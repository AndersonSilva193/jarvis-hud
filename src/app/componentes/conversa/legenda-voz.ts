import { Component, ElementRef, afterRenderEffect, inject, input, viewChild } from '@angular/core';
import { VozService } from '../../nucleo/voz.service';

@Component({
  selector: 'app-legenda-voz',
  host: { '[class.vazia]': 'compacta() && !transcricao() && !voz.trechoAtual()' },
  template: `<div #faixa class="faixa" role="region" aria-label="Legenda da fala" aria-live="off">
    <span class="quem">{{ transcricao() ? 'Você' : voz.trechoAtual() ? 'Jarvis' : '' }}</span>
    <p>{{ transcricao() || voz.trechoAtual() }}</p>
  </div>`,
  styles: `
    :host{display:block;flex-shrink:0;width:100%;max-width:60rem;align-self:center}
    :host.vazia{display:none}
    .faixa{padding:.25rem .75rem;text-align:center;color:#dff4ff}
    .quem{display:block;height:1em;font:600 .6rem monospace;letter-spacing:.2em;text-transform:uppercase;color:#a6f8ff}
    p{margin:.35rem 0 0;height:3em;line-height:1.5;font-size:clamp(.85rem,1.2vw,1rem);overflow:hidden;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  `,
})
export class LegendaVozComponent {
  readonly compacta = input(false);
  readonly transcricao = input('');
  protected readonly voz = inject(VozService);
  private readonly faixa = viewChild.required<ElementRef<HTMLElement>>('faixa');

  constructor() {
    afterRenderEffect(limpar => {
      if (typeof ResizeObserver === 'undefined') return;
      const faixa = this.faixa().nativeElement;
      const medir = () => {
        const paragrafo = faixa.querySelector('p');
        if (!paragrafo) return;
        const tamanho = Number.parseFloat(getComputedStyle(paragrafo).fontSize) || 16;
        // Margem conservadora para duas linhas, inclusive fontes monoespaçadas.
        this.voz.limiteLegenda.set(Math.max(20, Math.min(100, Math.floor((paragrafo.clientWidth / tamanho) * 2.3))));
      };
      const observador = new ResizeObserver(medir);
      observador.observe(faixa);
      medir();
      limpar(() => observador.disconnect());
    });
  }
}
