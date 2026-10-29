import { test, expect } from '@playwright/test';

// A câmera falsa do Chrome: um vídeo sintético, sem mão nenhuma, e a permissão já concedida.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

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

test('gestos ligam com wasm e modelo da própria HUD, sem pedido para fora, e desligam ao fechar', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  const externos: string[] = [];
  const doMediaPipe: string[] = [];
  page.on('request', (pedido) => {
    const url = new URL(pedido.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'api.hud.test' && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob')) externos.push(pedido.url());
    if (url.pathname.includes('/mediapipe/')) doMediaPipe.push(url.pathname);
    // A imagem nunca sobe: nenhum POST leva corpo binário para a API.
    if (pedido.method() !== 'GET' && /image|octet/.test(pedido.headers()['content-type'] ?? '')) externos.push(`upload ${pedido.url()}`);
  });

  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  await page.getByRole('button', { name: 'Gestos' }).click();
  // O wasm tem ~13 MB e o modelo ~8 MB: o primeiro carregamento demora.
  await expect(page.locator('app-preview-gestos .indicador')).toHaveText('Câmera ligada', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Gestos' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('app-preview-gestos .gesto')).toHaveText('Sem mão');
  // O detector roda sobre os quadros do vídeo: espera alguns ciclos sem erro.
  await page.waitForTimeout(1_500);

  expect(doMediaPipe).toEqual(expect.arrayContaining(['/mediapipe/hand_landmarker.task']));
  expect(doMediaPipe.some((p) => /\/mediapipe\/wasm\/vision_wasm_(nosimd_)?internal\.wasm$/.test(p))).toBe(true);
  expect(externos).toEqual([]);

  await page.getByRole('button', { name: 'Esconder câmera' }).click();
  await expect(page.locator('app-preview-gestos .indicador')).toHaveText('Câmera ligada');
  await page.getByRole('button', { name: 'Mostrar câmera' }).click();

  await page.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.locator('app-holograma-view')).toHaveCount(0);
  const trilhasVivas = await page.evaluate(() =>
    [...document.querySelectorAll('video')].flatMap((v) => (v.srcObject instanceof MediaStream ? v.srcObject.getTracks() : [])).filter((t) => t.readyState === 'live').length,
  );
  expect(trilhasVivas).toBe(0);
  expect(erros).toEqual([]);
});
