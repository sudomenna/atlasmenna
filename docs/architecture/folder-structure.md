---
title: Estrutura de Pastas
description: Árvore canônica do repositório atlasmenna/ com responsabilidades por diretório
status: stable
source: PRD.md § 9.4
---

# Estrutura de Pastas

```
atlasmenna/
├── vercel.ts                              # config TS (crons, rewrites, regions)
├── next.config.ts
├── tailwind.config.ts
├── package.json
├── app/
│   ├── layout.tsx                         # shell global
│   ├── page.tsx                           # / (Home Nacional)
│   ├── globals.css
│   ├── governador/page.tsx
│   ├── uf/[sigla]/page.tsx
│   ├── uf/[sigla]/governador/page.tsx
│   ├── uf/[sigla]/municipio/[ibge]/page.tsx
│   ├── sobre-o-modelo/page.mdx
│   ├── sobre-as-etiquetas/page.tsx             # spec 025: metodologia das etiquetas editoriais
│   ├── _status/page.tsx                   # interno, auth
│   ├── manutencao/page.tsx
│   ├── opengraph-image.tsx                # OG dinâmica
│   └── api/
│       ├── projection/route.ts            # leitura pública
│       ├── ingest/route.ts                # cron-only
│       └── model/project.py               # Python — modelo
├── components/
│   ├── atoms/
│   │   ├── needle/Needle.tsx
│   │   ├── bars/ConfidenceBar.tsx
│   │   ├── charts/{DotPlotRange,TimeSeriesChart,ProbabilityOverTime,TurnoutAreaChart,ModelComposition}.tsx
│   │   ├── maps/{ChoroplethMap,BubbleMap,SwingArrowMap}.tsx
│   │   ├── tables/CandidateRow.tsx
│   │   └── banners/WinnerBanner.tsx
│   ├── blocks/
│   │   ├── NationalNeedle.tsx
│   │   ├── DecisiveUFsGrid.tsx
│   │   ├── UFForecastTable.tsx
│   │   ├── UFMapDuo.tsx
│   │   ├── MunicipioTable.tsx
│   │   ├── ForecastTransparency.tsx
│   │   └── InsightCard.tsx
│   ├── layout/{Header,Footer,LiveBadge,Tabs}.tsx
│   └── shared/{HoverTooltip,BottomSheet}.tsx
├── editorial/
│   ├── etiquetas/                             # spec 024: CSVs editadas à mão (candidatos, partidos, senadores)
│   ├── senado/                                # spec 023: foto do Senado 2027 (27 mandatos até 2031) por UF
│   ├── derivados/                             # spec 024: trajetória e alinhamento por cargo, compilados
│   ├── README.md                              # guia leigo para preencher CSVs
│   └── etiquetas/publicar.json                # spec 025: chaves de visão editorial (v1..v4, camara2027)
├── lib/
│   ├── tse/{client,ea20-parser,cdn-urls,ea-config}.ts
│   ├── model/{swing,bootstrap,project,types}.ts (+ project.py)
│   ├── edge-config/{keys,reader,writer,types}.ts
│   ├── blob/{paths,uf-detail,write}.ts     # Vercel Blob — ADR-0026/0032
│   ├── db/{schema.sql,queries.ts,migrations/}
│   ├── state/hover-store.ts
│   ├── geo/{municipios.pmtiles,ufs.pmtiles,index.ts}
│   ├── insights/{templates.json,generate.ts}
│   ├── etiquetas/{catalogo,leitor,portao}.ts       # spec 024: definição, leitura, cobertura de etiquetas editoriais
│   ├── data/
│   │   └── etiquetas/{compilado,publicado,publicar}.ts  # spec 024: tipos e funções para dados compilados/publicados
│   ├── senado/{foto-2027,composicao-vagas}.ts      # spec 023: foto dos 27 mandatos, derivação das 54 vagas
│   └── utils/{format,colors,a11y}.ts
├── middleware.ts                          # rate limit + BotID
├── data-pipeline/
│   ├── historical-import.ts               # importa TSE 2022
│   ├── eleitorado-import.ts
│   ├── ibge-import.ts                     # municípios shapefile → PMTiles
│   ├── etiquetas-compilar.ts              # spec 024: valida e compila CSVs → JSON
│   ├── etiquetas-publicar.ts              # spec 024: publica etiquetas compiladas no Blob
│   ├── trajetoria-camara.ts               # spec 024: extrai trajetória de candidatos ao Deputado (reeleição, volta, estreante)
│   ├── trajetoria-senado.ts               # spec 024: extrai trajetória de candidatos ao Senador
│   ├── alinhamento-senado.ts              # spec 024: calcula alinhamento (base/oposição) pela votação do Senado (quando existir)
│   ├── senado-mandatos-snapshot.ts        # spec 023: consulta API do Senado Federal e grava foto dos 27 mandatos até 2031
│   └── README.md
├── scripts/
│   ├── replay-2022.ts
│   ├── load-test.k6.js
│   └── tse-simulator.ts                   # testa pipeline offline
├── tests/
│   ├── unit/{tse,model,insights}/
│   ├── integration/{ingest,projection}/
│   └── e2e/{home,uf,brushing}.spec.ts
└── public/
    ├── og-static.png
    └── favicon.ico
```

## Princípios

- **`app/`** segue convenção do Next.js App Router; rotas são pastas.
- **`components/`** dividido em `atoms` (primitivos visuais), `blocks` (composições de domínio), `layout`, `shared`.
- **`lib/`** concentra lógica não-React: TSE client, modelo, Global Config, Blob, DB, state global.
- **`lib/blob/`** é o ponto único de caminho, URL, escrita e leitura no Vercel Blob — o segundo mecanismo do read path (ADR-0026 para Deputado Federal, ADR-0032 para o detalhe municipal e as séries por UF). Fica fora de `lib/edge-config/` de propósito: é outro produto de armazenamento, com outro modo de falha, e nomeá-lo pelo mecanismo errado convidaria a uma segunda implementação ad hoc — exatamente o que o ADR-0032 proíbe.
- **`data-pipeline/`** scripts one-shot rodados fora do request path (import histórico, geração PMTiles).
- **`scripts/`** automações (replay, load test, simulador TSE).
- **`tests/`** mirror da estrutura de `lib/` + e2e por rota.

## Cross-refs

- Mapeamento componente → RF: [../design-system/components.md](../design-system/components.md)
- Stack e versões: [./tech-stack.md](./tech-stack.md)
