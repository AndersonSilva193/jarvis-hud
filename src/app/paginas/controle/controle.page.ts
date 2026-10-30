import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { ReconhecedorDeToque, type ContatoDeToque } from '../../componentes/holograma/controle-de-toque';
import { mensagemDoGesto, mensagemDoToque } from '../../controle/controle.modelos';
import { MotorDeGestos } from '../../gestos/motor-de-gestos';
import { CanalDoControleService, type CredencialDoControle } from '../../nucleo/canal-do-controle.service';
import { conteudoMisto, normalizarUrl, urlValida } from '../../nucleo/config.store';
import { PerfilDoAparelhoService } from '../../nucleo/perfil-do-aparelho.service';
import { RastreioDeMaoService } from '../../nucleo/rastreio-de-mao.service';

type Modo = 'camera' | 'touchpad';

const TEXTO_DO_ESTADO = {
  parado: 'Sem conexão',
  conectando: 'Conectando…',
  conectado: 'Conectado ao PC',
  reconectando: 'Reconectando…',
  pcFora: 'PC fora do ar',
  encerrado: 'Desconectado',
} as const;

/**
 * O celular como controle do holograma do PC (Fase 5B). Abre pelo QR da HUD, sem `HUD_TOKEN`: o
 * código do QR é a credencial. Nada é desenhado aqui — os gestos (câmera, no perfil leve, ou
 * touchpad) viram eventos curtos que o `CanalDoControleService` manda ao PC.
 */
@Component({
  selector: 'app-controle-page',
  template: `
    <main class="tela" aria-labelledby="controle-titulo">
      <header class="topo">
        <p class="marca">Jarvis · Holograma</p>
        <h1 id="controle-titulo" class="titulo">Controle</h1>
        <p class="estado" role="status">
          <span class="luz" [class.luz--ok]="canal.estado() === 'conectado'" aria-hidden="true"></span>{{ textoDoEstado() }}
        </p>
        @if (canal.latencia(); as l) {
          <p class="latencia">Ida e volta até o PC: {{ l.p50 }} ms <span class="fraco">(p95 {{ l.p95 }} ms)</span></p>
        }
      </header>

      @if (ativo()) {
        <div class="modos" role="group" aria-label="Modo do controle">
          <button class="botao" type="button" [attr.aria-pressed]="modo() === 'touchpad'" (click)="modo.set('touchpad')">Touchpad</button>
          <button class="botao" type="button" [attr.aria-pressed]="modo() === 'camera'" (click)="modo.set('camera')">Câmera</button>
        </div>

        @if (modo() === 'touchpad') {
          <section #area class="touchpad" aria-labelledby="touchpad-dica">
            <p id="touchpad-dica" class="dica">
              Um dedo gira. Dois dedos: abrir ou fechar dá zoom; subir ou descer juntos explode e monta.
              Toque duplo reseta.
            </p>
          </section>
        } @else {
          <section class="camera" aria-labelledby="camera-dica">
            <video #video class="video" autoplay muted playsinline aria-hidden="true"></video>
            <p class="gesto" aria-hidden="true">{{ gesto() }}</p>
            <p id="camera-dica" class="dica">
              Pinça e arraste gira; pinça aproximando ou afastando a mão dá zoom; mão aberta parada explode;
              apontar seleciona; punho reseta. A imagem não sai do celular.
            </p>
          </section>
          <p class="aviso" role="status">{{ rastreio.aviso() }}</p>
        }

        <div class="acoes">
          <button class="botao" type="button" (click)="resetar()">Resetar</button>
          <button class="botao botao--sair" type="button" (click)="sair()">Sair</button>
        </div>
        @if (!wakeLockSuportado) {
          <p class="nota">Este navegador não consegue manter a tela acesa: ajuste o bloqueio automático do celular.</p>
        }
      } @else {
        <section class="painel" aria-labelledby="controle-fim">
          <h2 id="controle-fim" class="subtitulo">{{ canal.motivo() || 'Abra pelo QR code do PC' }}</h2>
          <p class="nota">No PC, abra o holograma e toque em <strong>Usar celular como controle</strong> para gerar um QR code novo.</p>
        </section>
      }
    </main>
  `,
  styleUrl: './controle.page.scss',
})
export class ControlePage {
  protected readonly canal = inject(CanalDoControleService);
  protected readonly rastreio = inject(RastreioDeMaoService);
  private readonly perfil = inject(PerfilDoAparelhoService);
  private readonly rota = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly modo = signal<Modo>('touchpad');
  protected readonly gesto = signal('Sem mão');
  protected readonly wakeLockSuportado = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  protected readonly ativo = computed(() => {
    const estado = this.canal.estado();
    return estado === 'conectando' || estado === 'conectado' || estado === 'reconectando' || estado === 'pcFora';
  });
  protected readonly textoDoEstado = computed(() => TEXTO_DO_ESTADO[this.canal.estado()]);

