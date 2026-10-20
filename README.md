# jarvis-hud

A tela de conversa e briefing do [Jarvis](../jarvis): fundo azul-escuro com grade, orbe de energia no centro e
cards translúcidos que entram um por um enquanto o Jarvis lê cada bloco em voz alta. Feita para
ficar aberta em tela cheia num monitor.

A moldura é de instrumento: colchetes nos quatro cantos, uma varredura lenta de cima a baixo, o
relógio no cabeçalho e, em volta do orbe, anéis que giram — tracejado por fora, escala de tiques
por dentro e uma mira nos pontos cardeais. Os anéis aceleram e acendem conforme o estado (ouvindo,
pensando, falando). Tudo isso para no `prefers-reduced-motion`.

O orbe é um **reator**: anel luminoso com núcleo escuro e uma coroa de arcos segmentados. Uma
**onda de voz** atravessa a tela de borda a borda na altura dele, com espectro nas pontas e
partículas no fundo; ela cresce com a energia real da fala (o mesmo `intensidade` que já movia o
orbe) e respira enquanto o microfone capta. Em volta, quatro **sondas** ligadas ao anel por fios
mostram o caminho de um pedido — entrada de áudio, transcrição, processamento e síntese de voz — e
cada uma acende só quando a sua etapa acontece; o texto pequeno é o estado real (microfone,
ferramenta em curso, provedor e cota de voz). As sondas apagam quando há card no palco e somem
abaixo de 1100 px. No cabeçalho, o selo **Voz online / Voz em espera** diz se a ativação por voz
está ligada, e as barras dele mexem enquanto há som entrando ou saindo.

O palco tem **até seis janelas em destaque**, e respostas de conversa só entram quando têm **o que se olha**: um bloco do briefing, uma
imagem ou arquivo anexado, um código de confirmação, um erro. Fala simples do Jarvis não vira card
— ela é falada, aparece na legenda embaixo do orbe e fica no histórico. Para ler a conversa, abra o
chat (**Conversar**) ou o **Histórico** no topo; para conversar por texto o tempo todo, há o
Telegram.

Quando o bloco acaba de ser falado, o card desce para a fileira de baixo e vira miniatura; depois
do último, o palco fica vazio e o orbe cresce e assume o centro — o Jarvis em repouso é um círculo
livre, sem nada por cima.

Angular 22 (standalone, zoneless, sem SSR). Nenhum segredo no build: a URL da API e o `HUD_TOKEN`
são digitados na primeira tela e ficam no `localStorage` do navegador.

## Google Sheets

Na tela de configuração, “Conectar Google Sheets” abre a autorização OAuth quando a API
Jarvis possui credenciais Google configuradas. A HUD consulta o estado da conexão; os tokens
ficam somente no backend, cifrados no volume persistente. A ferramenta do Jarvis cria
planilhas novas e devolve um link, ou oferece XLSX para importação quando não há autorização.

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
3. No evento `gerando`, a linha de estado no topo mostra **"Atualizando o radar de notícias..."**.
   Essa linha é a única voz sobre o que o Jarvis está fazendo: pronto, ouvindo, pensando,
   consultando ferramenta, falando e aguardando resposta passam todos por ali. O estado da conexão
   é separado, no canto esquerdo.
4. No evento `briefing`, a fila começa: o card entra no centro, o Jarvis fala aquele bloco e, ao
   terminar, o card sai animado para baixo e vira miniatura na fileira. São 7 blocos no caso cheio —
   abertura, clima, lembretes, sistemas e uma manchete por notícia. Depois do último, o palco fica
   vazio: o orbe cresce e fica sozinho na tela, com o rótulo do briefing e a data de geração acima
   da fileira.
5. O botão **Briefing** faz `POST /api/briefing`. Ele é discreto de propósito: existe porque o
   Chrome exige um clique antes de tocar áudio. O cron das 8h e o `/bomdia` no Telegram disparam o
   briefing sem clique nenhum — a tela se monta sozinha pelo SSE.
6. Cada miniatura é consultável: clicar abre o card em leitura silenciosa (selo **CONSULTA**) e
   interrompe a fala em curso. Clicar de novo na mesma miniatura, no **✕** do card ou em `Esc`
   fecha a consulta e devolve o centro ao orbe.

