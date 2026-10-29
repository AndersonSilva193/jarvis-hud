import { Component, DestroyRef, ElementRef, NgZone, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';

import { HologramaService } from '../../nucleo/holograma.service';
import { EXEMPLOS_HOLOGRAMA } from '../../nucleo/holograma.modelos';
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
  host: { class: 'holograma' },
  template: `
    <div class="cena" #alvo role="img" [attr.aria-label]="descricaoDaCena()"></div>
    @if (falha()) { <p class="falha" role="alert">{{ falha() }}</p> }
    <section class="painel titulo" aria-labelledby="holograma-nome">
      <p class="rotulo">Holograma</p>
      <h2 id="holograma-nome" class="nome">{{ holograma.meta()?.nome ?? 'Nenhum objeto' }}</h2>
      @if (holograma.meta()?.descricao; as descricao) { <p class="descricao">{{ descricao }}</p> }
      <p class="estado" [class.estado--erro]="holograma.fase() === 'erro'" role="status" aria-live="polite">
        @if (holograma.construindo()) { <span class="pulso" aria-hidden="true"></span> }{{ estado() }}
      </p>
    </section>
    <section class="painel exemplos" aria-label="Exemplos de holograma">
      <p class="rotulo">Exemplos</p>
      @for (exemplo of exemplos; track exemplo.nome) {
        <button class="botao" type="button" (click)="holograma.carregarExemplo(exemplo.nome)">{{ exemplo.rotulo }}</button>
      }
    </section>
    @if (destaque(); as peca) {
      <p class="painel destaque"><strong>{{ peca.nome }}</strong><span>Grupo · {{ peca.grupo }}</span></p>
    }
    <section class="painel controles" aria-label="Controles do holograma">
      <label class="explosao">
        <span>Vista explodida</span>
        <input type="range" min="0" max="100" step="1" [value]="explosao()" [attr.aria-valuetext]="explosao() + '%'" (input)="aoExplodir($event)" />
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
  protected readonly exemplos = EXEMPLOS_HOLOGRAMA;
  protected readonly explosao = signal(0);
  protected readonly destaque = signal<PecaDestacada | null>(null);
  protected readonly falha = signal('');

  protected readonly estado = computed(() => {
    const total = contar(this.holograma.pecas().length);
    switch (this.holograma.fase()) {
      case 'construindo':
        return `Construindo… ${total}`;
      case 'pronto': {
        const avisos = this.holograma.avisos();
        return avisos ? `${total} · ${avisos} ${avisos === 1 ? 'aviso' : 'avisos'}` : total;
      }
      case 'erro':
        return this.holograma.erro();
      default:
        return 'Escolha um exemplo para montar.';
    }
  });

  protected readonly descricaoDaCena = computed(() => {
    const meta = this.holograma.meta();
    return meta ? `Holograma de ${meta.nome}, ${contar(this.holograma.pecas().length)}` : 'Holograma vazio';
  });

  private readonly zona = inject(NgZone);
  private readonly alvo = viewChild.required<ElementRef<HTMLElement>>('alvo');
  private readonly cena = signal<CenaHolograma | null>(null);
  private geracaoDesenhada = -1;
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
        this.geracaoDesenhada = geracao;
        this.desenhadas = 0;
        this.explosao.set(0);
      }
      for (; this.desenhadas < pecas.length; this.desenhadas++) cena.adicionar(pecas[this.desenhadas]!);
    });
    effect(() => this.cena()?.explodir(this.explosao() / 100));
    inject(DestroyRef).onDestroy(() => {
      this.vivo = false;
      this.cena()?.destruir();
    });
  }

  protected aoExplodir(evento: Event): void {
    if (evento.target instanceof HTMLInputElement) this.explosao.set(Number(evento.target.value));
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

function contar(n: number): string {
  return `${n} ${n === 1 ? 'peça' : 'peças'}`;
}
