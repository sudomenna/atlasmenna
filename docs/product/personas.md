---
title: Personas
description: Personas-alvo do AtlasMenna e seus comportamentos esperados
status: stable
source: PRD.md § 4.1
---

# Personas

## P1 — Eleitor Engajado *(alvo primário, ~60% do tráfego)*

- 25–55 anos, votou consciente, acompanha política
- Quer mais profundidade que TV mas não é especialista
- Multi-screen: TV ligada + laptop/celular
- **Comportamento**: deixa a aba aberta por 1–3 horas, recarrega frequentemente

## P2 — Jornalista *(alvo secundário, ~5% do tráfego mas alto valor de alcance)*

- Repórter de portal/TV usando o produto como fonte
- Quer screenshots compartilháveis, drill-down rápido, dados defensáveis
- **Comportamento**: alta densidade de navegação por UFs, foco em swing vs 2022

## P3 — Analista Político / Cientista de Dados *(~3% do tráfego, alto LTV)*

- Acadêmico, consultor, marketing político
- Quer drill-down até zona eleitoral, exportar dados, ver modelo
- **Comportamento**: passa horas, navega por dezenas de UFs

## P4 — Curioso Ocasional *(~32% do tráfego)*

- Acessa via link compartilhado em WhatsApp
- Quer saber só "quem está ganhando" em 5 segundos
- **Comportamento**: olha a home, sai

---

## Como usar

Cada spec em `docs/specs/` lista quais personas ela serve no frontmatter `personas: [P1, P2, ...]`. Decisões de design ambíguas devem favorecer a persona primária da spec.