Abaixo do orbe, uma legenda discreta mostra o trecho que está sendo falado agora — é o texto
entregue à síntese, sem simular sincronia palavra a palavra, que o navegador não informa.

Teclas: `→` pula o bloco atual; `Esc` fecha primeiro o histórico aberto ou a janela focada. Sem janela, cancela ditado/fala. `Alt + setas` move a janela; setas com foco na alça redimensionam.

A barra de conversa fica compacta em repouso (**Conversar** e o microfone) e só expande ao clicar ou
ao começar um ditado. Ela nunca se recolhe sozinha enquanto houver rascunho ou ditado em curso.
Aberta, ela mostra acima de si as últimas trocas — é ali que a fala do Jarvis vira texto na tela.

## Saudação e horário

O cumprimento é **um só**, decidido no backend: a mesma abertura vai para a tela e para a síntese,
e o modelo não escolhe de novo o período do dia. As faixas são bom dia das 05h às 11h59, boa tarde
das 12h às 17h59 e boa noite no resto.

Quem lê isso aqui é `nucleo/horario-briefing.ts`, e a regra é usar **o relógio do servidor**:

- com `fusoHorario` no briefing (campo opcional, para não quebrar com backend antigo), a data é
  formatada nesse fuso;
- sem ele, o relógio é reconstruído do offset do `geradoEm` — o que o servidor tinha, não o que o
  navegador tem. Abrir o HUD de outro fuso não muda o cumprimento;
- a `abertura` que o backend mandou sempre vence o cálculo local, que é só a rede de segurança.

O briefing restaurado ao abrir a tela fica **mudo** e aparece rotulado **Último briefing**, com a
data em que foi gerado — ele não finge ser de agora. Pedir um novo gera conteúdo atualizado, e o
cache do backend deixa de ser reaproveitado quando vira a data ou muda o período da saudação.

## Voz

São dois caminhos, e o backend decide qual. Com `VOZ_PROVEDOR=elevenlabs` no Jarvis, a HUD pede o
MP3 em `POST /api/voz/sintetizar` e toca num elemento `<audio>` — é a voz boa, e a intensidade do
orbe vem da análise real do áudio. Com a ElevenLabs desligada, sem cota ou após uma falha (e aí com
um descanso antes de tentar de novo), a fala cai para o `speechSynthesis` do navegador.

No caminho do navegador é `lang="pt-BR"`, preferindo a voz que tenha **Google** e **Brasil** no nome
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
seguintes. Usa pt-BR contínuo: **bom dia**, **boa tarde** e **boa noite** pedem o briefing (com ou sem
"jarvis" antes ou depois); **Jarvis** seguido de qualquer outra coisa inicia um ditado de conversa.
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
uma aba recém-aberta pode precisar de um clique em **Ditar**, **ativação por voz** ou **Briefing** para liberar
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

As respostas da HUD usam a mesma voz do briefing e aparecem como texto em dois lugares: no diálogo
em cima da barra, enquanto o chat está aberto, e no histórico. **O card central é só para o que se
olha** — anexo, código de confirmação ou erro —, e esse card sai no **✕**, no **Esc** ou no **Ver
briefing**; um card restaurado ao abrir a tela não volta sozinho ao palco. O histórico lateral
recolhível mostra as dez últimas trocas dos dois canais. Respostas de conversa do Telegram só atualizam essa
coluna e não são faladas. Eventos `tela.card` do Telegram abrem janelas normalmente. **Limpar conversa** limpa também o histórico
do Telegram e a última resposta; fica indisponível durante um pedido pendente.

Iniciar conversa interrompe briefing e pergunta de observações. Briefings recebidos durante a
interação ficam guardados (somente o mais recente) e **Ver briefing** permite consultá-los sem
reprodução automática. Setas e Enter dentro do campo não acionam os atalhos do briefing.

