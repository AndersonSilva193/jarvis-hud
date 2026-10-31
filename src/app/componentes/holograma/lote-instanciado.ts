import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
} from 'three';

import type { FormaHolograma } from '../../nucleo/holograma.modelos';
import type { GeometriaDaPeca } from './geometrias-holograma';

/**
 * O maior `rep.n`/`rad.n` que o `HologramaValidator` do Java aceita (`MAX_COPIAS`): uma série nunca
 * passa disso, e o lote nasce com esse tanto de lugares.
 */
export const CAPACIDADE_DO_LOTE = 60;

/** Matriz que some com a cópia: escondida por filtro, ela não aparece nem recebe o raio. */
const ESCONDIDA = new Matrix4().makeScale(0, 0, 0);

/**
 * As cópias de um `rep`/`rad` numa chamada só à GPU, em vez de duas por cópia (malha e contorno).
 *
 * A malha é um `InstancedMesh`; o contorno, um `LineSegments` sobre `InstancedBufferGeometry` que
 * lê **a mesma** matriz por instância. Cada cópia continua com posição, escala, cor e opacidade
 * próprias: a entrada, o flash, a explosão e o destaque andam por peça, como na peça avulsa.
 *
 * A opacidade por instância não existe no `MeshBasicMaterial`. Multiplicar a cor por ela daria a
 * mesma luz no blending aditivo, mas não a mesma névoa: a névoa somaria a cor de fundo inteira em
 * cada camada translúcida, e um motor com dezenas de carcaças sobrepostas ficaria azulado. Então
 * o shader `basic` (o mesmo da malha e da linha) ganha um `corDaInstancia` RGBA que multiplica o
 * `diffuse` e o `opacity` — o resto do shader, névoa inclusive, é o do Three.js.
 */
export class LoteDaSerie<T> {
  readonly malha: InstancedMesh<BufferGeometry, MeshBasicMaterial>;
  readonly contorno: LineSegments<InstancedBufferGeometry, LineBasicMaterial> | null;
  /** Na ordem dos índices: o raio devolve o `instanceId`, e é aqui que ele vira peça. */
  readonly membros: T[] = [];
  private readonly corDaMalha: InstancedBufferAttribute;
  private readonly corDoContorno: InstancedBufferAttribute | null;

