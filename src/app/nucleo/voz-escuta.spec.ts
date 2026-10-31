import { PainelHudService } from './painel-hud.service';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { OrbeComponent } from '../componentes/orbe/orbe';
import { ConversaService } from './conversa.service';
import { EscutaService, respostaDasObservacoes } from './escuta.service';
import { VozService } from './voz.service';
import { BriefingPlayerService } from './briefing-player.service';
import { JarvisApiService } from './jarvis-api.service';
import { JarvisEventosService } from './jarvis-eventos.service';
import { HudPage } from '../paginas/hud/hud.page';
import type { Briefing } from './briefing.modelos';

class ReconhecimentoFalso {
  static sessoes: ReconhecimentoFalso[] = [];
  lang = '';
  continuous = false;
  interimResults = true;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((evento: { error: string }) => void) | null = null;
  onresult: ((evento: unknown) => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
  stop = vi.fn();
  constructor() {
    ReconhecimentoFalso.sessoes.push(this);
  }
  iniciar(): void {
    this.onstart?.();
  }
  ouvir(frase: string): void {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: frase } }] });
  }
}

class FalaFalsa {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onboundary: (() => void) | null = null;
  constructor(readonly text: string) {}
}

const BRIEFING: Briefing = {
  geradoEm: '2026-10-14T08:00:00-03:00',
  nomeUsuario: 'Anderson',
  abertura: 'Bom dia, senhor.',
  encerramento: 'Tudo tranquilo hoje.',
  secoes: [],
  texto: '',
  geradoAgora: true,
};

