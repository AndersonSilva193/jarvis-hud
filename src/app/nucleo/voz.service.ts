import { Injectable, computed, inject, signal } from '@angular/core';

import { JarvisApiService } from './jarvis-api.service';
import type { RespostaVoz } from './voz.modelos';
import { RoteiroLegenda } from './legenda-fala';

/** Acima disso o Chrome corta a fala no meio, então o texto vai em pedaços. */
const LIMITE_DO_PEDACO = 180;
/** Se o onend não vier (acontece), seguimos a fila em vez de travar o HUD para sempre. */
const FOLGA_POR_CARACTERE_MS = 130;
const FOLGA_MINIMA_MS = 4_000;
/** Depois deste tempo sem evento `boundary`, a intensidade passa a ser oscilação sintética. */
const VALIDADE_DO_BOUNDARY_MS = 400;
/** Teto para a API responder. Passou disso, falar pelo navegador é melhor do que esperar. */
const TETO_DA_SINTESE_MS = 4_000;
/** Depois de uma falha, quanto tempo nem tentamos a API de novo (e a HUD fala na hora). */
const DESCANSO_APOS_FALHA_MS = 60_000;
/** Quando a API diz que a voz remota está desligada, vale esperar bem mais. */
const DESCANSO_SE_DESLIGADA_MS = 10 * 60_000;
/** Quantas falas adiantadas guardamos. O briefing só precisa de uma; isto é só a trava. */
const MAXIMO_PREPARADO = 8;

/**
 * A voz do Jarvis.
 *
 * O caminho bom é o MP3 da ElevenLabs, pedido ao backend e tocado num elemento <audio> ligado a
 * um AnalyserNode — assim o orbe pulsa com o áudio de verdade. Quando esse caminho não dá (cota
 * na reserva, backend fora do ar, demora), a fala sai pela Web Speech API, que é o que a HUD
 * sempre fez. Quem chama não escolhe: pede `falar()` e alguma voz sai.
 *
 * Duas coisas no caminho do navegador existem por causa do Chrome, não por gosto: o texto é
 * falado em pedaços (utterance longa é cortada) e a intensidade tem um plano B (as vozes de rede
 * do Google quase nunca emitem `boundary`, então sem isso o orbe ficaria parado justamente com a
 * melhor voz pt-BR).
 */
@Injectable({ providedIn: 'root' })
export class VozService {
  private readonly api = inject(JarvisApiService);

  readonly disponivel = typeof window !== 'undefined' && 'speechSynthesis' in window;

  /** Verdadeiro do primeiro pedaço ao último: é o que acende o "FALANDO" no topo. */
  readonly falando = signal(false);
  /** 0 a 1, de quanto o orbe deve pulsar agora. */
  readonly intensidade = signal(0);
  private readonly roteiro = signal(new RoteiroLegenda(''));
  private readonly palavraAtual = signal(-1);
  readonly limiteLegenda = signal(72);
  readonly trechoAtual = computed(() => this.roteiro().trecho(this.palavraAtual(), this.limiteLegenda()));
  readonly textoRevelado = computed(() => this.roteiro().revelado(this.palavraAtual()));
  readonly preparando = signal(false);
  private apagarLegenda: ReturnType<typeof setTimeout> | null = null;
  private atualizarLegenda: (() => void) | null = null;

  private readonly vozes = signal<SpeechSynthesisVoice[]>([]);
  readonly voz = computed(() => escolherVoz(this.vozes()));
  readonly nomeDaVoz = computed(() => this.voz()?.name ?? 'voz padrão do sistema');

  private execucao = 0;
  private concluirPedaco: (() => void) | null = null;
  private readonly antesDaFala = new Set<() => void>();
  private ultimoBoundary = 0;
  private quadro: number | null = null;

  /** Falas já pedidas à API e ainda não usadas, por texto. É o que tira a pausa do briefing. */
  private readonly preparados = new Map<string, Promise<RespostaVoz | null>>();
  /** Enquanto `Date.now()` for menor que isto, nem perguntamos à API. */
  private remotaEmDescansoAte = 0;

  private audio: HTMLAudioElement | null = null;
  private contexto: AudioContext | null = null;
  private analisador: AnalyserNode | null = null;
  private amostras: Uint8Array | null = null;
  private tocandoAudio = false;

  /** Aviso síncrono: a captura deve parar antes de enviar áudio ao alto-falante. */
  aoComecarFala(ouvinte: () => void): () => void {
    this.antesDaFala.add(ouvinte);
    return () => {
      this.antesDaFala.delete(ouvinte);
    };
  }

