import { FiltroUmEuro } from './filtro-um-euro';
import {
  INDICADOR_PONTA,
  POLEGAR_PONTA,
  aberturaDaMao,
  centroDaPalma,
  classificarPose,
  distanciaDaPinca,
  tamanhoDaMao,
} from './geometria-da-mao';
import {
  OPCOES_PADRAO_DO_MOTOR,
  type EventoDeGesto,
  type MaoDetectada,
  type OpcoesDoMotor,
  type PoseDaMao,
  type Ponto,
  type QuadroDeMaos,
} from './gestos.modelos';

export type EstadoDoMotor =
  | 'semMao'
  | 'ocioso'
  | 'girando'
  | 'pincaDecidindo'
  | 'zoomProfundidade'
  | 'zoomDuasMaos'
  | 'explosao'
  | 'apontando'
  | 'punhoArmando'
  | 'punhoSeguro';

interface Ponto2 {
  x: number;
  y: number;
}

interface Amostra extends Ponto2 {
  t: number;
}

/** Um lado diferente só é a mesma mão se o pulso não pulou mais que isso (o MediaPipe às vezes troca o rótulo). */
const TROCA_DE_LADO_MAX = 0.15;
const ASPECTO_PADRAO = 4 / 3;
/** Janela da velocidade que vira inércia ao soltar a pinça. */
const JANELA_DA_INERCIA_MS = 100;
/** Janela da palma "parada". */
const JANELA_DA_PALMA_MS = 200;
const HISTORICO_DO_FATOR_MS = 1_500;

const ROTULOS_DA_POSE: Record<PoseDaMao, string> = {
  nenhuma: 'Mão',
  outra: 'Mão',
  aberta: 'Mão aberta',
  punho: 'Punho',
  apontar: 'Apontando',
  pinca: 'Pinça',
};

/** Uma mão acompanhada entre quadros: filtros, histerese da pinça e a pose estável. */
class MaoSeguida {
  private readonly filtros: FiltroUmEuro[];
  private historicoDaPalma: Amostra[] = [];

  vista: number;
  vistaAgora = false;
  pulsoBruto: Ponto = [0, 0, 0];
  tamanho = 0;
  pincando = false;
  poseBruta: PoseDaMao = 'nenhuma';
  poseDesde: number;
  /** A pose que durou `estavelMs`. */
  pose: PoseDaMao = 'nenhuma';
  /** Em tela, espelhado: o meio entre as pontas do polegar e do indicador. */
  pinca: Ponto2 = { x: 0, y: 0 };
  /** O mesmo ponto, corrigido pelo aspecto, para medir a distância entre duas mãos. */
  pincaCorrigida: Ponto2 = { x: 0, y: 0 };
  /** A ponta do indicador, já esticada pela zona ativa. */
  cursor: Ponto2 = { x: 0, y: 0 };
  abertura = 0;
  parada = false;
  abertaParadaDesde: number | null = null;
  /** Os pontos filtrados, crus (0..1), para quem quiser desenhar. */
  pontos: Ponto[] = [];

  constructor(
    public lado: string,
    t: number,
    opcoes: OpcoesDoMotor,
  ) {
    const { minCutoff, beta, dCutoff } = opcoes.filtro;
    this.filtros = Array.from({ length: 63 }, () => new FiltroUmEuro(minCutoff, beta, dCutoff));
    this.vista = t;
    this.poseDesde = t;
  }

