import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  Curve,
  CylinderGeometry,
  EdgesGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';

import type { PecaHolograma } from '../../nucleo/holograma.modelos';

/** A malha translúcida e o contorno de uma forma; `line` só tem contorno. */
export interface GeometriaDaPeca {
  malha: BufferGeometry | null;
  contorno: BufferGeometry;
}

/**
 * Ângulo mínimo entre faces para a aresta virar contorno. Em superfície curva o padrão de 1° traça
 * cada triângulo; com 20° sobram as bordas e as linhas ao longo de tubos e anéis.
 */
const LIMIAR_CURVO = 20;
/**
 * Lados da seção de toros, tubos e hélices. Cada lado vira uma linha de contorno ao longo do tubo,
 * e num tubo fino elas caem quase uma em cima da outra: com 12, a soma aditiva estourava em branco.
 */
const LADOS_DO_TUBO = 6;

/** A hélice de `docs/HOLOGRAMA.md` §7: `Ry(360·voltas·t) · (raio, 0, 0)`, de `-alt/2` a `+alt/2`. */
class CurvaHelice extends Curve<Vector3> {
  constructor(
    private readonly raio: number,
    private readonly altura: number,
    private readonly voltas: number,
  ) {
    super();
  }

  override getPoint(t: number, alvo = new Vector3()): Vector3 {
    const angulo = 2 * Math.PI * this.voltas * t;
    return alvo.set(this.raio * Math.cos(angulo), this.altura * (t - 0.5), -this.raio * Math.sin(angulo));
  }
}

/**
 * Fábrica de geometria por forma, com cache por forma + tamanho (+ pontos, em `tube`/`line`).
 *
 * As cópias de `rep`/`rad` chegam como peças iguais: elas dividem a mesma geometria na GPU. Quem
 * troca de objeto chama `descartar()`, que libera tudo de uma vez.
 */
export class FabricaDeGeometrias {
  private readonly cache = new Map<string, GeometriaDaPeca>();

  /** Multiplica os segmentos das formas curvas: 0.5 no perfil leve do celular. */
  constructor(public segmentos = 1) {}

  obter(peca: PecaHolograma): GeometriaDaPeca {
    const chave = `${this.segmentos}|${peca.forma}|${peca.tamanho.join(',')}|${peca.pontos?.flat().join(',') ?? ''}`;
    let geometria = this.cache.get(chave);
    if (!geometria) {
      geometria = criar(peca, this.segmentos);
      this.cache.set(chave, geometria);
    }
    return geometria;
  }

  descartar(): void {
    for (const { malha, contorno } of this.cache.values()) {
      malha?.dispose();
      contorno.dispose();
    }
    this.cache.clear();
  }
}

function criar({ forma, tamanho: s, pontos }: PecaHolograma, fator: number): GeometriaDaPeca {
  // Abaixo do piso a forma deixa de ler como curva.
  const n = (base: number, piso: number) => Math.max(piso, Math.round(base * fator));
  switch (forma) {
    case 'box':
      return comArestas(new BoxGeometry(s[0], s[1], s[2]), 1);
    case 'sph': {
      // Quadriláteros da esfera UV são planos: com 1° sobram paralelos e meridianos, sem diagonais.
      const molde = new SphereGeometry(s[0], 16, 10);
      const contorno = new EdgesGeometry(molde, 1);
      molde.dispose();
      return { malha: new SphereGeometry(s[0], n(32, 16), n(20, 10)), contorno };
    }
    case 'cyl':
      return comArestas(new CylinderGeometry(s[0], s[1], s[2], n(32, 12)), LIMIAR_CURVO);
    case 'cone':
      return comArestas(new ConeGeometry(s[0], s[1], n(32, 12)), LIMIAR_CURVO);
    case 'tor':
      return comArestas(new TorusGeometry(s[0], s[1], LADOS_DO_TUBO, n(72, 24)), LIMIAR_CURVO);
    case 'ring':
      return comArestas(new RingGeometry(s[0], s[1], n(72, 24)), 1);
    case 'cap':
      return comArestas(new CapsuleGeometry(s[0], s[1], n(6, 3), n(24, 12)), LIMIAR_CURVO);
    case 'tube': {
      const caminho = new CatmullRomCurve3((pontos ?? []).map((p) => new Vector3(...p)));
      const segmentos = n(Math.max(16, (pontos?.length ?? 2) * 12), 8);
      return comArestas(new TubeGeometry(caminho, segmentos, s[0], LADOS_DO_TUBO), LIMIAR_CURVO);
    }
    case 'helix': {
      const [raio, altura, voltas, espessura] = s as [number, number, number, number];
      const segmentos = n(Math.min(600, Math.max(48, Math.ceil(voltas * 64))), 32);
      return comArestas(new TubeGeometry(new CurvaHelice(raio, altura, voltas), segmentos, espessura, LADOS_DO_TUBO), LIMIAR_CURVO);
    }
    case 'line':
      return { malha: null, contorno: new BufferGeometry().setFromPoints((pontos ?? []).map((p) => new Vector3(...p))) };
  }
}

function comArestas(malha: BufferGeometry, limiar: number): GeometriaDaPeca {
  return { malha, contorno: new EdgesGeometry(malha, limiar) };
}
