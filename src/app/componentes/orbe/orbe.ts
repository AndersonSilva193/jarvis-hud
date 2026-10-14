import { AfterViewInit, Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';

import {
  amplitudeAlvo,
  criarParticulas,
  desenharCampo,
  desenharReator,
  suavizar,
  type Particula,
  type Quadro,
} from './desenho-orbe';

export type EstadoOrbe = 'ocioso' | 'ouvindo' | 'gerando' | 'pensando' | 'falando';

/** O campo é largo como a tela: mais densidade que isso só custa GPU sem aparecer. */
const DENSIDADE_MAXIMA_DO_CAMPO = 1.5;
/** Uma partícula a cada tantos px² do campo, para a poeira ter a mesma cara em qualquer monitor. */
const AREA_POR_PARTICULA = 11_000;

/**
 * O reator no centro e a onda de voz que atravessa a tela.
 *
 * São dois canvas num laço só: o `campo` (onda, espectro e partículas, da largura da tela) e a
 * `tela` (o anel, quadrado). O desenho em si mora em `desenho-orbe.ts`; aqui fica só o ciclo de
 * vida — tamanho, visibilidade da aba, `prefers-reduced-motion` e a suavização da amplitude.
 */
@Component({
  selector: 'app-orbe',
  templateUrl: './orbe.html',
  styleUrl: './orbe.scss',
  host: { '[attr.data-estado]': 'estado()' },
})
export class OrbeComponent implements AfterViewInit, OnDestroy {
  readonly estado = input<EstadoOrbe>('ocioso');
  readonly intensidade = input(0);
  private readonly tela = viewChild.required<ElementRef<HTMLCanvasElement>>('tela');
  private readonly campo = viewChild.required<ElementRef<HTMLCanvasElement>>('campo');
  private contexto: CanvasRenderingContext2D | null = null;
  private contextoCampo: CanvasRenderingContext2D | null = null;
  private observador: ResizeObserver | null = null;
  private quadro: number | null = null;
  private largura = 0;
  private altura = 0;
  private larguraCampo = 0;
  private alturaCampo = 0;
  private tempo = 0;
  private anterior = 0;
  private amplitude = amplitudeAlvo('ocioso', 0, 0);
  private particulas: Particula[] = [];
  private movimento: MediaQueryList | null = null;

  constructor() {
    effect(() => {
      this.estado();
      this.intensidade();
      if (this.movimento?.matches) this.desenhar();
    });
  }

  ngAfterViewInit(): void {
    this.contexto = this.tela().nativeElement.getContext('2d');
    this.contextoCampo = this.campo().nativeElement.getContext('2d');
    if (!this.contexto) return;
    this.movimento =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.movimento?.addEventListener('change', this.atualizar);
    document.addEventListener('visibilitychange', this.atualizar);
    this.observador = new ResizeObserver(() => this.ajustar());
    this.observador.observe(this.tela().nativeElement);
    this.observador.observe(this.campo().nativeElement);
    this.ajustar();
    this.atualizar();
  }

  ngOnDestroy(): void {
    this.suspender();
    this.observador?.disconnect();
    document.removeEventListener('visibilitychange', this.atualizar);
    this.movimento?.removeEventListener('change', this.atualizar);
  }

  private suspender(): void {
    if (this.quadro !== null) cancelAnimationFrame(this.quadro);
    this.quadro = null;
    this.anterior = 0;
  }

  private readonly atualizar = (): void => {
    this.suspender();
    if (document.hidden) return;
    this.desenhar();
    if (!this.movimento?.matches) this.quadro = requestAnimationFrame(this.animar);
  };

  private readonly animar = (agora: number): void => {
    this.quadro = null;
    if (document.hidden) return;
    const delta = this.anterior ? Math.min((agora - this.anterior) / 1000, 0.05) : 0;
    this.anterior = agora;
    this.tempo += delta;
    this.amplitude = suavizar(
      this.amplitude,
      amplitudeAlvo(this.estado(), this.intensidade(), this.tempo),
      delta,
    );
    this.desenhar();
    this.quadro = requestAnimationFrame(this.animar);
  };

  private ajustar(): void {
    const tela = this.tela().nativeElement;
    const densidade = Math.min(devicePixelRatio || 1, 2);
    this.largura = tela.clientWidth;
    this.altura = tela.clientHeight;
    tela.width = this.largura * densidade;
    tela.height = this.altura * densidade;
    this.contexto?.setTransform(densidade, 0, 0, densidade, 0, 0);

    const campo = this.campo().nativeElement;
    const densidadeCampo = Math.min(densidade, DENSIDADE_MAXIMA_DO_CAMPO);
    this.larguraCampo = campo.clientWidth;
    this.alturaCampo = campo.clientHeight;
    campo.width = this.larguraCampo * densidadeCampo;
    campo.height = this.alturaCampo * densidadeCampo;
    this.contextoCampo?.setTransform(densidadeCampo, 0, 0, densidadeCampo, 0, 0);
    const quantas = Math.round((this.larguraCampo * this.alturaCampo) / AREA_POR_PARTICULA);
    if (quantas !== this.particulas.length) this.particulas = criarParticulas(Math.min(quantas, 160));

    this.desenhar();
  }

  private desenhar(): void {
    const parado = !!this.movimento?.matches;
    const estado = this.estado();
    const forca = estado === 'falando' ? Math.max(0, Math.min(1, this.intensidade())) : 0;
    const tempo = parado ? 0 : this.tempo;
    // Sem animação não há quadro para suavizar: a amplitude vai direto para o alvo do estado.
    const amplitude = parado ? amplitudeAlvo(estado, forca, 0) : this.amplitude;
    const base = { tempo, estado, forca, amplitude } satisfies Omit<Quadro, 'largura' | 'altura'>;
    if (this.contextoCampo && this.larguraCampo && this.alturaCampo) {
      desenharCampo(
        this.contextoCampo,
        { ...base, largura: this.larguraCampo, altura: this.alturaCampo },
        this.particulas,
      );
    }
    if (this.contexto && this.largura && this.altura) {
      desenharReator(this.contexto, { ...base, largura: this.largura, altura: this.altura });
    }
  }
}
