import { describe, expect, it } from 'vitest';

import { aberturaDaMao } from './geometria-da-mao';
import { lerGravacaoDeGestos, type EventoDeGesto, type OpcoesDoMotor, type Ponto, type QuadroDeMaos } from './gestos.modelos';
import { MotorDeGestos } from './motor-de-gestos';
import {
  LUGAR_PADRAO,
  POSES,
  entreLugares,
  entrePoses,
  filmar,
  sintetizarMao,
  type Lugar,
  type Trecho,
} from './sintetizar-mao';
import pincaArrastarDireita from './fixtures/pinca-arrastar-direita.sintetico.json';

type EventoNoTempo = EventoDeGesto & { t: number };

const PERFIL_PC: Partial<OpcoesDoMotor> = { maosMax: 2, zoomPorProfundidade: false };
const PERFIL_LEVE: Partial<OpcoesDoMotor> = { maosMax: 1, zoomPorProfundidade: true };

function reproduzir(quadros: readonly QuadroDeMaos[], opcoes: Partial<OpcoesDoMotor> = PERFIL_PC): EventoNoTempo[] {
  const motor = new MotorDeGestos(opcoes);
  return quadros.flatMap((q) => motor.processar(q).map((e) => ({ ...e, t: q.t })));
}

function doTipo<T extends EventoDeGesto['tipo']>(eventos: EventoNoTempo[], tipo: T): (Extract<EventoDeGesto, { tipo: T }> & { t: number })[] {
  return eventos.filter((e) => e.tipo === tipo) as (Extract<EventoDeGesto, { tipo: T }> & { t: number })[];
}

function soma(eventos: EventoNoTempo[], campo: 'dx' | 'dy'): number {
  return doTipo(eventos, 'girar').reduce((s, e) => s + e[campo], 0);
}

/** A câmera é frontal e o motor espelha: o pulso andando para a esquerda da imagem é a mão indo para a direita da tela. */
const ESQUERDA_DA_IMAGEM: Lugar = { ...LUGAR_PADRAO, x: 0.35 };

const parada = (pose: Trecho['maos'][number]['pose'], ms: number, lugar: Lugar = LUGAR_PADRAO): Trecho => ({ ms, maos: [{ pose, lugar }] });
const semMao = (ms: number): Trecho => ({ ms, maos: [] });

