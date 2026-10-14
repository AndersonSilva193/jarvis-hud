import { Component, computed, input } from '@angular/core';

import {
  descreverSondas,
  type EstadoDasSondas,
  type IconeSonda,
  type Sonda,
} from './sondas.modelo';

/** Traços de 24×24, no mesmo peso dos ícones do resto do HUD. */
const ICONES: Record<IconeSonda, string> = {
  onda: 'M2 12h2M6 8v8M10 5v14M14 9v6M18 7v10M22 12h-2',
  documento: 'M6 3h9l4 4v14H6z M9 10h7M9 14h7M9 18h4',
  brilho:
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z',
  'alto-falante': 'M4 9h4l5-4v14l-5-4H4z M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
};

/**
 * Os cards-satélite ligados ao orbe por fios: entrada de áudio, transcrição, processamento e
 * voz. Ficam por baixo do palco e recuam quando há card nele.
 *
 * É `aria-hidden` de propósito: tudo o que aparece aqui já é anunciado pela linha de estado
 * (`role="status"`) e pelos controles do rodapé. Repetir no leitor de tela seria ruído.
 */
@Component({
  selector: 'app-sondas',
  template: `
    <svg class="fios" viewBox="0 0 100 100" preserveAspectRatio="none">
      @for (sonda of sondas(); track sonda.id) {
        <polyline class="fio" [class.fio--ativo]="sonda.ativa" [attr.points]="pontos(sonda)" />
      }
    </svg>
    @for (sonda of sondas(); track sonda.id) {
      <i
        class="ponta"
        [class.ponta--ativa]="sonda.ativa"
        [style.left.%]="sonda.alvo[0]"
        [style.top.%]="sonda.alvo[1]"
      ></i>
      <div
        class="sonda"
        [class.sonda--ativa]="sonda.ativa"
        [attr.data-sonda]="sonda.id"
        [style.top.%]="sonda.y"
        [style.right.%]="sonda.lado === 'esquerda' ? 100 - sonda.x : null"
        [style.left.%]="sonda.lado === 'direita' ? sonda.x : null"
      >
        <svg class="icone" viewBox="0 0 24 24">
          <path [attr.d]="icones[sonda.icone]" />
        </svg>
        <div>
          <strong>{{ sonda.titulo }}</strong>
          <small>{{ sonda.detalhe }}</small>
        </div>
      </div>
    }
  `,
  styleUrl: './sondas.scss',
  host: { 'aria-hidden': 'true', '[class.recuada]': 'recuada()' },
})
export class SondasComponent {
  readonly estado = input<EstadoDasSondas>('ocioso');
  readonly escutaDisponivel = input(false);
  readonly escutaLigada = input(false);
  readonly ditando = input(false);
  readonly progresso = input('');
  readonly rotuloVoz = input('');
  /** Há card no palco: as sondas apagam e deixam o card ser o assunto. */
  readonly recuada = input(false);

  protected readonly icones = ICONES;
  protected readonly sondas = computed(() =>
    descreverSondas({
      estado: this.estado(),
      escutaDisponivel: this.escutaDisponivel(),
      escutaLigada: this.escutaLigada(),
      ditando: this.ditando(),
      progresso: this.progresso(),
      rotuloVoz: this.rotuloVoz(),
    }),
  );

  protected pontos(sonda: Sonda): string {
    return `${sonda.x},${sonda.y} ${sonda.cotovelo},${sonda.y} ${sonda.alvo[0]},${sonda.alvo[1]}`;
  }
}
