import { Service, inject } from '@angular/core';

import { ConfigStore } from './config.store';
import { ErroDoStreamHolograma } from './holograma-stream.service';
import { lerItemGaleria, type ItemGaleria } from './holograma.modelos';

/**
 * As chamadas da galeria de hologramas: listar, apagar e as miniaturas.
 *
 * Com `fetch` e `Authorization: Bearer`, como o stream do holograma — inclusive para ler a
 * miniatura, que por isso chega como `Blob` e não como `<img src>` apontando para a API: uma rota
 * nova com `?token=` na URL é o que o `docs/HOLOGRAMA.md` (risco 9) pede para não criar.
 */
@Service()
export class HologramaGaleriaService {
  private readonly config = inject(ConfigStore);

  async listar(): Promise<ItemGaleria[]> {
    const resposta = await this.pedir('/api/holograma/galeria');
    const corpo: unknown = await resposta.json();
    if (!Array.isArray(corpo)) return [];
    return corpo.map(lerItemGaleria).filter((item): item is ItemGaleria => item !== null);
  }

  async apagar(id: string): Promise<void> {
    await this.pedir(`/api/holograma/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  /** A miniatura, ou `null` quando o objeto ainda não tem uma. */
  async miniatura(id: string): Promise<Blob | null> {
    try {
      const resposta = await this.pedir(`/api/holograma/${encodeURIComponent(id)}/miniatura`);
      const blob = await resposta.blob();
      return blob.type === 'image/png' ? blob : null;
    } catch (erro) {
      if (erro instanceof ErroDoStreamHolograma && erro.status === 404) return null;
      throw erro;
    }
  }

  /** Manda o `canvas.toDataURL('image/png')` da montagem pronta. */
  async enviarMiniatura(id: string, imagem: string): Promise<void> {
    await this.pedir(`/api/holograma/${encodeURIComponent(id)}/miniatura`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagem }),
    });
  }

  private async pedir(caminho: string, init: RequestInit = {}): Promise<Response> {
    const resposta = await fetch(this.config.rota(caminho), {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${this.config.token()}` },
      cache: 'no-store',
    });
    if (!resposta.ok) throw new ErroDoStreamHolograma(resposta.status);
    return resposta;
  }
}
