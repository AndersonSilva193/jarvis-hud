import { describe, expect, it } from 'vitest';

import { AgregadorDeEventos, INTERVALO_MINIMO_MS } from './agregador';
import type { EventoDoControle } from './controle.modelos';

/** Relógio e agenda na mão do teste: `andar(ms)` roda o que venceu. */
function montar() {
  let agora = 0;
  let agenda: { quando: number; fn: () => void }[] = [];
  const enviados: { t: number; m: EventoDoControle | EventoDoControle[] }[] = [];
  const agregador = new AgregadorDeEventos((m) => enviados.push({ t: agora, m }), {
    agora: () => agora,
    agendar: (fn, ms) => agenda.push({ quando: agora + ms, fn }),
  });
  const andar = (ms: number) => {
    const fim = agora + ms;
    for (;;) {
      agenda.sort((a, b) => a.quando - b.quando);
      const proxima = agenda[0];
      if (!proxima || proxima.quando > fim) break;
      agenda = agenda.slice(1);
      agora = proxima.quando;
      proxima.fn();
    }
    agora = fim;
  };
  return { agregador, enviados, andar };
}

describe('o agregador', () => {
  it('o primeiro evento depois do silêncio sai na hora', () => {
    const { agregador, enviados, andar } = montar();
    agregador.adicionar({ t: 'resetar' });
    andar(0);
    expect(enviados).toEqual([{ t: 0, m: { t: 'resetar' } }]);
  });

  it('girar soma, zoom multiplica, cursor e explodir ficam com o último', () => {
    const { agregador, enviados, andar } = montar();
    agregador.adicionar({ t: 'girar', dx: 0.001, dy: 0 });
    andar(0);
    agregador.adicionar({ t: 'girar', dx: 0.01, dy: 0.02 });
    agregador.adicionar({ t: 'girar', dx: 0.01, dy: -0.01 });
    agregador.adicionar({ t: 'zoom', f: 1.1 });
    agregador.adicionar({ t: 'zoom', f: 1.1 });
    agregador.adicionar({ t: 'cursor', x: 0.1, y: 0.1 });
    agregador.adicionar({ t: 'cursor', x: 0.4, y: 0.7 });
    agregador.adicionar({ t: 'explodir', v: 0.2 });
    agregador.adicionar({ t: 'explodir', v: 0.6 });
    andar(INTERVALO_MINIMO_MS);
    expect(enviados[1]!.m).toEqual([
      { t: 'cursor', x: 0.4, y: 0.7 },
      { t: 'girar', dx: 0.02, dy: 0.01 },
      { t: 'zoom', f: 1.21 },
      { t: 'explodir', v: 0.6 },
    ]);
  });

  it('nunca passa de 30 mensagens por segundo', () => {
    const { agregador, enviados, andar } = montar();
    for (let ms = 0; ms < 1000; ms += 4) {
      agregador.adicionar({ t: 'girar', dx: 0.001, dy: 0 });
      andar(4);
    }
    expect(enviados.length).toBeLessThanOrEqual(31);
    expect(enviados.length).toBeGreaterThanOrEqual(29);
    for (let i = 1; i < enviados.length; i++) {
      expect(enviados[i]!.t - enviados[i - 1]!.t).toBeGreaterThanOrEqual(INTERVALO_MINIMO_MS - 1e-9);
    }
    // O último lote ainda espera a vez; com ele, nada se perdeu na fusão.
    andar(INTERVALO_MINIMO_MS);
    const total = enviados.map((e) => e.m as EventoDoControle).reduce((s, m) => s + (m.t === 'girar' ? m.dx : 0), 0);
    expect(total).toBeCloseTo(0.25, 6);
  });

  it('o discreto não fura a fila: o pendente sai antes dele, na ordem', () => {
    const { agregador, enviados, andar } = montar();
    agregador.adicionar({ t: 'eco', n: 0 });
    andar(0);
    agregador.adicionar({ t: 'cursor', x: 0.5, y: 0.5 });
    agregador.adicionar({ t: 'selecionar' });
    agregador.adicionar({ t: 'girar', dx: 0.01, dy: 0 });
    agregador.adicionar({ t: 'soltar', vx: 99, vy: 0 });
    andar(INTERVALO_MINIMO_MS);
    expect(enviados[1]!.m).toEqual([
      { t: 'cursor', x: 0.5, y: 0.5 },
      { t: 'selecionar' },
      { t: 'girar', dx: 0.01, dy: 0 },
      { t: 'soltar', vx: 20, vy: 0 },
    ]);
  });

  it('prende os valores aos limites do servidor e não manda o que se anulou', () => {
    const { agregador, enviados, andar } = montar();
    agregador.adicionar({ t: 'resetar' });
    andar(0);
    agregador.adicionar({ t: 'girar', dx: 0.9, dy: 0 });
    agregador.adicionar({ t: 'girar', dx: 0.9, dy: 0 });
    agregador.adicionar({ t: 'zoom', f: 1.9 });
    agregador.adicionar({ t: 'zoom', f: 1.9 });
    andar(INTERVALO_MINIMO_MS);
    expect(enviados[1]!.m).toEqual([{ t: 'girar', dx: 1, dy: 0 }, { t: 'zoom', f: 2 }]);

    agregador.adicionar({ t: 'zoom', f: 2 });
    agregador.adicionar({ t: 'zoom', f: 0.5 });
    andar(INTERVALO_MINIMO_MS);
    expect(enviados).toHaveLength(2);
  });

  it('mais de oito eventos num intervalo continuam no próximo', () => {
    const { agregador, enviados, andar } = montar();
    for (let n = 0; n < 10; n++) agregador.adicionar({ t: 'eco', n });
    andar(0);
    expect((enviados[0]!.m as EventoDoControle[]).length).toBe(8);
    andar(INTERVALO_MINIMO_MS);
    expect(enviados[1]!.m).toEqual([{ t: 'eco', n: 8 }, { t: 'eco', n: 9 }]);
  });

  it('descartar esquece o que não saiu', () => {
    const { agregador, enviados, andar } = montar();
    agregador.adicionar({ t: 'resetar' });
    andar(0);
    agregador.adicionar({ t: 'girar', dx: 0.1, dy: 0 });
    agregador.descartar();
    andar(100);
    expect(enviados).toHaveLength(1);
  });
});
