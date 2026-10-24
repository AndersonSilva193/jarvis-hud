import { describe, expect, it } from 'vitest';

import type { Grafico } from '../../nucleo/tela.modelos';
import {
  desenhar,
  escalaY,
  indicesComRotulo,
  passoDosRotulos,
  passoRedondo,
  ROSCA,
} from './grafico-hud.modelo';

const CLIMA: Grafico = {
  tipo: 'linha',
  eixoX: ['seg', 'ter', 'qua', 'qui'],
  series: [{ nome: 'Máxima', valores: [31, 29, 26, 23] }],
  unidade: '°C',
  destaque: { serie: 0, indice: 3 },
  origem: 'pesquisa',
};

/** Totais por coluna: 20, 24, 20 e 14 — todos maiores que o maior valor solto, 18. */
const EMPILHADO: Grafico = {
  tipo: 'barras_empilhadas',
  eixoX: ['seg', 'ter', 'qua', 'qui'],
  series: [
    { nome: 'Solar', valores: [12, 18, 9, 0] },
    { nome: 'Eólica', valores: [8, 6, 11, 14] },
  ],
  unidade: 'GW',
  destaque: null,
  origem: 'pesquisa',
};

const ANEL: Grafico = {
  tipo: 'rosca',
  eixoX: ['Android', 'iOS', 'Outros SO'],
  series: [{ nome: 'Participação', valores: [71, 27, 2] }],
  unidade: '%',
  destaque: null,
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
    const tipos = [desenhar(CLIMA), desenhar(grafico({ tipo: 'barras' })), desenhar(EMPILHADO), desenhar(ANEL)];
    for (const d of tipos) {
      expect(d.marcas.length).toBeGreaterThan(0);
      expect(d.marcas.every(m => m.x >= d.eixo.esquerda - 1 && m.x <= d.eixo.direita + 1)).toBe(true);
      expect(d.marcas.every(m => Number.isFinite(m.y) && m.y >= 0 && m.y <= d.eixo.base + 1)).toBe(true);
    }
  });
});

describe('o desenho das barras empilhadas', () => {
  it('a escala cobre o total da coluna, não o maior valor solto', () => {
    const d = desenhar(EMPILHADO);
    expect(d.totais).toEqual([20, 24, 20, 14]);
    expect(d.escala.min).toBe(0);
    // Sobre os valores soltos a escala pararia em 20 e a coluna de 24 estouraria o eixo.
    expect(d.escala.max).toBeGreaterThanOrEqual(24);
  });

  it('os segmentos de uma coluna se encostam, do zero para cima, na mesma largura', () => {
    const d = desenhar(EMPILHADO);
    const coluna = d.barras.filter(b => b.indice === 0).sort((a, b) => b.topo - a.topo);
    expect(coluna).toHaveLength(2);
    // O de baixo nasce na linha do zero e o de cima continua exatamente onde ele termina.
    expect(coluna[0]!.topo + coluna[0]!.altura).toBeCloseTo(d.yDoZero, 5);
    expect(coluna[1]!.topo + coluna[1]!.altura).toBeCloseTo(coluna[0]!.topo, 5);
    expect(coluna[0]!.esquerda).toBeCloseTo(coluna[1]!.esquerda, 5);
    expect(new Set(d.barras.map(b => b.largura.toFixed(4))).size).toBe(1);
    // Mais valor, mais altura: é a soma da coluna que o eixo mede.
    expect(coluna[0]!.altura).toBeGreaterThan(coluna[1]!.altura);
  });

  it('segmento de valor zero não entra no desenho', () => {
    const d = desenhar(EMPILHADO);
    expect(d.barras).toHaveLength(7);
    const ultima = d.barras.filter(b => b.indice === 3);
    expect(ultima).toHaveLength(1);
    expect(ultima[0]!.serie).toBe(1);
    expect(ultima[0]!.topo + ultima[0]!.altura).toBeCloseTo(d.yDoZero, 5);
  });

  it('escreve só o valor do destaque, no topo do próprio segmento', () => {
    const d = desenhar({ ...EMPILHADO, destaque: { serie: 1, indice: 2 } });
    expect(d.valoresEscritos).toHaveLength(1);
    expect(d.valoresEscritos[0]!.texto).toBe('11 GW');
    const segmento = d.barras.find(b => b.serie === 1 && b.indice === 2)!;
    expect(d.valoresEscritos[0]!.y).toBeCloseTo(segmento.topo, 5);
  });

  it('não desenha linha nem ponto, e a dica se ancora nos segmentos', () => {
    const d = desenhar(EMPILHADO);
    expect(d.caminhos).toEqual([]);
    expect(d.pontos).toEqual([]);
    expect(d.colunas).toBe(true);
    expect(d.marcas).toBe(d.barras);
  });
});

