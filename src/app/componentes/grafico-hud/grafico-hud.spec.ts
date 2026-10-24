import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { Grafico } from '../../nucleo/tela.modelos';
import { GraficoHudComponent } from './grafico-hud';

const CLIMA: Grafico = {
  tipo: 'linha',
  eixoX: ['seg', 'ter', 'qua', 'qui'],
  series: [{ nome: 'Máxima', valores: [31, 29, 26, 23] }],
  unidade: '°C',
  destaque: { serie: 0, indice: 3 },
  origem: 'pesquisa',
};

const DUAS_SERIES: Grafico = {
  ...CLIMA,
  tipo: 'barras',
  series: [
    { nome: 'Máxima', valores: [31, 29, 26, 23] },
    { nome: 'Mínima', valores: [21, 20, 18, 15] },
  ],
  destaque: null,
};

const EMPILHADO: Grafico = {
  ...CLIMA,
  tipo: 'barras_empilhadas',
  series: [
    { nome: 'Solar', valores: [12, 18, 9, 0] },
    { nome: 'Eólica', valores: [8, 6, 11, 14] },
  ],
  unidade: 'GW',
  destaque: null,
};

const ANEL: Grafico = {
  tipo: 'rosca',
  eixoX: ['Android', 'iOS', 'Outros SO'],
  series: [{ nome: 'Participação', valores: [71, 27, 2] }],
  unidade: '%',
  destaque: null,
  origem: 'pesquisa',
};

const montar = (grafico: Grafico, titulo = 'A temperatura cai 8 °C até quinta') => {
  const f = TestBed.createComponent(GraficoHudComponent);
  f.componentRef.setInput('grafico', grafico);
  f.componentRef.setInput('titulo', titulo);
  f.detectChanges();
  return f;
};

afterEach(() => TestBed.resetTestingModule());

