---
id: 013-pagina-manutencao
type: design
title: Página de Manutenção — Design Técnico
status: draft
---

# Design — Página de Manutenção

## Arquitetura

- `app/manutencao/page.tsx` — Server Component estático, sem fetch.
- Não consome Edge Config (justamente para sobreviver à indisponibilidade dele).
- Conteúdo congelado no build.

## Trigger

`middleware.ts` detecta indisponibilidade do Edge Config (catch em probe leve no startup do request) e faz `NextResponse.rewrite('/manutencao')`.

Alternativa simpler: feature flag manual via env var `MAINTENANCE_MODE=true` controlada do dashboard `/_status`.

## Conteúdo

```
<h1>Estamos voltando logo</h1>
<p>O AtlasMenna está temporariamente indisponível.</p>
<p>Enquanto isso, você pode acompanhar a apuração diretamente em:</p>
<a href="https://resultados.tse.jus.br">resultados.tse.jus.br</a>
```

## Cross-refs

- Spec: [./spec.md](./spec.md)
- Spec operação (trigger): [../010-operacao-monitoramento/spec.md](../010-operacao-monitoramento/spec.md)
