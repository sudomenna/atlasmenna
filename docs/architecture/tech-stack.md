---
title: Stack Tecnológica
description: Tabela canônica de tecnologias, versões e justificativas; dependências NPM principais
status: stable
source: PRD.md § 10
---

# Stack Tecnológica

## Tabela detalhada

| Componente | Tecnologia | Versão | Justificativa |
|---|---|---|---|
| Framework | Next.js | 16+ | App Router, Cache Components, SSR rápido, integração nativa Vercel |
| UI library | React | 19+ | Server Components estáveis, transições nativas |
| Runtime principal | Node.js (Fluid Compute) | 24 LTS | Padrão Vercel, single-instance multiplexing |
| Runtime modelo | Python (Fluid Compute) | 3.14 | NumPy/SciPy para bootstrap eficiente |
| Linguagem | TypeScript | 5.6+ | Type safety end-to-end |
| Styling | Tailwind CSS | 4.0+ | **S07 Bloco 0 ✓**: `@theme static { ... }` em `app/globals.css`; `tailwind.config.ts` removido (morto desde migração v3→v4) |
| Tipografia | next/font (Source Serif Pro + Inter) | latest | NYT-like via Google Fonts |
| Estado cliente | Zustand | 5+ | Mais leve que Redux, ideal para hover store |
| Fetcher cliente | SWR | 2+ | Polling, dedup, revalidação |
| Mapas | MapLibre GL JS | 5+ | Open-source, sem lock-in Mapbox |
| Mapa tiles | PMTiles | 4+ | Single-file vector tiles, range-requests |
| Tile converter | tippecanoe | latest | shapefile → PMTiles |
| Tipografia | next/font/google | latest | ⚠️ **S07 planejado**: Spectral 400/600 (display), Archivo 400/500/600 (corpo), JetBrains Mono 400/500 (números); substitui Source Serif Pro + Inter via Google Fonts com `@theme static` Tailwind v4 |
| Animações | CSS puro + `prefers-reduced-motion` | — | **S07 Bloco 0 ✓**: Framer Motion removido (zero imports reais); transições via Tailwind `transition-*` + global RNF-026 guard |
| Charts | Custom SVG | — | **S07 Bloco 0 ✓**: D3 removido (`d3-array`/`d3-scale`/`d3-shape`; zero imports reais) |
| DB | Neon Postgres (Marketplace) | 16+ | Serverless, branching, ramp gratuito |
| ORM | Drizzle | latest | Type-safe, mais leve que Prisma |
| Estado quente | Vercel Edge Config | latest | Replicado nos PoPs, <15ms; limite 512KB total (ADR-0001, emendado ADR-0026) |
| Storage objeto | Vercel Blob | latest | PMTiles, raw archives; ⚠️ **S07 planejado**: drill-down de UF de Deputado Federal (`deputado:uf:<sigla>.json`, exceção ao ADR-0001) |
| Cron | Vercel Cron | latest | Trigger do ingest em **três rotas**: `/api/ingest` (todos os cargos, manual/heartbeat), `/api/ingest/[cargo]` (Presidente e Governador a 60s; Senador a cada 5 min) e `/api/ingest/deputado-federal/<1..6>` (6 fatias intercaladas a cada 5 min — volta completa em 30 min, ADR-0036). Implementado, não mais "futura expansão" |
| Rate limit TSE | Python + Node.js | — | Teto **por cargo** em `lib/config/cargos.ts` (`rpsMax`): **25 rps** Presidente/Governador/Senador, **5 rps** Deputado Federal. Ceiling 50 por processo; pior caso agregado dos 4 crons 25+25+25+5 = **80 rps** < 100 documentado (ADR-0026 nota 11/09; ADR-0036). `TSE_MAX_RPS_DEFAULT` = 5 vale só para caller sem cargo |
| Config | `vercel.ts` | — | TS-typed, dynamic. ⚠️ **`@vercel/config` NÃO é dependência instalada** — decisão deliberada registrada em `vercel.ts:1-7`: o pacote não existe consolidado no npm; o projeto usa um shape literal validado por `pnpm typecheck` |
| MDX | `@next/mdx` | latest | Página `/sobre-o-modelo` |
| Validação | Zod | latest | Schema do TSE, payloads de API |
| Texto por LLM (caixa "Análise" da home) | `ai` (AI SDK) + Vercel AI Gateway | 7 | Claude Sonnet 5.5 (`anthropic/claude-sonnet-5.5`) escreve 2–4 frases, chamado **só** pelo cron `/api/internal/leitura-noite` (nunca por requisição de leitor) e importado só por `lib/leitura/ia.ts` — fora do bundle do leitor. `@ai-sdk/gateway` vem como dependência do próprio `ai`. Exceção escopada ao [ADR-0005](./adrs/0005-templates-nao-llm.md) e ao § 6 da constituição: [ADR-0072](./adrs/0072-leitura-da-noite-ia-e-imprensa.md) |
| Testes unit | Vitest | latest | Mais rápido que Jest |
| Testes e2e | Playwright | latest | Browser real |
| Load test | k6 | latest | 20k VUs simulados |
| Lint/Format | Biome | latest | Substitui ESLint + Prettier (mais rápido) |
| CI/CD | Vercel + GitHub Actions | — | Preview deployments por PR |
| Observabilidade | Vercel Analytics + Speed Insights | latest | Core Web Vitals automáticos. ⚠️ **`@vercel/analytics` e `@vercel/speed-insights` NÃO estão instalados** (confira `package.json`) — gap contra a meta de [RNF-031](../nfr/observability.md), não decisão registrada. Pendência, não conserto de código aqui |
| Logs | Vercel Logs + structured JSON | — | Filtrable por correlation-id |
| Proteção | Vercel BotID | latest | Bot detection no edge |
| Pacote manager | pnpm | 9+ | Workspaces, deduplicação |

