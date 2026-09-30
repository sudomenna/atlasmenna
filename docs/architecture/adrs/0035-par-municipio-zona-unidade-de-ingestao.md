---
id: ADR-0035
title: O par (município, zona) como unidade de ingestão e agregação exata por soma, não a zona sozinha nem rateio por eleitorado — cron por cargo, não fan-out único
status: accepted
date: 2026-09-11
amends: 0012, 0020, 0021, 0023, 0032, 0033
---

# ADR-0035 — O par (município, zona) como unidade de ingestão, soma exata por município, cron por cargo

## Status

Aceito. Este ADR **emenda o ADR-0002 do banco** — não um ADR de arquitetura, mas a migration
`lib/db/migrations/0002_zonas_pk_fix.sql`, que em 2026-05-17 corrigiu a PK de `zonas` de `cod_zona`
(globalmente único, falso — zona 1 existe em toda UF) para `(uf, cod_zona)`. Esta decisão troca essa
PK de novo, agora para `(uf, cod_municipio_tse, cod_zona)` — o mesmo padrão de "a chave natural
correta, não uma simplificação conveniente" aplicado um nível mais fundo. Implementado no mesmo dia
em que este ADR foi escrito: migration `data-pipeline/migrations/0006_pares_municipio_zona.ts`,
`lib/db/schema.ts:59-193`, `api/model/zona_merge.py` (novo), `lib/tse/ingest-handler.ts` (novo,
extraído de `app/api/ingest/route.ts`), `app/api/ingest/[cargo]/route.ts` (novo), `vercel.ts:83-135`.

> **Nota 2026-09-30 ([ADR-0068](0068-limitador-de-taxa-do-tse-por-cargo.md)).** A premissa de D3 e da
> emenda do teto de 40 — "Fluid Compute isola instâncias por invocação concorrente, cada uma com seu
> próprio rate limiter singleton" — **é falsa**: o Fluid Compute reaproveita instâncias e roda
> invocações concorrentes na mesma, de modo que o singleton de processo compartilhava (e congelava, na
> taxa do primeiro cargo a chegar) um bucket entre cargos. O ADR-0068 troca o singleton por **um bucket
> por cargo**; só então o pior caso agregado como soma dos tetos por cargo passa a descrever o código. O
> teto de 100 rps/IP, o lock por cargo e a pendência do limitador coordenado entre instâncias seguem como
> aqui definidos.

Este ADR também emenda pontualmente o ADR-0012 (D3, precedente de namespacing por corrida — ver nota
aplicada ao seu `## Status`), o ADR-0020 (D3, RF-010.3 recalibrado para dois processos concorrentes),
o ADR-0032 (D2, a soma exata de município deixa de depender de `zonas`) e o ADR-0033 (D3, nota de
implementação da faixa de sensibilidade OT-4, já registrada lá em 2026-09-11). Não supersede nem
emenda o corpo do ADR-0021 nem do ADR-0023: o método do estimador (extrapolação por zona,
pós-estratificação por porte de zona) **não muda** — só ganha uma nota de que a unidade de ingestão
mudou por baixo dele sem alterar seu contrato de entrada.

## Contexto

O TSE 2026 publica o EA20 de zona **por par** `(município, zona)` — o nome do arquivo é
`<uf><mun5>-z<zona4>-c<cargo>-e<n>-u.json` (ex. `sp71072-z0001-c0003-e999999-u.json`, spec 001 § 2),
e o material oficial do TSE declara ~6.083 arquivos por cargo
(`tse_docs/txt/apresentacao-interessados-2026.txt:195-200`). Medido no CSV oficial de eleitorado 2024
(`build/tse-archives/eleitorado_local_votacao_2024/`, 599.204 registros): **2.619 zonas distintas**,
**5.569 municípios**, **6.085 pares** — 1.636 zonas (62,5%) cobrem de 2 a 8 municípios, 189
municípios têm mais de uma zona (até 57). A relação é muitos-para-muitos; o par é a interseção, mais
fino que as duas visões, e ambas deriváveis dele por soma
(`docs/_meta/diagnostico-colapso-zona-municipio-2026-09-10.md`).

Antes desta decisão, o pipeline tratava a relação como um-para-um em dois lugares independentes:

- `data-pipeline/zonas-import.ts` fazia `SELECT uf, cod_zona, MIN(cod_municipio_tse) GROUP BY uf,
  cod_zona` — uma linha por zona, com o município de menor código escolhido arbitrariamente. A tabela
  `zonas` tinha **2.651 linhas** cobrindo apenas **2.180 municípios alcançáveis** de 5.572. Como essa
  tabela alimentava `lib/tse/targets.ts` (enumeração de alvos de ingestão), o pipeline pediria em 2026
  ~2.651 dos ~6.085 arquivos reais — perdendo **~56% dos votos sem nenhum 404** (o arquivo do
  município "perdedor" simplesmente nunca era requisitado).
