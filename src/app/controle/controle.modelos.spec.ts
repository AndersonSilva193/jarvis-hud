import { describe, expect, it, vi } from 'vitest';

import { ControleDeToque, type IntencaoDeToque } from '../componentes/holograma/controle-de-toque';
import { ControlePorGestos, type AlvoDoControle, type Sensibilidade } from '../componentes/holograma/controle-por-gestos';
import { ControleRemoto } from '../componentes/holograma/controle-remoto';
import type { EventoDeGesto } from '../gestos/gestos.modelos';
import { AgregadorDeEventos } from './agregador';
import {
  MAX_EVENTOS_POR_MENSAGEM,
  lerEvento,
  lerMensagemParaControle,
  lerMensagensParaHud,
  mensagemDoGesto,
  mensagemDoToque,
  urlDoCanal,
  type EventoDoControle,
} from './controle.modelos';

const SENSIBILIDADE: Sensibilidade = { giro: 1.5, zoom: 2, inverterX: true, inverterY: false };
const PECA = { nome: 'Pistão', grupo: 'pistoes' };

/** Uma cena de mentira e as saídas da view: o que foi chamado, em ordem, é o que se compara. */
function cenaDeMentira() {
  const alvo = {
    girar: vi.fn(),
    lancarGiro: vi.fn(),
    aproximar: vi.fn(),
    apontar: vi.fn(),
    selecionarEm: vi.fn(() => PECA),
    segurarAutoRotacao: vi.fn(),
    comecarInteracao: vi.fn(),
    terminarInteracao: vi.fn(),
  } satisfies AlvoDoControle;
  const saidas = { explodir: vi.fn(), resetar: vi.fn(), selecionou: vi.fn(), gesto: vi.fn() };
  const explodirMais = vi.fn();
  const gestos = new ControlePorGestos(alvo, saidas, () => SENSIBILIDADE);
  return { alvo, saidas, explodirMais, gestos, remoto: new ControleRemoto(alvo, gestos, explodirMais) };
}

type Cena = ReturnType<typeof cenaDeMentira>;

function chamadas(c: Cena) {
  const tudo: Record<string, unknown[][]> = {};
  for (const [nome, fn] of Object.entries({ ...c.alvo, ...c.saidas, explodirMais: c.explodirMais })) tudo[nome] = fn.mock.calls;
  return tudo;
}

/** O caminho inteiro do celular até a HUD, sem a rede: mensagem → JSON → leitura → cena, em lotes de 8. */
function peloCanal(c: Cena, mensagens: EventoDoControle[]): void {
  for (let i = 0; i < mensagens.length; i += MAX_EVENTOS_POR_MENSAGEM) {
    const lote = JSON.stringify(mensagens.slice(i, i + MAX_EVENTOS_POR_MENSAGEM));
    c.remoto.aplicar(lerMensagensParaHud(lote).filter((m): m is EventoDoControle => lerEvento(m) !== null));
  }
}

