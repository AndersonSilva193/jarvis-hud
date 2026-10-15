import { Injectable, inject, signal } from '@angular/core';

import { ConfigStore } from './config.store';
import { JarvisApiService, type ResultadoTeste } from './jarvis-api.service';
import type { PedidoConversa, ProgressoConversa, RespostaConversa } from './conversa.modelos';
import type { Briefing } from './briefing.modelos';
import { lerCardTela, lerComandoTela, type CardTela, type ComandoTela } from './tela.modelos';

export type StatusConexao = 'desligado' | 'conectando' | 'online' | 'reconectando';

/** Quando cai, o motivo provável — o EventSource não conta, então a gente vai perguntar. */
export type MotivoQueda = 'token-invalido' | 'api-inacessivel' | null;

export interface OuvintesDoBriefing {
  card?: (card: CardTela) => void;
  comando?: (comando: ComandoTela) => void;
  conectado?: () => void;
  pensando?: (pedido: PedidoConversa) => void;
  ferramenta?: (progresso: ProgressoConversa) => void;
  resposta?: (resposta: RespostaConversa) => void;
  erroConversa?: (resposta: RespostaConversa) => void;
  historico?: () => void;
  gerando: () => void;
  briefing: (briefing: Briefing) => void;
}

const ESPERA_INICIAL_MS = 1_000;
const ESPERA_MAXIMA_MS = 30_000;
const INTERVALO_DA_INVESTIGACAO_MS = 15_000;

/**
 * A conexão SSE com /api/eventos, que se reconecta sozinha.
 *
 * Recebe briefing e eventos conversa.*; cada abertura avisa a página para recuperar o estado.
 * O keep-alive a cada 25 s é um comentário. O token vai na query porque EventSource não envia
 * headers; downloads de anexos da HUD usam Bearer.
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
  private geracao = 0;
  private ultimaInvestigacao = 0;

  conectar(ouvintes: OuvintesDoBriefing): void {
    this.geracao++;
    this.cancelarAgendamento();
    this.ouvintes = ouvintes;
    this.tentativas = 0;
    this.abrir();
  }

  desconectar(): void {
    this.geracao++;
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

    const url = `${this.config.rota('/api/eventos')}?token=${encodeURIComponent(this.config.token())}`;
    // Sem withCredentials: a API não libera credenciais no CORS.
    const fonte = new EventSource(url);
    this.fonte = fonte;

    fonte.onopen = () => {
      if (this.fonte !== fonte) return;
      this.tentativas = 0;
      this.motivo.set(null);
      this.status.set('online');
      this.ouvintes?.conectado?.();
    };

    fonte.addEventListener('gerando', () => {
      if (this.fonte === fonte) this.ouvintes?.gerando();
    });

    fonte.addEventListener('briefing', (evento) => {
      if (this.fonte !== fonte) return;
      const briefing = interpretar<Briefing>(evento);
      if (briefing) {
        this.ouvintes?.briefing(briefing);
      }
    });

    const receber = <T>(nome: string, tratar: (dados: T) => void) => {
      fonte.addEventListener(nome, (evento) => {
        if (this.fonte !== fonte) return;
        const dados = interpretar<T>(evento);
        if (dados) tratar(dados);
      });
    };
    receber<PedidoConversa>('conversa.pensando', (dados) => this.ouvintes?.pensando?.(dados));
    receber<ProgressoConversa>('conversa.ferramenta', (dados) =>
      this.ouvintes?.ferramenta?.(dados),
    );
    receber<RespostaConversa>('conversa.resposta', (dados) => this.ouvintes?.resposta?.(dados));
    receber<RespostaConversa>('conversa.erro', (dados) => this.ouvintes?.erroConversa?.(dados));
    receber<unknown>('conversa.historico', () => this.ouvintes?.historico?.());
    receber<unknown>('tela.card', dados => { const card = lerCardTela(dados); if (card) this.ouvintes?.card?.(card); });
    receber<unknown>('tela.comando', dados => { const comando = lerComandoTela(dados); if (comando) this.ouvintes?.comando?.(comando); });

    fonte.onerror = () => {
      if (this.fonte !== fonte) return;
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
    const geracao = this.geracao;
    this.investigando = true;
    this.ultimaInvestigacao = agora;
    this.api
      .testar(this.config.urlApi(), this.config.token())
      .then((resultado) => {
        if (geracao === this.geracao) this.motivo.set(motivoDe(resultado));
      })
      .catch(() => {
        if (geracao === this.geracao) this.motivo.set('api-inacessivel');
      })
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

function interpretar<T>(evento: Event): T | null {
  const dados = (evento as MessageEvent<string>).data;
  try {
    return JSON.parse(dados) as T;
  } catch {
    console.error('Evento SSE com JSON inválido; ignorado.');
    return null;
  }
}