- `data-pipeline/eleitorado-import.ts` agregava eleitorado por `${uf}|${codZona}`, creditando o total
  da zona inteira ao **primeiro** `cod_municipio_tse` visto no CSV — 26,1% do eleitorado nacional
  (40.750.446 de 155.912.680) sob rótulo de município errado.
- `snapshots` não tinha nenhuma coluna de município. Em 2026, dois arquivos da mesma zona (dois
  municípios diferentes) colidiriam na dedup por `(cargo, turno, uf, cod_zona)` — o segundo par
  gravado seria tratado como "mesma zona, conteúdo novo" e sobrescreveria silenciosamente o sinal do
  primeiro no `pct_apurado`/`votos_total` agregados, embora o `payload` bruto de cada linha
  permanecesse correto.

O impacto medido no mapa e no painel "Maiores colégios eleitorais" (com a regra `MIN`, pior que os
26,1% do problema de eleitorado porque favorece sistematicamente o código mais baixo): **31,2% do
eleitorado com votos creditados ao município errado**, **3.392 dos 5.572 municípios estruturalmente
invisíveis** — Uberaba e Governador Valadares, 7º e 9º maiores colégios de MG, simplesmente não
apareciam; Montes Claros perdia 63 mil eleitores exibidos. Nenhum desses três defeitos produzia um
404 ou um erro visível — o pipeline funcionava, media alguma coisa e reportava um número plausível
mas sistematicamente incompleto ou deslocado.

Uma quarta constatação, encontrada durante a mesma investigação e sem relação estrutural com as três
acima: `app/api/ingest/route.ts` exportava apenas `POST` e lia o segredo de `x-cron-secret`, enquanto
o Vercel Cron dispara **HTTP GET** e envia o segredo em `Authorization: Bearer <CRON_SECRET>`
(vercel.com/docs/cron-jobs, seção "Securing cron jobs", lida em 2026-09-11) — as três entradas de
`vercel.ts` **nunca invocaram a ingestão real** desde que o cron existe; todo ciclo executado até hoje
foi disparado manualmente via `curl -X POST -H "x-cron-secret"` (runbook, protocolo do simulado). Um
segundo achado da mesma pesquisa: query string em `path` de cron não é documentada pela Vercel — o
que a doc documenta, com exemplo literal, é distinguir dois crons no mesmo horário por **segmento de
rota** (`/api/sync-slack-team/T0CAQ10TZ` vs. `/T4BOE34OP`).

O gate OT-4 (spec 002) foi medido **antes e depois** desta mudança para confirmar que ela não toca o
modelo. A medição de controle é contra o **fixture commitado** (`tests/fixtures/replay-2022/
snapshots.json`, gerado em 2026-09-08), porque ele é a única entrada que não se move: rodado depois
de `zona_merge.py` entrar em `project.py`, devolveu `MAE@1h` PT `0.0236233843` (**2,3623pp**) e
cobertura IC95@1h **82,5% (n=297)** — os mesmos dígitos do baseline de 08/09.

A tabela de `docs/testing/replay-sensitivity.md` mostra **2,3624pp** no ponto oficial, e a diferença
de 4ª casa **não é arredondamento**: aquele script **regenera** o fixture a partir do banco, e o
banco mudou no mesmo dia — o conserto de `iterCsv` (quebra de linha dentro de campo entre aspas)
recuperou 1.429 eleitores, e Σ`eleitores_aptos` passou de 155.911.251 para **155.912.680**. Peso de
zona ligeiramente diferente, MAE ligeiramente diferente, na direção de **mais** correto. As duas
medições são consistentes; só não são a mesma medição.

A identidade do modelo é esperada por construção: o estimador (ADR-0021/0023) lê
`fetch_eleitorado`/estratos por `(uf, cod_zona)`, nunca por `cod_municipio_tse`, e as fixtures de
replay têm uma linha por zona — o caso trivial de `merge_pairs_into_zonas` (identidade, sem soma).

## Decisão

### D1 — o par (município, zona) é a unidade de ingestão

`zonas` (`lib/db/schema.ts:143-158`) vira tabela de pares: PK `(uf, cod_municipio_tse, cod_zona)`,
nova coluna `fonte text` (`'ea12' | 'csv'`), FK para `municipios(cod_municipio_tse)` preservada. A
migration `data-pipeline/migrations/0006_pares_municipio_zona.ts` troca a PK in-place (função
`ddlSwapPk`, que inspeciona `pg_index`/`pg_constraint` antes de agir — mesmo padrão idempotente da
migration 0002) em vez de recriar a tabela.

