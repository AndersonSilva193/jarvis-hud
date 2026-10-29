import { Service, computed, inject, signal } from '@angular/core';

import { ErroDoStreamHolograma, HologramaStreamService } from './holograma-stream.service';
import type { MetaHolograma, NomeExemplo, PecaHolograma } from './holograma.modelos';

export type FaseHolograma = 'vazio' | 'construindo' | 'pronto' | 'erro';

/**
 * O modo Holograma da HUD: se a camada está aberta, o objeto atual e as peças que já chegaram.
 *
 * As peças só crescem enquanto o objeto é o mesmo; trocar de objeto sobe a `geracao`, e é por ela
 * que a cena sabe que tem de descartar o que desenhou.
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

  async carregarExemplo(nome: NomeExemplo): Promise<void> {
    this.interromper();
    const controle = new AbortController();
    this.controle = controle;
    this.aberto.set(true);
    this.limpar('construindo');
    try {
      const terminou = await this.stream.exemplo(
        nome,
        {
          meta: (meta) => this.meta.set(meta),
          peca: (peca) => this.pecas.update((lista) => [...lista, peca]),
          aviso: () => this.avisos.update((n) => n + 1),
          fim: () => undefined,
        },
        controle.signal,
      );
      if (controle.signal.aborted) return;
      if (terminou) this.fase.set('pronto');
      else this.falhar('A transmissão caiu antes do fim do objeto.');
    } catch (erro) {
      if (!controle.signal.aborted) this.falhar(explicar(erro));
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

  private falhar(motivo: string): void {
    this.erro.set(motivo);
    this.fase.set('erro');
  }
}

function explicar(erro: unknown): string {
  if (erro instanceof ErroDoStreamHolograma) {
    if (erro.status === 401 || erro.status === 403) return 'Token recusado pela API.';
    if (erro.status === 404) return 'Esse exemplo não existe na API.';
    return `A API respondeu ${erro.status}.`;
  }
  return 'Não consegui falar com a API.';
}
