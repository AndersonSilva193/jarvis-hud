import { Service, inject } from '@angular/core';

import { ConfigStore } from './config.store';
import { LeitorSse, type EventoSse } from './leitor-sse';
import {
  avisoEhTroca,
  lerAvisoHolograma,
  lerErroHolograma,
  lerFimHolograma,
  lerMetaHolograma,
  lerPecaHolograma,
  type DetalheHolograma,
  type FimHolograma,
  type GeradorHolograma,
  type MetaHolograma,
  type PecaHolograma,
} from './holograma.modelos';

export interface OuvintesDoHolograma {
  meta: (meta: MetaHolograma) => void;
  peca: (peca: PecaHolograma) => void;
  /** `troca`: o aviso é de que o gerador mudou, e não um conserto da montagem. */
  aviso: (texto: string, troca: boolean) => void;
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
 * A conexão ficou muda além do aceitável: o celular pôs a aba em segundo plano, a rede trocou, o
 * proxy largou. O que chegou fica, e a tela oferece "Continuar".
 */
export class ConexaoMudaHolograma extends Error {
  constructor() {
    super('O stream do holograma ficou mudo');
  }
}

/**
 * Quanto o stream pode ficar sem nenhum byte. O servidor manda `:gerando` a cada 3 s enquanto o
 * modelo pensa, então silêncio disso é conexão morta — e não modelo lento.
 */
export const SILENCIO_MAXIMO_MS = 15_000;
const CONFERENCIA_MS = 2_000;

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

  /** Reabre um objeto da galeria, peça por peça, como se tivesse vindo do cache. */
  abrir(id: string, ouvintes: OuvintesDoHolograma, sinal: AbortSignal): Promise<boolean> {
    return this.transmitir(`/api/holograma/${encodeURIComponent(id)}/stream`, ouvintes, sinal);
  }

  /**
   * Pede o objeto; as peças chegam enquanto o modelo escreve — ou, se o servidor já o tem na
   * galeria, numa reprodução rápida. `novo` pula a galeria e substitui o que estava lá.
   */
  gerar(
    objeto: string,
    detalhe: DetalheHolograma,
    provedor: GeradorHolograma,
    ouvintes: OuvintesDoHolograma,
    sinal: AbortSignal,
    novo = false,
  ): Promise<boolean> {
    const busca = new URLSearchParams({ objeto, detalhe, provedor });
    if (novo) busca.set('novo', 'true');
    return this.transmitir(`/api/holograma/gerar?${busca.toString()}`, ouvintes, sinal);
  }

  /**
   * Retoma a geração `id`: o servidor reenvia as peças a partir da `recebidas`-ésima e, se o objeto
   * não estava completo, segue com o modelo — no mesmo formato de eventos.
   */
  continuar(id: string, recebidas: number, ouvintes: OuvintesDoHolograma, sinal: AbortSignal): Promise<boolean> {
    const busca = new URLSearchParams({ id, recebidas: String(recebidas) });
    return this.transmitir(`/api/holograma/continuar?${busca.toString()}`, ouvintes, sinal);
  }

  /**
   * Resolve com `true` quando o `fim` chegou; `false` quando o corpo acabou antes dele. Lança
   * `ConexaoMudaHolograma` quando nenhum byte chega por `SILENCIO_MAXIMO_MS` — inclusive na volta
   * do segundo plano, quando o celular congelou a aba e a conexão morreu sem avisar.
   */
  async transmitir(caminho: string, ouvintes: OuvintesDoHolograma, sinal: AbortSignal): Promise<boolean> {
    const corte = new AbortController();
    const repassar = () => corte.abort();
    sinal.addEventListener('abort', repassar);
    let ultimoByte = Date.now();
    let mudo = false;
    const conferir = () => {
      if (Date.now() - ultimoByte > SILENCIO_MAXIMO_MS) {
        mudo = true;
        corte.abort();
      }
    };
    const vigia = setInterval(conferir, CONFERENCIA_MS);
    // O intervalo para junto com a aba em segundo plano; na volta, a conferência é imediata.
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') conferir();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    try {
      const resposta = await fetch(this.config.rota(caminho), {
        headers: { Authorization: `Bearer ${this.config.token()}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: corte.signal,
      });
      if (!resposta.ok || !resposta.body) throw new ErroDoStreamHolograma(resposta.status);
      ultimoByte = Date.now();

      const leitor = resposta.body.getReader();
      const decodificador = new TextDecoder();
      const sse = new LeitorSse();
      let terminou = false;
      try {
        for (;;) {
          const { done, value } = await leitor.read();
          ultimoByte = Date.now();
          const eventos = done ? sse.terminar() : sse.alimentar(decodificador.decode(value, { stream: true }));
          for (const evento of eventos) terminou = despachar(evento, ouvintes) || terminou;
          if (done || terminou) return terminou;
        }
      } finally {
        // Depois do `fim` o servidor fecha; cancelar aqui só solta a conexão um instante antes.
        void leitor.cancel().catch(() => undefined);
      }
    } catch (erro) {
      if (mudo && !sinal.aborted) throw new ConexaoMudaHolograma();
      throw erro;
    } finally {
      clearInterval(vigia);
      document.removeEventListener('visibilitychange', aoVoltar);
      sinal.removeEventListener('abort', repassar);
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
      if (aviso) ouvintes.aviso(aviso, avisoEhTroca(corpo));
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
