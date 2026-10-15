import { Service } from '@angular/core';

export interface PlayerYoutube {
  playVideo(): void; pauseVideo(): void; setVolume(volume: number): void; getVolume(): number;
  getCurrentTime(): number; getDuration(): number; seekTo(segundos: number, permitir: boolean): void;
  loadVideoById(id: string): void; destroy(): void;
}
export interface OpcoesYoutube {
  events: { onReady: () => void; onStateChange: (evento: { data: number }) => void;
    onError: (evento: { data: number }) => void; onAutoplayBlocked: () => void };
}
export interface ApiYoutube { Player: new (elemento: HTMLIFrameElement, opcoes: OpcoesYoutube) => PlayerYoutube }
declare global { interface Window { YT?: ApiYoutube; onYouTubeIframeAPIReady?: () => void } }

@Service()
export class YoutubeService {
  private carregamento: Promise<ApiYoutube> | null = null;
  carregar(): Promise<ApiYoutube> {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (this.carregamento) return this.carregamento;
    this.carregamento = new Promise((resolve, reject) => {
      const anterior = window.onYouTubeIframeAPIReady;
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
      const falhar = () => { clearTimeout(prazo); script.remove(); this.carregamento = null; window.onYouTubeIframeAPIReady = anterior; reject(new Error('Não foi possível carregar o player.')); };
      const prazo = setTimeout(falhar, 20_000);
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(prazo); anterior?.();
        if (window.YT?.Player) resolve(window.YT); else falhar();
      };
      script.onerror = falhar;
      document.head.appendChild(script);
    });
    return this.carregamento;
  }
}
