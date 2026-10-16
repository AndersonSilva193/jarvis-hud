import { Service, inject, signal } from '@angular/core';

import { ConfigStore } from './config.store';
import { EscutaService } from './escuta.service';
import { JarvisApiService } from './jarvis-api.service';
import { JarvisEventosService } from './jarvis-eventos.service';
import { VozService } from './voz.service';
import {
  FALA_DE_RESERVA,
  type FaseDaInicializacao,
  type Introducao,
  type LinhaDeChecagem,
} from './inicializacao.modelos';

/** O parâmetro que o agente do PC põe na URL ao abrir a tela por palmas. */
export const PARAMETRO_DE_INICIO = 'inicio';

/** Quanto cada linha de checagem demora a aparecer. Quatro linhas = ~4 s de animação. */
const PASSO_MS = 900;
/** Com prefers-reduced-motion a sequência inteira cabe nisto, sem escalonar. */
const PASSO_REDUZIDO_MS = 200;
/** A sequência não pode ficar presa numa checagem lenta: ela tem um fim. */
const TETO_DA_CHECAGEM_MS = 4_000;

/**
 * A abertura da HUD: a sequência de inicialização e a apresentação falada.
 *
 * Roda quando a tela abre com `?inicio=1`, que é o que o agente do PC põe na URL ao acordar o
 * Jarvis por palmas ou por voz.
 *
 * <h2>Duas coisas ao mesmo tempo</h2>
 *
 * A animação (4 a 6 s) e a chamada a `/api/inicializacao` (que tem orçamento de 3 s de fontes
 * mais a ida ao Claude) começam juntas. Não é pressa: é que o tempo da animação é exatamente o
 * tempo que o servidor precisa, e encadear as duas faria o usuário esperar o dobro olhando para
 * uma tela parada.
 *
 * <h2>Nada aqui pode travar</h2>
 *
 * Cada linha mostra o estado **real** da sua checagem, e uma que falhe vira "FALHOU" sem
 * interromper o resto. Se a API inteira estiver fora, o Jarvis fala a frase de reserva. A tela
 * acendeu porque alguém bateu palmas na frente dela — ela tem de responder alguma coisa.
 */
@Service()
export class InicializacaoService {
  private readonly api = inject(JarvisApiService);
  private readonly config = inject(ConfigStore);
  private readonly voz = inject(VozService);
  private readonly escuta = inject(EscutaService);
  private readonly eventos = inject(JarvisEventosService);

  readonly fase = signal<FaseDaInicializacao>('inativa');
  readonly linhas = signal<LinhaDeChecagem[]>([]);

  /** Verdadeiro enquanto a sobreposição de abertura deve cobrir a tela. */
  readonly rodando = () => this.fase() === 'animando' || this.fase() === 'falando';

  private rodada = 0;

  /** Verdadeiro quando a URL atual pede a sequência de abertura. */
  pedidoNaUrl(): boolean {
    if (typeof location === 'undefined') {
      return false;
    }
    return new URLSearchParams(location.search).get(PARAMETRO_DE_INICIO) === '1';
  }

  /**
   * Toca a abertura inteira: animação, checagens, fala e a escuta ligada no fim.
   *
   * Nunca lança — é chamada do `ngOnInit` e não pode derrubar a página.
   */
  async iniciar(): Promise<void> {
    if (this.rodando()) {
      return;
    }
    const minhaVez = ++this.rodada;
    this.fase.set('animando');
    this.linhas.set(linhasIniciais());

    // Primeiro de tudo: o Chrome foi aberto pelo agente com --autoplay-policy, então aqui não há
    // clique nenhum para aproveitar. Sem a flag, isto não destrava e a fala cai na voz do
    // navegador ou no silêncio — sem travar a sequência.
    this.voz.destravar();

    // A chamada parte agora e é esperada lá embaixo: ela e a animação ocupam o mesmo tempo.
    const introducao = this.pedirIntroducao();

    try {
      await this.animar(introducao, minhaVez);
      if (minhaVez !== this.rodada) {
        return;
      }
      await this.apresentar(await introducao, minhaVez);
    } catch {
      // Qualquer tropeço vira tela normal: melhor sem abertura do que presa nela.
    } finally {
      if (minhaVez === this.rodada) {
        this.terminar();
      }
    }
  }

  /** Corta a abertura pela metade — o Esc, ou a página sendo destruída. */
  cancelar(): void {
    if (this.fase() === 'inativa') {
      return;
    }
    this.rodada++;
    this.voz.parar();
    this.fase.set('pronta');
  }

