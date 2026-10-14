import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { ConversaService } from './conversa.service';
import { JarvisApiService } from './jarvis-api.service';
import { ConfigStore } from './config.store';
import { VozService } from './voz.service';
import { BriefingPlayerService } from './briefing-player.service';
import type { HistoricoConversa, RespostaConversa, PedidoConversa } from './conversa.modelos';

function adiar<T>() {
  let resolver!: (v: T) => void;
  const promessa = new Promise<T>((r) => (resolver = r));
  return { promessa, resolver };
}
const resposta = (id = '1', canal: 'hud' | 'telegram' = 'hud'): RespostaConversa => ({
  id,
  canal,
  texto: 'Tudo certo.',
  anexos: [],
  confirmacao: null,
  concluidoEm: '2026-10-14T10:00:00Z',
  erro: null,
});
const pedido = (id = '1'): PedidoConversa => ({
  id,
  canal: 'hud',
  texto: 'oi',
  estado: 'processando',
  iniciadoEm: '2026-10-14T10:00:00Z',
});
const vazio = (): HistoricoConversa => ({
  sessao: 'servidor1',
  revisao: 0,
  trocas: [],
  emAndamento: null,
  ultima: null,
});
const aguardar = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe('ConversaService', () => {
  let servico: ConversaService;
  let historico: HistoricoConversa;
  const api = {
    enviarConversa: vi.fn(),
    historicoConversa: vi.fn(),
    ultimaConversa: vi.fn(),
    limparConversa: vi.fn(),
  };
  const voz = { falar: vi.fn(), parar: vi.fn() };
  const player = { parar: vi.fn() };
  beforeEach(async () => {
    vi.resetAllMocks();
    sessionStorage.clear();
    historico = vazio();
    api.historicoConversa.mockImplementation(async () => historico);
    api.ultimaConversa.mockImplementation(async () => historico.ultima);
    api.enviarConversa.mockResolvedValue({ id: '1' });
    voz.falar.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: JarvisApiService, useValue: api },
        { provide: ConfigStore, useValue: { urlApi: signal('http://teste') } },
        { provide: VozService, useValue: voz },
        { provide: BriefingPlayerService, useValue: player },
      ],
    });
    servico = TestBed.inject(ConversaService);
    servico.abrir();
    await aguardar();
  });
  afterEach(() => {
    servico.fechar();
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });
  it('aceita a resposta SSE antes do 202 e fala uma vez', async () => {
    const post = adiar<{ id: string }>();
    api.enviarConversa.mockReturnValue(post.promessa);
    const envio = servico.enviar('oi');
    historico = { ...vazio(), revisao: 3, ultima: resposta() };
    servico.receber(resposta());
    post.resolver({ id: '1' });
    await envio;
    await aguardar();
    servico.receber(resposta());
    await servico.recuperar();
    expect(servico.ocupada()).toBe(false);
    expect(voz.falar).toHaveBeenCalledExactlyOnceWith('Tudo certo.');
  });
  it('recupera uma resposta perdida do pedido pendente e não repete o POST', async () => {
    historico = { ...vazio(), revisao: 1, emAndamento: pedido() };
    await servico.enviar('oi');
    await aguardar();
    expect(servico.pendente()).toBe('1');
    expect(await servico.enviar('outro')).toBe(false);
    historico = { ...vazio(), revisao: 3, ultima: resposta() };
    await servico.recuperar();
    await aguardar();
    await servico.recuperar();
    expect(voz.falar).toHaveBeenCalledTimes(1);
    expect(api.enviarConversa).toHaveBeenCalledTimes(1);
  });
  it('restaura silenciosamente e deixa mensagens do Telegram apenas no histórico', async () => {
    historico = {
      ...vazio(),
      revisao: 3,
      ultima: resposta(),
      trocas: [{ id: 't', canal: 'telegram', pedido: 'Olá', resposta: resposta('t', 'telegram') }],
    };
    await servico.recuperar();
    await aguardar();
    expect(servico.resposta()?.id).toBe('1');
    expect(voz.falar).not.toHaveBeenCalled();
    servico.mostrarBriefing();
    servico.receber(resposta('t', 'telegram'));
    await servico.recuperar();
    expect(servico.naTela()).toBe(false);
    expect(servico.trocas()[0].canal).toBe('telegram');
  });
  it('ignora consulta antiga quando um novo pedido começou', async () => {
    const leitura = adiar<HistoricoConversa>();
    api.historicoConversa.mockReturnValueOnce(leitura.promessa);
    const recuperar = servico.recuperar();
    servico.pensando(pedido());
    leitura.resolver(vazio());
    await recuperar;
    expect(servico.pendente()).toBe('1');
  });
  it('descarta revisão menor e libera pedido perdido após reinício', async () => {
    historico = { ...vazio(), revisao: 5, emAndamento: pedido() };
    await servico.recuperar();
    historico = { ...vazio(), revisao: 4 };
    await servico.recuperar();
    expect(servico.pendente()).toBe('1');
    historico = { ...vazio(), sessao: 'servidor2' };
    await servico.recuperar();
    expect(servico.ocupada()).toBe(false);
    expect(servico.erro()).toContain('interrompido');
  });
  it('não reenvia um POST incerto e consulta o estado antes de liberar', async () => {
    api.enviarConversa.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    historico = { ...vazio(), revisao: 1, emAndamento: pedido() };
    await servico.enviar('oi');
    await aguardar();
    expect(api.enviarConversa).toHaveBeenCalledTimes(1);
    expect(servico.pendente()).toBe('1');
  });
  it('não faz narração nem altera a tela com consultas que terminam após sair', async () => {
    const leitura = adiar<HistoricoConversa>();
    api.historicoConversa.mockReturnValueOnce(leitura.promessa);
    const recuperar = servico.recuperar();
    servico.fechar();
    leitura.resolver({ ...vazio(), revisao: 3, ultima: resposta() });
    await recuperar;
    servico.receber(resposta());
    expect(servico.resposta()).toBeNull();
    expect(voz.falar).not.toHaveBeenCalled();
  });
  it('recupera erro terminal, permite limpar e nunca lê o erro em voz alta', async () => {
    const erro = { ...resposta(), texto: '', erro: 'Falha pública' };
    historico = { ...vazio(), revisao: 3, ultima: erro };
    await servico.recuperar();
    await aguardar();
    expect(servico.erro()).toBe('Falha pública');
    expect(voz.falar).not.toHaveBeenCalled();
    historico = { ...vazio(), revisao: 4 };
    await servico.limpar();
    expect(servico.resposta()).toBeNull();
  });
  it('fala simples não ocupa a tela; só o que se olha segura o palco', async () => {
    servico.chatAberto.set(true);
    expect(servico.naTela()).toBe(true);

    // Fechado o chat, a resposta de texto é falada e guardada no histórico — a tela volta ao orbe.
    servico.chatAberto.set(false);
    servico.receber(resposta());
    expect(servico.cartao()).toBeNull();
    expect(servico.naTela()).toBe(false);
    expect(voz.falar).toHaveBeenCalledExactlyOnceWith('Tudo certo.');

    // Com anexo há o que olhar: o card entra no palco e só sai no ✕.
    servico.receber({
      ...resposta('2'),
      anexos: [
        {
          id: 'a',
          tipo: 'imagem',
          nome: 'Print',
          mime: 'image/png',
          url: '/api/anexos/a',
          expiraEm: null,
        },
      ],
    });
    expect(servico.cartao()?.id).toBe('2');
    expect(servico.naTela()).toBe(true);
    servico.dispensar();
    expect(servico.cartao()).toBeNull();
    expect(servico.naTela()).toBe(false);
  });
  it('card restaurado ao abrir a tela não volta sozinho para o palco', async () => {
    historico = {
      ...vazio(),
      revisao: 2,
      ultima: {
        ...resposta('9'),
        anexos: [
          {
            id: 'a',
            tipo: 'imagem',
            nome: 'Print',
            mime: 'image/png',
            url: '/api/anexos/a',
            expiraEm: null,
          },
        ],
      },
    };
    await servico.recuperar();
    await aguardar();
    expect(servico.resposta()?.id).toBe('9');
    expect(servico.cartao()).toBeNull();
    expect(servico.naTela()).toBe(false);
  });
  it('chat aberto pela pessoa continua aberto depois da resposta', () => {
    servico.chatAberto.set(true);
    servico.receber(resposta());
    // Quem abriu o chat foi a pessoa; só ela o fecha, no Recolher, no Esc ou no Ver briefing.
    expect(servico.chatAberto()).toBe(true);
    expect(servico.naTela()).toBe(true);
    servico.recolher();
    expect(servico.naTela()).toBe(false);
  });
  it('sair durante o POST não deixa a próxima abertura bloqueada', async () => {
    const post = adiar<{ id: string }>();
    api.enviarConversa.mockReturnValue(post.promessa);
    const envio = servico.enviar('oi');
    servico.fechar();
    historico = { ...vazio(), revisao: 1, emAndamento: pedido() };
    servico.abrir();
    await aguardar();
    post.resolver({ id: '1' });
    await envio;
    expect(servico.enviando()).toBe(false);
    expect(servico.pendente()).toBe('1');
    historico = { ...vazio(), revisao: 3, ultima: resposta() };
    await servico.recuperar();
    await aguardar();
    expect(servico.ocupada()).toBe(false);
    expect(voz.falar).toHaveBeenCalledOnce();
  });
});
