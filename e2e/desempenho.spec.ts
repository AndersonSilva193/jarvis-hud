import { test, expect, type Page } from '@playwright/test';

/**
 * FPS e chamadas de desenho de um objeto de 250 peças, com e sem os lotes instanciados — o "antes e
 * depois" do `LIMIAR_DE_INSTANCIAS`. Os números saem no console e no anexo do relatório; o teste só
 * exige o que não depende da máquina: que as séries virem lotes e que as chamadas caiam.
 *
 * Rodar sozinho: `npx playwright test e2e/desempenho.spec.ts --reporter=list`.
 */

// Sem o teto do vsync, o FPS mede quanto a máquina aguenta, e não a taxa do monitor.
test.use({ launchOptions: { args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] } });

const evento = (nome: string, dados: unknown) => `event:${nome}\ndata:${JSON.stringify(dados)}\n\n`;

interface Serie { id: string; forma: string; tamanho: number[]; cor: string; n: number; onde: (i: number) => number[]; rotacao?: (i: number) => number[] }

/** Seis séries como as de um motor (dentes, parafusos, pistões, aletas, elos, válvulas) e 32 avulsas. */
const SERIES: Serie[] = [
  { id: 'dente', forma: 'box', tamanho: [0.18, 0.12, 0.3], cor: '#fbbf24', n: 60, onde: (i) => [Math.cos((i / 60) * 2 * Math.PI) * 2.2, -1.5, Math.sin((i / 60) * 2 * Math.PI) * 2.2], rotacao: (i) => [0, -(i * 6) % 180, 0] },
  { id: 'parafuso', forma: 'cyl', tamanho: [0.05, 0.05, 0.3], cor: '#a78bfa', n: 40, onde: (i) => [Math.cos((i / 40) * 2 * Math.PI) * 1.6, 1.2, Math.sin((i / 40) * 2 * Math.PI) * 1.6] },
  { id: 'pistao', forma: 'cyl', tamanho: [0.28, 0.28, 0.5], cor: '#f472b6', n: 8, onde: (i) => [-1.4 + i * 0.4, 0.4, 0] },
  { id: 'aleta', forma: 'box', tamanho: [0.04, 0.6, 1.2], cor: '#22d3ee', n: 30, onde: (i) => [-2.4 + i * 0.16, 2.2, 0] },
  { id: 'elo', forma: 'tor', tamanho: [0.08, 0.02], cor: '#34d399', n: 60, onde: (i) => [-3 + i * 0.1, -2.2, 1.4], rotacao: (i) => [0, i % 2 ? 90 : 0, 0] },
  { id: 'valvula', forma: 'cone', tamanho: [0.08, 0.3], cor: '#f87171', n: 20, onde: (i) => [-1.9 + i * 0.2, 1.7, -0.6] },
];
const AVULSAS = 250 - SERIES.reduce((soma, s) => soma + s.n, 0);

function pecas(): unknown[] {
  const lista: unknown[] = [];
  const base = { rotacao: [0, 0, 0], explosao: null, opacidade: 1, contorno: true, pontos: null };
  for (let i = 0; i < AVULSAS; i++) {
    lista.push({ ...base, id: `placa_${i}`, nome: `Placa ${i}`, grupo: 'carcaca', forma: 'box', posicao: [-3 + (i % 8) * 0.8, -1 + Math.floor(i / 8) * 0.6, -1.6], tamanho: [0.7, 0.5, 0.05], cor: '#38bdf8', opacidade: 0.25 });
  }
  for (const s of SERIES) {
    for (let i = 0; i < s.n; i++) {
      lista.push({ ...base, id: `${s.id}_${i + 1}`, nome: s.id, grupo: s.id, forma: s.forma, posicao: s.onde(i), rotacao: s.rotacao?.(i) ?? [0, 0, 0], tamanho: s.tamanho, cor: s.cor, serie: `${s.id}_1` });
    }
  }
  return lista;
}

const STREAM =
  evento('meta', { nome: 'Banco de prova', categoria: 'mecanica', descricao: 'Duzentas e cinquenta peças em séries.' }) +
  pecas().map((p) => evento('peca', p)).join('') +
  evento('fim', { pecas: 250, avisos: 0, status: 'completo' });

interface Medida { fps: number; chamadas: number; pecas: number; lotes: number }

async function medir(page: Page, consulta: string): Promise<Medida[]> {
  await page.goto(`/${consulta}`);
  await expect(page.locator('.orbe--livre')).toBeVisible();
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  await page.getByLabel('Gerar objeto').fill('banco de prova');
  await page.getByRole('button', { name: 'Gerar' }).click();
  await expect(page.locator('app-holograma-view .estado')).toHaveText('250 peças', { timeout: 20_000 });
  // A câmera enquadra e as entradas terminam; depois disso cada segundo é um quadro igual ao outro.
  await page.waitForTimeout(2_500);
  // As duas capturas lado a lado mostram que o lote desenha o mesmo que a peça avulsa.
  await page.locator('app-holograma-view .cena').screenshot({ path: test.info().outputPath(`cena${consulta.includes('instancias=0') ? '-avulsa' : '-instanciada'}.png`) });
  // A cena publica uma medida por segundo.
  const medidas: Medida[] = [];
  while (medidas.length < 6) {
    await page.waitForTimeout(1_050);
    const [fps, chamadas, quantas, lotes] = ((await page.locator('.medida').textContent()) ?? '').match(/\d+/g)!.map(Number);
    medidas.push({ fps: fps!, chamadas: chamadas!, pecas: quantas!, lotes: lotes! });
  }
  return medidas;
}

const mediana = (valores: number[]) => [...valores].sort((a, b) => a - b)[Math.floor(valores.length / 2)]!;

test('250 peças: os lotes instanciados cortam as chamadas de desenho e o FPS não cai', async ({ page }) => {
  test.setTimeout(150_000);
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
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
    if (path === '/api/holograma/gerar') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: STREAM });
    if (path === '/api/holograma/galeria') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    const corpo = path.endsWith('/historico') ? { sessao: 'teste', revisao: 0, trocas: [], emAndamento: null, ultima: null } : null;
    await route.fulfill({ status: path.endsWith('/estado') ? 204 : 200, contentType: 'application/json', body: path.endsWith('/estado') ? '' : JSON.stringify(corpo) });
  });

  const resumir = (medidas: Medida[]) => ({
    fps: mediana(medidas.map((m) => m.fps)), chamadas: mediana(medidas.map((m) => m.chamadas)), lotes: medidas[0]!.lotes,
  });
  const cdp = await page.context().newCDPSession(page);
  const resultados: Record<string, { antes: ReturnType<typeof resumir>; depois: ReturnType<typeof resumir> }> = {};
  // CPU cheia e 4× mais lenta: a segunda aproxima o celular, onde cada chamada de desenho pesa mais.
  for (const lentidao of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: lentidao });
    const antes = resumir(await medir(page, '?medir=1&instancias=0'));
    const depois = resumir(await medir(page, '?medir=1'));
    resultados[`cpu ${lentidao}x`] = { antes, depois };
    console.log(`Holograma de 250 peças, CPU ${lentidao}x — antes: ${JSON.stringify(antes)} · depois: ${JSON.stringify(depois)}`);
    expect(antes.lotes).toBe(0);
    expect(depois.lotes).toBe(SERIES.length);
    expect(depois.chamadas).toBeLessThan(antes.chamadas / 2);
  }
  await test.info().attach('desempenho.json', { body: JSON.stringify(resultados, null, 2), contentType: 'application/json' });
  expect(erros).toEqual([]);
});
