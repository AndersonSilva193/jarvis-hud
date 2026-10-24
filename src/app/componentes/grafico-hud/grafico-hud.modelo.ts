/**
 * A conta do gráfico do card de pesquisa, separada do componente porque é toda ela aritmética:
 * escala, posição de cada ponto e quais rótulos cabem. O componente só desenha o que sai daqui.
 *
 * Tudo em unidades de `viewBox`, nunca em pixels. O SVG tem proporção fixa e é esticado por CSS,
 * então estas coordenadas valem igual com a janela pequena ou maximizada — e, de quebra, a decisão
 * de pular rótulos do eixo X não precisa medir a tela (a janela minimizada é `display: none`,
 * justamente o caso em que medir não funcionaria).
 */

import type { Grafico, TipoGrafico } from '../../nucleo/tela.modelos';

/** A área do `viewBox`. A margem direita é larga para caber o valor escrito ao lado do ponto. */
export const AREA = { largura: 640, altura: 300 } as const;
const MARGEM = { topo: 18, direita: 56, baixo: 30, esquerda: 48 } as const;
const ESQUERDA = MARGEM.esquerda;
const DIREITA = AREA.largura - MARGEM.direita;
const TOPO = MARGEM.topo;
const BASE = AREA.altura - MARGEM.baixo;
const LARGURA = DIREITA - ESQUERDA;
const ALTURA = BASE - TOPO;

/** Quantos intervalos tentar primeiro no eixo Y; cai para menos até sobrarem no máximo 5 marcas. */
const INTERVALOS_ALVO = 4;
/** Passos que o olho lê como redondos, multiplicados por potências de dez. */
const MULTIPLOS = [1, 2, 2.5, 5] as const;
/** Largura de um caractere no mono do HUD, no tamanho usado nos rótulos do eixo X. */
const LARGURA_CARACTERE = 6.6;
const FOLGA_ROTULO = 10;
/** A fração da faixa de cada rótulo ocupada pelo grupo de barras. O resto é respiro. */
const OCUPACAO_DO_GRUPO = 0.68;

/** Teto de fatias da rosca: acima disso as menores viram uma fatia só, "Outros". */
const MAX_FATIAS = 6;
/** A fração do raio que fica vazada. É ela que faz anel em vez de pizza e abre o espaço do total. */
const FURO = 0.62;
/**
 * O anel: centrado na área, com o raio interno em número inteiro para o `d` sair limpo.
 * Exportado porque o componente escreve o total no centro e os testes conferem o furo.
 */
export const ROSCA = {
  centro: { x: AREA.largura / 2, y: AREA.altura / 2 },
  raio: 118,
  raioInterno: Math.round(118 * FURO),
} as const;
/** Respiro entre fatias, em radianos. Nunca come mais de um quarto do arco da fatia. */
const VAO_ANGULAR = 0.03;

export interface MarcaY {
  readonly valor: number;
  readonly rotulo: string;
  readonly y: number;
}

export interface EscalaY {
  readonly min: number;
  readonly max: number;
  readonly passo: number;
  readonly marcas: readonly MarcaY[];
}

export interface PontoGrafico {
  readonly serie: number;
  readonly indice: number;
  /** Centro do ponto (ou do topo da barra): é onde a dica se ancora. */
  readonly x: number;
  readonly y: number;
  readonly valor: number;
  readonly destacado: boolean;
  /** O rótulo da dica, quando não é o `eixoX[indice]`: só a fatia agregada da rosca usa. */
  readonly rotulo?: string;
}

export interface BarraGrafico extends PontoGrafico {
  readonly esquerda: number;
  readonly topo: number;
  readonly largura: number;
  readonly altura: number;
}

export interface FatiaRosca extends PontoGrafico {
  /** O caminho do segmento de anel. */
  readonly d: string;
  readonly rotulo: string;
  /** A parte do total, de 0 a 1. */
  readonly fracao: number;
  /** Quantas categorias a fatia resume: 1 na fatia comum, mais de 1 em "Outros". */
  readonly agregadas: number;
}

export interface RotuloX {
  readonly indice: number;
  readonly texto: string;
  readonly x: number;
}

