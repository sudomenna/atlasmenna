---
id: 001-ingestao-tse
type: tasks
status: done
sprint: 2026-S02
opened: 2026-05-17
closed: 2026-05-17
---

# Tasks — Spec 001 Ingestão TSE

> **Ordem bottom-up**: tipos/schema → lib (client, parser, persistência) → API route → cron/scheduler → script de replay → testes integrados → gates.
> **Status**: cada checkbox marcado **imediatamente** após terminar a task (não em lote).
> **Mapping**: cada task lista os RFs/NFRs/ADRs que ataca. RFs já 100% atendidos pela S01 (RF-006, RF-007, RF-008, RF-009) só ganham tasks de **verificação/teste** nesta sprint.

## Contexto e premissas

- **Plano Vercel: Pro** (confirmado pelo orquestrador em 2026-05-17). `maxDuration` default 60s, até 800s via Fluid Compute.
- **Cron via Vercel Cron nativo a cada 60s** (decisão D-1 abaixo). RF-002 e RNF-006 renegociados via ADR-0011 (a ser criado pelo `adr-author` antes de T09).
- ~~**Cadastro "interessado divulgação"** (RF-010) é **operacional, não código** — entra como task de checklist (T22), não implementação.~~ **OBSOLETO (2026-09-05)**: a Res. TSE 23.751/2026 **não prevê cadastro algum** — a premissa veio de analogia com a Res. 23.736/2024 e nunca se confirmou ([ADR-0020](../../architecture/adrs/0020-conformidade-res-23751-2026.md)). RF-010 foi reescrito como conformidade verificável por código (RF-010.1..RF-010.6).
- `lib/db/schema.ts` já tem `snapshots` e `ingest_log` definidos (não duplicar).
- Reutilizar `data-pipeline/_tse-common.ts` **só como inspiração** — runtime do `/api/ingest` é Fluid Compute Node, sem `node:fs` cache, sem `unzip`.

## Decisões fechadas (resolvendo as Open Questions originais)

- **D-1 (ex-OQ-1) Cadência: 60s via Vercel Cron nativo.** Não self-loop. Implicações: (a) RF-002 muda de "a cada 15s" para "a cada 60s"; (b) RNF-006 muda defasagem TSE→tela de <30s para <90s (60s polling + ~10s processamento + ~10s propagação Edge Config + margem). Renegociação formal via **ADR-0011** (`adr-author` antes de T09). Spec.md e design.md também são atualizados (T-pre-coding abaixo).
- ~~**D-2 (ex-OQ-2) User-Agent**: manter `AtlasMenna/1.0 (interessado-divulgacao-cadastrado)` como placeholder. Revisado no T22 quando resolução TSE 2026 for publicada.~~ **REVERTIDA (2026-09-05)**: aquele User-Agent declarava ao TSE um cadastro **que nunca existiu** — afirmação falsa. Substituído por `AtlasMenna/1.0 (+<url>; <contato>)` (RF-010.6, ADR-0020, `lib/tse/client.ts:60`). Falta só o texto do contato (decisão humana).
- **D-3 (ex-OQ-3) Raw EA20**: **só Postgres** nesta sprint. JSONB completo na coluna `snapshots.payload`. Dual write para Blob fica como chore S03 se custo de armazenamento couber. Backlog atualizado.
- **D-4 (ex-OQ-4) Whitelist preview**: SP × cargo 1 (Presidente) × ~500 zonas (~500 GETs/ciclo). Configurada via `TSE_TARGETS_WHITELIST=SP:1` env var no preview. Produção lê todas as zonas × cargos ativos da `zonas`.

## Tasks

### Fase Pre — Documentação das decisões (antes de codar)

