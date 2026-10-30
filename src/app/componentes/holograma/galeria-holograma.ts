import { Component, ElementRef, afterNextRender, afterRenderEffect, inject, output, signal, viewChild } from '@angular/core';

import { HologramaService } from '../../nucleo/holograma.service';
import { legendaDoItem, type ItemGaleria } from '../../nucleo/holograma.modelos';

/**
 * A Galeria do modo Holograma: os objetos que o servidor guardou (os exemplos fixos e os gerados
 * completos), com abrir, "Gerar de novo" e apagar.
 *
 * Fica recolhida atrás de um botão, como o Histórico: abrir leva o foco para a lista; fechar (pelo
 * botão ou Esc) devolve ao botão. Escolher um item recolhe a lista para a cena aparecer.
 *
 * Quem gera de novo é o pai, pela saída `regerar`: o campo de pedido mora lá e passa a mostrar o
 * objeto que está sendo refeito.
 */
@Component({
  selector: 'app-galeria-holograma',
  host: { '(keydown.escape)': 'aoEsc($event)' },
  template: `
    <button
      #botao
      class="alternar"
      type="button"
      [attr.aria-expanded]="aberta()"
      aria-controls="holograma-galeria-painel"
      (click)="aberta.set(!aberta())"
    >
      {{ aberta() ? 'Fechar galeria' : 'Galeria' }}
      @if (!aberta() && holograma.galeria().length) { <span class="contagem">· {{ holograma.galeria().length }}</span> }
    </button>
    @if (aberta()) {
      <section #painel id="holograma-galeria-painel" class="painel" aria-labelledby="holograma-galeria" tabindex="-1">
        <h2 class="rotulo" id="holograma-galeria">Galeria</h2>
        @if (holograma.falhaDaGaleria(); as falha) { <p class="descricao" role="status">{{ falha }}</p> }
        <ul class="itens" aria-labelledby="holograma-galeria">
          @for (item of holograma.galeria(); track item.id) {
            <li class="item" [class.item--atual]="item.id === holograma.idGeracao()">
              <button class="abrir" type="button" [attr.aria-label]="'Abrir ' + item.nome" [disabled]="holograma.construindo()" (click)="abrir(item)">
                @if (holograma.miniaturas()[item.id]; as src) {
                  <img class="miniatura" [src]="src" alt="" width="56" height="56" />
                } @else {
                  <span class="miniatura miniatura--vazia" aria-hidden="true">◇</span>
                }
                <span class="texto">
                  <span class="nome">{{ item.nome }}</span>
                  <span class="legenda">{{ legenda(item) }}</span>
                </span>
              </button>
              <span class="acoes">
                <button class="botao" type="button" title="Gerar de novo" [attr.aria-label]="'Gerar de novo ' + item.nome" [disabled]="holograma.construindo()" (click)="gerarDeNovo(item)">↻</button>
                @if (!item.fixo) {
                  <button
                    class="botao"
                    [class.botao--confirmar]="confirmando() === item.id"
                    type="button"
                    [attr.title]="confirmando() === item.id ? 'Clique de novo para apagar' : 'Apagar'"
                    [attr.aria-label]="(confirmando() === item.id ? 'Confirmar: apagar ' : 'Apagar ') + item.nome"
                    (click)="aoApagar(item)"
                    (blur)="desistir(item)"
                  >{{ confirmando() === item.id ? '?' : '✕' }}</button>
                }
              </span>
            </li>
          } @empty {
            @if (!holograma.falhaDaGaleria()) { <li class="descricao">Nada guardado ainda.</li> }
          }
        </ul>
      </section>
    }
  `,
  styleUrl: './galeria-holograma.scss',
})
export class GaleriaHologramaComponent {
  protected readonly holograma = inject(HologramaService);
  /** "Gerar de novo": o pai repete o pedido do item com `novo=true`. */
  readonly regerar = output<ItemGaleria>();
  /** O item cujo ✕ já foi clicado uma vez: o segundo clique apaga. */
  protected readonly confirmando = signal<string | null>(null);
  protected readonly aberta = signal(false);
  private readonly botao = viewChild.required<ElementRef<HTMLButtonElement>>('botao');
  private readonly painel = viewChild<ElementRef<HTMLElement>>('painel');
  private anterior = false;

  constructor() {
    // Carrega já recolhida: ao abrir, as miniaturas estão prontas e a contagem aparece no botão.
    afterNextRender(() => void this.holograma.carregarGaleria());
    // O foco segue o que apareceu, como no Histórico — só quando muda, não a cada render.
    afterRenderEffect(() => {
      const aberta = this.aberta();
      if (aberta === this.anterior) return;
      this.anterior = aberta;
      (aberta ? this.painel() : this.botao())?.nativeElement.focus({ preventScroll: true });
    });
  }

  protected legenda(item: ItemGaleria): string {
    return legendaDoItem(item);
  }

  protected abrir(item: ItemGaleria): void {
    this.aberta.set(false);
    void this.holograma.abrirDaGaleria(item);
  }

  protected gerarDeNovo(item: ItemGaleria): void {
    this.aberta.set(false);
    this.regerar.emit(item);
  }

  /** Esc com a galeria aberta fecha só ela: sem isto, a HUD fecharia o holograma inteiro. */
  protected aoEsc(evento: Event): void {
    if (!this.aberta()) return;
    evento.preventDefault();
    this.aberta.set(false);
  }

  /** Apagar não tem volta: o primeiro clique só arma, o segundo apaga. */
  protected aoApagar(item: ItemGaleria): void {
    if (this.confirmando() !== item.id) {
      this.confirmando.set(item.id);
      return;
    }
    this.confirmando.set(null);
    void this.holograma.apagarDaGaleria(item);
  }

  protected desistir(item: ItemGaleria): void {
    if (this.confirmando() === item.id) this.confirmando.set(null);
  }
}
