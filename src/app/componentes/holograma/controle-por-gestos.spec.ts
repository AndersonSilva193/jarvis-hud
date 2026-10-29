import { describe, expect, it, vi } from 'vitest';

import { ControlePorGestos, VOLTA, type AlvoDoControle, type SaidasDoControle, type Sensibilidade } from './controle-por-gestos';

const NORMAL: Sensibilidade = { giro: 1, zoom: 1, inverterX: false, inverterY: false };

function montar(sensibilidade: Sensibilidade = NORMAL, pecaNoPonto: { nome: string; grupo: string } | null = null) {
  const alvo = {
    girar: vi.fn(),
    lancarGiro: vi.fn(),
    aproximar: vi.fn(),
    apontar: vi.fn(),
    selecionarEm: vi.fn(() => pecaNoPonto),
    segurarAutoRotacao: vi.fn(),
    comecarInteracao: vi.fn(),
    terminarInteracao: vi.fn(),
  } satisfies AlvoDoControle;
  const saidas = { explodir: vi.fn(), resetar: vi.fn(), selecionou: vi.fn(), gesto: vi.fn() } satisfies SaidasDoControle;
  return { alvo, saidas, controle: new ControlePorGestos(alvo, saidas, () => sensibilidade) };
}

describe('o controle por gestos', () => {
  it('girar e soltar viram radianos, com sensibilidade e eixo invertido', () => {
    const { alvo, controle } = montar({ ...NORMAL, giro: 2, inverterY: true });
    controle.aplicar([{ tipo: 'girar', dx: 0.1, dy: 0.05 }, { tipo: 'soltarGiro', vx: 0.5, vy: 0 }]);
    const [dAz, dPol] = alvo.girar.mock.calls[0]!;
    expect(dAz).toBeCloseTo(VOLTA * 0.2);
    expect(dPol).toBeCloseTo(-VOLTA * 0.1);
    expect(alvo.lancarGiro.mock.calls[0]![0]).toBeCloseTo(VOLTA * 1);
  });

  it('a sensibilidade do zoom é expoente do fator', () => {
    const { alvo, controle } = montar({ ...NORMAL, zoom: 2 });
    controle.aplicar([{ tipo: 'zoom', fator: 1.1 }]);
    expect(alvo.aproximar.mock.calls[0]![0]).toBeCloseTo(1.21);
  });

  it('o cursor vai em coordenadas do canvas (-1..1, y para cima)', () => {
    const { alvo, controle } = montar();
    controle.aplicar([{ tipo: 'cursor', x: 0.75, y: 0.25 }, { tipo: 'cursorFim' }]);
    expect(alvo.apontar.mock.calls).toEqual([[{ x: 0.5, y: 0.5 }], [null]]);
  });

  it('apontar parado sobre peça seleciona; no vazio, não mexe na seleção', () => {
    const peca = { nome: 'Pistão', grupo: 'pistoes' };
    const comPeca = montar(NORMAL, peca);
    comPeca.controle.aplicar([{ tipo: 'apontarParado', x: 0.5, y: 0.5 }]);
    expect(comPeca.saidas.selecionou).toHaveBeenCalledWith(peca);

    const vazio = montar();
    vazio.controle.aplicar([{ tipo: 'apontarParado', x: 0.5, y: 0.5 }]);
    expect(vazio.saidas.selecionou).not.toHaveBeenCalled();
  });

  it('explosão, reset, mão presente/ausente e rótulo vão a quem cuida de cada um', () => {
    const { alvo, saidas, controle } = montar();
    controle.aplicar([
      { tipo: 'maoPresente' },
      { tipo: 'explosaoInicio' },
      { tipo: 'explosao', fator: 0.6 },
      { tipo: 'explosaoFim', fator: 0.55 },
      { tipo: 'resetar' },
      { tipo: 'gesto', nome: 'Punho' },
      { tipo: 'autoRotacao' },
    ]);
    expect(saidas.explodir.mock.calls).toEqual([[0.6], [0.55]]);
    expect(saidas.resetar).toHaveBeenCalledOnce();
    expect(saidas.gesto).toHaveBeenCalledWith('Punho');
    expect(alvo.segurarAutoRotacao.mock.calls).toEqual([[true], [false]]);
  });
});
