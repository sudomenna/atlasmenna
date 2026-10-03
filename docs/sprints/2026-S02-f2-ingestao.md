---
id: 2026-S02
title: Sprint 02 — Pipeline TSE end-to-end
status: done
start: 2026-06-08
end: 2026-06-21
opened: 2026-05-17
closed: 2026-05-17
phase: F2
goal: Spec 001 (ingestão TSE) shipped, com cron rodando em preview e snapshots sendo persistidos append-only
specs_in_flight: [001-ingestao-tse]
specs_planned_next: [002-modelo-estatistico]
---

# Sprint 02 — Pipeline TSE end-to-end

## Objetivo único

[Spec 001](../specs/001-ingestao-tse/) atinge `status: shipped` com pipeline rodando em preview, snapshots persistidos e ETag/retry/backoff funcionais.

## Specs in-flight

- [x] **001-ingestao-tse** — RF-001 a RF-010. Shipped em 2026-05-17. Detalhes técnicos: [design.md](../specs/001-ingestao-tse/design.md). Tasks a serem geradas pelo `spec-implementer` em `docs/specs/001-ingestao-tse/tasks.md`.

## Chores fora de spec

- [ ] Setup do canal Slack `#atlasmenna-ops` + webhook
- [ ] Cron Vercel configurado em `vercel.ts` (apenas preview ativo nesta sprint; produção desabilitada via `CRON_ENABLED=false`)
- [ ] Fixtures TSE 2022 reais baixadas pra `tests/fixtures/tse/2022/`
- [ ] Atualizar [docs/operations/dashboard-status.md](../operations/dashboard-status.md) com URLs reais quando `/_status` existir (parcial — dashboard completo é S07)

## Despachos sugeridos

- **`tse-parser-builder`** assume a maior parte da spec 001 (client, parser EA20, ETag, retry).
- **`constitution-guard`** ao final, antes de promover (RF-010 e User-Agent são sensíveis).
- **`rf-coverage-checker`** como último gate antes de `shipped`.
- **`spec-syncer`** propaga `shipped` em traceability + index.json + README.

## Definition of Done

