import { Service, signal } from '@angular/core';

export type EscolhaDePerfil = 'auto' | 'pc' | 'leve';

export interface AjustesDeGestos {
  /** `auto` deixa o `PerfilDoAparelhoService` decidir pelo aparelho. */
  perfil: EscolhaDePerfil;
  /** Multiplica o giro de gesto e de toque. */
  sensibilidadeGiro: number;
  /** Expoente do fator de zoom: 2 dobra o efeito, 0.5 corta pela metade. */
  sensibilidadeZoom: number;
  inverterX: boolean;
  inverterY: boolean;
  /** O mini preview da câmera aparece no canto. */
  preview: boolean;
}

export const AJUSTES_PADRAO: AjustesDeGestos = {
  perfil: 'auto',
  sensibilidadeGiro: 1,
  sensibilidadeZoom: 1,
  inverterX: false,
  inverterY: false,
  preview: true,
};

export const SENSIBILIDADE_MINIMA = 0.25;
export const SENSIBILIDADE_MAXIMA = 3;

const CHAVE = 'jarvis-hud.gestos.v1';

/** O que estiver torto ou faltando volta ao padrão: um ajuste quebrado não derruba os outros. */
export function lerAjustesDeGestos(bruto: unknown): AjustesDeGestos {
  const a = typeof bruto === 'object' && bruto !== null ? (bruto as Record<string, unknown>) : {};
  const perfil = a['perfil'];
  return {
    perfil: perfil === 'pc' || perfil === 'leve' || perfil === 'auto' ? perfil : AJUSTES_PADRAO.perfil,
    sensibilidadeGiro: sensibilidade(a['sensibilidadeGiro']),
    sensibilidadeZoom: sensibilidade(a['sensibilidadeZoom']),
    inverterX: typeof a['inverterX'] === 'boolean' ? a['inverterX'] : AJUSTES_PADRAO.inverterX,
    inverterY: typeof a['inverterY'] === 'boolean' ? a['inverterY'] : AJUSTES_PADRAO.inverterY,
    preview: typeof a['preview'] === 'boolean' ? a['preview'] : AJUSTES_PADRAO.preview,
  };
}

function sensibilidade(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return 1;
  return Math.min(SENSIBILIDADE_MAXIMA, Math.max(SENSIBILIDADE_MINIMA, valor));
}

/** Perfil, sensibilidades e eixos dos gestos e do toque, lembrados neste navegador. */
@Service()
export class AjustesDeGestosService {
  readonly ajustes = signal<AjustesDeGestos>(lembrar());

  alterar(parte: Partial<AjustesDeGestos>): void {
    const novos = lerAjustesDeGestos({ ...this.ajustes(), ...parte });
    this.ajustes.set(novos);
    try {
      localStorage.setItem(CHAVE, JSON.stringify(novos));
    } catch {
      /* Sem persistência: vale até recarregar. */
    }
  }

  restaurar(): void {
    this.alterar(AJUSTES_PADRAO);
  }
}

function lembrar(): AjustesDeGestos {
  try {
    return lerAjustesDeGestos(JSON.parse(localStorage.getItem(CHAVE) ?? 'null'));
  } catch {
    return AJUSTES_PADRAO;
  }
}
