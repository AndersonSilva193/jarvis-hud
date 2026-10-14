import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ConversaService } from '../../nucleo/conversa.service';
import { BarraConversaComponent } from '../../componentes/conversa/barra-conversa';
import { RespostaConversaComponent } from '../../componentes/conversa/resposta-conversa';
import { HistoricoConversaComponent } from '../../componentes/conversa/historico-conversa';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';

import { CardClimaComponent } from '../../componentes/card-clima/card-clima';
import { CardLembretesComponent } from '../../componentes/card-lembretes/card-lembretes';
import { CardNoticiaComponent } from '../../componentes/card-noticia/card-noticia';
import { CardSistemasComponent } from '../../componentes/card-sistemas/card-sistemas';
import { CardTextoComponent } from '../../componentes/card-texto/card-texto';
import { OrbeComponent, type EstadoOrbe } from '../../componentes/orbe/orbe';
import { BriefingPlayerService } from '../../nucleo/briefing-player.service';
import {
  normalizar,
  EscutaService,
  contem,
  respostaDasObservacoes,
} from '../../nucleo/escuta.service';
import { JarvisApiService } from '../../nucleo/jarvis-api.service';
import { JarvisEventosService } from '../../nucleo/jarvis-eventos.service';
import { VozService } from '../../nucleo/voz.service';
import { contextoBriefing } from '../../nucleo/horario-briefing';
import type { Bloco, Briefing } from '../../nucleo/briefing.modelos';

/** Tempo parado até o cursor sumir: o HUD vive num monitor, sem ninguém mexendo no mouse. */
const OCIOSO_ATE_ESCONDER_MS = 5_000;

/** A pergunta do fim do briefing, e quanto tempo ele espera o "sim". */
const PERGUNTA_DAS_OBSERVACOES = 'O senhor quer ouvir as observações?';
const JANELA_DA_RESPOSTA_MS = 8_000;
/** Duas frases finais no mesmo fôlego não podem pedir dois briefings. */
const DESCANSO_DA_ATIVACAO_MS = 3_000;

/**
 * A tela do HUD: orbe no centro, o bloco atual por cima dele e os já falados numa fileira.
 *
 * Três coisas podem trazer um briefing — o botão, o `/bomdia` do Telegram e o cron das 8h — e as
 * duas últimas chegam sem clique nenhum, então a tela se monta sozinha a partir do SSE.
 */
@Component({
  selector: 'app-hud',
  imports: [
    BarraConversaComponent,
    RespostaConversaComponent,
    HistoricoConversaComponent,
    OrbeComponent,
    CardClimaComponent,
    CardLembretesComponent,
    CardNoticiaComponent,
    CardSistemasComponent,
    CardTextoComponent,
    RouterLink,
  ],
  templateUrl: './hud.page.html',
  styleUrls: ['./hud.page.scss', './fileira.scss', './conversa.scss'],
})
export class HudPage implements OnInit, OnDestroy {
  protected readonly conversa = inject(ConversaService);
  protected readonly rascunho = signal('');
  protected readonly briefingGuardado = signal<Briefing | null>(null);
  protected readonly player = inject(BriefingPlayerService);
  protected readonly voz = inject(VozService);
  protected readonly eventos = inject(JarvisEventosService);
  protected readonly escuta = inject(EscutaService);
  private readonly api = inject(JarvisApiService);

  protected readonly pedindo = signal(false);
  protected readonly erro = signal('');

  protected readonly estadoOrbe = computed<EstadoOrbe>(() => {
    if (this.conversa.ocupada()) return 'pensando';
    if (this.player.fase() === 'gerando') {
      return 'gerando';
    }
    return this.voz.falando() ? 'falando' : this.escuta.ouvindo() ? 'ouvindo' : 'ocioso';
  });

  protected readonly estadoDaConexao = computed(() => {
    switch (this.eventos.status()) {
      case 'online':
        return 'conectado';
      case 'conectando':
        return 'conectando';
      case 'reconectando':
        switch (this.eventos.motivo()) {
          case 'token-invalido':
            return 'token inválido';
          case 'api-inacessivel':
            return 'api fora do ar';
          default:
            return 'reconectando';
        }
      default:
        return 'desligado';
    }
  });

