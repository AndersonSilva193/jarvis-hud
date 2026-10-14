import { Injectable, computed, inject, signal } from '@angular/core';

import {
  TITULO_CLIMA,
  TITULO_LEMBRETES,
  TITULO_NOTICIAS,
  TITULO_SISTEMAS,
  type Bloco,
  type Briefing,
  type DadosClima,
  type DadosLembretes,
  type DadosNoticias,
  type DadosSecao,
  type DadosSistemas,
  type Secao,
} from './briefing.modelos';
import { VozService } from './voz.service';

export type Fase = 'ocioso' | 'gerando' | 'tocando' | 'concluido';

export const LEGENDA_GERANDO = 'Atualizando o radar de notícias...';
const LEGENDA_OCIOSO = 'Aguardando o briefing';

/**
 * A fila do briefing: um bloco por vez no centro, cada um falado até o fim antes do próximo.
 *
 * Quem dispara isto são três coisas que não se coordenam entre si — o botão "Bom dia", o
 * `/bomdia` do Telegram e o cron das 8h — então a fila precisa aguentar um briefing novo
 * chegando no meio de outro e o mesmo briefing chegando duas vezes (o POST frio devolve na
 * resposta HTTP o mesmo briefing que já veio pelo SSE).
 */
@Injectable({ providedIn: 'root' })
export class BriefingPlayerService {
  private readonly voz = inject(VozService);

  readonly fase = signal<Fase>('ocioso');
  readonly blocos = signal<Bloco[]>([]);
  /** Índice do bloco no palco. Acima dele, nada apareceu ainda; abaixo, já está na fileira. */
  readonly indiceAtual = signal(-1);
  readonly briefing = signal<Briefing | null>(null);

  readonly atual = computed(() => this.blocos()[this.indiceAtual()] ?? null);
  readonly legenda = computed(() => {
    switch (this.fase()) {
      case 'gerando':
        return LEGENDA_GERANDO;
      case 'ocioso':
        return LEGENDA_OCIOSO;
      default:
        return '';
    }
  });

  /** Tempo que o card fica no palco antes da fala começar, para a entrada não ser atropelada. */
  pausaDeEntradaMs = 600;

  /**
   * O que vem depois do último bloco — hoje a pergunta das observações. Quem monta é a página,
   * para a fila não precisar saber que existe microfone.
   */
  epilogo: ((briefing: Briefing, sinal: AbortSignal) => Promise<void>) | null = null;

  /** Cresce a cada nova reprodução: o laço antigo vê que não é mais o dono e desiste. */
  private execucao = 0;
  private cancelamento = new AbortController();
  private emAndamento: string | null = null;

  /** Um briefing começou a ser montado no servidor. */
  gerando(): void {
    this.cancelamento.abort();
    this.execucao += 1;
    this.voz.parar();
    this.emAndamento = null;
    this.blocos.set([]);
    this.indiceAtual.set(-1);
    this.fase.set('gerando');
  }

  /** Pinta um briefing sem falar nada: é o que o HUD faz ao abrir, com o /ultimo. */
  mostrar(briefing: Briefing): void {
    if (this.fase() === 'tocando' || this.fase() === 'gerando') {
      return;
    }
    const blocos = blocosDe(briefing);
    this.briefing.set(briefing);
    this.blocos.set(blocos);
    this.indiceAtual.set(blocos.length);
    this.fase.set('concluido');
  }

  /**
   * Toca o briefing inteiro, bloco por bloco.
   *
   * Ignora o briefing que já está tocando agora (é o SSE e a resposta do POST descrevendo o
   * mesmo briefing), mas aceita o mesmo `geradoEm` depois do fim — clicar "Bom dia" de novo
   * dentro dos 60 s de cache da API tem de tocar outra vez.
   */
  async tocar(briefing: Briefing): Promise<void> {
    if (this.fase() === 'tocando' && this.emAndamento === briefing.geradoEm) {
      return;
    }

    this.cancelamento.abort();
    this.cancelamento = new AbortController();
    const sinal = this.cancelamento.signal;
    const minhaVez = ++this.execucao;
    this.voz.parar();
    this.emAndamento = briefing.geradoEm;
    this.briefing.set(briefing);

    const blocos = blocosDe(briefing);
    this.blocos.set(blocos);
    this.indiceAtual.set(-1);
    this.fase.set('tocando');

    for (let i = 0; i < blocos.length; i += 1) {
      if (minhaVez !== this.execucao) {
        return;
      }
      this.indiceAtual.set(i);
      await espera(this.pausaDeEntradaMs);
      if (minhaVez !== this.execucao) {
        return;
      }
      await this.voz.falar(blocos[i]!.fala);
    }

    if (minhaVez !== this.execucao) {
      return;
    }
    // Todos abaixo do índice: a fileira fica cheia e o palco vazio.
    this.indiceAtual.set(blocos.length);

    // A fase só fecha depois do epílogo: enquanto a pergunta está no ar, continuar em "tocando"
    // é o que mantém a guarda de reentrância de pé — briefing novo cancela a pergunta e um "bom
    // dia" ouvido na janela não dispara nada. O try/catch existe para que um epílogo que estoure
    // não deixe a fase congelada, o que mataria a palavra de ativação.
    const epilogo = this.epilogo;
    if (epilogo !== null) {
      try {
        await epilogo(briefing, sinal);
      } catch {
        // Pergunta que não deu certo não é motivo para a fila ficar presa.
      }
      if (minhaVez !== this.execucao) {
        return;
      }
    }
    this.fase.set('concluido');
  }

