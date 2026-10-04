---
id: ADR-0005
title: Templates de insights, não LLM
status: accepted
date: 2026-05-17
amended_by: [ADR-0072] # parcial: só a caixa "Análise" da home presidencial; critério de supersessão parcial na nota de 2026-09-05 do ADR-0017
---

# ADR-0005 — Templates de insights, não LLM

## Status

Superseded (parcialmente) por [ADR-0072](0072-leitura-da-noite-ia-e-imprensa.md) em 2026-10-04, apenas na caixa "Análise" da home presidencial; nas demais superfícies este ADR segue aceito e vigente.

## Contexto

A página precisa gerar 1–3 frases analíticas por estado/seção ("Disputa apertada em SP", "Lula consolida vitória em PE +18pp"). Opções:

1. **LLM** (GPT, Claude, Gemini): saída natural, flexível, mas custo por chamada, latência variável, risco de alucinação.
2. **Templates** com regras: determinístico, gratuito, sem risco.

Em uma janela de pico, 50–100 chamadas LLM por segundo por usuário multiplicam custo/latência. Risco de alucinação numa eleição é inaceitável.

## Decisão

Insights são gerados por **engine de templates** em `lib/insights/generate.ts` consumindo regras de `lib/insights/templates.json`. Cada regra tem condição (ex: `abs(swing_pp) >= 5`) e variantes de texto com placeholders.

## Consequências

**Positivas**:
- Custo zero, latência <1ms.
- Saída 100% determinística — auditável e testável.
- Sem risco de alucinação (constituição § 2 e § 6).

**Negativas**:
- Variabilidade limitada às variantes pré-escritas.
- Adicionar nova regra exige PR com QA editorial.

## Cross-refs

- Templates: [../../design-system/insights-templates.md](../../design-system/insights-templates.md)
- Constituição § 2 (neutralidade) e § 6 (determinismo): [../../constitution.md](../../constitution.md)
