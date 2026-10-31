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

export type Vetor3 = readonly [number, number, number];

export interface MetaHolograma {
  nome: string;
  categoria: string;
  descricao: string;
  /** O id da geração ou do item da galeria: é o que o `Continuar` e a miniatura devolvem ao servidor. */
  id?: string;
}

/**
 * Os ids que o servidor usa: o da geração (`h` + 8, `HologramaService.idValido`) e o dos exemplos
 * fixos da galeria (`exemplo_dna`) — o mesmo `GaleriaDeHologramas.idValido`.
 */
const ID_GERACAO = /^[a-z0-9_]{1,40}$/;

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
  /**
   * O id da primeira cópia, igual em todas as cópias de um mesmo `rep`/`rad`; ausente na peça escrita
   * uma vez só. Num objeto grande a cena desenha a série inteira numa chamada só à GPU.
   */
  serie?: string;
}

export interface FimHolograma {
  pecas: number;
  avisos: number;
  /** `incompleto`: o servidor fechou antes da linha de fim do modelo (teto, prazo, falha). */
  status: 'completo' | 'incompleto';
  /** Por que ficou incompleto; frase fixa do servidor. */
  motivo?: string;
  id?: string;
  /** Quem gerou: só nas gerações reais (o exemplo fixo não informa). */
  provedor?: 'anthropic' | 'local';
  modelo?: string;
  /** Ausentes quando a API não informou o uso (stream cortado) ou o gerador foi o local. */
  tokensEntrada?: number;
  tokensSaida?: number;
  custoUsd?: number;
  /** `cache`: veio da galeria, sem gastar modelo. */
  origem?: 'modelo' | 'cache';
  /** O objeto está na galeria; `miniatura` diz se ela já tem a imagem, e falsa pede a captura. */
  salvo?: boolean;
  miniatura?: boolean;
}

/** Uma linha de `GET /api/holograma/galeria`. */
export interface ItemGaleria {
  id: string;
  nome: string;
  pecas: number;
  /** ISO-8601; vazio nos exemplos fixos. */
  data: string;
  provedor: string;
  detalhe: DetalheHolograma;
  /** O pedido como foi feito: é o que o "Gerar de novo" repete. */
  objeto: string;
  /** Exemplo escrito à mão: não se apaga. */
  fixo: boolean;
  miniatura: boolean;
}

export function lerItemGaleria(v: unknown): ItemGaleria | null {
  if (!objeto(v) || typeof v['id'] !== 'string' || !ID_GERACAO.test(v['id'])) return null;
  const nome = texto(v['nome'], 80);
  if (!nome || !Number.isInteger(v['pecas'])) return null;
  const detalhe = DETALHES_HOLOGRAMA.find((d) => d.valor === v['detalhe'])?.valor ?? 'normal';
  return {
    id: v['id'],
    nome,
    pecas: v['pecas'] as number,
    data: texto(v['data'], 40),
    provedor: texto(v['provedor'], 20),
    detalhe,
    objeto: texto(v['objeto'], MAX_OBJETO_HOLOGRAMA) || nome.slice(0, MAX_OBJETO_HOLOGRAMA),
    fixo: v['fixo'] === true,
    miniatura: v['miniatura'] === true,
  };
}

/** "Haiku · 86 peças" — a linha de baixo de um item da galeria. */
export function legendaDoItem(item: ItemGaleria): string {
  const gerador = item.fixo ? 'Exemplo' : item.provedor === 'local' ? 'Local' : 'Haiku';
  return `${gerador} · ${item.pecas} ${item.pecas === 1 ? 'peça' : 'peças'}`;
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
  if (!nome) return null;
  const meta: MetaHolograma = { nome, categoria: texto(v['categoria'], 40), descricao: texto(v['descricao'], 200) };
  if (typeof v['id'] === 'string' && ID_GERACAO.test(v['id'])) meta.id = v['id'];
  return meta;
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
    ...(typeof v['serie'] === 'string' && ID_GERACAO.test(v['serie']) ? { serie: v['serie'] } : {}),
  };
}