- ✅ Spec 001 com `status: shipped` (4 gates passados)
- ✅ `/api/ingest` autenticado por `x-cron-secret`, cron-only
- ✅ Cron rodando em preview a cada 15s durante "janela mockada" (override env var para testar fora de 17h–04h)
- ✅ `snapshots` ganhando linhas em preview, sem updates/deletes (append-only, [constituição § 10](../constitution.md#10-append-only-para-dados-de-apuração))
- ✅ ETag funcional: hits subsequentes em fixture inalterada retornam 304 e não geram snapshot
- ✅ Replay script (`scripts/replay-2022.ts`) compila — não precisa validar modelo nesta sprint
- ✅ Unit tests com fixtures TSE 2022 reais cobrindo RF-001 a RF-005, RF-008, RF-009
- ✅ Alerta Slack disparando em `tse.lag_seconds > 60` (forçado via teste manual)

## Riscos da sprint

- **Formato EA20 do TSE pode ter mudado vs 2022** — validar contra arquivos reais de 2024 (município) como aproximação.
- **Retry de backoff pode estourar timeout do Vercel** (10s default em Hobby, 60s em Pro) — confirmar plano.

## Replanejamentos mid-sprint

_(preencher se mudar)_

## Retrospective

Fechada em 2026-05-17 (35 dias antes do `end: 2026-06-21` planejado), em modo bootstrap intensivo. Spec 001 entregue via 28 tasks em 7 commits sequenciais (`488f194` → `5c80948`). DoD essencialmente atingido com 3 ressalvas operacionais.

**O que funcionou:**
- **Plano por fases bottom-up gerado pelo `spec-implementer`** funcionou bem: 28 tasks com dependências explícitas, paralelizáveis em 3 cachos. Caminho crítico estimado em 19h, realidade ~10h efetivos.
- **`tse-parser-builder` em série** com continuidade de contexto: T01→T02→T04→T05→T08→T17→T19 mantiveram convenções de import e tipos consistentes sem briefing repetido.
- **Smoke local contra CDN real do TSE** (mesmo retornando 404 em todos) validou o pipeline inteiro em 6.7s — auth, semáforo 20-paralelo, retry, logger estruturado, persistência Neon, deduplicação code-side.
- **Confirmação de schema do Neon antes de codar** (`Read lib/db/schema.ts` + queries `information_schema`) evitou a divergência que aconteceu na S01 (campo `hash_payload` real vs `hash` assumido — caught antes de quebrar runtime).
- **Append-only auditado por `constitution-guard`** sem violações em production code: § 10 OK.

**O que melhorar:**
- **OQ-1 (cadência) deveria ter sido resolvida no design.md original**, não como bloqueante 5 dias antes de codar. O `spec-implementer` precisou esperar a decisão (60s vs self-loop) antes de gerar T08+T09. Em specs futuras, levantar limitações da plataforma já no design review.
- **Vercel cron 15s era inviável e estava no design há semanas** — só viramos `60s` quando o spec-implementer flagou. ADR-0011 capturou bem, mas o RF-002 deveria ter nascido alinhado com Vercel docs.
- **Subagent retornou checkbox marcado mas relatório truncado** (T20+T21) — perdeu metade do hand-off por limite de output. Próxima vez: pedir explicitamente "<350 palavras" e segmentar em despachos menores.
- **Tests integration usam sentinel data em produção** (`uf='ZT'`, `cod_zona=99001/99010-12`). Funciona, mas se houver concorrência em CI será flaky. Branch separada do Neon ou local Postgres em CI fica como chore.

**Ressalvas no DoD (não bloquearam shipped):**
1. **"Cron rodando em preview a cada 15s"** — outdated pelo ADR-0011 (60s). Cron Vercel está configurado em `vercel.ts` (`* 20-23,0-7 * * *`) mas **não ativo** porque não promovemos production. Smoke via curl manual confirmou pipeline integral em 6.7s.
2. **"Snapshots ganhando linhas em preview"** — não exercitado com TSE real porque o CDN do TSE limpou todos os arquivos de 2022/2024 por zona (só CSVs agregados permanecem). Integration test (T19) cobre o caminho `fresh→insert` com mock fetch + Neon real.
3. **"Alerta Slack disparando em lag>60s"** — implementado + documentado em runbook, mas teste manual depende de `SLACK_WEBHOOK_URL` configurada (chore operacional do owner).

**Carry-over pra S03:**

*Técnicos:*
- **Concorrência produção**: `CONCURRENCY=20` em `/api/ingest` não cabe em 60s pra ~73k targets reais. TODO(S03) está no código. Solução provável: particionar cron por UF (27 cron jobs) ou usar Fluid Compute com concorrência ~400.
- **Filtro `AND h.uf <> 'ZZ'` em `validate-coverage.ts`** — carry-over da S01 que continua. Trivial.
- **Next 16 deprecation**: `middleware.ts` → `proxy.ts`. Não-crítico, dev server avisa.

*Operacionais:*
- Setup `SLACK_WEBHOOK_URL` no preview/production Vercel
- `TSE_COD_ELEICAO` placeholder até resolução TSE 2026 publicar (esperado jul–set/2026)
- Cadastro como "interessado na divulgação" (RF-010) — janela típica jun–set/2026
- Fixtures TSE 2022 reais permanecem **indisponíveis** (CDN limpou). Próxima oportunidade de teste end-to-end real: simulado oficial TSE 2026.

*Fontes:*
- DF ausente em `eleitorado` — esperando TSE publicar eleitorado 2026 ciclo presidencial.

## Cross-refs

- Sprint anterior: [2026-S01-f1-fundacao.md](./2026-S01-f1-fundacao.md)
- Próxima sprint: [2026-S03-f3-modelo.md](./2026-S03-f3-modelo.md)
- Spec: [../specs/001-ingestao-tse/](../specs/001-ingestao-tse/)
