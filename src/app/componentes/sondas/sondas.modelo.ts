/**
 * As quatro sondas em volta do orbe: o caminho de um pedido falado, no sentido horário.
 *
 *   entrada de áudio → transcrição → processamento → síntese de voz
 *
 * Cada uma acende quando a sua etapa está acontecendo de verdade. Nada aqui é decorativo: o
 * texto pequeno embaixo do título é o estado real (microfone, ditado, ferramenta, provedor de voz).
 */

export type EstadoDasSondas = 'ocioso' | 'ouvindo' | 'gerando' | 'pensando' | 'falando';

export interface EntradaDasSondas {
  readonly estado: EstadoDasSondas;
  readonly escutaDisponivel: boolean;
  readonly escutaLigada: boolean;
  readonly ditando: boolean;
  /** O que a ferramenta em curso informou, ex. "Consultando status do servidor". */
  readonly progresso: string;
  /** O rótulo da cota de voz, ex. "VOZ: ELEVENLABS 62%" ou "VOZ: NAVEGADOR (cota)". */
  readonly rotuloVoz: string;
}

export type IconeSonda = 'onda' | 'documento' | 'brilho' | 'alto-falante';

export interface Sonda {
  readonly id: 'entrada' | 'transcricao' | 'processamento' | 'voz';
  readonly titulo: string;
  readonly detalhe: string;
  readonly ativa: boolean;
  readonly icone: IconeSonda;
  readonly lado: 'esquerda' | 'direita';
  /**
   * Geometria em % do quadrado do orbe (0–100, centro em 50/50). `x`/`y` é a ponta do fio no
   * card; o fio anda na horizontal até `cotovelo` e desce em diagonal até `alvo`, que fica
   * logo fora dos arcos segmentados do reator.
   */
  readonly x: number;
  readonly y: number;
  readonly cotovelo: number;
  readonly alvo: readonly [number, number];
}

/** Raio, em fração do lado, onde os fios tocam o reator: logo fora da coroa segmentada. */
const RAIO_DOS_FIOS = 0.335;

function pontoNoAro(graus: number): readonly [number, number] {
  const a = (graus * Math.PI) / 180;
  const arredondar = (n: number) => Math.round(n * 10) / 10;
  return [
    arredondar(50 + Math.cos(a) * RAIO_DOS_FIOS * 100),
    arredondar(50 + Math.sin(a) * RAIO_DOS_FIOS * 100),
  ];
}

export function descreverSondas(e: EntradaDasSondas): Sonda[] {
  const trabalhando = e.estado === 'pensando' || e.estado === 'gerando';
  return [
    {
      id: 'entrada',
      titulo: 'Entrada de áudio',
      detalhe: !e.escutaDisponivel
        ? 'Sem suporte'
        : e.estado === 'ouvindo'
          ? 'Captando'
          : e.escutaLigada
            ? 'Em espera'
            : 'Microfone desligado',
      ativa: e.estado === 'ouvindo',
      icone: 'onda',
      lado: 'esquerda',
      x: 4,
      y: 24,
      cotovelo: 15,
      alvo: pontoNoAro(-140),
    },
    {
      id: 'transcricao',
      titulo: 'Transcrição',
      detalhe: e.ditando ? 'Ditado em curso' : 'Fala → texto',
      ativa: e.ditando,
      icone: 'documento',
      lado: 'direita',
      x: 96,
      y: 20,
      cotovelo: 86,
      alvo: pontoNoAro(-35),
    },
    {
      id: 'processamento',
      titulo: 'Processamento',
      detalhe:
        e.estado === 'gerando'
          ? 'Montando briefing'
          : trabalhando
            ? encurtar(e.progresso) || 'Pensando'
            : 'Claude · ferramentas',
      ativa: trabalhando,
      icone: 'brilho',
      lado: 'direita',
      x: 96,
      y: 76,
      cotovelo: 86,
      alvo: pontoNoAro(30),
    },
    {
      id: 'voz',
      titulo: 'Síntese de voz',
      detalhe: e.estado === 'falando' ? 'Falando' : provedorDaVoz(e.rotuloVoz),
      ativa: e.estado === 'falando',
      icone: 'alto-falante',
      lado: 'esquerda',
      x: 4,
      y: 78,
      cotovelo: 14,
      alvo: pontoNoAro(150),
    },
  ];
}

/** "VOZ: ELEVENLABS 62%" → "ElevenLabs 62%"; sem cota conhecida, só "Pronta". */
export function provedorDaVoz(rotulo: string): string {
  const resto = rotulo.replace(/^VOZ:\s*/i, '').trim();
  if (!resto) return 'Pronta';
  return resto.replace(/^ELEVENLABS/i, 'ElevenLabs').replace(/^NAVEGADOR/i, 'Navegador');
}

/** O card é estreito: o progresso de ferramenta passa de duas palavras com frequência. */
function encurtar(texto: string, limite = 28): string {
  const limpo = texto.trim();
  return limpo.length > limite ? limpo.slice(0, limite - 1).trimEnd() + '…' : limpo;
}
