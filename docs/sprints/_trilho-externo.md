---
id: TRILHO-EXTERNO
title: Trilho externo — os três compromissos em data do TSE
description: Roteiros executáveis para as três janelas que o TSE controla (22–24/09, 02–03/10, 03/10) — fora das sprints, porque a data não é nossa
status: standing
gatilhos: [2026-09-22, 2026-10-02, 2026-10-03]
---

# Trilho externo — os três compromissos em data do TSE

> **Isto não é uma sprint.** É o irmão mais novo de [`_D1-04out2026.md`](./_D1-04out2026.md): o que
> vem **antes** do dia D. O prefixo `_` é a convenção de `docs/sprints/` para arquivos que não são
> sprint (ver também [`_D2-25out2026.md`](./_D2-25out2026.md)).

Por decisão do dono (18/09) as sprints passam a ser ordenadas **por dependência, sem data**. Sobram
três itens que não cabem nessa ordenação porque o relógio deles é do TSE, não nosso:

| # | Item | Gatilho | Antecipável? |
|---|---|---|---|
| 1 | [Janela de simulado do TSE](#item-1--janela-de-simulado-do-tse--gatilho-2224092026) | **22–24/09/2026**, 9h–12h e 14h–17h BRT | Parcialmente — o preparo sim, a medição não |
| 2 | [Código da eleição de produção](#item-2--código-da-eleição-de-produção--gatilho-03102026) | **03/10/2026** | **Não.** Nada neste projeto é menos antecipável |
| 3 | [Reimportação do cadastro de candidaturas](#item-3--reimportação-do-cadastro-de-candidaturas--gatilho-0203102026) | **02–03/10/2026** | Não — o valor está em ser tardio |

Cada seção tem a mesma estrutura: **Gatilho** (a data e como saber que chegou), **Roteiro** (passo a
passo executável) e **Como saber que deu certo** (critério observável). Não são tarefas a planejar.
São roteiros a executar.

---

## Item 1 — Janela de simulado do TSE · gatilho 22–24/09/2026

> ✅ **Conferido na Vercel em 2026-09-18: o preview JÁ ESTÁ ARMADO e o ciclo dispara
> sozinho.** `TSE_BASE_URL` aponta para `https://resultados-sim.tse.jus.br/simulado/simulado2026`
> (o endereço CERTO), as duas chaves de eleição estão em `ele2026/21270` e `ele2026/21272`,
> `CRON_ENABLED=true` e `INGEST_WINDOW=9-17` — que é exatamente a janela do TSE. **Nenhum
> passo de disparo é necessário.**
>
> 🔴 **O que continua faltando não é disparar, é ASSISTIR**: sem `SLACK_WEBHOOK_URL` nada
> avisa se o ciclo falhar, e a tabela "Registro das janelas" é preenchida à mão. O roteiro
> abaixo vira, na prática, um roteiro de **observação e registro**.

### Por que este documento existe: a primeira janela foi perdida quase inteira

A 1ª janela (15–17/09) rendeu **um único ciclo real**, na madrugada de 17/09. Evidência direta no
histórico do repositório:

```bash
git log --since=2026-09-14T00:00:00 --until=2026-09-16T23:59:59 --oneline | wc -l   # → 0
```

**Zero commits em 14, 15 e 16/09** — dois dias e meio de janela oficial sem um único registro.

A causa foi de endereço, não de código. A vigia horária (`~/.claude/scheduled-tasks/vigia-tse-2026`)
e o Passo 1 do protocolo apontavam para `resultados-sim.tse.jus.br/**oficial**`, que responde **403
para sempre**: o segmento do caminho é o **ambiente**, e `oficial` é o de produção. O ambiente de
simulado é `simulado/simulado2026`, e estava no ar desde a noite de 14/09 (`ele-c.json` com
`dg: 14/09/2026`). Ninguém foi avisado porque a vigia estava medindo o 403 errado — e um 403
permanente é indistinguível de "ainda não subiu".

⚠️ **Dois documentos do repositório ainda ensinam o endereço errado** — outro trabalho está
corrigindo; aqui ficam como referência cruzada, **não como instrução**:

- [`2026-S07-f6-simulado-hero-1t.md:497-509`](./2026-S07-f6-simulado-hero-1t.md) — Fase 4, passos 1 e 2
- [`../_meta/plano-s07-2026-09-05.md:192-193`](../_meta/plano-s07-2026-09-05.md) — Fase 4, itens 1 e 2

O protocolo canônico, e o único a seguir, é [`../testing/tse-simulados.md`](../testing/tse-simulados.md).

### Parâmetros reais — obtidos, nunca adivinhados

Todos saíram do próprio `ele-c.json` do ambiente de simulado em 17/09 e estão congelados em
`tests/fixtures/tse/2026-sim/README.md` e no
[ADR-0044](../architecture/adrs/0044-codigo-eleicao-por-cargo.md):

| Parâmetro | Valor | Onde conferir |
|---|---|---|
| Ambiente | `https://resultados-sim.tse.jus.br/simulado/simulado2026` | `tests/fixtures/tse/2026-sim/README.md` |
| Pleito | `17801` | idem |
| Ciclo | `ele2026` — vive em `pl[].c`, **não** na raiz do `ele-c.json` | `scripts/tse-watch.ts`, corrigido em `9a56ef4` |
| Eleição **21270** | Federal — **Presidente** (cargo TSE 1) | [ADR-0044](../architecture/adrs/0044-codigo-eleicao-por-cargo.md) |
| Eleição **21272** | Estadual — **Governador (3), Senador (5), Deputado Federal (6)** | idem |
| Eleição 21274 | Municipal (Conselheiro Distrital) — **fora de escopo** | idem |
| Campo `f` | `"s"` em ambiente de simulado | medido nos **14** arquivos de `tests/fixtures/tse/2026-sim/*.json` |

🔴 **Nunca sondar URL adivinhada.** Uma requisição malformada pode bloquear o IP por **10 minutos** e
queimar uma das poucas faixas de teste que restam antes de 04/10. Teste exploratório roda contra
`pnpm tse:mock`, nunca contra o CDN do TSE. Fundamento em
[ADR-0020](../architecture/adrs/0020-conformidade-res-23751-2026.md) e no
[runbook § Conformidade TSE](../operations/runbook.md#conformidade-tse-rf-010--spec-001).

### Gatilho

**22/09/2026, antes das 9h BRT.** Como saber que a janela abriu — e não confiar no calendário:

```bash
pnpm tse:watch --once --base-url https://resultados-sim.tse.jus.br/simulado/simulado2026
```

Resposta esperada: HTTP 200 com as eleições `21270` / `21272` sob o ciclo `ele2026`. **403 continuado
no endereço acima** (não no `/oficial`) significa que o ambiente caiu ou mudou — neste caso o
protocolo **para aqui** e vira chamado em `30308800.tse.jus.br` (descrição começando com
`Resultados - Divulgação`), exatamente como em
[`../reference/risks.md`](../reference/risks.md). Não prosseguir por tentativa e erro.

### Roteiro

**Passo 0 — conferir que a vigia olha o endereço certo.** Antes de qualquer outra coisa, e é o
conserto da falha de 15–17/09:

```bash
grep -rn "resultados-sim.tse.jus.br" ~/.claude/scheduled-tasks/ docs/ scripts/
# Nenhuma ocorrência de ".../oficial" deve sobrar apontando para o ambiente de simulado.
```

**Passo 1 — armar o preview.** As sete variáveis de escopo `preview` já foram criadas em 13/09 e
atualizadas em 17/09 (`TSE_BASE_URL`, `INGEST_WINDOW=9-17`, `TSE_MAX_RPS`, `TSE_TARGETS_WHITELIST`,
`TSE_ACOMPANHAMENTO`, `TSE_GRANULARIDADE=zona`, `CRON_ENABLED`). As **duas** que carregam o código da
eleição são as do [ADR-0044](../architecture/adrs/0044-codigo-eleicao-por-cargo.md):

```
TSE_COD_ELEICAO_FEDERAL=ele2026/21270      # cargo 1
TSE_COD_ELEICAO_ESTADUAL=ele2026/21272     # cargos 3, 5, 6
```

⚠️ `INGEST_WINDOW=9-17` não é detalhe: o default é `17-04` e **excluiria a janela inteira** do
simulado, que roda de manhã e à tarde.

**Passo 2 — primeiro ciclo manual, um cargo só.** Não ligar o cron antes de um ciclo verde a olho nu:

```bash
curl -X POST https://<preview-url>/api/ingest/presidente  -H "x-cron-secret: $CRON_SECRET"
curl -X POST https://<preview-url>/api/ingest/governador  -H "x-cron-secret: $CRON_SECRET"
```

**Passo 3 — ligar o cron e deixar a faixa da manhã (9h–12h) rodar inteira.** Depois exportar, por
ciclo, os cinco números que a tabela "Registro das janelas" pede.

**Passo 4 — faixa da tarde (14h–17h): escalar a taxa.** Só se a manhã fechou com `rateLimited == 0`,
subir `TSE_MAX_RPS` de 20 → 30 e repetir. Qualquer 429 → voltar a 20 e **registrar o ponto de
quebra**: é esse número que calibra produção.

⚠️ O teto por cargo (`rpsMax` em `lib/config/cargos.ts:197,210,223,236` — hoje **25/25/25/5**)
**nunca viu um único 429 real**. É estimativa de segurança, não medição, e a penalidade de errar para
cima é bloqueio de IP por 10 minutos. Esta janela é a última chance de transformá-lo em número
medido antes de 04/10 — é o item aberto em
[`../operations/pre-prod-checklist.md`](../operations/pre-prod-checklist.md) § Conformidade TSE.

**Passo 5 — dias 23 e 24: ampliar.** Whitelist progressiva (algumas UFs → 27), `TSE_ACOMPANHAMENTO=on`
só depois do EA15 mapeado, e fan-out completo com `TSE_GRANULARIDADE=zona`.

### O que esta janela precisa produzir (e a primeira não produziu)

A tabela **"Registro das janelas"** de
[`../testing/tse-simulados.md`](../testing/tse-simulados.md#registro-das-janelas) está hoje **em
branco — todas as células vazias**, para as cinco linhas (15/09 manhã, 15/09 tarde, 16/09, 17/09,
22–24/09). Preencher **durante** a janela, não depois:

| Coluna | De onde sai |
|---|---|
| `codEleicao` + **fonte** | `ele-c.json` do ambiente de simulado ou comunicado oficial |
| `TSE_MAX_RPS` | o valor em vigor naquele ciclo |
| Ciclos | contagem em `ingest_log` |
| `rateLimited` | resposta do ciclo e `ingest_log` |
| `notFound` | idem — 404 legítimo de zona sem dado ≠ URL errada |
| Lag p95 | métrica `tse.lag_seconds` |
| Duração do ciclo | `duration_ms` por ciclo |
| Payload | tamanho do payload nacional publicado no Global Config |

Sem esses números, quatro decisões continuam sem base medida — fan-out de produção, `TSE_MAX_RPS` de
produção, `INGEST_CONCURRENCY`/`maxDuration`, e o path real do EA15 (listadas em
[`../testing/tse-simulados.md`](../testing/tse-simulados.md#decisões-que-dependem-destes-dados)).

### Dois defeitos silenciosos que o único ciclo de 17/09 comprou

Valem como aviso do **tipo** de coisa que aparece só contra dado real — ambos passavam por verdes:

1. **Vercel BotID devolvia 403 em `/api/ingest/*`.** Nenhum cliente legítimo dessas rotas é
   navegador (Vercel Cron, runtime Python do modelo, `curl` do runbook), então todos eram
   classificados como bot. A resposta do primeiro ciclo manual foi `{"error":"bot_detected"}`.
   Corrigido em `0bd95e0` (`proxy.ts`): portão de autenticação **antes** da detecção, casamento por
   segmento de rota. **É o mesmo caminho do cron de 04/10.**
2. **O SSO da Vercel devolvia 401 na autochamada — com o ciclo reportando `ok: true`.** O deployment
   de preview fica atrás do SSO, e isso vale para a requisição que o próprio deployment dispara
   contra a própria URL: `triggerModel` recebia 401 **da plataforma**, antes de chegar ao Python, e
   como o trigger é best-effort o ciclo terminava `ok: true` com a tela vazia. Corrigido em `ce1dd91`
   (`lib/tse/ingest-handler.ts:214-219`, `api/model/project.py`) enviando
   `VERCEL_AUTOMATION_BYPASS_SECRET` nos dois saltos internos.

Corolário operacional: **`ok: true` não é evidência de nada.** Confira o log da função e a tela.

### Como saber que deu certo

- [ ] As cinco linhas da tabela "Registro das janelas" **preenchidas**, `22–24/09` inclusive.
- [ ] Dois ciclos completos (27 UFs × cargos ativos) **sem um 429**.
- [ ] `rpsMax` de produção decidido a partir de número **medido**, e o item correspondente de
      [`../operations/pre-prod-checklist.md`](../operations/pre-prod-checklist.md) marcado.
- [ ] Lag `tse.lag_seconds` < 90 s, ou o desvio registrado em
      [`../reference/risks.md`](../reference/risks.md) com o número real.
- [x] ~~Payload nacional < 75 KB~~ — **MEDIDO em 2026-09-19, e o limiar estava errado.**
      Os 75 KB foram calibrados para "11 candidatos + `cenarios_2t`" (está escrito no
      `writer.ts`). Aplicá-los ao **Senado**, que junta 27 corridas de 2 vagas num payload
      só — **285 candidaturas** —, fazia o alarme tocar por o cargo existir: 98,8 KiB
      medidos, e **94,3 KiB já antes** daquela sessão. O limiar passou a acompanhar o
      elenco (`limiarNacionalBytes`, `lib/edge-config/writer.ts`): piso de 75 KB no ponto
      de calibração, mais 512 B por candidatura acima de 12 — ~1,8× o custo marginal
      **medido** de 281 B, que é constante nos dois cargos de 27 corridas.

      | cargo | limiar | payload real | folga |
      |---|---|---|---|
      | Presidente (12) | 75 KiB | 26,7 KiB | 2,8× |
      | Governador (180) | 159 KiB | 70,0 KiB | 2,3× |
      | Senador (285) | 215 KiB | 98,8 KiB | 2,2× |

      A parede de verdade não mudou: 1 MB de store, aviso em 780 KB, erro em 940 KB — e o
      store inteiro está em ~410 KB. Travado por `tests/unit/edge-config/limiar-nacional.test.ts`,
      que mede contra os payloads REAIS.

      ⚠️ **O que continua a vigiar é o CRESCIMENTO, e o gatilho é o Item 3 desta página**:
      a reimportação do cadastro em 02–03/10 pode aumentar o número de candidaturas, e este
      payload cresce junto. **Remedir depois dela.**
- [ ] As 4 rotas do preview renderizando 1º turno com dado do simulado: `/`, `/uf/SP`, `/governador`,
      `/uf/SP/governador`.

---

## Item 2 — Código da eleição de produção · gatilho 03/10/2026

### Gatilho

**03/10/2026, véspera do 1º turno.** É quando o TSE insere os parâmetros oficiais no data center.

Estado de hoje, verificado: o `ele-c.json` de **produção** ainda anuncia `ciclo: "ele2024"` —
`build/tse-watch/state.json`, campo `eleC.ciclo`, com `updatedAt: "2026-09-18T05:29:40.130Z"` e
`lastModified: "Wed, 17 Jun 2026 20:36:58 GMT"`. As eleições listadas lá são municipais de 2024 e
consultas populares. Nada de 2026.

Como saber que chegou:

```bash
pnpm tse:watch --once     # produção; exit 0 = nada mudou, exit 2 = mudou
```

O watch destaca em MAIÚSCULAS (`ELEIÇÃO GERAL 2026 DETECTADA`) quando surgir eleição com `t=1|2` e
nome contendo "2026". Rodar **diariamente** até lá.

### Por que isto é bloqueante absoluto

Sem o código, a coleta **não roda em ambiente nenhum**. `getCodEleicao()`
(`lib/tse/targets.ts:332`) lança explicitamente quando nenhuma das variáveis está definida
(`lib/tse/targets.ts:340-351`). Não há default, e isso é deliberado: um `codEleicao` chutado vira
URL malformada contra o CDN do TSE, e URL malformada bloqueia o IP por 10 minutos — na véspera ou no
dia da apuração.

As variáveis são **duas**, uma por eleição
([ADR-0044](../architecture/adrs/0044-codigo-eleicao-por-cargo.md), `lib/tse/targets.ts:296-297`):

```
TSE_COD_ELEICAO_FEDERAL=ele2026/<n>     # cargo 1 — Presidente
TSE_COD_ELEICAO_ESTADUAL=ele2026/<m>    # cargos 3, 5, 6
```

⚠️ Uma eleição **nunca** supre a outra: setar só a federal não dá à estadual valor nenhum — ela lança
do mesmo jeito. Formato exigido: `ele<AAAA>/<dígitos>`, validado por regex
(`lib/tse/targets.ts:300`).

🔴 **Jamais adivinhar a URL.** Obter o código de `pnpm tse:watch --once` ou de comunicado oficial do
TSE — nunca de tentativa e erro, nunca por analogia com 2022 ou 2024.

### Roteiro

> 📋 **Passo a passo para o dono, em linguagem simples:** [`../operations/vespera-03-10.md`](../operations/vespera-03-10.md).

1. **03/10, manhã** — `pnpm tse:watch --once` contra produção. Se `exit 2`, ler os códigos das
   eleições Federal e Estadual no `ele-c.json`, anotando **a fonte e o horário**.
2. Se até o meio-dia não houver sinal: chamado em `30308800.tse.jus.br` (descrição começando com
   `Resultados - Divulgação`), telefone `(61) 3030-8800`. Não sondar.
3. Criar as duas variáveis no escopo **production** do projeto na Vercel.
4. **Redeploy** — variável de ambiente só vale para deployments criados depois dela.
5. Ciclo manual contra produção, **fora** da janela de ingestão, com um alvo só, para provar o
   endereço sem gastar orçamento de requisição.
6. Marcar o item correspondente em
   [`../operations/pre-prod-checklist.md`](../operations/pre-prod-checklist.md) § Conformidade TSE.

### Alguém de plantão em 03/10

Este é o **único** item do projeto inteiro que não pode ser antecipado — não existe versão dele que
possa ser feita em 30/09. Se ninguém estiver de plantão em 03/10, o produto não apura em 04/10. O
nome do plantonista entra na seção _Quem está de plantão_ de [`_D1-04out2026.md`](./_D1-04out2026.md).

### Como saber que deu certo

- [ ] `TSE_COD_ELEICAO_FEDERAL` e `TSE_COD_ELEICAO_ESTADUAL` presentes no escopo production, com
      valor no formato `ele2026/<dígitos>` e **fonte registrada**.
- [ ] Deployment de produção **posterior** à criação das duas variáveis.
- [ ] Ciclo manual de prova: HTTP 200 do CDN, `notFound` compatível com o alvo escolhido,
      `rateLimited == 0`, snapshot gravado.
- [ ] `pnpm list-targets --env production --cargo 1` devolve ~**6.110** alvos (um por par
      município×zona) sem lançar.

---

## Item 3 — Reimportação do cadastro de candidaturas · gatilho 02–03/10/2026

### Gatilho

**02–03/10/2026**, o mais tarde possível antes do dia D. O valor deste item é justamente ser tardio:
substituições, renúncias e indeferimentos de registro continuam entrando até a véspera, e o cadastro
que vale na noite da apuração é o último.

### Roteiro — a ordem não é sugestão

```bash
set -a; . ./.env.local; set +a

pnpm candidatos:import     # 1. baixa os dois CSVs do TSE → só Postgres; foto_ok = false
pnpm candidatos:fotos      # 2. baixa os ZIPs de foto → Blob; marca foto_ok = true
pnpm candidatos:publish    # 3. lê o Postgres → 82 fatias + candidatos/index.json no Blob
# 4. redeploy de produção
```

Os três nomes de script estão conferidos no `package.json`. O detalhe de cada passo — o que cada um
faz e, principalmente, o que **não** faz — está em
[`../operations/runbook.md`](../operations/runbook.md#publicação-das-fatias-e-índice-pós-importação).

⚠️ O passo 3 **fotografa o estado do banco no instante em que roda**. Rodar antes do passo 2 publica
as fatias com `foto_ok: false` para todo mundo, e os cartões caem no avatar de iniciais **mesmo com
as fotos já no ar** — sem erro, sem alarme, só errado na tela. Já aconteceu em 13/09: a primeira
publicação pegou 446 de 7.698 fotos porque as duas trilhas rodavam em paralelo.

### 🔴 Sem o redeploy final o site serve a lista velha por até 12 horas

O passo 4 não é cerimônia. A leitura das fatias de candidatura é cacheada por **43.200 segundos**:

- `lib/blob/candidatos.ts:169` — `CANDIDATOS_REVALIDATE_SECONDS = 43_200`
- `lib/blob/candidatos.ts:247` — `fetch(url, { next: { revalidate: CANDIDATOS_REVALIDATE_SECONDS } })`
- `app/(cand)/candidatos/page.tsx:125` — `export const revalidate = 43_200` (literal duplicado por
  imposição do Next, com teste de sincronia em `tests/unit/pages/candidatos.test.tsx`)

Doze horas é o intervalo certo para um dado que **normalmente** não se move — quem se candidatou,
com que número e por que partido está fechado desde o registro. Mas escrever no Blob **não invalida
o Data Cache**: sem o redeploy, o site continua servindo a fatia anterior por até 12 h. Na noite de
04/10 isso significa nome e foto de quem foi substituído, renunciou ou teve registro indeferido
aparecendo no placar ao vivo.

### Como saber que deu certo

- [ ] `pnpm candidatos:publish` reportou as **82** fatias + `candidatos/index.json` gravadas.
- [ ] Contagem de `foto_ok = true` no Postgres compatível com o total de candidaturas publicáveis —
      não com 446.
- [ ] Deployment de produção **posterior** ao passo 3.
- [ ] `curl` na página pública `/candidatos` mostrando um nome que **mudou** nesta reimportação.
- [ ] 🔴 **Payload do Senado remedido** (acrescentado em 2026-09-19). Ele é o maior dos
      quatro — **98,8 KiB** com 285 candidaturas —, e esta reimportação é o único evento
      previsto que pode aumentar o elenco. O limiar acompanha o elenco desde 19/09
      (`limiarNacionalBytes`), então o alarme por chave não vai tocar à toa; o que pode
      apertar é o **store inteiro**, hoje em ~410 KB de 1 MB (aviso em 780 KB, erro em
      940 KB). Medir com:
      ```bash
      node -e "const d=require('./tests/fixtures/simulacao/senador.json');console.log((Buffer.byteLength(JSON.stringify(d))/1024).toFixed(1)+' KiB',(d.national?.candidatos||[]).length+' candidaturas')"
      ```
      Se o número saltar muito, o caminho NÃO é afrouxar o limiar — é encolher o payload
      (ver a discussão em `docs/_meta/handoff-2026-09-19-ajustes-ui.md` § Aberto).
      Teste verde e deploy verde não provam que o dado chegou à tela: em 17/09 um bloco inteiro
      passou nos testes e **não existia em produção**. Depois de publicar, confira no site.

---

## Como isto não é esquecido

Um documento que só existe em si mesmo é um documento que ninguém abre. Cada item acima tem **duas
outras casas**, e as três precisam concordar:

1. **Uma linha no `## Calendário` da sprint que estiver `active`.** Sprints não têm mais data, mas
   têm calendário — e é lá que quem está trabalhando olha. Achar a sprint ativa:

   ```bash
   grep -l "status: active" docs/sprints/*.md
   ```

   A linha cita este arquivo; o roteiro **não** é copiado (a regra de não duplicar conteúdo está em
   [`../_meta/conventions.md`](../_meta/conventions.md#cross-references)).

2. **Um item em [`../operations/pre-prod-checklist.md`](../operations/pre-prod-checklist.md).** O
   checklist pré-prod é o que precisa estar 100% verde na entrada do
   [D1](./_D1-04out2026.md#estado-esperado-de-entrada). Itens 1 e 2 já têm linha lá, em
   § Conformidade TSE; o item 3 ainda não.

3. **Quando um item fecha**, o resultado medido vai para a fonte canônica dele — a tabela "Registro
   das janelas" de [`../testing/tse-simulados.md`](../testing/tse-simulados.md) (item 1), o
   checklist pré-prod (itens 2 e 3) — e a caixa correspondente acima é marcada. O trilho externo
   guarda o **roteiro**; a medição mora onde sempre morou.

## Cross-refs

- Protocolo completo dos simulados: [`../testing/tse-simulados.md`](../testing/tse-simulados.md)
- Marco do dia D: [`_D1-04out2026.md`](./_D1-04out2026.md) · 2º turno: [`_D2-25out2026.md`](./_D2-25out2026.md)
- Checklist pré-produção: [`../operations/pre-prod-checklist.md`](../operations/pre-prod-checklist.md)
- Runbook (env vars, fan-out, publicação de candidaturas): [`../operations/runbook.md`](../operations/runbook.md)
- Código de eleição por cargo: [ADR-0044](../architecture/adrs/0044-codigo-eleicao-por-cargo.md)
- Conformidade Res. 23.751/2026: [ADR-0020](../architecture/adrs/0020-conformidade-res-23751-2026.md)
- Par (município, zona) como unidade de ingestão: [ADR-0035](../architecture/adrs/0035-par-municipio-zona-unidade-de-ingestao.md)
- Riscos e watch items: [`../reference/risks.md`](../reference/risks.md)
- Regulamentação vigente: [`../reference/regulatory.md`](../reference/regulatory.md)
