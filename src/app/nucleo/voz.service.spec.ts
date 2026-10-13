import { describe, expect, it } from 'vitest';

import { escolherVoz, fatiar } from './voz.service';

/** Só uma casca com o que escolherVoz lê: o tipo do DOM tem muito mais campo do que importa. */
function voz(name: string, lang: string): SpeechSynthesisVoice {
  return {
    name,
    lang,
    default: false,
    localService: false,
    voiceURI: name,
  } as SpeechSynthesisVoice;
}

describe('escolherVoz', () => {
  it('prefere a voz do Google em português do Brasil', () => {
    const vozes = [
      voz('Microsoft Daniel - Portuguese (Brazil)', 'pt-BR'),
      voz('Google português do Brasil', 'pt-BR'),
      voz('Google US English', 'en-US'),
    ];

    expect(escolherVoz(vozes)?.name).toBe('Google português do Brasil');
  });

  it('cai para qualquer pt-BR quando não há voz do Google', () => {
    const vozes = [voz('Google português', 'pt-PT'), voz('Luciana', 'pt-BR')];

    expect(escolherVoz(vozes)?.name).toBe('Luciana');
  });

  it('aceita pt_BR com sublinhado, que alguns sistemas reportam assim', () => {
    expect(escolherVoz([voz('Joana', 'pt_BR')])?.name).toBe('Joana');
  });

  it('não escolhe voz de outro idioma: melhor deixar o navegador decidir pelo lang', () => {
    expect(escolherVoz([voz('Google US English', 'en-US')])).toBeNull();
    expect(escolherVoz([])).toBeNull();
  });
});

describe('fatiar', () => {
  it('não devolve pedaço nenhum para texto vazio', () => {
    expect(fatiar('')).toEqual([]);
    expect(fatiar('   \n  \n')).toEqual([]);
  });

  it('mantém texto curto em um pedaço só', () => {
    expect(fatiar('Bom dia, Anderson!')).toEqual(['Bom dia, Anderson!']);
  });

  it('pontua a linha que não termina em pontuação, para a voz respirar entre itens', () => {
    expect(fatiar('09:00 Enviar o currículo\n14:00 Dentista')).toEqual([
      '09:00 Enviar o currículo. 14:00 Dentista.',
    ]);
  });

  it('respeita o limite, porque utterance longa é cortada no Chrome', () => {
    const longo = Array.from({ length: 40 }, (_, i) => `palavra${i}`).join(' ');

    const pedacos = fatiar(longo, 60);

    expect(pedacos.length).toBeGreaterThan(1);
    for (const pedaco of pedacos) {
      expect(pedaco.length).toBeLessThanOrEqual(60);
    }
  });

  it('não perde nenhuma palavra ao fatiar', () => {
    const texto =
      'Curitiba: 18 °C agora (céu limpo), mínima 14 °C e máxima 22 °C\nChance de chuva: 30%';

    const juntado = fatiar(texto, 40).join(' ');

    for (const palavra of ['Curitiba:', '18', 'mínima', 'máxima', '30%']) {
      expect(juntado).toContain(palavra);
    }
  });
});
