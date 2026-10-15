import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CardPaginaComponent } from './card-pagina';
import { ConfigStore } from '../../nucleo/config.store';

afterEach(() => TestBed.resetTestingModule());
describe('páginas externas', () => {
  function montar(url: string, incorporavel = true) {
    TestBed.inject(ConfigStore).urlApi.set('https://api.hud.test');
    const f = TestBed.createComponent(CardPaginaComponent);
    f.componentRef.setInput('dados', { url, incorporavel, titulo: 'Página', descricao: '<b>Descrição</b>', imagem: '', site: 'example.com' }); f.detectChanges(); return f;
  }
  it('incorpora somente URL externa, com sandbox e sem token', () => {
    const f = montar('https://example.com/'); const iframe = f.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.src).toBe('https://example.com/'); expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-popups'); expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
    iframe.dispatchEvent(new Event('error')); f.detectChanges(); expect(f.nativeElement.querySelector('iframe')).toBeNull(); expect(f.nativeElement.textContent).toContain('<b>Descrição</b>'); expect(f.nativeElement.querySelector('b')).toBeNull();
  });
  it.each(['https://api.hud.test/admin', location.origin + '/configuracao', 'javascript:alert(1)', 'http://example.com/'])('mostra prévia, sem incorporar %s', url => expect(montar(url).nativeElement.querySelector('iframe')).toBeNull());
  it('respeita incorporavel falso', () => expect(montar('https://example.com/', false).nativeElement.querySelector('iframe')).toBeNull());
});