  constructor() {
    if (!this.disponivel) {
      return;
    }
    const carregar = () => this.vozes.set(speechSynthesis.getVoices());
    carregar();
    // No Chrome a lista chega vazia na primeira leitura e só depois dispara este evento.
    speechSynthesis.addEventListener('voiceschanged', carregar);
  }

  /**
   * O Chrome exige um gesto do usuário antes de tocar áudio — vale para a síntese e para o
   * elemento <audio>. Chamada no clique, esta fala vazia destrava a Web Speech API, e o
   * AudioContext nasce (ou acorda) aqui pelo mesmo motivo: criado fora do gesto, ele ficaria
   * suspenso e o primeiro MP3 sairia mudo.
   */
  destravar(): void {
    this.garantirContexto();
    void this.contexto?.resume().catch(() => undefined);
    if (!this.disponivel) {
      return;
    }
    speechSynthesis.resume();
    const silencio = new SpeechSynthesisUtterance(' ');
    silencio.volume = 0;
    silencio.lang = 'pt-BR';
    speechSynthesis.speak(silencio);
  }

  /**
   * Pede o áudio desta frase desde já, sem falar.
   *
   * O briefing chama isto para a seção seguinte enquanto a atual toca: quando chega a vez dela,
   * o MP3 já está no navegador e as seções se emendam sem silêncio no meio.
   */
  preparar(texto: string | null | undefined): void {
    const limpo = texto?.trim() ?? '';
    if (limpo.length === 0 || this.preparados.has(limpo) || this.emDescanso()) {
      return;
    }
    if (this.preparados.size >= MAXIMO_PREPARADO) {
      this.preparados.clear();
    }
    this.preparados.set(limpo, this.pedir(limpo));
  }

  /** Fala o texto inteiro e só resolve quando acabou (ou quando `parar()` interrompeu). */
  async falar(texto: string, sinal?: AbortSignal): Promise<void> {
    const limpo = texto?.trim() ?? '';
    if (limpo.length === 0 || sinal?.aborted) {
      return;
    }
    this.parar();
    const minhaVez = ++this.execucao;
    this.roteiro.set(new RoteiroLegenda(limpo));
    this.preparando.set(true);
    const cancelar = () => {
      if (minhaVez === this.execucao) this.parar();
    };
    sinal?.addEventListener('abort', cancelar, { once: true });
    try {
      const resposta = await this.obter(limpo);
      if (minhaVez !== this.execucao) {
        return;
      }
      // Só agora: até aqui ninguém falou nada, e acender "FALANDO" antes seria mentira.
      this.antesDaFala.forEach((ouvinte) => ouvinte());
      this.preparando.set(false);
      this.falando.set(true);
      this.ultimoBoundary = performance.now();
      this.animar();
      if (resposta?.provedor === 'elevenlabs' && resposta.url) {
        if (await this.tocarAudio(resposta.url, limpo, minhaVez)) {
          return;
        }
        if (minhaVez !== this.execucao) {
          return;
        }
      }
      await this.falarPelaSintese(limpo, minhaVez);
    } finally {
      sinal?.removeEventListener('abort', cancelar);
      if (minhaVez === this.execucao) {
        this.atualizarLegenda = null;
        this.preparando.set(false);
        this.falando.set(false);
        this.intensidade.set(0);
        if (this.palavraAtual() >= 0) {
          this.apagarLegenda = setTimeout(() => {
            if (minhaVez === this.execucao) this.palavraAtual.set(-1);
            this.apagarLegenda = null;
          }, 2_000);
        }
      }
    }
  }

