import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerMidiaComponent } from './player-midia';
import { YoutubeService, type ApiYoutube, type OpcoesYoutube, type PlayerYoutube } from '../../nucleo/youtube.service';
import { VozService } from '../../nucleo/voz.service';
import { MidiaService } from '../../nucleo/midia.service';
import type { DadosMidia } from '../../nucleo/tela.modelos';

const dados: DadosMidia = { modo: 'video', videoId: 'M7lc1UVf-VE', titulo: 'Teste', canal: 'Canal', miniatura: '', alternativas: [{ videoId: 'dQw4w9WgXcQ', titulo: 'Alternativa', canal: 'Outro canal', miniatura: '' }] };
describe('player compartilhado', () => {
  let opcoes: OpcoesYoutube;
  const player: PlayerYoutube = { playVideo: vi.fn(), pauseVideo: vi.fn(), setVolume: vi.fn(), getVolume: () => 70, getCurrentTime: () => 0, getDuration: () => 60, seekTo: vi.fn(), loadVideoById: vi.fn(), destroy: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    class PlayerFake { constructor(_el: HTMLIFrameElement, op: OpcoesYoutube) { opcoes = op; return player; } }
    TestBed.configureTestingModule({ providers: [{ provide: YoutubeService, useValue: { carregar: async () => ({ Player: PlayerFake }) } }, { provide: VozService, useValue: { falando: signal(false) } }] });
  });
  afterEach(() => TestBed.resetTestingModule());
  async function montar() {
    const f = TestBed.createComponent(PlayerMidiaComponent); f.componentRef.setInput('id', 'v1'); f.componentRef.setInput('dados', dados); f.detectChanges(); await Promise.resolve();
    opcoes.events.onReady(); f.detectChanges(); return f;
  }
  it.each([101, 150])('erro %s oferece abrir no YouTube sem fingir que está tocando', async erro => {
    const f = await montar(); opcoes.events.onStateChange({ data: 1 }); opcoes.events.onError({ data: erro }); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('não permite incorporação'); expect(f.nativeElement.textContent).toContain('Abrir no YouTube'); expect(TestBed.inject(MidiaService).tocando('v1')).toBe(false);
  });
  it('autoplay bloqueado mostra play, alternativa conserva iframe e destruição libera player', async () => {
    const f = await montar(); const quadro = f.nativeElement.querySelector('iframe'); const src = quadro.src;
    opcoes.events.onAutoplayBlocked(); f.detectChanges(); expect(f.nativeElement.textContent).toContain('Toque em Play');
    f.nativeElement.querySelector('.alternativas button').click(); f.detectChanges(); expect(player.loadVideoById).toHaveBeenCalledWith('dQw4w9WgXcQ'); expect(f.nativeElement.querySelector('iframe')).toBe(quadro); expect(quadro.src).toBe(src);
    f.destroy(); expect(player.destroy).toHaveBeenCalledOnce(); expect(TestBed.inject(MidiaService).estado('v1')).toBeUndefined();
  });
});

describe('falhas de incorporação', () => {
  const player: PlayerYoutube = { playVideo: vi.fn(), pauseVideo: vi.fn(), setVolume: vi.fn(), getVolume: () => 70, getCurrentTime: () => 0, getDuration: () => 60, seekTo: vi.fn(), loadVideoById: vi.fn(), destroy: vi.fn() };
  afterEach(() => TestBed.resetTestingModule());
  /** Espera o await de ngAfterViewInit, que não passa pelo detectChanges. */
  async function montar(carregar: () => Promise<ApiYoutube>) {
    TestBed.configureTestingModule({ providers: [{ provide: YoutubeService, useValue: { carregar } }, { provide: VozService, useValue: { falando: signal(false) } }] });
    const f = TestBed.createComponent(PlayerMidiaComponent); f.componentRef.setInput('id', 'v2'); f.componentRef.setInput('dados', dados);
    f.detectChanges(); await new Promise(pronto => setTimeout(pronto)); f.detectChanges(); return f;
  }
  it('erro fora de 101/150 mostra mensagem e abertura externa', async () => {
    let opcoes: OpcoesYoutube | undefined;
    class PlayerFake { constructor(_el: HTMLIFrameElement, op: OpcoesYoutube) { opcoes = op; return player; } }
    const f = await montar(async () => ({ Player: PlayerFake }) as unknown as ApiYoutube);
    opcoes!.events.onReady(); opcoes!.events.onStateChange({ data: 1 }); opcoes!.events.onError({ data: 5 }); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Não foi possível reproduzir');
    expect(f.nativeElement.textContent).toContain('Abrir no YouTube');
    expect(f.nativeElement.querySelector('.video.falhou')).not.toBeNull();
    expect(TestBed.inject(MidiaService).tocando('v2')).toBe(false);
  });
  it('API indisponível não deixa controles mortos na tela', async () => {
    const f = await montar(() => Promise.reject(new Error('Não foi possível carregar o player.')));
    expect(f.nativeElement.textContent).toContain('O player está indisponível');
    expect(f.nativeElement.textContent).toContain('Abrir no YouTube');
    expect(f.nativeElement.querySelector('input[type=range]')).toBeNull();
    expect(TestBed.inject(MidiaService).estado('v2')).toBeUndefined();
  });
});
