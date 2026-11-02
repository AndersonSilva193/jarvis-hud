import { JanelaComponent } from '../../componentes/janela/janela';
import { ConteudoJanelaComponent } from '../../componentes/janela/conteudo-janela';
import { TelaService } from '../../nucleo/tela.service';
import { TelaEstadoService } from '../../nucleo/tela-estado.service';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  afterRenderEffect,
  viewChild,
  ElementRef,
} from '@angular/core';
import { ConversaService } from '../../nucleo/conversa.service';
import { BarraConversaComponent } from '../../componentes/conversa/barra-conversa';
import { DialogoConversaComponent } from '../../componentes/conversa/dialogo-conversa';
import { PainelHudComponent } from '../../componentes/painel-hud/painel-hud';
import { LegendaVozComponent } from '../../componentes/conversa/legenda-voz';
import { FerramentasHologramaComponent } from '../../componentes/holograma/ferramentas-holograma';
import { PainelHudService } from '../../nucleo/painel-hud.service';
import { HttpErrorResponse } from '@angular/common/http';
import { NgOptimizedImage, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { HologramaViewComponent } from '../../componentes/holograma/holograma-view';
import { InicializacaoComponent } from '../../componentes/inicializacao/inicializacao';
import { NucleoJarvisComponent } from '../../componentes/nucleo-jarvis/nucleo-jarvis';
import { IconeHudComponent } from '../../componentes/icone-hud/icone-hud';
import {
  AgenteHudComponent,
  AtividadesHudComponent,
  CapacidadesHudComponent,
  ExecucoesHudComponent,
  MemoriaHudComponent,
} from '../../componentes/paineis-agente/paineis-agente';
import { AtividadeHudService, type EstadoJarvis } from '../../nucleo/atividade-hud.service';
import { BriefingPlayerService } from '../../nucleo/briefing-player.service';
import { normalizar, EscutaService, contem } from '../../nucleo/escuta.service';
import { EscutaDeRespostaService } from '../../nucleo/escuta-de-resposta.service';
import { normalizarCodigo } from '../../nucleo/normalizar-codigo';
import { JarvisApiService, type TarefaComputer } from '../../nucleo/jarvis-api.service';
import { ComandosDoHologramaService } from '../../nucleo/comandos-do-holograma.service';
import { HologramaEstadoService } from '../../nucleo/holograma-estado.service';
import { HologramaService } from '../../nucleo/holograma.service';
import { InicializacaoService } from '../../nucleo/inicializacao.service';
import { JarvisEventosService } from '../../nucleo/jarvis-eventos.service';
import { VozService } from '../../nucleo/voz.service';
import { VozCotaService } from '../../nucleo/voz-cota.service';
import { contextoBriefing } from '../../nucleo/horario-briefing';
import type { Bloco, Briefing } from '../../nucleo/briefing.modelos';

/** Tempo parado até o cursor sumir: o HUD vive num monitor, sem ninguém mexendo no mouse. */
const OCIOSO_ATE_ESCONDER_MS = 5_000;

/** O relógio do cabeçalho: um HUD sem hora na tela não parece um HUD. */
const RELOGIO_MS = 1_000;

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
    JanelaComponent,
    ConteudoJanelaComponent,
    BarraConversaComponent,
    DialogoConversaComponent,
    PainelHudComponent,
    LegendaVozComponent,
    FerramentasHologramaComponent,
    NucleoJarvisComponent,
    IconeHudComponent,
    AgenteHudComponent,
    AtividadesHudComponent,
    CapacidadesHudComponent,
    ExecucoesHudComponent,
    MemoriaHudComponent,
    InicializacaoComponent,
    HologramaViewComponent,
    RouterLink,
    NgTemplateOutlet,
    NgOptimizedImage,
  ],
  templateUrl: './hud.page.html',
  styleUrls: [
    './hud.page.scss',
    './fileira.scss',
    './dashboard.scss',
    './estudio.scss',
    './estudio-dock.scss',
    './instrumentos.scss',
    './workspace.scss',
  ],
})
export class HudPage implements OnInit, OnDestroy {
  protected readonly tela = inject(TelaService);
  protected readonly janelas = this.tela.janelas;
  protected readonly midia = this.tela.midia;
  private readonly estadoTela = inject(TelaEstadoService);
  private readonly areaJanelas = viewChild<ElementRef<HTMLElement>>('areaJanelas');
  private readonly bandejaPlayer = viewChild<ElementRef<HTMLElement>>('bandejaPlayer');
  private readonly atalhoFerramentas =
    viewChild<ElementRef<HTMLButtonElement>>('atalhoFerramentas');

