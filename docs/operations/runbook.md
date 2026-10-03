---
title: Runbook
description: Procedimentos operacionais para incidentes na noite eleitoral
status: stable
source: PRD.md § 19.5
---

# Runbook

## 🚨 Publicar sem depender de nada — a rota de fuga (13/09/2026)

Se no dia D a integração com o GitHub cair, o painel não abrir, ou ninguém estiver logado,
**publicar é uma linha**:

```bash
cd /Users/tiagomenna/Projetos/AtlasMenna
set -a; . ./.env.local; set +a
curl -s -X POST "$VERCEL_DEPLOY_HOOK_URL" | head -c 200
```

O hook `emergencia-dia-d` (id `HkVUtPrjIs`) publica a branch `main` em produção. A URL é
**segredo** — quem a tem publica em produção — e vive em `.env.local` (git-ignored) como
`VERCEL_DEPLOY_HOOK_URL`. Nunca commitar, nunca colar em chat ou ticket.

**Testado em 13/09**, não apenas criado: o disparo produziu um deploy com
`deployHookId=HkVUtPrjIs`, `deployHookRef=main`, commit correto e `target: production`.
Rota de fuga não testada é a coisa que mais falha quando é acionada.

Existe porque a integração Git **já caiu uma vez e ficou 4 meses caída sem ninguém perceber**
(ver `docs/reference/risks.md`). Listar os hooks: `vercel deploy-hooks list`.

Documento operacional com procedimentos para cenários críticos. Versão completa: `RUNBOOK.md` na raiz do repo (a ser criado em F6).

## Verificação pós-deploy (obrigatória)

**Procedimento**: após qualquer deploy em produção, testar a home **manualmente** (não automático).

```bash
# Em navegador, após deploy:
# 1. Abrir https://atlasmenna.online em incógnito
# 2. Confirmar que a página exibe "Aguardando o primeiro boletim…"
# 3. **Não deve exibir resultado com votos reais** (ex: "PT 15.240.321 votos 43,5%")
```

**Por quê**: `app/(pres)/page.tsx` usava uma fixture hardcoded do modelo que renderizava em produção quando não deveria. Risco agora mitigado (verificado em 13/09), mas o fallback de conveniência é pegadio — uma segunda linha de defesa vale. Se vir resultado real em menos de 2 semanas da apuração, é sinal de corrupção no fallback.

**Blocker**: se a home exibir resultado fora de `development`, não prosseguir com qualquer teste no público — dados falsos publicados são violação da constituição § 8.

## 🔴 Regra operacional crítica — jamais dev server durante testes

**NUNCA rodar a suíte de testes (`pnpm test`) com `pnpm dev` em localhost na porta 3000.**

Um servidor em desenvolvimento com credenciais de produção no `.env.local` recebe
os POSTs que a suíte dispara, grava dados sintéticos em produção, e o leitor não
tem como saber. **Ocorreu uma vez em 14/09 às 02:10 UTC** — seis chaves corrompidas
em 9 POSTs antes da detecção.

**Defesas em três camadas**:
1. `tests/setup/no-remote-writes.ts` — suite aborta se detectar attempt de POST
2. `tests/unit/model/conftest.py` autouse — Python também rejeita remotes
3. `app/api/internal/edge-write/route.ts` — 403 quando `NODE_ENV=development`

**Procedimento pré-teste**: confirmar que `pnpm dev` **não** está rodando.

```bash
lsof -i :3000  # deve retornar vazio
```

## Rodar os portões e2e na máquina (21/09/2026)

Os dois portões canônicos — **peso de página** (`tests/e2e/perf-budget.spec.ts`,
RNF-007a/b/c) e **acessibilidade** (`tests/e2e/a11y-audit.spec.ts`) — passaram a
rodar contra um build local. Até 20/09 os dois só existiam por medição manual ou
contra o site publicado.

```bash
pnpm build:e2e      # 🔴 este, NUNCA `pnpm build` — monta com o Global Config falso de pé
pnpm start:e2e      # 🔴 este, NUNCA `pnpm start` nem `pnpm dev` — sobe na porta 3100

# noutro terminal
pnpm test:e2e       # o default do `playwright.config.ts` é http://localhost:3100
```

**Porta 3100, não 3000 (26/09).** A 3000 é a do `pnpm dev`. Com as duas
separadas, um `test:e2e` esquecido nunca audita o servidor de desenvolvimento
(outro bundle, elementos só de dev, outra fonte de dado), e o `start:e2e` sobe
mesmo com um `pnpm dev` de pé.

🔴 **Por que existe um `start:e2e` em vez de `pnpm start`.** O Next carrega o
`.env.local` **sozinho** — ele anuncia `Environments: .env.local` no build —, e a
primeira variável de lá é o `DATABASE_URL` de **produção**. O `start:e2e` declara
vazias as 13 variáveis que dão poder de escrita (banco, Blob, token do Edge
Config, os dois segredos de rota e o deploy hook); o ambiente real vence o
arquivo, então isso basta. **Confirme sempre pelo log do servidor**:

```
[db] DATABASE_URL ausente — db client não está pronto
```

Sem essa linha, você está servindo produção para a suíte de testes — pare.

### O dado dos portões é FIXO (26/09) — o Global Config falso

**Decisão do dono (26/09): os portões usam dado fixo, nunca produção.** Até essa
data o `start:e2e` herdava do `.env.local` o `EDGE_CONFIG` — a string de
LEITURA do Global Config de produção —, então o SSR dos portões lia o payload
publicado: duas execuções mediam páginas diferentes, e um peso ou uma violação
de axe mudava sem o código mudar.

Apagar o `EDGE_CONFIG` **não** resolve, e foi a primeira ideia: fora do
`pnpm dev` a fixture nunca entra (`app/(pres)/page.tsx:564-565` e as guardas
irmãs — o conserto de 13/09, quando o site público mostrou número inventado), e
a página cai em "Aguardando dados". O portão auditaria outra página.

O que o `start:e2e` faz agora:

```
EDGE_CONFIG="http://127.0.0.1:3101/ecfg_e2efalso?token=e2e" \
  tsx scripts/edge-config-falso.ts -- next start -p 3100
```

- `scripts/edge-config-falso.ts` é um servidor HTTP **só de teste**, em
  `127.0.0.1:3101`, que responde as chaves canônicas de
  `lib/edge-config/keys.ts` a partir de `tests/fixtures/simulacao/` —
  `projection-current-{pres,gov,sen,dep}-t1` e
  `projection-uf-<UF>-{pres,gov,sen}-t1` (85 chaves). O SDK oficial aceita
  connection string com host arbitrário, então o app segue pelo caminho de
  PRODUÇÃO (reader, guardas, tudo igual) e só a fonte do dado muda. Nada em
  `app/`, `lib/` ou `components/` importa o script.
- Chave desconhecida ⇒ **404, nunca um default**, com o cabeçalho
  `x-edge-config-digest` que a API real manda para "chave não gravada" (o
  reader lê como `ausente`, não como `falha`). Toda chave desconhecida vai para
  o stderr como `[edge-config-falso] 404 …`.
- O script **recusa subir** — e não sobe o `next` — se o `EDGE_CONFIG` do
  ambiente não apontar para `http://127.0.0.1`.
- O servidor falso morre junto com o `next` (Ctrl-C derruba os dois).

**Confirme pelo log**, além da linha do banco:

```
[edge-config-falso] 85 chaves em http://127.0.0.1:3101/ecfg_e2efalso
```

### O build também lê o falso — `pnpm build:e2e` (29/09)

🔴 **Sem `.env.local`, os portões mediam páginas VAZIAS (achado de 29/09).** O
`start:e2e` já lia o Global Config falso, mas o `.next` saía de um `pnpm build`
— e numa worktree, no CI ou num clone novo não há `.env.local`, logo não há
`EDGE_CONFIG` no build. O Next pré-montava as rotas que leem o Global Config com
`revalidate = 60` — `/`, `/senador`, `/deputado-federal`, `/uf/[sigla]/*` —
como páginas ESTÁTICAS com a casca "Esta página ainda não recebeu dados", e o
`next start` servia essa casca. A regeneração não consertava: o SDK busca com
`cache: "no-store"`, o Next lê isso como uso dinâmico e aborta com "Page changed
from static to dynamic at runtime" (no log do servidor, uma vez por rota).
`/governador` escapava porque já era dinâmica (lê `searchParams`). No checkout
principal o `pnpm build` lia o `EDGE_CONFIG` de **produção** do `.env.local`, as
rotas saíam dinâmicas e o portão acertava — por acaso, e com o build carregando
as variáveis de produção.

O que existe agora:

```
pnpm build:e2e   = (as mesmas 13, com o banco MORTO) EDGE_CONFIG=…3101… \
                   tsx scripts/edge-config-falso.ts --marcar-build -- next build
pnpm start:e2e   = (13 variáveis vazias)             EDGE_CONFIG=…3101… \
                   tsx scripts/edge-config-falso.ts --exigir-build-e2e -- next start -p 3100
```

- **O banco morto.** O build avalia os módulos das rotas de ingestão, e o
  `neon()` lança com `DATABASE_URL` vazio ("No database connection string",
  `Failed to collect page data for /api/ingest/[cargo]`). O `build:e2e` leva
  `postgresql://ninguem:nada@127.0.0.1:9/inexistente` — porta 9 da própria
  máquina, sem ninguém escutando: o módulo carrega, qualquer consulta falharia.
  Nunca o `DATABASE_URL` do `.env.local` (produção). O `start:e2e` segue com ele
  vazio. Um teste unitário confere que essa é a ÚNICA diferença entre os dois
  ambientes (`tests/unit/scripts/edge-config-falso.test.ts`).

- Com o falso de pé no build, o Next marca essas rotas como **dinâmicas (ƒ)**:
  cada requisição lê o dado fixo. É o que o README do SDK diz de qualquer
  leitura com o padrão `no-store`, e o mesmo que o `pnpm build` com o
  `.env.local` já produzia (a tabela de rotas mostra `ƒ /senador`). ISR contra
  um Global Config por HTTP não existe; só o caminho local do SDK (o arquivo
  `/opt/edge-config` das funções da Vercel) evita o `fetch`.
- O build loga `global-config read failed … Dynamic server usage` uma vez por
  rota: é o reader engolindo o sinal com que o Next descobre que a rota é
  dinâmica. Ruído de build, não falha — a tabela de rotas é a prova.
- `--marcar-build` grava `.next/e2e-edge-config.json` com o `BUILD_ID` depois de
  um build que terminou bem. `--exigir-build-e2e` recusa subir sem a marca ou
  com a de outro build (um `pnpm build` comum depois troca o `BUILD_ID`), e
  diz por quê. Confira no log do `start:e2e`:
  `[edge-config-falso] build:e2e <BUILD_ID> conferido`.
- Os dois portões reprovam se o documento trouxer a casca de espera
  (`cascaVaziaNoDocumento`, `tests/e2e/_apoio-local.ts`) — alarme para quem
  voltar a medir sem o `build:e2e`.
- Porta 3101 ocupada (um `start:e2e` de pé) derruba o `build:e2e` com
  `EADDRINUSE`: pare o servidor antes de remontar.

**Primeira execução com dado de verdade (29/09):** suíte inteira em **118
passed / 18 skipped** (1,0 min), das quais 2 são **falhas conhecidas
declaradas** do peso do documento (`test.fail` em `FALHAS_CONHECIDAS_DOCUMENTO`,
`tests/e2e/perf-budget.spec.ts`), ambas anteriores à spec 025 e com as etiquetas
desligadas: `/` com 668.014 B (2,2× o teto de 300 KiB) e `/uf/SP/senador` com
309.446 B (0,7% acima). O teto NÃO mudou; se uma delas voltar a caber, o
Playwright acusa "passou sem esperar" e a entrada sai da lista. As demais rotas
medidas com dado: `/senador` 275.789 B, `/deputado-federal` 271.572 B, `/uf/SP`
287.704 B, `/uf/SP/governador` 268.785 B, `/sobre-as-etiquetas` 82.604 B.

⚠️ **O relógio.** As fixtures só têm turno 1. Depois de 25/10 o calendário
passa a pedir `-t2`, o servidor falso responde 404 (visível no log) e as
páginas presidenciais caem em "Aguardando dados" — o portão volta a auditar
outra página. O `ts` gravado nas fixtures não aciona aviso de dado parado: elas
não trazem `dado_ts`, e sem ele a tela mostra só "Atualizado às HH:MM:SS"
(estado `ausente` de `lib/config/dado-freshness.ts`).

**Regerar a fixture muda o que os portões medem.** Os JSON saem de
`pnpm sim:full`; um peso de página que mudou depois de uma regeneração pode ser
só o dado. Não edite esses arquivos à mão.

**Medir sem os blocos novos** (a "Medição A" de 26/09): o script aceita
`--sem-blocos-novos`, que tira NA RESPOSTA `votacao.corrida`,
`votacao.corrida_por_partido` e `votacao.destino_pendente` dos nacionais e o
`votacao` inteiro das UFs. Não é modo de uso corrente — para rodá-lo, repita o
ambiente do `start:e2e` e passe a flag antes do `--`.

Primeira execução (21/09): **10/10** no peso em 7 s, **64/64** na
acessibilidade em 42,6 s, e a suíte e2e inteira em **98 passed / 14 skipped**
(47,8 s), rodada exatamente por estes dois comandos.

### O Blob e o interruptor também — spec 026 (29/09)

🔴 **`/uf/SP/deputado-federal` era medida SEM a parte que pesa.** O detalhe de
Deputado por UF mora no Vercel Blob (`deputado/uf/<UF>.json`, lido por
`readDeputadoUfDetail`), e os dois scripts zeram `BLOB_READ_WRITE_TOKEN` — sem
ele, `blobPublicBaseUrl()` devolve `null` e a página rendia "Detalhe
indisponível". Com a spec 026 essa página ganha as listas por agremiação (60
por agremiação no documento) e um teto de peso PRÓPRIO de **480 KiB**
(ADR-0065 D5, `TETO_DOCUMENTO_POR_ROTA` em `tests/e2e/perf-budget.spec.ts`).

O que mudou nos dois scripts:

- `BLOB_PUBLIC_BASE_URL="http://127.0.0.1:3101/blob"` — o override que
  `lib/blob/paths.ts` já tinha para os testes. O servidor falso responde como o
  CDN público do Blob sob `/blob/`: `deputado/uf/<UF>.json` (de
  `tests/fixtures/simulacao/deputado-uf.json`) e `deputado/uf-lista/<UF>.json`
  (de `deputado-uf-lista.json`, quando o simulado passar a emiti-lo). Ele
  recusa subir se `BLOB_PUBLIC_BASE_URL` apontar para qualquer outro lugar.
- `--projecao-ligada` — serve `interruptor-projecao-dep = {ligada: true}`, o
  estado pretendido da noite (e a página mais pesada). Sem a flag, a chave fica
  AUSENTE, que é DESLIGADA (ver § interruptor abaixo). `--projecao-desligada`
  mede a página sem projeção.
- O portão de peso reprova se `/uf/SP/deputado-federal` trouxer alguma das
  frases de "detalhe indisponível" — sinal de que o Blob não foi servido.

⚠️ **Efeitos fora de Deputado, todos na direção de produção:** (1) com a base
do Blob definida, as páginas passam a emitir `<img>` de foto de candidato — a
URL existe, o arquivo não (404 do falso, não logado); (2) o detalhe municipal
de `/uf/SP*` passa de "não configurado" a "não publicado" (mesma caixa, outra
frase); (3) as etiquetas tentam o Blob e caem na cópia do build. Um peso de
documento dessas rotas que mudou depois de 29/09 pode ser isso.

### O que estava quebrado, e o que o registro antigo dizia de errado

`checkBotId()` (`proxy.ts`) **lança** fora da Vercel, o matcher do proxy é
`/api/:path*`, e o Next responde **500 com um corpo que nunca fecha**. A
requisição fica em voo para sempre, então `waitForLoadState("networkidle")`
nunca resolve — testado até 60 s. E como `PersistentMapFrame` renderiza o
esqueleto enquanto não tem payload, o mapa nunca montava e o **RNF-007b media
0 B sem ninguém notar**.

⚠️ O diagnóstico anterior (cabeçalho do spec de a11y, handoffs de 18 e 21/09)
dizia "a página consulta em laço" e "o mapa fica pedindo tiles de domínio
bloqueado". **As duas coisas são falsas**: a página consulta UMA vez, e nenhum
tile é pedido. Está vencido; a versão medida vive em `tests/e2e/_apoio-local.ts`.

### Por que o conserto não está em `proxy.ts`

`checkBotId()` não tem como funcionar fora da Vercel — qualquer guarda no código
de produção (`if (!process.env.VERCEL) pular`) some com a proteção em silêncio se
a variável faltar num deploy real. O remendo fica na suíte, em
`tests/e2e/_apoio-local.ts`, e **só é instalado quando o alvo é localhost**:
contra o site publicado nada muda.

### ⚠️ Duas ressalvas para quem for citar um número daqui

