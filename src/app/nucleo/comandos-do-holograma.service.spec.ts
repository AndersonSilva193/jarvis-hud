import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { Relogio } from './animador';
import { ComandosDoHologramaService, type AlvoDaCena } from './comandos-do-holograma.service';
import { HologramaService } from './holograma.service';
import type { FimHolograma, PecaHolograma } from './holograma.modelos';
import { VozService } from './voz.service';

/** Um relógio que o teste empurra: cada `avancar` roda o quadro agendado. */
function relogioManual() {
  let agora = 0;
  let pendente: (() => void) | null = null;
  const relogio: Relogio = {
    agora: () => agora,
    quadro: (passo) => {
      pendente = passo;
      return () => { if (pendente === passo) pendente = null; };
    },
  };
  return {
    relogio,
    avancar(ms: number, passos = 6) {
      for (let i = 1; i <= passos; i++) {
        agora += ms / passos;
        const passo = pendente;
        pendente = null;
        passo?.();
      }
    },
  };
}

type CenaFalsa = Record<keyof AlvoDaCena, Mock>;

function cenaDeMentira(): CenaFalsa {
  const nomes = ['explodir', 'girarObjeto', 'vista', 'filtrar', 'selecionarPorId', 'limparSelecao', 'definirGiro',
    'resetar', 'centralizar', 'girar', 'lancarGiro', 'aproximar', 'apontar', 'selecionarEm', 'segurarAutoRotacao',
    'comecarInteracao', 'terminarInteracao'];
  return Object.fromEntries(nomes.map((n) => [n, vi.fn(() => null)])) as CenaFalsa;
}

function peca(id: string, grupo = 'pistoes'): PecaHolograma {
  return {
    id, nome: id, grupo, forma: 'box', posicao: [0, 0, 0], rotacao: [0, 0, 0], tamanho: [1, 1, 1],
    cor: '#38bdf8', explosao: null, opacidade: 1, contorno: true, pontos: null,
  };
}

/** O `HologramaService` só nos signals que o controle lê, e nos métodos que ele chama. */
function hologramaDeMentira() {
  const fase = signal<'vazio' | 'construindo' | 'pronto' | 'erro' | 'incompleto' | 'cancelado'>('vazio');
  const geracao = signal(0);
  const pecas = signal<readonly PecaHolograma[]>([]);
  const resumo = signal<FimHolograma | null>(null);
  const aberto = signal(false);
  return {
    fase, geracao, pecas, resumo, aberto,
    meta: signal(null), idGeracao: signal(''),
    construindo: computed(() => fase() === 'construindo'),
    gerar: vi.fn(async () => { aberto.set(true); geracao.update((g) => g + 1); pecas.set([]); fase.set('construindo'); }),
    abrir: vi.fn(() => aberto.set(true)),
    fechar: vi.fn(() => aberto.set(false)),
    cancelar: vi.fn(),
    abrirDaGaleria: vi.fn(async () => undefined),
    abrirDaGaleriaPorId: vi.fn(async () => { aberto.set(true); geracao.update((g) => g + 1); fase.set('construindo'); }),
    gerarDeNovo: vi.fn(async () => undefined),
  };
}

