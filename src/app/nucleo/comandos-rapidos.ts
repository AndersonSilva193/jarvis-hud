import type { AcaoTela, TipoJanela } from './tela.modelos';

export interface ComandoRapido { acao: AcaoTela; tipo?: TipoJanela; fala: string }
export function normalizarComando(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/^jarvis\b[\s,.:;!?-]*/, '').replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '').replace(/\s+/g, ' ');
}
/** Somente frases completas: prefixos parecidos continuam sendo pedidos ao Jarvis. */
export function reconhecerComandoRapido(texto: string): ComandoRapido | null {
  const frase = normalizarComando(texto);
  const comandos: Record<string, ComandoRapido> = {
    'limpa a tela': { acao: 'limpar', fala: 'Tela limpa.' },
    'fecha tudo': { acao: 'fechar_tudo', fala: 'Janelas fechadas.' },
    'abre o historico': { acao: 'abrir_historico', fala: 'Histórico aberto.' },
    'fecha o historico': { acao: 'fechar_historico', fala: 'Histórico fechado.' },
    'pausa': { acao: 'pausar', fala: 'Pausado.' },
    'continua': { acao: 'continuar', fala: 'Continuando.' },
    'aumenta o volume': { acao: 'volume_mais', fala: 'Volume aumentado.' },
    'abaixa o volume': { acao: 'volume_menos', fala: 'Volume reduzido.' },
    'fecha o video': { acao: 'fechar', tipo: 'video', fala: 'Vídeo fechado.' },
    'fecha a musica': { acao: 'fechar', tipo: 'musica', fala: 'Música fechada.' },
    'fecha a pesquisa': { acao: 'fechar', tipo: 'pesquisa', fala: 'Pesquisa fechada.' },
  };
  return Object.hasOwn(comandos, frase) ? comandos[frase]! : null;
}