  atualizar(mao: MaoDetectada, t: number, aspecto: number, o: OpcoesDoMotor): void {
    this.vista = t;
    this.vistaAgora = true;
    this.lado = mao.lado;
    this.pulsoBruto = mao.pontos[0]!;
    const f = this.filtros;
    this.pontos = mao.pontos.map(
      (p, i): Ponto => [f[i * 3]!.filtrar(p[0], t), f[i * 3 + 1]!.filtrar(p[1], t), f[i * 3 + 2]!.filtrar(p[2], t)],
    );
    const corrigidos = this.pontos.map((p): Ponto => [p[0] * aspecto, p[1], p[2] * aspecto]);

    this.tamanho = tamanhoDaMao(corrigidos);
    const pinca = distanciaDaPinca(corrigidos, this.tamanho);
    this.pincando = this.pincando ? pinca <= o.pincaSai : pinca < o.pincaEntra;
    const bruta = classificarPose(corrigidos, this.pincando);
    if (bruta !== this.poseBruta) {
      this.poseBruta = bruta;
      this.poseDesde = t;
    }
    if (t - this.poseDesde >= o.estavelMs) this.pose = bruta;

    const polegar = this.pontos[POLEGAR_PONTA]!;
    const indicador = this.pontos[INDICADOR_PONTA]!;
    this.pinca = naTela((polegar[0] + indicador[0]) / 2, (polegar[1] + indicador[1]) / 2, o.espelhar);
    const cp = corrigidos[POLEGAR_PONTA]!;
    const ci = corrigidos[INDICADOR_PONTA]!;
    this.pincaCorrigida = { x: (cp[0] + ci[0]) / 2, y: (cp[1] + ci[1]) / 2 };
    this.cursor = esticar(naTela(indicador[0], indicador[1], o.espelhar), o.zonaAtiva);
    this.abertura = aberturaDaMao(corrigidos);

    const palma = centroDaPalma(corrigidos);
    this.historicoDaPalma.push({ t, x: palma[0], y: palma[1] });
    this.historicoDaPalma = this.historicoDaPalma.filter((a) => t - a.t <= JANELA_DA_PALMA_MS * 2);
    const referencia = this.historicoDaPalma.find((a) => t - a.t <= JANELA_DA_PALMA_MS);
    if (!referencia || t - referencia.t < JANELA_DA_PALMA_MS / 2 || this.tamanho <= 0) {
      this.parada = false;
    } else {
      const velocidade = Math.hypot(palma[0] - referencia.x, palma[1] - referencia.y) / ((t - referencia.t) / 1000);
      this.parada = velocidade / this.tamanho < o.velocidadeParada;
    }
    if (this.firme('aberta') && this.parada) this.abertaParadaDesde ??= t;
    else this.abertaParadaDesde = null;
  }

  /** A pose estável **e** a deste quadro: entrar num gesto pede as duas. */
  firme(pose: PoseDaMao): boolean {
    return this.pose === pose && this.poseBruta === pose;
  }
}

/**
 * Landmarks entram, eventos de gesto saem. Não conhece a cena, nem o Angular, nem o relógio: o tempo
 * é o `t` de cada quadro, e o mesmo arquivo gravado sempre dá os mesmos eventos.
 *
 * A máquina de estados está desenhada em `docs/HOLOGRAMA.md` §10. Chame `processar` a cada detecção,
 * **também** quando não há mão nenhuma: é assim que os prazos sem mão andam.
 */
export class MotorDeGestos {
  private opcoes: OpcoesDoMotor;
  private maos: MaoSeguida[] = [];
  private estado: EstadoDoMotor = 'semMao';
  private ativa: MaoSeguida | null = null;
  private segunda: MaoSeguida | null = null;
  private ultimaVista = -Infinity;
  private semMaoDesde = -Infinity;
  /** No começo a cena já gira sozinha: não há o que devolver. */
  private autoRotacaoEnviada = true;
  private rotulo = 'Sem mão';

  private ultimoPonto: Ponto2 = { x: 0, y: 0 };
  private historicoDoGiro: Amostra[] = [];
  private origemDaPinca: Ponto2 = { x: 0, y: 0 };
  private tamanhoDeReferencia = 0;
  private referenciaDoZoom = 0;
  private historicoDoFator: { t: number; f: number }[] = [];
  private fatorEmitido = 0;
  private ancora: Ponto2 = { x: 0, y: 0 };
  private ancoraDesde = 0;
  private selecaoDisparada = false;
  private punhoDesde = 0;

