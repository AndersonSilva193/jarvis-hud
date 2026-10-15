import { DestroyRef, Service, effect, inject, untracked } from '@angular/core';
import { TelaService } from './tela.service';
import { JarvisApiService } from './jarvis-api.service';
import { ConfigStore } from './config.store';
import type { EstadoTela } from './tela.modelos';

/** Serializa os POSTs: uma resposta lenta nunca deixa um retrato antigo vencer o novo. */
@Service()
export class TelaEstadoService {
  private readonly tela = inject(TelaService);
  private readonly api = inject(JarvisApiService);
  private readonly config = inject(ConfigStore);
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private pulso: ReturnType<typeof setInterval> | null = null;
  private pendente: EstadoTela | null = null;
  private enviando = false;
  constructor() {
    effect(() => {
      const ativa = this.tela.ativa() && this.config.configurado();
      this.config.urlApi(); this.config.token();
      const estado = this.tela.estado();
      // Volume e seek também são mudanças do player, embora não ampliem o DTO do servidor.
      this.tela.midia.estados();
      untracked(() => {
        if (!ativa) { this.parar(); return; }
        this.agendar(estado);
        this.pulso ??= setInterval(() => this.reenviar(), 5 * 60_000);
      });
    });
    inject(DestroyRef).onDestroy(() => this.parar());
  }
  reenviar(): void { if (this.tela.ativa() && this.config.configurado()) this.agendar(this.tela.estado()); }
  private agendar(estado: EstadoTela): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { this.debounce = null; this.pendente = estado; void this.enviar(); }, 500);
  }
  private async enviar(): Promise<void> {
    if (this.enviando || !this.pendente || !this.tela.ativa()) return;
    const estado = this.pendente;
    this.pendente = null; this.enviando = true;
    try { await this.api.enviarEstadoTela(estado); }
    catch { /* Próxima mudança, reconexão ou pulso envia um retrato novo. Nunca bloqueia a HUD. */ }
    finally { this.enviando = false; if (this.pendente) void this.enviar(); }
  }
  private parar(): void {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.pulso) clearInterval(this.pulso);
    this.debounce = null; this.pulso = null; this.pendente = null;
  }
}