export interface ValorEscrito extends PontoGrafico {
  readonly texto: string;
}

export interface Desenho {
  readonly tipo: TipoGrafico;
  /** Barras ou empilhadas: uma coluna por faixa do eixo X, e a escala parte do zero. */
  readonly colunas: boolean;
  /** Rosca: não há eixo nem grade para desenhar. */
  readonly rosca: boolean;
  readonly escala: EscalaY;
  /** O y da linha do zero, de onde as barras crescem. Só faz sentido em barras. */
  readonly yDoZero: number;
  readonly eixo: { readonly esquerda: number; readonly direita: number; readonly base: number };
  readonly caminhos: readonly { readonly serie: number; readonly d: string }[];
  readonly pontos: readonly PontoGrafico[];
  readonly barras: readonly BarraGrafico[];
  readonly fatias: readonly FatiaRosca[];
  /** Pontos, barras ou fatias, o que o gráfico usar: é por aqui que a dica acha a coordenada. */
  readonly marcas: readonly PontoGrafico[];
  /** A soma das séries em cada índice: a altura da coluna empilhada e a coluna "Total" da tabela. */
  readonly totais: readonly number[];
  /** O total do anel, já com a unidade. `null` fora da rosca. */
  readonly total: string | null;
  readonly rotulosX: readonly RotuloX[];
  /** Último ponto de cada linha mais o destaque, sem repetir. Vazio em barras sem destaque. */
  readonly valoresEscritos: readonly ValorEscrito[];
  /** Vazia com uma série só: aí o título do card já diz o que a linha é. Na rosca, as fatias. */
  readonly legenda: readonly { readonly serie: number; readonly nome: string }[];
}

