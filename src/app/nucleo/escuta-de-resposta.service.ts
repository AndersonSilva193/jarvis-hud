import { Service, inject, signal } from '@angular/core';
import type { Briefing } from './briefing.modelos';
import type { RespostaConversa } from './conversa.modelos';
import { ConversaService } from './conversa.service';
import { EscutaService, contem, respostaDasObservacoes } from './escuta.service';
import { normalizarCodigo } from './normalizar-codigo';
import { VozService } from './voz.service';

const PERGUNTA_DAS_OBSERVACOES = 'O senhor quer ouvir as observações?';
const JANELA_DAS_OBSERVACOES_MS = 8_000;
const PAUSA_APOS_FALA_MS = 300;
const LIMITE_AUTOMATICO = 5;
const AVISO_SEM_RESPOSTA = 'Sem resposta. Diga Jarvis quando quiser continuar.';

type FaseResposta = 'inativa' | 'preparando' | 'ouvindo' | 'opcoes';

/** Coordena uma resposta esperada sem acordar o Jarvis pela própria voz. */
@Service()
export class EscutaDeRespostaService {
  private readonly conversa = inject(ConversaService);
  private readonly escuta = inject(EscutaService);
  private readonly voz = inject(VozService);

  readonly fase = signal<FaseResposta>('inativa');
  readonly motivo = signal('');
  readonly opcoes = signal<string[]>([]);
  readonly aviso = signal('');

  private controle: AbortController | null = null;
  private observacoes: AbortController | null = null;
  private ditadoProprio = false;
  private geracao = 0;
  private consecutivas = 0;

  receberResposta(resposta: RespostaConversa, narracao: Promise<void>): void {
    this.cancelar();
    if (resposta.canal !== 'hud' || resposta.erro || !resposta.escuta) return;
    const { tempoSegundos, motivo = '' } = resposta.escuta;
    if (!Number.isFinite(tempoSegundos) || tempoSegundos <= 0) return;
    this.aviso.set('');
    this.opcoes.set(opcoesDe(resposta));
    this.motivo.set(motivo.trim());
    this.fase.set('preparando');
    const controle = new AbortController();
    this.controle = controle;
    const geracao = ++this.geracao;
    void this.abrirQuandoPronta(resposta, narracao, tempoSegundos, controle, geracao);
  }

  private async abrirQuandoPronta(
    resposta: RespostaConversa,
    narracao: Promise<void>,
    tempoSegundos: number,
    controle: AbortController,
    geracao: number,
  ): Promise<void> {
    try {
      await narracao;
    } catch {
      // A síntese pode falhar; ainda se respeita o estado real da voz.
    }
    do {
      while (this.voz.falando() && !controle.signal.aborted) {
        await esperar(50, controle.signal);
      }
      if (!await esperar(PAUSA_APOS_FALA_MS, controle.signal) || geracao !== this.geracao) return;
    } while (this.voz.falando());
    if (this.consecutivas >= LIMITE_AUTOMATICO || !this.escuta.disponivel ||
        !await this.permissaoAutomatica()) {
      if (!controle.signal.aborted && geracao === this.geracao) this.fase.set('opcoes');
      return;
    }
    if (controle.signal.aborted || geracao !== this.geracao) return;
    this.consecutivas++;
    this.ditadoProprio = true;
    this.fase.set('ouvindo');
    const texto = await this.escuta.ditar('', {
      tempoParaComecarMs: tempoSegundos * 1000,
      sinal: controle.signal,
      aoAbrir: () => this.tocarBip(),
    });
    this.ditadoProprio = false;
    if (controle.signal.aborted || geracao !== this.geracao) return;
    this.fase.set('inativa');
    this.opcoes.set([]);
    this.motivo.set('');
    this.controle = null;
    if (!texto) {
      this.aviso.set(AVISO_SEM_RESPOSTA);
      return;
    }
    const mensagem = this.mensagemDaResposta(texto, resposta);
    if (contem(texto, ['só isso', 'obrigado', 'pode parar'])) {
      this.consecutivas = LIMITE_AUTOMATICO;
    }
    void this.conversa.enviar(mensagem);
  }

  selecionarOpcao(opcao: string): void {
    if (!this.opcoes().includes(opcao)) return;
    this.registrarClique();
    void this.conversa.enviar(opcao);
  }

