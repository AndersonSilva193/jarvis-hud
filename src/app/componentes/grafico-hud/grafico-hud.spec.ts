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
