import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { BriefingPlayerService, blocosDe } from './briefing-player.service';
import { VozService } from './voz.service';
import type { Briefing, Secao } from './briefing.modelos';

const GERADO_EM = '2026-10-13T08:00:00-03:00';

function briefingDe(secoes: Secao[], geradoEm = GERADO_EM): Briefing {
  return {
    geradoEm,
    // Explícito de propósito: sem ele a saudação sairia do offset, e o teste passaria por acaso.
    fusoHorario: 'America/Sao_Paulo',
    nomeUsuario: 'Anderson',
    secoes,
    texto: 'Bom dia, Anderson!',
    geradoAgora: true,
  };
}

const CLIMA: Secao = {
  titulo: 'clima',
  conteudo: 'Curitiba: 18 °C agora (céu limpo)',
  dados: {
    cidade: 'Curitiba',
    temperaturaAtual: 18,
    minima: 14,
    maxima: 22,
    chanceChuvaPct: 30,
    descricao: 'céu limpo',
  },
};

const LEMBRETES: Secao = {
  titulo: 'lembretes de hoje',
  conteudo: '09:00 Enviar o currículo',
  dados: { itens: [{ hora: '09:00', texto: 'Enviar o currículo' }] },
};

const NOTICIAS: Secao = {
  titulo: 'notícias',
  conteudo: '• [tecnologia · G1] Primeira\n• [politica] Segunda',
  dados: {
    itens: [
      {
        titulo: 'Primeira',
        tema: 'tecnologia',
        fonte: 'G1',
        link: 'https://g1/1',
        imagemUrl: 'https://g1/1.jpg',
      },
      { titulo: 'Segunda', tema: 'politica', fonte: '', link: 'https://g1/2', imagemUrl: '' },
    ],
  },
};

/** Uma voz de mentira: no modo manual a fala só termina quando o teste manda. */
class VozFalsa {
  readonly falados: string[] = [];
  /** Os textos que o player mandou adiantar: é por aqui que se vê o pré-carregamento. */
  readonly preparados: string[] = [];
  manual = false;
  paradas = 0;

  preparar(texto: string | null | undefined): void {
    if (texto) this.preparados.push(texto);
  }

  private concluirAtual: (() => void) | null = null;

  falar(texto: string): Promise<void> {
    this.falados.push(texto);
    if (!this.manual) {
      return Promise.resolve();
    }
    return new Promise<void>((resolver) => {
      this.concluirAtual = resolver;
    });
  }

  parar(): void {
    this.paradas += 1;
    this.terminarFala();
  }

  terminarFala(): void {
    const resolver = this.concluirAtual;
    this.concluirAtual = null;
    resolver?.();
  }
}

/** Deixa as promessas pendentes andarem antes de conferir o estado. */
function respirar(): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, 0));
}

describe('blocosDe', () => {
  it('abre com a saudação e segue a ordem das seções', () => {
    const blocos = blocosDe(briefingDe([CLIMA, LEMBRETES]));

    expect(blocos.map((b) => b.tipo)).toEqual(['abertura', 'clima', 'lembretes']);
    expect(blocos[0]!.fala).toContain('Bom dia, Anderson!');
  });

  it('fala a narração do Jarvis quando a API manda, e o card segue com o conteudo', () => {
    const blocos = blocosDe(
      briefingDe([{ ...CLIMA, fala: 'Dezoito graus e céu limpo em Curitiba, senhor.' }]),
    );

    expect(blocos[1]!.fala).toBe('Dezoito graus e céu limpo em Curitiba, senhor.');
    // O card continua desenhando os dados estruturados, não a narração.
    expect(blocos[1]!.tipo).toBe('clima');
  });

  it('sem narração — ou com ela em branco — fala o conteudo montado em Java', () => {
    expect(blocosDe(briefingDe([CLIMA]))[1]!.fala).toBe(CLIMA.conteudo);
    expect(blocosDe(briefingDe([{ ...CLIMA, fala: '   ' }]))[1]!.fala).toBe(CLIMA.conteudo);
  });

  it('abertura usa a narração do Jarvis quando vem, senão o cumprimento montado aqui', () => {
    const narrado = blocosDe({
      ...briefingDe([CLIMA]),
      abertura: 'Bom dia, senhor. Seu briefing está pronto.',
    });
    expect(narrado[0]!.fala).toBe('Bom dia, senhor. Seu briefing está pronto.');

    expect(blocosDe(briefingDe([CLIMA]))[0]!.fala).toContain('Bom dia, Anderson!');
  });

  it('transforma cada manchete em um bloco próprio, com a sua imagem', () => {
    const blocos = blocosDe(briefingDe([NOTICIAS]));

    const noticias = blocos.filter((b) => b.tipo === 'noticia');
    expect(noticias).toHaveLength(2);
    expect(noticias[0]!.rotulo).toBe('notícia 1 de 2');
    // A prosa da seção é uma lista com marcador; a fala de uma manchete só lê melhor assim.
    expect(noticias[0]!.fala).toBe('Primeira. Fonte: G1.');
    // Sem fonte, sobra o tema.
    expect(noticias[1]!.fala).toBe('Segunda. Fonte: politica.');
  });

  it('seção de notícias vazia continua sendo falada', () => {
    const blocos = blocosDe(
      briefingDe([
        { titulo: 'notícias', conteudo: 'Nada novo nas últimas 24 horas.', dados: { itens: [] } },
      ]),
    );

    expect(blocos[1]!.tipo).toBe('texto');
    expect(blocos[1]!.fala).toBe('Nada novo nas últimas 24 horas.');
  });

  it('seção que falhou no servidor aparece como texto em vez de desaparecer', () => {
    const blocos = blocosDe(
      briefingDe([
        { titulo: 'clima', conteudo: 'não consegui consultar agora (timeout)', dados: null },
      ]),
    );

    expect(blocos[1]!.tipo).toBe('texto');
    expect(blocos[1]!.rotulo).toBe('clima');
  });

  it('título desconhecido não derruba nada: vira um card de texto', () => {
    const blocos = blocosDe(
      briefingDe([{ titulo: 'bolsa', conteudo: 'Ibovespa: +1,2%', dados: null }]),
    );

    expect(blocos[1]!.tipo).toBe('texto');
    expect(blocos[1]!.rotulo).toBe('bolsa');
  });
});

