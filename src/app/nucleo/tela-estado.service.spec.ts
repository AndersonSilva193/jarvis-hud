import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelaEstadoService } from './tela-estado.service';
import { TelaService } from './tela.service';
import { JarvisApiService } from './jarvis-api.service';
import { ConfigStore } from './config.store';
import type { EstadoTela } from './tela.modelos';

const vazio: EstadoTela = { janelas: [], historicoAberto: false, briefingNaTela: false };
describe('sincronização de estado', () => {
  const estado = signal<EstadoTela>(vazio), ativa = signal(true), estados = signal({});
  const enviar = vi.fn<(e: EstadoTela) => Promise<void>>();
  beforeEach(() => {
    vi.useFakeTimers(); estado.set(vazio); ativa.set(true); estados.set({}); enviar.mockReset().mockResolvedValue(undefined);
    TestBed.configureTestingModule({ providers: [
      { provide: TelaService, useValue: { ativa, estado, midia: { estados } } },
      { provide: JarvisApiService, useValue: { enviarEstadoTela: enviar } },
      { provide: ConfigStore, useValue: { configurado: signal(true), urlApi: signal('https://api.test'), token: signal('teste') } },
    ] });
    TestBed.inject(TelaEstadoService); TestBed.tick();
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.clearAllTimers(); vi.useRealTimers(); });
  it('agrupa mudanças por 500 ms e envia o último retrato', async () => {
    await vi.advanceTimersByTimeAsync(300); estado.set({ ...vazio, historicoAberto: true }); TestBed.tick();
    await vi.advanceTimersByTimeAsync(499); expect(enviar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(enviar).toHaveBeenCalledExactlyOnceWith({ ...vazio, historicoAberto: true });
  });
  it('não envia em paralelo e substitui estados pendentes antigos', async () => {
    let liberar!: () => void; enviar.mockImplementationOnce(() => new Promise<void>(resolve => { liberar = resolve; }));
    await vi.advanceTimersByTimeAsync(500);
    estado.set({ ...vazio, historicoAberto: true }); TestBed.tick(); await vi.advanceTimersByTimeAsync(500);
    estado.set({ ...vazio, briefingNaTela: true }); TestBed.tick(); await vi.advanceTimersByTimeAsync(500);
    expect(enviar).toHaveBeenCalledTimes(1); liberar(); await vi.advanceTimersByTimeAsync(0);
    expect(enviar).toHaveBeenLastCalledWith({ ...vazio, briefingNaTela: true }); expect(enviar).toHaveBeenCalledTimes(2);
  });
  it('falha não impede reconexão e encerrar cancela debounce e pulso', async () => {
    enviar.mockRejectedValueOnce(new Error('offline')); await vi.advanceTimersByTimeAsync(500);
    TestBed.inject(TelaEstadoService).reenviar(); await vi.advanceTimersByTimeAsync(500); expect(enviar).toHaveBeenCalledTimes(2);
    ativa.set(false); TestBed.tick(); await vi.advanceTimersByTimeAsync(6 * 60_000); expect(enviar).toHaveBeenCalledTimes(2);
  });
  it('renova antes da expiração do servidor e reporta mudança do player', async () => {
    await vi.advanceTimersByTimeAsync(500); estados.set({ video: { volume: 50 } }); TestBed.tick(); await vi.advanceTimersByTimeAsync(500);
    expect(enviar).toHaveBeenCalledTimes(2); await vi.advanceTimersByTimeAsync(5 * 60_000); expect(enviar).toHaveBeenCalledTimes(3);
  });
});
