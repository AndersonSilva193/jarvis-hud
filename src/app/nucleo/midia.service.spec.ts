import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MidiaService } from './midia.service';
import { VozService } from './voz.service';
import type { PlayerYoutube } from './youtube.service';

function player(): PlayerYoutube { let volume = 70; return { playVideo: vi.fn(), pauseVideo: vi.fn(), setVolume: vi.fn(v => { volume = v; }), getVolume: () => volume, getCurrentTime: () => 30, getDuration: () => 120, seekTo: vi.fn(), loadVideoById: vi.fn(), destroy: vi.fn() }; }
afterEach(() => TestBed.resetTestingModule());
describe('players de mídia', () => {
  it('pausa o anterior e controla volume e seek dentro dos limites', () => {
    TestBed.configureTestingModule({ providers: [{ provide: VozService, useValue: { falando: signal(false) } }] });
    const s = TestBed.inject(MidiaService), a = player(), b = player(); s.registrar('a', a); s.registrar('b', b);
    s.mudou('a', true); s.mudou('b', true); expect(a.pauseVideo).toHaveBeenCalledOnce(); expect(s.ativo()).toBe('b');
    s.volume('b', 999); expect(s.estado('b')?.volume).toBe(100);
    s.executar('b', 'voltar', '999'); expect(b.seekTo).toHaveBeenLastCalledWith(0, true);
    s.executar('b', 'avancar', '999'); expect(b.seekTo).toHaveBeenLastCalledWith(120, true);
    expect(s.executar('b', 'avancar', 'NaN')).toBe(false);
  });
  it('reduz durante fala e restaura o volume mais recente sem retomar uma pausa manual', () => {
    const falando = signal(false);
    TestBed.configureTestingModule({ providers: [{ provide: VozService, useValue: { falando } }] });
    const s = TestBed.inject(MidiaService), a = player(); s.registrar('a', a); s.mudou('a', true);
    falando.set(true); TestBed.tick(); expect(a.setVolume).toHaveBeenLastCalledWith(14);
    s.volume('a', 50); TestBed.tick(); expect(a.setVolume).toHaveBeenLastCalledWith(10);
    s.executar('a', 'pausar'); falando.set(false); TestBed.tick();
    expect(a.setVolume).toHaveBeenLastCalledWith(50); expect(a.playVideo).not.toHaveBeenCalled(); expect(s.tocando('a')).toBe(false);
  });
});
