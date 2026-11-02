import { Component, computed, input } from '@angular/core';

const ICONES = {
  painel: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  workspace: 'M3 4h18v13H3ZM8 21h8m-4-4v4M3 8h18',
  ferramentas: 'm14 6 4-4 4 4-4 4-4-4ZM2 3h7v7H2ZM2 15h7v7H2Zm13 0h7v7h-7Z',
  memoria: 'M3 7h7l2-3h7l2 3v14H3Zm0 4h18',
  execucoes: 'M12 3a9 9 0 1 1-8.5 6M3 3v6h6m3-3v6l4 2',
  agente: 'M8 3h8l4 6-2 10-6 3-6-3L4 9Zm-1 7 3 1m7-1-3 1m-4 6h4M12 3v4',
  atividade: 'M2 12h4l3-8 5 16 3-8h5',
  busca: 'M21 21l-6-6m2-6a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  grafico: 'M3 21h19M5 17V9h3v8Zm6 0V5h3v12Zm6 0V2h3v15Z',
  documento: 'M5 2h9l5 5v15H5Zm9 0v6h5M8 12h8m-8 4h8',
  automacao: 'm13 2-9 12h7l-1 8 10-13h-7Z',
  globo: 'M3 12h18M12 3a17 17 0 0 0 0 18 17 17 0 0 0 0-18Zm9 9a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  conversa: 'M3 4h18v13H8l-5 4Z',
  config:
    'm9 3 1-1h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1Zm7 9a4 4 0 1 0-8 0 4 4 0 0 0 8 0Z',
  voz: 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8',
  seta: 'm9 5 7 7-7 7',
} as const;
export type IconeHud = keyof typeof ICONES;

@Component({
  selector: 'app-icone-hud',
  template:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path [attr.d]="caminho()" /></svg>',
  styles:
    ':host{display:inline-flex;width:1.3em;height:1.3em;flex-shrink:0}svg{width:100%;height:100%}',
})
export class IconeHudComponent {
  readonly nome = input<IconeHud>('painel');
  protected readonly caminho = computed(() => ICONES[this.nome()]);
}
