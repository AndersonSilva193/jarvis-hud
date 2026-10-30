import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';

import { CanalDaHudService } from '../../nucleo/canal-da-hud.service';
import { ConfigStore } from '../../nucleo/config.store';

type FabricaDeQr = typeof import('qrcode-generator');

/** A zona quieta que o padrão do QR pede em volta do desenho, em módulos. */
const MARGEM_DO_QR = 4;

/** O endereço que o QR leva: a rota do controle nesta mesma HUD, com o código e a API. */
export function urlDoControle(origem: string, codigo: string, urlApi: string): string {
  return `${origem}/controle?${new URLSearchParams({ par: codigo, api: urlApi }).toString()}`;
}

/**
 * "Usar celular como controle": abre o canal, mostra o QR com o código de uso único e, com o
 * celular ligado, vira "Celular conectado" e "Desconectar". O QR é um `<path>` montado aqui (sem
 * `innerHTML`), escuro sobre claro para qualquer câmera ler, com a URL em texto ao lado.
 */
@Component({
  selector: 'app-parear-celular',
  template: `
    @switch (canal.estado()) {
      @case ('conectado') {
        <span class="ligado"><span class="luz" aria-hidden="true"></span>Celular conectado</span>
        <button class="botao" type="button" (click)="canal.desconectar()">Desconectar</button>
      }
      @case ('caiu') {
        <span class="ligado ligado--caiu"><span class="luz" aria-hidden="true"></span>Celular caiu</span>
        <button class="botao" type="button" (click)="canal.desconectar()">Desconectar</button>
      }
      @default {
        <button class="botao" type="button" aria-haspopup="dialog" (click)="abrir()">Usar celular como controle</button>
      }
    }
    <!-- Sempre no DOM: uma região viva criada junto com o texto não é anunciada. -->
    <p class="aviso" role="status">{{ canal.aviso() }}</p>

    <dialog #dialogo class="dialogo" aria-labelledby="parear-titulo" (close)="aoFechar()" (keydown.escape)="aoEsc($event)">
      <h2 id="parear-titulo" class="titulo">Celular como controle</h2>
      @if (canal.estado() === 'aguardando' && qr(); as desenho) {
        @if (venceu()) {
          <p class="nota">O código venceu.</p>
          <button class="botao botao--forte" type="button" (click)="canal.parear()">Gerar outro</button>
        } @else {
          <svg class="qr" role="img" aria-labelledby="parear-qr" [attr.viewBox]="desenho.viewBox">
            <title id="parear-qr">QR code que abre o controle no celular</title>
            <rect [attr.x]="-margem" [attr.y]="-margem" width="100%" height="100%" fill="#ffffff" />
            <path [attr.d]="desenho.caminho" fill="#01050e" />
          </svg>
          <p class="nota">Aponte a câmera do celular. Uso único, vale por <strong>{{ restante() }}</strong>.</p>
          <p class="nota">Ou abra no celular: <span class="url">{{ url() }}</span></p>
        }
      } @else if (canal.estado() === 'abrindo') {
        <p class="nota" role="status">Preparando o código…</p>
      } @else if (canal.aviso()) {
        <p class="nota nota--erro">{{ canal.aviso() }}</p>
        <button class="botao botao--forte" type="button" (click)="canal.parear()">Tentar de novo</button>
      }
      <div class="acoes">
        <button class="botao" type="button" (click)="fechar()">Fechar</button>
      </div>
    </dialog>
  `,
  styleUrl: './parear-celular.scss',
})
export class ParearCelularComponent {
  protected readonly canal = inject(CanalDaHudService);
  private readonly config = inject(ConfigStore);
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  protected readonly margem = MARGEM_DO_QR;

  private readonly agora = signal(Date.now());
  private relogio: ReturnType<typeof setInterval> | null = null;
  /** O gerador de QR chega por `import()` na primeira abertura: fora do pacote inicial. */
  private readonly fabrica = signal<FabricaDeQr | null>(null);

  protected readonly url = computed(() => {
    const codigo = this.canal.codigo();
    return codigo ? urlDoControle(location.origin, codigo.codigo, this.config.urlApi()) : '';
  });

  protected readonly qr = computed(() => {
    const qrcode = this.fabrica();
    const url = this.url();
    if (!qrcode || !url) return null;
    const codigo = qrcode(0, 'M');
    codigo.addData(url);
    codigo.make();
    const n = codigo.getModuleCount();
    let caminho = '';
    for (let l = 0; l < n; l++) for (let c = 0; c < n; c++) if (codigo.isDark(l, c)) caminho += `M${c} ${l}h1v1h-1z`;
    const lado = n + 2 * MARGEM_DO_QR;
    return { caminho, viewBox: `${-MARGEM_DO_QR} ${-MARGEM_DO_QR} ${lado} ${lado}` };
  });

  private readonly segundos = computed(() => {
    const codigo = this.canal.codigo();
    return codigo ? Math.max(0, Math.ceil((codigo.expiraEm - this.agora()) / 1000)) : 0;
  });
  protected readonly venceu = computed(() => this.segundos() === 0);
  protected readonly restante = computed(() => {
    const s = this.segundos();
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  });

  constructor() {
    // O celular entrou: o diálogo já cumpriu o papel.
    effect(() => {
      if (this.canal.estado() === 'conectado' && this.dialogo().nativeElement.open) this.dialogo().nativeElement.close();
    });
    inject(DestroyRef).onDestroy(() => this.pararRelogio());
  }

  protected async abrir(): Promise<void> {
    this.dialogo().nativeElement.showModal();
    this.agora.set(Date.now());
    this.relogio ??= setInterval(() => this.agora.set(Date.now()), 1_000);
    this.canal.parear();
    if (!this.fabrica()) {
      const { default: qrcode } = await import('qrcode-generator');
      this.fabrica.set(qrcode);
    }
  }

  protected fechar(): void {
    this.dialogo().nativeElement.close();
  }

  /** Fechou sem celular: o código não serve mais para nada, e o canal fecha junto. */
  protected aoFechar(): void {
    this.pararRelogio();
    const estado = this.canal.estado();
    if (estado === 'aguardando' || estado === 'abrindo') this.canal.fechar();
  }

  /** O Esc é do diálogo: sem isto, a HUD também fecharia o holograma inteiro. */
  protected aoEsc(evento: Event): void {
    evento.preventDefault();
    evento.stopPropagation();
    this.fechar();
  }

  private pararRelogio(): void {
    if (this.relogio) clearInterval(this.relogio);
    this.relogio = null;
  }
}