  parar(): void {
    if (this.apagarLegenda !== null) clearTimeout(this.apagarLegenda);
    this.apagarLegenda = null;
    this.atualizarLegenda = null;
    this.palavraAtual.set(-1);
    this.preparando.set(false);
    this.execucao += 1;
    this.concluirPedaco?.();
    this.falando.set(false);
    this.intensidade.set(0);
    this.tocandoAudio = false;
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.currentTime = 0;
      } catch {
        // Elemento ainda sem fonte: não há o que parar.
      }
    }
    if (this.disponivel) {
      speechSynthesis.cancel();
    }
  }

  // ---- caminho da ElevenLabs -------------------------------------------------------------

  /** A resposta da API para este texto: a preparada, se houver, ou um pedido novo. */
  private async obter(texto: string): Promise<RespostaVoz | null> {
    const preparado = this.preparados.get(texto);
    if (preparado) {
      this.preparados.delete(texto);
      return comTeto(preparado, TETO_DA_SINTESE_MS);
    }
    if (this.emDescanso()) {
      return null;
    }
    return comTeto(this.pedir(texto), TETO_DA_SINTESE_MS);
  }

  /**
   * Uma pergunta à API, que nunca rejeita: erro vira null e a fala sai pelo navegador.
   *
   * Depois de uma falha a HUD para de perguntar por um tempo — senão cada frase pagaria de novo
   * os quatro segundos de espera com o backend fora do ar.
   */
  private async pedir(texto: string): Promise<RespostaVoz | null> {
    try {
      const resposta = await this.api.sintetizarVoz(texto);
      if (resposta?.provedor === 'navegador' && resposta.motivo === 'desligado') {
        this.remotaEmDescansoAte = Date.now() + DESCANSO_SE_DESLIGADA_MS;
      }
      return resposta;
    } catch {
      this.remotaEmDescansoAte = Date.now() + DESCANSO_APOS_FALHA_MS;
      return null;
    }
  }

  private emDescanso(): boolean {
    return Date.now() < this.remotaEmDescansoAte;
  }

  /** Toca o MP3 até o fim. Falso quando nem começou — aí a síntese do navegador assume. */
  private async tocarAudio(rota: string, texto: string, minhaVez: number): Promise<boolean> {
    const audio = this.elementoDeAudio();
    if (!audio) {
      return false;
    }
    audio.src = this.api.urlDoAudio(rota);
    this.ligarAnalise(audio);
    this.palavraAtual.set(-1);
    try {
      await audio.play();
    } catch {
      return false;
    }
    if (minhaVez !== this.execucao) {
      return true;
    }
    this.tocandoAudio = true;
    const atualizar = () => {
      if (minhaVez !== this.execucao || audio.paused) return;
      // A duração pode chegar depois de play(). Até lá aguardamos os metadados.
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      this.revelar(this.roteiro().indiceNoTempo(audio.currentTime / audio.duration));
    };
    this.atualizarLegenda = atualizar;
    atualizar();
    await new Promise<void>((resolver) => {
      let encerrado = false;
      const encerrar = () => {
        if (encerrado) {
          return;
        }
        encerrado = true;
        clearTimeout(salvaguarda);
        audio.onended = null;
        audio.onerror = null;
        if (this.atualizarLegenda === atualizar) this.atualizarLegenda = null;
        this.tocandoAudio = false;
        if (this.concluirPedaco === encerrar) this.concluirPedaco = null;
        resolver();
      };
      audio.onended = () => {
        if (minhaVez === this.execucao) this.revelar(this.roteiro().palavras.length - 1);
        encerrar();
      };
      audio.onerror = encerrar;
      this.concluirPedaco = encerrar;
      // Mesma ideia da síntese: se o `ended` não vier, a fila não pode travar para sempre.
      const salvaguarda = setTimeout(encerrar, folgaPara(texto));
    });
    return true;
  }

  private elementoDeAudio(): HTMLAudioElement | null {
    if (this.audio) {
      return this.audio;
    }
    if (typeof Audio === 'undefined') {
      return null;
    }
    const audio = new Audio();
    // Sem isto o MP3 de outra origem "suja" o grafo e o AnalyserNode só entrega silêncio —
    // o orbe ficaria parado com o áudio tocando.
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    this.audio = audio;
    return audio;
  }

  private garantirContexto(): void {
    if (this.contexto || typeof AudioContext === 'undefined') {
      return;
    }
    try {
      this.contexto = new AudioContext();
    } catch {
      // Sem Web Audio o áudio ainda toca; o orbe é que fica na oscilação sintética.
      this.contexto = null;
    }
  }

  /** Liga o elemento ao analisador. O MediaElementSource só pode ser criado uma vez por áudio. */
  private ligarAnalise(audio: HTMLAudioElement): void {
    this.garantirContexto();
    if (!this.contexto || this.analisador) {
      return;
    }
    try {
      const fonte = this.contexto.createMediaElementSource(audio);
      const analisador = this.contexto.createAnalyser();
      analisador.fftSize = 256;
      fonte.connect(analisador);
      // Sem esta ligação o áudio entra no grafo e não sai em lugar nenhum: silêncio total.
      analisador.connect(this.contexto.destination);
      this.analisador = analisador;
      this.amostras = new Uint8Array(analisador.fftSize);
    } catch {
      this.analisador = null;
      this.amostras = null;
    }
  }

  // ---- caminho da Web Speech API ---------------------------------------------------------

  private async falarPelaSintese(texto: string, minhaVez: number): Promise<void> {
    if (!this.disponivel) {
      return;
    }
    const pedacos = fatiar(texto, LIMITE_DO_PEDACO);
    this.roteiro.set(new RoteiroLegenda(pedacos.join(' ')));
    this.palavraAtual.set(-1);
    let inicio = 0;
    for (const pedaco of pedacos) {
      if (minhaVez !== this.execucao) {
        return;
      }
      await this.falarPedaco(pedaco, minhaVez, inicio);
      inicio += pedaco.length + 1;
    }
  }

  private falarPedaco(texto: string, minhaVez: number, inicio: number): Promise<void> {
    return new Promise<void>((resolver) => {
      const fala = new SpeechSynthesisUtterance(texto);
      fala.lang = 'pt-BR';
      const voz = this.voz();
      if (voz) {
        fala.voice = voz;
      }
      fala.rate = 1.02;
      fala.pitch = 1;
      fala.volume = 1;

      let encerrado = false;
      let comecouEm: number | null = null;
      let recebeuBoundary = false;
      const roteiroLocal = new RoteiroLegenda(texto);
      const atualizar = () => {
        if (minhaVez !== this.execucao || comecouEm === null || recebeuBoundary || speechSynthesis.paused) return;
        const duracaoEstimada = Math.max(800, roteiroLocal.pesoTotal * 65 / fala.rate);
        const indice = roteiroLocal.indiceNoTempo((performance.now() - comecouEm) / duracaoEstimada);
        this.revelar(this.roteiro().indiceNoCaractere(inicio + (roteiroLocal.palavras[indice]?.inicio ?? 0)));
      };
      let salvaguarda: ReturnType<typeof setTimeout>;
      const encerrar = () => {
        if (encerrado) {
          return;
        }
        encerrado = true;
        clearTimeout(salvaguarda);
        fala.onboundary = null;
        fala.onstart = null;
        fala.onpause = null;
        fala.onresume = null;
        fala.onend = null;
        fala.onerror = null;
        if (this.atualizarLegenda === atualizar) this.atualizarLegenda = null;
        if (this.concluirPedaco === encerrar) this.concluirPedaco = null;
        resolver();
      };

      this.atualizarLegenda = atualizar;
      let pausouEm = 0;
      fala.onstart = () => {
        if (minhaVez !== this.execucao) return;
        comecouEm = performance.now();
        atualizar();
      };
      fala.onpause = () => { pausouEm = performance.now(); };
      fala.onresume = () => {
        if (comecouEm !== null) comecouEm += performance.now() - pausouEm;
      };
      fala.onboundary = (evento) => {
        if (minhaVez !== this.execucao || encerrado) return;
        // Algumas vozes só informam frases: nesses casos a estimativa continua revelando palavras.
        recebeuBoundary = evento.name !== 'sentence';
        this.ultimoBoundary = performance.now();
        this.revelar(this.roteiro().indiceNoCaractere(inicio + evento.charIndex));
      };
      fala.onend = () => {
        if (minhaVez === this.execucao) this.revelar(this.roteiro().indiceNoCaractere(inicio + texto.length - 1));
        encerrar();
      };
      // cancel() cai em onerror em alguns navegadores e em onend em outros: os dois encerram.
      fala.onerror = encerrar;

      this.concluirPedaco = encerrar;
      salvaguarda = setTimeout(() => {
        speechSynthesis.cancel();
        encerrar();
      }, folgaPara(texto));
      try {
        speechSynthesis.speak(fala);
      } catch {
        encerrar();
      }
    });
  }

  /**
   * Um laço só, enquanto fala. Com MP3, a intensidade é a energia real da onda; com a síntese,
   * é o pico do último `boundary` e, na falta dele, a oscilação sintética.
   */
  private animar(): void {
    if (this.quadro !== null) {
      return;
    }
    const passo = () => {
      if (!this.falando()) {
        this.intensidade.set(0);
        this.quadro = null;
        return;
      }
      this.atualizarLegenda?.();
      if (this.tocandoAudio && this.analisador && this.amostras) {
        this.intensidade.set(energiaDe(this.analisador, this.amostras));
      } else {
        const agora = performance.now();
        const desdeOBoundary = agora - this.ultimoBoundary;
        if (desdeOBoundary < VALIDADE_DO_BOUNDARY_MS) {
          // Cada sílaba dá um pico que decai até o próximo.
          this.intensidade.set(Math.max(0.3, 1 - desdeOBoundary / VALIDADE_DO_BOUNDARY_MS));
        } else {
          this.intensidade.set(oscilacao(agora / 1000));
        }
      }
      this.quadro = requestAnimationFrame(passo);
    };
    this.quadro = requestAnimationFrame(passo);
  }

  private revelar(indice: number): void {
    this.palavraAtual.update(atual => Math.max(atual, indice));
  }
}

