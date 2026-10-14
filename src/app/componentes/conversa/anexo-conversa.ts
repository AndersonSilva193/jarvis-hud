import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { JarvisApiService } from '../../nucleo/jarvis-api.service';
import type { AnexoConversa } from '../../nucleo/conversa.modelos';

@Component({
  selector: 'app-anexo-conversa',
  template: ` <article>
    @if (anexo().tipo === 'link') {
      @if (linkSeguro()) {
        <a
          [href]="linkSeguro()"
          target="_blank"
          rel="noopener noreferrer"
          referrerpolicy="no-referrer"
          >{{ anexo().nome }} ↗</a
        >
      }
    } @else if (erro()) {
      <p role="status">{{ anexo().nome }} — {{ erro() }}</p>
    } @else if (endereco()) {
      @if (anexo().tipo === 'imagem') {
        <img [src]="endereco()" [alt]="anexo().nome" />
      } @else {
        <span aria-hidden="true">▤</span>
      }
      <span>{{ anexo().nome }}</span>
      <a [href]="endereco()" [download]="anexo().nome" [attr.aria-label]="'Abrir ' + anexo().nome"
        >Abrir</a
      >
    } @else {
      <p role="status">Carregando {{ anexo().nome }}…</p>
    }
  </article>`,
  styles: `
    article {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      flex-wrap: wrap;
      padding: 0.7rem;
      border: 1px solid #416574;
      border-radius: 5px;
    }
    img {
      width: 100%;
      max-height: 30vh;
      object-fit: contain;
    }
    a {
      color: #a6f8ff;
      overflow-wrap: anywhere;
    }
    p {
      margin: 0;
      color: #c7dce5;
    }
    span {
      overflow-wrap: anywhere;
    }
    a:focus-visible {
      outline: 2px solid #a6f8ff;
      outline-offset: 3px;
    }
  `,
})
export class AnexoConversaComponent {
  readonly anexo = input.required<AnexoConversa>();
  private readonly api = inject(JarvisApiService);
  readonly endereco = signal('');
  readonly erro = signal('');
  readonly linkSeguro = computed(() => {
    try {
      const url = new URL(this.anexo().url);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        ? url.href
        : '';
    } catch {
      return '';
    }
  });
  constructor() {
    effect((limpar) => {
      const anexo = this.anexo();
      let encerrado = false;
      let criado = '';
      this.endereco.set('');
      this.erro.set('');
      limpar(() => {
        encerrado = true;
        if (criado) URL.revokeObjectURL(criado);
      });
      if (anexo.tipo === 'link') return;
      if (anexo.expiraEm && Date.parse(anexo.expiraEm) <= Date.now()) {
        this.erro.set('anexo expirado');
        return;
      }
      void this.api
        .baixarAnexo(anexo.id)
        .then((blob) => {
          if (encerrado) return;
          criado = URL.createObjectURL(blob);
          this.endereco.set(criado);
        })
        .catch(() => {
          if (!encerrado) this.erro.set('anexo indisponível ou expirado');
        });
    });
  }
}
