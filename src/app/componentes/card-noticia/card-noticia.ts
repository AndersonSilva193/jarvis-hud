import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { AbrirLinkService } from '../../nucleo/abrir-link.service';

import type { ItemNoticia } from '../../nucleo/briefing.modelos';

/**
 * Uma manchete: imagem, título e fonte.
 *
 * Feed sem foto é comum, e CDN de jornal às vezes recusa o hotlink, então o card tem um estado
 * sem imagem de primeira classe em vez de uma moldura quebrada.
 */
@Component({
  selector: 'app-card-noticia',
  imports: [NgOptimizedImage],
  templateUrl: './card-noticia.html',
  styleUrl: './card-noticia.scss',
})
export class CardNoticiaComponent {
  protected readonly links = inject(AbrirLinkService);
  readonly dados = input.required<ItemNoticia>();

  private readonly imagemFalhou = signal(false);

  readonly comImagem = computed(() => this.dados().imagemUrl.length > 0 && !this.imagemFalhou());
  readonly linkSeguro = computed(() => { try { const u = new URL(this.dados().link); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } });
  readonly fonte = computed(() => {
    const dados = this.dados();
    return dados.fonte ? `${dados.tema} · ${dados.fonte}` : dados.tema;
  });

  constructor() {
    // Manchete nova no mesmo componente: a falha da anterior não vale para esta.
    effect(() => {
      this.dados();
      this.imagemFalhou.set(false);
    });
  }

  aoFalharImagem(): void {
    this.imagemFalhou.set(true);
  }
}
