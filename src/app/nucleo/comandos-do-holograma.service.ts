import { Service, effect, inject, signal, untracked } from '@angular/core';

import { Animador, RELOGIO_DO_NAVEGADOR, type Relogio } from './animador';
import { HologramaService } from './holograma.service';
import {
  SEM_FILTROS,
  type AlvoDoFiltro,
  type ComandoHolograma,
  type DetalheHolograma,
  type EixoHolograma,
  type FiltrosDoHolograma,
  type GeradorHolograma,
  type ItemGaleria,
  type PecaSelecionada,
  type VistaHolograma,
} from './holograma.modelos';
import { tocarConfirmacao } from './som-de-confirmacao';
import { VozService } from './voz.service';

interface PontoNdc {
  x: number;
  y: number;
}

/**
 * O que o serviço pede da cena. A `CenaHolograma` cumpre isto; o teste passa uma de mentira, e o
 * Three.js nunca entra no pacote do núcleo.
 */
export interface AlvoDaCena {
  explodir(fator: number, imediato?: boolean): void;
  girarObjeto(eixo: EixoHolograma, radianos: number): void;
  vista(nome: VistaHolograma): void;
  filtrar(filtros: FiltrosDoHolograma): void;
  selecionarPorId(id: string): PecaSelecionada | null;
  limparSelecao(): void;
  definirGiro(modo: ModoDeGiro, velocidade?: number): void;
  resetar(): void;
  centralizar(): void;
  // O que gestos, toque e celular já usavam: chega à cena por aqui.
  girar(dAz: number, dPol: number): void;
  lancarGiro(vAz: number, vPol: number): void;
  aproximar(fator: number): void;
  apontar(ndc: PontoNdc | null): void;
  selecionarEm(ndc: PontoNdc): PecaSelecionada | null;
  segurarAutoRotacao(segurar: boolean): void;
  comecarInteracao(): void;
  terminarInteracao(): void;
}

/** `auto`: gira sozinho quando ninguém mexe (o padrão); `continuo`: gira sempre; `parado`: nunca. */
export type ModoDeGiro = 'auto' | 'continuo' | 'parado';

/** A mão no modo explosão: de onde ela partiu e de que fator da cena. */
interface GestoDeExplosao {
  base: number;
  inicio: number;
  ultimo: number;
}

/**
 * A porta única da cena do holograma. Mouse (botões e slider), toque, gestos da câmera, celular e
 * os comandos do Jarvis passam por aqui; nada mexe na `CenaHolograma` por fora. O arrasto do mouse
 * no canvas continua com o OrbitControls, dentro da cena — é a única exceção, e ela só gira a câmera.
 *
 * Três regras moram aqui, e é por isso que a porta é uma só:
 *
 * - **Voz anima, gesto é relativo.** Um comando do Jarvis anda até o valor em 600 ms (ease-in-out);
 *   a mão soma deltas ao que está na tela. Se a voz explodiu para 0.8, a mão continua de 0.8.
 * - **O último comando vence.** A voz no meio de um gesto de explosão rebaseia o gesto: a mão segue
 *   do valor novo, sem pular de volta.
 * - **Objeto em construção recebe comando.** Explosão é da cena inteira, e destaque, isolamento e
 *   esconder são filtros por grupo e peça — valem para o que já chegou e para o que chegar depois.
 */
@Service()
export class ComandosDoHologramaService {
  private readonly holograma = inject(HologramaService);
  private readonly voz = inject(VozService);

  /** O fator de explosão na tela, 0..1. */
  readonly explosao = signal(0);
  readonly selecao = signal<PecaSelecionada | null>(null);
  readonly filtros = signal<FiltrosDoHolograma>(SEM_FILTROS);
  readonly vista = signal<VistaHolograma | 'livre'>('livre');
  readonly giro = signal<ModoDeGiro>('auto');

  /** Para o teste trocar: o relógio das animações, o movimento reduzido e o som. */
  relogio: Relogio = RELOGIO_DO_NAVEGADOR;
  movimentoReduzido = (): boolean =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  tocarSom: () => void = tocarConfirmacao;

