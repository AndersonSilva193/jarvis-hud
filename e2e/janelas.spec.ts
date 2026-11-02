import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type JanelaTeste = Window & { sseTeste: EventTarget };
async function emitir(page: Page, nome: string, dados: unknown) {
  await page.evaluate(
    ({ nome, dados }) =>
      (window as JanelaTeste).sseTeste.dispatchEvent(
        new MessageEvent(nome, { data: JSON.stringify(dados) }),
      ),
    { nome, dados },
  );
}
const pesquisa = (id = 'c1', layout = 'ranking') => ({
  id,
  tipo: 'pesquisa',
  titulo: 'Energia renovável no Brasil',
  origem: 'telegram',
  criadoEm: '2026-10-14T15:30:00Z',
  dados: {
    categoria: 'Pesquisa',
    tema: 'Energia',
    referencia: 'Outubro de 2026',
    resumo: 'Fontes renováveis em comparação.',
    consultadoEm: '2026-10-14T15:30:00Z',
    fontes: [{ nome: 'Fonte de exemplo', url: 'https://example.com/' }],
    layout,
    itens:
      layout === 'ranking'
        ? [
            {
              posicao: 1,
              nome: 'Solar',
              detalhe: 'Geração instalada',
              valor: 100,
              unidade: 'MW',
              etiqueta: 'Maior',
            },
            {
              posicao: 2,
              nome: 'Eólica',
              detalhe: 'Geração instalada',
              valor: 50,
              unidade: 'MW',
              etiqueta: '',
            },
          ]
        : layout === 'ficha'
          ? [{ rotulo: 'Potência', valor: '100 MW' }]
          : layout === 'lista'
            ? [{ texto: 'Energia solar' }]
            : layout === 'linha_do_tempo'
              ? [{ data: '2026', texto: 'Nova geração' }]
              : [{ valor: '100', legenda: 'Megawatts' }],
  },
});
const midia = (id = 'v1', tipo = 'video') => ({
  id,
  tipo,
  titulo: 'Vídeo de teste',
  origem: 'telegram',
  criadoEm: '2026-10-14T15:30:00Z',
  dados: {
    modo: tipo,
    videoId: 'M7lc1UVf-VE',
    titulo: 'Vídeo de teste',
    canal: 'YouTube Developers',
    miniatura: '',
    alternativas: [
      { videoId: 'dQw4w9WgXcQ', titulo: 'Alternativa', canal: 'Canal', miniatura: '' },
    ],
  },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-hud.api-url', 'https://api.hud.test');
    localStorage.setItem('jarvis-hud.token', 'token-de-teste');
    Object.assign(window, { SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
    class FonteTeste extends EventTarget {
      static CLOSED = 2;
      readyState = 1;
      onopen: (() => void) | null = null;
      constructor() {
        super();
        Object.assign(window, { sseTeste: this });
        setTimeout(() => this.onopen?.(), 0);
      }
      close() {}
    }
    Object.assign(window, { EventSource: FonteTeste });
    speechSynthesis.speak = (utterance) => {
      setTimeout(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent), 10);
    };
  });
  await page.route('https://api.hud.test/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const corpo = path.endsWith('/historico')
      ? { sessao: 'teste', revisao: 0, trocas: [], emAndamento: null, ultima: null }
      : path.endsWith('/sintetizar')
        ? { provedor: 'navegador' }
        : null;
    await route.fulfill({
      status: path === '/api/tela/estado' ? 204 : 200,
      contentType: 'application/json',
      body: path === '/api/tela/estado' ? '' : JSON.stringify(corpo),
    });
  });
  await page.goto('/');
  await expect(page.locator('.orbe--livre')).toBeVisible();
});

