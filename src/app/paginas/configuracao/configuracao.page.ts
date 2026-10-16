import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { ConfigStore, conteudoMisto, urlValida } from '../../nucleo/config.store';
import { JarvisApiService, type ResultadoTeste } from '../../nucleo/jarvis-api.service';
import { VozService } from '../../nucleo/voz.service';

const MENSAGENS: Record<Exclude<ResultadoTeste, 'ok'>, string> = {
  'token-invalido': 'A API respondeu, mas recusou o token. Confira o HUD_TOKEN do .env.',
  'api-inacessivel':
    'Não consegui falar com a API neste endereço. Confira a URL, se o Jarvis está no ar e se ' +
    'esta origem está em HUD_ORIGEM.',
  'conteudo-misto':
    'Esta página está em HTTPS e a API em HTTP: o navegador bloqueia a chamada. Use HTTPS na ' +
    'API ou abra o HUD em http://localhost.',
};

/**
 * A primeira tela: pede a URL da API e o HUD_TOKEN e guarda no localStorage.
 *
 * Em vez de salvar e esperar o HUD falhar, testa antes — e separa "token errado" de "API fora
 * do ar", que é a diferença que faz alguém achar o problema em dez segundos em vez de meia hora.
 */
@Component({
  selector: 'app-configuracao',
  templateUrl: './configuracao.page.html',
  styleUrl: './configuracao.page.scss',
})
export class ConfiguracaoPage {
  private readonly config = inject(ConfigStore);
  private readonly api = inject(JarvisApiService);
  private readonly router = inject(Router);
  private readonly rota = inject(ActivatedRoute);
  protected readonly voz = inject(VozService);

  protected readonly url = signal(this.config.urlApi());
  protected readonly token = signal(this.config.token());
  protected readonly testando = signal(false);
  protected readonly mensagem = signal('');
  protected readonly google = signal<{ configurado: boolean; autorizado: boolean } | null>(null);
  protected readonly conectandoGoogle = signal(false);
  protected readonly mensagemGoogle = signal('');

  constructor() {
    if (this.config.configurado()) void this.atualizarGoogle();
  }

  private async atualizarGoogle(): Promise<void> {
    try { this.google.set(await this.api.statusGoogle()); }
    catch { this.mensagemGoogle.set('Não consegui consultar a conexão Google.'); }
  }

  protected async conectarGoogle(): Promise<void> {
    const janela = window.open('', '_blank');
    this.conectandoGoogle.set(true);
    this.mensagemGoogle.set('');
    try {
      const { url } = await this.api.iniciarGoogle();
      if (janela) janela.location.href = url;
      else { this.mensagemGoogle.set('Permita pop-ups para autorizar o Google.'); return; }
      for (let tentativa = 0; tentativa < 60; tentativa++) {
        await new Promise<void>(resolve => setTimeout(resolve, 2000));
        const estado = await this.api.statusGoogle();
        this.google.set(estado);
        if (estado.autorizado) { this.mensagemGoogle.set('Google Sheets conectado.'); return; }
        if (janela.closed) break;
      }
      this.mensagemGoogle.set('A conexão não foi concluída. Tente novamente.');
    } catch {
      janela?.close();
      this.mensagemGoogle.set('Não consegui iniciar a conexão Google.');
    } finally { this.conectandoGoogle.set(false); }
  }

  protected readonly avisoDeConteudoMisto = computed(() => conteudoMisto(this.url()));
  protected readonly podeConectar = computed(
    () => urlValida(this.url()) && this.token().trim().length > 0 && !this.testando(),
  );
  protected readonly semVozEmPortugues = computed(() => this.voz.disponivel && !this.voz.voz());

  protected aoDigitarUrl(evento: Event): void {
    this.url.set((evento.target as HTMLInputElement).value);
    this.mensagem.set('');
  }

  protected aoDigitarToken(evento: Event): void {
    this.token.set((evento.target as HTMLInputElement).value);
    this.mensagem.set('');
  }

  protected async conectar(evento: Event): Promise<void> {
    evento.preventDefault();
    if (!this.podeConectar()) {
      return;
    }
    this.testando.set(true);
    this.mensagem.set('');
    try {
      const resultado = await this.api.testar(this.url(), this.token());
      if (resultado === 'ok') {
        this.config.salvar(this.url(), this.token());
        await this.router.navigate(['/'], {
          queryParams: this.rota.snapshot.queryParamMap.get('inicio') === '1' ? { inicio: '1' } : {},
          replaceUrl: true,
        });
        return;
      }
      this.mensagem.set(MENSAGENS[resultado]);
    } finally {
      this.testando.set(false);
    }
  }
}
