import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('no celular, a galeria cheia rola de lado sem alargar o holograma', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-hud.api-url', 'https://api.hud.test'); localStorage.setItem('jarvis-hud.token', 'token-de-teste');
    class FonteTeste extends EventTarget {
      static CLOSED = 2; readyState = 1; onopen: (() => void) | null = null;
      constructor() { super(); setTimeout(() => this.onopen?.(), 0); }
      close() {}
    }
    Object.assign(window, { EventSource: FonteTeste, SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
  });
  const itens = [...Array(8)].map((_, i) => ({
    id: `item_${i}`, nome: `Vírus da gripe ${i}`, pecas: 40, data: '', provedor: 'anthropic', detalhe: 'normal', objeto: 'vírus', fixo: i < 3, miniatura: false,
  }));
  await page.route('https://api.hud.test/**', (route) => {
    const galeria = new URL(route.request().url()).pathname.endsWith('/galeria');
    return route.fulfill({ status: 200, contentType: 'application/json', body: galeria ? JSON.stringify(itens) : 'null' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  await page.getByRole('button', { name: /^Galeria/ }).click();
  await expect(page.getByText('Vírus da gripe 7')).toBeAttached();

  const medidas = await page.evaluate(() => {
    const largura = document.documentElement.clientWidth;
    const transbordam = [...document.querySelectorAll('app-holograma-view > *')]
      .filter((e) => e.getBoundingClientRect().right > largura + 1)
      .map((e) => e.className);
    return { largura, pagina: document.documentElement.scrollWidth, transbordam };
  });
  expect(medidas.transbordam).toEqual([]);
  expect(medidas.pagina).toBe(medidas.largura);
});

test('a galeria é um botão que expande, como o Histórico', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-hud.api-url', 'https://api.hud.test'); localStorage.setItem('jarvis-hud.token', 'token-de-teste');
    class FonteTeste extends EventTarget {
      static CLOSED = 2; readyState = 1; onopen: (() => void) | null = null;
      constructor() { super(); setTimeout(() => this.onopen?.(), 0); }
      close() {}
    }
    Object.assign(window, { EventSource: FonteTeste, SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
  });
  const itens = [{ id: 'exemplo_dna', nome: 'DNA', pecas: 105, data: '', provedor: 'exemplo', detalhe: 'normal', objeto: 'dna', fixo: true, miniatura: false }];
  await page.route('https://api.hud.test/**', (route) => {
    const galeria = new URL(route.request().url()).pathname.endsWith('/galeria');
    return route.fulfill({ status: 200, contentType: 'application/json', body: galeria ? JSON.stringify(itens) : 'null' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await page.getByRole('button', { name: 'Holograma', exact: true }).click();

  // Recolhida: só o botão, com a contagem.
  const botao = page.getByRole('button', { name: 'Galeria · 1' });
  await expect(botao).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Abrir DNA' })).toHaveCount(0);

  await botao.click();
  const painel = page.getByRole('region', { name: 'Galeria' });
  await expect(painel).toBeFocused();
  await expect(page.getByRole('button', { name: 'Fechar galeria' })).toHaveAttribute('aria-expanded', 'true');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // Esc fecha só a galeria e devolve o foco ao botão; o holograma continua aberto.
  await page.keyboard.press('Escape');
  await expect(painel).toHaveCount(0);
  await expect(page.locator('app-holograma-view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Galeria · 1' })).toBeFocused();

  // Escolher um item recolhe a lista para a cena aparecer.
  await page.getByRole('button', { name: 'Galeria · 1' }).click();
  await page.getByRole('button', { name: 'Abrir DNA' }).click();
  await expect(painel).toHaveCount(0);
  expect(erros).toEqual([]);
});
