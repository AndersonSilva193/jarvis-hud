import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { YoutubeService, type ApiYoutube } from './youtube.service';
afterEach(() => { TestBed.resetTestingModule(); delete window.YT; delete window.onYouTubeIframeAPIReady; document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]').forEach(s => s.remove()); vi.useRealTimers(); });
it('carrega um único script para pedidos simultâneos', async () => {
  const s = TestBed.inject(YoutubeService), a = s.carregar(), b = s.carregar();
  expect(a).toBe(b); expect(document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')).toHaveLength(1);
  window.YT = { Player: class {} } as unknown as ApiYoutube; window.onYouTubeIframeAPIReady?.();
  expect(await a).toBe(window.YT); expect(await s.carregar()).toBe(window.YT);
});
it('falha de rede permite nova tentativa sem duplicar scripts', async () => {
  const s = TestBed.inject(YoutubeService), a = s.carregar(); const erro = expect(a).rejects.toThrow('carregar');
  document.querySelector('script[src="https://www.youtube.com/iframe_api"]')?.dispatchEvent(new Event('error')); await erro;
  const b = s.carregar(); expect(document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')).toHaveLength(1);
  window.YT = { Player: class {} } as unknown as ApiYoutube; window.onYouTubeIframeAPIReady?.(); await b;
});
