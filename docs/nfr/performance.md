---
title: NFR — Performance
description: Metas de performance percebida (LCP, INP, latência API, cache hit, defasagem TSE, bundle size)
status: stable
source: PRD.md § 6.1
---

# Performance

| ID | Descrição | Meta |
|---|---|---|
| RNF-001 | Acessos simultâneos sustentados | 20.000+ |
| RNF-002 | LCP (Largest Contentful Paint) p95 global | <2.5s |
| RNF-003 | INP (Interaction to Next Paint) p95 | <200ms |
| RNF-004 | Latência do endpoint `/api/projection` p95 | <100ms |
| RNF-005 | Cache hit ratio na CDN no pico | >99% |
| RNF-006 | Defasagem TSE → tela do usuário | <90s ([ADR-0011](../architecture/adrs/0011-cadencia-60s.md)) — verificável em tempo real via `dado_ts` do payload ([ADR-0038 D1](../architecture/adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md)) |
| RNF-007a | Bundle JS above-the-fold **de aplicação** (total medido − piso de framework) | <150KB gzipped |
| RNF-007a-floor | Piso de framework above-the-fold (React + runtime Next + runtime do bundler) | informacional — 153.482 B em 2026-09-07 |
| RNF-007b | Bundle JS do chunk do mapa (MapLibre + PMTiles client + componente) | <300KB gzipped |
| RNF-007c | Bundle JS total da home (above-the-fold + chunks lazy) | <500KB gzipped |
| RNF-008 | Tempo de renderização do mapa inicial (após first paint) | <1.5s |

### Teto do documento HTML — global e exceção nomeada

O portão de peso do documento (`tests/e2e/perf-budget.spec.ts`) mede o corpo do HTML de cada rota
(markup + payload RSC embutido) contra um **teto global de 300 KiB** (`BUDGET_DOCUMENT_BYTES`). O
teto global **não muda** por rota: uma rota que precise de mais ganha uma **exceção nomeada**, com
decisão registrada em ADR, e ela vale só para aquela rota (`TETO_DOCUMENTO_POR_ROTA`).

| Rota | Teto do documento | Por quê | Decisão |
|---|---|---|---|
| *(todas as demais)* | **300 KiB** | teto global; `/`, a maior, mediu 212,2 KiB em 21/09 | o próprio spec de peso (`BUDGET_DOCUMENT_BYTES`, com a medição e o porquê de não apertar) |
| `/uf/SP/deputado-federal`, `/uf/RJ/deputado-federal`, `/uf/MG/deputado-federal` | **576 KiB** | páginas de UF de Deputado com até 60 candidatos por agremiação no documento (listas em três faixas); medido **com o Blob servido** (`build:e2e`/`start:e2e`) e a fixture do simulado em 30/09, antes dos cortes do dia: SP 520,5 · RJ 442,8 · MG 441,2 KiB. SP mediu 544,9 KiB em 03/10 (com fotos). Em 04/10, o voto projetado por candidatura nos "eleitos + 7" (spec 026 RF-297) somou, sobre a fixture: SP +13.598 B (218 linhas) · RJ +11.532 B · MG +11.628 B, mais ~1 KB de payload RSC — SP estimado em ~559,2 KiB, a 0,8 KiB dos 560 | [ADR-0065](../architecture/adrs/0065-listas-proporcionais-em-tres-faixas.md) D5 + emenda de 30/09 (decisão do dono); 560 → 576 KiB em 04/10 (decisão do dono: "eleitos + 7"; emenda do ADR-0063 D1) |
| `/deputado-federal` (capa) | **368 KiB** | hemiciclo de 513 cadeiras, mais votados do país, puxadores e selo por UF; mediu 307,8 KiB em 30/09 (teto 320). Em 03/10: 313,2 KiB sem bandeiras, 321,3 KiB com as 27 bandeiras da grade (+8,1 KiB cru, +586 B comprimido) | [ADR-0065](../architecture/adrs/0065-listas-proporcionais-em-tres-faixas.md), emenda de 30/09; 320 → 336 KiB em 03/10 pelo [ADR-0070](../architecture/adrs/0070-bandeiras-de-uf-em-webp-same-origin-no-lugar-do-sprite-svg-inline.md) (decisão do dono); 336 → 344 KiB em 03/10 à noite (emenda 2 do ADR-0070, realce do plenário RF-294); 344 → 368 KiB em 04/10 (decisão do dono: avatares na capa — 621 B por avatar em produção, HTML + RSC; 20 avatares na fixture ⇒ ~347,2 KiB, 40 no pior caso da noite ⇒ ~359,3 KiB; `build:e2e` de 04/10 mediu 356.255 B / 347,9 KiB) |
| `/deputado-estadual` (capa) | **312 KiB** | soma das 27 assembleias: bancada, mais votados, puxadores, casa a casa. Mediu 285.005 B antes dos avatares | 300 → 312 KiB em 04/10 (decisão do dono: avatares na capa; a fixture já tem o pior caso, 40 avatares; `build:e2e` mediu 309.047 B / 301,8 KiB) |

⚠️ **As demais UFs de Deputado Federal NÃO estão no portão.** Até 30/09 este parágrafo dizia que elas
"ficam no teto global" — era falso: só SP era medida, e RJ e MG passavam 45% dos 300 KiB globais. O
portão mede as três maiores (SP, RJ, MG); as outras medem menos que elas (RS 360, BA 353, PR 332, PE 321
KiB em 30/09 — todas **acima** do global, abaixo dos 560, hoje 576) e ficam cobertas por construção, não por
asserção. O teto de 480 KiB de 29/09 era escolha, não medida, e SP o passava em 8%; os 560 KiB vieram
da medição. Rever o número é por ADR, não por edição do spec de peso. RNF-002 (LCP) continua sendo a
métrica de autoridade; o teto de bytes é proxy.

