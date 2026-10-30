import { test, expect, type WebSocketRoute } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Os segredos do canal têm 43 caracteres de base64url. */
const CODIGO = 'c'.repeat(43);
const RETOMADA = 'r'.repeat(43);
const API = 'https://api.hud.test';

test.describe('PC: o celular como controle do holograma', () => {
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
    await page.route(`${API}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const corpo = path.endsWith('/historico') ? { sessao: 'teste', revisao: 0, trocas: [], emAndamento: null, ultima: null } : path.endsWith('/galeria') ? [] : null;
      await route.fulfill({ status: path === '/api/tela/estado' ? 204 : 200, contentType: 'application/json', body: path === '/api/tela/estado' ? '' : JSON.stringify(corpo) });
    });
    await page.goto('/'); await expect(page.locator('.orbe--livre')).toBeVisible();
  });

  test('mostra o QR, aplica os gestos do celular, avisa a queda e desconecta', async ({ page }) => {
    const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
    let autorizacao = '';
    await page.route(`${API}/api/holograma/controle/bilhete`, async (route) => {
      autorizacao = route.request().headers()['authorization'] ?? '';
      await route.fulfill({ json: { bilhete: 'b'.repeat(43), validade: 30 } });
    });
    let servidor: WebSocketRoute | null = null;
    let urlDoSocket = '';
    const recebidas: string[] = [];
    await page.routeWebSocket(/\/ws\/holograma/, (ws) => {
      servidor = ws; urlDoSocket = ws.url();
      ws.onMessage((m) => {
        recebidas.push(String(m));
        if (JSON.parse(String(m)).t === 'parear') ws.send(JSON.stringify({ t: 'par', codigo: CODIGO, expira: 300 }));
      });
    });
    const mandar = (m: unknown) => servidor!.send(JSON.stringify(m));

    await page.getByRole('button', { name: 'Holograma', exact: true }).click();
    await page.getByRole('button', { name: 'Usar celular como controle' }).click();
    const dialogo = page.getByRole('dialog', { name: 'Celular como controle' });
    await expect(dialogo.getByRole('img', { name: 'QR code que abre o controle no celular' })).toBeVisible();
    expect(autorizacao).toBe('Bearer token-de-teste');
    expect(urlDoSocket).toBe(`wss://api.hud.test/ws/holograma?bilhete=${'b'.repeat(43)}`);
    await expect(dialogo).toContainText(`/controle?par=${CODIGO}&api=https%3A%2F%2Fapi.hud.test`);
    await expect(dialogo).toContainText(/vale por 5:00|vale por 4:5\d/);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    mandar({ t: 'controle', e: 'conectado', retomada: RETOMADA });
    await expect(dialogo).toBeHidden();
    await expect(page.getByText('Celular conectado')).toBeVisible();

    // Os mesmos caminhos do gesto local: explosão absoluta (câmera) e relativa (touchpad).
    mandar([{ t: 'explodir', v: 0.6 }]);
    await expect(page.getByLabel('Vista explodida')).toHaveValue('60');
    mandar({ t: 'explodir', dv: 0.2 });
    await expect(page.getByLabel('Vista explodida')).toHaveValue('80');
    mandar([{ t: 'girar', dx: 0.05, dy: 0 }, { t: 'zoom', f: 1.1 }, { t: 'resetar' }]);
    await expect(page.getByLabel('Vista explodida')).toHaveValue('0');

    // O eco volta na hora: é o PC que a medição de latência quer ver.
    mandar({ t: 'eco', n: 5 });
    await expect.poll(() => recebidas).toContain('{"t":"eco","n":5}');

    mandar({ t: 'controle', e: 'caiu' });
    await expect(page.getByRole('status').filter({ hasText: 'Celular desconectado — de volta ao mouse e à câmera.' })).toBeVisible();
    await expect(page.getByText('Celular caiu')).toBeVisible();
    mandar({ t: 'controle', e: 'voltou' });
    await expect(page.getByText('Celular conectado')).toBeVisible();

    await page.getByRole('button', { name: 'Desconectar' }).click();
    await expect.poll(() => recebidas).toContain('{"t":"desconectar"}');
    mandar({ t: 'controle', e: 'encerrado' });
    await expect(page.getByRole('button', { name: 'Usar celular como controle' })).toBeVisible();
    expect(erros).toEqual([]);
  });
});

