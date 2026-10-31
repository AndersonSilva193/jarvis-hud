import { Color, Matrix4, MeshBasicMaterial, LineBasicMaterial, Quaternion, ShaderLib, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { PecaHolograma } from '../../nucleo/holograma.modelos';
import { FabricaDeGeometrias } from './geometrias-holograma';
import { CAPACIDADE_DO_LOTE, LoteDaSerie, porInstancia } from './lote-instanciado';

const DENTE: PecaHolograma = {
  id: 'dente_1', nome: 'Dente', grupo: 'engrenagem', forma: 'box', posicao: [2, 0, 0], rotacao: [0, 0, 0],
  tamanho: [0.3, 0.2, 0.2], cor: '#fbbf24', explosao: [1, 0, 0], opacidade: 1, contorno: true, pontos: null, serie: 'dente_1',
};

/** O que o `onBeforeCompile` faria com o shader `basic` do Three.js instalado. */
function compilar(material: MeshBasicMaterial | LineBasicMaterial): { vertexShader: string; fragmentShader: string } {
  const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader as never, null as never);
  return shader;
}

describe('LoteDaSerie', () => {
  it('estende o shader basic do pacote instalado: os trechos substituídos existem', () => {
    const malha = compilar(porInstancia(new MeshBasicMaterial(), false));
    expect(malha.vertexShader).toContain('vCorDaInstancia = corDaInstancia;');
    expect(malha.vertexShader).toContain('#include <project_vertex>');
    expect(malha.fragmentShader).toContain('vec4( diffuse * vCorDaInstancia.rgb, opacity * vCorDaInstancia.a )');

    const contorno = compilar(porInstancia(new LineBasicMaterial(), true));
    expect(contorno.vertexShader).toContain('modelViewMatrix * matrizDaInstancia * vec4( transformed, 1.0 )');
    expect(contorno.vertexShader).not.toContain('#include <project_vertex>');
    expect(contorno.fragmentShader).toContain('opacity * vCorDaInstancia.a');
  });

  it('malha e contorno não dividem o programa compilado', () => {
    const malha = porInstancia(new MeshBasicMaterial(), false);
    const contorno = porInstancia(new LineBasicMaterial(), true);
    expect(malha.customProgramCacheKey()).not.toBe(contorno.customProgramCacheKey());
  });

  it('cada cópia tem matriz, cor e opacidade próprias, e a mesma matriz serve ao contorno', () => {
    const lote = new LoteDaSerie<string>(new FabricaDeGeometrias().obter(DENTE), 'box', true);
    expect(lote.acrescentar('a')).toBe(0);
    expect(lote.acrescentar('b')).toBe(1);
    expect(lote.malha.count).toBe(2);
    expect(lote.contorno?.geometry.instanceCount).toBe(2);
    expect(lote.contorno?.geometry.getAttribute('matrizDaInstancia')).toBe(lote.malha.instanceMatrix);

    const matriz = new Matrix4().compose(new Vector3(1, 2, 3), new Quaternion(), new Vector3(1, 1, 1));
    lote.colocar(1, matriz, new Color(1, 0.5, 0), 0.1, new Color(0, 1, 0), 0.7);
    const lida = new Matrix4();
    lote.malha.getMatrixAt(1, lida);
    expect(new Vector3().setFromMatrixPosition(lida).toArray()).toEqual([1, 2, 3]);
    const cor = lote.malha.geometry.getAttribute('corDaInstancia');
    expect([cor.getX(1), cor.getY(1), cor.getZ(1), cor.getW(1)]).toEqual([1, 0.5, 0, expect.closeTo(0.1, 5)]);
    expect(lote.contorno?.geometry.getAttribute('corDaInstancia').getW(1)).toBeCloseTo(0.7, 5);
    expect(lote.membros[1]).toBe('b');
  });

  it('a cópia escondida vira escala zero, e publicar invalida as caixas', () => {
    const lote = new LoteDaSerie<string>(new FabricaDeGeometrias().obter(DENTE), 'box', false);
    expect(lote.contorno).toBeNull();
    lote.acrescentar('a');
    lote.malha.computeBoundingBox();
    lote.colocar(0, null, new Color(), 1, new Color(), 1);
    lote.publicar();
    const lida = new Matrix4();
    lote.malha.getMatrixAt(0, lida);
    expect(lida.determinant()).toBe(0);
    expect(lote.malha.boundingBox).toBeNull();
    expect(lote.malha.instanceMatrix.version).toBeGreaterThan(0);
  });

  it('enche na capacidade de uma série do servidor', () => {
    const lote = new LoteDaSerie<number>(new FabricaDeGeometrias().obter(DENTE), 'box', true);
    for (let i = 0; i < CAPACIDADE_DO_LOTE; i++) lote.acrescentar(i);
    expect(lote.cheio).toBe(true);
  });
});