  constructor(geometria: GeometriaDaPeca, forma: FormaHolograma, comContorno: boolean) {
    if (!geometria.malha) throw new Error('Série sem malha não vira lote.');
    // A geometria da fábrica é compartilhada com as peças avulsas: o atributo por instância mora num
    // invólucro que reaproveita os mesmos buffers de posição e índice.
    const daMalha = new BufferGeometry();
    daMalha.index = geometria.malha.index;
    daMalha.setAttribute('position', geometria.malha.getAttribute('position'));
    this.corDaMalha = new InstancedBufferAttribute(new Float32Array(CAPACIDADE_DO_LOTE * 4), 4);
    daMalha.setAttribute('corDaInstancia', this.corDaMalha);
    const materialDaMalha = porInstancia(
      new MeshBasicMaterial({
        transparent: true, blending: AdditiveBlending, depthWrite: false,
        side: forma === 'ring' ? DoubleSide : FrontSide,
      }),
      false,
    );
    this.malha = new InstancedMesh(daMalha, materialDaMalha, CAPACIDADE_DO_LOTE);
    this.malha.count = 0;
    // A caixa do lote muda a cada quadro (entrada, explosão): ela é recalculada sob demanda, e quem
    // corta o que está fora da tela é a câmera, que nunca deixa o objeto de fora.
    this.malha.frustumCulled = false;

    if (comContorno) {
      const doContorno = new InstancedBufferGeometry();
      doContorno.index = geometria.contorno.index;
      doContorno.setAttribute('position', geometria.contorno.getAttribute('position'));
      doContorno.setAttribute('matrizDaInstancia', this.malha.instanceMatrix);
      this.corDoContorno = new InstancedBufferAttribute(new Float32Array(CAPACIDADE_DO_LOTE * 4), 4);
      doContorno.setAttribute('corDaInstancia', this.corDoContorno);
      doContorno.instanceCount = 0;
      const materialDoContorno = porInstancia(
        new LineBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false }),
        true,
      );
      this.contorno = new LineSegments(doContorno, materialDoContorno);
      this.contorno.frustumCulled = false;
    } else {
      this.contorno = null;
      this.corDoContorno = null;
    }
  }

  get cheio(): boolean {
    return this.membros.length >= CAPACIDADE_DO_LOTE;
  }

  /** Entra no fim do lote e devolve o índice da instância. */
  acrescentar(membro: T): number {
    this.membros.push(membro);
    const quantidade = this.membros.length;
    this.malha.count = quantidade;
    if (this.contorno) this.contorno.geometry.instanceCount = quantidade;
    return quantidade - 1;
  }

  /** Escreve uma instância; `matriz` nula esconde a cópia. Vale no próximo {@link publicar}. */
  colocar(indice: number, matriz: Matrix4 | null, corDaMalha: Color, alfaDaMalha: number, corDoContorno: Color, alfaDoContorno: number): void {
    this.malha.setMatrixAt(indice, matriz ?? ESCONDIDA);
    this.corDaMalha.setXYZW(indice, corDaMalha.r, corDaMalha.g, corDaMalha.b, alfaDaMalha);
    this.corDoContorno?.setXYZW(indice, corDoContorno.r, corDoContorno.g, corDoContorno.b, alfaDoContorno);
  }

  /** Depois de escrever as instâncias do quadro: sobe à GPU e invalida as caixas do raio e do enquadramento. */
  publicar(): void {
    this.malha.instanceMatrix.needsUpdate = true;
    this.corDaMalha.needsUpdate = true;
    if (this.corDoContorno) this.corDoContorno.needsUpdate = true;
    this.malha.boundingBox = null;
    this.malha.boundingSphere = null;
  }

  /** Os buffers de posição são da fábrica, que os descarta no mesmo `limpar`. */
  descartar(): void {
    this.malha.geometry.dispose();
    this.malha.material.dispose();
    this.malha.dispose();
    this.contorno?.geometry.dispose();
    this.contorno?.material.dispose();
  }
}

/**
 * Estende o shader `basic` com a cor RGBA por instância e, no contorno (que não é `InstancedMesh`),
 * com a matriz por instância também. Os trechos substituídos são do Three.js 0.186: se uma versão
 * nova os renomear, o `replace` não acha nada e o lote sai apagado — o `lote-instanciado.spec.ts`
 * confere os trechos contra o shader do pacote instalado.
 */
export function porInstancia<M extends MeshBasicMaterial | LineBasicMaterial>(material: M, comMatriz: boolean): M {
  material.onBeforeCompile = (shader) => {
    let vertice = `attribute vec4 corDaInstancia;\nvarying vec4 vCorDaInstancia;\n${shader.vertexShader}`.replace(
      '#include <fog_vertex>',
      '#include <fog_vertex>\n\tvCorDaInstancia = corDaInstancia;',
    );
    if (comMatriz) {
      vertice = `attribute mat4 matrizDaInstancia;\n${vertice}`.replace(
        '#include <project_vertex>',
        'vec4 mvPosition = modelViewMatrix * matrizDaInstancia * vec4( transformed, 1.0 );\n\tgl_Position = projectionMatrix * mvPosition;',
      );
    }
    shader.vertexShader = vertice;
    shader.fragmentShader = `varying vec4 vCorDaInstancia;\n${shader.fragmentShader}`.replace(
      'vec4 diffuseColor = vec4( diffuse, opacity );',
      'vec4 diffuseColor = vec4( diffuse * vCorDaInstancia.rgb, opacity * vCorDaInstancia.a );',
    );
  };
  // O código do `onBeforeCompile` é o mesmo nos dois: sem chave própria, o Three.js reaproveitaria o
  // programa da malha no contorno.
  const chave = comMatriz ? 'holograma-lote-contorno' : 'holograma-lote-malha';
  material.customProgramCacheKey = () => chave;
  return material;
}
