import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { DadosSistemas } from '../../nucleo/briefing.modelos';

/** Os sites monitorados e a linha de saúde do servidor onde o Jarvis roda. */
@Component({
  selector: 'app-card-sistemas',
  templateUrl: './card-sistemas.html',
  styleUrl: './card-sistemas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardSistemasComponent {
  readonly dados = input.required<DadosSistemas>();

  /**
   * O servidor descreve a checagem em texto ("HTTP 200 em 180 ms (OK)", "FORA DO AR ..."), e só
   * o caso OK é marcado como tal: qualquer outra coisa merece a cor de alerta.
   */
  estaDePe(resultado: string): boolean {
    return resultado.includes('(OK)');
  }
}
