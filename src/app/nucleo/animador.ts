/**
 * Animações curtas com easing, num relógio que o teste controla.
 *
 * Cada animação recebe, a cada quadro, a fração "eased" atual e a do quadro anterior: quem anima um
 * valor absoluto usa a atual, quem soma deltas (giro, zoom) usa a diferença. Uma animação nova no
 * mesmo canal substitui a anterior — o último comando vence.
 */
export interface Relogio {
  agora(): number;
  /** Agenda o próximo quadro; devolve como cancelar. */
  quadro(passo: () => void): () => void;
}

export const RELOGIO_DO_NAVEGADOR: Relogio = {
  agora: () => performance.now(),
  quadro: (passo) => {
    const id = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(id);
  },
};

/** O tempo dos comandos de voz: suave sem parecer lento. */
export const DURACAO_DA_VOZ_MS = 600;

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

interface Animacao {
  inicio: number;
  duracao: number;
  ultima: number;
  passo: (fracao: number, anterior: number) => void;
}

export class Animador {
  private readonly animacoes = new Map<string, Animacao>();
  private cancelar: (() => void) | null = null;

  constructor(
    private readonly relogio: Relogio = RELOGIO_DO_NAVEGADOR,
    /** Movimento reduzido: tudo pula direto ao fim, num passo só. */
    private readonly reduzido: () => boolean = () => false,
  ) {}

  animar(canal: string, passo: (fracao: number, anterior: number) => void, duracao = DURACAO_DA_VOZ_MS): void {
    if (this.reduzido() || duracao <= 0) {
      this.animacoes.delete(canal);
      passo(1, 0);
      return;
    }
    this.animacoes.set(canal, { inicio: this.relogio.agora(), duracao, ultima: 0, passo });
    this.agendar();
  }

  /** O canal está no meio de uma animação? */
  animando(canal: string): boolean {
    return this.animacoes.has(canal);
  }

  parar(canal?: string): void {
    if (canal === undefined) this.animacoes.clear();
    else this.animacoes.delete(canal);
    if (!this.animacoes.size) {
      this.cancelar?.();
      this.cancelar = null;
    }
  }

  private agendar(): void {
    this.cancelar ??= this.relogio.quadro(this.quadro);
  }

  private readonly quadro = (): void => {
    this.cancelar = null;
    const agora = this.relogio.agora();
    for (const [canal, animacao] of [...this.animacoes]) {
      const t = Math.min(1, (agora - animacao.inicio) / animacao.duracao);
      const fracao = easeInOut(t);
      animacao.passo(fracao, animacao.ultima);
      animacao.ultima = fracao;
      if (t >= 1 && this.animacoes.get(canal) === animacao) this.animacoes.delete(canal);
    }
    if (this.animacoes.size) this.agendar();
  };
}
