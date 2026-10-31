import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { JanelasService } from './janelas.service';
import { MidiaService } from './midia.service';
import { ConversaService } from './conversa.service';
import { BriefingPlayerService } from './briefing-player.service';
import { VozService } from './voz.service';
import { PainelHudService } from './painel-hud.service';
import { reconhecerComandoRapido, normalizarComando } from './comandos-rapidos';
import type { Bloco } from './briefing.modelos';
import type { CardTela, ComandoTela, EstadoTela, Janela } from './tela.modelos';

@Service()
export class TelaService {
  readonly janelas = inject(JanelasService);
  readonly midia = inject(MidiaService);
  private readonly conversa = inject(ConversaService);
  private readonly player = inject(BriefingPlayerService);
  private readonly voz = inject(VozService);
  private readonly painel = inject(PainelHudService);
  readonly historicoAberto = computed(() => this.painel.ativo() === 'conversa');
  readonly ativa = signal(false);
  mostrarBriefing: (() => void) | null = null;
  private readonly consultas = new Map<Bloco, string>();
  private readonly respostas = new Map<string, string>();
  private readonly recebidos = new Set<string>();
  private transitoria: string | null = null;
  private respostaAnterior: string | null = null;
  readonly estado = computed<EstadoTela>(() => ({
    janelas: [...this.janelas.janelas()].sort((a,b) => Number(b.id === this.janelas.foco()) - Number(a.id === this.janelas.foco()) || Number(this.midia.tocando(b.id)) - Number(this.midia.tocando(a.id)) || b.z - a.z).map(j => ({
      id: j.id, tipo: j.tipo, titulo: j.titulo.slice(0,160), estado: j.estado === 'minimizada' ? 'minimizado' : j.estado === 'maximizada' ? 'maximizado' : 'normal', fixado: j.fixada, emFoco: j.id === this.janelas.foco(), tocando: this.midia.tocando(j.id),
    })),
    historicoAberto: this.historicoAberto(),
    briefingNaTela: this.janelas.visiveis().some(j => j.tipo === 'briefing'),
  }));
  constructor() {
    this.janelas.aoFechar = j => this.fechada(j);
    effect(() => {
      if (!this.ativa()) return;
      const resposta = this.conversa.cartao();
      untracked(() => {
        if (this.respostaAnterior && this.respostaAnterior !== resposta?.id) this.janelas.retirar(this.respostas.get(this.respostaAnterior) ?? '');
        this.respostaAnterior = resposta?.id ?? null;
        if (resposta && !this.respostas.has(resposta.id)) this.respostas.set(resposta.id, this.janelas.abrir({ tipo: 'resposta', dados: resposta }, { titulo: 'Resposta do Jarvis', origem: 'hud', selo: 'RESPOSTA' }));
      });
    });
    effect(() => {
      if (!this.ativa()) return;
      const bloco = this.player.atual();
      untracked(() => {
        if (this.transitoria && this.janelas.obter(this.transitoria)?.conteudo.dados !== bloco) { this.janelas.retirar(this.transitoria); this.transitoria = null; }
        if (bloco && !this.transitoria) this.transitoria = this.janelas.abrir({ tipo: 'briefing', dados: bloco }, { titulo: bloco.rotulo, origem: 'briefing', selo: 'BRIEFING' });
      });
    });
    effect(() => {
      const ativo = this.midia.ativo();
      const janelas = this.janelas.janelas();
      untracked(() => {
        if (ativo && janelas.some(j => j.id === ativo && j.estado === 'minimizada')) this.midia.bandeja.set(ativo);
        else if (!janelas.some(j => j.id === this.midia.bandeja() && j.estado === 'minimizada')) this.midia.bandeja.set([...janelas].reverse().find(j => j.estado === 'minimizada' && (j.tipo === 'video' || j.tipo === 'musica'))?.id ?? null);
      });
    });
  }
  receber(card: CardTela): void {
    if (this.recebidos.has(card.id)) return;
    this.recebidos.add(card.id);
    this.janelas.abrir(card, { id: card.id, titulo: card.titulo, origem: card.origem });
    if ((card.tipo === 'video' || card.tipo === 'musica') && this.janelas.obter(card.id)?.estado === 'minimizada') this.midia.mostrarBandeja(card.id);
  }
  consultada(bloco: Bloco): boolean { return this.janelas.janelas().some(j => j.id === this.consultas.get(bloco)); }
  consultar(bloco: Bloco): void {
    const id = this.consultas.get(bloco);
    if (id && this.janelas.obter(id)) { this.janelas.fechar(id); return; }
    this.player.parar(); this.player.selecionado.set(bloco);
    this.consultas.set(bloco, this.janelas.abrir({ tipo: 'briefing', dados: bloco }, { titulo: bloco.rotulo, origem: 'briefing', selo: 'CONSULTA' }));
  }
  executar(comando: ComandoTela): boolean {
    const { acao, alvo, valor } = comando;
    if (alvo && !this.janelas.obter(alvo)) return false;
    switch (acao) {
      case 'limpar': this.player.fecharConsulta(); this.player.parar(); this.painel.fechar(); this.janelas.limpar(); return true;
      case 'fechar_tudo': this.player.fecharConsulta(); this.player.parar(); this.janelas.fecharTudo(); return true;
      case 'abrir_historico': this.painel.abrir('conversa'); return true;
      case 'fechar_historico': if (this.historicoAberto()) this.painel.fechar(); return true;
      case 'mostrar_briefing': this.mostrarBriefing?.(); return true;
      case 'repetir_briefing': {
        const briefing = this.player.briefing();
        if (!briefing || this.conversa.ocupada()) return false;
        this.conversa.mostrarBriefing(); void this.player.tocar(briefing); return true;
      }
      case 'abrir_noticia': {
        if (!valor.trim()) return false;
        const noticias = this.player.blocos().filter(b => b.tipo === 'noticia');
        const termo = normalizarComando(valor);
        const bloco = noticias.find(b => normalizarComando(b.dados.titulo).includes(termo)) ?? noticias.find(b => normalizarComando(b.dados.tema).includes(termo));
        if (!bloco) return false;
        this.janelas.abrir({ tipo: 'noticia', dados: bloco.dados }, { titulo: bloco.dados.titulo, origem: 'briefing' }); return true;
      }
    }
    if (!alvo) return false;
    switch (acao) {
      case 'fechar': this.janelas.fechar(alvo); break;
      case 'minimizar': this.janelas.minimizar(alvo); break;
      case 'maximizar': this.janelas.maximizar(alvo); break;
      case 'restaurar': this.janelas.restaurar(alvo); break;
      case 'focar': this.janelas.focar(alvo); break;
      case 'fixar': this.janelas.fixar(alvo); break;
      case 'desafixar': this.janelas.fixar(alvo, false); break;
      default:
        if (acao === 'continuar' && this.janelas.obter(alvo)?.estado === 'minimizada') this.midia.mostrarBandeja(alvo);
        return this.midia.executar(alvo, acao, valor);
    }
    return true;
  }
  rapido(texto: string): boolean {
    const comando = reconhecerComandoRapido(texto);
    if (!comando) return false;
    let alvo = '';
    if (comando.tipo) {
      const candidatas = this.janelas.janelas().filter(j => j.tipo === comando.tipo);
      if (candidatas.length !== 1) return false;
      alvo = candidatas[0]!.id;
    } else if (['pausar', 'continuar', 'volume_mais', 'volume_menos'].includes(comando.acao)) {
      const candidatas = this.janelas.janelas().filter(j => j.tipo === 'video' || j.tipo === 'musica');
      const focada = candidatas.find(j => j.id === this.janelas.foco());
      if (!focada && candidatas.length !== 1) return false;
      alvo = (focada ?? candidatas[0])!.id;
    }
    if (!this.executar({ acao: comando.acao, alvo, valor: '' })) return false;
    void this.voz.falar(comando.fala); return true;
  }
  encerrar(): void { this.ativa.set(false); this.janelas.fecharTudo(); this.mostrarBriefing = null; this.painel.fechar(); this.consultas.clear(); this.respostas.clear(); this.respostaAnterior = null; this.transitoria = null; }
  private fechada(j: Janela): void {
    if (j.tipo === 'resposta' && j.conteudo.tipo === 'resposta' && this.conversa.resposta()?.id === j.conteudo.dados.id) this.conversa.dispensar();
    if (j.id === this.transitoria) { this.transitoria = null; this.player.parar(); }
    if (j.conteudo.tipo === 'briefing' && this.player.selecionado() === j.conteudo.dados) this.player.fecharConsulta();
    this.midia.executar(j.id, 'pausar');
  }
}