  protected readonly blocoNoPalco = computed(() => this.player.selecionado() ?? this.player.atual());
  /** Zero ou um: é lista para o `@for` dar identidade ao card e animar a entrada e a saída dele. */
  protected readonly palco = computed(() => { const bloco = this.blocoNoPalco(); return bloco ? [bloco] : []; });
  /** Sem nada no palco o orbe cresce e assume o centro — é o Jarvis em repouso, sem card por cima. */
  protected readonly orbeLivre = computed(() => !this.conversa.naTela() && this.palco().length === 0);
  protected readonly concluidos = computed(() => this.player.blocos().slice(0, Math.max(0,this.player.indiceAtual())));
  protected readonly geracaoBriefing = computed(() => { const b = this.player.briefing(); return b ? contextoBriefing(b).geracao : ''; });
  protected readonly estadoApresentacao = computed(() => {
    if (this.voz.falando()) return 'Falando';
    if (this.escuta.aguardandoResposta()) return 'Aguardando resposta';
    if (this.conversa.ocupada()) return this.conversa.progresso() || 'Pensando';
    // Na fase `gerando` quem tem o texto é a fila; aqui em cima fica só a decisão de qual estado mostrar.
    if (this.player.fase() === 'gerando') return this.player.legenda();
    if (this.pedindo()) return 'Preparando briefing';
    if (this.escuta.ouvindo()) return this.escuta.ditando() ? 'Ouvindo sua mensagem' : 'Ouvindo';
    return 'Às suas ordens';
  });
  protected consultarCard(bloco: Bloco): void { this.player.consultar(bloco); }
  protected resumoCard(bloco: Bloco): string {
    switch(bloco.tipo) {
      case 'clima': return bloco.dados.temperaturaAtual + '° · ' + bloco.dados.cidade;
      case 'lembretes': return bloco.dados.itens.length ? bloco.dados.itens.length + ' lembrete(s)' : 'Agenda livre';
      case 'sistemas': return bloco.dados.sites.length + ' site(s) monitorado(s)';
      case 'noticia': return bloco.dados.titulo;
      default: return bloco.linhas[0] ?? bloco.rotulo;
    }
  }

  private ocioso: ReturnType<typeof setTimeout> | null = null;
  private ultimaAtivacao = -Infinity;
  private ativa = true;
  private observacoes: AbortController | null = null;

  constructor() {
    effect(() => {
      if (this.escuta.ditando()) this.rascunho.set(this.escuta.transcricao());
    });
  }

  ngOnInit(): void {
    this.conversa.abrir();
    this.eventos.conectar({
      gerando: () => {
        if (!this.conversa.naTela() && !this.escuta.ditando()) this.player.gerando();
      },
      briefing: (briefing) => {
        if (this.conversa.naTela() || this.escuta.ditando()) this.briefingGuardado.set(briefing);
        else void this.player.tocar(briefing);
      },
      conectado: () => void this.conversa.recuperar(),
      pensando: (pedido) => {
        this.escuta.cancelarDitado();
        this.conversa.pensando(pedido);
      },
      ferramenta: (progresso) => this.conversa.ferramenta(progresso),
      resposta: (resposta) => this.conversa.receber(resposta),
      erroConversa: (resposta) => this.conversa.receber(resposta),
      historico: () => void this.conversa.recuperar(),
    });

    // Conectar no SSE não traz nada: quem pinta a tela ao abrir é o último briefing.
    this.api
      .ultimoBriefing()
      .then((briefing) => {
        if (briefing && this.ativa) {
          if (this.conversa.naTela() || this.escuta.ditando()) this.briefingGuardado.set(briefing);
          else this.player.mostrar(briefing);
        }
      })
      .catch(() => {
        // O estado da conexão no rodapé já conta essa história.
      });

    // A escuta abre sozinha quando ficou ligada da última vez: num monitor 24 h, pedir um clique
    // a cada recarga não faz sentido. O que o clique traz é o destravar() da fala.
    this.escuta.escutar((frase) => this.aoOuvir(frase));
    this.player.epilogo = (briefing, sinal) => this.perguntarObservacoes(briefing, sinal);

    window.addEventListener('keydown', this.aoTeclar);
    window.addEventListener('mousemove', this.aoMexerOMouse);
    this.agendarEsconderCursor();
  }

