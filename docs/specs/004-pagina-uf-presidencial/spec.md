---
id: 004-pagina-uf-presidencial
title: Página de UF — Presidencial (T-03)
status: shipped
priority: M
personas: [P1, P2, P3, P4]
screens: [T-03]
requirements: [RF-031, RF-032, RF-033, RF-034, RF-037, RF-043, RF-061, RF-062, RF-063, RF-182, RF-183, RF-180, RF-181, RF-191, RF-186]
depends_on: [001-ingestao-tse, 002-modelo-estatistico, 008-interatividade-brushing, 003-home-nacional]
apis: [GET /api/projection?uf=<sigla>]
components: [WinnerBanner, CandidateRow, ChoroplethMapUF, MunicipioTable, ForecastTransparency, Footer, ProjectionThermometer, TrilhaKicker, RaceHeader, CandidateResultRow, MunicipioExplorer, ResultPanel, CandidateListCollapse]
nfr: [RNF-001, RNF-002, RNF-003, RNF-008, RNF-022, RNF-023, RNF-024, RNF-025, RNF-027]
adrs: [0001, 0003, 0004, 0007, 0010, 0013, 0014, 0017, 0018, 0019, 0025, 0032, 0033, 0034, 0038, 0053, 0055, 0056]
shipped_with_carry_overs:
  - NewsClippingPlaceholder-sem-RF-formal-clipping-midias-BR-virara-spec-em-F4b-F5
  - chunk-MapLibre-287KB-acima-RNF-007b-pendente-ADR-aumentar-meta-300KB
  - e2e-Playwright-cobertura-RF-034-RF-035-RF-036-RF-038-interacao-MapLibre-deferida-S05
  - imagens-OG-dinamicas-RF-051-deferidas-spec-009-dedicada
---

# Spec 004 — Página de UF (Presidencial)

**Rota**: `/uf/[sigla]`

## Objetivo

Espelhar a profundidade da página estadual do NYT, adaptada ao contexto brasileiro — winner banner, mapas duo (votos reportados + estimativa do que falta), tabela de municípios, swing vs 2022, agulha estadual, séries temporais.

## Escopo

**In**:
- Breadcrumb para voltar ao nacional.
- Winner banner colorido (P(vitória) > 95%).
- Tabela de candidatos.
- Mapa do estado em granularidade de município.
- Mapas duo: votos reportados (bubbles) + estimativa do que falta (choropleth).
- Tabela de municípios paginada/virtualizada.
- Mapa de swing vs 2022 com setas.
- Agulha estadual + estimated margin.
- Gráficos: margem ao longo do tempo, probabilidade ao longo do tempo, turnout cumulativo.
- Bloco "O que está movendo o forecast agora".
- Insight textual por template.

**Out**:
- Página de UF para Governador (escopo [spec 005](../005-pagina-uf-governador/)).
- Drill-down de município — deferido para v2.

## Personas e jornadas

- **P1**: drill-down rápido após ver UF decisiva na home.
- **P2**: dados defensáveis e exportáveis, swing vs 2022.
- **P3**: passa horas, navega entre UFs.

## Wireframe (desktop)

```
┌──────────────────────────────────────────────────────────────────┐
│ PRESIDÊNCIA · Brasil › SP        (Brasil › SP)                   │
│ São Paulo — Apuração Presidencial 2026                           │
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────┐ ┌───────────────────────────┐   │
│ │ [VENCEDOR ✓]                 │ │                            │   │
│ │ Lula vence em São Paulo     │ │     [MAPA DE MUNICÍPIOS]   │   │
│ │ Chamada por AP/Reuters       │ │     com choropleth         │   │
│ │                              │ │     coordenado             │   │
│ │ Candidato  Partido  Votos %  │ │                            │   │
│ │ ▌Lula      PT       8.2M 54.1│ │                            │   │
│ │ ▌Bols      PL       7.0M 45.9│ │                            │   │
│ │ Total: 15.2M reportados      │ │                            │   │
│ └──────────────────────────────┘ └───────────────────────────┘   │
│                                                                  │
│ Insight: "Lula supera 2022 em SP por 2,1pp; ganho expressivo... │
│                                                                  │
│ Mapeando os resultados e o que ainda falta                       │
│ ┌──────────────────────┐  ┌──────────────────────┐               │
│ │  Votos REPORTADOS    │  │  ESTIMATIVA do que   │               │
│ │  (bubbles)           │  │  falta (choropleth)  │               │
│ └──────────────────────┘  └──────────────────────┘               │
│                                                                  │
│ Tabela de municípios (645 itens, paginada/virtualizada)          │
│ Município   Margem   % apurado   Votos                           │
│ São Paulo   Lula+8   100%        4.2M    [highlighted on hover]  │
│ Campinas    Bols+3   100%        680k                            │
│ ...                                                              │
│                                                                  │
│ Como os votos se comparam com 2022                               │
│ [Mapa de swing — choropleth + setas]                             │
│                                                                  │
│ Forecast ao vivo de SP                                           │
│ ╱─agulha─╲   Margem estimada: Lula +8.2pp (± 1.1)                │
│                                                                  │
│ Margem ao longo do tempo    Probabilidade ao longo do tempo      │
│ Turnout reportado            O que está movendo o forecast       │
└──────────────────────────────────────────────────────────────────┘
```