  /** Corta a fala do bloco atual; o laço segue para o próximo. */
  pular(): void {
    this.voz.parar();
  }

  /** Encerra a reprodução onde está e manda tudo para a fileira. */
  parar(): void {
    this.cancelamento.abort();
    this.execucao += 1;
    this.voz.parar();
    if (this.blocos().length > 0) {
      this.indiceAtual.set(this.blocos().length);
      this.fase.set('concluido');
    } else {
      this.fase.set('ocioso');
    }
  }
}

/**
 * Transforma as seções do briefing na fila de blocos.
 *
 * Não é um espelho de `secoes`: a abertura ganha um bloco próprio e a seção de notícias virá
 * como um bloco por manchete, porque cada manchete tem a sua imagem e merece a tela inteira.
 */
/**
 * O que falar de uma seção: a narração do Jarvis quando o backend manda, senão a prosa montada
 * em Java. O `conteudo` nunca é substituído — ele continua sendo o que o card desenha.
 */
function falaDe(secao: Secao): string {
  return secao.fala?.trim() || secao.conteudo;
}

export function blocosDe(briefing: Briefing): Bloco[] {
  const blocos: Bloco[] = [abertura(briefing)];

  briefing.secoes.forEach((secao, indice) => {
    const chave = `${indice}-${secao.titulo}`;
    const dados = secao.dados;

    if (secao.titulo === TITULO_CLIMA && dados) {
      blocos.push({
        id: chave,
        tipo: 'clima',
        rotulo: 'clima',
        fala: falaDe(secao),
        dados: converter<DadosClima>(dados),
      });
      return;
    }

    if (secao.titulo === TITULO_LEMBRETES && dados) {
      blocos.push({
        id: chave,
        tipo: 'lembretes',
        rotulo: 'lembretes de hoje',
        fala: falaDe(secao),
        dados: converter<DadosLembretes>(dados),
      });
      return;
    }

    if (secao.titulo === TITULO_SISTEMAS && dados) {
      blocos.push({
        id: chave,
        tipo: 'sistemas',
        rotulo: 'sistemas',
        fala: falaDe(secao),
        dados: converter<DadosSistemas>(dados),
      });
      return;
    }

    if (secao.titulo === TITULO_NOTICIAS && dados) {
      const itens = converter<DadosNoticias>(dados).itens ?? [];
      if (itens.length === 0) {
        // "Nada novo nas últimas 24 horas." ainda merece ser dito.
        blocos.push(blocoDeTexto(chave, 'notícias', secao));
        return;
      }
      itens.forEach((item, posicao) => {
        blocos.push({
          id: `${chave}-${posicao}`,
          tipo: 'noticia',
          rotulo: `notícia ${posicao + 1} de ${itens.length}`,
          // A prosa da seção é uma lista com marcador; para uma manchete só, isto lê melhor.
          fala: `${item.titulo}. Fonte: ${item.fonte || item.tema}.`,
          dados: item,
        });
      });
      return;
    }

    // Seção que falhou (dados nulo) ou um título que a API passou a mandar depois: mostra a
    // prosa como está, em vez de sumir com ela da tela.
    blocos.push(blocoDeTexto(chave, secao.titulo, secao));
  });

  return blocos;
}

function abertura(briefing: Briefing): Bloco {
  const data = new Date(briefing.geradoEm);
  const valida = !Number.isNaN(data.getTime());
  const dia = valida
    ? new Intl.DateTimeFormat('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
      }).format(data)
    : '';
  const hora = valida
    ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(data)
    : '';
  const saudacao = `Bom dia, ${briefing.nomeUsuario}!`;

  return {
    id: 'abertura',
    tipo: 'abertura',
    rotulo: 'briefing do dia',
    // A abertura narrada pelo Jarvis, quando veio; senão o cumprimento montado aqui.
    fala: briefing.abertura?.trim() || (valida ? `${saudacao} ${dia}, ${hora}.` : saudacao),
    linhas: valida ? [saudacao, `${dia} às ${hora}`] : [saudacao],
  };
}

function blocoDeTexto(id: string, rotulo: string, secao: Secao): Bloco {
  return {
    id,
    tipo: 'texto',
    rotulo,
    fala: falaDe(secao),
    linhas: secao.conteudo.split('\n').filter((linha) => linha.trim().length > 0),
  };
}

/**
 * O `dados` da API não tem campo de tipo: quem discrimina é o `titulo` da seção, então a
 * conversão acontece aqui, num lugar só, depois do título já ter sido conferido.
 */
function converter<T extends DadosSecao>(dados: DadosSecao): T {
  return dados as T;
}

function espera(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolver) => setTimeout(resolver, ms));
}
