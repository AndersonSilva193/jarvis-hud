import { describe, expect, it } from 'vitest';

import { LeitorSse } from './leitor-sse';

describe('LeitorSse', () => {
  it('entrega cada evento na linha em branco que o fecha', () => {
    const leitor = new LeitorSse();
    expect(leitor.alimentar('event:meta\ndata:{"nome":"DNA"}\n\nevent:peca\ndata:{}\n\n')).toEqual([
      { evento: 'meta', dados: '{"nome":"DNA"}' },
      { evento: 'peca', dados: '{}' },
    ]);
  });

  it('junta um evento cortado entre pedaços, até no meio do \\r\\n', () => {
    const leitor = new LeitorSse();
    expect(leitor.alimentar('event: pe')).toEqual([]);
    expect(leitor.alimentar('ca\r\ndata: {"a"')).toEqual([]);
    expect(leitor.alimentar(':1}\r')).toEqual([]);
    expect(leitor.alimentar('\n\r\n')).toEqual([{ evento: 'peca', dados: '{"a":1}' }]);
  });

  it('ignora comentário, campo desconhecido e BOM; junta várias linhas de data', () => {
    const leitor = new LeitorSse();
    const eventos = leitor.alimentar('﻿:ping\nid: 3\ndata: a\ndata: b\n\n');
    expect(eventos).toEqual([{ evento: 'message', dados: 'a\nb' }]);
  });

  it('descarta no fim o evento sem linha em branco, mas fecha o que só esperava o \\n do \\r', () => {
    const cortado = new LeitorSse();
    cortado.alimentar('event: fim\ndata: {}\n');
    expect(cortado.terminar()).toEqual([]);

    const pendente = new LeitorSse();
    expect(pendente.alimentar('event: fim\rdata: {}\r\r')).toEqual([]);
    expect(pendente.terminar()).toEqual([{ evento: 'fim', dados: '{}' }]);
  });
});
