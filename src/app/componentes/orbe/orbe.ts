import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  input,
  viewChild,
} from '@angular/core';

export type EstadoOrbe = 'ocioso' | 'gerando' | 'falando';

const TAU = Math.PI * 2;
const PARTICULAS = 130;
const ANEIS = 3;

interface Particula {
  angulo: number;
  raio: number;
  velocidade: number;
  tamanho: number;
  fase: number;
  achatamento: number;
}

/**
 * O orbe de energia: núcleo, anéis em órbita e partículas, desenhados em <canvas>.
 *
 * O laço de animação lê os inputs direto (são signals) em vez de reagir a eles, porque quem
 * manda no ritmo aqui é o requestAnimationFrame — a intensidade muda a cada quadro enquanto o
 * Jarvis fala, e redesenhar por mudança de estado seria o caminho mais longo para o mesmo lugar.
 */
@Component({
  selector: 'app-orbe',
  templateUrl: './orbe.html',
  styleUrl: './orbe.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrbeComponent implements AfterViewInit, OnDestroy {
  readonly estado = input<EstadoOrbe>('ocioso');
  /** 0 a 1: no estado "falando" é o que faz o orbe pulsar junto com as sílabas. */
  readonly intensidade = input(0);
  readonly legenda = input('');

  private readonly tela = viewChild.required<ElementRef<HTMLCanvasElement>>('tela');

  private contexto: CanvasRenderingContext2D | null = null;
  private observador: ResizeObserver | null = null;
  private quadro: number | null = null;
  private largura = 0;
  private altura = 0;
  private giro = 0;
  private readonly particulas = semear();

  ngAfterViewInit(): void {
    const canvas = this.tela().nativeElement;
    this.contexto = canvas.getContext('2d');
    if (!this.contexto) {
      return;
    }

    this.observador = new ResizeObserver(() => this.ajustar());
    this.observador.observe(canvas);
    this.ajustar();

    if (preferePoucoMovimento()) {
      this.desenhar(0);
      return;
    }
    const passo = (tempo: number) => {
      this.desenhar(tempo / 1000);
      this.quadro = requestAnimationFrame(passo);
    };
    this.quadro = requestAnimationFrame(passo);
  }

  ngOnDestroy(): void {
    if (this.quadro !== null) {
      cancelAnimationFrame(this.quadro);
    }
    this.observador?.disconnect();
  }

  /** Canvas na resolução real do monitor: sem isso o orbe sai borrado em tela 4K. */
  private ajustar(): void {
    const canvas = this.tela().nativeElement;
    const contexto = this.contexto;
    if (!contexto) {
      return;
    }
    const densidade = Math.min(window.devicePixelRatio || 1, 2);
    this.largura = canvas.clientWidth;
    this.altura = canvas.clientHeight;
    canvas.width = Math.round(this.largura * densidade);
    canvas.height = Math.round(this.altura * densidade);
    contexto.setTransform(densidade, 0, 0, densidade, 0, 0);
  }

  private desenhar(segundos: number): void {
    const ctx = this.contexto;
    if (!ctx || this.largura === 0 || this.altura === 0) {
      return;
    }

    const estado = this.estado();
    const forca = estado === 'falando' ? limitar(this.intensidade()) : 0;
    const agitacao = estado === 'gerando' ? 1 : 0;
    const cx = this.largura / 2;
    const cy = this.altura / 2;
    const base = Math.min(this.largura, this.altura) * 0.3;

    this.giro += 0.0022 + 0.004 * agitacao + 0.003 * forca;

    ctx.clearRect(0, 0, this.largura, this.altura);
    // Tudo somando luz: é o que faz os cruzamentos de anel e partícula brilharem.
    ctx.globalCompositeOperation = 'lighter';

    this.halo(ctx, cx, cy, base, forca, agitacao);
    this.nucleo(ctx, cx, cy, base, forca);
    this.aneis(ctx, cx, cy, base, forca, agitacao);
    this.poeira(ctx, cx, cy, base, forca, segundos);
    this.pulso(ctx, cx, cy, base, forca);
    if (agitacao > 0) {
      this.varredura(ctx, cx, cy, base, segundos);
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  private halo(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    base: number,
    forca: number,
    agitacao: number,
  ): void {
    const raio = base * 2.8;
    const brilho = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, raio);
    brilho.addColorStop(0, `rgba(45, 125, 255, ${0.26 + 0.2 * forca + 0.06 * agitacao})`);
    brilho.addColorStop(0.42, 'rgba(22, 74, 168, 0.1)');
    brilho.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = brilho;
    ctx.beginPath();
    ctx.arc(cx, cy, raio, 0, TAU);
    ctx.fill();
  }

  private nucleo(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    base: number,
    forca: number,
  ): void {
    const raio = base * (0.58 + 0.07 * forca);
    const brilho = ctx.createRadialGradient(cx, cy, base * 0.04, cx, cy, raio);
    brilho.addColorStop(0, `rgba(236, 254, 255, ${0.82 + 0.15 * forca})`);
    brilho.addColorStop(0.3, `rgba(95, 242, 255, ${0.42 + 0.3 * forca})`);
    brilho.addColorStop(0.72, `rgba(45, 125, 255, ${0.16 + 0.14 * forca})`);
    brilho.addColorStop(1, 'rgba(45, 125, 255, 0)');
    ctx.fillStyle = brilho;
    ctx.beginPath();
    ctx.arc(cx, cy, raio, 0, TAU);
    ctx.fill();
  }

  /** Anéis elípticos em inclinações diferentes: é a inclinação que dá a sensação de volume. */
  private aneis(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    base: number,
    forca: number,
    agitacao: number,
  ): void {
    for (let i = 0; i < ANEIS; i += 1) {
      const escala = 1.04 + i * 0.17;
      const inclinacao = this.giro * (i % 2 === 0 ? 1 : -0.72) + (i * Math.PI) / ANEIS;
      ctx.save();
      ctx.lineWidth = 1.1 + 0.6 * forca;
      ctx.strokeStyle = `rgba(95, 242, 255, ${0.16 + 0.12 * forca + 0.05 * agitacao})`;
      ctx.beginPath();
      ctx.ellipse(
        cx,
        cy,
        base * escala,
        base * (0.26 + i * 0.1) * (1 + 0.08 * forca),
        inclinacao,
        0,
        TAU,
      );
      ctx.stroke();
      ctx.restore();
    }
  }

  private poeira(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    base: number,
    forca: number,
    segundos: number,
  ): void {
    for (const p of this.particulas) {
      const angulo = p.angulo + segundos * p.velocidade * (1 + 0.5 * forca);
      // A respiração dessincronizada evita o anel perfeito de pontos.
      const respiro = Math.sin(segundos * 1.4 + p.fase) * 0.06;
      const raio = base * (p.raio + respiro + 0.12 * forca);
      const x = cx + Math.cos(angulo) * raio;
      const y = cy + Math.sin(angulo) * raio * p.achatamento;
      const alfa = 0.3 + 0.45 * (Math.sin(segundos * 2.1 + p.fase) * 0.5 + 0.5) + 0.2 * forca;
      ctx.fillStyle = `rgba(166, 248, 255, ${Math.min(alfa, 0.95)})`;
      ctx.beginPath();
      ctx.arc(x, y, p.tamanho * (1 + 0.5 * forca), 0, TAU);
      ctx.fill();
    }
  }

  /** O anel externo que abre com a fala: é o "volume" visível do Jarvis. */
  private pulso(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    base: number,
    forca: number,
  ): void {
    if (forca <= 0.01) {
      return;
    }
    ctx.lineWidth = 1 + 2.4 * forca;
    ctx.strokeStyle = `rgba(166, 248, 255, ${0.1 + 0.4 * forca})`;
    ctx.beginPath();
    ctx.arc(cx, cy, base * (1.5 + 0.34 * forca), 0, TAU);
    ctx.stroke();
  }

  /** Arco que corre em volta enquanto o servidor monta o briefing: o "radar" girando. */
  private varredura(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    base: number,
    segundos: number,
  ): void {
    const inicio = (segundos * 1.9) % TAU;
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(166, 248, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, base * 1.74, inicio, inicio + 0.7);
    ctx.stroke();
  }
}

function semear(): Particula[] {
  const particulas: Particula[] = [];
  for (let i = 0; i < PARTICULAS; i += 1) {
    particulas.push({
      angulo: Math.random() * TAU,
      raio: 0.62 + Math.random() * 0.78,
      velocidade: (0.08 + Math.random() * 0.4) * (Math.random() < 0.3 ? -1 : 1),
      tamanho: 0.5 + Math.random() * 1.5,
      fase: Math.random() * TAU,
      achatamento: 0.3 + Math.random() * 0.7,
    });
  }
  return particulas;
}

function limitar(valor: number): number {
  return Math.max(0, Math.min(1, valor));
}

function preferePoucoMovimento(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
