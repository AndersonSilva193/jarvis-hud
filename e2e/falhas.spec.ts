import { test, expect, type Page } from '@playwright/test';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * As falhas do holograma que não podem travar a HUD (Fase 7): lixo no stream, evento partido no
 * meio, conexão que cai, objeto sem peça, conexão muda, câmera recusada e pouca luz.
 *
 * O `route.fulfill` do Playwright só entrega o corpo inteiro de uma vez, então o stream vem de um
 * servidor HTTP de verdade, aqui mesmo: é ele que parte um evento em dois pacotes, derruba o socket
 * no meio ou fica calado.
 */

// Um vídeo Y4M quase preto no lugar da webcam: o Chrome o repete em laço como se fosse a câmera.
const VIDEO_ESCURO = join(tmpdir(), 'jarvis-hud-e2e', 'camera-escura.y4m');
mkdirSync(join(tmpdir(), 'jarvis-hud-e2e'), { recursive: true });
{
  const [l, a] = [320, 240];
  const quadro = Buffer.concat([Buffer.from('FRAME\n'), Buffer.alloc(l * a, 12), Buffer.alloc((l * a) / 2, 128)]);
  writeFileSync(VIDEO_ESCURO, Buffer.concat([Buffer.from(`YUV4MPEG2 W${l} H${a} F15:1 Ip A1:1 C420jpeg\n`), ...Array(5).fill(quadro)]));
}
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${VIDEO_ESCURO}`] },
});

const evento = (nome: string, dados: unknown) => `event:${nome}\ndata:${JSON.stringify(dados)}\n\n`;
const peca = (id: string, x: number) => ({
  id, nome: `Pistão ${id}`, grupo: 'pistoes', forma: 'box', posicao: [x, 0, 0], rotacao: [0, 0, 0], tamanho: [0.5, 0.5, 0.5],
  cor: '#f472b6', explosao: [1, 0, 0], opacidade: 1, contorno: true, pontos: null,
});
const META = evento('meta', { nome: 'Motor', categoria: 'mecanica', descricao: 'Motor de teste.', id: 'h1234abcd' });
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Cenario = (res: ServerResponse, req: IncomingMessage, url: URL) => void | Promise<void>;
const cenarios: Record<string, Cenario> = {};
let servidor: Server;
let api = '';
/** O servidor viu o cliente ir embora no meio: é o que dispara o corte do modelo no Jarvis de verdade. */
let clienteSaiu = false;

test.beforeAll(async () => {
  servidor = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const url = new URL(req.url ?? '/', 'http://local');
    const cenario = url.pathname === '/api/holograma/gerar' ? cenarios[url.searchParams.get('objeto') ?? '']
      : url.pathname === '/api/holograma/continuar' ? cenarios['continuar'] : undefined;
    if (cenario) {
      // Fechou antes de o cenário terminar a resposta: foi o cliente que saiu.
      res.on('close', () => { if (!res.writableFinished) clienteSaiu = true; });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.flushHeaders();
      return void (await cenario(res, req, url));
    }
    const corpo = url.pathname === '/api/holograma/galeria' ? []
      : url.pathname.endsWith('/historico') ? { sessao: 'teste', revisao: 0, trocas: [], emAndamento: null, ultima: null } : null;
    if (url.pathname.endsWith('/estado')) return void res.writeHead(204).end();
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(corpo));
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const endereco = servidor.address();
  api = `http://127.0.0.1:${typeof endereco === 'object' && endereco ? endereco.port : 0}`;
});

test.afterAll(() => servidor.close());

