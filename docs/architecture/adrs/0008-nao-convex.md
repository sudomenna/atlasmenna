---
id: ADR-0008
title: NÃO usar Convex como banco
status: accepted
date: 2026-05-17
---

# ADR-0008 — NÃO usar Convex como banco

## Status

Aceito.

## Contexto

Convex é uma plataforma de dados reativa que oferece sync automático via WebSocket. Atraente para apps colaborativos em tempo real.

Para AtlasMenna o caso é diferente: **broadcast read-heavy**. Todos os 20k clientes leem o mesmo payload pequeno, atualizado a cada 15s. Não há colaboração, não há writes por cliente.

WebSocket por cliente seria anti-padrão (ver ADR-0002).

## Decisão

**Não usar Convex.** Usar **Vercel Edge Config** (estado quente broadcast) + **Neon Postgres** (write path + histórico).

## Consequências

**Positivas**:
- Stack 100% Vercel (princípio constitucional § 9).
- Sem WebSocket overhead.
- Modelo de custo previsível.

**Negativas**:
- Perde-se sync reativo automático — substituído por polling SWR (que é mais barato no nosso caso).

## Cross-refs

- ADR-0001 Edge Config: [./0001-edge-config-no-read-path.md](./0001-edge-config-no-read-path.md)
- ADR-0002 Polling: [./0002-polling-cdn-cache.md](./0002-polling-cdn-cache.md)
