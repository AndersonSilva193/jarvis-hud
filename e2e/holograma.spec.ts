import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Uma peça de cada forma, no formato do evento `peca` do `HologramaController`. */
const peca = (id: string, forma: string, posicao: number[], tamanho: number[], extra: Record<string, unknown> = {}) => ({
  id, nome: id.replace(/_/g, ' '), grupo: forma, forma, posicao, rotacao: [0, 0, 0], tamanho, cor: '#22d3ee',
  explosao: [0, 1, 0], opacidade: 1, contorno: true, pontos: null, ...extra,
});
const PECAS = [
  peca('pedestal', 'cyl', [0, -2.1, 0], [1.4, 1.5, 0.12], { opacidade: 0.25, explosao: [0, -1, 0] }),
  peca('anel', 'tor', [0, -2, 0], [1.5, 0.03], { rotacao: [90, 0, 0] }),
  peca('fita', 'helix', [0, 0.6, 0], [1, 5, 2.5, 0.06], { cor: '#a78bfa', explosao: [1, 0, 0] }),
  peca('nucleo', 'sph', [0, 0.6, 0], [0.5], { cor: '#f472b6' }),
  peca('caixa', 'box', [2.2, -1.4, 0], [0.8, 0.8, 0.8], { cor: '#fbbf24', explosao: [1, 0, 0] }),
  peca('cone', 'cone', [-2.2, -1.4, 0], [0.4, 0.9], { cor: '#34d399', explosao: [-1, 0, 0] }),
  peca('capsula', 'cap', [0, -1.4, 2], [0.25, 0.6], { explosao: [0, 0, 1] }),
  peca('arruela', 'ring', [0, -1.4, -2], [0.3, 0.5]),
  peca('tubo', 'tube', [0, 3.4, 0], [0.05], { pontos: [[-1, 0, 0], [0, 0.6, 0], [1, 0, 0]], explosao: null }),
  peca('eixo', 'line', [0, 0, 0], [], { pontos: [[0, -2, 0], [0, 3.5, 0]], opacidade: 0.3 }),
];
const evento = (nome: string, dados: unknown) => `event:${nome}\ndata:${JSON.stringify(dados)}\n\n`;
const STREAM =
  ':ok\n\n' +
  evento('meta', { nome: 'DNA', categoria: 'biologia', descricao: 'Trecho de dupla hélice.' }) +
  PECAS.map((p) => evento('peca', p)).join('') +
  evento('peca', { ...PECAS[0], forma: 'piramide' }) +
  evento('fim', { pecas: PECAS.length, avisos: 0 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-hud.api-url', 'https://api.hud.test'); localStorage.setItem('jarvis-hud.token', 'token-de-teste');
    Object.assign(window, { SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
    class FonteTeste extends EventTarget {
      static CLOSED = 2; readyState = 1; onopen: (() => void) | null = null;
      constructor() { super(); setTimeout(() => this.onopen?.(), 0); }
      close() {}
    }
    Object.assign(window, { EventSource: FonteTeste });
  });
  await page.route('https://api.hud.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const corpo = path.endsWith('/historico') ? { sessao: 'teste', revisao: 0, trocas: [], emAndamento: null, ultima: null } : null;
    await route.fulfill({ status: path === '/api/tela/estado' ? 204 : 200, contentType: 'application/json', body: path === '/api/tela/estado' ? '' : JSON.stringify(corpo) });
  });
  await page.goto('/'); await expect(page.locator('.orbe--livre')).toBeVisible();
});

test('holograma monta o exemplo pelo stream com Bearer, explode e fecha com Esc', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  let autorizacao = '';
  await page.route('https://api.hud.test/api/holograma/exemplo/dna', async (route) => {
    autorizacao = route.request().headers()['authorization'] ?? '';
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: STREAM });
  });

  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  await expect(page.locator('app-holograma-view')).toBeVisible();
  await expect(page.locator('.orbe--recuado')).toHaveCount(1);
  await page.getByRole('button', { name: 'DNA' }).click();

  // A peça de forma desconhecida é descartada pelo validador da HUD.
  await expect(page.locator('app-holograma-view [role=status]')).toHaveText(`${PECAS.length} peças`);
  expect(autorizacao).toBe('Bearer token-de-teste');
  await expect(page.getByRole('img', { name: `Holograma de DNA, ${PECAS.length} peças` })).toBeVisible();
  await expect(page.locator('app-holograma-view canvas')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByLabel('Vista explodida').fill('100');
  await page.getByRole('button', { name: 'Centralizar' }).click();
  await page.screenshot({ path: test.info().outputPath('holograma.png') });
  await page.getByRole('button', { name: 'Resetar' }).click();
  await expect(page.getByLabel('Vista explodida')).toHaveValue('0');

  await page.keyboard.press('Escape');
  await expect(page.locator('app-holograma-view')).toHaveCount(0);
  await expect(page.locator('.orbe--livre')).toBeVisible();
  expect(erros).toEqual([]);
});

test('holograma explica o token recusado', async ({ page }) => {
  await page.route('https://api.hud.test/api/holograma/exemplo/atomo', (route) => route.fulfill({ status: 401, body: '' }));
  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  await page.getByRole('button', { name: 'Átomo' }).click();
  await expect(page.locator('app-holograma-view [role=status]')).toHaveText('Token recusado pela API.');
});
