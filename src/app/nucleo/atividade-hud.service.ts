import { DestroyRef, Service, computed, inject, signal } from '@angular/core';
import type {
  HistoricoConversa,
  PedidoConversa,
  ProgressoConversa,
  RespostaConversa,
} from './conversa.modelos';
import type { TarefaComputer } from './jarvis-api.service';

export type EstadoJarvis =
  'repouso' | 'escutando' | 'pensando' | 'executando' | 'falando' | 'concluido' | 'erro';
export interface AtividadeHud {
  chave: number;
  id: string;
  texto: string;
  hora: string;
  tipo: 'inicio' | 'ferramenta' | 'concluido' | 'erro' | 'card';
}
export interface ExecucaoHud {
  id: string;
  titulo: string;
  canal: string;
  estado: 'processando' | 'concluido' | 'erro' | 'interrompido';
  ferramenta: ProgressoConversa | null;
  restaurada: boolean;
}

/** Projeção dos eventos existentes, sem inferir sucesso individual de ferramentas. */
@Service()
export class AtividadeHudService {
  readonly atividades = signal<AtividadeHud[]>([]);
  readonly execucoes = signal<ExecucaoHud[]>([]);
  readonly computer = signal<TarefaComputer | null>(null);
  readonly pulso = signal<'concluido' | 'erro' | null>(null);
  private readonly observadas = signal<ProgressoConversa[]>([]);
  readonly ferramentas = this.observadas.asReadonly();
  readonly emCurso = computed(
    () => this.execucoes().find((e) => e.canal === 'hud' && e.estado === 'processando') ?? null,
  );
  readonly ferramenta = computed(() => this.emCurso()?.ferramenta ?? null);
  private sequencia = 0;
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private readonly cards = new Set<string>();
  private readonly respostasAoVivo = new Set<string>();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.limparPulso());
  }

  iniciar(pedido: PedidoConversa, aoVivo = true): void {
    if (pedido.canal !== 'hud') return;
    const existente = this.execucoes().find((e) => e.id === pedido.id);
    if (existente) return;
    if (aoVivo) this.limparPulso();
    this.inserir({
      id: pedido.id,
      titulo: pedido.texto || 'Pedido ao Jarvis',
      canal: pedido.canal,
      estado: 'processando',
      ferramenta: null,
      restaurada: !aoVivo,
    });
    if (aoVivo) this.registrar(pedido.id, 'Pedido recebido pelo Jarvis', 'inicio');
  }

  observar(progresso: ProgressoConversa): void {
    if (progresso.canal !== 'hud') return;
    const execucao = this.execucoes().find((e) => e.id === progresso.id);
    if (!execucao || execucao.estado !== 'processando') return;
    if (JSON.stringify(execucao.ferramenta) === JSON.stringify(progresso)) return;
    this.observadas.update((lista) =>
      [progresso, ...lista.filter((f) => f.nome !== progresso.nome)].slice(0, 40),
    );
    this.execucoes.update((lista) =>
      lista.map((e) => (e.id === progresso.id ? { ...e, ferramenta: progresso } : e)),
    );
    this.registrar(progresso.id, progresso.descricao || progresso.nome, 'ferramenta');
  }

  responder(resposta: RespostaConversa, aoVivo: boolean): void {
    const anterior = this.execucoes().find((e) => e.id === resposta.id);
    if (
      anterior &&
      anterior.estado !== 'processando' &&
      (!aoVivo || this.respostasAoVivo.has(resposta.id))
    )
      return;
    this.inserir({
      id: resposta.id,
      titulo: anterior?.titulo ?? 'Resposta do Jarvis',
      canal: resposta.canal,
      estado: resposta.erro ? 'erro' : 'concluido',
      ferramenta: anterior?.ferramenta ?? null,
      restaurada: !aoVivo,
    });
    if (aoVivo && resposta.canal === 'hud') {
      this.respostasAoVivo.add(resposta.id);
      if (this.respostasAoVivo.size > 100)
        this.respostasAoVivo.delete(this.respostasAoVivo.values().next().value!);
      const tipo = resposta.erro ? 'erro' : 'concluido';
      this.registrar(resposta.id, resposta.erro || 'Resposta recebida', tipo);
      this.sinalizar(tipo);
    }
  }

  restaurar(historico: HistoricoConversa): void {
    for (const troca of historico.trocas.slice(-10)) {
      if (!this.execucoes().some((e) => e.id === troca.id)) {
        this.inserir({
          id: troca.id,
          titulo: troca.pedido,
          canal: troca.canal,
          estado: troca.resposta.erro ? 'erro' : 'concluido',
          ferramenta: null,
          restaurada: true,
        });
      }
    }
    // O servidor pode ter reiniciado ou perdido uma execução: não deixar ferramenta acesa.
    this.execucoes.update((lista) =>
      lista.map((e) =>
        e.estado === 'processando' &&
        e.id !== historico.emAndamento?.id &&
        e.id !== historico.ultima?.id
          ? { ...e, estado: 'interrompido', ferramenta: null }
          : e,
      ),
    );
  }

  receberComputer(tarefa: TarefaComputer | null, aoVivo: boolean): void {
    if (!tarefa) return;
    const anterior = this.computer();
    this.computer.set(tarefa);
    if (aoVivo && (!anterior || JSON.stringify(anterior) !== JSON.stringify(tarefa))) {
      this.registrar(
        tarefa.id,
        `Tarefa no PC: ${tarefa.estado}${tarefa.motivo ? ' · ' + tarefa.motivo : ''}`,
        'ferramenta',
      );
      if (tarefa.estado === 'concluido' && anterior?.estado !== 'concluido')
        this.sinalizar('concluido');
      if (
        (tarefa.estado === 'falhou' || tarefa.estado === 'resultado_incerto') &&
        anterior?.estado !== tarefa.estado
      )
        this.sinalizar('erro');
    }
  }

  finalizarNarracao(id: string): void {
    const execucao = this.execucoes()[0];
    if (!this.emCurso() && execucao?.id === id && !execucao.restaurada)
      this.sinalizar(execucao.estado === 'erro' ? 'erro' : 'concluido');
  }

  receberCard(id: string, titulo: string): void {
    if (this.cards.has(id)) return;
    this.cards.add(id);
    if (this.cards.size > 100) this.cards.delete(this.cards.values().next().value!);
    this.registrar(id, `Aberto no workspace: ${titulo}`, 'card');
  }

  private inserir(execucao: ExecucaoHud): void {
    this.execucoes.update((lista) =>
      [execucao, ...lista.filter((e) => e.id !== execucao.id)].slice(0, 30),
    );
  }
  private registrar(id: string, texto: string, tipo: AtividadeHud['tipo']): void {
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    this.atividades.update((lista) =>
      [{ chave: ++this.sequencia, id, texto, hora, tipo }, ...lista].slice(0, 50),
    );
  }
  private sinalizar(tipo: 'concluido' | 'erro'): void {
    this.limparPulso();
    this.pulso.set(tipo);
    this.temporizador = setTimeout(() => {
      this.pulso.set(null);
      this.temporizador = null;
    }, 2200);
  }
  private limparPulso(): void {
    if (this.temporizador !== null) clearTimeout(this.temporizador);
    this.temporizador = null;
    this.pulso.set(null);
  }
}

export function etapaValida(p: ProgressoConversa): boolean {
  return (
    Number.isInteger(p.passo) &&
    Number.isInteger(p.total) &&
    (p.passo ?? 0) > 0 &&
    (p.total ?? 0) >= (p.passo ?? 0)
  );
}
