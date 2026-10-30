import { giroDaTela, zoomComSensibilidade, type AlvoDoControle, type Sensibilidade } from './controle-por-gestos';

export interface ContatoDeToque {
  id: number;
  /** Em px, relativos ao elemento. */
  x: number;
  y: number;
  /** ms. */
  t: number;
}

/** O que os dedos querem; em px (e px/s), que a casca converte com o tamanho do elemento. */
export type IntencaoDeToque =
  | { tipo: 'inicio' }
  | { tipo: 'fim' }
  | { tipo: 'girar'; dx: number; dy: number }
  | { tipo: 'soltarGiro'; vx: number; vy: number }
  /** > 1: os dedos se afastaram, aproxima. */
  | { tipo: 'zoom'; fator: number }
  /** Fração da altura que o par de dedos subiu (negativo = desceu). */
  | { tipo: 'explodir'; delta: number }
  | { tipo: 'toqueDuplo'; x: number; y: number };

/** |ln(d/d0)| que trava o par de dedos no zoom. */
const LIMIAR_DO_ZOOM = 0.08;
/** Fração da altura que o centro do par tem de andar na vertical para travar na explosão. */
const LIMIAR_DA_EXPLOSAO = 0.04;
const TOQUE_MAXIMO_MS = 250;
const TOQUE_MOVIMENTO_MAXIMO = 10;
const ENTRE_TOQUES_MS = 300;
const ENTRE_TOQUES_DISTANCIA = 30;
const JANELA_DA_INERCIA_MS = 100;

type Modo = 'nenhum' | 'um' | 'doisDecidindo' | 'zoom' | 'explodir' | 'esperandoSoltar';

interface Contato extends ContatoDeToque {
  x0: number;
  y0: number;
  t0: number;
}

/**
 * Os dedos na tela viram intenções. TypeScript puro, sem DOM: os testes mandam contatos e
 * conferem o que sai.
 *
 * Um dedo gira (e solta com inércia). Dois dedos decidem uma vez, pelo que passar do limiar
 * primeiro — a distância mudando é zoom; os dois subindo ou descendo juntos é explosão — e ficam
 * nisso até soltar. Isso é o que impede o zoom de tremer quando a mão só desliza.
 */
export class ReconhecedorDeToque {
  private readonly contatos = new Map<number, Contato>();
  private modo: Modo = 'nenhum';
  private historico: { t: number; x: number; y: number }[] = [];
  private ehToque = false;
  private ultimoToque: { t: number; x: number; y: number } | null = null;
  private distanciaInicial = 0;
  private referencia = 0;
  private centroInicialY = 0;

  constructor(private readonly altura: () => number) {}

  baixar(c: ContatoDeToque): IntencaoDeToque[] {
    if (this.contatos.size >= 2) return [];
    this.contatos.set(c.id, { ...c, x0: c.x, y0: c.y, t0: c.t });
    if (this.contatos.size === 1) {
      this.modo = 'um';
      this.historico = [{ t: c.t, x: c.x, y: c.y }];
      this.ehToque = true;
      return [{ tipo: 'inicio' }];
    }
    this.ehToque = false;
    const [a, b] = this.par();
    this.modo = 'doisDecidindo';
    this.distanciaInicial = Math.hypot(a.x - b.x, a.y - b.y);
    this.centroInicialY = (a.y + b.y) / 2;
    return [];
  }

