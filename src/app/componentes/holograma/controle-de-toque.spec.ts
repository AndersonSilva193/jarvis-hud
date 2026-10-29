import { describe, expect, it } from 'vitest';

import { ReconhecedorDeToque, type IntencaoDeToque } from './controle-de-toque';

const ALTURA = 600;

function novo(): ReconhecedorDeToque {
  return new ReconhecedorDeToque(() => ALTURA);
}

function doTipo<T extends IntencaoDeToque['tipo']>(lista: IntencaoDeToque[], tipo: T): Extract<IntencaoDeToque, { tipo: T }>[] {
  return lista.filter((i) => i.tipo === tipo) as Extract<IntencaoDeToque, { tipo: T }>[];
}

/** Dois dedos indo de (a0, b0) a (a1, b1) em `passos` movimentos de 16 ms. */
function doisDedos(r: ReconhecedorDeToque, a0: [number, number], b0: [number, number], a1: [number, number], b1: [number, number], passos = 20): IntencaoDeToque[] {
  const saida = [...r.baixar({ id: 1, x: a0[0], y: a0[1], t: 0 }), ...r.baixar({ id: 2, x: b0[0], y: b0[1], t: 0 })];
  for (let i = 1; i <= passos; i++) {
    const k = i / passos;
    const t = i * 16;
    saida.push(...r.mover({ id: 1, x: a0[0] + (a1[0] - a0[0]) * k, y: a0[1] + (a1[1] - a0[1]) * k, t }));
    saida.push(...r.mover({ id: 2, x: b0[0] + (b1[0] - b0[0]) * k, y: b0[1] + (b1[1] - b0[1]) * k, t }));
  }
  const fim = passos * 16 + 16;
  saida.push(...r.levantar({ id: 1, x: a1[0], y: a1[1], t: fim }), ...r.levantar({ id: 2, x: b1[0], y: b1[1], t: fim }));
  return saida;
}

