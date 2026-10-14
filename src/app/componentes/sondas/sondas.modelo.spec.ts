import { describe, expect, it } from 'vitest';

import { descreverSondas, provedorDaVoz, type EntradaDasSondas } from './sondas.modelo';

const REPOUSO: EntradaDasSondas = {
  estado: 'ocioso',
  escutaDisponivel: true,
  escutaLigada: true,
  ditando: false,
  progresso: '',
  rotuloVoz: 'VOZ: ELEVENLABS 62%',
};

const ativas = (e: EntradaDasSondas) =>
  descreverSondas(e)
    .filter((s) => s.ativa)
    .map((s) => s.id);

describe('as sondas do orbe', () => {
  it('em repouso nenhuma acende e cada uma diz o estado real', () => {
    const sondas = descreverSondas(REPOUSO);
    expect(ativas(REPOUSO)).toEqual([]);
    expect(sondas.map((s) => s.detalhe)).toEqual([
      'Em espera',
      'Fala → texto',
      'Claude · ferramentas',
      'ElevenLabs 62%',
    ]);
  });

  it('cada etapa do pedido acende a sua sonda', () => {
    expect(ativas({ ...REPOUSO, estado: 'ouvindo' })).toEqual(['entrada']);
    expect(ativas({ ...REPOUSO, estado: 'ouvindo', ditando: true })).toEqual([
      'entrada',
      'transcricao',
    ]);
    expect(ativas({ ...REPOUSO, estado: 'pensando' })).toEqual(['processamento']);
    expect(ativas({ ...REPOUSO, estado: 'gerando' })).toEqual(['processamento']);
    expect(ativas({ ...REPOUSO, estado: 'falando' })).toEqual(['voz']);
  });

  it('o processamento mostra a ferramenta em curso, encurtada para caber no card', () => {
    const [, , processamento] = descreverSondas({
      ...REPOUSO,
      estado: 'pensando',
      progresso: 'Consultando o status do servidor e dos sites monitorados',
    });
    expect(processamento.detalhe.length).toBeLessThanOrEqual(28);
    expect(processamento.detalhe.endsWith('…')).toBe(true);
  });

  it('sem reconhecimento de voz no navegador, a entrada diz isso', () => {
    expect(descreverSondas({ ...REPOUSO, escutaDisponivel: false })[0].detalhe).toBe('Sem suporte');
    expect(descreverSondas({ ...REPOUSO, escutaLigada: false })[0].detalhe).toBe(
      'Microfone desligado',
    );
  });

  it('o rótulo da cota vira o nome do provedor', () => {
    expect(provedorDaVoz('VOZ: ELEVENLABS 8%')).toBe('ElevenLabs 8%');
    expect(provedorDaVoz('VOZ: NAVEGADOR (cota)')).toBe('Navegador (cota)');
    expect(provedorDaVoz('')).toBe('Pronta');
  });

  it('os fios terminam no mesmo raio, fora da coroa do reator', () => {
    for (const sonda of descreverSondas(REPOUSO)) {
      const [x, y] = sonda.alvo;
      expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(33.5, 0);
    }
  });
});
