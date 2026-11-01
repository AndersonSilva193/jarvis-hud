import { Box3, MathUtils, Sphere, Vector3 } from 'three';

/** Enquadra também em retrato, usando a menor abertura real da câmera. */
export function calcularEnquadramento(caixa: Box3, aspecto: number, fov: number, direcao: Vector3) {
  const esfera = caixa.getBoundingSphere(new Sphere());
  const vertical = MathUtils.degToRad(fov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * aspecto);
  const abertura = Math.min(vertical, horizontal);
  const distancia = Math.max(2.5, (esfera.radius / Math.sin(abertura)) * 1.12);
  return {
    alvo: esfera.center,
    posicao: esfera.center.clone().addScaledVector(direcao.clone().normalize(), distancia),
    distancia,
    raio: esfera.radius,
  };
}
