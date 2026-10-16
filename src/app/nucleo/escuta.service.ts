import { DestroyRef, Service, effect, inject, signal, untracked } from '@angular/core';

import { VozService } from './voz.service';

const CHAVE_LIGADA = 'jarvis-hud.escuta';

/** O que acorda o Jarvis. */
export const ATIVACOES = ['bom dia', 'boa tarde', 'boa noite', 'jarvis'] as const;
/** O que conta como "sim" na pergunta das observações. */
export const CONFIRMACOES = ['sim', 'quero', 'claro', 'pode'] as const;

/** A cauda do áudio do alto-falante ainda está no ar quando ele cala; este é o tempo de sumir. */
const ESPERA_PARA_RETOMAR_MS = 400;
/** O Chrome encerra a sessão sozinho no silêncio; este é o tempo até religar. */
const ESPERA_PARA_RELIGAR_MS = 300;
/** Religar que falha em sequência vai recuando até aqui, para não virar laço quente. */
const ESPERA_MAXIMA_MS = 10_000;
/** Teto para o microfone voltar antes de uma escuta pontual começar a contar. */
const ESPERA_PELO_MICROFONE_MS = 10_000;

/** Por que a escuta parou, quando parou por algo que o usuário precisa saber. */
export type MotivoDaParada = 'permissao-negada' | null;

/**
 * O microfone do Jarvis, pela Web Speech API.
 *
 * Três coisas aqui existem por causa do navegador, não por gosto. O `continuous` não é contínuo
 * (o Chrome encerra a sessão no silêncio, e quem religa somos nós); o microfone sai do ar
 * enquanto a síntese fala, senão a HUD ouviria a própria voz e pediria briefing para si mesma; e
 * permissão negada desliga a escuta em vez de insistir, que seria laço infinito.
 *
 * Fora isso, só reconhece e avisa: quem decide o que fazer com cada frase é a página.
 */
@Service()
export class EscutaService {
  private readonly voz = inject(VozService);

  readonly disponivel = construtorDeReconhecimento() !== null;

  /** A vontade do usuário, lembrada entre sessões. */
  readonly ligada = signal(this.disponivel && lerLigada());
  /** Capturando agora. Falso enquanto ele fala — é o que acende o indicador de microfone. */
  readonly ouvindo = signal(false);
  readonly ditando = signal(false);
  readonly transcricao = signal('');
  private ditado: {
    iniciar: () => void;
    receber: (evento: SpeechRecognitionEvent) => void;
    atividade: () => void;
    silencio: () => void;
    terminou: () => void;
    cancelar: () => void;
  } | null = null;
  readonly aguardandoResposta = signal(false);
  readonly motivo = signal<MotivoDaParada>(null);

  private sessao: SpeechRecognition | null = null;
  private ouvinte: ((frase: string) => void) | null = null;
  private pontual: {
    receber: (frase: string) => void;
    iniciar: () => void;
    cancelar: () => void;
  } | null = null;
  private pausada = false;
  private suspensaPelaInicializacao = false;
  private reabertura: ReturnType<typeof setTimeout> | null = null;
  private tentativas = 0;

  constructor() {
    if (!this.disponivel) {
      return;
    }
    const remover = this.voz.aoComecarFala(() => this.pausar());
    inject(DestroyRef).onDestroy(() => {
      remover();
      this.soltarMicrofone();
    });
    // O microfone acompanha a fala pelo avesso: ele fala, o microfone cala.
    effect(() => {
      const falando = this.voz.falando();
      untracked(() => (falando ? this.pausar() : this.retomar()));
    });
  }

  /**
   * Registra quem recebe cada frase final e, se a escuta já estava ligada, abre o microfone. Um
   * ouvinte só, como o `conectar()` do SSE.
   */
  escutar(ouvinte: (frase: string) => void): void {
    this.ouvinte = ouvinte;
    if (this.ligada()) {
      this.abrir();
    }
  }

  ligar(): void {
    if (!this.disponivel) {
      return;
    }
    this.motivo.set(null);
    this.tentativas = 0;
    if (!this.ligada()) {
      this.ligada.set(true);
      gravarLigada(true);
    }
    this.abrir();
  }