Na abertura e reconexão SSE, consulta histórico e última resposta. Uma resposta perdida de um
pedido pendente é exibida e falada uma vez; restauração sem pedido pendente é silenciosa. IDs e
revisões descartam duplicatas e consultas antigas. Se o POST perdeu a resposta, a HUD consulta
o estado e não o reenvia automaticamente. Se o backend perdeu o pedido ao reiniciar, informa a
interrupção e permite novo envio. O histórico do servidor é persistido em disco pelo Jarvis (um
JSON por chat) e restaurado na partida, com a sessão renovada: o que volta é lista para olhar, não
resposta para falar de novo.

### Anexos e confirmações

Anexos de imagem usam preview; arquivos têm **Abrir** para download. A HUD baixa conteúdo com
Bearer, cria URLs locais e as libera ao remover o card. O servidor expira os arquivos em uma
hora. Referências externas aceitam somente HTTP/HTTPS e nunca recebem o token da HUD.

Confirmações aparecem somente com metadados explícitos da API: código grande, descrição,
validade e botões **Confirmar** / **Cancelar**. Enviam **confirmo <código>** / **cancelo <código>**.

As tarefas visuais do PC aparecem no rodapé com estado, ciclos, ações e botão de parada. A HUD
recupera a última tarefa por HTTP ao reconectar; o progresso chega por `computer.progresso`.
O botão de confirmação envia uma nova mensagem autenticada, consumida diretamente
pelo servidor para ações do PC e rotinas.
Também é possível acionar o microfone e dizer o código válido; números podem ser ditados dígito
por dígito. Os anexos e as confirmações já são usados de verdade: `criar_arquivo` e `ler_arquivo`
entregam documento, `captura_tela` entrega imagem, e desligar o PC, rodar rotina, iniciar tarefa
visual, sobrescrever arquivo e desfazer edição passam pela confirmação. A suíte automatizada
continua exercitando os componentes com metadados simulados.

### Roteiro de teste com microfone físico

1. Em HTTPS/localhost, autorize o microfone. Confirme que a primeira visita começa com ativação desligada.
2. Envie texto com Enter; confirme a resposta falada e a mesma conversa no histórico do Telegram.
3. Clique **Ditar**, diga uma pergunta e faça silêncio; deve enviar uma vez e pausar a captura durante a resposta.
4. Ligue **ativação por voz**, diga “Jarvis, como está o servidor?” e depois “bom dia”. Só a segunda pede briefing.
5. Repita com “boa tarde” e “boa noite”: as três saudações pedem briefing.
6. Com o briefing terminado, confira que o palco está vazio e o orbe sozinho; clique numa miniatura,
   depois no **✕**, e veja o orbe voltar ao centro.
7. Mude o relógio do servidor para manhã, tarde, noite e madrugada e confira que o cumprimento
   exibido é idêntico ao falado. O período vem do servidor, nunca do relógio do navegador.
