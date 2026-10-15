import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JanelasService } from './janelas.service';
import type { ConteudoJanela } from './tela.modelos';

const conteudo: ConteudoJanela = { tipo: 'noticia', dados: { titulo: 'Notícia', tema: '', fonte: '', link: '', imagemUrl: '' } };
describe('JanelasService', () => {
  let janelas: JanelasService;
  const abrir = () => janelas.abrir(conteudo, { titulo: 'Notícia', origem: 'telegram' });
  beforeEach(() => { localStorage.clear(); janelas = TestBed.inject(JanelasService); });
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });
  it('a sétima minimiza a mais antiga, mesmo que ela tenha recebido foco depois', () => {
    const ids = Array.from({ length: 6 }, abrir);
    janelas.focar(ids[0]); abrir();
    expect(janelas.visiveis()).toHaveLength(6);
    expect(janelas.obter(ids[0])?.estado).toBe('minimizada');
  });
  it('seis fixadas recebem a próxima na bandeja e não permitem restaurar sem espaço', () => {
    Array.from({ length: 6 }, abrir).forEach(id => janelas.fixar(id));
    const id = abrir(); janelas.restaurar(id);
    expect(janelas.visiveis()).toHaveLength(6); expect(janelas.obter(id)?.estado).toBe('minimizada');
    janelas.minimizar(janelas.visiveis()[0].id); janelas.restaurar(id);
    expect(janelas.obter(id)?.estado).toBe('normal');
  });
  it('limpa preservando fixadas, mas fecharTudo fecha inclusive fixadas e minimizadas', () => {
    const fixada = abrir(); janelas.fixar(fixada); const outra = abrir(); janelas.minimizar(outra);
    janelas.limpar(); expect(janelas.janelas().map(j => j.id)).toEqual([fixada]);
    janelas.fecharTudo(); expect(janelas.janelas()).toEqual([]); expect(janelas.foco()).toBeNull();
  });
  it('contém arraste, resize, maximização e restauração dentro da área, inclusive após encolher', () => {
    const id = abrir(); janelas.mover(id, -100, 9999); janelas.redimensionar(id, 9999, 9999);
    janelas.definirArea(320, 240); janelas.maximizar(id); janelas.restaurar(id);
    const j = janelas.obter(id)!;
    expect(j.x).toBeGreaterThanOrEqual(0); expect(j.y).toBeGreaterThanOrEqual(0);
    expect(j.x + j.largura).toBeLessThanOrEqual(320); expect(j.y + j.altura).toBeLessThanOrEqual(240);
    janelas.mover(id, NaN, Infinity); expect(janelas.obter(id)).toEqual(j);
  });
  it('lembra geometria normal por tipo sem gravar a geometria maximizada', () => {
    const id = abrir(); janelas.mover(id, 25, 30); janelas.redimensionar(id, 400, 300); janelas.maximizar(id); janelas.fechar(id);
    expect(janelas.obter(abrir())).toMatchObject({ x: 25, y: 30, largura: 400, altura: 300 });
  });
  it('resiste a armazenamento corrompido ou bloqueado', () => {
    localStorage.setItem('jarvis-hud.janela.v1:noticia', '{'); expect(() => abrir()).not.toThrow();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    const id = abrir(); expect(() => janelas.mover(id, 10, 10)).not.toThrow();
  });
});
