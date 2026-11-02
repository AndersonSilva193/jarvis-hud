import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { RespostaConversa } from '../src/app/nucleo/conversa.modelos';

type JanelaTeste = Window & {
  sseTeste: EventTarget;
  audioTeste: { currentTime: number; paused: boolean; onended: (() => void) | null };
};

async function emitir(page: Page, nome: string, dados: unknown): Promise<void> {
  await page.evaluate(
    ({ nome, dados }) => {
      (window as JanelaTeste).sseTeste.dispatchEvent(
        new MessageEvent(nome, { data: JSON.stringify(dados) }),
      );
    },
    { nome, dados },
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-hud.api-url', 'https://api.hud.test');
    localStorage.setItem('jarvis-hud.token', 'token-de-teste');
    class FonteTeste extends EventTarget {
      static CLOSED = 2;
      readyState = 1;
      onopen: (() => void) | null = null;
      constructor() {
        super();
        Object.assign(window, { sseTeste: this });
        setTimeout(() => this.onopen?.(), 0);
      }
      close(): void {}
    }
    class AudioTeste {
      src = '';
      duration = 12;
      currentTime = 0;
      paused = true;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        Object.assign(window, { audioTeste: this });
      }
      async play(): Promise<void> {
        this.paused = false;
      }
      pause(): void {
        this.paused = true;
      }
    }
    Object.assign(window, {
      EventSource: FonteTeste,
      Audio: AudioTeste,
      AudioContext: undefined,
      SpeechRecognition: undefined,
      webkitSpeechRecognition: undefined,
    });
  });
  await page.route('https://api.hud.test/**', async (route) => {
    const caminho = new URL(route.request().url()).pathname;
    const corpo = caminho.endsWith('/historico')
      ? { sessao: 'teste', revisao: 0, trocas: [], emAndamento: null, ultima: null }
      : caminho.endsWith('/sintetizar')
        ? { provedor: 'elevenlabs', url: '/api/voz/audio/teste' }
        : caminho.endsWith('/galeria')
          ? []
          : null;
    await route.fulfill({ json: corpo });
  });
  await page.goto('/');
  await expect(page.locator('.orbe--livre')).toBeVisible();
});

test('laterais reservam espaço, preservam rascunho e devolvem o foco', async ({ page }) => {
  const palco = page.locator('main');
  const larguraInicial = (await palco.boundingBox())!.width;
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Conversa', exact: true });
  await expect(dialogo).toBeVisible();
  await expect(page.locator('#painel-hud-titulo')).toBeFocused();
  await page.getByLabel('Sua mensagem').fill('Continuar estudando serotonina');
  const area = (await palco.boundingBox())!;
  const painel = (await dialogo.boundingBox())!;
  expect(painel.width).toBe(380);
  expect(area.width).toBeLessThan((await page.locator('.corpo-hud').boundingBox())!.width);
  expect(area.x + area.width).toBeLessThanOrEqual(painel.x);
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await expect(page.getByLabel('Sua mensagem')).toBeVisible();
  await expect(page.locator('#mensagem-jarvis')).toHaveCount(1);
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  await expect(page.getByLabel('Sua mensagem')).toHaveValue('Continuar estudando serotonina');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  await expect(page.getByRole('button', { name: 'Conversa', exact: true })).toBeFocused();
  await expect.poll(async () => (await palco.boundingBox())!.width).toBe(larguraInicial);
  await page.screenshot({ path: test.info().outputPath('hud-livre.png') });
});

test('pedido e fala não abrem o chat; legenda e resposta acompanham o áudio', async ({ page }) => {
  const resposta: RespostaConversa = {
    id: 'r1',
    canal: 'hud',
    texto: 'Texto completo para consulta posterior.',
    fala: 'Aqui está a molécula de serotonina, senhor. A visualização está pronta para explorar.',
    anexos: [],
    confirmacao: null,
    erro: null,
    concluidoEm: '2026-10-30T23:00:00Z',
  };
  let concluida = false;
  const pedido = {
    id: 'r1',
    canal: 'hud',
    estado: 'processando',
    texto: 'Mostre a molécula',
    iniciadoEm: '',
  };
  await page.route('https://api.hud.test/api/conversa/historico', (route) =>
    route.fulfill({
      json: {
        sessao: 'teste',
        revisao: concluida ? 1 : 0,
        trocas: [],
        emAndamento: concluida ? null : pedido,
        ultima: concluida ? resposta : null,
      },
    }),
  );
  await page.route('https://api.hud.test/api/conversa/ultima', (route) =>
    route.fulfill({ json: concluida ? resposta : null }),
  );
  await emitir(page, 'conversa.pensando', pedido);
  await expect(page.locator('#painel-hud')).toBeHidden();
  concluida = true;
  await emitir(page, 'conversa.resposta', resposta);
  const legenda = page.getByRole('region', { name: 'Legenda da fala' }).locator('p');
  await expect(legenda).toHaveText('Aqui');
  await expect(page.locator('#painel-hud')).toBeHidden();
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  await expect(page.locator('app-dialogo-conversa .fala')).toHaveText('JarvisAqui');
  await page.evaluate(() => {
    (window as JanelaTeste).audioTeste.currentTime = 6;
  });
  await expect(legenda).not.toHaveText('Aqui');
  await expect(page.locator('app-dialogo-conversa .fala')).not.toContainText(resposta.texto);
  const altura = await legenda.evaluate((el) => ({
    altura: el.clientHeight,
    linha: Number.parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(altura.altura).toBeLessThanOrEqual(altura.linha * 2 + 1);
  await page.evaluate(() => (window as JanelaTeste).audioTeste.onended?.());
  await expect(page.locator('app-dialogo-conversa .fala')).toContainText(resposta.texto);
  await expect(legenda).not.toBeEmpty();
  await expect(legenda).toBeEmpty({ timeout: 4_000 });
});

test('recolher ferramentas preserva a cena e o controle do holograma', async ({ page }) => {
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  const canvas = page.locator('app-holograma-view canvas');
  await expect(canvas).toHaveCount(1);
  await canvas.evaluate((el) => el.setAttribute('data-instancia', 'original'));
  await page.getByLabel('Vista explodida').fill('70');
  await page.getByRole('button', { name: 'Fechar painel' }).click();
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-instancia', 'original');
  await expect(page.getByRole('button', { name: 'Montar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Centralizar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await expect(page.getByLabel('Vista explodida')).toHaveValue('70');
  await expect(canvas).toHaveAttribute('data-instancia', 'original');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('holograma-ferramentas.png') });
});

test('no celular o painel é modal, contém o foco e preserva o rascunho', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  const dialogo = page.getByRole('dialog', { name: 'Conversa', exact: true });
  await expect(dialogo).toBeVisible();
  expect(await dialogo.evaluate((el) => el.matches(':modal'))).toBe(true);
  await page.getByLabel('Sua mensagem').fill('Rascunho no celular');
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await dialogo.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('conversa-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  await expect(page.getByRole('button', { name: 'Conversa', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  await expect(page.getByLabel('Sua mensagem')).toHaveValue('Rascunho no celular');
});