test.describe('celular: a página /controle', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('entra pelo QR, manda o touchpad, mede a latência, reconecta e sai', async ({ page }) => {
    const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
    const conexoes: { url: string; ws: WebSocketRoute; recebidas: string[] }[] = [];
    await page.routeWebSocket(/\/ws\/holograma/, (ws) => {
      const c = { url: ws.url(), ws, recebidas: [] as string[] };
      conexoes.push(c);
      ws.onMessage((m) => {
        c.recebidas.push(String(m));
        // O servidor repassa o eco ao PC, que devolve na hora.
        for (const e of [JSON.parse(String(m))].flat()) if (e.t === 'eco') ws.send(JSON.stringify(e));
      });
      ws.send(JSON.stringify({ t: 'pareado', retomada: RETOMADA }));
    });

    await page.goto(`/controle?par=${CODIGO}&api=${encodeURIComponent(API)}`);
    await expect(page.getByRole('status').filter({ hasText: 'Conectado ao PC' })).toBeVisible();
    expect(conexoes[0]!.url).toBe(`wss://api.hud.test/ws/holograma?par=${CODIGO}`);
    // O código é de uso único: sai da barra de endereço.
    await expect(page).toHaveURL(/\/controle$/);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    const area = page.getByRole('region', { name: /Um dedo gira/ });
    const caixa = (await area.boundingBox())!;
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(caixa.x + caixa.width / 2 + i * 12, caixa.y + caixa.height / 2);
    await page.mouse.up();
    // O fim do arrasto é o último: com ele chegou tudo o que o agregador juntou antes.
    await expect.poll(() => conexoes[0]!.recebidas.join('\n')).toContain('{"t":"toque","v":0}');
    const eventos = conexoes[0]!.recebidas.flatMap((m) => [JSON.parse(m)].flat()) as { t: string; dx?: number }[];
    expect(eventos[0]).toEqual({ t: 'toque', v: 1 });
    expect(eventos.filter((e) => e.t === 'girar').reduce((s, e) => s + e.dx!, 0)).toBeCloseTo(120 / caixa.height, 2);
    expect(eventos.some((e) => e.t === 'toque' && (e as { v?: number }).v === 0)).toBe(true);

    // O eco de 2 s em 2 s vira a ida e volta na tela.
    await expect(page.getByText(/Ida e volta até o PC: \d/)).toBeVisible({ timeout: 5_000 });

    // A rede cai: o celular volta sozinho com a chave de retomada.
    await conexoes[0]!.ws.close({ code: 4001, reason: 'rede' });
    await expect.poll(() => conexoes.length, { timeout: 5_000 }).toBe(2);
    expect(conexoes[1]!.url).toBe(`wss://api.hud.test/ws/holograma?retomada=${RETOMADA}`);
    await expect(page.getByRole('status').filter({ hasText: 'Conectado ao PC' })).toBeVisible();

    conexoes[1]!.ws.send(JSON.stringify({ t: 'hud', e: 'caiu' }));
    await expect(page.getByRole('status').filter({ hasText: 'PC fora do ar' })).toBeVisible();
    conexoes[1]!.ws.send(JSON.stringify({ t: 'hud', e: 'voltou' }));
    await expect(page.getByRole('status').filter({ hasText: 'Conectado ao PC' })).toBeVisible();

    await page.getByRole('button', { name: 'Sair' }).click();
    await expect(page.getByRole('heading', { name: 'Controle encerrado.' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(erros).toEqual([]);
  });

  test('sem QR, explica como entrar', async ({ page }) => {
    await page.goto('/controle');
    await expect(page.getByRole('heading', { name: 'Abra pelo QR code do PC' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});