  constructor(opcoes: Partial<OpcoesDoMotor> = {}) {
    this.opcoes = mesclar(opcoes);
  }

  get estadoAtual(): EstadoDoMotor {
    return this.estado;
  }

  get gestoAtual(): string {
    return this.rotulo;
  }

  /** As mãos que o motor está vendo, com os pontos filtrados (0..1, sem espelho) e a pose estável. */
  maosVistas(): { pontos: readonly Ponto[]; pose: PoseDaMao }[] {
    return this.maos.filter((m) => m.vistaAgora).map((m) => ({ pontos: m.pontos, pose: m.pose }));
  }

  /** Troca de perfil (uma mão ↔ duas) ou de limiar: recomeça do zero. */
  configurar(opcoes: Partial<OpcoesDoMotor>): void {
    this.opcoes = mesclar(opcoes);
    this.reiniciar();
  }

  reiniciar(): void {
    this.maos = [];
    this.estado = 'semMao';
    this.ativa = null;
    this.segunda = null;
    this.ultimaVista = -Infinity;
    this.semMaoDesde = -Infinity;
    this.autoRotacaoEnviada = true;
    this.rotulo = 'Sem mão';
  }

  processar(quadro: QuadroDeMaos): EventoDeGesto[] {
    const eventos: EventoDeGesto[] = [];
    const t = quadro.t;
    this.acompanhar(quadro);
    this.descartarPerdidas(t, eventos);

    const visiveis = this.maos.filter((m) => m.vistaAgora);
    if (this.estado === 'semMao') {
      if (visiveis.length) {
        eventos.push({ tipo: 'maoPresente' });
        this.estado = 'ocioso';
      } else if (!this.autoRotacaoEnviada && t - this.semMaoDesde >= this.opcoes.autoRotacaoMs) {
        eventos.push({ tipo: 'autoRotacao' });
        this.autoRotacaoEnviada = true;
      }
    }
    if (this.estado !== 'semMao') this.passo(t, visiveis, eventos);

    const rotulo = this.nomeDoGesto(visiveis);
    if (rotulo !== this.rotulo) {
      this.rotulo = rotulo;
      eventos.push({ tipo: 'gesto', nome: rotulo });
    }
    return eventos;
  }

  private acompanhar(quadro: QuadroDeMaos): void {
    const t = quadro.t;
    const aspecto = quadro.aspecto ?? ASPECTO_PADRAO;
    for (const m of this.maos) m.vistaAgora = false;
    const livres = [...this.maos];
    for (const detectada of quadro.maos.slice(0, this.opcoes.maosMax)) {
      if (detectada.pontos.length !== 21) continue;
      const pulso = detectada.pontos[0]!;
      let escolhida: MaoSeguida | null = null;
      let melhor = Infinity;
      for (const m of livres) {
        const salto = Math.hypot(m.pulsoBruto[0] - pulso[0], m.pulsoBruto[1] - pulso[1]);
        if (m.lado !== detectada.lado && salto > TROCA_DE_LADO_MAX) continue;
        const custo = (m.lado === detectada.lado ? 0 : 1) + salto;
        if (custo < melhor) {
          melhor = custo;
          escolhida = m;
        }
      }
      if (escolhida) {
        livres.splice(livres.indexOf(escolhida), 1);
      } else if (this.maos.length < this.opcoes.maosMax) {
        escolhida = new MaoSeguida(detectada.lado, t, this.opcoes);
        this.maos.push(escolhida);
      } else {
        // Uma mão nova enquanto a velha ainda está no prazo de perda: espera o prazo acabar.
        continue;
      }
      escolhida.atualizar(detectada, t, aspecto, this.opcoes);
      this.ultimaVista = t;
    }
  }

