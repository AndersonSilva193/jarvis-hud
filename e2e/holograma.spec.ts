import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

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
    const corpo = path.endsWith('/historico') ? { sessao: 'teste', revisao: 0, trocas: [], emAndamento: null, ultima: null }
      : path.endsWith('/galeria') ? ['dna', 'atomo'].map(id => ({ id: `exemplo_${id}`, nome: id === 'dna' ? 'DNA' : 'Átomo', pecas: 10, fixo: true })) : null;
    await route.fulfill({ status: path === '/api/tela/estado' ? 204 : 200, contentType: 'application/json', body: path === '/api/tela/estado' ? '' : JSON.stringify(corpo) });
  });
  await page.goto('/'); await expect(page.locator('.orbe--livre')).toBeVisible();
});

test('holograma monta o exemplo pelo stream com Bearer, explode e fecha com Esc', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  let autorizacao = '';
  await page.route('https://api.hud.test/api/holograma/exemplo_dna/stream', async (route) => {
    autorizacao = route.request().headers()['authorization'] ?? '';
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: STREAM });
  });

  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  await expect(page.locator('app-holograma-view')).toBeVisible();
  await expect(page.locator('.orbe--recuado')).toHaveCount(1);
  await page.getByRole('button', { name: /^Galeria/ }).click();
  await page.getByRole('button', { name: 'Abrir DNA', exact: true }).click();

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
  await expect(page.getByRole('dialog', { name: 'Ferramentas', exact: true })).toBeHidden();
  await expect(page.locator('app-holograma-view')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('app-holograma-view')).toHaveCount(0);
  await expect(page.locator('.orbe--livre')).toBeVisible();
  expect(erros).toEqual([]);
});

test('holograma explica o token recusado', async ({ page }) => {
  await page.route('https://api.hud.test/api/holograma/exemplo_atomo/stream', (route) => route.fulfill({ status: 401, body: '' }));
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  await page.getByRole('button', { name: /^Galeria/ }).click();
  await page.getByRole('button', { name: 'Abrir Átomo', exact: true }).click();
  await expect(page.locator('app-holograma-view [role=status]')).toHaveText('Token recusado pela API.');
});

test('holograma gerado pelo modelo: escaneia, mantém as peças no erro e cancela', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  const pedidos: URL[] = [];
  let liberar!: () => void;
  const liberado = new Promise<void>((r) => (liberar = r));
  await page.route('https://api.hud.test/api/holograma/gerar?**', async (route) => {
    pedidos.push(new URL(route.request().url()));
    // O primeiro pedido espera o teste mandar; o segundo nunca responde, e é cancelado.
    if (pedidos.length > 1) return;
    await liberado;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body:
        evento('meta', { nome: 'Motor V8', categoria: 'mecanica', descricao: 'Motor em corte.' }) +
        evento('peca', PECAS[0]) + evento('peca', PECAS[4]) +
        evento('erro', { texto: 'O modelo não respondeu a tempo.' }) +
        evento('fim', { pecas: 2, avisos: 0 }),
    });
  });

  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  const estado = page.locator('app-holograma-view .estado');
  await expect(page.getByRole('button', { name: 'Gerar' })).toBeDisabled();
  await page.getByLabel('Gerar objeto').fill('motor V8');
  await page.getByLabel('Nível de detalhe').selectOption('detalhado');
  await page.getByRole('button', { name: 'Gerar' }).click();

  await expect(estado).toHaveText('Escaneando…');
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(pedidos[0]?.searchParams.get('objeto')).toBe('motor V8');
  expect(pedidos[0]?.searchParams.get('detalhe')).toBe('detalhado');

  liberar();
  await expect(estado).toHaveText('O modelo não respondeu a tempo. · 2 peças');
  await expect(page.getByRole('img', { name: 'Holograma de Motor V8, 2 peças' })).toBeVisible();

  await page.getByRole('button', { name: 'Gerar' }).click();
  await expect(estado).toHaveText('Escaneando…');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(estado).toHaveText('Cancelado · 0 peças');
  await expect(page.getByRole('button', { name: 'Gerar' })).toBeFocused();
  expect(erros).toEqual([]);
});

