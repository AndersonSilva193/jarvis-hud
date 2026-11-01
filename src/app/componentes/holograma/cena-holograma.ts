import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Euler,
  FrontSide,
  FogExp2,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  PolarGridHelper,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Intersection,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import type { ModoDeGiro } from '../../nucleo/comandos-do-holograma.service';
import {
  SEM_FILTROS,
  filtroVazio,
  noFiltro,
  type EixoHolograma,
  type FiltrosDoHolograma,
  type PecaHolograma,
  type VistaHolograma,
} from '../../nucleo/holograma.modelos';
import { FabricaDeGeometrias } from './geometrias-holograma';
import { LoteDaSerie } from './lote-instanciado';
import { calcularEnquadramento } from './enquadramento-holograma';

/**
 * Acima de tantas peças, as cópias de um mesmo `rep`/`rad` passam a ser desenhadas num lote
 * instanciado (`LoteDaSerie`): duas chamadas à GPU por série, em vez de duas por cópia.
 * Abaixo disso a peça avulsa é barata e não vale a troca.
 */
export const LIMIAR_DE_INSTANCIAS = 120;

/** O retrato de desempenho, uma vez por segundo, quando a HUD abre com `?medir=1`. */
export interface MedidaDaCena {
  fps: number;
  /** Chamadas de desenho do quadro inteiro: a cena mais os passes do bloom e da saída. */
  chamadas: number;
  pecas: number;
  /** Séries desenhadas por instância; zero abaixo do limiar ou com `?instancias=0`. */
  lotes: number;
}

export interface PecaDestacada {
  /** Falta só no destaque do mouse, que é por grupo; a seleção sempre sabe a peça. */
  id?: string;
  nome: string;
  grupo: string;
}

/** O peso da cena: o perfil leve do celular corta resolução, bloom e segmentos. */
export interface PerfilDaCena {
  pixelRatioMaximo: number;
  bloom: 'completo' | 'reduzido';
  segmentos: number;
}

export interface OpcoesDaCena {
  /** Chamado só quando a peça sob o mouse muda — nunca a cada quadro. */
  aoDestacar: (peca: PecaDestacada | null) => void;
  /** O mouse começou a arrastar a câmera: a vista nomeada ("de cima") deixou de valer. */
  aoArrastar?: () => void;
  movimentoReduzido: boolean;
  perfil: PerfilDaCena;
  /** `false` desliga os lotes instanciados (`?instancias=0`): é o "antes" da medição. */
  instanciar?: boolean;
  /** Com ele, a cena mede FPS e chamadas de desenho e avisa uma vez por segundo. */
  aoMedir?: (medida: MedidaDaCena) => void;
}

/**
 * As vistas nomeadas, como direção da câmera a partir do alvo. "Cima" não é o polo exato: o
 * OrbitControls perde o rumo em cima do eixo, e um fio de inclinação deixa a frente reconhecível.
 */
const VISTAS: Record<VistaHolograma, Vector3> = {
  frente: new Vector3(0, 0.12, 1).normalize(),
  lado: new Vector3(1, 0.12, 0).normalize(),
  cima: new Vector3(0, 1, 0.08).normalize(),
  isometrica: new Vector3(1, 0.8, 1).normalize(),
};
/** O quanto apagam as peças fora do destaque e fora do isolado. */
const APAGADA = 0.25;
const VELOCIDADE_DO_GIRO = 0.5;

/** Coordenadas normalizadas do canvas: -1..1, `y` para cima. */
export interface PontoNdc {
  x: number;
  y: number;
}

const BLOOM = {
  completo: { forca: 0.28, raio: 0.2 },
  reduzido: { forca: 0.16, raio: 0.15 },
} as const;
const ENTRADA_MS = 300;
/** Quanto a inércia do giro perde por segundo (`e^(-k·dt)`). */
const ATRITO_DO_GIRO = 3;
const GIRO_MINIMO = 0.01;
const RAIO_DO_CURSOR = 0.09;
const DISTANCIA_DA_EXPLOSAO = 2.5;
/** Tempo sem mexer no mouse até o objeto voltar a girar sozinho. */
const OCIOSO_ATE_GIRAR_MS = 4_000;
/** A opacidade da malha quando a peça não pediu outra (`o` ausente chega como 1). */
const OPACIDADE_PADRAO = 0.35;
/**
 * Quanto da opacidade da peça vira luz no preenchimento. O blending é aditivo: num motor com
 * dezenas de peças uma atrás da outra, 0.35 cheio somava acima de 1 e o objeto virava um borrão
 * branco. O contorno é que carrega a forma; a malha só tinge.
 */
const PESO_DO_PREENCHIMENTO = 0.15;
/** Só o que passa disso brilha: as linhas acendem, o preenchimento somado não. */
const LIMIAR_DO_BLOOM = 0.75;
const Y_DO_PISO = -2.4;
// Mesmo fundo da interface imersiva, sem máscara ou borda sobre o canvas.
const FUNDO = 0x030a18;
const CAMERA_INICIAL = new Vector3(6.5, 3.2, 8.5);
const ALVO_INICIAL = new Vector3(0, -0.3, 0);
const BRANCO = new Color(0xffffff);

/** A varredura de "escaneando": um anel que sobe da base e apaga, de novo e de novo. */
const VARREDURA_RAIO = 2.1;
const VARREDURA_ALTURA = 3.2;
const VARREDURA_PERIODO_S = 1.6;

/** Os anéis da base: arcos de um anel girando é o que deixa a rotação visível. */
const ANEIS = [
  { raio: 2.3, largura: 0.05, arcos: 3, velocidade: 0.22, cor: 0x5ff2ff },
  { raio: 2.75, largura: 0.025, arcos: 5, velocidade: -0.14, cor: 0x2d7dff },
  { raio: 3.4, largura: 0.07, arcos: 2, velocidade: 0.07, cor: 0x5ff2ff },
] as const;

