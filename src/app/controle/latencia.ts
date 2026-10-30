/** Um eco a cada 2 s; 30 amostras dão o último minuto. */
export const INTERVALO_DO_ECO_MS = 2_000;
export const JANELA_DE_AMOSTRAS = 30;
/** Eco que não voltou em 10 s não volta mais: sai da conta para não vazar memória. */
const ECO_PERDIDO_MS = 10_000;

export interface ResumoDaLatencia {
  p50: number;
  p95: number;
  k: number;
}

/**
 * A ida e volta do caminho inteiro: celular → servidor → HUD do PC → servidor → celular. O celular
 * manda `{"t":"eco","n"}`, a HUD devolve na hora, e a diferença de `performance.now()` é a amostra.
 */
export class MedidorDeLatencia {
  private proximo = 0;
  private readonly enviados = new Map<number, number>();
  private amostras: number[] = [];

  constructor(private readonly agora: () => number = () => performance.now()) {}

  novoEco(): { t: 'eco'; n: number } {
    const t = this.agora();
    for (const [n, enviado] of this.enviados) if (t - enviado > ECO_PERDIDO_MS) this.enviados.delete(n);
    const n = this.proximo++;
    this.enviados.set(n, t);
    return { t: 'eco', n };
  }

  /** A amostra em ms, ou `null` para eco desconhecido ou repetido. */
  voltou(n: number): number | null {
    const enviado = this.enviados.get(n);
    if (enviado === undefined) return null;
    this.enviados.delete(n);
    const ms = this.agora() - enviado;
    this.amostras = [...this.amostras, ms].slice(-JANELA_DE_AMOSTRAS);
    return ms;
  }

  resumo(): ResumoDaLatencia | null {
    if (!this.amostras.length) return null;
    const ordenadas = [...this.amostras].sort((a, b) => a - b);
    return { p50: percentil(ordenadas, 0.5), p95: percentil(ordenadas, 0.95), k: ordenadas.length };
  }

  /** Conexão nova: os ecos em voo da antiga não voltam. */
  reiniciarPendentes(): void {
    this.enviados.clear();
  }
}

/** Percentil pelo posto mais próximo, arredondado ao décimo de ms. */
export function percentil(ordenadas: readonly number[], p: number): number {
  const i = Math.min(ordenadas.length - 1, Math.max(0, Math.ceil(ordenadas.length * p) - 1));
  return Math.round(ordenadas[i]! * 10) / 10;
}
