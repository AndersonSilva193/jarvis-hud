import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  viewChild,
} from '@angular/core';
import type { RespostaConversa, TrocaConversa } from '../../nucleo/conversa.modelos';

/** Quantas trocas ficam à vista. O resto está no histórico, atrás do botão do topo. */
const TROCAS_NA_TELA = 4;

/**
 * O diálogo em curso, encostado na barra de conversa.
 *
 * É aqui que a fala do Jarvis vira texto na tela — e só enquanto o chat está aberto. Fechada a
 * barra, a resposta fica só no histórico e no que foi dito em voz alta: o centro da tela é do
 * orbe e do que se olha (um anexo, um código, o briefing).
 */
@Component({
  selector: 'app-dialogo-conversa',
  template: `<div class="rolo" #rolo>
    <ol aria-label="Conversa em curso">
      @for (troca of ultimas(); track troca.id) {
        <li>
          <p class="pedido">
            <span class="quem">{{ troca.canal === 'telegram' ? 'Você · Telegram' : 'Você' }}</span>
            {{ troca.pedido }}
          </p>
          @if (troca.resposta.texto) {
            <p class="fala"><span class="quem">Jarvis</span>{{ troca.resposta.texto }}</p>
          }
        </li>
      } @empty {
        <li class="vazio">Pergunte alguma coisa — o Jarvis responde aqui e em voz alta.</li>
      }
    </ol>
    @if (recemChegada(); as resposta) {
      <p class="fala solta"><span class="quem">Jarvis</span>{{ resposta.texto }}</p>
    }
    @if (progresso()) {
      <p class="progresso" role="status">
        {{ progresso() }}<span class="cursor" aria-hidden="true"></span>
      </p>
    }
    @if (erro()) {
      <p class="erro" role="alert">{{ erro() }}</p>
    }
  </div>`,
  styles: `
    :host {
      display: block;
    }
    .rolo {
      max-height: min(32vh, 20rem);
      overflow: auto;
      padding: 0.9rem 1.1rem;
      background: linear-gradient(160deg, rgba(10, 32, 62, 0.58), rgba(3, 12, 26, 0.72));
      border: 1px solid rgba(95, 242, 255, 0.22);
      /* A borda de baixo encosta na de cima do editor: as duas viram uma linha só. */
      margin-bottom: -1px;
      clip-path: polygon(14px 0, 100% 0, 100% 100%, 0 100%, 0 14px);
      backdrop-filter: blur(8px);
    }
    ol {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }
    p {
      margin: 0;
      font-size: 0.86rem;
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .quem {
      display: block;
      font-size: 0.58rem;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: #7fb0cc;
      margin-bottom: 0.25rem;
    }
    .pedido {
      color: #bcd4e6;
    }
    .fala {
      margin-top: 0.55rem;
      padding-left: 0.8rem;
      border-left: 1px solid rgba(95, 242, 255, 0.4);
      color: #dff4ff;
    }
    .fala .quem {
      color: #5ff2ff;
    }
    .solta {
      margin-top: 0.9rem;
    }
    .vazio,
    .progresso {
      color: #9fbed4;
      font-size: 0.8rem;
    }
    .progresso {
      margin-top: 0.8rem;
      color: #9cefff;
      letter-spacing: 0.04em;
    }
    .cursor {
      display: inline-block;
      width: 0.5em;
      height: 1em;
      margin-left: 0.3em;
      vertical-align: -0.15em;
      background: #5ff2ff;
      animation: hud-pulsar 1s steps(2, end) infinite;
    }
    .erro {
      margin-top: 0.6rem;
      color: #ffadb8;
      font-size: 0.8rem;
    }
  `,
})
export class DialogoConversaComponent {
  readonly trocas = input<TrocaConversa[]>([]);
  /** A resposta recém-chegada, que o histórico do servidor ainda não trouxe. */
  readonly resposta = input<RespostaConversa | null>(null);
  /** O id da resposta que já está no palco, para o texto não aparecer duas vezes. */
  readonly ocultar = input('');
  readonly progresso = input('');
  readonly erro = input('');
  private readonly rolo = viewChild<ElementRef<HTMLElement>>('rolo');
  protected readonly ultimas = computed(() =>
    this.trocas()
      .filter((troca) => troca.resposta.id !== this.ocultar())
      .slice(-TROCAS_NA_TELA),
  );
  /** Enquanto o histórico não volta da API, a última resposta aparece por conta própria. */
  protected readonly recemChegada = computed(() => {
    const resposta = this.resposta();
    const inedita =
      !!resposta &&
      resposta.id !== this.ocultar() &&
      !resposta.erro &&
      !this.ultimas().some((troca) => troca.resposta.id === resposta.id);
    return inedita ? resposta : null;
  });
  constructor() {
    // A última troca é a que importa: o rolo acompanha sozinho, como um terminal.
    afterRenderEffect(() => {
      this.ultimas();
      this.recemChegada();
      this.progresso();
      const elemento = this.rolo()?.nativeElement;
      if (elemento) elemento.scrollTop = elemento.scrollHeight;
    });
  }
}
