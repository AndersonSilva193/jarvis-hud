import { Injectable, computed, signal } from '@angular/core';

const CHAVE_URL = 'jarvis-hud.api-url';
const CHAVE_TOKEN = 'jarvis-hud.token';

/**
 * A URL da API e o HUD_TOKEN, guardados no localStorage deste navegador.
 *
 * Nada vai para o build: a tela de configuração pede os dois na primeira vez e o HUD lembra.
 * Toda leitura e escrita é protegida porque localStorage estoura em janela privada e quando o
 * usuário bloqueia dados do site.
 */
@Injectable({ providedIn: 'root' })
export class ConfigStore {
  readonly urlApi = signal(ler(CHAVE_URL));
  readonly token = signal(ler(CHAVE_TOKEN));

  readonly configurado = computed(() => this.urlApi().length > 0 && this.token().length > 0);

  /**
   * Página em HTTPS chamando API em HTTP é bloqueada pelo navegador (conteúdo misto) — é o caso
   * de abrir o HUD na Vercel apontando para localhost:8090.
   */
  readonly riscoDeConteudoMisto = computed(() => conteudoMisto(this.urlApi()));

  salvar(urlApi: string, token: string): void {
    const url = normalizarUrl(urlApi);
    this.urlApi.set(url);
    this.token.set(token.trim());
    gravar(CHAVE_URL, url);
    gravar(CHAVE_TOKEN, token.trim());
  }

  limpar(): void {
    this.urlApi.set('');
    this.token.set('');
    gravar(CHAVE_URL, '');
    gravar(CHAVE_TOKEN, '');
  }

  /** Monta a URL de um endpoint, ex. rota('/api/briefing'). */
  rota(caminho: string): string {
    return `${this.urlApi()}${caminho}`;
  }
}

/** Sem barra no fim e com esquema: assim concatenar com '/api/...' nunca dá barra dobrada. */
export function normalizarUrl(bruta: string): string {
  const limpa = bruta.trim().replace(/\/+$/, '');
  if (limpa.length === 0) {
    return '';
  }
  return /^https?:\/\//i.test(limpa) ? limpa : `https://${limpa}`;
}

export function urlValida(bruta: string): boolean {
  const normalizada = normalizarUrl(bruta);
  if (normalizada.length === 0) {
    return false;
  }
  try {
    new URL(normalizada);
    return true;
  } catch {
    return false;
  }
}

export function conteudoMisto(urlApi: string): boolean {
  return (
    typeof location !== 'undefined' &&
    location.protocol === 'https:' &&
    normalizarUrl(urlApi).startsWith('http://')
  );
}

function ler(chave: string): string {
  try {
    return localStorage.getItem(chave)?.trim() ?? '';
  } catch {
    return '';
  }
}

function gravar(chave: string, valor: string): void {
  try {
    if (valor.length === 0) {
      localStorage.removeItem(chave);
    } else {
      localStorage.setItem(chave, valor);
    }
  } catch {
    // Sem localStorage o HUD ainda funciona nesta sessão; só não lembra na próxima.
  }
}
