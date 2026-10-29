import type { PoseDaMao, Ponto } from './gestos.modelos';

/**
 * Medidas de uma mão a partir dos 21 pontos do MediaPipe, **já corrigidos pelo aspecto** (`x` e `z`
 * multiplicados por largura ÷ altura): assim uma distância vale o mesmo em pé e deitada.
 */

export const PULSO = 0;
export const POLEGAR_IP = 3;
export const POLEGAR_PONTA = 4;
export const INDICADOR_MCP = 5;
export const INDICADOR_PIP = 6;
export const INDICADOR_PONTA = 8;
export const MEDIO_MCP = 9;
export const MINIMO_MCP = 17;

/** MCP, PIP e ponta de indicador, médio, anelar e mínimo. */
const DEDOS = [
  { mcp: 5, pip: 6, ponta: 8 },
  { mcp: 9, pip: 10, ponta: 12 },
  { mcp: 13, pip: 14, ponta: 16 },
  { mcp: 17, pip: 18, ponta: 20 },
] as const;

/** Ponta mais longe do pulso que a PIP por essa razão: dedo estendido. */
const ESTENDIDO = 1.15;
/** Ponta do polegar longe do MCP do mínimo (÷ largura da palma): polegar aberto. */
const POLEGAR_ABERTO = 1.25;
/** A razão ponta÷MCP (até o pulso) de um dedo fechado e de um estendido: a abertura 0..1 entre elas. */
const ABERTURA_FECHADA = 1.05;
const ABERTURA_ABERTA = 1.75;

export function distancia(a: Ponto, b: Ponto): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * O comprimento da mão: pulso → MCP do médio → ponta do médio, somando os segmentos. É a medida
 * antropométrica de "tamanho da mão" e, por somar ossos, quase não muda quando os dedos dobram.
 * Com ela, polegar e indicador encostados dão ≈ 0.03–0.05.
 */
export function tamanhoDaMao(p: readonly Ponto[]): number {
  return distancia(p[0]!, p[9]!) + distancia(p[9]!, p[10]!) + distancia(p[10]!, p[11]!) + distancia(p[11]!, p[12]!);
}

export function distanciaDaPinca(p: readonly Ponto[], tamanho: number): number {
  return tamanho > 0 ? distancia(p[POLEGAR_PONTA]!, p[INDICADOR_PONTA]!) / tamanho : Infinity;
}

export function centroDaPalma(p: readonly Ponto[]): Ponto {
  const indices = [PULSO, INDICADOR_MCP, MEDIO_MCP, 13, MINIMO_MCP];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of indices) {
    x += p[i]![0];
    y += p[i]![1];
    z += p[i]![2];
  }
  return [x / indices.length, y / indices.length, z / indices.length];
}

interface EstadoDosDedos {
  /** Indicador, médio, anelar e mínimo. */
  estendidos: readonly boolean[];
  dobrados: readonly boolean[];
  polegarAberto: boolean;
}

export function dedos(p: readonly Ponto[]): EstadoDosDedos {
  const pulso = p[PULSO]!;
  const estendidos: boolean[] = [];
  const dobrados: boolean[] = [];
  for (const d of DEDOS) {
    const ponta = distancia(p[d.ponta]!, pulso);
    const pip = distancia(p[d.pip]!, pulso);
    estendidos.push(ponta > pip * ESTENDIDO);
    dobrados.push(ponta < pip);
  }
  const larguraDaPalma = distancia(p[INDICADOR_MCP]!, p[MINIMO_MCP]!);
  const polegarAberto = larguraDaPalma > 0 && distancia(p[POLEGAR_PONTA]!, p[MINIMO_MCP]!) / larguraDaPalma > POLEGAR_ABERTO;
  return { estendidos, dobrados, polegarAberto };
}

/** 0 = punho, 1 = dedos todos estendidos. É o que controla o fator no modo explosão. */
export function aberturaDaMao(p: readonly Ponto[]): number {
  const pulso = p[PULSO]!;
  let soma = 0;
  for (const d of DEDOS) {
    const mcp = distancia(p[d.mcp]!, pulso);
    soma += mcp > 0 ? distancia(p[d.ponta]!, pulso) / mcp : 0;
  }
  const razao = soma / DEDOS.length;
  return Math.min(1, Math.max(0, (razao - ABERTURA_FECHADA) / (ABERTURA_ABERTA - ABERTURA_FECHADA)));
}

/**
 * A pose deste quadro, na ordem de prioridade punho > pinça > apontar > aberta > outra.
 * `pincando` é o estado da histerese, que quem chama mantém de um quadro para o outro.
 */
export function classificarPose(p: readonly Ponto[], pincando: boolean): PoseDaMao {
  const { estendidos, dobrados, polegarAberto } = dedos(p);
  if (dobrados.every(Boolean)) return 'punho';
  // Punho vem antes: no punho o polegar deita sobre o indicador e as pontas ficam perto.
  if (pincando) return 'pinca';
  if (estendidos[0] && dobrados[1] && dobrados[2] && dobrados[3]) return 'apontar';
  if (estendidos.every(Boolean) && polegarAberto) return 'aberta';
  return 'outra';
}