describe('o reconhecedor de toque', () => {
  it('um dedo arrastando gira e, ao soltar, lança com a velocidade do fim do arrasto', () => {
    const r = novo();
    const saida = [...r.baixar({ id: 1, x: 100, y: 300, t: 0 })];
    for (let i = 1; i <= 20; i++) saida.push(...r.mover({ id: 1, x: 100 + i * 10, y: 300, t: i * 16 }));
    saida.push(...r.levantar({ id: 1, x: 300, y: 300, t: 336 }));
    expect(saida[0]).toEqual({ tipo: 'inicio' });
    expect(doTipo(saida, 'girar').reduce((s, g) => s + g.dx, 0)).toBe(200);
    const [solta] = doTipo(saida, 'soltarGiro');
    // 10 px a cada 16 ms ≈ 625 px/s.
    expect(solta!.vx).toBeCloseTo(625, -1);
    expect(saida.at(-1)).toEqual({ tipo: 'fim' });
  });

  it('pinça de dois dedos abrindo dá zoom e nunca explode', () => {
    const saida = doisDedos(novo(), [250, 300], [350, 300], [150, 300], [450, 300]);
    const total = doTipo(saida, 'zoom').reduce((p, z) => p * z.fator, 1);
    expect(total).toBeCloseTo(3, 1);
    expect(doTipo(saida, 'explodir')).toHaveLength(0);
    expect(doTipo(saida, 'girar')).toHaveLength(0);
  });

  it('dois dedos subindo juntos explodem, descendo montam, sem zoom', () => {
    const sobe = doisDedos(novo(), [250, 400], [350, 400], [250, 250], [350, 250]);
    expect(doTipo(sobe, 'explodir').reduce((s, e) => s + e.delta, 0)).toBeCloseTo(150 / ALTURA, 5);
    expect(doTipo(sobe, 'zoom')).toHaveLength(0);

    const desce = doisDedos(novo(), [250, 250], [350, 250], [250, 400], [350, 400]);
    expect(doTipo(desce, 'explodir').reduce((s, e) => s + e.delta, 0)).toBeLessThan(0);
  });

  it('decidido o modo, ele não troca até soltar: subir e depois abrir continua explodindo', () => {
    const r = novo();
    const saida = [...r.baixar({ id: 1, x: 250, y: 400, t: 0 }), ...r.baixar({ id: 2, x: 350, y: 400, t: 0 })];
    saida.push(...r.mover({ id: 1, x: 250, y: 360, t: 16 }), ...r.mover({ id: 2, x: 350, y: 360, t: 16 }));
    saida.push(...r.mover({ id: 1, x: 150, y: 360, t: 32 }), ...r.mover({ id: 2, x: 450, y: 360, t: 32 }));
    expect(doTipo(saida, 'explodir').length).toBeGreaterThan(0);
    expect(doTipo(saida, 'zoom')).toHaveLength(0);
  });

  it('toque duplo no mesmo lugar sai uma vez, no ponto do segundo toque', () => {
    const r = novo();
    const saida = [
      ...r.baixar({ id: 1, x: 200, y: 200, t: 0 }),
      ...r.levantar({ id: 1, x: 201, y: 200, t: 90 }),
      ...r.baixar({ id: 2, x: 205, y: 203, t: 250 }),
      ...r.levantar({ id: 2, x: 205, y: 203, t: 330 }),
    ];
    expect(doTipo(saida, 'toqueDuplo')).toEqual([{ tipo: 'toqueDuplo', x: 205, y: 203 }]);
    expect(doTipo(saida, 'soltarGiro')).toHaveLength(0);
  });

  it('toques lentos, longe ou arrastados não são toque duplo', () => {
    const lento = novo();
    expect(
      doTipo([...lento.baixar({ id: 1, x: 200, y: 200, t: 0 }), ...lento.levantar({ id: 1, x: 200, y: 200, t: 90 }),
        ...lento.baixar({ id: 2, x: 200, y: 200, t: 500 }), ...lento.levantar({ id: 2, x: 200, y: 200, t: 580 })], 'toqueDuplo'),
    ).toHaveLength(0);

    const longe = novo();
    expect(
      doTipo([...longe.baixar({ id: 1, x: 200, y: 200, t: 0 }), ...longe.levantar({ id: 1, x: 200, y: 200, t: 90 }),
        ...longe.baixar({ id: 2, x: 300, y: 200, t: 200 }), ...longe.levantar({ id: 2, x: 300, y: 200, t: 280 })], 'toqueDuplo'),
    ).toHaveLength(0);

    const arrastado = novo();
    const saida = [...arrastado.baixar({ id: 1, x: 200, y: 200, t: 0 }), ...arrastado.mover({ id: 1, x: 240, y: 200, t: 40 }),
      ...arrastado.levantar({ id: 1, x: 240, y: 200, t: 90 }),
      ...arrastado.baixar({ id: 2, x: 200, y: 200, t: 200 }), ...arrastado.levantar({ id: 2, x: 200, y: 200, t: 280 })];
    expect(doTipo(saida, 'toqueDuplo')).toHaveLength(0);
  });

  it('quando um dos dois dedos sai, o que fica não vira giro', () => {
    const r = novo();
    r.baixar({ id: 1, x: 250, y: 300, t: 0 });
    r.baixar({ id: 2, x: 350, y: 300, t: 0 });
    r.levantar({ id: 2, x: 350, y: 300, t: 50 });
    const saida = r.mover({ id: 1, x: 300, y: 300, t: 66 });
    expect(saida).toEqual([]);
    expect(r.levantar({ id: 1, x: 300, y: 300, t: 80 })).toEqual([{ tipo: 'fim' }]);
  });

  it('cancelar fecha sem toque nem inércia', () => {
    const r = novo();
    r.baixar({ id: 1, x: 100, y: 100, t: 0 });
    r.mover({ id: 1, x: 200, y: 100, t: 16 });
    expect(r.cancelar({ id: 1, x: 200, y: 100, t: 32 })).toEqual([{ tipo: 'fim' }]);
  });
});
