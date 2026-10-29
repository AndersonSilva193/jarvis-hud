import type { EventoDeGesto } from '../../gestos/gestos.modelos';
import type { CenaHolograma, PecaDestacada } from './cena-holograma';

/** O pedaço da cena que gestos e toque comandam: com isto, os testes passam uma cena de mentira. */
export type AlvoDoControle = Pick<
  CenaHolograma,
  'girar' | 'lancarGiro' | 'aproximar' | 'apontar' | 'selecionarEm' | 'segurarAutoRotacao' | 'comecarInteracao' | 'terminarInteracao'
>;

/** O que não é da cena e sim da view: o fator do slider, o reset completo, a seleção e o rótulo. */
export interface SaidasDoControle {
  /** Fator absoluto 0..1. */
  explodir(fator: number): void;
  resetar(): void;
  selecionou(peca: PecaDestacada): void;
  gesto(nome: string): void;
}

export interface Sensibilidade {
  giro: number;
  zoom: number;
  inverterX: boolean;
  inverterY: boolean;
}

/** Uma tela inteira de arrasto (ou da mão de um lado ao outro) dá uma volta. */
export const VOLTA = 2 * Math.PI;

/** Giro em radianos a partir de um deslocamento em frações da tela, com sensibilidade e eixos. */
export function giroDaTela(dx: number, dy: number, s: Sensibilidade): [number, number] {
  return [VOLTA * dx * s.giro * (s.inverterX ? -1 : 1), VOLTA * dy * s.giro * (s.inverterY ? -1 : 1)];
}

/** A sensibilidade do zoom é expoente: 2 dobra o efeito em escala logarítmica, 0.5 corta pela metade. */
export function zoomComSensibilidade(fator: number, s: Sensibilidade): number {
  return fator ** s.zoom;
}

/**
 * Leva os eventos do `MotorDeGestos` às chamadas da cena. É o único lugar que conhece os dois —
 * o motor não sabe o que é uma cena, e a cena não sabe o que é uma mão.
 */
export class ControlePorGestos {
  constructor(
    private readonly alvo: AlvoDoControle,
    private readonly saidas: SaidasDoControle,
    private readonly sensibilidade: () => Sensibilidade,
  ) {}

  aplicar(eventos: readonly EventoDeGesto[]): void {
    for (const e of eventos) this.aplicarUm(e);
  }

  private aplicarUm(e: EventoDeGesto): void {
    const s = this.sensibilidade();
    switch (e.tipo) {
      case 'maoPresente':
        this.alvo.segurarAutoRotacao(true);
        break;
      case 'autoRotacao':
        this.alvo.segurarAutoRotacao(false);
        break;
      case 'girar':
        this.alvo.girar(...giroDaTela(e.dx, e.dy, s));
        break;
      case 'soltarGiro':
        this.alvo.lancarGiro(...giroDaTela(e.vx, e.vy, s));
        break;
      case 'zoom':
        this.alvo.aproximar(zoomComSensibilidade(e.fator, s));
        break;
      case 'explosao':
      case 'explosaoFim':
        this.saidas.explodir(e.fator);
        break;
      case 'cursor':
        this.alvo.apontar({ x: e.x * 2 - 1, y: 1 - e.y * 2 });
        break;
      case 'cursorFim':
        this.alvo.apontar(null);
        break;
      case 'apontarParado': {
        const peca = this.alvo.selecionarEm({ x: e.x * 2 - 1, y: 1 - e.y * 2 });
        if (peca) this.saidas.selecionou(peca);
        break;
      }
      case 'resetar':
        this.saidas.resetar();
        break;
      case 'gesto':
        this.saidas.gesto(e.nome);
        break;
      case 'explosaoInicio':
        break;
    }
  }
}
