import { afterEach, describe, expect, it, vi } from 'vitest';

import { explicar, impedimentoDaCamera } from './rastreio-de-mao.service';

describe('o rastreio de mão sem câmera', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('página sem HTTPS nem tenta pedir a câmera', () => {
    vi.stubGlobal('isSecureContext', false);
    expect(impedimentoDaCamera()).toBe('Gestos precisam de HTTPS.');
  });

  it('navegador sem getUserMedia avisa em vez de quebrar', () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { mediaDevices: undefined });
    expect(impedimentoDaCamera()).toBe('Este navegador não dá acesso à câmera.');
  });

  it('cada recusa da câmera vira uma frase curta', () => {
    expect(explicar(new DOMException('', 'NotAllowedError'))).toBe('Permissão da câmera negada.');
    expect(explicar(new DOMException('', 'NotFoundError'))).toBe('Nenhuma câmera encontrada.');
    expect(explicar(new DOMException('', 'NotReadableError'))).toBe('A câmera está em uso por outro programa.');
    expect(explicar(new Error('wasm'))).toBe('Não foi possível ligar os gestos.');
  });
});