  private readonly area = viewChild<ElementRef<HTMLElement>>('area');
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly motor = new MotorDeGestos({ maosMax: 1, zoomPorProfundidade: true });
  private trava: WakeLockSentinel | null = null;

  constructor() {
    this.perfil.forcado.set('leve');
    this.entrar();

    const pararDeOuvir = this.rastreio.ouvir((quadro) => {
      for (const evento of this.motor.processar(quadro)) {
        if (evento.tipo === 'gesto') this.gesto.set(evento.nome);
        const m = mensagemDoGesto(evento);
        if (m) this.canal.enviar(m);
      }
    });

    // Câmera: liga quando o <video> aparece, solta quando o modo muda ou a conexão acaba.
    effect((aoLimpar) => {
      const video = this.video()?.nativeElement;
      if (!video) return;
      untracked(() => {
        this.motor.reiniciar();
        void this.rastreio.ligar(video);
      });
      aoLimpar(() => {
        this.rastreio.desligar();
        this.gesto.set('Sem mão');
      });
    });

    // Touchpad: o mesmo reconhecedor do toque da HUD, sem cena — cada intenção vira mensagem.
    effect((aoLimpar) => {
      const area = this.area()?.nativeElement;
      if (area) aoLimpar(ligarTouchpad(area, (m) => this.canal.enviar(m)));
    });

    // A tela não apaga enquanto o controle está ativo; a trava cai sozinha com a aba oculta.
    effect(() => {
      if (this.ativo()) void this.travarTela();
      else this.soltarTela();
    });
    const aoVoltar = () => {
      if (document.visibilityState === 'visible' && this.ativo()) void this.travarTela();
    };
    document.addEventListener('visibilitychange', aoVoltar);

    inject(DestroyRef).onDestroy(() => {
      pararDeOuvir();
      document.removeEventListener('visibilitychange', aoVoltar);
      this.rastreio.desligar();
      this.soltarTela();
      this.perfil.forcado.set(null);
      if (this.ativo()) this.canal.sair();
    });
  }

  protected resetar(): void {
    this.canal.enviar({ t: 'resetar' });
  }

  protected sair(): void {
    this.canal.sair();
  }

  /** Pelo QR (`?par=&api=`) ou, recarregando a aba, pela chave guardada nela. */
  private entrar(): void {
    const consulta = this.rota.snapshot.queryParamMap;
    const par = consulta.get('par') ?? '';
    const api = normalizarUrl(consulta.get('api') ?? '');
    let credencial: CredencialDoControle | null = null;
    if (/^[A-Za-z0-9_-]{43}$/.test(par) && urlValida(api) && !conteudoMisto(api)) credencial = { api, par };
    else credencial = this.canal.credencialGuardada();
    // O código é de uso único: fora da barra de endereço, recarregar usa a retomada.
    if (consulta.has('par')) void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    if (credencial) this.canal.conectar(credencial);
  }

  private async travarTela(): Promise<void> {
    if (!this.wakeLockSuportado || (this.trava && !this.trava.released)) return;
    try {
      this.trava = await navigator.wakeLock.request('screen');
    } catch {
      // Bateria fraca ou aba oculta: tenta de novo na volta (visibilitychange).
      this.trava = null;
    }
  }

  private soltarTela(): void {
    void this.trava?.release().catch(() => undefined);
    this.trava = null;
  }
}

/**
 * Os pointer events da área viram contatos do `ReconhecedorDeToque`, e as intenções, mensagens em
 * frações da altura da área. Mouse e caneta também valem: é como se testa no computador.
 */
function ligarTouchpad(area: HTMLElement, enviar: (m: ReturnType<typeof mensagemDoToque>) => void): () => void {
  const reconhecedor = new ReconhecedorDeToque(() => area.clientHeight || 1);
  const contato = (e: PointerEvent): ContatoDeToque => {
    const r = area.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  };
  const mandar = (intencoes: ReturnType<ReconhecedorDeToque['baixar']>) => {
    for (const i of intencoes) enviar(mensagemDoToque(i, area.clientHeight));
  };
  const baixar = (e: PointerEvent) => {
    area.setPointerCapture(e.pointerId);
    mandar(reconhecedor.baixar(contato(e)));
  };
  const mover = (e: PointerEvent) => mandar(reconhecedor.mover(contato(e)));
  const levantar = (e: PointerEvent) => mandar(reconhecedor.levantar(contato(e)));
  const cancelar = (e: PointerEvent) => mandar(reconhecedor.cancelar(contato(e)));
  area.addEventListener('pointerdown', baixar);
  area.addEventListener('pointermove', mover);
  area.addEventListener('pointerup', levantar);
  area.addEventListener('pointercancel', cancelar);
  return () => {
    area.removeEventListener('pointerdown', baixar);
    area.removeEventListener('pointermove', mover);
    area.removeEventListener('pointerup', levantar);
    area.removeEventListener('pointercancel', cancelar);
  };
}
