import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';

import {
  AjustesDeGestosService,
  SENSIBILIDADE_MAXIMA,
  SENSIBILIDADE_MINIMA,
  type AjustesDeGestos,
  type EscolhaDePerfil,
} from '../../nucleo/ajustes-de-gestos.service';
import { PerfilDoAparelhoService } from '../../nucleo/perfil-do-aparelho.service';
import { RastreioDeMaoService } from '../../nucleo/rastreio-de-mao.service';

const NOMES_DO_PERFIL = { pc: 'PC', leve: 'Leve (celular)' } as const;

/**
 * Os ajustes de gestos e toque, num `<dialog>` modal: o navegador cuida do foco preso e de
 * devolvê-lo ao botão que abriu. Tudo vale na hora e fica guardado neste navegador.
 */
@Component({
  selector: 'app-ajustes-gestos',
  template: `
    <dialog #dialogo class="dialogo" aria-labelledby="ajustes-gestos-titulo" (keydown.escape)="aoEsc($event)">
      <h2 id="ajustes-gestos-titulo" class="titulo">Ajustes de gestos</h2>

      <label class="campo">
        <span class="rotulo">Perfil do aparelho</span>
        <select class="entrada" (change)="aoEscolherPerfil($event)">
          <option value="auto" [selected]="ajustes().perfil === 'auto'">Automático ({{ nomeDetectado() }})</option>
          <option value="pc" [selected]="ajustes().perfil === 'pc'">PC — 2 mãos, cena completa</option>
          <option value="leve" [selected]="ajustes().perfil === 'leve'">Leve — 1 mão, cena econômica</option>
        </select>
      </label>

      <label class="campo">
        <span class="rotulo">Sensibilidade do giro</span>
        <span class="faixa">
          <input type="range" [min]="minimo" [max]="maximo" step="0.25" [value]="ajustes().sensibilidadeGiro"
                 [attr.aria-valuetext]="ajustes().sensibilidadeGiro + ' vezes'" (input)="aoMudarNumero('sensibilidadeGiro', $event)" />
          <output aria-hidden="true">{{ ajustes().sensibilidadeGiro }}×</output>
        </span>
      </label>

      <label class="campo">
        <span class="rotulo">Sensibilidade do zoom</span>
        <span class="faixa">
          <input type="range" [min]="minimo" [max]="maximo" step="0.25" [value]="ajustes().sensibilidadeZoom"
                 [attr.aria-valuetext]="ajustes().sensibilidadeZoom + ' vezes'" (input)="aoMudarNumero('sensibilidadeZoom', $event)" />
          <output aria-hidden="true">{{ ajustes().sensibilidadeZoom }}×</output>
        </span>
      </label>

      <label class="marcar"><input type="checkbox" [checked]="ajustes().inverterX" (change)="aoMarcar('inverterX', $event)" /> Inverter eixo horizontal</label>
      <label class="marcar"><input type="checkbox" [checked]="ajustes().inverterY" (change)="aoMarcar('inverterY', $event)" /> Inverter eixo vertical</label>
      <label class="marcar"><input type="checkbox" [checked]="ajustes().preview" (change)="aoMarcar('preview', $event)" /> Mostrar a câmera no canto</label>

      <section class="gravar" aria-labelledby="ajustes-gestos-gravar">
        <h3 id="ajustes-gestos-gravar" class="rotulo">Gravar landmarks</h3>
        <p class="nota">Salva 5 s dos pontos da mão em JSON, para os testes do motor. Só pontos, nunca a imagem.</p>
        <button class="botao" type="button" [disabled]="!podeGravar()" (click)="gravar()">
          {{ rastreio.gravando() ? 'Gravando…' : 'Gravar 5 s' }}
        </button>
        @if (!podeGravar() && !rastreio.gravando()) { <p class="nota">Ligue os gestos para gravar.</p> }
      </section>

      <p class="nota" role="status">{{ resumo() }}</p>

      <div class="acoes">
        <button class="botao" type="button" (click)="servico.restaurar()">Restaurar padrão</button>
        <button class="botao botao--fechar" type="button" (click)="fechar()">Fechar</button>
      </div>
    </dialog>
  `,
  styleUrl: './ajustes-gestos.scss',
})
export class AjustesGestosComponent {
  protected readonly servico = inject(AjustesDeGestosService);
  protected readonly rastreio = inject(RastreioDeMaoService);
  private readonly perfil = inject(PerfilDoAparelhoService);
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');

  protected readonly minimo = SENSIBILIDADE_MINIMA;
  protected readonly maximo = SENSIBILIDADE_MAXIMA;
  protected readonly ajustes = this.servico.ajustes;
  protected readonly nomeDetectado = computed(() => NOMES_DO_PERFIL[this.perfil.detectado()]);
  protected readonly podeGravar = computed(() => this.rastreio.status() === 'ligado' && !this.rastreio.gravando());
  private readonly arquivoSalvo = signal('');

  protected readonly resumo = computed(() => {
    const partes = [`Perfil em uso: ${NOMES_DO_PERFIL[this.perfil.perfil()]}`];
    const delegate = this.rastreio.delegate();
    if (delegate) partes.push(`detector na ${delegate}`);
    if (this.arquivoSalvo()) partes.push(`salvo ${this.arquivoSalvo()}`);
    return partes.join(' · ');
  });

  abrir(): void {
    this.dialogo().nativeElement.showModal();
  }

  protected fechar(): void {
    this.dialogo().nativeElement.close();
  }

  /** O Esc é do diálogo: sem isto, a HUD também fecharia o holograma inteiro. */
  protected aoEsc(evento: Event): void {
    evento.preventDefault();
    evento.stopPropagation();
    this.fechar();
  }

  protected aoEscolherPerfil(evento: Event): void {
    const valor = evento.target instanceof HTMLSelectElement ? evento.target.value : '';
    if (valor === 'auto' || valor === 'pc' || valor === 'leve') this.servico.alterar({ perfil: valor satisfies EscolhaDePerfil });
  }

  protected aoMudarNumero(campo: 'sensibilidadeGiro' | 'sensibilidadeZoom', evento: Event): void {
    if (evento.target instanceof HTMLInputElement) this.servico.alterar({ [campo]: Number(evento.target.value) });
  }

  protected aoMarcar(campo: keyof Pick<AjustesDeGestos, 'inverterX' | 'inverterY' | 'preview'>, evento: Event): void {
    if (evento.target instanceof HTMLInputElement) this.servico.alterar({ [campo]: evento.target.checked });
  }

  protected async gravar(): Promise<void> {
    const gravacao = await this.rastreio.gravar();
    if (!gravacao) return;
    const nome = `gestos-${gravacao.data.slice(0, 19).replace(/[T:]/g, '-')}.json`;
    // Um Blob local baixado pelo próprio navegador: o arquivo não passa por servidor nenhum.
    const url = URL.createObjectURL(new Blob([JSON.stringify(gravacao)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    this.arquivoSalvo.set(nome);
  }
}