## Como atingir

- Edge Config como read store ([ADR-0001](../architecture/adrs/0001-edge-config-no-read-path.md))
- Polling com CDN cache ([ADR-0002](../architecture/adrs/0002-polling-cdn-cache.md))
- PMTiles para mapas ([ADR-0003](../architecture/adrs/0003-pmtiles-nao-geojson.md))
- **Mapa via `next/dynamic({ ssr: false })`** — carrega após first paint ([ADR-0010](../architecture/adrs/0010-mapa-dynamic-import.md))
- Bundle splitting via App Router server components
- Above-the-fold da home: header, headline (placar), agulha SVG estática (skeleton) — sem MapLibre, sem Framer Motion pesado
- Mapa, animações de spring e charts D3 ficam em chunks separados

## Nota sobre o orçamento de bundle

> **Revisão 2026-09-08 (constituição 1.4, [ADR-0030](../architecture/adrs/0030-orcamento-above-the-fold-piso-framework-vs-aplicacao.md)).**
> O RNF-007a mudou de **escopo**, não de valor. A medição do build de produção em 2026-09-07 mostrou
> que o teto de 150KB tinha virado o piso do framework: dos **153.482 bytes** que a home baixa acima da
> dobra em 8 requests, **71.080 são o React DOM** e o resto é runtime do Next e do bundler — e
> `/sobre-o-modelo`, a rota mais simples do site (sem mapa, sem polling), baixa exatamente o mesmo tanto.
> Sobravam 118 bytes para todo o código de aplicação.
>
> Agora o gate mede **total menos piso**: o piso é uma constante registrada (o maior valor observado,
> 153.482 B), recalibrada só quando Next ou React sobem de versão major — nunca por PR. O RNF-007b subiu
> de 250KB para 300KB, formalizando o débito do chunk do MapLibre aberto desde a S04 (medido em ~287KB).
> **RNF-002 (LCP p95 < 2,5s) continua sendo a métrica de autoridade**; bytes são proxy.
>
> A medição canônica está em `tests/e2e/perf-budget.spec.ts`, que roda com Playwright contra o build de
> produção e soma `responseBodySize` dos scripts até o evento `load`.


O RNF-007 foi refinado em 2026-05-17 após audit: a meta original "<150KB total" era matematicamente inalcançável incluindo MapLibre (~200KB gzipped sozinho). A nova estrutura distingue:

- **RNF-007a (above-the-fold)** — bloqueia o LCP. Estrita.
- **RNF-007b (mapa)** — carregado sob demanda, não bloqueia LCP. Mais folgada mas ainda monitorada.
- **RNF-007c (total)** — soma do que o usuário acaba baixando na home completa.

`Lighthouse` mede o above-the-fold; CI lint deve falhar quando RNF-007a > 150KB. Análise por bundle-analyzer cobre RNF-007b/c.

### ⚠️ Como medir RNF-007a sem inflar o número (2026-09-05)

**Não some ingenuamente todo `<script src>` do HTML.** O Next.js emite um chunk de polyfills legados
com o atributo `nomodule` — 112.594 bytes raw / **39.373 bytes gz**, byte a byte idêntico a
`node_modules/next/dist/build/polyfills/polyfill-nomodule.js`. Qualquer navegador que entenda
`<script type="module">` **ignora esse arquivo e nem faz o request**, então ele não custa nada a
usuário real algum — mas entra na soma e infla a métrica em ~39KB.

Foi exatamente isso que fez o above-the-fold "medir" 191,6KB e parecer 42KB acima da meta. Descontando
o chunk `nomodule`, o custo real é de **~148,7 KiB em 8 requests** — ou seja, **dentro da meta**, com o
resultado dependendo de arredondamento (KB decimal vs. KiB) e do nível de compressão do medidor.

Composição real dos 8 chunks que o navegador de fato baixa:

| Bucket | gz |
|---|---|
| React 19 DOM runtime | 70,85 KB |
| React core + Scheduler + Flight (RSC) | 38,48 KB |
| App Router client runtime (4 chunks) | 36,69 KB |
| Turbopack module runtime | 4,16 KB |
| Glue/misc | 1,45 KB |

Nenhum dos chunks contém `framer-motion`, `zustand`, `swr`, `zod`, `maplibre` ou `d3-*` — o código do
app não vazou para o above-the-fold; o que resta é overhead de framework.

**Antes de virar gate de CI**, a régua precisa filtrar `noModule`. O caminho mais robusto é capturar os
requests reais via Playwright (`page.on("response")` com `resourceType === "script"`), porque o próprio
navegador aplica a semântica de `nomodule` e elimina essa classe de erro sem depender de regex de HTML.

## Validação

- Load test 30k VUs: [../testing/load.md](../testing/load.md)
- Core Web Vitals: Vercel Speed Insights em produção
- Lighthouse CI em cada PR
- Bundle analyzer no CI (`ANALYZE=true pnpm build`) com gate de tamanho por chunk

## Validação

- Load test 30k VUs: [../testing/load.md](../testing/load.md)
- Core Web Vitals: Vercel Speed Insights em produção
- Lighthouse CI em cada PR

## Cross-refs

- Constituição § 3 (performance): [../constitution.md](../constitution.md#3-performance-percebida)
