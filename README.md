# jarvis-hud

A tela de briefing do [Jarvis](../jarvis): fundo azul-escuro com grade, orbe de energia no centro e
cards translúcidos que entram um por um enquanto o Jarvis lê cada bloco em voz alta. Feita para
ficar aberta em tela cheia num monitor.

Angular 22 (standalone, zoneless, sem SSR). Nenhum segredo no build: a URL da API e o `HUD_TOKEN`
são digitados na primeira tela e ficam no `localStorage` do navegador.

## Rodar

```bash
npm install
npm start           # http://localhost:4200
```

Na primeira abertura o HUD pede dois valores e testa os dois antes de salvar:

| Campo      | O que é                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------- |
| URL da API | Onde o Jarvis responde, **sem** barra no fim — ex. `http://localhost:8090` ou `https://seu-dominio` |
| HUD_TOKEN  | O mesmo valor de `HUD_TOKEN` no `.env` do Jarvis                                                    |

Do lado do Jarvis, `HUD_ORIGEM` precisa listar a origem de onde o HUD é aberto (ex.
`http://localhost:4200`), senão o navegador barra tudo no CORS.

## O que acontece na tela

1. Ao abrir, busca `GET /api/briefing/ultimo` e pinta o último briefing na fileira de baixo — sem
   falar nada. Conectar no SSE não traz estado nenhum, por isso essa chamada existe.
2. Conecta em `GET /api/briefing/eventos?token=...` e reconecta sozinho, com backoff até 30 s.
3. No evento `gerando`, o orbe mostra **"Atualizando o radar de notícias..."**.
4. No evento `briefing`, a fila começa: o card entra no centro, o Jarvis fala aquele bloco e, ao
   terminar, o card desce para a fileira e o próximo entra. São 7 blocos no caso cheio — abertura,
   clima, lembretes, sistemas e uma manchete por notícia.
5. O botão **Bom dia** faz `POST /api/briefing`. Ele é discreto de propósito: existe porque o
   Chrome exige um clique antes de tocar áudio. O cron das 8h e o `/bomdia` no Telegram disparam o
   briefing sem clique nenhum — a tela se monta sozinha pelo SSE.

Teclas: `→` pula o bloco atual, `Esc` encerra a reprodução.

## Voz

`speechSynthesis` com `lang="pt-BR"`, preferindo a voz que tenha **Google** e **Brasil** no nome
(a tela de configuração mostra qual voz foi escolhida). Duas coisas no código existem por causa do
navegador:

- o texto é falado em pedaços de até 180 caracteres, porque o Chrome corta utterance longa;
- a intensidade do orbe vem dos eventos `boundary`, mas cai numa oscilação sintética quando eles
  não chegam — as vozes de rede do Google quase nunca os emitem, e sem isso o orbe ficaria parado
  justamente com a melhor voz pt-BR.

Para rodar sem precisar do clique inicial:

```bash
chrome --kiosk --autoplay-policy=no-user-gesture-required http://localhost:4200
```

## Deploy na Vercel

O `vercel.json` já traz o build, o diretório de saída (`dist/jarvis-hud/browser`) e o rewrite para
`index.html` — sem ele, recarregar em `/configuracao` daria 404.

```bash
npx vercel --prod      # ou importar o repositório no painel da Vercel
```

Depois do deploy, dois ajustes no Jarvis:

1. Adicionar o domínio em `HUD_ORIGEM` (separado por vírgula) e reiniciar.
2. A API precisa estar em **HTTPS**. Uma página HTTPS na Vercel não consegue chamar
   `http://localhost:8090` nem IP sem TLS — o navegador bloqueia por conteúdo misto, e a tela de
   configuração avisa quando detecta essa combinação. O `README` do Jarvis tem o bloco de nginx com
   as diretivas que o SSE exige (`proxy_buffering off`, `proxy_read_timeout 1h`).

`HUD_ORIGEM` usa origens exatas, sem curinga: as URLs de _preview_ da Vercel mudam a cada deploy e
teriam de ser listadas uma por uma. Na prática, só o domínio de produção funciona.

## Organização

```
src/app/
  nucleo/
    briefing.modelos.ts          espelho do BriefingDto da API, mais o tipo Bloco da fila
    config.store.ts              URL + token no localStorage
    jarvis-api.service.ts        POST /api/briefing, GET /ultimo, teste de conexão
    jarvis-eventos.service.ts    SSE com reconexão e diagnóstico da queda
    voz.service.ts               speechSynthesis pt-BR e a intensidade do orbe
    briefing-player.service.ts   a fila: um bloco por vez, falado até o fim
  paginas/configuracao/          tela 1
  paginas/hud/                   tela 2: orbe, palco e fileira
  componentes/orbe/              OrbeComponent (canvas: núcleo, anéis, partículas)
  componentes/card-clima/        CardClimaComponent
  componentes/card-lembretes/    CardLembretesComponent
  componentes/card-noticia/      CardNoticiaComponent
  componentes/card-sistemas/     CardSistemasComponent
  componentes/card-texto/        abertura e qualquer seção sem dados estruturados
  estilos/_hud.scss              cores, fonte mono e a moldura dos cards
```

## Validar

```bash
npm test            # vitest
npm run build       # build de produção
```

## Quando algo não aparece

| Sintoma                          | Provável causa                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `token inválido` no rodapé       | `HUD_TOKEN` diferente do que está no `.env` do Jarvis                                                                                         |
| `api fora do ar`                 | URL errada, Jarvis desligado, ou a origem não está em `HUD_ORIGEM`                                                                            |
| Cards aparecem, mas ninguém fala | Falta o clique inicial (clique em **Bom dia**) ou não há voz pt-BR no sistema                                                                 |
| Clicar **Bom dia** não muda nada | Dentro de 60 s a API devolve o briefing anterior sem emitir SSE; o HUD toca o da resposta HTTP, então isso deveria funcionar — veja o console |
| Card de notícia sem foto         | O feed não trouxe imagem, ou a CDN recusou o hotlink: o card tem estado próprio para isso                                                     |
