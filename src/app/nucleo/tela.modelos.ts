import type { Bloco, ItemNoticia } from './briefing.modelos';
import type { RespostaConversa } from './conversa.modelos';

export interface FontePesquisa { nome: string; url: string }
export interface SerieGrafico { nome: string; valores: number[] }
export interface DestaqueGrafico { serie: number; indice: number }
export interface Grafico {
  tipo: 'linha' | 'barras';
  eixoX: string[];
  series: SerieGrafico[];
  unidade: string;
  /** O ponto que a pesquisa quer que o olho encontre primeiro, ou `null`. */
  destaque: DestaqueGrafico | null;
  origem: string;
}
export interface PosicaoPesquisa {
  posicao: number; nome: string; detalhe: string; valor: number | null; unidade: string; etiqueta: string;
}
interface BasePesquisa {
  categoria: string; tema: string; referencia: string; resumo: string;
  fontes: FontePesquisa[]; consultadoEm: string;
}
export type DadosPesquisa = BasePesquisa & (
  | { layout: 'ranking'; itens: PosicaoPesquisa[] }
  | { layout: 'ficha'; itens: { rotulo: string; valor: string }[] }
  | { layout: 'lista'; itens: { texto: string }[] }
  | { layout: 'linha_do_tempo'; itens: { data: string; texto: string }[] }
  | { layout: 'destaque'; itens: { valor: string; legenda: string }[] }
  | { layout: 'grafico'; itens: never[]; grafico: Grafico }
);
export interface AlternativaMidia { videoId: string; titulo: string; canal: string; miniatura: string }
export interface DadosMidia extends AlternativaMidia { modo: 'video' | 'musica'; alternativas: AlternativaMidia[] }
export interface DadosPagina { url: string; titulo: string; descricao: string; imagem: string; site: string; incorporavel: boolean }
export type ConteudoCard =
  | { tipo: 'pesquisa'; dados: DadosPesquisa }
  | { tipo: 'video' | 'musica'; dados: DadosMidia }
  | { tipo: 'pagina'; dados: DadosPagina }
  | { tipo: 'noticia'; dados: ItemNoticia };
export type CardTela = ConteudoCard & { id: string; titulo: string; origem: string; criadoEm: string };
export type ConteudoJanela = ConteudoCard
  | { tipo: 'briefing'; dados: Bloco }
  | { tipo: 'resposta'; dados: RespostaConversa };
export type TipoJanela = ConteudoJanela['tipo'];
export interface Geometria { x: number; y: number; largura: number; altura: number }
export interface Janela extends Geometria {
  id: string; tipo: TipoJanela; titulo: string; conteudo: ConteudoJanela; z: number;
  estado: 'normal' | 'minimizada' | 'maximizada'; fixada: boolean; origem: string; selo: string;
}
export const ACOES_TELA = ['limpar', 'fechar', 'fechar_tudo', 'minimizar', 'maximizar', 'restaurar',
  'focar', 'fixar', 'desafixar', 'abrir_historico', 'fechar_historico', 'mostrar_briefing',
  'repetir_briefing', 'abrir_noticia', 'pausar', 'continuar', 'volume_mais', 'volume_menos',
  'avancar', 'voltar'] as const;
export type AcaoTela = typeof ACOES_TELA[number];
export interface ComandoTela { acao: AcaoTela; alvo: string; valor: string }
export interface EstadoTela {
  janelas: { id: string; tipo: TipoJanela; titulo: string; estado: 'normal' | 'minimizado' | 'maximizado';
    fixado: boolean; emFoco: boolean; tocando: boolean }[];
  historicoAberto: boolean; briefingNaTela: boolean;
}

