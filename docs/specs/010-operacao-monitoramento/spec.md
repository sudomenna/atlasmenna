---
id: 010-operacao-monitoramento
title: Operação e Monitoramento
status: draft
priority: M
personas: []
screens: [T-07]
requirements: [RF-056, RF-057, RF-058, RF-059, RF-060]
depends_on: [001-ingestao-tse]
# 🔴 A spec 012 saiu daqui em 18/09 (cortada pelo dono, e o par formava ciclo);
# a 013 saiu porque só RF-058 depende dela, e RF-058 foi diferido. Ver ## Fatiamento.
apis: []
components: []
nfr: [RNF-009, RNF-010, RNF-011, RNF-012, RNF-031, RNF-032, RNF-033, RNF-034]
adrs: []
---

# Spec 010 — Operação e Monitoramento

> ## Fatiamento — 2026-09-18
>
> Esta spec entra em voo **parcial**. Os cinco RFs não são uma unidade: dois
> mandam mensagem, três dependem de tela ou de plataforma.
>
> | RF | Fatia | Onde |
> |---|---|---|
> | **RF-057** — alertas quando o lag passa de 60 s | ✅ **em voo** | [S08 — Enxergar](../../sprints/2026-S08-f7-enxergar.md) § 1 |
> | **RF-060** — cron desligável por env var | ✅ **em voo** | S08 (o interruptor já existe em `lib/tse/ingest-handler.ts:399`; falta o teste que prova o desligamento) |
> | **RF-056** — painel de saúde do pipeline | ⏸️ diferido | [S11](../../sprints/2026-S11-f7-resiliencia.md) — herdado da 012, que foi cortada |
> | **RF-058** — modo manutenção | ⏸️ diferido | S11, junto da [spec 013](../013-pagina-manutencao/spec.md) |
> | **RF-059** — rolling release com rollback | ⏸️ diferido | S11 |
>
> **Por que a divisão foi necessária**, e não é organização por gosto: o
> frontmatter declarava `depends_on: [001, 012, 013]`, e a **spec 012 foi
> cortada pelo dono** — `app/_status/` tem só um `.gitkeep`. Seguir a
> dependência ao pé da letra trancava o RF-057 atrás de uma tela que não vai
> existir. **Alerta não precisa de painel nenhum para mandar mensagem.**
>
> Havia também um **ciclo**: a 010 dependia da 012 e a 012 dependia da 010.
> Desfeito nos dois lados em 18/09.
>
> ⚠️ A fatia diferida é nomeada aqui **e** na S11, de propósito: a S08 registra
> o risco de RF-056/RF-058/RF-059 ficarem sem casa se a divisão não for escrita
> nos dois lugares.

## Objetivo

Garantir visibilidade operacional do pipeline em tempo real, alertas proativos quando algo derrapa, modo de manutenção amigável e capacidade de deploy/rollback rápido sem big-bang.

## Escopo

**In**:
- Dashboard interno `/_status` (ver [spec 012](../012-dashboard-status/)).
- Alertas Slack/email para anomalias.
- Página de manutenção (ver [spec 013](../013-pagina-manutencao/)).
- Rolling release com rollback rápido.
- Cron habilitável/desabilitável via env var.

**Out**:
- Métricas detalhadas (escopo [spec 012](../012-dashboard-status/)).
- Runbook detalhado ([operations/runbook.md](../../operations/runbook.md)).

## Requisitos Funcionais (EARS)

**RF-056 — Dashboard interno de saúde do pipeline**

WHEN um operador acessa `/_status` (autenticado), the system SHALL exibir métricas em tempo real (cache hit, lag TSE, taxa de erros, throughput de invalidações).

Ver [spec 012](../012-dashboard-status/spec.md).

**RF-057 — Alertas Slack/email se lag >60s**

WHILE a janela de apuração está ativa, IF `tse.lag_seconds > 60`, the system SHALL postar alerta em `#atlasmenna-ops`.

**RF-058 — Modo manutenção amigável**

IF todos os endpoints estiverem indisponíveis, the system SHALL servir página `/manutencao` com mensagem amigável e link para `resultados.tse.jus.br`.

Ver [spec 013](../013-pagina-manutencao/spec.md).

**RF-059 — Rolling release com rollback rápido**

WHEN um novo deploy é promovido para produção, the system SHALL usar Vercel Rolling Releases (canary 10/50/100%) com botão de rollback no dashboard.

**Aceitação**:
- Given canary 10% está ativo, when métricas pioram, then 1 click no dashboard reverte 100%.

**RF-060 — Cron habilitável via env var**

WHEN env var `CRON_ENABLED=false`, the system SHALL responder o handler do cron com no-op (200 OK sem fazer GETs no TSE).

## Requisitos Não-Funcionais aplicáveis

- Uptime 99,9% na janela ([RNF-009](../../nfr/availability.md)).
- Degradação <30s ([RNF-010](../../nfr/availability.md)).
- Observabilidade completa ([../../nfr/observability.md](../../nfr/observability.md)).

## Open questions

- Quem é PagerDuty de plantão na noite D? (definir antes de F6).
- Webhook de alerta tem fallback (SMS/Email) se Slack cair? (atual: apenas Slack).

## Cross-refs

- Design: [./design.md](./design.md)
- Spec dashboard `/_status`: [../012-dashboard-status/](../012-dashboard-status/)
- Spec manutenção: [../013-pagina-manutencao/](../013-pagina-manutencao/)
- Runbook: [../../operations/runbook.md](../../operations/runbook.md)
- Alertas: [../../operations/alerts.md](../../operations/alerts.md)
- Deployment: [../../operations/deployment.md](../../operations/deployment.md)
