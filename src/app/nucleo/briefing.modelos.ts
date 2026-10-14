/**
 * O briefing exatamente como a API do Jarvis entrega (dev.jarvis.web.BriefingDto).
 *
 * Cada seção vem nas duas formas: `conteudo` em prosa (é o que o Jarvis fala) e `dados`
 * estruturado (é o que a tela desenha). Não existe campo de tipo dentro de `dados`: quem
 * discrimina é o `titulo`, em minúsculas. Seção que falhou vem com `dados` nulo.
 */
export interface Briefing {
  /** ISO-8601 com offset, ex. "2026-10-13T08:00:00-03:00". */
  geradoEm: string;
  fusoHorario?: string;
  nomeUsuario: string;
  secoes: Secao[];
  /** O cumprimento narrado pelo Jarvis. Vazio quando a narração falhou. */
  abertura?: string;
  /**
   * As observações do fim da narração, que a HUD só fala se o usuário pedir. Opcional porque um
   * backend anterior a esta versão não manda o campo; aí a pergunta nem é feita.
   */
  encerramento?: string;
  /** A narração inteira, do jeito que vai para o Telegram. */
  texto: string;
  /** false quando a API reaproveitou um briefing de menos de 60 s. */
  geradoAgora: boolean;
}

export interface Secao {
  titulo: string;
  conteudo: string;
  dados: DadosSecao | null;
  /**
   * O mesmo conteudo narrado pelo Jarvis — é o que a HUD fala. Opcional porque um backend
   * anterior a esta versão não manda o campo; aí a fala volta a ser o `conteudo`.
   */
  fala?: string;
}

/** Os quatro títulos que a API manda, sempre nesta ordem. */
export const TITULO_CLIMA = 'clima';
export const TITULO_LEMBRETES = 'lembretes de hoje';
export const TITULO_SISTEMAS = 'sistemas';
export const TITULO_NOTICIAS = 'notícias';

export type DadosSecao = DadosClima | DadosLembretes | DadosNoticias | DadosSistemas;

export interface DadosClima {
  cidade: string;
  /** Graus inteiros, já arredondados pela API para não divergir da fala. */
  temperaturaAtual: number;
  minima: number;
  maxima: number;
  chanceChuvaPct: number;
  descricao: string;
}

export interface DadosLembretes {
  itens: ItemLembrete[];
}

export interface ItemLembrete {
  /** HH:mm no fuso configurado no servidor. */
  hora: string;
  texto: string;
}

export interface DadosNoticias {
  itens: ItemNoticia[];
}

export interface ItemNoticia {
  titulo: string;
  tema: string;
  fonte: string;
  link: string;
  /** Vazio quando o feed não trouxe foto: o card cai no painel sem imagem. */
  imagemUrl: string;
}

export interface DadosSistemas {
  sites: ItemSite[];
  servidor: string;
}

export interface ItemSite {
  nome: string;
  resultado: string;
}

/**
 * Um pedaço do briefing na fila de reprodução: o que a tela mostra e o que a voz lê.
 *
 * A seção de notícias virá como vários blocos (um card por manchete), então a fila não é
 * um espelho de `secoes`.
 */
export type Bloco =
  | { id: string; tipo: 'abertura'; rotulo: string; fala: string; linhas: string[] }
  | { id: string; tipo: 'clima'; rotulo: string; fala: string; dados: DadosClima }
  | { id: string; tipo: 'lembretes'; rotulo: string; fala: string; dados: DadosLembretes }
  | { id: string; tipo: 'sistemas'; rotulo: string; fala: string; dados: DadosSistemas }
  | { id: string; tipo: 'noticia'; rotulo: string; fala: string; dados: ItemNoticia }
  | { id: string; tipo: 'texto'; rotulo: string; fala: string; linhas: string[] };

export type TipoBloco = Bloco['tipo'];
