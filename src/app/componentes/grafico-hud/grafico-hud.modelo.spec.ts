import { describe, expect, it } from 'vitest';

import type { Grafico } from '../../nucleo/tela.modelos';
import { desenhar, escalaY, indicesComRotulo, passoDosRotulos, passoRedondo } from './grafico-hud.modelo';

const CLIMA: Grafico = {
  tipo: 'linha',
  eixoX: ['seg', 'ter', 'qua', 'qui'],
  series: [{ nome: 'Máxima', valores: [31, 29, 26, 23] }],
  unidade: '°C',
  destaque: { serie: 0, indice: 3 },
  origem: 'pesquisa',
};

const grafico = (parcial: Partial<Grafico>): Grafico => ({ ...CLIMA, ...parcial });

/** Toda marca precisa cair num múltiplo exato do passo, senão o eixo não lê como redondo. */
const redondas = (marcas: readonly { valor: number }[], passo: number) =>
  marcas.every(m => Math.abs(m.valor / passo - Math.round(m.valor / passo)) < 1e-6);

describe('a escala do gráfico do HUD', () => {
  it('nas barras sempre inclui o zero, mesmo com todos os valores longe dele', () => {
    const escala = escalaY([31, 29, 26, 23], true);
    expect(escala.min).toBe(0);
    expect(escala.max).toBeGreaterThanOrEqual(31);
  });

  it('na linha usa faixa justa em volta dos dados em vez de cair a zero', () => {
    const escala = escalaY([31, 29, 26, 23], false);
    expect(escala.min).toBeGreaterThan(0);
    expect(escala.min).toBeLessThanOrEqual(23);
    expect(escala.max).toBeGreaterThanOrEqual(31);
  });

  it.each([
    [[31, 29, 26, 23], false],
    [[31, 29, 26, 23], true],
    [[0.2, 0.45, 0.1], false],
    [[1200, 300, 8400], true],
    [[-4, 6, 2], true],
  ] as const)('dá de 3 a 5 marcas em números redondos para %j (zero: %s)', (valores, doZero) => {
    const escala = escalaY([...valores], doZero);
    expect(escala.marcas.length).toBeGreaterThanOrEqual(3);
    expect(escala.marcas.length).toBeLessThanOrEqual(5);
    expect(redondas(escala.marcas, escala.passo)).toBe(true);
    expect(escala.min).toBeLessThanOrEqual(Math.min(...valores));
    expect(escala.max).toBeGreaterThanOrEqual(Math.max(...valores));
  });

  it('a unidade aparece só na marca de cima', () => {
    const marcas = escalaY([31, 23], false, '°C').marcas;
    expect(marcas[marcas.length - 1]!.rotulo).toContain('°C');
    expect(marcas.slice(0, -1).every(m => !m.rotulo.includes('°C'))).toBe(true);
  });

  it('não quebra com série constante nem com tudo em zero', () => {
    for (const escala of [escalaY([7, 7, 7], false), escalaY([0, 0], true)]) {
      expect(escala.max).toBeGreaterThan(escala.min);
      expect(escala.marcas.every(m => Number.isFinite(m.y))).toBe(true);
    }
  });

  it('o passo redondo é sempre 1 / 2 / 2,5 / 5 × 10ⁿ', () => {
    expect(passoRedondo(2.6)).toBe(5);
    expect(passoRedondo(1.9)).toBe(2);
    expect(passoRedondo(2)).toBe(2);
    expect(passoRedondo(0.03)).toBe(0.05);
    expect(passoRedondo(0)).toBe(1);
  });
});

describe('os rótulos do eixo X', () => {
  it('pula rótulos quando não cabem e mantém todos quando cabem', () => {
    expect(passoDosRotulos(4, 536, 3)).toBe(1);
    expect(passoDosRotulos(24, 536, 5)).toBeGreaterThan(1);
  });

  it('o primeiro e o último entram sempre, sem colar um no outro', () => {
    const muitos = Array.from({ length: 24 }, (_, i) => `${i}h00`);
    const indices = indicesComRotulo(muitos);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(23);
    const passos = indices.slice(1).map((v, i) => v - indices[i]!);
    expect(Math.min(...passos)).toBeGreaterThan(1);
  });
});

describe('o desenho do gráfico', () => {
  it('na linha liga os pontos e escreve o valor do fim e do destaque', () => {
    const d = desenhar(CLIMA);
    expect(d.pontos).toHaveLength(4);
    expect(d.barras).toHaveLength(0);
    expect(d.caminhos[0]!.d.startsWith('M')).toBe(true);
    expect(d.caminhos[0]!.d.match(/L/g)).toHaveLength(3);
    // O último ponto é o próprio destaque: um valor escrito, não dois.
    expect(d.valoresEscritos).toHaveLength(1);
    expect(d.valoresEscritos[0]!.texto).toBe('23 °C');
    expect(d.pontos[3]!.destacado).toBe(true);
    expect(d.pontos.filter(p => p.destacado)).toHaveLength(1);
  });

  it('as barras nascem na linha do zero e as de uma mesma faixa não se sobrepõem', () => {
    const d = desenhar(grafico({
      tipo: 'barras',
      series: [
        { nome: 'Máxima', valores: [31, 29, 26, 23] },
        { nome: 'Mínima', valores: [21, 20, 18, 15] },
      ],
      destaque: null,
    }));
    expect(d.escala.min).toBe(0);
    expect(d.yDoZero).toBeCloseTo(d.eixo.base, 5);
    expect(d.barras.every(b => Math.abs(b.topo + b.altura - d.yDoZero) < 1e-6)).toBe(true);

    const naFaixa = d.barras.filter(b => b.indice === 0).sort((a, b) => a.esquerda - b.esquerda);
    expect(naFaixa).toHaveLength(2);
    expect(naFaixa[0]!.esquerda + naFaixa[0]!.largura).toBeLessThanOrEqual(naFaixa[1]!.esquerda);
    // Barra maior, coluna mais alta: a leitura por área só vale porque a escala parte do zero.
    expect(naFaixa[0]!.altura).toBeGreaterThan(d.barras.find(b => b.serie === 1 && b.indice === 0)!.altura);
  });

  it('em barras escreve só o valor do destaque', () => {
    const semDestaque = desenhar(grafico({ tipo: 'barras', destaque: null }));
    expect(semDestaque.valoresEscritos).toHaveLength(0);
    const comDestaque = desenhar(grafico({ tipo: 'barras', destaque: { serie: 0, indice: 1 } }));
    expect(comDestaque.valoresEscritos).toHaveLength(1);
    expect(comDestaque.valoresEscritos[0]!.indice).toBe(1);
  });

  it('a legenda só existe com mais de uma série', () => {
    expect(desenhar(CLIMA).legenda).toEqual([]);
    const duas = desenhar(grafico({
      series: [{ nome: 'Máxima', valores: [31, 29, 26, 23] }, { nome: 'Mínima', valores: [21, 20, 18, 15] }],
    }));
    expect(duas.legenda.map(l => l.nome)).toEqual(['Máxima', 'Mínima']);
  });

  it('todo ponto fica dentro da área do viewBox', () => {
    for (const d of [desenhar(CLIMA), desenhar(grafico({ tipo: 'barras' }))]) {
      expect(d.marcas.every(m => m.x >= d.eixo.esquerda - 1 && m.x <= d.eixo.direita + 1)).toBe(true);
      expect(d.marcas.every(m => Number.isFinite(m.y) && m.y >= 0 && m.y <= d.eixo.base + 1)).toBe(true);
    }
  });
});
