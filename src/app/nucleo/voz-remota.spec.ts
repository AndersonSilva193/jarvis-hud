import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JarvisApiService } from './jarvis-api.service';
import { VozService } from './voz.service';
import { VozCotaService } from './voz-cota.service';
import type { RespostaVoz } from './voz.modelos';

/** Uma utterance de mentira, para ver o que foi parar na síntese do navegador. */
class FalaFalsa {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: (() => void) | null = null;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown = null;
  constructor(readonly text: string) {}
}

/** Um <audio> de mentira: guarda o src e deixa o teste disparar o fim na hora que quiser. */
class AudioFalso {
  static criados: AudioFalso[] = [];
  /** Liga o caso do Chrome recusando o autoplay sem gesto do usuário. */
  static recusarPlay = false;
  src = '';
  crossOrigin: string | null = null;
  preload = '';
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly pause = vi.fn();
  readonly play = vi.fn(async () => {
    if (AudioFalso.recusarPlay) {
      throw new Error('NotAllowedError');
    }
  });

  constructor() {
    AudioFalso.criados.push(this);
  }

  terminar(): void {
    this.onended?.();
  }
}

describe('voz com a ElevenLabs', () => {
  let falas: FalaFalsa[];
  let voz: VozService;
  let sintetizarVoz: ReturnType<typeof vi.fn>;

  /**
   * O respiro entre pedir a fala e o primeiro som: falar() pergunta à API antes de emitir
   * qualquer coisa. Microtarefas puras — o laço de animação reagenda a cada quadro, então
   * avançar o relógio aqui não terminaria.
   */
  async function inicioDaFala(): Promise<void> {
    for (let volta = 0; volta < 6; volta += 1) {
      await Promise.resolve();
    }
  }

  function montar(resposta: () => Promise<RespostaVoz>): void {
    sintetizarVoz = vi.fn(resposta);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: JarvisApiService,
          useValue: {
            sintetizarVoz,
            urlDoAudio: (rota: string) => `https://jarvis.teste${rota}?token=t`,
            statusVoz: async () => null,
          },
        },
      ],
    });
    voz = TestBed.inject(VozService);
  }

  beforeEach(() => {
    falas = [];
    AudioFalso.criados = [];
    AudioFalso.recusarPlay = false;
    vi.stubGlobal('SpeechSynthesisUtterance', FalaFalsa);
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [],
      addEventListener: vi.fn(),
      cancel: vi.fn(),
      resume: vi.fn(),
      speak: (fala: FalaFalsa) => falas.push(fala),
    });
    vi.stubGlobal('Audio', AudioFalso);
    // Sem Web Audio no jsdom: o que se mede aqui é o áudio, não o desenho do orbe.
    vi.stubGlobal('AudioContext', undefined);
  });

  afterEach(() => {
    voz?.parar();
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('toca o MP3 da API e mostra a frase inteira na legenda', async () => {
    montar(async () => ({ provedor: 'elevenlabs', url: '/api/voz/audio/abc' }));

    const fala = voz.falar('Bom dia, senhor.');
    await inicioDaFala();

    const audio = AudioFalso.criados[0]!;
    expect(audio.src).toBe('https://jarvis.teste/api/voz/audio/abc?token=t');
    // Sem isto o AnalyserNode receberia um nó "sujo" e o orbe ficaria parado.
    expect(audio.crossOrigin).toBe('anonymous');
    expect(voz.trechoAtual()).toBe('Bom dia, senhor.');
    expect(falas).toHaveLength(0);

    audio.terminar();
    await fala;
    expect(voz.falando()).toBe(false);
    expect(voz.trechoAtual()).toBe('');
  });

  it('a API dizendo "navegador" manda a fala para o speechSynthesis', async () => {
    montar(async () => ({ provedor: 'navegador', motivo: 'reserva' }));

    const fala = voz.falar('A agenda de hoje está livre.');
    await inicioDaFala();

    expect(AudioFalso.criados).toHaveLength(0);
    expect(falas.map((f) => f.text)).toEqual(['A agenda de hoje está livre.']);

    falas[0]!.onend?.();
    await fala;
  });

  it('erro na API não deixa o Jarvis mudo: fala pelo navegador', async () => {
    montar(async () => {
      throw new Error('500');
    });

    const fala = voz.falar('O servidor caiu.');
    await inicioDaFala();

    expect(falas.map((f) => f.text)).toEqual(['O servidor caiu.']);
    falas[0]!.onend?.();
    await fala;
  });

  it('API demorando mais de 4 s não segura a fala: o navegador assume', async () => {
    vi.useFakeTimers();
    // Nunca responde: é o pior caso da VPS fora do ar sem recusar a conexão.
    montar(() => new Promise<RespostaVoz>(() => undefined));

    const fala = voz.falar('Demorou.');
    await vi.advanceTimersByTimeAsync(3_999);
    expect(falas).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2);

    expect(falas.map((f) => f.text)).toEqual(['Demorou.']);
    falas.at(-1)!.onend?.();
    await fala;
  });

  it('autoplay bloqueado cai para o navegador em vez de ficar em silêncio', async () => {
    montar(async () => ({ provedor: 'elevenlabs', url: '/api/voz/audio/abc' }));
    AudioFalso.recusarPlay = true;

    const fala = voz.falar('Preciso de um clique.');
    await inicioDaFala();

    expect(falas.map((f) => f.text)).toEqual(['Preciso de um clique.']);
    falas[0]!.onend?.();
    await fala;
  });

  it('parar() interrompe o MP3 e resolve a fala', async () => {
    montar(async () => ({ provedor: 'elevenlabs', url: '/api/voz/audio/abc' }));

    const fala = voz.falar('Uma fala longa que ninguém vai ouvir até o fim.');
    await inicioDaFala();
    const audio = AudioFalso.criados[0]!;

    voz.parar();
    await fala;

    expect(audio.pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
    expect(voz.falando()).toBe(false);
    expect(voz.trechoAtual()).toBe('');
  });

  it('preparar() adianta o áudio e falar() reaproveita, sem pedir duas vezes', async () => {
    montar(async () => ({ provedor: 'elevenlabs', url: '/api/voz/audio/abc' }));

    voz.preparar('A seção seguinte.');
    await inicioDaFala();
    expect(sintetizarVoz).toHaveBeenCalledTimes(1);

    const fala = voz.falar('A seção seguinte.');
    await inicioDaFala();

    expect(sintetizarVoz).toHaveBeenCalledTimes(1);
    expect(AudioFalso.criados[0]!.src).toContain('/api/voz/audio/abc');
    AudioFalso.criados[0]!.terminar();
    await fala;
  });

  it('com a voz remota desligada, a HUD para de perguntar e fala direto', async () => {
    montar(async () => ({ provedor: 'navegador', motivo: 'desligado' }));

    const primeira = voz.falar('Uma.');
    await inicioDaFala();
    falas.at(-1)!.onend?.();
    await primeira;

    const segunda = voz.falar('Duas.');
    await inicioDaFala();
    falas.at(-1)!.onend?.();
    await segunda;

    expect(sintetizarVoz).toHaveBeenCalledTimes(1);
    expect(falas.map((f) => f.text)).toEqual(['Uma.', 'Duas.']);
  });
});

