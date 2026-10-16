import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigStore } from './config.store';
import { EscutaService } from './escuta.service';
import { InicializacaoService } from './inicializacao.service';
import { FALA_DE_RESERVA, type Introducao } from './inicializacao.modelos';
import { JarvisApiService } from './jarvis-api.service';
import { JarvisEventosService } from './jarvis-eventos.service';
import { VozService } from './voz.service';

const INTRODUCAO: Introducao = {
  texto: 'Boa tarde, senhor. Todos os sistemas operacionais. Às suas ordens.',
  sitesOk: 3,
  sitesTotal: 3,
  climaOk: true,
  lembretesHoje: 2,
  geradoEm: '2026-10-15T14:00:00-03:00',
};

describe('abertura da HUD', () => {
  const inicializacao = vi.fn<() => Promise<Introducao>>();
  const statusVoz = vi.fn<() => Promise<{ provedor: string }>>();
  const testar = vi.fn<() => Promise<string>>();
  const falar = vi.fn<(t: string) => Promise<void>>();
  const destravar = vi.fn();
  const ligar = vi.fn();
  const suspenderInicializacao = vi.fn();
  const liberarInicializacao = vi.fn((ativar: boolean) => { if (ativar) ligar(); });
  const status = signal('online');

  /** Deixa a abertura inteira correr: 4 passos de 900 ms mais a fala. */
  const correrTudo = () => vi.advanceTimersByTimeAsync(10_000);

  beforeEach(() => {
    vi.useFakeTimers();
    inicializacao.mockReset().mockResolvedValue(INTRODUCAO);
    statusVoz.mockReset().mockResolvedValue({ provedor: 'elevenlabs' });
    testar.mockReset().mockResolvedValue('ok');
    falar.mockReset().mockResolvedValue(undefined);
    destravar.mockReset();
    ligar.mockReset();
    suspenderInicializacao.mockClear();
    liberarInicializacao.mockClear();
    status.set('online');
    history.replaceState(null, '', '/?inicio=1');

    TestBed.configureTestingModule({
      providers: [
        { provide: JarvisApiService, useValue: { inicializacao, statusVoz, testar } },
        { provide: VozService, useValue: { falar, destravar, parar: vi.fn() } },
        { provide: EscutaService, useValue: { disponivel: true, ligar, suspenderInicializacao, liberarInicializacao } },
        { provide: JarvisEventosService, useValue: { status } },
        {
          provide: ConfigStore,
          useValue: { urlApi: signal('https://api.test'), token: signal('t') },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
    history.replaceState(null, '', '/');
  });

  it('só roda quando a URL tem ?inicio=1', () => {
    expect(TestBed.inject(InicializacaoService).pedidoNaUrl()).toBe(true);

    history.replaceState(null, '', '/');
    expect(TestBed.inject(InicializacaoService).pedidoNaUrl()).toBe(false);
  });

  it('fala o texto da API, liga a escuta e tira o ?inicio=1 da URL', async () => {
    const servico = TestBed.inject(InicializacaoService);
    const pronto = servico.iniciar();
    await correrTudo();
    await pronto;

    expect(falar).toHaveBeenCalledExactlyOnceWith(INTRODUCAO.texto);
    expect(ligar).toHaveBeenCalledOnce();
    expect(servico.fase()).toBe('pronta');
    // Sem isto, um F5 repetiria a introdução inteira do nada.
    expect(location.search).toBe('');
  });

  it('destrava a voz antes de qualquer coisa', async () => {
    const servico = TestBed.inject(InicializacaoService);
    void servico.iniciar();

    // O Chrome é aberto pelo agente com --autoplay-policy, então não há clique a aproveitar:
    // o destravar tem de sair já, não depois da animação.
    expect(destravar).toHaveBeenCalledOnce();
    await correrTudo();
  });

  it('API fora do ar: fala a frase de reserva em vez de ficar muda', async () => {
    inicializacao.mockRejectedValue(new Error('offline'));
    const servico = TestBed.inject(InicializacaoService);
    const pronto = servico.iniciar();
    await correrTudo();
    await pronto;

    expect(falar).toHaveBeenCalledExactlyOnceWith(FALA_DE_RESERVA);
    expect(ligar).toHaveBeenCalledOnce();
    const sistemas = servico.linhas().find((l) => l.id === 'sistemas');
    expect(sistemas?.estado).toBe('falhou');
  });

  it('checagem que falha vira FALHOU e não interrompe as seguintes', async () => {
    statusVoz.mockRejectedValue(new Error('sem voz'));
    const servico = TestBed.inject(InicializacaoService);
    const pronto = servico.iniciar();
    await correrTudo();
    await pronto;

    const porId = Object.fromEntries(servico.linhas().map((l) => [l.id, l]));
    expect(porId['voz']?.estado).toBe('falhou');
    expect(porId['microfone']?.estado).toBe('ok');
    expect(porId['sistemas']?.estado).toBe('ok');
    expect(falar).toHaveBeenCalledExactlyOnceWith(INTRODUCAO.texto);
  });

  it('a linha de sistemas mostra a contagem real e falha quando algum site caiu', async () => {
    inicializacao.mockResolvedValue({ ...INTRODUCAO, sitesOk: 2, sitesTotal: 3 });
    const servico = TestBed.inject(InicializacaoService);
    const pronto = servico.iniciar();
    await correrTudo();
    await pronto;

    const sistemas = servico.linhas().find((l) => l.id === 'sistemas');
    expect(sistemas?.detalhe).toBe('2/3');
    expect(sistemas?.estado).toBe('falhou');
  });

  it('microfone indisponível aparece como falha, sem derrubar a abertura', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: JarvisApiService, useValue: { inicializacao, statusVoz, testar } },
        { provide: VozService, useValue: { falar, destravar, parar: vi.fn() } },
        { provide: EscutaService, useValue: { disponivel: false, ligar, suspenderInicializacao, liberarInicializacao } },
        { provide: JarvisEventosService, useValue: { status } },
        {
          provide: ConfigStore,
          useValue: { urlApi: signal('https://api.test'), token: signal('t') },
        },
      ],
    });
    const servico = TestBed.inject(InicializacaoService);
    const pronto = servico.iniciar();
    await correrTudo();
    await pronto;

    expect(servico.linhas().find((l) => l.id === 'microfone')?.estado).toBe('falhou');
    expect(falar).toHaveBeenCalledOnce();
  });

  it('cancelar no meio para a fala e libera a tela', async () => {
    const servico = TestBed.inject(InicializacaoService);
    void servico.iniciar();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(servico.rodando()).toBe(true);

    servico.cancelar();

    expect(servico.fase()).toBe('pronta');
    expect(servico.rodando()).toBe(false);
    await correrTudo();
    // Cancelou antes da fala: ela não pode sair depois, com a tela já em uso.
    expect(falar).not.toHaveBeenCalled();
  });

  it('não toca duas aberturas ao mesmo tempo', async () => {
    const servico = TestBed.inject(InicializacaoService);
    const primeira = servico.iniciar();
    const segunda = servico.iniciar();
    await correrTudo();
    await Promise.all([primeira, segunda]);

    expect(inicializacao).toHaveBeenCalledOnce();
    expect(falar).toHaveBeenCalledOnce();
  });

  it('consome a URL imediatamente e suspende a escuta durante a animação', async () => {
    const servico = TestBed.inject(InicializacaoService);
    void servico.iniciar();
    expect(location.search).toBe('');
    expect(suspenderInicializacao).toHaveBeenCalledOnce();
    expect(liberarInicializacao).not.toHaveBeenCalled();
    await correrTudo();
    expect(liberarInicializacao).toHaveBeenCalledWith(true);
    await servico.iniciar();
    expect(inicializacao).toHaveBeenCalledOnce();
  });

  it('API que não responde libera a tela e usa reserva aos 15 segundos', async () => {
    inicializacao.mockReturnValue(new Promise(() => {}));
    const servico = TestBed.inject(InicializacaoService);
    const pronto = servico.iniciar();
    await vi.advanceTimersByTimeAsync(15_000);
    await pronto;
    expect(falar).toHaveBeenCalledExactlyOnceWith(FALA_DE_RESERVA);
    expect(servico.fase()).toBe('pronta');
  });

  it('destruir a página cancela sem religar a captura nem falar depois', async () => {
    const servico = TestBed.inject(InicializacaoService);
    void servico.iniciar();
    servico.cancelar(false);
    await correrTudo();
    expect(liberarInicializacao).toHaveBeenCalledExactlyOnceWith(false);
    expect(ligar).not.toHaveBeenCalled();
    expect(falar).not.toHaveBeenCalled();
    expect(location.search).toBe('');
  });
});
