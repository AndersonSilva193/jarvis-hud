import { describe, expect, it } from 'vitest';

import { lerModoIa, rotuloModoIa, type EstadoModoIa } from './modo-ia.modelos';

const LOCAL: EstadoModoIa = { modo: 'LOCAL', provedorEfetivo: 'local', modelo: 'Qwen 9B', motivoFallback: null };

describe('lerModoIa', () => {
  it('aceita o corpo do servidor, com ou sem motivo de fallback', () => {
    expect(lerModoIa({ modo: 'LOCAL', provedorEfetivo: 'local', modelo: ' Qwen 9B ' })).toEqual(LOCAL);
    expect(
      lerModoIa({ modo: 'AUTO', provedorEfetivo: 'claude', modelo: 'Haiku', motivoFallback: 'PC sem VRAM livre' }),
    ).toEqual({ modo: 'AUTO', provedorEfetivo: 'claude', modelo: 'Haiku', motivoFallback: 'PC sem VRAM livre' });
    expect(lerModoIa({ ...LOCAL, motivoFallback: '   ' })?.motivoFallback).toBeNull();
  });

  it('descarta o que não é do contrato', () => {
    expect(lerModoIa(null)).toBeNull();
    expect(lerModoIa('LOCAL')).toBeNull();
    expect(lerModoIa({ ...LOCAL, modo: 'GPT' })).toBeNull();
    expect(lerModoIa({ ...LOCAL, modo: 'local' })).toBeNull();
    expect(lerModoIa({ ...LOCAL, provedorEfetivo: 'openai' })).toBeNull();
    expect(lerModoIa({ ...LOCAL, modelo: 9 })).toBeNull();
    expect(lerModoIa({ ...LOCAL, motivoFallback: { texto: 'x' } })).toBeNull();
  });
});

describe('rotuloModoIa', () => {
  it('mostra quem está pensando nos três formatos', () => {
    expect(rotuloModoIa(LOCAL)).toBe('Local · Qwen 9B');
    expect(rotuloModoIa({ modo: 'CLAUDE', provedorEfetivo: 'claude', modelo: 'Haiku', motivoFallback: null })).toBe(
      'Claude · Haiku',
    );
    expect(rotuloModoIa({ ...LOCAL, modo: 'AUTO' })).toBe('Auto → Local');
    expect(rotuloModoIa({ ...LOCAL, modo: 'AUTO', provedorEfetivo: 'claude' })).toBe('Auto → Claude');
  });

  it('com fallback, o rótulo segue o provedor efetivo', () => {
    expect(
      rotuloModoIa({ modo: 'LOCAL', provedorEfetivo: 'claude', modelo: 'Haiku', motivoFallback: 'PC sem VRAM livre' }),
    ).toBe('Claude · Haiku');
  });
});