8. Na pergunta das observações, teste “sim”, “não quero” e silêncio. Saia da página durante a espera: o microfone não deve reabrir.
9. Derrube e restaure a conexão durante um pedido. Deve recuperar a resposta sem executar o pedido novamente.
10. Reabra a HUD: a preferência de ativação deve ser lembrada e as respostas restauradas silenciosamente.

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
    horario-briefing.ts          abertura e data de geração no fuso do servidor, nunca no do navegador
    config.store.ts              URL + token no localStorage
    conversa.service.ts          pedido, histórico e recuperação sem repetir POST
    conversa.modelos.ts          contratos de conversa, anexos e confirmação
    escuta.service.ts            ativação por voz e ditado
    escuta-de-resposta.service.ts  a espera pela resposta falada a uma pergunta do Jarvis
    comandos-rapidos.ts          as frases que a própria tela resolve, sem ir ao Jarvis
    normalizar-codigo.ts         código de confirmação ditado dígito por dígito
    jarvis-api.service.ts        POST /api/briefing, GET /ultimo, teste de conexão
    jarvis-eventos.service.ts    SSE com reconexão e diagnóstico da queda
    voz.service.ts               a fala: voz do navegador ou da ElevenLabs, e a intensidade do orbe
    voz-cota.service.ts          provedor em uso e cota restante (/api/voz/status)
    briefing-player.service.ts   a fila: um bloco por vez, falado até o fim
    tela.service.ts              os eventos tela.card / tela.comando vindos do Jarvis
    tela-estado.service.ts       o POST /api/tela/estado do que está aberto
    janelas.service.ts           as seis janelas do palco: foco, fixar, bandeja
    midia.service.ts             uma mídia por vez e o volume que abaixa durante a fala
    youtube.service.ts           a YouTube IFrame API, carregada uma vez
    inicializacao.service.ts     a abertura falada do ?inicio=1
    abrir-link.service.ts        única porta de saída para link externo, só http/https
    exige-configuracao.guard.ts  sem URL e token, cai na tela 1
  paginas/configuracao/          tela 1
  paginas/hud/                   tela 2: orbe, palco, fileira e controles (um .scss por área)
  componentes/janela/            a moldura arrastável e redimensionável das janelas
  componentes/conversa/          barra, diálogo em curso, resposta, anexos e histórico
  componentes/inicializacao/     a sequência de abertura por palmas
  componentes/orbe/              OrbeComponent: ciclo de vida dos dois canvas (reator e campo da onda)
  componentes/orbe/desenho-orbe.ts  o desenho em funções puras: reator, onda, espectro e partículas
  componentes/sondas/            SondasComponent: os quatro cards-satélite e os fios até o reator
  componentes/card-clima/        CardClimaComponent
  componentes/card-lembretes/    CardLembretesComponent
  componentes/card-noticia/      CardNoticiaComponent
  componentes/card-sistemas/     CardSistemasComponent
  componentes/card-pesquisa/     ranking, ficha, lista, linha do tempo e destaque
  componentes/card-video/, card-musica/, card-midia/  os players do YouTube
  componentes/card-pagina/       a página incorporada, ou a prévia quando o site recusa o iframe
  componentes/card-texto/        abertura e qualquer seção sem dados estruturados
  estilos/_hud.scss              cores, fonte mono, a moldura dos cards e o botão do HUD
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
| Cards aparecem, mas ninguém fala | Falta o clique inicial (clique em **Briefing**) ou não há voz pt-BR no sistema                                                                 |
| Clicar **Briefing** não muda nada | Dentro de 60 s a API devolve o briefing anterior sem emitir SSE; o HUD toca o da resposta HTTP, então isso deveria funcionar — veja o console |
| Card de notícia sem foto         | O feed não trouxe imagem, ou a CDN recusou o hotlink: o card tem estado próprio para isso                                                     |

## Janelas e cards dirigidos pelo Jarvis

Cada janela pode ser movida, redimensionada, minimizada, maximizada, fixada ou fechada.
Posição e tamanho normais são lembrados por tipo no navegador; conteúdo não é persistido.
Ao abrir ou restaurar a sétima janela, a mais antiga não fixada é minimizada. Se as seis
estiverem fixadas, a próxima fica na bandeja. Limpar preserva fixadas; fechar tudo também as fecha.
Nenhuma dessas operações apaga o histórico compartilhado.

O briefing continua bloco a bloco, com miniaturas; fixar um bloco conserva sua janela ao avançar.
Consultas de miniaturas são independentes e silenciosas. Respostas só geram janela para anexos,
confirmações ou erros, e fechar uma resposta a dispensa sem apagar o histórico.

Pesquisa aceita ranking, ficha, lista, linha_do_tempo e destaque. Fontes expandem no próprio card.
Página usa a indicação incorporavel do backend; a prévia está disponível também quando o site
recusa o iframe. A HUD nunca envia seu token para embeds. Os botões Abrir passam por
AbrirLinkService, ponto de troca para a futura integração com o agente do PC.

Vídeo e música usam a mesma YouTube IFrame API, carregada uma vez. O player fica visível,
inclusive minimizado (mínimo 200 × 200 px). Só uma mídia toca por vez; iniciar outra pausa a anterior.
A mídia ativa na bandeja conserva iframe e posição. Outros players minimizados ficam pausados.
Durante a fala do Jarvis, o volume cai a 20% do escolhido e depois volta. O navegador pode exigir
um clique em Play; vídeos que recusam incorporação oferecem Abrir no YouTube.

Comandos locais por texto ou após Jarvis: limpa a tela, fecha tudo, abre o histórico,
fecha o histórico, pausa, continua, aumenta o volume, abaixa o volume e fecha o vídeo/a música/a pesquisa.
Só frases completas são interceptadas. Mídia usa a janela focada ou a única candidata; fechamento
por tipo exige uma única candidata. Ambiguidade e outras frases vão ao Jarvis normalmente.

