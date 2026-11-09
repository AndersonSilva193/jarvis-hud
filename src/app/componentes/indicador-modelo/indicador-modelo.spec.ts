import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IndicadorModeloComponent } from './indicador-modelo';
import { JarvisApiService } from '../../nucleo/jarvis-api.service';
import { ModoIaService } from '../../nucleo/modo-ia.service';
import type { EstadoModoIa } from '../../nucleo/modo-ia.modelos';

const LOCAL: EstadoModoIa = { modo: 'LOCAL', provedorEfetivo: 'local', modelo: 'Qwen 9B', motivoFallback: null };
const CLAUDE: EstadoModoIa = { modo: 'CLAUDE', provedorEfetivo: 'claude', modelo: 'Haiku', motivoFallback: null };
const AUTO_LOCAL: EstadoModoIa = { ...LOCAL, modo: 'AUTO' };
const FALLBACK: EstadoModoIa = {
  modo: 'LOCAL',
  provedorEfetivo: 'claude',
  modelo: 'Haiku',
  motivoFallback: 'PC sem VRAM livre',
};

describe('indicador do modelo de IA', () => {
  let api: { modoIa: ReturnType<typeof vi.fn>; definirModoIa: ReturnType<typeof vi.fn> };
  let tela: ComponentFixture<IndicadorModeloComponent>;
  let servico: ModoIaService;

  const el = () => tela.nativeElement as HTMLElement;
  const gatilho = () => el().querySelector<HTMLButtonElement>('.gatilho')!;
  const itens = () => [...el().querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
  const painel = () => el().querySelector<HTMLElement>('.painel')!;
  const aviso = () => el().querySelector('[role="status"]')!.textContent!.trim();
  const teclar = (alvo: Element, key: string) => {
    const evento = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    alvo.dispatchEvent(evento);
    return evento;
  };

  async function montar(inicial: EstadoModoIa | null = LOCAL): Promise<void> {
    api.modoIa.mockResolvedValue(inicial);
    tela = TestBed.createComponent(IndicadorModeloComponent);
    servico = TestBed.inject(ModoIaService);
    tela.detectChanges();
    await tela.whenStable();
    tela.detectChanges();
  }

  beforeEach(() => {
    api = { modoIa: vi.fn(), definirModoIa: vi.fn() };
    TestBed.configureTestingModule({ providers: [{ provide: JarvisApiService, useValue: api }] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  describe('render de cada estado', () => {
    it('local: rótulo, cor ciano e aria-label com o modo atual', async () => {
      await montar(LOCAL);
      expect(api.modoIa).toHaveBeenCalledOnce();
      expect(gatilho().textContent).toContain('Local · Qwen 9B');
      expect(gatilho().classList).toContain('gatilho--local');
      expect(gatilho().getAttribute('aria-label')).toBe('Modelo de IA: Local · Qwen 9B. Trocar modo');
      expect(gatilho().querySelector('.atencao')).toBeNull();
    });

    it('claude: rótulo e cor azul-energia', async () => {
      await montar(CLAUDE);
      expect(gatilho().textContent).toContain('Claude · Haiku');
      expect(gatilho().classList).toContain('gatilho--claude');
    });

    it('auto: mostra a seta para o provedor escolhido', async () => {
      await montar(AUTO_LOCAL);
      expect(gatilho().textContent).toContain('Auto → Local');
    });

    it('fallback: sinal de atenção, motivo no tooltip, no aria-label e no menu', async () => {
      await montar(FALLBACK);
      expect(gatilho().classList).toContain('gatilho--fallback');
      expect(gatilho().querySelector('.atencao')).not.toBeNull();
      expect(gatilho().title).toBe('PC sem VRAM livre');
      expect(gatilho().getAttribute('aria-label')).toContain('Fallback: PC sem VRAM livre.');
      expect(el().querySelector('.nota')!.textContent).toContain('PC sem VRAM livre');
    });

    it('sem resposta do GET: selo neutro, sem quebrar', async () => {
      api.modoIa.mockRejectedValue(new Error('fora do ar'));
      tela = TestBed.createComponent(IndicadorModeloComponent);
      tela.detectChanges();
      await tela.whenStable();
      tela.detectChanges();
      expect(gatilho().textContent).toContain('IA · —');
      expect(gatilho().hasAttribute('title')).toBe(false);
    });
  });

  describe('menu', () => {
    it('abre pelo toque com os três modos e o atual marcado', async () => {
      await montar(AUTO_LOCAL);
      expect(painel().hidden).toBe(true);
      expect(gatilho().getAttribute('aria-expanded')).toBe('false');

      gatilho().click();
      tela.detectChanges();
      expect(painel().hidden).toBe(false);
      expect(gatilho().getAttribute('aria-expanded')).toBe('true');
      expect(itens().map((i) => i.textContent!.trim())).toEqual(['Auto', 'Local', 'Claude']);
      expect(itens().map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    });

    it('teclado: ↓ abre no atual, setas navegam e Esc fecha devolvendo o foco', async () => {
      await montar(LOCAL);
      gatilho().focus();
      teclar(gatilho(), 'ArrowDown');
      tela.detectChanges();
      await tela.whenStable();
      expect(document.activeElement).toBe(itens()[1]);
      expect(itens()[1].tabIndex).toBe(0);

      teclar(itens()[1], 'ArrowDown');
      tela.detectChanges();
      expect(document.activeElement).toBe(itens()[2]);
      teclar(itens()[2], 'ArrowDown');
      expect(document.activeElement).toBe(itens()[0]);
      teclar(itens()[0], 'End');
      expect(document.activeElement).toBe(itens()[2]);

      const esc = teclar(itens()[2], 'Escape');
      tela.detectChanges();
      expect(esc.defaultPrevented).toBe(true);
      expect(painel().hidden).toBe(true);
      expect(document.activeElement).toBe(gatilho());
    });

    it('tocar fora fecha', async () => {
      await montar(LOCAL);
      gatilho().click();
      tela.detectChanges();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      tela.detectChanges();
      expect(painel().hidden).toBe(true);
    });
  });

  describe('troca de modo', () => {
    it('POST com sucesso: pede ao servidor e só muda quando o SSE confirma', async () => {
      await montar(LOCAL);
      api.definirModoIa.mockResolvedValue(undefined);
      gatilho().click();
      tela.detectChanges();
      itens()[2].click();
      tela.detectChanges();
      await tela.whenStable();
      tela.detectChanges();

      expect(api.definirModoIa).toHaveBeenCalledWith('CLAUDE');
      expect(painel().hidden).toBe(true);
      expect(gatilho().textContent).toContain('Local · Qwen 9B');
      expect(servico.pedido()).toBe('CLAUDE');

      servico.receber(CLAUDE);
      tela.detectChanges();
      expect(gatilho().textContent).toContain('Claude · Haiku');
      expect(servico.pedido()).toBeNull();
    });

    it('escolher o modo atual não faz POST', async () => {
      await montar(LOCAL);
      gatilho().click();
      tela.detectChanges();
      itens()[1].click();
      expect(api.definirModoIa).not.toHaveBeenCalled();
    });

    it('POST com falha: aviso curto e estado anterior mantido', async () => {
      await montar(LOCAL);
      vi.useFakeTimers();
      api.definirModoIa.mockRejectedValue(new Error('500'));
      gatilho().click();
      tela.detectChanges();
      itens()[0].click();
      await vi.advanceTimersByTimeAsync(0);
      tela.detectChanges();

      expect(aviso()).toBe('Não consegui trocar o modo da IA');
      expect(gatilho().textContent).toContain('Local · Qwen 9B');
      expect(servico.pedido()).toBeNull();

      await vi.advanceTimersByTimeAsync(4_000);
      tela.detectChanges();
      expect(aviso()).toBe('');
    });
  });

  describe('atualização pelo SSE', () => {
    it('cada evento repinta o selo, inclusive entrando e saindo do fallback', async () => {
      await montar(LOCAL);
      servico.receber(FALLBACK);
      tela.detectChanges();
      expect(gatilho().textContent).toContain('Claude · Haiku');
      expect(gatilho().classList).toContain('gatilho--fallback');

      servico.receber(AUTO_LOCAL);
      tela.detectChanges();
      expect(gatilho().textContent).toContain('Auto → Local');
      expect(gatilho().classList).not.toContain('gatilho--fallback');
    });

    it('um GET que volta depois do SSE não sobrescreve o estado mais novo', async () => {
      let responder!: (valor: unknown) => void;
      api.modoIa.mockReturnValue(new Promise((r) => (responder = r)));
      tela = TestBed.createComponent(IndicadorModeloComponent);
      servico = TestBed.inject(ModoIaService);
      tela.detectChanges();

      servico.receber(CLAUDE);
      responder(LOCAL);
      await tela.whenStable();
      tela.detectChanges();
      expect(gatilho().textContent).toContain('Claude · Haiku');
    });
  });
});
