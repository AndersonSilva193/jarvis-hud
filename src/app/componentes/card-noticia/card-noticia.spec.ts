import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CardNoticiaComponent } from './card-noticia';
import type { ItemNoticia } from '../../nucleo/briefing.modelos';

function manchete(parcial: Partial<ItemNoticia> = {}): ItemNoticia {
  return {
    titulo: 'Primeira',
    tema: 'tecnologia',
    fonte: 'G1',
    link: 'https://g1.globo.com/1',
    imagemUrl: '',
    ...parcial,
  };
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('card de notícia', () => {
  it('oferece a fonte original quando o link é http(s)', () => {
    const tela = TestBed.createComponent(CardNoticiaComponent);
    tela.componentRef.setInput('dados', manchete());
    tela.detectChanges();

    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    const elo: HTMLButtonElement = tela.nativeElement.querySelector('.abrir-fonte');
    elo.click();
    expect(abrir).toHaveBeenCalledWith('https://g1.globo.com/1', '_blank', 'noopener,noreferrer');
  });

  it.each([
    ['javascript:alert(1)', 'esquema que executa script'],
    ['https://usuario:senha@g1.globo.com/1', 'credenciais embutidas na URL'],
    ['não é uma url', 'link que o feed mandou quebrado'],
  ])('recusa %s (%s)', (link) => {
    const tela = TestBed.createComponent(CardNoticiaComponent);
    tela.componentRef.setInput('dados', manchete({ link }));
    tela.detectChanges();

    expect(tela.nativeElement.querySelector('.abrir-fonte')).toBeNull();
  });

  it('sem imagem no feed, o card não tenta desenhar uma', () => {
    const tela = TestBed.createComponent(CardNoticiaComponent);
    tela.componentRef.setInput('dados', manchete({ imagemUrl: '' }));
    tela.detectChanges();

    expect(tela.componentInstance.comImagem()).toBe(false);
  });
});
