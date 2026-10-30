/**
 * O formato do canal do holograma (`/ws/holograma`), o mesmo da seção 11 do `docs/HOLOGRAMA.md` e
 * do `ValidadorDeMensagemDoControle` do Java. TypeScript puro: o celular converte gestos em
 * mensagens, a HUD do PC converte mensagens de volta em gestos, e os testes conferem as duas pontas.
 *
 * Só eventos já interpretados: nunca imagem, nunca landmarks.
 */
import type { EventoDeGesto } from '../gestos/gestos.modelos';
import { EXPLOSAO_POR_ALTURA, type IntencaoDeToque } from '../componentes/holograma/controle-de-toque';

export type EventoDoControle =
  /** Soma dos deslocamentos do intervalo, em frações da tela. */
  | { t: 'girar'; dx: number; dy: number }
  /** Soltou o giro: a inércia, em frações da tela por segundo. */
  | { t: 'soltar'; vx: number; vy: number }
  /** Produto dos fatores do intervalo; > 1 aproxima. */
  | { t: 'zoom'; f: number }
  /** Fator absoluto 0..1 (câmera). */
  | { t: 'explodir'; v: number }
  /** Soma ao fator atual (touchpad, dois dedos). */
  | { t: 'explodir'; dv: number }
  | { t: 'cursor'; x: number; y: number }
  | { t: 'cursorFim' }
  /** O indicador parou: a HUD seleciona na última posição do cursor. */
  | { t: 'selecionar' }
  | { t: 'resetar' }
  /** Mão entrou (1) ou saiu (0) da câmera do celular. */
  | { t: 'mao'; v: 0 | 1 }
  /** Dedo na tela do celular (1) ou fora (0). */
  | { t: 'toque'; v: 0 | 1 }
  | { t: 'gesto'; n: string }
  | { t: 'eco'; n: number }
  /** Só para o log do servidor; não chega à HUD. */
  | { t: 'latencia'; p50: number; p95: number; k: number };

export type EstadoDoOutroLado = 'conectado' | 'caiu' | 'voltou' | 'encerrado';

/** O que o servidor manda à HUD do PC. */
export type MensagemParaHud =
  | EventoDoControle
  | { t: 'par'; codigo: string; expira: number }
  | { t: 'controle'; e: EstadoDoOutroLado; retomada?: string }
  | { t: 'erro'; e: string };

/** O que o servidor manda ao celular. */
export type MensagemParaControle =
  | { t: 'pareado'; retomada: string }
  | { t: 'hud'; e: Exclude<EstadoDoOutroLado, 'conectado'> }
  | { t: 'eco'; n: number };

/** Os códigos de fechamento do `CanalDoHologramaHandler`; com eles não adianta reconectar. */
export const FECHAMENTOS_FINAIS: Readonly<Record<number, string>> = {
  1000: 'Controle encerrado.',
  1008: 'O servidor recusou as mensagens deste aparelho.',
  4000: 'O PC desconectou este celular.',
  4401: 'Este QR code já foi usado ou expirou. Gere outro no PC.',
  4404: 'A HUD do PC não voltou. Gere outro QR code no PC.',
  4409: 'Outro celular já está controlando o PC.',
};

export const MAX_EVENTOS_POR_MENSAGEM = 8;
export const MAX_ROTULO = 24;

/** A URL do WebSocket a partir da URL da API (`https://x` → `wss://x/ws/holograma?...`). */
export function urlDoCanal(urlApi: string, query: Record<string, string>): string {
  const base = urlApi.replace(/^http/i, 'ws').replace(/\/+$/, '');
  return `${base}/ws/holograma?${new URLSearchParams(query).toString()}`;
}

// ── celular: gesto e toque → mensagem ──────────────────────────────────────────────────────────

