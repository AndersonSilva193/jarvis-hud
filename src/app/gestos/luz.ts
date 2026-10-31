/**
 * Pouca luz: o detector não acha a mão no escuro e, sem isso, a tela só diria "Sem mão" para sempre.
 *
 * A medida é o brilho médio de um quadro reduzido a {@link LADO_DA_AMOSTRA} (a câmera não sai do
 * navegador; a cópia de 32×24 é lida e descartada na hora). Só se mede **sem mão** à vista: com a mão
 * detectada a luz é suficiente por definição, e não há o que avisar.
 */

/** Largura e altura da amostra. Pouco pixel basta para uma média, e o `getImageData` fica barato. */
export const LADO_DA_AMOSTRA = { largura: 32, altura: 24 } as const;
/** Uma amostra por segundo: luz não muda em menos que isso. */
export const INTERVALO_DA_LUZ_MS = 1_000;
/** Brilho médio (0 a 255) abaixo do qual a mão some para o detector; e o de volta, com histerese. */
export const LIMIAR_ESCURO = 40;
export const LIMIAR_CLARO = 55;
/** Amostras seguidas no escuro antes de avisar: um vulto passando na frente da câmera não é noite. */
export const AMOSTRAS_PARA_AVISAR = 2;

export interface EstadoDaLuz {
  escuro: boolean;
  seguidas: number;
}

export const LUZ_INICIAL: EstadoDaLuz = { escuro: false, seguidas: 0 };

/** O brilho médio (luma Rec. 709) de um RGBA, de 0 a 255. */
export function brilhoMedio(rgba: ArrayLike<number>): number {
  let soma = 0;
  const pixels = Math.floor(rgba.length / 4);
  if (!pixels) return 0;
  for (let i = 0; i < pixels * 4; i += 4) soma += 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
  return soma / pixels;
}

/** O próximo estado depois de uma amostra: escurece depois de duas seguidas, clareia com folga. */
export function avaliarLuz(anterior: EstadoDaLuz, brilho: number): EstadoDaLuz {
  if (anterior.escuro) return brilho > LIMIAR_CLARO ? LUZ_INICIAL : anterior;
  if (brilho >= LIMIAR_ESCURO) return LUZ_INICIAL;
  const seguidas = anterior.seguidas + 1;
  return { escuro: seguidas >= AMOSTRAS_PARA_AVISAR, seguidas };
}
