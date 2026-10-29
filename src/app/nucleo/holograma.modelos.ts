import { objeto } from './tela.modelos';

/** As formas que o `HologramaValidator` do Java deixa passar; qualquer outra é descartada aqui. */
export const FORMAS_HOLOGRAMA = ['box', 'sph', 'cyl', 'cone', 'tor', 'ring', 'cap', 'tube', 'line', 'helix'] as const;
export type FormaHolograma = (typeof FORMAS_HOLOGRAMA)[number];

/** Os níveis de `GET /api/holograma/gerar?detalhe=`: o servidor recusa qualquer outro. */
export const DETALHES_HOLOGRAMA = [
  { valor: 'rapido', rotulo: 'Rápido' },
  { valor: 'normal', rotulo: 'Normal' },
  { valor: 'detalhado', rotulo: 'Detalhado' },
] as const;
export type DetalheHolograma = (typeof DETALHES_HOLOGRAMA)[number]['valor'];

/** O mesmo teto do `PromptDeHolograma.MAX_OBJETO`: acima disso o servidor responde 400. */
export const MAX_OBJETO_HOLOGRAMA = 120;

/** Os exemplos de `GET /api/holograma/exemplo/{nome}`: objetos prontos, sem gastar modelo. */
export const EXEMPLOS_HOLOGRAMA = [
  { nome: 'motor_v8', rotulo: 'Motor V8' },
  { nome: 'dna', rotulo: 'DNA' },
  { nome: 'atomo', rotulo: 'Átomo' },
] as const;
export type NomeExemplo = (typeof EXEMPLOS_HOLOGRAMA)[number]['nome'];

export type Vetor3 = readonly [number, number, number];

export interface MetaHolograma {
  nome: string;
  categoria: string;
  descricao: string;
}

/** Uma peça pronta para desenhar, como sai da `MontagemDeHolograma` (`docs/HOLOGRAMA.md` §7). */
export interface PecaHolograma {
  id: string;
  nome: string;
  grupo: string;
  forma: FormaHolograma;
  posicao: Vetor3;
  /** Graus, Euler XYZ. */
  rotacao: Vetor3;
  tamanho: readonly number[];
  cor: string;
  /** Direção da vista explodida; `null` quando não veio, e a cena usa a posição em relação ao centro. */
  explosao: Vetor3 | null;
  opacidade: number;
  contorno: boolean;
  /** Só em `tube` e `line`, relativos à posição. */
  pontos: readonly Vetor3[] | null;
}

export interface FimHolograma {
  pecas: number;
  avisos: number;
  /** Quem gerou: só nas gerações reais (o exemplo fixo não informa). */
  provedor?: 'anthropic' | 'local';
  modelo?: string;
  /** Ausentes quando a API não informou o uso (stream cortado) ou o gerador foi o local. */
  tokensEntrada?: number;
  tokensSaida?: number;
  custoUsd?: number;
}

/** Os geradores de `GET /api/holograma/gerar?provedor=`: o servidor recusa qualquer outro. */
export const GERADORES_HOLOGRAMA = [
  { valor: 'haiku', rotulo: 'Haiku' },
  { valor: 'local', rotulo: 'Local' },
] as const;
export type GeradorHolograma = (typeof GERADORES_HOLOGRAMA)[number]['valor'];
export const GERADOR_PADRAO_HOLOGRAMA: GeradorHolograma = 'haiku';

export function lerGeradorHolograma(v: unknown): GeradorHolograma | null {
  return GERADORES_HOLOGRAMA.find((g) => g.valor === v)?.valor ?? null;
}

/** O selo discreto do fim da montagem: "Haiku · 86 peças · US$0,002". Sem custo, sem o último trecho. */
export function seloDoHolograma(fim: FimHolograma): string {
  const gerador = fim.provedor === 'local' ? 'Local' : fim.modelo?.toLowerCase().includes('haiku') ? 'Haiku' : 'Claude';
  const partes = [gerador, `${fim.pecas} ${fim.pecas === 1 ? 'peça' : 'peças'}`];
  if (fim.custoUsd !== undefined) partes.push(formatarDolar(fim.custoUsd));
  return partes.join(' · ');
}

function formatarDolar(valor: number): string {
  if (valor > 0 && valor < 0.0005) return '<US$0,001';
  return `US$${valor.toFixed(3).replace('.', ',')}`;
}