## Dependências NPM (principais)

```jsonc
{
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@vercel/edge-config": "^2.0.0",
    "@vercel/blob": "^2.0.0",
    // @vercel/analytics, @vercel/speed-insights: NÃO instalados — gap contra RNF-031, não decisão
    // @vercel/config: NÃO instalado por decisão deliberada — pacote não existe consolidado no npm; ver vercel.ts:1-7
    "drizzle-orm": "^0.40.0",
    "@neondatabase/serverless": "^1.0.0",
    "zustand": "^5.0.0",
    "swr": "^2.4.0",
    "maplibre-gl": "^5.0.0",
    "pmtiles": "^4.0.0",
    "zod": "^4.0.0",
    "@next/mdx": "^16.0.0",
    "ai": "^7.0.0" // AI SDK v7 + AI Gateway (@ai-sdk/gateway vem com ele); só lib/leitura/ia.ts importa — ADR-0072
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@biomejs/biome": "^2.0.0",
    "vitest": "^3.0.0",
    "@playwright/test": "^1.50.0",
    "tailwindcss": "^4.0.0"
  }
}
```

## Notas sobre bundle size

A stack inclui a biblioteca pesada **MapLibre GL** (~200KB gzipped). Para respeitar [RNF-007a](../nfr/performance.md) (bundle above-the-fold <150KB):

- **MapLibre** carrega via `next/dynamic({ ssr: false })` após first paint — ver [ADR-0010](./adrs/0010-mapa-dynamic-import.md).
- **Framer Motion** foi removida em S07 Bloco 0 (zero imports reais). Animações agora usam CSS puro com transições Tailwind.
- **D3** foi removida em S07 Bloco 0 (zero imports reais). Charts continuam como SVG customizado.
- **PMTiles client** acompanha MapLibre no chunk lazy.

## Notas sobre ingestão e modelo

**Unidade de ingestão**: par `(UF, município, zona)` em vez de zona sozinha (ADR-0035 D1). O TSE **declara 6.083** arquivos EA20 de zona por cargo (`tse_docs/txt/apresentacao-interessados-2026.txt:195-200`); nossa lista de alvos tem **6.110**, porque **6.085 vêm do CSV de eleitorado 2024** e **25 vêm do histórico de 2022** (19 do DF, que não aparece num CSV de pleito municipal, mais 5 do PI e 1 de SP). O 6.085º entrou em 11/09 com a migration 0007: Boa Esperança do Norte (MT) foi instalado em 01/01/2025 e não existia na malha IBGE de 2022, então a FK de `zonas` barrava o par e os 4.243 eleitores dele ficavam fora dos alvos. Esses 25 são inferência, não publicação confirmada do TSE: se algum par não existir em 2026, vira 404 — tolerado pelo pipeline, mas 404 conta no orçamento de requisições do TSE. O EA12 (`--ea12` em `zonas-import.ts`) elimina a inferência assim que existir, porque aí a lista vem do próprio TSE. `maxDuration` dos handlers `/api/ingest` e `/api/ingest/[cargo]` é **300 segundos** para acomodar o fan-out maior (~6.100 GETs por cargo a 40 rps ≈ 153 s).

**Agregação**: `api/model/zona_merge.py` soma pares de volta em zona **em memória**, antes de alimentar o estimador (ADR-0035 D2). O modelo continua operando por zona (ADR-0021/0023 intactos). Totais municipais são suma exata dos pares, sem rateio.

**Concorrência de cargo**: o lock anti-overlap de `/api/ingest` agora é **por cargo** — Presidente e Governador podem ingerir simultaneamente em processes isolados (Fluid Compute), cada um com seu próprio rate limiter singleton (40 rps default; teto 50). Pior caso agregado: 2×40=80 rps < 100 rps (teto TSE).

## Notas sobre dependências transitivas

A `@neondatabase/serverless` depende de `ws` para suporte a WebSocket em runtimes sem objeto `WebSocket` global (ex: scripts Node puro em `data-pipeline/`). Esta é uma dependência **transitiva** (não listada explicitamente) mas essencial — não constitui violação da stack (não é dep adicional fora do padrão Vercel).

## Cross-refs

- ADRs que justificam decisões-chave: [./adrs/](./adrs/)
- Princípio "stack 100% Vercel": [../constitution.md](../constitution.md#9-stack-100-vercel)
- Orçamento de bundle refinado: [../nfr/performance.md](../nfr/performance.md)
- Texto por LLM na caixa "Análise" da home (`ai` + AI Gateway): [ADR-0072](./adrs/0072-leitura-da-noite-ia-e-imprensa.md)
