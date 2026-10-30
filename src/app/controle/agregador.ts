import { MAX_EVENTOS_POR_MENSAGEM, type EventoDoControle } from './controle.modelos';

/** 30 mensagens por segundo, no máximo. */
export const INTERVALO_MINIMO_MS = 1000 / 30;

export interface RelogioDoAgregador {
  agora(): number;
  agendar(fn: () => void, ms: number): unknown;
}

const RELOGIO_REAL: RelogioDoAgregador = {
  agora: () => performance.now(),
  agendar: (fn, ms) => setTimeout(fn, ms),
};

interface Pendentes {
  cursor: { x: number; y: number } | null;
  giro: { dx: number; dy: number } | null;
  zoom: number | null;
  explosao: number | null;
  explosaoRelativa: number | null;
}

const VAZIO: Pendentes = { cursor: null, giro: null, zoom: null, explosao: null, explosaoRelativa: null };

/**
 * Junta os eventos do celular e manda no máximo uma mensagem a cada {@link INTERVALO_MINIMO_MS}.
 *
 * Os contínuos se fundem enquanto esperam: `girar` soma, `zoom` multiplica, `cursor` e `explodir v`
 * ficam com o último. Os discretos (`soltar`, `selecionar`, `resetar`, `mao`, `toque`, `gesto`,
 * `eco`) não se fundem e não furam a fila: chegando um, o que estava pendente vira evento antes
 * dele, para a HUD ver a mesma ordem. Um intervalo com mais de um tipo sai como array.
 *
 * O primeiro evento depois de um silêncio sai na hora — juntar só custa latência quando há o que
 * juntar.
 */
export class AgregadorDeEventos {
  private fila: EventoDoControle[] = [];
  private pendentes: Pendentes = { ...VAZIO };
  private agendado = false;
  private ultimoEnvio = -Infinity;

  constructor(
    private readonly enviar: (mensagem: EventoDoControle | EventoDoControle[]) => void,
    private readonly relogio: RelogioDoAgregador = RELOGIO_REAL,
  ) {}

  adicionar(e: EventoDoControle): void {
    const p = this.pendentes;
    switch (e.t) {
      case 'girar':
        p.giro = { dx: (p.giro?.dx ?? 0) + e.dx, dy: (p.giro?.dy ?? 0) + e.dy };
        break;
      case 'zoom':
        p.zoom = (p.zoom ?? 1) * e.f;
        break;
      case 'cursor':
        p.cursor = { x: e.x, y: e.y };
        break;
      case 'explodir':
        if ('v' in e) p.explosao = e.v;
        else p.explosaoRelativa = (p.explosaoRelativa ?? 0) + e.dv;
        break;
      default:
        this.fecharPendentes();
        this.fila.push(e.t === 'soltar' ? { t: 'soltar', vx: arred(preso(e.vx, -20, 20)), vy: arred(preso(e.vy, -20, 20)) } : e);
    }
    this.agendar();
  }

  /** Descarta o que ainda não saiu (a conexão caiu: o gesto velho não vale na volta). */
  descartar(): void {
    this.fila = [];
    this.pendentes = { ...VAZIO };
  }

  private agendar(): void {
    if (this.agendado) return;
    this.agendado = true;
    const espera = Math.max(0, this.ultimoEnvio + INTERVALO_MINIMO_MS - this.relogio.agora());
    this.relogio.agendar(() => this.soltar(), espera);
  }

  private soltar(): void {
    this.agendado = false;
    this.fecharPendentes();
    if (!this.fila.length) return;
    const lote = this.fila.splice(0, MAX_EVENTOS_POR_MENSAGEM);
    this.ultimoEnvio = this.relogio.agora();
    this.enviar(lote.length === 1 ? lote[0]! : lote);
    if (this.fila.length) this.agendar();
  }

  /** Os contínuos pendentes viram eventos na fila, dentro dos limites do servidor. */
  private fecharPendentes(): void {
    const p = this.pendentes;
    if (p.cursor) this.fila.push({ t: 'cursor', x: preso(p.cursor.x, 0, 1), y: preso(p.cursor.y, 0, 1) });
    if (p.giro && (p.giro.dx || p.giro.dy)) {
      this.fila.push({ t: 'girar', dx: arred(preso(p.giro.dx, -1, 1)), dy: arred(preso(p.giro.dy, -1, 1)) });
    }
    if (p.zoom !== null && p.zoom !== 1) this.fila.push({ t: 'zoom', f: arred(preso(p.zoom, 0.5, 2)) });
    if (p.explosao !== null) this.fila.push({ t: 'explodir', v: arred(preso(p.explosao, 0, 1)) });
    if (p.explosaoRelativa) this.fila.push({ t: 'explodir', dv: arred(preso(p.explosaoRelativa, -1, 1)) });
    this.pendentes = { ...VAZIO };
  }
}

function preso(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Cinco casas bastam (1/100000 de tela) e encurtam o JSON. */
function arred(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}
