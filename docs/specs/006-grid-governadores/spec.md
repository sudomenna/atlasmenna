---
id: 006-grid-governadores
title: Grid Nacional Governadores (T-02)
status: shipped
shipped_date: 2026-05-18
priority: M
personas: [P1, P2, P3]
screens: [T-02]
requirements: [RF-021, RF-022, RF-025, RF-027, RF-029, RF-006.1, RF-006.2, RF-006.3, RF-006.4, RF-006.5, RF-006.6, RF-006.7, RF-006.8, RF-063, RF-189, RF-191]
depends_on: [001-ingestao-tse, 002-modelo-estatistico, 005-pagina-uf-governador]
apis: [GET /api/projection?cargo=governador]
components: [GovernorCard, HexCartogramBrasil, RaceStatsCards, BreakingNewsTicker, LiveBadge, Tabs, TrilhaKicker, RaceHeader, GovernadoresPlacarTurno, GovernadoresPorPartido]
nfr: [RNF-001, RNF-002, RNF-003, RNF-022, RNF-023, RNF-024]
adrs: [0001, 0002, 0010, 0011, 0012, 0013, 0017, 0018, 0019, 0022, 0025, 0034, 0038, 0048, 0053]
---

# Spec 006 — Grid Nacional Governadores

**Rota**: `/governador`

## Objetivo

Mostrar status de todas as 27 corridas estaduais de governador em uma única tela — com layout NYT-style (cartograma hexagonal, cards individuais, stats sumarizadas, breaking news ticker).

## Escopo

**In**:
- Grid de 27 cards `<GovernorCard />` (um por UF) — layout opção (b): líder + top-3 compacto + chip de status.
- `<HexCartogramBrasil />` — visão alternativa SVG inline (sem MapLibre — preserva bundle).
- ~~`<RaceStatsCards />` — 3 cards (eleitos no 1T / em 2T / em apuração).~~ Saiu em 2026-09-09 (D23); substituído pelo painel "1º ou 2º turno" (RF-006.6/7/8, 2026-09-27).
- `<GovernadoresPlacarTurno />` + `<GovernadoresPorPartido />` — placar 1º × 2º turno e desfecho por partido, nas bases projeção e contagem (RF-006.6/7/8).
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

**RF-006.1 — Header com contagem via RaceStatsCards** — ⚠️ **SUBSTITUÍDO em 2026-09-27 por RF-006.6 + RF-006.8**

WHEN a página renderiza, the system SHALL exibir `<RaceStatsCards />` com counts `{eleitos, segundo_turno, em_apuracao}` agregando `EdgeUfRow.bucket` das 27 UFs.

> **Substituído.** O `<RaceStatsCards />` saiu da rota em 2026-09-09 (decisão D23, sem contraparte no protótipo) e o componente ficou sem call site. Além disso, a contagem que este RF descreve — agregar por `bucket` — tratava `bucket === "chamada"` como eleito, o que é falso: `chamada` é só margem grande, ortogonal ao turno (ver RF-006.8). A contagem por desfecho volta à tela pelo **RF-006.6**, com a regra do **RF-006.8**. O texto acima fica como registro histórico; nenhum código novo deve implementá-lo.

**RF-006.2 — Filtros por status (server-side)**

WHEN o usuário clica em um filtro, the system SHALL navegar para `/governador?status=<filtro>` e re-renderizar com `por_uf` filtrado por bucket. Filtros: `todas | em_disputa | decididos_1t | vai_2t | chamadas`. WHEN filtro inválido na URL, the system SHALL coalescer para `todas`.

**RF-006.3 — Mapa coroplético nacional por líder de UF (adoção do ADR-0048)**

WHEN há ao menos 1 UF no payload, the system SHALL renderizar um mapa coroplético nacional (MapLibre + PMTiles, variant `frame`, cargo `gov`) com cada UF pintada pela cor do partido do líder projetado naquela UF. UFs com `bucket === "indefinido"` recebem cinza neutro.

> **Histórico**: de 2026-05-18 até 2026-09-18, este RF normatizava `<HexCartogramBrasil />` SVG inline pintado por `colorForRank()` — um rank 1 igual em todos os estados, resultando em cores que comunicavam posição na paleta local, não partido real. O [ADR-0048](../../architecture/adrs/0048-coropletico-substitui-cartograma-governador-estreia-senador.md) (2026-09-18) substitui o cartograma pelo coroplético que já cobria Presidente, pagando a dívida do [ADR-0024](../../architecture/adrs/0024-paleta-editorial-por-partido.md) de 11 dias antes. `<HexCartogramBrasil />` permanece no repositório, sem uso nesta rota, preservado por decisão explícita do dono.

**RF-006.4 — Breaking news ticker (broadcast)**