describe('o gráfico do HUD', () => {
  it('é um role="img" rotulado pelo título do card', () => {
    const svg = montar(CLIMA).nativeElement.querySelector('svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('A temperatura cai 8 °C até quinta');
  });

  it('mostra rótulo e valor exato ao passar no ponto, e some ao sair', () => {
    const f = montar(CLIMA);
    expect(f.nativeElement.querySelector('.dica')).toBeNull();

    f.nativeElement.querySelectorAll('.alvo')[2].dispatchEvent(new Event('pointerenter'));
    f.detectChanges();
    const dica = f.nativeElement.querySelector('.dica');
    expect(dica.textContent).toContain('qua');
    expect(dica.textContent).toContain('26 °C');
    // Uma série só: o nome dela não entra, o título já disse do que se trata.
    expect(dica.querySelector('.dica-serie')).toBeNull();

    f.nativeElement.querySelector('svg').dispatchEvent(new Event('pointerleave'));
    f.detectChanges();
    expect(f.nativeElement.querySelector('.dica')).toBeNull();
  });

  it('o toque numa barra abre a dica com a série e o valor daquela barra', () => {
    const f = montar(DUAS_SERIES);
    const barras = f.nativeElement.querySelectorAll('.barra');
    expect(barras).toHaveLength(8);

    barras[4].dispatchEvent(new Event('pointerdown'));
    f.detectChanges();
    const dica = f.nativeElement.querySelector('.dica');
    expect(dica.textContent).toContain('seg');
    expect(dica.querySelector('.dica-serie').textContent).toBe('Mínima');
    expect(dica.querySelector('strong').textContent).toBe('21 °C');
  });

  it('a legenda só aparece com mais de uma série', () => {
    expect(montar(CLIMA).nativeElement.querySelector('.legenda')).toBeNull();
    const itens = montar(DUAS_SERIES).nativeElement.querySelectorAll('.legenda li');
    expect([...itens].map((li: Element) => li.textContent?.trim())).toEqual(['Máxima', 'Mínima']);
  });

  it('a tabela oculta traz todos os valores, com o título por legenda', () => {
    const tabela = montar(DUAS_SERIES).nativeElement.querySelector('table.oculto');
    expect(tabela.querySelector('caption').textContent).toBe('A temperatura cai 8 °C até quinta');
    expect([...tabela.querySelectorAll('thead th')].map((t: Element) => t.textContent)).toEqual([
      'Rótulo', 'Máxima (°C)', 'Mínima (°C)',
    ]);
    const linhas = [...tabela.querySelectorAll('tbody tr')];
    expect(linhas).toHaveLength(4);
    expect(linhas.map((tr: Element) => [...tr.children].map(c => c.textContent))).toEqual([
      ['seg', '31', '21'], ['ter', '29', '20'], ['qua', '26', '18'], ['qui', '23', '15'],
    ]);
  });

  it('desenha o destaque e escreve o valor do fim da linha', () => {
    const f = montar(CLIMA);
    expect(f.nativeElement.querySelectorAll('.ponto.destacado')).toHaveLength(1);
    const valores = [...f.nativeElement.querySelectorAll('text.valor')];
    expect(valores.map((t: Element) => t.textContent)).toEqual(['23 °C']);
  });

  it('o viewBox é fixo, então o desenho acompanha a largura da janela sem distorcer', () => {
    const svg = montar(CLIMA).nativeElement.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 640 300');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });
});

describe('o gráfico de barras empilhadas', () => {
  it('o toque num segmento abre a dica com a série e o valor só daquele segmento', () => {
    const f = montar(EMPILHADO);
    const barras = f.nativeElement.querySelectorAll('.barra');
    // Sete, e não oito: o segmento de valor zero da quinta não é desenhado.
    expect(barras).toHaveLength(7);

    barras[3].dispatchEvent(new Event('pointerdown'));
    f.detectChanges();
    const dica = f.nativeElement.querySelector('.dica');
    expect(dica.textContent).toContain('seg');
    expect(dica.querySelector('.dica-serie').textContent).toBe('Eólica');
    expect(dica.querySelector('strong').textContent).toBe('8 GW');
  });

  it('a tabela oculta ganha a coluna do total da coluna empilhada', () => {
    const tabela = montar(EMPILHADO).nativeElement.querySelector('table.oculto');
    expect([...tabela.querySelectorAll('thead th')].map((t: Element) => t.textContent)).toEqual([
      'Rótulo', 'Solar (GW)', 'Eólica (GW)', 'Total (GW)',
    ]);
    const linhas = [...tabela.querySelectorAll('tbody tr')];
    expect(linhas.map((tr: Element) => [...tr.children].map(c => c.textContent))).toEqual([
      ['seg', '12', '8', '20'], ['ter', '18', '6', '24'], ['qua', '9', '11', '20'], ['qui', '0', '14', '14'],
    ]);
  });

  it('desenha grade e eixo como as barras agrupadas, e nenhuma fatia', () => {
    const f = montar(EMPILHADO);
    expect(f.nativeElement.querySelector('.grade')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.fatia')).toHaveLength(0);
    expect([...f.nativeElement.querySelectorAll('.legenda li')].map((li: Element) => li.textContent?.trim()))
      .toEqual(['Solar', 'Eólica']);
  });
});

describe('o gráfico de rosca', () => {
  it('desenha uma fatia por categoria, com o total no centro e sem eixo', () => {
    const f = montar(ANEL, 'Android tem 71% do mercado');
    expect(f.nativeElement.querySelectorAll('.fatia')).toHaveLength(3);
    expect(f.nativeElement.querySelector('.total-valor').textContent).toBe('100 %');
    expect(f.nativeElement.querySelector('.total-rotulo').textContent).toBe('total');
    // Sem eixo Y a grade não tem o que referenciar: o que compara é o ângulo.
    expect(f.nativeElement.querySelector('.grade')).toBeNull();
  });

  it('a fatia nunca fecha no centro: o caminho volta pelo raio interno', () => {
    const f = montar(ANEL);
    const caminhos = [...f.nativeElement.querySelectorAll('.fatia')].map((p: Element) => p.getAttribute('d') ?? '');
    expect(caminhos).toHaveLength(3);
    expect(caminhos.every(d => d.length > 0 && !d.includes('320.00 150.00'))).toBe(true);
  });

  it('a legenda nomeia a cor de cada fatia, da maior para a menor', () => {
    const itens = montar(ANEL).nativeElement.querySelectorAll('.legenda li');
    expect([...itens].map((li: Element) => li.textContent?.trim())).toEqual(['Android', 'iOS', 'Outros SO']);
  });

  it('a dica da fatia traz a categoria e o valor, e a participação quando a unidade não é %', () => {
    const f = montar(ANEL);
    f.nativeElement.querySelectorAll('.fatia')[0].dispatchEvent(new Event('pointerenter'));
    f.detectChanges();
    let dica = f.nativeElement.querySelector('.dica');
    expect(dica.querySelector('.dica-rotulo').textContent).toBe('Android');
    expect(dica.querySelector('strong').textContent).toBe('71 %');
    // Em %, dizer a participação seria escrever o mesmo número duas vezes.
    expect(dica.querySelector('.dica-serie')).toBeNull();

    const g = montar({ ...ANEL, unidade: 'GW' });
    g.nativeElement.querySelectorAll('.fatia')[1].dispatchEvent(new Event('pointerenter'));
    g.detectChanges();
    dica = g.nativeElement.querySelector('.dica');
    expect(dica.querySelector('.dica-rotulo').textContent).toBe('iOS');
    expect(dica.querySelector('strong').textContent).toBe('27 GW');
    expect(dica.querySelector('.dica-serie').textContent).toBe('27% do total');
  });

  it('a fatia "Outros" diz quantas categorias resume, e a tabela segue com todas', () => {
    const muitas: Grafico = {
      ...ANEL,
      eixoX: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      series: [{ nome: 'Fatia', valores: [40, 20, 10, 8, 6, 5, 4, 3, 2] }],
      unidade: '',
    };
    const f = montar(muitas);
    expect(f.nativeElement.querySelectorAll('.fatia')).toHaveLength(6);

    f.nativeElement.querySelectorAll('.fatia')[5].dispatchEvent(new Event('pointerdown'));
    f.detectChanges();
    const dica = f.nativeElement.querySelector('.dica');
    expect(dica.querySelector('.dica-rotulo').textContent).toBe('Outros');
    expect(dica.querySelector('.dica-serie').textContent).toBe('14,3% do total · 4 categorias');
    expect(dica.querySelector('strong').textContent).toBe('14');

    // O desenho agrega, a tabela não: quem lê por leitor de tela recebe as nove categorias.
    expect(f.nativeElement.querySelectorAll('table.oculto tbody tr')).toHaveLength(9);
  });

  it('a tabela oculta mantém a ordem do payload e fecha com o total no pé', () => {
    const tabela = montar(ANEL).nativeElement.querySelector('table.oculto');
    expect([...tabela.querySelectorAll('thead th')].map((t: Element) => t.textContent)).toEqual([
      'Rótulo', 'Participação (%)',
    ]);
    const linhas = [...tabela.querySelectorAll('tbody tr')];
    expect(linhas.map((tr: Element) => [...tr.children].map(c => c.textContent))).toEqual([
      ['Android', '71'], ['iOS', '27'], ['Outros SO', '2'],
    ]);
    expect([...tabela.querySelectorAll('tfoot tr th, tfoot tr td')].map((c: Element) => c.textContent))
      .toEqual(['Total', '100']);
  });
});
