/**
 * O que entra e o que sai do motor de gestos. TypeScript puro: nada de Angular nem de Three.js,
 * para o mesmo motor servir à cena do holograma e a quem vier depois (Fase 5B).
 */

/** Um landmark do MediaPipe: `x` e `y` em 0..1 da largura e da altura do quadro; `z` na escala de `x`. */
export type Ponto = readonly [x: number, y: number, z: number];

export interface MaoDetectada {
  /** O `categoryName` do MediaPipe. Só serve de chave para seguir a mesma mão entre quadros. */
  lado: string;
  /** Os 21 pontos, na ordem do MediaPipe (0 pulso, 4 ponta do polegar, 8 ponta do indicador…). */
  pontos: readonly Ponto[];
}

export interface QuadroDeMaos {
  /** Instante do quadro em ms. O motor não lê relógio nenhum: o tempo é só este. */
  t: number;
  /** Largura ÷ altura do quadro, para as distâncias não saírem achatadas. Padrão 4/3. */
  aspecto?: number;
  maos: readonly MaoDetectada[];
}

export type PoseDaMao = 'nenhuma' | 'outra' | 'aberta' | 'punho' | 'apontar' | 'pinca';

/**
 * O que o motor viu. Coordenadas de tela (`x`, `y`) em 0..1, já espelhadas quando `espelhar` está
 * ligado: mão para a direita do dono → `x` cresce. Velocidades em unidades de tela por segundo.
 */
export type EventoDeGesto =
  | { tipo: 'maoPresente' }
  | { tipo: 'autoRotacao' }
  | { tipo: 'girar'; dx: number; dy: number }
  | { tipo: 'soltarGiro'; vx: number; vy: number }
  /** `fator` > 1 aproxima (as mãos se afastaram ou a mão chegou perto da câmera). */
  | { tipo: 'zoom'; fator: number }
  | { tipo: 'explosaoInicio' }
  | { tipo: 'explosao'; fator: number }
  | { tipo: 'explosaoFim'; fator: number }
  | { tipo: 'cursor'; x: number; y: number }
  | { tipo: 'cursorFim' }
  /** O indicador ficou parado no mesmo lugar: quem conhece a cena decide o que há ali. */
  | { tipo: 'apontarParado'; x: number; y: number }
  | { tipo: 'resetar' }
  /** O rótulo do gesto atual mudou (para o preview). */
  | { tipo: 'gesto'; nome: string };

export interface OpcoesDoMotor {
  /** 1 no perfil leve, 2 no PC. Mãos além disso são ignoradas. */
  maosMax: number;
  /** Perfil de uma mão: pinça + aproximar/afastar a mão da câmera dá zoom. */
  zoomPorProfundidade: boolean;
  /** Câmera frontal: inverte `x` para a mão e a tela andarem para o mesmo lado. */
  espelhar: boolean;
  /** Distância polegar–indicador ÷ tamanho da mão para entrar na pinça. */
  pincaEntra: number;
  /** …e para sair dela (histerese). */
  pincaSai: number;
  /** Uma pose só vale depois de durar isso. */
  estavelMs: number;
  /** Mão aberta parada por isso entra no modo explosão. */
  explosaoMs: number;
  /** Indicador parado por isso seleciona. */
  apontarMs: number;
  /** Punho por isso (fora da explosão) reseta a vista. */
  resetarMs: number;
  /** Sem mão por isso devolve a rotação automática. */
  autoRotacaoMs: number;
  /** Quadros sem a mão antes de a dar por perdida. */
  perderMaoMs: number;
  /** No modo explosão a perda tolera mais: a mão aberta some e volta com facilidade. */
  perderMaoNaExplosaoMs: number;
  /** A trava do punho usa o fator de antes de a mão começar a fechar. */
  recuoDaTravaMs: number;
  /** Raio (em tela) em que o indicador conta como parado. */
  raioParado: number;
  /** Translação (em tela) que decide pinça → giro no perfil leve. */
  decidirGiro: number;
  /** |Δ ln tamanho| que decide pinça → zoom no perfil leve. */
  decidirZoom: number;
  /** Palma "parada": velocidade abaixo disso, em tamanhos de mão por segundo. */
  velocidadeParada: number;
  /** Fração central do quadro que vira a tela inteira para o cursor. */
  zonaAtiva: number;
  /** Parâmetros do filtro One Euro. */
  filtro: { minCutoff: number; beta: number; dCutoff: number };
}

export const OPCOES_PADRAO_DO_MOTOR: OpcoesDoMotor = {
  maosMax: 2,
  zoomPorProfundidade: false,
  espelhar: true,
  pincaEntra: 0.05,
  pincaSai: 0.08,
  estavelMs: 150,
  explosaoMs: 600,
  apontarMs: 800,
  resetarMs: 1_200,
  autoRotacaoMs: 3_000,
  perderMaoMs: 200,
  perderMaoNaExplosaoMs: 1_000,
  recuoDaTravaMs: 300,
  raioParado: 0.02,
  decidirGiro: 0.03,
  decidirZoom: 0.12,
  velocidadeParada: 0.25,
  zonaAtiva: 0.7,
  // O beta 0.007 do artigo é para pixels; em coordenadas 0..1 (≈ 480 px por unidade) o mesmo
  // efeito pede ~3. Com 5 a mão parada fica lisa e o arrasto não arrasta atrás.
  filtro: { minCutoff: 1, beta: 5, dCutoff: 1 },
};

/** O arquivo do "Gravar 5 s": só landmarks, nunca imagem. É o fixture dos testes do motor. */
export interface GravacaoDeGestos {
  versao: 1;
  perfil: string;
  deteccoesPorSegundo: number;
  /** ISO 8601. */
  data: string;
  quadros: QuadroDeMaos[];
}

/** Confere um JSON de gravação antes de reproduzi-lo; `null` quando não é uma. */
export function lerGravacaoDeGestos(bruto: unknown): GravacaoDeGestos | null {
  if (typeof bruto !== 'object' || bruto === null) return null;
  const g = bruto as Record<string, unknown>;
  if (g['versao'] !== 1 || !Array.isArray(g['quadros'])) return null;
  const quadros: QuadroDeMaos[] = [];
  for (const q of g['quadros'] as unknown[]) {
    if (typeof q !== 'object' || q === null) return null;
    const { t, aspecto, maos } = q as Record<string, unknown>;
    if (typeof t !== 'number' || !Array.isArray(maos)) return null;
    const lidas: MaoDetectada[] = [];
    for (const m of maos as unknown[]) {
      const { lado, pontos } = (m ?? {}) as Record<string, unknown>;
      if (typeof lado !== 'string' || !Array.isArray(pontos) || pontos.length !== 21) return null;
      if (!pontos.every((p) => Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number'))) return null;
      lidas.push({ lado, pontos: pontos as Ponto[] });
    }
    quadros.push({ t, aspecto: typeof aspecto === 'number' ? aspecto : undefined, maos: lidas });
  }
  return {
    versao: 1,
    perfil: typeof g['perfil'] === 'string' ? g['perfil'] : '',
    deteccoesPorSegundo: typeof g['deteccoesPorSegundo'] === 'number' ? g['deteccoesPorSegundo'] : 0,
    data: typeof g['data'] === 'string' ? g['data'] : '',
    quadros,
  };
}
