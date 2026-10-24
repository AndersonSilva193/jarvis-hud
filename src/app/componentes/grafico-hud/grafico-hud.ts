import { Component, computed, input, signal } from '@angular/core';

import type { Grafico } from '../../nucleo/tela.modelos';
import { AREA, comUnidade, desenhar, numero, type PontoGrafico, ROSCA } from './grafico-hud.modelo';

/** Quantas cores de série existem antes de repetir. São seis porque a rosca vai até seis fatias. */
const CORES = 6;

/**
 * O gráfico do card de pesquisa, em SVG próprio.
 *
 * O `viewBox` é fixo e o CSS fixa a mesma proporção na caixa, então o desenho acompanha a largura
 * da janela sem distorcer e a dica pode se posicionar em porcentagem das coordenadas do `viewBox`.
 *
 * O SVG é um `role="img"` com o título do card por rótulo: para leitor de tela o que vale é a
 * tabela ao lado, visualmente oculta, com todos os valores. As áreas de toque são só para o mouse
 * e o dedo, e por isso ficam `aria-hidden`.
 */
@Component({
  selector: 'app-grafico-hud',
  template: `
    @let d = desenho();
    @let g = grafico();
    <div class="area">
      <svg
        [attr.viewBox]="'0 0 ' + area.largura + ' ' + area.altura"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        [attr.aria-label]="titulo()"
        (pointerleave)="ativo.set(null)"
      >
        @if (!d.rosca) {
          <g class="grade" aria-hidden="true">
            @for (marca of d.escala.marcas; track marca.valor) {
              <line [attr.x1]="d.eixo.esquerda" [attr.x2]="d.eixo.direita" [attr.y1]="marca.y" [attr.y2]="marca.y" />
              <text class="marca-y" [attr.x]="d.eixo.esquerda - 10" [attr.y]="marca.y + 3.5">{{ marca.rotulo }}</text>
            }
            <line class="eixo" [attr.x1]="d.eixo.esquerda" [attr.x2]="d.eixo.direita" [attr.y1]="d.eixo.base" [attr.y2]="d.eixo.base" />
            @for (rotulo of d.rotulosX; track rotulo.indice) {
              <text class="marca-x" [attr.x]="rotulo.x" [attr.y]="d.eixo.base + 18">{{ rotulo.texto }}</text>
            }
          </g>
        }

        @for (caminho of d.caminhos; track caminho.serie) {
          <path
            [class]="'linha ' + cor(caminho.serie)"
            [attr.d]="caminho.d"
            pathLength="1"
            [style.--atraso]="caminho.serie * 120 + 'ms'"
            aria-hidden="true"
          />
        }

        @for (barra of d.barras; track barra.serie + ':' + barra.indice) {
          <rect
            [class]="'barra ' + cor(barra.serie) + (barra.destacado ? ' destacada' : '') + (aceso(barra) ? ' acesa' : '')"
            [attr.x]="barra.esquerda"
            [attr.y]="barra.topo"
            [attr.width]="barra.largura"
            [attr.height]="barra.altura"
            [style.--atraso]="barra.indice * 60 + 'ms'"
            aria-hidden="true"
            (pointerenter)="mostrar(barra)"
            (pointerdown)="mostrar(barra)"
          />
        }

        @for (fatia of d.fatias; track fatia.indice; let f = $index) {
          <path
            [class]="'fatia ' + cor(f) + (fatia.destacado ? ' destacada' : '') + (aceso(fatia) ? ' acesa' : '')"
            [attr.d]="fatia.d"
            [style.--atraso]="f * 70 + 'ms'"
            aria-hidden="true"
            (pointerenter)="mostrar(fatia)"
            (pointerdown)="mostrar(fatia)"
          />
        }

        @if (d.total; as total) {
          <text class="total-valor" [attr.x]="anel.centro.x" [attr.y]="anel.centro.y - 2" aria-hidden="true">{{ total }}</text>
          <text class="total-rotulo" [attr.x]="anel.centro.x" [attr.y]="anel.centro.y + 18" aria-hidden="true">total</text>
        }

        @for (ponto of d.pontos; track ponto.serie + ':' + ponto.indice) {
          <circle
            [class]="'ponto ' + cor(ponto.serie) + (ponto.destacado ? ' destacado' : '') + (aceso(ponto) ? ' aceso' : '')"
            [attr.cx]="ponto.x"
            [attr.cy]="ponto.y"
            r="3.5"
            aria-hidden="true"
          />
          <circle
            class="alvo"
            [attr.cx]="ponto.x"
            [attr.cy]="ponto.y"
            r="12"
            aria-hidden="true"
            (pointerenter)="mostrar(ponto)"
            (pointerdown)="mostrar(ponto)"
          />
        }

        @for (valor of d.valoresEscritos; track valor.serie + ':' + valor.indice) {
          <text
            [class]="'valor ' + cor(valor.serie) + (valor.destacado ? ' destacado' : '')"
            [attr.x]="valor.x + (d.colunas ? 0 : 9)"
            [attr.y]="valor.y - (d.colunas ? 7 : 0)"
            [attr.dy]="d.colunas ? 0 : 4"
            [attr.text-anchor]="d.colunas ? 'middle' : 'start'"
            aria-hidden="true"
          >{{ valor.texto }}</text>
        }
      </svg>

      @if (dica(); as atual) {
        <p class="dica" role="presentation" [style.left.%]="atual.esquerda" [style.top.%]="atual.topo">
          <span class="dica-rotulo">{{ atual.rotulo }}</span>
          @if (atual.serie) { <span class="dica-serie">{{ atual.serie }}</span> }
          <strong>{{ atual.valor }}</strong>
        </p>
      }
    </div>

    @if (d.legenda.length) {
      <ul class="legenda">
        @for (item of d.legenda; track item.serie) {
          <li [class]="cor(item.serie)"><i aria-hidden="true"></i>{{ item.nome }}</li>
        }
      </ul>
    }

    <table class="oculto">
      <caption>{{ titulo() }}</caption>
      <thead>
        <tr>
          <th scope="col">Rótulo</th>
          @for (serie of g.series; track $index) {
            <th scope="col">{{ serie.nome }}{{ g.unidade ? ' (' + g.unidade + ')' : '' }}</th>
          }
          @if (d.tipo === 'barras_empilhadas') {
            <th scope="col">Total{{ g.unidade ? ' (' + g.unidade + ')' : '' }}</th>
          }
        </tr>
      </thead>
      <tbody>
        @for (rotulo of g.eixoX; track $index; let i = $index) {
          <tr>
            <th scope="row">{{ rotulo }}</th>
            @for (serie of g.series; track $index) {
              <td>{{ texto(serie.valores[i]) }}</td>
            }
            @if (d.tipo === 'barras_empilhadas') {
              <td>{{ texto(d.totais[i]) }}</td>
            }
          </tr>
        }
      </tbody>
      @if (d.rosca) {
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{{ texto(soma()) }}</td>
          </tr>
        </tfoot>
      }
    </table>
  `,
  styleUrl: './grafico-hud.scss',
})
export class GraficoHudComponent {
  readonly grafico = input.required<Grafico>();
  /** O título do card: é ele que descreve o gráfico para quem usa leitor de tela. */
  readonly titulo = input.required<string>();