  private descartarPerdidas(t: number, eventos: EventoDeGesto[]): void {
    for (const m of [...this.maos]) {
      const limite =
        m === this.ativa && this.estado === 'explosao' ? this.opcoes.perderMaoNaExplosaoMs : this.opcoes.perderMaoMs;
      if (t - m.vista <= limite) continue;
      if (m === this.ativa || m === this.segunda) this.encerrar(eventos);
      this.maos.splice(this.maos.indexOf(m), 1);
    }
    if (!this.maos.length && this.estado !== 'semMao') {
      this.encerrar(eventos);
      this.estado = 'semMao';
      this.semMaoDesde = this.ultimaVista;
      this.autoRotacaoEnviada = false;
    }
  }

  /** Fecha o gesto em andamento, com o evento de fim que ele pedir, e volta ao ocioso. */
  private encerrar(eventos: EventoDeGesto[]): void {
    switch (this.estado) {
      case 'girando':
        eventos.push({ tipo: 'soltarGiro', ...this.velocidadeDoGiro() });
        break;
      case 'apontando':
        eventos.push({ tipo: 'cursorFim' });
        break;
      case 'explosao':
        eventos.push({ tipo: 'explosaoFim', fator: this.fatorEmitido });
        break;
    }
    this.estado = 'ocioso';
    this.ativa = null;
    this.segunda = null;
  }

  private passo(t: number, visiveis: MaoSeguida[], eventos: EventoDeGesto[]): void {
    if (this.estado === 'ocioso') {
      this.escolherGesto(t, visiveis, eventos);
      return;
    }
    const m = this.ativa;
    if (!m?.vistaAgora) return;
    switch (this.estado) {
      case 'girando':
        this.girar(t, m, visiveis, eventos);
        break;
      case 'pincaDecidindo':
        this.decidirPinca(t, m, eventos);
        break;
      case 'zoomProfundidade':
        if (!m.pincando) return this.voltarAoOcioso();
        this.emitirZoom(m.tamanho, eventos);
        break;
      case 'zoomDuasMaos': {
        const outra = this.segunda;
        if (!outra?.vistaAgora) return;
        if (!m.pincando || !outra.pincando) return this.voltarAoOcioso();
        this.emitirZoom(distanciaEntre(m.pincaCorrigida, outra.pincaCorrigida), eventos);
        break;
      }
      case 'explosao':
        this.explodir(t, m, eventos);
        break;
      case 'apontando':
        this.apontar(t, m, eventos);
        break;
      case 'punhoArmando':
        if (m.pose !== 'punho') return this.voltarAoOcioso();
        if (t - this.punhoDesde >= this.opcoes.resetarMs) {
          eventos.push({ tipo: 'resetar' });
          this.estado = 'punhoSeguro';
        }
        break;
      case 'punhoSeguro':
        // O punho que travou a explosão ou já resetou não arma outro reset: só depois de abrir.
        if (m.pose !== 'punho') this.voltarAoOcioso();
        break;
    }
  }

  private escolherGesto(t: number, visiveis: MaoSeguida[], eventos: EventoDeGesto[]): void {
    const pincando = visiveis.filter((m) => m.firme('pinca'));
    if (pincando.length >= 2 && this.opcoes.maosMax >= 2) {
      this.iniciarZoomDuasMaos(pincando[0]!, pincando[1]!);
      return;
    }
    for (const m of visiveis) {
      if (m.firme('pinca')) {
        this.ativa = m;
        if (this.opcoes.zoomPorProfundidade) {
          this.estado = 'pincaDecidindo';
          this.origemDaPinca = m.pinca;
          this.tamanhoDeReferencia = m.tamanho;
        } else {
          this.iniciarGiro(t, m, m.pinca);
        }
        return;
      }
      if (m.firme('apontar')) {
        this.ativa = m;
        this.estado = 'apontando';
        this.ancora = m.cursor;
        this.ancoraDesde = t;
        this.selecaoDisparada = false;
        eventos.push({ tipo: 'cursor', ...m.cursor });
        return;
      }
      if (m.firme('punho')) {
        this.ativa = m;
        this.estado = 'punhoArmando';
        this.punhoDesde = m.poseDesde;
        return;
      }
      if (m.abertaParadaDesde !== null && t - m.abertaParadaDesde >= this.opcoes.explosaoMs) {
        this.ativa = m;
        this.estado = 'explosao';
        this.historicoDoFator = [];
        eventos.push({ tipo: 'explosaoInicio' });
        this.fatorEmitido = m.abertura;
        this.historicoDoFator.push({ t, f: m.abertura });
        eventos.push({ tipo: 'explosao', fator: m.abertura });
        return;
      }
    }
  }

