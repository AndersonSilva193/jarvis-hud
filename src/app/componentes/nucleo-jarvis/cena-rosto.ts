import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Material,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  ShaderMaterial,
  Texture,
  TextureLoader,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { EstadoJarvis } from '../../nucleo/atividade-hud.service';

type Secao = readonly [y: number, x: number, z: number];
const PERFIL: readonly Secao[] = [
  [1.68, 0.2, 0.28],
  [1.62, 0.55, 0.58],
  [1.44, 0.76, 0.72],
  [1.18, 0.86, 0.77],
  [0.86, 0.88, 0.76],
  [0.56, 0.86, 0.72],
  [0.29, 0.82, 0.7],
  [0.04, 0.79, 0.69],
  [-0.23, 0.74, 0.66],
  [-0.48, 0.69, 0.61],
  [-0.7, 0.6, 0.56],
  [-0.91, 0.45, 0.47],
  [-1.04, 0.22, 0.33],
];
const VERTEX = `
  varying vec3 vNormal; varying vec3 vView; varying vec2 vUv; varying vec3 vPos;
  void main() {
    vUv=uv; vPos=position;
    vec4 p=modelViewMatrix*vec4(position,1.);
    vNormal=normalize(normalMatrix*normal); vView=normalize(-p.xyz);
    gl_Position=projectionMatrix*p;
  }
`;
const FRAGMENT = `
  uniform vec3 uCor; uniform float uTempo; uniform float uForca;
  uniform sampler2D uRetrato; uniform float uTemRetrato;
  varying vec3 vNormal; varying vec3 vView; varying vec2 vUv; varying vec3 vPos;
  void main() {
    float borda=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),2.1);
    vec2 celula=vUv*vec2(64.,64.);
    vec2 linha=abs(fract(celula-.5)-.5)/max(fwidth(celula),vec2(.001));
    float grade=1.-min(min(linha.x,linha.y),1.);
    float luz=.18+.32*max(dot(normalize(vNormal),normalize(vec3(-.8,1.,2.))),0.);
    float varredura=pow(max(0.,sin(vPos.y*32.-uTempo*.65)),40.)*.08;
    vec3 cor=vec3(.003,.018,.028)+uCor*(luz*.12+grade*.25+borda*.85+varredura+uForca*.06);
    vec2 retratoUv=vec2(.445+(vPos.x/1.8+.5)*.11,1.-(.184+(1.-clamp((vPos.y+1.04)/2.72,0.,1.))*.303));
    vec3 retrato=texture2D(uRetrato,retratoUv).rgb;
    float frontal=smoothstep(.05,.38,vPos.z)*uTemRetrato;
    cor=mix(cor,retrato*(1.05+uForca*.28)+uCor*borda*.14,frontal);
    gl_FragColor=vec4(cor,1.);
  }
`;