/** Um evento do `MotorDeGestos` vira no máximo uma mensagem. */
export function mensagemDoGesto(e: EventoDeGesto): EventoDoControle | null {
  switch (e.tipo) {
    case 'maoPresente':
      return { t: 'mao', v: 1 };
    case 'autoRotacao':
      return { t: 'mao', v: 0 };
    case 'girar':
      return { t: 'girar', dx: e.dx, dy: e.dy };
    case 'soltarGiro':
      return { t: 'soltar', vx: e.vx, vy: e.vy };
    case 'zoom':
      return { t: 'zoom', f: e.fator };
    case 'explosao':
    case 'explosaoFim':
      return { t: 'explodir', v: e.fator };
    case 'cursor':
      return { t: 'cursor', x: e.x, y: e.y };
    case 'cursorFim':
      return { t: 'cursorFim' };
    case 'apontarParado':
      // A posição já foi no último `cursor`: o agregador manda o cursor pendente antes disto.
      return { t: 'selecionar' };
    case 'resetar':
      return { t: 'resetar' };
    case 'gesto':
      return { t: 'gesto', n: e.nome.slice(0, MAX_ROTULO) };
    case 'explosaoInicio':
      return null;
  }
}

/**
 * Uma intenção do `ReconhecedorDeToque` (em px) vira mensagem em frações da altura — a mesma conta
 * que o `ControleDeToque` faz antes de chamar a cena. Sem cena no celular, o toque duplo reseta.
 */
export function mensagemDoToque(i: IntencaoDeToque, altura: number): EventoDoControle {
  const a = altura || 1;
  switch (i.tipo) {
    case 'inicio':
      return { t: 'toque', v: 1 };
    case 'fim':
      return { t: 'toque', v: 0 };
    case 'girar':
      return { t: 'girar', dx: i.dx / a, dy: i.dy / a };
    case 'soltarGiro':
      return { t: 'soltar', vx: i.vx / a, vy: i.vy / a };
    case 'zoom':
      return { t: 'zoom', f: i.fator };
    case 'explodir':
      return { t: 'explodir', dv: i.delta * EXPLOSAO_POR_ALTURA };
    case 'toqueDuplo':
      return { t: 'resetar' };
  }
}

// ── PC: mensagem → gesto ───────────────────────────────────────────────────────────────────────

/**
 * O que a HUD faz com cada mensagem do celular: o que é gesto vai ao mesmo `ControlePorGestos` da
 * câmera local; o toque e a explosão relativa vão aos mesmos caminhos do toque local.
 */
export type AcaoRemota =
  | { tipo: 'gesto'; evento: EventoDeGesto }
  | { tipo: 'selecionar' }
  | { tipo: 'toque'; ativo: boolean }
  | { tipo: 'explodirMais'; delta: number }
  | { tipo: 'eco'; n: number };

export function acaoDaMensagem(m: EventoDoControle): AcaoRemota | null {
  switch (m.t) {
    case 'mao':
      return { tipo: 'gesto', evento: { tipo: m.v ? 'maoPresente' : 'autoRotacao' } };
    case 'girar':
      return { tipo: 'gesto', evento: { tipo: 'girar', dx: m.dx, dy: m.dy } };
    case 'soltar':
      return { tipo: 'gesto', evento: { tipo: 'soltarGiro', vx: m.vx, vy: m.vy } };
    case 'zoom':
      return { tipo: 'gesto', evento: { tipo: 'zoom', fator: m.f } };
    case 'explodir':
      return 'v' in m ? { tipo: 'gesto', evento: { tipo: 'explosao', fator: m.v } } : { tipo: 'explodirMais', delta: m.dv };
    case 'cursor':
      return { tipo: 'gesto', evento: { tipo: 'cursor', x: m.x, y: m.y } };
    case 'cursorFim':
      return { tipo: 'gesto', evento: { tipo: 'cursorFim' } };
    case 'selecionar':
      return { tipo: 'selecionar' };
    case 'resetar':
      return { tipo: 'gesto', evento: { tipo: 'resetar' } };
    case 'gesto':
      return { tipo: 'gesto', evento: { tipo: 'gesto', nome: m.n } };
    case 'toque':
      return { tipo: 'toque', ativo: m.v === 1 };
    case 'eco':
      return { tipo: 'eco', n: m.n };
    case 'latencia':
      return null;
  }
}

