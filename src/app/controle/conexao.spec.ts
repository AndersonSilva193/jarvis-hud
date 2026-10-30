import { describe, expect, it } from 'vitest';

import { ConexaoDoCanal, TOLERANCIA_DE_QUEDA_MS, type EstadoDaConexao, type SocketMinimo } from './conexao';
import { MedidorDeLatencia, percentil } from './latencia';

class SocketFalso implements SocketMinimo {
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  enviados: string[] = [];
  fechadoCom: number | null = null;
  constructor(readonly url: string) {}
  send(texto: string) { this.enviados.push(texto); }
  close(codigo?: number) { this.fechadoCom = codigo ?? 1000; this.readyState = 3; }
  abrir() { this.readyState = 1; this.onopen?.(new Event('open')); }
  cair(codigo: number) { this.readyState = 3; this.onclose?.({ code: codigo } as CloseEvent); }
}

function montar() {
  let agora = 0;
  let agenda: { quando: number; fn: () => void }[] = [];
  const sockets: SocketFalso[] = [];
  const estados: [EstadoDaConexao, string?][] = [];
  const recebidas: string[] = [];
  let tentativa = 0;
  const conexao = new ConexaoDoCanal({
    url: async () => `ws://x/ws/holograma?n=${tentativa++}`,
    aoAbrir: () => undefined,
    aoReceber: (t) => recebidas.push(t),
    aoMudar: (e, m) => estados.push(m ? [e, m] : [e]),
    criar: (url) => {
      const s = new SocketFalso(url);
      sockets.push(s);
      return s;
    },
    agora: () => agora,
    agendar: (fn, ms) => agenda.push({ quando: agora + ms, fn }),
    cancelar: () => (agenda = []),
  });
  /** Anda o relógio rodando as esperas vencidas, e deixa as promessas do `url()` resolverem. */
  const andar = async (ms: number) => {
    const fim = agora + ms;
    for (;;) {
      await Promise.resolve();
      agenda.sort((a, b) => a.quando - b.quando);
      const proxima = agenda[0];
      if (!proxima || proxima.quando > fim) break;
      agenda = agenda.slice(1);
      agora = proxima.quando;
      proxima.fn();
    }
    agora = fim;
    await Promise.resolve();
  };
  return { conexao, sockets, estados, recebidas, andar };
}

describe('a conexão do canal', () => {
  it('abre, recebe e manda', async () => {
    const { conexao, sockets, estados, recebidas, andar } = montar();
    conexao.abrir();
    await andar(0);
    sockets[0]!.abrir();
    sockets[0]!.onmessage?.({ data: '{"t":"eco","n":1}' } as MessageEvent);
    expect(conexao.enviar('oi')).toBe(true);
    expect(sockets[0]!.enviados).toEqual(['oi']);
    expect(recebidas).toEqual(['{"t":"eco","n":1}']);
    expect(estados).toEqual([['conectando'], ['aberta']]);
  });

  it('caiu: tenta de novo, com espera crescente, e volta', async () => {
    const { conexao, sockets, estados, andar } = montar();
    conexao.abrir();
    await andar(0);
    sockets[0]!.abrir();
    sockets[0]!.cair(1006);
    await andar(499);
    expect(sockets).toHaveLength(1);
    await andar(1);
    expect(sockets).toHaveLength(2);
    sockets[1]!.cair(1006);
    await andar(999);
    expect(sockets).toHaveLength(2);
    await andar(1);
    expect(sockets[2]!.url).toContain('n=2');
    sockets[2]!.abrir();
    expect(estados.at(-1)).toEqual(['aberta']);
  });

  it('desiste depois de 30 s sem conseguir, e diz por quê', async () => {
    const { conexao, sockets, estados, andar } = montar();
    conexao.abrir();
    await andar(0);
    sockets[0]!.abrir();
    sockets[0]!.cair(1006);
    for (let t = 0; t < TOLERANCIA_DE_QUEDA_MS + 5_000; t += 250) {
      await andar(250);
      const ultimo = sockets.at(-1)!;
      if (ultimo.readyState === 0) ultimo.cair(1006);
    }
    expect(estados.at(-1)).toEqual(['fechada', 'Sem conexão com o servidor há 30 s.']);
    const tentativas = sockets.length;
    await andar(10_000);
    expect(sockets).toHaveLength(tentativas);
    expect(tentativas).toBeGreaterThan(5);
  });

  it('código final não reconecta: o motivo vai para a tela', async () => {
    const { conexao, sockets, estados, andar } = montar();
    conexao.abrir();
    await andar(0);
    sockets[0]!.cair(4409);
    await andar(10_000);
    expect(sockets).toHaveLength(1);
    expect(estados.at(-1)).toEqual(['fechada', 'Outro celular já está controlando o PC.']);
  });

  it('fechar de propósito manda o código e não volta', async () => {
    const { conexao, sockets, andar } = montar();
    conexao.abrir();
    await andar(0);
    sockets[0]!.abrir();
    conexao.fechar();
    await andar(10_000);
    expect(sockets[0]!.fechadoCom).toBe(1000);
    expect(sockets).toHaveLength(1);
    expect(conexao.enviar('x')).toBe(false);
  });
});

describe('a medida da latência', () => {
  it('cada eco que volta é uma amostra; o desconhecido e o repetido não contam', () => {
    let agora = 0;
    const medidor = new MedidorDeLatencia(() => agora);
    for (const ms of [40, 20, 30, 100, 50]) {
      const { n } = medidor.novoEco();
      agora += ms;
      expect(medidor.voltou(n)).toBe(ms);
      expect(medidor.voltou(n)).toBeNull();
    }
    expect(medidor.voltou(999)).toBeNull();
    expect(medidor.resumo()).toEqual({ p50: 40, p95: 100, k: 5 });
  });

  it('o percentil é o do posto mais próximo', () => {
    const cem = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentil(cem, 0.5)).toBe(50);
    expect(percentil(cem, 0.95)).toBe(95);
    expect(percentil([7], 0.95)).toBe(7);
  });
});
