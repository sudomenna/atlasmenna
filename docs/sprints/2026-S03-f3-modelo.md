---
id: 2026-S03
title: Sprint 03 — Modelo estatístico + replay 2022
status: done
start: 2026-06-22
end: 2026-07-05
opened: 2026-05-17
closed: 2026-05-17
phase: F3
goal: Spec 002 (modelo) shipped, com replay 2022 atingindo MAE@1h < 2pp (OT-4) e Edge Config sendo atualizado
specs_in_flight: [002-modelo-estatistico]
specs_planned_next: [003-home-nacional, 004-pagina-uf-presidencial]
---

# Sprint 03 — Modelo estatístico + replay 2022

## Objetivo único

[Spec 002](../specs/002-modelo-estatistico/) atinge `status: shipped` com o modelo validado contra 2022 (MAE@1h < 2pp — gate de OT-4).

## Specs in-flight

- [~] **002-modelo-estatistico** — RF-011 a RF-020 entregues + `status: implementing` (Caminho C — **NÃO promovida a shipped**). Gate técnico OT-4 PASS (MAE@1h: PT 0.998pp, PL 0.867pp), mas validação dinâmica completa do modelo aguarda simulado oficial TSE 2026. Razões na Retrospective abaixo.

## Chores fora de spec

- [ ] Setup do runtime Python no Vercel Fluid Compute (Python 3.14 + NumPy)
- [ ] `lib/edge-config/writer.ts` — abstração sobre o SDK `@vercel/edge-config`
- [ ] Confirmar pré-cálculo de `historical_results` agregado por UF (denormalização auxiliar pra acelerar bootstrap)

## Despachos sugeridos

