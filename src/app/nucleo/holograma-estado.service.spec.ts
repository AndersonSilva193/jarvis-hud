import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComandosDoHologramaService } from './comandos-do-holograma.service';
import { ConfigStore } from './config.store';
import { DEBOUNCE_DO_ESTADO_MS, HologramaEstadoService } from './holograma-estado.service';
import { HologramaService } from './holograma.service';
import { SEM_FILTROS, type PecaHolograma } from './holograma.modelos';
import { JarvisApiService } from './jarvis-api.service';

const PECA: PecaHolograma = {
  id: 'p1', nome: 'Pistão', grupo: 'pistoes', forma: 'box', posicao: [0, 0, 0], rotacao: [0, 0, 0],
  tamanho: [1, 1, 1], cor: '#38bdf8', explosao: null, opacidade: 1, contorno: true, pontos: null,
};

describe('HologramaEstadoService', () => {
  const aberto = signal(false);
  const explosao = signal(0);
  const enviar = vi.fn(async (_estado: { aberto: boolean }) => undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    aberto.set(false);
    explosao.set(0);
    enviar.mockClear();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: HologramaService,
          useValue: {
            aberto, meta: signal({ nome: 'Motor V8', categoria: '', descricao: '' }), idGeracao: signal('h1a2b3c4d'),
            construindo: computed(() => false), pecas: signal([PECA]),
          },
        },
        {
          provide: ComandosDoHologramaService,
          useValue: { explosao, filtros: signal(SEM_FILTROS), selecao: signal(null), vista: signal('livre') },
        },
        { provide: JarvisApiService, useValue: { enviarEstadoHolograma: enviar } },
        { provide: ConfigStore, useValue: { configurado: signal(true), urlApi: signal('x'), token: signal('t') } },
      ],
    });
    TestBed.inject(HologramaEstadoService);
  });

  afterEach(() => vi.useRealTimers());

  it('junta as mudanças em 300 ms e manda o retrato com peças, explosão e vista', async () => {
    aberto.set(true);
    TestBed.tick();
    explosao.set(0.333);
    TestBed.tick();
    vi.advanceTimersByTime(DEBOUNCE_DO_ESTADO_MS - 1);
    expect(enviar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(enviar).toHaveBeenCalledOnce();
    expect(enviar).toHaveBeenCalledWith(expect.objectContaining({
      aberto: true, objeto: { id: 'h1a2b3c4d', nome: 'Motor V8' }, explosao: 0.33,
      pecas: [{ id: 'p1', nome: 'Pistão', grupo: 'pistoes' }], vista: 'livre',
    }));
  });

  it('fechado manda uma vez só', async () => {
    aberto.set(true);
    TestBed.tick();
    vi.advanceTimersByTime(DEBOUNCE_DO_ESTADO_MS);
    await Promise.resolve();
    aberto.set(false);
    TestBed.tick();
    vi.advanceTimersByTime(DEBOUNCE_DO_ESTADO_MS);
    await Promise.resolve();
    explosao.set(0.5);
    TestBed.tick();
    vi.advanceTimersByTime(DEBOUNCE_DO_ESTADO_MS);
    await Promise.resolve();
    expect(enviar.mock.calls.map(([e]) => e.aberto)).toEqual([true, false]);
  });
});