WHEN `national.chamadas_recentes?.length > 0`, the system SHALL renderizar `<BreakingNewsTicker />` no topo com rotação 5s. WHEN `prefers-reduced-motion: reduce`, the system SHALL empilhar todas as chamadas verticalmente sem rotação.

**RF-006.5 — Tabs cargo com cargos diferidos grayed-out**

WHEN renderizar tabs, the system SHALL incluir Senado / Congresso / Assembleias como tabs `disabled` com tooltip "Disponível em breve" e `aria-disabled="true"` (sinaliza roadmap sem esconder).

**RF-006.6 — Placar 1º × 2º turno nas duas bases (2026-09-27, decisão do dono)**

WHILE a página está na fase normal do 1º turno (payload presente, `fase` ≠ `pre_eleicao`, `turno === 1`), the system SHALL exibir, entre o painel "Governadores 2026" e a grade "Corridas estaduais", um painel com DUAS leituras lado a lado — "Pela projeção" e "Se a apuração parasse agora" — e, em cada uma, a contagem das 27 UFs por desfecho (`eleito_1t`, `segundo_turno`, `em_aberto` só na projeção, `aguardando`) com a lista de siglas de cada grupo, segundo a regra do RF-006.8.

IF o payload está em fase pré-eleição, ausente, ou `turno === 2`, the system SHALL omitir o painel inteiro.

IF nenhuma das 27 UFs tem desfecho na base (todas `aguardando`), the system SHALL dizer isso em texto, sem imprimir contagens zeradas.

**Aceitação**:
- Given o simulado de `tests/fixtures/simulacao/governador.json`, when a página renderiza, then a coluna "Pela projeção" mostra 9 eleitos no 1º turno · 17 no 2º turno · 1 em aberto · 0 aguardando, e a coluna "Se a apuração parasse agora" mostra 10 · 17 · 0 aguardando (AL, com 52,04% apurado, fecharia).
- Given uma UF ausente de `por_uf`, when o placar renderiza, then ela aparece como "aguardando apuração" nas duas bases e o placar soma 27.
- Given a base "contagem", when o placar renderiza, then nenhum rótulo diz "eleito": o vocabulário é condicional ("fechariam no 1º turno", "iriam ao 2º turno").
- Given qualquer base, when o placar renderiza, then a faixa usa só tinta neutra com o mesmo código das barras por partido — cheio (`--text-primary`) = 1º turno, listrado = 2º turno, contorno para em aberto e tracejado para aguardando — nunca cor de partido nem verde/tijolo (decisão do dono 27/09: colidia com PL/PT logo abaixo), e cada sigla tem o nome do estado por extenso para leitor de tela.

**RF-006.7 — Desfecho por partido nas duas bases (2026-09-27, decisão do dono)**

WHILE o painel do RF-006.6 está visível, the system SHALL exibir, em cada uma das duas colunas, uma linha por partido com barra dividida — parte cheia = UFs em que o candidato do partido fecha no 1º turno; parte listrada na mesma cor = UFs em que o partido tem um dos dois candidatos do 2º turno — e o texto "N · E eleitos + T no 2º turno" (na contagem, "fechariam" no lugar de "eleitos").

Regras de soma: `eleito_1t` conta o partido do 1º colocado; `segundo_turno` conta os partidos dos DOIS primeiros **na mesma base** que classificou a UF; `em_aberto` e `aguardando` não contam. Ordem: total desc → eleitos desc → sigla (collation pt-BR). Partido ausente no payload vira a linha "Partido não informado". Cor por identidade (`colorForParty`, ADR-0024) com o contorno `DATA_FILL_STROKE` (RNF-035), escala fixa de 27 UFs nas duas colunas.

**Aceitação**:
- Given o simulado, when a coluna "Pela projeção" renderiza, then o topo é PT 11 (2 eleitos + 9 no 2º turno) e PL 10 (2 + 8), e a soma das linhas é 43 = 9 + 2 × 17.
- Given uma UF em 2º turno, when o gráfico renderiza, then a nota diz que cada estado em 2º turno conta dois candidatos.
- Given a sigla "REPUBLICANOS", when a linha renderiza, then a tela desenha "REP" e o leitor de tela recebe "REPUBLICANOS".

**RF-006.8 — Regra única de desfecho para selo, filtro e gráficos (2026-09-27)**

The system SHALL derivar o desfecho de cada UF de UM ponto só (`lib/utils/desfecho-governador.ts`), usado pelo selo do `<GovernorCard />`, pelos filtros por status do RF-006.2 e pelos gráficos dos RF-006.6/RF-006.7:

