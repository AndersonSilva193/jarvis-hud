import { DestroyRef, Service, effect, inject, signal, untracked } from '@angular/core';

import { VozService } from './voz.service';

const CHAVE_LIGADA = 'jarvis-hud.escuta';

/** O que acorda o Jarvis. */
export const ATIVACOES = ['bom dia', 'jarvis'] as const;
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

  desligar(): void {
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

  private podeOuvir(): boolean {
    return this.ouvinte !== null && this.ligada() && !this.pausada && !this.voz.falando();
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
    // Só frase pronta: resultado parcial muda a cada sílaba e não serve para comparar palavra.
    sessao.interimResults = false;
    sessao.maxAlternatives = 1;

    sessao.onstart = () => {
      if (this.sessao !== sessao || !this.podeOuvir()) return;
      this.tentativas = 0;
      this.ouvindo.set(true);
      this.pontual?.iniciar();
    };
    sessao.onresult = (evento) => {
      if (this.sessao === sessao && this.podeOuvir()) this.aoOuvir(evento);
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
      this.reabrirDepois(this.esperaDaVez());
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
      this.ouvinte?.(frase);
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