function interpolar(a: number, b: number, c: number, d: number, t: number): number {
  return (
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t * t +
      (-a + 3 * b - 3 * c + d) * t * t * t)
  );
}
function geometriaDaMascara(leve: boolean): BufferGeometry {
  const linhas = leve ? 44 : 80,
    colunas = leve ? 64 : 112;
  const posicoes: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let l = 0; l <= linhas; l++) {
    const v = (l / linhas) * (PERFIL.length - 1),
      i = Math.min(Math.floor(v), PERFIL.length - 2),
      t = v - i;
    const a = PERFIL[Math.max(0, i - 1)]!,
      b = PERFIL[i]!,
      c = PERFIL[i + 1]!,
      d = PERFIL[Math.min(PERFIL.length - 1, i + 2)]!;
    const y = interpolar(a[0], b[0], c[0], d[0], t);
    const rx = interpolar(a[1], b[1], c[1], d[1], t),
      rz = interpolar(a[2], b[2], c[2], d[2], t);
    for (let n = 0; n <= colunas; n++) {
      const angulo = (n / colunas) * Math.PI * 2,
        x = Math.sin(angulo) * rx,
        frente = Math.max(0, Math.cos(angulo));
      const nariz =
        Math.exp(-Math.pow(x / 0.17, 4)) * Math.exp(-Math.pow((y + 0.04) / 0.4, 2)) * 0.28;
      const zigomatico =
        Math.exp(-Math.pow((Math.abs(x) - 0.53) / 0.18, 2)) *
        Math.exp(-Math.pow((y + 0.02) / 0.35, 2)) *
        0.055;
      posicoes.push(x, y, Math.cos(angulo) * rz + (nariz + zigomatico) * frente);
      uvs.push(n / colunas, l / linhas);
      if (l && n) {
        const atual = l * (colunas + 1) + n,
          anterior = atual - colunas - 1;
        indices.push(atual - 1, anterior - 1, anterior, atual - 1, anterior, atual);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(posicoes, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

const CONTINENTES: readonly (readonly [number, number])[][] = [
  [
    [-165, 67],
    [-130, 71],
    [-53, 48],
    [-81, 8],
    [-102, 19],
    [-119, 44],
    [-165, 58],
  ],
  [
    [-80, 10],
    [-50, 7],
    [-35, -7],
    [-51, -32],
    [-69, -55],
    [-77, -17],
  ],
  [
    [-17, 35],
    [10, 37],
    [37, 30],
    [51, 12],
    [34, -10],
    [29, -35],
    [13, -35],
    [-16, 6],
  ],
  [
    [-9, 37],
    [-10, 58],
    [29, 70],
    [90, 73],
    [177, 61],
    [145, 36],
    [120, 17],
    [103, 1],
    [80, 7],
    [62, 26],
    [35, 35],
  ],
  [
    [113, -12],
    [141, -11],
    [154, -27],
    [136, -39],
    [115, -33],
  ],
  [
    [-52, 60],
    [-24, 68],
    [-43, 83],
    [-60, 75],
  ],
];
function noContinente(
  x: number,
  y: number,
  poligono: readonly (readonly [number, number])[],
): boolean {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const a = poligono[i]!,
      b = poligono[j]!;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      dentro = !dentro;
  }
  return dentro;
}

/** Máscara volumétrica, aros de instrumento e globo: uma única cena com qualidade adaptativa. */
export class CenaRosto {
  private readonly cena = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 0.1, 40);
  private readonly renderer: WebGLRenderer;
  private readonly compositor: EffectComposer | null;
  private readonly bloom: UnrealBloomPass | null;
  private readonly transparencia: ShaderPass | null;
  private readonly cabeca = new Group();
  private readonly aneis = new Group();
  private readonly terra = new Group();
  private readonly orbita = new Group();
  private readonly geometrias: BufferGeometry[] = [];
  private readonly materiais: Material[] = [];
  private readonly texturas: Texture[] = [];
  private vivo = true;
  private readonly cor = new Color('#24d7ff');
  private readonly branco = new Color('#c2fbff');
  private readonly uniforme = {
    uCor: { value: this.cor },
    uTempo: { value: 0 },
    uForca: { value: 0 },
    uRetrato: { value: null as Texture | null },
    uTemRetrato: { value: 0 },
  };
  private readonly fino = this.material(
    new LineBasicMaterial({ color: '#126b91', transparent: true, opacity: 0.7 }),
  );
  private readonly aceso = this.material(
    new LineBasicMaterial({ color: '#39cfff', transparent: true, opacity: 0.95 }),
  );
  private readonly olhos = this.material(
    new MeshBasicMaterial({ color: '#b7fbff', side: DoubleSide }),
  );
  private readonly neon = this.material(
    new MeshBasicMaterial({ color: '#28d9ff', side: DoubleSide, transparent: true, opacity: 0.95 }),
  );
  private readonly vermelho = this.material(
    new MeshBasicMaterial({ color: '#ff4d42', side: DoubleSide, transparent: true, opacity: 0.8 }),
  );

  constructor(host: HTMLElement, leve: boolean, aoTexturizar?: () => void) {
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: !leve,
      powerPreference: 'low-power',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, leve ? 1 : 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(this.renderer.domElement);
    this.camera.position.set(0, 0.08, 8.7);
    if (!leve) {
      this.compositor = new EffectComposer(this.renderer);
      this.compositor.addPass(new RenderPass(this.cena, this.camera));
      this.bloom = new UnrealBloomPass(new Vector2(512, 512), 0.8, 0.55, 0.55);
      this.compositor.addPass(this.bloom);
      this.transparencia = new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader:
          'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:
          'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;float a=clamp(max(c.r,max(c.g,c.b))*2.6,0.,1.);gl_FragColor=vec4(c,a);}',
      });
      this.compositor.addPass(this.transparencia);
    } else {
      this.compositor = null;
      this.bloom = null;
      this.transparencia = null;
    }
    this.cena.add(this.cabeca, this.aneis, this.terra, this.orbita);
    this.cabeca.position.y = 1.06;
    this.cabeca.scale.setScalar(0.91);
    this.cabeca.rotation.y = -0.075;
    const mascara = this.geometria(geometriaDaMascara(leve));
    const superficie = this.material(
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: this.uniforme,
        side: DoubleSide,
      }),
    );
    this.cabeca.add(new Mesh(mascara, superficie));
    // Projeção frontal do capacete fornecido pelo usuário, sem desenhar os controles da imagem.
    // O mapa permanece sobre geometria volumétrica; a textura completa não é usada como tela.
    const retrato = new TextureLoader().load('/ambiente/referencia-jarvis.png', (textura) => {
      if (!this.vivo) {
        textura.dispose();
        return;
      }
      this.uniforme.uRetrato.value = textura;
      this.uniforme.uTemRetrato.value = 1;
      this.olhos.visible = false;
      this.renderer.domElement.dataset['material'] = 'referencia';
      aoTexturizar?.();
    });
    this.texturas.push(retrato);

    // Placas da testa, órbitas e mandíbula com contornos que acompanham o volume.
    this.traco(
      [
        [-0.64, 1.38, 0.51],
        [-0.4, 1.17, 0.7],
        [-0.32, 0.72, 0.8],
        [0.32, 0.72, 0.8],
        [0.4, 1.17, 0.7],
        [0.64, 1.38, 0.51],
      ],
      this.aceso,
    );
    this.traco(
      [
        [-0.72, 1.45, 0.41],
        [-0.52, 1.58, 0.52],
        [0, 1.68, 0.34],
        [0.52, 1.58, 0.52],
        [0.72, 1.45, 0.41],
      ],
      this.aceso,
    );
    for (const s of [-1, 1]) {
      this.traco(
        [
          [s * 0.83, 0.93, 0.3],
          [s * 0.86, 0.49, 0.29],
          [s * 0.8, 0.09, 0.37],
          [s * 0.6, -0.16, 0.55],
          [s * 0.58, -0.64, 0.51],
          [s * 0.32, -0.91, 0.47],
          [0, -1.02, 0.36],
        ],
        this.aceso,
      );
      this.traco(
        [
          [s * 0.7, 0.35, 0.5],
          [s * 0.49, 0.27, 0.68],
          [s * 0.18, 0.28, 0.79],
          [s * 0.14, -0.12, 0.99],
          [0, -0.26, 1.03],
        ],
        this.aceso,
      );
      this.traco(
        [
          [s * 0.72, 0.03, 0.5],
          [s * 0.4, -0.23, 0.67],
          [s * 0.35, -0.54, 0.69],
        ],
        this.aceso,
      );
      this.traco(
        [
          [s * 0.77, -0.25, 0.34],
          [s * 0.64, -0.57, 0.4],
          [s * 0.43, -0.78, 0.46],
        ],
        this.fino,
      );
      this.traco(
        [
          [s * 0.29, -0.43, 0.72],
          [s * 0.21, -0.5, 0.77],
          [s * 0.21, -0.69, 0.65],
        ],
        this.fino,
      );
      const olho = new Shape();
      olho.moveTo(s * 0.17, 0.4);
      olho.lineTo(s * 0.69, 0.44);
      olho.lineTo(s * 0.65, 0.34);
      olho.lineTo(s * 0.19, 0.32);
      olho.closePath();
      const g = this.geometria(new ShapeGeometry(olho));
      const p = g.getAttribute('position');
      for (let n = 0; n < p.count; n++)
        p.setZ(n, 0.81 - Math.pow(Math.abs(p.getX(n)) / 0.9, 2) * 0.25);
      this.cabeca.add(new Mesh(g, this.olhos));
      // Pequenas fendas de luz e módulos laterais dão espessura ao capacete.
      for (let i = 0; i < 3; i++)
        this.traco(
          [
            [s * 0.87, 0.32 - i * 0.13, 0.15],
            [s * 0.89, 0.28 - i * 0.13, 0.34],
          ],
          this.aceso,
        );
      const ouvido = new Mesh(this.geometria(new TorusGeometry(0.19, 0.022, 6, 32)), this.neon);
      ouvido.position.set(s * 0.86, 0.31, 0.03);
      ouvido.rotation.y = Math.PI / 2;
      this.cabeca.add(ouvido);
    }
    this.traco(
      [
        [-0.28, -0.55, 0.66],
        [-0.17, -0.52, 0.76],
        [0.17, -0.52, 0.76],
        [0.28, -0.55, 0.66],
      ],
      this.aceso,
    );
    this.traco(
      [
        [-0.23, -0.75, 0.59],
        [0, -0.84, 0.56],
        [0.23, -0.75, 0.59],
      ],
      this.aceso,
    );
    for (let l = 0; l < 16; l++) {
      const y = -1.06 - l * 0.052,
        w = l < 7 ? 0.3 + l * 0.008 : 0.36 + (l - 7) * 0.09;
      this.traco(
        [
          [-w, y, -0.08],
          [-w * 0.55, y + 0.025, 0.32],
          [0, y + 0.05, 0.43],
          [w * 0.55, y + 0.025, 0.32],
          [w, y, -0.08],
        ],
        this.fino,
      );
    }
    for (let i = -6; i <= 6; i++)
      this.traco(
        [
          [i * 0.15, -1.84, 0.1],
          [i * 0.045, -1.2, 0.36],
          [i * 0.04, -1.04, 0.18],
        ],
        this.fino,
      );

    this.aneis.position.set(0, 0.97, -0.65);
    this.arco(1.7, 1.713, 0, Math.PI * 2, this.neon, this.aneis);
    this.arco(
      1.84,
      1.85,
      0,
      Math.PI * 2,
      this.material(new MeshBasicMaterial({ color: '#135674', side: DoubleSide })),
      this.aneis,
    );
    const tiques: number[] = [];
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2,
        r = i % 5 === 0 ? 1.94 : 1.98;
      tiques.push(
        Math.cos(a) * r,
        Math.sin(a) * r,
        0.01,
        Math.cos(a) * 2.025,
        Math.sin(a) * 2.025,
        0.01,
      );
    }
    const t = this.geometria(new BufferGeometry());
    t.setAttribute('position', new Float32BufferAttribute(tiques, 3));
    this.aneis.add(new LineSegments(t, this.fino));
    for (let i = 0; i < 12; i++) {
      if (i === 2 || i === 7) continue;
      this.arco(
        2.07,
        2.12,
        (i * Math.PI) / 6,
        (i * Math.PI) / 6 + 0.22,
        i === 4 || i === 10 ? this.vermelho : this.neon,
        this.aneis,
      );
    }
    for (let i = 0; i < 5; i++)
      this.arco(1.77, 1.79, i * 1.17, i * 1.17 + 0.36, this.neon, this.aneis);

    // Globo pontilhado, com silhuetas geográficas e órbitas inclinadas.
    const esfera = this.geometria(new SphereGeometry(0.77, leve ? 24 : 48, leve ? 16 : 32));
    this.terra.add(
      new Mesh(
        esfera,
        this.material(
          new MeshBasicMaterial({
            color: '#047fa7',
            wireframe: true,
            transparent: true,
            opacity: 0.22,
          }),
        ),
      ),
    );
    const pontos: number[] = [];
    for (let lat = -65; lat < 80; lat += leve ? 4 : 2) {
      for (let lon = -180; lon < 180; lon += leve ? 4 : 2) {
        if (!CONTINENTES.some((p) => noContinente(lon, lat, p))) continue;
        const a = (lon * Math.PI) / 180,
          b = (lat * Math.PI) / 180;
        pontos.push(
          0.78 * Math.cos(b) * Math.sin(a),
          0.78 * Math.sin(b),
          0.78 * Math.cos(b) * Math.cos(a),
        );
      }
    }
    const terra = this.geometria(new BufferGeometry());
    terra.setAttribute('position', new Float32BufferAttribute(pontos, 3));
    this.terra.add(
      new Points(
        terra,
        this.material(
          new PointsMaterial({
            color: '#5ce6ff',
            size: 0.018,
            transparent: true,
            opacity: 0.9,
            blending: AdditiveBlending,
          }),
        ),
      ),
    );
    this.terra.position.set(0, -2.25, 0.15);
    this.terra.scale.setScalar(1.35);
    this.orbita.position.copy(this.terra.position);
    this.orbita.scale.setScalar(1.15);
    for (let i = 0; i < 3; i++) {
      const orb = new Mesh(
        this.geometria(new RingGeometry(0.93 + i * 0.14, 0.936 + i * 0.14, 96)),
        this.material(
          new MeshBasicMaterial({
            color: '#14b8e7',
            side: DoubleSide,
            transparent: true,
            opacity: 0.6,
          }),
        ),
      );
      orb.rotation.set(Math.PI / 2 - 0.15 + i * 0.16, 0, i * 0.25);
      this.orbita.add(orb);
    }
    for (let i = 0; i < 4; i++) {
      const pedestal = new Mesh(
        this.geometria(new RingGeometry(1.05 + i * 0.23, 1.065 + i * 0.23, 100)),
        i === 1
          ? this.neon
          : this.material(
              new MeshBasicMaterial({
                color: '#087ba9',
                side: DoubleSide,
                transparent: true,
                opacity: 0.65,
              }),
            ),
      );
      pedestal.rotation.x = -Math.PI * 0.475;
      pedestal.position.set(0, -2.75 + i * 0.035, 0.1);
      this.cena.add(pedestal);
    }
    const particulas: number[] = [];
    for (let i = 0; i < (leve ? 40 : 100); i++) {
      const a = i * 2.39996,
        r = 0.85 + (i % 17) * 0.07;
      particulas.push(Math.cos(a) * r, -2.4 + (i % 23) * 0.064, Math.sin(a) * r);
    }
    const poeira = this.geometria(new BufferGeometry());
    poeira.setAttribute('position', new Float32BufferAttribute(particulas, 3));
    this.cena.add(
      new Points(
        poeira,
        this.material(
          new PointsMaterial({
            color: '#2cd8ff',
            size: 0.017,
            transparent: true,
            opacity: 0.65,
            blending: AdditiveBlending,
          }),
        ),
      ),
    );
  }
  redimensionar(largura: number, altura: number): void {
    if (!largura || !altura) return;
    this.camera.aspect = largura / altura;
    this.camera.position.z = this.camera.aspect < 0.66 ? (8.7 * 0.66) / this.camera.aspect : 8.7;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(largura, altura);
    this.compositor?.setSize(largura, altura);
  }
  desenhar(tempo: number, estado: EstadoJarvis, intensidade: number, parado: boolean): void {
    const forca = estado === 'falando' ? Math.max(0, Math.min(1, intensidade)) : 0;
    this.cor.set(estado === 'erro' ? '#ff5068' : estado === 'concluido' ? '#43f7c5' : '#1acfff');
    this.uniforme.uTempo.value = parado ? 0 : tempo;
    this.uniforme.uForca.value = forca;
    this.aceso.color.copy(this.cor);
    this.neon.color.copy(this.cor);
    this.olhos.color.copy(this.cor).lerp(this.branco, 0.7 + forca * 0.25);
    this.cabeca.rotation.y = -0.075 + (parado ? 0 : Math.sin(tempo * 0.3) * 0.075);
    this.cabeca.rotation.x = parado ? 0 : Math.sin(tempo * 0.4) * 0.012;
    this.aneis.rotation.z = parado
      ? 0
      : tempo * (estado === 'pensando' || estado === 'executando' ? 0.1 : 0.012);
    this.terra.rotation.y = parado ? -0.25 : tempo * 0.075 - 0.25;
    this.orbita.rotation.y = parado ? 0 : -tempo * 0.04;
    const escala =
      estado === 'escutando' && !parado ? 1 + Math.sin(tempo * 2) * 0.01 : 1 + forca * 0.012;
    this.aneis.scale.setScalar(escala);
    if (this.bloom) this.bloom.strength = 0.72 + forca * 0.3;
    if (this.compositor) this.compositor.render();
    else this.renderer.render(this.cena, this.camera);
  }
  destruir(): void {
    this.vivo = false;
    for (const textura of this.texturas) textura.dispose();
    for (const g of this.geometrias) g.dispose();
    for (const m of this.materiais) m.dispose();
    this.bloom?.dispose();
    this.transparencia?.dispose();
    this.compositor?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
  private material<T extends Material>(m: T): T {
    this.materiais.push(m);
    return m;
  }
  private geometria<T extends BufferGeometry>(g: T): T {
    this.geometrias.push(g);
    return g;
  }
  private traco(pontos: number[][], material: LineBasicMaterial): void {
    const g = this.geometria(new BufferGeometry());
    g.setAttribute('position', new Float32BufferAttribute(pontos.flat(), 3));
    this.cabeca.add(new Line(g, material));
  }
  private arco(
    interno: number,
    externo: number,
    inicio: number,
    fim: number,
    material: MeshBasicMaterial,
    alvo: Group,
  ): void {
    alvo.add(
      new Mesh(
        this.geometria(
          new RingGeometry(
            interno,
            externo,
            Math.max(8, Math.round((fim - inicio) * 42)),
            1,
            inicio,
            fim - inicio,
          ),
        ),
        material,
      ),
    );
  }
}