describe('o controle pelo celular faz o mesmo que o gesto local', () => {
  const sequencia: EventoDeGesto[] = [
    { tipo: 'maoPresente' },
    { tipo: 'gesto', nome: 'Pinça' },
    { tipo: 'girar', dx: 0.02, dy: -0.01 },
    { tipo: 'girar', dx: 0.03, dy: 0.005 },
    { tipo: 'soltarGiro', vx: 0.8, vy: -0.2 },
    { tipo: 'zoom', fator: 1.05 },
    { tipo: 'explosaoInicio' },
    { tipo: 'explosao', fator: 0.4 },
    { tipo: 'explosaoFim', fator: 0.6 },
    { tipo: 'cursor', x: 0.3, y: 0.6 },
    { tipo: 'apontarParado', x: 0.3, y: 0.6 },
    { tipo: 'cursorFim' },
    { tipo: 'resetar' },
    { tipo: 'autoRotacao' },
  ];

  it('câmera: cada evento do motor chega às mesmas chamadas da cena, com a sensibilidade do PC', () => {
    const local = cenaDeMentira();
    local.gestos.aplicar(sequencia);

    const remoto = cenaDeMentira();
    peloCanal(remoto, sequencia.map(mensagemDoGesto).filter((m) => m !== null));

    expect(chamadas(remoto)).toEqual(chamadas(local));
    expect(local.saidas.selecionou).toHaveBeenCalledWith(PECA);
  });

  it('o agregador funde os deltas, e a soma que chega à cena é a mesma', async () => {
    const enviados: (EventoDoControle | EventoDoControle[])[] = [];
    let agora = 0;
    const tarefas: (() => void)[] = [];
    const agregador = new AgregadorDeEventos((m) => enviados.push(m), { agora: () => agora, agendar: (fn) => tarefas.push(fn) });
    for (let i = 0; i < 10; i++) agregador.adicionar({ t: 'girar', dx: 0.01, dy: -0.002 });
    agora = 40;
    tarefas.shift()!();

    const local = cenaDeMentira();
    local.gestos.aplicar(Array.from({ length: 10 }, () => ({ tipo: 'girar', dx: 0.01, dy: -0.002 }) as const));
    const remoto = cenaDeMentira();
    peloCanal(remoto, enviados.flat());

    const soma = (calls: unknown[][]) => calls.reduce<[number, number]>((s, c) => [s[0] + (c[0] as number), s[1] + (c[1] as number)], [0, 0]);
    expect(enviados).toHaveLength(1);
    expect(soma(remoto.alvo.girar.mock.calls)[0]).toBeCloseTo(soma(local.alvo.girar.mock.calls)[0], 6);
    expect(soma(remoto.alvo.girar.mock.calls)[1]).toBeCloseTo(soma(local.alvo.girar.mock.calls)[1], 6);
  });

  it('touchpad: as intenções do reconhecedor chegam como as do toque local', () => {
    const altura = 800;
    const intencoes: IntencaoDeToque[] = [
      { tipo: 'inicio' },
      { tipo: 'girar', dx: 16, dy: -8 },
      { tipo: 'soltarGiro', vx: 400, vy: 0 },
      { tipo: 'fim' },
      { tipo: 'inicio' },
      { tipo: 'zoom', fator: 1.1 },
      { tipo: 'explodir', delta: 0.05 },
      { tipo: 'fim' },
    ];
    const local = cenaDeMentira();
    const host = {
      clientHeight: altura,
      clientWidth: 400,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as HTMLElement;
    const toque = new ControleDeToque(host, local.alvo, { explodirMais: local.explodirMais, resetar: local.saidas.resetar, selecionou: local.saidas.selecionou }, () => SENSIBILIDADE);
    (toque as unknown as { aplicar(i: IntencaoDeToque[]): void }).aplicar(intencoes);

    const remoto = cenaDeMentira();
    peloCanal(remoto, intencoes.map((i) => mensagemDoToque(i, altura)));

    expect(chamadas(remoto)).toEqual(chamadas(local));
  });

  it('sem cena no celular, o toque duplo reseta', () => {
    expect(mensagemDoToque({ tipo: 'toqueDuplo', x: 10, y: 10 }, 800)).toEqual({ t: 'resetar' });
  });

  it('selecionar sem cursor antes não seleciona nada, e a queda desfaz o que ficou aberto', () => {
    const c = cenaDeMentira();
    c.remoto.aplicar([{ t: 'selecionar' }, { t: 'toque', v: 1 }, { t: 'mao', v: 1 }]);
    expect(c.alvo.selecionarEm).not.toHaveBeenCalled();
    c.remoto.soltar();
    expect(c.alvo.apontar).toHaveBeenLastCalledWith(null);
    expect(c.alvo.segurarAutoRotacao).toHaveBeenLastCalledWith(false);
    expect(c.alvo.terminarInteracao).toHaveBeenCalledTimes(1);
  });
});

describe('a leitura do canal', () => {
  it('aceita objeto ou array e deixa de fora o evento torto', () => {
    expect(lerMensagensParaHud('{"t":"zoom","f":1.05}')).toEqual([{ t: 'zoom', f: 1.05 }]);
    expect(lerMensagensParaHud('[{"t":"cursor","x":0.4,"y":0.7},{"t":"voar"},{"t":"selecionar"}]')).toEqual([
      { t: 'cursor', x: 0.4, y: 0.7 },
      { t: 'selecionar' },
    ]);
    expect(lerMensagensParaHud('lixo')).toEqual([]);
    expect(lerMensagensParaHud('{"t":"girar","dx":5,"dy":0}')).toEqual([]);
    expect(lerMensagensParaHud('{"t":"controle","e":"conectado","retomada":"abc"}')).toEqual([
      { t: 'controle', e: 'conectado', retomada: 'abc' },
    ]);
    expect(lerMensagensParaHud('{"t":"par","codigo":"x","expira":300}')).toEqual([{ t: 'par', codigo: 'x', expira: 300 }]);
  });

  it('o celular só entende pareado, estado do PC e eco', () => {
    expect(lerMensagemParaControle('{"t":"pareado","retomada":"r"}')).toEqual({ t: 'pareado', retomada: 'r' });
    expect(lerMensagemParaControle('{"t":"hud","e":"caiu"}')).toEqual({ t: 'hud', e: 'caiu' });
    expect(lerMensagemParaControle('{"t":"eco","n":3}')).toEqual({ t: 'eco', n: 3 });
    expect(lerMensagemParaControle('{"t":"girar","dx":0,"dy":0}')).toBeNull();
  });

  it('a URL do canal troca o esquema e leva a credencial na query', () => {
    expect(urlDoCanal('https://jarvis.exemplo.store/', { par: 'a_b-c' })).toBe('wss://jarvis.exemplo.store/ws/holograma?par=a_b-c');
    expect(urlDoCanal('http://localhost:8090', { bilhete: 'x', retomada: 'y' })).toBe(
      'ws://localhost:8090/ws/holograma?bilhete=x&retomada=y',
    );
  });

  it('o rótulo longo do gesto é cortado antes de sair', () => {
    expect(mensagemDoGesto({ tipo: 'gesto', nome: 'x'.repeat(40) })).toEqual({ t: 'gesto', n: 'x'.repeat(24) });
    expect(mensagemDoGesto({ tipo: 'explosaoInicio' })).toBeNull();
  });
});
