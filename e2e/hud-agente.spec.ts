import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type {
  HistoricoConversa,
  PedidoConversa,
  RespostaConversa,
} from '../src/app/nucleo/conversa.modelos';

async function emitir(page: Page, nome: string, dados: unknown): Promise<void> {
  await page.evaluate(
    ({ nome, dados }) => {
      const fonte = (window as Window & { sseTeste: EventTarget }).sseTeste;
      fonte.dispatchEvent(new MessageEvent(nome, { data: JSON.stringify(dados) }));
    },
    { nome, dados },
  );
}

async function preparar(page: Page) {
  const api = {
    historico: {
      sessao: 'hud-agente',
      revisao: 0,
      trocas: [],
      emAndamento: null,
      ultima: null,
    } as HistoricoConversa,
    pedidos: [] as string[],
  };
  await page.addInitScript(() => {
    localStorage.setItem('jarvis-hud.api-url', 'https://api.hud.test');
    localStorage.setItem('jarvis-hud.token', 'teste');
    class Fonte extends EventTarget {
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
    Object.assign(window, {
      EventSource: Fonte,
      SpeechRecognition: undefined,
      webkitSpeechRecognition: undefined,
      speechSynthesis: undefined,
    });
  });
  await page.route('https://api.hud.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/conversa' && route.request().method() === 'POST') {
      api.pedidos.push((route.request().postDataJSON() as { texto: string }).texto);
      await route.fulfill({ status: 202, json: { id: 't1' } });
    } else
      await route.fulfill({
        json: url.pathname.endsWith('/historico')
          ? api.historico
          : url.pathname.endsWith('/ultima')
            ? api.historico.ultima
            : null,
      });
  });
  await page.goto('/');
  await expect(page.locator('app-nucleo-jarvis')).toBeVisible();
  return api;
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1120, height: 623 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`HUD do agente em ${viewport.width}px: HUD única, comando e acessibilidade`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const api = await preparar(page);
    await expect(page.getByText('Just A Rather Very Intelligent System')).toBeVisible();
    await expect(page.locator('#mensagem-jarvis')).toHaveCount(1);
    if (viewport.width >= 1000) {
      await expect(page.locator('.coluna-esquerda')).toBeVisible();
      await expect(page.locator('.coluna-direita')).toBeVisible();
      const rodape = (await page.locator('.rodape').boundingBox())!;
      for (const lado of ['.coluna-esquerda', '.coluna-direita']) {
        const caixa = (await page.locator(lado).boundingBox())!;
        expect(caixa.y + caixa.height).toBeLessThanOrEqual(rodape.y);
      }
      await expect(page.locator('app-nucleo-jarvis canvas')).toHaveAttribute(
        'data-material',
        'referencia',
      );
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('painel.png') });
    await expect(page.locator('.navegacao-desktop, .navegacao-mobile')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    for (const item of [
      { acao: 'Ferramentas', titulo: 'Ferramentas' },
      { acao: 'Abrir memória', titulo: 'Memória' },
      { acao: 'Ver execuções', titulo: 'Execuções' },
    ]) {
      await page.getByRole('button', { name: item.acao, exact: true }).click();
      await expect(page.getByRole('dialog', { name: item.titulo, exact: true })).toBeVisible();
      await expect(page.locator('app-nucleo-jarvis')).toHaveCount(1);
      expect(new URL(page.url()).pathname).toBe('/');
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.getByRole('button', { name: 'Fechar painel', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Abrir memória', exact: true }).click();
    await page.getByRole('button', { name: 'Consultar memória', exact: true }).click();
    await expect(page.getByLabel('Sua mensagem')).toHaveValue('Jarvis, o que você sabe sobre mim?');
    await expect(page.locator('#mensagem-jarvis')).toHaveCount(1);
    expect(api.pedidos).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Sua mensagem')).toHaveValue('Jarvis, o que você sabe sobre mim?');
    await expect(page.locator('#mensagem-jarvis')).toHaveCount(1);
  });
}

test('estados seguem o pedido e ferramentas reais; reconectar não repete conclusão', async ({
  page,
}) => {
  const api = await preparar(page);
  const pedido: PedidoConversa = {
    id: 't1',
    canal: 'hud',
    texto: 'Pesquisar modelos',
    estado: 'processando',
    iniciadoEm: '',
  };
  api.historico.emAndamento = pedido;
  await emitir(page, 'conversa.pensando', pedido);
  await expect(page.locator('app-nucleo-jarvis')).toHaveAttribute('data-estado', 'pensando');
  await emitir(page, 'conversa.ferramenta', {
    id: 't1',
    canal: 'hud',
    nome: 'buscar_na_web',
    descricao: 'Consultando fontes reais',
    passo: 2,
    total: 4,
  });
  await expect(page.locator('app-nucleo-jarvis')).toHaveAttribute('data-estado', 'executando');
  await page.getByRole('button', { name: 'Ver execuções', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '2');
  const resposta: RespostaConversa = {
    id: 't1',
    canal: 'hud',
    texto: 'Consulta concluída',
    erro: null,
    anexos: [],
    confirmacao: null,
    concluidoEm: '',
  };
  api.historico = {
    ...api.historico,
    revisao: 1,
    emAndamento: null,
    ultima: resposta,
    trocas: [{ id: pedido.id, pedido: pedido.texto, canal: 'hud', resposta }],
  };
  await emitir(page, 'conversa.resposta', resposta);
  await page.getByRole('button', { name: 'Fechar painel', exact: true }).click();
  await expect(page.locator('app-nucleo-jarvis')).toHaveAttribute('data-estado', 'concluido');
  await expect(page.locator('app-nucleo-jarvis')).toHaveAttribute('data-estado', 'repouso', {
    timeout: 5000,
  });
  await emitir(page, 'conversa.resposta', resposta);
  await expect(page.locator('app-nucleo-jarvis')).toHaveAttribute('data-estado', 'repouso');
  await page.reload();
  await expect(page.locator('app-nucleo-jarvis')).toHaveAttribute('data-estado', 'repouso');
  await expect(page.getByText('Resposta recebida', { exact: true })).toHaveCount(0);
});

test('mobile mostra uma janela por vez sem perder os outros cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await preparar(page);
  for (const id of ['primeiro', 'segundo'])
    await emitir(page, 'tela.card', {
      id,
      titulo: 'Resultado ' + id,
      tipo: 'pesquisa',
      origem: 'hud',
      criadoEm: '2026-11-01T12:00:00Z',
      dados: {
        layout: 'lista',
        categoria: 'pesquisa',
        tema: 'Teste',
        referencia: '',
        resumo: 'Resumo real do resultado',
        fontes: [],
        consultadoEm: '2026-11-01T12:00:00Z',
        itens: [{ texto: 'Conteúdo do card' }],
      },
    });
  await expect(page.locator('app-janela')).toHaveCount(2);
  await expect(page.locator('app-janela:visible')).toHaveCount(1);
  await expect(page.locator('.apresentacao.compacta')).toBeVisible();
  await page.getByLabel('Resultado em foco').selectOption('primeiro');
  await expect(page.getByRole('region', { name: 'Resultado primeiro', exact: true })).toBeVisible();
  await expect(page.locator('app-janela:visible')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('workspace-mobile.png') });
});

test('perda do contexto WebGL mantém o rosto 2D e os comandos utilizáveis', async ({ page }) => {
  await preparar(page);
  const canvas = page.locator('app-nucleo-jarvis canvas');
  await expect(canvas).toHaveCount(1);
  await canvas.dispatchEvent('webglcontextlost');
  await expect(page.locator('app-nucleo-jarvis .reserva')).toBeVisible();
  await expect(page.getByLabel('Sua mensagem')).toBeEditable();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('viewport reduzido pelo teclado e orientação horizontal preservam o editor e o rascunho', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await preparar(page);
  await page.getByLabel('Sua mensagem').fill('Um comando ainda em edição');
  for (const viewport of [
    { width: 390, height: 480 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByLabel('Sua mensagem')).toHaveValue('Um comando ainda em edição');
    await expect
      .poll(async () => {
        const campo = await page.getByLabel('Sua mensagem').boundingBox();
        return (
          !!campo &&
          campo.y >= 0 &&
          campo.y + campo.height <= viewport.height &&
          campo.x + campo.width <= viewport.width
        );
      })
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Executar', exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
});
