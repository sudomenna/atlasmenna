---
id: 2026-S12
title: Sprint 12 — Pós-1T (análise + recalibração para 2T)
status: planned
start: 2026-10-05
end: 2026-10-14
phase: F8a
goal: Pós-mortem do 1T documentado + recalibração do modelo se MAE real divergiu do replay + plano de ajustes pra 2T
specs_in_flight: []
specs_planned_next: []
---

# Sprint 12 — Retro pós-1T

> ⚠️ **Renumerada em 2026-09-18**: esta sprint era a **S09**. As quatro sprints
> novas de prontidão para produção (S08–S11, ordenadas por dependência e sem data —
> decisão do dono D2) ocuparam a faixa S08–S11, e as duas sprints pós-eleição desceram
> para S12 e S13. O conteúdo não mudou; só o número e o nome do arquivo.

## Objetivo único

Aprender com o 1T e ajustar o que for necessário pra o 2T. Sem feature nova; só análise + recalibração.

## Foco

- **Pós-mortem completo do dia D1** — timeline de eventos, métricas reais, incidentes, lições.
- **Análise da projeção vs apuração final**: nossa projeção em t=1h, 2h, ... vs resultado oficial. Calcular MAE real por candidato e por UF.
- **Recalibração do modelo** se MAE divergiu significativamente do replay (>2pp em t=1h):
  - Investigar UFs com swing anômalo.
  - Atualizar `historical_results` com dados do 1T 2026 (passa a ser referência pra 2T).
  - Revisar tratamento de casos de borda (RF-017, RF-018).
- **Plano de ajustes pra 2T** — lista priorizada do que mudar.
- **Relatório público** comparando nossa projeção com apuração final (insumo de OP-4 — credibilidade).

## Chores

- [ ] Pós-mortem documentado (público interno; resumo executivo público)
- [ ] Dataset oficial do 1T 2026 carregado em `historical_results` (turno 1, ano 2026)
- [ ] Replay do pipeline contra dados reais do 1T — comparar com o que foi servido em real-time
- [ ] Recalibração modelo se necessário (delegar a `model-validator`)
- [ ] Sweep do Slack `#atlasmenna-ops` por aprendizados
- [ ] Atualizar runbook com aprendizados (incidentes encontrados, novas heurísticas)
- [ ] Comunicado público: "como nos saímos no 1T" (LinkedIn/X) — insumo OP-4

## Despachos sugeridos

- **`model-validator`** com input `--ano=2026 --turno=1` para validar a projeção contra o resultado oficial.
- **`spec-syncer`** atualiza `traceability.md` com referências ao pós-mortem.
- **`adr-author`** se a recalibração revelar decisão arquitetural nova (ex: ponderar bootstrap por eleitores aptos).

## Definition of Done

- ✅ Pós-mortem D1 publicado (interno + resumo externo)
- ✅ MAE real do 1T calculado e documentado
- ✅ Decisão registrada: modelo é mantido como está, ajustado, ou refeito para 2T
- ✅ `historical_results` com dados do 1T 2026
- ✅ Plano de ajustes pra S13 priorizado
- ✅ Comunicado público publicado

## Riscos da sprint

- **Modelo errou muito** — pressão pra refazer em 1.5 sprint. Se MAE > 5pp, considerar disclaimer mais forte no 2T em vez de retrabalho profundo.
- **Atribuição partidária 1T→2T** — alianças mudam entre turnos. Mapeamento histórico precisa ajuste.

## Replanejamentos mid-sprint

_(preencher se mudar)_

## Retrospective (preencher ao fechar)

- O que funcionou no D1:
- O que falhou no D1:
- Ajustes pra D2:

## Cross-refs

- Sprint anterior (marco): [_D1-04out2026.md](./_D1-04out2026.md)
- Próxima sprint: [2026-S13-f8b-prep2t.md](./2026-S13-f8b-prep2t.md)
- Validação do modelo: [../testing/replay.md](../testing/replay.md)