1. **~~A página tem duas fontes de dado~~ — resolvido em 26/09.** Até essa
   data o stub de `_apoio-local.ts` servia o `fetch` do cliente com a fixture do
   simulado, mas o SSR lia o **Global Config de produção**. Agora as duas
   pontas leem `tests/fixtures/simulacao/` (ver "O dado dos portões é FIXO"
   acima). O preço: o SSR de produção exercitava de graça o caminho de "nome
   ausente" ("Candidato 13"), e a fixture do simulado preenche
   `candidatos[].nome` em todo cargo — esse caminho agora só é coberto pelo
   vitest. E um número medido aqui é do SIMULADO, não do site: pesos de 26/09
   em `/` foram 391.710 B lendo produção e 510.219 B lendo a fixture.
2. **Build local ≠ build da Vercel.** A referência continua sendo
   `PLAYWRIGHT_BASE_URL=https://atlasmenna.online`. O cruzamento dá confiança:
   o chunk do MapLibre mediu **285,0 KiB** local contra **285,3 KiB** publicados
   em 18/09.

## 🔴 Regra operacional crítica — `ALLOW_DB_WRITE_TESTS` (17/09/2026)

**Cinco testes de integração escrevem de verdade** no banco apontado por `DATABASE_URL`:
`tests/integration/model-edge-cases`, `model-cycle`, `ingest-cycle`, `ingest-model-trigger` e
o bloco de lock de `ingest-routes-auth-cargo`. Em `.env.local` esse banco é **produção** — o
mesmo que vai guardar a apuração de 04/10.

**O que aconteceu em 17/09**: até então o único freio era a **ausência** de `DATABASE_URL`.
Alguém carregou o `.env.local` para conferir uma migration, rodou `npx vitest run`, e
**1.877 linhas de harness** ficaram no banco de produção — **1.233** sob cargos que não
existem (91, 92, 93) e **644 sob o cargo REAL 1**, com as candidaturas sintéticas 101 e 102
ao lado das candidaturas de verdade. O resíduo cresceu por meses sem ninguém notar porque o
cleanup filtrava por `uf IN (…)` e `IN` nunca casa com `NULL`: as linhas de escopo
**nacional** (`uf IS NULL`) — justamente as que o modelo cria a cada ciclo — nunca eram
apagadas.

**Como está agora**: a escrita exige `ALLOW_DB_WRITE_TESTS=1` **declarado**, com igualdade
exata a `"1"` (`=true`, `=0` ou vazio não liberam nada). O ponto único de decisão é
`tests/integration/_guarda-banco.ts` (`podeEscreverNoBanco()`); sem autorização os blocos
viram `describe.skip` com o motivo na mensagem. A guarda **não** tenta adivinhar "isto é
produção" pelo host — adivinhação com default permissivo é a rede de mão única que este
repositório já pagou caro.

**Como rodá-los de propósito** — só contra um banco descartável, nunca o de `.env.local`:

```bash
DATABASE_URL='postgres://…/banco-descartavel' ALLOW_DB_WRITE_TESTS=1 \
  npx vitest run tests/integration/model-cycle.test.ts
```

⛔ **Não declare `ALLOW_DB_WRITE_TESTS` com o `.env.local` carregado no shell.** As duas
coisas juntas — variável declarada + `DATABASE_URL` de produção — reproduzem exatamente o
incidente, e desta vez com autorização explícita. Se você precisa das duas na mesma sessão,
abra outro terminal.

