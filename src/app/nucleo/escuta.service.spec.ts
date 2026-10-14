import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { ATIVACOES, CONFIRMACOES, EscutaService, contem, normalizar } from './escuta.service';

describe('normalizar', () => {
  it('derruba caixa e acento, que é o que o reconhecimento varia a cada frase', () => {
    expect(normalizar('Bom dia!')).toBe('bom dia!');
    expect(normalizar('BOM DIA')).toBe('bom dia');
    expect(normalizar('observações')).toBe('observacoes');
  });
});

describe('contem', () => {
  it('reconhece a ativação com pontuação, caixa e no meio da frase', () => {
    expect(contem('Bom dia!', ATIVACOES)).toBe(true);
    expect(contem('BOM DIA, senhor', ATIVACOES)).toBe(true);
    expect(contem('Jarvis, bom dia', ATIVACOES)).toBe(true);
    expect(contem('ei jarvis', ATIVACOES)).toBe(true);
  });

  it('as três saudações acordam o Jarvis, não só a da manhã', () => {
    expect(contem('Boa tarde', ATIVACOES)).toBe(true);
    expect(contem('BOA NOITE, senhor', ATIVACOES)).toBe(true);
    expect(contem('Jarvis, boa noite', ATIVACOES)).toBe(true);
  });

  it('não casa por pedaço de palavra: "simplesmente" não é um "sim"', () => {
    expect(contem('simplesmente não', CONFIRMACOES)).toBe(false);
    expect(contem('bomba', ATIVACOES)).toBe(false);
    expect(contem('jarvisão', ATIVACOES)).toBe(false);
  });

  it('aceita as formas de dizer sim, e recusa o resto', () => {
    expect(contem('sim', CONFIRMACOES)).toBe(true);
    expect(contem('Sim, quero.', CONFIRMACOES)).toBe(true);
    expect(contem('claro', CONFIRMACOES)).toBe(true);
    expect(contem('não', CONFIRMACOES)).toBe(false);
    expect(contem('', CONFIRMACOES)).toBe(false);
  });
});

describe('EscutaService', () => {
  it('sem SpeechRecognition no navegador, fica inerte em vez de estourar', async () => {
    const escuta = TestBed.inject(EscutaService);

    expect(escuta.disponivel).toBe(false);
    expect(escuta.ligada()).toBe(false);

    // Tudo isto é chamado pela tela; nada pode quebrar onde o recurso não existe.
    escuta.escutar(() => {});
    escuta.ligar();
    escuta.alternar();
    escuta.soltarMicrofone();

    expect(escuta.ligada()).toBe(false);
    expect(escuta.ouvindo()).toBe(false);
    await expect(escuta.ouvirPor(10)).resolves.toBe('');
  });
});
