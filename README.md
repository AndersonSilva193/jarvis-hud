# jarvis-hud

A tela de conversa e briefing do [Jarvis](../jarvis): fundo azul-escuro com grade, orbe de energia no centro e
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
2. Conecta em `GET /api/eventos?token=...` e reconecta sozinho, com backoff até 30 s.
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

## Escuta por voz

Em navegadores com SpeechRecognition ou webkitSpeechRecognition, clique em **ativação por voz** e
autorize o acesso. A escuta começa desligada na primeira visita e lembra a preferência nas
seguintes. Usa pt-BR contínuo: **bom dia** pede briefing; **Jarvis** inicia um ditado de conversa.
A frase **Jarvis, como está o servidor?** já aproveita a pergunta na mesma ativação.

O indicador **ouvindo** acende somente durante a captura. O microfone pausa durante qualquer
fala do Jarvis e retoma após 400 ms. O botão permanece ligado durante essa pausa. Ao sair da
HUD, a captura e as esperas são encerradas. Sem suporte, o recurso fica escondido.

Se houver observações e o microfone estiver ligado, o Jarvis pergunta **O senhor quer ouvir as
observações?** e mostra **Aguardando resposta**. São oito segundos a partir da captura ativa
(com até dez segundos para abrir o microfone). Aceita **sim**, **quero**, **claro** e **pode**;
**não**, **nem** e **negativo** têm prioridade como recusa. Outras frases não encerram a espera.
Silêncio encerra a pergunta; Escape, novo briefing, saída da HUD ou desligar o microfone
cancelam a interação. As observações só são faladas após confirmação.

Use HTTPS ou localhost e conceda a permissão do navegador. Mesmo lembrando o microfone ligado,
uma aba recém-aberta pode precisar de um clique em **Ditar**, **ativação por voz** ou **Bom dia** para liberar
áudio. Se a permissão for recusada, a HUD avisa e não fica solicitando novamente em laço.

## Conversar com o Jarvis

Escreva na barra inferior e aperte **Enter**; **Shift + Enter** quebra a linha. Um pedido pode
estar em andamento por vez, mas o campo continua disponível para preparar a próxima mensagem.
O orbe indica que o Jarvis está pensando e mostra o trabalho informado pela ferramenta.

**Ditar** captura uma mensagem mesmo com a ativação contínua desligada, sem mudar essa preferência.
A transcrição aparece no campo. Após aproximadamente 1,5 segundo sem fala/transcrição, solicita
o resultado final e aguarda até mais um segundo antes de enviar. Sem fala por dez segundos,
segundo clique ou **Esc** cancela. Não envia texto vazio. A precisão dos eventos de silêncio
depende do navegador. Depois da resposta, aguarda novo clique ou a palavra **Jarvis**.

As respostas da HUD aparecem no card central e usam a mesma voz do briefing. O histórico lateral
recolhível mostra as dez últimas trocas dos dois canais. Mensagens do Telegram só atualizam essa
coluna: não assumem o card central e não são faladas. **Limpar conversa** limpa também o histórico
do Telegram e a última resposta; fica indisponível durante um pedido pendente.

Iniciar conversa interrompe briefing e pergunta de observações. Briefings recebidos durante a
interação ficam guardados (somente o mais recente) e **Ver briefing** permite consultá-los sem
reprodução automática. Setas e Enter dentro do campo não acionam os atalhos do briefing.

Na abertura e reconexão SSE, consulta histórico e última resposta. Uma resposta perdida de um
pedido pendente é exibida e falada uma vez; restauração sem pedido pendente é silenciosa. IDs e
revisões descartam duplicatas e consultas antigas. Se o POST perdeu a resposta, a HUD consulta
o estado e não o reenvia automaticamente. Se o backend perdeu o pedido ao reiniciar, informa a
interrupção e permite novo envio. O histórico do servidor fica em memória.

### Anexos e confirmações futuras

Anexos de imagem usam preview; arquivos têm **Abrir** para download. A HUD baixa conteúdo com
Bearer, cria URLs locais e as libera ao remover o card. O servidor expira os arquivos em uma
hora. Referências externas aceitam somente HTTP/HTTPS e nunca recebem o token da HUD.

Confirmações aparecem somente com metadados explícitos da API: código grande, descrição,
validade e botões **Confirmar** / **Cancelar**. Enviam **confirmo <código>** / **cancelo <código>**.
Também é possível acionar o microfone e dizer o código válido; números podem ser ditados dígito
por dígito. Esta entrega testa os componentes com metadados simulados. As ferramentas atuais
não criam arquivos, prints nem ações protegidas; a geração e validação de confirmações ficam
para essas futuras integrações.

### Roteiro de teste com microfone físico

1. Em HTTPS/localhost, autorize o microfone. Confirme que a primeira visita começa com ativação desligada.
2. Envie texto com Enter; confirme a resposta falada e a mesma conversa no histórico do Telegram.
3. Clique **Ditar**, diga uma pergunta e faça silêncio; deve enviar uma vez e pausar a captura durante a resposta.
4. Ligue **ativação por voz**, diga “Jarvis, como está o servidor?” e depois “bom dia”. Só a segunda pede briefing.
5. Na pergunta das observações, teste “sim”, “não quero” e silêncio. Saia da página durante a espera: o microfone não deve reabrir.
6. Derrube e restaure a conexão durante um pedido. Deve recuperar a resposta sem executar o pedido novamente.
7. Reabra a HUD: a preferência de ativação deve ser lembrada e as respostas restauradas silenciosamente.

Os testes automatizados simulam reconhecimento, áudio, API e ferramentas. Não substituem essa
checagem física nem as políticas de permissão e áudio do navegador.

## Deploy na Vercel

O `vercel.json` já traz o build, o diretório de saída (`dist/jarvis-hud/browser`) e o rewrite para
`index.html` — sem ele, recarregar em `/configuracao` daria 404.

```bash
npx vercel --prod      # ou importar o repositório no painel da Vercel
```

Disponibilize primeiro o backend atualizado (mantém o alias SSE antigo) e depois a HUD.
Nenhuma publicação é feita automaticamente. Depois do deploy, dois ajustes no Jarvis:

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
    conversa.service.ts          pedido, histórico e recuperação sem repetir POST
    conversa.modelos.ts          contratos de conversa, anexos e confirmação
    escuta.service.ts            ativação, ditado e resposta às observações
    jarvis-api.service.ts        POST /api/briefing, GET /ultimo, teste de conexão
    jarvis-eventos.service.ts    SSE com reconexão e diagnóstico da queda
    voz.service.ts               speechSynthesis pt-BR e a intensidade do orbe
    briefing-player.service.ts   a fila: um bloco por vez, falado até o fim
  paginas/configuracao/          tela 1
  paginas/hud/                   tela 2: orbe, palco e fileira
  componentes/conversa/          barra, resposta, anexos e histórico
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
npm test -- --watch=false # vitest
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