  mover(c: ContatoDeToque): IntencaoDeToque[] {
    const contato = this.contatos.get(c.id);
    if (!contato) return [];
    const antes = { x: contato.x, y: contato.y };
    contato.x = c.x;
    contato.y = c.y;
    contato.t = c.t;
    switch (this.modo) {
      case 'um': {
        if (Math.hypot(c.x - contato.x0, c.y - contato.y0) > TOQUE_MOVIMENTO_MAXIMO) this.ehToque = false;
        this.historico.push({ t: c.t, x: c.x, y: c.y });
        this.historico = this.historico.filter((h) => c.t - h.t <= JANELA_DA_INERCIA_MS * 3);
        const dx = c.x - antes.x;
        const dy = c.y - antes.y;
        return dx || dy ? [{ tipo: 'girar', dx, dy }] : [];
      }
      case 'doisDecidindo':
        return this.decidir();
      case 'zoom': {
        const d = this.distancia();
        if (!(d > 0) || !(this.referencia > 0)) return [];
        const fator = d / this.referencia;
        this.referencia = d;
        return [{ tipo: 'zoom', fator }];
      }
      case 'explodir': {
        const y = this.centroY();
        const delta = (this.referencia - y) / this.altura();
        this.referencia = y;
        return delta ? [{ tipo: 'explodir', delta }] : [];
      }
      default:
        return [];
    }
  }

  levantar(c: ContatoDeToque): IntencaoDeToque[] {
    const contato = this.contatos.get(c.id);
    if (!contato) return [];
    this.contatos.delete(c.id);
    const saida: IntencaoDeToque[] = [];
    if (this.modo === 'um') {
      if (this.ehToque && c.t - contato.t0 < TOQUE_MAXIMO_MS) saida.push(...this.tocou(contato, c.t));
      else saida.push({ tipo: 'soltarGiro', ...this.velocidade() });
    }
    if (this.contatos.size) {
      // Um dos dois saiu: o que ficou não vira giro de repente.
      this.modo = 'esperandoSoltar';
      return saida;
    }
    this.modo = 'nenhum';
    saida.push({ tipo: 'fim' });
    return saida;
  }

  /** O navegador tomou o dedo (rolagem do sistema, alerta): fecha sem toque nem inércia. */
  cancelar(c: ContatoDeToque): IntencaoDeToque[] {
    if (!this.contatos.delete(c.id)) return [];
    if (this.contatos.size) {
      this.modo = 'esperandoSoltar';
      return [];
    }
    this.modo = 'nenhum';
    return [{ tipo: 'fim' }];
  }

  private tocou(contato: Contato, t: number): IntencaoDeToque[] {
    const anterior = this.ultimoToque;
    if (
      anterior &&
      contato.t0 - anterior.t < ENTRE_TOQUES_MS &&
      Math.hypot(contato.x0 - anterior.x, contato.y0 - anterior.y) < ENTRE_TOQUES_DISTANCIA
    ) {
      this.ultimoToque = null;
      return [{ tipo: 'toqueDuplo', x: contato.x0, y: contato.y0 }];
    }
    this.ultimoToque = { t, x: contato.x0, y: contato.y0 };
    return [];
  }

  private decidir(): IntencaoDeToque[] {
    const d = this.distancia();
    if (!(this.distanciaInicial > 0) || !(d > 0)) return [];
    if (Math.abs(Math.log(d / this.distanciaInicial)) > LIMIAR_DO_ZOOM) {
      this.modo = 'zoom';
      this.referencia = d;
      return [{ tipo: 'zoom', fator: d / this.distanciaInicial }];
    }
    const y = this.centroY();
    const delta = (this.centroInicialY - y) / this.altura();
    if (Math.abs(delta) > LIMIAR_DA_EXPLOSAO) {
      this.modo = 'explodir';
      this.referencia = y;
      return [{ tipo: 'explodir', delta }];
    }
    return [];
  }

  private par(): [Contato, Contato] {
    const [a, b] = [...this.contatos.values()];
    return [a!, b!];
  }

