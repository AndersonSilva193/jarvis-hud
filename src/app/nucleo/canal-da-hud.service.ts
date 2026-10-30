import { Service, inject, signal } from '@angular/core';

import { ConexaoDoCanal, type OpcoesDaConexao } from '../controle/conexao';
import { lerMensagensParaHud, urlDoCanal, type EventoDoControle } from '../controle/controle.modelos';
import { ConfigStore } from './config.store';
import { JarvisApiService } from './jarvis-api.service';

/**
 * - `desligado`: sem canal aberto (o normal).
 * - `abrindo`: pedindo bilhete e abrindo o socket.
 * - `aguardando`: o QR está na tela, esperando o celular.
 * - `conectado`: o celular comanda o holograma.
 * - `caiu`: o celular (ou este canal) caiu; o servidor segura o par por 30 s.
 */
export type EstadoDoCelular = 'desligado' | 'abrindo' | 'aguardando' | 'conectado' | 'caiu';

type Ouvinte = (eventos: EventoDoControle[]) => void;

export const AVISO_DE_QUEDA = 'Celular desconectado — de volta ao mouse e à câmera.';
export const AVISO_SEM_CANAL = 'O servidor não abriu o canal do controle. Tentando de novo…';

/**
 * O lado do PC no `/ws/holograma`: pede o código do QR, recebe os gestos do celular e responde os
 * ecos da medição de latência na hora. Só abre quando o dono pede o controle pelo celular.
 */
@Service()
export class CanalDaHudService {
  private readonly api = inject(JarvisApiService);
  private readonly config = inject(ConfigStore);

  readonly estado = signal<EstadoDoCelular>('desligado');
  /** O código do QR e quando ele vence (`Date.now()`). */
  readonly codigo = signal<{ codigo: string; expiraEm: number } | null>(null);
  /** A frase da região viva: queda, volta, recusa. */
  readonly aviso = signal('');

  private conexao: ConexaoDoCanal | null = null;
  /** A chave que o servidor deu a esta HUD para voltar ao par se o canal dela cair. */
  private retomada: string | null = null;
  private readonly ouvintes = new Set<Ouvinte>();

  /** Os gestos do celular, já validados. Devolve a função que para de ouvir. */
  ouvir(ouvinte: Ouvinte): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  /** Abre o canal (se preciso) e pede um código novo. */
  parear(opcoes: Partial<OpcoesDaConexao> = {}): void {
    this.aviso.set('');
    if (this.conexao?.aberta) {
      this.conexao.enviar(JSON.stringify({ t: 'parear' }));
      return;
    }
    this.conexao?.fechar();
    this.retomada = null;
    this.estado.set('abrindo');
    this.conexao = new ConexaoDoCanal({
      url: async () => {
        const bilhete = await this.api.bilheteDoCanal();
        return urlDoCanal(this.config.urlApi(), this.retomada ? { bilhete, retomada: this.retomada } : { bilhete });
      },
      // Sem par, a conexão nova pede o código de novo: o anterior morreu com a sessão que caiu.
      aoAbrir: () => {
        if (!this.retomada) this.conexao?.enviar(JSON.stringify({ t: 'parear' }));
      },
      aoReceber: (texto) => this.receber(texto),
      aoMudar: (estado, motivo) => {
        if (estado === 'reconectando' && this.estado() === 'conectado') {
          this.estado.set('caiu');
          this.aviso.set(AVISO_DE_QUEDA);
        }
        // Nem abriu (bilhete recusado, rota fora do nginx, backend velho): a tela diz, e segue tentando.
        if (estado === 'reconectando' && this.estado() === 'abrindo') this.aviso.set(AVISO_SEM_CANAL);
        if (estado === 'fechada') this.encerrar(motivo ?? '');
      },
      ...opcoes,
    });
    this.conexao.abrir();
  }

  /** O botão "Desconectar": o servidor fecha o celular e confirma com `encerrado`. */
  desconectar(): void {
    if (!this.conexao?.enviar(JSON.stringify({ t: 'desconectar' }))) this.fechar();
  }

  /** Fecha o canal sem cerimônia (o holograma fechou, ou o diálogo foi cancelado sem par). */
  fechar(): void {
    this.conexao?.fechar();
    this.conexao = null;
    this.retomada = null;
    this.codigo.set(null);
    this.estado.set('desligado');
  }

  private receber(texto: string): void {
    const eventos: EventoDoControle[] = [];
    for (const m of lerMensagensParaHud(texto)) {
      switch (m.t) {
        case 'par':
          this.codigo.set({ codigo: m.codigo, expiraEm: Date.now() + m.expira * 1000 });
          this.estado.set('aguardando');
          break;
        case 'controle':
          if (m.retomada) this.retomada = m.retomada;
          if (m.e === 'conectado' || m.e === 'voltou') {
            this.codigo.set(null);
            this.estado.set('conectado');
            this.aviso.set(m.e === 'voltou' ? 'Celular reconectado.' : '');
          } else if (m.e === 'caiu') {
            this.estado.set('caiu');
            this.aviso.set(AVISO_DE_QUEDA);
          } else {
            this.encerrar(this.estado() === 'desligado' || this.estado() === 'aguardando' ? '' : AVISO_DE_QUEDA);
          }
          break;
        case 'erro':
          break;
        case 'eco':
          // Na hora, antes de qualquer outra coisa: é o PC que a medição quer ver.
          this.conexao?.enviar(JSON.stringify(m));
          break;
        default:
          eventos.push(m);
      }
    }
    if (eventos.length) for (const ouvinte of this.ouvintes) ouvinte(eventos);
  }

  private encerrar(aviso: string): void {
    this.fechar();
    this.aviso.set(aviso);
  }
}