  private cena: AlvoDaCena | null = null;
  private animador = new Animador(this.relogio, () => this.movimentoReduzido());
  private alvoExplosao = 0;
  private gesto: GestoDeExplosao | null = null;
  private velocidadeDoGiro = 1;
  private sequencia = 0;
  /** O molde do "Pronto: {n} peças." e a geração a que ele pertence. */
  private falaPronto: { molde: string; geracao: number } | null = null;

  constructor() {
    // O fim de um objeto que o Jarvis mandou carregar é anunciado aqui: só a HUD vê o `fim`.
    effect(() => {
      const pendente = this.falaPronto;
      const fase = this.holograma.fase();
      const geracao = this.holograma.geracao();
      if (!pendente || pendente.geracao !== geracao || (fase !== 'pronto' && fase !== 'erro' && fase !== 'incompleto')) return;
      untracked(() => {
        this.falaPronto = null;
        const fim = this.holograma.resumo();
        // Do cache, o "na tela" já foi dito; com erro, a tela já explica.
        if (fase !== 'pronto' || fim?.origem === 'cache') return;
        void this.voz.falar(pendente.molde.replace('{n}', String(this.holograma.pecas().length)));
      });
    });
  }

  /** Troca o relógio (teste) e refaz o animador com ele. */
  usarRelogio(relogio: Relogio): void {
    this.relogio = relogio;
    this.animador.parar();
    this.animador = new Animador(relogio, () => this.movimentoReduzido());
  }

  // ---- A cena -------------------------------------------------------------------------------

  /** A view registra a cena quando o Three.js termina de chegar; o estado acumulado vai junto. */
  conectar(cena: AlvoDaCena): void {
    this.cena = cena;
    cena.explodir(this.explosao(), true);
    cena.filtrar(this.filtros());
    cena.definirGiro(this.giro(), this.velocidadeDoGiro);
    const vista = this.vista();
    if (vista !== 'livre') cena.vista(vista);
    const selecionada = this.selecao()?.id;
    if (selecionada) cena.selecionarPorId(selecionada);
  }

  desconectar(): void {
    this.animador.parar();
    this.cena = null;
  }

  // ---- Abrir, fechar, carregar ----------------------------------------------------------------

  abrir(): void {
    this.holograma.abrir();
  }

  fechar(): void {
    this.holograma.fechar();
    this.novoObjeto();
    this.giro.set('auto');
    this.falaPronto = null;
  }

  carregar(objeto: string, detalhe: DetalheHolograma, opcoes: { novo?: boolean; gerador?: GeradorHolograma; falaPronto?: string } = {}): void {
    void this.holograma.gerar(objeto, detalhe, opcoes.novo ?? false, opcoes.gerador);
    this.novoObjeto();
    this.falaPronto = opcoes.falaPronto ? { molde: opcoes.falaPronto, geracao: this.holograma.geracao() } : null;
  }

  abrirDaGaleria(item: ItemGaleria): void {
    void this.holograma.abrirDaGaleria(item);
    this.novoObjeto();
    this.falaPronto = null;
  }

  gerarDeNovo(item: ItemGaleria): void {
    void this.holograma.gerarDeNovo(item);
    this.novoObjeto();
    this.falaPronto = null;
  }

  cancelar(): void {
    this.holograma.cancelar();
  }

  // ---- Explosão -------------------------------------------------------------------------------

  /**
   * Leva a explosão a `fator`. `animado` é o comando de voz: anda até lá em 600 ms. Sem animação é o
   * slider, o botão e o toque. Em qualquer caso o gesto da mão em andamento é rebaseado — a mão
   * segue do valor novo.
   */
  explodir(fator: number, animado = false): void {
    const alvo = limitar(fator);
    this.alvoExplosao = alvo;
    if (this.gesto) {
      this.gesto.base = alvo;
      this.gesto.inicio = this.gesto.ultimo;
    }
    if (!animado) {
      this.animador.parar('explosao');
      this.aplicarExplosao(alvo, false);
      return;
    }
    const de = this.explosao();
    // O passo lê o alvo a cada quadro: a mão mexendo no meio da animação muda o destino, não a corta.
    this.animador.animar('explosao', (f) => this.aplicarExplosao(de + (this.alvoExplosao - de) * f, true));
  }

