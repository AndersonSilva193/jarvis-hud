/** Índices no texto original: a transcrição mantém pontuação e quebras de linha. */
export class RoteiroLegenda {
  readonly palavras: { inicio: number; fim: number; peso: number }[];
  readonly pesoTotal: number;

  constructor(readonly texto: string) {
    let peso = 0;
    this.palavras = Array.from(texto.matchAll(/\S+/g), parte => {
      const inicio = parte.index;
      const palavra = parte[0];
      const marca = { inicio, fim: inicio + palavra.length, peso };
      peso += Math.max(2, palavra.length) + (/[.!?;:,]$/.test(palavra) ? 4 : 1);
      return marca;
    });
    this.pesoTotal = peso;
  }

  indiceNoTempo(progresso: number): number {
    const alvo = Math.max(0, Math.min(1, progresso)) * this.pesoTotal;
    let indice = 0;
    while (indice + 1 < this.palavras.length && this.palavras[indice + 1]!.peso <= alvo) indice++;
    return indice;
  }

  indiceNoCaractere(caractere: number): number {
    let indice = 0;
    while (indice + 1 < this.palavras.length && this.palavras[indice + 1]!.inicio <= caractere) indice++;
    return indice;
  }

  revelado(indice: number): string {
    return indice < 0 ? '' : this.texto.slice(0, this.palavras[indice]?.fim ?? 0);
  }

  trecho(indice: number, limite: number): string {
    if (indice < 0) return '';
    let inicio = 0;
    let quantidade = 0;
    for (let i = 0; i <= indice; i++) {
      if (!this.palavras[i]) break;
      if (this.palavras[i]!.fim - this.palavras[inicio]!.inicio > limite || quantidade >= 12) {
        inicio = i;
        quantidade = 0;
      }
      quantidade++;
    }
    return this.texto.slice(this.palavras[inicio]?.inicio ?? 0, this.palavras[indice]?.fim ?? 0);
  }
}