`eleitorado` (`lib/db/schema.ts:59-83`) ganha a mesma troca de PK: `(ano, uf, cod_zona)` →
`(ano, uf, cod_municipio_tse, cod_zona)`. `data-pipeline/eleitorado-import.ts` passa a agregar por
`${uf}|${codMun}|${codZona}` e a gravar em transação única `BEGIN; DELETE FROM eleitorado WHERE
ano=$1; INSERT …; COMMIT` (`eleitorado-import.ts:224,294,296`) em vez de `INSERT … ON CONFLICT DO
UPDATE` sem `DELETE` — o upsert antigo nunca removia chaves de uma importação anterior que
desaparecessem na seguinte.

`snapshots` (`lib/db/schema.ts:164-193`) ganha `codMunicipioTse: integer NOT NULL DEFAULT 0`
(sentinel 0 para abrangências UF/BR, mesma convenção já usada em `cod_zona`) e o índice
`ix_snap_lookup_par (cargo, turno, uf, cod_municipio_tse, cod_zona, ts)`, criado `CONCURRENTLY`
(`migrations/0006:184-192`, com fallback para `CREATE INDEX` bloqueante se `CONCURRENTLY` falhar
dentro do runner). `ix_snap_lookup` (a chave antiga, sem município) é **mantido** — o estimador
continua consultando por zona (D2). A dedup em `lib/tse/repository.ts` (`insertSnapshot`,
`getLastEtagAndHash`) passa a incluir `target.codMunicipioTse` (`repository.ts:85,162,178`): dois
pares da mesma zona não colidem mais.

Fonte dos pares: **EA12** (`comum/config/mun-e<n>-cm.json`, arquivo único nacional, `abr[].mu[].z[]`
— parser `lib/tse/ea12-schema.ts`, novo) quando existir; hoje, antes do simulado de 15/09, só
`ele2024` está publicado, então `data-pipeline/zonas-import.ts` cai no fallback: `SELECT DISTINCT uf,
cod_municipio_tse, cod_zona FROM eleitorado WHERE ano=2026 AND uf <> 'ZZ'` (`zonas-import.ts:107-113`,
fonte B, grava `fonte='csv'`). Uma fonte suplementar estreita (`zonas-import.ts:132-152`, fonte B′)
recupera pares que só existem em `historical_results`, restrita a zonas com **um único** município no
histórico (`n_mun = 1`) e cujo município exista em `municipios` — 25 dos 32 pares faltantes na fonte B
(19 DF + 5 PI + 1 SP; medido em 2026-09-11), deixando de fora os 7 genuinamente ambíguos (6 PI, 1 BA),
que o EA12 2026 resolve. `historical_results` **saiu do `UNION`** que a versão anterior do script
usava como fonte primária: seu índice único (`uq_historical_results`, `lib/db/schema.ts:47-54`) não
inclui município, e 1.640 zonas aparecem lá com municípios diferentes conforme o candidato — não é
fonte confiável de pares no caso geral, só no recorte estreito de zona com um único município
observado.

`municipios` ganha `capital boolean NOT NULL DEFAULT false` (`lib/db/schema.ts:108-128`), semeada
estaticamente para as 27 capitais por `cod_ibge` (`migrations/0006:97-125`) — o EA12 traz esse bit em
`mu[].c`, e `zonas-import.ts --ea12` reescreve a coluna a partir dele quando o arquivo 2026 existir.

### D2 — município é unidade de exibição por soma exata; o modelo continua por zona

`api/model/zona_merge.py` (módulo novo, 494 linhas) soma os pares de volta em zona **em memória**,
entre `fetch_snapshots` e o estimador (`api/model/project.py:3341-3342`,
`raw_snapshots = fetch_snapshots(...); snapshots = merge_pairs_into_zonas(raw_snapshots)`). Zona com
um único par sai **inalterada** — o mesmo objeto, sem reconstrução de payload (`zona_merge.py:477-480`)
— é o caso das fixtures de replay 2022, que têm uma linha por zona; por isso o gate OT-4 não se move.
Zona com N pares vira um envelope EA20 sintético: campos aditivos de `e`/`v`/`s` somados
(`_E_ADITIVOS`/`_V_ADITIVOS`/`_S_ADITIVOS`, `zona_merge.py:101-122`), `cand[].vap` somado por
`cand[].n` com `pvap`/`pvapn` recalculados sobre `Σvvc` (`_aplicar_vap`, `zona_merge.py:362-378`),
`psa` da zona como `100·Σsa/Σsi` com fallback ponderado por `e.te` quando `s.si` falta em algum par
(`_psa_merged`, `zona_merge.py:197-234`). Campos não aditivos (metadados de envelope, nomes) são
herdados do par de maior `e.te` (o "par dominante"). A soma é determinística e comutativa: a ordem de
saída segue a primeira aparição de cada zona na entrada, preservada de propósito porque o bootstrap
reamostra índices desse vetor (`zona_merge.py:59-66`).