interface PecaNaCena {
  dados: PecaHolograma;
  /** Desenhada sozinha: o grupo com a malha e o contorno. `null` quando a peça está num lote. */
  raiz: Group | null;
  malha: Mesh<BufferGeometry, MeshBasicMaterial> | null;
  contorno: Line<BufferGeometry, LineBasicMaterial> | null;
  /** Ou numa série instanciada, no `indice` dela. */
  lote: LoteDaSerie<PecaNaCena> | null;
  indice: number;
  /** A rotação da peça, para a matriz da instância (a avulsa a guarda no próprio grupo). */
  giro: Quaternion;
  /** Fora do filtro (escondida, ou fora do isolado): não aparece nem recebe o mouse. */
  visivel: boolean;
  base: Vector3;
  direcao: Vector3;
  /** A direção veio da peça; sem ela, é recalculada pelo centro a cada peça nova. */
  direcaoPropria: boolean;
  nascimento: number;
  alvoMalha: number;
  alvoContorno: number;
  cor: Color;
  destaque: number;
}

/**
 * A cena do holograma, em Three.js puro: nenhum signal aqui dentro.
 *
 * Mora num módulo à parte para o `import()` dinâmico do componente levar o Three.js para um chunk
 * próprio — a HUD não paga ~600 kB enquanto ninguém abre o holograma. Quem cria a cena deve fazê-lo
 * fora da zona do Angular: o laço e os ouvintes registrados aqui herdam isso.
 */