  ngOnDestroy(): void {
    this.ativa = false;
    this.conversa.fechar();
    this.eventos.desconectar();
    this.player.parar();
    this.player.epilogo = null;
    this.escuta.soltarMicrofone();
    window.removeEventListener('keydown', this.aoTeclar);
    window.removeEventListener('mousemove', this.aoMexerOMouse);
    if (this.ocioso !== null) {
      clearTimeout(this.ocioso);
    }
    document.body.classList.remove('sem-cursor');
  }

  /**
   * Pede um briefing novo pelo botão.
   *
   * O destravar() tem de acontecer dentro do clique, senão o Chrome recusa a fala.
   */
  protected async bomDia(): Promise<void> {
    if (this.conversa.ocupada()) return;
    this.escuta.cancelarDitado();
    this.conversa.mostrarBriefing();
    this.voz.destravar();
    await this.pedirBriefing();
  }

  /**
   * Liga e desliga o microfone.
   *
   * O destravar() vem antes de propósito: este clique é o gesto que o Chrome exige para falar, e
   * sem ele o primeiro "bom dia" ouvido numa aba recém-aberta traria um briefing mudo.
   */
  protected alternarEscuta(): void {
    this.voz.destravar();
    if (this.escuta.ligada()) this.observacoes?.abort();
    this.escuta.alternar();
  }

  /**
   * O briefing que volta aqui é tocado direto porque, se a API reaproveitar um de menos de 60 s,
   * ela não emite nada no SSE — o pedido ficaria sem resposta.
   */
  private async pedirBriefing(): Promise<void> {
    if (!this.ativa || this.pedindo()) return;
    this.pedindo.set(true);
    this.erro.set('');
    try {
      const briefing = await this.api.gerarBriefing();
      if (this.ativa) {
        if (this.conversa.naTela() || this.escuta.ditando()) this.briefingGuardado.set(briefing);
        else void this.player.tocar(briefing);
      }
    } catch (erro) {
      this.erro.set(explicar(erro));
    } finally {
      this.pedindo.set(false);
    }
  }

  /**
   * Cada frase ouvida. A palavra de ativação só vale com a tela parada: no meio de um briefing o
   * microfone está pausado de todo jeito, e o descanso evita que duas frases do mesmo fôlego
   * peçam dois briefings.
   */
  private aoOuvir(frase: string): void {
    if (this.conversa.ocupada() || this.escuta.ditando()) return;
    if (!this.ativa || !this.escuta.ligada() || this.voz.falando()) return;
    const fase = this.player.fase();
    if (fase !== 'ocioso' && fase !== 'concluido') {
      return;
    }
    if (this.pedindo() || Date.now() - this.ultimaAtivacao < DESCANSO_DA_ATIVACAO_MS) {
      return;
    }
    const saudacao = normalizar(frase)
      .replace(/[^a-z ]/g, '')
      .trim();
    if (/^(?:(?:bom dia|boa tarde|boa noite)(?: jarvis)?|jarvis (?:bom dia|boa tarde|boa noite))$/.test(saudacao)) {
      this.ultimaAtivacao = Date.now();
      this.conversa.mostrarBriefing();
      void this.pedirBriefing();
    } else if (contem(frase, ['jarvis'])) {
      this.ultimaAtivacao = Date.now();
      void this.ditar(frase.replace(/^.*?\bjarvis\b[\s,.:!-]*/i, ''));
    }
  }

  /**
   * O fim do briefing: ele oferece as observações e escuta a resposta por alguns segundos.
   *
   * Sem microfone ligado a pergunta não é feita — ficaria uma pergunta no vazio. Sem
   * encerramento (backend antigo, ou narração que falhou) também não há o que oferecer.
   */
  private async perguntarObservacoes(briefing: Briefing, sinal: AbortSignal): Promise<void> {
    const encerramento = briefing.encerramento?.trim() ?? '';
    if (!encerramento || !this.escuta.ligada() || !this.ativa || sinal.aborted) return;
    const controle = new AbortController();
    this.observacoes?.abort();
    this.observacoes = controle;
    const cancelar = () => controle.abort();
    sinal.addEventListener('abort', cancelar, { once: true });
    try {
      await this.voz.falar(PERGUNTA_DAS_OBSERVACOES, controle.signal);
      if (controle.signal.aborted || !this.escuta.ligada()) return;
      const resposta = await this.escuta.ouvirPor(
        JANELA_DA_RESPOSTA_MS,
        controle.signal,
        (frase) => respostaDasObservacoes(frase) !== null,
      );
      if (
        !controle.signal.aborted &&
        this.escuta.ligada() &&
        respostaDasObservacoes(resposta) === 'sim'
      ) {
        await this.voz.falar(encerramento, controle.signal);
      }
    } finally {
      sinal.removeEventListener('abort', cancelar);
      if (this.observacoes === controle) this.observacoes = null;
    }
  }