  /** Bloqueio temporário independente da fala, sem mudar a preferência salva. */
  suspenderInicializacao(): void {
    this.suspensaPelaInicializacao = true;
    this.cancelarDitado();
    this.pontual?.cancelar();
    this.fechar();
  }

  liberarInicializacao(ativar: boolean): void {
    this.suspensaPelaInicializacao = false;
    if (ativar) this.ligar();
  }

  desligar(): void {
    this.cancelarDitado();
    this.ligada.set(false);
    gravarLigada(false);
    this.pontual?.cancelar();
    this.fechar();
  }

  alternar(): void {
    if (this.ligada()) {
      this.desligar();
    } else {
      this.ligar();
    }
  }

  /** Solta o microfone sem apagar a preferência: é o que a página faz ao sair da tela. */
  soltarMicrofone(): void {
    this.ouvinte = null;
    this.cancelarDitado();
    this.pontual?.cancelar();
    this.fechar();
  }

  /** Reserva os resultados até uma resposta reconhecida, cancelamento ou prazo final. */
  ouvirPor(
    ms: number,
    sinal?: AbortSignal,
    aceitar: (frase: string) => boolean = () => true,
  ): Promise<string> {
    this.pontual?.cancelar();
    if (!this.disponivel || !this.ligada() || this.ouvinte === null || sinal?.aborted) {
      return Promise.resolve('');
    }
    return new Promise<string>((resolver) => {
      let encerrada = false;
      let iniciada = false;
      let prazo: ReturnType<typeof setTimeout>;
      const concluir = (frase: string) => {
        if (encerrada) return;
        encerrada = true;
        clearTimeout(prazo);
        sinal?.removeEventListener('abort', cancelar);
        this.pontual = null;
        this.aguardandoResposta.set(false);
        resolver(frase);
      };
      const cancelar = () => concluir('');
      const iniciar = () => {
        if (iniciada || encerrada) return;
        iniciada = true;
        clearTimeout(prazo);
        prazo = setTimeout(cancelar, ms);
      };
      this.pontual = {
        receber: (frase) => {
          if (iniciada && aceitar(frase)) concluir(frase);
        },
        iniciar,
        cancelar,
      };
      this.aguardandoResposta.set(true);
      sinal?.addEventListener('abort', cancelar, { once: true });
      prazo = setTimeout(cancelar, ESPERA_PELO_MICROFONE_MS);
      if (this.ouvindo()) iniciar();
    });
  }

