import { describe, expect, it } from 'vitest';
import { RoteiroLegenda } from './legenda-fala';

describe('legenda em trechos', () => {
  it('preserva palavras, acentos e pontuação sem revelar o restante da fala', () => {
    const roteiro = new RoteiroLegenda('Olá, senhor.\nA molécula está pronta!');
    expect(roteiro.revelado(1)).toBe('Olá, senhor.');
    expect(roteiro.indiceNoCaractere(13)).toBe(2);
    expect(roteiro.revelado(5)).toBe(roteiro.texto);
    expect(roteiro.trecho(-1, 30)).toBe('');
  });

  it('limita o trecho visível sem acumular os parágrafos anteriores', () => {
    const texto = Array.from({ length: 60 }, (_, i) => `palavra${i}`).join(' ');
    const roteiro = new RoteiroLegenda(texto);
    for (let i = 0; i < roteiro.palavras.length; i++) {
      const trecho = roteiro.trecho(i, 54);
      expect(trecho.length).toBeLessThanOrEqual(54);
      expect(trecho.split(' ').length).toBeLessThanOrEqual(12);
      expect(trecho.endsWith(`palavra${i}`)).toBe(true);
    }
    expect(roteiro.trecho(59, 54)).not.toContain('palavra0');
  });

  it('usa o tempo do áudio e dá peso às pausas da pontuação', () => {
    const roteiro = new RoteiroLegenda('Bom dia, senhor.');
    expect(roteiro.indiceNoTempo(0)).toBe(0);
    expect(roteiro.indiceNoTempo(0.5)).toBe(1);
    expect(roteiro.indiceNoTempo(1)).toBe(2);
  });
});
