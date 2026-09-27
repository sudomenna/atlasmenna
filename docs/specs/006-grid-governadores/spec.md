---
id: 006-grid-governadores
title: Grid Nacional Governadores (T-02)
status: shipped
shipped_date: 2026-05-18
priority: M
personas: [P1, P2, P3]
screens: [T-02]
requirements: [RF-021, RF-022, RF-025, RF-027, RF-029, RF-006.1, RF-006.2, RF-006.3, RF-006.4, RF-006.5, RF-062, RF-063, RF-189, RF-191]
depends_on: [001-ingestao-tse, 002-modelo-estatistico, 005-pagina-uf-governador]
apis: [GET /api/projection?cargo=governador]
components: [GovernorCard, HexCartogramBrasil, RaceStatsCards, BreakingNewsTicker, LiveBadge, Tabs, ProjectionThermometer, ProjectionThermometers, TrilhaKicker, RaceHeader]
nfr: [RNF-001, RNF-002, RNF-003, RNF-022, RNF-023, RNF-024]
adrs: [0001, 0002, 0010, 0011, 0012, 0013, 0017, 0018, 0019, 0022, 0025, 0034, 0038, 0048]
---

# Spec 006 — Grid Nacional Governadores

**Rota**: `/governador`

## Objetivo

Mostrar status de todas as 27 corridas estaduais de governador em uma única tela — com layout NYT-style (cartograma hexagonal, cards individuais, stats sumarizadas, breaking news ticker).

## Escopo

**In**:
- Grid de 27 cards `<GovernorCard />` (um por UF) — layout opção (b): líder + top-3 compacto + chip de status.
- `<HexCartogramBrasil />` — visão alternativa SVG inline (sem MapLibre — preserva bundle).
- `<RaceStatsCards />` — 3 cards (eleitos no 1T / em 2T / em apuração).
- `<BreakingNewsTicker />` — chamadas recentes (rotação 5s, respeita prefers-reduced-motion).
- Filtros server-side via search params (`Todas | Em disputa | Decididos 1T | Vão a 2T | Chamadas`).
- Tabs cargo: `Presidente | Governador (active) | Senado | Congresso | Assembleias` — últimas 3 grayed-out + tooltip "Disponível em breve".

**Out**:
- Drill-down por UF (escopo [spec 005](../005-pagina-uf-governador/)).
- Senado, Congresso, Assembleias (pós-D1).

## Wireframe (desktop)

