import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { ConfigStore, normalizarUrl } from './config.store';
import type { HistoricoConversa, RespostaConversa } from './conversa.modelos';
import type { Briefing } from './briefing.modelos';
import type { Introducao } from './inicializacao.modelos';
import type { RespostaVoz, StatusVoz } from './voz.modelos';
import type { EstadoDoHolograma } from './holograma.modelos';
import type { EstadoTela } from './tela.modelos';
import type { ModoIa } from './modo-ia.modelos';

/** Por que uma tentativa de conexão não deu certo — o suficiente para a tela explicar. */
export type ResultadoTeste = 'ok' | 'token-invalido' | 'api-inacessivel' | 'conteudo-misto';
export interface TarefaComputer {
  id: string;
  estado: string;
  provedor: string;
  modelo: string;
  ciclos: number;
  acoes: number;
  motivo: string;
  iniciadoEm: string;
}

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
  ultimaTarefaComputer(): Promise<TarefaComputer | null> {
    return firstValueFrom(this.http.get<TarefaComputer | null>(
      this.config.rota('/api/computer/ultima'), { headers: this.autorizacao() },
    ));
  }
  cancelarTarefaComputer(id: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(
      this.config.rota(`/api/computer/${encodeURIComponent(id)}/cancelar`), null,
      { headers: this.autorizacao() },
    ));
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
  /**
   * Pergunta como falar esta frase: a rota do MP3, ou o aviso de que a HUD fala sozinha.
   *
   * Quem chama põe um teto de tempo em cima desta promessa — esperar a rede é pior do que falar
   * logo com a voz do navegador.
   */
  sintetizarVoz(texto: string): Promise<RespostaVoz> {
    return firstValueFrom(
      this.http.post<RespostaVoz>(
        this.config.rota('/api/voz/sintetizar'),
        { texto },
        { headers: this.autorizacao() },
      ),
    );
  }

  /** Endereço absoluto do MP3, com o token na query: o elemento <audio> não manda header. */
  urlDoAudio(rotaRelativa: string): string {
    return `${this.config.rota(rotaRelativa)}?token=${encodeURIComponent(this.config.token())}`;
  }

  /**
   * A apresentação falada da abertura, com os números das checagens.
   *
   * A API junta clima, lembretes, sites e servidor em paralelo (3 s de prazo cada) e faz UMA
   * chamada ao Claude, com cache de 2 minutos — duas palmas seguidas não geram duas introduções.
   */
  inicializacao(): Promise<Introducao> {
    return firstValueFrom(
      this.http.post<Introducao>(this.config.rota('/api/inicializacao'), null, {
        headers: this.autorizacao(),
        timeout: 15_000,
      }),
    );
  }

  statusVoz(): Promise<StatusVoz> {
    return firstValueFrom(
      this.http.get<StatusVoz>(this.config.rota('/api/voz/status'), {
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

  statusGoogle(): Promise<{ configurado: boolean; autorizado: boolean }> {
    return firstValueFrom(this.http.get<{ configurado: boolean; autorizado: boolean }>(
      this.config.rota('/api/google/status'), { headers: this.autorizacao() }));
  }

  iniciarGoogle(): Promise<{ url: string }> {
    return firstValueFrom(this.http.post<{ url: string }>(
      this.config.rota('/api/google/oauth/iniciar'), null, { headers: this.autorizacao() }));
  }

  /** O modo da IA e quem está pensando; quem chama valida o corpo com `lerModoIa`. */
  modoIa(): Promise<unknown> {
    return firstValueFrom(
      this.http.get<unknown>(this.config.rota('/api/ia/modo'), { headers: this.autorizacao() }),
    );
  }

  /** Só pede a troca: a confirmação chega pelo evento SSE `ia.modo`. */
  definirModoIa(modo: ModoIa): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(this.config.rota('/api/ia/modo'), { modo }, { headers: this.autorizacao() }),
    );
  }

  private autorizacao(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${this.config.token()}` });
  }

  enviarEstadoTela(estado: EstadoTela): Promise<void> {
    return firstValueFrom(this.http.post<void>(this.config.rota('/api/tela/estado'), estado, { headers: this.autorizacao() }));
  }

  /** O retrato do holograma, para o Jarvis entender "disso" e "mais" (Fase 6). */
  enviarEstadoHolograma(estado: EstadoDoHolograma): Promise<void> {
    return firstValueFrom(this.http.post<void>(this.config.rota('/api/holograma/estado'), estado, { headers: this.autorizacao() }));
  }

  /** O bilhete de uso único (30 s) que abre o `/ws/holograma`: o token nunca vai na URL do socket. */
  async bilheteDoCanal(): Promise<string> {
    const { bilhete } = await firstValueFrom(this.http.post<{ bilhete: string }>(
      this.config.rota('/api/holograma/controle/bilhete'), null, { headers: this.autorizacao() }));
    return bilhete;
  }
}