  /** Soma ao fator atual: o toque de dois dedos e o touchpad do celular. */
  explodirMais(delta: number): void {
    this.explodir(this.alvoExplosao + delta);
  }

  alternarExplosao(): void {
    this.explodir(this.alvoExplosao > 0 ? 0 : 1, true);
  }

  montar(): void {
    this.explodir(0, true);
  }

  /** A mão abriu o modo explosão: o próximo fator dela vira a referência. */
  inicioDoGestoDeExplosao(): void {
    this.gesto = null;
  }

  /** A abertura da mão (0..1) passa a valer como delta sobre o fator que a cena tinha. */
  explodirPorGesto(fatorDaMao: number): void {
    this.gesto ??= { base: this.alvoExplosao, inicio: fatorDaMao, ultimo: fatorDaMao };
    this.gesto.ultimo = fatorDaMao;
    this.alvoExplosao = limitar(this.gesto.base + fatorDaMao - this.gesto.inicio);
    if (this.animador.animando('explosao')) return;
    this.aplicarExplosao(this.alvoExplosao, false);
  }

  fimDoGestoDeExplosao(fatorDaMao: number): void {
    this.explodirPorGesto(fatorDaMao);
    this.gesto = null;
  }

  // ---- Giro, zoom, vista ------------------------------------------------------------------------

  /** Gira o objeto em volta de um eixo, animado. Somam-se: dois "gira 90" seguidos dão 180. */
  girarEixo(eixo: EixoHolograma, graus: number): void {
    const radianos = (graus * Math.PI) / 180;
    this.vista.set('livre');
    this.animador.animar(`giro-${++this.sequencia}`, (f, anterior) => this.cena?.girarObjeto(eixo, radianos * (f - anterior)));
  }

  girarContinuo(ligar: boolean, velocidade = 1): void {
    this.velocidadeDoGiro = velocidade;
    this.definirGiro(ligar ? 'continuo' : 'auto');
  }

  parar(): void {
    this.definirGiro('parado');
  }

  /** `fator` > 1 aproxima. Animado, em passos multiplicativos que somam ao zoom da mão. */
  zoom(fator: number): void {
    if (!(fator > 0)) return;
    this.vista.set('livre');
    const log = Math.log(fator);
    this.animador.animar(`zoom-${++this.sequencia}`, (f, anterior) => this.cena?.aproximar(Math.exp(log * (f - anterior))));
  }

  definirVista(vista: VistaHolograma): void {
    this.vista.set(vista);
    this.cena?.vista(vista);
  }

  /** O mouse arrastou a câmera: a vista nomeada deixou de valer. */
  arrastou(): void {
    this.vista.set('livre');
  }

  centralizar(): void {
    this.cena?.centralizar();
  }

  // ---- Filtros e seleção ----------------------------------------------------------------------

  destacar(alvo: AlvoDoFiltro): void {
    this.mudarFiltros({ ...this.filtros(), destacados: alvo });
  }

  isolar(alvo: AlvoDoFiltro): void {
    this.mudarFiltros({ ...this.filtros(), isolados: alvo });
  }

  /** Esconder acumula: "esconde o bloco" e depois "esconde a tampa" deixam os dois de fora. */
  esconder(alvo: AlvoDoFiltro): void {
    const atual = this.filtros().escondidos;
    this.mudarFiltros({
      ...this.filtros(),
      escondidos: { grupos: unir(atual.grupos, alvo.grupos), pecas: unir(atual.pecas, alvo.pecas) },
    });
  }

  mostrarTudo(): void {
    this.mudarFiltros(SEM_FILTROS);
  }

  /** Seleciona pelo id que o servidor resolveu. A peça ainda chegando não é erro: fica para depois. */
  selecionar(id: string): void {
    const peca = this.holograma.pecas().find((p) => p.id === id);
    this.selecao.set(peca ? { id: peca.id, nome: peca.nome, grupo: peca.grupo } : null);
    if (peca) this.cena?.selecionarPorId(id);
  }

  /** Gesto ou toque escolheu uma peça. */
  selecionou(peca: PecaSelecionada): void {
    this.selecao.set(peca);
  }