### Contratos de tela

- SSE tela.card: {id,tipo,titulo,dados,origem,criadoEm}; o id do servidor é preservado.
- SSE tela.comando: {acao,alvo,valor}; valor é texto, inclusive segundos em avancar/voltar.
- SSE voz.falar: {texto}; uma frase pronta para a tela dizer, sem card nem janela. Hoje vem do
  despertar por palmas encontrando a HUD já aberta.
- POST /api/tela/estado, Bearer: {janelas:[{id,tipo,titulo,estado,fixado,emFoco,tocando}],historicoAberto,briefingNaTela}.
- No POST, estado é normal/minimizado/maximizado. Conteúdo e geometria não são enviados.
- Mudanças usam debounce de 500 ms e POSTs serializados; reconexão e pulso de cinco minutos renovam o retrato.
- Instale primeiro o backend que aceita resposta e mais de 24 janelas; o contexto mantém o teto de 12 linhas.

## Abertura por palmas (?inicio=1)

Quando o [agente do PC](../jarvis-agente-pc) acorda o Jarvis — duas palmas ou a palavra
"Jarvis" dita sozinha —
ele abre esta tela com `?inicio=1`. Aí a HUD não aparece direto: toca uma sequência de abertura
antes.

1. Tela escura, cantos acendendo, o orbe se formando (`.orbe--formando`: escala, opacidade e
   desfoque — sem estado novo no canvas).
2. Quatro linhas de checagem aparecem uma a uma, cada uma com o estado **real**:
   `CONECTANDO AO SERVIDOR` (o SSE), `SÍNTESE DE VOZ` (`/api/voz/status`), `MICROFONE`
   (`escuta.disponivel`) e `SISTEMAS MONITORADOS ... 3/3` (da resposta de `/api/inicializacao`).
   Quem falha aparece como `FALHOU` e **não** interrompe o resto.
3. O Jarvis fala a introdução de `POST /api/inicializacao` (no máximo três frases). API fora do
   ar: fala a frase fixa de reserva, em vez de ficar muda.
4. A escuta liga sozinha e o `?inicio=1` sai da URL por `history.replaceState` — sem isso, um F5
   repetiria a introdução inteira.

Tudo isso em 4 a 6 segundos, que é de propósito o mesmo orçamento do backend: a chamada à API
parte junto com a animação, não depois dela. Com `prefers-reduced-motion` a sequência encurta e
chega ao mesmo estado final — o Playwright roda com `reducedMotion: 'reduce'`, e uma abertura que
não terminasse travaria o e2e.

O `Esc` corta a abertura a qualquer momento.

**Autoplay:** o agente abre o Chrome com `--autoplay-policy=no-user-gesture-required`, que é o que
permite falar sem clique. Abrindo a HUD à mão com `?inicio=1`, a fala pode sair pela voz do
navegador ou não sair — a sequência roda igual, sem travar.

**Perfil próprio:** a tela abre num perfil do Chrome só dela, que nasce sem `localStorage`. Na
primeira vez a HUD cai em `/configuracao` e você preenche URL e token uma vez; depois o perfil
persiste. Ver o README do agente.

### Verificação

Execute npm test -- --watch=false e npm run build. Em PowerShell com scripts desabilitados,
use npm.cmd. npm run test:e2e usa Chrome instalado, Playwright e AXE, com API/SSE simulados e
sem credenciais reais. Os testes cobrem layouts, teclado, geometria, comandos locais, estado,
continuidade do player e as falhas de incorporação: vídeo que recusa o embed cai na miniatura com
Abrir no YouTube, página que não incorpora oferece a prévia e imagem indisponível some do card.
Capturas e traces ficam em test-results/ (ignorado pelo Git).

O embed real do YouTube fica fora da suíte determinística, que usa player simulado. Para conferi-lo
no navegador, rode `TESTAR_YOUTUBE_REAL=1 npx playwright test -g "@externo"`: o teste aceita
reprodução, play explícito pelo autoplay bloqueado ou erro declarado, e guarda a captura do player.
