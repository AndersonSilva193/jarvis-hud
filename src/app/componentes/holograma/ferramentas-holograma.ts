import { Component, computed, inject, signal } from '@angular/core';
import { ComandosDoHologramaService } from '../../nucleo/comandos-do-holograma.service';
import { HologramaService } from '../../nucleo/holograma.service';
import { DETALHES_HOLOGRAMA, GERADORES_HOLOGRAMA, MAX_OBJETO_HOLOGRAMA, lerGeradorHolograma, type DetalheHolograma, type ItemGaleria } from '../../nucleo/holograma.modelos';
import { BotoesGestosComponent } from './botoes-gestos';
import { ParearCelularComponent } from './parear-celular';
import { GaleriaHologramaComponent } from './galeria-holograma';

@Component({
  selector: 'app-ferramentas-holograma',
  imports: [BotoesGestosComponent, ParearCelularComponent, GaleriaHologramaComponent],
  template: `
    <details open>
      <summary>Gerar e galeria</summary>
      @if (holograma.meta()?.descricao; as descricao) { <p class="descricao">{{ descricao }}</p> }
      @if (holograma.trocaDeGerador(); as troca) { <p class="descricao" role="status">{{ troca }}</p> }
      @if (holograma.selo(); as selo) { <p class="rotulo">{{ selo }}</p> }
      @if (holograma.podeContinuar()) {
        <button class="botao" type="button" (click)="holograma.continuar()">Continuar</button>
      }
      <section class="painel gerar" aria-label="Gerar holograma">
        <form class="formulario" (submit)="aoGerar($event)">
          <label class="rotulo" for="holograma-objeto">Gerar objeto</label>
          <div class="campos">
            <input
              id="holograma-objeto"
              class="entrada"
              type="text"
              autocomplete="off"
              placeholder="motor V8, turbina, DNA…"
              [attr.maxlength]="maxObjeto"
              [value]="objeto()"
              (input)="aoDigitar($event)"
            />
            <select class="entrada seletor" aria-label="Nível de detalhe" (change)="aoEscolherDetalhe($event)">
              @for (opcao of detalhes; track opcao.valor) {
                <option [value]="opcao.valor" [selected]="opcao.valor === detalhe()">{{ opcao.rotulo }}</option>
              }
            </select>
            <!-- Um botão só, que troca de papel: o foco continua nele quando a geração começa e termina. -->
            <button
              class="botao botao--gerar"
              [class.botao--cancelar]="holograma.construindo()"
              [attr.type]="holograma.construindo() ? 'button' : 'submit'"
              [disabled]="!holograma.construindo() && !objeto().trim()"
              (click)="aoClicarAcao($event)"
            >
              {{ holograma.construindo() ? 'Cancelar' : 'Gerar' }}
            </button>
          </div>
          <div class="descricao">
            <label class="rotulo" for="holograma-gerador">Gerador:</label>
            <select id="holograma-gerador" class="entrada seletor" (change)="aoEscolherGerador($event)">
              @for (opcao of geradores; track opcao.valor) {
                <option [value]="opcao.valor" [selected]="opcao.valor === holograma.gerador()">{{ opcao.rotulo }}</option>
              }
            </select>
          </div>
        </form>
      </section>
      <app-galeria-holograma class="galeria"(regerar)="gerarDeNovo($event)" />
    </details>
    <details open>
      <summary>Visualização</summary>
      <div class="controles" role="group" aria-label="Controles do holograma">
      <button class="botao botao--explodir" type="button" [attr.aria-pressed]="explosao() > 0" (click)="comandos.alternarExplosao()">
        {{ explosao() > 0 ? 'Montar' : 'Explodir' }}
      </button>
      <label class="explosao">
        <span>Vista explodida</span>
        <input type="range" min="0" max="100" step="1" [value]="explosao()" [attr.aria-valuetext]="explosao() + '%'" (input)="aoExplodir($event)" />
        <output aria-hidden="true">{{ explosao() }}%</output>
      </label>
      <button class="botao" type="button" (click)="comandos.centralizar()">Centralizar</button>
      <button class="botao" type="button" (click)="comandos.resetar()">Resetar</button>
      @if (comandos.selecao()) {
        <button class="botao" type="button" (click)="comandos.limparSelecao()">Limpar seleção</button>
      }
      <button class="botao" type="button" (click)="comandos.fechar()">Fechar</button>
      </div>
    </details>
    <details>
      <summary>Gestos e celular</summary>
      <div class="controles"><app-botoes-gestos /><app-parear-celular /></div>
    </details>
  `,
  styleUrl: './ferramentas-holograma.scss',
})
export class FerramentasHologramaComponent {
  protected readonly holograma = inject(HologramaService);
  protected readonly comandos = inject(ComandosDoHologramaService);
  protected readonly detalhes = DETALHES_HOLOGRAMA;
  protected readonly geradores = GERADORES_HOLOGRAMA;
  protected readonly maxObjeto = MAX_OBJETO_HOLOGRAMA;
  protected readonly objeto = signal('');
  protected readonly detalhe = signal<DetalheHolograma>('normal');
  protected readonly explosao = computed(() => Math.round(this.comandos.explosao() * 100));

  /** O "Gerar de novo" da galeria: o campo passa a mostrar o pedido que está sendo refeito. */
  protected gerarDeNovo(item: ItemGaleria): void {
    if (this.holograma.construindo()) return;
    this.objeto.set(item.objeto);
    this.detalhe.set(item.detalhe);
    this.comandos.gerarDeNovo(item);
  }

  protected aoDigitar(evento: Event): void {
    if (evento.target instanceof HTMLInputElement) this.objeto.set(evento.target.value);
  }

  protected aoEscolherDetalhe(evento: Event): void {
    const valor = evento.target instanceof HTMLSelectElement ? evento.target.value : '';
    const escolhido = this.detalhes.find((d) => d.valor === valor);
    if (escolhido) this.detalhe.set(escolhido.valor);
  }

  protected aoEscolherGerador(evento: Event): void {
    const escolhido = lerGeradorHolograma(evento.target instanceof HTMLSelectElement ? evento.target.value : '');
    if (escolhido) this.holograma.escolherGerador(escolhido);
  }

  protected aoGerar(evento: Event): void {
    evento.preventDefault();
    if (this.holograma.construindo() || !this.objeto().trim()) return;
    this.comandos.carregar(this.objeto(), this.detalhe());
  }

  /** Durante a geração o botão é "Cancelar"; fora dela ele é o submit do formulário. */
  protected aoClicarAcao(evento: Event): void {
    if (!this.holograma.construindo()) return;
    evento.preventDefault();
    this.comandos.cancelar();
  }

  protected aoExplodir(evento: Event): void {
    if (evento.target instanceof HTMLInputElement) this.comandos.explodir(Number(evento.target.value) / 100);
  }

}