describe('o desenho da rosca', () => {
  it('é sempre um anel: o caminho volta ao raio interno e nunca passa pelo centro', () => {
    const d = desenhar(ANEL);
    expect(d.fatias).toHaveLength(3);
    expect(ROSCA.raioInterno).toBeGreaterThan(0);
    for (const fatia of d.fatias) {
      expect(fatia.d).toContain(`A${ROSCA.raioInterno} ${ROSCA.raioInterno}`);
      expect(fatia.d).toContain(`A${ROSCA.raio} ${ROSCA.raio}`);
      expect(fatia.d).not.toContain(`${ROSCA.centro.x.toFixed(2)} ${ROSCA.centro.y.toFixed(2)}`);
      expect(fatia.d).not.toContain('NaN');
    }
  });

  it('as fatias saem da maior para a menor e as frações fecham o total', () => {
    const d = desenhar(ANEL);
    expect(d.fatias.map(f => f.rotulo)).toEqual(['Android', 'iOS', 'Outros SO']);
    expect(d.fatias.map(f => f.valor)).toEqual([71, 27, 2]);
    expect(d.fatias.reduce((soma, f) => soma + f.fracao, 0)).toBeCloseTo(1, 10);
    expect(d.total).toBe('100 %');
    expect(d.rosca).toBe(true);
    // Sem eixo não há grade nem rótulo de X para desenhar.
    expect(d.rotulosX).toEqual([]);
    expect(d.valoresEscritos).toEqual([]);
  });

  it('acima de seis categorias resume as menores numa fatia "Outros", sempre a última', () => {
    const d = desenhar({
      ...ANEL,
      eixoX: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      series: [{ nome: 'Fatia', valores: [40, 20, 10, 8, 6, 5, 4, 3, 2] }],
    });
    expect(d.fatias).toHaveLength(6);
    expect(d.fatias.slice(0, 5).map(f => f.valor)).toEqual([40, 20, 10, 8, 6]);
    const outros = d.fatias[5]!;
    expect(outros.rotulo).toBe('Outros');
    expect(outros.indice).toBe(-1);
    // Nada se perde: a cauda inteira vira uma fatia só, senão os ângulos não fechariam o total.
    expect(outros.valor).toBe(14);
    expect(outros.agregadas).toBe(4);
    expect(d.fatias.slice(0, 5).every(f => f.agregadas === 1)).toBe(true);
    expect(d.total).toBe('98 %');
  });

  it('com uma categoria só desenha o anel inteiro, sem arco de comprimento zero', () => {
    const d = desenhar({ ...ANEL, eixoX: ['Tudo'], series: [{ nome: 'Fatia', valores: [250] }] });
    expect(d.fatias).toHaveLength(1);
    expect(d.fatias[0]!.fracao).toBe(1);
    // Duas metades em cada raio: um `A` de 360° começaria onde termina e não desenharia nada.
    expect(d.fatias[0]!.d.match(/A/g)).toHaveLength(4);
    expect(d.fatias[0]!.d).not.toContain('NaN');
    expect(d.total).toBe('250 %');
  });

  it('categoria de valor zero não vira fatia, mas a legenda nomeia cada cor do anel', () => {
    const d = desenhar({
      ...ANEL,
      eixoX: ['Android', 'iOS', 'Vazio'],
      series: [{ nome: 'Participação', valores: [60, 40, 0] }],
    });
    expect(d.fatias.map(f => f.rotulo)).toEqual(['Android', 'iOS']);
    // Com uma série só a legenda das séries sairia vazia, e aí nada nomearia as cores.
    expect(d.legenda).toEqual([{ serie: 0, nome: 'Android' }, { serie: 1, nome: 'iOS' }]);
  });

  it('o destaque acende a fatia daquela categoria, mesmo fora da ordem do payload', () => {
    const d = desenhar({ ...ANEL, destaque: { serie: 0, indice: 1 } });
    const destacadas = d.fatias.filter(f => f.destacado);
    expect(destacadas).toHaveLength(1);
    expect(destacadas[0]!.rotulo).toBe('iOS');
  });
});
