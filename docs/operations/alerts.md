---
title: Alertas Slack
description: Canal #atlasmenna-ops com webhooks para anomalias críticas
status: stable
source: PRD.md § 19.4
---

# Alertas Slack

**Canal**: `#atlasmenna-ops`.

## Critérios de disparo

| Métrica | Threshold |
|---|---|
| `tse.lag_seconds` | >60s |
| `tse.fetch_errors_rate` | >5%/min |
| `model.compute_duration_ms` p95 | >2000ms |
| `edge_config.write_duration_ms` p95 | >15s |
| `projection.cache_hit_ratio` | <95% |

## Testes

Forçar falsos positivos no bug bash de Set/2026 para garantir delivery.

## Cross-refs

- Métricas detalhadas: [./dashboard-status.md](./dashboard-status.md)
- Runbook: [./runbook.md](./runbook.md)
- NFR observabilidade: [../nfr/observability.md](../nfr/observability.md)
