import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardPesquisaComponent } from './card-pesquisa';
import type { DadosPesquisa } from '../../nucleo/tela.modelos';

const base = { categoria: 'Ciência', tema: 'Energia', referencia: 'Outubro de 2026', resumo: 'Resumo legível', consultadoEm: '2026-10-14T15:30:00-03:00', fontes: [{ nome: 'Fonte', url: 'https://example.com/' }] };
const layouts: DadosPesquisa[] = [
  { ...base, layout: 'ranking', itens: [{ posicao: 1, nome: 'Solar', detalhe: 'Detalhe', valor: 100, unidade: 'MW', etiqueta: 'Maior' }, { posicao: 2, nome: 'Eólica', detalhe: '', valor: 50, unidade: 'MW', etiqueta: '' }] },
  { ...base, layout: 'ficha', itens: [{ rotulo: 'Potência', valor: '100 MW' }] },
  { ...base, layout: 'lista', itens: [{ texto: 'Primeiro item' }] },
  { ...base, layout: 'linha_do_tempo', itens: [{ data: '2026', texto: 'Marco' }] },
  { ...base, layout: 'destaque', itens: [{ valor: '100', legenda: 'Megawatts' }] },
];
afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });
describe('pesquisa', () => {
  it.each(layouts)('renderiza $layout com resumo, fontes e horário', dados => {
    const f = TestBed.createComponent(CardPesquisaComponent); f.componentRef.setInput('dados', dados); f.componentRef.setInput('titulo', 'Energia em números'); f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Energia em números');
    expect(f.nativeElement.textContent).toContain('EM RESUMO'); expect(f.nativeElement.textContent).toContain('1 FONTES'); expect(f.nativeElement.textContent).toContain('CONSULTADO ÀS');
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    f.nativeElement.querySelector('footer button').click(); f.detectChanges(); f.nativeElement.querySelector('.fontes button').click();
    expect(abrir).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
    if (dados.layout === 'ranking') expect(f.nativeElement.querySelectorAll('.trilho span')[1].style.width).toBe('50%');
  });
  it('trata marcação como texto e desabilita URL executável', () => {
    const f = TestBed.createComponent(CardPesquisaComponent);
    f.componentRef.setInput('titulo', '<script>alert(1)</script>');
    f.componentRef.setInput('dados', { ...layouts[2], resumo: '<img src=x onerror=alert(1)>', fontes: [{ nome: 'Inválida', url: 'javascript:alert(1)' }] }); f.detectChanges();
    expect(f.nativeElement.querySelector('script,img')).toBeNull();
    expect(f.nativeElement.textContent).toContain('<img src=x onerror=alert(1)>');
    f.nativeElement.querySelector('footer button').click(); f.detectChanges(); expect(f.nativeElement.querySelector('.fontes button').disabled).toBe(true);
  });
});
