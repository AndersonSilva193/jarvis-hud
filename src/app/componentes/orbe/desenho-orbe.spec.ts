import { describe, expect, it } from 'vitest';

import { amplitudeAlvo, criarParticulas, suavizar } from './desenho-orbe';

describe('o desenho do orbe', () => {
  it('a onda cresce com a força da fala e fica baixa em repouso', () => {
    const repouso = amplitudeAlvo('ocioso', 0, 0);
    const fraca = amplitudeAlvo('falando', 0.1, 0);
    const forte = amplitudeAlvo('falando', 1, 0);
    expect(fraca).toBeGreaterThan(repouso);
    expect(forte).toBeGreaterThan(fraca * 2);
    // A força chega do VozService já entre 0 e 1, mas um pico fora disso não estoura a tela.
    expect(amplitudeAlvo('falando', 5, 0)).toBe(forte);
  });

  it('a força só vale falando: ouvir ou pensar não depende dela', () => {
    expect(amplitudeAlvo('pensando', 1, 0)).toBe(amplitudeAlvo('pensando', 0, 0));
    expect(amplitudeAlvo('ouvindo', 1, 2)).toBe(amplitudeAlvo('ouvindo', 0, 2));
  });

  it('a suavização chega ao alvo sem passar dele, em qualquer taxa de quadros', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = suavizar(a, 1, 1 / 60);
    expect(a).toBeGreaterThan(0.99);
    expect(a).toBeLessThanOrEqual(1);
    expect(suavizar(0.4, 1, 0)).toBe(0.4);
  });

  it('as partículas nascem dentro do campo', () => {
    let semente = 1;
    const aleatorio = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
    const particulas = criarParticulas(200, aleatorio);
    expect(particulas).toHaveLength(200);
    for (const p of particulas) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(1);
      expect(p.raio).toBeGreaterThan(0);
    }
  });
});