  protected readonly area = AREA;
  protected readonly anel = ROSCA;
  protected readonly desenho = computed(() => desenhar(this.grafico()));
  protected readonly ativo = signal<{ serie: number; indice: number } | null>(null);

  /** A soma de tudo: o pé da tabela da rosca, par textual do número no centro do anel. */
  protected readonly soma = computed(() => this.desenho().totais.reduce((a, b) => a + b, 0));

  protected readonly dica = computed(() => {
    const ativo = this.ativo();
    if (!ativo) return null;
    const g = this.grafico();
    const marca = this.desenho().marcas.find(m => m.serie === ativo.serie && m.indice === ativo.indice);
    if (!marca) return null;
    return {
      // A fatia agregada da rosca não é um índice do eixo X, então traz o rótulo consigo.
      rotulo: marca.rotulo ?? g.eixoX[marca.indice] ?? '',
      serie: this.segundaLinha(marca),
      valor: comUnidade(marca.valor, g.unidade),
      // Presa à borda para a caixa não vazar do card nos pontos das pontas.
      esquerda: Math.min(92, Math.max(8, (marca.x / AREA.largura) * 100)),
      topo: (marca.y / AREA.altura) * 100,
    };
  });

  protected cor(serie: number): string {
    return `serie--${serie % CORES}`;
  }

  protected aceso(marca: PontoGrafico): boolean {
    const ativo = this.ativo();
    return ativo?.serie === marca.serie && ativo?.indice === marca.indice;
  }

  protected mostrar(marca: PontoGrafico): void {
    this.ativo.set({ serie: marca.serie, indice: marca.indice });
  }

  protected texto(valor: number | undefined): string {
    return valor === undefined ? '—' : numero(valor);
  }

  /** O nome da série; na rosca, a participação da fatia no total, que é o que falta ali. */
  private segundaLinha(marca: PontoGrafico): string {
    const g = this.grafico();
    const fatia = this.desenho().fatias.find(f => f.indice === marca.indice);
    if (fatia) {
      const partes: string[] = [];
      // Com a unidade já em %, a participação seria o mesmo número escrito duas vezes.
      if (g.unidade !== '%') partes.push(`${numero(Math.round(fatia.fracao * 1000) / 10)}% do total`);
      if (fatia.agregadas > 1) partes.push(`${fatia.agregadas} categorias`);
      return partes.join(' · ');
    }
    // Com uma série só o nome dela não acrescenta nada ao que o título já disse.
    return g.series.length > 1 ? (g.series[marca.serie]?.nome ?? '') : '';
  }
}
