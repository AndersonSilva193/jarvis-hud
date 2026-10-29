import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { AJUSTES_PADRAO, AjustesDeGestosService, lerAjustesDeGestos } from './ajustes-de-gestos.service';
import { PerfilDoAparelhoService, detectarPerfil } from './perfil-do-aparelho.service';

const CHAVE = 'jarvis-hud.gestos.v1';

describe('os ajustes de gestos', () => {
  afterEach(() => localStorage.removeItem(CHAVE));

  it('o que está torto volta ao padrão, campo a campo', () => {
    expect(lerAjustesDeGestos(null)).toEqual(AJUSTES_PADRAO);
    expect(lerAjustesDeGestos({ perfil: 'tablet', sensibilidadeGiro: 'muito', inverterX: true, sensibilidadeZoom: 9 })).toEqual({
      ...AJUSTES_PADRAO,
      inverterX: true,
      sensibilidadeZoom: 3,
    });
  });

  it('alterar guarda no navegador e a próxima HUD lembra', () => {
    TestBed.inject(AjustesDeGestosService).alterar({ perfil: 'leve', sensibilidadeGiro: 1.5 });
    expect(JSON.parse(localStorage.getItem(CHAVE)!)).toMatchObject({ perfil: 'leve', sensibilidadeGiro: 1.5 });
    TestBed.resetTestingModule();
    expect(TestBed.inject(AjustesDeGestosService).ajustes()).toMatchObject({ perfil: 'leve', sensibilidadeGiro: 1.5 });
  });
});

describe('o perfil do aparelho', () => {
  afterEach(() => localStorage.removeItem(CHAVE));

  it('celular e tablet (dedo e tela pequena) são leves; notebook com toque não', () => {
    expect(detectarPerfil(true, 390)).toBe('leve');
    expect(detectarPerfil(true, 820)).toBe('leve');
    expect(detectarPerfil(true, 1200)).toBe('pc');
    expect(detectarPerfil(false, 390)).toBe('pc');
  });

  it('a escolha manual passa por cima da detecção, e os parâmetros seguem o perfil', () => {
    const perfil = TestBed.inject(PerfilDoAparelhoService);
    const ajustes = TestBed.inject(AjustesDeGestosService);
    perfil.detectado.set('pc');
    expect(perfil.parametros().maosMax).toBe(2);
    ajustes.alterar({ perfil: 'leve' });
    expect(perfil.perfil()).toBe('leve');
    expect(perfil.parametros()).toMatchObject({ maosMax: 1, deteccoesPorSegundo: 15, pixelRatioMaximo: 1, camera: { largura: 480, altura: 360 } });
    ajustes.alterar({ perfil: 'auto' });
    expect(perfil.perfil()).toBe('pc');
  });
});