/** Resolve com null em vez de esperar para sempre — ou de rejeitar. */
function comTeto<T>(promessa: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolver) => {
    const relogio = setTimeout(() => resolver(null), ms);
    promessa.then(
      (valor) => {
        clearTimeout(relogio);
        resolver(valor);
      },
      () => {
        clearTimeout(relogio);
        resolver(null);
      },
    );
  });
}

/** Valor eficaz da onda, esticado para a faixa que o orbe usa. */
function energiaDe(analisador: AnalyserNode, amostras: Uint8Array): number {
  analisador.getByteTimeDomainData(amostras as Uint8Array<ArrayBuffer>);
  let soma = 0;
  for (const amostra of amostras) {
    const desvio = (amostra - 128) / 128;
    soma += desvio * desvio;
  }
  const eficaz = Math.sqrt(soma / amostras.length);
  return Math.min(1, eficaz * 3.2);
}

/**
 * A voz pt-BR preferida: primeiro as que têm "Google" e "Brasil" no nome, depois qualquer pt-BR,
 * depois qualquer português. Null quando o sistema não tem voz nenhuma em português — aí a
 * utterance vai só com lang="pt-BR" e o navegador escolhe.
 */
export function escolherVoz(vozes: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const emPortugues = vozes.filter((voz) => idioma(voz).startsWith('pt'));
  if (emPortugues.length === 0) {
    return null;
  }
  const pontuadas = emPortugues
    .map((voz) => ({ voz, pontos: pontuar(voz) }))
    .sort((a, b) => b.pontos - a.pontos);
  return pontuadas[0]?.voz ?? null;
}