O modelo **não muda**: a unidade do estimador continua a zona, os estratos continuam por porte de
zona (ADR-0021/0023 permanecem intocados no corpo). `fetch_snapshots` (`project.py:229`) devolve uma
linha por par; `merge_pairs_into_zonas` é o único ponto que recompõe a zona antes do estimador vê-la.

Totais municipais deixam de depender de `zonas`: `fetch_municipio_aggregates`
(`api/model/project.py:645-733`) **perdeu o `LEFT JOIN zonas`** que existia para re-derivar o
município a partir da zona — exatamente o caminho do colapso de 31,2% (`zonas` tinha um município por
zona). `cod_municipio_tse` agora vem **do próprio snapshot** (`project.py:667-668,693-711`, CTE
`ranked` particionada por `(uf, cod_municipio_tse, cod_zona)`), e o total do município é a **soma
exata** dos pares que caem nele — **sem rateio** (`project.py:658-660`, citando explicitamente ADR-0035
D2 e a proibição de estimativa apresentada como apuração, constituição § 6). `pct_apurado` do
município passou de média simples entre zonas para média **ponderada pelo eleitorado do par**
(`project.py:675-681`, `_fetch_eleitorado_por_par`) — sem essa mudança, uma zona de 2 mil eleitores
pesaria o mesmo que uma de 200 mil no percentual exibido.

`EdgeUfMunicipio` (`lib/edge-config/types.ts:608-650`) ganha `eleitores?: number` e `capital?:
boolean`, ambos opcionais e no Blob do ADR-0032 (o array `municipios` já vive lá desde aquele ADR;
esta mudança não adiciona um novo destino de armazenamento, só dois campos ao objeto existente).
`capital` é emitido **só quando `true`** — 27 em ~5.570 municípios; emitir `false` explicitamente em
todos custaria payload sem benefício.

Consequência resolvida por D1+D2 juntas: os **3.392 de 5.572 municípios** estruturalmente invisíveis
no mapa deixam de ser (o alvo de ingestão agora existe para cada um), e os 26,1% do eleitorado / 31,2%
dos votos sob rótulo errado passam a ficar sob o município certo, porque `zonas` e `eleitorado` agora
carregam a chave que o TSE de fato publica.

### D3 — um cron por cargo, invocado por GET com Bearer; limpeza única de snapshots de ensaio

`lib/tse/ingest-handler.ts` (módulo novo) extrai o corpo do ciclo de ingestão de
`app/api/ingest/route.ts` para uma função importável, `runIngestCycle(req, { cargo? })`, usada por
duas rotas: `/api/ingest` (todos os cargos ativos — preview, disparo manual, sem mudança de
comportamento) e `/api/ingest/[cargo]` (`app/api/ingest/[cargo]/route.ts`, novo), que aceita o
segmento `1`/`presidente` ou `3`/`governador` (`parseCargoSegment`, `[cargo]/route.ts:43-48`) e é o
caminho do cron de produção — porque a doc da Vercel documenta, com exemplo literal, distinguir dois
crons do mesmo horário por segmento de rota, não por query string. `vercel.ts:114-135` aponta as
entradas de cron para `/api/ingest/presidente` e `/api/ingest/governador`, cada uma com `GET`+`POST`.

`extractProvidedSecret` (`ingest-handler.ts:110-117`) aceita, nesta ordem, `Authorization: Bearer
<secret>` (caminho real do Vercel Cron) e `x-cron-secret` (caminho manual do runbook/simulado) — sem
diferenciar no erro qual dos dois foi tentado, para não vazar qual mecanismo está configurado.

`maxDuration` sobe de 180 para 300s nas duas rotas (`app/api/ingest/route.ts:41`,
`[cargo]/route.ts:32`): o fan-out por par chega a ~6.100 arquivos por cargo, contra ~2.600 quando a
unidade era "1 município por zona". O lock anti-overlap passa a ser **por cargo**
(`ingest-handler.ts:360-420`): a última linha de `ingest_log` cujo `notes.cargo` bate com o cargo do
ciclo (ou sem `cargo`, para o ciclo de todos) determina se um ciclo anterior do mesmo cargo ainda está
em voo; dois cargos diferentes têm locks independentes, permitindo invocação simultânea de Presidente
e Governador. A janela do lock sobe de 3 para 6 minutos (`OVERLAP_LOCK_WINDOW_MS`,
`ingest-handler.ts:378`) — deliberadamente ≥ `maxDuration`, para que o próximo ciclo do mesmo cargo
nunca rode em paralelo mesmo que um ciclo estoure o intervalo do cron.

`TSE_MAX_RPS_DEFAULT` sobe de 30 para 50 (`lib/tse/rate-limiter.ts:157`; teto documentado do TSE é 100
req/s/IP, RF-010.3): com dois cargos podendo ingerir ao mesmo tempo em processos separados (Fluid
Compute isola instâncias por invocação concorrente, cada uma com seu próprio rate limiter singleton),
o pior caso — duas invocações no mesmo IP, cada uma no teto de 50 — soma exatamente 100 rps, na borda
documentada, não acima dela. Era 30 quando um único ciclo cobria todos os cargos sequencialmente e
nunca havia duas invocações reais em paralelo no mesmo IP.