test('inicialização consome URL, permite Escape e não reaparece na recarga', async ({ page }) => {
  let pedidos = 0;
  await page.route('https://api.hud.test/api/inicializacao', async (route) => {
    pedidos++;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({
      json: {
        texto: 'Boa noite, senhor.',
        sitesOk: 1,
        sitesTotal: 1,
        climaOk: true,
        lembretesHoje: 0,
        geradoEm: '2026-10-15T20:00:00-03:00',
      },
    });
  });
  await page.goto('/?inicio=1');
  await expect(page.locator('app-inicializacao')).toBeVisible();
  await expect(page).not.toHaveURL(/inicio=1/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('app-inicializacao')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.orbe--livre')).toBeVisible();
  await expect(page.locator('app-inicializacao')).toHaveCount(0);
  expect(pedidos).toBe(1);
});

test('pesquisas acessíveis, foco, teclado, bandeja e estado autenticado', async ({ page }) => {
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(e.message));
  for (const layout of ['ranking', 'ficha', 'lista', 'linha_do_tempo', 'destaque']) {
    await emitir(page, 'tela.card', pesquisa(layout, layout));
    const janela = page.locator('app-janela.em-foco');
    await expect(janela).toBeVisible();
    await janela.getByRole('button', { name: '1 FONTES' }).click();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
    await emitir(page, 'tela.comando', { acao: 'fechar', alvo: layout });
  }
  await emitir(page, 'tela.card', pesquisa());
  const janela = page.locator('app-janela');
  await expect(janela).toBeVisible();
  const antes = await janela.boundingBox();
  await janela.locator('article').focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(async () => (await janela.boundingBox())!.x).toBe(antes!.x + 10);
  const post = page.waitForRequest(
    (r) =>
      r.url().endsWith('/api/tela/estado') &&
      r.postDataJSON().janelas.some((j: { estado: string }) => j.estado === 'minimizado'),
  );
  await janela.getByRole('button', { name: 'Minimizar janela' }).click();
  expect((await post).headers()['authorization']).toBe('Bearer token-de-teste');
  await expect(page.locator('.orbe--livre')).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar Energia renovável no Brasil' }).click();
  await expect(janela).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(janela).toHaveCount(0);
  expect(erros).toEqual([]);
});

test('arraste, tamanho e viewport estreita mantêm a janela na área útil', async ({ page }) => {
  await emitir(page, 'tela.card', pesquisa());
  const janela = page.locator('app-janela');
  await expect(janela).toBeVisible();
  const barra = await janela.locator('.rotulo-bloco').boundingBox();
  await page.mouse.move(barra!.x + 20, barra!.y + 8);
  await page.mouse.down();
  await page.mouse.move(-100, -100);
  await page.mouse.up();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const j = await janela.boundingBox();
      return !!j && j.x >= 0 && j.y >= 0 && j.x + j.width <= 391 && j.y + j.height <= 845;
    })
    .toBe(true);
  // No celular a janela preenche a área útil; o redimensionamento fica no desktop.
  await expect(
    janela.getByRole('button', { name: 'Redimensionar janela; use as setas' }),
  ).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/hud-pesquisa-mobile.png', fullPage: true });
});

test('comando local não chama conversa; frase mais longa vai para o Jarvis', async ({ page }) => {
  const enviados: string[] = [];
  await page.route('https://api.hud.test/api/conversa', async (route) => {
    enviados.push(route.request().postDataJSON().texto);
    await route.fulfill({ status: 202, json: { id: 'pedido1' } });
  });
  await emitir(page, 'tela.card', pesquisa());
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  await page.getByLabel('Sua mensagem').fill('Jarvis, limpa a tela');
  await page.getByLabel('Sua mensagem').press('Enter');
  await expect(page.locator('app-janela')).toHaveCount(0);
  expect(enviados).toEqual([]);
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  await page.getByLabel('Sua mensagem').fill('limpa a tela da minha casa');
  await page.getByLabel('Sua mensagem').press('Enter');
  await expect.poll(() => enviados).toEqual(['limpa a tela da minha casa']);
});

