import { Injectable, computed, signal } from '@angular/core';

/** Acima disso o Chrome corta a fala no meio, então o texto vai em pedaços. */
const LIMITE_DO_PEDACO = 180;
/** Se o onend não vier (acontece), seguimos a fila em vez de travar o HUD para sempre. */
const FOLGA_POR_CARACTERE_MS = 130;
const FOLGA_MINIMA_MS = 4_000;
/** Depois deste tempo sem evento `boundary`, a intensidade passa a ser oscilação sintética. */
const VALIDADE_DO_BOUNDARY_MS = 400;

/**
 * A voz do Jarvis, pela Web Speech API.
 *
 * Duas coisas aqui existem por causa do navegador, não por gosto: o texto é falado em pedaços
 * (utterance longa é cortada no Chrome) e a intensidade tem um plano B (as vozes de rede do
 * Google quase nunca emitem `boundary`, então sem isso o orbe ficaria parado justamente com a
 * melhor voz pt-BR).
 */
@Injectable({ providedIn: 'root' })
export class VozService {
  readonly disponivel = typeof window !== 'undefined' && 'speechSynthesis' in window;

  /** Verdadeiro do primeiro pedaço ao último: é o que acende o "FALANDO" no topo. */
  readonly falando = signal(false);
  /** 0 a 1, de quanto o orbe deve pulsar agora. */
  readonly intensidade = signal(0);

  private readonly vozes = signal<SpeechSynthesisVoice[]>([]);
  readonly voz = computed(() => escolherVoz(this.vozes()));
  readonly nomeDaVoz = computed(() => this.voz()?.name ?? 'voz padrão do sistema');

  private cancelado = false;
  private ultimoBoundary = 0;
  private quadro: number | null = null;

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
   * O Chrome exige um gesto do usuário antes de tocar áudio. Chamada no clique do botão, esta
   * fala vazia "destrava" a síntese para o resto da sessão. Rodando o Chrome com
   * --autoplay-policy=no-user-gesture-required nada disso é necessário.
   */
  destravar(): void {
    if (!this.disponivel) {
      return;
    }
    speechSynthesis.resume();
    const silencio = new SpeechSynthesisUtterance(' ');
    silencio.volume = 0;
    silencio.lang = 'pt-BR';
    speechSynthesis.speak(silencio);
  }

  /** Fala o texto inteiro e só resolve quando acabou (ou quando `parar()` interrompeu). */
  async falar(texto: string): Promise<void> {
    const pedacos = fatiar(texto, LIMITE_DO_PEDACO);
    if (!this.disponivel || pedacos.length === 0) {
      return;
    }
    this.cancelado = false;
    this.falando.set(true);
    this.ultimoBoundary = performance.now();
    this.animar();
    try {
      for (const pedaco of pedacos) {
        if (this.cancelado) {
          return;
        }
        await this.falarPedaco(pedaco);
      }
    } finally {
      this.falando.set(false);
      this.intensidade.set(0);
    }
  }

  parar(): void {
    this.cancelado = true;
    this.falando.set(false);
    this.intensidade.set(0);
    if (this.disponivel) {
      speechSynthesis.cancel();
    }
  }

  private falarPedaco(texto: string): Promise<void> {
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
      let salvaguarda: ReturnType<typeof setTimeout>;
      const encerrar = () => {
        if (encerrado) {
          return;
        }
        encerrado = true;
        clearTimeout(salvaguarda);
        resolver();
      };

      fala.onboundary = () => {
        this.ultimoBoundary = performance.now();
      };
      fala.onend = encerrar;
      // cancel() cai em onerror em alguns navegadores e em onend em outros: os dois encerram.
      fala.onerror = encerrar;

      salvaguarda = setTimeout(encerrar, folgaPara(texto));
      speechSynthesis.speak(fala);
    });
  }

  /** Um laço só, enquanto fala: puxa a intensidade do último `boundary` ou a oscila. */
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
      const agora = performance.now();
      const desdeOBoundary = agora - this.ultimoBoundary;
      if (desdeOBoundary < VALIDADE_DO_BOUNDARY_MS) {
        // Cada sílaba dá um pico que decai até o próximo.
        this.intensidade.set(Math.max(0.3, 1 - desdeOBoundary / VALIDADE_DO_BOUNDARY_MS));
      } else {
        this.intensidade.set(oscilacao(agora / 1000));
      }
      this.quadro = requestAnimationFrame(passo);
    };
    this.quadro = requestAnimationFrame(passo);
  }
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
