import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { DadosClima } from '../../nucleo/briefing.modelos';

/** O clima de hoje: temperatura grande, mínima/máxima e a chance de chuva. */
@Component({
  selector: 'app-card-clima',
  templateUrl: './card-clima.html',
  styleUrl: './card-clima.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardClimaComponent {
  readonly dados = input.required<DadosClima>();

  /** Mesmo limite que o servidor usa para sugerir o guarda-chuva na prosa. */
  readonly vaiChover = computed(() => this.dados().chanceChuvaPct >= 50);
}
