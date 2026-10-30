import { acaoDaMensagem, type EventoDoControle } from '../../controle/controle.modelos';
import type { AlvoDoControle, ControlePorGestos } from './controle-por-gestos';

/**
 * Os gestos que vêm do celular, aplicados como os locais. O que é gesto passa pelo **mesmo**
 * `ControlePorGestos` da câmera do PC (mesma sensibilidade, mesmo `giroDaTela`, a inércia e os
 * limites da cena); o toque e a explosão relativa vão aos mesmos caminhos do `ControleDeToque`.
 * O One Euro já rodou no celular, dentro do `MotorDeGestos` — no PC é igual: o filtro é do motor.
 */
export class ControleRemoto {
  /** A última posição do indicador do celular: o `selecionar` aponta para ela. */
  private cursor: { x: number; y: number } | null = null;
  private tocando = false;

  constructor(
    private readonly alvo: AlvoDoControle,
    private readonly gestos: ControlePorGestos,
    private readonly explodirMais: (delta: number) => void,
  ) {}

  aplicar(mensagens: readonly EventoDoControle[]): void {
    for (const m of mensagens) {
      const acao = acaoDaMensagem(m);
      if (!acao) continue;
      switch (acao.tipo) {
        case 'gesto':
          if (acao.evento.tipo === 'cursor') this.cursor = { x: acao.evento.x, y: acao.evento.y };
          if (acao.evento.tipo === 'cursorFim') this.cursor = null;
          this.gestos.aplicar([acao.evento]);
          break;
        case 'selecionar':
          if (this.cursor) this.gestos.aplicar([{ tipo: 'apontarParado', ...this.cursor }]);
          break;
        case 'toque':
          this.tocando = acao.ativo;
          if (acao.ativo) this.alvo.comecarInteracao();
          else this.alvo.terminarInteracao();
          break;
        case 'explodirMais':
          this.explodirMais(acao.delta);
          break;
        case 'eco':
          break;
      }
    }
  }

  /** O celular saiu: desfaz o que ficou pela metade (cursor, rotação segurada, toque aberto). */
  soltar(): void {
    this.cursor = null;
    this.alvo.apontar(null);
    this.alvo.segurarAutoRotacao(false);
    if (this.tocando) this.alvo.terminarInteracao();
    this.tocando = false;
  }
}
