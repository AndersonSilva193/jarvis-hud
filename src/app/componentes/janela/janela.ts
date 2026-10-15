import { Component, ElementRef, OnDestroy, computed, effect, inject, input, untracked } from '@angular/core';
import { JanelasService } from '../../nucleo/janelas.service';
import type { Janela } from '../../nucleo/tela.modelos';

@Component({
  selector: 'app-janela',
  host: {
    '[class.minimizada]': 'janela().estado === "minimizada"',
    '[class.com-player]': 'miniPlayer()',
    '[class.em-foco]': 'janelas.foco() === janela().id',
    '[style.left.px]': 'geometria().x', '[style.top.px]': 'geometria().y',
    '[style.width.px]': 'geometria().largura', '[style.height.px]': 'geometria().altura',
    '[style.z-index]': 'miniPlayer() ? 80 : janela().z',
    '(pointerdown)': 'focar()', '(focusin)': 'focar()', '(keydown)': 'teclar($event)',
  },
  template: `
    <article class="card-principal" tabindex="-1" [attr.aria-label]="janela().titulo" role="region">
      <header class="cabecalho-card" (pointerdown)="iniciar($event, false)" (pointermove)="mover($event)" (pointerup)="terminar($event)" (pointercancel)="terminar($event)">
        <p class="rotulo-bloco">{{ janela().titulo }}</p><span class="selo">{{ janela().selo }}</span>
        <div class="botoes">
          @if (miniPlayer()) { <button type="button" aria-label="Restaurar janela" (click)="janelas.restaurar(janela().id)">↗</button> }
          @else { <button type="button" aria-label="Minimizar janela" (click)="janelas.minimizar(janela().id)">−</button>
            <button type="button" [attr.aria-label]="janela().estado === 'maximizada' ? 'Restaurar janela' : 'Maximizar janela'" (click)="maximizar()">□</button> }
          <button type="button" [attr.aria-label]="janela().fixada ? 'Desafixar janela' : 'Fixar janela'" [attr.aria-pressed]="janela().fixada" (click)="janelas.fixar(janela().id, !janela().fixada)">⌖</button>
          <button class="fechar" type="button" [attr.aria-label]="rotuloFechar()" (click)="fechar()">✕</button>
        </div>
      </header>
      <div class="conteudo-janela"><ng-content /></div>
      @if (!miniPlayer() && janela().estado === 'normal') {
        <button class="alca" type="button" aria-label="Redimensionar janela; use as setas" (pointerdown)="iniciar($event, true)" (pointermove)="mover($event)" (pointerup)="terminar($event)" (pointercancel)="terminar($event)" (keydown)="redimensionarTecla($event)">◢</button>
      }
    </article>
  `,
  styleUrl: './janela.scss',
})
export class JanelaComponent implements OnDestroy {
  readonly janela = input.required<Janela>();
  readonly miniPlayer = input(false);
  protected readonly janelas = inject(JanelasService);
  private readonly elemento = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly geometria = computed(() => {
    if (!this.miniPlayer()) return this.janela();
    const bandeja = this.janelas.bandejaArea(), origem = this.janelas.origemArea();
    return { ...bandeja, x: bandeja.x - origem.x, y: bandeja.y - origem.y };
  });
  protected readonly rotuloFechar = computed(() => this.janela().tipo === 'resposta' ? 'Fechar resposta' : this.janela().selo === 'CONSULTA' ? 'Fechar consulta' : `Fechar ${this.janela().titulo}`);
  private arraste: { pointer: number; x: number; y: number; janela: Janela; tamanho: boolean; alvo: HTMLElement } | null = null;
  private retorno: HTMLElement | null = null;
  constructor() {
    effect(() => {
      const focada = this.janelas.foco() === this.janela().id;
      if (focada) untracked(() => queueMicrotask(() => {
        const host = this.elemento.nativeElement;
        if (!host.isConnected || host.contains(document.activeElement)) return;
        if (document.activeElement instanceof HTMLElement) this.retorno = document.activeElement;
        host.querySelector<HTMLElement>('article')?.focus({ preventScroll: true });
      }));
    });
  }
  protected focar(): void { this.janelas.focar(this.janela().id, !this.miniPlayer()); }
  protected fechar(): void { this.janelas.fechar(this.janela().id); }
  protected maximizar(): void { if (this.janela().estado === 'maximizada') this.janelas.restaurar(this.janela().id); else this.janelas.maximizar(this.janela().id); }
  protected iniciar(evento: PointerEvent, tamanho: boolean): void {
    if (evento.button !== 0 || this.miniPlayer() || this.janela().estado !== 'normal' || !tamanho && (evento.target as HTMLElement).closest('button')) return;
    evento.preventDefault(); this.focar();
    const alvo = evento.currentTarget as HTMLElement;
    alvo.setPointerCapture(evento.pointerId);
    this.arraste = { pointer: evento.pointerId, x: evento.clientX, y: evento.clientY, janela: this.janela(), tamanho, alvo };
  }
  protected mover(evento: PointerEvent): void {
    const a = this.arraste;
    if (!a || evento.pointerId !== a.pointer) return;
    const dx = evento.clientX - a.x, dy = evento.clientY - a.y;
    if (a.tamanho) this.janelas.redimensionar(a.janela.id, a.janela.largura + dx, a.janela.altura + dy);
    else this.janelas.mover(a.janela.id, a.janela.x + dx, a.janela.y + dy);
  }
  protected terminar(evento: PointerEvent): void { if (this.arraste?.pointer === evento.pointerId) this.soltar(); }
  private soltar(): void { const a = this.arraste; if (a?.alvo.hasPointerCapture(a.pointer)) a.alvo.releasePointerCapture(a.pointer); this.arraste = null; }
  protected teclar(evento: KeyboardEvent): void {
    if (!evento.altKey || !evento.key.startsWith('Arrow')) return;
    if ((evento.target as HTMLElement).closest('input,textarea,[contenteditable=true]')) return;
    evento.preventDefault(); evento.stopPropagation();
    const j = this.janela();
    this.janelas.mover(j.id, j.x + (evento.key === 'ArrowRight' ? 10 : evento.key === 'ArrowLeft' ? -10 : 0), j.y + (evento.key === 'ArrowDown' ? 10 : evento.key === 'ArrowUp' ? -10 : 0));
  }
  protected redimensionarTecla(evento: KeyboardEvent): void {
    if (!evento.key.startsWith('Arrow') || evento.altKey) return;
    evento.preventDefault(); evento.stopPropagation();
    const j = this.janela();
    this.janelas.redimensionar(j.id, j.largura + (evento.key === 'ArrowRight' ? 10 : evento.key === 'ArrowLeft' ? -10 : 0), j.altura + (evento.key === 'ArrowDown' ? 10 : evento.key === 'ArrowUp' ? -10 : 0));
  }
  ngOnDestroy(): void { this.soltar(); if (this.elemento.nativeElement.contains(document.activeElement) && this.retorno?.isConnected) this.retorno.focus({ preventScroll: true }); }
}