```
┌──────────────────────────────────────────────────────────────────┐
│ [Breaking news ticker] AGORA · 17:25 · SP chamada para Tarcísio  │
├──────────────────────────────────────────────────────────────────┤
│ Governadores 2026                                  [AO VIVO]     │
│ 27 corridas estaduais — apuração em tempo real.                  │
├──────────────────────────────────────────────────────────────────┤
│ [Presidente] [Governador] [Senado*] [Congresso*] [Assembleias*]  │
├──────────────────────────────────────────────────────────────────┤
│ ┌───────────┐ ┌───────────┐ ┌───────────┐                        │
│ │ Eleitos   │ │ Em 2T     │ │ Em apur.  │                        │
│ │     9     │ │    14     │ │     4     │                        │
│ └───────────┘ └───────────┘ └───────────┘                        │
├──────────────────────────────────────────────────────────────────┤
│ Mapa hexagonal — visão por líder                                 │
│ [SVG: 27 hex pintados por bucket/líder]                          │
├──────────────────────────────────────────────────────────────────┤
│ Filtros: [Todas] [Em disputa] [Decididos] [Vão 2T] [Chamadas]    │
│ 27 corridas — todas.                                             │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ │
│ │ São Paulo   │ │ Minas Gerais│ │ Rio Janeiro │ │ Bahia       │ │
│ │ Tarcísio    │ │ Zema   ELE  │ │ Castro 2T   │ │ Costa  ELE  │ │
│ │ Boulos      │ │ Pacheco     │ │ Freixo      │ │ Neto        │ │
│ │ Outros      │ │ Outros      │ │ Outros      │ │ Outros      │ │
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

## Requisitos Funcionais (EARS)

Aplicam-se subsets dos RFs já definidos:

**RF-021 (agulha por UF)** — substituída por `<GovernorCard />` que mostra top-3 candidatos + chip de status (não há agulha individual no grid — view hex cartogram cobre o resumo visual).
**RF-022 (votos absolutos)** — exibidos no `<GovernorCard />` via barra colorida + pct.
**RF-025 (tabela de UFs)** — substituída por grid de cards.
**RF-027 (atualização live)** — ISR `revalidate = 60` (ADR-0011).
**RF-029 (tabs cargo)** — alterna entre `/` e `/governador`; outros cargos grayed-out.

### RFs específicos desta tela

**RF-006.1 — Header com contagem via RaceStatsCards**

WHEN a página renderiza, the system SHALL exibir `<RaceStatsCards />` com counts `{eleitos, segundo_turno, em_apuracao}` agregando `EdgeUfRow.bucket` das 27 UFs.

**RF-006.2 — Filtros por status (server-side)**

WHEN o usuário clica em um filtro, the system SHALL navegar para `/governador?status=<filtro>` e re-renderizar com `por_uf` filtrado por bucket. Filtros: `todas | em_disputa | decididos_1t | vai_2t | chamadas`. WHEN filtro inválido na URL, the system SHALL coalescer para `todas`.

**RF-006.3 — Mapa coroplético nacional por líder de UF (adoção do ADR-0048)**

WHEN há ao menos 1 UF no payload, the system SHALL renderizar um mapa coroplético nacional (MapLibre + PMTiles, variant `frame`, cargo `gov`) com cada UF pintada pela cor do partido do líder projetado naquela UF. UFs com `bucket === "indefinido"` recebem cinza neutro.

> **Histórico**: de 2026-05-18 até 2026-09-18, este RF normatizava `<HexCartogramBrasil />` SVG inline pintado por `colorForRank()` — um rank 1 igual em todos os estados, resultando em cores que comunicavam posição na paleta local, não partido real. O [ADR-0048](../../architecture/adrs/0048-coropletico-substitui-cartograma-governador-estreia-senador.md) (2026-09-18) substitui o cartograma pelo coroplético que já cobria Presidente, pagando a dívida do [ADR-0024](../../architecture/adrs/0024-paleta-editorial-por-partido.md) de 11 dias antes. `<HexCartogramBrasil />` permanece no repositório, sem uso nesta rota, preservado por decisão explícita do dono.

**RF-006.4 — Breaking news ticker (broadcast)**

WHEN `national.chamadas_recentes?.length > 0`, the system SHALL renderizar `<BreakingNewsTicker />` no topo com rotação 5s. WHEN `prefers-reduced-motion: reduce`, the system SHALL empilhar todas as chamadas verticalmente sem rotação.

**RF-006.5 — Tabs cargo com cargos diferidos grayed-out**

WHEN renderizar tabs, the system SHALL incluir Senado / Congresso / Assembleias como tabs `disabled` com tooltip "Disponível em breve" e `aria-disabled="true"` (sinaliza roadmap sem esconder).

### Open question resolvida (kickoff S06)

> Mobile: grid 1-col em portrait, 2-col em landscape?

**Decisão**: 1 col `< 640px`, 2 cols `sm`, 3 cols `lg`, 4 cols `xl`. `<GovernorCard mode="compact">` degrada pra single-line `< 640px` (sigla + líder + chip). Sem dependência de orientation media query.

## Requisitos herdados da spec 003 (S07)

Decisão D7 (2026-09-05): `/governador` recebe **apenas a participação** do hero de 1º turno — **não** os seis termômetros. Aqui não existe uma corrida nacional de governador (existem 27 corridas estaduais), então um "top 3 nacional" não teria significado. RF-061 **não se aplica** a esta rota.

| RF | Aplicação em `/governador` |
|---|---|
| **RF-062** — participação e "Outros" | `<ProjectionThermometers variant="participacao-only" />` acima de `<RaceStatsCards />`, com heading "Participação do eleitorado" — 2 termômetros (brancos/nulos, abstenção). **Exceção a ADR-0017**: quando `national.participacao` está ausente o bloco é omitido inteiro, em vez de renderizar "aguardando" — um bloco vazio anunciaria uma projeção nacional que não existe nesta trilha. |
| **RF-063** — identidade de trilha | `<main data-trilha="gov">`, `<RaceHeader />` com kicker "GOVERNADOR · Brasil (27 UFs)" e aba `Governador` ativa em `--trilha-accent`. |
| **RF-061** — hero de seis termômetros | **Fora de escopo** nesta rota (ver acima). |

## Requisitos Não-Funcionais

Mesmos da home (performance + a11y). Bundle above-the-fold: respeita RNF-007a (sem MapLibre — só SVG inline pro cartogram e cards).

## Emendas por specs posteriores

### Spec 021 — Votação (2026-09-26)

O painel "Votação" (RF-192..199) **não entra** na tela nacional `/governador`. A tela renderiza a participação (RF-062) e a grade de 27 corridas estaduais (RF-145), sem painéis de "Votação" ou "A corrida". O painel "Votação" entra nas telas de UF `/uf/[sigla]/governador` conforme spec 021 RF-192 emendado.

### Spec 022 — A corrida em três círculos (2026-09-26)

O painel "A corrida" (RF-200..210) **não entra** na tela nacional `/governador`. Entra apenas nas telas de UF `/uf/[sigla]/governador`, imediatamente após o `<ResultPanel>` (e após o painel "Votação" quando presente).

## Cross-refs

- Design: [./design.md](./design.md)
- Spec UF Governador (drill-down): [../005-pagina-uf-governador/](../005-pagina-uf-governador/)
- Home Presidencial (modelo de tela espelho): [../003-home-nacional/](../003-home-nacional/)
- ADR-0011 (cadência ISR 60s): [../../architecture/adrs/0011-cadencia-60s.md](../../architecture/adrs/0011-cadencia-60s.md)
- ADR-0012 (chaves nomeadas): [../../architecture/adrs/0012-edge-config-chaves-nomeadas.md](../../architecture/adrs/0012-edge-config-chaves-nomeadas.md)
- ADR-0017 (transparência multi-camada): [../../architecture/adrs/0017-transparencia-total-3-camadas.md](../../architecture/adrs/0017-transparencia-total-3-camadas.md)