Limpeza única de `snapshots`: `migrations/0006:320-339` apaga, com `DELETE FROM snapshots WHERE ts <
'2026-09-11T00:00:00Z'`, as linhas anteriores a este corte — 10.604 linhas presentes em 2026-09-11,
todas do ensaio de 2026-09-05 contra `scripts/tse-mock-server.ts` (payload sintético), nenhuma do TSE
real. A constituição § 10 protege snapshots **do TSE**, que permitem reproduzir qualquer número
exibido; estas não eram do TSE. O usuário autorizou a limpeza em 2026-09-11 (decisão E3 do plano de
trabalho). A guarda de segurança é o próprio corte temporal fixo: rodar a migration de novo depois de
qualquer ciclo real de ingestão não apaga nada, porque o corte é anterior à existência desta
migration. Testes de integração que grava snapshots passam a rodar contra um branch Neon separado
(`DATABASE_URL_TEST`), para que ensaios futuros não voltem a poluir a tabela de produção.

## Alternativas consideradas

- **Manter `zonas` como uma linha por zona e ratear os votos de uma zona multi-município por
  eleitorado.** Rejeitada: é um número estimado apresentado como apuração — a constituição § 6 (todo
  valor reproduzível a partir do snapshot persistido) e § 1 (dado oficial intocável) não admitem essa
  saída sem um ADR que a autorize explicitamente, e nenhuma medição empírica de rateio existia. Esta é
  a "opção 3" descartada em `docs/_meta/diagnostico-colapso-zona-municipio-2026-09-10.md` § "Por que
  este é mais difícil".
- **Pintar todos os municípios de uma zona multi-município com a cor da zona inteira, sem soma
  exata.** Rejeitada em favor de D2: uma vez que o par vira a unidade de ingestão, a soma exata por
  município fica disponível de graça — não há razão para aceitar o resultado mais grosseiro (zona
  inteira repetida em cada município) quando o dado real do par já está sendo requisitado e persistido.
- **Unidade do modelo passar a ser o par, não a zona** (eliminaria a necessidade de
  `merge_pairs_into_zonas`). Rejeitada para esta janela: mudaria os estratos do bootstrap (ADR-0023) e
  exigiria revalidar o gate OT-4 do zero, sob pressão de calendário do simulado de 15/09. Registrada
  como fora de escopo, a reavaliar depois do simulado 2 (22–24/09).
- **Rota única `/api/ingest?cargo=1|3`** (query string) em vez de segmento de rota. Rejeitada depois
  do achado (B): a doc da Vercel não documenta query string em `path` de cron, e o único exemplo
  literal de dois crons no mesmo horário usa segmento de rota.
- **Manter `TSE_MAX_RPS` em 30 mesmo com dois cargos concorrentes.** Rejeitada: desperdiçaria metade
  da margem de segurança sob o teto real de 100 rps/IP sem necessidade, alongando desnecessariamente
  ciclos que já competem contra `maxDuration=300s` com ~6.100 GETs por cargo.

## Emenda do mesmo dia — teto de requisições recuado de 50 para 40

A auditoria do `constitution-guard` (2026-09-11, após a redação original deste ADR) levantou uma
objeção **procedente** contra a D3 como escrita: com o cron por cargo, duas invocações correm no
mesmo IP com **buckets independentes** (Fluid Compute isola instâncias), e o default de 50 rps dava
pior caso agregado de **exatamente 100 rps** — o teto documentado do TSE. A constituição § 1 exige
teto "**bem abaixo** do limite documentado", e "exatamente no limite" não satisfaz esse texto: não
sobra folga para retry, para o `HEAD` do `tse-watch`, para o 304 (que conta na cota) nem para
qualquer outro processo no mesmo IP. Um bloqueio de 10 minutos na janela do simulado — ou no dia D —
é exatamente o que a norma manda evitar com margem, não com precisão de régua.

**Decisão revista**: `TSE_MAX_RPS_DEFAULT` = **40** (`lib/tse/rate-limiter.ts:171`). Pior caso
agregado **80 rps**, 20% abaixo do teto. Custo medido em tempo: 6.110 GETs a 40 rps ≈ **153 s** por
cargo, confortável dentro do `maxDuration` de 300 s. O `CEILING` fica em 50 para que uma janela
**supervisionada** (simulado, com alguém lendo `rateLimited` ao vivo) possa subir deliberadamente via
`TSE_MAX_RPS`; produção desassistida usa o default.