- [ ] **T00a — ADR-0011: cadência de polling 60s** *(despachar `adr-author`)*
  - Contexto: Vercel Cron mínimo nativo é 1/min; design original assumia 15s via self-loop. Decisão D-1 aceita 60s pra evitar complexidade de loop interno e estourar `maxDuration` em casos de carga alta.
  - Consequências: RF-002 atualizado de 15s → 60s; RNF-006 (defasagem TSE→tela) atualizado de <30s → <90s.
  - Trade-off documentado: precisão de tempo-real cede para simplicidade operacional e robustez.
  - Cobre: gate de constituição § 1 (transparência metodológica).
  - Estimado: 0.5h (despacho + revisão).

- [ ] **T00b — Atualizar `spec.md` RF-002 + `design.md` Cadenciamento**
  - `spec.md` RF-002: trocar "a cada 15 segundos" por "a cada 60 segundos". Adicionar referência a ADR-0011.
  - `design.md` § Cadenciamento: na linha "Domingo 17h–04h", trocar "A cada 15s" por "A cada 60s". Adicionar nota referenciando ADR-0011.
  - `design.md` § Volume estimado: recalcular pico de GETs (`/15s` → `/60s` reduz pico 4×). De ~10.000 GETs/min para ~10.000 GETs/min ainda (porque ciclo de 60s × ~10k zonas × cargo ativo ≈ mesma ordem — só muda distribuição temporal).
  - NFR-006 (em `docs/nfr/performance.md`): atualizar budget defasagem TSE→tela de "<30s" para "<90s".
  - Cobre: alinhamento canônico spec ↔ ADR ↔ NFR.
  - Estimado: 0.5h.

### Fase 0 — Tipos e infraestrutura compartilhada

- [x] **T01 — Schema Zod EA20 + tipos TS**
  - Cria `lib/tse/ea20-schema.ts` com `EA20Schema` (Zod) + tipo inferido `EA20`.
  - Espelha o shape do design.md §"Schema EA20 (parcial relevante)" — todos os campos string preservados como vieram do TSE (TSE devolve numéricos como string).
  - Helpers: `parseEA20Numeric(s: string): number` (vírgula decimal BR → number).
  - Cobre: **RF-001** (validação fail-fast pré-aceite).
  - ADRs: 0002.
  - Estimado: 1.5h.

- [x] **T02 — Tabela de targets (UF × cargo × par município-zona)**
  - Cria `lib/tse/targets.ts` com função `listIngestTargets(env: 'preview'|'production'): Target[]`.
  - `Target = { uf: string; cargo: 1|3; codMunicipioTse: number; codZona: number; url: string; codEleicao: string }` — cada target é um **par** (município, zona), não uma zona isolada ([ADR-0035 D1](../../architecture/adrs/0035-par-municipio-zona-unidade-de-ingestao.md)).
  - Em preview: lê whitelist de env var `TSE_TARGETS_WHITELIST` (default: SP, cargo 1) — resolve OQ-4.
  - Em production: deriva de `zonas` (tabela de pares) × `cargos` ativos no Neon.
  - URL builder: `https://resultados.tse.jus.br/oficial/{codEleicao}/dados/{uf}/{uf}{codMun}/{uf}{codMun}-c{cargo}-z{zona}-e{codEleicao}.json` (formato confirmado no design).
  - Cobre: **RF-001** (descoberta de endpoints).
  - Despacho: `tse-parser-builder` (conhece formato URL TSE).
  - Estimado: 2h.

- [x] **T03 — Tipos de erro e logs estruturados**
  - [x] Cria `lib/tse/errors.ts` com `TSEError extends Error` (`status`, `url`, `bodySample`) e `IngestError` (`reason: 'parse'|'persist'|'network'|'timeout'`).
  - [x] Cria `lib/tse/log.ts` — wrapper sobre `console.log` que serializa JSON com `{ level, ts, msg, ...ctx }`. Sem dep externa (next/observability funciona via console em Vercel).
  - Cobre: **RNF-032** (logs estruturados).
  - Estimado: 1h. **Done 2026-05-17.**

