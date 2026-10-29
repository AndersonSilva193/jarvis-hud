import { Service, inject, signal } from '@angular/core';
// Só tipos: o MediaPipe chega pelo `import()` dinâmico, num chunk que só baixa ao ligar os gestos.
import type { HandLandmarker } from '@mediapipe/tasks-vision';

import type { GravacaoDeGestos, MaoDetectada, Ponto, QuadroDeMaos } from '../gestos/gestos.modelos';
import { PerfilDoAparelhoService } from './perfil-do-aparelho.service';

export type StatusDoRastreio = 'desligado' | 'carregando' | 'ligado' | 'pausado' | 'indisponivel';

/** Servidos pela própria HUD (`angular.json` e `public/`): nada vem de CDN em tempo de execução. */
const PASTA_DO_WASM = 'mediapipe/wasm';
const MODELO = 'mediapipe/hand_landmarker.task';
/** Sem mão nenhuma por isso, a câmera desliga sozinha. */
const INATIVIDADE_MS = 120_000;
const GRAVACAO_MS = 5_000;

type Ouvinte = (quadro: QuadroDeMaos) => void;

/**
 * A webcam e o Hand Landmarker do MediaPipe, tudo no navegador.
 *
 * O quadro vai do `<video>` ao detector e para ali: nenhuma imagem é copiada, codificada ou
 * enviada. Quem ouve recebe só os 21 pontos de cada mão, fora da detecção de mudanças — os signals
 * daqui só mudam quando o estado muda, nunca a cada quadro.
 */
@Service()
export class RastreioDeMaoService {
  private readonly perfil = inject(PerfilDoAparelhoService);

  /** O botão "Gestos": a vontade do dono. Falha e inatividade o soltam. */
  readonly ativo = signal(false);
  readonly status = signal<StatusDoRastreio>('desligado');
  /** A frase discreta de por que os gestos não estão ligados. */
  readonly aviso = signal('');
  readonly delegate = signal<'GPU' | 'CPU' | null>(null);
  readonly gravando = signal(false);

  private detector: HandLandmarker | null = null;
  private maosDoDetector = 0;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private readonly ouvintes = new Set<Ouvinte>();
  private quadro = 0;
  private quadroDeVideo = 0;
  private ultimaDeteccao = 0;
  private ultimoInstante = 0;
  private ultimaMao = 0;
  /** Sobe a cada ligar/desligar: um `await` que volta depois disso desiste. */
  private sessao = 0;

  alternar(): void {
    if (this.ativo()) this.desligar();
    else {
      this.aviso.set('');
      this.ativo.set(true);
    }
  }

  /** Cada detecção, com ou sem mão. Devolve a função que para de ouvir. */
  ouvir(ouvinte: Ouvinte): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  /**
   * Abre a câmera no `<video>` dado e começa a detectar. Sem HTTPS, sem câmera ou sem permissão,
   * deixa o aviso, solta o botão e devolve `false`: toque e mouse seguem como sempre.
   */
  async ligar(video: HTMLVideoElement): Promise<boolean> {
    const sessao = ++this.sessao;
    this.video = video;
    const impedimento = impedimentoDaCamera();
    if (impedimento) return this.recusar(impedimento);
    this.status.set('carregando');
    try {
      await this.abrirCamera(video);
      if (sessao !== this.sessao) return false;
      await this.prepararDetector();
      if (sessao !== this.sessao) return false;
    } catch (erro) {
      if (sessao !== this.sessao) return false;
      this.fecharCamera();
      return this.recusar(explicar(erro));
    }
    this.ultimaMao = performance.now();
    document.addEventListener('visibilitychange', this.aoMudarVisibilidade);
    this.status.set('ligado');
    this.agendar();
    return true;
  }

  /** Solta a câmera e o botão. Com `aviso`, conta por quê (inatividade). */
  desligar(aviso = ''): void {
    this.soltarCamera();
    this.status.set('desligado');
    this.ativo.set(false);
    this.aviso.set(aviso);
  }

  /** O `<video>` saiu da tela: solta a câmera sem mexer no botão nem apagar o aviso que o tirou dali. */
  liberar(): void {
    this.soltarCamera();
    if (this.status() !== 'indisponivel') this.status.set('desligado');
  }

  private soltarCamera(): void {
    this.sessao++;
    this.pararLaco();
    this.fecharCamera();
    document.removeEventListener('visibilitychange', this.aoMudarVisibilidade);
    this.video = null;
  }

  /** Os próximos 5 s de landmarks, só pontos, no formato dos fixtures do motor. */
  gravar(): Promise<GravacaoDeGestos | null> {
    if (this.status() !== 'ligado' || this.gravando()) return Promise.resolve(null);
    this.gravando.set(true);
    const quadros: QuadroDeMaos[] = [];
    const parar = this.ouvir((q) => quadros.push(arredondar(q)));
    const { deteccoesPorSegundo } = this.perfil.parametros();
    return new Promise((resolver) => {
      setTimeout(() => {
        parar();
        this.gravando.set(false);
        const inicio = quadros[0]?.t ?? 0;
        resolver({
          versao: 1,
          perfil: this.perfil.perfil(),
          deteccoesPorSegundo,
          data: new Date().toISOString(),
          quadros: quadros.map((q) => ({ ...q, t: Math.round(q.t - inicio) })),
        });
      }, GRAVACAO_MS);
    });
  }