describe('o motor de gestos', () => {
  describe('pinça e giro', () => {
    it('pinça arrastando gira para o lado da mão e solta com inércia no mesmo sentido', () => {
      const eventos = reproduzir(
        filmar([
          parada(POSES.pinca, 300),
          { ms: 400, maos: [{ pose: POSES.pinca, lugar: (k) => entreLugares(LUGAR_PADRAO, ESQUERDA_DA_IMAGEM, k) }] },
          parada(POSES.pincaSolta, 200, ESQUERDA_DA_IMAGEM),
        ]),
      );
      expect(eventos[0]?.tipo).toBe('maoPresente');
      expect(soma(eventos, 'dx')).toBeGreaterThan(0.1);
      expect(Math.abs(soma(eventos, 'dy'))).toBeLessThan(0.02);
      const soltou = doTipo(eventos, 'soltarGiro');
      expect(soltou).toHaveLength(1);
      expect(soltou[0]!.vx).toBeGreaterThan(0);
    });

    it('a pinça só vale depois de 150 ms estável', () => {
      const motor = new MotorDeGestos(PERFIL_PC);
      const quadros = filmar([parada(POSES.pincaSolta, 200), parada(POSES.pinca, 300)]);
      let entrouEm = -1;
      for (const q of quadros) {
        motor.processar(q);
        if (entrouEm < 0 && motor.estadoAtual === 'girando') entrouEm = q.t;
      }
      // A pinça começa aos 200 ms; o filtro leva ~120 ms para fechar um salto de 2,6 cm do polegar
      // (uma pinça de verdade fecha devagar assim), e aí contam os 150 ms.
      expect(entrouEm).toBeGreaterThanOrEqual(350);
      expect(entrouEm).toBeLessThan(500);
    });

    it('uma pinça de 90 ms não gira nada', () => {
      const eventos = reproduzir(
        filmar([
          parada(POSES.pincaSolta, 300),
          { ms: 90, maos: [{ pose: POSES.pinca, lugar: (k) => entreLugares(LUGAR_PADRAO, ESQUERDA_DA_IMAGEM, k) }] },
          parada(POSES.pincaSolta, 300, ESQUERDA_DA_IMAGEM),
        ]),
      );
      expect(doTipo(eventos, 'girar')).toHaveLength(0);
      expect(doTipo(eventos, 'soltarGiro')).toHaveLength(0);
    });

    it('a histerese: oscilar entre 0.06 e 0.07 não solta uma pinça nem entra numa', () => {
      // Com o tamanho da mão sintética (18,8 cm), 1,13 cm ≈ 0.06 e 1,32 cm ≈ 0.07.
      const oscilando = (i: number) => ({ ...POSES.pinca, folga: i % 2 ? 1.13 : 1.32 });
      const trecho = (ms: number): Trecho => ({ ms, maos: [{ pose: (k) => oscilando(Math.round(k * 30)), lugar: (k) => entreLugares(LUGAR_PADRAO, ESQUERDA_DA_IMAGEM, k) }] });

      const dentro = reproduzir(filmar([parada(POSES.pinca, 300), trecho(1000)]));
      expect(doTipo(dentro, 'soltarGiro')).toHaveLength(0);
      expect(soma(dentro, 'dx')).toBeGreaterThan(0.1);

      const fora = reproduzir(filmar([parada(POSES.pincaSolta, 300), trecho(1000)]));
      expect(doTipo(fora, 'girar')).toHaveLength(0);
    });

    it('a mão que some no meio do giro solta com inércia depois de 200 ms', () => {
      const eventos = reproduzir(
        filmar([
          parada(POSES.pinca, 300),
          { ms: 300, maos: [{ pose: POSES.pinca, lugar: (k) => entreLugares(LUGAR_PADRAO, ESQUERDA_DA_IMAGEM, k) }] },
          semMao(400),
        ]),
      );
      const soltou = doTipo(eventos, 'soltarGiro');
      expect(soltou).toHaveLength(1);
      expect(soltou[0]!.vx).toBeGreaterThan(0);
      const ultimaVista = doTipo(eventos, 'girar').at(-1)!.t;
      expect(soltou[0]!.t - ultimaVista).toBeGreaterThan(200);
      expect(soltou[0]!.t - ultimaVista).toBeLessThan(270);
    });

    it('o rótulo do MediaPipe trocando de lado no meio do giro não quebra o gesto', () => {
      const motor = new MotorDeGestos(PERFIL_PC);
      const quadros = filmar([
        parada(POSES.pinca, 300),
        { ms: 500, maos: [{ pose: POSES.pinca, lugar: (k) => entreLugares(LUGAR_PADRAO, ESQUERDA_DA_IMAGEM, k) }] },
      ]).map((q, i) => ({ ...q, maos: q.maos.map((m) => ({ ...m, lado: i % 3 ? 'Right' : 'Left' })) }));
      const eventos = quadros.flatMap((q) => motor.processar(q).map((e) => ({ ...e, t: q.t })));
      expect(doTipo(eventos, 'soltarGiro')).toHaveLength(0);
      expect(soma(eventos, 'dx')).toBeGreaterThan(0.1);
      expect(motor.estadoAtual).toBe('girando');
    });
  });

  describe('zoom', () => {
    it('no PC, pinça nas duas mãos afastando dá zoom proporcional à distância', () => {
      const a = (k: number): Lugar => ({ ...LUGAR_PADRAO, x: 0.38 - 0.1 * k });
      const b = (k: number): Lugar => ({ ...LUGAR_PADRAO, x: 0.62 + 0.1 * k });
      const eventos = reproduzir(
        filmar([
          { ms: 300, maos: [{ pose: POSES.pinca, lugar: a(0), lado: 'Right' }, { pose: POSES.pinca, lugar: b(0), lado: 'Left' }] },
          { ms: 500, maos: [{ pose: POSES.pinca, lugar: a, lado: 'Right' }, { pose: POSES.pinca, lugar: b, lado: 'Left' }] },
          { ms: 300, maos: [{ pose: POSES.pinca, lugar: a(1), lado: 'Right' }, { pose: POSES.pinca, lugar: b(1), lado: 'Left' }] },
        ]),
      );
      const total = doTipo(eventos, 'zoom').reduce((p, e) => p * e.fator, 1);
      // As pontas das pinças começam ~0.18 (corrigido) apart e terminam ~0.45: o produto conta isso.
      expect(total).toBeGreaterThan(1.5);
      expect(doTipo(eventos, 'girar')).toHaveLength(0);
    });

    it('no perfil leve, pinça e aproximar a mão da câmera dá zoom, sem girar', () => {
      const longe = LUGAR_PADRAO;
      const perto: Lugar = { ...LUGAR_PADRAO, escala: 1 / 42 };
      const eventos = reproduzir(
        filmar([
          parada(POSES.pinca, 300, longe),
          { ms: 600, maos: [{ pose: POSES.pinca, lugar: (k) => entreLugares(longe, perto, k) }] },
          parada(POSES.pinca, 200, perto),
        ]),
        PERFIL_LEVE,
      );
      const total = doTipo(eventos, 'zoom').reduce((p, e) => p * e.fator, 1);
      expect(total).toBeGreaterThan(1.25);
      expect(doTipo(eventos, 'girar')).toHaveLength(0);
    });

    it('no perfil leve, pinça arrastando ainda gira', () => {
      const eventos = reproduzir(
        filmar([
          parada(POSES.pinca, 300),
          { ms: 400, maos: [{ pose: POSES.pinca, lugar: (k) => entreLugares(LUGAR_PADRAO, ESQUERDA_DA_IMAGEM, k) }] },
          parada(POSES.pincaSolta, 200, ESQUERDA_DA_IMAGEM),
        ]),
        PERFIL_LEVE,
      );
      expect(soma(eventos, 'dx')).toBeGreaterThan(0.1);
      expect(doTipo(eventos, 'zoom')).toHaveLength(0);
    });

    it('no perfil leve a segunda mão é ignorada', () => {
      const eventos = reproduzir(
        filmar([{ ms: 600, maos: [{ pose: POSES.aberta }, { pose: POSES.pinca, lugar: { ...LUGAR_PADRAO, x: 0.2 } }] }]),
        PERFIL_LEVE,
      );
      expect(doTipo(eventos, 'zoom')).toHaveLength(0);
      expect(doTipo(eventos, 'girar')).toHaveLength(0);
    });
  });

  describe('explosão', () => {
    const meia = aberturaDaMao(
      sintetizarMao(POSES.meiaAberta).map((p): Ponto => [p[0] * (4 / 3), p[1], p[2] * (4 / 3)]),
    );

    it('mão aberta parada 0,6 s entra; os dedos controlam o fator; o punho trava sem resetar', () => {
      const eventos = reproduzir(
        filmar([
          parada(POSES.aberta, 1000),
          { ms: 300, maos: [{ pose: (k) => entrePoses(POSES.aberta, POSES.meiaAberta, k) }] },
          parada(POSES.meiaAberta, 500),
          { ms: 90, maos: [{ pose: (k) => entrePoses(POSES.meiaAberta, POSES.punho, k) }] },
          parada(POSES.punho, 2500),
        ]),
      );
      const inicio = doTipo(eventos, 'explosaoInicio');
      expect(inicio).toHaveLength(1);
      // 150 ms até a pose valer + 600 ms parada (+ a janela da palma parada).
      expect(inicio[0]!.t).toBeGreaterThanOrEqual(750);
      expect(inicio[0]!.t).toBeLessThan(1000);

      const fatores = doTipo(eventos, 'explosao').map((e) => e.fator);
      expect(fatores[0]).toBeGreaterThan(0.95);
      expect(Math.min(...fatores)).toBeLessThan(meia + 0.05);

      const fim = doTipo(eventos, 'explosaoFim');
      expect(fim).toHaveLength(1);
      expect(fim[0]!.fator).toBeCloseTo(meia, 1);
      expect(doTipo(eventos, 'resetar')).toHaveLength(0);
    });

    it('mão aberta andando não entra no modo explosão', () => {
      const eventos = reproduzir(
        filmar([
          {
            ms: 1500,
            maos: [{ pose: POSES.aberta, lugar: (k) => ({ ...LUGAR_PADRAO, x: 0.3 + 0.4 * k }) }],
          },
        ]),
      );
      expect(doTipo(eventos, 'explosaoInicio')).toHaveLength(0);
    });

    it('a mão que some no modo explosão trava o último fator depois de 1 s', () => {
      const eventos = reproduzir(filmar([parada(POSES.aberta, 1000), semMao(1500)]));
      const fim = doTipo(eventos, 'explosaoFim');
      expect(fim).toHaveLength(1);
      expect(fim[0]!.fator).toBeGreaterThan(0.95);
      expect(fim[0]!.t).toBeGreaterThan(1900);
    });
  });

  describe('apontar', () => {
    it('o cursor segue o indicador e, parado 0,8 s, seleciona uma vez só', () => {
      const outro: Lugar = { ...LUGAR_PADRAO, x: 0.4, y: 0.7 };
      const eventos = reproduzir(
        filmar([
          parada(POSES.apontar, 2000),
          { ms: 200, maos: [{ pose: POSES.apontar, lugar: (k) => entreLugares(LUGAR_PADRAO, outro, k) }] },
          parada(POSES.apontar, 1200, outro),
          parada(POSES.aberta, 300, outro),
        ]),
      );
      const cursores = doTipo(eventos, 'cursor');
      expect(cursores.length).toBeGreaterThan(50);
      for (const c of cursores) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThanOrEqual(1);
      }
      const selecoes = doTipo(eventos, 'apontarParado');
      expect(selecoes).toHaveLength(2);
      expect(selecoes[0]!.t).toBeGreaterThanOrEqual(950);
      expect(selecoes[0]!.t).toBeLessThan(1150);
      // A mão foi para a esquerda da imagem: na tela espelhada o cursor foi para a direita.
      expect(selecoes[1]!.x).toBeGreaterThan(selecoes[0]!.x);
      expect(doTipo(eventos, 'cursorFim')).toHaveLength(1);
    });
  });

  describe('punho', () => {
    it('punho fechado 1,2 s reseta uma vez, mesmo mantido', () => {
      const eventos = reproduzir(filmar([parada(POSES.punho, 3500)]));
      const resets = doTipo(eventos, 'resetar');
      expect(resets).toHaveLength(1);
      expect(resets[0]!.t).toBeGreaterThanOrEqual(1200);
      expect(resets[0]!.t).toBeLessThan(1300);
    });

    it('punho de 0,8 s não reseta', () => {
      const eventos = reproduzir(filmar([parada(POSES.punho, 800), parada(POSES.aberta, 300)]));
      expect(doTipo(eventos, 'resetar')).toHaveLength(0);
    });
  });

  describe('sem mão', () => {
    it('sem mão por 3 s devolve a rotação automática, uma vez', () => {
      const eventos = reproduzir(filmar([parada(POSES.aberta, 400), semMao(5000)]));
      expect(eventos[0]?.tipo).toBe('maoPresente');
      const auto = doTipo(eventos, 'autoRotacao');
      expect(auto).toHaveLength(1);
      // Conta do último quadro com mão (367 ms), não do primeiro sem.
      expect(auto[0]!.t).toBeGreaterThanOrEqual(367 + 3000);
      expect(auto[0]!.t).toBeLessThan(367 + 3040);
    });

    it('nunca ter visto mão não pede rotação automática (ela já está ligada)', () => {
      expect(doTipo(reproduzir(filmar([semMao(5000)])), 'autoRotacao')).toHaveLength(0);
    });

    it('o rótulo do gesto acompanha o estado', () => {
      const motor = new MotorDeGestos(PERFIL_PC);
      const nomes = filmar([parada(POSES.punho, 1500), semMao(500)])
        .flatMap((q) => motor.processar(q))
        .filter((e) => e.tipo === 'gesto')
        .map((e) => (e.tipo === 'gesto' ? e.nome : ''));
      expect(nomes).toEqual(['Mão', 'Resetando…', 'Punho', 'Sem mão']);
    });
  });

  describe('gravações', () => {
    // Uma linha por gravação: o "Gravar 5 s" dos ajustes gera o JSON; o nome diz o gesto, e
    // `espera` diz a sequência de eventos (em ordem, não necessariamente seguidos) que ela tem de dar.
    const GRAVACOES: { nome: string; json: unknown; opcoes: Partial<OpcoesDoMotor>; espera: EventoDeGesto['tipo'][]; giro?: 'direita' | 'esquerda' }[] = [
      { nome: 'pinca-arrastar-direita.sintetico', json: pincaArrastarDireita, opcoes: PERFIL_PC, espera: ['maoPresente', 'girar', 'soltarGiro'], giro: 'direita' },
    ];

    for (const g of GRAVACOES) {
      it(`${g.nome} dá ${g.espera.join(' → ')}`, () => {
        const gravacao = lerGravacaoDeGestos(g.json);
        expect(gravacao).not.toBeNull();
        const eventos = reproduzir(gravacao!.quadros, g.opcoes);
        let i = 0;
        for (const e of eventos) if (e.tipo === g.espera[i]) i++;
        expect(g.espera.slice(i)).toEqual([]);
        if (g.giro) expect(Math.sign(soma(eventos, 'dx'))).toBe(g.giro === 'direita' ? 1 : -1);
      });
    }

    it('o leitor recusa o que não é gravação', () => {
      expect(lerGravacaoDeGestos(null)).toBeNull();
      expect(lerGravacaoDeGestos({ versao: 2, quadros: [] })).toBeNull();
      expect(lerGravacaoDeGestos({ versao: 1, quadros: [{ t: 0, maos: [{ lado: 'Right', pontos: [[0, 0, 0]] }] }] })).toBeNull();
    });

    it('o mesmo arquivo sempre dá os mesmos eventos', () => {
      const quadros = lerGravacaoDeGestos(pincaArrastarDireita)!.quadros;
      expect(reproduzir(quadros)).toEqual(reproduzir(quadros));
    });
  });
});
