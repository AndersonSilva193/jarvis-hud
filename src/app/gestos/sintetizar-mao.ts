import type { MaoDetectada, Ponto, QuadroDeMaos } from './gestos.modelos';

/**
 * Mãos de mentira para os testes do motor: um esqueleto em centímetros, com a flexão de cada dedo,
 * projetado como o MediaPipe entregaria (0..1 da largura e da altura, `z` na escala de `x`).
 *
 * O dedo dobra em direção à câmera (`z` negativo), como uma mão com a palma virada para ela.
 */

export interface PoseSintetica {
  /** Indicador, médio, anelar e mínimo: 0 estendido, 1 punho. */
  flexao: readonly [number, number, number, number];
  polegar: 'aberto' | 'dobrado' | 'pinca';
  /** Só com `polegar: 'pinca'`: o vão entre as pontas do polegar e do indicador, em cm. */
  folga?: number;
}

export const POSES = {
  aberta: { flexao: [0, 0, 0, 0], polegar: 'aberto' },
  punho: { flexao: [1, 1, 1, 1], polegar: 'dobrado' },
  apontar: { flexao: [0, 1, 1, 1], polegar: 'dobrado' },
  pinca: { flexao: [0.5, 0, 0, 0], polegar: 'pinca', folga: 0.4 },
  pincaSolta: { flexao: [0.5, 0, 0, 0], polegar: 'pinca', folga: 3 },
  meiaAberta: { flexao: [0.5, 0.5, 0.5, 0.5], polegar: 'aberto' },
} satisfies Record<string, PoseSintetica>;

export interface Lugar {
  /** O pulso, em 0..1 do quadro. */
  x: number;
  y: number;
  /** Alturas de quadro por cm: ~1/58 com a mão a meio metro de uma webcam comum. */
  escala: number;
}

export const LUGAR_PADRAO: Lugar = { x: 0.5, y: 0.75, escala: 1 / 58 };

type Vec = [number, number, number];

const DEDOS: readonly { mcp: Vec; ossos: Vec; abertura: number }[] = [
  { mcp: [-2.3, 8.5, 0], ossos: [4.3, 2.5, 2.0], abertura: -0.12 },
  { mcp: [-0.6, 9.0, 0], ossos: [4.8, 2.9, 2.1], abertura: -0.03 },
  { mcp: [1.1, 8.6, 0], ossos: [4.4, 2.8, 2.0], abertura: 0.06 },
  { mcp: [2.6, 7.6, 0], ossos: [3.4, 2.1, 1.8], abertura: 0.15 },
];
/** Graus de MCP, PIP e DIP com a flexão em 1. */
const JUNTAS = [80, 100, 70];
const CMC: Vec = [-1.8, 2.3, -0.5];
const POLEGAR_ABERTO: Vec[] = [[-3.6, 4.4, -1.0], [-4.9, 6.0, -1.3], [-5.9, 7.4, -1.5]];
const POLEGAR_DOBRADO: Vec[] = [[-2.6, 4.0, -1.5], [-1.6, 5.2, -2.5], [-0.4, 5.8, -3.0]];

