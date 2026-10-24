import { Component, computed, inject, input, signal } from '@angular/core';
import { AbrirLinkService, urlSegura } from '../../nucleo/abrir-link.service';
import { GraficoHudComponent } from '../grafico-hud/grafico-hud';
import type { DadosPesquisa } from '../../nucleo/tela.modelos';

@Component({
  selector: 'app-card-pesquisa',
  template: `
    <p class="categoria">{{ dados().categoria }} · {{ dados().tema }}</p>
    <h2>{{ titulo() }}</h2>
    @if (dados().referencia) { <p class="caixa referencia">{{ dados().referencia }}</p> }
    @let pesquisa = dados();
    @switch (pesquisa.layout) {
      @case ('ranking') {
        <ol class="ranking">
          @for (item of pesquisa.itens; track $index) {
            <li><span class="posicao">{{ item.posicao }}</span><div class="item">
              <h3>{{ item.nome }}</h3><p>{{ item.detalhe }}</p>
              @if (item.valor !== null) { <strong class="valor">{{ numero(item.valor) }} <small>{{ item.unidade }}</small></strong>
                <div class="trilho" aria-hidden="true"><span [style.width.%]="barra(item.valor)"></span></div> }
              @if (item.etiqueta) { <span class="etiqueta">{{ item.etiqueta }}</span> }
            </div></li>
          }
        </ol>
      }
      @case ('ficha') { <dl class="ficha">@for (item of pesquisa.itens; track $index) { <div><dt>{{ item.rotulo }}</dt><dd>{{ item.valor }}</dd></div> }</dl> }
      @case ('lista') { <ul class="lista">@for (item of pesquisa.itens; track $index) { <li>{{ item.texto }}</li> }</ul> }
      @case ('linha_do_tempo') { <ol class="linha-tempo">@for (item of pesquisa.itens; track $index) { <li><strong>{{ item.data }}</strong><p>{{ item.texto }}</p></li> }</ol> }
      @case ('destaque') { <div class="destaques">@for (item of pesquisa.itens; track $index) { <p><strong>{{ item.valor }}</strong><span>{{ item.legenda }}</span></p> }</div> }
      @case ('grafico') { <app-grafico-hud [grafico]="pesquisa.grafico" [titulo]="titulo()" /> }
    }
    <section class="caixa resumo" aria-label="Em resumo"><h3>EM RESUMO</h3><p>{{ dados().resumo }}</p></section>
    <footer><button type="button" (click)="fontesAbertas.update(inverter)" [attr.aria-expanded]="fontesAbertas()">{{ dados().fontes.length }} FONTES</button><span>CONSULTADO ÀS {{ horario() }}</span></footer>
    @if (fontesAbertas()) {
      <ul class="fontes" aria-label="Fontes da pesquisa">@for (fonte of dados().fontes; track $index) {
        <li><span>{{ fonte.nome }}</span><button type="button" [disabled]="!segura(fonte.url)" (click)="links.abrir(fonte.url)" [attr.aria-label]="'Abrir fonte ' + fonte.nome">Abrir ↗</button></li>
      } @empty { <li>Nenhuma fonte informada.</li> }</ul>
    }
  `,
  imports: [GraficoHudComponent],
  styleUrl: './card-pesquisa.scss',
})
export class CardPesquisaComponent {
  readonly dados = input.required<DadosPesquisa>();
  readonly titulo = input.required<string>();
  protected readonly links = inject(AbrirLinkService);
  protected readonly fontesAbertas = signal(false);
  protected readonly inverter = (valor: boolean) => !valor;
  protected readonly segura = urlSegura;
  protected readonly maximo = computed(() => { const d = this.dados(); return d.layout === 'ranking' ? Math.max(0, ...d.itens.map(i => i.valor ?? 0)) : 0; });
  protected readonly horario = computed(() => {
    const data = new Date(this.dados().consultadoEm);
    return Number.isNaN(data.getTime()) ? '—' : data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  });
  protected barra(valor: number): number { return this.maximo() > 0 ? Math.max(0, valor / this.maximo() * 100) : 0; }
  protected numero(valor: number): string { return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 }); }
}
