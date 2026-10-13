import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * O card de uso geral: a abertura ("Bom dia, chefe!") e qualquer seção que venha sem dados
 * estruturados — seja porque falhou no servidor, seja porque é uma seção nova que a API passou
 * a mandar. Nada do briefing sai da tela em silêncio.
 */
@Component({
  selector: 'app-card-texto',
  templateUrl: './card-texto.html',
  styleUrl: './card-texto.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardTextoComponent {
  readonly linhas = input.required<string[]>();
  /** Liga a cor de alerta: é uma seção que o servidor não conseguiu montar. */
  readonly comFalha = input(false);
}