test('gestos sem permissão da câmera avisam e os ajustes abrem e fecham sem fechar o holograma', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.reject(new DOMException('negado', 'NotAllowedError')) },
    });
  });
  await page.reload(); await expect(page.locator('.orbe--livre')).toBeVisible();

  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  await page.getByText('Gestos e celular', { exact: true }).click();
  const gestos = page.getByRole('button', { name: 'Gestos' });
  await gestos.click();
  await expect(page.locator('app-botoes-gestos .aviso')).toHaveText('Permissão da câmera negada.');
  await expect(gestos).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('app-preview-gestos')).toHaveCount(0);

  await page.getByRole('button', { name: 'Ajustes' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Ajustes de gestos' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel('Perfil do aparelho').selectOption('leve');
  await expect(dialogo.getByText('Perfil em uso: Leve (celular)')).toBeVisible();
  await expect(dialogo.getByRole('button', { name: 'Gravar 5 s' })).toBeDisabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis-hud.gestos.v1') ?? '{}').perfil)).toBe('leve');

  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  await expect(page.locator('app-holograma-view')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajustes' })).toBeFocused();
  expect(erros).toEqual([]);
});

const MOTOR = [
  peca('bloco', 'box', [0, 0, 0], [3.6, 1.3, 2], { opacidade: 0.18 }),
  peca('eixo_motor', 'cyl', [0, -0.7, 0], [0.15, 0.15, 4], { rotacao: [0, 0, 90], cor: '#a78bfa' }),
  ...Array.from({ length: 8 }, (_, i) => peca(`pistao_${i}`, 'cyl', [-1.2 + (i % 4) * 0.8, 0.9, i < 4 ? -0.65 : 0.65], [0.3, 0.3, 1.25], {
    rotacao: [i < 4 ? -35 : 35, 0, 0], explosao: [0, 1, i < 4 ? -1 : 1], cor: '#f472b6', serie: 'pistoes',
  })),
  ...Array.from({ length: 140 }, (_, i) => peca(`parafuso_${i}`, 'cyl', [-1.7 + (i % 20) * 0.18, -0.4 + Math.floor(i / 40) * 0.32, i % 40 < 20 ? -1.04 : 1.04], [0.045, 0.045, 0.16], {
    rotacao: [90, 0, 0], explosao: [0, 0, i % 40 < 20 ? -1 : 1], cor: '#fbbf24', serie: 'parafusos',
  })),
];

const CENARIOS = [
  { nome: 'Objeto pequeno', pecas: [peca('esfera', 'sph', [0, 0, 0], [0.15])] },
  { nome: 'Objeto alongado', pecas: [peca('haste', 'box', [0, 0, 0], [1, 38, 1])] },
  { nome: 'Motor V8', pecas: MOTOR },
];

async function verificarLimites(page: Page): Promise<void> {
  const fora = await page.evaluate(() => {
    const limites = { largura: innerWidth, altura: innerHeight };
    return [...document.querySelectorAll('.hud--holograma, .cabecalho, .rodape .botao, app-holograma-view, app-holograma-view > *, app-holograma-view canvas')]
      .filter(el => el.checkVisibility() && !el.closest('dialog'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.x < -1 || r.y < -1 || r.right > limites.largura + 1 || r.bottom > limites.altura + 1;
      }).map(el => `${el.tagName}.${el.className}`);
  });
  expect(fora).toEqual([]);
  expect(await page.locator('.hud').evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
  const cena = (await page.locator('app-holograma-view .cena').boundingBox())!;
  const canvas = (await page.locator('app-holograma-view canvas').boundingBox())!;
  expect(canvas.width).toBeCloseTo(cena.width);
  expect(canvas.height).toBeCloseTo(cena.height);
  expect(cena.height).toBeGreaterThan(Math.min(200, page.viewportSize()!.height * 0.25));
}

for (const viewport of [
  { width: 1920, height: 1080 }, { width: 1440, height: 900 },
  { width: 1024, height: 768 }, { width: 390, height: 844 },
]) {
  test(`modo imersivo em ${viewport.width}×${viewport.height}: objetos, barra, painéis e redimensionamento`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const erros: string[] = [];
    page.on('pageerror', erro => erros.push(erro.message));
    await page.route('https://api.hud.test/api/holograma/gerar?**', route => {
      const cenario = CENARIOS.find(c => c.nome === new URL(route.request().url()).searchParams.get('objeto'))!;
      return route.fulfill({ contentType: 'text/event-stream', body:
        evento('meta', { nome: cenario.nome, categoria: 'teste', descricao: cenario.nome }) +
        cenario.pecas.map(p => evento('peca', p)).join('') + evento('fim', { pecas: cenario.pecas.length, avisos: 0 }),
      });
    });
    await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
    await page.getByRole('button', { name: 'Holograma', exact: true }).click();
    const canvas = page.locator('app-holograma-view canvas');
    await expect(canvas).toHaveCount(1);
    await canvas.evaluate(el => el.setAttribute('data-instancia', 'original'));
    const ferramentas = page.getByRole('button', { name: 'Ferramentas', exact: true });
    const painel = page.getByRole('dialog', { name: 'Ferramentas', exact: true });

    for (const [i, cenario] of CENARIOS.entries()) {
      if (i) await ferramentas.click();
      await page.getByLabel('Gerar objeto').fill(cenario.nome);
      await page.getByRole('button', { name: 'Gerar', exact: true }).click();
      await expect(page.locator('app-holograma-view .estado')).toHaveText(`${cenario.pecas.length} ${cenario.pecas.length === 1 ? 'peça' : 'peças'}`);
      await verificarLimites(page);
      if (i === 2) expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      if (viewport.width >= 1024) {
        const area = (await page.locator('main').boundingBox())!;
        const lateral = (await painel.boundingBox())!;
        expect(lateral.width).toBe(380);
        expect(area.x + area.width).toBeLessThanOrEqual(lateral.x);
      } else {
        expect(await painel.evaluate(el => el.matches(':modal'))).toBe(true);
      }
      await page.screenshot({ path: test.info().outputPath(`${i}-painel.png`) });
      await page.keyboard.press('Escape');
      await expect(painel).toBeHidden();
      await expect(ferramentas).toBeFocused();
      await expect(canvas).toHaveAttribute('data-instancia', 'original');
      await verificarLimites(page);
      expect((await page.locator('main').boundingBox())!.width).toBe(viewport.width);
      await page.getByRole('button', { name: 'Centralizar', exact: true }).click();
      const captura = await page.screenshot({ path: test.info().outputPath(`${i}-montado.png`) });
      const areaDaCena = (await page.locator('app-holograma-view .cena').boundingBox())!;
      const cores = await page.evaluate(async ({ base64, x, y }) => {
        const imagem = new Image();
        imagem.src = `data:image/png;base64,${base64}`;
        await imagem.decode();
        const tela = document.createElement('canvas');
        tela.width = imagem.width; tela.height = imagem.height;
        const contexto = tela.getContext('2d')!;
        contexto.drawImage(imagem, 0, 0);
        return {
          cena: Array.from(contexto.getImageData(x, y, 1, 1).data).slice(0, 3),
          interface: getComputedStyle(document.querySelector('.hud')!).backgroundColor.match(/\d+/g)!.map(Number),
        };
      }, { base64: captura.toString('base64'), x: Math.round(areaDaCena.x + 2), y: Math.round(areaDaCena.y + 2) });
      // O pós-processamento não pode tornar o fundo do canvas diferente do restante da tela.
      cores.cena.forEach((canal, indice) => expect(Math.abs(canal - cores.interface[indice]!)).toBeLessThanOrEqual(1));
      await page.getByRole('button', { name: 'Explodir', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Montar', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Centralizar', exact: true }).click();
      await page.screenshot({ path: test.info().outputPath(`${i}-explodido.png`) });
    }

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    // A mesma instância atravessa também uma mudança real de orientação/proporção.
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await expect(canvas).toHaveAttribute('data-instancia', 'original');
    await verificarLimites(page);
    await page.getByRole('button', { name: 'Sair do holograma', exact: true }).click();
    await expect(page.locator('.hud--holograma')).toHaveCount(0);
    await expect(ferramentas).toBeFocused();
    await expect(page.locator('.orbe--livre')).toBeVisible();
    expect(erros).toEqual([]);
  });
}
