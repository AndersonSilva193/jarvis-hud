import { AfterViewInit, Component, ElementRef, OnDestroy, computed, inject, input, signal, viewChild } from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { NgOptimizedImage } from '@angular/common';
import { YoutubeService, type PlayerYoutube } from '../../nucleo/youtube.service';
import { MidiaService } from '../../nucleo/midia.service';
import { JanelasService } from '../../nucleo/janelas.service';
import { AbrirLinkService, urlSegura } from '../../nucleo/abrir-link.service';
import { videoIdValido, type AlternativaMidia, type DadosMidia } from '../../nucleo/tela.modelos';

@Component({
  selector: 'app-player-midia', imports: [NgOptimizedImage],
  template: `
    <div class="video" [class.falhou]="!!erro()">
      <iframe #quadro [src]="embed()" [title]="atual().titulo" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
    </div>
    @if (erro()) {
      @if (imagem() && !imagemFalhou()) { <div class="miniatura"><img [ngSrc]="imagem()" fill sizes="100vw" [alt]="atual().titulo" (error)="imagemFalhou.set(true)" /></div> }
      <p role="status">{{ erro() }}</p>
    }
    <div class="descricao"><h2>{{ atual().titulo }}</h2><p>{{ atual().canal }}</p></div>
    <div class="controles">
      @if (!erro()) {
        <button type="button" [disabled]="!pronto()" (click)="alternar()" [attr.aria-label]="midia.tocando(id()) ? 'Pausar' : 'Reproduzir'">{{ midia.tocando(id()) ? 'Pausar' : 'Play' }}</button>
        <label>Volume <input type="range" min="0" max="100" [value]="midia.estado(id())?.volume ?? 70" (input)="volume($event)" aria-label="Volume do player" /></label>
      }
      <button type="button" (click)="links.abrir(link())">{{ erro() ? 'Abrir no YouTube' : 'Abrir ↗' }}</button>
    </div>
    @if (bloqueado()) { <p class="aviso" role="status">Toque em Play para permitir a reprodução.</p> }
    @if (dados().alternativas.length) {
      <details class="alternativas"><summary>Outras opções</summary><ul>@for (alternativa of dados().alternativas; track alternativa.videoId) {
        <li><button type="button" (click)="trocar(alternativa)">{{ alternativa.titulo }} · {{ alternativa.canal }}</button></li>
      }</ul></details>
    }
  `,
  styles: `:host{display:block;min-width:200px}.video{min-width:200px;min-height:200px;height:clamp(200px,28vh,360px)}iframe{display:block;width:100%;height:100%;min-width:200px;min-height:200px;border:0}.video.falhou{display:none}.miniatura{height:200px;position:relative}.miniatura img{object-fit:contain}h2{font-size:1rem;margin:.6rem 0 .2rem}p{margin:.3rem 0;line-height:1.4;font-size:.8rem;color:#c2d9e9}.controles{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:.5rem 0}button{color:#dff4ff;background:#0c2943;border:1px solid #6fa6c3;padding:.45rem .6rem;cursor:pointer}button:disabled{opacity:.6}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #fff;outline-offset:3px}label{display:flex;gap:.4rem;align-items:center;font-size:.75rem}input{width:90px;accent-color:#5ff2ff}.alternativas{margin-top:.5rem;font-size:.8rem}.alternativas ul{list-style:none;padding:0}.alternativas li{margin:.4rem 0}.alternativas button{text-align:left;width:100%}.aviso{color:#ffcf88}:host-context(.com-player) .descricao,:host-context(.com-player) .alternativas{display:none}:host-context(.com-player) .video{height:200px}:host-context(.com-player) .controles{margin:.3rem 0}`,
})
export class PlayerMidiaComponent implements AfterViewInit, OnDestroy {
  readonly id = input.required<string>();
  readonly dados = input.required<DadosMidia>();
  private readonly youtube = inject(YoutubeService);
  protected readonly midia = inject(MidiaService);
  private readonly janelas = inject(JanelasService);
  protected readonly links = inject(AbrirLinkService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly quadro = viewChild<ElementRef<HTMLIFrameElement>>('quadro');
  private readonly escolha = signal<AlternativaMidia | null>(null);
  protected readonly atual = computed(() => this.escolha() ?? this.dados());
  // Não muda com as alternativas: loadVideoById mantém o mesmo iframe e a mesma instância.
  private embedInicial: SafeResourceUrl | null = null;
  protected embed(): SafeResourceUrl {
    if (this.embedInicial) return this.embedInicial;
    const id = this.dados().videoId;
    this.embedInicial = this.sanitizer.bypassSecurityTrustResourceUrl(videoIdValido(id) ? `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&playsinline=1&origin=${encodeURIComponent(location.origin)}` : 'about:blank');
    return this.embedInicial;
  }
  protected readonly link = computed(() => `https://www.youtube.com/watch?v=${this.atual().videoId}`);
  protected readonly imagem = computed(() => urlSegura(this.atual().miniatura));
  protected readonly imagemFalhou = signal(false);
  protected readonly pronto = signal(false);
  protected readonly erro = signal('');
  protected readonly bloqueado = signal(false);
  private player: PlayerYoutube | null = null;
  private destruido = false;
  private visibilidade: IntersectionObserver | null = null;
  async ngAfterViewInit(): Promise<void> {
    try {
      const api = await this.youtube.carregar();
      const quadro = this.quadro()?.nativeElement;
      if (this.destruido || !quadro) return;
      this.player = new api.Player(quadro, { events: {
        onReady: () => {
          if (this.destruido || !this.player) return;
          this.pronto.set(true); this.midia.registrar(this.id(), this.player);
          if (typeof IntersectionObserver !== 'undefined') {
            this.visibilidade = new IntersectionObserver(entradas => {
              if (entradas.some(e => e.intersectionRatio > .5)) { this.visibilidade?.disconnect(); this.player?.playVideo(); }
            }, { threshold: [.51] });
            this.visibilidade.observe(quadro);
          } else this.player.playVideo();
        },
        onStateChange: e => { this.midia.mudou(this.id(), e.data === 1); if (e.data === 1) this.bloqueado.set(false); },
        onError: e => { this.erro.set(e.data === 101 || e.data === 150 ? 'Este vídeo não permite incorporação.' : 'Não foi possível reproduzir este vídeo.'); this.midia.mudou(this.id(), false); },
        onAutoplayBlocked: () => { this.bloqueado.set(true); this.midia.mudou(this.id(), false); },
      }});
    } catch { if (!this.destruido) this.erro.set('O player está indisponível.'); }
  }
  protected alternar(): void { this.midia.executar(this.id(), this.midia.tocando(this.id()) ? 'pausar' : 'continuar'); }
  protected volume(evento: Event): void { if (evento.target instanceof HTMLInputElement) this.midia.volume(this.id(), evento.target.valueAsNumber); }
  protected trocar(alternativa: AlternativaMidia): void {
    if (!videoIdValido(alternativa.videoId) || !this.player) return;
    this.escolha.set(alternativa); this.imagemFalhou.set(false); this.erro.set(''); this.bloqueado.set(false);
    this.player.loadVideoById(alternativa.videoId);
    const dados = { ...this.dados(), ...alternativa };
    this.janelas.atualizarMidia(this.id(), { tipo: dados.modo, dados }, alternativa.titulo);
  }
  ngOnDestroy(): void {
    this.destruido = true; this.visibilidade?.disconnect();
    this.player?.destroy(); this.midia.remover(this.id());
  }
}