- **`spec-implementer`** orquestra a spec 002 (lib/model em TS + Python script).
- **`model-validator`** roda o replay 2022 — gate obrigatório de OT-4.
- **`constitution-guard`** confirma: zero LLM, zero PII, determinismo do modelo ([constituição § 6](../constitution.md#6-determinismo-do-modelo)).
- **`rf-coverage-checker`** valida cobertura.
- **`spec-syncer`** propaga `shipped`.

## Definition of Done

- ⚠️ Spec 002 com `status: shipped` — **NÃO atingido** (Caminho C). Spec ficou em `implementing`; promoção a shipped condicionada ao simulado oficial TSE 2026.
- ✅ `model-validator` retorna **PASS técnico** no replay (MAE@1h: PT 0.998pp, PL 0.867pp — ambos <2pp). **Caveat**: gate semântico não exercitou modelo de swing (dataset circular).
- ✅ Bootstrap completa em <2s p95 — medido 142ms p95 por timestep (~14× abaixo do alvo).
- ⚠️ Edge Config `projection:current` — código pronto (Python chama `/api/_internal/edge-write` → `writeProjection` Promise.allSettled), mas **NÃO exercitado contra Edge Config real** (sem deploy preview).
- ⚠️ Pipeline ponta-a-ponta em preview — **NÃO exercitado contra preview Vercel real** (handoff operacional pendente).
- ✅ Casos de borda RF-017 (0% apurado) e RF-018 (<5% apurado) testados — unit + integration verdes contra Neon real.

## Riscos da sprint

- **MAE@1h pode ficar acima de 2pp** — investigar mapeamento histórico 2022 + ponderação por eleitores aptos. Se persistir, decidir entre relaxar OT-4 (ADR formal) ou refinar modelo (gasta tempo da S04).
- **Tempo de bootstrap pode estourar 2s** — paralelizar via NumPy Generator com seeds determinísticos.

## Replanejamentos mid-sprint

_(preencher se mudar)_

## Retrospective

Fechada em 2026-05-17 (49 dias antes do `end: 2026-07-05` planejado), em modo bootstrap intensivo. Spec 002 entregue via **28 tasks em ~8h efetivas** (caminho crítico estimado em 19h, realidade compacta por paralelização agressiva e bootstrap NumPy vetorizado dramaticamente mais rápido que estimado).

### Decisão de fechamento: Caminho C

Diante do PASS técnico do gate OT-4 com red flags semânticos descobertos durante a execução (swing efetivamente zero no replay porque o dataset T21 era circular sem ruído), optei por:

1. **NÃO** promover spec 002 a `status: shipped` agora.
2. Manter spec em `implementing` com `ship_blocked_on:` listado no frontmatter.
3. Fechar sprint S03 em `done` com retrospective honesta documentando o trade-off.
4. Validação dinâmica completa do modelo fica condicionada ao **simulado oficial TSE 2026** (chore S04+).

Justificativa: forçar promoção com gate semanticamente fraco compromete a credibilidade do contrato de "shipped" no projeto. Replay sintético com ruído seria opção (B), mas ainda assim sintético — e o simulado oficial vem em poucas semanas com dados reais. Custo de esperar é zero (UI da S04 não depende de spec 002 shipped, só de existir).

### O que funcionou

- **Paralelização agressiva**: 4 ondas de subagents em paralelo (T02∥T03; T18∥T19; T20∥T21; T23∥T24∥T25). Caminho crítico de 19h comprimido em ~8h walltime.
- **Bootstrap NumPy vetorizado** (T09): substituí o pseudocódigo do design (`for _ in range(n_resamples)`) por uma matriz `(n_resamples, k)` num único `rng.integers`. Resultado: **3ms por UF localmente** (estimativa do design era ~50× mais lenta). Compute total medido: **787ms para 5 timesteps × 27 UFs × 11 candidatos × 1000 resamples** (T22).
- **T20 escolheu Opção B inteligente**: descobriu que `compute_uf_projections` e `compute_national` já eram **puras** dentro de `project.py` (DB I/O só no wrapper). Importou direto em `replay_batch.py` — drift zero, sem duplicar código de produção. Wall time projetado pro replay completo: ~45s (vs ~1h45 do approach naive de subprocess-por-call).
- **Imports absolutos no Vercel Python** (`from api.model.X import Y`) — decisão documentada pelo agent do T12 antes de virar dor.
- **Profiling cedo (T13)**: medição com mock psycopg deu **p95=28.5ms** (~70× abaixo do alvo RNF-006 de 2000ms). Eliminou ansiedade sobre performance durante o resto da sprint.
- **Decisões kickoff explícitas** (K-1..K-7) — fechamos open questions ANTES de codar, evitando o tipo de bloqueio que aconteceu em S02 com OQ-1 (cadência).
- **Stack Python na Vercel**: documentação Vercel é explícita — `api/*.py` na raiz (não em `app/`), `BaseHTTPRequestHandler`, pinning via `.python-version`. T02 descobriu cedo e documentou.
- **Drift entre Python e TS controlado**: `lib/model/repository.ts` (5 funções) ficou pronta mas o orchestrator Python usa psycopg direto. A repo TS continua útil para tests integration (T05) e para futuras invocações TS→model.

### O que melhorar

- **T21 dataset circular**: o fixture do replay derivou `pct_validos` do bucket final dos próprios snapshots (`pvap/100`), fazendo swing=0 em todas as zonas. **Gate técnico passou mas não exercitou o modelo de swing**. Para um replay sintético honesto, precisaria injetar ruído ±2pp entre a linha histórica e o snapshot — chore S04 se o simulado oficial demorar.
- **Bug pré-existente descoberto tarde**: `historical_results.pct_validos = null` para todos os 28.202 registros 2022 (carga S01 só inseriu `votos`). Só virou problema quando T22 tentou usar — corrigido inline mas fixtures T21 têm sha1 inválido agora. Lição: a próxima carga de dados históricos precisa ter validação semântica, não só de schema.
- **`p_vitoria_a` semanticamente invertido**: `compute_national` define "A" = menor `candidato_id`. Com 11 candidatos no replay 2022, A = Ciro (3022112), não Lula (3022113). Não afetou gate (MAE é por id), mas quebra UI quando spec 003+ consumir. Fix obrigatório S04: identificar top-2 por `pct_projetado`, não por id.
- **CRITICAL P2 só apareceu no `constitution-guard`**: T16b embutiu hex literais `#c0392b`/`#2980b9` no payload Edge Config (violação § 2). Corrigido in-place para tokens semânticos. Lição: para qualquer task que toca payload visível ao front, despachar `constitution-guard` **durante** a task, não só no gate final.
- **`pnpm test` exit code é traiçoeiro**: rodou exit 0 mesmo com 8 test files falhando por ausência de `DATABASE_URL` no env. Real `pnpm test` deveria sempre rodar com `.env.local` exportado. Documentar no `package.json` ou criar wrapper.
- **Estimativas conservadoras demais**: caminho crítico 19h, realidade ~8h. Foi bom (folga), mas indica que minhas estimativas não calibraram com a agressividade de paralelização disponível em AtlasMenna. Recalibrar para S04.

### Carry-over pra S04

**Bugs introduzidos por S03 (corrigir cedo na S04)**:
1. **`compute_national` p_vitoria_a invertido** — identificar top-2 por `pct_projetado`, não `candidato_id`. Bloqueante para UI (spec 003+).
2. **Fixture replay-2022 com sha1 stale** — T22 corrigiu inline; regenerar T21 com `pct_validos` correto após fix #4 e atualizar tasks.md.
3. **Divergência K-1 spec ↔ código**: spec.md diz `computed=false` quando candidato sem mapping, mas implementação trata por-candidato (continue no loop). Decidir: corrigir spec ou código.

**Bugs pré-existentes que viraram chores explícitos**:
4. **`historical_results.pct_validos = null`** — popular via migration: `UPDATE historical_results SET pct_validos = votos / SUM(votos) OVER (PARTITION BY ano, turno, cargo, uf, cod_zona)`.
5. **Eleitorado 2026 sem DF** — esperar TSE publicar; chore RF-010 já segue.
6. **`botid` sem ADR** (constituição § 9) — despachar `adr-author` retroativo.
7. **`app/sobre-o-modelo/` só com `.gitkeep`** (constituição § 8) — bloqueante antes de qualquer UI de projeção. Materializa spec 011.
8. **`<ForecastTransparency />` ausente** (constituição § 8) — mesma raiz.
9. **`pnpm test` flaky em forks paralelos**: `ingest-cycle.test.ts:T19` espera count absoluto de `ingest_log`. Migrar para marker JSON em `notes` com `test_run_id`, OU forçar `singleFork` em integration tests.
10. **Drizzle baseline vs Neon**: `pnpm db:generate` gera baseline 0000 falso porque migrations foram manuais. Reconciliar via introspect + baseline marcado como applied.

**Validação dinâmica do modelo (condição pra promover spec 002 a shipped)**:
11. **Re-rodar gate OT-4 com simulado oficial TSE 2026** (esperado jul–set/2026). Critério: MAE@1h < 2pp em dataset real (não sintético).
12. **Deploy preview Vercel para validar Python end-to-end**: smoke `curl https://<preview>/api/model/project` retornando shape correto + grava em projections + Edge Config preview tem `projection:current`. Hand-off operacional pendente.
13. **Profiling em preview**: re-medir `computed_duration_ms` com DB Neon real (T13 mediu só local com mock — estimou +250–600ms em preview).

**Watch items operacionais (carry-over S02 já flagado em S03)**:
14. **Concorrência prod CONCURRENCY=20**: documentação dos 3 cenários (a/b/c) está em `runbook.md § "TSE — concorrência produção"`. Decisão fica para S04 se nenhuma opção decantar.
15. **`SLACK_WEBHOOK_URL`** no Vercel para alerting (owner).
16. **`TSE_COD_ELEICAO` placeholder** até Res. 2026 (owner).
17. **Cadastro RF-010** (owner).

**Não-bloqueantes mas relevantes**:
18. K-1 formalizar como RF (sugestão do `rf-coverage-checker`).
19. Next 16 deprecation: `middleware.ts` → `proxy.ts` (carry-over S02).

### Sinal qualitativo da sprint

Spec 002 entregou **100% das funcionalidades de RF (10/10 RFs)** com **51 pytest + 93 vitest verdes** e **gate OT-4 técnico PASS**. A decisão de não promover a shipped foi sobre **credibilidade do gate semântico**, não falha técnica. A próxima sprint pode começar a UI (S04) com a base do modelo estável; o reshipping após simulado oficial é updating de metadados + uma re-run de validator, não retrabalho.

## Cross-refs

- Sprint anterior: [2026-S02-f2-ingestao.md](./2026-S02-f2-ingestao.md)
- Próxima sprint: [2026-S04-f4a-home-uf.md](./2026-S04-f4a-home-uf.md)
- Spec: [../specs/002-modelo-estatistico/](../specs/002-modelo-estatistico/)
- ADR: [0006 Bootstrap, não Bayesiano](../architecture/adrs/0006-bootstrap-nao-bayesiano.md)
