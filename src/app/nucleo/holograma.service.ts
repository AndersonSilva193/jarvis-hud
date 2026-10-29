import { Service, computed, inject, signal } from '@angular/core';

import { HologramaGaleriaService } from './holograma-galeria.service';
import { ConexaoMudaHolograma, ErroDoStreamHolograma, HologramaStreamService, type OuvintesDoHolograma } from './holograma-stream.service';
import {
  GERADOR_PADRAO_HOLOGRAMA,
  MAX_OBJETO_HOLOGRAMA,
  lerGeradorHolograma,
  seloDoHolograma,
  textoIncompleto,
  type DetalheHolograma,
  type FimHolograma,
  type GeradorHolograma,
  type ItemGaleria,
  type MetaHolograma,
  type PecaHolograma,
} from './holograma.modelos';

/** `incompleto`: parou antes do fim com peça na tela, e o servidor ainda pode continuar. */
export type FaseHolograma = 'vazio' | 'construindo' | 'pronto' | 'incompleto' | 'erro' | 'cancelado';

/** De onde vêm as peças: muda só a explicação de um erro HTTP. */
type Origem = 'galeria' | 'gerar' | 'continuar';

const CONEXAO_CAIU = 'a conexão caiu no meio';

/**
 * O modo Holograma da HUD: se a camada está aberta, o objeto atual e as peças que já chegaram.
 *
 * As peças só crescem enquanto o objeto é o mesmo; trocar de objeto sobe a `geracao`, e é por ela
 * que a cena sabe que tem de descartar o que desenhou. Erro e cancelamento **não** sobem a
 * `geracao`: o que já foi montado fica na tela, com o aviso por cima.
 */
@Service()
export class HologramaService {
  private readonly stream = inject(HologramaStreamService);
  private readonly api = inject(HologramaGaleriaService);

  readonly aberto = signal(false);
  readonly geracao = signal(0);
  readonly meta = signal<MetaHolograma | null>(null);
  readonly pecas = signal<readonly PecaHolograma[]>([]);
  readonly fase = signal<FaseHolograma>('vazio');
  readonly erro = signal('');
  readonly avisos = signal(0);
  /** O texto de cada aviso recebido, para a dica do contador; o número é só quantos foram. */
  readonly textosDeAviso = signal<readonly string[]>([]);
  /** O gerador do próximo pedido; lembrado entre sessões e enviado em cada pedido. */
  readonly gerador = signal<GeradorHolograma>(lembrarGerador());
  /** O que o servidor disse que gastou ao fechar a geração; vazio enquanto constrói. */
  readonly resumo = signal<FimHolograma | null>(null);
  /** O último aviso de que o gerador trocou (Haiku ↔ local), para a tela explicar. */
  readonly trocaDeGerador = signal('');
  /** O id da geração (vem na `meta`): é o que o `Continuar` devolve ao servidor. */
  readonly idGeracao = signal('');
  /** Parou pela metade e o servidor ainda guarda a geração: a tela mostra "Continuar". */
  readonly podeContinuar = computed(() => this.fase() === 'incompleto' && this.idGeracao() !== '');
  /** O selo discreto do fim da montagem, só com peça na tela. */
  readonly selo = computed(() => {
    const resumo = this.resumo();
    return resumo && resumo.provedor && this.pecas().length ? seloDoHolograma(resumo) : '';
  });

  readonly construindo = computed(() => this.fase() === 'construindo');
  /** Pedido feito e nenhuma peça ainda: é quando a base da cena "escaneia". */
  readonly escaneando = computed(() => this.construindo() && this.pecas().length === 0);

  /** Os objetos guardados no servidor: os exemplos fixos e os gerados completos. */
  readonly galeria = signal<readonly ItemGaleria[]>([]);
  /** id → endereço da miniatura (`blob:` lido da API ou o `data:` que acabou de ser capturado). */
  readonly miniaturas = signal<Readonly<Record<string, string>>>({});
  /** A galeria não respondeu: a lista mostra isso em vez de parecer vazia. */
  readonly falhaDaGaleria = signal('');

  private controle: AbortController | null = null;

  abrir(): void {
    this.aberto.set(true);
  }

  alternar(): void {
    if (this.aberto()) this.fechar();
    else this.abrir();
  }

  /** Fecha a camada e larga o objeto: a cena é destruída junto e libera a GPU. */
  fechar(): void {
    this.interromper();
    this.aberto.set(false);
    this.limpar('vazio');
  }

  /** Reabre um objeto da galeria: o servidor reproduz as peças sem gastar modelo. */
  abrirDaGaleria(item: ItemGaleria): Promise<void> {
    return this.executar('galeria', (ouvintes, sinal) => this.stream.abrir(item.id, ouvintes, sinal));
  }

