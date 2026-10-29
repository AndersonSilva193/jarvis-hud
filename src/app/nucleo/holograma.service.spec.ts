import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConexaoMudaHolograma, ErroDoStreamHolograma, HologramaStreamService, type OuvintesDoHolograma } from './holograma-stream.service';
import { HologramaGaleriaService } from './holograma-galeria.service';
import { HologramaService } from './holograma.service';
import type { ItemGaleria, PecaHolograma } from './holograma.modelos';

const ITEM: ItemGaleria = {
  id: 'habcdefgh', nome: 'Motor V8', pecas: 40, data: '2026-10-29T12:00:00Z', provedor: 'anthropic',
  detalhe: 'detalhado', objeto: 'o motor V8', fixo: false, miniatura: false,
};

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
  const abrir = (o: OuvintesDoHolograma, s: AbortSignal) => {
    ouvintes = o;
    sinal = s;
    return new Promise<boolean>((resolver, rejeitar) => {
      terminar = resolver;
      falhar = rejeitar;
      s.addEventListener('abort', () => rejeitar(new DOMException('abortado', 'AbortError')));
    });
  };
  const gerar = vi.fn((_objeto: string, _detalhe: string, _provedor: string, o: OuvintesDoHolograma, s: AbortSignal, _novo?: boolean) => abrir(o, s));
  const abrirDaGaleria = vi.fn((_id: string, o: OuvintesDoHolograma, s: AbortSignal) => abrir(o, s));
  const continuar = vi.fn((_id: string, _recebidas: number, o: OuvintesDoHolograma, s: AbortSignal) => abrir(o, s));
  return {
    gerar,
    continuar,
    abrirDaGaleria,
    get ouvintes() { return ouvintes; },
    get sinal() { return sinal; },
    terminar: (t: boolean) => terminar(t),
    falhar: (e: unknown) => falhar(e),
  };
}