test('player mantém iframe na bandeja, respeita tamanho e troca alternativas', async ({ page }) => {
  await page.route('https://www.youtube-nocookie.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="pt-BR"><title>Player de teste</title><body><main aria-label="Player de teste"><h1>Vídeo</h1></main></body></html>',
    }),
  );
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.YT={Player:class {constructor(el,o){this.o=o;this.el=el;this.volume=70;window.playerTeste=this;setTimeout(()=>o.events.onReady(),0)}playVideo(){this.o.events.onStateChange({data:1})}pauseVideo(){this.o.events.onStateChange({data:2})}setVolume(v){this.volume=v}getVolume(){return this.volume}getCurrentTime(){return 30}getDuration(){return 120}seekTo(){}loadVideoById(){this.playVideo()}destroy(){}}};window.onYouTubeIframeAPIReady();`,
    }),
  );
  await emitir(page, 'tela.card', midia('m1', 'musica'));
  const iframe = page.locator('app-player-midia iframe');
  await expect(iframe).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
  await iframe.evaluate((el) => el.setAttribute('data-instancia', 'original'));
  await page.getByRole('button', { name: 'Minimizar janela' }).click();
  await expect(page.locator('app-janela.com-player')).toBeVisible();
  const tamanho = await iframe.boundingBox();
  expect(tamanho!.width).toBeGreaterThanOrEqual(200);
  expect(tamanho!.height).toBeGreaterThanOrEqual(200);
  await expect(iframe).toHaveAttribute('data-instancia', 'original');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const b = await iframe.boundingBox();
      return !!b && b.y >= 0 && b.y + b.height <= 844;
    })
    .toBe(true);
  await page.screenshot({ path: 'test-results/hud-musica-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Restaurar janela', exact: true }).click();
  await expect(iframe).toHaveAttribute('data-instancia', 'original');
  await page.getByText('Outras opções', { exact: true }).click();
  await page.getByRole('button', { name: 'Alternativa · Canal' }).click();
  await expect(iframe).toHaveAttribute('data-instancia', 'original');
  await expect(page.locator('.rotulo-bloco')).toContainText('Alternativa');
  const src = await iframe.getAttribute('src');
  expect(src).not.toContain('token');
  expect(src).toContain('youtube-nocookie.com');
});

test('prévia de página, notícia e confirmação continuam acessíveis', async ({ page }) => {
  await emitir(page, 'tela.card', {
    id: 'p1',
    tipo: 'pagina',
    titulo: 'Página',
    origem: 'telegram',
    criadoEm: '2026-10-14',
    dados: {
      url: 'https://example.com',
      titulo: 'Página',
      descricao: '<b>Texto externo</b>',
      imagem: '',
      site: 'example.com',
      incorporavel: false,
    },
  });
  await expect(page.locator('app-card-pagina')).toContainText('<b>Texto externo</b>');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await emitir(page, 'tela.comando', { acao: 'fechar_tudo' });
  await emitir(page, 'tela.card', {
    id: 'n1',
    tipo: 'noticia',
    titulo: 'Notícia',
    origem: 'telegram',
    criadoEm: '2026-10-14',
    dados: {
      titulo: 'Notícia',
      tema: 'Ciência',
      fonte: 'Fonte',
      link: 'https://example.com',
      imagemUrl: '',
    },
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await emitir(page, 'tela.comando', { acao: 'fechar_tudo' });
  const resposta = {
    id: 'r1',
    canal: 'hud',
    texto: 'Confirme com o código.',
    anexos: [],
    confirmacao: {
      codigo: '1234',
      descricao: 'Operação de teste',
      expiraEm: '2099-01-01T00:00:00Z',
    },
    concluidoEm: '2026-10-14',
    erro: null,
  };
  await page.route('https://api.hud.test/api/conversa/historico', (route) =>
    route.fulfill({
      json: { sessao: 'teste', revisao: 1, trocas: [], emAndamento: null, ultima: resposta },
    }),
  );
  await page.route('https://api.hud.test/api/conversa/ultima', (route) =>
    route.fulfill({ json: resposta }),
  );
  await emitir(page, 'conversa.resposta', resposta);
  await expect(page.locator('app-resposta-conversa')).toContainText('1234');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  await expect(page.locator('#painel-hud-titulo')).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Conversa', exact: true })).toBeFocused();
});

test('YouTube real: carregamento e reprodução ou bloqueio explícito @externo', async ({
  page,
}, info) => {
  test.skip(
    process.env['TESTAR_YOUTUBE_REAL'] !== '1',
    'Verificação externa opt-in; a suíte determinística usa player simulado.',
  );
  await emitir(page, 'tela.card', midia());
  const play = page.getByRole('button', { name: 'Reproduzir', exact: true });
  await expect(async () => {
    const tocando = await page.getByRole('button', { name: 'Pausar', exact: true }).count();
    const disponivel = (await play.count()) && (await play.isEnabled());
    const erro = await page.getByRole('button', { name: 'Abrir no YouTube', exact: true }).count();
    expect(tocando || disponivel || erro).toBeTruthy();
  }).toPass({ timeout: 30_000 });
  if ((await play.count()) && (await play.isEnabled())) await play.click();
  await page.screenshot({ path: info.outputPath('youtube-real.png') });
  await info.attach('estado-player', {
    body: await page.locator('app-player-midia').innerText(),
    contentType: 'text/plain',
  });
});

test('embeds que falham oferecem saída externa sem perder acessibilidade', async ({ page }) => {
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.route('https://img.test/capa.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: pixel }),
  );
  await page.route('https://img.test/ausente.png', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page
    .context()
    .route('https://www.youtube.com/watch**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html lang="pt-BR"><title>YouTube</title><body><main><h1>Página externa</h1></main></body></html>',
      }),
    );
  await page.route('https://example.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="pt-BR"><title>Externa</title><body><main><h1>Site externo</h1></main></body></html>',
    }),
  );
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.YT={Player:class {constructor(el,o){this.o=o;setTimeout(()=>{o.events.onReady();o.events.onError({data:101})},0)}playVideo(){}pauseVideo(){}setVolume(){}getVolume(){return 70}getCurrentTime(){return 0}getDuration(){return 0}seekTo(){}loadVideoById(){}destroy(){}}};window.onYouTubeIframeAPIReady();`,
    }),
  );

  const card = midia();
  card.dados.miniatura = 'https://img.test/capa.png';
  await emitir(page, 'tela.card', card);
  const abrirVideo = page.getByRole('button', { name: 'Abrir no YouTube', exact: true });
  await expect(abrirVideo).toBeVisible();
  await expect(page.locator('app-player-midia p[role=status]')).toContainText(
    'não permite incorporação',
  );
  await expect(page.locator('app-player-midia .miniatura img')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reproduzir', exact: true })).toHaveCount(0);
  await expect(page.locator('app-player-midia input[type=range]')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const aba = page.context().waitForEvent('page');
  await abrirVideo.click();
  const externa = await aba;
  await externa.waitForURL('**/watch?v=M7lc1UVf-VE');
  await externa.close();
  await emitir(page, 'tela.comando', { acao: 'fechar_tudo' });

  await emitir(page, 'tela.card', {
    id: 'p2',
    tipo: 'pagina',
    titulo: 'Página incorporada',
    origem: 'telegram',
    criadoEm: '2026-10-14',
    dados: {
      url: 'https://example.com/artigo',
      titulo: 'Artigo externo',
      descricao: 'Resumo do artigo.',
      imagem: 'https://img.test/ausente.png',
      site: 'example.com',
      incorporavel: true,
    },
  });
  await expect(page.locator('app-card-pagina iframe')).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar prévia', exact: true }).click();
  await expect(page.locator('app-card-pagina iframe')).toHaveCount(0);
  await expect(page.locator('app-card-pagina .dominio')).toHaveText('example.com');
  await expect(page.locator('app-card-pagina img')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