  /**
   * Pede um objeto; as peças entram na cena conforme o modelo escreve — ou numa reprodução rápida,
   * se o servidor já o tem na galeria. `novo` força o modelo e substitui o que estava guardado.
   */
  gerar(objeto: string, detalhe: DetalheHolograma, novo = false): Promise<void> {
    const limpo = objeto.trim().slice(0, MAX_OBJETO_HOLOGRAMA);
    if (!limpo) return Promise.resolve();
    const gerador = this.gerador();
    return this.executar('gerar', (ouvintes, sinal) => this.stream.gerar(limpo, detalhe, gerador, ouvintes, sinal, novo));
  }

  /** O "Gerar de novo" de um item: o mesmo pedido, com o modelo e o gerador escolhido agora. */
  gerarDeNovo(item: ItemGaleria): Promise<void> {
    return this.gerar(item.objeto, item.detalhe, true);
  }

  /** Lê a lista e as miniaturas que ainda não estão na memória. Falha fica em `falhaDaGaleria`. */
  async carregarGaleria(): Promise<void> {
    let itens: ItemGaleria[];
    try {
      itens = await this.api.listar();
    } catch {
      this.falhaDaGaleria.set('Não consegui ler a galeria.');
      return;
    }
    this.falhaDaGaleria.set('');
    this.galeria.set(itens);
    const vivos = new Set(itens.map((item) => item.id));
    this.miniaturas.update((atuais) => {
      const mantidas: Record<string, string> = {};
      for (const [id, url] of Object.entries(atuais)) {
        if (vivos.has(id)) mantidas[id] = url;
        else liberar(url);
      }
      return mantidas;
    });
    await Promise.all(
      itens.filter((item) => item.miniatura && !this.miniaturas()[item.id]).map((item) => this.lerMiniatura(item.id)),
    );
  }

  /** Apaga um objeto gerado; os exemplos fixos não têm botão para isso. */
  async apagarDaGaleria(item: ItemGaleria): Promise<void> {
    try {
      await this.api.apagar(item.id);
    } catch (erro) {
      // 404: outro lugar já apagou; a lista só estava velha.
      if (!(erro instanceof ErroDoStreamHolograma && erro.status === 404)) {
        this.falhaDaGaleria.set('Não consegui apagar esse objeto.');
        return;
      }
    }
    this.galeria.update((lista) => lista.filter((i) => i.id !== item.id));
    this.miniaturas.update((atuais) => {
      const { [item.id]: removida, ...resto } = atuais;
      if (removida) liberar(removida);
      return resto;
    });
  }

  /**
   * Guarda a miniatura capturada da cena. A imagem vai para a tela na hora (é o `data:` que já está
   * aqui); falhar o envio só deixa o item sem miniatura no servidor.
   */
  async enviarMiniatura(id: string, imagem: string): Promise<void> {
    try {
      await this.api.enviarMiniatura(id, imagem);
    } catch {
      return;
    }
    this.miniaturas.update((atuais) => {
      const anterior = atuais[id];
      if (anterior) liberar(anterior);
      return { ...atuais, [id]: imagem };
    });
    this.galeria.update((lista) => lista.map((i) => (i.id === id ? { ...i, miniatura: true } : i)));
  }

  private async lerMiniatura(id: string): Promise<void> {
    try {
      const blob = await this.api.miniatura(id);
      if (blob) this.miniaturas.update((atuais) => ({ ...atuais, [id]: URL.createObjectURL(blob) }));
    } catch {
      /* Sem miniatura: o item mostra o símbolo no lugar. */
    }
  }

  /**
   * Retoma o objeto que parou pela metade: o servidor reenvia as peças que não chegaram e segue com
   * o modelo. A cena não é limpa — as peças novas entram em cima das que já estão lá.
   */
  continuar(): Promise<void> {
    if (!this.podeContinuar()) return Promise.resolve();
    const id = this.idGeracao();
    const recebidas = this.pecas().length;
    return this.executar('continuar', (ouvintes, sinal) => this.stream.continuar(id, recebidas, ouvintes, sinal));
  }

  /** Troca o gerador dos próximos pedidos e guarda a escolha no navegador. */
  escolherGerador(gerador: GeradorHolograma): void {
    this.gerador.set(gerador);
    try {
      localStorage.setItem(CHAVE_GERADOR, gerador);
    } catch {
      /* Sem persistência: vale até recarregar. */
    }
  }

  /**
   * Para a geração em andamento. Abortar o `fetch` fecha a conexão, e é isso que faz o servidor
   * cortar o modelo; as peças que já chegaram ficam.
   */
  cancelar(): void {
    if (!this.construindo()) return;
    this.interromper();
    this.fase.set('cancelado');
  }