### Fase 1 — Cliente TSE (fetch + ETag + retry)

- [x] **T04 — `fetchEA20()` com If-None-Match**
  - Cria `lib/tse/client.ts` com `fetchEA20(opts: { url, etag? }): Promise<{ kind: 'fresh'; data: EA20; etag: string|null; hash: string } | { kind: 'not_modified' } | { kind: 'not_found' }>`.
  - `If-None-Match` enviado se `etag` presente; `Accept-Encoding: gzip`; `AbortSignal.timeout(5000)`.
  - User-Agent: `AtlasMenna/1.0 (interessado-divulgacao-cadastrado)` (placeholder até OQ-2 / RF-010).
  - SHA256 do body via `crypto.subtle.digest` (Web Crypto, runtime-agnóstico).
  - Trata 304 → `not_modified`; 404 → `not_found`; outros 4xx/5xx → throw `TSEError`.
  - Cobre: **RF-001, RF-003**.
  - Risco: TSE pode não respeitar If-None-Match em todos os caches CDN — validar com fixture real (T18).
  - Despacho: `tse-parser-builder`.
  - Estimado: 2.5h.

- [x] **T05 — Retry com backoff exponencial**
  - Cria `lib/tse/retry.ts` com `withRetry<T>(fn, { attempts: 3, baseMs: 1000 })`.
  - Backoff: 1s/2s/4s (design.md). Não-retryable: 304, 404, parse errors.
  - Total wallclock max: ~7s — **dentro do timeout Vercel mesmo em Hobby (10s)**, mas justo. Documentar em comment.
  - Cobre: **RF-001 (resiliência), RNF-011** (recuperação automática).
  - Estimado: 1h.

### Fase 2 — Persistência (Neon + dedup)

- [x] **T06 — Repository de snapshots**
  - Cria `lib/tse/repository.ts` com:
    - `getLastEtagAndHash(target: Target): Promise<{ etag: string|null; hash: string|null }>` — lê `snapshots` por (cargo, turno, uf, cod_zona) ORDER BY ts DESC LIMIT 1.
    - `insertSnapshot(s: { target, etag, hash, payload: EA20, pctApurado, votosTotal }): Promise<bigint>` — INSERT-only, **proibido UPDATE/DELETE** (constituição § 10).
    - Skip explícito se `hash === lastHash` (dedup por conteúdo, complemento ao ETag).
  - Usa drizzle-orm (já no projeto) + `lib/db/index.ts` connection.
  - Cobre: **RF-004** (append-only), complementa **RF-003**.
  - Constitution § 10 — `constitution-guard` vai verificar.
  - Estimado: 2h.

- [x] **T07 — Logger de ingestão (`ingest_log`)**
  - Em `lib/tse/repository.ts`, adiciona `logIngestRun({ durationMs, filesFetched, filesChanged, errors, notes })`.
  - Schema já existe (`lib/db/schema.ts` → tabela `ingest_log`). Conferir colunas reais antes de assumir (briefing diz: `id, ts, duration_ms, files_fetched, files_changed, errors, notes`).
  - Cobre: **RNF-032, RNF-033** (métricas custom: lag, files_changed).
  - Estimado: 0.5h.

### Fase 3 — API route `/api/ingest`

