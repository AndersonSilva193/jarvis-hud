import { describe, expect, it } from 'vitest';

import { LUZ_INICIAL, LIMIAR_CLARO, LIMIAR_ESCURO, avaliarLuz, brilhoMedio, type EstadoDaLuz } from './luz';

const cinza = (valor: number, pixels = 4) => Array.from({ length: pixels * 4 }, (_, i) => (i % 4 === 3 ? 255 : valor));

describe('luz', () => {
  it('mede o brilho médio do RGBA, sem contar o alfa', () => {
    expect(brilhoMedio(cinza(0))).toBe(0);
    expect(brilhoMedio(cinza(200))).toBeCloseTo(200, 6);
    expect(brilhoMedio([255, 0, 0, 255])).toBeCloseTo(0.2126 * 255, 6);
    expect(brilhoMedio([])).toBe(0);
  });

  it('só avisa depois de duas amostras seguidas no escuro', () => {
    let estado: EstadoDaLuz = LUZ_INICIAL;
    estado = avaliarLuz(estado, 10);
    expect(estado.escuro).toBe(false);
    estado = avaliarLuz(estado, 10);
    expect(estado.escuro).toBe(true);
  });

  it('um vulto passando não é noite: uma amostra clara zera a contagem', () => {
    const umaEscura = avaliarLuz(LUZ_INICIAL, 10);
    expect(avaliarLuz(umaEscura, LIMIAR_ESCURO + 5)).toEqual(LUZ_INICIAL);
  });

  it('volta com folga: entre os dois limiares continua escuro', () => {
    const escuro: EstadoDaLuz = { escuro: true, seguidas: 2 };
    expect(avaliarLuz(escuro, (LIMIAR_ESCURO + LIMIAR_CLARO) / 2).escuro).toBe(true);
    expect(avaliarLuz(escuro, LIMIAR_CLARO + 1).escuro).toBe(false);
  });
});