test.beforeEach(async ({ page }) => {
  clienteSaiu = false;
  await page.addInitScript((urlDaApi) => {
    localStorage.setItem('jarvis-hud.api-url', urlDaApi); localStorage.setItem('jarvis-hud.token', 'token-de-teste');
    Object.assign(window, { SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
    class FonteTeste extends EventTarget {
      static CLOSED = 2; readyState = 1; onopen: (() => void) | null = null;
      constructor() { super(); setTimeout(() => this.onopen?.(), 0); }
      close() {}
    }
    Object.assign(window, { EventSource: FonteTeste });
  }, api);
});

async function abrirEGerar(page: Page, objeto: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.orbe--livre')).toBeVisible();
  await page.getByRole('button', { name: 'Ferramentas', exact: true }).click();
  await page.getByRole('button', { name: 'Holograma', exact: true }).click();
  await page.getByLabel('Gerar objeto').fill(objeto);
  await page.getByRole('button', { name: 'Gerar' }).click();
}

/** A HUD não travou: a cena ainda desenha, os botões respondem e dá para gerar de novo. */
async function aindaResponde(page: Page): Promise<void> {
  const quadro = await page.evaluate(() => new Promise<boolean>((r) => requestAnimationFrame(() => r(true))));
  expect(quadro).toBe(true);
  if (await page.getByRole('button', { name: 'Explodir' }).isEnabled()) {
    await page.getByRole('button', { name: 'Explodir' }).click();
    await expect(page.getByRole('button', { name: 'Montar' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Montar' }).click();
  } else {
    await expect(page.getByRole('button', { name: 'Centralizar' })).toBeDisabled();
  }
  // Durante a geração o botão é "Cancelar"; fora dela, "Gerar".
  await expect(page.getByRole('button', { name: /^(Gerar|Cancelar)$/ })).toBeEnabled();
}

const estado = (page: Page) => page.locator('app-holograma-view .estado');

test('lixo antes e no meio do stream é ignorado: texto solto, JSON quebrado, evento desconhecido', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  cenarios['lixo'] = (res) => {
    res.end(
      'data: Claro! Aqui está o seu objeto.\n\n' + META +
      'event:peca\ndata:{"id":"quebrada","forma":\n\n' +
      evento('peca', { ...peca('sem_forma', 0), forma: 'piramide' }) +
      evento('desconhecido', { qualquer: true }) +
      evento('peca', peca('a', -1)) + evento('peca', peca('b', 1)) +
      evento('fim', { pecas: 2, avisos: 0, status: 'completo' }),
    );
  };
  await abrirEGerar(page, 'lixo');
  await expect(estado(page)).toHaveText('2 peças');
  await aindaResponde(page);
  expect(erros).toEqual([]);
});

test('evento partido em dois pacotes, no meio de um caractere, vira uma peça só', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  cenarios['partida'] = async (res) => {
    res.write(META);
    const bytes = Buffer.from(evento('peca', peca('a', -1)));
    // O "ã" de "Pistão" ocupa dois bytes em UTF-8: o corte cai entre eles.
    const meio = bytes.indexOf(Buffer.from('ã')) + 1;
    res.write(bytes.subarray(0, meio));
    await espera(300);
    res.write(bytes.subarray(meio));
    res.end(evento('peca', peca('b', 1)) + evento('fim', { pecas: 2, avisos: 0, status: 'completo' }));
  };
  await abrirEGerar(page, 'partida');
  await expect(estado(page)).toHaveText('2 peças');
  await expect(page.getByRole('img', { name: 'Holograma de Motor, 2 peças' })).toBeVisible();
  expect(erros).toEqual([]);
});

test('o servidor derruba a conexão no meio: as peças ficam, e o Continuar termina o objeto', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  let recebidas = '';
  cenarios['queda'] = async (res) => {
    res.write(META + evento('peca', peca('a', -1)) + evento('peca', peca('b', 0)) + 'event:peca\ndata:{"id":"c","no');
    await espera(200);
    res.destroy();
  };
  cenarios['continuar'] = (res, _req, url) => {
    recebidas = url.searchParams.get('recebidas') ?? '';
    res.end(META + evento('peca', peca('c', 1)) + evento('fim', { pecas: 3, avisos: 0, status: 'completo', id: 'h1234abcd' }));
  };
  await abrirEGerar(page, 'queda');
  await expect(estado(page)).toHaveText('Incompleto: a conexão caiu no meio · 2 peças');
  await aindaResponde(page);

  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(estado(page)).toHaveText('3 peças');
  expect(recebidas).toBe('2');
  expect(erros).toEqual([]);
});

test('objeto sem nenhuma peça vira erro legível, e o vazio sem fim também', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  cenarios['vazio'] = (res) => {
    res.end(META + evento('erro', { texto: 'O modelo não devolveu um objeto válido.' }) +
      evento('fim', { pecas: 0, avisos: 0, status: 'incompleto', motivo: 'O modelo não devolveu um objeto válido.' }));
  };
  cenarios['nada'] = (res) => res.end(':ok\n\n');
  await abrirEGerar(page, 'vazio');
  await expect(estado(page)).toHaveText('Incompleto: o modelo não devolveu um objeto válido');
  await expect(page.getByRole('button', { name: 'Continuar' })).toHaveCount(0);
  await aindaResponde(page);

  await page.getByLabel('Gerar objeto').fill('nada');
  await page.getByRole('button', { name: 'Gerar' }).click();
  await expect(estado(page)).toHaveText('Incompleto: a conexão caiu no meio');
  await aindaResponde(page);
  expect(erros).toEqual([]);
});

test('conexão muda: a HUD desiste sozinha em 15 s, avisa o servidor fechando e oferece Continuar', async ({ page }) => {
  test.setTimeout(60_000);
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  // Como a aba do celular em segundo plano, ou o Wi-Fi que trocou: nem peça nem ping, e o socket aberto.
  cenarios['muda'] = (res) => void res.write(META + evento('peca', peca('a', 0)));
  await abrirEGerar(page, 'muda');
  await expect(estado(page)).toHaveText('Construindo… 1 peça');
  await aindaResponde(page);
  await expect(estado(page)).toHaveText('Incompleto: a conexão caiu no meio · 1 peça', { timeout: 25_000 });
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeVisible();
  await expect.poll(() => clienteSaiu, { message: 'o servidor não viu a HUD sair' }).toBe(true);
  expect(erros).toEqual([]);
});

test('câmera ocupada por outro programa: avisa, solta o botão e o holograma segue no mouse', async ({ page }) => {
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.reject(new DOMException('ocupada', 'NotReadableError')) },
    });
  });
  cenarios['camera'] = (res) => res.end(META + evento('peca', peca('a', 0)) + evento('fim', { pecas: 1, avisos: 0, status: 'completo' }));
  await abrirEGerar(page, 'camera');
  await expect(estado(page)).toHaveText('1 peça');
  await page.getByText('Gestos e celular', { exact: true }).click();
  await page.getByRole('button', { name: 'Gestos' }).click();
  await expect(page.locator('app-botoes-gestos .aviso')).toHaveText('A câmera está em uso por outro programa.');
  await expect(page.getByRole('button', { name: 'Gestos' })).toHaveAttribute('aria-pressed', 'false');
  await aindaResponde(page);
  expect(erros).toEqual([]);
});

test('câmera escura avisa pouca luz em vez de só "Sem mão", e nada trava', async ({ page }) => {
  test.setTimeout(60_000);
  const erros: string[] = []; page.on('pageerror', (e) => erros.push(e.message));
  cenarios['escuro'] = (res) => res.end(META + evento('peca', peca('a', 0)) + evento('fim', { pecas: 1, avisos: 0, status: 'completo' }));
  await abrirEGerar(page, 'escuro');
  await expect(estado(page)).toHaveText('1 peça');
  await page.getByText('Gestos e celular', { exact: true }).click();
  await page.getByRole('button', { name: 'Gestos' }).click();
  // O wasm e o modelo do MediaPipe demoram a carregar na primeira vez.
  await expect(page.locator('app-preview-gestos .indicador')).toHaveText('Pouca luz · acenda uma luz', { timeout: 40_000 });
  await expect(page.locator('app-preview-gestos .gesto')).toHaveText('Sem mão');
  await aindaResponde(page);
  expect(erros).toEqual([]);
});
