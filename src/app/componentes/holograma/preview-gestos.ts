import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, viewChild } from '@angular/core';

import type { QuadroDeMaos } from '../../gestos/gestos.modelos';
import { AjustesDeGestosService } from '../../nucleo/ajustes-de-gestos.service';
import { RastreioDeMaoService } from '../../nucleo/rastreio-de-mao.service';

/** Os ossos da mão, pares de índices do MediaPipe. */
const OSSOS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

/**
 * O canto da câmera: o `<video>` que alimenta o detector, os pontos da mão por cima (os dois
 * espelhados, como um espelho de verdade) e o nome do gesto.
 *
 * Existir é ligar: a câmera abre quando o componente entra e solta quando ele sai. Esconder não
 * desliga — o vídeo só fica transparente, porque com `display: none` o iPhone para os quadros.
 */
@Component({
  selector: 'app-preview-gestos',
  template: `
    <div class="quadro" [class.quadro--oculto]="!visivel()">
      <video #video class="video" autoplay muted playsinline aria-hidden="true"></video>
      <canvas #tela class="pontos" aria-hidden="true"></canvas>
      @if (visivel()) { <p class="gesto">{{ gesto() }}</p> }
    </div>
    <div class="barra">
      <p class="indicador" role="status">
        <span class="luz" [class.luz--ligada]="rastreio.status() === 'ligado'" aria-hidden="true"></span>{{ textoDoStatus() }}
      </p>
      <button class="botao" type="button" (click)="alternarVisivel()">
        {{ visivel() ? 'Esconder' : 'Mostrar' }}<span class="oculto"> câmera</span>
      </button>
    </div>
  `,
  styleUrl: './preview-gestos.scss',
})
export class PreviewGestosComponent {
  readonly gesto = input('');

  protected readonly rastreio = inject(RastreioDeMaoService);
  private readonly ajustes = inject(AjustesDeGestosService);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly tela = viewChild.required<ElementRef<HTMLCanvasElement>>('tela');

  protected readonly visivel = computed(() => this.ajustes.ajustes().preview);
  protected readonly textoDoStatus = computed(() => {
    switch (this.rastreio.status()) {
      case 'carregando':
        return 'Ligando a câmera…';
      case 'ligado':
        if (this.rastreio.gravando()) return 'Câmera ligada · gravando';
        // Escuro, o detector não acha a mão: dizer por quê poupa o dono de achar que o gesto quebrou.
        return this.rastreio.poucaLuz() ? 'Pouca luz · acenda uma luz' : 'Câmera ligada';
      case 'pausado':
        return 'Câmera pausada';
      default:
        return 'Câmera desligada';
    }
  });

  constructor() {
    const pararDeOuvir = this.rastreio.ouvir((quadro) => this.desenhar(quadro));
    afterNextRender(() => void this.rastreio.ligar(this.video().nativeElement));
    inject(DestroyRef).onDestroy(() => {
      pararDeOuvir();
      this.rastreio.liberar();
    });
  }

  protected alternarVisivel(): void {
    this.ajustes.alterar({ preview: !this.visivel() });
  }

  /** Chamado a cada detecção, fora da detecção de mudanças: só canvas, nenhum signal. */
  private desenhar(quadro: QuadroDeMaos): void {
    const tela = this.tela().nativeElement;
    const video = this.video().nativeElement;
    if (!this.visivel() || !video.videoWidth) return;
    if (tela.width !== video.videoWidth) tela.width = video.videoWidth;
    if (tela.height !== video.videoHeight) tela.height = video.videoHeight;
    const ctx = tela.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, tela.width, tela.height);
    const { width: l, height: a } = tela;
    ctx.lineWidth = Math.max(1.5, l / 220);
    ctx.strokeStyle = 'rgba(95, 242, 255, 0.75)';
    ctx.fillStyle = '#a6f8ff';
    for (const mao of quadro.maos) {
      ctx.beginPath();
      for (const [de, para] of OSSOS) {
        const p = mao.pontos[de]!;
        const q = mao.pontos[para]!;
        ctx.moveTo(p[0] * l, p[1] * a);
        ctx.lineTo(q[0] * l, q[1] * a);
      }
      ctx.stroke();
      for (const p of mao.pontos) {
        ctx.beginPath();
        ctx.arc(p[0] * l, p[1] * a, Math.max(2, l / 160), 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
}
