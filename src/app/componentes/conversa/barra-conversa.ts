import { Component, input, model, output } from '@angular/core';

@Component({
  selector: 'app-barra-conversa',
  template: ` <div class="barra" role="group" aria-label="Conversar com o Jarvis">
    <label class="rotulo" for="mensagem-jarvis">Sua mensagem</label>
    <textarea
      id="mensagem-jarvis"
      rows="2"
      maxlength="8000"
      [value]="texto()"
      (input)="editar($event)"
      (keydown)="teclar($event)"
      placeholder="Escreva para o Jarvis…"
      aria-describedby="ajuda-conversa"
    ></textarea>
    <div class="acoes">
      @if (vozDisponivel()) {
        <button
          type="button"
          (click)="microfone.emit()"
          [disabled]="ocupada()"
          [attr.aria-pressed]="ditando()"
          [attr.aria-label]="ditando() ? 'Cancelar ditado' : 'Ditar mensagem'"
        >
          {{ ditando() ? 'Cancelar ditado' : 'Ditar' }}
        </button>
      }
      <button
        type="button"
        (click)="enviar.emit()"
        [disabled]="ocupada() || ditando() || !texto().trim()"
      >
        Enviar
      </button>
    </div>
    <p id="ajuda-conversa">
      {{
        ditando()
          ? 'Ouvindo sua mensagem…'
          : ocupada()
            ? 'Aguarde a resposta. Você pode preparar a próxima mensagem.'
            : 'Enter envia · Shift + Enter quebra a linha'
      }}
    </p>
  </div>`,
  styles: `
    :host {
      display: block;
    }
    .barra {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.5rem 0.8rem;
      padding: 0.8rem 1rem;
      background: #07162cf2;
      border: 1px solid #386577;
      border-radius: 8px;
    }
    .rotulo {
      grid-column: 1/-1;
      color: #a6f8ff;
      font: 600 0.75rem monospace;
    }
    textarea {
      resize: none;
      width: 100%;
      box-sizing: border-box;
      background: #030a18;
      color: #dff4ff;
      border: 1px solid #527381;
      border-radius: 4px;
      padding: 0.65rem;
      font: inherit;
    }
    .acoes {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    button {
      padding: 0.7rem;
      color: #a6f8ff;
      background: #102e46;
      border: 1px solid #5c8796;
      border-radius: 4px;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    button[aria-pressed='true'] {
      background: #24526a;
    }
    p {
      grid-column: 1/-1;
      margin: 0;
      color: #b6ced8;
      font-size: 0.72rem;
    }
    :focus-visible {
      outline: 2px solid #a6f8ff;
      outline-offset: 3px;
    }
    @media (max-width: 600px) {
      .barra {
        grid-template-columns: 1fr;
      }
      .acoes {
        justify-content: flex-end;
      }
    }
  `,
})
export class BarraConversaComponent {
  readonly texto = model('');
  readonly ocupada = input(false);
  readonly ditando = input(false);
  readonly vozDisponivel = input(false);
  readonly enviar = output<void>();
  readonly microfone = output<void>();
  protected editar(evento: Event): void {
    this.texto.set((evento.target as HTMLTextAreaElement).value);
  }
  protected teclar(evento: KeyboardEvent): void {
    if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
      evento.preventDefault();
      if (!this.ocupada() && !this.ditando() && this.texto().trim()) this.enviar.emit();
    }
  }
}