  registrarClique(): void {
    this.consecutivas = 0;
    this.cancelar();
  }

  registrarAtivacao(): void {
    this.consecutivas = 0;
    this.cancelar();
  }

  cancelar(): void {
    this.geracao++;
    this.controle?.abort();
    this.controle = null;
    this.observacoes?.abort();
    this.observacoes = null;
    if (this.ditadoProprio) this.escuta.cancelarDitado();
    this.ditadoProprio = false;
    this.fase.set('inativa');
    this.motivo.set('');
    this.opcoes.set([]);
    this.aviso.set('');
  }

  /** Mantém o epílogo do briefing na mesma coordenação de perguntas. */
  async perguntarObservacoes(briefing: Briefing, sinal: AbortSignal): Promise<void> {
    const encerramento = briefing.encerramento?.trim() ?? '';
    if (!encerramento || !this.escuta.ligada() || sinal.aborted) return;
    this.observacoes?.abort();
    const controle = new AbortController();
    this.observacoes = controle;
    const cancelar = () => controle.abort();
    sinal.addEventListener('abort', cancelar, { once: true });
    try {
      await this.voz.falar(PERGUNTA_DAS_OBSERVACOES, controle.signal);
      if (controle.signal.aborted || !this.escuta.ligada()) return;
      const resposta = await this.escuta.ouvirPor(
        JANELA_DAS_OBSERVACOES_MS,
        controle.signal,
        (frase) => respostaDasObservacoes(frase) !== null,
      );
      if (!controle.signal.aborted && this.escuta.ligada() &&
          respostaDasObservacoes(resposta) === 'sim') {
        await this.voz.falar(encerramento, controle.signal);
      }
    } finally {
      sinal.removeEventListener('abort', cancelar);
      if (this.observacoes === controle) this.observacoes = null;
    }
  }

  private mensagemDaResposta(texto: string, resposta: RespostaConversa): string {
    // Sem opções a oferecer, a fala vale como mensagem digitada: quem decide se foi sim ou não é
    // o servidor, e achatar "agora não, só amanhã" em `cancelar` perderia a resposta.
    if (opcoesDe(resposta).length === 0) return texto;
    const confirmacao = resposta.confirmacao;
    if (!confirmacao || Date.parse(confirmacao.expiraEm) <= Date.now()) return texto;
    if (contem(texto, ['cancelar', 'não'])) return 'cancelar';
    if (normalizarCodigo(texto) === normalizarCodigo(confirmacao.codigo)) {
      return `confirmo ${confirmacao.codigo}`;
    }
    return texto;
  }

  private async permissaoAutomatica(): Promise<boolean> {
    if (this.escuta.ligada()) return true;
    if (!navigator.permissions?.query) return false;
    try {
      const permissao = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return permissao.state === 'granted';
    } catch {
      return false;
    }
  }

  private tocarBip(): void {
    if (typeof AudioContext === 'undefined') return;
    try {
      const contexto = new AudioContext();
      const oscilador = contexto.createOscillator();
      const ganho = contexto.createGain();
      oscilador.frequency.value = 660;
      ganho.gain.value = 0.025;
      oscilador.connect(ganho);
      ganho.connect(contexto.destination);
      oscilador.start();
      oscilador.stop(contexto.currentTime + 0.07);
      oscilador.onended = () => void contexto.close();
    } catch {
      // Autoplay pode bloquear o bip, sem bloquear a resposta.
    }
  }
}

/** As opções que a resposta realmente oferece — texto em branco não é opção. */
function opcoesDe(resposta: RespostaConversa): string[] {
  return (resposta.escuta?.opcoes ?? []).filter((opcao) => !!opcao.trim());
}

function esperar(ms: number, sinal: AbortSignal): Promise<boolean> {
  if (sinal.aborted) return Promise.resolve(false);
  return new Promise((resolver) => {
    const cancelar = () => concluir(false);
    const concluir = (ok: boolean) => {
      clearTimeout(prazo);
      sinal.removeEventListener('abort', cancelar);
      resolver(ok);
    };
    const prazo = setTimeout(() => concluir(true), ms);
    sinal.addEventListener('abort', cancelar, { once: true });
  });
}