export class CenaHolograma {
  private readonly renderer: WebGLRenderer;
  private readonly cena = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.1, 200);
  private readonly controles: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly objeto = new Group();
  private readonly piso = new Group();
  private pisoPendente = false;
  private largura = 0;
  private altura = 0;
  private readonly aneis: Group[] = [];
  private readonly fixos: { dispose(): void }[] = [];
  private readonly fabrica: FabricaDeGeometrias;
  private readonly pecas: PecaNaCena[] = [];
  /** A peça avulsa, ou o lote cujo `instanceId` diz qual cópia o raio acertou. */
  private readonly porObjeto = new Map<Object3D, PecaNaCena | LoteDaSerie<PecaNaCena>>();
  private readonly lotes: LoteDaSerie<PecaNaCena>[] = [];
  private readonly lotePorSerie = new Map<string, LoteDaSerie<PecaNaCena>>();
  /** Passou do limiar neste objeto: as séries já estão em lote, e as próximas cópias vão direto. */
  private instanciando = false;
  private readonly matriz = new Matrix4();
  private readonly onde = new Vector3();
  private readonly escala = new Vector3();
  private readonly corDaMalha = new Color();
  private medicao = { inicio: 0, quadros: 0 };
  private readonly alvosDoRaio: Object3D[] = [];
  private readonly caixa = new Box3();
  private readonly centro = new Vector3();
  private readonly raio = new Raycaster();
  private readonly ponteiro = new Vector2();
  private readonly observador: ResizeObserver;
  private readonly esferica = new Spherical();
  private readonly deslocamento = new Vector3();
  private readonly inercia = new Vector2();
  private cursor3d!: { grupo: Group; ativo: boolean };

  private quadro = 0;
  private contagem = 0;
  private anterior = performance.now();
  private fatorExplosao = 0;
  private alvoExplosao = 0;
  private arrastando = false;
  private ultimaInteracao = -Infinity;
  private ponteiroDentro = false;
  private ponteiroMudou = false;
  private destacada: PecaNaCena | null = null;
  /** Escolhida por gesto ou toque duplo: fica até outra seleção, um reset ou objeto novo. */
  private selecionada: PecaNaCena | null = null;
  /** Uma mão na câmera segura a rotação automática até sumir (o motor avisa depois de 3 s). */
  private maoNaCamera = false;
  private voo: { posicao: Vector3; alvo: Vector3 } | null = null;
  private varredura!: { grupo: Group; anel: Mesh; materialAnel: MeshBasicMaterial; materialDisco: MeshBasicMaterial };
  private escaneando = false;
  /** 0 a 1: a varredura acende e apaga suave, em vez de sumir no quadro da primeira peça. */
  private intensidadeDaVarredura = 0;
  private faseDaVarredura = 0;
  /** Destaque, isolado e escondidos: por grupo e peça, valem também para a peça que chegar depois. */
  private filtros: FiltrosDoHolograma = SEM_FILTROS;
  private modoDeGiro: ModoDeGiro = 'auto';

  constructor(
    private readonly host: HTMLElement,
    private readonly opcoes: OpcoesDaCena,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opcoes.perfil.pixelRatioMaximo));
    this.fabrica = new FabricaDeGeometrias(opcoes.perfil.segmentos);
    this.renderer.setClearColor(0x000000, 1);
    // Onde muitas peças se sobrepõem a soma aditiva passa de 1: o tone mapping (aplicado no
    // OutputPass) satura essa soma na cor da peça em vez de estourar em branco.
    this.renderer.toneMapping = ACESFilmicToneMapping;
    const tela = this.renderer.domElement;
    tela.style.display = 'block';
    tela.style.width = '100%';
    tela.style.height = '100%';
    tela.style.touchAction = 'none';
    host.appendChild(tela);

    this.cena.background = new Color(0x000000);
    this.cena.fog = new FogExp2(0x000000, 0.02);
    this.camera.position.copy(CAMERA_INICIAL);
    this.cena.add(this.objeto);
    this.montarPiso();
    this.montarVarredura();
    this.montarCursor();

    this.controles = new OrbitControls(this.camera, tela);
    this.controles.target.copy(ALVO_INICIAL);
    // Arrastar com dois dedos explode; com o botão direito, nada: o alvo fica no objeto.
    this.controles.enablePan = false;
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.08;
    this.controles.minDistance = 2.5;
    this.controles.maxDistance = 24;
    this.controles.maxPolarAngle = Math.PI * 0.88;
    this.controles.autoRotateSpeed = 0.5;
    this.controles.addEventListener('start', this.aoComecarArrasto);
    this.controles.addEventListener('end', this.aoTerminarArrasto);
    this.controles.update();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.cena, this.camera));
    const bloom = BLOOM[opcoes.perfil.bloom];
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), bloom.forca, bloom.raio, LIMIAR_DO_BLOOM);
    this.composer.addPass(this.bloom);
    // O ACES escurece até o fundo. Somá-lo depois do tone mapping mantém o mesmo azul da
    // interface e faz a névoa apagar as linhas nessa cor, sem retângulo ou máscara nas bordas.
    const saida = new OutputPass();
    saida.uniforms['fundoDaInterface'] = { value: new Color(FUNDO) };
    saida.material.fragmentShader = saida.material.fragmentShader
      .replace('void main() {', 'uniform vec3 fundoDaInterface;\nvoid main() {')
      .replace('#ifdef SRGB_TRANSFER', 'gl_FragColor.rgb += fundoDaInterface;\n#ifdef SRGB_TRANSFER');
    this.composer.addPass(saida);
    this.fixos.push(saida);

    this.raio.params.Line.threshold = 0.06;
    tela.addEventListener('pointermove', this.aoMoverPonteiro);
    tela.addEventListener('pointerleave', this.aoSairPonteiro);

    this.observador = new ResizeObserver(() => this.ajustar());
    this.observador.observe(host);
    this.ajustar();
    this.quadro = requestAnimationFrame(this.passo);
  }

  adicionar(dados: PecaHolograma): void {
    const opacidade = dados.opacidade < 1 ? dados.opacidade : OPACIDADE_PADRAO;
    const giro = new Quaternion().setFromEuler(new Euler(
      MathUtils.degToRad(dados.rotacao[0]),
      MathUtils.degToRad(dados.rotacao[1]),
      MathUtils.degToRad(dados.rotacao[2]),
    ));
    const base = new Vector3(...dados.posicao);
    const peca: PecaNaCena = {
      dados, raiz: null, malha: null, contorno: null, lote: null, indice: -1, giro, visivel: true, base,
      cor: new Color(dados.cor),
      alvoMalha: opacidade * PESO_DO_PREENCHIMENTO,
      direcao: dados.explosao ? new Vector3(...dados.explosao).normalize() : new Vector3(),
      direcaoPropria: dados.explosao !== null,
      nascimento: this.opcoes.movimentoReduzido ? -Infinity : performance.now(),
      alvoContorno: Math.min(0.7, opacidade + 0.2),
      destaque: 1,
    };
    // O filtro do momento vale para quem chega: "isola os pistões" durante a montagem segue isolando.
    peca.visivel = this.visivel(peca);
    this.pecas.push(peca);
    if (this.instanciando && cabeEmLote(dados)) this.porNoLote(peca);
    else this.desenharSozinha(peca);
    if (!this.instanciando && this.opcoes.instanciar !== false && this.pecas.length > LIMIAR_DE_INSTANCIAS) this.agruparSeries();

    this.caixa.expandByPoint(base);
    this.caixa.getCenter(this.centro);
    for (const p of this.pecas) if (!p.direcaoPropria) direcaoPeloCentro(p, this.centro);
    this.pisoPendente = true;
  }

  /** Larga o objeto atual e devolve à GPU geometrias e materiais. */
  limpar(): void {
    for (const p of this.pecas) if (p.raiz) this.desfazerSozinha(p);
    for (const lote of this.lotes) {
      this.objeto.remove(lote.malha);
      if (lote.contorno) this.objeto.remove(lote.contorno);
      lote.descartar();
    }
    this.lotes.length = 0;
    this.lotePorSerie.clear();
    this.instanciando = false;
    this.pecas.length = 0;
    this.alvosDoRaio.length = 0;
    this.porObjeto.clear();
    this.fabrica.descartar();
    this.caixa.makeEmpty();
    this.centro.set(0, 0, 0);
    this.objeto.rotation.set(0, 0, 0);
    this.piso.position.set(0, 0, 0);
    this.piso.scale.setScalar(1);
    this.pisoPendente = false;
    this.selecionada = null;
    this.destacar(null);
  }

  /**
   * Liga ou desliga a varredura da base — o "estou escaneando" enquanto o modelo pensa e a primeira
   * peça não chegou. Com movimento reduzido, o anel fica parado na base.
   */
  escanear(ligado: boolean): void {
    this.escaneando = ligado;
    if (this.opcoes.movimentoReduzido) this.intensidadeDaVarredura = ligado ? 1 : 0;
  }

  /**
   * 0 = montado, 1 = explodido; o fator anda até o alvo suavemente. `imediato` é para quem já anima
   * por conta própria (o comando de voz, em 600 ms): duas suavizações em série atrasariam o fim.
   */
  explodir(fator: number, imediato = false): void {
    this.alvoExplosao = MathUtils.clamp(fator, 0, 1);
    if (imediato || this.opcoes.movimentoReduzido) this.fatorExplosao = this.alvoExplosao;
    this.pisoPendente = true;
  }

  /** Gira o objeto (não a câmera) em volta de um eixo do mundo. */
  girarObjeto(eixo: EixoHolograma, radianos: number): void {
    if (!Number.isFinite(radianos)) return;
    this.objeto.rotation[eixo] += radianos;
    this.pisoPendente = true;
    this.ultimaInteracao = performance.now();
  }

  /** Leva a câmera a uma vista nomeada, na distância em que ela está. */
  vista(nome: VistaHolograma): void {
    const distancia = this.camera.position.distanceTo(this.controles.target);
    this.inercia.set(0, 0);
    this.voar(this.controles.target.clone().addScaledVector(VISTAS[nome], distancia), this.controles.target);
    this.ultimaInteracao = performance.now();
  }

  /** Troca os filtros; cada peça (as que já estão e as que chegarem) consulta o atual. */
  filtrar(filtros: FiltrosDoHolograma): void {
    this.filtros = filtros;
    for (const p of this.pecas) {
      p.visivel = this.visivel(p);
      if (p.raiz) p.raiz.visible = p.visivel;
    }
    if (this.selecionada && !this.selecionada.visivel) this.selecionada = null;
    if (this.destacada && !this.destacada.visivel) this.destacar(null);
    this.pisoPendente = true;
  }

  /** Seleciona a peça pelo id que o servidor resolveu. */
  selecionarPorId(id: string): PecaDestacada | null {
    const peca = this.pecas.find((p) => p.dados.id === id);
    if (!peca) return null;
    this.selecionada = peca;
    return { id: peca.dados.id, nome: peca.dados.nome, grupo: peca.dados.grupo };
  }

  /** `continuo` gira sempre, `parado` nunca, `auto` só quando ninguém mexe (o de sempre). */
  definirGiro(modo: ModoDeGiro, velocidade = 1): void {
    this.modoDeGiro = modo;
    this.controles.autoRotateSpeed = VELOCIDADE_DO_GIRO * (modo === 'continuo' ? Math.max(0.1, velocidade) * 4 : 1);
    if (modo === 'parado') this.inercia.set(0, 0);
  }

  /** Enquadra o objeto como está agora (já explodido, se for o caso), mantendo o ângulo da câmera. */
  centralizar(): void {
    this.enquadrar(this.camera.position.clone().sub(this.controles.target).normalize());
  }

  private enquadrar(direcao: Vector3): void {
    // Usa a geometria em tamanho final e a explosão pedida, mesmo durante as animações de entrada.
    const caixa = this.medirObjeto();
    if (caixa.isEmpty()) {
      this.voar(CAMERA_INICIAL, ALVO_INICIAL);
      return;
    }
    this.posicionarPiso(caixa);
    // A base também precisa caber: sua caixa é plana e não inclui a varredura decorativa.
    const raioDoPiso = this.piso.scale.x * 3.6;
    const centroDoPiso = this.piso.position.clone().add(new Vector3(0, Y_DO_PISO * this.piso.scale.y, 0));
    caixa.expandByPoint(centroDoPiso.clone().add(new Vector3(-raioDoPiso, 0, -raioDoPiso)));
    caixa.expandByPoint(centroDoPiso.clone().add(new Vector3(raioDoPiso, 0, raioDoPiso)));
    const quadro = calcularEnquadramento(caixa, this.camera.aspect, this.camera.fov, direcao);
    this.controles.maxDistance = Math.max(24, quadro.distancia * 3);
    this.camera.far = Math.max(200, this.controles.maxDistance + quadro.raio * 2);
    (this.cena.fog as FogExp2).density = 0.06 / Math.max(1, quadro.raio);
    this.camera.updateProjectionMatrix();
    this.voar(quadro.posicao, quadro.alvo);
  }

  /** A mesma medição para avulsas e instâncias, sem depender do último quadro publicado na GPU. */
  private medirObjeto(): Box3 {
    this.objeto.updateMatrixWorld();
    const caixa = new Box3();
    const transformacao = new Matrix4();
    const posicao = new Vector3();
    const escala = new Vector3(1, 1, 1);
    const limite = new Box3();
    for (const p of this.pecas) {
      if (!p.visivel) continue;
      const geometria = this.fabrica.obter(p.dados);
      const forma = geometria.malha ?? geometria.contorno;
      if (!forma.boundingBox) forma.computeBoundingBox();
      if (!forma.boundingBox) continue;
      posicao.copy(p.base).addScaledVector(p.direcao, this.alvoExplosao * DISTANCIA_DA_EXPLOSAO);
      transformacao.compose(posicao, p.giro, escala).premultiply(this.objeto.matrixWorld);
      caixa.union(limite.copy(forma.boundingBox).applyMatrix4(transformacao));
    }
    return caixa;
  }

  private posicionarPiso(caixa: Box3): void {
    this.pisoPendente = false;
    if (caixa.isEmpty()) return;
    const tamanho = caixa.getSize(new Vector3());
    const centro = caixa.getCenter(new Vector3());
    const escala = Math.max(0.65, Math.max(tamanho.x, tamanho.z) * 0.6) / 3.4;
    const y = caixa.min.y - Math.max(0.06, tamanho.y * 0.03);
    this.piso.scale.setScalar(escala);
    this.piso.position.set(centro.x, y - Y_DO_PISO * escala, centro.z);
  }

  resetar(): void {
    this.explodir(0);
    this.inercia.set(0, 0);
    this.objeto.rotation.set(0, 0, 0);
    this.selecionada = null;
    this.enquadrar(CAMERA_INICIAL.clone().sub(ALVO_INICIAL).normalize());
    this.ultimaInteracao = -Infinity;
  }

  /**
   * Gira a câmera em volta do alvo, em radianos, no mesmo sentido do arrasto do OrbitControls:
   * `dAz` positivo é o ponteiro indo para a direita; `dPol`, indo para baixo.
   */
  girar(dAz: number, dPol: number): void {
    this.voo = null;
    this.inercia.set(0, 0);
    this.aplicarGiro(dAz, dPol);
    this.ultimaInteracao = performance.now();
  }

  /** Solta o giro com velocidade (rad/s): o objeto continua e para devagar. */
  lancarGiro(vAz: number, vPol: number): void {
    if (this.opcoes.movimentoReduzido) return;
    this.inercia.set(vAz, vPol);
    this.ultimaInteracao = performance.now();
  }

  /** `fator` > 1 aproxima a câmera do alvo, dentro dos limites do OrbitControls. */
  aproximar(fator: number): void {
    if (!(fator > 0) || !Number.isFinite(fator)) return;
    this.voo = null;
    this.deslocamento.copy(this.camera.position).sub(this.controles.target);
    const distancia = MathUtils.clamp(this.deslocamento.length() / fator, this.controles.minDistance, this.controles.maxDistance);
    this.deslocamento.setLength(distancia);
    this.camera.position.copy(this.controles.target).add(this.deslocamento);
    this.ultimaInteracao = performance.now();
  }

  /**
   * O cursor 3D do gesto de apontar: um anel no ponto da peça sob o dedo, ou na profundidade do alvo
   * se não houver peça, que também faz o destaque do hover. `null` esconde.
   */
  apontar(ndc: PontoNdc | null): void {
    this.cursor3d.ativo = ndc !== null;
    this.cursor3d.grupo.visible = ndc !== null;
    if (ndc) {
      this.ponteiro.set(ndc.x, ndc.y);
      this.ponteiroMudou = true;
    } else {
      this.destacar(null);
    }
  }

  /** Seleciona o grupo da peça nesse ponto. Sem peça ali, nada muda e volta `null`. */
  selecionarEm(ndc: PontoNdc): PecaDestacada | null {
    const peca = this.pecaEm(ndc.x, ndc.y);
    if (!peca) return null;
    this.selecionada = peca;
    return { id: peca.dados.id, nome: peca.dados.nome, grupo: peca.dados.grupo };
  }

  limparSelecao(): void {
    this.selecionada = null;
  }

  /** Mão na câmera: nada de rotação automática até o motor dizer que ela sumiu. */
  segurarAutoRotacao(segurar: boolean): void {
    this.maoNaCamera = segurar;
    // Sem mão por 3 s já é a espera: a rotação volta na hora, sem os 4 s do mouse.
    if (!segurar) this.ultimaInteracao = -Infinity;
  }

  /** Toque começou/terminou: o mesmo que o arrasto do mouse faz pelo OrbitControls. */
  comecarInteracao(): void {
    this.aoComecarArrasto();
  }

  terminarInteracao(): void {
    this.aoTerminarArrasto();
  }

  /** Resolução e bloom mudam na hora; os segmentos valem a partir do próximo objeto. */
  aplicarPerfil(perfil: PerfilDaCena): void {
    this.opcoes.perfil = perfil;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, perfil.pixelRatioMaximo));
    this.fabrica.segmentos = perfil.segmentos;
    const bloom = BLOOM[perfil.bloom];
    this.bloom.strength = bloom.forca;
    this.bloom.radius = bloom.raio;
    this.ajustar();
  }

  /**
   * Um quadrado de `lado` px do centro da tela, em PNG. O WebGL não preserva o buffer entre quadros,
   * então a leitura vem logo depois de um `render` aqui mesmo, na mesma tarefa — depois dela o
   * navegador já pode ter apagado o que foi desenhado. `null` quando o navegador recusa.
   */
  miniatura(lado = 256): string | null {
    try {
      this.composer.render(0);
      const origem = this.renderer.domElement;
      const corte = Math.min(origem.width, origem.height);
      if (!corte) return null;
      const destino = document.createElement('canvas');
      destino.width = lado;
      destino.height = lado;
      const contexto = destino.getContext('2d');
      if (!contexto) return null;
      contexto.drawImage(origem, (origem.width - corte) / 2, (origem.height - corte) / 2, corte, corte, 0, 0, lado, lado);
      return destino.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  destruir(): void {
    cancelAnimationFrame(this.quadro);
    this.observador.disconnect();
    const tela = this.renderer.domElement;
    tela.removeEventListener('pointermove', this.aoMoverPonteiro);
    tela.removeEventListener('pointerleave', this.aoSairPonteiro);
    this.controles.removeEventListener('start', this.aoComecarArrasto);
    this.controles.removeEventListener('end', this.aoTerminarArrasto);
    this.controles.dispose();
    this.limpar();
    for (const fixo of this.fixos) fixo.dispose();
    this.bloom.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    tela.remove();
  }

  private montarPiso(): void {
    this.cena.add(this.piso);
    const grade = new PolarGridHelper(3.6, 12, 6, 96, 0x285a71, 0x163c52);
    grade.position.y = Y_DO_PISO;
    // O helper sempre cria um LineBasicMaterial; o tipo dele é que é o genérico de Line.
    const materialDaGrade = grade.material as LineBasicMaterial;
    materialDaGrade.transparent = true;
    materialDaGrade.opacity = 0.25;
    materialDaGrade.depthWrite = false;
    // Atenuação radial nos vértices: a grade apaga antes de chegar à borda do palco.
    const posicoes = grade.geometry.getAttribute('position');
    const cores = grade.geometry.getAttribute('color');
    for (let i = 0; i < posicoes.count; i++) {
      const raio = Math.hypot(posicoes.getX(i), posicoes.getZ(i)) / 3.6;
      const peso = 1 - MathUtils.smoothstep(raio, 0.45, 1);
      cores.setXYZ(i, cores.getX(i) * peso, cores.getY(i) * peso, cores.getZ(i) * peso);
    }
    this.piso.add(grade);
    this.fixos.push(grade.geometry, materialDaGrade);

    for (const anel of ANEIS) {
      const grupo = new Group();
      grupo.position.y = Y_DO_PISO + 0.02;
      grupo.rotation.x = -Math.PI / 2;
      grupo.userData['velocidade'] = anel.velocidade;
      const material = new MeshBasicMaterial({
        color: anel.cor, transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
      });
      this.fixos.push(material);
      const passo = (2 * Math.PI) / anel.arcos;
      for (let i = 0; i < anel.arcos; i++) {
        const geometria = new RingGeometry(anel.raio, anel.raio + anel.largura, 64, 1, i * passo, passo * 0.7);
        this.fixos.push(geometria);
        grupo.add(new Mesh(geometria, material));
      }
      this.aneis.push(grupo);
      this.piso.add(grupo);
    }
  }

  private montarVarredura(): void {
    const grupo = new Group();
    grupo.visible = false;
    const materialDisco = new MeshBasicMaterial({
      color: 0x2d7dff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
    });
    const disco = new Mesh(new CircleGeometry(VARREDURA_RAIO, 64), materialDisco);
    disco.rotation.x = -Math.PI / 2;
    disco.position.y = Y_DO_PISO + 0.03;
    const materialAnel = new MeshBasicMaterial({
      color: 0x5ff2ff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
    });
    const anel = new Mesh(new RingGeometry(VARREDURA_RAIO - 0.12, VARREDURA_RAIO, 96), materialAnel);
    anel.rotation.x = -Math.PI / 2;
    anel.position.y = Y_DO_PISO + 0.04;
    grupo.add(disco, anel);
    this.fixos.push(disco.geometry, materialDisco, anel.geometry, materialAnel);
    this.piso.add(grupo);
    this.varredura = { grupo, anel, materialAnel, materialDisco };
  }

  /** O anel do gesto de apontar: por cima de tudo, sempre de frente para a câmera. */
  private montarCursor(): void {
    const grupo = new Group();
    grupo.visible = false;
    grupo.renderOrder = 10;
    const material = new MeshBasicMaterial({
      color: 0x5ff2ff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, depthTest: false, side: DoubleSide,
    });
    const anel = new Mesh(new RingGeometry(RAIO_DO_CURSOR * 0.7, RAIO_DO_CURSOR, 32), material);
    const ponto = new Mesh(new CircleGeometry(RAIO_DO_CURSOR * 0.25, 16), material);
    anel.renderOrder = ponto.renderOrder = 10;
    grupo.add(anel, ponto);
    this.fixos.push(anel.geometry, ponto.geometry, material);
    this.cena.add(grupo);
    this.cursor3d = { grupo, ativo: false };
  }

  /** A peça com o grupo, a malha e o contorno dela: duas chamadas à GPU. */
  private desenharSozinha(peca: PecaNaCena): void {
    const { dados, cor } = peca;
    const geometria = this.fabrica.obter(dados);
    const raiz = new Group();
    raiz.quaternion.copy(peca.giro);
    if (geometria.malha) {
      const material = new MeshBasicMaterial({
        color: cor, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false,
        // Face de trás também somaria luz: só o anel, que é chato, precisa dos dois lados.
        side: dados.forma === 'ring' ? DoubleSide : FrontSide,
      });
      peca.malha = new Mesh(geometria.malha, material);
      raiz.add(peca.malha);
    }
    if (dados.contorno || !geometria.malha) {
      const material = new LineBasicMaterial({
        color: cor, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false,
      });
      peca.contorno = geometria.malha ? new LineSegments(geometria.contorno, material) : new Line(geometria.contorno, material);
      raiz.add(peca.contorno);
    }
    raiz.position.copy(peca.base);
    raiz.scale.setScalar(this.opcoes.movimentoReduzido ? 1 : 1e-3);
    raiz.visible = peca.visivel;
    this.objeto.add(raiz);
    peca.raiz = raiz;

    const { malha, contorno } = peca;
    // O feixe do projetor (o: 0.08) cobre o objeto inteiro: não pode roubar o mouse das peças.
    const alvo = malha && peca.alvoMalha >= 0.1 * PESO_DO_PREENCHIMENTO ? malha : contorno && !malha ? contorno : null;
    if (alvo) {
      this.alvosDoRaio.push(alvo);
      this.porObjeto.set(alvo, peca);
    }
  }

  /** Tira a peça avulsa da cena, devolvendo os materiais; a geometria é da fábrica. */
  private desfazerSozinha(peca: PecaNaCena): void {
    if (!peca.raiz) return;
    this.objeto.remove(peca.raiz);
    for (const parte of [peca.malha, peca.contorno]) {
      if (!parte) continue;
      parte.material.dispose();
      this.porObjeto.delete(parte);
      const i = this.alvosDoRaio.indexOf(parte);
      if (i >= 0) this.alvosDoRaio.splice(i, 1);
    }
    peca.raiz = peca.malha = peca.contorno = null;
  }

  /** A cópia entra no lote da série dela; o lote nasce com a primeira. */
  private porNoLote(peca: PecaNaCena): void {
    const { dados } = peca;
    let lote = this.lotePorSerie.get(dados.serie!);
    if (!lote || lote.cheio) {
      lote = new LoteDaSerie<PecaNaCena>(this.fabrica.obter(dados), dados.forma, dados.contorno);
      this.lotes.push(lote);
      this.lotePorSerie.set(dados.serie!, lote);
      this.objeto.add(lote.malha);
      if (lote.contorno) this.objeto.add(lote.contorno);
      if (peca.alvoMalha >= 0.1 * PESO_DO_PREENCHIMENTO) {
        this.alvosDoRaio.push(lote.malha);
        this.porObjeto.set(lote.malha, lote);
      }
    }
    peca.lote = lote;
    peca.indice = lote.acrescentar(peca);
  }

  /**
   * O objeto passou do limiar: as cópias que já estão na tela trocam a peça avulsa pelo lote da
   * série, sem perder a entrada em andamento — o estado da animação é da `PecaNaCena`, não do desenho.
   */
  private agruparSeries(): void {
    this.instanciando = true;
    for (const p of this.pecas) {
      if (!p.raiz || !cabeEmLote(p.dados)) continue;
      this.desfazerSozinha(p);
      this.porNoLote(p);
    }
  }

  private aplicarGiro(dAz: number, dPol: number): void {
    this.deslocamento.copy(this.camera.position).sub(this.controles.target);
    this.esferica.setFromVector3(this.deslocamento);
    this.esferica.theta -= dAz;
    this.esferica.phi = MathUtils.clamp(this.esferica.phi - dPol, this.controles.minPolarAngle, this.controles.maxPolarAngle);
    this.esferica.makeSafe();
    this.deslocamento.setFromSpherical(this.esferica);
    this.camera.position.copy(this.controles.target).add(this.deslocamento);
    this.camera.lookAt(this.controles.target);
  }

  private girarPorInercia(dt: number): void {
    if (!this.inercia.x && !this.inercia.y) return;
    this.aplicarGiro(this.inercia.x * dt, this.inercia.y * dt);
    this.inercia.multiplyScalar(Math.exp(-ATRITO_DO_GIRO * dt));
    if (this.inercia.length() < GIRO_MINIMO) this.inercia.set(0, 0);
    this.ultimaInteracao = performance.now();
  }

  private animarVarredura(agora: number, dt: number, reduzido: boolean): void {
    const v = this.varredura;
    if (!reduzido) {
      this.intensidadeDaVarredura += ((this.escaneando ? 1 : 0) - this.intensidadeDaVarredura) * suave(dt, 6);
      if (!this.escaneando && this.intensidadeDaVarredura < 0.01) this.intensidadeDaVarredura = 0;
      this.faseDaVarredura = (this.faseDaVarredura + dt / VARREDURA_PERIODO_S) % 1;
    }
    v.grupo.visible = this.intensidadeDaVarredura > 0;
    if (!v.grupo.visible) return;
    // Sobe da base e encolhe um pouco enquanto apaga: lê como um feixe varrendo o volume do objeto.
    const t = reduzido ? 0 : this.faseDaVarredura;
    v.anel.position.y = Y_DO_PISO + 0.04 + t * VARREDURA_ALTURA;
    v.anel.scale.setScalar(1 - t * 0.35);
    v.materialAnel.opacity = this.intensidadeDaVarredura * (reduzido ? 0.6 : (1 - t) * 0.85);
    v.materialDisco.opacity = this.intensidadeDaVarredura * (reduzido ? 0.12 : 0.1 + 0.05 * Math.sin(agora / 160));
  }

  private ajustar(): void {
    const largura = this.host.clientWidth;
    const altura = this.host.clientHeight;
    if (!largura || !altura) return;
    const mudou = largura !== this.largura || altura !== this.altura;
    this.largura = largura;
    this.altura = altura;
    this.renderer.setSize(largura, altura, false);
    this.composer.setSize(largura, altura);
    if (this.opcoes.perfil.bloom === 'reduzido') {
      // O bloom é o passe mais caro: em meia resolução o brilho quase não muda e a GPU do celular agradece.
      const razao = this.renderer.getPixelRatio();
      this.bloom.setSize((largura * razao) / 2, (altura * razao) / 2);
    }
    this.camera.aspect = largura / altura;
    this.camera.updateProjectionMatrix();
    if (mudou && this.pecas.length) this.centralizar();
  }

  private readonly passo = (agora: number): void => {
    this.quadro = requestAnimationFrame(this.passo);
    const dt = Math.min(0.1, Math.max(0, (agora - this.anterior) / 1000));
    this.anterior = agora;
    const reduzido = this.opcoes.movimentoReduzido;

    if (this.pisoPendente) this.posicionarPiso(this.medirObjeto());

    this.fatorExplosao += (this.alvoExplosao - this.fatorExplosao) * suave(dt, 7);
    if (Math.abs(this.alvoExplosao - this.fatorExplosao) < 1e-4) this.fatorExplosao = this.alvoExplosao;
    const grupo = (this.destacada ?? this.selecionada)?.dados.grupo ?? null;
    for (const p of this.pecas) this.animarPeca(p, agora, dt, grupo);
    for (const lote of this.lotes) lote.publicar();

    if (!reduzido) for (const anel of this.aneis) anel.rotation.z += (anel.userData['velocidade'] as number) * dt;
    this.animarVarredura(agora, dt, reduzido);
    this.voarPasso(dt);
    this.girarPorInercia(dt);
    // Pedido de girar sempre ou de parar vence o "gira quando ninguém mexe"; o arrasto e a mão
    // continuam segurando, porque quem está mexendo é o dono.
    this.controles.autoRotate =
      this.modoDeGiro !== 'parado' &&
      !this.arrastando &&
      !this.maoNaCamera &&
      !this.voo &&
      (this.modoDeGiro === 'continuo' ||
        (!reduzido && !this.destacada && agora - this.ultimaInteracao > OCIOSO_ATE_GIRAR_MS));
    this.controles.update(dt);

    // Raio só quando o ponteiro (mouse ou dedo apontando) mexeu, ou de vez em quando, porque o
    // objeto gira por baixo dele.
    const apontando = this.ponteiroDentro || this.cursor3d.ativo;
    if (apontando && !this.arrastando && (this.ponteiroMudou || ++this.contagem % 6 === 0)) this.lancarRaio();
    this.ponteiroMudou = false;
    if (this.cursor3d.ativo) this.cursor3d.grupo.quaternion.copy(this.camera.quaternion);
    if (this.opcoes.aoMedir) {
      // O composer chama o renderer uma vez por passe, e cada chamada zeraria a contagem: aqui ela
      // soma o quadro inteiro.
      this.renderer.info.autoReset = false;
      this.renderer.info.reset();
    }
    this.composer.render(dt);
    if (this.opcoes.aoMedir) this.medir(agora);
  };

  private medir(agora: number): void {
    const m = this.medicao;
    if (!m.inicio) m.inicio = agora;
    m.quadros++;
    if (agora - m.inicio < 1_000) return;
    this.opcoes.aoMedir?.({
      fps: Math.round((m.quadros * 1_000) / (agora - m.inicio)),
      chamadas: this.renderer.info.render.calls,
      pecas: this.pecas.length,
      lotes: this.lotes.length,
    });
    this.medicao = { inicio: agora, quadros: 0 };
  }

  private animarPeca(p: PecaNaCena, agora: number, dt: number, grupo: string | null): void {
    const t = MathUtils.clamp((agora - p.nascimento) / ENTRADA_MS, 0, 1);
    const entrada = 1 - (1 - t) ** 3;
    // O flash acende no meio da entrada e apaga junto com ela.
    const flash = t < 1 ? Math.sin(Math.PI * t) : 0;
    // O mouse e a seleção mandam; sem eles, o destaque pedido pelo Jarvis.
    const destacados = this.filtros.destacados;
    const alvoDestaque = grupo !== null ? (p.dados.grupo === grupo ? 1.8 : APAGADA)
      : filtroVazio(destacados) ? 1 : noFiltro(destacados, p.dados) ? 1.8 : APAGADA;
    p.destaque += (alvoDestaque - p.destaque) * suave(dt, 10);
    const alfaDaMalha = Math.min(1, p.alvoMalha * entrada * p.destaque + flash * 0.2);
    const alfaDoContorno = Math.min(1, p.alvoContorno * entrada * Math.min(p.destaque, 1.3) + flash * 0.5);
    this.onde.copy(p.base).addScaledVector(p.direcao, this.fatorExplosao * DISTANCIA_DA_EXPLOSAO);
    if (p.lote) {
      // A cópia instanciada recebe os mesmos números da avulsa, só que por instância.
      const tom = this.corDaMalha.copy(p.cor).lerp(BRANCO, flash * 0.7);
      const matriz = p.visivel ? this.matriz.compose(this.onde, p.giro, this.escala.setScalar(Math.max(1e-3, entrada))) : null;
      p.lote.colocar(p.indice, matriz, tom, alfaDaMalha, tom, alfaDoContorno);
      return;
    }
    if (!p.raiz) return;
    p.raiz.scale.setScalar(Math.max(1e-3, entrada));
    p.raiz.position.copy(this.onde);
    if (p.malha) {
      p.malha.material.opacity = alfaDaMalha;
      p.malha.material.color.copy(p.cor).lerp(BRANCO, flash * 0.7);
    }
    if (p.contorno) {
      p.contorno.material.opacity = alfaDoContorno;
      p.contorno.material.color.copy(p.cor).lerp(BRANCO, flash * 0.7);
    }
  }

  private voar(posicao: Vector3, alvo: Vector3): void {
    this.voo = { posicao: posicao.clone(), alvo: alvo.clone() };
    if (this.opcoes.movimentoReduzido) this.voarPasso(Infinity);
  }

  private voarPasso(dt: number): void {
    if (!this.voo) return;
    const k = suave(dt, 6);
    this.camera.position.lerp(this.voo.posicao, k);
    this.controles.target.lerp(this.voo.alvo, k);
    if (this.camera.position.distanceTo(this.voo.posicao) < 0.01 && this.controles.target.distanceTo(this.voo.alvo) < 0.01) {
      this.voo = null;
    }
  }

  /** Escondida, ou fora do que foi isolado, a peça não aparece nem recebe o mouse. */
  private visivel(p: PecaNaCena): boolean {
    const { isolados, escondidos } = this.filtros;
    return !noFiltro(escondidos, p.dados) && (filtroVazio(isolados) || noFiltro(isolados, p.dados));
  }

  /** A peça de um acerto: a avulsa direto, a do lote pelo `instanceId`. */
  private pecaDoAcerto(acerto: Intersection): PecaNaCena | null {
    const dono = this.porObjeto.get(acerto.object);
    if (!(dono instanceof LoteDaSerie)) return dono ?? null;
    return acerto.instanceId === undefined ? null : (dono.membros[acerto.instanceId] ?? null);
  }

  /** O primeiro acerto numa peça visível: o raio do Three.js não olha `visible`. */
  private acertar(): { ponto: Vector3; peca: PecaNaCena } | null {
    for (const acerto of this.raio.intersectObjects(this.alvosDoRaio, false)) {
      const peca = this.pecaDoAcerto(acerto);
      if (peca?.visivel) return { ponto: acerto.point, peca };
    }
    return null;
  }

  private lancarRaio(): void {
    this.raio.setFromCamera(this.ponteiro, this.camera);
    const acerto = this.acertar();
    this.destacar(acerto?.peca ?? null);
    if (this.cursor3d.ativo) {
      const profundidade = this.camera.position.distanceTo(this.controles.target);
      if (acerto) this.cursor3d.grupo.position.copy(acerto.ponto);
      else this.raio.ray.at(profundidade, this.cursor3d.grupo.position);
    }
  }

  private pecaEm(x: number, y: number): PecaNaCena | null {
    this.raio.setFromCamera(new Vector2(x, y), this.camera);
    return this.acertar()?.peca ?? null;
  }

  private destacar(peca: PecaNaCena | null): void {
    if (peca === this.destacada) return;
    this.destacada = peca;
    this.renderer.domElement.style.cursor = peca ? 'pointer' : '';
    this.opcoes.aoDestacar(peca ? { nome: peca.dados.nome, grupo: peca.dados.grupo } : null);
  }

  private readonly aoMoverPonteiro = (evento: PointerEvent): void => {
    const retangulo = this.renderer.domElement.getBoundingClientRect();
    this.ponteiro.set(
      ((evento.clientX - retangulo.left) / retangulo.width) * 2 - 1,
      -((evento.clientY - retangulo.top) / retangulo.height) * 2 + 1,
    );
    this.ponteiroDentro = true;
    this.ponteiroMudou = true;
  };

  private readonly aoSairPonteiro = (): void => {
    this.ponteiroDentro = false;
    if (!this.cursor3d.ativo) this.destacar(null);
  };

  private readonly aoComecarArrasto = (): void => {
    this.arrastando = true;
    this.voo = null;
    this.inercia.set(0, 0);
    this.opcoes.aoArrastar?.();
  };

  private readonly aoTerminarArrasto = (): void => {
    this.arrastando = false;
    this.ultimaInteracao = performance.now();
  };
}

/** Fração de aproximação que não depende da taxa de quadros: `1 - e^(-velocidade·dt)`. */
function suave(dt: number, velocidade: number): number {
  return 1 - Math.exp(-velocidade * dt);
}

/**
 * Só a cópia de uma série vai para o lote, e só com malha: a `line` é uma linha contínua, que o
 * `InstancedMesh` não desenha, e o raio dela é o do `Line` — fica avulsa.
 */
function cabeEmLote(dados: PecaHolograma): boolean {
  return dados.serie !== undefined && dados.forma !== 'line';
}

function direcaoPeloCentro(peca: PecaNaCena, centro: Vector3): void {
  peca.direcao.copy(peca.base).sub(centro);
  if (peca.direcao.lengthSq() < 1e-8) peca.direcao.set(0, 1, 0);
  else peca.direcao.normalize();
}
