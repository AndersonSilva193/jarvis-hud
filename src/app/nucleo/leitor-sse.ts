export interface EventoSse {
  evento: string;
  dados: string;
}

/**
 * Lê `text/event-stream` em pedaços, como chegam do `fetch`: um pedaço pode cortar uma linha ao
 * meio, e o evento só sai na linha em branco que o fecha.
 *
 * Existe porque o `EventSource` não manda cabeçalho, e o stream do holograma exige `Bearer`.
 * Segue a especificação do HTML no que importa aqui: `event`, `data` em várias linhas (juntas por
 * `\n`), comentário com `:`, um espaço opcional depois dos dois-pontos e os três finais de linha.
 */
export class LeitorSse {
  private resto = '';
  private evento = '';
  private dados: string[] = [];
  private inicio = true;

  alimentar(pedaco: string): EventoSse[] {
    let texto = this.resto + pedaco;
    if (this.inicio && texto.length) {
      texto = texto.replace(/^﻿/, '');
      this.inicio = false;
    }
    const linhas = texto.split(/\r\n|\r|\n/);
    this.resto = linhas.pop() ?? '';
    // Um `\r` no fim do pedaço pode ser a metade de um `\r\n`: a linha espera o próximo pedaço.
    if (texto.endsWith('\r')) this.resto = (linhas.pop() ?? '') + '\r';
    const saida: EventoSse[] = [];
    for (const linha of linhas) {
      const evento = this.linha(linha);
      if (evento) saida.push(evento);
    }
    return saida;
  }

  /** O fim do corpo: um evento sem a linha em branco final é descartado, como manda a especificação. */
  terminar(): EventoSse[] {
    const saida = this.resto.endsWith('\r') ? this.alimentar('\n') : [];
    this.resto = '';
    this.evento = '';
    this.dados = [];
    return saida;
  }

  private linha(linha: string): EventoSse | null {
    if (linha === '') {
      const evento = this.dados.length ? { evento: this.evento || 'message', dados: this.dados.join('\n') } : null;
      this.evento = '';
      this.dados = [];
      return evento;
    }
    if (linha.startsWith(':')) return null;
    const corte = linha.indexOf(':');
    const campo = corte < 0 ? linha : linha.slice(0, corte);
    const valor = corte < 0 ? '' : linha.slice(corte + 1).replace(/^ /, '');
    if (campo === 'event') this.evento = valor;
    else if (campo === 'data') this.dados.push(valor);
    return null;
  }
}