  protected async enviarTexto(comando?: string): Promise<void> {
    const texto = comando ?? this.rascunho();
    this.voz.destravar();
    this.escuta.cancelarDitado();
    if (await this.conversa.enviar(texto)) {
      if (comando === undefined && this.rascunho() === texto) this.rascunho.set('');
    }
  }

  protected async ditar(inicial = ''): Promise<void> {
    if (this.conversa.ocupada()) return;
    if (this.escuta.ditando()) {
      this.escuta.cancelarDitado();
      return;
    }
    this.voz.destravar();
    this.conversa.assumirPalco();
    const texto = await this.escuta.ditar(inicial);
    if (!this.ativa || !texto) return;
    this.rascunho.set(texto);
    const confirmacao = this.conversa.resposta()?.confirmacao;
    const codigo = normalizarCodigo(texto);
    if (
      confirmacao &&
      Date.parse(confirmacao.expiraEm) > Date.now() &&
      codigo === normalizarCodigo(confirmacao.codigo)
    ) {
      await this.enviarTexto('confirmo ' + confirmacao.codigo);
    } else await this.enviarTexto();
  }

  protected consultarBriefing(): void {
    if (this.conversa.ocupada()) return;
    this.escuta.cancelarDitado();
    this.conversa.mostrarBriefing();
    const briefing = this.briefingGuardado();
    if (briefing) {
      this.player.mostrar(briefing);
      this.briefingGuardado.set(null);
    }
  }

  protected limparConversa(): void {
    if (
      !this.conversa.ocupada() &&
      window.confirm('Apagar o histórico compartilhado da HUD e do Telegram?')
    ) {
      this.escuta.cancelarDitado();
      void this.conversa.limpar();
    }
  }

  private readonly aoTeclar = (evento: KeyboardEvent): void => {
    if (evento.key === 'Escape') {
      this.escuta.cancelarDitado();
      this.voz.parar();
      // Fechar a consulta antes de parar: o palco volta a ficar vazio e o orbe retoma o centro.
      this.player.fecharConsulta();
      this.player.parar();
      return;
    }
    if (
      evento.target instanceof HTMLElement &&
      (evento.target.closest('input, textarea, button, [contenteditable=true]') ||
        this.conversa.naTela())
    )
      return;
    if (evento.key === 'ArrowRight') {
      this.player.pular();
    }
  };

  private readonly aoMexerOMouse = (): void => {
    document.body.classList.remove('sem-cursor');
    this.agendarEsconderCursor();
  };

  private agendarEsconderCursor(): void {
    if (this.ocioso !== null) {
      clearTimeout(this.ocioso);
    }
    this.ocioso = setTimeout(
      () => document.body.classList.add('sem-cursor'),
      OCIOSO_ATE_ESCONDER_MS,
    );
  }
}

function explicar(erro: unknown): string {
  if (erro instanceof HttpErrorResponse) {
    if (erro.status === 401 || erro.status === 403) {
      return 'token recusado pela API';
    }
    if (erro.status === 0) {
      return 'não consegui falar com a API';
    }
    return `a API respondeu ${erro.status}`;
  }
  return 'não consegui pedir o briefing';
}

/** Aceita também códigos numéricos ditados dígito por dígito. */
function normalizarCodigo(texto: string): string {
  const digitos: Record<string, string> = {
    zero: '0',
    um: '1',
    uma: '1',
    dois: '2',
    duas: '2',
    tres: '3',
    quatro: '4',
    cinco: '5',
    seis: '6',
    sete: '7',
    oito: '8',
    nove: '9',
  };
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .map((parte) => digitos[parte] ?? parte)
    .join('');
}