  /** Um ditado por acionamento; não muda a preferência da escuta por palavra-chave. */
  ditar(
    inicial = '',
    opcoes: { tempoParaComecarMs?: number; sinal?: AbortSignal; aoAbrir?: () => void } = {},
  ): Promise<string> {
    this.cancelarDitado();
    this.pontual?.cancelar();
    if (!this.disponivel || this.ouvinte === null || this.voz.falando() || opcoes.sinal?.aborted) {
      return Promise.resolve('');
    }
    this.fechar();
    this.pausada = false;
    this.ditando.set(true);
    this.transcricao.set(inicial.trim());
    return new Promise<string>((resolver) => {
      let encerrado = false;
      let finalizando = false;
      let iniciada = false;
      let comecou = !!inicial.trim();
      let prefixo = inicial.trim();
      const trechos = new Map<number, string>();
      let silencio: ReturnType<typeof setTimeout> | null = null;
      let final: ReturnType<typeof setTimeout> | null = null;
      let prazo: ReturnType<typeof setTimeout> | null = setTimeout(
        () => concluir(''),
        ESPERA_PELO_MICROFONE_MS,
      );
      const marcarInicio = () => {
        if (comecou) return;
        comecou = true;
        if (prazo !== null) clearTimeout(prazo);
        prazo = null;
      };
      const concluir = (texto: string) => {
        if (encerrado) return;
        encerrado = true;
        if (prazo !== null) clearTimeout(prazo);
        if (silencio !== null) clearTimeout(silencio);
        if (final !== null) clearTimeout(final);
        opcoes.sinal?.removeEventListener('abort', cancelar);
        this.ditado = null;
        this.ditando.set(false);
        this.fechar();
        if (this.ligada()) this.reabrirDepois(ESPERA_PARA_RETOMAR_MS);
        resolver(texto.trim());
      };
      const encerrar = () => {
        if (encerrado || finalizando) return;
        finalizando = true;
        final = setTimeout(() => concluir(this.transcricao()), 1000);
        try {
          if (this.sessao) this.sessao.stop();
          else concluir(this.transcricao());
        } catch {
          concluir(this.transcricao());
        }
      };
      const agendar = () => {
        if (silencio !== null) clearTimeout(silencio);
        if (!finalizando && comecou) silencio = setTimeout(encerrar, 1500);
      };
      const cancelar = () => concluir('');
      this.ditado = {
        iniciar: () => {
          if (encerrado || iniciada) return;
          iniciada = true;
          if (prazo !== null) clearTimeout(prazo);
          prazo = comecou ? null : setTimeout(cancelar, opcoes.tempoParaComecarMs ?? 10_000);
          opcoes.aoAbrir?.();
        },
        receber: (evento) => {
          for (const indice of trechos.keys()) {
            if (indice >= evento.results.length) trechos.delete(indice);
          }
          for (let i = evento.resultIndex; i < evento.results.length; i++) {
            trechos.set(i, evento.results[i]?.[0]?.transcript ?? '');
          }
          const texto = [prefixo, ...[...trechos].sort(([a], [b]) => a - b).map(([, t]) => t)]
            .join(' ')
            .trim();
          this.transcricao.set(texto);
          if (texto) marcarInicio();
          agendar();
        },
        atividade: () => {
          marcarInicio();
          if (silencio !== null) clearTimeout(silencio);
        },
        silencio: agendar,
        terminou: () => {
          if (finalizando) concluir(this.transcricao());
          else {
            prefixo = this.transcricao();
            trechos.clear();
            this.reabrirDepois(ESPERA_PARA_RELIGAR_MS);
          }
        },
        cancelar,
      };
      opcoes.sinal?.addEventListener('abort', cancelar, { once: true });
      this.abrir();
      agendar();
    });
  }
  cancelarDitado(): void {
    this.ditado?.cancelar();
  }

  private podeOuvir(): boolean {
    return (
      this.ouvinte !== null &&
      (this.ligada() || this.ditado !== null) &&
      !this.pausada &&
      !this.suspensaPelaInicializacao &&
      !this.voz.falando()
    );
  }

  private abrir(): void {
    const Reconhecimento = construtorDeReconhecimento();
    if (
      Reconhecimento === null ||
      this.sessao !== null ||
      this.reabertura !== null ||
      !this.podeOuvir()
    ) {
      return;
    }

    const sessao = new Reconhecimento();
    sessao.lang = 'pt-BR';
    sessao.continuous = true;
    // Ativação exige frase final; no ditado cada parcial substitui a posição correspondente.
    sessao.interimResults = this.ditado !== null;
    sessao.maxAlternatives = 1;

    sessao.onstart = () => {
      if (this.sessao !== sessao || !this.podeOuvir()) return;
      this.tentativas = 0;
      this.ouvindo.set(true);
      this.ditado?.iniciar();
      this.pontual?.iniciar();
    };
    sessao.onspeechstart = () => {
      if (this.sessao === sessao) this.ditado?.atividade();
    };
    sessao.onspeechend = () => {
      if (this.sessao === sessao) this.ditado?.silencio();
    };
    sessao.onresult = (evento) => {
      if (this.sessao === sessao && this.podeOuvir()) {
        if (this.ditado) this.ditado.receber(evento);
        else this.aoOuvir(evento);
      }
    };
    sessao.onerror = (evento) => {
      if (this.sessao === sessao) this.aoErrar(evento.error);
    };
    sessao.onend = () => {
      if (this.sessao !== sessao) {
        return;
      }
      this.sessao = null;
      this.ouvindo.set(false);
      if (this.ditado) this.ditado.terminou();
      else this.reabrirDepois(this.esperaDaVez());
    };

    this.sessao = sessao;
    try {
      sessao.start();
    } catch {
      // start() em sessão que o navegador ainda não soltou estoura; tentamos de novo mais tarde.
      this.sessao = null;
      this.ouvindo.set(false);
      this.reabrirDepois(this.esperaDaVez());
    }
  }

