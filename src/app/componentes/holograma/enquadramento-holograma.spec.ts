import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { calcularEnquadramento } from './enquadramento-holograma';

describe('enquadramento do holograma', () => {
  const caixas = [
    new Box3(new Vector3(-0.1, -0.1, -0.1), new Vector3(0.1, 0.1, 0.1)),
    new Box3(new Vector3(-30, -2, -2), new Vector3(30, 2, 2)),
    new Box3(new Vector3(8, -50, 3), new Vector3(12, 50, 7)),
    new Box3(new Vector3(-8, -5, -8), new Vector3(8, 8, 8)),
  ];

  for (const aspecto of [1920 / 900, 1060 / 700, 644 / 560, 390 / 500]) {
    it(`mantém todos os extremos visíveis, com margem e orientação, no aspecto ${aspecto}`, () => {
      const direcao = new Vector3(6.5, 3.5, 8.5).normalize();
      for (const caixa of caixas) {
        const quadro = calcularEnquadramento(caixa, aspecto, 45, direcao);
        const camera = new PerspectiveCamera(45, aspecto, 0.1, quadro.distancia * 4);
        camera.position.copy(quadro.posicao);
        camera.lookAt(quadro.alvo);
        camera.updateMatrixWorld();
        expect(camera.position.clone().sub(quadro.alvo).normalize().distanceTo(direcao)).toBeLessThan(1e-10);
        for (const x of [caixa.min.x, caixa.max.x]) {
          for (const y of [caixa.min.y, caixa.max.y]) {
            for (const z of [caixa.min.z, caixa.max.z]) {
              const projetado = new Vector3(x, y, z).project(camera);
              expect(Math.abs(projetado.x)).toBeLessThan(0.9);
              expect(Math.abs(projetado.y)).toBeLessThan(0.9);
              expect(projetado.z).toBeGreaterThan(-1);
              expect(projetado.z).toBeLessThan(1);
            }
          }
        }
      }
    });
  }

  it('afasta além do limite antigo para objetos grandes e mais ainda em retrato', () => {
    const caixa = caixas[1]!;
    const paisagem = calcularEnquadramento(caixa, 2, 45, new Vector3(0, 0, 1));
    const retrato = calcularEnquadramento(caixa, 0.5, 45, new Vector3(0, 0, 1));
    expect(paisagem.distancia).toBeGreaterThan(24);
    expect(retrato.distancia).toBeGreaterThan(paisagem.distancia);
  });
});
