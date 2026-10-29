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

import type { PecaHolograma } from '../../nucleo/holograma.modelos';
import { FabricaDeGeometrias } from './geometrias-holograma';

export interface PecaDestacada {
  nome: string;
  grupo: string;
}

export interface OpcoesDaCena {
  /** Chamado só quando a peça sob o mouse muda — nunca a cada quadro. */
  aoDestacar: (peca: PecaDestacada | null) => void;
  movimentoReduzido: boolean;
}

/** Acima disso o bloom custa GPU sem diferença visível num monitor de sala. */
const PIXEL_RATIO_MAXIMO = 1.5;
const ENTRADA_MS = 300;
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
  private readonly fabrica = new FabricaDeGeometrias();
  private readonly pecas: PecaNaCena[] = [];
  private readonly porObjeto = new Map<Object3D, PecaNaCena>();
  private readonly alvosDoRaio: Object3D[] = [];
  private readonly caixa = new Box3();
  private readonly centro = new Vector3();
  private readonly raio = new Raycaster();
  private readonly ponteiro = new Vector2();
  private readonly observador: ResizeObserver;

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
  private voo: { posicao: Vector3; alvo: Vector3 } | null = null;
  private varredura!: { grupo: Group; anel: Mesh; materialAnel: MeshBasicMaterial; materialDisco: MeshBasicMaterial };
  private escaneando = false;
  /** 0 a 1: a varredura acende e apaga suave, em vez de sumir no quadro da primeira peça. */
  private intensidadeDaVarredura = 0;
  private faseDaVarredura = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly opcoes: OpcoesDaCena,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_MAXIMO));
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

    this.controles = new OrbitControls(this.camera, tela);
    this.controles.target.copy(ALVO_INICIAL);
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
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0.6, 0.35, LIMIAR_DO_BLOOM);
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

  /** 0 = montado, 1 = explodido; o fator anda até o alvo suavemente. */
  explodir(fator: number): void {
    this.alvoExplosao = MathUtils.clamp(fator, 0, 1);
    if (this.opcoes.movimentoReduzido) this.fatorExplosao = this.alvoExplosao;
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
    this.voar(CAMERA_INICIAL, ALVO_INICIAL);
    this.ultimaInteracao = -Infinity;
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
    const grupo = this.destacada?.dados.grupo ?? null;
    for (const p of this.pecas) this.animarPeca(p, agora, dt, grupo);

    if (!reduzido) for (const anel of this.aneis) anel.rotation.z += (anel.userData['velocidade'] as number) * dt;
    this.animarVarredura(agora, dt, reduzido);
    this.voarPasso(dt);
    this.controles.autoRotate =
      !reduzido && !this.arrastando && !this.voo && !this.destacada && agora - this.ultimaInteracao > OCIOSO_ATE_GIRAR_MS;
    this.controles.update(dt);

    // Raio só quando o mouse mexeu, ou de vez em quando, porque o objeto gira por baixo dele.
    if (this.ponteiroDentro && !this.arrastando && (this.ponteiroMudou || ++this.contagem % 6 === 0)) this.lancarRaio();
    this.ponteiroMudou = false;
    this.composer.render(dt);
  };

  private animarPeca(p: PecaNaCena, agora: number, dt: number, grupo: string | null): void {
    const t = MathUtils.clamp((agora - p.nascimento) / ENTRADA_MS, 0, 1);
    const entrada = 1 - (1 - t) ** 3;
    // O flash acende no meio da entrada e apaga junto com ela.
    const flash = t < 1 ? Math.sin(Math.PI * t) : 0;
    const alvoDestaque = grupo === null ? 1 : p.dados.grupo === grupo ? 1.8 : 0.25;
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

  private lancarRaio(): void {
    this.raio.setFromCamera(this.ponteiro, this.camera);
    const acerto = this.raio.intersectObjects(this.alvosDoRaio, false)[0];
    this.destacar(acerto ? (this.porObjeto.get(acerto.object) ?? null) : null);
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
    this.destacar(null);
  };

  private readonly aoComecarArrasto = (): void => {
    this.arrastando = true;
    this.voo = null;
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