  protected readonly conversa = inject(ConversaService);
  protected readonly painel = inject(PainelHudService);
  protected readonly tituloPainel = computed(
    () =>
      ({
        conversa: 'Conversa',
        ferramentas: 'Ferramentas',
        memoria: 'Memória',
        execucoes: 'Execuções',
      })[this.painel.ativo() ?? 'conversa'],
  );
  private readonly ditadoNoEditor = signal(false);
  protected readonly rascunho = signal('');
  protected readonly briefingGuardado = signal<Briefing | null>(null);
  protected readonly player = inject(BriefingPlayerService);
  protected readonly voz = inject(VozService);
  protected readonly cota = inject(VozCotaService);
  protected readonly eventos = inject(JarvisEventosService);
  protected readonly escuta = inject(EscutaService);
  protected readonly escutaDeResposta = inject(EscutaDeRespostaService);
  protected readonly inicio = inject(InicializacaoService);
  protected readonly holograma = inject(HologramaService);
  protected readonly comandosDoHolograma = inject(ComandosDoHologramaService);
  /** Conta ao servidor como está o holograma; injetar já o liga. */
  private readonly estadoDoHolograma = inject(HologramaEstadoService);
  private readonly api = inject(JarvisApiService);

  protected readonly pedindo = signal(false);
  protected readonly erro = signal('');
  protected readonly tarefaComputer = signal<TarefaComputer | null>(null);
  protected readonly relogio = signal(agora());
  protected readonly horaVisivel = computed(() => this.relogio().split(' · ')[1] ?? '');
  protected readonly dataVisivel = computed(() => this.relogio().split(' · ')[0] ?? '');
  protected readonly atividade = inject(AtividadeHudService);
  protected readonly miniPlayerIsolado = computed(
    () => !this.janelas.visiveis().length && !!this.midia.bandeja() && !this.holograma.aberto(),
  );
  protected readonly workspaceAtivo = computed(() => !this.orbeLivre() || this.miniPlayerIsolado());
  protected readonly estadoNucleo = computed<EstadoJarvis>(() => {
    if (this.voz.falando()) return 'falando';
    if (this.conversa.ocupada()) return this.atividade.ferramenta() ? 'executando' : 'pensando';
    if (this.player.fase() === 'gerando' || this.pedindo() || this.voz.preparando())
      return 'pensando';
    const tarefa = this.tarefaComputer();
    if (tarefa?.estado === 'executando' || tarefa?.estado === 'pendente') return 'executando';
    if (this.escuta.ouvindo()) return 'escutando';
    return this.atividade.pulso() ?? 'repouso';
  });
  protected readonly rotuloNucleo = computed(
    () =>
      ({
        repouso: 'SISTEMA EM ESPERA',
        escutando: 'CANAL DE ESCUTA ATIVO',
        pensando: 'PROCESSANDO SOLICITAÇÃO',
        executando: 'ORQUESTRANDO FERRAMENTAS',
        falando: 'TRANSMITINDO RESPOSTA',
        concluido: 'RESPOSTA CONCLUÍDA',
        erro: 'ATENÇÃO NECESSÁRIA',
      })[this.estadoNucleo()],
  );
  protected prepararComando(texto: string): void {
    this.rascunho.set(texto);
    this.painel.abrir('conversa');
    setTimeout(() => document.getElementById('mensagem-jarvis')?.focus(), 0);
  }
  protected focarJanela(evento: Event): void {
    this.janelas.focar((evento.target as HTMLSelectElement).value);
  }

