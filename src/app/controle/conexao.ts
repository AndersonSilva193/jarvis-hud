import { FECHAMENTOS_FINAIS } from './controle.modelos';

/** Quanto tempo depois de cair ainda vale tentar: o mesmo que o servidor segura o par. */
export const TOLERANCIA_DE_QUEDA_MS = 30_000;
const ESPERAS_MS = [500, 1_000, 2_000, 4_000];

export type EstadoDaConexao = 'conectando' | 'aberta' | 'reconectando' | 'fechada';

export interface SocketMinimo {
  readonly readyState: number;
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  send(texto: string): void;
  close(codigo?: number, motivo?: string): void;
}

export interface OpcoesDaConexao {
  /** A URL de cada tentativa: a HUD pede bilhete novo a cada vez, o celular passa a retomada. */
  url(): Promise<string>;
  aoAbrir(): void;
  aoReceber(texto: string): void;
  /** `motivo` só vem com `fechada`: a frase para a tela. */
  aoMudar(estado: EstadoDaConexao, motivo?: string): void;
  criar?: (url: string) => SocketMinimo;
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (id: unknown) => void;
}

const ABERTO = 1;

/**
 * Um WebSocket que volta sozinho. Caiu sem um código final (os de {@link FECHAMENTOS_FINAIS}),
 * tenta de novo em 0,5 → 1 → 2 → 4 s, repetindo 4 s, até {@link TOLERANCIA_DE_QUEDA_MS} desde a
 * queda; passou disso, desiste e conta por quê. Fechar de propósito ({@link fechar}) não volta.
 */
export class ConexaoDoCanal {
  private socket: SocketMinimo | null = null;
  private quedaEm: number | null = null;
  private tentativa = 0;
  private espera: unknown = null;
  private encerrada = false;
  /** Sobe a cada tentativa: o `url()` que volta depois de outra tentativa (ou do fechar) desiste. */
  private geracao = 0;

  private readonly criar: (url: string) => SocketMinimo;
  private readonly agora: () => number;
  private readonly agendar: (fn: () => void, ms: number) => unknown;
  private readonly cancelar: (id: unknown) => void;

  constructor(private readonly opcoes: OpcoesDaConexao) {
    this.criar = opcoes.criar ?? ((url) => new WebSocket(url));
    this.agora = opcoes.agora ?? (() => performance.now());
    this.agendar = opcoes.agendar ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancelar = opcoes.cancelar ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  get aberta(): boolean {
    return this.socket?.readyState === ABERTO;
  }

  abrir(): void {
    this.encerrada = false;
    this.quedaEm = null;
    this.tentativa = 0;
    this.opcoes.aoMudar('conectando');
    void this.tentar();
  }

  enviar(texto: string): boolean {
    if (!this.aberta) return false;
    this.socket!.send(texto);
    return true;
  }

  /** De propósito: 1000 é o "Sair", que o servidor entende como fim do par. Não reconecta. */
  fechar(codigo = 1000): void {
    this.encerrada = true;
    this.geracao++;
    if (this.espera !== null) this.cancelar(this.espera);
    this.espera = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close(codigo);
    }
  }

  private async tentar(): Promise<void> {
    const geracao = ++this.geracao;
    let url: string;
    try {
      url = await this.opcoes.url();
    } catch {
      if (geracao === this.geracao) this.caiu();
      return;
    }
    if (geracao !== this.geracao || this.encerrada) return;
    const socket = this.criar(url);
    this.socket = socket;
    socket.onopen = () => {
      this.quedaEm = null;
      this.tentativa = 0;
      this.opcoes.aoMudar('aberta');
      this.opcoes.aoAbrir();
    };
    socket.onmessage = (e) => {
      if (typeof e.data === 'string') this.opcoes.aoReceber(e.data);
    };
    socket.onerror = () => {
      // O close vem logo depois, com o código: é lá que se decide.
    };
    socket.onclose = (e) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const final = FECHAMENTOS_FINAIS[e.code];
      if (final) {
        this.encerrada = true;
        this.opcoes.aoMudar('fechada', final);
        return;
      }
      this.caiu();
    };
  }

  private caiu(): void {
    if (this.encerrada) return;
    const agora = this.agora();
    this.quedaEm ??= agora;
    if (agora - this.quedaEm >= TOLERANCIA_DE_QUEDA_MS) {
      this.encerrada = true;
      this.opcoes.aoMudar('fechada', 'Sem conexão com o servidor há 30 s.');
      return;
    }
    this.opcoes.aoMudar('reconectando');
    const espera = ESPERAS_MS[Math.min(this.tentativa++, ESPERAS_MS.length - 1)]!;
    const resta = TOLERANCIA_DE_QUEDA_MS - (agora - this.quedaEm);
    this.espera = this.agendar(() => {
      this.espera = null;
      void this.tentar();
    }, Math.min(espera, resta));
  }
}
