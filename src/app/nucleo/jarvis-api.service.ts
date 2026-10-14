import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ConfigStore, normalizarUrl } from './config.store';
import type { HistoricoConversa, RespostaConversa } from './conversa.modelos';
import type { Briefing } from './briefing.modelos';

/** Por que uma tentativa de conexão não deu certo — o suficiente para a tela explicar. */
export type ResultadoTeste = 'ok' | 'token-invalido' | 'api-inacessivel' | 'conteudo-misto';

/**
 * As chamadas HTTP da API do Jarvis.
 *
 * O token vai em "Authorization: Bearer" em tudo. Só o SSE usa `?token=`, porque o EventSource
 * não manda header — isso vive no JarvisEventosService.
 */
@Injectable({ providedIn: 'root' })
export class JarvisApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigStore);

  /**
   * Pede um briefing novo. A API devolve o briefing anterior (geradoAgora: false) quando o
   * último tem menos de 60 s — e nesse caso **não** emite nada no SSE, então quem chamou precisa
   * tocar o que voltou aqui.
   */
  gerarBriefing(): Promise<Briefing> {
    // Sem corpo: o endpoint não tem @RequestBody.
    return firstValueFrom(
      this.http.post<Briefing>(this.config.rota('/api/briefing'), null, {
        headers: this.autorizacao(),
      }),
    );
  }

  /** O último briefing gerado, ou null enquanto não houve nenhum (a API responde 404). */
  async ultimoBriefing(): Promise<Briefing | null> {
    try {
      return await firstValueFrom(
        this.http.get<Briefing>(this.config.rota('/api/briefing/ultimo'), {
          headers: this.autorizacao(),
        }),
      );
    } catch (erro) {
      if (erro instanceof HttpErrorResponse && erro.status === 404) {
        return null;
      }
      throw erro;
    }
  }

  /**
   * Testa um par URL + token antes de salvar, separando "token errado" de "API fora do ar".
   *
   * Dá para distinguir os dois porque o 401 do Jarvis sai com os cabeçalhos de CORS (o filtro de
   * CORS roda antes do de token). Sem isso, o navegador entregaria status 0 nos dois casos.
   * O 404 de /ultimo conta como sucesso: significa "a API respondeu, só não há briefing ainda".
   */
  async testar(urlBruta: string, token: string): Promise<ResultadoTeste> {
    const url = normalizarUrl(urlBruta);
    if (
      typeof location !== 'undefined' &&
      location.protocol === 'https:' &&
      url.startsWith('http://')
    ) {
      return 'conteudo-misto';
    }
    try {
      await firstValueFrom(this.http.get(`${url}/api/saude`, { responseType: 'text' }));
    } catch {
      return 'api-inacessivel';
    }
    try {
      await firstValueFrom(
        this.http.get(`${url}/api/briefing/ultimo`, {
          headers: new HttpHeaders({ Authorization: `Bearer ${token.trim()}` }),
          responseType: 'text',
        }),
      );
      return 'ok';
    } catch (erro) {
      if (erro instanceof HttpErrorResponse) {
        if (erro.status === 404) {
          return 'ok';
        }
        if (erro.status === 401 || erro.status === 403) {
          return 'token-invalido';
        }
      }
      return 'api-inacessivel';
    }
  }

  enviarConversa(texto: string): Promise<{ id: string }> {
    return firstValueFrom(
      this.http.post<{ id: string }>(
        this.config.rota('/api/conversa'),
        { texto },
        { headers: this.autorizacao() },
      ),
    );
  }
  historicoConversa(): Promise<HistoricoConversa> {
    return firstValueFrom(
      this.http.get<HistoricoConversa>(this.config.rota('/api/conversa/historico'), {
        headers: this.autorizacao(),
      }),
    );
  }
  ultimaConversa(): Promise<RespostaConversa | null> {
    return firstValueFrom(
      this.http.get<RespostaConversa | null>(this.config.rota('/api/conversa/ultima'), {
        headers: this.autorizacao(),
      }),
    );
  }
  limparConversa(): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(this.config.rota('/api/conversa/limpar'), null, {
        headers: this.autorizacao(),
      }),
    );
  }
  baixarAnexo(id: string): Promise<Blob> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) return Promise.reject(new Error('Anexo inválido'));
    return firstValueFrom(
      this.http.get(this.config.rota('/api/anexos/' + id), {
        headers: this.autorizacao(),
        responseType: 'blob',
      }),
    );
  }

  private autorizacao(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.config.token()}` });
  }
}
