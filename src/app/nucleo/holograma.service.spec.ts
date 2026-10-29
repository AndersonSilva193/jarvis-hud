import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroDoStreamHolograma, HologramaStreamService, type OuvintesDoHolograma } from './holograma-stream.service';
import { HologramaService } from './holograma.service';
import type { PecaHolograma } from './holograma.modelos';

const PECA: PecaHolograma = {
  id: 'cubo', nome: 'Cubo', grupo: 'corpo', forma: 'box', posicao: [0, 0, 0], rotacao: [0, 0, 0],
  tamanho: [1, 1, 1], cor: '#38bdf8', explosao: [0, 1, 0], opacidade: 1, contorno: true, pontos: null,
};

/** Um stream que o teste conduz passo a passo: os ouvintes ficam expostos, e o fim é uma promessa. */
function streamControlado() {
  let ouvintes!: OuvintesDoHolograma;
  let sinal!: AbortSignal;
  let terminar!: (terminou: boolean) => void;
  let falhar!: (erro: unknown) => void;
  const gerar = vi.fn((_objeto: string, _detalhe: string, _provedor: string, o: OuvintesDoHolograma, s: AbortSignal) => {
    ouvintes = o;
    sinal = s;
    return new Promise<boolean>((resolver, rejeitar) => {
      terminar = resolver;
      falhar = rejeitar;
      s.addEventListener('abort', () => rejeitar(new DOMException('abortado', 'AbortError')));
    });
  });
  return {
    gerar,
    get ouvintes() { return ouvintes; },
    get sinal() { return sinal; },
    terminar: (t: boolean) => terminar(t),
    falhar: (e: unknown) => falhar(e),
  };
}

describe('HologramaService.gerar', () => {
  let stream: ReturnType<typeof streamControlado>;

  beforeEach(() => {
    stream = streamControlado();
    TestBed.configureTestingModule({
      providers: [{ provide: HologramaStreamService, useValue: { gerar: stream.gerar, exemplo: vi.fn() } }],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('escaneia até a primeira peça e fica pronto no fim', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerar('  motor V8  ', 'detalhado');

    expect(stream.gerar).toHaveBeenCalledWith('motor V8', 'detalhado', 'haiku', expect.anything(), expect.anything());
    expect(holograma.aberto()).toBe(true);
    expect(holograma.escaneando()).toBe(true);

    stream.ouvintes.meta({ nome: 'Motor V8', categoria: 'mecanica', descricao: '' });
    stream.ouvintes.peca(PECA);
    expect(holograma.escaneando()).toBe(false);
    expect(holograma.construindo()).toBe(true);

    stream.ouvintes.fim({ pecas: 1, avisos: 0 });
    stream.terminar(true);
    await pedido;
    expect(holograma.fase()).toBe('pronto');
  });

  it('envia o gerador escolhido em cada pedido e o lembra no navegador', async () => {
    localStorage.removeItem('jarvis-hud.holograma.gerador.v1');
    const holograma = TestBed.inject(HologramaService);
    expect(holograma.gerador()).toBe('haiku');

    holograma.escolherGerador('local');
    const pedido = holograma.gerar('turbina', 'normal');
    expect(stream.gerar).toHaveBeenCalledWith('turbina', 'normal', 'local', expect.anything(), expect.anything());
    stream.terminar(true);
    await pedido;

    expect(localStorage.getItem('jarvis-hud.holograma.gerador.v1')).toBe('local');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: HologramaStreamService, useValue: { gerar: stream.gerar, exemplo: vi.fn() } }],
    });
    expect(TestBed.inject(HologramaService).gerador()).toBe('local');
    localStorage.removeItem('jarvis-hud.holograma.gerador.v1');
  });

  it('mostra o selo do gasto no fim e o aviso de troca de gerador', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerar('cubo', 'normal');
    stream.ouvintes.aviso('O Haiku falhou; troquei para o gerador local.', true);
    stream.ouvintes.peca(PECA);
    expect(holograma.selo()).toBe('');
    stream.ouvintes.fim({ pecas: 1, avisos: 1, provedor: 'anthropic', modelo: 'claude-haiku-5-5', custoUsd: 0.002 });
    stream.terminar(true);
    await pedido;

    expect(holograma.textosDeAviso()).toEqual(['O Haiku falhou; troquei para o gerador local.']);
    expect(holograma.trocaDeGerador()).toBe('O Haiku falhou; troquei para o gerador local.');
    expect(holograma.selo()).toBe('Haiku · 1 peça · US$0,002');
  });

  it('o erro do servidor mantém as peças que chegaram', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerar('turbina', 'normal');
    stream.ouvintes.peca(PECA);
    stream.ouvintes.erro('O modelo não respondeu a tempo.');
    stream.ouvintes.fim({ pecas: 1, avisos: 0 });
    stream.terminar(true);
    await pedido;

    expect(holograma.fase()).toBe('erro');
    expect(holograma.erro()).toBe('O modelo não respondeu a tempo.');
    expect(holograma.pecas()).toHaveLength(1);
  });

  it('a conexão que cai sem o fim vira erro, sem apagar nada', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerar('turbina', 'normal');
    stream.ouvintes.peca(PECA);
    stream.terminar(false);
    await pedido;

    expect(holograma.fase()).toBe('erro');
    expect(holograma.pecas()).toHaveLength(1);
  });

  it('cancelar aborta o stream e deixa as peças', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerar('turbina', 'rapido');
    stream.ouvintes.peca(PECA);

    holograma.cancelar();
    await pedido;

    expect(stream.sinal.aborted).toBe(true);
    expect(holograma.fase()).toBe('cancelado');
    expect(holograma.pecas()).toHaveLength(1);
    expect(holograma.escaneando()).toBe(false);
  });

  it('não pede nada com o campo vazio, e explica a rota que a API não tem', async () => {
    const holograma = TestBed.inject(HologramaService);
    await holograma.gerar('   ', 'normal');
    expect(stream.gerar).not.toHaveBeenCalled();

    const pedido = holograma.gerar('cubo', 'normal');
    stream.falhar(new ErroDoStreamHolograma(404));
    await pedido;
    expect(holograma.erro()).toBe('Esta API ainda não gera hologramas.');
  });
});