  private async pedirIntroducao(): Promise<Introducao | null> {
    try {
      return await this.api.inicializacao();
    } catch {
      return null;
    }
  }

  /** As quatro linhas, uma a uma, cada uma com o resultado da sua checagem de verdade. */
  private async animar(introducao: Promise<Introducao | null>, minhaVez: number): Promise<void> {
    const passo = reduzirMovimento() ? PASSO_REDUZIDO_MS : PASSO_MS;

    await this.passo('servidor', passo, minhaVez, async () => {
      // O SSE já conectado é a prova mais honesta de que o servidor responde.
      if (this.eventos.status() === 'online') {
        return { ok: true };
      }
      const resultado = await this.api.testar(this.config.urlApi(), this.config.token());
      return { ok: resultado === 'ok' };
    });

    await this.passo('voz', passo, minhaVez, async () => {
      const status = await this.api.statusVoz();
      return { ok: true, detalhe: status.provedor === 'elevenlabs' ? 'OK' : 'NAVEGADOR' };
    });

    await this.passo('microfone', passo, minhaVez, async () => ({ ok: this.escuta.disponivel }));

    await this.passo('sistemas', passo, minhaVez, async () => {
      const dados = await introducao;
      if (!dados) {
        return { ok: false };
      }
      return {
        ok: dados.sitesOk === dados.sitesTotal,
        detalhe: `${dados.sitesOk}/${dados.sitesTotal}`,
      };
    });
  }

  /**
   * Uma linha: espera a vez dela, roda a checagem e marca o resultado.
   *
   * A checagem tem teto de tempo próprio para a abertura não ficar presa numa resposta que nunca
   * chega — e nesse caso a linha mostra FALHOU, que é a verdade.
   */
  private async passo(
    id: string,
    passo: number,
    minhaVez: number,
    checar: () => Promise<{ ok: boolean; detalhe?: string }>,
  ): Promise<void> {
    await esperar(passo);
    if (minhaVez !== this.rodada) {
      return;
    }
    let resultado: { ok: boolean; detalhe?: string };
    try {
      resultado = await Promise.race([
        checar(),
        esperar(TETO_DA_CHECAGEM_MS).then(() => ({ ok: false }) as const),
      ]);
    } catch {
      resultado = { ok: false };
    }
    if (minhaVez !== this.rodada) {
      return;
    }
    this.linhas.update((linhas) =>
      linhas.map((linha) =>
        linha.id === id
          ? { ...linha, estado: resultado.ok ? 'ok' : 'falhou', detalhe: resultado.detalhe }
          : linha,
      ),
    );
  }

  /** Fala a apresentação — a da API, ou a de reserva se ela não veio. */
  private async apresentar(introducao: Introducao | null, minhaVez: number): Promise<void> {
    this.fase.set('falando');
    const texto = introducao?.texto?.trim() || FALA_DE_RESERVA;
    await this.voz.falar(texto);
    if (minhaVez !== this.rodada) {
      return;
    }
  }

  /**
   * Fecha a abertura: liga a escuta e tira o `?inicio=1` da URL.
   *
   * Tirar o parâmetro importa de verdade: sem isso um F5 — ou o Chrome restaurando a sessão —
   * repetiria a introdução inteira do nada.
   */
  private terminar(): void {
    this.fase.set('pronta');
    this.escuta.ligar();
    limparParametro();
  }
}

function linhasIniciais(): LinhaDeChecagem[] {
  return [
    { id: 'servidor', rotulo: 'CONECTANDO AO SERVIDOR', estado: 'pendente' },
    { id: 'voz', rotulo: 'SÍNTESE DE VOZ', estado: 'pendente' },
    { id: 'microfone', rotulo: 'MICROFONE', estado: 'pendente' },
    { id: 'sistemas', rotulo: 'SISTEMAS MONITORADOS', estado: 'pendente' },
  ];
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

/**
 * Respeita a preferência do sistema.
 *
 * Não é só acessibilidade: o Playwright roda com `reducedMotion: 'reduce'`, e uma abertura que
 * não termine depressa travaria a suíte de ponta a ponta.
 */
export function reduzirMovimento(): boolean {
  return (
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Tira o ?inicio=1 sem recarregar nem mexer no histórico. */
function limparParametro(): void {
  if (typeof history === 'undefined' || typeof location === 'undefined') {
    return;
  }
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAMETRO_DE_INICIO)) {
    return;
  }
  url.searchParams.delete(PARAMETRO_DE_INICIO);
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);
}