function pontuar(voz: SpeechSynthesisVoice): number {
  const nome = voz.name.toLowerCase();
  let pontos = 0;
  if (idioma(voz) === 'pt-br') {
    pontos += 4;
  }
  if (nome.includes('google')) {
    pontos += 3;
  }
  if (nome.includes('brasil') || nome.includes('brazil')) {
    pontos += 3;
  }
  return pontos;
}

function idioma(voz: SpeechSynthesisVoice): string {
  return voz.lang.toLowerCase().replace('_', '-');
}

/**
 * Corta o texto em pedaços que o Chrome fala inteiros, quebrando por linha e por frase e só
 * então por palavra. Linha sem pontuação ganha um ponto no fim, para a voz respirar entre itens.
 */
export function fatiar(texto: string, limite = LIMITE_DO_PEDACO): string[] {
  const frases: string[] = [];
  for (const linha of texto.split('\n').map((l) => l.trim())) {
    if (linha.length === 0) {
      continue;
    }
    const pontuada = /[.!?:]$/.test(linha) ? linha : `${linha}.`;
    for (const frase of pontuada.split(/(?<=[.!?])\s+/)) {
      const limpa = frase.trim();
      if (limpa.length > 0) {
        frases.push(...porPalavras(limpa, limite));
      }
    }
  }
  // Junta frases vizinhas curtas: menos utterances, menos silêncio entre elas.
  const pedacos: string[] = [];
  for (const frase of frases) {
    const ultimo = pedacos[pedacos.length - 1];
    if (ultimo !== undefined && ultimo.length + frase.length + 1 <= limite) {
      pedacos[pedacos.length - 1] = `${ultimo} ${frase}`;
    } else {
      pedacos.push(frase);
    }
  }
  return pedacos;
}

function porPalavras(frase: string, limite: number): string[] {
  if (frase.length <= limite) {
    return [frase];
  }
  const partes: string[] = [];
  let atual = '';
  for (const palavra of frase.split(/\s+/)) {
    if (atual.length === 0) {
      atual = palavra;
    } else if (atual.length + palavra.length + 1 <= limite) {
      atual = `${atual} ${palavra}`;
    } else {
      partes.push(atual);
      atual = palavra;
    }
  }
  if (atual.length > 0) {
    partes.push(atual);
  }
  return partes;
}

function folgaPara(texto: string): number {
  return Math.max(FOLGA_MINIMA_MS, texto.length * FOLGA_POR_CARACTERE_MS);
}

/** Duas senoides fora de fase: parece fala, não parece metrônomo. */
function oscilacao(segundos: number): number {
  const rapida = Math.sin(segundos * 7.3) * 0.5 + 0.5;
  const lenta = Math.sin(segundos * 11.9 + 1.7) * 0.5 + 0.5;
  return 0.32 + 0.4 * rapida + 0.18 * lenta;
}