/** Os 21 pontos de uma mão na pose e no lugar pedidos. */
export function sintetizarMao(pose: PoseSintetica, lugar: Lugar = LUGAR_PADRAO, aspecto = 4 / 3): Ponto[] {
  const cm: Vec[] = Array.from({ length: 21 }, (): Vec => [0, 0, 0]);
  DEDOS.forEach((dedo, i) => {
    const base = 5 + i * 4;
    let atual: Vec = [...dedo.mcp];
    cm[base] = atual;
    let angulo = 0;
    for (let k = 0; k < 3; k++) {
      angulo += ((JUNTAS[k]! * pose.flexao[i]!) * Math.PI) / 180;
      const direcao: Vec = [
        Math.sin(dedo.abertura) * Math.cos(angulo),
        Math.cos(dedo.abertura) * Math.cos(angulo),
        -Math.sin(angulo),
      ];
      atual = [atual[0] + direcao[0] * dedo.ossos[k]!, atual[1] + direcao[1] * dedo.ossos[k]!, atual[2] + direcao[2] * dedo.ossos[k]!];
      cm[base + k + 1] = atual;
    }
  });
  cm[1] = CMC;
  if (pose.polegar === 'pinca') {
    const indicador = cm[8]!;
    const ponta: Vec = [indicador[0] - (pose.folga ?? 0.4), indicador[1], indicador[2]];
    cm[2] = [-3.4, 4.2, -1.2];
    cm[3] = [ponta[0] - 1.2, ponta[1] - 1.2, ponta[2] + 0.3];
    cm[4] = ponta;
  } else {
    const polegar = pose.polegar === 'aberto' ? POLEGAR_ABERTO : POLEGAR_DOBRADO;
    cm[2] = polegar[0]!;
    cm[3] = polegar[1]!;
    cm[4] = polegar[2]!;
  }
  return cm.map(([x, y, z]): Ponto => [
    lugar.x + (x * lugar.escala) / aspecto,
    lugar.y - y * lugar.escala,
    (z * lugar.escala) / aspecto,
  ]);
}

/** Uma pose entre duas, pela flexão (o polegar e a folga vêm da segunda a partir da metade). */
export function entrePoses(a: PoseSintetica, b: PoseSintetica, k: number): PoseSintetica {
  const flexao = a.flexao.map((f, i) => f + (b.flexao[i]! - f) * k) as unknown as PoseSintetica['flexao'];
  const folga = (a.folga ?? 0.4) + ((b.folga ?? 0.4) - (a.folga ?? 0.4)) * k;
  return { flexao, polegar: k < 0.5 ? a.polegar : b.polegar, folga };
}

export function entreLugares(a: Lugar, b: Lugar, k: number): Lugar {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, escala: a.escala + (b.escala - a.escala) * k };
}

export interface MaoNoTrecho {
  lado?: string;
  /** Fixa, ou uma função do progresso 0..1 dentro do trecho. */
  pose: PoseSintetica | ((k: number) => PoseSintetica);
  lugar?: Lugar | ((k: number) => Lugar);
}

export interface Trecho {
  ms: number;
  /** Vazio = sem mão nenhuma nesse trecho. */
  maos: readonly MaoNoTrecho[];
}

export interface OpcoesDaFilmagem {
  fps?: number;
  aspecto?: number;
  /** Amplitude do tremor, em 0..1 do quadro, determinístico. */
  ruido?: number;
  t0?: number;
}

/** Uma sequência de quadros, trecho após trecho, como o rastreio entregaria ao motor. */
export function filmar(trechos: readonly Trecho[], opcoes: OpcoesDaFilmagem = {}): QuadroDeMaos[] {
  const { fps = 30, aspecto = 4 / 3, ruido = 0, t0 = 0 } = opcoes;
  const passo = 1000 / fps;
  const quadros: QuadroDeMaos[] = [];
  let semente = 7;
  const aleatorio = () => {
    semente = (semente * 16807) % 2147483647;
    return semente / 2147483647 - 0.5;
  };
  let t = t0;
  for (const trecho of trechos) {
    const n = Math.max(1, Math.round(trecho.ms / passo));
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 1 : i / (n - 1);
      const maos: MaoDetectada[] = trecho.maos.map((m, j) => {
        const pose = typeof m.pose === 'function' ? m.pose(k) : m.pose;
        const lugar = typeof m.lugar === 'function' ? m.lugar(k) : (m.lugar ?? LUGAR_PADRAO);
        const pontos = sintetizarMao(pose, lugar, aspecto).map(
          (p): Ponto => (ruido ? [p[0] + aleatorio() * ruido, p[1] + aleatorio() * ruido, p[2]] : p),
        );
        return { lado: m.lado ?? (j === 0 ? 'Right' : 'Left'), pontos };
      });
      quadros.push({ t: Math.round(t), aspecto, maos });
      t += passo;
    }
  }
  return quadros;
}
