import { Component, computed, inject, input, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { AbrirLinkService, urlSegura } from '../../nucleo/abrir-link.service';
import { ConfigStore } from '../../nucleo/config.store';
import type { DadosPagina } from '../../nucleo/tela.modelos';

@Component({
  selector: 'app-card-pagina', imports: [NgOptimizedImage],
  template: `
    @if (incorporada(); as url) {
      <iframe [src]="url" [title]="dados().titulo" sandbox="allow-scripts allow-same-origin allow-popups" referrerpolicy="no-referrer" (error)="previa.set(true)"></iframe>
      <button type="button" (click)="previa.set(true)">Mostrar prévia</button>
    } @else {
      @if (imagem() && !imagemFalhou()) { <div class="foto"><img [ngSrc]="imagem()" fill sizes="100vw" [alt]="dados().titulo" referrerpolicy="no-referrer" (error)="imagemFalhou.set(true)" /></div> }
      <h2>{{ dados().titulo }}</h2><p>{{ dados().descricao }}</p><p class="dominio">{{ dominio() }}</p>
    }
    <button type="button" [disabled]="!url()" (click)="links.abrir(url())" aria-label="Abrir página no navegador">Abrir ↗</button>
  `,
  styles: `:host{display:block;user-select:text}iframe{display:block;width:100%;height:300px;border:1px solid #456680;background:#fff}.foto{position:relative;height:180px}.foto img{object-fit:cover}h2{font-size:1.3rem}p{line-height:1.6;overflow-wrap:anywhere}.dominio{color:#a6d5ef;font-size:.8rem}button{margin:.5rem .5rem 0 0;padding:.5rem .8rem;border:1px solid #6fa6c3;background:#0c2943;color:#dff4ff;cursor:pointer}button:focus-visible{outline:2px solid #fff;outline-offset:3px}`,
})
export class CardPaginaComponent {
  readonly dados = input.required<DadosPagina>();
  private readonly config = inject(ConfigStore);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly links = inject(AbrirLinkService);
  protected readonly previa = signal(false);
  protected readonly imagemFalhou = signal(false);
  protected readonly url = computed(() => urlSegura(this.dados().url));
  protected readonly imagem = computed(() => urlSegura(this.dados().imagem));
  protected readonly dominio = computed(() => this.url() ? new URL(this.url()).hostname : this.dados().site);
  protected readonly incorporada = computed(() => {
    if (!this.dados().incorporavel || this.previa() || !this.url()) return null;
    const url = new URL(this.url());
    const api = urlSegura(this.config.urlApi());
    if (url.protocol !== 'https:' || url.origin === location.origin || api && url.origin === new URL(api).origin) return null;
    // Exclusivamente uma URL externa validada; nunca HTML ou uma rota autenticada da HUD.
    return this.sanitizer.bypassSecurityTrustResourceUrl(url.href);
  });
}
