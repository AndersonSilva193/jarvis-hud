import { describe, expect, it } from 'vitest';

import {
  avisoEhTroca,
  lerErroHolograma,
  lerFimHolograma,
  textoIncompleto,
  lerGeradorHolograma,
  lerMetaHolograma,
  lerPecaHolograma,
  seloDoHolograma,
} from './holograma.modelos';

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
    expect(lerFimHolograma({ pecas: 87, avisos: 0 })).toEqual({ pecas: 87, avisos: 0, status: 'completo' });
    expect(lerFimHolograma({ pecas: '87', avisos: 0 })).toBeNull();
  });

  it('o fim leva o resumo do gasto, campo a campo', () => {
    expect(
      lerFimHolograma({ pecas: 86, avisos: 0, provedor: 'anthropic', modelo: 'claude-haiku-5-5', tokensEntrada: 900, tokensSaida: 5200, custoUsd: 0.0027 }),
    ).toEqual({ pecas: 86, avisos: 0, status: 'completo', provedor: 'anthropic', modelo: 'claude-haiku-5-5', tokensEntrada: 900, tokensSaida: 5200, custoUsd: 0.0027 });
    // Valor torto cai fora sem derrubar o fim.
    expect(lerFimHolograma({ pecas: 1, avisos: 0, provedor: 'x', custoUsd: -1, tokensSaida: 'muitos' })).toEqual({ pecas: 1, avisos: 0, status: 'completo' });
  });

  it('o fim incompleto traz o motivo e o id; a meta traz o id da geração', () => {
    expect(lerFimHolograma({ pecas: 72, avisos: 0, status: 'incompleto', motivo: 'o modelo bateu no teto de tokens', id: 'habc12345' })).toEqual({
      pecas: 72, avisos: 0, status: 'incompleto', motivo: 'o modelo bateu no teto de tokens', id: 'habc12345',
    });
    expect(lerFimHolograma({ pecas: 1, avisos: 0, status: 'talvez', id: '../x' })).toEqual({ pecas: 1, avisos: 0, status: 'completo' });
    expect(lerMetaHolograma({ nome: 'Torre', id: 'habc12345' })?.id).toBe('habc12345');
    expect(lerMetaHolograma({ nome: 'Torre', id: 'h<script>' })?.id).toBeUndefined();
  });

  it('o texto do incompleto sai em minúscula e sem ponto', () => {
    expect(textoIncompleto('O modelo não respondeu a tempo.')).toBe('Incompleto: o modelo não respondeu a tempo');
    expect(textoIncompleto(undefined)).toBe('Incompleto');
  });

  it('o selo mostra gerador, peças e custo', () => {
    expect(seloDoHolograma({ pecas: 86, avisos: 0, status: 'completo', provedor: 'anthropic', modelo: 'claude-haiku-5-5', custoUsd: 0.0021 })).toBe('Haiku · 86 peças · US$0,002');
    expect(seloDoHolograma({ pecas: 1, avisos: 0, status: 'completo', provedor: 'local' })).toBe('Local · 1 peça');
    expect(seloDoHolograma({ pecas: 5, avisos: 0, status: 'completo', provedor: 'anthropic', modelo: 'claude-haiku-5-5', custoUsd: 0.0001 })).toBe('Haiku · 5 peças · <US$0,001');
    // Stream cortado: sem tokens, o selo não inventa custo.
    expect(seloDoHolograma({ pecas: 250, avisos: 3, status: 'completo', provedor: 'anthropic', modelo: 'claude-haiku-5-5' })).toBe('Haiku · 250 peças');
  });

  it('o aviso de troca é marcado pelo servidor, não pelo texto', () => {
    expect(avisoEhTroca({ texto: 'troquei', troca: true })).toBe(true);
    expect(avisoEhTroca({ texto: 'O Haiku falhou; troquei para o gerador local.' })).toBe(false);
  });

  it('o gerador pedido é só haiku ou local', () => {
    expect(lerGeradorHolograma('local')).toBe('local');
    expect(lerGeradorHolograma('gpt')).toBeNull();
    expect(lerGeradorHolograma(null)).toBeNull();
  });

  it('o erro precisa de texto', () => {
    expect(lerErroHolograma({ texto: 'O modelo não respondeu a tempo.' })).toBe('O modelo não respondeu a tempo.');
    expect(lerErroHolograma({ texto: '   ' })).toBeNull();
    expect(lerErroHolograma({ mensagem: 'x' })).toBeNull();
  });
});
