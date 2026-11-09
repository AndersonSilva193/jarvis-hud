/** Quem o usuário pediu para pensar. AUTO deixa o servidor escolher a cada pedido. */
export type ModoIa = 'AUTO' | 'LOCAL' | 'CLAUDE';

/** Quem está pensando de fato agora — pode diferir do modo quando há fallback. */
export type ProvedorIa = 'local' | 'claude';

/** O corpo do GET /api/ia/modo e do evento SSE `ia.modo`. */
export interface EstadoModoIa {
  modo: ModoIa;
  provedorEfetivo: ProvedorIa;
  /** Já vem legível do servidor ("Qwen 9B", "Haiku"). */
  modelo: string;
  /** Presente só quando o servidor caiu para o outro provedor ("PC sem VRAM livre"). */
  motivoFallback: string | null;
}

export const MODOS_IA: readonly { modo: ModoIa; rotulo: string }[] = [
  { modo: 'AUTO', rotulo: 'Auto' },
  { modo: 'LOCAL', rotulo: 'Local' },
  { modo: 'CLAUDE', rotulo: 'Claude' },
];

const MODOS: readonly unknown[] = ['AUTO', 'LOCAL', 'CLAUDE'];
const PROVEDORES: readonly unknown[] = ['local', 'claude'];
const NOME_DO_PROVEDOR: Record<ProvedorIa, string> = { local: 'Local', claude: 'Claude' };

/** Confere o corpo antes de a HUD acreditar nele, como `lerCardTela` faz com o resto do SSE. */
export function lerModoIa(dados: unknown): EstadoModoIa | null {
  if (typeof dados !== 'object' || dados === null) return null;
  const v = dados as Record<string, unknown>;
  const { modo, provedorEfetivo, modelo, motivoFallback } = v;
  if (!MODOS.includes(modo) || !PROVEDORES.includes(provedorEfetivo)) return null;
  if (typeof modelo !== 'string') return null;
  if (motivoFallback !== undefined && motivoFallback !== null && typeof motivoFallback !== 'string') {
    return null;
  }
  const motivo = typeof motivoFallback === 'string' ? motivoFallback.trim() : '';
  return {
    modo: modo as ModoIa,
    provedorEfetivo: provedorEfetivo as ProvedorIa,
    modelo: modelo.trim(),
    motivoFallback: motivo || null,
  };
}

/** "Local · Qwen 9B", "Claude · Haiku" ou "Auto → Local": sempre o provedor que está pensando. */
export function rotuloModoIa(estado: EstadoModoIa): string {
  const provedor = NOME_DO_PROVEDOR[estado.provedorEfetivo];
  if (estado.modo === 'AUTO') return `Auto → ${provedor}`;
  return estado.modelo ? `${provedor} · ${estado.modelo}` : provedor;
}
