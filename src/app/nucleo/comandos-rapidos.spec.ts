import { describe, expect, it } from 'vitest';
import { reconhecerComandoRapido } from './comandos-rapidos';
describe('reconhecedor local', () => {
  it.each(['Jarvis, limpa a tela', 'limpa a tela', '  JARVIS: limpa   a tela! '])('reconhece %s', frase => expect(reconhecerComandoRapido(frase)?.acao).toBe('limpar'));
  it.each(['limpa a tela da minha casa', 'por favor limpa a tela', 'Jarvis, limpa a tela e fecha tudo', 'pausa o filme amanhã', 'jarvislimpa a tela', 'constructor', ''])('não intercepta %s', frase => expect(reconhecerComandoRapido(frase)).toBeNull());
  it('normaliza acentos e identifica o tipo sem procurar janelas no parser', () => expect(reconhecerComandoRapido('Jarvis, fecha a música.')).toMatchObject({ acao: 'fechar', tipo: 'musica' }));
});
