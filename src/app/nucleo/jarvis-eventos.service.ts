import { Injectable, inject, signal } from '@angular/core';

import { ConfigStore } from './config.store';
import { JarvisApiService, type ResultadoTeste } from './jarvis-api.service';
import type { Briefing } from './briefing.modelos';

export type StatusConexao = 'desligado' | 'conectando' | 'online' | 'reconectando';

/** Quando cai, o motivo provável — o EventSource não conta, então a gente vai perguntar. */
export type MotivoQueda = 'token-invalido' | 'api-inacessivel' | null;

export interface OuvintesDoBriefing {
  gerando: () => void;
  briefing: (briefing: Briefing) => void;
}

const ESPERA_INICIAL_MS = 1_000;
const ESPERA_MAXIMA_MS = 30_000;
const INTERVALO_DA_INVESTIGACAO_MS = 15_000;

/**
 * A conexão SSE com /api/briefing/eventos, que se reconecta sozinha.
 *
 * A API emite só dois eventos nomeados — `gerando` e `briefing` — e um comentário de keep-alive a
 * cada 25 s, que não dispara nada e não precisa de tratamento. Conectar não traz estado nenhum:
 * quem abre o HUD busca /api/briefing/ultimo para pintar a tela.
 *
 * O token vai na query string porque o EventSource do navegador não sabe mandar header; essa é a
 * única rota da API que aceita isso.
 */
@Injectable({ providedIn: 'root' })
export class JarvisEventosService {
  private readonly config = inject(ConfigStore);
  private readonly api = inject(JarvisApiService);

  readonly status = signal<StatusConexao>('desligado');
  readonly motivo = signal<MotivoQueda>(null);

  private fonte: EventSource | null = null;
  private ouvintes: OuvintesDoBriefing | null = null;
  private tentativas = 0;
  private agendamento: ReturnType<typeof setTimeout> | null = null;
  private investigando = false;
  private ultimaInvestigacao = 0;

  conectar(ouvintes: OuvintesDoBriefing): void {
    this.ouvintes = ouvintes;
    this.tentativas = 0;
    this.abrir();
  }

  desconectar(): void {
    this.ouvintes = null;
    this.cancelarAgendamento();
    this.fechar();
    this.status.set('desligado');
    this.motivo.set(null);
  }

  private abrir(): void {
    this.fechar();
    if (!this.config.configurado()) {
      this.status.set('desligado');
      return;
    }
    this.status.set(this.tentativas === 0 ? 'conectando' : 'reconectando');

    const url = `${this.config.rota('/api/briefing/eventos')}?token=${encodeURIComponent(this.config.token())}`;
    // Sem withCredentials: a API não libera credenciais no CORS.
    const fonte = new EventSource(url);
    this.fonte = fonte;

    fonte.onopen = () => {
      this.tentativas = 0;
      this.motivo.set(null);
      this.status.set('online');
    };

    fonte.addEventListener('gerando', () => this.ouvintes?.gerando());

    fonte.addEventListener('briefing', (evento) => {
      const briefing = interpretar(evento);
      if (briefing) {
        this.ouvintes?.briefing(briefing);
      }
    });

    fonte.onerror = () => {
      // CONNECTING = o próprio EventSource já está tentando de novo; CLOSED = morreu de vez
      // (é o que acontece com token inválido, porque a resposta não é um event-stream).
      if (fonte.readyState === EventSource.CLOSED) {
        this.reagendar();
      } else {
        this.status.set('reconectando');
        this.investigar();
      }
    };
  }

  /** Backoff exponencial com jitter, teto de 30 s. */
  private reagendar(): void {
    this.fechar();
    this.status.set('reconectando');
    this.investigar();

    const base = Math.min(ESPERA_MAXIMA_MS, ESPERA_INICIAL_MS * 2 ** this.tentativas);
    this.tentativas += 1;
    const espera = Math.round(base * (0.7 + Math.random() * 0.6));
    this.cancelarAgendamento();
    this.agendamento = setTimeout(() => this.abrir(), espera);
  }

  /**
   * O EventSource não diz por que caiu, então perguntamos por HTTP: é token inválido ou a API
   * está fora do ar? Uma investigação por vez, e no máximo a cada 15 s — o retry nativo do
   * EventSource é de 3 s, e cada investigação são duas requisições.
   */
  private investigar(): void {
    const agora = Date.now();
    if (this.investigando || agora - this.ultimaInvestigacao < INTERVALO_DA_INVESTIGACAO_MS) {
      return;
    }
    this.investigando = true;
    this.ultimaInvestigacao = agora;
    this.api
      .testar(this.config.urlApi(), this.config.token())
      .then((resultado) => this.motivo.set(motivoDe(resultado)))
      .catch(() => this.motivo.set('api-inacessivel'))
      .finally(() => {
        this.investigando = false;
      });
  }

  private fechar(): void {
    this.fonte?.close();
    this.fonte = null;
  }

  private cancelarAgendamento(): void {
    if (this.agendamento !== null) {
      clearTimeout(this.agendamento);
      this.agendamento = null;
    }
  }
}

function motivoDe(resultado: ResultadoTeste): MotivoQueda {
  switch (resultado) {
    case 'ok':
      return null;
    case 'token-invalido':
      return 'token-invalido';
    default:
      return 'api-inacessivel';
  }
}

function interpretar(evento: Event): Briefing | null {
  const dados = (evento as MessageEvent<string>).data;
  try {
    return JSON.parse(dados) as Briefing;
  } catch {
    console.error('Evento "briefing" com JSON inválido; ignorado.');
    return null;
  }
}