**Pendência que esta emenda não fecha**: dois buckets independentes garantem a média, não o pico
instantâneo. A solução completa é um limitador **coordenado** entre invocações (contador
compartilhado). Fica para depois do simulado 1, quando `rateLimited` tiver medição real — registrado
aqui para não se perder.

## Consequências

**Positivas**:
- Os **3.392 de 5.572 municípios** estruturalmente invisíveis no mapa deixam de ser — o alvo de
  ingestão passa a existir para cada par real que o TSE publica.
- **26,1% do eleitorado e 31,2% dos votos** deixam de ficar sob rótulo de município errado — o dado
  já estava correto no CSV/EA20; só a chave de agregação estava rasa demais para carregá-lo.
- O gate OT-4 é **idêntico ao dígito** antes e depois (MAE@1h PT 2,3623pp / cobertura 82,5%, contra
  o fixture commitado `tests/fixtures/replay-2022/snapshots.json` — ver o Contexto para por que a
  tabela de sensibilidade, que regenera o fixture, mostra 2,3624pp) — prova medida, não assumida, de
  que a mudança de unidade de ingestão não toca o modelo.
- O cron de produção **passa a de fato invocar a ingestão** — antes desta correção, as três entradas
  de `vercel.ts` nunca acionavam `runIngestCycle`, e ninguém tinha notado porque todo ciclo real até
  hoje foi manual.
- `pct_apurado` do município ganha peso correto por eleitorado do par, em vez de tratar uma zona de
  2 mil eleitores como equivalente a uma de 200 mil.
- Nenhum dado é inventado: tanto a soma exata por município (D2) quanto os pares recuperados da fonte
  suplementar (D1, 25 de 32) vêm de dado já publicado pelo TSE ou já presente no histórico — zero
  estimativa nova entra no pipeline.