export function lerFimHolograma(v: unknown): FimHolograma | null {
  if (!objeto(v) || !Number.isInteger(v['pecas']) || !Number.isInteger(v['avisos'])) return null;
  // Servidor velho não manda `status`: o fim dele era sempre o do objeto inteiro.
  const fim: FimHolograma = {
    pecas: v['pecas'] as number,
    avisos: v['avisos'] as number,
    status: v['status'] === 'incompleto' ? 'incompleto' : 'completo',
  };
  if (fim.status === 'incompleto') {
    const motivo = texto(v['motivo'], 120);
    if (motivo) fim.motivo = motivo;
  }
  if (typeof v['id'] === 'string' && ID_GERACAO.test(v['id'])) fim.id = v['id'];
  // O resumo é opcional e cada campo se confere sozinho: servidor velho não manda nenhum.
  if (v['provedor'] === 'anthropic' || v['provedor'] === 'local') fim.provedor = v['provedor'];
  if (typeof v['modelo'] === 'string') fim.modelo = v['modelo'].slice(0, 80);
  if (numeroNaoNegativo(v['tokensEntrada'])) fim.tokensEntrada = v['tokensEntrada'];
  if (numeroNaoNegativo(v['tokensSaida'])) fim.tokensSaida = v['tokensSaida'];
  if (numeroNaoNegativo(v['custoUsd'])) fim.custoUsd = v['custoUsd'];
  if (v['origem'] === 'modelo' || v['origem'] === 'cache') fim.origem = v['origem'];
  if (v['salvo'] === true) {
    fim.salvo = true;
    fim.miniatura = v['miniatura'] === true;
  }
  return fim;
}

