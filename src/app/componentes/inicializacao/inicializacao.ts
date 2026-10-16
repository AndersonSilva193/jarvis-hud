import { Component, inject } from '@angular/core';

import { InicializacaoService } from '../../nucleo/inicializacao.service';

/**
 * A sequência de abertura, por cima do HUD: tela escura, grade e cantos acendendo, e as linhas
 * de checagem aparecendo uma a uma.
 *
 * Cada linha mostra o estado **real** da sua checagem — quem falha aparece como `FALHOU` e a
 * sequência segue. Uma abertura que mentisse "OK" para tudo seria só enfeite; esta diz, antes de
 * o Jarvis abrir a boca, o que está de pé.
 *
 * O orbe não é desenhado aqui: ele já existe por baixo, e "o orbe se formando" é a classe
 * `inicializando` que o HUD põe nele (escala, opacidade e desfoque). Acrescentar um estado novo
 * ao canvas obrigaria a mexer nas três uniões paralelas — `EstadoOrbe`, `EstadoDesenho` e
 * `EstadoDasSondas` — por um efeito que o CSS entrega igual.
 *
 * `aria-hidden` porque isto é a mesma informação que o Jarvis vai falar em seguida; num leitor
 * de tela seria tudo dito duas vezes.
 */
@Component({
  selector: 'app-inicializacao',
  host: { class: 'inicializacao', 'aria-hidden': 'true' },
  template: `
    <div class="fundo"></div>
    <div class="cantos"><i></i><i></i><i></i><i></i></div>
    <ul class="checagens">
      @for (linha of inicio.linhas(); track linha.id) {
        <li class="checagem" [attr.data-estado]="linha.estado">
          <span class="rotulo">{{ linha.rotulo }}</span>
          <span class="pontilhado"></span>
          <span class="veredito">{{ veredito(linha.estado, linha.detalhe) }}</span>
        </li>
      }
    </ul>
  `,
  styleUrl: './inicializacao.scss',
})
export class InicializacaoComponent {
  protected readonly inicio = inject(InicializacaoService);

  protected veredito(estado: string, detalhe?: string): string {
    if (estado === 'pendente') {
      return '';
    }
    if (estado === 'falhou') {
      return 'FALHOU';
    }
    return detalhe ?? 'OK';
  }
}