- [x] **T08 — Route handler `app/api/ingest/route.ts`**
  - `POST /api/ingest` (Fluid Compute Node, runtime `nodejs`, `maxDuration` configurada via export).
  - Auth: header `x-cron-secret` === `process.env.CRON_SECRET` (RNF-016). Sem secret → 401. Vercel Cron envia esse header automaticamente quando configurado.
  - Janela de tempo: se `process.env.CRON_ENABLED !== 'true'` **ou** `now()` fora de 17:00–04:00 BRT (e sem override `INGEST_WINDOW_OVERRIDE=true`), retorna 200 `{ skipped: 'out_of_window' }` sem ingerir. Cobre RF-002 GWT.
  - Body: ignora; o handler descobre targets via `listIngestTargets()`.
  - Loop: para cada target → `fetchEA20` (com ETag do repo) → se `fresh` e hash diferente → `insertSnapshot`. Concorrência limitada (ex. 20 em paralelo via simple semaphore — sem dep nova).
  - Final: `logIngestRun(...)` e retorna `{ filesFetched, filesChanged, errors, durationMs }`.
  - Cobre: **RF-001, RF-002, RF-003, RF-004, RNF-016, RNF-032**.
  - Compatibilidade com `middleware.ts` (BotID): cron requests do Vercel são `isVerifiedBot` → passam.
  - Despacho: `tse-parser-builder` (parte da rota), depois `constitution-guard` lê pós-fato.
  - Estimado: 3h.

- [x] **T09 — Cadência via Vercel Cron 60s** *(D-1)*
  - Sem self-loop. O handler executa **1 ciclo completo por invocação**.
  - Janela checada no handler (17h–04h BRT) — fora dela retorna `{skipped:'out_of_window'}`.
  - **Pré-req**: ADR-0011 (cadência 60s) criado pelo `adr-author` — referenciar em comment.
  - Cobre: **RF-002 (revisado D-1), RNF-006 (revisado D-1)**.
  - Risco: ciclo precisa caber em 60s `maxDuration` mesmo no pior caso (~500 GETs em paralelo no preview, ~73k em produção); paralelismo controlado em T08 é essencial.
  - Estimado: 1h.

### Fase 4 — Vercel Cron config

- [x] **T10 — Atualizar `vercel.ts` crons**
  - Substitui o placeholder `"0 3 * * *"` por cron de janela: `*/1 20-23,0-7 * * *` (UTC; equivale a 17h–04h BRT) apontando para `/api/ingest`.
  - Manter heartbeat diurno `0 12 * * *` (handler retorna `skipped` fora da janela) — necessário pra satisfazer regra Vercel "≥1 execução/dia em plano pago".
  - Cobre: **RF-002 (D-1)**.
  - Estimado: 0.5h.

- [x] **T11 — `maxDuration` em route handler**
  - Plano Vercel confirmado: **Pro** (D-1).
  - Adicionar `export const maxDuration = 60;` em `app/api/ingest/route.ts`. Comment explicando: budget = polling 60s; se ciclo médio < 30s, sobra margem.
  - Cobre: **RF-002 (D-1), RNF-006 (D-1)**.
  - Estimado: 0.2h.

### Fase 5 — Script de replay

- [x] **T12 — `scripts/replay-2022.ts` (skeleton)**
  - Cria `scripts/replay-2022.ts` (tsx-runnable, sem build).
  - Lê snapshots de 2022 (ainda inexistentes em Neon — usa fixtures `tests/fixtures/tse/2022/` ou um Postgres seed se a chore S02 entregar).
  - Ordena por `ts ASC`, **chama placeholder** `runModel(snapshot)` que apenas loga `[t=...] zona=... cargo=... pct=...`.
  - Não implementa modelo (escopo spec 002). DoD da S02 exige só que **compile**.
  - Output: `build/replay-2022/<timestamp>/report.json` com MAE-shaped vazio (campos presentes, valores `null`).
  - Cobre: **RF-005** (compila — modelo real em S03).
  - Estimado: 2h.

### Fase 6 — Verificação dos RFs já entregues na S01

- [x] **T13 — Teste de verificação RF-006 / RF-007 (historical_results)**
  - Cria `tests/unit/tse/historical-coverage.test.ts`.
  - Query Neon: `SELECT ano, COUNT(*) FROM historical_results GROUP BY ano` — espera `2018` e `2022` com ≥119.000 linhas cada.
  - Query: `SELECT DISTINCT cargo, turno FROM historical_results WHERE ano=2022` — espera `{cargo:1,turno:1}, {cargo:1,turno:2}, {cargo:3,turno:1}, {cargo:3,turno:2}`.
  - Cobre: **RF-006, RF-007** (testes — implementação done na S01).
  - Estimado: 0.5h.

