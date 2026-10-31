import { Component, DestroyRef, ElementRef, afterRenderEffect, inject, input, output, signal, viewChild } from '@angular/core';

@Component({
  selector: 'app-painel-hud',
  host: { '[class.aberto]': 'aberto()' },
  template: `
    <dialog #dialogo id="painel-hud" [attr.aria-label]="titulo()"
      (cancel)="cancelar($event)" (keydown)="teclar($event)">
      <div class="cabecalho-painel">
        <h2 id="painel-hud-titulo" #tituloEl tabindex="-1">{{ titulo() }}</h2>
        <button type="button" aria-label="Fechar painel" (click)="fechar.emit()">Fechar ×</button>
      </div>
      <div class="corpo"><ng-content /></div>
    </dialog>
  `,
  styles: `
    :host{display:none;min-width:0;min-height:0}
    :host.aberto{display:block}
    dialog{position:relative;inset:auto;box-sizing:border-box;margin:0;padding:0;width:100%;height:100%;max-width:none;max-height:none;color:#dff4ff;background:linear-gradient(160deg,#0a203e,#030c1a);border:1px solid #357486}
    dialog[open]{display:flex;flex-direction:column}
    .cabecalho-painel{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:1rem;border-bottom:1px solid #28596b;flex-shrink:0}
    h2{margin:0;font:600 .85rem monospace;letter-spacing:.16em;text-transform:uppercase;color:#a6f8ff}
    button{min-height:44px;padding:.5rem .7rem;border:1px solid #477e91;background:#0b243b;color:#dff4ff;font:500 .72rem monospace;cursor:pointer}
    :focus-visible{outline:2px solid #a6f8ff;outline-offset:-3px}
    .corpo{padding:1rem;overflow:auto;min-height:0;flex:1}
    dialog::backdrop{background:#020916b8}
    @media(max-width:1023px){dialog{position:fixed;inset:0 0 0 auto;width:min(380px,100%);height:100dvh}}
  `,
})
export class PainelHudComponent {
  readonly aberto = input(false);
  readonly titulo = input('Conversa');
  readonly fechar = output<void>();
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');
  private readonly tituloEl = viewChild.required<ElementRef<HTMLElement>>('tituloEl');
  private readonly modal = signal(false);
  private anterior: HTMLElement | null = null;
  private tituloAnterior = '';

  constructor() {
    const media = typeof matchMedia === 'function' ? matchMedia('(max-width: 1023px)') : null;
    this.modal.set(media?.matches ?? false);
    const medir = () => this.modal.set(media?.matches ?? false);
    media?.addEventListener('change', medir);
    inject(DestroyRef).onDestroy(() => media?.removeEventListener('change', medir));
    afterRenderEffect(() => {
      const dialogo = this.dialogo().nativeElement;
      const aberto = this.aberto();
      const modal = this.modal();
      const titulo = this.titulo();
      if (!aberto) {
        if (dialogo.open) {
          dialogo.close();
          if (this.anterior?.isConnected) this.anterior.focus({ preventScroll: true });
        }
        this.tituloAnterior = '';
        return;
      }
      if (!dialogo.open) {
        this.anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      } else if (dialogo.matches(':modal') !== modal) {
        dialogo.close();
      }
      if (!dialogo.open) {
        if (modal) dialogo.showModal();
        else dialogo.show();
      }
      if (titulo !== this.tituloAnterior) {
        if (document.activeElement instanceof HTMLElement && !dialogo.contains(document.activeElement)) {
          this.anterior = document.activeElement;
        }
        this.tituloAnterior = titulo;
        this.tituloEl().nativeElement.focus({ preventScroll: true });
      }
    });
  }

  protected cancelar(evento: Event): void {
    evento.preventDefault();
    evento.stopPropagation();
    this.fechar.emit();
  }

  protected teclar(evento: KeyboardEvent): void {
    if (evento.defaultPrevented) return;
    const dialogo = this.dialogo().nativeElement;
    if (!(evento.target instanceof Element) || evento.target.closest('dialog') !== dialogo) return;
    if (evento.key === 'Tab' && this.modal()) {
      const focaveis = Array.from(dialogo.querySelectorAll<HTMLElement>(
        'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])',
      )).filter(elemento => elemento.getClientRects().length > 0);
      const primeiro = focaveis[0];
      const ultimo = focaveis.at(-1);
      if (!primeiro || !ultimo) {
        evento.preventDefault();
        this.tituloEl().nativeElement.focus();
      } else if (evento.shiftKey && (document.activeElement === primeiro || document.activeElement === this.tituloEl().nativeElement)) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault();
        primeiro.focus();
      }
      return;
    }
    // Os diálogos de ajustes/pareamento têm seu próprio Escape.
    if (evento.key === 'Escape') {
      this.cancelar(evento);
    }
  }
}
