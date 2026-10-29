import { describe, expect, it } from 'vitest';

import { lerFimHolograma, lerMetaHolograma, lerPecaHolograma } from './holograma.modelos';

/** Uma peça como o `HologramaController` manda no evento `peca`. */
const PECA = {
  id: 'pistao_e_1',
  nome: 'Pistão esquerdo',
  grupo: 'pistoes',
  forma: 'cyl',
  posicao: [-1.05, 0.9, -0.45],
  rotacao: [0, 0, -45],
  tamanho: [0.28, 0.28, 0.5],
  cor: '#f472b6',
  explosao: [-0.7071, 0.7071, 0],
  opacidade: 1,
  contorno: true,
  pontos: null,
};

describe('lerPecaHolograma', () => {
  it('aceita a peça do servidor', () => {
    expect(lerPecaHolograma(PECA)).toEqual({ ...PECA, pontos: null });
  });

  it('recusa forma desconhecida, aridade errada e número que não é finito', () => {
    expect(lerPecaHolograma({ ...PECA, forma: 'pyramid' })).toBeNull();
    expect(lerPecaHolograma({ ...PECA, tamanho: [0.28, 0.5] })).toBeNull();
    expect(lerPecaHolograma({ ...PECA, posicao: [0, null, 0] })).toBeNull();
    expect(lerPecaHolograma({ ...PECA, tamanho: [0.28, 0.28, -1] })).toBeNull();
  });

  it('exige de 2 a 32 pontos em tube e line', () => {
    const linha = { ...PECA, forma: 'line', tamanho: [], pontos: [[0, 0, 0], [0, 1, 0]] };
    expect(lerPecaHolograma(linha)?.pontos).toEqual([[0, 0, 0], [0, 1, 0]]);
    expect(lerPecaHolograma({ ...linha, pontos: [[0, 0, 0]] })).toBeNull();
    expect(lerPecaHolograma({ ...linha, pontos: [[0, 0, 0], [0, 1]] })).toBeNull();
  });

  it('troca cor inválida pelo ciano e prende a opacidade; explosão nula vira null', () => {
    const peca = lerPecaHolograma({ ...PECA, cor: 'red', opacidade: 0, explosao: [0, 0, 0] });
    expect(peca?.cor).toBe('#38bdf8');
    expect(peca?.opacidade).toBe(0.05);
    expect(peca?.explosao).toBeNull();
  });
});

describe('meta e fim', () => {
  it('leem os corpos do stream', () => {
    expect(lerMetaHolograma({ nome: 'DNA', categoria: 'biologia', descricao: 'Dupla hélice.' })).toEqual({
      nome: 'DNA', categoria: 'biologia', descricao: 'Dupla hélice.',
    });
    expect(lerMetaHolograma({ nome: '  ' })).toBeNull();
    expect(lerFimHolograma({ pecas: 87, avisos: 0 })).toEqual({ pecas: 87, avisos: 0 });
    expect(lerFimHolograma({ pecas: '87', avisos: 0 })).toBeNull();
  });
});