- [x] **T14 — Teste de verificação RF-008 / RF-009 (geo + eleitorado)**
  - `tests/unit/tse/geo-coverage.test.ts`:
    - `zonas` tem ≥2.600 linhas e join 100% contra `municipios`.
    - `eleitorado WHERE ano=2026` tem ≥2.500 zonas e ≥25 UFs (DF gap conhecido).
  - Cobre: **RF-008, RF-009** (testes — implementação done na S01).
  - Estimado: 0.5h.

### Fase 7 — Testes do pipeline ao vivo

- [x] **T15 — Fixtures EA20 reais 2022**
  - Chore de sprint (não-spec) entrega `tests/fixtures/tse/2022/`. Se ainda não chegou, criar **mocks mínimos** a partir do schema EA20 — 3 fixtures: `presidente-sp-z0001.json`, `presidente-sp-z0002.json` (variação de hash), `presidente-rj-z0001.json`.
  - Cobre: prerequisite de T16-T19.
  - Estimado: 1h (mocks) ou 0.3h (se chore S02 entregou fixtures reais).

- [x] **T16 — Unit: parser EA20 (T01) contra fixtures**
  - `tests/unit/tse/ea20-schema.test.ts`:
    - Parse sucesso para fixture válida.
    - Parse-fail (Zod throw) com fixture corrompida (campo `cand` ausente).
  - Cobre: **RF-001**.
  - Estimado: 0.5h.

- [x] **T17 — Unit: client com fetch mockado (T04, T05)**
  - `tests/unit/tse/client.test.ts` (`vi.mock('node:fetch')` ou MSW):
    - GET 200 + body → `kind: 'fresh'` com hash determinístico.
    - GET 200 + header `ETag: "abc"` + posterior GET com `If-None-Match: "abc"` → 304 → `kind: 'not_modified'`.
    - GET 500 três vezes → throw após retry exhausted; GET 500 → 500 → 200 → success.
    - Timeout >5s → throw.
  - Cobre: **RF-001, RF-003, RNF-011**.
  - Estimado: 2h.

- [x] **T18 — Unit: repository append-only (T06)**
  - `tests/unit/tse/repository.test.ts`:
    - Insert seguido de insert com mesmo hash → segundo é skipped (sem nova linha).
    - Insert com hash diferente → N+1 linhas; SELECT da primeira linha confirma **payload não alterado** (constituição § 10).
    - Tentativa de UPDATE direto via drizzle (teste de proteção) — opcional, mas vale como sanity.
  - Cobre: **RF-004**.
  - Despacho proativo: `constitution-guard` lê este teste para confirmar gate.
  - Estimado: 1h.

- [x] **T19 — Integration: ciclo completo `/api/ingest`**
  - `tests/integration/ingest-cycle.test.ts`:
    - Mock TSE servindo 3 fixtures (T15). Chama o route handler diretamente (sem subir Next dev).
    - Assert: `files_changed=3` no 1º ciclo; `=0` no 2º (ETag/hash dedup).
    - Assert: `ingest_log` ganha 2 linhas.
    - Assert: requisição sem `x-cron-secret` → 401.
    - Assert: requisição fora da janela (mockar `Date.now()`) → 200 `{skipped:'out_of_window'}`.
  - Cobre: **RF-001, RF-002, RF-003, RF-004, RNF-016**.
  - Estimado: 2.5h.

### Fase 8 — Observabilidade e alerting

