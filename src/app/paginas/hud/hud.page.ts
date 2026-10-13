import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';

import { CardClimaComponent } from '../../componentes/card-clima/card-clima';
import { CardLembretesComponent } from '../../componentes/card-lembretes/card-lembretes';
import { CardNoticiaComponent } from '../../componentes/card-noticia/card-noticia';
import { CardSistemasComponent } from '../../componentes/card-sistemas/card-sistemas';
import { CardTextoComponent } from '../../componentes/card-texto/card-texto';
import { OrbeComponent, type EstadoOrbe } from '../../componentes/orbe/orbe';
import { BriefingPlayerService } from '../../nucleo/briefing-player.service';
import { JarvisApiService } from '../../nucleo/jarvis-api.service';
import { JarvisEventosService } from '../../nucleo/jarvis-eventos.service';
import { VozService } from '../../nucleo/voz.service';

/** Tempo parado até o cursor sumir: o HUD vive num monitor, sem ninguém mexendo no mouse. */
const OCIOSO_ATE_ESCONDER_MS = 5_000;

/**
 * A tela do HUD: orbe no centro, o bloco atual por cima dele e os já falados numa fileira.
 *
 * Três coisas podem trazer um briefing — o botão, o `/bomdia` do Telegram e o cron das 8h — e as
 * duas últimas chegam sem clique nenhum, então a tela se monta sozinha a partir do SSE.
 */
@Component({
  selector: 'app-hud',
  imports: [
    OrbeComponent,
    CardClimaComponent,
    CardLembretesComponent,
    CardNoticiaComponent,
    CardSistemasComponent,
    CardTextoComponent,
    RouterLink,
  ],
  templateUrl: './hud.page.html',
  styleUrl: './hud.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HudPage implements OnInit, OnDestroy {
  protected readonly player = inject(BriefingPlayerService);
  protected readonly voz = inject(VozService);
  protected readonly eventos = inject(JarvisEventosService);
  private readonly api = inject(JarvisApiService);

  protected readonly pedindo = signal(false);
  protected readonly erro = signal('');

  protected readonly estadoOrbe = computed<EstadoOrbe>(() => {
    if (this.player.fase() === 'gerando') {
      return 'gerando';
    }
    return this.voz.falando() ? 'falando' : 'ocioso';
  });

  protected readonly estadoDaConexao = computed(() => {
    switch (this.eventos.status()) {
      case 'online':
        return 'conectado';
      case 'conectando':
        return 'conectando';
      case 'reconectando':
        switch (this.eventos.motivo()) {
          case 'token-invalido':
            return 'token inválido';
          case 'api-inacessivel':
            return 'api fora do ar';
          default:
            return 'reconectando';
        }
      default:
        return 'desligado';
    }
  });

  private ocioso: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.eventos.conectar({
      gerando: () => this.player.gerando(),
      briefing: (briefing) => void this.player.tocar(briefing),
    });

    // Conectar no SSE não traz nada: quem pinta a tela ao abrir é o último briefing.
    this.api
      .ultimoBriefing()
      .then((briefing) => {
        if (briefing) {
          this.player.mostrar(briefing);
        }
      })
      .catch(() => {
        // O estado da conexão no rodapé já conta essa história.
      });

    window.addEventListener('keydown', this.aoTeclar);
    window.addEventListener('mousemove', this.aoMexerOMouse);
    this.agendarEsconderCursor();
  }

  ngOnDestroy(): void {
    this.eventos.desconectar();
    this.player.parar();
    window.removeEventListener('keydown', this.aoTeclar);
    window.removeEventListener('mousemove', this.aoMexerOMouse);
    if (this.ocioso !== null) {
      clearTimeout(this.ocioso);
    }
    document.body.classList.remove('sem-cursor');
  }

  /**
   * Pede um briefing novo.
   *
   * O destravar() tem de acontecer dentro do clique, senão o Chrome recusa a fala. E o briefing
   * que volta aqui é tocado direto porque, se a API reaproveitar um de menos de 60 s, ela não
   * emite nada no SSE — o clique ficaria sem resposta.
   */
  protected async bomDia(): Promise<void> {
    this.voz.destravar();
    this.pedindo.set(true);
    this.erro.set('');
    try {
      const briefing = await this.api.gerarBriefing();
      void this.player.tocar(briefing);
    } catch (erro) {
      this.erro.set(explicar(erro));
    } finally {
      this.pedindo.set(false);
    }
  }

  private readonly aoTeclar = (evento: KeyboardEvent): void => {
    if (evento.key === 'ArrowRight') {
      this.player.pular();
    } else if (evento.key === 'Escape') {
      this.player.parar();
    }
  };

  private readonly aoMexerOMouse = (): void => {
    document.body.classList.remove('sem-cursor');
    this.agendarEsconderCursor();
  };

  private agendarEsconderCursor(): void {
    if (this.ocioso !== null) {
      clearTimeout(this.ocioso);
    }
    this.ocioso = setTimeout(
      () => document.body.classList.add('sem-cursor'),
      OCIOSO_ATE_ESCONDER_MS,
    );
  }
}

function explicar(erro: unknown): string {
  if (erro instanceof HttpErrorResponse) {
    if (erro.status === 401 || erro.status === 403) {
      return 'token recusado pela API';
    }
    if (erro.status === 0) {
      return 'não consegui falar com a API';
    }
    return `a API respondeu ${erro.status}`;
  }
  return 'não consegui pedir o briefing';
}