export function numero(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** O número como ele aparece ao lado do ponto, na dica e no centro do anel. */
export function comUnidade(valor: number, unidade: string): string {
  return unidade ? `${numero(valor)} ${unidade}` : numero(valor);
}

/** O menor passo "redondo" que cobre `bruto`, na forma 1 / 2 / 2,5 / 5 × 10ⁿ. */
export function passoRedondo(bruto: number): number {
  if (!(bruto > 0)) return 1;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  for (const multiplo of MULTIPLOS) {
    if (bruto <= multiplo * potencia * (1 + 1e-9)) return multiplo * potencia;
  }
  return 10 * potencia;
}

/**
 * A escala do eixo Y com 3 a 5 marcas em números redondos.
 *
 * `doZero` é o que separa os dois gráficos: barras comparam área e precisam do zero na escala,
 * senão a diferença entre 23 e 31 parece quatro vezes maior do que é. A linha mostra variação,
 * então usa uma faixa justa em volta dos dados — é o que faz uma queda de 8 °C aparecer.
 */
export function escalaY(valores: readonly number[], doZero: boolean, unidade = ''): EscalaY {
  const finitos = valores.filter(v => Number.isFinite(v));
  let alto = finitos.length ? Math.max(...finitos) : 1;
  let baixo = finitos.length ? Math.min(...finitos) : 0;
  if (doZero) {
    alto = Math.max(alto, 0);
    baixo = Math.min(baixo, 0);
  }
  if (alto === baixo) {
    // Série constante: sem folga a escala teria altura zero e todo y viraria NaN.
    const folga = (Math.abs(alto) || 4) / 4;
    alto += folga;
    if (!doZero) baixo -= folga;
  }

  for (let intervalos = INTERVALOS_ALVO; intervalos >= 1; intervalos--) {
    const escala = montarEscala(baixo, alto, passoRedondo((alto - baixo) / intervalos), unidade);
    if (escala.marcas.length >= 3 && escala.marcas.length <= 5) return escala;
  }
  return montarEscala(baixo, alto, passoRedondo((alto - baixo) / INTERVALOS_ALVO), unidade);
}

function montarEscala(baixo: number, alto: number, passo: number, unidade: string): EscalaY {
  const min = arredondar(Math.floor(baixo / passo + 1e-9) * passo, passo);
  const max = arredondar(Math.ceil(alto / passo - 1e-9) * passo, passo);
  const quantas = Math.round((max - min) / passo) + 1;
  const marcas: MarcaY[] = [];
  for (let i = 0; i < quantas; i++) {
    const valor = arredondar(min + i * passo, passo);
    // A unidade aparece só na marca de cima: repetida em todas viraria ruído.
    const rotulo = i === quantas - 1 && unidade ? `${numero(valor)} ${unidade}` : numero(valor);
    marcas.push({ valor, rotulo, y: yNaEscala(valor, min, max) });
  }
  return { min, max, passo, marcas };
}

/** Tira o lixo de ponto flutuante de somas como 0,1 + 0,2 antes de virar rótulo. */
function arredondar(valor: number, passo: number): number {
  const casas = Math.max(0, Math.min(10, -Math.floor(Math.log10(passo)) + 1));
  return Number(valor.toFixed(casas));
}

function yNaEscala(valor: number, min: number, max: number): number {
  return TOPO + ALTURA * (1 - (valor - min) / (max - min));
}

/**
 * De quantos em quantos desenhar o rótulo do eixo X. Com 24 horas numa janela estreita os
 * rótulos encavalam; pular alguns é mais legível do que girar ou encolher o texto.
 */
export function passoDosRotulos(quantidade: number, larguraUtil: number, maiorRotulo: number): number {
  if (quantidade <= 1) return 1;
  const necessario = maiorRotulo * LARGURA_CARACTERE + FOLGA_ROTULO;
  const disponivel = larguraUtil / quantidade;
  return Math.max(1, Math.ceil(necessario / Math.max(disponivel, 1)));
}

/** Os índices do eixo X que recebem rótulo. O primeiro e o último entram sempre. */
export function indicesComRotulo(eixoX: readonly string[]): number[] {
  const ultimo = eixoX.length - 1;
  if (ultimo <= 0) return eixoX.length ? [0] : [];
  const passo = passoDosRotulos(eixoX.length, LARGURA, Math.max(...eixoX.map(r => r.length), 1));
  const indices: number[] = [];
  for (let i = 0; i <= ultimo; i += passo) indices.push(i);
  if (indices[indices.length - 1] !== ultimo) {
    // O último é obrigatório, mas não pode colar no anterior: nesse caso o anterior sai.
    if (ultimo - indices[indices.length - 1]! < passo) indices.pop();
    indices.push(ultimo);
  }
  return indices;
}

/** Um ponto do anel, já em coordenada do `viewBox`. */
function noAnel(raio: number, angulo: number): string {
  const x = ROSCA.centro.x + raio * Math.cos(angulo);
  const y = ROSCA.centro.y + raio * Math.sin(angulo);
  return `${x.toFixed(2)} ${y.toFixed(2)}`;
}

/**
 * Um segmento de anel: arco externo, corta para dentro, arco interno de volta, fecha. O caminho
 * nunca passa pelo centro — é isso que faz rosca em vez de pizza.
 *
 * Com uma fatia só o arco daria a volta inteira, e um `A` que começa onde termina não desenha
 * nada: nesse caso o anel sai em dois meios-arcos de cada raio, e o furo vem do `fill-rule`.
 */
function anel(de: number, ate: number): string {
  const { raio: re, raioInterno: ri } = ROSCA;
  if (ate - de >= 2 * Math.PI - 1e-9) {
    const meio = de + Math.PI;
    return (
      `M${noAnel(re, de)} A${re} ${re} 0 0 1 ${noAnel(re, meio)} A${re} ${re} 0 0 1 ${noAnel(re, de)} Z ` +
      `M${noAnel(ri, de)} A${ri} ${ri} 0 0 1 ${noAnel(ri, meio)} A${ri} ${ri} 0 0 1 ${noAnel(ri, de)} Z`
    );
  }
  const grande = ate - de > Math.PI ? 1 : 0;
  return (
    `M${noAnel(re, de)} A${re} ${re} 0 ${grande} 1 ${noAnel(re, ate)} ` +
    `L${noAnel(ri, ate)} A${ri} ${ri} 0 ${grande} 0 ${noAnel(ri, de)} Z`
  );
}

/**
 * As fatias do anel, no máximo `MAX_FATIAS`.
 *
 * As categorias vêm da única série, ordenadas da maior para a menor — é assim que o olho compara
 * ângulo. Passando do teto, as menores viram uma fatia "Outros", sempre a última: cortar a cauda
 * fora faria os ângulos não fecharem o total. A fatia agregada nunca é o destaque, porque ela não
 * é uma categoria do payload.
 */
function fatiasDaRosca(g: Grafico): FatiaRosca[] {
  const escolhidas = (g.series[0]?.valores ?? [])
    .map((valor, indice) => ({ indice, rotulo: g.eixoX[indice] ?? '', valor, agregadas: 1 }))
    // Valor zero não tem arco: sairia só como um risco na borda da fatia vizinha.
    .filter(c => c.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  if (escolhidas.length > MAX_FATIAS) {
    const cauda = escolhidas.slice(MAX_FATIAS - 1);
    escolhidas.length = MAX_FATIAS - 1;
    escolhidas.push({
      indice: -1,
      rotulo: 'Outros',
      valor: cauda.reduce((soma, c) => soma + c.valor, 0),
      agregadas: cauda.length,
    });
  }

  const total = escolhidas.reduce((soma, c) => soma + c.valor, 0);
  if (!(total > 0)) return [];

  const vao = escolhidas.length > 1 ? VAO_ANGULAR : 0;
  const raioMedio = (ROSCA.raio + ROSCA.raioInterno) / 2;
  // Começa no topo e corre no sentido do relógio, que é por onde o olho entra no anel.
  let inicio = -Math.PI / 2;

  return escolhidas.map(c => {
    const fracao = c.valor / total;
    const abertura = fracao * 2 * Math.PI;
    // O respiro nunca come mais de um quarto do arco: numa fatia fina ele a apagaria.
    const recuo = Math.min(vao, abertura / 4);
    const de = inicio + recuo / 2;
    const ate = inicio + abertura - recuo / 2;
    inicio += abertura;
    const meio = (de + ate) / 2;
    return {
      serie: 0,
      indice: c.indice,
      valor: c.valor,
      destacado: c.indice >= 0 && g.destaque?.serie === 0 && g.destaque?.indice === c.indice,
      rotulo: c.rotulo,
      fracao,
      agregadas: c.agregadas,
      d: anel(de, ate),
      x: ROSCA.centro.x + raioMedio * Math.cos(meio),
      y: ROSCA.centro.y + raioMedio * Math.sin(meio),
    };
  });
}

export function desenhar(g: Grafico): Desenho {
  const empilhado = g.tipo === 'barras_empilhadas';
  const colunas = g.tipo === 'barras' || empilhado;
  const rosca = g.tipo === 'rosca';
  const totais = g.eixoX.map((_, i) => g.series.reduce((soma, s) => soma + (s.valores[i] ?? 0), 0));
  // No empilhado é a coluna inteira que tem de caber no eixo, não o maior valor solto.
  const escala = escalaY(empilhado ? totais : g.series.flatMap(s => s.valores), colunas, g.unidade);
  const y = (valor: number) => yNaEscala(valor, escala.min, escala.max);
  const yDoZero = y(Math.min(Math.max(0, escala.min), escala.max));
  const quantos = g.eixoX.length;
  const destacado = (serie: number, indice: number) =>
    g.destaque?.serie === serie && g.destaque?.indice === indice;

  // Linha: pontos nas pontas da área. Colunas: um ponto no meio de cada faixa, para a barra caber.
  const faixa = LARGURA / Math.max(quantos, 1);
  const xDoIndice = (i: number) =>
    colunas
      ? ESQUERDA + faixa * (i + 0.5)
      : quantos === 1
        ? ESQUERDA + LARGURA / 2
        : ESQUERDA + (LARGURA * i) / (quantos - 1);

  const pontos: PontoGrafico[] = [];
  const barras: BarraGrafico[] = [];
  const larguraDoGrupo = faixa * OCUPACAO_DO_GRUPO;
  // Empilhado: uma coluna por faixa, e as séries se dividem na altura, não na largura.
  const larguraDaBarra = empilhado ? larguraDoGrupo : larguraDoGrupo / Math.max(g.series.length, 1);
  /** O quanto de cada coluna já foi empilhado: o próximo segmento nasce no topo do anterior. */
  const acumulado = g.eixoX.map(() => 0);

  g.series.forEach((serie, s) => {
    serie.valores.forEach((valor, i) => {
      const centro = xDoIndice(i);
      const alturaNaEscala = y(valor);
      if (empilhado) {
        // Segmento de valor zero sairia como um fio de 1 de altura colado na coluna.
        if (valor === 0) return;
        const base = acumulado[i]!;
        acumulado[i] = base + valor;
        const topo = y(base + valor);
        barras.push({
          serie: s,
          indice: i,
          valor,
          destacado: destacado(s, i),
          esquerda: centro - larguraDoGrupo / 2,
          largura: larguraDoGrupo,
          topo,
          altura: Math.max(y(base) - topo, 1),
          x: centro,
          y: topo,
        });
      } else if (g.tipo === 'barras') {
        const esquerda = centro - larguraDoGrupo / 2 + s * larguraDaBarra;
        const vao = Math.min(2, larguraDaBarra * 0.18);
        barras.push({
          serie: s,
          indice: i,
          valor,
          destacado: destacado(s, i),
          esquerda: esquerda + vao / 2,
          largura: Math.max(larguraDaBarra - vao, 1),
          topo: Math.min(alturaNaEscala, yDoZero),
          altura: Math.max(Math.abs(alturaNaEscala - yDoZero), 1),
          x: esquerda + larguraDaBarra / 2,
          y: Math.min(alturaNaEscala, yDoZero),
        });
      } else if (g.tipo === 'linha') {
        pontos.push({ serie: s, indice: i, valor, destacado: destacado(s, i), x: centro, y: alturaNaEscala });
      }
    });
  });

  const caminhos =
    g.tipo === 'linha'
      ? g.series.map((_, s) => ({
          serie: s,
          d: pontos
            .filter(p => p.serie === s)
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
            .join(' '),
        }))
      : [];

  const fatias = rosca ? fatiasDaRosca(g) : [];
  const marcas = rosca ? fatias : colunas ? barras : pontos;
  return {
    tipo: g.tipo,
    colunas,
    rosca,
    escala,
    yDoZero,
    eixo: { esquerda: ESQUERDA, direita: DIREITA, base: BASE },
    caminhos,
    pontos,
    barras,
    fatias,
    marcas,
    totais,
    total: rosca ? comUnidade(fatias.reduce((soma, f) => soma + f.valor, 0), g.unidade) : null,
    rotulosX: rosca
      ? []
      : indicesComRotulo(g.eixoX).map(i => ({ indice: i, texto: g.eixoX[i]!, x: xDoIndice(i) })),
    valoresEscritos: valoresEscritos(g, marcas),
    legenda: rosca
      ? fatias.map((f, i) => ({ serie: i, nome: f.rotulo }))
      : g.series.length > 1
        ? g.series.map((s, i) => ({ serie: i, nome: s.nome }))
        : [],
  };
}

/**
 * O que ganha o valor por escrito: o fim de cada linha (onde o olho para) e o destaque. Em barras
 * só o destaque — a altura já compara, e um número por barra encheria o gráfico de texto. Na rosca
 * nenhum: o texto cairia sobre o arco, e o total no centro mais a dica já dão os números.
 */
function valoresEscritos(g: Grafico, marcas: readonly PontoGrafico[]): ValorEscrito[] {
  if (g.tipo === 'rosca') return [];
  const escolhidas = new Map<string, PontoGrafico>();
  if (g.tipo === 'linha') {
    g.series.forEach((_, s) => {
      const daSerie = marcas.filter(p => p.serie === s);
      const ultimo = daSerie[daSerie.length - 1];
      if (ultimo) escolhidas.set(`${ultimo.serie}:${ultimo.indice}`, ultimo);
    });
  }
  const d = g.destaque;
  if (d) {
    const ponto = marcas.find(p => p.serie === d.serie && p.indice === d.indice);
    if (ponto) escolhidas.set(`${d.serie}:${d.indice}`, ponto);
  }
  return [...escolhidas.values()].map(p => ({ ...p, texto: comUnidade(p.valor, g.unidade) }));
}