  private iniciarGiro(t: number, m: MaoSeguida, de: Ponto2): void {
    this.ativa = m;
    this.estado = 'girando';
    this.ultimoPonto = de;
    this.historicoDoGiro = [{ t, ...de }];
  }

  private iniciarZoomDuasMaos(a: MaoSeguida, b: MaoSeguida): void {
    this.ativa = a;
    this.segunda = b;
    this.estado = 'zoomDuasMaos';
    this.referenciaDoZoom = distanciaEntre(a.pincaCorrigida, b.pincaCorrigida);
  }

  private girar(t: number, m: MaoSeguida, visiveis: MaoSeguida[], eventos: EventoDeGesto[]): void {
    // A soltura usa a histerese, não a pose estável: esperar 150 ms arrastaria o objeto depois de soltar.
    if (!m.pincando) {
      eventos.push({ tipo: 'soltarGiro', ...this.velocidadeDoGiro() });
      this.voltarAoOcioso();
      return;
    }
    if (this.opcoes.maosMax >= 2) {
      const outra = visiveis.find((o) => o !== m && o.firme('pinca'));
      if (outra) {
        eventos.push({ tipo: 'soltarGiro', vx: 0, vy: 0 });
        this.iniciarZoomDuasMaos(m, outra);
        return;
      }
    }
    const dx = m.pinca.x - this.ultimoPonto.x;
    const dy = m.pinca.y - this.ultimoPonto.y;
    if (dx || dy) eventos.push({ tipo: 'girar', dx, dy });
    this.ultimoPonto = m.pinca;
    this.historicoDoGiro.push({ t, ...m.pinca });
    this.historicoDoGiro = this.historicoDoGiro.filter((a) => t - a.t <= JANELA_DA_INERCIA_MS * 3);
  }

  /** Perfil de uma mão: o que passar do limiar primeiro — andar ou mudar de tamanho — decide. */
  private decidirPinca(t: number, m: MaoSeguida, eventos: EventoDeGesto[]): void {
    if (!m.pincando) return this.voltarAoOcioso();
    if (Math.abs(Math.log(m.tamanho / this.tamanhoDeReferencia)) > this.opcoes.decidirZoom) {
      this.estado = 'zoomProfundidade';
      this.referenciaDoZoom = this.tamanhoDeReferencia;
      this.emitirZoom(m.tamanho, eventos);
      return;
    }
    if (distanciaEntre(m.pinca, this.origemDaPinca) > this.opcoes.decidirGiro) {
      this.iniciarGiro(t, m, this.origemDaPinca);
      this.girar(t, m, [], eventos);
    }
  }

  private emitirZoom(medida: number, eventos: EventoDeGesto[]): void {
    if (this.referenciaDoZoom > 0 && medida > 0) {
      const fator = medida / this.referenciaDoZoom;
      if (Math.abs(fator - 1) > 1e-4) eventos.push({ tipo: 'zoom', fator });
    }
    this.referenciaDoZoom = medida;
  }

  private explodir(t: number, m: MaoSeguida, eventos: EventoDeGesto[]): void {
    if (m.firme('punho')) {
      // Fechar a mão passa pelos fatores baixos: trava o de antes de a mão começar a fechar.
      const travado = this.fatorEm(m.poseDesde - this.opcoes.recuoDaTravaMs);
      eventos.push({ tipo: 'explosaoFim', fator: travado });
      this.fatorEmitido = travado;
      this.estado = 'punhoSeguro';
      return;
    }
    const fator = m.abertura;
    this.historicoDoFator.push({ t, f: fator });
    this.historicoDoFator = this.historicoDoFator.filter((a) => t - a.t <= HISTORICO_DO_FATOR_MS);
    if (Math.abs(fator - this.fatorEmitido) >= 0.01) {
      eventos.push({ tipo: 'explosao', fator });
      this.fatorEmitido = fator;
    }
  }

