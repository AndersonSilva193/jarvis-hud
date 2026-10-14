import { Service, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { JarvisApiService } from './jarvis-api.service';
import { ConfigStore } from './config.store';
import { VozService } from './voz.service';
import { BriefingPlayerService } from './briefing-player.service';
import type {
  HistoricoConversa,
  PedidoConversa,
  ProgressoConversa,
  RespostaConversa,
  TrocaConversa,
} from './conversa.modelos';

/** Estado da conversa e recuperação. Nunca repete um POST de resultado incerto. */
@Service()
export class ConversaService {
  private readonly api = inject(JarvisApiService);
  private readonly config = inject(ConfigStore);
  private readonly voz = inject(VozService);
  private readonly player = inject(BriefingPlayerService);
  readonly resposta = signal<RespostaConversa | null>(null);
  readonly trocas = signal<TrocaConversa[]>([]);
  readonly pendente = signal<string | null>(null);
  readonly enviando = signal(false);
  readonly incerto = signal(false);
  readonly limpando = signal(false);
  readonly erro = signal('');
  readonly progresso = signal('');
  readonly naTela = signal(false);
  readonly ocupada = computed(
    () => !!this.pendente() || this.enviando() || this.incerto() || this.limpando(),
  );
  private ativa = false;
  private geracao = 0;
  private consulta = 0;
  private sessao = '';
  private revisao = -1;
  private readonly faladas = new Set<string>();
  private readonly encerradas = new Set<string>();

  abrir(): void {
    this.ativa = true;
    this.geracao++;
    try {
      this.pendente.set(sessionStorage.getItem(this.chave()));
    } catch {
      /* Sem persistência. */
    }
    void this.recuperar();
  }
  fechar(): void {
    this.ativa = false;
    this.geracao++;
    this.consulta++;
    if (this.enviando()) this.incerto.set(true);
    this.enviando.set(false);
    this.limpando.set(false);
    this.voz.parar();
  }
  assumirPalco(): void {
    this.player.parar();
    this.naTela.set(true);
  }
  mostrarBriefing(): void {
    if (!this.ocupada()) {
      this.voz.parar();
      this.naTela.set(false);
    }
  }

  async enviar(texto: string): Promise<boolean> {
    texto = texto.trim();
    if (!this.ativa || this.ocupada() || !texto || texto.length > 8000) return false;
    const geracao = this.geracao;
    this.consulta++;
    this.assumirPalco();
    this.enviando.set(true);
    this.erro.set('');
    this.progresso.set('Enviando pedido…');
    try {
      const aceito = await this.api.enviarConversa(texto);
      if (!this.ativa || geracao !== this.geracao) return true;
      // O SSE pode concluir antes de chegar a resposta HTTP 202.
      if (!this.encerradas.has(aceito.id)) this.guardarPendente(aceito.id);
      return true;
    } catch (erro) {
      if (!this.ativa || geracao !== this.geracao) return false;
      if (erro instanceof HttpErrorResponse && erro.status !== 0) {
        this.erro.set(
          erro.status === 409
            ? 'Aguarde o pedido atual terminar.'
            : 'O pedido foi recusado pela API.',
        );
      } else {
        this.incerto.set(true);
        this.erro.set('Conexão interrompida. Verificando se o pedido foi recebido…');
      }
      return false;
    } finally {
      if (this.ativa && geracao === this.geracao) {
        this.enviando.set(false);
        void this.recuperar();
      }
    }
  }

  pensando(pedido: PedidoConversa): void {
    if (!this.ativa || pedido.canal !== 'hud' || this.encerradas.has(pedido.id)) return;
    this.consulta++;
    this.assumirPalco();
    this.guardarPendente(pedido.id);
    this.progresso.set(pedido.estado === 'aguardando' ? 'Aguardando a vez…' : 'Pensando…');
  }
  ferramenta(progresso: ProgressoConversa): void {
    if (!this.ativa || progresso.id !== this.pendente()) return;
    const etapas =
      Number.isInteger(progresso.passo) &&
      Number.isInteger(progresso.total) &&
      (progresso.passo ?? 0) > 0 &&
      (progresso.total ?? 0) >= (progresso.passo ?? 0);
    this.progresso.set(
      progresso.descricao + (etapas ? `, passo ${progresso.passo} de ${progresso.total}` : ''),
    );
  }
  receber(resposta: RespostaConversa, narrar = true): void {
    if (!this.ativa || resposta.canal !== 'hud' || this.encerradas.has(resposta.id)) return;
    this.consulta++; // Uma leitura anterior ao evento não pode sobrescrevê-lo.
    this.encerradas.add(resposta.id);
    this.incerto.set(false);
    this.resposta.set(resposta);
    this.naTela.set(true);
    if (this.pendente() === resposta.id) this.guardarPendente(null);
    this.progresso.set('');
    this.erro.set(resposta.erro ?? '');
    if (narrar && !resposta.erro && !this.faladas.has(resposta.id)) {
      this.player.parar();
      this.faladas.add(resposta.id);
      void this.voz.falar(resposta.texto);
    }
    void this.recuperar();
  }

  async recuperar(): Promise<void> {
    if (!this.ativa || this.enviando()) return;
    const consulta = ++this.consulta;
    const geracao = this.geracao;
    const esperado = this.pendente();
    try {
      const [historico, ultima] = await Promise.all([
        this.api.historicoConversa(),
        this.api.ultimaConversa(),
      ]);
      if (!this.ativa || geracao !== this.geracao || consulta !== this.consulta) return;
      // O histórico contém a última resposta no mesmo retrato atômico; /ultima confirma recuperação.
      this.aplicarHistorico(historico, esperado, ultima);
    } catch {
      // SSE e o diagnóstico de conexão controlam as novas tentativas. Não reenviar a mensagem.
    }
  }
  private aplicarHistorico(
    h: HistoricoConversa,
    esperado: string | null,
    ultima: RespostaConversa | null,
  ): void {
    if (this.sessao === h.sessao && h.revisao < this.revisao) return;
    const reiniciou = !!this.sessao && this.sessao !== h.sessao;
    this.sessao = h.sessao;
    this.revisao = h.revisao;
    this.trocas.set(h.trocas.slice(-10));
    const estavaIncerto = this.incerto();
    this.incerto.set(false);
    const resposta = h.ultima;
    if (resposta && !this.encerradas.has(resposta.id)) {
      this.receber(resposta, !reiniciou && esperado === resposta.id && ultima?.id === resposta.id);
    } else if (!resposta) {
      this.resposta.set(null);
    }
    this.guardarPendente(h.emAndamento?.id ?? null);
    if (h.emAndamento) {
      this.erro.set('');
      this.pensando(h.emAndamento);
    } else if (estavaIncerto && !esperado) {
      this.progresso.set('');
      this.erro.set(
        resposta?.id === this.resposta()?.id && resposta
          ? (resposta.erro ?? '')
          : 'Nenhum pedido em andamento foi encontrado. Você pode enviar novamente.',
      );
    } else if (esperado && resposta?.id !== esperado && !this.encerradas.has(esperado)) {
      this.progresso.set('');
      this.erro.set(
        'O pedido foi interrompido ou o histórico foi limpo. Você pode enviar novamente.',
      );
    }
  }
  async limpar(): Promise<void> {
    if (this.ocupada()) return;
    const geracao = this.geracao;
    this.consulta++;
    this.limpando.set(true);
    this.voz.parar();
    try {
      await this.api.limparConversa();
      if (!this.ativa || geracao !== this.geracao) return;
      this.resposta.set(null);
      this.trocas.set([]);
      this.erro.set('');
      this.progresso.set('');
      this.guardarPendente(null);
      await this.recuperar();
    } catch {
      if (this.ativa && geracao === this.geracao) this.erro.set('Não consegui limpar a conversa.');
    } finally {
      if (geracao === this.geracao) this.limpando.set(false);
    }
  }
  private chave(): string {
    return `jarvis-hud.pedido:${this.config.urlApi()}`;
  }
  private guardarPendente(id: string | null): void {
    this.pendente.set(id);
    try {
      if (id) sessionStorage.setItem(this.chave(), id);
      else sessionStorage.removeItem(this.chave());
    } catch {
      /* A conversa também funciona sem sessionStorage. */
    }
  }
}
