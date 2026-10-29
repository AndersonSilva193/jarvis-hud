import { Service, computed, inject, signal } from '@angular/core';

import { ErroDoStreamHolograma, HologramaStreamService, type OuvintesDoHolograma } from './holograma-stream.service';
import {
  MAX_OBJETO_HOLOGRAMA,
  type DetalheHolograma,
  type MetaHolograma,
  type NomeExemplo,
  type PecaHolograma,
} from './holograma.modelos';

export type FaseHolograma = 'vazio' | 'construindo' | 'pronto' | 'erro' | 'cancelado';

/** De onde vêm as peças: muda só a explicação de um erro HTTP. */
type Origem = 'exemplo' | 'gerar';

/**
 * O modo Holograma da HUD: se a camada está aberta, o objeto atual e as peças que já chegaram.
 *
 * As peças só crescem enquanto o objeto é o mesmo; trocar de objeto sobe a `geracao`, e é por ela
 * que a cena sabe que tem de descartar o que desenhou. Erro e cancelamento **não** sobem a
 * `geracao`: o que já foi montado fica na tela, com o aviso por cima.
 */
@Service()
export class HologramaService {
  private readonly stream = inject(HologramaStreamService);

  readonly aberto = signal(false);
  readonly geracao = signal(0);
  readonly meta = signal<MetaHolograma | null>(null);
  readonly pecas = signal<readonly PecaHolograma[]>([]);
  readonly fase = signal<FaseHolograma>('vazio');
  readonly erro = signal('');
  readonly avisos = signal(0);

  readonly construindo = computed(() => this.fase() === 'construindo');
  /** Pedido feito e nenhuma peça ainda: é quando a base da cena "escaneia". */
  readonly escaneando = computed(() => this.construindo() && this.pecas().length === 0);

  private controle: AbortController | null = null;

  abrir(): void {
    this.aberto.set(true);
  }

  alternar(): void {
    if (this.aberto()) this.fechar();
    else this.abrir();
  }

  /** Fecha a camada e larga o objeto: a cena é destruída junto e libera a GPU. */
  fechar(): void {
    this.interromper();
    this.aberto.set(false);
    this.limpar('vazio');
  }

  carregarExemplo(nome: NomeExemplo): Promise<void> {
    return this.executar('exemplo', (ouvintes, sinal) => this.stream.exemplo(nome, ouvintes, sinal));
  }

  /** Pede ao modelo um objeto; as peças entram na cena conforme ele escreve. */
  gerar(objeto: string, detalhe: DetalheHolograma): Promise<void> {
    const limpo = objeto.trim().slice(0, MAX_OBJETO_HOLOGRAMA);
    if (!limpo) return Promise.resolve();
    return this.executar('gerar', (ouvintes, sinal) => this.stream.gerar(limpo, detalhe, ouvintes, sinal));
  }

  /**
   * Para a geração em andamento. Abortar o `fetch` fecha a conexão, e é isso que faz o servidor
   * cortar o modelo; as peças que já chegaram ficam.
   */
  cancelar(): void {
    if (!this.construindo()) return;
    this.interromper();
    this.fase.set('cancelado');
  }

  private async executar(
    origem: Origem,
    transmitir: (ouvintes: OuvintesDoHolograma, sinal: AbortSignal) => Promise<boolean>,
  ): Promise<void> {
    this.interromper();
    const controle = new AbortController();
    this.controle = controle;
    this.aberto.set(true);
    this.limpar('construindo');
    let erroDoServidor = '';
    try {
      const terminou = await transmitir(
        {
          meta: (meta) => this.meta.set(meta),
          peca: (peca) => this.pecas.update((lista) => [...lista, peca]),
          aviso: () => this.avisos.update((n) => n + 1),
          erro: (texto) => (erroDoServidor = texto),
          fim: () => undefined,
        },
        controle.signal,
      );
      if (controle.signal.aborted) return;
      if (erroDoServidor) this.falhar(erroDoServidor);
      else if (terminou) this.fase.set('pronto');
      else this.falhar('A transmissão caiu antes do fim do objeto.');
    } catch (erro) {
      if (!controle.signal.aborted) this.falhar(explicar(erro, origem));
    } finally {
      if (this.controle === controle) this.controle = null;
    }
  }

  private interromper(): void {
    this.controle?.abort();
    this.controle = null;
  }

  private limpar(fase: FaseHolograma): void {
    this.geracao.update((g) => g + 1);
    this.meta.set(null);
    this.pecas.set([]);
    this.avisos.set(0);
    this.erro.set('');
    this.fase.set(fase);
  }

  /** Mantém as peças: um corte no meio ainda deixa na tela o que chegou. */
  private falhar(motivo: string): void {
    this.erro.set(motivo);
    this.fase.set('erro');
  }
}

function explicar(erro: unknown, origem: Origem): string {
  if (erro instanceof ErroDoStreamHolograma) {
    if (erro.status === 401 || erro.status === 403) return 'Token recusado pela API.';
    if (erro.status === 404) return origem === 'exemplo' ? 'Esse exemplo não existe na API.' : 'Esta API ainda não gera hologramas.';
    if (erro.status === 400) return 'A API recusou o pedido: confira o nome do objeto.';
    return `A API respondeu ${erro.status}.`;
  }
  return 'Não consegui falar com a API.';
}