// ── leitura ────────────────────────────────────────────────────────────────────────────────────

/**
 * Lê o que chegou à HUD: um objeto ou um array de eventos. O servidor já validou, mas a HUD revalida
 * — o mesmo cuidado de `lerCardTela`. Evento torto é deixado de fora; o resto passa.
 */
export function lerMensagensParaHud(texto: string): MensagemParaHud[] {
  const bruto = analisar(texto);
  const lista = Array.isArray(bruto) ? bruto.slice(0, MAX_EVENTOS_POR_MENSAGEM) : [bruto];
  const saida: MensagemParaHud[] = [];
  for (const item of lista) {
    const m = lerEvento(item) ?? lerEstadoParaHud(item);
    if (m) saida.push(m);
  }
  return saida;
}

export function lerMensagemParaControle(texto: string): MensagemParaControle | null {
  const o = objeto(analisar(texto));
  if (!o) return null;
  switch (o['t']) {
    case 'pareado':
      return typeof o['retomada'] === 'string' && o['retomada'] ? { t: 'pareado', retomada: o['retomada'] } : null;
    case 'hud':
      return o['e'] === 'caiu' || o['e'] === 'voltou' || o['e'] === 'encerrado' ? { t: 'hud', e: o['e'] } : null;
    case 'eco':
      return inteiro(o['n']) ? { t: 'eco', n: o['n'] as number } : null;
    default:
      return null;
  }
}

function lerEstadoParaHud(item: unknown): MensagemParaHud | null {
  const o = objeto(item);
  if (!o) return null;
  switch (o['t']) {
    case 'par':
      return typeof o['codigo'] === 'string' && o['codigo'] && numero(o['expira'], 0, 3600)
        ? { t: 'par', codigo: o['codigo'], expira: o['expira'] as number }
        : null;
    case 'controle': {
      const e = o['e'];
      if (e !== 'conectado' && e !== 'caiu' && e !== 'voltou' && e !== 'encerrado') return null;
      return typeof o['retomada'] === 'string' ? { t: 'controle', e, retomada: o['retomada'] } : { t: 'controle', e };
    }
    case 'erro':
      return typeof o['e'] === 'string' ? { t: 'erro', e: o['e'] } : null;
    default:
      return null;
  }
}

/** Os eventos do celular, com os limites do validador do Java. */
export function lerEvento(item: unknown): EventoDoControle | null {
  const o = objeto(item);
  if (!o) return null;
  switch (o['t']) {
    case 'girar':
      return numero(o['dx'], -1, 1) && numero(o['dy'], -1, 1) ? { t: 'girar', dx: o['dx'] as number, dy: o['dy'] as number } : null;
    case 'soltar':
      return numero(o['vx'], -20, 20) && numero(o['vy'], -20, 20) ? { t: 'soltar', vx: o['vx'] as number, vy: o['vy'] as number } : null;
    case 'zoom':
      return numero(o['f'], 0.5, 2) ? { t: 'zoom', f: o['f'] as number } : null;
    case 'explodir':
      if (numero(o['v'], 0, 1)) return { t: 'explodir', v: o['v'] as number };
      return numero(o['dv'], -1, 1) ? { t: 'explodir', dv: o['dv'] as number } : null;
    case 'cursor':
      return numero(o['x'], 0, 1) && numero(o['y'], 0, 1) ? { t: 'cursor', x: o['x'] as number, y: o['y'] as number } : null;
    case 'cursorFim':
    case 'selecionar':
    case 'resetar':
      return { t: o['t'] };
    case 'mao':
    case 'toque':
      return o['v'] === 0 || o['v'] === 1 ? { t: o['t'], v: o['v'] } : null;
    case 'gesto':
      return typeof o['n'] === 'string' && o['n'].length > 0 && o['n'].length <= MAX_ROTULO ? { t: 'gesto', n: o['n'] } : null;
    case 'eco':
      return inteiro(o['n']) ? { t: 'eco', n: o['n'] as number } : null;
    default:
      return null;
  }
}

function analisar(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function numero(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

function inteiro(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
