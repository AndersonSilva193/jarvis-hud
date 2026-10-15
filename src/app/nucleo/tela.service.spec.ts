import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelaService } from './tela.service';
import { ConversaService } from './conversa.service';
import { BriefingPlayerService } from './briefing-player.service';
import { VozService } from './voz.service';
import { MidiaService } from './midia.service';
import type { CardTela, ComandoTela } from './tela.modelos';

const noticia: CardTela = { id: 'c1', tipo: 'noticia', titulo: 'Uma notícia', origem: 'telegram', criadoEm: '2026-10-14T10:00:00Z', dados: { titulo: 'Uma notícia', tema: 'Ciência', fonte: '', link: '', imagemUrl: '' } };
describe('aplicação dos comandos de tela', () => {
  let tela: TelaService;
  const voz = { falando: signal(false), falar: vi.fn(async () => {}), parar: vi.fn() };
  const conversa = { cartao: signal(null), naTela: signal(false), resposta: signal(null), dispensar: vi.fn(), chatAberto: signal(false), ocupada: signal(false), mostrarBriefing: vi.fn() };
  const player = { atual: signal(null), selecionado: signal(null), parar: vi.fn(), fecharConsulta: vi.fn(), briefing: signal(null), blocos: signal([]), tocar: vi.fn() };
  const comando = (acao: ComandoTela['acao'], alvo = '', valor = '') => tela.executar({ acao, alvo, valor });
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear();
    TestBed.configureTestingModule({ providers: [{ provide: ConversaService, useValue: conversa }, { provide: BriefingPlayerService, useValue: player }, { provide: VozService, useValue: voz }] });
    tela = TestBed.inject(TelaService); tela.ativa.set(true);
  });
  afterEach(() => TestBed.resetTestingModule());
  it('abre cards do Telegram uma vez e preserva o id no estado', () => {
    tela.receber(noticia); tela.receber(noticia);
    expect(tela.janelas.janelas()).toHaveLength(1);
    expect(tela.estado().janelas[0]).toMatchObject({ id: 'c1', tipo: 'noticia', fixado: false, estado: 'normal', emFoco: true });
    comando('fechar', 'c1'); tela.receber(noticia); expect(tela.janelas.janelas()).toHaveLength(0);
  });
  it('aplica operações somente ao alvo, preservando as fixadas ao limpar', () => {
    tela.receber(noticia); tela.receber({ ...noticia, id: 'c2' });
    comando('fixar', 'c1'); comando('minimizar', 'c1');
    expect(tela.estado().janelas.find(j => j.id === 'c1')).toMatchObject({ estado: 'minimizado', fixado: true });
    comando('restaurar', 'c1'); comando('maximizar', 'c1'); expect(tela.janelas.obter('c1')?.estado).toBe('maximizada');
    comando('abrir_historico'); expect(tela.historicoAberto()).toBe(true);
    comando('limpar'); expect(tela.historicoAberto()).toBe(false); expect(tela.janelas.janelas().map(j => j.id)).toEqual(['c1']);
    expect(comando('fechar', 'inexistente')).toBe(false); comando('fechar_tudo'); expect(tela.janelas.janelas()).toHaveLength(0);
  });
  it('comandos locais confirmam pela voz sem iniciar conversa; frases maiores não casam', () => {
    tela.receber(noticia); expect(tela.rapido('Jarvis, limpa a tela')).toBe(true);
    expect(voz.falar).toHaveBeenCalledWith('Tela limpa.'); expect(tela.janelas.janelas()).toHaveLength(0);
    expect(tela.rapido('limpa a tela da minha casa')).toBe(false);
  });
  it('fecha por tipo somente quando há uma candidata', () => {
    const pesquisa = { ...noticia, tipo: 'pesquisa', dados: { categoria: '', tema: '', referencia: '', resumo: '', fontes: [], consultadoEm: '', layout: 'lista', itens: [] } } as const;
    tela.receber(pesquisa as unknown as CardTela); expect(tela.rapido('fecha a pesquisa')).toBe(true);
    tela.receber({ ...pesquisa, id: 'c2' } as unknown as CardTela); tela.receber({ ...pesquisa, id: 'c3' } as unknown as CardTela);
    expect(tela.rapido('fecha a pesquisa')).toBe(false);
  });
  it('resolve mídia focada ou única e recusa ambiguidade', () => {
    const midia = TestBed.inject(MidiaService), executar = vi.spyOn(midia, 'executar').mockReturnValue(true);
    const dados = { modo: 'video' as const, videoId: 'M7lc1UVf-VE', titulo: 'Vídeo', canal: '', miniatura: '', alternativas: [] };
    tela.receber({ ...noticia, tipo: 'video', dados }); expect(tela.rapido('pausa')).toBe(true);
    tela.receber({ ...noticia, id: 'c2', tipo: 'video', dados }); expect(tela.rapido('continua')).toBe(true);
    expect(executar).toHaveBeenLastCalledWith('c2', 'continuar', '');
    tela.receber({ ...noticia, id: 'c3' }); expect(tela.rapido('pausa')).toBe(false);
  });
});