- [x] **T20 — Métrica `tse.lag_seconds` + alerta Slack**
  - Em `lib/tse/log.ts`, emitir log estruturado `{ metric: 'tse.lag_seconds', value: now - snapshot.dg/hg, target: '...' }`.
  - Hook Slack: criar `lib/tse/alerts.ts` com `notifySlack({ severity, msg })` que POSTa em `process.env.SLACK_WEBHOOK_URL` se setado. Trigger: lag > 60s OU 3 erros consecutivos em um ciclo.
  - **Não bloquear** o ciclo se Slack falhar — fire-and-forget com `void`.
  - Cobre: **RNF-033, RNF-034**.
  - Risco: Vercel não roda fora da função; usar `waitUntil()` se disponível na Next 16 API.
  - Estimado: 1.5h.

- [x] **T21 — Teste manual: forçar alerta Slack**
  - Em preview, com `SLACK_WEBHOOK_URL` setado, injetar fixture com `dg/hg` antigo → confirmar mensagem em `#atlasmenna-ops`.
  - Documentar passo em `docs/operations/runbook.md` (seção "TSE indisponível").
  - Cobre: DoD sprint S02.
  - Estimado: 0.5h.

### Fase 9 — RF-010 (conformidade regulatória) — *ver adendo de obsolescência ao fim do arquivo*

- [~] **T22 — ~~Checklist RF-010 e watch regulatório~~ — OBSOLETA (2026-09-05)**
  - ~~**NÃO é código** — entrada em `docs/operations/runbook.md` (seção "Conformidade TSE"):~~
    - ~~User-Agent atual: `AtlasMenna/1.0 (interessado-divulgacao-cadastrado)`.~~
    - ~~Status cadastro TSE: **pendente** (resolução 2026 não publicada).~~
    - ~~Owner: usuário (Tiago).~~
    - ~~Watch: revisar `docs/reference/regulatory.md` semanalmente.~~
  - **Motivo da obsolescência**: a task inteira existia para acompanhar um **cadastro que não
    existe** e uma **resolução que já estava publicada** (Res. 23.751/2026, arts. 264–269). Não há
    status administrativo a monitorar, nem aprovação a esperar — ver
    [ADR-0020](../../architecture/adrs/0020-conformidade-res-23751-2026.md).
  - **O que a substitui**: RF-010 reescrito em seis sub-requisitos verificáveis por teste
    (RF-010.1 integridade do payload · RF-010.2 rotulagem "não oficial" · RF-010.3 rate limiter
    ≤ 50 rps · RF-010.4 condicional ciente do 304 · RF-010.5 zero sondagem de URL ·
    RF-010.6 User-Agent honesto). O watch regulatório vira watch **técnico** de leiaute
    (`pnpm tse:watch`), não administrativo.

### Fase 10 — Gates pré-`shipped` (sequencial)

Todos paralelos exceto onde indicado.

- [x] **T23 — Gate: `pnpm typecheck && pnpm lint && pnpm test`** verde. (60/60 tests passed em 3.8s)
- [x] **T24 — Gate: `constitution-guard`** — APROVADO COM RESSALVAS (ressalva menor: `ws` é transitivo de `@neondatabase/serverless` — não exige ADR, só nota em tech-stack.md).
- [x] **T25 — Gate: `rf-coverage-checker`** — OK PARA SHIPPED. Todos 10 RFs cobertos. Sugere 4 atualizações pontuais em traceability.md (RF-002/003 add integration, RF-004 add unit, RF-007 add unit) — spec-syncer faz.
- [x] **T26 — Gate: a11y N/A** (sem UI nesta spec).
- [x] **T27 — Gate: model-validator N/A** (T12 só compila — validação real em S03).
- [x] **T28 — Promoção: spec.md `status: draft → shipped`** + despachar `spec-syncer`.

## Adendo de obsolescência — 2026-09-05 (Fase 3 da S07)

Este `tasks.md` fechou a S02 em 2026-05-17 e permanece como registro histórico daquele ciclo —
nenhuma checkbox marcada foi desmarcada. O que a pesquisa em fonte primária de 2026-09-05 tornou
obsoleto está riscado acima, com o motivo ao lado:

