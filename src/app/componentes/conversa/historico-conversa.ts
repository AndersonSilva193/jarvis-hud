import { Component, input, output, signal } from '@angular/core';
import type { TrocaConversa } from '../../nucleo/conversa.modelos';

@Component({
  selector: 'app-historico-conversa',
  template: ` <button
      class="alternar"
      type="button"
      (click)="aberto.set(!aberto())"
      [attr.aria-expanded]="aberto()"
      aria-controls="historico-conversa"
    >
      {{ aberto() ? 'Fechar histórico' : 'Histórico' }}
    </button>
    @if (aberto()) {
      <aside id="historico-conversa" aria-label="Últimas dez trocas">
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
      z-index: 8;
    }
    button {
      background: #12354a;
      color: #dff4ff;
      border: 1px solid #608b9a;
      padding: 0.6rem 0.8rem;
      border-radius: 4px;
      cursor: pointer;
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
      background: #07162cf5;
      border: 1px solid #608b9a;
      border-radius: 6px;
      color: #dff4ff;
    }
    h2 {
      font-size: 1rem;
      margin-top: 0;
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
  readonly aberto = signal(false);
}
