import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { PerfilDoAparelhoService } from '../../nucleo/perfil-do-aparelho.service';
import type { EstadoJarvis } from '../../nucleo/atividade-hud.service';
import type { CenaRosto } from './cena-rosto';
import { NgOptimizedImage } from '@angular/common';

@Component({
  selector: 'app-nucleo-jarvis',
  imports: [NgOptimizedImage],
  template: `
    <div class="halo" aria-hidden="true"></div>
    <div #alvo class="rosto-3d" [class.carregado]="carregado()" aria-hidden="true"></div>
    <div class="reserva" [class.oculta]="carregado()" aria-hidden="true">
      <div class="mascara-reserva">
        <img ngSrc="/ambiente/referencia-jarvis.png" width="1672" height="941" alt="" />
      </div>
    </div>
    <div class="ondas" [style.--energia]="intensidade()" aria-hidden="true">
      @for (barra of barras; track $index) {
        <i [style.--i]="$index" [style.height.px]="8 + intensidade() * barra"></i>
      }
    </div>
  `,
  styleUrl: './nucleo-jarvis.scss',
  host: { '[attr.data-estado]': 'estado()', '[class.compacto]': 'compacto()' },
})
export class NucleoJarvisComponent {
  readonly estado = input<EstadoJarvis>('repouso');
  readonly intensidade = input(0);
  readonly compacto = input(false);
  /** O visualizador de objetos tem precedência sobre o laço do rosto. */
  readonly pausado = input(false);
  protected readonly carregado = signal(false);
  protected readonly barras = [
    12, 20, 14, 32, 45, 25, 55, 72, 38, 86, 52, 38, 66, 44, 90, 36, 56, 24, 44, 15, 28, 18, 10,
  ];
  private readonly alvo = viewChild.required<ElementRef<HTMLDivElement>>('alvo');
  private readonly perfil = inject(PerfilDoAparelhoService);
  private cena: CenaRosto | null = null;
  private quadro: number | null = null;
  private vivo = true;
  private falhou = false;
  private reduzido = false;
  private tempo = 0;
  private anterior = 0;

  constructor() {
    effect(() => {
      this.pausado();
      untracked(() => this.atualizar());
    });
    effect(() => {
      this.estado();
      this.intensidade();
      if (this.reduzido && !this.pausado()) this.desenhar();
    });
    afterNextRender(() => {
      void this.iniciar();
    });
    inject(DestroyRef).onDestroy(() => {
      this.vivo = false;
      this.parar();
      this.cena?.destruir();
    });
  }

  private async iniciar(): Promise<void> {
    if (
      typeof matchMedia !== 'function' ||
      typeof ResizeObserver === 'undefined' ||
      typeof WebGLRenderingContext === 'undefined'
    )
      return;
    const host = this.alvo().nativeElement;
    const movimento = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduzido = movimento.matches;
    try {
      const { CenaRosto } = await import('./cena-rosto');
      if (!this.vivo) return;
      this.cena = new CenaRosto(host, this.perfil.perfil() === 'leve', () => this.desenhar());
      const medir = () => {
        this.cena?.redimensionar(host.clientWidth, host.clientHeight);
        this.desenhar();
      };
      const observador = new ResizeObserver(medir);
      observador.observe(host);
      const ajustar = () => {
        this.reduzido = movimento.matches;
        this.atualizar();
      };
      const contextoPerdido = (e: Event) => {
        e.preventDefault();
        this.falhou = true;
        this.parar();
        this.carregado.set(false);
      };
      host.querySelector('canvas')?.addEventListener('webglcontextlost', contextoPerdido);
      document.addEventListener('visibilitychange', ajustar);
      movimento.addEventListener('change', ajustar);
      this.limpar = () => {
        observador.disconnect();
        document.removeEventListener('visibilitychange', ajustar);
        movimento.removeEventListener('change', ajustar);
      };
      medir();
      this.carregado.set(true);
      this.atualizar();
    } catch {
      this.carregado.set(false);
    }
  }
  private limpar = (): void => {};
  private parar(): void {
    if (this.quadro !== null) cancelAnimationFrame(this.quadro);
    this.quadro = null;
    this.anterior = 0;
    if (!this.vivo) this.limpar();
  }
  private atualizar(): void {
    this.parar();
    if (!this.cena || document.hidden || !this.vivo || this.falhou) return;
    this.desenhar();
    if (!this.reduzido && !this.pausado()) this.quadro = requestAnimationFrame(this.animar);
  }
  private readonly animar = (agora: number): void => {
    this.quadro = null;
    this.tempo += this.anterior ? Math.min((agora - this.anterior) / 1000, 0.05) : 0;
    this.anterior = agora;
    this.desenhar();
    this.quadro = requestAnimationFrame(this.animar);
  };
  private desenhar(): void {
    if (!this.falhou)
      this.cena?.desenhar(
        this.tempo,
        this.estado(),
        this.intensidade(),
        this.reduzido || this.pausado(),
      );
  }
}