| Item | Situação |
|---|---|
| Premissa "Cadastro interessado divulgação" (Contexto) | **Obsoleta** — cadastro não existe na Res. 23.751/2026 |
| D-2 (User-Agent declarando cadastro) | **Revertida** — o header afirmava status inexistente |
| T22 (checklist de cadastro + watch regulatório) | **Obsoleta** — substituída por RF-010.1..RF-010.6 |
| T25 (`rf-coverage-checker` "todos 10 RFs cobertos") | **Parcialmente vencida** — a spec passou de 10 para 16 RFs; os seis sub-RFs de RF-010 precisam de nova passada de cobertura |

Não há neste arquivo nenhuma task de "refactor do parser EA20 → JSON": esse trabalho vivia na
[spec 001.1](../001.1-tse-json-refactor/spec.md), agora `superseded` — o EA20 foi mantido pelo TSE
e sempre foi JSON. O que de fato mudou (estrutura interna do leiaute 2026) foi absorvido nas Fases
0 e 1a da S07 (commits `c6395a3` e `67c1014`), fora deste `tasks.md`.

## Caminho crítico

```
T01 → T04 → T05 → T06 → T08 → T11 (plano) → T09 (cadência)
                                           ↘ T10 (vercel.ts)
                                              ↘ T19 (integration) → T23/T24/T25 → T28
```

Caminho crítico em horas: **T01(1.5) + T04(2.5) + T05(1) + T06(2) + T08(3) + T11(1) + T09(1.5) + T10(0.5) + T15(1) + T19(2.5) + T23-T25(2) + T28(0.5) ≈ 19h**.

Com 4 dias úteis × 6h de execução produtiva = 24h disponíveis → folga de ~5h para imprevistos (formato EA20 diferente, OQ-1 indo pra ADR, ajustes pós-`constitution-guard`).

## Paralelismo possível

- T01 ∥ T02 ∥ T03 (todas independentes — Fase 0).
- T13 ∥ T14 ∥ T22 (checklists e queries de verificação — qualquer momento).
- T16 ∥ T17 ∥ T18 (uma vez que T01/T04/T06 terminarem — testes unitários independentes).
- T20 pode rodar em paralelo com T19.

## Riscos vivos por task

| Task | Risco | Mitigação |
|---|---|---|
| T04 | TSE não respeita If-None-Match em CDN | Dedup secundário via hash SHA256 (T06) |
| T08 | BotID middleware bloqueia cron | Vercel Cron é `isVerifiedBot=true` — middleware já trata. Confirmar em T19 |
| T09 | Self-loop estoura `maxDuration` | OQ-1; se Hobby, forçar cadência 60s + ADR |
| T11 | Plano Hobby invalida design da spec | Bloqueia sprint até decisão usuário |
| T15 | Fixtures TSE 2022 ainda não baixadas | Mocks mínimos a partir do schema (1h extra) |
| T20 | `waitUntil` não disponível em Fluid Compute | Fallback: log estruturado consumido por dashboard `/_status` (spec 012, S07) |

## Cross-refs

- Spec: [./spec.md](./spec.md)
- Design: [./design.md](./design.md)
- Sprint ativa: [../../sprints/2026-S02-f2-ingestao.md](../../sprints/2026-S02-f2-ingestao.md)
- Constituição § 1 (transparência) e § 10 (append-only): [../../constitution.md](../../constitution.md)
- ADRs: [0001](../../architecture/adrs/0001-edge-config-no-read-path.md), [0002](../../architecture/adrs/0002-polling-cdn-cache.md), [0008](../../architecture/adrs/0008-nao-convex.md)
- NFRs: [performance.md](../../nfr/performance.md), [availability.md](../../nfr/availability.md), [security.md](../../nfr/security.md), [observability.md](../../nfr/observability.md)