**Como conferir resíduo de harness no banco**: ver
[Série por candidatura](#série-por-candidatura--o-que-é-gravado-a-cada-ciclo-spec-020).

**Rede antes do commit**: `core.hooksPath=.githooks` está ativo desde 17/09 — o
`.githooks/pre-commit` roda `biome check` na árvore inteira e **aborta o commit** se
reprovar. `--no-verify` exige ordem explícita do dono (CLAUDE.md § 11).

## `DATABASE_URL_CI` — o banco que o CI usa (19/09/2026)

O job `test` de `.github/workflows/ci.yml` aborta de propósito, em ~37 s, quando o segredo
`DATABASE_URL_CI` não existe (`ci.yml:152-162`). O comentário daquele passo remetia a este
runbook, que **não documentava o procedimento** — lacuna fechada aqui.

**Por que o CI precisa de banco**: 10 arquivos de teste tocam o Postgres e esperam dado
real (eleitorado por zona, ≥ 20.000 linhas históricas de 2018 e 2022). Um Postgres vazio com
as migrations aplicadas reprova todos, e a causa fica escondida atrás de falhas genéricas —
por isso o guarda falha antes, com o nome certo.

### Como recriar o banco do CI

1. **Neon → Branches → New Branch**, no projeto do AtlasMenna.
   - **Name**: `ci`
   - 🔴 **Auto-delete: Never.** O default da caixa de diálogo é *After 1 day*. Com o default,
     o CI volta a quebrar no dia seguinte — e **pior do que hoje**: em vez da mensagem
     nomeada do guarda, o sintoma vira erro de conexão, que não diz o que houve.
   - **Parent branch**: `main`
   - **Branch data and schema** (não *schema only*, que reprova os 10 arquivos; não
     *anonymize*, que embaralharia justamente os números conferidos pelos testes — e não há
     PII aqui, é resultado eleitoral público, constituição § 5).
2. Copiar a string **com `Connection pooling` LIGADO** (host com sufixo `-pooler`).
3. Cadastrar como segredo do repositório:

```bash
gh auth switch --user sudomenna
gh secret set DATABASE_URL_CI --repo sudomenna/atlasmenna
```

### Por que a string COM pooling

Medido em 19/09, não inferido:

- O CI consome `DATABASE_URL` num lugar só — o passo `Unit tests` (`ci.yml:164-167`), que
  chega em `lib/db/index.ts:5-19` pelo driver HTTP `@neondatabase/serverless` + `neon-http`.
  É o caso de uso do endpoint com pooler.
- `DATABASE_URL_UNPOOLED` é lido **apenas** por `data-pipeline/_tse-common.ts:35` e
  `data-pipeline/ibge-import.ts:49` — importadores que o CI não executa.
- Nada no código depende de sessão longa: zero ocorrências de `pg_advisory`, `LISTEN`,
  `NOTIFY` ou `prepare(` em `lib/`, `api/` e `tests/`. São essas as construções que o
  pgbouncer em modo transação quebra.
- Produção usa o endereço com pooler. CI numa configuração diferente da real testaria
  outra coisa.

### Duas garantias que valem reconferir se alguém mexer no workflow

- **O CI não declara `ALLOW_DB_WRITE_TESTS`** — conferido em 19/09, zero ocorrências em
  `ci.yml`. Os cinco testes de escrita seguem desligados lá, e o branch `ci` não vira lixo.
  Ver a regra completa em
  [`ALLOW_DB_WRITE_TESTS`](#-regra-operacional-crítica--allow_db_write_tests-17092026).
- **O passo do pytest NÃO recebe `DATABASE_URL`, e a ausência é deliberada** (`ci.yml:130-138`):
  os testes do modelo não tocam banco. Não "conserte" isso passando a variável.

⚠️ **`gh secret list` não serve para conferir se o segredo existe**: com token sem a permissão
de segredos ele responde **HTTP 403**, indistinguível de lista vazia para quem não olha o
código de saída. A evidência boa é o log do passo "Conferir o segredo do banco": se o segredo
faltar, `DATABASE_URL:` aparece **vazio** no ambiente do passo.

## Cenários cobertos

- **TSE indisponível** (>60s, >5min, >15min) — diagnóstico, banner, escalada.
- **Modelo retornando NaN** — fallback para último valor, alerta.
- **Cache hit ratio caindo** — investigar invalidação descontrolada.
- **Rollback de release** — Rolling Release reverter via dashboard.
- **Pico de tráfego acima do esperado** — monitorar billing, ativar plano emergencial CF.

## Conformidade TSE (RF-010 — spec 001)

> **Fonte de verdade**: [ADR-0020 — Conformidade com a Res. TSE 23.751/2026 sem cadastro prévio](../architecture/adrs/0020-conformidade-res-23751-2026.md).
> Esta seção é o **resumo operacional** do ADR. Onde divergirem, o ADR vence — não duplique o raciocínio dele aqui.

### Os dois fatos que mudaram (05/09/2026)

1. **Não existe cadastro.** Para o pleito 2026 **não há** registro, inscrição, homologação ou aprovação de "interessado na divulgação". Os arquivos são públicos no CDN e qualquer entidade pode consumi-los, sujeita às obrigações dos arts. 264–269. O termo "entidade interessada" no material oficial é **descritivo**, não um status administrativo a obter. Toda menção anterior a "cadastro pendente / aprovado" nesta documentação (redigida em maio/2026) partia de analogia com a Res. 23.736/2024 e **estava errada**.
2. **A norma vigente está publicada**: **Res. TSE nº 23.751/2026, Título III, Cap. VI, arts. 264–269**. Não há "watch de publicação" a manter — o que resta é cumprir o que já está em vigor.

### Obrigações vigentes (o que a operação precisa garantir)

| Obrigação | Origem | Como cumprimos hoje |
|---|---|---|
| **Não alterar o conteúdo dos dados** distribuídos pela Justiça Eleitoral | **Art. 267 § 4º** | `snapshots.payload` guarda o envelope EA20 **cru**, como recebido; nunca há `UPDATE` (constituição § 10). A projeção estatística é **conteúdo derivado**, gravado em `projections`, nunca sobre o registro do dado oficial. |
| Rotular a projeção como **não oficial** | Art. 267 § 4º + constituição § 1 | Footer "Não oficial. Fonte: TSE." em toda superfície; a projeção precisa ser **inconfundível** com o resultado oficial. |
| Buscar os arquivos **periodicamente**, conforme os padrões da Justiça Eleitoral | Art. 267 § 3º | Cron de 60 s (ADR-0011) dentro de `INGEST_WINDOW`, com rate limiter de saída. |
| Infraestrutura de comunicação por conta da entidade | Art. 267 § 2º | Vercel + Neon; nenhuma dependência de recurso do TSE além do CDN público. |
| Não majorar preço de serviço em razão dos dados do TSE | Art. 268 | AtlasMenna é gratuito e público. |
| Distinguir **válidos / anulados / anulados sub judice** | **Schema do EA20** (`v.vvc = v.vv + v.van + v.vansj`) — ver ADR-0020, "Consequências" | Denominador de "% dos votos a votáveis" derivado de `vvc`, nunca de `v.tv`. ⚠️ ADR-0020 **não conseguiu confirmar** um parágrafo específico da resolução que imponha isso — trate como **requisito de schema**, não cite artigo. |
| Presidente só a partir das **17h de Brasília** | Art. 265 § 1º | `INGEST_WINDOW` default `17-04`. |
| Descumprir o capítulo → **perda de acesso** ao centro de dados | Art. 269 | É a razão de as invariantes técnicas abaixo serem invioláveis. |

### Invariantes técnicas (ADR-0020 — não relaxar sem novo ADR)

- **Rate limiter de saída sempre ativo** — teto **por cargo** (`lib/config/cargos.ts`, campo `rpsMax`): **25 rps** para Presidente, Governador e Senador e **5 rps** para Deputado Federal (os quatro em zona, 6.110 alvos cada; o cargo 6 varre em 6 fatias de ~1.019, ADR-0036). Ceiling 50, só alcançável com `TSE_MAX_RPS` explícita em janela supervisionada. Pior caso agregado dos quatro crons simultâneos: **80 rps** (25+25+25+5). O limite documentado do TSE é **100 req/s por IP → bloqueio de 10 minutos, renovado** a cada nova violação durante o bloqueio.
- **429 e 503 são retryáveis**, honrando `Retry-After` — um bloqueio de 10 min não pode derrubar o ciclo em silêncio.
- **Proibição absoluta de sondar URLs adivinhadas** contra `resultados.tse.jus.br` ou `resultados-sim.tse.jus.br` — ver a advertência em [Testes manuais de alerting](#testes-manuais-de-alerting-t21-spec-001).
- **Envelope Zod em `.passthrough()`, nunca `.strict()`** — o TSE não anunciou freeze de leiaute.

### User-Agent

O UA atual (`lib/tse/client.ts`, constante `USER_AGENT`) é **honesto** e só identifica o produto e a URL pública:

```
AtlasMenna/1.0 (+https://atlasmenna.online)
```

O valor de maio — `AtlasMenna/1.0 (interessado-divulgacao-cadastrado)` — declarava um cadastro **inexistente** e foi removido; **nunca reintroduzir** menção a cadastro (ADR-0020). **Não há e-mail no UA desde 03/10**: a caixa de contato que constava antes nunca existiu (o domínio de então nunca teve registro MX), e declarar uma caixa que não recebe nada não é identificação verificável. Se uma caixa real for criada, ela volta ao UA — e o teste literal de `tests/unit/tse/client.test.ts` cai junto.

- **Owner**: Tiago Menna (menna@outsiders.digital).
- Os importadores de dados abertos (`data-pipeline/_tse-common.ts`, `TSE_ETL_USER_AGENT`) usam `AtlasMenna-ETL/0.1`, sem URL nem e-mail: o WAF de `cdn.tse.jus.br`/`dadosabertos.tse.jus.br` bloqueia essa forma. O vigia (`scripts/tse-watch.ts`) usa `AtlasMenna-watch/1.0`.

### Triggers que invalidam esta seção

- TSE publica **errata ou nova resolução** sobre divulgação → reler arts. 264–269, despachar `adr-author` para supersedir o ADR-0020.
- TSE sinaliza **mudança de leiaute** em simulado → diff técnico contra [docs/reference/tse-2026-leiautes.md](../reference/tse-2026-leiautes.md); `pnpm tse:watch` detecta mudança nas 9 páginas técnicas.
- **Bloqueio de IP observado** (429 sustentado, ou silêncio de 10 min) → reduzir `TSE_MAX_RPS`, abrir incidente, registrar em [docs/testing/tse-simulados.md](../testing/tse-simulados.md).

## Alarme de dado parado — limiares por cargo (ADR-0038 D3)

**Quando dispara**: O último boletim TSE recebido (`dado_ts`, extraído de `dg`/`hg` do envelope EA20) ficou mais de **3× a cadência do cargo** atrás do `now()` no servidor.

| Cargo | Cadência | Limiar de alarme |
|---|---|---|
| Presidente / Governador (1, 3) | 60s | **180s** (3 min) |
| Senador (5) | 300s (5 min) | **900s** (15 min) |
| Deputado Federal (6) | 1.800s (30 min) | **5.400s** (90 min) |

**O que acontece**:
1. A cada ciclo do modelo, `api/model/project.py` computa `now() - dado_ts` e compara ao limiar.
2. Se excedido, chama `_alert_slack("error", "dado do TSE parado", cargo=..., turno=..., dado_ts=..., lag_seconds=...)`.
3. `_alert_slack` verifica se `SLACK_WEBHOOK_URL` está configurada em `os.environ`.
   - **Se sim**: envia para Slack (canal a definir antes de produção).
   - **Se não**: loga como "slack alert skipped" — nenhum erro, nenhuma exceção.

**UI associada**: O componente `<DadoParadoBanner />` (planejado, ADR-0038 D4) renderiza um banner amarelo quando `dado_ts > limiar_do_cargo` no payload recebido, com mensagem tipo "Os dados do TSE não avançam há X min — a página segue mostrando o último apurado conhecido".

**Status atual (13/09/2026)**: Alarme **implementado no backend, inerte sem `SLACK_WEBHOOK_URL`**. `SLACK_WEBHOOK_URL` ainda não está configurada em Vercel — **decisão pendente do dono do projeto** sobre qual canal Slack (ou webhook de outro sistema) receber os alertas.

**Quando ativar**: Antes de qualquer corrida real (simulado 15/09 ou 1º turno 04/10), configurar `SLACK_WEBHOOK_URL` em Settings → Environment Variables (Vercel).

## Testes manuais de alerting (T21 spec 001)

> ### ⛔ Nunca force um erro contra o CDN do TSE
>
> **Regra inviolável do projeto** (ADR-0020, [handoff 2026-09-05](../_meta/handoff-2026-09-05.md)):
> **é proibido apontar o pipeline para uma URL inválida, inexistente ou adivinhada** em
> `resultados.tse.jus.br` ou `resultados-sim.tse.jus.br` — inclusive "só para testar um alerta".
>
> O material oficial do TSE afirma que uma **requisição malformada (404) também pode gerar bloqueio de IP
> por 10 minutos**, e **o limiar não é divulgado** — não há como calibrar "quantos 404 são seguros",
> e não há como testar isso com segurança. Durante o simulado ou o dia D, 10 minutos de bloqueio
> significam 10 ciclos perdidos e a home congelada.
>
> Isso inclui, explicitamente: `TSE_TARGETS_WHITELIST` com UF/cargo inexistentes, `TSE_COD_ELEICAO`
> chutado, `curl` manual em um path "provável", e qualquer varredura para "descobrir" o que existe —
> **não há índice de arquivos no CDN**; descoberta legítima vem só do `ele-c.json` (EA11) e dos
> arquivos de acompanhamento EA14/EA15.
>
> **Versão anterior deste runbook ensinava exatamente isso** (`TSE_TARGETS_WHITELIST=ZT:9`, "UF
> inexistente"). A técnica foi **removida** — se você a encontrar em qualquer outro documento, é um
> resquício de maio/2026 e deve ser reportado.
>
> **A alternativa correta**: todo teste de ingestão, alerta, retry ou erro roda contra o **mock local
> do CDN** (`scripts/tse-mock-server.ts`), que serve o layout de URL real a partir das fixtures e
> sabe simular 404, 429 e latência sob demanda. Ver [Ferramentas](#ferramentas-do-pipeline-tse).

### Forçar alerta de lag (`tse.lag_seconds > 60`)

1. No preview Vercel, garantir env `SLACK_WEBHOOK_URL` apontando pra `#atlasmenna-ops` (ou canal de teste).
2. Setar `INGEST_WINDOW_OVERRIDE=true` e `CRON_ENABLED=true` no preview.
3. Servir uma fixture com `dg/hg` 2 horas no passado (ex.: `dg="04/10/2026", hg="18:00:00"` num teste rodado às 20:00 BRT) — apontar `TSE_BASE_URL` para o mock local, ou seedar `snapshots` com `payload.dg/hg` antigos. **Formato de `dg` é `dd/mm/aaaa`** (EA20 § dicionário de dados); `ddMMyyyy` é legado tolerado por `calculateLagSeconds`, não o formato real.
4. POST manual para `/api/ingest` com `x-cron-secret` correto:
   ```bash
   curl -X POST -H "x-cron-secret: $CRON_SECRET" \
     https://<preview-url>/api/ingest
   ```
5. Confirmar mensagem `[WARN] tse.lag_seconds > 60` em `#atlasmenna-ops`.

### Forçar alerta de erros (`>= 3 erros consecutivos`)

Sempre contra o **mock local**, nunca contra o TSE:

1. Subir o mock com uma fração determinística de 404 (ou com rate limit agressivo, para exercitar o caminho de 429):
   ```bash
   pnpm tse:mock --port 8787 --not-found-ratio 1.0     # todo target 404
   # ou:  pnpm tse:mock --port 8787 --rate-limit-after 3   # 429 + Retry-After a partir do 4º GET
   ```
2. Rodar o ingest apontado para ele:
   ```bash
   TSE_BASE_URL=http://localhost:8787/oficial TSE_COD_ELEICAO=ele2022/544 \
   INGEST_WINDOW_OVERRIDE=true TSE_MAX_RPS=10 pnpm dev
   curl -X POST localhost:3000/api/ingest -H "x-cron-secret: $CRON_SECRET"
   ```
3. Confirmar mensagem `[ERROR] 3 erros consecutivos no ciclo` em `#atlasmenna-ops` (com `SLACK_WEBHOOK_URL` setada localmente) e os contadores `notFound` / `rateLimited` na resposta JSON.

### Não disparou?

Checklist:
- [ ] `SLACK_WEBHOOK_URL` setada e válida (testar com `curl` direto)
- [ ] `CRON_SECRET` correto no header
- [ ] Janela aberta ou override ativo
- [ ] Verificar logs Vercel (`vercel logs`) — webhook timeout (3s) faz fire-and-forget falhar silenciosamente

## Candidatos — importação de cadastro (spec 018, RF-152)

**Escopo**: Importação recorrente do Portal de Dados Abertos do TSE (candidatos + fotos + partidos). Roda fora do request path, como `eleitorado-import` e `zonas-import`.

### Cadência

- **Até ~20/09**: Diária (oportunista, sem aviso prévio)
- **21/09 até 01/10**: A cada 2–3 dias
- **02–03/10**: **Obrigatória** — última janela de confirmação antes da apuração (ADR-0040, RF-152)

### Como rodar manualmente

```bash
set -a; . ./.env.local; set +a
pnpm candidatos:import [--force]
```

Internamente usa `tsx` — o loader de strip-types não resolve o alias `@/` que
`lib/blob/write.ts` usa, e falharia antes da primeira linha. Mesmo motivo de
`pnpm edge-config:smoke` e `pnpm replay-2022`.

**Argumentos**:
- Sem flag: baixa arquivos do TSE se houver mudança detectada via header `Last-Modified` (GET Range). Se nenhuma mudança, ciclo para sem escrever.
- `--force`: ignora `Last-Modified` e reimporta tudo (use só em emergência ou em 02–03/10 se o ciclo anterior falhou).

### Saída esperada (13/09)

```
[0008] ok: candidatos
[0008] ok: partidos
[0008] ok: ix_cand_cargo_uf
[0008] ok: ix_cand_publicavel
[0008] ok: ix_cand_busca
[0008] candidatos: 20939 linhas, 7698 publicáveis nos 4 cargos
[0008] partidos: 30 registros
[candidatos-import] Frescor: <data/hora> (Last-Modified do TSE)
[candidatos-import] Publicáveis: 7698 (limite 2%: 7544 mín)
[candidatos-import] Fotos: 387 encontradas no Acre (amostra), 0 órfãs
[candidatos-import] Blob: <N> fotos gravadas em candidatos/foto/<UF>/
[candidatos-import] Fatias: 82 candidatos/uf/<SIGLA>/<cargo>.json gravadas
[candidatos-import] Ciclo completo: <duração>
```

⚠️ **O índice `candidatos/index.json` NÃO é publicado pelo importador.** Quem publica
é `data-pipeline/candidatos-publish.ts` (ver seção abaixo).

### Guarda de encolhimento (RF-152)

Se uma reimportação produzir **menos de 98%** da contagem anterior, o ciclo **aborta** e publica um alerta (sem alterar o Blob):

```
[candidatos-import] AVISO: encolhimento detectado
  Anterior: 7698 publicáveis
  Novo:     7540 publicáveis
  Queda: 2,07% (máximo permitido: 2%)
  Ação: use --force para confirmar a mudança, ou investigue
```

### Onde olhar em emergência

Se o ciclo disso errado:

1. **Logs**: `pnpm candidatos:import 2>&1 | tee /tmp/import-log.txt`
2. **Banco**: `psql $DATABASE_URL -c "SELECT COUNT(*), COUNT(*) FILTER (WHERE publicavel) FROM candidatos;"`
3. **Blob**: `vercel env pull` + ler Vercel Blob storage (bucket `candidatos`) via CLI da Vercel
4. **Index**: `curl https://<BLOB-URL>/candidatos/index.json`

Se o Blob ficou corrompido mas Postgres está OK:

```bash
# Reescrever só as fotos e o index:
node --experimental-strip-types data-pipeline/candidatos-import.ts --skip-db --force
```

(Nota: `--skip-db` ainda não existe em 13/09 — será adicionado se necessário em operação real.)

### Publicação das fatias e índice (pós-importação)

**Quem publica**: `data-pipeline/candidatos-publish.ts` (script `pnpm candidatos:publish`).

**Quando rodar**: **DEPOIS** do importador de fotos concluir com sucesso. A ordem crítica é:

| # | Comando | O que faz | O que NÃO faz |
|---|---|---|---|
| 1 | `pnpm candidatos:import` | Baixa os dois CSVs do TSE e grava **só no Postgres** (tabelas `candidatos` e `partidos`). Deixa `foto_ok = false` em todas. | **Não toca no Blob.** Não baixa foto. Não publica nada visível. |
| 2 | `pnpm candidatos:fotos` | Baixa os 28 ZIPs de foto, sobe os JPEGs para `candidatos/foto/<UF>/<sqcand>.jpg` no Blob e marca `foto_ok = true` no Postgres. | Não republica as fatias — quem lê as fatias continua vendo o `foto_ok` antigo. |
| 3 | `pnpm candidatos:publish` | Lê o Postgres e escreve **as 82 fatias `candidatos/uf/<UF>/<cargo>.json` E o `candidatos/index.json`** no Blob. É o único passo que torna o dado visível ao site. | — |

⚠️ **A ordem não é sugestão.** O passo 3 fotografa o estado do banco no instante em que roda. Se rodar
antes do passo 2, as fatias saem com `foto_ok: false` para todo mundo, e os cartões caem no avatar de
iniciais **mesmo com as fotos já no ar** — sem erro, sem alarme, só errado na tela. Já aconteceu em
13/09: a primeira publicação pegou 446 de 7.698 fotos porque as duas trilhas rodavam em paralelo.

Corolário: **toda vez que o passo 1 ou o 2 rodar de novo, o passo 3 precisa rodar depois.**

> **Ainda não documentado aqui: o seed de fase pré-eleição** (`projection-seed`, `edge-config-prune`).
> Os comandos **não existem** — a spec 019 os especifica e ainda não foi implementada. Este manual
> descreve só o que se pode rodar hoje; comando documentado que não existe é pior que comando não
> documentado, porque quem procura não sabe se quebrou ou se nunca existiu. Quando a 019 entregar,
> a seção entra aqui com os números medidos.

### ⚠️ Publicar não é o mesmo que aparecer — a janela de 12 horas

`lib/blob/candidatos.ts` lê a fatia com `next: { revalidate: 43_200 }`
(`CANDIDATOS_REVALIDATE_SECONDS`). Depois de `pnpm candidatos:publish`, **o site continua
servindo a fatia anterior por até 12 horas**, sem erro e sem aviso — a página renderiza
normalmente, só com o dado velho.

Medido em 13/09, e custou uma hora de diagnóstico: as fotos estavam no ar, a fatia publicada
dizia `foto_ok: true`, e a tela mostrava iniciais. A mesma URL devolvia corpos diferentes para
`curl` (versão nova) e para o servidor Next (versão anterior, retida no Data Cache). Apagar
`.next/cache` **não basta** — só `rm -rf .next` inteiro liberou.

| Leitor | `revalidate` | Consequência |
|---|---|---|
| `lib/blob/candidatos.ts` | **43.200 s (12 h)** | O TSE republica 1×/dia, então revalidar 2×/dia cobre toda novidade da fonte. Decisão do dono do produto em 13/09. **A defasagem só é honesta porque a tela carimba `fonte_ts` — se o carimbo sair, vira mentira.** |
| `lib/blob/uf-detail.ts` | 60 s | Apuração. **Não afetado** pela janela longa. |
| `lib/blob/deputado-uf.ts` | 60 s | Apuração. **Não afetado.** |

**Na noite de 04/10 isto não atrapalha a apuração** — os dois leitores do resultado usam 60 s. A
janela de 1 h vale só para o cadastro de candidaturas.

**Como verificar que o dado novo chegou** (em vez de confiar que chegou):

```bash
# o que o Blob tem agora
curl -s https://<store>.public.blob.vercel-storage.com/candidatos/index.json | grep -o '"gerado_ts":"[^"]*"'
# o que a página está mostrando — compare o carimbo de frescor na tela
```

Se precisar do dado imediatamente em produção, o caminho é **um redeploy** (que zera o Data
Cache), não esperar. Com 12 h de janela, esperar não é opção prática: nos dias até 04/10, em que
o cadastro é reimportado quase todo dia, **publicar sem redeploy significa o site mostrar a lista
de ontem o dia inteiro.**

➜ **Regra operacional**: `candidatos:publish` e redeploy andam juntos. Publicar sozinho não
chega ao leitor dentro do mesmo dia.


**Como rodar manualmente**:

```bash
set -a; . ./.env.local; set +a
pnpm candidatos:publish
```

Roda com `tsx` (mesmo motivo de `candidatos:import` acima). Saída esperada:

```
[candidatos-publish] Lendo snapshot do banco...
[candidatos-publish] Publicáveis por cargo/UF: <contagem>
[candidatos-publish] 82 fatias gravadas (maior: candidatos/uf/SP/dep.json, 211,6 KB)
[candidatos-publish] Índice gravado: candidatos/index.json (<bytes> bytes)
[candidatos-publish] Publicação concluída
```

### Armadilha: User-Agent e bloqueio do TSE

O download dos arquivos usa `TSE_ETL_USER_AGENT` de `data-pipeline/_tse-common.ts:70`. Atualmente:

```
AtlasMenna-ETL/0.1
```

**Se a Akamai bloquear o download com 403**, adicionar o field de contato (atualmente pendente):

```
AtlasMenna-ETL/0.1 (contato: menna@outsiders.digital)
```

Mas primeiro **verifique se a URL de base está correta** (deve ser `https://cdn.tse.jus.br/`, não outro host).

## Carregar o eleitorado do DF (2026-09-27)

**Problema**: `eleitorado` (Postgres) não tem o DF. A fonte de `eleitorado-import.ts`
é o CSV de eleitorado da eleição **municipal** de 2024, e o DF não elege prefeito —
não aparece no CSV. Efeito no modelo: `_resolve_zone_weight`
(`api/model/project.py:2510-2528`) dá peso 0 a toda zona do DF, então
Governador/Senador do DF ficam "aguardando projeção" a noite inteira mesmo com
100% apurado, e Presidente-DF fica com `pct_apurado` travado em 0 (os votos reais
são descartados). `zonas` **já tem** os 19 pares do DF (recuperados de
`historical_results` por `zonas-import.ts`, fonte `'historico'`) — só falta o
PESO, que vive em `eleitorado.eleitores_aptos`.

**Fonte**: fixtures reais do simulado TSE 2026, 2ª janela (22–24/09), baixadas em
27/09 — `tests/fixtures/tse/2026-sim/df/` (ver o README da pasta para proveniência
completa e a ressalva sobre AC/AP).

**Script**: `data-pipeline/eleitorado-df-import.ts` (`pnpm db:eleitorado:df`). Lê
só as fixtures locais — nenhum fetch em runtime. Valida: as 19 zonas lidas ==
lista oficial do EA12 para o município 97012; `Σ te` das zonas == `te` do
agregado de UF; toda zona com `te > 0`. Modo padrão é **simulação** (imprime as
19 linhas e sai sem conectar no banco).

```bash
# 1. Simulação — confere os números sem tocar o banco:
pnpm db:eleitorado:df

# 2. Escrita — só depois de conferir a simulação acima:
set -a; . ./.env.local; set +a
pnpm db:eleitorado:df --escrever
```

A escrita é restrita a `uf='DF'` (nunca lê nem grava outra UF) e usa
`INSERT ... ON CONFLICT DO NOTHING`. Se já existirem linhas do DF em
`ano=2026` com valores **diferentes** dos calculados, a escrita **aborta**
listando a diferença — não sobrescreve. Se os valores já baterem, ela não faz
nada (idempotente).

**Conferência pós-escrita**:

```sql
SELECT uf, count(*), sum(eleitores_aptos) FROM eleitorado WHERE uf='DF' GROUP BY uf;
-- esperado: DF | 19 | 2.187.571
```

Depois de carregado, rode `zonas-import.ts` de novo **não é necessário** — os
pares do DF já estão em `zonas` desde a migration 0006. O que muda é só o peso
em `eleitorado`, que o modelo (`fetch_eleitorado`, `api/model/project.py:518`)
lê com `ano=2026` — a mesma convenção que as outras 26 UFs já usam mesmo vindo
de fonte de 2024.

## Zonas faltantes (2026-09-29)

**Problema**: `zonas` (pares município × zona) decide QUAIS arquivos EA20 pedimos ao TSE, para
todos os cargos (`lib/tse/targets.ts`). Medido em 29/09 contra o EA12 do simulado
(`tests/fixtures/tse/2026-sim/mun-e021270-cm.json`, gerado 14/09 22:57:56, 6.105 pares sem o
exterior), só `SELECT` em produção, há dois defeitos de **estrutura** e um de **peso**:

1. o EA12 lista **2 pares que `zonas` não tem** (AP 06050×0014 Macapá, PE 30015×0004 Fernando de
   Noronha) — o arquivo deles nunca é pedido, então os votos somem em silêncio em todos os cargos
   (mesma classe de falha do DF em 27/09);
2. **7 pares em `zonas` que o EA12 não lista** — cada ciclo pede 7 URLs por cargo que dão 404 (a
   constituição § 1 registra que 404 em rajada pode bloquear o IP);
3. os pesos de `eleitorado` são do CSV de **2024** (Macapá: zona 2 pesa 176.626, zona 10 pesa
   134.192 — eleitores da zona 14 nova ainda estão nelas).

### 🔴 Decisão do dono (29/09, noite): só a ESTRUTURA agora; peso só do arquivo oficial

O plano anterior gravava como peso o `e.te` dos EA20 do **simulado** (derivado do agregado). **Não
serve**: o eleitorado do simulado NÃO é o real. TRE-AP publicou **577.534** eleitores para o AP em
2026 (2024: 571.248, +1,1 %); o agregado do simulado diz **628.071** (+8,7 %). Sinais na mesma
direção: municípios do AP com +26 % a +106 % contra 2024 (Serra do Navio +106 %, Amapá +83 %,
Cutias +65 %) ao lado de outros a −2 %, e o Recife com +20,55 %. **Nenhum `te` de simulado pode virar
peso** — e o script agora RECUSA (ver abaixo). Decisão:

1. **Agora**: gravar só a estrutura — inserir os 2 pares em `zonas` (sem linha em `eleitorado`) e
   remover os 7 fantasmas de `zonas` e o peso órfão de `eleitorado` (`--so-estrutural
   --remover-fantasmas`).
2. **Depois**: pesos de `eleitorado` a partir do arquivo oficial do TSE, dataset "Eleitorado - 2026"
   (<https://dadosabertos.tse.jus.br/dataset/eleitorado-2026>, `perfil_eleitorado_2026.zip`), com
   `--pesos-oficiais`.

**O que isso significa para o modelo até os pesos chegarem**: `_resolve_zone_weight`
(`api/model/project.py`) pesa a zona pela **Σ dos pares dela em `eleitorado`**. Como AP 06050×0014
sai sem peso e a zona 14 só existe em Macapá, a zona (AP, 14) tem peso **0 e os votos dela são
DESCARTADOS** pelo modelo — como no caso do DF antes de 27/09. PE 30015×0004 divide a zona 4 com o
Recife, que já tem peso (109.229, de 2024): a zona segue pesada, sem a fatia de Noronha (pouca
coisa). Em compensação o ingest passa a **pedir** os dois arquivos: os votos ficam registrados em
`snapshots` e o peso é o que falta. O script imprime esse aviso na simulação.

### Script

`data-pipeline/zonas-faltantes-import.ts` (`pnpm db:zonas:faltantes`); lógica pura em
`zonas-faltantes-nucleo.ts`; modo de pesos oficiais em `zonas-pesos-oficiais.ts`; testes em
`tests/unit/data-pipeline/zonas-faltantes-import.test.ts`. **Não faz rede**: o EA12 e o arquivo
oficial são arquivos locais. A simulação **lê** o banco (precisa de `DATABASE_URL`, só `SELECT`,
numa transação `READ ONLY` que o servidor faz cumprir).

| Flag | Efeito |
|---|---|
| *(nenhuma)* | Simulação: relatório completo, linhas que inseriria/atualizaria/removeria (antigo → novo), SQL de desfazer e **pré-voo** do SQL de escrita. Não grava (nem o backup). |
| `--escrever` | Uma transação: relê, refaz o plano, aborta se houver bloqueio, grava o backup, escreve e confere **dentro** da transação; só então `COMMIT`. |
| `--so-estrutural` | Insere os pares que o EA12 lista e `zonas` não tem **só em `zonas`**. Não lê `te` nem o agregado do simulado e nunca grava peso; dispensa `--aceitar-te-derivado` (que aqui é **recusado**, como `--recalcular-pesos-uf`). |
| `--remover-fantasmas` | `DELETE` em `zonas` e `eleitorado` dos 7 pares de `FANTASMAS_AUTORIZADOS` (lista fechada no código). Recusa o par que o EA12 lista **ou** que tem **qualquer** snapshot. |
| `--pesos-oficiais <zip\|csv> --uf AP[,PE…]` | **Modo de depois.** Lê o arquivo oficial (latin1, `;`), soma `QT_ELEITORES_PERFIL` por (`CD_MUNICIPIO`, `NR_ZONA`) e grava `eleitorado.eleitores_aptos` (ano 2026) de todo par das UFs que está em `zonas` (INSERT do que não tem peso, UPDATE do que difere). `--uf` é obrigatório (nunca "todas"). Não combina com `--so-estrutural`, `--remover-fantasmas` nem com os modos legados. |
| `--total-uf AP=577534[,PE=…]` | Só com `--pesos-oficiais`: total **publicado** pela UF, conferido contra a soma do arquivo (bloqueia se diferir). |
| `--col-uf` `--col-municipio` `--col-zona` `--col-qt` | Nomes das colunas do arquivo oficial (padrão `SG_UF`, `CD_MUNICIPIO`, `NR_ZONA`, `QT_ELEITORES_PERFIL`). ⚠️ **Não há amostra do arquivo no repositório** (só o de locais de votação de 2024, outro leiaute): a leitura **valida o cabeçalho** e, se um nome não existir, falha listando as colunas que encontrou. |
| `--uf AP,PE` | No estrutural: restringe inserção e remoção a UFs (padrão: todas). |
| `--zonas-dir` / `--ea12` / `--eleicao` | Padrões: `tests/fixtures/tse/2026-sim/zonas-faltantes` · `…/mun-e021270-cm.json` · `21270`. `--ea12` e `--pesos-oficiais` só aceitam **caminho local**. |
| `--aceitar-te-derivado` · `--recalcular-pesos-uf` · `--exigir-soma-exata` | **Modos legados** (peso a partir de `te` de EA20). Com EA12 do simulado (`f='s'`) qualquer peso vindo daí é **BLOQUEIO** ("viriam do te do SIMULADO"): só passam com um EA12 que não seja do simulado (ex.: o da eleição real, quando existir). |

**Pré-voo (só na simulação)**: para cada SQL de escrita do plano o script pede ao servidor
`EXPLAIN <sql>` com os parâmetros reais. O servidor planeja e **não executa** (permitido na
transação `READ ONLY`): prova que colunas, tipos e casts existem no esquema real antes do
`--escrever`. Não prova FK nem conflito de chave (só a execução mostra; o `ROLLBACK` cobre). Se o
pré-voo falha, a simulação sai com erro.

**Bloqueios** (qualquer um impede `--escrever`) — estrutural: município ausente de `municipios` (a
FK de `zonas` rejeitaria); fantasma que o EA12 lista ou que tem snapshot. Pesos oficiais: par em
`zonas` **sem contagem** no arquivo; par do arquivo **fora de `zonas`** (rode o estrutural antes);
linha de peso de par fora de `zonas` (o órfão); contagem oficial 0; Σ final da UF ≠ total do
arquivo; total publicado ≠ soma do arquivo.

**Conferências dentro da transação** (qualquer falha → `ROLLBACK`, nada fica): linhas afetadas por
cada `UPDATE`/`DELETE` (`RETURNING`) == previsto; o `UPDATE` só casa a linha se o peso ainda for o
lido (escrita concorrente = contagem menor = aborta); `count(zonas)`, `count(eleitorado)` e
`Σ eleitorado` de cada UF tocada == previsto (nos pesos oficiais, Σ == **total do arquivo**); e por
fim `zonas` e `eleitorado` **inteiros** idênticos ao estado esperado (nada além do plano mudou).
Reexecutar depois do `COMMIT` não faz nada.

**Backup**: antes da primeira escrita, as linhas que `UPDATE`/`DELETE` vão perder são gravadas em
`build/zonas-backup-<AAAAMMDDTHHMMSSZ>.json` (pasta ignorada pelo git; nunca sobrescreve). O JSON traz
o estado anterior de cada linha e o `desfazerSql`. O arquivo é gravado **antes**: só houve mudança
se a execução imprimiu `COMMIT`.

### Comandos

Os comandos carregam o `.env.local` **dentro de um subshell** `( … )` — o `DATABASE_URL` de lá é
**produção** e não deve ficar no shell. O pnpm repassa as flags com ou sem o `--` (testado; o
script ignora o `--`).

**Agora — estrutura:**

```bash
# 1. Simulação — só SELECT (+ EXPLAIN das escritas), não grava. Ler a saída inteira (seções 1 a 9).
( set -a; . ./.env.local; set +a; PGOPTIONS='-c default_transaction_read_only=on' \
  pnpm db:zonas:faltantes --so-estrutural --remover-fantasmas )

# 2. Escrita — SÓ depois de o dono ver a simulação acima. Mesmos flags + --escrever.
( set -a; . ./.env.local; set +a; \
  pnpm db:zonas:faltantes --escrever --so-estrutural --remover-fantasmas )
```

Se a escrita abortar, **nada** foi gravado (`ROLLBACK`) e a mensagem diz o motivo. Um arquivo em
`build/zonas-backup-*.json` pode existir mesmo assim (foi gravado antes) — não significa mudança.

**O que a simulação de 29/09 (medida em produção, só leitura) mostra para o comando acima:**

| | Antes | Depois |
|---|---|---|
| `zonas` (pares) | 6.110 | **6.105** (= os 6.105 do EA12) |
| `eleitorado` (linhas, ano 2026) | 6.104 | **6.103** (só o órfão PE 25313×0001 sai) |
| AP: pares em `zonas` · linhas de peso | 17 · 17 | 18 · 17 (**Macapá 14 sem peso**) |
| PE: pares em `zonas` · linhas de peso | 208 · 208 | 208 · 207 (−Recife 1, +Noronha 4 sem peso) |
| PI · SP: pares em `zonas` | 235 · 780 | 230 · 779 |
| Σ `eleitores_aptos` nacional | 158.100.251 | 157.984.390 (−115.861, o órfão) |
| Linhas | — | `zonas` +2 −7 · `eleitorado` −1 |

**Conferência pós-escrita** (só `SELECT`):

```sql
SELECT uf, cod_municipio_tse, cod_zona, fonte FROM zonas
 WHERE (uf, cod_municipio_tse, cod_zona) IN (('AP',6050,14),('PE',30015,4));
-- 2 linhas, fonte 'ea12'

SELECT uf, cod_municipio_tse, cod_zona FROM zonas
 WHERE (uf, cod_municipio_tse, cod_zona) IN
   (('PE',25313,1),('PI',10170,92),('PI',11118,75),('PI',11452,83),('PI',11495,31),('PI',11614,55),('SP',71072,398));
-- 0 linhas

SELECT uf, count(*) AS pares, sum(eleitores_aptos) AS soma FROM eleitorado
 WHERE ano = 2026 AND uf IN ('AP','PE') GROUP BY uf;
-- antes: AP 17 | 571.248 · PE 208 | 7.152.871      depois: AP 17 | 571.248 · PE 207 | 7.037.010

SELECT (SELECT count(*) FROM zonas) AS zonas, (SELECT count(*) FROM eleitorado WHERE ano = 2026) AS pesos;
-- antes 6.110 | 6.104 · depois 6.105 | 6.103
```

**`list-targets` tem de refletir a mudança** (a ingestão lê `zonas` a cada ciclo; o cache de
`listIngestTargets` é de 5 min):

```bash
( set -a; . ./.env.local; set +a; TSE_COD_ELEICAO_FEDERAL=ele2026/21270 pnpm list-targets --env production --cargo 1 )
# antes (medido 29/09):  Total de alvos: 6138 · zona: 6110 · uf: 27 · br: 1 · PE | 208 · AP | 17 · PI | 235 · SP | 780
# depois (esperado):     Total de alvos: 6133 · zona: 6105 · uf: 27 · br: 1 · PE | 208 · AP | 18 · PI | 230 · SP | 779
```

⚠️ `docs/operations/vespera-03-10.md` passo 2.4 espera `Total de alvos: 6133` (o mesmo número vale
para estrutural e para o conserto completo). Se a estrutura **não** for gravada, o número esperado
continua 6.138 — o passo 2.4 diz isso, para a véspera não reprovar em falso nem aprovar o número
errado.

**Depois — pesos oficiais** (quando o dono baixar o arquivo; a estrutura acima tem de estar gravada,
senão o Macapá 14 do arquivo está "fora de `zonas`" e o script bloqueia):

```bash
# 0. O dono baixa o zip pela página do dataset (1 download; o WAF do dadosabertos recusa `curl` e
#    User-Agent com contato — ver TSE_ETL_USER_AGENT em data-pipeline/_tse-common.ts).
# 1. Simulação: só SELECT + EXPLAIN. Conferir o total, o "arquivo × publicado" e a seção 4.
( set -a; . ./.env.local; set +a; PGOPTIONS='-c default_transaction_read_only=on' \
  pnpm db:zonas:faltantes --pesos-oficiais ~/Downloads/perfil_eleitorado_2026.zip \
    --uf AP --total-uf AP=577534 )

# 2. Escrita — só depois de o dono ver a simulação. Mesmos flags + --escrever.
( set -a; . ./.env.local; set +a; \
  pnpm db:zonas:faltantes --escrever --pesos-oficiais ~/Downloads/perfil_eleitorado_2026.zip \
    --uf AP --total-uf AP=577534 )
```

O que conferir na simulação: (a) `total do arquivo=577.534 · publicado=577.534 · arquivo × publicado:
IGUAL` e `Σ depois … FECHA com o arquivo`; (b) a seção 4 (variação por município) sem salto absurdo;
(c) seção 5 com **0** pares sem contagem, **0** fora de `zonas` e **0** órfãos. Serve para qualquer UF
(`--uf AC,AL,…`, cada uma com o seu `--total-uf` se houver total publicado). ⚠️ **O DF** teve o peso
carregado em 27/09 do `te` do simulado (`eleitorado-df-import`): confira-o com `--uf DF` — a
simulação mostra a diferença sem gravar nada.

### Desfazer (só com ordem do dono)

O `desfazerSql` do backup é gerado das linhas **lidas antes da escrita** (uma transação, na ordem:
recolocar o que saiu → devolver os pesos → apagar o que entrou). Cole-o no `psql`/console do Neon:

```bash
jq -r '.desfazerSql[]' build/zonas-backup-<timestamp>.json
```

Para o comando estrutural de 29/09 o SQL é este (valores lidos de produção na simulação; vale
enquanto essas linhas não tiverem sido alteradas por outra via):

```sql
BEGIN;
INSERT INTO zonas (uf, cod_municipio_tse, cod_zona, nome, fonte) VALUES
  ('PE', 25313, 1, NULL, 'csv'),
  ('PI', 10170, 92, NULL, 'historico'),
  ('PI', 11118, 75, NULL, 'historico'),
  ('PI', 11452, 83, NULL, 'historico'),
  ('PI', 11495, 31, NULL, 'historico'),
  ('PI', 11614, 55, NULL, 'historico'),
  ('SP', 71072, 398, NULL, 'historico');
INSERT INTO eleitorado (ano, uf, cod_municipio_tse, cod_zona, eleitores_aptos, comparecimento_pct_historico) VALUES
  (2026, 'PE', 25313, 1, 115861, NULL);
DELETE FROM zonas WHERE (uf, cod_municipio_tse, cod_zona) IN (('AP', 6050, 14), ('PE', 30015, 4));
COMMIT;
```

Desfazer devolve os 7 fantasmas (e com eles os 404 por ciclo). Snapshots já gravados para AP
06050×0014 / PE 30015×0004 **não** são apagados (append-only, constituição § 10). O desfazer do
`--pesos-oficiais` é gerado da mesma forma (UPDATE devolvendo os pesos antigos + DELETE do que foi
inserido) e fica no backup dele.

⚠️ **Não rode `eleitorado-import.ts` / `pnpm db:migrate:0006` / `zonas-import.ts` depois destas
correções sem refazê-las**: o importador de `eleitorado` faz `DELETE FROM eleitorado WHERE ano = 2026`
e regrava o CSV de 2024 (desfaz os pesos oficiais), e o de `zonas` reescreve a tabela inteira.

### O que este script NÃO resolve

- **Pesos de 2024 nas demais UFs** (PE/Recife, AC, RR, RJ…) e o do DF (do `te` do simulado): só o
  `--pesos-oficiais`, UF a UF, com o arquivo oficial. Enquanto isso o peso é o de 2024 (real, defasado).
- **Exterior** (`zz`) — ADR-0045, fora do escopo (o arquivo oficial traz `ZZ`; é ignorado).
- **EA12 da eleição real**: não há como obtê-lo antes de 03/10 (os códigos só saem então; ver
  `vespera-03-10.md` parte 2). Quando existir, rode a simulação de novo com `--ea12 <arquivo
  baixado> --eleicao <cod federal>`; e o EA12 da 21272 (estadual) **não foi consultado** — o
  `te` de UF idêntico nas duas eleições é a evidência indireta de que os pares coincidem. A lista
  de fantasmas é **fechada no código**: com outro EA12, pares que "sobram" só são apontados, nunca
  removidos, até alguém autorizar a lista nova.

## Modelo — profiling baseline (T13 spec 002 · RNF-006)

Baseline de `computed_duration_ms` do endpoint `/api/model/project` (orquestrador T12). A meta operacional é **p95 < 2000ms** ([RNF-006](../nfr/performance.md)), com sub-meta interna **p95 < 1500ms** para deixar ≥500ms de folga ao I/O Postgres (Neon) que entra na conta em produção.

### Resultado — 2026-05-17 (medição local, mock psycopg)

| Quantil | Valor |
|---|---|
| min | 27 ms |
| p50 | 27.5 ms |
| mean | 27.6 ms |
| **p95** | **28.5 ms** |
| p99 | 30 ms |
| max | 30 ms |

**Veredito**: PASS. Margem de ~1970ms sobre a meta — o cómputo NumPy puro consome <2% do orçamento. O bootstrap vetorizado de T09 (matriz `(1000, k)` num único `rng.integers`) é o que entrega esse número; nada a otimizar agora.

### Dataset usado

- 27 UFs canônicas (AC..TO, incluindo DF)
- 100 zonas por UF → **2.700 zonas total**
- 2 candidatos (códigos 100 e 200, dois finalistas Presidente turno 1)
- `n_resamples=1000` (default T09)
- `pct_apurado` zona-a-zona: uniforme [30%, 80%]
- `pct_validos_2022` por UF: cand A em [40%, 60%], B = complemento, com ruído ±5pp por zona
- Eleitorado por zona: uniforme [100k, 500k]
- N=50 iterações, `trigger_ts` distinto a cada uma (seeds bootstrap descorrelacionados)

### Como reproduzir

```bash
source .venv-model/bin/activate
python scripts/profile-model.py
```

Saída inclui linha `RESULT_JSON={...}` final para parsing programático (CI futuro).

### Caveats

- **Mock psycopg** — `_open_conn` foi monkey-patched para uma `FakeConn` em memória (mesmo padrão do `tests/unit/model/test_orchestrator.py`). A medição **não inclui**: cold-start `psycopg[binary]` (~150ms), round-trip Neon (3 queries SELECT + 1 `executemany`), latência cross-region Vercel↔Neon. Em produção real, somar ~250–600ms ao p95 medido aqui.
- **Single-region NumPy local** — máquina dev (M-series Mac, Python 3.14.3, numpy 2.4.5). Vercel Fluid Compute Python tem perfil de CPU similar mas memória/cache distintos; reteste em preview é obrigatório (chore S03 após T15 fechar e dar acesso a preview URL com DATABASE_URL real).
- **Sem concorrência** — uma chamada por vez. Em prod, `/api/ingest` chama 1× por cargo ativo; se Presidente + Governador rodarem simultaneamente, há contenção potencial em GIL durante o bootstrap. Não esperamos impacto (numpy libera GIL), mas medir em preview.

### Trigger de re-medição

Re-rodar este profiling sempre que:

- Algum dos módulos `api/model/{bootstrap,projection,weighted_average,swing,p_vitoria}.py` mudar.
- `n_resamples` for ajustado (default atual 1000).
- Número de UFs apuradas ou candidatos por UF crescer significativamente (ex.: turno 1 vereador → 100+ candidatos por município).
- Após primeiro deploy em preview com Neon real, abrir issue de re-medição contra preview URL com 50 chamadas `curl` autenticadas (`x-model-secret`).

### Se p95 regredir > 1500ms

Plano B em ordem de impacto/custo:

1. **Vetorizar `compute_uf_projections`**: hoje há um loop Python `for uf in snaps_by_uf`. Se as 27 UFs entrarem num único bootstrap NumPy 3-D (`(n_resamples, n_ufs, k)`), ganho estimado 5–10×.
2. **Threading**: `concurrent.futures.ThreadPoolExecutor(max_workers=4)` sobre as 27 UFs. NumPy libera GIL durante operações de array → ganho 2–3×. Mais simples que (1) mas menos eficaz.
3. **Pré-agregar `p_2022_uf`**: hoje recomputamos o índice de histórico a cada chamada. Materializar em tabela `historical_results_uf_agg` (chore S03 ou S04) economiza ~3–5ms — irrelevante hoje, mas útil se o histórico crescer (vereadores).
4. **Reduzir `n_resamples` para 500** — **não recomendado**: afeta largura do CI e a confiabilidade da `p_vitoria` (constituição § 6 exige seed estável, mas n=500 amplia variância amostral).

## TSE — dimensionamento do fan-out (revisado em 2026-09-05)

> ⚠️ **Correção de duas gerações de números errados.** Versões anteriores desta seção afirmavam
> **~73.000 targets por ciclo** e concluíam que o ciclo "não cabe em 60 s". Ambas as premissas caíram:
> o número nunca foi 73.000 (com granularidade de zona o real era **~5.200**), e a Fase 0 da S07
> chegou a usar granularidade de **UF** por padrão (~55 GETs). **Essa decisão foi revertida em
> 05/09 (E4 do plano de projeção por regra de três)**: o modo `uf` grava a zona sob o sentinela
> `cod_zona = 0`, que `eleitorado.get((uf, cod_zona), 0)` em `api/model/project.py` não encontra —
> peso 0, zona descartada, participação `None`. **O modo `uf` está quebrado em produção
> hoje.** `zona` volta a ser a granularidade necessária; o texto abaixo documenta seu custo real,
> medido, não estimado.
>
> Números de fan-out confirmados em [docs/reference/tse-2026-leiautes.md § 6](../reference/tse-2026-leiautes.md).
> Números de **desempenho** (duração, throughput, gargalo) medidos em 05/09 com
> `scripts/tse-mock-server.ts --zonas <N> --cargos 1,3` servindo ~2.600 zonas × 2 cargos
> sintéticas em escala real (ver `scripts/tse-mock-server.ts` para o gerador determinístico) —
> ver § "Ensaio de escala" abaixo.

### Requisições por ciclo

| Granularidade | 1 cargo | 2 cargos (Presidente + Governador) | Onde |
|---|---|---|---|
| **`zona` (~6.110 pares na tabela `zonas`)** | ~6.110 | **~12.170 (medido 11/09)** | `TSE_GRANULARIDADE=zona` (default, desde 05/09) — **único modo funcional em produção** (granularidade UF está quebrada no modelo); unidade de ingestão é par (município, zona) |
| `uf` | 27 + 1 BR (só Presidente) | 27×2 + 1 = **55** | `TSE_GRANULARIDADE=uf` — **quebrado no modelo em produção**; mantido só como fallback de emergência (telas nacional/UF sozinhas, sem modelo funcional) |

`zonas` agora é tabela de pares: PK `(uf, cod_municipio_tse, cod_zona)`. Medição em 05/09 sobre _zona_ (2.651) 
era obsoleta quando o EA20 passou a ser por _par_ (6.110); a tabela foi regravada em 11/09. `listIngestTargets` 
(`lib/tse/targets.ts`) enumerava targets de ingestão; com pares, a mesma função agora retorna ~6.110 por cargo. 
Só Presidente (cargo 0001) tem arquivo agregado de Brasil; Governador (0003) tem UF/Município/Zona apenas — daí o "+1" e não "+2".

### Ensaio de escala (05/09/2026 — mock local, 3 ciclos completos)

Protocolo: `pnpm tsx scripts/tse-mock-server.ts --port 8787 --zonas 500 --cargos 1,3` (teto 500 cobre o `codZona` máximo real, 428, em RR/SP) + `pnpm dev` com `TSE_BASE_URL=http://localhost:8787/oficial`, `TSE_COD_ELEICAO=ele2022/544`, `INGEST_WINDOW_OVERRIDE=true`, `TSE_GRANULARIDADE=zona`, `TSE_MAX_RPS=50`, `VERCEL_ENV=production` (necessário — sem isso `listIngestTargets` usa o path de **preview**, whitelist `SP:1`, não o fan-out completo) + `curl -X POST /api/ingest`. Nenhuma requisição tocou `resultados.tse.jus.br`.

| # | `INGEST_CONCURRENCY` | Estado do cache | `durationMs` | `filesFetched` | `filesChanged` | `unchanged` | `rateLimited` | `waitedMs` | rps efetivo |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 30 | frio (maioria muda) | **123.373** | 5.302 | 4.908 | 394 | 0 | 16.975 | ~43 |
| 2 | 30 | quente (tudo 304) | **106.478** | 5.302 | 0 | 5.302 | 0 | 95.033 | ~50 (teto) |
| 3 | 20 | frio (tudo muda) | **155.947** | 5.302 | 5.302 | 0 | 0 | 0 | ~34 |

**Leitura dos números:**

- **Ciclo 2 (tudo 304, sem INSERT) bate quase exatamente o piso teórico do rate limiter**: 5.302 GETs / 50 rps = 106,04 s ≈ **106,478 s medidos**. Com o Postgres fora do caminho quente, `TSE_MAX_RPS=50` é o único gargalo, e o bucket satura (`waitedMs` ≈ `durationMs`).
- **Ciclo 3 (`INGEST_CONCURRENCY=20`, tudo muda) nunca engata o rate limiter** (`waitedMs=0`) — o semáforo de 20 é o gargalo, não o TSE: rps efetivo ~34, próximo da estimativa do plano ("binda em ~40 rps"). Confirma que `INGEST_CONCURRENCY=30` é necessário para aproximar-se do teto de 50 rps.
- **Ciclo 1 (`concurrency=30`, maioria muda) fica 17 s acima do piso do rate limiter** (123 s vs. 106 s) mesmo com concorrência suficiente — a diferença é o **Postgres/Neon**, não o TSE.

**Achado sobre o Postgres (gargalo real, não presumido):** cada zona "mudada" faz **3 round-trips HTTP ao Neon serverless** — 1 `SELECT` em `getLastEtagAndHash` (`lib/tse/repository.ts:65`) antes do fetch, 1 `SELECT` de dedup **repetido** dentro de `insertSnapshot` (`lib/tse/repository.ts:144` — chama `getLastEtagAndHash` de novo) e 1 `INSERT`. Microbenchmark isolado nesta mesma sessão, contra o mesmo Neon: `SELECT` sequencial (sem overlap) — **p50 156,9 ms, p95 510,2 ms**; 30 `SELECT` concorrentes (`Promise.all`) — **18,2 ms/query amortizado**. Ou seja: **bem paralelizado o custo por query desaparece, mas os 2 SELECT + 1 INSERT de uma mesma zona são sequenciais entre si** (o segundo `SELECT` e o `INSERT` só podem rodar depois do primeiro `SELECT` resolver) — em concorrência baixa (20) isso vira um piso de latência por zona de ~450–600 ms que a concorrência não absorve totalmente (~5.300 × 0,55 s / 20 slots ≈ 146 s, próximo dos 156 s medidos). Em concorrência alta (30) o efeito é menor mas ainda soma ~17 s.
**Proposta (não implementada — fora do escopo desta tarefa, requer tocar `lib/tse/repository.ts` e `app/api/ingest/route.ts`):** (a) 1 `SELECT ... WHERE (cargo,turno,uf,cod_zona) IN (...)` para toda a tabela de targets no início do ciclo, eliminando ~5.300 SELECTs individuais; (b) eliminar o `SELECT` duplicado dentro de `insertSnapshot` reaproveitando o resultado já obtido em `getLastEtagAndHash` no passo 5a do handler (mesmo valor, chamado duas vezes hoje); (c) `INSERT` em lote (multi-row) por chunk de N zonas mudadas, no fim do loop em vez de um `INSERT` por zona. Com isso o Postgres deixa de competir pelo orçamento do ciclo e o único teto relevante volta a ser `TSE_MAX_RPS` (~106 s medidos).

**Cadência efetiva em produção**: ciclo de ~104–160 s (a depender de `INGEST_CONCURRENCY` e do "estado" do ciclo — frio custa mais) não cabe no cron de 60 s (ADR-0011); com o lock anti-overlap de 3 min (`OVERLAP_LOCK_WINDOW_MS`, `app/api/ingest/route.ts`), o tick de 60 s seguinte responde `{skipped:"overlap"}` e só o de ~120 s roda de fato — **cadência efetiva ~120 s**, consistente com a estimativa E4 do plano. Isso projeta um lag `tse.lag_seconds` na faixa de **~130–160 s** em regime permanente (tempo desde a geração do arquivo no TSE até o snapshot ficar disponível), acima da meta S07 de **< 90 s** — aceito pelo usuário em E4 como custo conhecido; ver linha nova em [risks.md](../reference/risks.md). **Medir de novo com dados reais do simulado 1 (15–17/09)** antes de fechar a decisão — o ensaio acima usa o mock local, não o CDN real, e não reproduz latência de rede real do TSE.

### Opções de mitigação (se o lag medido no simulado 1 for inaceitável)

Do plano de projeção por regra de três, seção D — nenhuma implementada, todas dependem de decisão humana após medir:

- **Z1 — aceitar e medir (recomendação atual)**: manter `zona` com os números acima; é o desenho necessário para o modelo (RF-011/012) e cabe em `maxDuration=180`. Ação: nenhuma, só observar no simulado.
- **Z2 — dois shards** (`?shard=0|1`, cada um com metade das zonas a ~45 rps): reduziria o ciclo por shard a ~58 s, mas os dois juntos somam ~90 rps agregados no mesmo IP — perto do teto de 100 req/s documentado pelo TSE. Só considerar **com dado do simulado 1** mostrando que Z1 não é suficiente.
- **Z3 — híbrido UF+zona**: usar UF/BR para as telas e zona só nas UFs que o EA14 sinalizar como alteradas (`TSE_ACOMPANHAMENTO=on`). Reduz GETs em ciclos "parados", mas **não resolve** o pico (quando muitas UFs mudam ao mesmo tempo, no horário de maior interesse, o custo converge para o de "zona" completo). Não antes de 04/10 — mudança de escopo maior.

> **A decisão final é do usuário**, só depois de **medir nos simulados de 15–17/09 e 22–24/09** contra o CDN real (latência de rede real, não a do mock local). Se a escolha implicar mudar o contrato do ciclo, despachar `adr-author`.

**Como medir no simulado**: `ingest_log.duration_ms`, `rateLimited`, `waitedMs` e `notFound` de cada ciclo — protocolo em [docs/testing/tse-simulados.md](../testing/tse-simulados.md).

## Variáveis de ambiente do pipeline TSE (hardening pré-simulado, 2026-09-05)

Defaults abaixo **lidos do código** em 2026-09-05, não do plano — cada linha cita `arquivo:linha`.

| Variável | Default | Onde é lida | Descrição |
|---|---|---|---|
| `TSE_BASE_URL` | `https://resultados.tse.jus.br/oficial` | `lib/tse/targets.ts:91` (`getTseBaseUrl`; default em `:71`) | Host do CDN TSE. Aceita o default de produção, `https://resultados-sim.tse.jus.br/simulado/simulado2026` (ambiente de simulado) ou `http://localhost:<porta>`/`http://127.0.0.1:<porta>` (mock local, `scripts/tse-mock-server.ts`). Qualquer outro valor (`http://` em host não-local, URL malformada) lança erro — nunca faz downgrade silencioso de TLS. |
| `TSE_MAX_RPS` | _(ausente)_ → teto do cargo: **25** Presidente/Governador/Senador, **5** Deputado Federal (`lib/config/cargos.ts`, `rpsMax`); clamp 1..50 | `lib/tse/rate-limiter.ts` (`getTseRateLimiter`) e `lib/config/cargos.ts` (tabela canônica) | Taxa máxima de saída (req/s) para o CDN TSE. O material oficial do TSE (`tse_docs/txt/apresentacao-interessados-2026.txt`, § "Regras de consumo dos arquivos") documenta limite de **100 req/s por IP → bloqueio de 10 min, renovado a cada nova violação**; o teto de 50 é exigido por **RF-010.3** da spec 001 e deixa margem para retries, HEAD do `tse-watch` e outros processos no mesmo IP. Não elevar sem revisar a spec. ⚠️ **Em produção, deixe ausente.** É um override **global**: substitui o teto de TODOS os cargos de uma vez, então `TSE_MAX_RPS=50` com os quatro crons coincidindo daria **200 rps** — o dobro do limite do TSE, e bloqueio de IP por 10 min. A recomendação anterior de `50` datava do mundo de dois cargos e foi **revogada em 13/09**; hoje o valor certo vem da tabela por cargo. Use só em janela supervisionada, com alguém lendo `rateLimited` em tempo real. Medição de 05/09 (dois cargos, ~5.300 GETs/ciclo) em [Ensaio de escala](#ensaio-de-escala-05092026--mock-local-3-ciclos-completos): com `INGEST_CONCURRENCY=20` o rps efetivo ficava em ~34 e o semáforo, não o rate limiter, era o gargalo. |
| `INGEST_WINDOW` | `17-04` | `lib/tse/ingest-window.ts:49` (`parseIngestWindow`) | Janela de ingestão, formato `HH-HH` (BRT, 0-23). `17-04` = apuração real (cruza meia-noite); `9-17` = janela diurna dos simulados TSE (9h-17h BRT). `INGEST_WINDOW_OVERRIDE=true` ainda ignora a janela por completo (uso: testes, dry-run manual). |
| `INGEST_CONCURRENCY` | `20` | `app/api/ingest/route.ts:117` (`getIngestConcurrency`) | Tamanho do semáforo de GETs simultâneos por invocação. Ortogonal a `TSE_MAX_RPS`: concorrência limita quantas requisições ficam em voo ao mesmo tempo; `TSE_MAX_RPS` limita quantas SAEM por segundo. Valor inválido cai no default com um warn. **Recomendação de produção para `zona`: `30`** — medido em 05/09: com `20`, o rps efetivo fica em ~34 e o rate limiter nunca satura (`waitedMs=0`, o semáforo é o gargalo); com `30`, o rps efetivo sobe para ~43–50 e o ciclo cai de ~156 s para ~106–123 s. Ver [Ensaio de escala](#ensaio-de-escala-05092026--mock-local-3-ciclos-completos). |
| `TSE_CARGOS` | `1,3` | `lib/tse/targets.ts:336` (`getActiveCargos`) | Lista de cargos ativos (1=Presidente, 3=Governador), separada por vírgula. Usada tanto para materializar targets de produção quanto para decidir quais cargos disparam `/api/model/project` ao fim do ciclo. Tokens inválidos são ignorados com warn; se nenhum sobrar, cai no default. |
| `TSE_GRANULARIDADE` | `zona` (desde 05/09, E4) | `lib/tse/targets.ts:399` (`getGranularidade`) | `uf` \| `zona`. `uf` = 27 UFs × cargos + 1 arquivo BR de Presidente ≈ **55 GETs/ciclo**, mas **está quebrado no modelo em produção** (ver aviso no topo de [dimensionamento do fan-out](#tse--dimensionamento-do-fan-out-revisado-em-2026-09-05) — sentinela `cod_zona=0` sem peso em `eleitorado`). `zona` = **~6.110 pares (município, zona) por cargo**, em invocações separadas desde o cron por cargo (ADR-0035 D3) — era 2.651 × cargos ≈ 5.302 GETs/ciclo até 10/09, quando o alvo ainda era a zona e perdíamos ~56% dos arquivos publicados. Necessária para a regra de três do modelo (RF-011/012) e único modo funcional hoje. Valor inválido cai no default com warn. **O default de código de `getGranularidade` é `zona`** (`lib/tse/targets.ts:404`) desde 05/09 — não é preciso definir a env explicitamente. |
| `TSE_DEPUTADO_GRANULARIDADE` | *(ausente — segue o padrão do cargo, `zona` desde 2026-09-13)* | `lib/tse/targets.ts` (`getGranularidade`) | Chave de emergência **específica do cargo 6** (Deputado Federal) — 🔴 **exige novo deploy** (corrigido em 29/09, ADR-0063 D4): na Vercel, variável de ambiente só chega a um deployment NOVO; mudar o valor não altera nada no que já está no ar, e **das 16h às 05h de 04/10 não há deploy**. Depois de mudar: `vercel redeploy <deployment de produção> --target production`. `uf` reverte só Deputado a granularidade UF (27 alvos) — os outros três cargos não são afetados, diferente de `TSE_GRANULARIDADE` (que sobrepõe TODOS os cargos e continua tendo prioridade sobre esta variável quando as duas estão setadas). Em modo `uf`, cada uma das 6 invocações fatiadas (`/api/ingest/deputado-federal/<1..6>`) devolve o agregado completo de 27 UFs — o fatiamento (`sliceTargets`) só se aplica a granularidade `zona`. Use quando o pipeline fatiado apresentar problema (ex.: formato EA20 mudou de um jeito que quebra `sliceTargets`, ou o volume de 6.110 alvos está causando erro sistemático) e for preciso voltar ao modo leve testado antes de 2026-09-13 — **com um redeploy**, fora da janela congelada. Valor inválido (nem `uf` nem `zona`) é ignorado com warn, caindo no padrão do cargo. **Seguro acionar no meio da apuração** — isto é, sem corromper o modelo; o redeploy continua obrigatório (achado de review, 2026-09-13): `fetch_snapshots`/`_discard_zero_zona_sentinel_when_real_zonas_exist` (`api/model/project.py`) decide entre a família sentinela (`cod_zona=0`) e a de zonas reais por **frescor de `ts`**, não por presença — a família mais recente (a que as invocações continuam alimentando) sempre vence, nas duas direções (`uf→zona` e `zona→uf`). Antes deste fix, acionar o interruptor no meio da apuração congelava o modelo nos pares de zona anteriores à virada, em silêncio (`snapshots` é append-only — a sentinela nova era descartada por presença, não por ser mais velha). |
| `TSE_ACOMPANHAMENTO` | *(desligado)* | `app/api/ingest/route.ts:426` | Opt-in literal: **só o valor exato `on` liga**. Quando ligado, 1 GET no EA14 diz quais UFs mudaram desde o último ciclo e os targets são filtrados para essas UFs (alvos de nível `br` nunca são filtrados). Fail-open em dois níveis: qualquer erro faz todas as UFs voltarem como `changed` — o gating economiza requisições, jamais perde atualização. Estado (ETag + hashes) vive em memória do processo, então cold start = 1 ciclo sem gating. **Recomendação de produção**: `on`, para reduzir GETs em ciclos "parados" mesmo em granularidade `zona` — não elimina o pico (quando muitas UFs mudam ao mesmo tempo o custo converge para o fan-out completo, ver opção Z3 em [dimensionamento do fan-out](#tse--dimensionamento-do-fan-out-revisado-em-2026-09-05)), mas não tem custo conhecido de correção; o gating **não foi exercitado neste ensaio** (rodou desligado, de propósito, para medir o pior caso — fan-out completo). |
| `INGEST_WINDOW_OVERRIDE` | *(desligado)* | `app/api/ingest/route.ts:309` | `true` ignora `INGEST_WINDOW` por completo. Uso: dry-run manual e testes. **Nunca em produção.** |
| `FIXTURE_VARIANT` | *(nenhum)* | `app/page.tsx:113` | **Só dev/teste.** `t2` troca a fixture local para o payload de 2º turno (`projection-current-t2.json`), permitindo renderizar o modo `binary` sem Edge Config. Qualquer outro valor = fixture de 1º turno. |

Variáveis já existentes que interagem com as acima (sem mudança de contrato):

- `TSE_COD_ELEICAO` — sem default; **obrigatória**. Validada contra `^ele\d{4}\/\d+$` em `getCodEleicao()` (`lib/tse/targets.ts:296`); valor ausente ou malformado **lança erro** em vez de seguir para uma URL inválida — uma URL malformada pode disparar bloqueio de IP no TSE. Os códigos de 2026 **ainda não existem** no `ele-c.json` de produção (05/09: ainda em `ele2024`); `pnpm tse:watch` avisa quando surgirem.
- `TSE_TARGETS_WHITELIST` — inalterado (preview only). ⚠️ Nunca usar para apontar a UF/cargo inexistente — ver a advertência em [Testes manuais de alerting](#testes-manuais-de-alerting-t21-spec-001).
- `TSE_TURNO` — `1` ou `2` (`app/api/ingest/route.ts:89`).
- `CRON_ENABLED` — qualquer valor diferente de `"false"` mantém o cron ligado (`app/api/ingest/route.ts:293`).

### Não existe: `TSE_EA15_PATH_TEMPLATE`

O handoff de 05/09 lista essa variável, mas ela **não existe no código** — `grep` em `lib/`, `app/` e `scripts/` não retorna nenhuma ocorrência. O que foi implementado em `lib/tse/acompanhamento.ts` usa `buildEA14Url`/`buildEA15Url` de `lib/tse/targets.ts`, com o path derivado da padronização documentada do CDN (`<uf>-e<eleição>-ab.json`), sem template configurável. Se um dia um template for necessário (ex.: o simulado usar um path diferente), ele precisa ser **implementado antes** de ser documentado.

### Edge Config em dev

`EDGE_CONFIG` segue **comentada** em `.env.local` (linha 8) desde **18/05/2026** — o endpoint externo passou a responder com timeout de 10 s ou mais e travava o dev server. Consequência: em desenvolvimento, `lib/edge-config/reader.ts` devolve `null` (`reader.ts:62,131,163`) e as páginas caem em **fixture local**. O que você vê em `localhost:3000` **não** é o payload de produção. Para exercitar o caminho real do Edge Config, descomentar a linha e aceitar a latência, ou usar o preview da Vercel.

### Novidades observáveis no response/log de `/api/ingest`

O JSON de resposta, `logIngestRun.notes` e o `logInfo` final de cada ciclo agora incluem:

- `rateLimited` — quantas respostas 429 o TSE devolveu neste ciclo (via `getClientStats()`/`resetClientStats()` em `lib/tse/client.ts`, resetado no início de cada ciclo). Dispara alerta Slack `error` quando `> 0`.
- `waitedMs` — delta (não total acumulado do processo) do tempo de espera do rate limiter neste ciclo (`getTseRateLimiter().stats.waitedMs`).
- `notFound` — já existia; contorno de 404 (zona sem dados), agora logado em `debug` em vez de `warn` por target (contador agregado preserva a observabilidade).

### Lock anti-overlap

`/api/ingest` (e `/api/ingest/[cargo]`, `/api/ingest/[cargo]/[fatia]`) grava uma linha marcador (`notes: {running: true, cargo?, fatia?}`) em `ingest_log` no início do ciclo e outra (`notes: {running: false, ...métricas}`) no fim — append-only (constituição § 10, nunca `UPDATE`). Se a última linha DA MESMA CHAVE (`cargo`+`fatia`) tem `running: true` com menos de **6 minutos** (`OVERLAP_LOCK_WINDOW_MS`, `lib/tse/ingest-handler.ts`), o handler responde `{ skipped: "overlap" }` em vez de rodar em paralelo. Falha ao ler/escrever o lock é fail-open (loga e segue) — um lock ilegível nunca deve travar o pipeline inteiro.

Desde 2026-09-13 a chave do lock ganhou `fatia` (ADR-0026, emenda): as 6 fatias do cargo 6 (Deputado Federal, `/api/ingest/deputado-federal/<1..6>`) disparam a cada 5 min — sem essa segunda dimensão na chave, a fatia 2 seria bloqueada pelo marcador `running:true` da fatia 1 (escrito 5 min antes, dentro da janela de 6 min), e a varredura completa nunca fecharia. `getLastIngestRun(cargo, fatia)` (`lib/tse/repository.ts`) exige match exato nos dois campos — `fatia` ausente só casa com linhas também sem `fatia`.

## Vercel Blob — monitoramento do detalhe por UF (ADR-0032)

Desde 2026-09-08 o read path tem **dois** mecanismos. O resumo por UF continua
no Global Config; o **detalhe municipal e as séries temporais** vivem no Vercel
Blob, um objeto por UF/cargo/turno:

```
https://<storeId>.public.blob.vercel-storage.com/municipios/uf/<SIGLA>/<cargo>/t<turno>.json
```

O `<storeId>` é derivado do `BLOB_READ_WRITE_TOKEN`
(`vercel_blob_rw_<storeId>_<segredo>`) por `lib/blob/paths.ts`;
`BLOB_PUBLIC_BASE_URL` sobrepõe quando presente.

**O que vigiar no log do ciclo.** `writeProjection` emite, na linha
`global-config projection written`, quatro contadores novos:

| Campo | O que significa | Quando agir |
|---|---|---|
| `blobWritten` | objetos publicados no ciclo | esperado: 1 por UF com payload explícito (até 27/cargo) |
| `blobSkipped` | pulados por falta de `BLOB_READ_WRITE_TOKEN` | **> 0 em produção = detalhe municipal offline** |
| `blobFailed` | falhas de `put()` | > 0 recorrente = investigar |
| `blobBytes` | soma dos objetos gravados | referência de crescimento |

E, quando há falha, uma linha `error` dedicada:
`blob uf detail write failures`, com a lista de UFs e o motivo por UF.

**Falha de Blob NÃO derruba o ciclo, de propósito.** O resumo publicado vale
mais que um ciclo marcado vermelho, e o read path degrada por seção com estado
"detalhe indisponível" explícito no DOM. Isso significa que **esta linha de log
é o único alarme** — não existe erro 500 correspondente.

**Verificação manual rápida** (não escreve nada):

```bash
set -a; . ./.env.local; set +a
curl -sI "https://$(echo "$BLOB_READ_WRITE_TOKEN" | cut -d_ -f4 | tr 'A-Z' 'a-z').public.blob.vercel-storage.com/municipios/uf/SP/pres/t1.json"
```

Esperado: `200`, `content-type: application/json` e
`cache-control: public, max-age=60`. Um `max-age` maior significa que alguém
removeu o `cacheControlMaxAge` do `put()` — o default do SDK é **um mês**, e o
CDN passaria a servir o detalhe congelado enquanto o resumo continua andando.

**Dimensionamento medido (2026-09-08, store real).** O objeto de SP com os 645
municípios reais do banco, 11 candidatos por município e 3 séries de 480 pontos
(o teto de uma noite de 8h a 60 s) pesa **248.473 B** — ordens de grandeza
abaixo do limite por objeto do Blob, e a maior UF do país. A pendência do
ADR-0032 item 6 fica **resolvida**: a cobertura municipal pode ir de 39% a 100%
sem ameaçar o limite por objeto.

**No dev sem token**: `readUfDetail` devolve `not_configured` e as seções de
município/séries mostram o estado "detalhe indisponível". Não é bug — é o
comportamento declarado.

## Série por candidatura — o que é gravado a cada ciclo (spec 020)

Desde 17/09 (migration **0009**, ADR-0046) a tabela `projections` guarda, a cada ciclo, a
fatia de votos de **cada candidatura**: `pct_atual`, `votos_atuais` e `dado_ts` (a hora do
**boletim**, ADR-0038 — não a do cálculo). É essa série que alimenta o gráfico da noite. A
migration é aditiva e idempotente (`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT
EXISTS`), O(1) em PG 11+, e **já foi aplicada em produção em 17/09**:

```bash
set -a; . ./.env.local; set +a
pnpm db:migrate:0009
```

⚠️ **`pct_apurado` e `pct_atual` são coisas opostas** e o nome engana: `pct_apurado` é quanto
da urna já chegou; `pct_atual` é a fatia da candidatura sobre os votos já contados.

### Só os cargos 1, 3 e 5 são persistidos

`CARGOS_COM_SERIE_PERSISTIDA = {1, 3, 5}` em `api/model/project.py` — Presidente, Governador e
Senador. **Deputado Federal (6) está fora por volume**: suas ~7,8 mil candidaturas dariam
**~3,7 milhões de linhas por noite**, nove vezes todo o resto somado. O cargo 6 hoje tem
caminho próprio (`api/model/deputado.py`) e nem chega aqui; a constante existe para que
ligá-lo um dia seja uma **decisão**, e não efeito colateral da validação de entrada (que
aceita 1..99 de propósito, para um código inesperado não derrubar o ciclo).

**O descarte é ruidoso de propósito.** Quando um cargo cai fora, o ciclo loga em `warn`:

```
serie nao persistida: cargo fora de CARGOS_COM_SERIE_PERSISTIDA
  cargo=… turno=… linhas_descartadas=…
```

➜ **Se essa linha aparecer para um cargo que deveria entrar (1, 3 ou 5), é configuração
errada**, não comportamento normal — a série daquele cargo some do gráfico e do replay sem
nenhum outro sinal.

### Conferir resíduo de harness no banco

Depois do incidente de 17/09 (ver
[`ALLOW_DB_WRITE_TESTS`](#-regra-operacional-crítica--allow_db_write_tests-17092026)), estas
duas consultas dizem em segundos se sobrou lixo de teste em `projections`:

```sql
-- 1. cargos que não existem (o harness usava 91, 92, 93)
SELECT cargo, count(*) FROM projections WHERE cargo NOT IN (1,3,5,6) GROUP BY cargo;

-- 2. candidaturas sintéticas sob o cargo REAL 1 (as de verdade têm id < 100)
SELECT count(*) FROM projections WHERE cargo = 1 AND candidato_id BETWEEN 100 AND 299;
```

As duas devem devolver **zero**. A primeira é a fácil de ver; a segunda é a perigosa — linha
de harness sob o cargo real, misturada às candidaturas de verdade, entra no gráfico como se
fosse resultado.

## 🔴 403 neste host nunca significa "ainda não publicado"

**A regra que a primeira janela de simulado comprou, em 15–17/09/2026.**

A vigia apontava para `https://resultados-sim.tse.jus.br/**oficial**`. Esse endereço
**não existe** — o segmento do caminho é o **ambiente**, e `oficial` é o de produção — e
responde **403 para sempre**. O 403 foi lido como *"o TSE ainda não publicou"*, ninguém viu
o ambiente subir em 14/09, e o `git log` registra **zero commits em 14, 15 e 16/09**, contra
54 em 13/09. Dois dos três dias da janela, perdidos por uma leitura de mensagem.

| Ambiente | Endereço base |
|---|---|
| **Simulado** | `https://resultados-sim.tse.jus.br/simulado/simulado2026` |
| **Produção** | `https://resultados.tse.jus.br/oficial` |

**Os três estados são distintos, e o script agora os separa** (`scripts/tse-watch.ts`,
18/09):

| Exit | Significado | O que fazer |
|---|---|---|
| `0` | Olhei, nada mudou | Nada |
| `2` | Olhei, **mudou** | Ler o diff |
| `3` | 🔴 **CEGO** — `ele-c.json` deu 403/401 | **Conferir a URL.** Não concluir nada sobre o TSE |
| `1` | Erro de execução (rede, 5xx, JSON inválido) | O TSE pode ter caído; esperar e repetir |

⚠️ **`3` e `1` são coisas diferentes de propósito.** "O endereço está errado" se conserta
olhando a URL; "o servidor caiu" se conserta esperando. Colapsar os dois devolve exatamente
a ambiguidade que custou a janela.

ℹ️ **403 nos leiautes é outra coisa, e é normal.** `www.tse.jus.br` responde 403 a cliente
não-navegador em 9 dos 10 alvos, sempre — está no contrato do script e **não** é alarme. O
que **é** alarme, desde 18/09: um leiaute que **estava respondendo** e passa a não
responder. Sai como `PERDEMOS VISÃO` e conta como mudança. Ficar cego numa fonte que se
vigiava importa mais que voltar a enxergar — e até 18/09 só o caminho inverso era
registrado.

---

## Vigia externo — `pnpm vigia:ciclo` (S08 item 2, 2026-09-18)

> **Quem recebe**: a tarefa horária `~/.claude/scheduled-tasks/vigia-tse-2026/`, que roda na
> máquina do dono, **fora da Vercel**. Ela reporta em linguagem comum e não conserta nada.

### Por que existe

**Todos os 9 alarmes do projeto moram dentro do próprio ciclo** — 5 em `api/model/project.py`
(`_alert_slack`), 3 em `lib/tse/ingest-handler.ts` e 1 em `scripts/tse-watch.ts`
(`notifySlack`). Eles só disparam a partir de código que roda **se o cron for invocado**. Se a
Vercel parar de invocar o cron, ou a função morrer antes do primeiro alerta, **nada avisa** — e
o site segue servindo o último payload, com cara de normalidade.

O `heartbeat` diurno de `vercel.ts:114-117` não cobre isso: ele aponta para `/api/ingest`,
isto é, para nós mesmos. **Um vigia que mora dentro do processo vigiado não é um vigia.**

### 🔴 Por que ele não bate na porta do site — medido em 18/09

```
GET https://atlasmenna.online/               → HTTP 200 (HTML)
GET https://atlasmenna.online/api/projection → HTTP 403 {"error":"bot_detected"}
GET https://atlasmenna.online/api/health     → HTTP 403 {"error":"bot_detected"}
```

O Vercel BotID trata qualquer cliente automatizado como robô: **todas as rotas `/api/*` estão
fechadas para um vigia**, e isso está certo — elas são rotas de leitura pública, não de
máquina. A página HTML responde, mas **só traz a hora do boletim quando há apuração**; em fase
pré-eleição não há carimbo algum, e "não achei a hora" seria indistinguível de "o ciclo
morreu".

Por isso o vigia lê o **payload publicado na sua fonte** (o store do Global Config), não pela
porta do site. Efeito colateral útil: se o app cair mas o store estiver fresco, os dois sinais
discordam — e a discordância é informação.

### Uso

```bash
pnpm vigia:ciclo                      # limite padrão: 15 min
pnpm vigia:ciclo --limite-min 30      # mais tolerante
```

🔴 **Não precisa — e não deve — carregar o `.env.local`.** A instrução aqui era
`set -a; . ./.env.local; set +a` até 2026-09-19. Funcionava, e punha o
`DATABASE_URL` de **produção** no ambiente — o banco que vai guardar a apuração
de 04/10. Em 17/09 foi assim que uma suíte gravou **1.877 linhas** de harness em
produção (ver a regra do `ALLOW_DB_WRITE_TESTS` acima).

Desde 19/09 o script carrega sozinho, e **só** as duas variáveis de que precisa —
`EDGE_CONFIG` e `INGEST_WINDOW`, nenhuma das quais toca banco. Lista **branca**,
nunca negação, no mesmo espírito da trava do modo simulado
(`scripts/_vigia-env.ts`; teste em `tests/unit/scripts/vigia-env-seletivo.test.ts`).

O motivo de a segurança estar no código e não na instrução: **um vigia roda às
pressas, de madrugada, quando algo já está errado.** É o pior momento possível
para depender de alguém lembrar de não carregar o arquivo errado.

⚠️ **`EDGE_CONFIG` é a string de LEITURA** (`https://edge-config.vercel.com/<id>?token=…`),
diferente de `EDGE_CONFIG_TOKEN`, que é de escrita. Trocar uma pela outra deixa o
vigia cego **com a mesma mensagem de erro** de quando falta credencial — o que
manda procurar no lugar errado. A string sai do painel da Vercel: Storage → o
store → **Tokens**, ou copiando o valor da variável `EDGE_CONFIG` já cadastrada
em Environment Variables (não exige gerar token novo).

### Os seis estados e o que fazer com cada um

O relógio é **`dado_ts`** (a hora que o TSE carimbou no boletim), nunca `ts` (a hora do nosso
cálculo) — [ADR-0038 D1](../architecture/adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md).
Um pipeline que roda a cada minuto sobre um boletim congelado tem `ts` sempre novo e `dado_ts`
parado: é exatamente a falha que se quer pegar, e olhar `ts` a esconderia.

| Estado | Exit | O que significa | O que fazer |
|---|---|---|---|
| `pre_eleicao` | 0 | Não há o que apurar ainda | Nada. Silêncio é o certo. |
| `fora_da_janela` | 0 | O ciclo não deveria estar rodando agora | Nada. |
| `fresco` | 0 | Boletim dentro do limite | Nada. |
| `parado` | **2** | 🔴 Dentro da janela e o boletim não anda | Ver § Alarme de dado parado abaixo; conferir o log da função na Vercel **e** a tela. |
| `sem_payload` | **2** | 🔴 Dentro da janela e não há payload nenhum | Nenhum ciclo publicou. Conferir `CRON_ENABLED` e o log. |
| `indeterminado` | **1** | O vigia está cego (falta credencial) | Conferir `EDGE_CONFIG`/`EDGE_CONFIG_TOKEN`. **Não** concluir que o ciclo parou. |

🔴 **`indeterminado` sai com 1, não com 2, e a diferença não é cosmética.** "Não consegui
olhar" jamais pode ter a mesma cara de "olhei e está parado". Foi precisamente essa
indistinção — um 403 permanente lido como "o TSE ainda não publicou" — que custou dois dos
três dias da primeira janela de simulado (15–17/09), com **zero commits em 14, 15 e 16/09**.

### Três estados, não dois

O vigia respeita a decisão do dono de 14/09: "não começou", "não sabemos" e "apurando" são
**três** estados distintos. Um vigia que grita em fase pré-eleição é um vigia que ninguém lê
em 04/10.

### O que ainda NÃO está feito

- ⏸️ **Não há canal de alarme.** `SLACK_WEBHOOK_URL` não existe em nenhum ambiente (decisão do
  dono adiada em 18/09). O vigia **reporta**, não notifica: depende de alguém ler o relatório
  da tarefa horária.
- ⏸️ **O ensaio do `Definition of Done` da S08 não foi executado** — desligar `CRON_ENABLED`,
  esperar o vigia acusar, religar. Fazer isso **depois** da janela de 22–24/09: mexer no
  interruptor do cron às vésperas arrisca deixá-lo desligado justamente na janela.
- ⏸️ **O vigia depende da máquina do dono estar ligada.** Um dead-man's switch hospedado
  (serviço externo com página de status própria) é mais robusto e continua em aberto na S08 § 2.

### Cobertura de teste

`tests/unit/scripts/vigia-ciclo.test.ts` — 13 casos sobre o núcleo puro `avaliarCiclo`, sem
rede e sem relógio implícito. Quatro mutações aplicadas à mão em 18/09, todas vermelhas:
inverter o limiar (`>` → `>=`), remover a guarda de hora ilegível, trocar a ordem das guardas
de credencial e fase, e remover a guarda de janela.

⚠️ **A terceira sobreviveu na primeira tentativa** e o caso que a mata foi acrescentado depois
(`"cego + payload de pré-eleição ainda é indeterminado"`). O defeito que passava: com um
payload obsoleto em cache, o vigia relataria "não há o que apurar" quando na verdade não tinha
conseguido ler nada.

## Interruptor da projeção de Deputado Federal — `pnpm dep:projecao` (spec 026, 29/09)

A projeção de cadeiras e de eleitos de Deputado Federal ([ADR-0063](../architecture/adrs/0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md))
tem um interruptor que **não precisa de deploy**: uma chave do Global Config,
`interruptor-projecao-dep`, com o valor `{ligada, pct_minimo?, em?, por?}`.

### Por que não é uma variável de ambiente

Na Vercel, variável de ambiente só chega a um deployment **novo** — mudar o
valor no painel não muda nada no que já está no ar, e das **16h às 05h de
04/10** não há deploy. A chave do Global Config é lida a cada ciclo do modelo
(vai no corpo do POST, `projecao_dep`) e **a cada abertura de página**. É a
regra geral do ADR-0063: interruptor que precisa agir sem deploy mora no
Global Config, nunca em variável.

### O que "falha fechada" quer dizer

A projeção só aparece quando a chave foi **lida com sucesso** e diz
`ligada: true`. Em todos os outros casos ela some — e o resto da página
(votos, eleitos na parcial, regras, Conferência) continua igual:

| O que a leitura encontrou | Projeção | O que o operador vê no `pnpm dep:projecao` |
|---|---|---|
| `{ligada: true}` | aparece (se a trava de 25% da UF abriu) | `LIGADA — gravada na chave` |
| `{ligada: false}` | some | `DESLIGADA — gravada na chave` |
| chave **ausente** | some | `DESLIGADA — chave AUSENTE` |
| valor malformado (`false` cru, `ligada: "sim"`…) | some, com `error` no log | `DESLIGADA — valor INVÁLIDO` |
| a leitura falhou (Global Config fora) | some, com `error` no log | o script também falha ao ler (sai 1) |

Consequência importante: **a chave começa AUSENTE, então a projeção começa
DESLIGADA.** "Começa ligada" (decisão do dono) é um passo da virada, não um
default do código.

### Ligar na virada (03/10) — passo obrigatório

Depois do passo 0.5 da véspera (o `EDGE_CONFIG` do `.env.local` apontando para
o store que o site lê):

```bash
pnpm dep:projecao                                   # mostra o store e o estado — confira o id
pnpm dep:projecao --ligar --por dono --confirmar ecfg_mcoa3usgvm5dbqb27vae8ptmpdxl
```

O script só grava com o **id do store digitado** em `--confirmar`, igual ao que
ele mostrou. **Ligar é lento:** a projeção só aparece quando o modelo rodar o
próximo ciclo de Deputado com a trava da UF aberta (a volta completa leva 30
min, ADR-0036).

### Desligar na noite (04/10) — se a projeção parecer errada

```bash
pnpm dep:projecao --desligar --por dono --confirmar ecfg_mcoa3usgvm5dbqb27vae8ptmpdxl
```

**Desligar é rápido:** a página lê a chave a cada abertura e apaga a projeção do
que está no Blob antes de mostrar (`aplicarInterruptorProjecao`,
`lib/blob/deputado-uf.ts`); o alvo é sumir em **até ~60 s** (cache da página e
do CDN) — medida pendente, é o ensaio de 03/10. Confira na página de SP.

⚠️ **O que some e o que fica ao desligar.** Some a projeção **das páginas**: no
próximo render de cada uma (ISR, `revalidate = 60`, então em até ~60 s mais o
cache do CDN). **Não** some, até o próximo ciclo do modelo de Deputado (volta
completa do cargo em até **30 min**, ADR-0036), do **arquivo JSON público do
Blob** de cada UF (`deputado/uf/<UF>.json`): quem abrir o arquivo direto, sem
passar pela página, ainda vê os campos de projeção (`projecao` com `estado`
`liberada`, `cadeiras_projetadas`, `votos_projetados`, `projecao`/
`projecao_apertada` por linha) do último ciclo ligado. O ciclo seguinte, já com
a chave desligada, regrava o arquivo sem esses campos. A lista 61+
(`deputado/uf-lista/<UF>.json` e a rota `/uf/<UF>/deputado-federal/lista`)
nunca carrega dado de projeção (ADR-0065 D1) e não muda.

Subir a trava sem desligar (ex.: se o replay mostrar que 25% é cedo):
`pnpm dep:projecao --pct 40 --confirmar <id>`. O interruptor **só sobe** a
trava: um `pct_minimo` abaixo de 25, acima de 100 ou não numérico é ignorado
(com aviso no log, na página e no modelo — a trava fica em 25 e o `ligada` não
muda) — o piso de 25% só muda por ADR. `--sem-pct` volta à trava do modelo.

A leitura da chave tem teto de **2 s**: sem resposta nesse tempo, a página e o
ciclo tratam a projeção como desligada (falha fechada, ADR-0063 D4) e seguem —
o ciclo de ingestão nunca espera mais que isso pelo interruptor.

### O store errado — a trava do script

Até o passo 0.5 da véspera o `.env.local` aponta para o store de **ensaio**
(`salacofre-edge-config-preview`, `ecfg_fdlfvusqgth3gc8eaxloahrvrsgh`), que o
site **não** lê. Desligar lá não desliga nada. Por isso o script:

- lê o alvo do `EDGE_CONFIG` (o que o site lê), **nunca** do `EDGE_CONFIG_ID`
  (que desvia só a escrita do modelo durante o simulado);
- mostra o id e o nome do store, perguntando à API da Vercel;
- **recusa o store de ensaio** (por id e por nome, sai com código 3) — salvo com
  `--ensaio`, que então só aceita o de ensaio;
- do `.env.local` lê só `EDGE_CONFIG`, `EDGE_CONFIG_TOKEN` e `VERCEL_TEAM_ID` —
  nunca o `DATABASE_URL` (mesmo molde de `scripts/_vigia-env.ts`).

**Ensaio de 03/10 ("desligar → some em até 60 s"):** no store de ensaio, com um
preview apontado para ele, `pnpm dep:projecao --ensaio --desligar --confirmar
ecfg_fdlfvusqgth3gc8eaxloahrvrsgh`, cronometrando até a projeção sumir da página.

Códigos de saída: `0` mostrou ou gravou e conferiu (ou simulou, sem
`--confirmar`); `1` a API da Vercel falhou; `2` falta credencial; `3` store
recusado ou id digitado diferente do alvo; `64` uso errado.

## Vigia de configuração — `pnpm vigia:armado` (incidente de 2026-09-22)

```bash
pnpm vigia:armado --modo simulado    # janelas de simulado de setembro
pnpm vigia:armado --modo dia-d       # a partir de 25/09, e na noite de 04/10
```

Saída: **0** = armado · **2** = 🔴 desarmado · **1** = não deu para olhar (CLI sem login).

### O incidente

A janela de simulado de **22/09** (9h–17h BRT) passou **inteira** sem que uma única
requisição nossa saísse para o TSE. Não foi o TSE, não foi rede, não foi código: foi
**endereço**.

Toda a configuração do simulado — `TSE_BASE_URL`, `TSE_COD_ELEICAO_FEDERAL`,
`TSE_COD_ELEICAO_ESTADUAL`, `INGEST_WINDOW=9-17`, `CRON_ENABLED` — estava cadastrada no
ambiente **Preview**. E o Vercel Cron **só invoca o deployment de produção**:

> "To trigger a cron job, Vercel makes an HTTP GET request to your project's **production
> deployment URL**" — [vercel.com/docs/cron-jobs](https://vercel.com/docs/cron-jobs), lido
> em 2026-09-22.

Preview nunca recebe invocação de cron. E não havia deployment de preview há 5+ dias — os
~38 deployments recentes eram todos `Production`.

Consequência medida, com os 19 crons registrados e disparando normalmente:

| Faixa | O que a produção fez |
|---|---|
| 9h–17h BRT (12-20 UTC) | Sem `INGEST_WINDOW`, usa o default `"17-04"` (`lib/tse/ingest-window.ts:49`) → `{skipped:"out_of_window"}` em toda invocação. Registrado em **`logDebug`** (`lib/tse/ingest-handler.ts:415-422`), o nível mais baixo do arquivo — invisível. |
| 17h BRT em diante (20-23 UTC) | Entra na janela e **quebra a cada ~30 s**: `listIngestTargets falhou — abortando ciclo` / `Nem TSE_COD_ELEICAO_FEDERAL nem TSE_COD_ELEICAO estão definidas`, `"env":"production"`. Observado ao vivo 17:29–17:33 em 22/09. **Acontecia todas as noites.** |

⚠️ O `ts` do último payload publicado é `2026-09-17T09:03Z` = **06h03 BRT**, que está fora
de `"17-04"` **e** de `"9-17"`. Nenhum cron poderia ter passado o portão de janela nesse
horário — logo aquela publicação veio de disparo manual (`INGEST_WINDOW_OVERRIDE=true`) ou
do semeador. **O cron automático provavelmente nunca publicou nada, nem em 15–17/09.**

### Por que um vigia SEPARADO do `vigia:ciclo`

`vigia:ciclo` responde "o boletim andou?" — a pergunta certa, e ele estava correto o tempo
todo. Só não teve chance de perguntar dentro da janela: a tarefa agendada é cron **local**,
e o Mac dormiu das 22h35 de 21/09 às 17h14 de 22/09 — **21h39 sem uma única corrida**,
cobrindo a janela inteira.

`vigia:armado` responde outra: **"a máquina está apontada para o lugar certo ANTES de a
janela abrir?"**. É a única das duas que pode ser respondida na véspera, quando ainda dá
tempo de consertar. Um vigia que só sabe dizer "não andou" chega sempre tarde demais.

### O que ele confere, e o que não confere

`vercel env ls production --json` devolve os valores **criptografados**. O script confere
**presença e ambiente**, nunca valor — de propósito, e é suficiente: o defeito de 22/09 foi
exatamente ausência, quatro variáveis que existiam só em `preview`.

Conferir valor exigiria baixá-los para a máquina, e o `.env.local` já é armadilha conhecida
(a primeira variável dele é o `DATABASE_URL` de produção — ver `scripts/_vigia-env.ts`).

⚠️ `TSE_TARGETS_WHITELIST` **não** entra na lista de exigidas: ele é lido apenas no ramo
`preview` de `lib/tse/targets.ts`. Exigi-lo em produção daria falsa sensação de contenção
de fan-out.

### As duas metades da lista

`EXIGIDAS` pega o erro de 22/09 (falta de config). `PROIBIDAS` pega o **erro simétrico**,
que é pior: chegar em 04/10 com `TSE_BASE_URL` de simulado ainda em produção — o site
público serviria número de mentira na noite da eleição — ou com `INGEST_WINDOW=9-17`, que
deixaria o ciclo mudo a partir das 17h, exatamente quando a apuração começa. Por isso
`--modo dia-d` reprova por **sobra**, não só por falta.

### Cobertura de teste

`tests/unit/scripts/vigia-armado.test.ts` — 13 casos sobre o núcleo puro `avaliarArmado`,
sem rede e sem processo. Mutação aplicada à mão em 22/09: trocar
`envs.filter(e => alvos(e).includes("production"))` por `envs.map(...)`, isto é, ignorar o
ambiente. **Três testes ficaram vermelhos**, entre eles o que reproduz a configuração exata
de 22/09. Sem esses casos, a suíte inteira passaria com a verificação de ambiente removida —
e o vigia diria "armado" na manhã em que a janela se perdeu.

## Armar e desarmar produção para um simulado (procedimento, 2026-09-22)

🔴 **Leia antes**: o simulado só roda se **produção** estiver armada — Preview nunca recebe
cron (ver a seção anterior). E armar produção tem uma consequência que **não é opcional**,
a menos que você use a variante B abaixo.

### A consequência, medida

Quando um ciclo publica, ele **sobrescreve a chave inteira** (`lib/edge-config/writer.ts:1098-1107`),
e isso **apaga o campo `fase`** que o semeador grava. O orchestrator nunca escreve `fase` — a
borda de escrita só aceita `z.literal("pre_eleicao").optional()`
(`app/api/internal/edge-write/route.ts:159`), então quem grava é só
`data-pipeline/projection-seed.ts:322`.

Sem `fase`, `isPreEleicao` devolve `false` (`lib/config/fase.ts:109`, chamado em
`app/(pres)/page.tsx:595`) e a home sai do ramo `AguardandoNacional` (`:586`). **Não existe
campo, flag ou marca de "simulado" em nenhum ponto do read path** — o payload de simulado e o
real têm o mesmo shape. O site passa a exibir "CANDIDATO 9991 · P 9990 · 8,6% · p_vitoria 0,819"
com a mesma tipografia, o mesmo selo "ao vivo" e a mesma atribuição **"Fonte: TSE"** que usará
em 04/10. Latência: ≤60 s nos painéis (ISR, `app/(pres)/page.tsx:227`) e ≤30 s no mapa
(`/api/projection`).

É a mesma família do incidente de 14/09 registrado em
`docs/sprints/2026-S07-f6-simulado-hero-1t.md:328` ("o site público publicava resultados
eleitorais inventados").

### O que NÃO é problema: fan-out e rate limit

Verificado em 22/09: o rate limiter é um token bucket **por cargo**
(`lib/tse/rate-limiter.ts:203-233`), com teto vindo de `cargoInfo(cargo).rpsMax`. Mais alvos
**não elevam o pico** — só alongam o ciclo. `piorCasoAgregadoRps()` (`lib/config/cargos.ts:312-314`)
soma 25+25+25+5 = **80 rps**, contra o limite documentado do TSE de 100 rps/IP. É o mesmo volume
já dimensionado para a noite real. **Não é preciso reduzir fan-out para rodar o simulado em
produção**, e reduzir com `TSE_GRANULARIDADE=uf` custaria caro: deixaria de exercitar a
granularidade `zona`, que é exatamente o que o Passo 0 precisa confirmar contra dado real.

⚠️ `TSE_TARGETS_WHITELIST` **é no-op em produção** — só é lido nos ramos `buildPreviewTargets*`
(`lib/tse/targets.ts:928,965`). Não conte com ele para conter escopo lá.

### Variante A — armar e publicar (rehearsal completo)

Exercita a cadeia inteira, incluindo a publicação. **O site público mostra os números do
simulado durante a janela.** Fato atenuante medido em 19/09: o domínio próprio de então (`.com.br`) não resolvia
(`docs/reference/risks.md`), então o único endereço no ar era o `.vercel.app`.

```bash
printf 'https://resultados-sim.tse.jus.br/simulado/simulado2026' | vercel env add TSE_BASE_URL production
printf 'ele2026/21270' | vercel env add TSE_COD_ELEICAO_FEDERAL production
printf 'ele2026/21272' | vercel env add TSE_COD_ELEICAO_ESTADUAL production
printf '9-17'          | vercel env add INGEST_WINDOW production
vercel --prod          # 🔴 OBRIGATÓRIO: env var só vale a partir de um deployment novo
pnpm vigia:armado --modo simulado   # tem de sair 0
```

### Variante B — armar SEM publicar no site público (recomendada)

Mesma ingestão, mesmo modelo, mesma gravação — só que o payload cai num **store separado**, e
o site continua lendo o antigo. Funciona porque leitura e escrita usam variáveis diferentes:
o site lê `EDGE_CONFIG` (`lib/edge-config/reader.ts:252`) e o gravador resolve o destino por
`EDGE_CONFIG_ID`, caindo no id extraído de `EDGE_CONFIG` só quando `EDGE_CONFIG_ID` está
ausente (`lib/edge-config/writer.ts:201-209`) — que é o estado de produção hoje.

Acrescente, além dos quatro comandos da variante A:

```bash
printf '<ecfg_do_store_de_ensaio>' | vercel env add EDGE_CONFIG_ID production
```

Custo: os números do simulado **não aparecem na tela**. Para vê-los, aponte um preview para o
store de ensaio, ou leia o store direto.

### Estado aplicado em 22/09 — variante B, com as duas gavetas que já existiam

`vercel global-config list` em 22/09 revelou que **os dois stores já existiam**, e que a
separação necessária já estava no lugar sem ninguém ter planejado:

| id | slug | itens | atualizado |
|---|---|---|---|
| `ecfg_mcoa3usgvm5dbqb27vae8ptmpdxl` | `salacofre-edge-config` | **0** | 14/09 |
| `ecfg_fdlfvusqgth3gc8eaxloahrvrsgh` | `salacofre-edge-config-preview` | 4 | **17/09 09:03** |

O `EDGE_CONFIG` de **produção** aponta para o primeiro — **vazio**. É por isso que o site
público mostra "Esta página ainda não recebeu dados de apuração": não é fase pré-eleição, é
**ausência de payload** (`app/(pres)/page.tsx:586`, o ramo `AguardandoNacional`, que vem uma
linha *antes* do teste de `fase`). O simulado de 17/09 caiu no segundo store, que é o que o
`.env.local` e portanto o `pnpm vigia:ciclo` leem.

Aplicado então, sem criar store novo:

```
TSE_BASE_URL             = https://resultados-sim.tse.jus.br/simulado/simulado2026
TSE_COD_ELEICAO_FEDERAL  = ele2026/21270
TSE_COD_ELEICAO_ESTADUAL = ele2026/21272
INGEST_WINDOW            = 9-17
EDGE_CONFIG_ID           = ecfg_fdlfvusqgth3gc8eaxloahrvrsgh   ← desvia a ESCRITA
```

seguido de `vercel redeploy <deployment de produção> --target production` — **redeploy do que
já estava no ar**, não `vercel --prod`, que empacotaria a árvore local (havia 19 arquivos
modificados e não commitados).

**Verificação feita, sem um único GET ao TSE**: `GET /api/ingest/presidente` com
`Authorization: Bearer $CRON_SECRET` respondeu `{"skipped":"out_of_window"}` às 17h50 BRT.
Antes do redeploy, esse horário caía **dentro** do default `"17-04"` e a rota morria no código
da eleição ausente — o `out_of_window` é prova de que o deployment leu a `INGEST_WINDOW` nova.
O portão de janela vem **antes** de `listIngestTargets`, então a checagem não gera tráfego
externo em nenhum dos desfechos possíveis.

⚠️ **Consequência para o `vigia:ciclo` nestes dias**: ele lê o `EDGE_CONFIG` do `.env.local`,
que é o store de **ensaio** — exatamente onde o simulado vai escrever. Isso é o que se quer
em 23–24/09. **Mas depois de desarmar, ele passa a vigiar a gaveta errada**: o site público lê
a outra. Repontar o `EDGE_CONFIG` do `.env.local` para `ecfg_mcoa3usgvm5dbqb27vae8ptmpdxl`
faz parte do checklist abaixo.

🔴 **Resíduo no banco — medido em 27/09, filtro entregue** (decisão do dono, opção B: não
apagar, só ignorar no cálculo — apagar fica para depois da eleição). `DATABASE_URL` em produção
é o banco real, e o ciclo grava `snapshots` a cada rodada. Medido em 27/09: **~296 mil linhas**
gravadas entre 23–26/09 com os códigos de eleição do **simulado oficial do TSE** (21270/21272),
cargos 1/3/5/6, turno 1, sobre os **MESMOS pares** uf×município×zona dos reais, com
`pct_apurado` = 100% — e o simulado segue recebendo até a virada de 03/10. Sem correção,
`fetch_snapshots` (`api/model/project.py:469`) e `fetch_municipio_aggregates`
(`api/model/project.py:1774`) escolhem por frescor de `ts` (`ROW_NUMBER() ... ORDER BY ts
DESC`) — e "mais recente" não é "real": todo par sem boletim de 04/10 ainda gravado entraria
no cálculo com os votos do simulado, porque não há nenhum outro sinal que distinga as duas
famílias.

O conserto (27/09): as duas funções agora recusam, no `WHERE` da CTE, qualquer linha com `ts`
anterior ao início do dia da eleição do turno (`AND ts >= %s` / `AND s.ts >= %s`) — filtro por
`ts` (coluna indexada, `ix_snap_lookup_par`), nunca por `payload->>'ele'` (destoastaria o JSONB
inteiro de cada linha no hot path). O corte só passa a valer quando o **instante do gatilho do ciclo**
(`trigger_ts`, o mesmo que alimenta a seed — constituição § 6; `_instante_do_gatilho`,
`api/model/project.py:366`) já alcançou o instante do turno (`_ts_minimo_valido`,
`api/model/project.py:336`, espelha `lib/config/calendar.ts:92-103`, amarrado por
`tests/unit/model/test_corte_residuo_calendario_sync.py`) — antes disso (hoje, o ensaio de 03/10, os testes de
integração que gravam `ts = now()`) o comportamento é idêntico ao anterior a esta mudança, e
nenhuma linha some do cálculo por causa de data. `snapshots` continua append-only (constituição
§ 10) — nada é apagado; a limpeza física do resíduo é uma decisão separada, tomada depois da
eleição. A série por candidatura (spec 020) **não** passa por este filtro — ela lê `projections`, não
`snapshots` —, mas tem janela própria de 24 h por `ts` **e** por `dado_ts`
(`_SERIE_POR_CANDIDATO_SQL` e `SERIE_JANELA_HORAS = 24`, `api/model/project.py:962` e `:1068`):
as linhas de setembro ficam fora dela na noite de 04/10. O que ainda caberia na janela seriam
projeções gravadas em 03/10 depois das ~17h (ensaio já com os códigos reais, sem voto), se o
modelo chegar a rodar nessa noite. ⚠️ A conferência de
[resíduo de harness no banco](#conferir-resíduo-de-harness-no-banco) **não detecta** o resíduo
do simulado (procura `cargo NOT IN (1,3,5,6)` e `candidato_id` 100–299); para medir este, contar
`snapshots` por dia com `ts >= '2026-09-14'`.

### Desarmar — 🔴 checklist obrigatório antes de 04/10

```bash
vercel env rm TSE_BASE_URL production --yes
vercel env rm INGEST_WINDOW production --yes
vercel env rm TSE_COD_ELEICAO_FEDERAL production --yes     # os do simulado NÃO servem ao dia D
vercel env rm TSE_COD_ELEICAO_ESTADUAL production --yes
vercel env rm EDGE_CONFIG_ID production --yes              # só se usou a variante B
vercel --prod
pnpm projection:seed                                       # devolve `fase: pre_eleicao` à tela
pnpm vigia:armado --modo dia-d                             # tem de sair 0
```

E, fora da CLI: repontar o `EDGE_CONFIG` do `.env.local` para
`ecfg_mcoa3usgvm5dbqb27vae8ptmpdxl` (o store que o site lê), senão o `vigia:ciclo`
passa a vigiar a gaveta de ensaio e ficaria mudo na noite de 04/10.

⚠️ **Os códigos reais da eleição ainda não existem.** Produção publicou `6257`/`6259` em 18/09
e eles sumiram em 19/09; o TSE insere os parâmetros oficiais por volta de **03/10**. Portanto
entre 25/09 e 03/10 `--modo dia-d` vai acusar os dois códigos como faltando, **e está certo** —
é pendência real, não falso alarme.

⚠️ `pnpm vigia:armado --modo dia-d` reprova por **sobra**, não só por falta: `TSE_BASE_URL`,
`INGEST_WINDOW`, `INGEST_WINDOW_OVERRIDE`, `EDGE_CONFIG_ID`, `TSE_GRANULARIDADE`, `TSE_CARGOS`
e `TSE_MAX_RPS` deixados para trás reprovam o check. É essa metade que impede o erro simétrico
— chegar na noite da eleição buscando o CDN de teste, ou lendo um store que ninguém alimenta.

## Ferramentas do pipeline TSE

Três ferramentas introduzidas no hardening pré-simulado (Fase 0 da S07). As duas primeiras existem para que **nenhum teste precise tocar o CDN do TSE**.

### `pnpm tse:watch` — monitor de publicação do TSE

```bash
pnpm tse:watch --once                                   # uma passada, sai
pnpm tse:watch --interval 300 --slack                   # loop de 5 min, alerta no Slack
pnpm tse:watch --once --base-url https://resultados-sim.tse.jus.br/simulado/simulado2026
```

O que faz (`scripts/tse-watch.ts`):

1. **1 GET** em `<base-url>/comum/config/ele-c.json` — hash SHA-256 do corpo, ETag, `Last-Modified`; extrai `{ ciclo, dg, hg, eleicoes[] }`.
2. **9 HEAD** nas páginas técnicas dos leiautes listadas em `scripts/tse-watch.targets.json` (URLs preenchidas por humano, verificadas em 05/09). `www.tse.jus.br` responde 403 a cliente não-navegador: tratado como `inacessivel`, **não** como mudança.
3. Compara com `build/tse-watch/state.json` (`--state` para trocar) e imprime o diff.
4. **Quando surgir uma eleição com `t=1|2` e nome contendo "2026", o alerta sai em MAIÚSCULAS** — `ELEIÇÃO GERAL 2026 DETECTADA`. É esse o sinal que destrava `TSE_COD_ELEICAO`.

Exit codes: `0` sem mudança · `2` com mudança · `1` erro. UA próprio, `AtlasMenna-watch/1.0`, sem alegação de cadastro. Não precisa de Postgres. **Nunca sonda URL adivinhada** — só os 10 alvos acima.

> Em 05/09 o `ele-c.json` de produção ainda está em `ele2024`. Rodar `--once` **diariamente** até o TSE publicar; se nada aparecer até **~12/09**, abrir chamado em `30308800.tse.jus.br` (descrição começando com `Resultados - Divulgação`).

### `pnpm tse:mock` — CDN falso

```bash
pnpm tse:mock --port 8787                       # default 8787
pnpm tse:mock --port 8787 --rate-limit-after 300   # 429 + Retry-After: 1 após N GETs
pnpm tse:mock --port 8787 --not-found-ratio 0.1    # 10% dos alvos em 404 (determinístico)
pnpm tse:mock --port 8787 --latency-ms 200         # latência artificial
```

Serve fixtures **no layout de URL real** do CDN (incluindo `/oficial/comum/config/ele-c.json` sintético), com ETag e `304` em `If-None-Match`. Nível **zona** vem de `tests/fixtures/tse/2022/` (trocável com `--fixtures`); níveis **uf / br / município / acompanhamento** vêm sempre de `tests/fixtures/tse/2026/`. `--cod-eleicao` é documental — o matching é por `(uf, zona/nível)`, então qualquer código no path funciona. É a única superfície legítima para exercitar 404, 429, retry e alertas.

### Dry-run completo do ingest, sem tocar o TSE

```bash
# terminal 1
pnpm tse:mock --port 8787 --rate-limit-after 300

# terminal 2
TSE_BASE_URL=http://localhost:8787/oficial TSE_COD_ELEICAO=ele2022/544 \
INGEST_WINDOW_OVERRIDE=true TSE_MAX_RPS=10 pnpm dev

# terminal 3
curl -X POST localhost:3000/api/ingest -H "x-cron-secret: $CRON_SECRET"
```

Verificar na resposta: `rateLimited` (retry de 429 funcionou), `changed > 0`, `notFound`, `waitedMs`, e `pct_projetado` em escala 0–100 no payload gerado.

> Carregar `.env.local` antes da suíte completa — 8 arquivos de teste dependem do Neon:
> ```bash
> set -a; . ./.env.local; set +a
> pnpm test                             # vitest — 3.492 verdes em 20/09
> .venv-model/bin/python3.14 -m pytest  # 626 verdes em 20/09
> ```
> ⚠️ Duas ressalvas de 17/09, as duas medidas:
> 1. **`pnpm test:py` está quebrado** — o script é `python -m pytest`, pega o `python` do PATH
>    e morre com `ModuleNotFoundError: pydantic`. Use o intérprete do venv, explícito, como
>    acima.
> 2. Com `.env.local` carregado, os cinco testes que **escrevem** no banco ficam em
>    `describe.skip` — é o desenho, ver
>    [`ALLOW_DB_WRITE_TESTS`](#-regra-operacional-crítica--allow_db_write_tests-17092026).
>    Resta 1 falha de ambiente pré-existente em `ResultPanelAvatar`, que assume Blob não
>    configurado.

## Cross-refs

- ADR-0020 (conformidade Res. 23.751/2026): [../architecture/adrs/0020-conformidade-res-23751-2026.md](../architecture/adrs/0020-conformidade-res-23751-2026.md)
- Leiautes TSE 2026 (fonte técnica, fan-out § 6): [../reference/tse-2026-leiautes.md](../reference/tse-2026-leiautes.md)
- Protocolo dos simulados: [../testing/tse-simulados.md](../testing/tse-simulados.md)
- Alertas Slack: [./alerts.md](./alerts.md)
- Dashboard `/_status`: [./dashboard-status.md](./dashboard-status.md)
- Disponibilidade: [../nfr/availability.md](../nfr/availability.md)
- Performance NFR: [../nfr/performance.md](../nfr/performance.md)
- Spec 001 (ingestão TSE): [../specs/001-ingestao-tse/](../specs/001-ingestao-tse/)
- Spec 002 (modelo estatístico): [../specs/002-modelo-estatistico/](../specs/002-modelo-estatistico/)
