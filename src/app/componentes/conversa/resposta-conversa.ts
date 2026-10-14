import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { AnexoConversaComponent } from './anexo-conversa';
import type { RespostaConversa } from '../../nucleo/conversa.modelos';

@Component({
  selector: 'app-resposta-conversa',
  imports: [AnexoConversaComponent],
  template: ` <div class="resposta">
    @if (resposta(); as r) {
      <p class="texto" aria-live="polite" aria-atomic="true">{{ r.texto }}</p>
      @for (anexo of r.anexos; track anexo.id) {
        <app-anexo-conversa [anexo]="anexo" />
      }
      @if (r.confirmacao; as c) {
        <section aria-label="Confirmação solicitada">
          <p>{{ c.descricao }}</p>
          <strong class="codigo">{{ c.codigo }}</strong>
          @if (expirada()) {
            <p>Confirmação expirada.</p>
          }
          <div>
            <button
              type="button"
              [disabled]="ocupada() || expirada()"
              (click)="comando.emit('confirmo ' + c.codigo)"
            >
              Confirmar
            </button>
            <button
              type="button"
              [disabled]="ocupada() || expirada()"
              (click)="comando.emit('cancelo ' + c.codigo)"
            >
              Cancelar
            </button>
          </div>
        </section>
      }
    } @else {
      <p>Como posso ajudar?</p>
    }
    @if (erro()) {
      <p class="erro" role="alert">{{ erro() }}</p>
    }
  </div>`,
  styles: `
    :host {
      display: block;
      color: #dff4ff;
    }
    p {
      margin: 0 0 0.6rem;
    }
    .texto {
      white-space: pre-wrap;
      line-height: 1.65;
      font-size: 1rem;
      overflow-wrap: anywhere;
    }
    app-anexo-conversa {
      display: block;
      margin-top: 0.7rem;
    }
    section {
      margin-top: 1rem;
      padding-top: 0.9rem;
      border-top: 1px solid rgba(95, 242, 255, 0.28);
    }
    .codigo {
      display: block;
      font: 700 2rem monospace;
      letter-spacing: 0.25em;
      color: #a6f8ff;
      text-shadow: 0 0 22px rgba(95, 242, 255, 0.45);
      margin: 0.5rem 0;
    }
    button {
      padding: 0.6rem 1.1rem;
      margin: 0.5rem 0.5rem 0 0;
      background: #12354a;
      color: #dff4ff;
      border: 1px solid #608b9a;
      border-radius: 0;
      clip-path: polygon(
        8px 0,
        100% 0,
        100% calc(100% - 8px),
        calc(100% - 8px) 100%,
        0 100%,
        0 8px
      );
      font: 500 0.75rem monospace;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      background: #184761;
      border-color: #68cbdc;
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .erro {
      color: #ff9ba7;
    }
    button:focus-visible {
      outline: 2px solid #a6f8ff;
      outline-offset: 3px;
    }
  `,
})
export class RespostaConversaComponent {
  readonly resposta = input<RespostaConversa | null>(null);
  readonly erro = input('');
  readonly ocupada = input(false);
  readonly comando = output<string>();
  private readonly agora = signal(Date.now());
  readonly expirada = computed(() => {
    const prazo = this.resposta()?.confirmacao?.expiraEm;
    return !prazo || !Number.isFinite(Date.parse(prazo)) || Date.parse(prazo) <= this.agora();
  });
  constructor() {
    const tempo = setInterval(() => this.agora.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tempo));
  }
}