describe('voz e escuta integradas', () => {
  let escuta: EscutaService;
  let voz: VozService;
  let falas: FalaFalsa[];
  let pagina: HudPage | undefined;
  const ouvinte = vi.fn();
  const gerar = vi.fn();
  const sessao = () => ReconhecimentoFalso.sessoes.at(-1)!;
  const microtarefas = async () => {
    await vi.advanceTimersByTimeAsync(0);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    ouvinte.mockClear();
    ReconhecimentoFalso.sessoes = [];
    falas = [];
    pagina = undefined;
    gerar.mockReset().mockResolvedValue(BRIEFING);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: JarvisApiService,
          useValue: {
            gerarBriefing: gerar,
            ultimoBriefing: async () => null,
            // Voz remota desligada: aqui o que se testa é a síntese do navegador.
            sintetizarVoz: async () => ({ provedor: 'navegador', motivo: 'desligado' }),
            urlDoAudio: (rota: string) => rota,
            statusVoz: async () => null,
          },
        },
        {
          provide: JarvisEventosService,
          useValue: {
            conectar: vi.fn(),
            desconectar: vi.fn(),
            status: signal('online'),
            motivo: signal(null),
          },
        },
      ],
    });
    vi.stubGlobal('SpeechRecognition', ReconhecimentoFalso);
    vi.stubGlobal('SpeechSynthesisUtterance', FalaFalsa);
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [],
      addEventListener: vi.fn(),
      cancel: vi.fn(),
      resume: vi.fn(),
      speak: (fala: FalaFalsa) => falas.push(fala),
    });
    voz = TestBed.inject(VozService);
    escuta = TestBed.inject(EscutaService);
    escuta.escutar(ouvinte);
    TestBed.tick();
  });

  afterEach(() => {
    pagina?.ngOnDestroy();
    escuta.soltarMicrofone();
    voz.parar();
    TestBed.resetTestingModule();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function ligar(): void {
    escuta.ligar();
    sessao().iniciar();
  }
  function ouvirResposta(sinal?: AbortSignal): Promise<string> {
    return escuta.ouvirPor(8000, sinal, (frase) => respostaDasObservacoes(frase) !== null);
  }
  async function terminarFala(): Promise<void> {
    falas.at(-1)!.onend?.();
    await microtarefas();
    TestBed.tick();
  }

  /**
   * Espera a ida à API de voz, que hoje acontece antes do primeiro som: só depois dela a
   * utterance existe e o microfone é pausado. São microtarefas puras de propósito — avançar o
   * relógio falso aqui esbarraria no laço de animação, que reagenda a cada quadro.
   */
  async function inicioDaFala(): Promise<void> {
    for (let volta = 0; volta < 5; volta += 1) {
      await Promise.resolve();
    }
  }

  it('começa desligado, configura pt-BR contínuo e lembra a preferência ao sair e voltar', () => {
    expect(escuta.ligada()).toBe(false);
    ligar();
    expect(sessao()).toMatchObject({ lang: 'pt-BR', continuous: true, interimResults: false });
    escuta.soltarMicrofone();
    expect(escuta.ligada()).toBe(true);
    expect(localStorage.getItem('jarvis-hud.escuta')).toBe('sim');
    escuta.escutar(ouvinte);
    expect(ReconhecimentoFalso.sessoes).toHaveLength(2);
  });

  it('aceita o construtor com prefixo webkit', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', ReconhecimentoFalso);
    ligar();
    expect(sessao().start).toHaveBeenCalledOnce();
  });

  it('aborta antes de falar e só retoma 400 ms após o fim', async () => {
    ligar();
    const antiga = sessao();
    const fala = voz.falar('Bom dia, Jarvis.');
    await inicioDaFala();
    expect(antiga.abort).toHaveBeenCalledOnce();
    expect(escuta.ouvindo()).toBe(false);
    antiga.ouvir('Jarvis');
    expect(ouvinte).not.toHaveBeenCalled();
    await terminarFala();
    await fala;
    await vi.advanceTimersByTimeAsync(399);
    expect(ReconhecimentoFalso.sessoes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    sessao().iniciar();
    expect(escuta.ouvindo()).toBe(true);
  });

  it('ligar durante fala não abre captura; fala antiga não encerra a nova', async () => {
    const antiga = voz.falar('Primeira.');
    await inicioDaFala();
    const fimAntigo = falas[0]!.onend;
    escuta.ligar();
    expect(ReconhecimentoFalso.sessoes).toHaveLength(0);
    const nova = voz.falar('Segunda.');
    await inicioDaFala();
    fimAntigo?.();
    await antiga;
    TestBed.tick();
    expect(voz.falando()).toBe(true);
    expect(escuta.ouvindo()).toBe(false);
    await terminarFala();
    await nova;
  });

  it('parar resolve a fala mesmo sem evento do navegador e não fala os pedaços restantes', async () => {
    const fala = voz.falar('Uma frase longa. '.repeat(50));
    await inicioDaFala();
    voz.parar();
    await fala;
    expect(falas).toHaveLength(1);
    expect(voz.falando()).toBe(false);
  });

  it('conta oito segundos a partir do onstart e ignora outras frases sem disparar ativação', async () => {
    escuta.ligar();
    const concluiu = vi.fn();
    const resposta = ouvirResposta().then(concluiu);
    await vi.advanceTimersByTimeAsync(5000);
    sessao().iniciar();
    sessao().ouvir('Jarvis, espere');
    await vi.advanceTimersByTimeAsync(7999);
    expect(concluiu).not.toHaveBeenCalled();
    expect(ouvinte).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await resposta;
    expect(concluiu).toHaveBeenCalledWith('');
    expect(escuta.aguardandoResposta()).toBe(false);
    sessao().ouvir('Jarvis');
    expect(ouvinte).toHaveBeenCalledWith('Jarvis');
  });

  it('desiste em dez segundos se a captura não iniciar', async () => {
    escuta.ligar();
    const resposta = ouvirResposta();
    await vi.advanceTimersByTimeAsync(10000);
    await expect(resposta).resolves.toBe('');
    expect(escuta.aguardandoResposta()).toBe(false);
  });

  it('aceita o sim no segundo resultado final do mesmo evento', async () => {
    ligar();
    const resposta = ouvirResposta();
    sessao().onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: true, 0: { transcript: 'espere' } },
        { isFinal: true, 0: { transcript: 'sim' } },
      ],
    });
    await expect(resposta).resolves.toBe('sim');
  });

  it.each(['sim', 'quero', 'claro', 'pode', 'não quero', 'nem pode', 'negativo, sim'])(
    'resolve a resposta reconhecida: %s',
    async (frase) => {
      ligar();
      const resposta = ouvirResposta();
      sessao().ouvir(frase);
      await expect(resposta).resolves.toBe(frase);
      expect(escuta.aguardandoResposta()).toBe(false);
    },
  );

  it.each(['não quero', 'nem pode', 'negativo, sim'])('negativa prevalece: %s', (frase) => {
    expect(respostaDasObservacoes(frase)).toBe('nao');
  });

  it('cancelar uma espera não deixa seu timer apagar a seguinte', async () => {
    ligar();
    const controle = new AbortController();
    const antiga = ouvirResposta(controle.signal);
    controle.abort();
    await expect(antiga).resolves.toBe('');
    await vi.advanceTimersByTimeAsync(4000);
    const nova = ouvirResposta();
    await vi.advanceTimersByTimeAsync(4001);
    expect(escuta.aguardandoResposta()).toBe(true);
    sessao().ouvir('sim');
    await expect(nova).resolves.toBe('sim');
  });

  it.each(['desligar', 'soltarMicrofone'] as const)(
    '%s cancela espera e descarta eventos antigos',
    async (metodo) => {
      ligar();
      const antiga = sessao();
      const resposta = ouvirResposta();
      escuta[metodo]();
      await expect(resposta).resolves.toBe('');
      antiga.iniciar();
      antiga.ouvir('Jarvis');
      antiga.onerror?.({ error: 'not-allowed' });
      antiga.onend?.();
      await vi.advanceTimersByTimeAsync(15000);
      expect(escuta.ouvindo()).toBe(false);
      expect(escuta.motivo()).toBeNull();
      expect(ouvinte).not.toHaveBeenCalled();
      expect(ReconhecimentoFalso.sessoes).toHaveLength(1);
    },
  );

  it('sair durante fala impede reabertura quando a fala termina', async () => {
    ligar();
    const fala = voz.falar('Uma fala.');
    await inicioDaFala();
    escuta.soltarMicrofone();
    await terminarFala();
    await fala;
    await vi.advanceTimersByTimeAsync(15000);
    expect(ReconhecimentoFalso.sessoes).toHaveLength(1);
  });

  it('reconecta no fim de sessão e para de insistir quando a permissão é negada', async () => {
    ligar();
    sessao().onend?.();
    await vi.advanceTimersByTimeAsync(300);
    expect(ReconhecimentoFalso.sessoes).toHaveLength(2);
    sessao().iniciar();
    const resposta = ouvirResposta();
    sessao().onerror?.({ error: 'not-allowed' });
    await expect(resposta).resolves.toBe('');
    await vi.advanceTimersByTimeAsync(15000);
    expect(escuta.ligada()).toBe(false);
    expect(escuta.motivo()).toBe('permissao-negada');
    expect(ReconhecimentoFalso.sessoes).toHaveLength(2);
  });

  function montarPagina(): { player: BriefingPlayerService; gerar: ReturnType<typeof vi.fn> } {
    // Instancia a página sem canvas: aqui verificamos a coordenação real dos serviços.
    pagina = TestBed.runInInjectionContext(() => new HudPage());
    const player = TestBed.inject(BriefingPlayerService);
    player.pausaDeEntradaMs = 0;
    pagina.ngOnInit();
    ligar();
    return { player, gerar };
  }

  it('Jarvis com uma pergunta envia um único ditado e não pede briefing', async () => {
    montarPagina();
    const conversa = TestBed.inject(ConversaService);
    const enviar = vi.spyOn(conversa, 'enviar').mockResolvedValue(true);
    sessao().ouvir('Jarvis, como está o servidor?');
    expect(escuta.ditando()).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);
    expect(enviar).toHaveBeenCalledExactlyOnceWith('como está o servidor?');
    expect(gerar).not.toHaveBeenCalled();
  });

  it('conversa interrompe a pergunta do briefing e guarda eventos recebidos', async () => {
    const { player } = montarPagina();
    const tocando = player.tocar(BRIEFING);
    await microtarefas();
    await terminarFala();
    await terminarFala();
    await vi.advanceTimersByTimeAsync(400);
    sessao().iniciar();
    const antiga = sessao();
    const conversa = TestBed.inject(ConversaService);
    // A conversa assume a tela: o briefing em curso para e o que chegar depois fica guardado.
    conversa.assumirPalco();
    TestBed.inject(PainelHudService).abrir('conversa');
    const eventos = TestBed.inject(JarvisEventosService);
    const ouvintes = vi.mocked(eventos.conectar).mock.calls[0][0];
    ouvintes.briefing({ ...BRIEFING, abertura: 'Novo briefing' });
    antiga.ouvir('sim');
    await tocando;
    expect(escuta.aguardandoResposta()).toBe(false);
    expect(falas.some((f) => f.text === BRIEFING.encerramento || f.text === 'Novo briefing')).toBe(
      false,
    );
    expect(pagina!['briefingGuardado']()?.abertura).toBe('Novo briefing');
  });

  it('setas no campo de texto não pulam briefing', () => {
    const { player } = montarPagina();
    const pular = vi.spyOn(player, 'pular');
    const texto = document.createElement('textarea');
    document.body.appendChild(texto);
    try {
      texto.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(pular).not.toHaveBeenCalled();
    } finally {
      texto.remove();
    }
  });

  it('duas ativações geram um POST; pergunta uma vez e só fala observações depois do sim', async () => {
    const { gerar } = montarPagina();
    sessao().ouvir('Bom dia, Jarvis');
    sessao().ouvir('Jarvis');
    await microtarefas();
    expect(gerar).toHaveBeenCalledOnce();
    await terminarFala();
    expect(falas.at(-1)!.text).toBe('O senhor quer ouvir as observações?');
    await terminarFala();
    await vi.advanceTimersByTimeAsync(400);
    sessao().iniciar();
    sessao().ouvir('pode');
    await microtarefas();
    expect(falas.at(-1)!.text).toBe(BRIEFING.encerramento);
    expect(falas.filter((f) => f.text === BRIEFING.encerramento)).toHaveLength(1);
  });

  it.each(['escape', 'novo', 'sair', 'desligar'])(
    '%s impede observações atrasadas',
    async (acao) => {
      const { player } = montarPagina();
      const tocando = player.tocar(BRIEFING);
      await microtarefas();
      await terminarFala();
      await terminarFala();
      await vi.advanceTimersByTimeAsync(400);
      sessao().iniciar();
      const antiga = sessao();
      if (acao === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      if (acao === 'novo') player.gerando();
      if (acao === 'sair') {
        pagina!.ngOnDestroy();
        pagina = undefined;
      }
      if (acao === 'desligar') pagina!['alternarEscuta']();
      antiga.ouvir('sim');
      await tocando;
      expect(falas.some((f) => f.text === BRIEFING.encerramento)).toBe(false);
      expect(escuta.aguardandoResposta()).toBe(false);
    },
  );

  it('não oferece observações de backend antigo', async () => {
    const { player } = montarPagina();
    const tocando = player.tocar({ ...BRIEFING, encerramento: undefined });
    await microtarefas();
    await terminarFala();
    await tocando;
    expect(falas).toHaveLength(1);
  });

  it('desligar durante a pergunta interrompe a fala e não abre espera', async () => {
    const { player } = montarPagina();
    const tocando = player.tocar(BRIEFING);
    await microtarefas();
    await terminarFala();
    expect(falas.at(-1)!.text).toBe('O senhor quer ouvir as observações?');
    pagina!['alternarEscuta']();
    await tocando;
    expect(voz.falando()).toBe(false);
    expect(escuta.aguardandoResposta()).toBe(false);
    expect(player.fase()).toBe('concluido');
  });
});