  private fatorEm(instante: number): number {
    let valor = this.historicoDoFator[0]?.f ?? this.fatorEmitido;
    for (const a of this.historicoDoFator) {
      if (a.t > instante) break;
      valor = a.f;
    }
    return valor;
  }

  private apontar(t: number, m: MaoSeguida, eventos: EventoDeGesto[]): void {
    if (m.pose !== 'apontar') {
      eventos.push({ tipo: 'cursorFim' });
      this.voltarAoOcioso();
      return;
    }
    eventos.push({ tipo: 'cursor', ...m.cursor });
    if (distanciaEntre(m.cursor, this.ancora) > this.opcoes.raioParado) {
      this.ancora = m.cursor;
      this.ancoraDesde = t;
      this.selecaoDisparada = false;
    } else if (!this.selecaoDisparada && t - this.ancoraDesde >= this.opcoes.apontarMs) {
      eventos.push({ tipo: 'apontarParado', ...this.ancora });
      this.selecaoDisparada = true;
    }
  }

  private voltarAoOcioso(): void {
    this.estado = 'ocioso';
    this.ativa = null;
    this.segunda = null;
  }

  private velocidadeDoGiro(): { vx: number; vy: number } {
    const h = this.historicoDoGiro;
    const ultima = h.at(-1);
    if (!ultima) return { vx: 0, vy: 0 };
    let primeira = h.find((a) => ultima.t - a.t <= JANELA_DA_INERCIA_MS) ?? ultima;
    // A 15 detecções/s a janela pode ter uma amostra só: usa a anterior a ela.
    if (primeira === ultima && h.length > 1) primeira = h.at(-2)!;
    const dt = (ultima.t - primeira.t) / 1000;
    return dt > 0 ? { vx: (ultima.x - primeira.x) / dt, vy: (ultima.y - primeira.y) / dt } : { vx: 0, vy: 0 };
  }

  private nomeDoGesto(visiveis: MaoSeguida[]): string {
    switch (this.estado) {
      case 'semMao':
        return 'Sem mão';
      case 'ocioso':
        return ROTULOS_DA_POSE[visiveis[0]?.pose ?? 'nenhuma'];
      case 'girando':
        return 'Girando';
      case 'pincaDecidindo':
        return 'Pinça';
      case 'zoomProfundidade':
      case 'zoomDuasMaos':
        return 'Zoom';
      case 'explosao':
        // Em passos de 5%: o rótulo muda pouco e não acorda a tela a cada quadro.
        return `Explosão ${Math.round(this.fatorEmitido * 20) * 5}%`;
      case 'apontando':
        return 'Apontando';
      case 'punhoArmando':
        return 'Resetando…';
      case 'punhoSeguro':
        return 'Punho';
    }
  }
}

function mesclar(opcoes: Partial<OpcoesDoMotor>): OpcoesDoMotor {
  return {
    ...OPCOES_PADRAO_DO_MOTOR,
    ...opcoes,
    filtro: { ...OPCOES_PADRAO_DO_MOTOR.filtro, ...opcoes.filtro },
  };
}

function naTela(x: number, y: number, espelhar: boolean): Ponto2 {
  return { x: espelhar ? 1 - x : x, y };
}

/** A zona ativa (o centro do quadro) vira a tela inteira: as bordas ficam ao alcance sem a mão sair da câmera. */
function esticar(p: Ponto2, zona: number): Ponto2 {
  const margem = (1 - zona) / 2;
  const prender = (v: number) => Math.min(1, Math.max(0, (v - margem) / zona));
  return { x: prender(p.x), y: prender(p.y) };
}

function distanciaEntre(a: Ponto2, b: Ponto2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
