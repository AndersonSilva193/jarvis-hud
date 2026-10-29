/**
 * Filtro One Euro (Casiez, Roussel e Vogel, 2012): passa-baixa cujo corte sobe com a velocidade.
 * Parado, alisa o tremor dos landmarks; rápido, quase não atrasa o movimento.
 */
export class FiltroUmEuro {
  private anterior: number | null = null;
  private derivada = 0;
  private tAnterior = 0;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly dCutoff: number,
  ) {}

  /** `t` em ms. Um instante repetido ou para trás devolve o último valor. */
  filtrar(valor: number, t: number): number {
    if (this.anterior === null) {
      this.anterior = valor;
      this.tAnterior = t;
      return valor;
    }
    const dt = (t - this.tAnterior) / 1000;
    if (dt <= 0) return this.anterior;
    this.tAnterior = t;
    const derivadaBruta = (valor - this.anterior) / dt;
    this.derivada += alfa(this.dCutoff, dt) * (derivadaBruta - this.derivada);
    const corte = this.minCutoff + this.beta * Math.abs(this.derivada);
    this.anterior += alfa(corte, dt) * (valor - this.anterior);
    return this.anterior;
  }
}

function alfa(corte: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * corte);
  return 1 / (1 + tau / dt);
}
