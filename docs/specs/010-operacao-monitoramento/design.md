---
id: 010-operacao-monitoramento
type: design
title: Operação e Monitoramento — Design Técnico
status: draft
---

# Design — Operação e Monitoramento

## Métricas Custom

Coletadas via `console.log` JSON estruturado + Vercel Logs:

| Métrica | Coleta | Alerta |
|---|---|---|
| `tse.lag_seconds` | `Date.now() - parse(dg+hg)` no `/api/ingest` | >60s |
| `tse.fetch_errors_rate` | Counter / minuto | >5%/min |
| `model.compute_duration_ms` | `performance.now()` no Python | p95 >2000ms |
| `edge_config.write_duration_ms` | Wrapper do `set()` | p95 >15s |
| `projection.cache_hit_ratio` | Header `x-vercel-cache` | <95% |
| `projection.requests_per_sec` | Vercel Analytics | — |

## Alertas Slack

Webhook em `lib/alerts/slack.ts` posta em `#atlasmenna-ops`. Trigger via try/catch dos handlers ou rotina periódica.

## Rolling Releases

Configurado em `vercel.ts`:

```ts
export default defineConfig({
  rollingRelease: {
    stages: [
      { percentage: 10, duration: '10m' },
      { percentage: 50, duration: '10m' },
      { percentage: 100 }
    ],
    autoPromote: false  // requer aprovação manual no dashboard
  }
});
```

## Cron toggle

```ts
// app/api/ingest/route.ts
export async function POST(req: Request) {
  if (process.env.CRON_ENABLED !== 'true') {
    return Response.json({ ok: true, skipped: true });
  }
  // ... fluxo normal
}
```

## Cross-refs

- Spec: [./spec.md](./spec.md)
- Dashboard detalhado: [../012-dashboard-status/design.md](../012-dashboard-status/design.md)
- Operations: [../../operations/](../../operations/)