## Requisitos Funcionais (EARS)

**RF-031 — Breadcrumb com a profundidade da trilha**

WHEN a página de UF renderiza, the system SHALL exibir um `<nav aria-label="Breadcrumb">` com a profundidade real da trilha presidencial — `Brasil › <SIGLA>` —, sendo "Brasil" um link para `/` e a sigla o nó atual com `aria-current="page"`.

> **Texto atualizado em S07** ([ADR-0019](../../architecture/adrs/0019-identidade-visual-por-trilha.md)). Até S06 o breadcrumb era o link único `‹ Voltar ao nacional`; esse texto continua sendo o **default do modo legado** de `<UFBreadcrumb />` (retrocompatibilidade), mas **nenhuma rota em produção o usa** — as duas páginas de UF passam `items`. Na trilha governador ([spec 005](../005-pagina-uf-governador/spec.md)) o breadcrumb é `Governadores › <SIGLA>`, sem nó nacional.

**Aceitação**:
- Given `/uf/SP`, when a página renderiza, then o breadcrumb tem dois nós — "Brasil" (link para `/`) e "SP" (`aria-current="page"`) — separados por `›` decorativo (`aria-hidden`).

**RF-032 — Winner banner quando P(vitória) > 95%**

IF `p_vitoria_lider ≥ 0.95`, the system SHALL exibir `<WinnerBanner />` colorido na cor do candidato vencedor.

**RF-033 — Tabela de candidatos**

WHEN a página renderiza, the system SHALL exibir tabela com `{avatar, partido, votos, %, barra}` para cada candidato.

**RF-034 — Mapa do estado em granularidade de município (choropleth)**

WHEN a página renderiza, the system SHALL exibir mapa do estado em granularidade de município colorido por líder/margem.

**RF-035 — Mapa "Votos reportados" com bubbles proporcionais**

WHEN a página renderiza, the system SHALL exibir mapa com bubbles proporcionais aos votos reportados por município.

**RF-036 — Mapa "Estimativa do que falta" choropleth**

WHEN a página renderiza, the system SHALL exibir mapa choropleth da estimativa do resultado nos municípios ainda não apurados.

**RF-037 — Tabela de municípios**

WHEN a página renderiza, the system SHALL exibir tabela de municípios ordenada por eleitorado decrescente, **paginada com 20 itens na primeira leva + 40 adicionais por toque** (removida virtualização em 2026-09-20; ADR-0034 D21).

**RF-038 — Mapa de swing vs 2022 com setas/indicadores (Should)**

WHEN a página renderiza, the system SHOULD exibir mapa com setas/indicadores de direção e magnitude do swing por município.

**RF-039 — Agulha estadual + estimated margin**

WHEN a página renderiza, the system SHALL exibir agulha estadual com `p_vitoria` e margem estimada com CI.

**RF-040 — Gráfico "Margem ao longo do tempo" (Should)**

WHEN a página renderiza, the system SHOULD exibir line chart da margem do líder ao longo do tempo desde 17h.

**RF-041 — Gráfico "Probabilidade de vitória ao longo do tempo" (Should)**

WHEN a página renderiza, the system SHOULD exibir line chart de `p_vitoria` do líder ao longo do tempo.

**RF-042 — Gráfico "Turnout cumulativo" (Should)**