  limparSelecao(): void {
    this.cena?.limparSelecao();
    this.selecao.set(null);
  }

  /** Volta tudo ao começo, com o objeto que está na tela. */
  resetar(): void {
    this.animador.parar();
    this.gesto = null;
    this.alvoExplosao = 0;
    this.explosao.set(0);
    this.selecao.set(null);
    this.filtros.set(SEM_FILTROS);
    this.vista.set('livre');
    this.giro.set('auto');
    this.cena?.resetar();
    this.cena?.filtrar(SEM_FILTROS);
    this.cena?.definirGiro('auto');
  }

  // ---- O que o Jarvis manda -------------------------------------------------------------------

  /** Um `holograma.comando` do SSE. Voz anima; o caminho rápido confirma com um som. */
  aplicar(comando: ComandoHolograma): void {
    if (comando.rapido) this.tocarSom();
    switch (comando.acao) {
      case 'abrir': return this.abrir();
      case 'fechar': return this.fechar();
      case 'carregar':
        return this.carregar(comando.objeto, comando.detalhe, {
          novo: comando.novo, gerador: comando.provedor, falaPronto: comando.falaPronto,
        });
      case 'explodir': return this.explodir(comando.fator, true);
      case 'girar': return this.girarEixo(comando.eixo, comando.graus);
      case 'girar_continuo': return this.girarContinuo(comando.ligar, comando.velocidade);
      case 'parar': return this.parar();
      case 'zoom': return this.zoom(comando.fator);
      case 'vista': return this.definirVista(comando.vista);
      case 'destacar': return this.destacar(comando.alvo);
      case 'isolar': return this.isolar(comando.alvo);
      case 'esconder': return this.esconder(comando.alvo);
      case 'mostrar_tudo': return this.mostrarTudo();
      case 'selecionar': return this.selecionar(comando.peca);
      case 'resetar': return this.resetar();
      case 'cancelar_geracao': return this.cancelar();
    }
  }

  // ---- A mesma cena, para gestos, toque e celular (o `AlvoDoControle`) --------------------------

  girar(dAz: number, dPol: number): void {
    this.vista.set('livre');
    this.cena?.girar(dAz, dPol);
  }

  lancarGiro(vAz: number, vPol: number): void {
    this.cena?.lancarGiro(vAz, vPol);
  }

  aproximar(fator: number): void {
    this.cena?.aproximar(fator);
  }

  apontar(ndc: PontoNdc | null): void {
    this.cena?.apontar(ndc);
  }

  selecionarEm(ndc: PontoNdc): PecaSelecionada | null {
    const peca = this.cena?.selecionarEm(ndc) ?? null;
    if (peca) this.selecao.set(peca);
    return peca;
  }

  segurarAutoRotacao(segurar: boolean): void {
    this.cena?.segurarAutoRotacao(segurar);
  }

  comecarInteracao(): void {
    this.cena?.comecarInteracao();
  }

  terminarInteracao(): void {
    this.cena?.terminarInteracao();
  }

  // ---- Por dentro ---------------------------------------------------------------------------

  /** Objeto novo começa montado, sem seleção nem filtro. A explosão é zerada aqui, na hora do pedido. */
  private novoObjeto(): void {
    this.animador.parar();
    this.gesto = null;
    this.alvoExplosao = 0;
    this.explosao.set(0);
    this.cena?.explodir(0, true);
    this.selecao.set(null);
    this.mudarFiltros(SEM_FILTROS);
  }

  private aplicarExplosao(valor: number, imediato: boolean): void {
    this.explosao.set(valor);
    this.cena?.explodir(valor, imediato);
  }

  private mudarFiltros(filtros: FiltrosDoHolograma): void {
    this.filtros.set(filtros);
    this.cena?.filtrar(filtros);
  }

  private definirGiro(modo: ModoDeGiro): void {
    this.giro.set(modo);
    this.cena?.definirGiro(modo, this.velocidadeDoGiro);
  }
}

function limitar(fator: number): number {
  return Number.isFinite(fator) ? Math.min(1, Math.max(0, fator)) : 0;
}

function unir(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}