  private fechar(): void {
    if (this.reabertura !== null) {
      clearTimeout(this.reabertura);
      this.reabertura = null;
    }
    const sessao = this.sessao;
    this.sessao = null;
    this.ouvindo.set(false);
    // abort() e não stop(): o stop() ainda entrega um último resultado, que é justamente o que
    // não queremos ao calar o microfone.
    try {
      sessao?.abort();
    } catch {
      // A sessão já foi invalidada; alguns navegadores recusam abort() depois do fim.
    }
  }

  private pausar(): void {
    this.cancelarDitado();
    if (this.pausada) {
      return;
    }
    this.pausada = true;
    this.fechar();
  }

  private retomar(): void {
    if (!this.pausada) {
      return;
    }
    this.pausada = false;
    if (!this.ligada()) {
      return;
    }
    this.tentativas = 0;
    this.reabrirDepois(ESPERA_PARA_RETOMAR_MS);
  }

  private reabrirDepois(ms: number): void {
    if (!this.podeOuvir()) {
      return;
    }
    if (this.reabertura !== null) {
      clearTimeout(this.reabertura);
    }
    this.reabertura = setTimeout(() => {
      this.reabertura = null;
      this.abrir();
    }, ms);
  }

  /** Recuo progressivo: sessão que nem abre não pode ser tentada trezentas vezes por minuto. */
  private esperaDaVez(): number {
    const quanto = Math.min(ESPERA_PARA_RELIGAR_MS * 2 ** this.tentativas, ESPERA_MAXIMA_MS);
    this.tentativas += 1;
    return quanto;
  }

  private aoOuvir(evento: SpeechRecognitionEvent): void {
    for (let i = evento.resultIndex; i < evento.results.length; i += 1) {
      const resultado = evento.results[i];
      if (!resultado?.isFinal) {
        continue;
      }
      const frase = (resultado[0]?.transcript ?? '').trim();
      if (frase.length === 0) {
        continue;
      }
      const pontual = this.pontual;
      if (pontual !== null) {
        pontual.receber(frase);
        if (this.pontual !== pontual) return;
        continue;
      }
      const sessao = this.sessao;
      this.ouvinte?.(frase);
      if (this.sessao !== sessao || this.ditado || !this.podeOuvir()) return;
    }
  }

  private aoErrar(erro: string): void {
    if (erro === 'not-allowed' || erro === 'service-not-allowed') {
      // Insistir em permissão negada é laço infinito: desliga e deixa o motivo na tela.
      this.motivo.set('permissao-negada');
      this.desligar();
    }
    // no-speech, aborted, network e companhia: o onend vem logo atrás e religa.
  }
}

/** O construtor do reconhecimento neste navegador, ou null onde o recurso não existe. */
function construtorDeReconhecimento(): (new () => SpeechRecognition) | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/** Minúsculas e sem acento: "Bom dia!" e "bom dia" têm de valer a mesma coisa. */
export function normalizar(frase: string): string {
  return frase.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Se a frase tem algum dos termos, por palavra inteira — "simplesmente" não pode valer por "sim".
 * A pontuação é descartada, então "Bom dia, Jarvis!" casa com os dois.
 */
export function contem(frase: string, termos: readonly string[]): boolean {
  const palavras = normalizar(frase)
    .split(/[^a-z0-9]+/)
    .filter((palavra) => palavra.length > 0);
  if (palavras.length === 0) {
    return false;
  }
  const limpa = ` ${palavras.join(' ')} `;
  return termos.some((termo) => limpa.includes(` ${normalizar(termo)} `));
}

function lerLigada(): boolean {
  try {
    return localStorage.getItem(CHAVE_LIGADA) === 'sim';
  } catch {
    return false;
  }
}

function gravarLigada(ligada: boolean): void {
  try {
    if (ligada) {
      localStorage.setItem(CHAVE_LIGADA, 'sim');
    } else {
      localStorage.removeItem(CHAVE_LIGADA);
    }
  } catch {
    // Sem localStorage a escuta ainda funciona nesta sessão; só não lembra na próxima.
  }
}

/** Negativas prevalecem sobre palavras afirmativas na mesma frase. */
export function respostaDasObservacoes(frase: string): 'sim' | 'nao' | null {
  if (contem(frase, ['não', 'nem', 'negativo'])) return 'nao';
  return contem(frase, CONFIRMACOES) ? 'sim' : null;
}
