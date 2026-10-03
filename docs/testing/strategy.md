---
title: Estratégia de Testes
description: Pirâmide de testes do AtlasMenna — unit, integração, e2e, replay, load, a11y, simulados TSE
status: stable
source: PRD.md § 20
---

# Estratégia de Testes

| Camada | Ferramenta | Onde |
|---|---|---|
| Unit | Vitest | [./unit.md](./unit.md) |
| Integration | Vitest + fixtures | [./integration.md](./integration.md) |
| E2E | Playwright | [./e2e.md](./e2e.md) |
| Replay 2022 | Script TS | [./replay.md](./replay.md) |
| Load | k6 | [./load.md](./load.md) |
| Acessibilidade | axe-core + Lighthouse | [./accessibility.md](./accessibility.md) |
| Simulados TSE | Participação oficial | [./tse-simulados.md](./tse-simulados.md) |

## Critério de "pronto para produção"

- ✅ Replay de 2022 com MAE <2pp em t=1h.
- ✅ Load test 30k VUs com p95 <200ms.
- ✅ Simulado oficial TSE executado com sucesso.
- ✅ Lighthouse a11y >95 em todas as páginas.
- ✅ Bug bash completo em desktop + mobile (iOS Safari, Chrome Android).

Ver checklist completo: [../operations/pre-prod-checklist.md](../operations/pre-prod-checklist.md).