  protected async cancelarComputer(id: string): Promise<void> {
    try {
      await this.api.cancelarTarefaComputer(id);
    } catch {
      this.erro.set('Não consegui pedir a parada da tarefa no PC. Use o atalho local.');
    }
  }

  /** O selo do cabeçalho: se a ativação por voz está de pé, e se há som entrando ou saindo agora. */
  protected readonly sinalDeVoz = computed(() => {
    if (!this.escuta.disponivel) return 'Só texto';
    return this.escuta.ligada() ? 'Voz online' : 'Voz em espera';
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

  protected readonly blocoNoPalco = computed(
    () => this.player.selecionado() ?? this.player.atual(),
  );
  /** Zero ou um: é lista para o `@for` dar identidade ao card e animar a entrada e a saída dele. */
  protected readonly palco = computed(() => {
    const bloco = this.blocoNoPalco();
    return bloco ? [bloco] : [];
  });
  /** O briefing só aparece no palco quando a conversa não está usando a tela. */
  protected readonly briefingNoPalco = computed(() => (this.conversa.naTela() ? [] : this.palco()));
  /** Sem nada no palco o orbe cresce e assume o centro — é o Jarvis em repouso, sem card por cima. */
  protected readonly orbeLivre = computed(
    () => this.janelas.visiveis().length === 0 && !this.holograma.aberto(),
  );
  /** Durante a abertura o orbe "se forma": escala, opacidade e desfoque, só com CSS. */
  protected readonly orbeFormando = computed(() => this.inicio.fase() === 'animando');
  protected readonly concluidos = computed(() =>
    this.player.blocos().slice(0, Math.max(0, this.player.indiceAtual())),
  );
  protected readonly geracaoBriefing = computed(() => {
    const b = this.player.briefing();
    return b ? contextoBriefing(b).geracao : '';
  });
  protected readonly estadoApresentacao = computed(() => {
    if (this.voz.falando()) return 'Falando';
    if (this.escutaDeResposta.fase() === 'ouvindo') return 'Ouvindo sua resposta';
    if (this.escutaDeResposta.fase() === 'preparando') return 'Aguardando resposta';
    if (this.escutaDeResposta.fase() === 'opcoes') return 'Aguardando sua resposta';
    if (this.escuta.aguardandoResposta()) return 'Aguardando resposta';
    if (this.conversa.ocupada()) return this.conversa.progresso() || 'Pensando';
    // Na fase `gerando` quem tem o texto é a fila; aqui em cima fica só a decisão de qual estado mostrar.
    if (this.player.fase() === 'gerando') return this.player.legenda();
    if (this.pedindo()) return 'Preparando briefing';
    const tarefa = this.tarefaComputer();
    if (tarefa?.estado === 'executando' || tarefa?.estado === 'pendente')
      return 'Executando tarefa no PC';
    if (this.escuta.ouvindo()) return this.escuta.ditando() ? 'Ouvindo sua mensagem' : 'Ouvindo';
    if (this.atividade.pulso() === 'concluido') return 'Resposta concluída';
    if (this.atividade.pulso() === 'erro') return 'Uma operação precisa de atenção';
    return 'Às suas ordens';
  });
  protected consultarCard(bloco: Bloco): void {
    this.tela.consultar(bloco);
  }
  protected resumoCard(bloco: Bloco): string {
    switch (bloco.tipo) {
      case 'clima':
        return bloco.dados.temperaturaAtual + '° · ' + bloco.dados.cidade;
      case 'lembretes':
        return bloco.dados.itens.length
          ? bloco.dados.itens.length + ' lembrete(s)'
          : 'Agenda livre';
      case 'sistemas':
        return bloco.dados.sites.length + ' site(s) monitorado(s)';
      case 'noticia':
        return bloco.dados.titulo;
      default:
        return bloco.linhas[0] ?? bloco.rotulo;
    }
  }

  private ocioso: ReturnType<typeof setTimeout> | null = null;
  private pendulo: ReturnType<typeof setInterval> | null = null;
  private ultimaAtivacao = -Infinity;
  private ativa = true;

  constructor() {
    let estavaNoHolograma = false;
    afterRenderEffect(() => {
      const aberto = this.holograma.aberto();
      if (estavaNoHolograma && !aberto && !this.painel.ativo()) {
        this.atalhoFerramentas()?.nativeElement.focus({ preventScroll: true });
      }
      estavaNoHolograma = aberto;
    });
    afterRenderEffect((limpar) => {
      const area = this.areaJanelas()?.nativeElement;
      const bandeja = this.bandejaPlayer()?.nativeElement;
      if (!area || typeof ResizeObserver === 'undefined') return;
      const medir = () => {
        const retangulo = area.getBoundingClientRect();
        this.janelas.origemArea.set({ x: retangulo.x, y: retangulo.y });
        this.janelas.definirArea(retangulo.width, retangulo.height);
        if (bandeja) {
          const b = bandeja.getBoundingClientRect();
          this.janelas.bandejaArea.set({ x: b.x, y: b.y, largura: b.width, altura: b.height });
        }
      };
      const observador = new ResizeObserver(medir);
      observador.observe(area);
      if (bandeja) observador.observe(bandeja);
      window.addEventListener('resize', medir);
      window.addEventListener('scroll', medir, true);
      medir();
      limpar(() => {
        observador.disconnect();
        window.removeEventListener('resize', medir);
        window.removeEventListener('scroll', medir, true);
      });
    });
    effect(() => {
      if (
        this.ditadoNoEditor() &&
        this.escuta.ditando() &&
        this.escutaDeResposta.fase() !== 'ouvindo'
      ) {
        this.rascunho.set(this.escuta.transcricao());
      }
    });
    // Enquanto há rascunho ou ditado, a conversa segura a tela: nada se recolhe por baixo da mão.
    effect(() => {
      this.conversa.compondo.set(
        !!this.rascunho().trim() ||
          (this.escuta.ditando() && this.escutaDeResposta.fase() !== 'ouvindo'),
      );
    });
  }

  ngOnInit(): void {
    this.conversa.aoReceber = (resposta, narracao) => {
      if (resposta.escuta && narracao) this.escutaDeResposta.receberResposta(resposta, narracao);
      else this.escutaDeResposta.cancelar();
    };
    this.conversa.abrir();
    this.tela.ativa.set(true);
    this.tela.mostrarBriefing = () => this.consultarBriefing();
    this.cota.acompanhar();
    this.eventos.conectar({
      gerando: () => {
        this.escutaDeResposta.cancelar();
        if (!this.conversa.naTela() && !this.conversa.chatAberto() && !this.escuta.ditando())
          this.player.gerando();
      },
      briefing: (briefing) => {
        this.escutaDeResposta.cancelar();
        if (this.conversa.naTela() || this.conversa.chatAberto() || this.escuta.ditando())
          this.briefingGuardado.set(briefing);
        else void this.player.tocar(briefing);
      },
      conectado: () => {
        void this.conversa.recuperar();
        this.estadoTela.reenviar();
        this.estadoDoHolograma.reenviar();
        void this.api
          .ultimaTarefaComputer()
          .then((tarefa) => {
            this.tarefaComputer.set(tarefa);
            this.atividade.receberComputer(tarefa, false);
          })
          .catch(() => {});
      },
      card: (card) => {
        this.tela.receber(card);
        this.atividade.receberCard(card.id, card.titulo);
      },
      comando: (comando) => {
        this.tela.executar(comando);
      },
      pensando: (pedido) => {
        this.escuta.cancelarDitado();
        this.conversa.pensando(pedido);
      },
      ferramenta: (progresso) => this.conversa.ferramenta(progresso),
      resposta: (resposta) => this.conversa.receber(resposta),
      erroConversa: (resposta) => this.conversa.receber(resposta),
      historico: () => void this.conversa.recuperar(),
      tarefaComputer: (tarefa) => {
        this.tarefaComputer.set(tarefa);
        this.atividade.receberComputer(tarefa, true);
      },
      // O despertar por palmas achando a tela já aberta: só a frase curta, sem card nenhum.
      falar: (fala) => void this.voz.falar(fala.texto),
      holograma: (comando) => this.comandosDoHolograma.aplicar(comando),
    });

    // Abriu com ?inicio=1, ou seja: o agente do PC acabou de acender esta tela por palmas ou por
    // voz. A abertura toca por cima de tudo e só então liga a escuta.
    if (this.inicio.pedidoNaUrl()) {
      void this.inicio.iniciar();
    }

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
    this.player.epilogo = (briefing, sinal) =>
      this.escutaDeResposta.perguntarObservacoes(briefing, sinal);

    window.addEventListener('keydown', this.aoTeclar);
    window.addEventListener('click', this.aoClicar);
    window.addEventListener('mousemove', this.aoMexerOMouse);
    this.pendulo = setInterval(() => this.relogio.set(agora()), RELOGIO_MS);
    this.agendarEsconderCursor();
  }

  ngOnDestroy(): void {
    this.ativa = false;
    this.escutaDeResposta.cancelar();
    this.conversa.aoReceber = null;
    this.inicio.cancelar(false);
    this.comandosDoHolograma.fechar();
    this.tela.encerrar();
    this.cota.parar();
    this.conversa.fechar();
    this.eventos.desconectar();
    this.player.parar();
    this.player.epilogo = null;
    this.escuta.soltarMicrofone();
    window.removeEventListener('keydown', this.aoTeclar);
    window.removeEventListener('click', this.aoClicar);
    window.removeEventListener('mousemove', this.aoMexerOMouse);
    if (this.ocioso !== null) {
      clearTimeout(this.ocioso);
    }
    if (this.pendulo !== null) {
      clearInterval(this.pendulo);
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
    this.escutaDeResposta.cancelar();
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
    this.escutaDeResposta.cancelar();
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
    if (this.inicio.rodando() || /^jarvis[\s,.:;!?-]+iniciar[\s.!?]*$/i.test(frase.trim())) return;
    if (this.conversa.ocupada() || this.escuta.ditando()) return;
    if (!this.ativa || !this.escuta.ligada() || this.voz.falando()) return;
    if (/^jarvis\b/i.test(frase.trim()) && this.tela.rapido(frase)) {
      this.escutaDeResposta.registrarAtivacao();
      this.ultimaAtivacao = Date.now();
      return;
    }
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
    if (
      /^(?:(?:bom dia|boa tarde|boa noite)(?: jarvis)?|jarvis (?:bom dia|boa tarde|boa noite))$/.test(
        saudacao,
      )
    ) {
      this.escutaDeResposta.registrarAtivacao();
      this.ultimaAtivacao = Date.now();
      this.conversa.mostrarBriefing();
      void this.pedirBriefing();
    } else if (contem(frase, ['jarvis'])) {
      this.escutaDeResposta.registrarAtivacao();
      this.ultimaAtivacao = Date.now();
      void this.ditar(frase.replace(/^.*?\bjarvis\b[\s,.:!-]*/i, ''));
    }
  }

  protected async enviarTexto(comando?: string): Promise<void> {
    const texto = comando ?? this.rascunho();
    this.escutaDeResposta.cancelar();
    this.voz.destravar();
    this.escuta.cancelarDitado();
    if (this.tela.rapido(texto) || (await this.conversa.enviar(texto))) {
      if (comando === undefined && this.rascunho() === texto) this.rascunho.set('');
    }
  }

  protected async ditar(inicial = '', noEditor = false): Promise<void> {
    if (this.conversa.ocupada()) return;
    if (this.escuta.ditando()) {
      this.escuta.cancelarDitado();
      return;
    }
    this.voz.destravar();
    this.ditadoNoEditor.set(noEditor);
    this.escutaDeResposta.cancelar();
    this.conversa.assumirPalco();
    const texto = await this.escuta.ditar(inicial);
    if (!this.ativa || !texto) return;
    if (noEditor) this.rascunho.set(texto);
    const confirmacao = this.conversa.resposta()?.confirmacao;
    const codigo = normalizarCodigo(texto);
    if (
      confirmacao &&
      Date.parse(confirmacao.expiraEm) > Date.now() &&
      codigo === normalizarCodigo(confirmacao.codigo)
    ) {
      await this.enviarTexto('confirmo ' + confirmacao.codigo);
    } else await this.enviarTexto(noEditor ? undefined : texto);
  }

  protected alternarHolograma(): void {
    const abrindo = !this.holograma.aberto();
    this.holograma.alternar();
    if (abrindo && !this.holograma.pecas().length) this.painel.abrir('ferramentas');
  }

  protected sairDoHolograma(): void {
    this.painel.fechar();
    this.comandosDoHolograma.fechar();
  }

  protected consultarBriefing(): void {
    if (this.conversa.ocupada()) return;
    this.escutaDeResposta.cancelar();
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
      this.escutaDeResposta.cancelar();
      void this.conversa.limpar();
    }
  }

  private readonly aoTeclar = (evento: KeyboardEvent): void => {
    if (evento.defaultPrevented) return;
    if (evento.key === 'Escape') {
      if (evento.target instanceof Element && evento.target.closest('dialog[open]')) return;
      if (this.painel.ativo()) {
        this.painel.fechar();
        evento.preventDefault();
        return;
      }
      this.escutaDeResposta.cancelar();
      // Antes de tudo: quem apertou Esc durante a abertura quer a tela, não o filme.
      if (this.inicio.rodando()) {
        this.inicio.cancelar();
        evento.preventDefault();
        return;
      }
      const foco = this.janelas.foco();
      if (foco) {
        this.janelas.fechar(foco);
        evento.preventDefault();
        return;
      }
      if (this.holograma.aberto()) {
        this.comandosDoHolograma.fechar();
        evento.preventDefault();
        return;
      }
      this.escuta.cancelarDitado();
      this.voz.parar();
      // Fechar a consulta antes de parar: o palco volta a ficar vazio e o orbe retoma o centro.
      this.player.fecharConsulta();
      this.player.parar();
      // E o mesmo Esc recolhe a conversa: a tela volta a ser só o orbe.
      if (!this.rascunho().trim()) this.conversa.recolher();
      return;
    }
    if (
      evento.target instanceof HTMLTextAreaElement &&
      evento.target.id === 'mensagem-jarvis' &&
      evento.key.length === 1 &&
      !evento.ctrlKey &&
      !evento.metaKey &&
      !evento.altKey
    ) {
      this.escutaDeResposta.cancelar();
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

  protected aoDigitar(): void {
    this.escutaDeResposta.cancelar();
  }

  private readonly aoClicar = (evento: MouseEvent): void => {
    if (!(evento.target instanceof Element)) return;
    if (evento.target.closest('[data-escuta-opcao]')) return;
    this.escutaDeResposta.registrarClique();
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

/** "14 out · 07:13" — hora do aparelho, que é onde a tela está pendurada. */
function agora(): string {
  const data = new Date();
  return (
    data
      .toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
      .replace('.', '')
      .toUpperCase() +
    ' · ' +
    data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  );
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
