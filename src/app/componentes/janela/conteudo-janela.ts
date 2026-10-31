import { Component, input, output } from '@angular/core';
import type { Janela } from '../../nucleo/tela.modelos';
import { CardPesquisaComponent } from '../card-pesquisa/card-pesquisa';
import { CardVideoComponent } from '../card-video/card-video';
import { CardMusicaComponent } from '../card-musica/card-musica';
import { CardPaginaComponent } from '../card-pagina/card-pagina';
import { CardNoticiaComponent } from '../card-noticia/card-noticia';
import { CardClimaComponent } from '../card-clima/card-clima';
import { CardLembretesComponent } from '../card-lembretes/card-lembretes';
import { CardSistemasComponent } from '../card-sistemas/card-sistemas';
import { CardTextoComponent } from '../card-texto/card-texto';
import { RespostaConversaComponent } from '../conversa/resposta-conversa';

@Component({
  selector: 'app-conteudo-janela',
  imports: [CardPesquisaComponent, CardVideoComponent, CardMusicaComponent, CardPaginaComponent, CardNoticiaComponent, CardClimaComponent, CardLembretesComponent, CardSistemasComponent, CardTextoComponent, RespostaConversaComponent],
  template: `
    @let conteudo = janela().conteudo;
    @switch (conteudo.tipo) {
      @case ('pesquisa') { <app-card-pesquisa [dados]="conteudo.dados" [titulo]="janela().titulo" /> }
      @case ('video') { <app-card-video [dados]="conteudo.dados" [id]="janela().id" /> }
      @case ('musica') { <app-card-musica [dados]="conteudo.dados" [id]="janela().id" /> }
      @case ('pagina') { <app-card-pagina [dados]="conteudo.dados" /> }
      @case ('noticia') { <app-card-noticia [dados]="conteudo.dados" /> }
      @case ('resposta') { <app-resposta-conversa [resposta]="conteudo.dados" [textoVisivel]="narrandoId() === conteudo.dados.id ? textoRevelado() : null" [erro]="conteudo.dados.erro ?? ''" [ocupada]="ocupada()" (comando)="comando.emit($event)" /> }
      @case ('briefing') {
        @let bloco = conteudo.dados;
        @switch (bloco.tipo) {
          @case ('clima') { <app-card-clima [dados]="bloco.dados" /> }
          @case ('lembretes') { <app-card-lembretes [dados]="bloco.dados" /> }
          @case ('sistemas') { <app-card-sistemas [dados]="bloco.dados" /> }
          @case ('noticia') { <app-card-noticia [dados]="bloco.dados" /> }
          @case ('abertura') { <app-card-texto [linhas]="bloco.linhas" /> }
          @case ('texto') { <app-card-texto [linhas]="bloco.linhas" [comFalha]="true" /> }
        }
      }
    }
  `,
})
export class ConteudoJanelaComponent {
  readonly janela = input.required<Janela>();
  readonly ocupada = input(false);
  readonly narrandoId = input<string | null>(null);
  readonly textoRevelado = input('');
  readonly comando = output<string>();
}