function numeroNaoNegativo(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** "Incompleto: o modelo bateu no teto de tokens" — o motivo do servidor em minúscula e sem ponto. */
export function textoIncompleto(motivo: string | undefined): string {
  const limpo = (motivo ?? '').trim().replace(/\.$/, '');
  return limpo ? `Incompleto: ${limpo.charAt(0).toLowerCase()}${limpo.slice(1)}` : 'Incompleto';
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

// ---------------------------------------------------------------------------------------------
// Fase 6: a cena comandada pela conversa (`holograma.comando` no SSE geral).
// ---------------------------------------------------------------------------------------------

export const VISTAS_HOLOGRAMA = ['frente', 'lado', 'cima', 'isometrica'] as const;
export type VistaHolograma = (typeof VISTAS_HOLOGRAMA)[number];
export type EixoHolograma = 'x' | 'y' | 'z';

/** Peças e grupos por id, como o servidor os resolveu. A HUD nunca interpreta o texto do alvo. */
export interface AlvoDoFiltro {
  grupos: readonly string[];
  pecas: readonly string[];
}

export interface FiltrosDoHolograma {
  destacados: AlvoDoFiltro;
  isolados: AlvoDoFiltro;
  escondidos: AlvoDoFiltro;
}

export const ALVO_VAZIO: AlvoDoFiltro = { grupos: [], pecas: [] };
export const SEM_FILTROS: FiltrosDoHolograma = { destacados: ALVO_VAZIO, isolados: ALVO_VAZIO, escondidos: ALVO_VAZIO };

/** O filtro vale para a peça? Vazio não vale para nenhuma. */
export function noFiltro(alvo: AlvoDoFiltro, peca: Pick<PecaHolograma, 'id' | 'grupo'>): boolean {
  return alvo.grupos.includes(peca.grupo) || alvo.pecas.includes(peca.id);
}

export function filtroVazio(alvo: AlvoDoFiltro): boolean {
  return alvo.grupos.length === 0 && alvo.pecas.length === 0;
}

/** A peça escolhida: por gesto, toque ou voz. O `id` falta só na seleção antiga por grupo. */
export interface PecaSelecionada {
  id?: string;
  nome: string;
  grupo: string;
}

/** Uma ordem do Jarvis para a cena. `rapido`: veio sem modelo, e a confirmação é um som. */
export type ComandoHolograma = { rapido: boolean } & (
  | { acao: 'abrir' | 'fechar' | 'parar' | 'mostrar_tudo' | 'resetar' | 'cancelar_geracao' }
  | { acao: 'carregar'; objeto: string; detalhe: DetalheHolograma; novo: boolean; provedor?: GeradorHolograma; falaPronto: string }
  /** O objeto já está na galeria (o servidor procurou antes): abre pelo id, sem modelo. */
  | { acao: 'abrir_galeria'; id: string; nome: string }
  | { acao: 'explodir'; fator: number }
  | { acao: 'girar'; eixo: EixoHolograma; graus: number }
  | { acao: 'girar_continuo'; ligar: boolean; velocidade: number }
  | { acao: 'zoom'; fator: number }
  | { acao: 'vista'; vista: VistaHolograma }
  | { acao: 'destacar' | 'isolar' | 'esconder'; alvo: AlvoDoFiltro }
  | { acao: 'selecionar'; peca: string }
);

const SEM_COMPLEMENTO = ['abrir', 'fechar', 'parar', 'mostrar_tudo', 'resetar', 'cancelar_geracao'] as const;
const MAX_ALVOS = 250;

function ids(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_ALVOS) return null;
  return v.every((id) => typeof id === 'string' && ID_GERACAO.test(id)) ? (v as string[]) : null;
}

/**
 * Confere o `holograma.comando` campo a campo. Ação desconhecida (servidor mais novo) ou número fora
 * da faixa voltam `null`, e o evento é ignorado como qualquer outro que esta HUD não entende.
 */
export function lerComandoHolograma(v: unknown): ComandoHolograma | null {
  if (!objeto(v) || typeof v['acao'] !== 'string') return null;
  const dados: Record<string, unknown> = objeto(v['dados']) ? v['dados'] : {};
  const rapido = v['rapido'] === true;
  const acao = v['acao'];
  if ((SEM_COMPLEMENTO as readonly string[]).includes(acao)) {
    return { acao: acao as (typeof SEM_COMPLEMENTO)[number], rapido };
  }
  switch (acao) {
    case 'carregar': {
      const alvo = texto(dados['objeto'], MAX_OBJETO_HOLOGRAMA);
      if (!alvo) return null;
      const detalhe = DETALHES_HOLOGRAMA.find((d) => d.valor === dados['detalhe'])?.valor ?? 'normal';
      const comando: ComandoHolograma = {
        acao, rapido, objeto: alvo, detalhe, novo: dados['novo'] === true, falaPronto: texto(dados['falaPronto'], 80),
      };
      const provedor = lerGeradorHolograma(dados['provedor']);
      if (provedor) comando.provedor = provedor;
      return comando;
    }
    case 'abrir_galeria': {
      const id = dados['id'];
      return typeof id === 'string' && ID_GERACAO.test(id) ? { acao, rapido, id, nome: texto(dados['nome'], 80) } : null;
    }
    case 'explodir':
    case 'zoom': {
      const fator = dados['fator'];
      const [minimo, maximo] = acao === 'explodir' ? [0, 1] : [0.25, 4];
      return finito(fator) && fator >= minimo && fator <= maximo ? { acao, rapido, fator } : null;
    }
    case 'girar': {
      const graus = dados['graus'];
      const eixo = dados['eixo'];
      if (!finito(graus) || Math.abs(graus) > 720 || (eixo !== 'x' && eixo !== 'y' && eixo !== 'z')) return null;
      return { acao, rapido, eixo, graus };
    }
    case 'girar_continuo': {
      const bruta = dados['velocidade'];
      const velocidade = finito(bruta) ? Math.min(5, Math.max(0.1, bruta)) : 1;
      return { acao, rapido, ligar: dados['ligar'] !== false, velocidade };
    }
    case 'vista': {
      const vista = VISTAS_HOLOGRAMA.find((nome) => nome === dados['vista']);
      return vista ? { acao, rapido, vista } : null;
    }
    case 'destacar':
    case 'isolar':
    case 'esconder': {
      const grupos = ids(dados['grupos'] ?? []);
      const pecas = ids(dados['pecas'] ?? []);
      return grupos && pecas ? { acao, rapido, alvo: { grupos, pecas } } : null;
    }
    case 'selecionar': {
      const peca = dados['peca'];
      return typeof peca === 'string' && ID_GERACAO.test(peca) ? { acao, rapido, peca } : null;
    }
    default:
      return null;
  }
}

/** O que a HUD conta ao servidor no `POST /api/holograma/estado` (ver `EstadoDoHologramaDto`). */
export interface EstadoDoHolograma {
  aberto: boolean;
  objeto?: { id: string; nome: string };
  gerando?: boolean;
  pecas?: { id: string; nome: string; grupo: string }[];
  explosao?: number;
  selecionada?: string;
  isolado?: string[];
  escondidos?: string[];
  vista?: VistaHolograma | 'livre';
}
