import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HudPage } from './hud.page';
import { OrbeComponent } from '../../componentes/orbe/orbe';
import { BriefingPlayerService } from '../../nucleo/briefing-player.service';
import { JarvisApiService } from '../../nucleo/jarvis-api.service';
import { InicializacaoService } from '../../nucleo/inicializacao.service';
import { JarvisEventosService } from '../../nucleo/jarvis-eventos.service';
import { ConversaService } from '../../nucleo/conversa.service';
import type { Briefing } from '../../nucleo/briefing.modelos';
import type { RespostaConversa } from '../../nucleo/conversa.modelos';
import { EscutaDeRespostaService } from '../../nucleo/escuta-de-resposta.service';
import { EscutaService } from '../../nucleo/escuta.service';

const BRIEFING: Briefing = {
  geradoEm: '2026-10-13T08:00:00-03:00',
  fusoHorario: 'America/Sao_Paulo',
  nomeUsuario: 'Anderson',
  secoes: [
    {
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
    },
  ],
  texto: '',
  geradoAgora: true,
};

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('o palco do HUD', () => {
  beforeEach(() => {
    // O jsdom não tem canvas; aqui o que se mede é o palco, não o desenho do orbe.
    vi.spyOn(OrbeComponent.prototype, 'ngAfterViewInit').mockImplementation(() => {});
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: JarvisApiService,
          useValue: {
            ultimoBriefing: async () => null,
            baixarAnexo: async () => new Blob(['x'], { type: 'image/png' }),
          },
        },
        {
          provide: JarvisEventosService,
          useValue: {
            conectar: vi.fn(),
            desconectar: vi.fn(),
            status: signal('online'),
            motivo: signal(null),
          },
        },
      ],
    });
  });

  it('briefing terminado: o último card sai do palco e deixa o orbe sozinho', () => {
    const player = TestBed.inject(BriefingPlayerService);
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();
    player.mostrar(BRIEFING);
    tela.detectChanges();

    // Nada por cima do orbe — nem card, nem o antigo painel de boas-vindas.
    expect(tela.nativeElement.querySelector('.card-principal')).toBeNull();
    expect(tela.nativeElement.querySelector('.boas-vindas')).toBeNull();
    expect(tela.nativeElement.querySelector('.orbe--livre')).not.toBeNull();

    // Os blocos falados viram miniaturas: abertura + clima.
    expect(tela.nativeElement.querySelectorAll('.fileira .miniatura')).toHaveLength(2);
    expect(tela.nativeElement.querySelector('.rotulo-arquivo').textContent).toContain(
      'Último briefing',
    );
  });

  it('consultar devolve o card ao palco; fechar devolve o orbe', () => {
    const player = TestBed.inject(BriefingPlayerService);
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();
    player.mostrar(BRIEFING);
    tela.detectChanges();
    const clima: HTMLButtonElement = tela.nativeElement.querySelectorAll('.miniatura')[1];

    clima.click();
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('.card-principal')).not.toBeNull();
    expect(tela.nativeElement.querySelector('.selo').textContent).toContain('CONSULTA');
    expect(clima.getAttribute('aria-pressed')).toBe('true');
    expect(tela.nativeElement.querySelector('.orbe--livre')).toBeNull();

    tela.nativeElement.querySelector('[aria-label="Fechar consulta"]').click();
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('.card-principal')).toBeNull();
    expect(tela.nativeElement.querySelector('.orbe--livre')).not.toBeNull();
  });

  it('clicar de novo na miniatura aberta fecha a consulta', () => {
    const player = TestBed.inject(BriefingPlayerService);
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();
    player.mostrar(BRIEFING);
    tela.detectChanges();
    const clima: HTMLButtonElement = tela.nativeElement.querySelectorAll('.miniatura')[1];

    clima.click();
    tela.detectChanges();
    clima.click();
    tela.detectChanges();

    expect(tela.nativeElement.querySelector('.card-principal')).toBeNull();
    expect(clima.getAttribute('aria-pressed')).toBe('false');
  });

  it('fala simples não vira card; o que se olha, sim', () => {
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();
    const conversa = TestBed.inject(ConversaService);
    const fala: RespostaConversa = {
      id: '1',
      canal: 'hud',
      texto: 'Tudo certo por aqui, senhor.',
      anexos: [],
      confirmacao: null,
      concluidoEm: '2026-10-14T10:00:00Z',
      erro: null,
    };

    // Texto puro: fica na voz e no histórico, e o centro continua sendo do orbe.
    conversa.receber(fala);
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('.card-principal')).toBeNull();
    expect(tela.nativeElement.querySelector('.orbe--livre')).not.toBeNull();

    conversa.receber({
      ...fala,
      id: '2',
      anexos: [
        {
          id: 'a',
          tipo: 'imagem',
          nome: 'Print',
          mime: 'image/png',
          url: '/api/anexos/a',
          expiraEm: null,
        },
      ],
    });
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('.card-principal')).not.toBeNull();

    tela.nativeElement.querySelector('[aria-label="Fechar resposta"]').click();
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('.card-principal')).toBeNull();
  });

  it('o diálogo só aparece com o chat aberto', () => {
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('app-dialogo-conversa')).toBeNull();

    tela.nativeElement.querySelector('.compacta button').click();
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('app-dialogo-conversa')).not.toBeNull();
    expect(TestBed.inject(ConversaService).chatAberto()).toBe(true);
  });

  it('sem briefing nenhum, a tela é só o orbe e a linha de estado', () => {
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();

    expect(tela.nativeElement.querySelector('.card-principal')).toBeNull();
    expect(tela.nativeElement.querySelector('.arquivo')).toBeNull();
    expect(tela.nativeElement.querySelector('.orbe--livre')).not.toBeNull();
    expect(tela.nativeElement.querySelector('.falando').textContent).toContain('Às suas ordens');
  });

  it('sem ?inicio=1 a abertura não toca: abrir a HUD à mão é tela normal', () => {
    const iniciar = vi.spyOn(TestBed.inject(InicializacaoService), 'iniciar');
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();

    expect(iniciar).not.toHaveBeenCalled();
    expect(tela.nativeElement.querySelector('app-inicializacao')).toBeNull();
  });

  it('mostra motivo e opções acessíveis; Esc, digitação e clique fora cancelam', () => {
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();
    const espera = TestBed.inject(EscutaDeRespostaService);
    espera.fase.set('opcoes');
    espera.motivo.set('confirmar o horário');
    espera.opcoes.set(['Agora', 'Mais tarde']);
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('.motivo-resposta').textContent).toContain('confirmar o horário');
    expect(tela.nativeElement.querySelector('[aria-label="Opções de resposta"] button').textContent).toContain('Agora');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(espera.fase()).toBe('inativa');
    espera.fase.set('opcoes');
    tela.nativeElement.querySelector('.compacta button').click();
    tela.detectChanges();
    espera.fase.set('opcoes');
    const campo: HTMLTextAreaElement = tela.nativeElement.querySelector('#mensagem-jarvis');
    campo.value = 'o';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    expect(espera.fase()).toBe('inativa');
    espera.fase.set('opcoes');
    tela.nativeElement.querySelector('.conteudo').click();
    expect(espera.fase()).toBe('inativa');
  });

  it('ditado automático não copia a transcrição para o rascunho', () => {
    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();
    const espera = TestBed.inject(EscutaDeRespostaService);
    const escuta = TestBed.inject(EscutaService);
    espera.fase.set('ouvindo');
    escuta.ditando.set(true);
    escuta.transcricao.set('amanhã às nove');
    tela.detectChanges();
    expect(tela.componentInstance['rascunho']()).toBe('');
    expect(tela.nativeElement.querySelector('.falando').textContent).toContain('Ouvindo sua resposta');
  });

  it('com ?inicio=1 a abertura cobre a tela e o orbe se forma', () => {
    // É a marca que o agente do PC põe na URL ao acordar o Jarvis por palmas ou por voz.
    history.replaceState(null, '', '/?inicio=1');
    const servico = TestBed.inject(InicializacaoService);
    const iniciar = vi.spyOn(servico, 'iniciar').mockImplementation(async () => {
      servico.fase.set('animando');
    });

    const tela = TestBed.createComponent(HudPage);
    tela.detectChanges();

    expect(iniciar).toHaveBeenCalledOnce();
    expect(tela.nativeElement.querySelector('app-inicializacao')).not.toBeNull();
    expect(tela.nativeElement.querySelector('.orbe--formando')).not.toBeNull();

    // Terminada a abertura, a sobreposição sai e a tela volta a ser a de sempre.
    servico.fase.set('pronta');
    tela.detectChanges();
    expect(tela.nativeElement.querySelector('app-inicializacao')).toBeNull();
    expect(tela.nativeElement.querySelector('.orbe--formando')).toBeNull();

    history.replaceState(null, '', '/');
  });
});