  private distancia(): number {
    if (this.contatos.size < 2) return 0;
    const [a, b] = this.par();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private centroY(): number {
    const [a, b] = this.par();
    return (a.y + b.y) / 2;
  }

  private velocidade(): { vx: number; vy: number } {
    const h = this.historico;
    const ultima = h.at(-1);
    const primeira = h.find((p) => ultima && ultima.t - p.t <= JANELA_DA_INERCIA_MS);
    if (!ultima || !primeira || ultima.t === primeira.t) return { vx: 0, vy: 0 };
    const dt = (ultima.t - primeira.t) / 1000;
    return { vx: (ultima.x - primeira.x) / dt, vy: (ultima.y - primeira.y) / dt };
  }
}

export interface SaidasDoToque {
  /** Soma ao fator de explosão (0..1) atual. */
  explodirMais(delta: number): void;
  resetar(): void;
  selecionou(peca: { nome: string; grupo: string }): void;
}

/** Arrastar meia tela com dois dedos explode ou monta tudo. O controle pelo celular usa o mesmo. */
export const EXPLOSAO_POR_ALTURA = 2;

/**
 * A casca do reconhecedor no DOM. Escuta os toques na **captura** do host e não os deixa chegar ao
 * canvas: o OrbitControls fica só com mouse e caneta, e o toque tem um dono só.
 */
export class ControleDeToque {
  private readonly reconhecedor: ReconhecedorDeToque;

  constructor(
    private readonly host: HTMLElement,
    private readonly alvo: AlvoDoControle,
    private readonly saidas: SaidasDoToque,
    private readonly sensibilidade: () => Sensibilidade,
  ) {
    this.reconhecedor = new ReconhecedorDeToque(() => this.host.clientHeight || 1);
    host.addEventListener('pointerdown', this.aoBaixar, { capture: true });
    host.addEventListener('pointermove', this.aoMover, { capture: true });
    host.addEventListener('pointerup', this.aoLevantar, { capture: true });
    host.addEventListener('pointercancel', this.aoCancelar, { capture: true });
  }

  destruir(): void {
    this.host.removeEventListener('pointerdown', this.aoBaixar, { capture: true });
    this.host.removeEventListener('pointermove', this.aoMover, { capture: true });
    this.host.removeEventListener('pointerup', this.aoLevantar, { capture: true });
    this.host.removeEventListener('pointercancel', this.aoCancelar, { capture: true });
  }

  private contato(e: PointerEvent): ContatoDeToque | null {
    if (e.pointerType !== 'touch') return null;
    e.stopPropagation();
    const r = this.host.getBoundingClientRect();
    return { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  }

  private readonly aoBaixar = (e: PointerEvent): void => {
    const c = this.contato(e);
    if (c) this.aplicar(this.reconhecedor.baixar(c));
  };

  private readonly aoMover = (e: PointerEvent): void => {
    const c = this.contato(e);
    if (c) this.aplicar(this.reconhecedor.mover(c));
  };

  private readonly aoLevantar = (e: PointerEvent): void => {
    const c = this.contato(e);
    if (c) this.aplicar(this.reconhecedor.levantar(c));
  };

  private readonly aoCancelar = (e: PointerEvent): void => {
    const c = this.contato(e);
    if (c) this.aplicar(this.reconhecedor.cancelar(c));
  };

  private aplicar(intencoes: IntencaoDeToque[]): void {
    const s = this.sensibilidade();
    const altura = this.host.clientHeight || 1;
    for (const i of intencoes) {
      switch (i.tipo) {
        case 'inicio':
          this.alvo.comecarInteracao();
          break;
        case 'fim':
          this.alvo.terminarInteracao();
          break;
        case 'girar':
          this.alvo.girar(...giroDaTela(i.dx / altura, i.dy / altura, s));
          break;
        case 'soltarGiro':
          this.alvo.lancarGiro(...giroDaTela(i.vx / altura, i.vy / altura, s));
          break;
        case 'zoom':
          this.alvo.aproximar(zoomComSensibilidade(i.fator, s));
          break;
        case 'explodir':
          this.saidas.explodirMais(i.delta * EXPLOSAO_POR_ALTURA);
          break;
        case 'toqueDuplo': {
          const largura = this.host.clientWidth || 1;
          const peca = this.alvo.selecionarEm({ x: (i.x / largura) * 2 - 1, y: 1 - (i.y / altura) * 2 });
          if (peca) this.saidas.selecionou(peca);
          else this.saidas.resetar();
          break;
        }
      }
    }
  }
}
