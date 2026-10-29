import { Service, inject } from '@angular/core';

import { ConfigStore } from './config.store';
import { LeitorSse, type EventoSse } from './leitor-sse';
import {
  lerAvisoHolograma,
  lerErroHolograma,
  lerFimHolograma,
  lerMetaHolograma,
  lerPecaHolograma,
  type DetalheHolograma,
  type FimHolograma,
  type MetaHolograma,
  type NomeExemplo,
  type PecaHolograma,
} from './holograma.modelos';

export interface OuvintesDoHolograma {
  meta: (meta: MetaHolograma) => void;
  peca: (peca: PecaHolograma) => void;
  aviso: (texto: string) => void;
  /** A geração parou antes da hora; o `fim` ainda vem depois. */
  erro: (texto: string) => void;
  fim: (fim: FimHolograma) => void;
}

/** O stream respondeu fora do 2xx: o status basta para a tela explicar. */
export class ErroDoStreamHolograma extends Error {
  constructor(readonly status: number) {
    super(`O stream do holograma respondeu ${status}`);
  }
}

/**
 * Lê o SSE de um holograma, peça por peça.
 *
 * Com `fetch` + `ReadableStream`, e não `EventSource`: a rota exige `Authorization: Bearer`, e o
 * `EventSource` não manda cabeçalho (`docs/HOLOGRAMA.md`, risco 17). Evento com nome desconhecido
 * ou corpo que não passa no validador é ignorado, como no `JarvisEventosService`.
 */
@Service()
export class HologramaStreamService {
  private readonly config = inject(ConfigStore);

  exemplo(nome: NomeExemplo, ouvintes: OuvintesDoHolograma, sinal: AbortSignal): Promise<boolean> {
    return this.transmitir(`/api/holograma/exemplo/${encodeURIComponent(nome)}`, ouvintes, sinal);
  }

  /** Pede ao modelo que gere o objeto; as peças chegam enquanto ele escreve. */
  gerar(objeto: string, detalhe: DetalheHolograma, ouvintes: OuvintesDoHolograma, sinal: AbortSignal): Promise<boolean> {
    const busca = new URLSearchParams({ objeto, detalhe });
    return this.transmitir(`/api/holograma/gerar?${busca.toString()}`, ouvintes, sinal);
  }

  /** Resolve com `true` quando o `fim` chegou; `false` quando o corpo acabou antes dele. */
  async transmitir(caminho: string, ouvintes: OuvintesDoHolograma, sinal: AbortSignal): Promise<boolean> {
    const resposta = await fetch(this.config.rota(caminho), {
      headers: { Authorization: `Bearer ${this.config.token()}`, Accept: 'text/event-stream' },
      cache: 'no-store',
      signal: sinal,
    });
    if (!resposta.ok || !resposta.body) throw new ErroDoStreamHolograma(resposta.status);

    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder();
    const sse = new LeitorSse();
    let terminou = false;
    try {
      for (;;) {
        const { done, value } = await leitor.read();
        const eventos = done ? sse.terminar() : sse.alimentar(decodificador.decode(value, { stream: true }));
        for (const evento of eventos) terminou = despachar(evento, ouvintes) || terminou;
        if (done || terminou) return terminou;
      }
    } finally {
      // Depois do `fim` o servidor fecha; cancelar aqui só solta a conexão um instante antes.
      void leitor.cancel().catch(() => undefined);
    }
  }
}

function despachar(evento: EventoSse, ouvintes: OuvintesDoHolograma): boolean {
  let corpo: unknown;
  try {
    corpo = JSON.parse(evento.dados);
  } catch {
    return false;
  }
  switch (evento.evento) {
    case 'meta': {
      const meta = lerMetaHolograma(corpo);
      if (meta) ouvintes.meta(meta);
      return false;
    }
    case 'peca': {
      const peca = lerPecaHolograma(corpo);
      if (peca) ouvintes.peca(peca);
      return false;
    }
    case 'aviso': {
      const aviso = lerAvisoHolograma(corpo);
      if (aviso) ouvintes.aviso(aviso);
      return false;
    }
    case 'erro': {
      const erro = lerErroHolograma(corpo);
      if (erro) ouvintes.erro(erro);
      return false;
    }
    case 'fim': {
      const fim = lerFimHolograma(corpo);
      if (fim) ouvintes.fim(fim);
      return fim !== null;
    }
    default:
      return false;
  }
}
