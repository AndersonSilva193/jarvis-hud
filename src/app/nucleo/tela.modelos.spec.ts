import { describe, expect, it } from 'vitest';

import { lerCardTela } from './tela.modelos';

/** O payload do servidor, igual ao que chega no SSE `tela.card`. */
const CARD = {
  id: 'cz9wu',
  tipo: 'pesquisa',
  titulo: 'A temperatura cai 8 °C até quinta',
  dados: {
    categoria: 'clima',
    tema: 'Previsão para São Paulo',
    referencia: '23/10/2026',
    layout: 'grafico',
    itens: [],
    resumo: 'A máxima cai de 31 para 23 graus até quinta.',
    fontes: [{ nome: 'Inmet', url: 'https://portal.inmet.gov.br/' }],
    consultadoEm: '23/10/2026 19:40',
    grafico: {
      tipo: 'linha',
      eixoX: ['seg', 'ter', 'qua', 'qui'],
      series: [{ nome: 'Máxima', valores: [31.0, 29.0, 26.0, 23.0] }],
      unidade: '°C',
      destaque: { serie: 0, indice: 3 },
      origem: 'pesquisa',
    },
  },
  origem: 'hud',
  criadoEm: '2026-10-23T22:47:24.742755Z',
};

const com = (grafico: unknown) => ({ ...CARD, dados: { ...CARD.dados, grafico } });

describe('a pesquisa com layout de gráfico', () => {
  it('aceita o payload do servidor', () => {
    const card = lerCardTela(CARD);
    expect(card).not.toBeNull();
    expect(card!.tipo === 'pesquisa' && card!.dados.layout).toBe('grafico');
  });

  it('aceita barras com duas séries e sem destaque', () => {
    const grafico = {
      ...CARD.dados.grafico,
      tipo: 'barras',
      destaque: null,
      series: [
        { nome: 'Máxima', valores: [31, 29, 26, 23] },
        { nome: 'Mínima', valores: [21, 20, 18, 15] },
      ],
    };
    expect(lerCardTela(com(grafico))).not.toBeNull();
  });

  it.each([
    ['sem o bloco do gráfico', undefined],
    ['com tipo desconhecido', { ...CARD.dados.grafico, tipo: 'pizza' }],
    ['com eixo vazio', { ...CARD.dados.grafico, eixoX: [], series: [{ nome: 'Máxima', valores: [] }] }],
    ['sem série alguma', { ...CARD.dados.grafico, series: [] }],
    ['com valores de tamanho diferente do eixo', { ...CARD.dados.grafico, series: [{ nome: 'Máxima', valores: [31, 29] }] }],
    ['com valor não numérico', { ...CARD.dados.grafico, series: [{ nome: 'Máxima', valores: [31, 29, 26, '23'] }] }],
    ['com valor infinito', { ...CARD.dados.grafico, series: [{ nome: 'Máxima', valores: [31, 29, 26, Infinity] }] }],
    ['com destaque fora da faixa', { ...CARD.dados.grafico, destaque: { serie: 0, indice: 9 } }],
    ['com unidade que não é texto', { ...CARD.dados.grafico, unidade: 7 }],
  ])('rejeita o card %s', (_caso, grafico) => {
    expect(lerCardTela(com(grafico))).toBeNull();
  });

  it('não exige o bloco do gráfico nos outros layouts', () => {
    const lista = { ...CARD, dados: { ...CARD.dados, layout: 'lista', itens: [{ texto: 'Primeiro' }], grafico: undefined } };
    expect(lerCardTela(lista)).not.toBeNull();
  });
});
