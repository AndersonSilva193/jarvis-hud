import { Component, input, output } from '@angular/core';
import { IconeHudComponent } from '../icone-hud/icone-hud';
import type { IconeHud } from '../icone-hud/icone-hud';
import {
  etapaValida,
  type AtividadeHud,
  type ExecucaoHud,
} from '../../nucleo/atividade-hud.service';
import type { ProgressoConversa } from '../../nucleo/conversa.modelos';
import type { TarefaComputer } from '../../nucleo/jarvis-api.service';

@Component({
  selector: 'app-atividades-hud',
  imports: [IconeHudComponent],
  template: `
    <section class="painel" aria-label="Atividades em tempo real">
      <header>
        <app-icone-hud nome="atividade" />
        <h2>Atividade recente</h2>
        <span class="micro">AO VIVO</span>
        @if (expandivel()) {
          <button
            class="expandir-atividade"
            type="button"
            aria-label="Ver execuções"
            (click)="expandir.emit()"
          >
            <app-icone-hud nome="seta" />
          </button>
        }
      </header>
      @if (!itens().length) {
        <div class="vazio">
          <span class="ponto"></span>
          <p>
            Aguardando seu próximo comando.<small
              >As atividades aparecem aqui conforme acontecem.</small
            >
          </p>
        </div>
      }
      <ol class="atividades">
        @for (item of itens().slice(0, limite()); track item.chave) {
          <li [class.falhou]="item.tipo === 'erro'">
            <span class="ponto"></span><span>{{ item.texto }}</span
            ><time>{{ item.hora }}</time>
          </li>
        }
      </ol>
    </section>
  `,
  styleUrls: ['./paineis-agente.scss', './paineis-vidro.scss'],
})
export class AtividadesHudComponent {
  readonly expandivel = input(false);
  readonly expandir = output<void>();
  readonly itens = input<AtividadeHud[]>([]);
  readonly limite = input(5);
}

@Component({
  selector: 'app-execucoes-hud',
  imports: [IconeHudComponent],
  template: `
    <section class="painel" aria-label="Execuções do Jarvis">
      <header>
        <app-icone-hud nome="execucoes" />
        <h2>Execuções</h2>
        <span class="micro">{{ itens().length }}</span>
      </header>
      @if (computer(); as tarefa) {
        <div class="controles-pc">
          <h3>Última tarefa no PC</h3>
          <p>{{ tarefa.estado }} · {{ tarefa.ciclos }} ciclos · {{ tarefa.acoes }} ações</p>
          @if (tarefa.motivo) {
            <small>{{ tarefa.motivo }}</small>
          }
        </div>
      }
      @if (!itens().length) {
        <p class="vazio">
          Nenhuma execução registrada.<small
            >Os pedidos atuais e o histórico recuperado aparecerão aqui.</small
          >
        </p>
      }
      <ol class="execucoes">
        @for (item of itens(); track item.id) {
          <li>
            <div class="linha">
              <strong>{{ item.titulo }}</strong
              ><span class="selo" [class.erro]="item.estado === 'erro'">{{
                rotulos[item.estado]
              }}</span>
            </div>
            <small
              >{{ item.canal === 'hud' ? 'HUD' : item.canal }} ·
              {{ item.restaurada ? 'Histórico recuperado' : 'Acompanhado nesta sessão' }}</small
            >
            @if (item.ferramenta; as ferramenta) {
              <p>{{ ferramenta.descricao || ferramenta.nome }}</p>
              <small>Ferramenta observada · {{ ferramenta.nome }}</small>
              @if (item.estado === 'processando' && etapaValida(ferramenta)) {
                <progress
                  [value]="ferramenta.passo"
                  [max]="ferramenta.total"
                  aria-label="Progresso informado pela ferramenta"
                ></progress
                ><small>Etapa {{ ferramenta.passo }} de {{ ferramenta.total }}</small>
              }
            }
          </li>
        }
      </ol>
      <p class="nota">
        O resultado do pedido não confirma o sucesso individual de cada ferramenta.
      </p>
    </section>
  `,
  styleUrls: ['./paineis-agente.scss', './paineis-vidro.scss'],
})
export class ExecucoesHudComponent {
  readonly itens = input<ExecucaoHud[]>([]);
  readonly computer = input<TarefaComputer | null>(null);
  protected readonly etapaValida = etapaValida;
  protected readonly rotulos = {
    processando: 'Em andamento',
    concluido: 'Respondido',
    erro: 'Erro',
    interrompido: 'Interrompido',
  };
}

@Component({
  selector: 'app-memoria-hud',
  host: { '[class.compacta]': 'compacta()' },
  imports: [IconeHudComponent],
  template: `
    <section class="painel memoria" aria-label="Memória do Jarvis">
      <header>
        <app-icone-hud nome="memoria" />
        <h2>Memória & contexto</h2>
        <span class="micro">CONTEXTO</span>
      </header>
      <div class="arquivo-visual" aria-hidden="true">
        <i></i><i></i><i></i><app-icone-hud nome="memoria" />
      </div>
      <div class="consultas-memoria">
        @for (consulta of consultas; track consulta.titulo) {
          <button type="button" (click)="preparar.emit(consulta.comando)">
            <app-icone-hud nome="documento" /><span
              ><strong>{{ consulta.titulo }}</strong
              ><small>Consultar pelo Jarvis</small></span
            ><span aria-hidden="true">···</span>
          </button>
        }
      </div>
      <button type="button" (click)="preparar.emit('Jarvis, o que você sabe sobre mim?')">
        <app-icone-hud nome="busca" />Consultar memória<app-icone-hud nome="seta" />
      </button>
      <p class="nota">Consultas por comando · os registros são recuperados pelo Jarvis.</p>
    </section>
  `,
  styleUrls: ['./paineis-agente.scss', './paineis-vidro.scss'],
})
export class MemoriaHudComponent {
  readonly preparar = output<string>();
  readonly compacta = input(false);
  protected readonly consultas = [
    { titulo: 'Contexto dos projetos', comando: 'Jarvis, quais projetos você tem na memória?' },
    {
      titulo: 'Preferências do usuário',
      comando: 'Jarvis, quais são as minhas preferências salvas?',
    },
    {
      titulo: 'Decisões e aprendizados',
      comando: 'Jarvis, quais decisões e aprendizados você guardou?',
    },
  ];
}