- **Pela projeção**: `eleito_1t` IF `vai_a_2t === false` E `bucket !== "indefinido"`; `segundo_turno` IF `vai_a_2t === true`; `em_aberto` nos demais casos (`vai_a_2t` nulo ou ausente, ou `false` com `indefinido`). `bucket === "chamada"` **não** implica eleito.
- **Pela contagem**: `aguardando` IF `pct_apurado === 0` ou IF falta `pct_atual` a qualquer candidato de `top_candidatos` (ausente ≠ 0); senão o líder é o primeiro na ordem da contagem (`ordenarTopCandidatosPorBase(…, "parcial")`, incluindo o candidato resgatado do RF-190) e o desfecho é `eleito_1t` IF `pct_atual > 50`, `segundo_turno` caso contrário.
- UF ausente de `por_uf` é `aguardando` nas duas bases.

Filtros: `decididos_1t` = `eleito_1t`; `vai_2t` = `segundo_turno`; `em_disputa` = todo desfecho diferente de `eleito_1t`; `chamadas` continua por `bucket === "chamada"`.

**Aceitação**:
- Given uma UF com `bucket: "chamada"` e `vai_a_2t: true`, when a página renderiza, then o selo diz "VAI A 2T" (nunca "● ELEITO"), a UF não entra em "Decididos no 1º turno", entra em "Vão a 2º turno" e em "Chamadas", e conta como 2º turno no placar e no gráfico por partido.
- Given o líder da contagem com `pct_atual` exatamente 50, when classificado, then vai ao 2º turno; com 50,01, fecharia no 1º.
- Given `pct_atual` ausente em algum candidato da UF, when classificado pela contagem, then a UF fica `aguardando`, nunca classificada como se o ausente fosse 0.

> ⚠️ `pct_atual` é fração de `v.vvc` (ADR-0018: válidos + anulados + anulados sub judice, o denominador do `pvap` do TSE), não de `v.vv`. Como `vvc ≥ vv`, `pct_atual > 50` implica maioria dos válidos: o erro possível da régua da contagem é só o conservador (não chamar de "fecharia" um líder que já passou de 50% dos válidos).
>
> ⚠️ **Nota 2026-09-27 ([ADR-0053](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md), RF-213 da spec 002).** `lider`, `chamada`, `vai_a_2t` e a base da regra de maioria absoluta do 1º turno já saem do modelo com toda candidatura de `dvt = "Anulado"` excluída — este RF-006.8 consome o campo pronto, sem lógica própria de exclusão. Candidatura `dvt = "Anulado sub judice"` continua contando normalmente (ponto aberto, pendente confirmação jurídica). ~~A lista de `top_candidatos` pode, portanto, mostrar uma candidatura anulada com seu percentual de `vvc` mesmo que ela nunca apareça como `lider` nem entre no placar de desfecho.~~
>
> 🔴 **EMENDADO em 2026-09-27 (tarde), decisão do dono, opção A ([ADR-0053, emenda](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md#emenda-2026-09-27-tarde-a-lista-passa-a-mostrar-a-base-da-disputa)).** A frase riscada acima deixa de valer: quando há candidatura `dvt = "Anulado"` na UF, `top_candidatos[i].pct_atual` de toda candidatura que compete passa a ser fração dos **votos em disputa** (`vvc − Σ votos das candidaturas anuladas`), não de `vvc` inteiro, e a candidatura anulada deixa de trazer `pct_atual` — só o total de votos, com etiqueta "Anulado". Isso muda também o limiar do RF-006.8 acima: "`pct_atual > 50`" continua correto, mas passa a ser maioria dos votos em disputa (que **inclui** sub judice, exclui só a anulada), não mais maioria de `vvc` inteiro. Sem candidatura anulada na UF — o caso hoje observado —, nada muda.

### Open question resolvida (kickoff S06)

> Mobile: grid 1-col em portrait, 2-col em landscape?

**Decisão**: 1 col `< 640px`, 2 cols `sm`, 3 cols `lg`, 4 cols `xl`. `<GovernorCard mode="compact">` degrada pra single-line `< 640px` (sigla + líder + chip). Sem dependência de orientation media query.

## Requisitos herdados da spec 003 (S07)

Decisão D7 (2026-09-05): `/governador` recebe **apenas a participação** do hero de 1º turno — **não** os seis termômetros. Aqui não existe uma corrida nacional de governador (existem 27 corridas estaduais), então um "top 3 nacional" não teria significado. RF-061 **não se aplica** a esta rota.

> **EMENDADO em 2026-09-27 (decisão do dono)**: O bloco "Participação do eleitorado" foi **removido inteiro** de `/governador`. RF-062 deixa de se aplicar a esta rota. A participação continua existindo nas demais rotas (specs 003, 004, 005).

| RF | Aplicação em `/governador` |
|---|---|
| **RF-062** — participação e "Outros" | ~~`<ProjectionThermometers variant="participacao-only" />`~~ **REMOVIDO em 2026-09-27**. Já não se aplica a esta rota; mantém em specs 003/004/005. |
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
