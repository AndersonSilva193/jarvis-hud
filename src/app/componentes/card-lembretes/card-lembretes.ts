import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { DadosLembretes } from '../../nucleo/briefing.modelos';

/** Os lembretes de hoje, na ordem do dia. Lista vazia é um estado normal, não um erro. */
@Component({
  selector: 'app-card-lembretes',
  templateUrl: './card-lembretes.html',
  styleUrl: './card-lembretes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardLembretesComponent {
  readonly dados = input.required<DadosLembretes>();
}
