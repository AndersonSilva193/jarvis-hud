import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';

import type { ItemNoticia } from '../../nucleo/briefing.modelos';

/**
 * Uma manchete: imagem, título e fonte.
 *
 * Feed sem foto é comum, e CDN de jornal às vezes recusa o hotlink, então o card tem um estado
 * sem imagem de primeira classe em vez de uma moldura quebrada.
 */
@Component({
  selector: 'app-card-noticia',
  templateUrl: './card-noticia.html',
  styleUrl: './card-noticia.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardNoticiaComponent {
  readonly dados = input.required<ItemNoticia>();

  private readonly imagemFalhou = signal(false);

  readonly comImagem = computed(() => this.dados().imagemUrl.length > 0 && !this.imagemFalhou());
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