  private recusar(aviso: string): false {
    this.status.set('indisponivel');
    this.ativo.set(false);
    this.aviso.set(aviso);
    return false;
  }

  private async abrirCamera(video: HTMLVideoElement): Promise<void> {
    const { largura, altura } = this.perfil.parametros().camera;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: largura }, height: { ideal: altura } },
    });
    // O iPhone só toca vídeo inline, mudo e com os dois atributos — a propriedade sozinha não basta.
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.srcObject = this.stream;
    await video.play();
  }

  private fecharCamera(): void {
    for (const trilha of this.stream?.getTracks() ?? []) trilha.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  private async prepararDetector(): Promise<void> {
    const maos = this.perfil.parametros().maosMax;
    if (this.detector) {
      if (this.maosDoDetector !== maos) {
        await this.detector.setOptions({ numHands: maos });
        this.maosDoDetector = maos;
      }
      return;
    }
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const arquivos = await FilesetResolver.forVisionTasks(new URL(PASTA_DO_WASM, document.baseURI).href);
    const criar = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(arquivos, {
        baseOptions: { modelAssetPath: new URL(MODELO, document.baseURI).href, delegate },
        runningMode: 'VIDEO',
        numHands: maos,
      });
    try {
      this.detector = await criar('GPU');
      this.delegate.set('GPU');
    } catch {
      // Sem WebGL2 ou com o driver recusando: a CPU é mais lenta, mas detecta.
      this.detector = await criar('CPU');
      this.delegate.set('CPU');
    }
    this.maosDoDetector = maos;
  }

  private agendar(): void {
    const video = this.video;
    if (!video) return;
    if ('requestVideoFrameCallback' in video) this.quadroDeVideo = video.requestVideoFrameCallback(this.detectar);
    else this.quadro = requestAnimationFrame(() => this.detectar());
  }

  private pararLaco(): void {
    cancelAnimationFrame(this.quadro);
    if (this.video && 'cancelVideoFrameCallback' in this.video) this.video.cancelVideoFrameCallback(this.quadroDeVideo);
  }

  private readonly detectar = (): void => {
    const video = this.video;
    const detector = this.detector;
    if (!video || !detector || this.status() !== 'ligado') return;
    const agora = performance.now();
    const intervalo = 1000 / this.perfil.parametros().deteccoesPorSegundo;
    if (agora - this.ultimaDeteccao >= intervalo - 2 && video.readyState >= 2 && video.videoWidth) {
      this.ultimaDeteccao = agora;
      // O detector exige instantes estritamente crescentes.
      const instante = Math.max(agora, this.ultimoInstante + 1);
      this.ultimoInstante = instante;
      const resultado = detector.detectForVideo(video, instante);
      const maos: MaoDetectada[] = resultado.landmarks.map((pontos, i) => ({
        lado: resultado.handedness[i]?.[0]?.categoryName ?? `mao${i}`,
        pontos: pontos.map((p): Ponto => [p.x, p.y, p.z]),
      }));
      if (maos.length) this.ultimaMao = agora;
      const quadro: QuadroDeMaos = { t: instante, aspecto: video.videoWidth / video.videoHeight, maos };
      for (const ouvinte of this.ouvintes) ouvinte(quadro);
      if (agora - this.ultimaMao > INATIVIDADE_MS) {
        this.desligar('Câmera desligada após 2 min sem mão.');
        return;
      }
    }
    this.agendar();
  };

  /** Aba oculta solta a câmera; na volta, se o botão ainda está ligado, religa sem perguntar de novo. */
  private readonly aoMudarVisibilidade = (): void => {
    if (document.hidden && this.status() === 'ligado') {
      this.pararLaco();
      this.fecharCamera();
      this.status.set('pausado');
    } else if (!document.hidden && this.status() === 'pausado' && this.video) {
      const video = this.video;
      const sessao = this.sessao;
      void this.abrirCamera(video).then(
        () => {
          if (sessao !== this.sessao) return;
          this.ultimaMao = performance.now();
          this.status.set('ligado');
          this.agendar();
        },
        (erro: unknown) => {
          if (sessao !== this.sessao) return;
          this.soltarCamera();
          this.recusar(explicar(erro));
        },
      );
    }
  };
}

/** O que impede a câmera antes mesmo de pedir: página sem HTTPS ou navegador sem a API. */
export function impedimentoDaCamera(): string {
  if (typeof isSecureContext !== 'undefined' && !isSecureContext) return 'Gestos precisam de HTTPS.';
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'Este navegador não dá acesso à câmera.';
  return '';
}

export function explicar(erro: unknown): string {
  const nome = erro instanceof DOMException || erro instanceof Error ? erro.name : '';
  switch (nome) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Permissão da câmera negada.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhuma câmera encontrada.';
    case 'NotReadableError':
    case 'AbortError':
      return 'A câmera está em uso por outro programa.';
    default:
      return 'Não foi possível ligar os gestos.';
  }
}

/** Quatro casas bastam para o motor e deixam o arquivo da gravação com um terço do tamanho. */
function arredondar(q: QuadroDeMaos): QuadroDeMaos {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return {
    t: q.t,
    aspecto: q.aspecto === undefined ? undefined : r(q.aspecto),
    maos: q.maos.map((m) => ({ lado: m.lado, pontos: m.pontos.map((p): Ponto => [r(p[0]), r(p[1]), r(p[2])]) })),
  };
}