describe('controles de microfone na HUD', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(OrbeComponent.prototype, 'ngAfterViewInit').mockImplementation(() => {});
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: JarvisApiService,
          useValue: {
            ultimoBriefing: async () => null,
            sintetizarVoz: async () => ({ provedor: 'navegador', motivo: 'desligado' }),
            urlDoAudio: (rota: string) => rota,
            statusVoz: async () => null,
          },
        },
        {
          provide: JarvisEventosService,
          useValue: {
            conectar: vi.fn(),
            desconectar: vi.fn(),
            status: signal('online'),
            motivo: signal(null),
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('esconde o botão quando o reconhecimento não existe', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('.microfone')).toBeNull();
  });

  it('botão acessível alterna; indicador só acende ao iniciar captura e mostra espera', async () => {
    vi.stubGlobal('SpeechRecognition', ReconhecimentoFalso);
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();
    const botao: HTMLButtonElement = tela.nativeElement.querySelector('.microfone');
    // A linha de estado agora é fixa — quem acende é o ponto, e o texto diz qual é o estado.
    const estado = () => tela.nativeElement.querySelector('.falando');
    expect(botao.getAttribute('aria-pressed')).toBe('false');
    botao.click();
    tela.detectChanges();
    expect(botao.getAttribute('aria-pressed')).toBe('true');
    expect(estado().textContent).toContain('Às suas ordens');
    expect(estado().querySelector('.ponto--ativo')).toBeNull();
    ReconhecimentoFalso.sessoes.at(-1)!.iniciar();
    tela.detectChanges();
    expect(estado().textContent).toContain('Ouvindo');
    expect(estado().querySelector('.ponto--ativo')).not.toBeNull();
    const escuta = TestBed.inject(EscutaService);
    const resposta = escuta.ouvirPor(8000);
    tela.detectChanges();
    expect(estado().textContent).toContain('Aguardando resposta');
    botao.click();
    tela.detectChanges();
    await expect(resposta).resolves.toBe('');
    expect(botao.getAttribute('aria-pressed')).toBe('false');
  });
});
