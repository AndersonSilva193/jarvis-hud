import { describe, expect, it } from 'vitest';

import { lerComandoHolograma } from './holograma.modelos';

describe('lerComandoHolograma', () => {
  it('lê as ações com os complementos que o servidor resolveu', () => {
    expect(lerComandoHolograma({ acao: 'explodir', dados: { fator: 0.8 }, rapido: false }))
      .toEqual({ acao: 'explodir', rapido: false, fator: 0.8 });
    expect(lerComandoHolograma({ acao: 'parar', dados: {}, rapido: true })).toEqual({ acao: 'parar', rapido: true });
    expect(lerComandoHolograma({ acao: 'isolar', dados: { grupos: ['pistoes'], pecas: [] } }))
      .toEqual({ acao: 'isolar', rapido: false, alvo: { grupos: ['pistoes'], pecas: [] } });
    expect(lerComandoHolograma({
      acao: 'carregar', dados: { objeto: 'motor V8', detalhe: 'detalhado', novo: true, provedor: 'local', falaPronto: 'Pronto: {n} peças.' },
    })).toEqual({
      acao: 'carregar', rapido: false, objeto: 'motor V8', detalhe: 'detalhado', novo: true, provedor: 'local',
      falaPronto: 'Pronto: {n} peças.',
    });
    expect(lerComandoHolograma({ acao: 'vista', dados: { vista: 'cima' } })).toEqual({ acao: 'vista', rapido: false, vista: 'cima' });
  });

  it('recusa o que não confere: ação nova, número fora da faixa, id torto', () => {
    expect(lerComandoHolograma({ acao: 'voar', dados: {} })).toBeNull();
    expect(lerComandoHolograma({ acao: 'explodir', dados: { fator: 2 } })).toBeNull();
    expect(lerComandoHolograma({ acao: 'girar', dados: { eixo: 'w', graus: 90 } })).toBeNull();
    expect(lerComandoHolograma({ acao: 'destacar', dados: { grupos: ['<script>'], pecas: [] } })).toBeNull();
    expect(lerComandoHolograma({ acao: 'carregar', dados: { objeto: '  ' } })).toBeNull();
    expect(lerComandoHolograma('explodir')).toBeNull();
  });
});
