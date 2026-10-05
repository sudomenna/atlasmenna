---
id: ADR-0077
title: Painel de operação privado (`/painel`) — senha no `proxy.ts` e retrato fixo do 1º turno em Vercel Blob privado, não página pública nem leitura do Postgres a cada abertura
status: accepted
date: 2026-10-05
---

# ADR-0077 — Painel de operação privado (`/painel`): senha no proxy, retrato fixo em Blob privado

## Status

Aceito (2026-10-05). Decisão do dono, tomada no dia seguinte ao 1º turno, com a ingestão desligada até o
2º turno (25/10) — não há apuração ao vivo em jogo, e o `proxy.ts` pode ser mexido sem a pressão do dia D.

Não supersede nem emenda nenhum ADR. O [ADR-0009](0009-botid-vercel.md) segue exato: o BotID continua
valendo só em `/api/*`; o `proxy.ts` ganha uma segunda função (portão de senha em `/painel`) sem tocar a
primeira. O [ADR-0001](0001-edge-config-no-read-path.md) fica intacto (Decisão 2). **Risco aberto**: a
store de Blob em uso pode não aceitar blob privado; o plano B está descrito na Decisão 2 e nas Consequências.

**Emenda (2026-10-05, mesmo dia) — PLANO B EM VIGOR.** O primeiro `--escrever` falhou com
`Cannot use private access on a public store`: a store do projeto é pública, e o acesso é por store, não
por arquivo. O dono escolheu o plano B, sem criar store nova. A alternativa recusada foi uma store privada só
para o painel: ao conectá-la ao projeto, ela disputaria o nome `BLOB_READ_WRITE_TOKEN` com a store do site.
O retrato vai como blob **público** em `painel/<32 bytes hex aleatórios>/retrato-1t-2026.json`, com um
segredo novo a cada `--escrever`. A URL fica só na env `PAINEL_RETRATO_URL` (Production) e em
`build/painel/url-retrato.txt` (fora do git); o gerador não a imprime. A página lê o retrato com `fetch`
no servidor (`no-store`), e um teste estático reprova qualquer `"use client"` que mencione a env. A
**confidencialidade do dado passa a ser por obscuridade** da URL. A senha continua protegendo a página. Os
riscos são baixos: o dado é só contagens e horários, sem PII, e o código do sistema já é público. Nas seções
abaixo, onde se lê "Blob privado" / `get()` privado, vale este parágrafo.

## Contexto

**1. O que o dono quer ver, e de onde isso pode vir.** Depois do 1º turno o dono pediu um painel em
`atlasmenna.online/painel` para ver, minuto a minuto, o que o sistema fez na noite da apuração: pedidos ao
TSE, arquivos que mudaram, erros, bloqueios (429), espera do limitador e rodadas da projeção. Três fontes
duráveis existem no Postgres. `ingest_log`: uma linha de início e uma de fim por ciclo; a de fim traz
`files_fetched`, `files_changed`, `errors`, `duration_ms` e `notes` (JSON com `cargo`, `fatia`, `unchanged`,
`not_found`, `rateLimited`, `waitedMs` e `model_triggered`). `snapshots`: uma linha por arquivo do TSE que
mudou. `projections`: uma linha por rodada do modelo. A fonte que **não** é durável são os logs de texto
(`lib/tse/log.ts`), que vão para o stdout da Vercel com retenção curta. E o pedido HTTP individual ao TSE
não é registrado em lugar nenhum — só o total por ciclo. O painel, portanto, só pode contar o que o banco
lembra, e a menor resolução de "pedidos ao TSE" é o ciclo, não a requisição.

**2. Restrições.** O site nunca teve página autenticada: o `proxy.ts` hoje só cobre `/api/*` (BotID mais os
segredos de cron e do modelo, comparados em tempo constante por `segredoConfere`, `proxy.ts:23-30`). O
repositório `sudomenna/atlasmenna` é **público** no GitHub. O ADR-0001 proíbe Postgres no caminho de leitura
do cliente. E o dono fixou duas coisas: a página é **privada** (só ele, com senha, fora do Google) e é um
**retrato fixo do 1º turno**, não uma tela ao vivo; para o 2º turno o retrato é gerado de novo.

**3. Alternativas consideradas e rejeitadas.** (a) *Página pública* — decisão do dono, e exporia erros e o
ritmo interno do sistema a qualquer um. (b) *Painel ao vivo lendo o Postgres a cada abertura* — o dono
escolheu o retrato; além disso tocaria o ADR-0001 e poria carga no banco na noite do 2º turno, a de maior
audiência. (c) *Commitar o JSON no repositório* — o repositório é público, e a senha viraria enfeite (o
dado estaria a um `git clone` de distância). (d) *Vercel Deployment Protection* — protege o deployment
inteiro, não um caminho: trancaria o site público junto. (e) *Blob público com URL secreta* — segurança só
por obscuridade; fica como plano B, e só se a store não aceitar blob privado (Decisão 2).