export const CAPACIDADES: readonly { nome: string; icone: IconeHud; comando: string }[] = [
  { nome: 'Pesquisa web', icone: 'busca', comando: 'Jarvis, pesquise na web sobre ' },
  {
    nome: 'Análise de dados',
    icone: 'grafico',
    comando: 'Jarvis, analise estes dados e apresente um gráfico na tela: ',
  },
  { nome: 'Documentos', icone: 'documento', comando: 'Jarvis, crie um documento sobre ' },
  { nome: 'Automação', icone: 'automacao', comando: 'Jarvis, me ajude a automatizar ' },
  { nome: 'Visualização 3D', icone: 'agente', comando: 'Jarvis, crie um holograma de ' },
  { nome: 'Memória', icone: 'memoria', comando: 'Jarvis, o que você guardou sobre o projeto ' },
  { nome: 'Navegação web', icone: 'globo', comando: 'Jarvis, abra a página ' },
  { nome: 'Lembretes', icone: 'execucoes', comando: 'Jarvis, crie um lembrete para ' },
];

@Component({
  selector: 'app-capacidades-hud',
  imports: [IconeHudComponent],
  template: `
    <section class="painel" aria-label="Atalhos de capacidades">
      <header>
        <app-icone-hud nome="automacao" />
        <h2>Capacidades</h2>
        <span class="micro">ATALHOS</span>
      </header>
      <div class="capacidades">
        @for (item of capacidades; track item.nome) {
          <button type="button" (click)="preparar.emit(item.comando)">
            <app-icone-hud [nome]="item.icone" /><span>{{ item.nome }}</span>
          </button>
        }
      </div>
      <p class="nota">Escolha um atalho e complete o comando antes de executar.</p>
    </section>
  `,
  styleUrls: ['./paineis-agente.scss', './paineis-vidro.scss'],
})
export class CapacidadesHudComponent {
  readonly preparar = output<string>();
  protected readonly capacidades = CAPACIDADES;
}

@Component({
  selector: 'app-agente-hud',
  imports: [IconeHudComponent],
  template: `
    <section class="painel" aria-label="Agente e ferramentas">
      <header>
        <app-icone-hud nome="agente" />
        <h2>Agente e ferramentas</h2>
      </header>
      <div class="agente">
        <div class="avatar"><app-icone-hud nome="agente" /></div>
        <div>
          <h3>Jarvis</h3>
          <p>Agente orquestrador</p>
        </div>
        <span class="selo">AGENTE ÚNICO</span>
      </div>
      <div class="estado-agente">
        <span class="ponto"></span><span>{{ estado() }}</span>
      </div>
      <p class="subtitulo">
        {{ ferramentas().length ? 'FERRAMENTAS OBSERVADAS' : 'RECURSOS POR COMANDO'
        }}<span>{{ ferramentas().length || '' }}</span>
      </p>
      @if (!ferramentas().length) {
        <div class="recursos">
          @for (recurso of recursos; track recurso.nome) {
            <button type="button" (click)="preparar.emit(recurso.comando)">
              <span class="avatar-recurso"><app-icone-hud [nome]="recurso.icone" /></span
              ><span
                ><strong>{{ recurso.nome }}</strong
                ><small>{{ recurso.detalhe }}</small></span
              ><app-icone-hud nome="seta" />
            </button>
          }
        </div>
      }
      <ul class="ferramentas">
        @for (f of ferramentas(); track f.nome) {
          <li [class.ativa]="ativa() === f.nome">
            <app-icone-hud nome="automacao" />
            <div>
              <strong>{{ f.nome.replaceAll('_', ' ') }}</strong
              ><small>{{ f.descricao }}</small>
            </div>
            <span class="selo">{{ ativa() === f.nome ? 'EM USO' : 'OBSERVADA' }}</span>
          </li>
        }
      </ul>
    </section>
  `,
  styleUrls: ['./paineis-agente.scss', './paineis-vidro.scss'],
})
export class AgenteHudComponent {
  readonly estado = input('Às suas ordens');
  readonly ferramentas = input<ProgressoConversa[]>([]);
  readonly ativa = input('');
  readonly preparar = output<string>();
  protected readonly recursos: readonly {
    nome: string;
    detalhe: string;
    icone: IconeHud;
    comando: string;
  }[] = [
    {
      nome: 'Pesquisa e análise',
      detalhe: 'Fontes, dados e informações',
      icone: 'busca',
      comando: 'Jarvis, pesquise e analise ',
    },
    {
      nome: 'Criação e visualização',
      detalhe: 'Documentos, gráficos e hologramas',
      icone: 'grafico',
      comando: 'Jarvis, crie e mostre na tela ',
    },
    {
      nome: 'Computador e automação',
      detalhe: 'Ações, ferramentas e integrações',
      icone: 'automacao',
      comando: 'Jarvis, me ajude a automatizar ',
    },
    {
      nome: 'Memória e contexto',
      detalhe: 'Preferências e continuidade',
      icone: 'memoria',
      comando: 'Jarvis, o que você sabe sobre mim?',
    },
  ];
}
