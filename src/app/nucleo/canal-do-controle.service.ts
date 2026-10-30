import { Service, signal } from '@angular/core';

import { AgregadorDeEventos } from '../controle/agregador';
import { ConexaoDoCanal, type OpcoesDaConexao } from '../controle/conexao';
import { lerMensagemParaControle, urlDoCanal, type EventoDoControle } from '../controle/controle.modelos';
import { INTERVALO_DO_ECO_MS, JANELA_DE_AMOSTRAS, MedidorDeLatencia, type ResumoDaLatencia } from '../controle/latencia';

/**
 * - `parado`: sem canal (a página abriu sem QR, ou o dono saiu).
 * - `conectando` / `reconectando`: tentando, por até 30 s desde a queda.
 * - `conectado`: os gestos chegam ao PC.
 * - `pcFora`: o canal está bom, mas a HUD do PC caiu; o servidor espera ela voltar.
 * - `encerrado`: acabou; `motivo` diz por quê.
 */
export type EstadoDoControle = 'parado' | 'conectando' | 'conectado' | 'reconectando' | 'pcFora' | 'encerrado';

export interface CredencialDoControle {
  api: string;
  /** O código do QR (primeira entrada) ou a chave de retomada (volta depois de recarregar). */
  par?: string;
  retomada?: string;
}

const CHAVE = 'jarvis-hud.controle.v1';

/**
 * O lado do celular no `/ws/holograma`. Não usa o `HUD_TOKEN` nem chama `/api`: o código do QR
 * (e depois a chave de retomada) é a única credencial, e ela só serve para mandar gestos.
 *
 * Tudo o que sai passa pelo {@link AgregadorDeEventos} (no máximo 30 mensagens/s), inclusive o eco
 * de 2 em 2 s que mede a ida e volta até o PC.
 */
@Service()
export class CanalDoControleService {
  readonly estado = signal<EstadoDoControle>('parado');
  readonly motivo = signal('');
  readonly latencia = signal<ResumoDaLatencia | null>(null);

  private conexao: ConexaoDoCanal | null = null;
  private readonly medidor = new MedidorDeLatencia();
  private readonly agregador: AgregadorDeEventos;
  private credencial: CredencialDoControle | null = null;
  private relogioDoEco: ReturnType<typeof setInterval> | null = null;
  private ecos = 0;

  constructor() {
    this.agregador = new AgregadorDeEventos((m) => this.conexao?.enviar(JSON.stringify(m)));
  }

  /** A chave guardada nesta aba: recarregar a página volta ao mesmo par sem QR. */
  credencialGuardada(): CredencialDoControle | null {
    try {
      const bruto: unknown = JSON.parse(sessionStorage.getItem(CHAVE) ?? 'null');
      if (typeof bruto !== 'object' || bruto === null) return null;
      const { api, retomada } = bruto as Record<string, unknown>;
      return typeof api === 'string' && typeof retomada === 'string' ? { api, retomada } : null;
    } catch {
      return null;
    }
  }

  conectar(credencial: CredencialDoControle, opcoes: Partial<OpcoesDaConexao> = {}): void {
    this.conexao?.fechar();
    this.credencial = { ...credencial };
    this.motivo.set('');
    this.conexao = new ConexaoDoCanal({
      url: async () => {
        const c = this.credencial!;
        return urlDoCanal(c.api, c.retomada ? { retomada: c.retomada } : { par: c.par ?? '' });
      },
      aoAbrir: () => {
        this.agregador.descartar();
        this.medidor.reiniciarPendentes();
      },
      aoReceber: (texto) => this.receber(texto),
      aoMudar: (estado, motivo) => {
        if (estado === 'conectando' || estado === 'reconectando') this.estado.set(estado);
        if (estado === 'fechada') this.encerrar(motivo ?? 'Controle encerrado.');
      },
      ...opcoes,
    });
    this.conexao.abrir();
  }

  enviar(evento: EventoDoControle): void {
    if (this.estado() === 'conectado') this.agregador.adicionar(evento);
  }

  /** O "Sair": fecha com 1000, e o servidor acaba o par na hora. */
  sair(): void {
    this.conexao?.fechar(1000);
    this.esquecer();
    this.encerrar('Controle encerrado.');
    this.estado.set('parado');
  }

  private receber(texto: string): void {
    const m = lerMensagemParaControle(texto);
    if (!m) return;
    switch (m.t) {
      case 'pareado':
        this.credencial = { api: this.credencial!.api, retomada: m.retomada };
        this.guardar(this.credencial);
        this.estado.set('conectado');
        this.motivo.set('');
        this.ligarEco();
        break;
      case 'hud':
        if (m.e === 'caiu') {
          this.estado.set('pcFora');
          this.motivo.set('O PC saiu do ar. Esperando ele voltar…');
        } else if (m.e === 'voltou') {
          this.estado.set('conectado');
          this.motivo.set('');
        }
        // `encerrado` vem junto com o fechamento 4404, que a conexão já explica.
        break;
      case 'eco':
        if (this.medidor.voltou(m.n) !== null) this.latencia.set(this.medidor.resumo());
        break;
    }
  }

  private ligarEco(): void {
    if (this.relogioDoEco) return;
    this.relogioDoEco = setInterval(() => {
      if (this.estado() !== 'conectado') return;
      this.agregador.adicionar(this.medidor.novoEco());
      // Uma vez por janela, o resumo vai ao log do servidor: é lá que a medida fica registrada.
      const resumo = this.medidor.resumo();
      if (++this.ecos % JANELA_DE_AMOSTRAS === 0 && resumo) this.agregador.adicionar({ t: 'latencia', ...resumo });
    }, INTERVALO_DO_ECO_MS);
  }

  private encerrar(motivo: string): void {
    if (this.relogioDoEco) clearInterval(this.relogioDoEco);
    this.relogioDoEco = null;
    this.agregador.descartar();
    this.conexao = null;
    this.estado.set('encerrado');
    this.motivo.set(motivo);
    // Recusa final: a chave não abre mais nada.
    this.esquecer();
  }

  private guardar(c: CredencialDoControle): void {
    try {
      sessionStorage.setItem(CHAVE, JSON.stringify({ api: c.api, retomada: c.retomada }));
    } catch {
      // Sem sessionStorage, recarregar a página pede o QR de novo; o resto funciona.
    }
  }

  private esquecer(): void {
    try {
      sessionStorage.removeItem(CHAVE);
    } catch {
      // Idem.
    }
  }
}
