/**
 * O desenho do orbe, separado do componente: funções puras sobre um `CanvasRenderingContext2D`.
 *
 * São duas camadas. O **campo** é a faixa larga que atravessa a tela — a onda de voz, o
 * espectro nas pontas e as partículas. O **reator** é o anel luminoso no centro, com o núcleo
 * escuro que apaga a onda por trás dele e os arcos segmentados em volta.
 *
 * Fica fora do componente para poder ser desenhado sem Angular (prévia, teste visual) e para o
 * componente continuar sendo só ciclo de vida: tamanho, visibilidade e o laço de quadros.
 */

export type EstadoDesenho = 'ocioso' | 'ouvindo' | 'gerando' | 'pensando' | 'falando';

export interface Quadro {
  readonly largura: number;
  readonly altura: number;
  /** Segundos acumulados da animação; zero com `prefers-reduced-motion`. */
  readonly tempo: number;
  readonly estado: EstadoDesenho;
  /** 0–1: energia da fala. Só tem valor no estado `falando`. */
  readonly forca: number;
  /** Altura da onda em fração da altura do campo, já suavizada pelo componente. */
  readonly amplitude: number;
}

export interface Particula {
  readonly x: number;
  readonly y: number;
  readonly raio: number;
  readonly deriva: number;
  readonly piscar: number;
  readonly fase: number;
}

/** Raio do anel principal em fração do lado do quadrado do orbe. Os anéis de CSS contam com ele. */
export const RAIO_DO_REATOR = 0.24;

const CIANO = '95, 242, 255';
const AZUL = '40, 170, 255';

/** A amplitude-alvo da onda por estado; o componente aproxima a atual dela quadro a quadro. */
export function amplitudeAlvo(estado: EstadoDesenho, forca: number, tempo: number): number {
  switch (estado) {
    case 'falando':
      return 0.045 + Math.max(0, Math.min(1, forca)) * 0.14;
    case 'ouvindo':
      // Sem nível real do microfone: uma respiração curta diz "estou captando" sem fingir dado.
      return 0.06 + Math.sin(tempo * 5.3) * 0.012 + Math.sin(tempo * 8.9) * 0.008;
    case 'pensando':
    case 'gerando':
      return 0.05;
    default:
      return 0.04;
  }
}

/** Aproxima `atual` de `alvo` sem depender da taxa de quadros. */
export function suavizar(atual: number, alvo: number, delta: number): number {
  const passo = 1 - Math.exp(-delta * 7);
  return atual + (alvo - atual) * passo;
}

export function criarParticulas(quantidade: number, aleatorio: () => number = Math.random): Particula[] {
  return Array.from({ length: quantidade }, () => {
    const grande = aleatorio() < 0.12;
    return {
      x: aleatorio(),
      y: 0.08 + aleatorio() * 0.84,
      raio: grande ? 1.8 + aleatorio() * 2.2 : 0.5 + aleatorio() * 1.1,
      deriva: (aleatorio() - 0.5) * 0.012,
      piscar: 0.4 + aleatorio() * 1.4,
      fase: aleatorio() * Math.PI * 2,
    };
  });
}

/** Quanto o estado acelera o giro dos arcos e a fase da onda. */
function ritmo(estado: EstadoDesenho): number {
  switch (estado) {
    case 'pensando':
    case 'gerando':
      return 2.6;
    case 'ouvindo':
      return 1.5;
    case 'falando':
      return 1.2;
    default:
      return 0.55;
  }
}

/**
 * O campo: a onda que atravessa a tela pela altura do centro do orbe, o espectro nas duas pontas
 * e as partículas. Desenhado por baixo do reator — o núcleo escuro dele cobre o miolo da onda.
 */
