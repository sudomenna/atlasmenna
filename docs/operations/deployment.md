---
title: Deployment
description: Rolling Release Vercel com canary 10/50/100% — sem big-bang no dia D
status: stable
source: PRD.md (RF-059) + constituição § 7
---

# Deployment

## Recursos provisionados (2026-05-17)

| Recurso | Identificador | URL |
|---|---|---|
| Repo GitHub | `sudomenna/atlasmenna` (privado) | https://github.com/sudomenna/atlasmenna |
| Vercel project | `atlasmenna` (scope `sudomennas-projects`) | https://vercel.com/sudomennas-projects/atlasmenna |
| Vercel preview/prod URL inicial | deploy `salacofre-7ft711fbp-...` | https://salacofre-7ft711fbp-sudomennas-projects.vercel.app |
| Edge Config store | `salacofre-edge-config` | (env `EDGE_CONFIG`) |
| Blob store (public) | `salacofre-blob` (`store_jbTu251tioj3y57Z`, region iad1) | base: https://jbtu251tioj3y57z.public.blob.vercel-storage.com/ |
| PMTiles publicados | UFs (451 KB) + Municípios (10 MB) | `/ufs.pmtiles`, `/municipios.pmtiles` no base acima |
| Neon Postgres | `salacofre-db` (via Vercel Marketplace) | (env `DATABASE_URL`, `DATABASE_URL_UNPOOLED`) |

## Estratégia

- **Vercel Rolling Releases** — canary 10% → 50% → 100%.
- Sem big-bang deploy no dia D (princípio constitucional § 7).
- Rollback rápido via dashboard Vercel.

## Janelas de freeze

- A partir de **F6 (Set 2026)**: só hotfix em produção, com aprovação.
- **Dia D (04/10/2026)**: deploy congelado das 16h00 até 05h00 do dia seguinte, exceto hotfix crítico.

## Cron toggle

Cron pode ser habilitado/desabilitado via env var `CRON_ENABLED` (RF-060) — usado em ambientes de preview e durante incidentes.

## Cross-refs

- RF-059, RF-060: [../specs/010-operacao-monitoramento/](../specs/010-operacao-monitoramento/)
- Runbook (rollback): [./runbook.md](./runbook.md)
- Constituição § 7: [../constitution.md](../constitution.md#7-resiliência-operacional)
