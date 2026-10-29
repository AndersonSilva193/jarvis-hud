import { Component, inject, viewChild } from '@angular/core';

import { RastreioDeMaoService } from '../../nucleo/rastreio-de-mao.service';
import { AjustesGestosComponent } from './ajustes-gestos';

/**
 * A parte de gestos da barra de controles: liga/desliga, abre os ajustes e mostra o aviso discreto
 * quando a câmera não dá (sem HTTPS, sem permissão, sem câmera, inatividade). `display: contents`
 * põe os botões na fila dos outros da barra.
 */
@Component({
  selector: 'app-botoes-gestos',
  imports: [AjustesGestosComponent],
  template: `
    <button class="botao" type="button" [attr.aria-pressed]="rastreio.ativo()" (click)="rastreio.alternar()">Gestos</button>
    <button class="botao" type="button" (click)="ajustes().abrir()">Ajustes</button>
    <!-- Sempre no DOM: uma região viva criada junto com o texto não é anunciada. -->
    <p class="aviso" role="status">{{ rastreio.aviso() }}</p>
    <app-ajustes-gestos />
  `,
  styleUrl: './botoes-gestos.scss',
})
export class BotoesGestosComponent {
  protected readonly rastreio = inject(RastreioDeMaoService);
  private readonly ajustes = viewChild.required(AjustesGestosComponent);
}