**Negativas — a de primeira grandeza**:
- **A premissa de que o arquivo de par contém a fatia da zona naquele município — não a zona
  inteira — não foi verificada contra dado real do TSE, e não dá para verificar sondando URL**
  (constituição § 1; um 404 bloqueia o IP por 10 minutos, limiar não divulgado). Três linhas de
  evidência convergem a favor: o nome do arquivo exige município
  (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:118-123`); o TSE declara ~6.083 arquivos
  de zona por cargo contra ~2.619 zonas reais
  (`tse_docs/txt/apresentacao-interessados-2026.txt:195-200`), e medimos 6.085 pares no CSV — números
  que só fazem sentido se cada arquivo for um par, não uma zona repetida; o EA16 aninha seção dentro
  de zona dentro de município, um precedente estrutural do TSE para essa hierarquia. Mas a descrição
  de conteúdo do próprio EA20 diz apenas "na abrangência da zona eleitoral", sem qualificar se é a
  zona inteira ou a fatia no município do nome do arquivo. **Se a premissa cair,
  `merge_pairs_into_zonas` multiplica os votos por até 8× em 62,5% das zonas** — o pior caso, uma
  zona com 8 municípios, somaria 8 cópias do mesmo total. Mitigação implementada nesta mesma janela:
  `check_zona_merge_sanity` (`api/model/zona_merge.py:526-…`) compara, por zona multi-par, a razão
  entre o `Σe.te` mesclado e o eleitorado conhecido (`fetch_eleitorado`) — razão ≥ 1,8 (bem abaixo do
  menor N possível, 2) é logada como violação confirmada e aciona alerta Slack
  (`api/model/project.py:3370-3385`); a faixa 1,5–1,8 é zona cinzenta, logada como warn. A guarda
  reduz o risco de multiplicação silenciosa a um alerta ruidoso, mas **não resolve a dúvida
  metodológica** — só o simulado de 15/09, com dado real do TSE, resolve isso.
- **A dedução da premissa acima não pode ser testada em preview nem em CI** — só existe fixture
  sintética (que já assume a premissa verdadeira, porque foi construída por quem escreveu o merge) e
  o mock server. O primeiro contato com dado real de par é o simulado 1.
- **A guarda de sanidade depende de `eleitorado` estar corretamente populada por zona** — se o
  importador de eleitorado tiver seu próprio defeito (o que este mesmo ADR corrige, mas que poderia
  recorrer de outra forma), a guarda perderia sua referência e o teto de 1,8 deixaria de ser
  confiável. É uma dependência circular fraca: a mesma mudança que motiva a guarda também a alimenta.
- **Duas fontes de pares hoje (CSV 2024 + histórico estreito) são um proxy para 2026, não o
  dado real** — o EA12 2026 pode trazer pares que não existem em nenhuma das duas (município novo,
  redistritamento de zona) ou divergir dos 6.085 medidos. `zonas-import.ts --ea12` substitui a fonte
  quando o arquivo 2026 existir, mas até 15/09 o pipeline opera sob uma aproximação de 2024.
- **`--skip-orphans` é necessário hoje** porque o CSV 2024 traz ao menos um município (Boa Esperança
  do Norte, MT, cod 73709) que a base IBGE de `municipios` não tem — um sintoma de que a base de
  municípios também está um passo atrás do calendário eleitoral e precisa de atenção antes do EA12
  chegar.
- **A limpeza única de `snapshots` remove todo histórico de ensaio anterior a 2026-09-11** — qualquer
  investigação futura sobre o comportamento do mock antes desta data perde a base de dado real (não
  que fosse dado real do TSE, mas era o único registro do comportamento do pipeline até aqui). O corte
  temporal fixo na migration é a salvaguarda contra repetir esse apagamento por engano.
- **`ix_snap_lookup` (chave sem município) permanece como segundo índice sobre a mesma tabela** —
  todo INSERT em `snapshots` agora mantém dois índices compostos de 5–6 colunas cada, custo de
  escrita que cresce com o volume (~6.100 linhas por cargo por ciclo de ingestão completo).
- **Cron por cargo dobra, na prática, o número de invocações simultâneas possíveis contra o mesmo
  IP** — o rate limiter default subiu de 30 para 50 rps por processo para compensar, mas isso depende
  de nenhum terceiro processo compartilhar o mesmo IP nem de retries elevarem o efetivo acima de
  100rps agregado; não medido sob carga real antes do simulado 1.

## Cross-refs

- Migration `lib/db/migrations/0002_zonas_pk_fix.sql` — emendada por D1 (troca de PK novamente, agora
  para incluir `cod_municipio_tse`); o padrão idempotente (`DO $$` inspecionando `pg_index`) é
  reaproveitado por `data-pipeline/migrations/0006_pares_municipio_zona.ts`.
- [ADR-0007](0007-zona-vs-municipio.md) — granularidade do modelo em zona / visualização em
  município: a premissa de agregação "`zonas.cod_municipio_tse`" citada em suas Consequências
  (`:39`) é exatamente o que D1/D2 substituem por soma exata de pares; não emendado formalmente por
  este ADR, mas seu texto descreve um mecanismo de agregação que já não existe mais em código.
- [ADR-0012](0012-edge-config-chaves-nomeadas.md) — precedente de "namespacing por corrida/turno, não
  chave única", o mesmo princípio de fundo que o lock anti-overlap por cargo (D3) aplica à camada de
  ingestão: cada cargo tem seu próprio marcador de estado, sem colisão entre invocações concorrentes.
  Nota de emenda aplicada ao `## Status` do ADR-0012 (ver abaixo).
- [ADR-0020](0020-conformidade-res-23751-2026.md) — RF-010.3 recalibrado por D3: cada invocação de
  `/api/ingest/[cargo]` fica em ≤50 rps, e as invocações somadas em ≤100 rps (teto documentado do
  TSE). Nota de emenda aplicada.
- [ADR-0021](0021-extrapolacao-do-apurado-sem-2022.md) / [ADR-0023](0023-pos-estratificacao-por-porte-de-zona.md)
  — método do estimador, **intocado**: `merge_pairs_into_zonas` entrega à zona exatamente o mesmo
  formato de linha que `fetch_snapshots` sempre devolveu, e o gate OT-4 medido idêntico confirma isso
  empiricamente. Nota de confirmação aplicada a ambos.
- [ADR-0032](0032-detalhe-municipal-vercel-blob.md) — `EdgeUfMunicipio.eleitores?`/`capital?` somam-se
  aos campos já movidos para Blob por aquele ADR; nenhum novo destino de armazenamento é criado. Nota
  de emenda aplicada.
- [ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md) — já registra, em seu
  próprio `## Status`, a implementação de 2026-09-11 da faixa de sensibilidade OT-4
  (`scripts/replay-sensitivity.ts`); este ADR reaproveita esses números (`docs/testing/replay-sensitivity.md`)
  como prova de que D1/D2 não tocaram o modelo. Sem alteração de texto adicional neste ADR (já estava
  aplicada).
- Constituição § 1 (dado oficial intocável — nenhum GET sondado por adivinhação; EA12 online lido só
  de URL derivada da padronização), § 6 (determinismo — soma exata, sem rateio; `zona_merge.py`
  reprodutível byte a byte), § 7 (degradar é melhor que ficar mudo — `check_zona_merge_sanity` não
  aborta o ciclo, só alerta), § 10 (append-only para snapshots do TSE — a limpeza de 11/09 é sobre
  dado de ensaio, não do TSE).
- `docs/_meta/diagnostico-colapso-zona-municipio-2026-09-10.md` — a medição que originou esta decisão.
- Spec 001 (`docs/specs/001-ingestao-tse/`) — RF-008/009 (mapeamento zona↔município) e RF-010.3 devem
  passar a citar este ADR (propagação sugerida ao `spec-syncer`).
- Spec 002 (`docs/specs/002-modelo-estatistico/`) — gate OT-4 permanece bloqueado pelas mesmas duas
  frentes já conhecidas (atraso regional sintético, ADR-0033; peso de `eleitorado` inflado, ainda sob
  investigação) — este ADR não resolve nenhuma delas, só confirma que não introduziu uma terceira.
- `docs/testing/replay-sensitivity.md` — evidência do gate OT-4 idêntico antes/depois.
- `docs/reference/risks.md` — pendente de nova linha: risco da premissa de fatia-por-município não
  verificada, com resolução esperada no simulado de 15/09 (propagação sugerida).

## Texto de emenda aplicado nos ADRs afetados

**`0012-edge-config-chaves-nomeadas.md`** — acrescentado ao `## Status`:

> **Nota 2026-09-11 ([ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) D3).** O princípio de
> fundo deste ADR — nomear o estado por corrida/contexto em vez de uma chave única compartilhada —
> reaparece na camada de ingestão: o lock anti-overlap de `/api/ingest` passou a ser **por cargo**
> (`notes.cargo` no marcador de `ingest_log`, `lib/tse/ingest-handler.ts:360-420`), para que um ciclo
> de Presidente e um de Governador possam correr concorrentemente sem um bloquear o outro. Mesmo
> princípio, mecanismo diferente (marcador de linha em vez de chave de Edge Config); nenhuma mudança
> ao schema de chaves deste ADR.

**`0020-conformidade-res-23751-2026.md`** — acrescentado ao `## Status`:

> **Nota 2026-09-11 ([ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) D3).** RF-010.3
> recalibrado: com o cron por cargo (Presidente e Governador em invocações separadas,
> `/api/ingest/[cargo]`), cada processo roda seu próprio rate limiter singleton
> (`lib/tse/rate-limiter.ts`), e `TSE_MAX_RPS_DEFAULT` subiu de 30 para 50 — o pior caso de duas
> invocações simultâneas no mesmo IP soma exatamente 100 rps, o teto documentado do TSE, não acima
> dele. Antes do cron por cargo, um único ciclo cobria todos os cargos sequencialmente e 30 rps era a
> margem de segurança adequada para um único processo. O teto de 100 rps/IP e a proibição de sondar
> URL seguem exatamente como este ADR definiu.

**`0021-extrapolacao-do-apurado-sem-2022.md`** — acrescentado ao `## Status`:

> **Nota 2026-09-11 ([ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) D1/D2).** A partir da
> migration 0006, a ingestão TSE passou a ser por **par** (município, zona) — o EA20 de zona é
> publicado um arquivo por par. O método deste ADR **não muda**: `api/model/zona_merge.py` soma os
> pares de volta em zona, em memória, antes de `fetch_snapshots` alimentar o estimador — a extrapolação
> continua operando sobre a zona, com o mesmo `k = te/esi` e o mesmo bootstrap não-paramétrico. O gate
> OT-4 foi medido antes e depois da mudança de ingestão e ficou **idêntico ao dígito** (MAE@1h PT
> 2,3623pp / cobertura 82,5%, `docs/testing/replay-sensitivity.md`) — confirmação empírica de que a
> unidade de ingestão e a unidade do estimador são, de propósito, desacopladas.

**`0023-pos-estratificacao-por-porte-de-zona.md`** — acrescentado ao `## Status`:

> **Nota 2026-09-11 ([ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) D1/D2).** Mesma nota
> aplicada ao ADR-0021: a ingestão passou a ser por par (município, zona), somada de volta à zona por
> `api/model/zona_merge.py` antes do estimador. Os estratos por porte de zona (tercis de `te` sobre
> `eleitorado`, agregada por `(uf, cod_zona)`) não mudam — `eleitorado` também passou a ser chaveada
> por par, mas `fetch_eleitorado` (`api/model/project.py:319`) soma por zona na leitura, preservando o
> peso a priori de cada estrato exatamente como este ADR definiu.

**`0032-detalhe-municipal-vercel-blob.md`** — acrescentado ao `## Status`:

> **Nota 2026-09-11 ([ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) D2).** `EdgeUfMunicipio`
> ganha dois campos opcionais no mesmo objeto Blob que este ADR já definia:
> `eleitores?: number` (soma do eleitorado dos pares do município) e `capital?: boolean` (emitido só
> quando `true`). Nenhum destino de armazenamento novo é criado — os dois campos entram no mesmo
> `municipios:uf:<sigla>:<cargo>:t<turno>.json` que este ADR já especificava. A soma de eleitorado por
> município passou a ser exata (soma dos pares reais), não mais dependente da tabela `zonas` antiga
> (um município por zona) que o `LEFT JOIN` removido por esta mudança usava.

**`0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md`** — já registra, no próprio
`## Status`, a implementação de 2026-09-11 da Decisão 3 (faixa de sensibilidade OT-4); nenhum texto
adicional aplicado por este ADR além da referência cruzada acima.