**4. Relação com a spec 012.** A [spec 012](../../specs/012-dashboard-status/spec.md) previu um dashboard
operacional `/_status`, "protegido por auth básica", ao vivo (5 s) e com botões de ação ("Pausar Cron",
"Forçar refresh"). Foi cortada pelo dono em 2026-09-18 e tem zero código. Este painel **não a substitui nem
a implementa**: é retrato, só leitura, sem ação. A open question de autenticação da 012 ("middleware com
usuário/senha em env, ou SSO") não é fechada por este ADR para aquela spec — apenas há agora, no repo, um
precedente de portão por senha em env.

## Decisão

**1. Senha no `proxy.ts`, fail-closed.** O `proxy.ts` passa a cobrir também `/painel` e `/painel/:path*`
com **HTTP Basic Auth** contra a variável de ambiente `PAINEL_SENHA`. Vale **qualquer usuário**; só a
senha é conferida, com `segredoConfere` (tempo constante, reuso do que já existe). **Sem a env, a resposta é
sempre 401** — nunca "liberado por não haver senha configurada". A proteção cobre o HTML e as requisições
RSC (ambas passam pelo mesmo caminho). **O BotID não roda nessa rota**: o site nunca ligou o script de
cliente do BotID (`initBotId`) e, por isso, todo navegador é classificado como bot (`proxy.ts:66-75`) — o
BotID aplicado aqui daria 403 ao próprio dono; a senha é o portão. As respostas levam
`X-Robots-Tag: noindex` e a página declara `metadata.robots` noindex.

**2. Retrato gerado por script, guardado em Blob privado, lido no servidor.** O script
`scripts/painel-retrato.ts` faz **só `SELECT`** em `ingest_log`, `snapshots` e `projections`, **nunca lê
`snapshots.payload`** (é o campo gordo; só interessa quando e quantos arquivos mudaram) e agrega **por minuto
em BRT**. O resultado é um JSON único, enviado ao **Vercel Blob com `access: 'private'`** em
`painel/retrato-1t-2026.json` — **e só com `--escrever`**; sem a flag o script não grava nada. O JSON
**nunca é commitado**, pela razão do item (c) do Contexto. O server component de `/painel` lê o retrato com
`get()` privado (o `@vercel/blob` instalado, 2.3.3, já tipa `access: 'private'` e `get()`; nenhuma atualização
de pacote). **Nenhum Postgres é consultado no momento da requisição**: o ADR-0001 fica intacto, e a leitura
em Blob é do mesmo gênero que as emendas dos ADR-0026/0032 já admitiram. O caminho carrega o turno; o retrato
do 2º turno é gerado de novo pelo mesmo script (a convenção exata de nome fica para a implementação).
**Plano B, só se a store recusar blob privado:** Blob público com URL secreta, e então esta decisão ganha uma
nota de emenda dizendo, sem rodeio, que a confidencialidade do arquivo passou a ser por obscuridade.

**3. Client components só recebem dados por props.** Importar o retrato — ou o módulo que o lê — num arquivo
`"use client"` é **proibido**: o que um client component importa vira chunk em `/_next/static`, que o
matcher do `proxy.ts` não cobre e que é público. O server component lê, e passa aos clientes apenas as props
de que precisam.

**4. Sem dependência nova.** Os gráficos são SVG à mão, como no resto do projeto. `@vercel/blob` já está na
stack canônica.

**5. Pedidos ao TSE por minuto são estimados; novidades por minuto são exatas.** O `files_fetched` de cada
ciclo é **espalhado** pela duração do ciclo (`duration_ms`) — a página tem de rotular a curva como estimativa.
As novidades por minuto vêm direto de `snapshots` (uma linha por arquivo que mudou) e são exatas.

## Consequências

**Positivas**:
- O dono enxerga a noite do 1º turno minuto a minuto, com os mesmos números que o banco guardou — sem
  depender de logs que a Vercel retém por pouco tempo.
- **Nenhum custo no banco na hora de abrir a página** (só `SELECT` no script, uma vez) e nenhum caminho novo de
  Postgres no read path: o ADR-0001 e a noite do 2º turno ficam como estavam.
- O repositório público não carrega o dado: o código do painel é público, o retrato não.
- Fail-closed: erro de configuração (env ausente) nega acesso em vez de abri-lo.
- O script é reaplicável no 2º turno sem mudança de arquitetura; sem dependência nova; sem escrita em
  nenhuma tabela (constituição § 10 preservada).

**Negativas**:
- **Env nova, `PAINEL_SENHA`, que tem de existir em produção ANTES do deploy** — senão a página fica em 401
  para sempre (inclusive para o dono). É o lado seguro da falha, mas é uma falha.
- **O retrato é fixo e envelhece**: tem de ser regenerado e reenviado no 2º turno; nada o atualiza sozinho.
  A página não deve parecer ao vivo.
- **A curva de pedidos ao TSE por minuto é uma estimativa, não uma medição**: o `files_fetched` é exato por
  ciclo, mas a distribuição dentro do ciclo é uma suposição uniforme — rajadas curtas (o limitador do
  [ADR-0068](0068-limitador-de-taxa-do-tse-por-cargo.md) é um balde de fichas) saem achatadas. Um ciclo que
  morreu antes de gravar a linha de fim não tem totais e só aparece pelo início.
- **A página não mostra os logs de texto da Vercel**, nem o pedido individual a um arquivo do TSE: não dá para
  responder "qual arquivo tomou 429 às 19h42". Passar a guardar esses logs é **pendência para 25/10**, sem
  decisão tomada aqui.
- **Risco aberto — Blob privado não confirmado na store em uso.** Tudo o que o projeto grava hoje no Blob usa
  `access: "public"` (`lib/blob/write.ts:121,181`); o tipo do SDK aceita `'private'`, mas se a **store**
  aceita não foi verificado. A verificação é o primeiro `--escrever`. Se recusar, vale o plano B da Decisão 2
  — que é pior (obscuridade) e exige a nota de emenda.
- **Basic Auth é rústico**: uma senha compartilhada em env; sem logout (o navegador guarda a credencial na
  sessão); sem limite de tentativas — o rate limit complementar do ADR-0009 segue pendente (`proxy.ts:7-8`) e
  o BotID não roda aqui; e `segredoConfere` retorna cedo quando os tamanhos diferem (`proxy.ts:24`), logo o
  **tamanho** da senha vaza por tempo de resposta. Mitigação: senha longa; o conteúdo é metadado operacional,
  sem dado pessoal.
- **A regra da Decisão 3 vive em disciplina de código**: um `import` errado num arquivo `"use client"` vaza o
  retrato para um chunk público em silêncio. A implementação deve travá-la com teste estático, não só
  convenção.
- **Constituição § 4 não abre exceção por a página ser privada**: os gráficos SVG feitos à mão têm de trazer
  fallback de tabela, o que é trabalho a mais.
- O nome "painel" já designa outras coisas nos ADRs (painéis da home, [ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md);
  painel de telão, [ADR-0073](0073-painel-desktop-para-telao-escala-fluida-e-larguras.md)). Aqui é a
  ferramenta de operação em `/painel`; quem ler "painel" sem contexto pode confundir.

## Cross-refs

- ADRs: [ADR-0001](0001-edge-config-no-read-path.md) (Postgres fora do read path — preservado; a leitura em Blob
  segue as emendas de [ADR-0026](0026-cargos-senador-deputado-ingestao-e-read-path.md) e
  [ADR-0032](0032-detalhe-municipal-vercel-blob.md)); [ADR-0009](0009-botid-vercel.md) (BotID segue só em
  `/api/*`; não roda em `/painel`; o cabeçalho e o matcher do `proxy.ts` precisam ser atualizados);
  [ADR-0060](0060-etiquetas-editoriais-fora-do-payload-repo-blob-copia-no-build.md) (precedente de conteúdo no
  Blob fora do payload, publicado por script do dono); [ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md)
  e [ADR-0068](0068-limitador-de-taxa-do-tse-por-cargo.md) (semântica de `notes.cargo`/`fatia`, `waitedMs` e
  `rateLimited` que o painel lê); [ADR-0074](0074-atualizacao-automatica-das-paginas-por-router-refresh.md)
  (a lista de rotas do refresh automático não inclui `/painel`; o retrato é fixo).
- Specs: [spec 012](../../specs/012-dashboard-status/spec.md) (dashboard `/_status`, cortada em 2026-09-18 —
  não substituída; o painel é retrato, sem ações). Nenhuma spec cobre `/painel`: é ferramenta do dono, não
  capacidade de produto.
- Constituição: § 5 (sem PII — as fontes são registros de máquina, o script não lê `snapshots.payload`, e
  Basic Auth viaja em cabeçalho, não em cookie), § 9 (stack 100% Vercel — Blob, proxy e env vars), § 10
  (script só lê; nada é escrito em `snapshots`), § 4 (fallback de tabela nos gráficos).
- NFRs: segurança ([RNF-021](../../nfr/security.md) — `PAINEL_SENHA` como secret de produção; lista de
  implementação do NFR a atualizar), observabilidade ([RNF-032](../../nfr/observability.md) — logs de texto
  não duráveis), SEO (RNF-029 — `/painel` fora de sitemap e indexação).
- Operação: registrar `PAINEL_SENHA` e o roteiro de regeneração do retrato (`scripts/painel-retrato.ts` com
  `--escrever`, depois do 2º turno) em `docs/operations/` ao entrar no ar.
