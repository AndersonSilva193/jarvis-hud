import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';

import { ModoIaService } from '../../nucleo/modo-ia.service';
import { MODOS_IA, rotuloModoIa, type ModoIa } from '../../nucleo/modo-ia.modelos';

/**
 * O selo de quem está pensando ("Local · Qwen 9B", "Auto → Claude") e o menu de troca de modo.
 *
 * Escolher um modo só pede ao servidor; o selo muda quando o evento `ia.modo` confirma.
 */
@Component({
  selector: 'app-indicador-modelo',
  template: `
    <button
      #gatilho
      type="button"
      class="gatilho"
      [class.gatilho--local]="estado()?.provedorEfetivo === 'local'"
      [class.gatilho--claude]="estado()?.provedorEfetivo === 'claude'"
      [class.gatilho--fallback]="!!motivo()"
      aria-haspopup="menu"
      aria-controls="menu-modo-ia"
      [attr.aria-expanded]="aberto()"
      [attr.aria-label]="descricao()"
      [attr.title]="motivo()"
      (click)="alternar()"
      (keydown)="teclarNoGatilho($event)"
    >
      <span class="ponto" aria-hidden="true"></span>
      <span class="rotulo">{{ rotulo() }}</span>
      @if (motivo()) { <span class="atencao" aria-hidden="true">⚠</span> }
    </button>
    <div
      class="painel"
      [hidden]="!aberto()"
      (keydown)="teclarNoMenu($event)"
      (focusout)="aoSairDoMenu($event)"
    >
      @if (motivo(); as motivo) { <p class="nota">Fallback: {{ motivo }}</p> }
      <div id="menu-modo-ia" class="menu" role="menu" aria-label="Modo da IA">
        @for (opcao of modos; track opcao.modo; let i = $index) {
          <button
            #item
            type="button"
            class="item"
            role="menuitemradio"
            [attr.aria-checked]="estado()?.modo === opcao.modo"
            [attr.tabindex]="i === foco() ? 0 : -1"
            (click)="escolher(opcao.modo)"
          >
            {{ opcao.rotulo }}@if (servico.pedido() === opcao.modo) { <span aria-hidden="true">…</span> }
          </button>
        }
      </div>
    </div>
    <!-- Sempre no DOM: uma região viva criada junto com o texto não é anunciada. -->
    <p class="aviso" role="status">{{ servico.aviso() }}</p>
  `,
  styleUrl: './indicador-modelo.scss',
  host: { '(document:pointerdown)': 'aoTocarFora($event)' },
})
export class IndicadorModeloComponent implements OnInit {
  protected readonly servico = inject(ModoIaService);
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly gatilho = viewChild.required<ElementRef<HTMLButtonElement>>('gatilho');
  private readonly itens = viewChildren<ElementRef<HTMLButtonElement>>('item');

  protected readonly modos = MODOS_IA;
  protected readonly aberto = signal(false);
  /** Índice do item que recebe o foco (roving tabindex). */
  protected readonly foco = signal(0);

  protected readonly estado = this.servico.estado;
  protected readonly motivo = computed(() => this.estado()?.motivoFallback ?? null);
  protected readonly rotulo = computed(() => {
    const estado = this.estado();
    return estado ? rotuloModoIa(estado) : 'IA · —';
  });
  protected readonly descricao = computed(() => {
    const estado = this.estado();
    if (!estado) return 'Modelo de IA: aguardando o servidor. Trocar modo';
    const motivo = estado.motivoFallback ? ` Fallback: ${estado.motivoFallback}.` : '';
    return `Modelo de IA: ${rotuloModoIa(estado)}.${motivo} Trocar modo`;
  });

  ngOnInit(): void {
    void this.servico.carregar();
  }

  protected alternar(): void {
    if (this.aberto()) this.fechar(true);
    else this.abrir();
  }

  protected escolher(modo: ModoIa): void {
    void this.servico.trocar(modo);
    this.fechar(true);
  }

  protected teclarNoGatilho(evento: KeyboardEvent): void {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      this.abrir(evento.key === 'ArrowUp' ? this.modos.length - 1 : undefined);
    } else if (evento.key === 'Escape' && this.aberto()) {
      evento.preventDefault();
      this.fechar(true);
    }
  }

  protected teclarNoMenu(evento: KeyboardEvent): void {
    const total = this.modos.length;
    switch (evento.key) {
      case 'ArrowDown': this.focar((this.foco() + 1) % total); break;
      case 'ArrowUp': this.focar((this.foco() - 1 + total) % total); break;
      case 'Home': this.focar(0); break;
      case 'End': this.focar(total - 1); break;
      // O Esc global da HUD respeita o preventDefault: fechar o menu não recolhe a conversa.
      case 'Escape': this.fechar(true); break;
      case 'Tab': this.fechar(false); return;
      default: return;
    }
    evento.preventDefault();
  }

  protected aoSairDoMenu(evento: FocusEvent): void {
    const destino = evento.relatedTarget;
    if (destino instanceof Node && this.elemento.nativeElement.contains(destino)) return;
    this.fechar(false);
  }

  protected aoTocarFora(evento: Event): void {
    if (!this.aberto()) return;
    if (evento.target instanceof Node && this.elemento.nativeElement.contains(evento.target)) return;
    this.fechar(false);
  }

  /** Abre com o foco no modo atual — Enter, Espaço e clique chegam aqui pelo próprio botão. */
  private abrir(indice?: number): void {
    const atual = this.modos.findIndex((opcao) => opcao.modo === this.estado()?.modo);
    this.aberto.set(true);
    // O menu só sai de [hidden] no próximo render; antes disso o foco não pega.
    afterNextRender(() => this.focar(indice ?? Math.max(0, atual)), { injector: this.injector });
  }

  private fechar(devolverFoco: boolean): void {
    if (!this.aberto()) return;
    this.aberto.set(false);
    if (devolverFoco) this.gatilho().nativeElement.focus();
  }

  private focar(indice: number): void {
    this.foco.set(indice);
    this.itens()[indice]?.nativeElement.focus();
  }
}
