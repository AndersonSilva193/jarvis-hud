import { Component, DestroyRef, ElementRef, NgZone, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';

import { HologramaService } from '../../nucleo/holograma.service';
import {
  DETALHES_HOLOGRAMA,
  GERADORES_HOLOGRAMA,
  MAX_OBJETO_HOLOGRAMA,
  lerGeradorHolograma,
  type DetalheHolograma,
  type ItemGaleria,
} from '../../nucleo/holograma.modelos';
import { GaleriaHologramaComponent } from './galeria-holograma';
// Só tipos: o valor vem do `import()` dinâmico, e o Three.js fica fora do chunk da HUD.
import type { CenaHolograma, PecaDestacada } from './cena-holograma';

/**
 * A camada do Holograma no palco: a cena 3D por baixo e o painel da HUD por cima.
 *
 * O componente só faz a ponte entre os signals do `HologramaService` e a `CenaHolograma`, que é
 * Three.js puro e roda fora da zona do Angular. O único caminho de volta é a peça sob o mouse,
 * que muda poucas vezes — nada aqui dispara detecção de mudança a cada quadro.
 */
@Component({
  selector: 'app-holograma-view',
  imports: [GaleriaHologramaComponent],
  host: { class: 'holograma' },
  template: `
    <div class="cena" #alvo role="img" [attr.aria-label]="descricaoDaCena()"></div>
    @if (falha()) { <p class="falha" role="alert">{{ falha() }}</p> }
    <section class="painel titulo" aria-labelledby="holograma-nome">
      <p class="rotulo">Holograma</p>
      <h2 id="holograma-nome" class="nome">{{ holograma.meta()?.nome ?? 'Nenhum objeto' }}</h2>
      @if (holograma.meta()?.descricao; as descricao) { <p class="descricao">{{ descricao }}</p> }
      <p class="estado" [class.estado--erro]="holograma.fase() === 'erro' || holograma.fase() === 'incompleto'" role="status" aria-live="polite" [attr.title]="dicaDosAvisos()">
        @if (holograma.construindo()) { <span class="pulso" aria-hidden="true"></span> }{{ estado() }}
      </p>
      @if (holograma.podeContinuar()) {
        <button class="botao" type="button" style="margin-top: 0.5rem" (click)="holograma.continuar()">Continuar</button>
      }
      @if (holograma.trocaDeGerador(); as troca) { <p class="descricao" role="status">{{ troca }}</p> }
      @if (holograma.selo(); as selo) { <p class="rotulo" title="Gerador, peças e custo estimado desta geração">{{ selo }}</p> }
    </section>
    <div class="lateral">
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
      <app-galeria-holograma class="painel galeria" (regerar)="gerarDeNovo($event)" />
    </div>
    @if (destaque(); as peca) {
      <p class="painel destaque"><strong>{{ peca.nome }}</strong><span>Grupo · {{ peca.grupo }}</span></p>
    }
    <section class="painel controles" aria-label="Controles do holograma">
      <button class="botao botao--explodir" type="button" [attr.aria-pressed]="explosao() > 0" (click)="alternarExplosao()">
        {{ explosao() > 0 ? 'Montar' : 'Explodir' }}
      </button>
      <label class="explosao">
        <span>Vista explodida</span>
        <input type="range" min="0" max="100" step="1" [value]="explosao()" [attr.aria-valuetext]="explosao() + '%'" (input)="aoExplodir($event)" />
        <output aria-hidden="true">{{ explosao() }}%</output>
      </label>
      <button class="botao" type="button" (click)="centralizar()">Centralizar</button>
      <button class="botao" type="button" (click)="resetar()">Resetar</button>
      <button class="botao" type="button" (click)="holograma.fechar()">Fechar</button>
    </section>
  `,
  styleUrl: './holograma-view.scss',
})
export class HologramaViewComponent {
  protected readonly holograma = inject(HologramaService);
  protected readonly detalhes = DETALHES_HOLOGRAMA;
  protected readonly geradores = GERADORES_HOLOGRAMA;
  protected readonly maxObjeto = MAX_OBJETO_HOLOGRAMA;
  protected readonly objeto = signal('');
  protected readonly detalhe = signal<DetalheHolograma>('normal');
  protected readonly explosao = signal(0);
  protected readonly destaque = signal<PecaDestacada | null>(null);
  protected readonly falha = signal('');

  protected readonly estado = computed(() => {
    const total = contar(this.holograma.pecas().length);
    switch (this.holograma.fase()) {
      case 'construindo':
        return this.holograma.escaneando() ? 'Escaneando…' : `Construindo… ${total}`;
      case 'pronto': {
        const avisos = this.holograma.avisos();
        return avisos ? `${total} · ${avisos} ${avisos === 1 ? 'aviso' : 'avisos'}` : total;
      }
      case 'incompleto':
      case 'erro':
        // As peças que chegaram ficam na tela; o estado diz quantas.
        return this.holograma.pecas().length ? `${this.holograma.erro()} · ${total}` : this.holograma.erro();
      case 'cancelado':
        return `Cancelado · ${total}`;
      default:
        return 'Digite um objeto ou abra um da galeria.';
    }
  });

  /** O texto dos avisos ao passar o mouse no contador; sem aviso, sem dica. */
  protected readonly dicaDosAvisos = computed(() => this.holograma.textosDeAviso().join('\n') || null);

  protected readonly descricaoDaCena = computed(() => {
    const meta = this.holograma.meta();
    if (meta) return `Holograma de ${meta.nome}, ${contar(this.holograma.pecas().length)}`;
    return this.holograma.escaneando() ? 'Holograma escaneando' : 'Holograma vazio';
  });

  private readonly zona = inject(NgZone);
  private readonly alvo = viewChild.required<ElementRef<HTMLElement>>('alvo');
  private readonly cena = signal<CenaHolograma | null>(null);
  private geracaoDesenhada = -1;
  /** A geração cuja miniatura já foi pedida: uma captura por objeto montado. */
  private geracaoCapturada = -1;
  private desenhadas = 0;
  private vivo = true;

  constructor() {
    afterNextRender(() => void this.criarCena());
    // As peças só crescem dentro de uma geração: a cena recebe só as novas.
    effect(() => {
      const cena = this.cena();
      const geracao = this.holograma.geracao();
      const pecas = this.holograma.pecas();
      if (!cena) return;
      if (geracao !== this.geracaoDesenhada) {
        cena.limpar();
        // Objeto novo começa montado; na primeira sincronização não, senão o Three.js chegando
        // depois de um clique em Explodir desfaria o clique.
        if (this.geracaoDesenhada !== -1) this.explosao.set(0);
        this.geracaoDesenhada = geracao;
        this.desenhadas = 0;
      }
      for (; this.desenhadas < pecas.length; this.desenhadas++) cena.adicionar(pecas[this.desenhadas]!);
    });
    effect(() => this.cena()?.explodir(this.explosao() / 100));
    effect(() => this.cena()?.escanear(this.holograma.escaneando()));
    // Objeto parado — pronto, cortado ou cancelado: a câmera enquadra o que chegou, seja um átomo
    // pequeno ou um motor grande.
    effect(() => {
      const fase = this.holograma.fase();
      if (fase !== 'construindo' && fase !== 'vazio' && this.holograma.pecas().length) this.cena()?.centralizar();
    });
    // Objeto da galeria sem miniatura terminou de montar: espera a última peça acender e a câmera
    // chegar, e manda a captura. Trocar de objeto antes disso desarma.
    effect((aoLimpar) => {
      const fim = this.holograma.resumo();
      const geracao = this.holograma.geracao();
      if (this.holograma.fase() !== 'pronto' || !fim?.salvo || fim.miniatura || !fim.id) return;
      if (this.geracaoCapturada === geracao) return;
      this.geracaoCapturada = geracao;
      const id = fim.id;
      const espera = setTimeout(() => {
        if (this.holograma.geracao() !== geracao) return;
        const imagem = this.cena()?.miniatura(LADO_DA_MINIATURA);
        if (imagem) void this.holograma.enviarMiniatura(id, imagem);
      }, ESPERA_DA_MINIATURA_MS);
      aoLimpar(() => clearTimeout(espera));
    });
    inject(DestroyRef).onDestroy(() => {
      this.vivo = false;
      this.cena()?.destruir();
    });
  }

  /** O "Gerar de novo" da galeria: o campo passa a mostrar o pedido que está sendo refeito. */
  protected gerarDeNovo(item: ItemGaleria): void {
    if (this.holograma.construindo()) return;
    this.objeto.set(item.objeto);
    this.detalhe.set(item.detalhe);
    void this.holograma.gerarDeNovo(item);
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
    void this.holograma.gerar(this.objeto(), this.detalhe());
  }

  /** Durante a geração o botão é "Cancelar"; fora dela ele é o submit do formulário. */
  protected aoClicarAcao(evento: Event): void {
    if (!this.holograma.construindo()) return;
    evento.preventDefault();
    this.holograma.cancelar();
  }

  protected aoExplodir(evento: Event): void {
    if (evento.target instanceof HTMLInputElement) this.explosao.set(Number(evento.target.value));
  }

  protected alternarExplosao(): void {
    this.explosao.set(this.explosao() > 0 ? 0 : 100);
  }

  protected centralizar(): void {
    this.cena()?.centralizar();
  }

  protected resetar(): void {
    this.explosao.set(0);
    this.cena()?.resetar();
  }

  private async criarCena(): Promise<void> {
    try {
      const { CenaHolograma } = await import('./cena-holograma');
      if (!this.vivo) return;
      const movimentoReduzido = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const cena = this.zona.runOutsideAngular(
        () =>
          new CenaHolograma(this.alvo().nativeElement, {
            movimentoReduzido,
            aoDestacar: (peca) => this.zona.run(() => this.destaque.set(peca)),
          }),
      );
      this.cena.set(cena);
    } catch {
      this.falha.set('Este navegador não conseguiu abrir o WebGL do holograma.');
    }
  }
}

/** O tamanho que o servidor espera da miniatura. */
const LADO_DA_MINIATURA = 256;
/** A entrada da última peça e o voo da câmera ao centralizar cabem nisso. */
const ESPERA_DA_MINIATURA_MS = 1_500;

function contar(n: number): string {
  return `${n} ${n === 1 ? 'peça' : 'peças'}`;
}