/** Quantos números cada forma pede em `tamanho` — a aridade do prompt. */
const ARIDADE: Record<FormaHolograma, number> = {
  box: 3, sph: 1, cyl: 3, cone: 2, tor: 2, ring: 2, cap: 2, tube: 1, line: 0, helix: 4,
};

function finito(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function vetor(v: unknown): Vetor3 | null {
  return Array.isArray(v) && v.length === 3 && v.every(finito) ? [v[0], v[1], v[2]] : null;
}

function texto(v: unknown, maximo: number): string {
  return typeof v === 'string' ? v.trim().slice(0, maximo) : '';
}

export function lerMetaHolograma(v: unknown): MetaHolograma | null {
  if (!objeto(v)) return null;
  const nome = texto(v['nome'], 80);
  return nome ? { nome, categoria: texto(v['categoria'], 40), descricao: texto(v['descricao'], 200) } : null;
}

/**
 * Revalida a peça que o servidor já validou: o texto do modelo não chega ao Three.js sem passar
 * por aqui, e um número torto viraria `NaN` na matriz da malha.
 */
export function lerPecaHolograma(v: unknown): PecaHolograma | null {
  if (!objeto(v)) return null;
  const forma = FORMAS_HOLOGRAMA.find((f) => f === v['forma']);
  const posicao = vetor(v['posicao']);
  const rotacao = vetor(v['rotacao']);
  const tamanho = v['tamanho'];
  const id = texto(v['id'], 40);
  if (!forma || !posicao || !rotacao || !id) return null;
  if (!Array.isArray(tamanho) || tamanho.length !== ARIDADE[forma] || !tamanho.every((n) => finito(n) && n > 0)) return null;
  const cor = typeof v['cor'] === 'string' && /^#[0-9a-f]{6}$/i.test(v['cor']) ? v['cor'] : '#38bdf8';
  let pontos: Vetor3[] | null = null;
  if (forma === 'tube' || forma === 'line') {
    const lista = Array.isArray(v['pontos']) ? v['pontos'].map(vetor) : [];
    if (lista.length < 2 || lista.length > 32 || lista.some((p) => p === null)) return null;
    pontos = lista as Vetor3[];
  }
  const explosao = vetor(v['explosao']);
  const opacidade = finito(v['opacidade']) ? Math.min(1, Math.max(0.05, v['opacidade'])) : 1;
  return {
    id,
    nome: texto(v['nome'], 60) || id,
    grupo: texto(v['grupo'], 40) || 'geral',
    forma,
    posicao,
    rotacao,
    tamanho,
    cor,
    explosao: explosao && Math.hypot(...explosao) > 1e-6 ? explosao : null,
    opacidade,
    contorno: v['contorno'] !== false,
    pontos,
  };
}

export function lerFimHolograma(v: unknown): FimHolograma | null {
  if (!objeto(v) || !Number.isInteger(v['pecas']) || !Number.isInteger(v['avisos'])) return null;
  const fim: FimHolograma = { pecas: v['pecas'] as number, avisos: v['avisos'] as number };
  // O resumo é opcional e cada campo se confere sozinho: servidor velho não manda nenhum.
  if (v['provedor'] === 'anthropic' || v['provedor'] === 'local') fim.provedor = v['provedor'];
  if (typeof v['modelo'] === 'string') fim.modelo = v['modelo'].slice(0, 80);
  if (numeroNaoNegativo(v['tokensEntrada'])) fim.tokensEntrada = v['tokensEntrada'];
  if (numeroNaoNegativo(v['tokensSaida'])) fim.tokensSaida = v['tokensSaida'];
  if (numeroNaoNegativo(v['custoUsd'])) fim.custoUsd = v['custoUsd'];
  return fim;
}

function numeroNaoNegativo(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** O `aviso` diz que o gerador trocou (Haiku ↔ local)? É o servidor que marca, não o texto. */
export function avisoEhTroca(v: unknown): boolean {
  return objeto(v) && v['troca'] === true;
}

export function lerAvisoHolograma(v: unknown): string | null {
  return objeto(v) && typeof v['texto'] === 'string' ? v['texto'].slice(0, 200) : null;
}

/** O `erro` da geração: o texto é fixo no servidor, e chega sempre antes do `fim`. */
export function lerErroHolograma(v: unknown): string | null {
  const texto = lerAvisoHolograma(v)?.trim();
  return texto ? texto : null;
}