WHEN a página renderiza, the system SHOULD exibir area chart de turnout cumulativo da UF ao longo do tempo.

**RF-043 — Bloco "O que está movendo o forecast agora"**

WHEN a página renderiza, the system SHALL exibir bloco `<ForecastTransparency />` mostrando a composição (modelo vs apuração).

**RF-044 — Análise textual gerada por templates estáticos**

WHEN a página renderiza, the system SHALL exibir 1–3 frases analíticas geradas pelo engine de templates ([insights-templates](../../design-system/insights-templates.md)).

### Tabela de municípios — paginação e ordem (S08/2026-09-20)

**RF-182 — Tabela de municípios paginada (20 inicial + 40 por toque)**

WHEN a página de UF renderiza e a tabela de municípios é exibida, the system SHALL exibir 20 municípios inicialmente com um botão que, ao toque, carrega +40 municípios adicionais por lote (em vez da virtualização anterior), e cujo rótulo informa **o tamanho do próximo lote e quantos municípios ainda faltam** — implementado como `Mostrar mais 40 · faltam 625` (`MunicipioTable.tsx:783`).

**Aceitação**:
- Given um estado com >50 municípios, when renderiza, then os primeiros 20 aparecem no viewport + o botão acessível, com o rótulo dizendo o lote e quantos faltam.
- Given usuário toca o botão, when carrega, then +40 linhas adicionadas ao DOM (total 60 visíveis).
- Given usuário toca novamente, when carrega, then +40 mais (total 100).
- Given um estado com ≤20 municípios, when renderiza, then nenhum botão aparece (lista completa já está presente).
- Given a lista em scroll, when usuário toca o botão abaixo do fold, then a página não retorna ao topo, e o **foco permanece no botão** enquanto sobrar município; no toque que esgota a lista o foco vai para a linha de status.

**RF-183 — Ordem da tabela de municípios por eleitorado decrescente**

WHEN a tabela de municípios é renderizada em uma página de UF, the system SHALL ordenar todos os registros por eleitorado decrescente, SEM omitir municípios cujo campo `EdgeUfMunicipio.eleitores` está ausente ou é nulo.

**Aceitação**:
- Given lista de 50 municípios com valores de eleitorado distintos (São Paulo 11,7M até Turuveleta 3.210), when renderiza, then ordem segue eleitorado decrescente (maior para menor).
- Given um município sem eleitorado registrado (`eleitores = null`, situação legítima em payload legado), when renderiza, then o município permanece na tabela (não é filtrado), posicionado ao fim após os que têm eleitorado.
- Given São Paulo (11.721.000) e Guarulhos (1.162.000) na mesma UF, when renderiza, then São Paulo aparece ANTES de Guarulhos, independente de ser capital ou código IBGE.
- Given payload onde NENHUM município tem eleitorado (todos null), when renderiza, then lista completa aparece na ordem original, com legenda "Ordenação por eleitorado indisponível".

## Requisitos herdados da spec 003 (S07)

Esta rota está no escopo do hero de 1º turno (decisão D7 de 2026-09-05). Os requisitos são definidos em [spec 003](../003-home-nacional/spec.md) e apenas **referenciados** aqui:

| RF | Aplicação em `/uf/[sigla]` |
|---|---|
| **RF-061** — hero de seis termômetros | Renderizado em modo `multi-1t`, acima da tabela de `<CandidateRow />`, com heading "Projeção do 1º turno em \<SIGLA\>". O IC dos candidatos vem de `ci95` (shape de UF), não de `pct_projetado_lower/upper`. Em modo `binary` o layout de S04/S06 é preservado. |
| **RF-062** — participação e "Outros" | Alimentado por `payload.participacao` (bloco por UF de RF-020.1, [spec 002](../002-modelo-estatistico/spec.md)). Ausência degrada para "aguardando projeção", sempre no DOM. |
| **RF-063** — identidade de trilha | `<main data-trilha="pres">`, `<RaceHeader />` com kicker "PRESIDÊNCIA · Brasil › \<SIGLA\>" e breadcrumb de RF-031. |

## Requisitos Não-Funcionais aplicáveis

- URL canônica `/uf/[sigla]` — [RNF-027](../../nfr/seo.md).
- Performance, a11y completos — ver frontmatter.

## Open questions

