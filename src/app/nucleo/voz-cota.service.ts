import { Injectable, computed, inject, signal } from '@angular/core';

import { JarvisApiService } from './jarvis-api.service';
import type { StatusVoz } from './voz.modelos';

/** De quanto em quanto tempo a HUD relê a cota. A ElevenLabs não muda de minuto a minuto. */
const INTERVALO_MS = 10 * 60_000;

/**
 * A cota de voz, para o rodapé.
 *
 * Fica fora do VozService de propósito: falar e contar crédito são assuntos diferentes, e este
 * aqui pode falhar à vontade sem deixar ninguém mudo.
 */
@Injectable({ providedIn: 'root' })
export class VozCotaService {
  private readonly api = inject(JarvisApiService);

  readonly status = signal<StatusVoz | null>(null);

  /** O que aparece no rodapé: "VOZ: ELEVENLABS 62%" ou "VOZ: NAVEGADOR (cota)". */
  readonly rotulo = computed(() => {
    const status = this.status();
    if (!status) {
      return '';
    }
    if (status.provedor === 'elevenlabs') {
      return `VOZ: ELEVENLABS ${status.percentual}%`;
    }
    return status.motivo ? `VOZ: NAVEGADOR (${status.motivo})` : 'VOZ: NAVEGADOR';
  });

  private relogio: ReturnType<typeof setInterval> | null = null;

  acompanhar(): void {
    if (this.relogio !== null) {
      return;
    }
    void this.atualizar();
    this.relogio = setInterval(() => void this.atualizar(), INTERVALO_MS);
  }

  parar(): void {
    if (this.relogio !== null) {
      clearInterval(this.relogio);
      this.relogio = null;
    }
  }

  private async atualizar(): Promise<void> {
    try {
      this.status.set(await this.api.statusVoz());
    } catch {
      // API fora do ar ou token ainda não configurado: o rodapé simplesmente não mostra nada.
      this.status.set(null);
    }
  }
}