export function desenharCampo(
  ctx: CanvasRenderingContext2D,
  q: Quadro,
  particulas: readonly Particula[],
): void {
  const { largura: w, altura: h } = q;
  ctx.clearRect(0, 0, w, h);
  if (!w || !h) return;
  const cx = w / 2;
  const cy = h / 2;
  const t = q.tempo * ritmo(q.estado);
  const amp = q.amplitude * h;
  const raioReator = h * RAIO_DO_REATOR;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // A linha de base: um traço quase invisível que dá eixo ao instrumento.
  const base = gradienteHorizontal(ctx, w, CIANO, 0.12);
  ctx.strokeStyle = base;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 7]);
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(w, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  // O espectro: barras verticais simétricas nas pontas, longe do orbe, onde a onda já se acalma.
  const passo = Math.max(5, w / 260);
  ctx.lineWidth = Math.max(1, passo * 0.38);
  for (const lado of [-1, 1]) {
    for (let d = raioReator * 2.4; d < w / 2 - passo; d += passo) {
      const x = cx + lado * d;
      const borda = envelope(d, w, raioReator);
      const ruido = Math.abs(Math.sin(d * 0.071 + t * 2.1) * Math.sin(d * 0.013 - t * 1.3 + lado));
      const altura = amp * 1.7 * borda * (0.15 + 0.85 * ruido);
      if (altura < 1) continue;
      ctx.strokeStyle = `rgba(${AZUL}, ${0.1 + borda * 0.22})`;
      ctx.beginPath();
      ctx.moveTo(x, cy - altura);
      ctx.lineTo(x, cy + altura);
      ctx.stroke();
    }
  }

  // A onda: seis fios com fase deslocada. O primeiro ganha um halo largo por baixo no lugar do
  // shadowBlur, que num canvas da largura da tela custaria caro a cada quadro.
  const fios = 7;
  for (let fio = fios - 1; fio >= 0; fio--) {
    const escala = fio === 0 ? 1 : 0.55 + ((fio * 37) % 10) / 15;
    const principal = fio === 0;
    const caminho = (): void => {
      ctx.beginPath();
      const amostras = Math.ceil(w / 4);
      for (let i = 0; i <= amostras; i++) {
        const x = (i / amostras) * w;
        const y = cy + amp * escala * envelope(x - cx, w, raioReator) * ondaEm((x - cx) / h, t, fio);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };
    if (principal) {
      caminho();
      ctx.strokeStyle = gradienteHorizontal(ctx, w, AZUL, 0.16 + q.forca * 0.12);
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = gradienteHorizontal(ctx, w, '175, 250, 255', 0.95);
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else {
      caminho();
      ctx.strokeStyle = gradienteHorizontal(ctx, w, fio % 2 ? AZUL : CIANO, 0.5 - fio * 0.04 + q.forca * 0.15);
      ctx.lineWidth = fio % 2 ? 0.9 : 1.2;
      ctx.stroke();
    }
  }

  // As partículas: poeira que deriva devagar e pisca; as maiores têm brilho difuso.
  for (const p of particulas) {
    const x = (((p.x + q.tempo * p.deriva) % 1) + 1) % 1 * w;
    const y = p.y * h + Math.sin(q.tempo * 0.3 + p.fase) * 6;
    const brilho = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(q.tempo * p.piscar + p.fase));
    if (p.raio > 1.7) {
      const halo = ctx.createRadialGradient(x, y, 0, x, y, p.raio * 3);
      halo.addColorStop(0, `rgba(${CIANO}, ${brilho * 0.55})`);
      halo.addColorStop(1, `rgba(${CIANO}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, p.raio * 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = `rgba(${CIANO}, ${brilho})`;
      ctx.beginPath();
      ctx.arc(x, y, p.raio, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/**
 * O reator: núcleo escuro, anel luminoso que pulsa com a voz e os arcos segmentados que giram
 * conforme o estado. Desenhado num quadrado; `largura` e `altura` são o lado do canvas.
 */
export function desenharReator(ctx: CanvasRenderingContext2D, q: Quadro): void {
  const { largura: w, altura: h } = q;
  ctx.clearRect(0, 0, w, h);
  if (!w || !h) return;
  const x = w / 2;
  const y = h / 2;
  const lado = Math.min(w, h);
  const t = q.tempo * ritmo(q.estado);
  const forca = q.estado === 'falando' ? Math.max(0, Math.min(1, q.forca)) : 0;
  const ouvindo = q.estado === 'ouvindo';
  const trabalhando = q.estado === 'pensando' || q.estado === 'gerando';
  const pulso = ouvindo ? Math.sin(q.tempo * 4) * 0.012 : 0;
  const r = lado * RAIO_DO_REATOR * (1 + forca * 0.05 + pulso);

  // Halo: o brilho que vaza do anel para o fundo.
  const halo = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 2.1);
  halo.addColorStop(0, `rgba(${AZUL}, ${0.16 + forca * 0.14})`);
  halo.addColorStop(0.45, `rgba(${AZUL}, ${0.06 + forca * 0.06})`);
  halo.addColorStop(1, `rgba(${AZUL}, 0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);

  // Núcleo: escuro de propósito. É ele que apaga a onda por trás e faz o anel parecer aceso.
  const nucleo = ctx.createRadialGradient(x, y, 0, x, y, r);
  nucleo.addColorStop(0, 'rgba(1, 6, 14, 0.96)');
  nucleo.addColorStop(0.8, 'rgba(2, 10, 22, 0.9)');
  nucleo.addColorStop(1, 'rgba(6, 30, 52, 0.85)');
  ctx.fillStyle = nucleo;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Filamentos internos: herança do orbe antigo, discretos, e ainda respondem à fala.
  for (let linha = 0; linha < 3; linha++) {
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const onda = Math.sin(a * 3 + t + linha * 0.9) * 0.03 + Math.sin(a * 5 - t * 0.7 + linha) * 0.015;
      const raio = r * (0.8 + onda + forca * 0.08);
      const px = x + Math.cos(a + t * 0.05) * raio;
      const py = y + Math.sin(a + t * 0.05) * raio;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = `rgba(${AZUL}, ${0.18 + forca * 0.3})`;
    ctx.stroke();
  }

  // Aro interno pontilhado e o fio fino logo dentro do anel.
  ctx.setLineDash([1.5, 6]);
  circulo(ctx, x, y, r * 0.72, `rgba(${CIANO}, 0.35)`, 1);
  ctx.setLineDash([]);
  circulo(ctx, x, y, r * 0.88, `rgba(${CIANO}, 0.4)`, 1);

  // O anel: três passadas, do brilho largo ao filete quase branco.
  ctx.shadowColor = `rgba(${CIANO}, 0.9)`;
  ctx.shadowBlur = lado * 0.05;
  circulo(ctx, x, y, r, `rgba(${AZUL}, ${0.22 + forca * 0.2})`, r * 0.11);
  ctx.shadowBlur = lado * 0.025;
  circulo(ctx, x, y, r, `rgba(${CIANO}, ${0.85})`, r * 0.04);
  ctx.shadowBlur = 0;
  circulo(ctx, x, y, r, 'rgba(235, 253, 255, 0.95)', Math.max(1, r * 0.014));

  // Arcos segmentados logo fora do anel: a coroa quebrada da referência.
  const segmentos: readonly [number, number][] = [
    [0.05, 0.95],
    [1.15, 0.42],
    [1.7, 0.9],
    [2.75, 0.3],
    [3.2, 1.15],
    [4.5, 0.55],
    [5.2, 0.8],
  ];
  const giro = t * 0.18;
  ctx.lineWidth = Math.max(2, r * 0.035);
  ctx.strokeStyle = `rgba(${CIANO}, ${0.5 + forca * 0.3})`;
  for (const [inicio, comprimento] of segmentos) {
    ctx.beginPath();
    ctx.arc(x, y, r * 1.2, inicio + giro, inicio + giro + comprimento);
    ctx.stroke();
  }

  // Arcos finos mais por fora, girando ao contrário, com um ponto na ponta de cada um.
  const contra = -t * 0.11;
  ctx.lineWidth = 1.2;
  for (const [inicio, comprimento] of [
    [0.4, 1.1],
    [2.6, 0.7],
    [4.1, 1.3],
  ] as const) {
    const a = inicio + contra;
    ctx.strokeStyle = `rgba(${CIANO}, 0.45)`;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.36, a, a + comprimento);
    ctx.stroke();
    ctx.fillStyle = `rgba(${CIANO}, 0.9)`;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a + comprimento) * r * 1.36, y + Math.sin(a + comprimento) * r * 1.36, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // O arco de trabalho: corre em volta enquanto ele pensa ou escuta, como antes.
  if (trabalhando || ouvindo) {
    ctx.beginPath();
    ctx.arc(x, y, r * 1.28, q.tempo * 1.4, q.tempo * 1.4 + (trabalhando ? 0.8 : 1.8));
    ctx.lineWidth = 2;
    ctx.strokeStyle = ouvindo ? 'rgba(146, 249, 255, 0.7)' : 'rgba(78, 172, 255, 0.75)';
    ctx.stroke();
  }

  ctx.restore();
}

/** Três senos sobrepostos: a forma da onda num ponto `u` (distância ao centro / altura). */
function ondaEm(u: number, t: number, fio: number): number {
  // Cada fio tem frequência e fase um pouco próprias: juntos eles abrem e fecham como uma fita.
  const p = fio * 0.55;
  const f = 1 + fio * 0.07;
  return (
    Math.sin(u * 9 * f + t * 1.6 + p) * 0.55 +
    Math.sin(u * 17 * f - t * 2.3 + p * 1.7) * 0.3 +
    Math.sin(u * 31 + t * 3.1 + p * 0.6) * 0.15
  );
}

/**
 * Quanto da amplitude vale a uma distância `d` do centro: cresce perto do orbe, onde a onda
 * nasce, e morre nas bordas da tela para não terminar num corte seco.
 */
function envelope(d: number, largura: number, raioReator: number): number {
  const distancia = Math.abs(d);
  const borda = Math.max(0, Math.min(1, (largura / 2 - distancia) / (largura * 0.14)));
  const perto = Math.exp(-(((distancia - raioReator * 1.5) / (largura * 0.16)) ** 2));
  return borda * (0.35 + 0.65 * perto);
}

function gradienteHorizontal(
  ctx: CanvasRenderingContext2D,
  largura: number,
  rgb: string,
  alfa: number,
): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, largura, 0);
  g.addColorStop(0, `rgba(${rgb}, 0)`);
  g.addColorStop(0.18, `rgba(${rgb}, ${alfa * 0.8})`);
  g.addColorStop(0.5, `rgba(${rgb}, ${alfa})`);
  g.addColorStop(0.82, `rgba(${rgb}, ${alfa * 0.8})`);
  g.addColorStop(1, `rgba(${rgb}, 0)`);
  return g;
}

function circulo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  raio: number,
  cor: string,
  espessura: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, raio, 0, Math.PI * 2);
  ctx.strokeStyle = cor;
  ctx.lineWidth = espessura;
  ctx.stroke();
}
