import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EscutaService } from './escuta.service';
import { VozService } from './voz.service';

class Reconhecimento {
  static sessoes: Reconhecimento[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    Reconhecimento.sessoes.push(this);
  }
  ouvir(texto: string, final = false) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: final, 0: { transcript: texto } }] });
  }
}
describe('ditado pontual', () => {
  let escuta: EscutaService;
  let antesDeFalar: () => void;
  const falando = signal(false);
  const sessao = () => Reconhecimento.sessoes.at(-1)!;
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    Reconhecimento.sessoes = [];
    falando.set(false);
    vi.stubGlobal('SpeechRecognition', Reconhecimento);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: VozService,
          useValue: {
            falando,
            aoComecarFala: (f: () => void) => {
              antesDeFalar = f;
              return () => {};
            },
          },
        },
      ],
    });
    escuta = TestBed.inject(EscutaService);
    escuta.escutar(() => {});
    TestBed.tick();
  });
  afterEach(() => {
    escuta.soltarMicrofone();
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  it('captura com ativação desligada, substitui parcial e pede final após 1,5 s', async () => {
    const resultado = escuta.ditar();
    const r = sessao();
    expect(r.interimResults).toBe(true);
    expect(escuta.ligada()).toBe(false);
    r.ouvir('Como');
    await vi.advanceTimersByTimeAsync(1000);
    r.ouvir('Como está o servidor');
    await vi.advanceTimersByTimeAsync(1499);
    expect(r.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(r.stop).toHaveBeenCalledTimes(1);
    r.ouvir('Como está o servidor?', true);
    r.onend?.();
    await expect(resultado).resolves.toBe('Como está o servidor?');
    await vi.advanceTimersByTimeAsync(5000);
    expect(Reconhecimento.sessoes).toHaveLength(1);
  });
  it('aproveita a frase após Jarvis e usa transcrição após um segundo sem final', async () => {
    const resultado = escuta.ditar('Como vai');
    sessao().ouvir('o servidor');
    await vi.advanceTimersByTimeAsync(2500);
    await expect(resultado).resolves.toBe('Como vai o servidor');
  });
  it('silêncio de dez segundos e permissão negada cancelam sem texto', async () => {
    const vazio = escuta.ditar();
    await vi.advanceTimersByTimeAsync(10000);
    await expect(vazio).resolves.toBe('');
    const negado = escuta.ditar();
    sessao().onerror?.({ error: 'not-allowed' });
    await expect(negado).resolves.toBe('');
    expect(escuta.motivo()).toBe('permissao-negada');
  });
  it('cancela sincronicamente antes da fala e ignora resultado antigo', async () => {
    escuta.ligar();
    const resultado = escuta.ditar();
    const antigo = sessao();
    antigo.ouvir('não enviar');
    antesDeFalar();
    falando.set(true);
    TestBed.tick();
    expect(antigo.abort).toHaveBeenCalled();
    antigo.ouvir('atrasado');
    await expect(resultado).resolves.toBe('');
    falando.set(false);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(399);
    expect(sessao()).toBe(antigo);
    await vi.advanceTimersByTimeAsync(1);
    expect(sessao()).not.toBe(antigo);
  });
  it('saída cancela captura e impede temporizadores de reabrir', async () => {
    escuta.ligar();
    const resultado = escuta.ditar();
    const antigo = sessao();
    antigo.ouvir('oi');
    escuta.soltarMicrofone();
    antigo.onend?.();
    await vi.advanceTimersByTimeAsync(15000);
    await expect(resultado).resolves.toBe('');
    expect(sessao()).toBe(antigo);
    expect(escuta.ouvindo()).toBe(false);
  });
  it('reconecta no meio de uma frase sem duplicar o prefixo', async () => {
    const resultado = escuta.ditar();
    sessao().ouvir('como está', true);
    sessao().onend?.();
    await vi.advanceTimersByTimeAsync(300);
    sessao().ouvir('o servidor', true);
    await vi.advanceTimersByTimeAsync(2500);
    await expect(resultado).resolves.toBe('como está o servidor');
  });
});
