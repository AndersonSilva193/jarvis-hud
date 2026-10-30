import { Service, computed, inject, signal } from '@angular/core';

import { AjustesDeGestosService } from './ajustes-de-gestos.service';

export type PerfilDoAparelho = 'pc' | 'leve';

export interface ParametrosDoPerfil {
  camera: { largura: number; altura: number };
  deteccoesPorSegundo: number;
  maosMax: number;
  bloom: 'completo' | 'reduzido';
  pixelRatioMaximo: number;
  /** Multiplica os segmentos das geometrias curvas. */
  segmentos: number;
}

export const PARAMETROS_DO_PERFIL: Record<PerfilDoAparelho, ParametrosDoPerfil> = {
  pc: {
    camera: { largura: 640, altura: 480 },
    deteccoesPorSegundo: 30,
    maosMax: 2,
    bloom: 'completo',
    pixelRatioMaximo: 1.5,
    segmentos: 1,
  },
  leve: {
    camera: { largura: 480, altura: 360 },
    deteccoesPorSegundo: 15,
    maosMax: 1,
    bloom: 'reduzido',
    pixelRatioMaximo: 1,
    segmentos: 0.5,
  },
};

/** Acima disso, no menor lado, é notebook ou monitor com tela de toque: aguenta o perfil cheio. */
const MENOR_LADO_DO_LEVE = 1024;

/** Celular e tablet: o dedo é o ponteiro principal e a tela é pequena. */
export function detectarPerfil(ponteiroGrosso: boolean, menorLado: number): PerfilDoAparelho {
  return ponteiroGrosso && menorLado <= MENOR_LADO_DO_LEVE ? 'leve' : 'pc';
}

/**
 * Quanto o aparelho aguenta: câmera, detecções por segundo, mãos e o peso da cena. A detecção é
 * pelo aparelho; a escolha manual dos ajustes de gestos passa por cima.
 */
@Service()
export class PerfilDoAparelhoService {
  private readonly ajustes = inject(AjustesDeGestosService);

  readonly detectado = signal<PerfilDoAparelho>(detectar());
  /** O `/controle` força o leve enquanto está aberto, sem mexer na escolha guardada nos ajustes. */
  readonly forcado = signal<PerfilDoAparelho | null>(null);
  readonly perfil = computed<PerfilDoAparelho>(() => {
    const escolha = this.ajustes.ajustes().perfil;
    return this.forcado() ?? (escolha === 'auto' ? this.detectado() : escolha);
  });
  readonly parametros = computed(() => PARAMETROS_DO_PERFIL[this.perfil()]);
}

function detectar(): PerfilDoAparelho {
  if (typeof matchMedia !== 'function' || typeof screen === 'undefined') return 'pc';
  return detectarPerfil(matchMedia('(pointer: coarse)').matches, Math.min(screen.width, screen.height));
}
