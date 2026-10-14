import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarraConversaComponent } from './barra-conversa';
import { RespostaConversaComponent } from './resposta-conversa';
import { AnexoConversaComponent } from './anexo-conversa';
import { JarvisApiService } from '../../nucleo/jarvis-api.service';
import type { RespostaConversa, AnexoConversa } from '../../nucleo/conversa.modelos';

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});
describe('componentes da conversa', () => {
  it('Enter envia, Shift+Enter preserva a linha e espera permite editar sem reenviar', () => {
    const tela = TestBed.createComponent(BarraConversaComponent);
    tela.detectChanges();
    const enviar = vi.fn();
    tela.componentInstance.enviar.subscribe(enviar);
    const texto: HTMLTextAreaElement = tela.nativeElement.querySelector('textarea');
    texto.value = 'Olá';
    texto.dispatchEvent(new Event('input'));
    tela.detectChanges();
    texto.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    expect(enviar).not.toHaveBeenCalled();
    texto.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(enviar).toHaveBeenCalledOnce();
    tela.componentRef.setInput('ocupada', true);
    tela.detectChanges();
    texto.value = 'Próxima pergunta';
    texto.dispatchEvent(new Event('input'));
    texto.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(enviar).toHaveBeenCalledOnce();
    expect(texto.disabled).toBe(false);
    expect(tela.componentInstance.texto()).toBe('Próxima pergunta');
    expect(tela.nativeElement.querySelector('[aria-label="Ditar mensagem"]')).toBeNull();
    expect(tela.nativeElement.querySelector('label')?.htmlFor).toBe(texto.id);
  });
  it('a barra começa compacta, expande ao clicar e não recolhe com rascunho ou ditado', () => {
    const tela = TestBed.createComponent(BarraConversaComponent);
    tela.detectChanges();
    const editor = (): HTMLElement => tela.nativeElement.querySelector('#editor-conversa');
    const recolher = (): HTMLButtonElement =>
      tela.nativeElement.querySelector('[aria-label="Recolher conversa"]');
    expect(editor().hidden).toBe(true);

    tela.nativeElement.querySelector('.compacta button').click();
    tela.detectChanges();
    expect(editor().hidden).toBe(false);
    expect(recolher().disabled).toBe(false);

    // Rascunho em cima da mesa: recolher apagaria o que a pessoa está escrevendo.
    const texto: HTMLTextAreaElement = tela.nativeElement.querySelector('textarea');
    texto.value = 'Meio de uma frase';
    texto.dispatchEvent(new Event('input'));
    tela.detectChanges();
    expect(recolher().disabled).toBe(true);

    recolher().click();
    tela.detectChanges();
    expect(editor().hidden).toBe(false);
    expect(tela.componentInstance.texto()).toBe('Meio de uma frase');

    // Ditado em curso também segura o campo aberto, mesmo sem texto ainda.
    tela.componentInstance.texto.set('');
    tela.componentRef.setInput('ditando', true);
    tela.detectChanges();
    expect(editor().hidden).toBe(false);
    expect(recolher().disabled).toBe(true);
  });
  it('só mostra confirmação com metadados e emite os dois comandos explícitos', () => {
    const tela = TestBed.createComponent(RespostaConversaComponent);
    const comando = vi.fn();
    tela.componentInstance.comando.subscribe(comando);
    const r: RespostaConversa = {
      id: '1',
      canal: 'hud',
      texto: 'Use 1234',
      anexos: [],
      confirmacao: null,
      concluidoEm: '',
      erro: null,
    };
    tela.componentRef.setInput('resposta', r);
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('.codigo')).toBeNull();
    tela.componentRef.setInput('resposta', {
      ...r,
      confirmacao: {
        codigo: '1234',
        descricao: 'Exemplo simulado',
        expiraEm: new Date(Date.now() + 60000).toISOString(),
      },
    });
    tela.detectChanges();
    const botoes: NodeListOf<HTMLButtonElement> = tela.nativeElement.querySelectorAll('button');
    botoes[0].click();
    botoes[1].click();
    expect(comando.mock.calls).toEqual([['confirmo 1234'], ['cancelo 1234']]);
    tela.componentRef.setInput('resposta', {
      ...r,
      confirmacao: { codigo: '1234', descricao: 'Expirado', expiraEm: '2020-01-01T00:00:00Z' },
    });
    tela.detectChanges();
    expect(botoes[0].disabled).toBe(true);
  });
  it('anexo expirado não busca arquivo e links externos não carregam credenciais', () => {
    const baixar = vi.fn();
    TestBed.configureTestingModule({
      providers: [{ provide: JarvisApiService, useValue: { baixarAnexo: baixar } }],
    });
    const tela = TestBed.createComponent(AnexoConversaComponent);
    const anexo: AnexoConversa = {
      id: 'a',
      tipo: 'arquivo',
      nome: 'Relatório',
      mime: 'application/octet-stream',
      url: '/api/anexos/a',
      expiraEm: '2020-01-01T00:00:00Z',
    };
    tela.componentRef.setInput('anexo', anexo);
    tela.detectChanges();
    expect(baixar).not.toHaveBeenCalled();
    expect(tela.nativeElement.textContent).toContain('expirado');
    tela.componentRef.setInput('anexo', {
      ...anexo,
      tipo: 'link',
      url: 'https://example.org/fonte',
    });
    tela.detectChanges();
    const link: HTMLAnchorElement = tela.nativeElement.querySelector('a');
    expect(link.href).toBe('https://example.org/fonte');
    expect(link.rel).toContain('noreferrer');
    tela.componentRef.setInput('anexo', { ...anexo, tipo: 'link', url: 'javascript:alert(1)' });
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('a')).toBeNull();
  });
  it('revoga URL local ao remover card de imagem', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: JarvisApiService,
          useValue: { baixarAnexo: async () => new Blob(['imagem'], { type: 'image/png' }) },
        },
      ],
    });
    const criar = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:imagem');
    const revogar = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const tela = TestBed.createComponent(AnexoConversaComponent);
    tela.componentRef.setInput('anexo', {
      id: 'a',
      tipo: 'imagem',
      nome: 'Print',
      mime: 'image/png',
      url: '/api/anexos/a',
      expiraEm: null,
    });
    tela.detectChanges();
    await tela.whenStable();
    tela.detectChanges();
    expect(criar).toHaveBeenCalledOnce();
    expect(tela.nativeElement.querySelector('img')?.alt).toBe('Print');
    tela.destroy();
    expect(revogar).toHaveBeenCalledWith('blob:imagem');
  });
});
