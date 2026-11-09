import { DestroyRef, Service, inject, signal } from '@angular/core';

import { JarvisApiService } from './jarvis-api.service';
import { lerModoIa, type EstadoModoIa, type ModoIa } from './modo-ia.modelos';

/** Quanto tempo o aviso de falha fica na tela. */
const AVISO_MS = 4_000;

/** Sem o SSE confirmar a troca até aqui, a HUD desiste de mostrar "trocando". */
const PRAZO_DA_TROCA_MS = 10_000;

/**
 * Qual IA está pensando, e o pedido de troca.
 *
 * O servidor é a fonte da verdade: o GET pinta a tela ao abrir, depois só o evento `ia.modo`
 * muda o estado. O POST apenas pede — quem confirma é o SSE.
 */
@Service()
export class ModoIaService {
  private readonly api = inject(JarvisApiService);

  private readonly atual = signal<EstadoModoIa | null>(null);
  readonly estado = this.atual.asReadonly();
  /** O modo pedido que o servidor ainda não confirmou. */
  readonly pedido = signal<ModoIa | null>(null);
  readonly aviso = signal('');

  /** Um evento SSE é sempre mais novo que um GET ainda em voo. */
  private recebeuEvento = false;
  private relogioDoAviso: ReturnType<typeof setTimeout> | null = null;
  private relogioDaTroca: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pararAviso();
      this.pararPrazo();
    });
  }

  async carregar(): Promise<void> {
    try {
      const estado = lerModoIa(await this.api.modoIa());
      if (estado && !this.recebeuEvento) this.atual.set(estado);
    } catch {
      // API fora do ar: o selo fica em "IA · —" e o rodapé já conta a história da conexão.
    }
  }

  receber(estado: EstadoModoIa): void {
    this.recebeuEvento = true;
    this.atual.set(estado);
    this.pedido.set(null);
    this.pararPrazo();
  }

  async trocar(modo: ModoIa): Promise<void> {
    if (this.pedido() === null && this.atual()?.modo === modo) return;
    this.pedido.set(modo);
    this.pararPrazo();
    this.relogioDaTroca = setTimeout(() => {
      this.relogioDaTroca = null;
      this.pedido.set(null);
    }, PRAZO_DA_TROCA_MS);
    try {
      await this.api.definirModoIa(modo);
    } catch {
      if (this.pedido() !== modo) return;
      this.pedido.set(null);
      this.pararPrazo();
      this.avisar('Não consegui trocar o modo da IA');
    }
  }

  private avisar(texto: string): void {
    this.pararAviso();
    this.aviso.set(texto);
    this.relogioDoAviso = setTimeout(() => {
      this.relogioDoAviso = null;
      this.aviso.set('');
    }, AVISO_MS);
  }

  private pararAviso(): void {
    if (this.relogioDoAviso !== null) clearTimeout(this.relogioDoAviso);
    this.relogioDoAviso = null;
  }

  private pararPrazo(): void {
    if (this.relogioDaTroca !== null) clearTimeout(this.relogioDaTroca);
    this.relogioDaTroca = null;
  }
}