- Critério de "Chamada por AP/Reuters" — temos parceria editorial ou é placeholder? (atual: placeholder, decidir antes de F5).
- Virtualização da tabela de municípios — Tanstack Virtual ou solução custom? (atual: pesquisar).

## Emendas por specs posteriores

### Spec 021 — Votação (2026-09-26)

O painel "Votação" (RF-192..199) entra na tela `/uf/[sigla]` imediatamente após o `<ResultPanel>` da UF, renderizado em seu próprio `<Panel>`.

### Spec 022 — A corrida em três círculos (2026-09-26)

O painel "A corrida" (RF-200..210) entra imediatamente **depois** do painel "Votação" da UF. Ordem na tela da UF: resultado → "Votação" → "A corrida" → evolução (spec 020).

### ADR-0053 — emenda 2026-09-27 (tarde): a lista passa a mostrar a base da disputa

Decisão do dono, opção A ([ADR-0053, emenda](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md#emenda-2026-09-27-tarde-a-lista-passa-a-mostrar-a-base-da-disputa)): sempre que a UF tem ao menos uma candidatura com `dvt = "Anulado"`, todo percentual publicado de candidatura que compete nesta rota (`<CandidateRow />`, RF-061, o balão do mapa e `<StateResultSheet>` herdados da spec 003) passa a ter como base os **votos em disputa** (`vvc − Σ votos das candidaturas anuladas`), não `vvc` inteiro — a mesma base que já decide `p_fecha_1t` por UF (RF-213, spec 002). A candidatura anulada permanece na lista, ao final, só com votos absolutos (sem percentual). Sem candidatura anulada — o caso hoje observado —, nada muda: a base continua `vvc` inteiro, igual ao `pvap` do TSE. Ver RF-202/203/204/205/212 da [spec 022](../022-corrida-em-tres-circulos/spec.md) para o efeito nos três círculos "A corrida".

## v2 — S05 Multi-candidato e 2º turno

Extensão da v1 (2 candidatos em foco) para visualização completa de todos os candidatos em 1T e métricas de 2º turno.

**Mudanças principais** (conforme [ADR-0017](../../architecture/adrs/0017-transparencia-total-3-camadas.md)):

- **Tabela candidatos**: agora exibe todos, com rank visual; top-2 em destaque, 3–6 em bloco expandível, 7+ em lista compacta.
- **Métricas de 2º turno**: novos campos `p_passa_2t` e `p_fecha_1t` por candidato ([ADR-0015](../../architecture/adrs/0015-k1-fallback-3-tier.md)).
- ~~**Tokens de rank**: cores/ícones por posição (ADR-0013), não por partido.~~ ⚠️ **Invertido em 2026-09-19**: o [ADR-0024](../../architecture/adrs/0024-paleta-editorial-por-partido.md) (07/09) superou o ADR-0013 e a **cor vem do partido**, não da posição — esta linha afirmava exatamente o contrário da norma vigente. O **rank** continua governando ordem, ênfase e qual camada exibe cada candidatura; o `--color-cand-*` só entra como fallback de sigla sem token próprio.
- **Needle**: variante que exibe margem ou P(2º turno) conforme turno ativo.
- **Breadcrumb**: superado em S07 por RF-031 reescrito — `Brasil › <SIGLA>` com kicker de trilha acima (ADR-0019). O turno passou a ser comunicado pelo `<TurnoBadge />` do `<RaceHeader />`, não pelo texto do breadcrumb.

**Componentes novos**:
- `<RaceTypeIndicator />` — "Disputa entre N candidatos" no header.
- `<MinorCandidatesList />` — rank 7+ em linha única.
- `<TurnoBadge />` — turno ativo.

**Componentes refatorados**:
- `<CandidateRow />` estendido com suporte a `p_passa_2t`, `p_fecha_1t` e modo compacto.
- `<Needle />` com `metricMode: 'margin' | 'round2_probability'`.
- `<UFBreadcrumb />` dinâmico por turno.

**Status**: v1 (`status: shipped`) continua válida pra 1T binário. v2 estende e é backward-compatible.

## Cross-refs

- Design: [./design.md](./design.md)
- Spec UF Governador (estrutura idêntica): [../005-pagina-uf-governador/](../005-pagina-uf-governador/)
- Brushing: [../008-interatividade-brushing/](../008-interatividade-brushing/)
