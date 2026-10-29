import { describe, expect, it } from 'vitest';

import { FiltroUmEuro } from './filtro-um-euro';
import { aberturaDaMao, classificarPose, distanciaDaPinca, tamanhoDaMao } from './geometria-da-mao';
import type { Ponto } from './gestos.modelos';
import { POSES, sintetizarMao, type Lugar, type PoseSintetica } from './sintetizar-mao';

const ASPECTO = 4 / 3;

/** Como o motor mede: `x` e `z` voltam para a escala de `y`. */
function corrigida(pose: PoseSintetica, lugar?: Lugar): Ponto[] {
  return sintetizarMao(pose, lugar, ASPECTO).map((p): Ponto => [p[0] * ASPECTO, p[1], p[2] * ASPECTO]);
}

describe('a geometria da mão', () => {
  it('o tamanho da mão quase não muda quando os dedos dobram', () => {
    const aberta = tamanhoDaMao(corrigida(POSES.aberta));
    expect(tamanhoDaMao(corrigida(POSES.punho))).toBeCloseTo(aberta, 6);
    expect(tamanhoDaMao(corrigida(POSES.meiaAberta))).toBeCloseTo(aberta, 6);
  });

  it('a distância da pinça é a mesma perto e longe da câmera', () => {
    const perto = corrigida(POSES.pinca, { x: 0.5, y: 0.8, escala: 1 / 35 });
    const longe = corrigida(POSES.pinca, { x: 0.5, y: 0.7, escala: 1 / 90 });
    expect(distanciaDaPinca(perto, tamanhoDaMao(perto))).toBeCloseTo(distanciaDaPinca(longe, tamanhoDaMao(longe)), 6);
    // Pontas encostadas ficam abaixo do limiar de entrada (0.05); soltas, bem acima do de saída.
    expect(distanciaDaPinca(perto, tamanhoDaMao(perto))).toBeLessThan(0.05);
    const solta = corrigida(POSES.pincaSolta);
    expect(distanciaDaPinca(solta, tamanhoDaMao(solta))).toBeGreaterThan(0.08);
  });

  it('classifica cada pose, com punho na frente da pinça', () => {
    expect(classificarPose(corrigida(POSES.aberta), false)).toBe('aberta');
    expect(classificarPose(corrigida(POSES.punho), false)).toBe('punho');
    // No punho o polegar deita sobre o indicador: mesmo com a histerese ligada, é punho.
    expect(classificarPose(corrigida(POSES.punho), true)).toBe('punho');
    expect(classificarPose(corrigida(POSES.apontar), false)).toBe('apontar');
    expect(classificarPose(corrigida(POSES.pinca), true)).toBe('pinca');
    expect(classificarPose(corrigida(POSES.pincaSolta), false)).toBe('outra');
    expect(classificarPose(corrigida(POSES.meiaAberta), false)).toBe('outra');
  });

  it('a abertura vai de 0 no punho a 1 na mão aberta, passando pelo meio', () => {
    expect(aberturaDaMao(corrigida(POSES.punho))).toBe(0);
    expect(aberturaDaMao(corrigida(POSES.aberta))).toBe(1);
    const meia = aberturaDaMao(corrigida(POSES.meiaAberta));
    expect(meia).toBeGreaterThan(0.3);
    expect(meia).toBeLessThan(0.8);
  });
});

describe('o filtro One Euro', () => {
  it('alisa o tremor da mão parada', () => {
    const filtro = new FiltroUmEuro(1, 5, 1);
    let maior = 0;
    for (let i = 0; i < 60; i++) {
      const valor = filtro.filtrar(0.5 + (i % 2 ? 0.004 : -0.004), i * 33);
      if (i > 10) maior = Math.max(maior, Math.abs(valor - 0.5));
    }
    expect(maior).toBeLessThan(0.002);
  });

  it('acompanha um movimento rápido sem ficar muito para trás', () => {
    const filtro = new FiltroUmEuro(1, 5, 1);
    let valor = 0;
    for (let i = 0; i <= 15; i++) valor = filtro.filtrar(i * 0.02, i * 33);
    // A mão andou 0.3 em meio segundo: o filtro está a menos de 0.05 dela.
    expect(0.3 - valor).toBeLessThan(0.05);
  });

  it('ignora um instante repetido', () => {
    const filtro = new FiltroUmEuro(1, 5, 1);
    filtro.filtrar(0.2, 0);
    const a = filtro.filtrar(0.4, 33);
    expect(filtro.filtrar(0.9, 33)).toBe(a);
  });
});
