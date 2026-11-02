import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtividadeHudService, etapaValida } from './atividade-hud.service';
import type {
  HistoricoConversa,
  PedidoConversa,
  ProgressoConversa,
  RespostaConversa,
} from './conversa.modelos';

const pedido: PedidoConversa = {
  id: 't1',
  canal: 'hud',
  texto: 'Pesquise e crie um gráfico',
  estado: 'processando',
  iniciadoEm: '',
};
const progresso: ProgressoConversa = {
  id: 't1',
  canal: 'hud',
  nome: 'buscar_na_web',
  descricao: 'Consultando fontes',
  passo: 1,
  total: 3,
};
const resposta: RespostaConversa = {
  id: 't1',
  canal: 'hud',
  texto: 'Pronto',
  anexos: [],
  confirmacao: null,
  concluidoEm: '',
  erro: null,
};
const historico: HistoricoConversa = {
  sessao: 's1',
  revisao: 1,
  ultima: resposta,
  emAndamento: null,
  trocas: [{ id: 't1', canal: 'hud', pedido: pedido.texto, resposta }],
};

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
});

describe('projeção de atividades reais na HUD', () => {
  it('correlaciona ferramentas, ignora duplicatas e conserva todas as ferramentas observadas', () => {
    const s = TestBed.inject(AtividadeHudService);
    s.iniciar(pedido);
    s.iniciar(pedido);
    s.observar({ ...progresso, id: 'outro-pedido' });
    expect(s.ferramenta()).toBeNull();
    s.observar(progresso);
    s.observar(progresso);
    s.observar({ ...progresso, nome: 'grafico_de_dados' });
    expect(s.execucoes()).toHaveLength(1);
    expect(s.atividades()).toHaveLength(3);
    expect(s.ferramentas()).toHaveLength(2);
    expect(s.ferramenta()?.nome).toBe('grafico_de_dados');
    s.responder(resposta, true);
    s.responder(resposta, true);
    expect(s.emCurso()).toBeNull();
    expect(s.atividades()).toHaveLength(4);
    expect(s.execucoes()[0]?.ferramenta?.nome).toBe('grafico_de_dados');
  });

  it('restauração e reconexão não criam atividades nem efeitos de conclusão', () => {
    const s = TestBed.inject(AtividadeHudService);
    s.restaurar(historico);
    s.restaurar(historico);
    s.responder(resposta, false);
    expect(s.execucoes()).toHaveLength(1);
    expect(s.execucoes()[0]?.restaurada).toBe(true);
    expect(s.atividades()).toEqual([]);
    expect(s.pulso()).toBeNull();
  });

  it('encerra visualmente só eventos ao vivo e não deixa uma fala antiga concluir o novo pedido', () => {
    vi.useFakeTimers();
    const s = TestBed.inject(AtividadeHudService);
    s.iniciar(pedido);
    s.responder(resposta, true);
    expect(s.pulso()).toBe('concluido');
    vi.advanceTimersByTime(2300);
    expect(s.pulso()).toBeNull();
    s.finalizarNarracao('t1');
    expect(s.pulso()).toBe('concluido');
    s.iniciar({ ...pedido, id: 't2' });
    s.finalizarNarracao('t1');
    expect(s.pulso()).toBeNull();
    s.responder({ ...resposta, id: 't2', erro: 'Falha ao consultar' }, true);
    expect(s.pulso()).toBe('erro');
  });

  it('limita atividades a 50 e não associa um card a uma execução sem metadados', () => {
    const s = TestBed.inject(AtividadeHudService);
    for (let n = 0; n < 80; n++) s.receberCard('c' + n, 'Resultado ' + n);
    s.receberCard('c79', 'Resultado 79');
    expect(s.atividades()).toHaveLength(50);
    expect(s.atividades()[0]?.id).toBe('c79');
    expect(s.execucoes()).toEqual([]);
  });

  it('um pedido perdido pelo backend deixa de indicar ferramenta em execução', () => {
    const s = TestBed.inject(AtividadeHudService);
    s.iniciar(pedido);
    s.observar(progresso);
    s.restaurar({ ...historico, trocas: [], ultima: null });
    expect(s.execucoes()[0]?.estado).toBe('interrompido');
    expect(s.ferramenta()).toBeNull();
  });

  it('restaurar uma tarefa concluída no PC é silencioso e a conclusão ao vivo é deduplicada', () => {
    const s = TestBed.inject(AtividadeHudService);
    const tarefa = {
      id: 'pc1',
      estado: 'concluido',
      provedor: '',
      modelo: '',
      ciclos: 2,
      acoes: 3,
      motivo: '',
      iniciadoEm: '',
    };
    s.receberComputer(tarefa, false);
    expect(s.pulso()).toBeNull();
    s.receberComputer({ ...tarefa, id: 'pc2', estado: 'executando' }, true);
    s.receberComputer({ ...tarefa, id: 'pc2' }, true);
    s.receberComputer({ ...tarefa, id: 'pc2' }, true);
    expect(s.pulso()).toBe('concluido');
    expect(s.atividades()).toHaveLength(2);
  });

  it('não apresenta percentuais quando o progresso está incompleto ou inválido', () => {
    expect(etapaValida(progresso)).toBe(true);
    for (const p of [
      { passo: null, total: null },
      { passo: 2, total: 1 },
      { passo: 0, total: 3 },
      { passo: 0.5, total: 3 },
    ]) {
      expect(etapaValida({ ...progresso, ...p })).toBe(false);
    }
  });
});
