import { DestroyRef, Service, computed, effect, inject, signal } from '@angular/core';
import type { AcaoTela } from './tela.modelos';
import type { PlayerYoutube } from './youtube.service';
import { VozService } from './voz.service';

export interface EstadoMidia { tocando: boolean; volume: number; posicao: number; pronto: boolean }
@Service()
export class MidiaService {
  private readonly voz = inject(VozService);
  private readonly players = new Map<string, PlayerYoutube>();
  private readonly aplicados = new Map<string, number>();
  private relogio: ReturnType<typeof setInterval> | null = null;
  readonly estados = signal<Record<string, EstadoMidia>>({});
  readonly ativo = computed(() => Object.entries(this.estados()).find(([,e]) => e.tocando)?.[0] ?? null);
  readonly bandeja = signal<string | null>(null);
  constructor() {
    effect(() => {
      const falando = this.voz.falando();
      for (const [id, estado] of Object.entries(this.estados())) this.aplicarVolume(id, estado.volume * (falando ? .2 : 1));
    });
    inject(DestroyRef).onDestroy(() => { if (this.relogio) clearInterval(this.relogio); });
  }
  registrar(id: string, player: PlayerYoutube): void {
    this.players.set(id, player);
    this.estados.update(e => ({ ...e, [id]: { tocando: false, volume: 70, posicao: 0, pronto: true } }));
    this.aplicarVolume(id, 70 * (this.voz.falando() ? .2 : 1));
    this.relogio ??= setInterval(() => { for (const id of this.players.keys()) this.lerVolume(id); }, 500);
  }
  remover(id: string): void {
    this.players.delete(id);
    this.aplicados.delete(id);
    if (!this.players.size && this.relogio) { clearInterval(this.relogio); this.relogio = null; }
    this.estados.update(e => { const copia = { ...e }; delete copia[id]; return copia; });
    if (this.bandeja() === id) this.bandeja.set(null);
  }
  estado(id: string): EstadoMidia | undefined { return this.estados()[id]; }
  tocando(id: string): boolean { return this.estado(id)?.tocando ?? false; }
  mostrarBandeja(id: string): void {
    const anterior = this.bandeja();
    if (anterior && anterior !== id && this.tocando(anterior)) this.executar(anterior, 'pausar');
    this.bandeja.set(id);
  }
  mudou(id: string, tocando: boolean): void {
    if (!this.players.has(id)) return;
    this.lerVolume(id);
    if (tocando) for (const [outro, p] of this.players) if (outro !== id && this.tocando(outro)) { p.pauseVideo(); this.atualizar(outro, { tocando: false }); }
    this.atualizar(id, { tocando, posicao: this.players.get(id)!.getCurrentTime() || 0 });
  }
  volume(id: string, volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.atualizar(id, { volume: Math.min(100, Math.max(0, volume)) });
    this.aplicarVolume(id, (this.estado(id)?.volume ?? 70) * (this.voz.falando() ? .2 : 1));
  }
  executar(id: string, acao: AcaoTela, valor = ''): boolean {
    const p = this.players.get(id), estado = this.estado(id);
    if (!p || !estado) return false;
    switch (acao) {
      case 'pausar': p.pauseVideo(); this.mudou(id, false); return true;
      case 'continuar': p.playVideo(); return true;
      case 'volume_mais': this.volume(id, estado.volume + 10); return true;
      case 'volume_menos': this.volume(id, estado.volume - 10); return true;
      case 'avancar': case 'voltar': {
        const segundos = Number(valor);
        if (!valor.trim() || !Number.isFinite(segundos) || segundos < 0) return false;
        const duracao = p.getDuration();
        const posicao = Math.max(0, Math.min(duracao > 0 ? duracao : Infinity, p.getCurrentTime() + segundos * (acao === 'voltar' ? -1 : 1)));
        p.seekTo(posicao, true); this.atualizar(id, { posicao }); return true;
      }
      default: return false;
    }
  }
  private atualizar(id: string, parte: Partial<EstadoMidia>): void {
    if (this.estado(id)) this.estados.update(e => ({ ...e, [id]: { ...e[id]!, ...parte } }));
  }
  private aplicarVolume(id: string, volume: number): void {
    const arredondado = Math.round(volume);
    if (this.aplicados.get(id) === arredondado) return;
    this.aplicados.set(id, arredondado); this.players.get(id)?.setVolume(arredondado);
  }
  private lerVolume(id: string): void {
    const volume = this.players.get(id)?.getVolume();
    if (volume === undefined || !Number.isFinite(volume) || Math.abs(volume - (this.aplicados.get(id) ?? volume)) < 1) return;
    this.aplicados.set(id, Math.round(volume));
    this.atualizar(id, { volume: Math.min(100, Math.max(0, Math.round(volume / (this.voz.falando() ? .2 : 1)))) });
  }
}