  private async executar(
    origem: Origem,
    transmitir: (ouvintes: OuvintesDoHolograma, sinal: AbortSignal) => Promise<boolean>,
  ): Promise<void> {
    this.interromper();
    const controle = new AbortController();
    this.controle = controle;
    this.aberto.set(true);
    if (origem === 'continuar') {
      this.erro.set('');
      this.resumo.set(null);
      this.fase.set('construindo');
    } else {
      this.limpar('construindo');
    }
    let erroDoServidor = '';
    try {
      const terminou = await transmitir(
        {
          meta: (meta) => {
            this.meta.set(meta);
            if (meta.id) this.idGeracao.set(meta.id);
          },
          peca: (peca) => this.pecas.update((lista) => [...lista, peca]),
          aviso: (texto, troca) => {
            if (troca) this.trocaDeGerador.set(texto);
            this.avisos.update((n) => n + 1);
            this.textosDeAviso.update((lista) => (lista.length < 20 ? [...lista, texto] : lista));
          },
          erro: (texto) => (erroDoServidor = texto),
          fim: (fim) => this.resumo.set(fim),
        },
        controle.signal,
      );
      if (controle.signal.aborted) return;
      const fim = this.resumo();
      if (fim?.status === 'incompleto') this.parar(fim.motivo ?? erroDoServidor);
      else if (erroDoServidor) this.falhar(erroDoServidor);
      else if (terminou) {
        this.fase.set('pronto');
        // Objeto novo na galeria (ou um que substituiu outro): a lista tem de mostrar.
        if (fim?.salvo && fim.origem === 'modelo') void this.carregarGaleria();
      } else this.parar(CONEXAO_CAIU);
    } catch (erro) {
      if (controle.signal.aborted) return;
      // Rede que caiu (ou ficou muda) com peça na tela: o servidor guardou, dá para continuar.
      if (erro instanceof ConexaoMudaHolograma || !(erro instanceof ErroDoStreamHolograma)) {
        if (origem !== 'galeria' && this.pecas().length) {
          this.parar(CONEXAO_CAIU);
          return;
        }
      }
      this.falhar(explicar(erro, origem));
    } finally {
      if (this.controle === controle) this.controle = null;
    }
  }

  private interromper(): void {
    this.controle?.abort();
    this.controle = null;
  }

  private limpar(fase: FaseHolograma): void {
    this.geracao.update((g) => g + 1);
    this.meta.set(null);
    this.pecas.set([]);
    this.avisos.set(0);
    this.textosDeAviso.set([]);
    this.resumo.set(null);
    this.trocaDeGerador.set('');
    this.idGeracao.set('');
    this.erro.set('');
    this.fase.set(fase);
  }

  /**
   * Parou antes do fim. Com peça na tela e id da geração, é `incompleto` — o servidor guarda o que
   * saiu e o "Continuar" retoma dali. Sem peça não há o que continuar, e é um erro comum.
   */
  private parar(motivo: string): void {
    if (this.pecas().length && this.idGeracao()) {
      this.erro.set(textoIncompleto(motivo));
      this.fase.set('incompleto');
    } else {
      this.falhar(motivo ? textoIncompleto(motivo) : 'A transmissão caiu antes do fim do objeto.');
    }
  }

  /** Mantém as peças: um corte no meio ainda deixa na tela o que chegou. */
  private falhar(motivo: string): void {
    this.erro.set(motivo);
    this.fase.set('erro');
  }
}

const CHAVE_GERADOR = 'jarvis-hud.holograma.gerador.v1';

function lembrarGerador(): GeradorHolograma {
  try {
    return lerGeradorHolograma(localStorage.getItem(CHAVE_GERADOR)) ?? GERADOR_PADRAO_HOLOGRAMA;
  } catch {
    return GERADOR_PADRAO_HOLOGRAMA;
  }
}

function explicar(erro: unknown, origem: Origem): string {
  if (erro instanceof ErroDoStreamHolograma) {
    if (erro.status === 401 || erro.status === 403) return 'Token recusado pela API.';
    if (erro.status === 404) {
      if (origem === 'continuar') return 'O servidor não guarda mais esse objeto; gere de novo.';
      return origem === 'galeria' ? 'Esse objeto não está mais na galeria.' : 'Esta API ainda não gera hologramas.';
    }
    if (erro.status === 400) return 'A API recusou o pedido: confira o nome do objeto.';
    return `A API respondeu ${erro.status}.`;
  }
  return 'Não consegui falar com a API.';
}

function liberar(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}
