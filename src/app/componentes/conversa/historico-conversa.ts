import { Component, ElementRef, afterRenderEffect, input, output, model, viewChild } from '@angular/core';
import type { TrocaConversa } from '../../nucleo/conversa.modelos';

@Component({
  selector: 'app-historico-conversa',
  template: ` <button
      class="alternar"
      #botao
      type="button"
      (click)="aberto.set(!aberto())"
      [attr.aria-expanded]="aberto()"
      aria-controls="historico-conversa"
    >
      {{ aberto() ? 'Fechar histórico' : 'Histórico' }}
    </button>
    @if (aberto()) {
      <aside #painel id="historico-conversa" aria-label="Últimas dez trocas" tabindex="-1">
        <h2>Últimas conversas</h2>
        <button type="button" [disabled]="ocupada()" (click)="limpar.emit()">
          Limpar conversa
        </button>
        <ol>
          @for (troca of trocas(); track troca.id) {
            <li>
              <span class="canal">{{ troca.canal === 'hud' ? 'HUD' : 'Telegram' }}</span>
              <p><b>Você:</b> {{ troca.pedido }}</p>
              <p><b>Jarvis:</b> {{ troca.resposta.texto }}</p>
            </li>
          } @empty {
            <li>A conversa ainda está vazia.</li>
          }
        </ol>
      </aside>
    }`,
  styles: `
    :host {
      position: absolute;
      right: 1rem;
      top: 1rem;
      z-index: 100;
    }
    button {
      font: 500 0.65rem monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      background: linear-gradient(180deg, rgba(13, 43, 74, 0.9), rgba(5, 17, 34, 0.92));
      color: #cdeaff;
      border: 1px solid rgba(95, 242, 255, 0.3);
      padding: 0.6rem 0.9rem;
      border-radius: 0;
      clip-path: polygon(
        7px 0,
        100% 0,
        100% calc(100% - 7px),
        calc(100% - 7px) 100%,
        0 100%,
        0 7px
      );
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      color: #a6f8ff;
      border-color: #5ff2ff;
    }
    .alternar {
      display: block;
      margin-left: auto;
    }
    aside {
      margin-top: 0.5rem;
      width: min(22rem, 85vw);
      max-height: 60vh;
      overflow: auto;
      padding: 1rem;
      box-sizing: border-box;
      background: linear-gradient(160deg, rgba(10, 32, 62, 0.95), rgba(3, 12, 26, 0.96));
      border: 1px solid rgba(95, 242, 255, 0.3);
      clip-path: polygon(
        14px 0,
        100% 0,
        100% calc(100% - 14px),
        calc(100% - 14px) 100%,
        0 100%,
        0 14px
      );
      backdrop-filter: blur(8px);
      color: #dff4ff;
    }
    h2 {
      font: 500 0.62rem monospace;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: #5ff2ff;
      margin: 0 0 0.8rem;
    }
    ol {
      list-style: none;
      padding: 0;
      margin-bottom: 0;
    }
    li {
      border-top: 1px solid #38515f;
      padding-top: 0.7rem;
      margin-top: 0.7rem;
      font-size: 0.85rem;
      overflow-wrap: anywhere;
    }
    p {
      white-space: pre-wrap;
      line-height: 1.5;
    }
    .canal {
      color: #a6f8ff;
      font: 0.75rem monospace;
    }
    button:disabled {
      opacity: 0.55;
    }
    button:focus-visible {
      outline: 2px solid #a6f8ff;
      outline-offset: 3px;
    }
  `,
})
export class HistoricoConversaComponent {
  readonly trocas = input<TrocaConversa[]>([]);
  readonly ocupada = input(false);
  readonly limpar = output<void>();
  readonly aberto = model(false);
  private readonly botao = viewChild<ElementRef<HTMLButtonElement>>('botao');
  private readonly painel = viewChild<ElementRef<HTMLElement>>('painel');
  private anterior = false;
  constructor() {
    afterRenderEffect(() => {
      const aberto = this.aberto();
      const alvo = aberto ? this.painel() : this.botao();
      if (aberto !== this.anterior) { this.anterior = aberto; alvo?.nativeElement.focus({ preventScroll: true }); }
    });
  }
}