describe('VozCotaService', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  function montar(statusVoz: () => Promise<unknown>): VozCotaService {
    TestBed.configureTestingModule({
      providers: [{ provide: JarvisApiService, useValue: { statusVoz } }],
    });
    return TestBed.inject(VozCotaService);
  }

  it('monta o rótulo do rodapé em cada provedor', async () => {
    const cota = montar(async () => ({
      provedor: 'elevenlabs',
      caracteresUsados: 18_000,
      limite: 30_000,
      percentual: 62,
      renovaEm: null,
      motivo: null,
      explicacao: null,
    }));

    cota.acompanhar();
    await Promise.resolve();
    await Promise.resolve();
    expect(cota.rotulo()).toBe('VOZ: ELEVENLABS 62%');

    cota.status.set({
      provedor: 'navegador',
      caracteresUsados: 30_000,
      limite: 30_000,
      percentual: 100,
      renovaEm: null,
      motivo: 'cota',
      explicacao: 'a ElevenLabs recusou por cota',
    });
    expect(cota.rotulo()).toBe('VOZ: NAVEGADOR (cota)');
    cota.parar();
  });

  it('API fora do ar deixa o rodapé em branco, sem quebrar', async () => {
    const cota = montar(async () => {
      throw new Error('offline');
    });

    cota.acompanhar();
    await Promise.resolve();
    await Promise.resolve();

    expect(cota.status()).toBeNull();
    expect(cota.rotulo()).toBe('');
    cota.parar();
  });
});