describe('HologramaService.gerar', () => {
  let stream: ReturnType<typeof streamControlado>;
  let galeria: { listar: ReturnType<typeof vi.fn>; apagar: ReturnType<typeof vi.fn>; miniatura: ReturnType<typeof vi.fn>; enviarMiniatura: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    stream = streamControlado();
    galeria = {
      listar: vi.fn(async () => [ITEM]),
      apagar: vi.fn(async () => undefined),
      miniatura: vi.fn(async () => null),
      enviarMiniatura: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: HologramaStreamService, useValue: { gerar: stream.gerar, continuar: stream.continuar, abrir: stream.abrirDaGaleria } },
        { provide: HologramaGaleriaService, useValue: galeria },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('escaneia até a primeira peça e fica pronto no fim', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerar('  motor V8  ', 'detalhado');

    expect(stream.gerar).toHaveBeenCalledWith('motor V8', 'detalhado', 'haiku', expect.anything(), expect.anything(), false);
    expect(holograma.aberto()).toBe(true);
    expect(holograma.escaneando()).toBe(true);

    stream.ouvintes.meta({ nome: 'Motor V8', categoria: 'mecanica', descricao: '' });
    stream.ouvintes.peca(PECA);
    expect(holograma.escaneando()).toBe(false);
    expect(holograma.construindo()).toBe(true);

    stream.ouvintes.fim({ pecas: 1, avisos: 0, status: 'completo' });
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
    expect(stream.gerar).toHaveBeenCalledWith('turbina', 'normal', 'local', expect.anything(), expect.anything(), false);
    stream.terminar(true);
    await pedido;

    expect(localStorage.getItem('jarvis-hud.holograma.gerador.v1')).toBe('local');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: HologramaStreamService, useValue: { gerar: stream.gerar, continuar: stream.continuar, abrir: stream.abrirDaGaleria } },
        { provide: HologramaGaleriaService, useValue: galeria },
      ],
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
    stream.ouvintes.fim({ pecas: 1, avisos: 1, status: 'completo', provedor: 'anthropic', modelo: 'claude-haiku-5-5', custoUsd: 0.002 });
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
    stream.ouvintes.fim({ pecas: 1, avisos: 0, status: 'completo' });
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

  it('fim incompleto mostra o motivo e o Continuar retoma sem limpar a cena', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerar('Torre Eiffel', 'detalhado');
    stream.ouvintes.meta({ nome: 'Torre Eiffel', categoria: 'arquitetura', descricao: '', id: 'habc12345' });
    stream.ouvintes.peca(PECA);
    stream.ouvintes.fim({ pecas: 1, avisos: 0, status: 'incompleto', motivo: 'o modelo bateu no teto de tokens', id: 'habc12345' });
    stream.terminar(true);
    await pedido;

    expect(holograma.fase()).toBe('incompleto');
    expect(holograma.erro()).toBe('Incompleto: o modelo bateu no teto de tokens');
    expect(holograma.podeContinuar()).toBe(true);
    const geracao = holograma.geracao();

    const retomada = holograma.continuar();
    expect(stream.continuar).toHaveBeenCalledWith('habc12345', 1, expect.anything(), expect.anything());
    expect(holograma.construindo()).toBe(true);
    stream.ouvintes.peca({ ...PECA, id: 'topo' });
    stream.ouvintes.fim({ pecas: 2, avisos: 0, status: 'completo', id: 'habc12345' });
    stream.terminar(true);
    await retomada;

    expect(holograma.fase()).toBe('pronto');
    expect(holograma.pecas().map((p) => p.id)).toEqual(['cubo', 'topo']);
    expect(holograma.geracao()).toBe(geracao);
  });

  it('a conexão que cai com peça e id na tela vira incompleto, não erro', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerar('motor V8', 'detalhado');
    stream.ouvintes.meta({ nome: 'Motor V8', categoria: '', descricao: '', id: 'habc12345' });
    stream.ouvintes.peca(PECA);
    stream.terminar(false);
    await pedido;

    expect(holograma.fase()).toBe('incompleto');
    expect(holograma.erro()).toBe('Incompleto: a conexão caiu no meio');
    expect(holograma.podeContinuar()).toBe(true);
  });

  it('a conexão muda na volta do segundo plano também oferece continuar', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerar('motor V8', 'detalhado');
    stream.ouvintes.meta({ nome: 'Motor V8', categoria: '', descricao: '', id: 'habc12345' });
    stream.ouvintes.peca(PECA);
    stream.falhar(new ConexaoMudaHolograma());
    await pedido;

    expect(holograma.podeContinuar()).toBe(true);
  });

  it('continuar o que o servidor não guarda mais explica e não apaga', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerar('motor V8', 'detalhado');
    stream.ouvintes.meta({ nome: 'Motor V8', categoria: '', descricao: '', id: 'habc12345' });
    stream.ouvintes.peca(PECA);
    stream.terminar(false);
    await pedido;

    const retomada = holograma.continuar();
    stream.falhar(new ErroDoStreamHolograma(404));
    await retomada;
    expect(holograma.fase()).toBe('erro');
    expect(holograma.erro()).toBe('O servidor não guarda mais esse objeto; gere de novo.');
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

  it('gerar de novo repete o pedido do item com novo=true', async () => {
    const holograma = TestBed.inject(HologramaService);
    const pedido = holograma.gerarDeNovo(ITEM);
    expect(stream.gerar).toHaveBeenCalledWith('o motor V8', 'detalhado', 'haiku', expect.anything(), expect.anything(), true);
    stream.terminar(true);
    await pedido;
  });

  it('abre da galeria pelo id e recarrega a lista quando o modelo salvou um objeto', async () => {
    const holograma = TestBed.inject(HologramaService);
    const aberto = holograma.abrirDaGaleria(ITEM);
    expect(stream.abrirDaGaleria).toHaveBeenCalledWith('habcdefgh', expect.anything(), expect.anything());
    stream.ouvintes.fim({ pecas: 40, avisos: 0, status: 'completo', origem: 'cache', salvo: true, miniatura: true });
    stream.terminar(true);
    await aberto;
    expect(galeria.listar).not.toHaveBeenCalled();

    const gerado = holograma.gerar('turbina', 'normal');
    stream.ouvintes.fim({ pecas: 9, avisos: 0, status: 'completo', origem: 'modelo', salvo: true, miniatura: false });
    stream.terminar(true);
    await gerado;
    await vi.waitFor(() => expect(holograma.galeria()).toEqual([ITEM]));
  });

  it('apagar tira o item da lista, e a miniatura enviada aparece na hora', async () => {
    const holograma = TestBed.inject(HologramaService);
    await holograma.carregarGaleria();
    await holograma.enviarMiniatura('habcdefgh', 'data:image/png;base64,AAAA');
    expect(galeria.enviarMiniatura).toHaveBeenCalledWith('habcdefgh', 'data:image/png;base64,AAAA');
    expect(holograma.miniaturas()['habcdefgh']).toBe('data:image/png;base64,AAAA');
    expect(holograma.galeria()[0]!.miniatura).toBe(true);

    await holograma.apagarDaGaleria(ITEM);
    expect(galeria.apagar).toHaveBeenCalledWith('habcdefgh');
    expect(holograma.galeria()).toEqual([]);
    expect(holograma.miniaturas()).toEqual({});
  });
});