describe('ComandosDoHologramaService', () => {
  let servico: ComandosDoHologramaService;
  let holograma: ReturnType<typeof hologramaDeMentira>;
  let voz: { falar: ReturnType<typeof vi.fn> };
  let tempo: ReturnType<typeof relogioManual>;
  let cena: ReturnType<typeof cenaDeMentira>;

  beforeEach(() => {
    holograma = hologramaDeMentira();
    voz = { falar: vi.fn(async () => undefined) };
    TestBed.configureTestingModule({
      providers: [
        { provide: HologramaService, useValue: holograma },
        { provide: VozService, useValue: voz },
      ],
    });
    servico = TestBed.inject(ComandosDoHologramaService);
    servico.movimentoReduzido = () => false;
    servico.tocarSom = vi.fn();
    tempo = relogioManual();
    servico.usarRelogio(tempo.relogio);
    cena = cenaDeMentira();
    servico.conectar(cena as unknown as AlvoDaCena);
  });

  it('a voz anima até o fator em ~600 ms, com ease-in-out', () => {
    servico.explodir(0.8, true);
    expect(servico.explosao()).toBe(0);
    tempo.avancar(300);
    expect(servico.explosao()).toBeCloseTo(0.4, 5);
    tempo.avancar(300);
    expect(servico.explosao()).toBeCloseTo(0.8, 5);
    expect(cena.explodir).toHaveBeenLastCalledWith(0.8, true);
  });

  it('a mão continua do que a voz deixou: 0.8 mais a abertura que variou', () => {
    servico.explodir(0.8, true);
    tempo.avancar(600);
    servico.inicioDoGestoDeExplosao();
    servico.explodirPorGesto(0.3);
    expect(servico.explosao()).toBeCloseTo(0.8, 5);
    servico.explodirPorGesto(0.4);
    expect(servico.explosao()).toBeCloseTo(0.9, 5);
  });

  it('a voz no meio do gesto vence, e a mão segue do valor novo', () => {
    servico.inicioDoGestoDeExplosao();
    servico.explodirPorGesto(0.2);
    servico.explodirPorGesto(0.5);
    expect(servico.explosao()).toBeCloseTo(0.3, 5);

    servico.explodir(0.8, true);
    tempo.avancar(600);
    expect(servico.explosao()).toBeCloseTo(0.8, 5);
    servico.explodirPorGesto(0.6);
    expect(servico.explosao()).toBeCloseTo(0.9, 5);
  });

  it('a mão mexendo durante a animação da voz muda o destino, não corta a animação', () => {
    servico.inicioDoGestoDeExplosao();
    servico.explodirPorGesto(0.5);
    servico.explodir(0.6, true);
    tempo.avancar(300);
    servico.explodirPorGesto(0.6);
    tempo.avancar(300);
    expect(servico.explosao()).toBeCloseTo(0.7, 5);
  });

  it('"carrega o motor explodido": o carregar zera e a explosão que vem depois fica', () => {
    servico.explodir(0.5);
    servico.aplicar({ acao: 'carregar', rapido: false, objeto: 'motor V8', detalhe: 'normal', novo: false, falaPronto: '' });
    expect(holograma.gerar).toHaveBeenCalledWith('motor V8', 'normal', false, undefined);
    expect(servico.explosao()).toBe(0);
    servico.aplicar({ acao: 'explodir', rapido: false, fator: 0.8 });
    tempo.avancar(600);
    expect(servico.explosao()).toBeCloseTo(0.8, 5);
  });

  it('"abre o átomo da galeria": abre o item pelo id e não gera nada', () => {
    servico.explodir(0.6);
    servico.aplicar({ acao: 'abrir_galeria', rapido: false, id: 'exemplo_atomo', nome: 'Átomo de carbono' });
    expect(holograma.abrirDaGaleriaPorId).toHaveBeenCalledWith('exemplo_atomo');
    expect(holograma.gerar).not.toHaveBeenCalled();
    expect(servico.explosao()).toBe(0);
  });

  it('filtro e explosão pedidos antes da cena chegam a ela ao conectar', () => {
    servico.desconectar();
    servico.destacar({ grupos: ['pistoes'], pecas: [] });
    servico.explodir(0.4);
    const nova = cenaDeMentira();
    servico.conectar(nova as unknown as AlvoDaCena);
    expect(nova.filtrar).toHaveBeenCalledWith(expect.objectContaining({ destacados: { grupos: ['pistoes'], pecas: [] } }));
    expect(nova.explodir).toHaveBeenCalledWith(0.4, true);
  });

  it('esconder acumula e mostrar tudo limpa', () => {
    servico.esconder({ grupos: ['bloco'], pecas: [] });
    servico.esconder({ grupos: ['tampa'], pecas: [] });
    expect(servico.filtros().escondidos.grupos).toEqual(['bloco', 'tampa']);
    servico.mostrarTudo();
    expect(servico.filtros().escondidos.grupos).toEqual([]);
  });

  it('dois "gira 90" somam 180 graus no eixo', () => {
    servico.girarEixo('y', 90);
    servico.girarEixo('y', 90);
    tempo.avancar(600);
    const total = cena.girarObjeto.mock.calls.reduce((soma: number, chamada: unknown[]) => soma + (chamada[1] as number), 0);
    expect(total).toBeCloseTo(Math.PI, 5);
  });

  it('o caminho rápido toca o som; a voz não', () => {
    servico.aplicar({ acao: 'parar', rapido: true });
    servico.aplicar({ acao: 'parar', rapido: false });
    expect(servico.tocarSom).toHaveBeenCalledOnce();
    expect(cena.definirGiro).toHaveBeenLastCalledWith('parado', 1);
  });

  it('o fim de um carregar do Jarvis fala o molde com o número de peças; do cache, não', () => {
    servico.aplicar({ acao: 'carregar', rapido: false, objeto: 'motor V8', detalhe: 'normal', novo: false, falaPronto: 'Pronto: {n} peças.' });
    holograma.pecas.set([peca('a'), peca('b'), peca('c')]);
    holograma.resumo.set({ pecas: 3, avisos: 0, status: 'completo', origem: 'modelo' });
    holograma.fase.set('pronto');
    TestBed.tick();
    expect(voz.falar).toHaveBeenCalledWith('Pronto: 3 peças.');

    voz.falar.mockClear();
    servico.aplicar({ acao: 'carregar', rapido: false, objeto: 'DNA', detalhe: 'normal', novo: false, falaPronto: 'Pronto: {n} peças.' });
    holograma.resumo.set({ pecas: 3, avisos: 0, status: 'completo', origem: 'cache' });
    holograma.fase.set('pronto');
    TestBed.tick();
    expect(voz.falar).not.toHaveBeenCalled();
  });

  it('selecionar pega nome e grupo da peça e manda o id à cena', () => {
    holograma.pecas.set([peca('pistao_e_1')]);
    servico.selecionar('pistao_e_1');
    expect(servico.selecao()).toEqual({ id: 'pistao_e_1', nome: 'pistao_e_1', grupo: 'pistoes' });
    expect(cena.selecionarPorId).toHaveBeenCalledWith('pistao_e_1');
  });

  it('movimento reduzido pula direto ao valor', () => {
    servico.movimentoReduzido = () => true;
    servico.explodir(0.7, true);
    expect(servico.explosao()).toBeCloseTo(0.7, 5);
  });
});
