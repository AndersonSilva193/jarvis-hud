import { Service } from '@angular/core';

export function urlSegura(valor: string): string {
  try { const url = new URL(valor); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}

/** Ponto de troca para a futura abertura pelo agente do PC. */
@Service()
export class AbrirLinkService {
  abrir(url: string): void { const segura = urlSegura(url); if (segura) window.open(segura, '_blank', 'noopener,noreferrer'); }
}
