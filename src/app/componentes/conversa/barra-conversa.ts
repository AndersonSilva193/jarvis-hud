import { Component, ElementRef, computed, input, model, output, viewChild } from '@angular/core';

@Component({
  selector: 'app-barra-conversa',
  host: { '[class.embutida]': 'embutida()' },
  template: ` <div class="barra" role="group" aria-label="Conversar com o Jarvis">
    <div class="compacta" [hidden]="expandida()">
      <button
        type="button"
        (click)="abrir()"
        aria-controls="editor-conversa"
        [attr.aria-expanded]="expandida()"
      >
        Conversar <span aria-hidden="true">↗</span>
      </button>
      @if (vozDisponivel()) {
        <button
          class="ditar"
          type="button"
          aria-label="Ditar mensagem"
          [disabled]="ocupada()"
          (click)="microfone.emit()"
        >
          ◉
        </button>
      }
    </div>
    <div id="editor-conversa" class="editor" [hidden]="!expandida()">
      <label class="rotulo" for="mensagem-jarvis">Sua mensagem</label>
      <textarea
        #campo
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
        @if (!embutida()) {
        <button
          type="button"
          aria-label="Recolher conversa"
          [disabled]="!!texto().trim() || ditando()"
          (click)="aberta.set(false)"
        >
          Recolher
        </button>
        }
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
    </div>
  </div>`,
  styles: `
    :host {
      display: block;
    }
    :host.embutida .editor{grid-template-columns:minmax(0,1fr);padding:.8rem}
    :host.embutida .acoes{justify-content:flex-end;flex-wrap:wrap}
    :host.embutida textarea{font-size:1rem;min-height:6rem}
    :host.embutida button{min-height:44px}
    [hidden] {
      display: none !important;
    }
    .barra {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.5rem 0.8rem;
    }
    .compacta {
      display: flex;
      justify-content: center;
      gap: 0.7rem;
    }
    .compacta button {
      border-radius: 30px;
      padding: 0.8rem 1.6rem;
      letter-spacing: 0.18em;
      box-shadow: 0 0 25px rgba(22, 122, 255, 0.18);
    }
    .compacta .ditar {
      border-radius: 50%;
      padding: 0.8rem 1rem;
      letter-spacing: 0;
    }
    /* O editor encosta no diálogo acima: mesmo corte, mesma borda, um painel só. */
    .editor {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.6rem;
      padding: 0.9rem 1.1rem;
      background: linear-gradient(180deg, rgba(7, 22, 44, 0.92), rgba(3, 12, 26, 0.95));
      border: 1px solid rgba(95, 242, 255, 0.3);
      clip-path: polygon(0 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%);
      backdrop-filter: blur(8px);
    }
    .rotulo {
      grid-column: 1/-1;
      font: 500 0.58rem monospace;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: #5ff2ff;
    }
    textarea {
      resize: none;
      width: 100%;
      box-sizing: border-box;
      background: rgba(2, 8, 20, 0.85);
      color: #dff4ff;
      border: 1px solid rgba(95, 242, 255, 0.25);
      border-radius: 0;
      padding: 0.7rem;
      font: inherit;
      caret-color: #5ff2ff;
    }
    textarea:focus {
      border-color: rgba(95, 242, 255, 0.6);
      outline: none;
      box-shadow: 0 0 18px rgba(45, 125, 255, 0.25) inset;
    }
    textarea::placeholder {
      color: #7f9bb5;
    }
    .acoes {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    button {
      font: 500 0.67rem monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      padding: 0.7rem 1rem;
      color: #cdeaff;
      background: linear-gradient(180deg, rgba(13, 43, 74, 0.9), rgba(5, 17, 34, 0.92));
      border: 1px solid rgba(95, 242, 255, 0.3);
      border-radius: 0;
      clip-path: polygon(
        8px 0,
        100% 0,
        100% calc(100% - 8px),
        calc(100% - 8px) 100%,
        0 100%,
        0 8px
      );
      cursor: pointer;
      transition:
        color 0.18s ease,
        border-color 0.18s ease,
        box-shadow 0.18s ease;
    }
    button:hover:not(:disabled) {
      color: #a6f8ff;
      border-color: #5ff2ff;
      box-shadow: 0 0 18px rgba(45, 125, 255, 0.35);
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    button[aria-pressed='true'] {
      background: linear-gradient(180deg, #1c4a63, #0b2135);
      border-color: #69bac9;
    }
    p {
      grid-column: 1/-1;
      margin: 0;
      color: #9fbed4;
      font-size: 0.68rem;
      letter-spacing: 0.04em;
    }
    :focus-visible {
      outline: 2px solid #a6f8ff;
      outline-offset: 3px;
    }
    @media (max-width: 600px) {
      .editor {
        grid-template-columns: 1fr;
      }
      .acoes {
        justify-content: flex-end;
      }
      button {
        min-height: 44px;
      }
    }
  `,
})
export class BarraConversaComponent {
  readonly texto = model('');
  /** Quem guarda o estado é a página: a tela inteira muda conforme o chat está aberto ou não. */
  readonly aberta = model(false);
  readonly embutida = input(false);
  readonly expandida = computed(() => this.embutida() || this.aberta() || this.ditando() || !!this.texto());
  private readonly campo = viewChild<ElementRef<HTMLTextAreaElement>>('campo');
  abrir(): void {
    this.aberta.set(true);
    setTimeout(() => this.campo()?.nativeElement.focus());
  }
  readonly ocupada = input(false);
  readonly ditando = input(false);
  readonly vozDisponivel = input(false);
  readonly enviar = output<void>();
  readonly microfone = output<void>();
  readonly digitando = output<void>();
  protected editar(evento: Event): void {
    this.digitando.emit();
    this.texto.set((evento.target as HTMLTextAreaElement).value);
  }
  protected teclar(evento: KeyboardEvent): void {
    if (evento.key === 'Enter' && !evento.shiftKey && !evento.isComposing) {
      evento.preventDefault();
      if (!this.ocupada() && !this.ditando() && this.texto().trim()) this.enviar.emit();
    }
  }
}