describe('BriefingPlayerService', () => {
  let player: BriefingPlayerService;
  let voz: VozFalsa;

  beforeEach(() => {
    voz = new VozFalsa();
    TestBed.configureTestingModule({
      providers: [BriefingPlayerService, { provide: VozService, useValue: voz }],
    });
    player = TestBed.inject(BriefingPlayerService);
    player.pausaDeEntradaMs = 0;
  });

  it('fala um bloco por vez, na ordem, e termina com tudo na fileira', async () => {
    await player.tocar(briefingDe([CLIMA, LEMBRETES]));

    expect(voz.falados).toEqual([
      expect.stringContaining('Bom dia, Anderson!'),
      CLIMA.conteudo,
      LEMBRETES.conteudo,
    ]);
    expect(player.fase()).toBe('concluido');
    expect(player.indiceAtual()).toBe(3);
  });

  it('pede o áudio da seção seguinte enquanto a atual toca', async () => {
    voz.manual = true;

    void player.tocar(briefingDe([CLIMA, LEMBRETES]));
    await respirar();

    // Falando a abertura, o áudio do clima já foi encomendado: é isso que tira o silêncio
    // entre uma seção e a outra.
    expect(voz.falados).toHaveLength(1);
    expect(voz.preparados).toContain(CLIMA.conteudo);
    expect(voz.preparados).not.toContain(LEMBRETES.conteudo);

    voz.terminarFala();
    await respirar();

    expect(voz.falados.at(-1)).toBe(CLIMA.conteudo);
    expect(voz.preparados).toContain(LEMBRETES.conteudo);

    voz.terminarFala();
    await respirar();
    voz.terminarFala();
    await respirar();
  });

  it('ignora o mesmo briefing chegando duas vezes enquanto toca (SSE e resposta do POST)', async () => {
    voz.manual = true;
    const briefing = briefingDe([CLIMA]);

    void player.tocar(briefing);
    await respirar();
    expect(player.fase()).toBe('tocando');
    const faladosAteAgora = voz.falados.length;

    await player.tocar(briefing);

    expect(voz.falados).toHaveLength(faladosAteAgora);
  });

  it('aceita o mesmo briefing depois do fim: clicar "Bom dia" de novo tem de tocar', async () => {
    const briefing = briefingDe([CLIMA]);
    await player.tocar(briefing);
    const primeiraVez = voz.falados.length;

    await player.tocar(briefing);

    expect(voz.falados.length).toBe(primeiraVez * 2);
  });

  it('briefing novo no meio da fila corta a fala e recomeça', async () => {
    voz.manual = true;
    void player.tocar(briefingDe([CLIMA, LEMBRETES]));
    await respirar();

    voz.manual = false;
    await player.tocar(briefingDe([CLIMA], '2026-10-13T09:00:00-03:00'));

    expect(voz.paradas).toBeGreaterThan(0);
    expect(player.fase()).toBe('concluido');
    // Só os blocos do briefing novo: abertura + clima.
    expect(player.blocos()).toHaveLength(2);
  });

  it('a abertura segue o horário do briefing, não o do navegador', () => {
    const abertura = blocosDe(briefingDe([CLIMA], '2026-10-13T20:00:00-03:00'))[0]!;

    expect(abertura.tipo).toBe('abertura');
    expect(abertura.fala).toBe('Boa noite, Anderson!');
    // O que a HUD desenha é o mesmo texto que vai para a síntese.
    expect(abertura.tipo === 'abertura' && abertura.linhas).toEqual(['Boa noite, Anderson!']);
  });

  it('consultar() abre um card já falado, para a fala e marca o selecionado', async () => {
    voz.manual = true;
    void player.tocar(briefingDe([CLIMA, LEMBRETES]));
    await respirar();
    const clima = player.blocos().find((b) => b.tipo === 'clima')!;

    player.consultar(clima);

    expect(player.selecionado()).toBe(clima);
    expect(player.fase()).toBe('concluido');
    expect(voz.paradas).toBeGreaterThan(0);
  });

  it('consultar() no card já aberto fecha: o palco esvazia e o orbe volta ao centro', () => {
    player.mostrar(briefingDe([CLIMA]));
    const clima = player.blocos().find((b) => b.tipo === 'clima')!;

    player.consultar(clima);
    player.consultar(clima);

    expect(player.selecionado()).toBeNull();
  });

  it('fecharConsulta() tira o card do palco sem mexer na fase', () => {
    player.mostrar(briefingDe([CLIMA]));
    player.consultar(player.blocos()[1]!);

    player.fecharConsulta();

    expect(player.selecionado()).toBeNull();
    expect(player.fase()).toBe('concluido');
  });

  it('consultar() ignora bloco que não é deste briefing', () => {
    player.mostrar(briefingDe([CLIMA]));
    const intruso = blocosDe(briefingDe([LEMBRETES]))[1]!;

    player.consultar(intruso);

    expect(player.selecionado()).toBeNull();
  });

  it('um briefing novo limpa a consulta aberta', async () => {
    player.mostrar(briefingDe([CLIMA]));
    player.consultar(player.blocos()[1]!);

    player.gerando();

    expect(player.selecionado()).toBeNull();
    expect(player.restaurado()).toBe(false);
  });

  it('restaurado só é verdade no briefing pintado pelo /ultimo', async () => {
    player.mostrar(briefingDe([CLIMA]));
    expect(player.restaurado()).toBe(true);

    await player.tocar(briefingDe([CLIMA], '2026-10-13T09:00:00-03:00'));

    expect(player.restaurado()).toBe(false);
  });

  it('gerando() limpa a tela e acende a legenda do radar', () => {
    player.gerando();

    expect(player.fase()).toBe('gerando');
    expect(player.blocos()).toEqual([]);
    expect(player.legenda()).toBe('Atualizando o radar de notícias...');
  });

  it('mostrar() pinta o briefing sem falar nada: é o /ultimo ao abrir a tela', () => {
    player.mostrar(briefingDe([CLIMA, LEMBRETES]));

    expect(voz.falados).toEqual([]);
    expect(player.fase()).toBe('concluido');
    expect(player.indiceAtual()).toBe(player.blocos().length);
  });

  it('mostrar() não atropela uma reprodução em andamento', async () => {
    voz.manual = true;
    void player.tocar(briefingDe([CLIMA]));
    await respirar();

    player.mostrar(briefingDe([LEMBRETES], '2026-10-13T07:00:00-03:00'));

    expect(player.fase()).toBe('tocando');
  });

  it('parar() encerra a fila onde está e manda tudo para a fileira', async () => {
    voz.manual = true;
    void player.tocar(briefingDe([CLIMA, LEMBRETES]));
    await respirar();

    player.parar();
    await respirar();

    expect(player.fase()).toBe('concluido');
    expect(player.indiceAtual()).toBe(player.blocos().length);
  });

  it('pular() corta a fala do bloco atual e segue para o próximo', async () => {
    voz.manual = true;
    void player.tocar(briefingDe([CLIMA, LEMBRETES]));
    await respirar();
    const noPrimeiro = voz.falados.length;

    player.pular();
    await respirar();

    expect(voz.falados.length).toBeGreaterThan(noPrimeiro);
  });

  it('chama o epílogo depois do último bloco, e só então conclui a fase', async () => {
    const quandoChamou: string[] = [];
    player.epilogo = async () => {
      quandoChamou.push(player.fase());
    };

    await player.tocar(briefingDe([CLIMA, LEMBRETES]));

    // A fase ainda é "tocando" durante o epílogo: é o que mantém a guarda de reentrância de pé.
    expect(quandoChamou).toEqual(['tocando']);
    expect(player.fase()).toBe('concluido');
  });

  it('epílogo que estoura não deixa a fase presa em "tocando"', async () => {
    player.epilogo = () => Promise.reject(new Error('microfone sumiu'));

    await player.tocar(briefingDe([CLIMA]));

    expect(player.fase()).toBe('concluido');
  });

  it('briefing novo no meio do epílogo cancela a conclusão do antigo', async () => {
    let soltarEpilogo: () => void = () => {};
    player.epilogo = () => new Promise<void>((resolver) => (soltarEpilogo = resolver));

    const antigo = player.tocar(briefingDe([CLIMA], '2026-10-13T08:00:00-03:00'));
    await respirar();

    void player.tocar(briefingDe([LEMBRETES], '2026-10-13T09:00:00-03:00'));
    soltarEpilogo?.();
    await antigo;

    expect(player.blocos().map((b) => b.tipo)).toEqual(['abertura', 'lembretes']);
  });
});
