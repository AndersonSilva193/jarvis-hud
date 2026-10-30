import { DestroyRef, Service, computed, effect, inject, untracked } from '@angular/core';

import { ComandosDoHologramaService } from './comandos-do-holograma.service';
import { ConfigStore } from './config.store';
import { HologramaService } from './holograma.service';
import type { EstadoDoHolograma } from './holograma.modelos';
import { JarvisApiService } from './jarvis-api.service';

/** O tempo para a cena assentar antes de contar: um gesto mexe na explosão a cada quadro. */
export const DEBOUNCE_DO_ESTADO_MS = 300;

/**
 * Conta ao servidor como está o holograma (`POST /api/holograma/estado`), para o Jarvis entender
 * "explode mais", "isola isso" e "o que é essa peça?".
 *
 * O irmão do `TelaEstadoService`: debounce, um POST por vez (uma resposta lenta nunca deixa um
 * retrato velho vencer o novo) e reenvio a cada 5 min e na reconexão, porque o retrato do servidor
 * vence em 10. Fechado, manda `{"aberto": false}` uma vez e para — o servidor tira a linha do
 * prompt, e não há o que contar até reabrir.
 */
@Service()
export class HologramaEstadoService {
  private readonly holograma = inject(HologramaService);
  private readonly comandos = inject(ComandosDoHologramaService);
  private readonly api = inject(JarvisApiService);
  private readonly config = inject(ConfigStore);
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private pulso: ReturnType<typeof setInterval> | null = null;
  private pendente: EstadoDoHolograma | null = null;
  private enviando = false;
  /** O último fechado já foi contado: não repete a cada mudança irrelevante com a camada fechada. */
  private fechadoContado = true;

  /** O retrato, montado dos dois serviços. A explosão vai em duas casas: o gesto não vira 60 POSTs. */
  readonly estado = computed<EstadoDoHolograma>(() => {
    if (!this.holograma.aberto()) return { aberto: false };
    const meta = this.holograma.meta();
    const id = this.holograma.idGeracao() || meta?.id || '';
    const filtros = this.comandos.filtros();
    return {
      aberto: true,
      objeto: { id, nome: meta?.nome ?? '' },
      gerando: this.holograma.construindo(),
      pecas: this.holograma.pecas().map((p) => ({ id: p.id, nome: p.nome, grupo: p.grupo })),
      explosao: Math.round(this.comandos.explosao() * 100) / 100,
      selecionada: this.comandos.selecao()?.id ?? '',
      isolado: [...filtros.isolados.grupos, ...filtros.isolados.pecas],
      escondidos: [...filtros.escondidos.grupos, ...filtros.escondidos.pecas],
      vista: this.comandos.vista(),
    };
  });

  constructor() {
    effect(() => {
      const configurado = this.config.configurado();
      this.config.urlApi(); this.config.token();
      const estado = this.estado();
      untracked(() => {
        if (!configurado) { this.parar(); return; }
        if (!estado.aberto) {
          if (this.fechadoContado) return;
          this.fechadoContado = true;
          if (this.pulso) clearInterval(this.pulso);
          this.pulso = null;
        } else {
          this.fechadoContado = false;
          this.pulso ??= setInterval(() => this.reenviar(), 5 * 60_000);
        }
        this.agendar(estado);
      });
    });
    inject(DestroyRef).onDestroy(() => this.parar());
  }

  /** A reconexão do SSE e o pulso: o servidor pode ter reiniciado e esquecido. */
  reenviar(): void {
    if (this.config.configurado() && this.holograma.aberto()) this.agendar(this.estado());
  }

  private agendar(estado: EstadoDoHolograma): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      this.pendente = estado;
      void this.enviar();
    }, DEBOUNCE_DO_ESTADO_MS);
  }

  private async enviar(): Promise<void> {
    if (this.enviando || !this.pendente) return;
    const estado = this.pendente;
    this.pendente = null;
    this.enviando = true;
    try {
      await this.api.enviarEstadoHolograma(estado);
    } catch {
      /* A próxima mudança, a reconexão ou o pulso mandam um retrato novo. Nunca segura a HUD. */
    } finally {
      this.enviando = false;
      if (this.pendente) void this.enviar();
    }
  }

  private parar(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.pulso) clearInterval(this.pulso);
    this.debounce = null;
    this.pulso = null;
    this.pendente = null;
  }
}
