import { Component, input } from '@angular/core';
import { PlayerMidiaComponent } from '../card-midia/player-midia';
import type { DadosMidia } from '../../nucleo/tela.modelos';
@Component({ selector: 'app-card-musica', imports: [PlayerMidiaComponent], template: `<app-player-midia [id]="id()" [dados]="dados()" />` })
export class CardMusicaComponent { readonly id = input.required<string>(); readonly dados = input.required<DadosMidia>(); }
