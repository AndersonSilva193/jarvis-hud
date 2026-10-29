import { Component, afterNextRender, inject, output, signal } from '@angular/core';

import { HologramaService } from '../../nucleo/holograma.service';
import { legendaDoItem, type ItemGaleria } from '../../nucleo/holograma.modelos';

/**
 * O painel Galeria do modo Holograma: os objetos que o servidor guardou (os exemplos fixos e os
 * gerados completos), com abrir, "Gerar de novo" e apagar.
 *
 * Quem gera de novo é o pai, pela saída `regerar`: o campo de pedido mora lá e passa a mostrar o
 * objeto que está sendo refeito.
 */
@Component({
  selector: 'app-galeria-holograma',
  template: `
    <p class="rotulo" id="holograma-galeria">Galeria</p>
    @if (holograma.falhaDaGaleria(); as falha) { <p class="descricao" role="status">{{ falha }}</p> }
    <ul class="itens" aria-labelledby="holograma-galeria">
      @for (item of holograma.galeria(); track item.id) {
        <li class="item" [class.item--atual]="item.id === holograma.idGeracao()">
          <button class="abrir" type="button" [attr.aria-label]="'Abrir ' + item.nome" [disabled]="holograma.construindo()" (click)="holograma.abrirDaGaleria(item)">
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
            <button class="botao" type="button" title="Gerar de novo" [attr.aria-label]="'Gerar de novo ' + item.nome" [disabled]="holograma.construindo()" (click)="regerar.emit(item)">↻</button>
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
  `,
  styleUrl: './galeria-holograma.scss',
})
export class GaleriaHologramaComponent {
  protected readonly holograma = inject(HologramaService);
  /** "Gerar de novo": o pai repete o pedido do item com `novo=true`. */
  readonly regerar = output<ItemGaleria>();
  /** O item cujo ✕ já foi clicado uma vez: o segundo clique apaga. */
  protected readonly confirmando = signal<string | null>(null);

  constructor() {
    afterNextRender(() => void this.holograma.carregarGaleria());
  }

  protected legenda(item: ItemGaleria): string {
    return legendaDoItem(item);
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
