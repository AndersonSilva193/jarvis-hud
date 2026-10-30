import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  Box3,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  FrontSide,
  FogExp2,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PolarGridHelper,
  Raycaster,
  RingGeometry,
  Scene,
  Sphere,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
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
  completo: { forca: 0.6, raio: 0.35 },
  reduzido: { forca: 0.45, raio: 0.25 },
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
const PESO_DO_PREENCHIMENTO = 0.3;
/** Só o que passa disso brilha: as linhas acendem, o preenchimento somado não. */
const LIMIAR_DO_BLOOM = 0.45;
const Y_DO_PISO = -2.4;
// O `$fundo` da HUD: com a borda esfumada pela máscara do componente, a cena some no resto da tela.
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
  raiz: Group;
  malha: Mesh<BufferGeometry, MeshBasicMaterial> | null;
  contorno: Line<BufferGeometry, LineBasicMaterial> | null;
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
  private readonly aneis: Group[] = [];
  private readonly fixos: { dispose(): void }[] = [];
  private readonly fabrica: FabricaDeGeometrias;
  private readonly pecas: PecaNaCena[] = [];
  private readonly porObjeto = new Map<Object3D, PecaNaCena>();
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
    this.renderer.setClearColor(FUNDO, 1);
    // Onde muitas peças se sobrepõem a soma aditiva passa de 1: o tone mapping (aplicado no
    // OutputPass) satura essa soma na cor da peça em vez de estourar em branco.
    this.renderer.toneMapping = ACESFilmicToneMapping;
    const tela = this.renderer.domElement;
    tela.style.display = 'block';
    tela.style.width = '100%';
    tela.style.height = '100%';
    tela.style.touchAction = 'none';
    host.appendChild(tela);

    this.cena.background = new Color(FUNDO);
    this.cena.fog = new FogExp2(FUNDO, 0.035);
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
    this.composer.addPass(new OutputPass());

    this.raio.params.Line.threshold = 0.06;
    tela.addEventListener('pointermove', this.aoMoverPonteiro);
    tela.addEventListener('pointerleave', this.aoSairPonteiro);

    this.observador = new ResizeObserver(() => this.ajustar());
    this.observador.observe(host);
    this.ajustar();
    this.quadro = requestAnimationFrame(this.passo);
  }

  adicionar(dados: PecaHolograma): void {
    const geometria = this.fabrica.obter(dados);
    const raiz = new Group();
    raiz.rotation.set(
      MathUtils.degToRad(dados.rotacao[0]),
      MathUtils.degToRad(dados.rotacao[1]),
      MathUtils.degToRad(dados.rotacao[2]),
    );
    const cor = new Color(dados.cor);
    const opacidade = dados.opacidade < 1 ? dados.opacidade : OPACIDADE_PADRAO;
    const alvoMalha = opacidade * PESO_DO_PREENCHIMENTO;
    let malha: PecaNaCena['malha'] = null;
    let contorno: PecaNaCena['contorno'] = null;
    if (geometria.malha) {
      const material = new MeshBasicMaterial({
        color: cor, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false,
        // Face de trás também somaria luz: só o anel, que é chato, precisa dos dois lados.
        side: dados.forma === 'ring' ? DoubleSide : FrontSide,
      });
      malha = new Mesh(geometria.malha, material);
      raiz.add(malha);
    }
    if (dados.contorno || !geometria.malha) {
      const material = new LineBasicMaterial({
        color: cor, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false,
      });
      contorno = geometria.malha ? new LineSegments(geometria.contorno, material) : new Line(geometria.contorno, material);
      raiz.add(contorno);
    }
    const base = new Vector3(...dados.posicao);
    const peca: PecaNaCena = {
      dados, raiz, malha, contorno, base, cor, alvoMalha,
      direcao: dados.explosao ? new Vector3(...dados.explosao).normalize() : new Vector3(),
      direcaoPropria: dados.explosao !== null,
      nascimento: this.opcoes.movimentoReduzido ? -Infinity : performance.now(),
      alvoContorno: Math.min(1, opacidade + 0.4),
      destaque: 1,
    };
    raiz.position.copy(base);
    raiz.scale.setScalar(this.opcoes.movimentoReduzido ? 1 : 1e-3);
    // O filtro do momento vale para quem chega: "isola os pistões" durante a montagem segue isolando.
    raiz.visible = this.visivel(peca);
    this.objeto.add(raiz);
    this.pecas.push(peca);

    // O feixe do projetor (o: 0.08) cobre o objeto inteiro: não pode roubar o mouse das peças.
    const alvo = malha && opacidade >= 0.1 ? malha : contorno && !malha ? contorno : null;
    if (alvo) {
      this.alvosDoRaio.push(alvo);
      this.porObjeto.set(alvo, peca);
    }
    this.caixa.expandByPoint(base);
    this.caixa.getCenter(this.centro);
    for (const p of this.pecas) if (!p.direcaoPropria) direcaoPeloCentro(p, this.centro);
  }

  /** Larga o objeto atual e devolve à GPU geometrias e materiais. */
  limpar(): void {
    for (const p of this.pecas) {
      this.objeto.remove(p.raiz);
      p.malha?.material.dispose();
      p.contorno?.material.dispose();
    }
    this.pecas.length = 0;
    this.alvosDoRaio.length = 0;
    this.porObjeto.clear();
    this.fabrica.descartar();
    this.caixa.makeEmpty();
    this.centro.set(0, 0, 0);
    this.objeto.rotation.set(0, 0, 0);
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
  }

  /** Gira o objeto (não a câmera) em volta de um eixo do mundo. */
  girarObjeto(eixo: EixoHolograma, radianos: number): void {
    if (!Number.isFinite(radianos)) return;
    this.objeto.rotation[eixo] += radianos;
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
    for (const p of this.pecas) p.raiz.visible = this.visivel(p);
    if (this.selecionada && !this.selecionada.raiz.visible) this.selecionada = null;
    if (this.destacada && !this.destacada.raiz.visible) this.destacar(null);
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
    const caixa = new Box3().setFromObject(this.objeto);
    if (caixa.isEmpty()) {
      this.voar(CAMERA_INICIAL, ALVO_INICIAL);
      return;
    }
    const esfera = caixa.getBoundingSphere(new Sphere());
    const meiaAbertura = MathUtils.degToRad(this.camera.fov / 2);
    let distancia = (esfera.radius / Math.sin(meiaAbertura)) * 1.1;
    if (this.camera.aspect < 1) distancia /= this.camera.aspect;
    distancia = MathUtils.clamp(distancia, this.controles.minDistance, this.controles.maxDistance);
    const direcao = this.camera.position.clone().sub(this.controles.target).normalize();
    this.voar(esfera.center.clone().addScaledVector(direcao, distancia), esfera.center);
  }

  resetar(): void {
    this.explodir(0);
    this.inercia.set(0, 0);
    this.objeto.rotation.set(0, 0, 0);
    this.selecionada = null;
    this.voar(CAMERA_INICIAL, ALVO_INICIAL);
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
    const grade = new PolarGridHelper(7, 16, 7, 96, 0x1d5677, 0x0e2c45);
    grade.position.y = Y_DO_PISO;
    // O helper sempre cria um LineBasicMaterial; o tipo dele é que é o genérico de Line.
    const materialDaGrade = grade.material as LineBasicMaterial;
    materialDaGrade.transparent = true;
    materialDaGrade.opacity = 0.45;
    materialDaGrade.depthWrite = false;
    this.cena.add(grade);
    this.fixos.push(grade.geometry, materialDaGrade);

    for (const anel of ANEIS) {
      const grupo = new Group();
      grupo.position.y = Y_DO_PISO + 0.02;
      grupo.rotation.x = -Math.PI / 2;
      grupo.userData['velocidade'] = anel.velocidade;
      const material = new MeshBasicMaterial({
        color: anel.cor, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
      });
      this.fixos.push(material);
      const passo = (2 * Math.PI) / anel.arcos;
      for (let i = 0; i < anel.arcos; i++) {
        const geometria = new RingGeometry(anel.raio, anel.raio + anel.largura, 64, 1, i * passo, passo * 0.7);
        this.fixos.push(geometria);
        grupo.add(new Mesh(geometria, material));
      }
      this.aneis.push(grupo);
      this.cena.add(grupo);
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
    this.cena.add(grupo);
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
    this.renderer.setSize(largura, altura, false);
    this.composer.setSize(largura, altura);
    if (this.opcoes.perfil.bloom === 'reduzido') {
      // O bloom é o passe mais caro: em meia resolução o brilho quase não muda e a GPU do celular agradece.
      const razao = this.renderer.getPixelRatio();
      this.bloom.setSize((largura * razao) / 2, (altura * razao) / 2);
    }
    this.camera.aspect = largura / altura;
    this.camera.updateProjectionMatrix();
  }

  private readonly passo = (agora: number): void => {
    this.quadro = requestAnimationFrame(this.passo);
    const dt = Math.min(0.1, Math.max(0, (agora - this.anterior) / 1000));
    this.anterior = agora;
    const reduzido = this.opcoes.movimentoReduzido;

    this.fatorExplosao += (this.alvoExplosao - this.fatorExplosao) * suave(dt, 7);
    if (Math.abs(this.alvoExplosao - this.fatorExplosao) < 1e-4) this.fatorExplosao = this.alvoExplosao;
    const grupo = (this.destacada ?? this.selecionada)?.dados.grupo ?? null;
    for (const p of this.pecas) this.animarPeca(p, agora, dt, grupo);

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
    this.composer.render(dt);
  };

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
    p.raiz.scale.setScalar(Math.max(1e-3, entrada));
    p.raiz.position.copy(p.base).addScaledVector(p.direcao, this.fatorExplosao * DISTANCIA_DA_EXPLOSAO);
    if (p.malha) {
      p.malha.material.opacity = Math.min(1, p.alvoMalha * entrada * p.destaque + flash * 0.2);
      p.malha.material.color.copy(p.cor).lerp(BRANCO, flash * 0.7);
    }
    if (p.contorno) {
      p.contorno.material.opacity = Math.min(1, p.alvoContorno * entrada * Math.min(p.destaque, 1.3) + flash * 0.5);
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

  /** O primeiro acerto numa peça visível: o raio do Three.js não olha `visible`. */
  private acertar(): { point: Vector3; object: Object3D } | undefined {
    return this.raio.intersectObjects(this.alvosDoRaio, false)
      .find((acerto) => this.porObjeto.get(acerto.object)?.raiz.visible);
  }

  private lancarRaio(): void {
    this.raio.setFromCamera(this.ponteiro, this.camera);
    const acerto = this.acertar();
    this.destacar(acerto ? (this.porObjeto.get(acerto.object) ?? null) : null);
    if (this.cursor3d.ativo) {
      const profundidade = this.camera.position.distanceTo(this.controles.target);
      if (acerto) this.cursor3d.grupo.position.copy(acerto.point);
      else this.raio.ray.at(profundidade, this.cursor3d.grupo.position);
    }
  }

  private pecaEm(x: number, y: number): PecaNaCena | null {
    this.raio.setFromCamera(new Vector2(x, y), this.camera);
    const acerto = this.acertar();
    return acerto ? (this.porObjeto.get(acerto.object) ?? null) : null;
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

function direcaoPeloCentro(peca: PecaNaCena, centro: Vector3): void {
  peca.direcao.copy(peca.base).sub(centro);
  if (peca.direcao.lengthSq() < 1e-8) peca.direcao.set(0, 1, 0);
  else peca.direcao.normalize();
}
