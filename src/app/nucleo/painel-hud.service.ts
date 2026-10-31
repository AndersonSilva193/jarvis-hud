import { Service, signal } from '@angular/core';

export type PainelHud = 'conversa' | 'ferramentas';

/** Uma única lateral, independente do ciclo de escuta e reprodução. */
@Service()
export class PainelHudService {
  private readonly estado = signal<PainelHud | null>(null);
  readonly ativo = this.estado.asReadonly();

  abrir(painel: PainelHud): void { this.estado.set(painel); }
  fechar(): void { this.estado.set(null); }
  alternar(painel: PainelHud): void {
    this.estado.update(atual => atual === painel ? null : painel);
  }
}
