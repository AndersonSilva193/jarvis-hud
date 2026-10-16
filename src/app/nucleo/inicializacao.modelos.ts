/** A apresentação que a API devolve quando a tela acende. */
export interface Introducao {
  /** O que o Jarvis fala, no máximo três frases. */
  texto: string;
  sitesOk: number;
  sitesTotal: number;
  climaOk: boolean;
  lembretesHoje: number;
  geradoEm: string;
}

/** Em que pé está uma linha da sequência de abertura. */
export type EstadoDaChecagem = 'pendente' | 'ok' | 'falhou';

/** Uma linha de "CONECTANDO AO SERVIDOR... OK". */
export interface LinhaDeChecagem {
  id: string;
  rotulo: string;
  estado: EstadoDaChecagem;
  /** O que aparece no lugar do OK — "3/3", por exemplo. */
  detalhe?: string;
}

/** Por onde a abertura está passando. */
export type FaseDaInicializacao = 'inativa' | 'animando' | 'falando' | 'pronta';

/**
 * O que o Jarvis diz quando a API não respondeu.
 *
 * A tela acabou de acender sozinha: ficar muda seria pior do que admitir que está sem servidor.
 */
export const FALA_DE_RESERVA =
  'Sistemas locais ativos, senhor. Sem conexão com o servidor no momento.';