export function objeto(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function textos(v: Record<string, unknown>, campos: string[]): boolean { return campos.every(c => typeof v[c] === 'string'); }
export function videoIdValido(v: unknown): v is string { return typeof v === 'string' && /^[\w-]{11}$/.test(v); }
export function lerComandoTela(v: unknown): ComandoTela | null {
  if (!objeto(v) || !ACOES_TELA.some(a => a === v['acao'])) return null;
  if (v['alvo'] != null && typeof v['alvo'] !== 'string' || v['valor'] != null && typeof v['valor'] !== 'string') return null;
  return { acao: v['acao'] as AcaoTela, alvo: String(v['alvo'] ?? '').trim(), valor: String(v['valor'] ?? '').trim() };
}
function numeros(v: unknown, quantidade: number): v is number[] {
  return Array.isArray(v) && v.length === quantidade && v.every(n => typeof n === 'number' && Number.isFinite(n));
}
/** O bloco `grafico` vem solto no payload: sem esta conferência o SVG desenharia com `NaN`. */
function graficoValido(v: unknown): boolean {
  if (!objeto(v) || v['tipo'] !== 'linha' && v['tipo'] !== 'barras' || !textos(v, ['unidade', 'origem'])) return false;
  const eixoX = v['eixoX'];
  if (!Array.isArray(eixoX) || !eixoX.length || !eixoX.every(r => typeof r === 'string')) return false;
  const series = v['series'];
  if (!Array.isArray(series) || !series.length) return false;
  if (!series.every(s => objeto(s) && textos(s, ['nome']) && numeros(s['valores'], eixoX.length))) return false;
  const destaque = v['destaque'];
  if (destaque == null) return true;
  return objeto(destaque) && Number.isInteger(destaque['serie']) && Number.isInteger(destaque['indice'])
    && (destaque['serie'] as number) >= 0 && (destaque['serie'] as number) < series.length
    && (destaque['indice'] as number) >= 0 && (destaque['indice'] as number) < eixoX.length;
}
export function lerCardTela(v: unknown): CardTela | null {
  if (!objeto(v) || !textos(v, ['id', 'tipo', 'titulo', 'origem', 'criadoEm']) || !/^[\w-]{1,32}$/.test(String(v['id'])) || !String(v['titulo']).trim()) return null;
  const d = v['dados'];
  if (!objeto(d)) return null;
  let valido = false;
  switch (v['tipo']) {
    case 'noticia': valido = textos(d, ['titulo', 'tema', 'fonte', 'link', 'imagemUrl']); break;
    case 'pagina': valido = textos(d, ['url', 'titulo', 'descricao', 'imagem', 'site']) && typeof d['incorporavel'] === 'boolean'; break;
    case 'video': case 'musica':
      valido = textos(d, ['titulo', 'canal', 'miniatura']) && videoIdValido(d['videoId']) && d['modo'] === v['tipo'] && Array.isArray(d['alternativas']) && d['alternativas'].every(a => objeto(a) && textos(a, ['titulo', 'canal', 'miniatura']) && videoIdValido(a['videoId'])); break;
    case 'pesquisa': {
      if (!textos(d, ['categoria', 'tema', 'referencia', 'resumo', 'consultadoEm']) || !Array.isArray(d['fontes']) || !d['fontes'].every(f => objeto(f) && textos(f, ['nome', 'url'])) || !Array.isArray(d['itens'])) break;
      const campos: Record<string, string[]> = { ranking: ['nome', 'detalhe', 'unidade', 'etiqueta'], ficha: ['rotulo', 'valor'], lista: ['texto'], linha_do_tempo: ['data', 'texto'], destaque: ['valor', 'legenda'], grafico: [] };
      const layout = String(d['layout']);
      if (layout === 'grafico' && !graficoValido(d['grafico'])) break;
      valido = Object.hasOwn(campos, layout) && d['itens'].every(i => objeto(i) && textos(i, campos[layout]!) && (layout !== 'ranking' || (Number.isInteger(i['posicao']) && typeof i['posicao'] === 'number' && i['posicao'] > 0 && (i['valor'] === null || typeof i['valor'] === 'number' && Number.isFinite(i['valor'])))));
    }
  }
  // O discriminante e cada campo usado pelo template foram conferidos acima.
  return valido ? v as unknown as CardTela : null;
}
