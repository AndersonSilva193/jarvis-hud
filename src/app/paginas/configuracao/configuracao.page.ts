import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfiguracaoPage {
  private readonly config = inject(ConfigStore);
  private readonly api = inject(JarvisApiService);
  private readonly router = inject(Router);
  protected readonly voz = inject(VozService);

  protected readonly url = signal(this.config.urlApi());
  protected readonly token = signal(this.config.token());
  protected readonly testando = signal(false);
  protected readonly mensagem = signal('');

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
        await this.router.navigate(['/']);
        return;
      }
      this.mensagem.set(MENSAGENS[resultado]);
    } finally {
      this.testando.set(false);
    }
  }
}
