import { describe, expect, it } from 'vitest';

import { contextoBriefing } from './horario-briefing';
import type { Briefing } from './briefing.modelos';

/** Um briefing só com o que o cálculo de horário usa; o resto não entra na conta. */
function briefingDe(parcial: Partial<Briefing>): Briefing {
  return {
    geradoEm: '2026-10-13T08:00:00-03:00',
    nomeUsuario: 'Anderson',
    secoes: [],
    texto: '',
    geradoAgora: true,
    ...parcial,
  };
}

/** Sem `abertura` do backend, a HUD calcula o cumprimento sozinha — é o caminho que se mede aqui. */
function saudacaoEm(hora: string, fusoHorario?: string): string {
  return contextoBriefing(briefingDe({ geradoEm: `2026-10-13T${hora}:00-03:00`, fusoHorario })).abertura;
}

describe('contextoBriefing', () => {
  it.each([
    ['00:00', 'Boa noite'],
    ['04:59', 'Boa noite'],
    ['05:00', 'Bom dia'],
    ['11:59', 'Bom dia'],
    ['12:00', 'Boa tarde'],
    ['17:59', 'Boa tarde'],
    ['18:00', 'Boa noite'],
    ['23:59', 'Boa noite'],
  ])('%s abre com "%s"', (hora, esperado) => {
    expect(saudacaoEm(hora, 'America/Sao_Paulo')).toBe(`${esperado}, Anderson!`);
  });

  it('a abertura do backend vence o cálculo local: é ela que vai para a síntese', () => {
    const contexto = contextoBriefing(
      briefingDe({ abertura: 'Boa noite, senhor. Seu briefing está pronto.', fusoHorario: 'America/Sao_Paulo' }),
    );

    expect(contexto.abertura).toBe('Boa noite, senhor. Seu briefing está pronto.');
  });

  it('usa o fuso do servidor, e não o relógio do navegador', () => {
    // 08:00 em São Paulo é 20:00 em Tóquio. Quem manda é o fuso que veio no briefing.
    expect(saudacaoEm('08:00', 'Asia/Tokyo')).toBe('Boa noite, Anderson!');
  });

  it('fuso inválido cai no caminho antigo e preserva o relógio do offset ISO', () => {
    expect(saudacaoEm('20:00', 'Marte/Olympus')).toBe('Boa noite, Anderson!');
    expect(saudacaoEm('08:00', 'Marte/Olympus')).toBe('Bom dia, Anderson!');
  });

  it('backend antigo, sem fusoHorario: o período sai do relógio que veio no offset', () => {
    expect(saudacaoEm('15:00')).toBe('Boa tarde, Anderson!');
    expect(contextoBriefing(briefingDe({ geradoEm: '2026-10-13T15:00:00-03:00' })).geracao).toContain('15:00');
  });

  it('sem nome de usuário trata por senhor', () => {
    expect(contextoBriefing(briefingDe({ nomeUsuario: '' })).abertura).toBe('Bom dia, senhor!');
  });

  it('geradoEm impossível de ler não derruba a tela', () => {
    const contexto = contextoBriefing(briefingDe({ geradoEm: 'ontem de manhã' }));

    expect(contexto.abertura).toBe('Olá, senhor. Seu briefing está disponível.');
    expect(contexto.geracao).toBe('Horário de geração indisponível');
  });

  it('a data de geração sai formatada em pt-BR, no fuso do servidor', () => {
    expect(contextoBriefing(briefingDe({ fusoHorario: 'America/Sao_Paulo' })).geracao).toBe(
      '13/10/2026, 08:00',
    );
  });
});
