---
id: ADR-0002
title: Polling com CDN cache, não SSE/WebSocket
status: accepted
date: 2026-05-17
amended_by: ADR-0074 # só o mecanismo de cliente para o conteúdo das páginas
---

# ADR-0002 — Polling com CDN cache, não SSE/WebSocket

## Status

Aceito.

> **Nota 2026-10-04 ([ADR-0074](0074-atualizacao-automatica-das-paginas-por-router-refresh.md)).** O
> "SWR poll a cada 5 s em `GET /api/projection`" decidido abaixo nunca foi montado em nenhuma página
> (`components/shared/swr-provider.tsx` não tem importadores); o mapa persistente busca
> `/api/projection` a cada 60 s por conta própria. Para o **conteúdo das páginas**, o mecanismo passa a
> ser `router.refresh()` a cada ~60 s, sem cache de CDN (as páginas são dinâmicas). A escolha de pull em
> vez de push, e o cache de CDN para `/api/projection`, permanecem.

## Contexto

Para atualizar 20k clientes com a projeção mais recente, duas famílias de soluções estão disponíveis:

1. **Push** (WebSocket, SSE): conexão persistente, servidor empurra deltas.
2. **Pull** (polling): cliente faz GET periódico em endpoint cacheável.

WebSocket é a opção "natural" para tempo real, mas:

- 20k conexões persistentes têm custo de compute não-trivial.
- Não cacheável na borda — cada conexão vai até a origem.
- Falhas de conexão precisam de lógica de reconexão custosa.

O dado muda a cada 15s no máximo. A janela útil de cache é grande.

## Decisão

Cliente faz **SWR poll a cada 5s** em `GET /api/projection`. Endpoint serve do **Edge Config** com `Cache-Control: public, s-maxage=5, stale-while-revalidate=30`.

## Consequências

**Positivas**:
- CDN absorve 99,8% das requests no pico.
- Sem conexões persistentes — escala horizontal trivial.
- Simplicidade operacional — só HTTP + cache.

**Negativas**:
- Latência mínima de 5s entre clientes (aceitável dado ciclo TSE de 15s).
- Tráfego desperdiçado em payloads idênticos — mitigado pelo cache.

## Cross-refs

- Cache strategy: [../apis-internas.md](../apis-internas.md)
- NFR de cache: [../../nfr/performance.md](../../nfr/performance.md)
