import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversaService } from './conversa.service';
import type { RespostaConversa } from './conversa.modelos';
import { EscutaDeRespostaService } from './escuta-de-resposta.service';
import { EscutaService } from './escuta.service';
import { VozService } from './voz.service';

function adiar<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => (resolver = r));
  return { promessa, resolver };
}

function resposta(id = '1'): RespostaConversa {
  return {
    id, canal: 'hud', texto: 'Qual horário?', anexos: [], confirmacao: null,
    concluidoEm: new Date().toISOString(), erro: null,
    escuta: { tempoSegundos: 4, motivo: 'confirmar o horário', opcoes: ['Agora', 'Mais tarde'] },
  };
}

describe('EscutaDeRespostaService', () => {
  const falando = signal(false);
  const ligada = signal(true);
  const enviar = vi.fn().mockResolvedValue(true);
  const ditar = vi.fn<(...args: unknown[]) => Promise<string>>();
  const cancelarDitado = vi.fn();
  let servico: EscutaDeRespostaService;

  beforeEach(() => {
    vi.useFakeTimers();
    falando.set(false);
    ligada.set(true);
    enviar.mockClear();
    ditar.mockReset().mockResolvedValue('');
    cancelarDitado.mockClear();
    TestBed.configureTestingModule({ providers: [
      { provide: ConversaService, useValue: { enviar } },
      { provide: EscutaService, useValue: { disponivel: true, ligada, ditar, cancelarDitado, ouvirPor: vi.fn() } },
      { provide: VozService, useValue: { falando, falar: vi.fn() } },
    ] });
    servico = TestBed.inject(EscutaDeRespostaService);
  });

  afterEach(() => {
    servico.cancelar();
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('espera toda a narração e mais 300 ms antes de abrir o ditado', async () => {
    const fala = adiar<void>();
    falando.set(true);
    servico.receberResposta(resposta(), fala.promessa);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ditar).not.toHaveBeenCalled();
    falando.set(false);
    fala.resolver();
    await vi.advanceTimersByTimeAsync(299);
    expect(ditar).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ditar).toHaveBeenCalledOnce();
    expect(ditar.mock.calls[0]?.[1]).toMatchObject({ tempoParaComecarMs: 4000 });
  });

  it('envia texto ouvido como conversa normal', async () => {
    ditar.mockResolvedValue('Às três da tarde');
    servico.receberResposta(resposta(), Promise.resolve());
    await vi.advanceTimersByTimeAsync(300);
    expect(enviar).toHaveBeenCalledExactlyOnceWith('Às três da tarde');
  });

  it('confirma código ditado e envia cancelar para negativa', async () => {
    const pergunta = resposta();
    pergunta.confirmacao = { codigo: '1234', descricao: 'Confirmar?', expiraEm: new Date(Date.now() + 60_000).toISOString() };
    ditar.mockResolvedValueOnce('um dois três quatro').mockResolvedValueOnce('não');
    servico.receberResposta(pergunta, Promise.resolve());
    await vi.advanceTimersByTimeAsync(300);
    expect(enviar).toHaveBeenLastCalledWith('confirmo 1234');
    servico.receberResposta({ ...pergunta, id: '2' }, Promise.resolve());
    await vi.advanceTimersByTimeAsync(300);
    expect(enviar).toHaveBeenLastCalledWith('cancelar');
  });

  it('encerra em silêncio e mostra aviso quando não há resposta', async () => {
    servico.receberResposta(resposta(), Promise.resolve());
    await vi.advanceTimersByTimeAsync(300);
    expect(enviar).not.toHaveBeenCalled();
    expect(servico.fase()).toBe('inativa');
    expect(servico.aviso()).toBe('Sem resposta. Diga Jarvis quando quiser continuar.');
  });

  it('não abre microfone sem permissão prévia quando a ativação está desligada', async () => {
    ligada.set(false);
    const anterior = Object.getOwnPropertyDescriptor(navigator, 'permissions');
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) },
    });
    try {
      servico.receberResposta(resposta(), Promise.resolve());
      await vi.advanceTimersByTimeAsync(300);
      expect(ditar).not.toHaveBeenCalled();
      expect(servico.fase()).toBe('opcoes');
      expect(servico.opcoes()).toEqual(['Agora', 'Mais tarde']);
    } finally {
      if (anterior) Object.defineProperty(navigator, 'permissions', anterior);
      else Reflect.deleteProperty(navigator, 'permissions');
    }
  });

  it('usa permissão concedida sem ligar a preferência de ativação', async () => {
    ligada.set(false);
    const anterior = Object.getOwnPropertyDescriptor(navigator, 'permissions');
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    });
    try {
      servico.receberResposta(resposta(), Promise.resolve());
      await vi.advanceTimersByTimeAsync(300);
      expect(ditar).toHaveBeenCalledOnce();
      expect(ligada()).toBe(false);
    } finally {
      if (anterior) Object.defineProperty(navigator, 'permissions', anterior);
      else Reflect.deleteProperty(navigator, 'permissions');
    }
  });

  it('opção clicada é enviada e reinicia a sequência', async () => {
    servico.receberResposta(resposta(), Promise.resolve());
    servico.selecionarOpcao('Mais tarde');
    expect(enviar).toHaveBeenCalledExactlyOnceWith('Mais tarde');
    expect(servico.fase()).toBe('inativa');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ditar).not.toHaveBeenCalled();
  });

  it('limita cinco aberturas automáticas e clique libera outra', async () => {
    for (let n = 1; n <= 6; n++) {
      servico.receberResposta(resposta(String(n)), Promise.resolve());
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(ditar).toHaveBeenCalledTimes(5);
    expect(servico.fase()).toBe('opcoes');
    servico.registrarClique();
    servico.receberResposta(resposta('7'), Promise.resolve());
    await vi.advanceTimersByTimeAsync(300);
    expect(ditar).toHaveBeenCalledTimes(6);
  });

  it('frase de encerramento é enviada e bloqueia a próxima abertura automática', async () => {
    ditar.mockResolvedValueOnce('só isso');
    servico.receberResposta(resposta(), Promise.resolve());
    await vi.advanceTimersByTimeAsync(300);
    expect(enviar).toHaveBeenCalledWith('só isso');
    servico.receberResposta(resposta('2'), Promise.resolve());
    await vi.advanceTimersByTimeAsync(300);
    expect(ditar).toHaveBeenCalledTimes(1);
  });

  it('resposta do Telegram nunca abre o microfone', async () => {
    servico.receberResposta({ ...resposta(), canal: 'telegram' }, Promise.resolve());
    await vi.advanceTimersByTimeAsync(1000);
    expect(ditar).not.toHaveBeenCalled();
  });
});
