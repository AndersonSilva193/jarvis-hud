import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigStore } from './config.store';
import { JarvisApiService } from './jarvis-api.service';
import { JarvisEventosService } from './jarvis-eventos.service';

class Fonte extends EventTarget {
  static CLOSED = 2;
  static criadas: Fonte[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  close = vi.fn();
  constructor(readonly url: string) {
    super();
    Fonte.criadas.push(this);
  }
  emitir(nome: string, dados: unknown) {
    this.dispatchEvent(new MessageEvent(nome, { data: JSON.stringify(dados) }));
  }
}
describe('SSE de conversa', () => {
  let eventos: JarvisEventosService;
  const ouvintes = {
    gerando: vi.fn(),
    briefing: vi.fn(),
    conectado: vi.fn(),
    resposta: vi.fn(),
    historico: vi.fn(),
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    Fonte.criadas = [];
    vi.stubGlobal('EventSource', Fonte);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ConfigStore,
          useValue: {
            configurado: () => true,
            rota: (p: string) => 'https://teste' + p,
            token: () => 'token simulado',
            urlApi: signal('https://teste'),
          },
        },
        { provide: JarvisApiService, useValue: { testar: async () => 'ok' } },
      ],
    });
    eventos = TestBed.inject(JarvisEventosService);
  });
  afterEach(() => {
    eventos.desconectar();
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('usa rota unificada e avisa a cada abertura para recuperar o estado', () => {
    eventos.conectar(ouvintes);
    const fonte = Fonte.criadas[0];
    expect(fonte.url).toBe('https://teste/api/eventos?token=token%20simulado');
    fonte.onopen?.();
    fonte.onerror?.();
    fonte.onopen?.();
    expect(ouvintes.conectado).toHaveBeenCalledTimes(2);
    fonte.emitir('conversa.resposta', { id: '1', canal: 'hud', texto: 'ok' });
    expect(ouvintes.resposta).toHaveBeenCalledOnce();
    fonte.emitir('conversa.historico', { revisao: 2 });
    expect(ouvintes.historico).toHaveBeenCalledOnce();
  });
  it('ignora eventos da conexão antiga e cancela reconexão ao sair', async () => {
    eventos.conectar(ouvintes);
    const antiga = Fonte.criadas[0];
    antiga.readyState = Fonte.CLOSED;
    antiga.onerror?.();
    eventos.desconectar();
    antiga.onopen?.();
    antiga.emitir('conversa.resposta', { id: 'velho' });
    await vi.advanceTimersByTimeAsync(31000);
    expect(eventos.status()).toBe('desligado');
    expect(ouvintes.resposta).not.toHaveBeenCalled();
    expect(Fonte.criadas).toHaveLength(1);
    eventos.conectar(ouvintes);
    antiga.emitir('briefing', {});
    expect(ouvintes.briefing).not.toHaveBeenCalled();
  });
});
