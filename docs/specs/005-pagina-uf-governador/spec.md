---
id: 005-pagina-uf-governador
title: Página de UF — Governador (T-04)
status: shipped
shipped_date: 2026-05-18
priority: M
personas: [P1, P2, P3]
screens: [T-04]
requirements: [RF-031, RF-032, RF-033, RF-034, RF-037, RF-043, RF-005.4, RF-061, RF-062, RF-063, RF-182, RF-183, RF-180, RF-181, RF-191, RF-186]
depends_on: [001-ingestao-tse, 002-modelo-estatistico, 004-pagina-uf-presidencial]
apis: [GET /api/projection?cargo=governador&uf=<sigla>]
components: [WinnerBanner, CandidateRow, ChoroplethMapUF, MunicipioTable, ForecastTransparency, ProjectionThermometer, ProjectionThermometers, TrilhaKicker, RaceHeader, CandidateResultRow, MunicipioExplorer, ResultPanel, CandidateListCollapse]
nfr: [RNF-001, RNF-002, RNF-003, RNF-008, RNF-022, RNF-023, RNF-024, RNF-025, RNF-027]
adrs: [0001, 0003, 0004, 0007, 0010, 0012, 0013, 0018, 0019, 0025, 0032, 0033, 0034, 0038, 0053, 0055, 0056]
---

# Spec 005 — Página de UF (Governador)

**Rota**: `/uf/[sigla]/governador`

## Objetivo

Versão da página de UF para a corrida de Governador daquela unidade federativa. Herda ~70% da estrutura da [spec 004](../004-pagina-uf-presidencial/spec.md) (presidencial) e adiciona blocos NYT-style decididos no kickoff S06: K-1 disclaimer, `<MunicipioWaffleGrid />` (Print 3), apuração por mesorregião (degrade gracioso) e tabela "Maiores municípios por eleitorado".

## Escopo

**In**:
- Mesma estrutura da [spec 004](../004-pagina-uf-presidencial/spec.md), mas com dados do cargo Governador (cargo=3).
- Reutiliza todos os componentes UF presidenciais — diferença é fetch (`?cargo=governador`).
- 4 blocos NOVOS / refator (S06/F4d):
  1. K-1 disclaimer (ADR-0015) quando `model_fallback_tier >= 2`.
  2. `<MunicipioWaffleGrid />` (Print 3) — 1 quadrado = 1 município.
  3. Apuração por mesorregião — tabela só renderiza se `payload.mesorregioes?` populado.
  4. `<MunicipioTable mode="top-by-eleitorado">` — top-15 maiores municípios + Δ vs 2022.

**Out**:
- Lista das 27 corridas estaduais (escopo [spec 006](../006-grid-governadores/)).
- Drill-down até zona eleitoral (diferido v2).
- Drill-down até município individual (diferido — [spec 015](../015-drill-down-municipio/)).
- Pesquisas pré-urna / demographic (diferido — [spec 014](../014-boca-de-urna/)).

## Requisitos Funcionais

**Idênticos a [spec 004](../004-pagina-uf-presidencial/spec.md)** — todos os RFs RF-031 a RF-044 se aplicam, com `cargo=3` no fetch.

**Exceção de RF-031**: a trilha governador **não tem nó nacional** — o breadcrumb é `Governadores › <SIGLA>`, com "Governadores" linkando para `/governador`, não para `/` ([ADR-0019](../../architecture/adrs/0019-identidade-visual-por-trilha.md): só o cargo Presidente tem arquivo de abrangência Brasil no EA20, então não existe home nacional de governador). O texto legado `‹ Voltar ao nacional` não se aplica a esta rota.

### Adições S06/F4d

**RF-005.1 — K-1 disclaimer adaptativo** (ADR-0015)

WHEN `payload.model_fallback_tier >= 2`, the system SHALL exibir banner sobre o hero com texto:
  - tier 2: "Modelagem com prior limitado — projeção usa pesquisa pré-eleitoral como prior, intervalos podem ser mais largos."
  - tier 3: "Bloco político sem mapeamento histórico em 2022 — exibimos apenas o parcial atual sem projeção."

**RF-005.2 — Waffle de municípios** (Print 3 NYT)

WHEN `payload.municipios.length > 0`, the system SHALL renderizar `<MunicipioWaffleGrid />` com 1 quadrado por município, colorido por líder via `colorForParty(sigla)` (constituição § 2 — cor é editorial por partido, não por rank).

**RF-005.3 — Apuração por mesorregião** (degrade gracioso, Fase 2 S06)

WHEN `payload.mesorregioes?.length > 0`, the system SHALL renderizar tabela `(nome, % apurado, líder, margem, Δ vs 2022)` ordenada por `cod` ASC. WHEN ausente ou vazia, the system SHALL omitir a seção inteira (sem título sem conteúdo).

**RF-005.4 — Municípios por eleitorado** (S06/F4d refator MunicipioTable; 2026-09-20: paginação)

WHEN ao final da composição, the system SHALL renderizar `<MunicipioTable />` exibindo a lista **completa** de municípios da UF, ordenada por eleitorado decrescente, **paginada com 20 itens na primeira leva + 40 adicionais por toque** (ADR-0034 D21; igual nas três rotas: Presidente, Governador, Senador).

### Tabela de municípios — paginação e ordem detalhe formal (S08/2026-09-20)

**RF-182 · RF-183 — Tabela de municípios (paginação e ordem)**

Definidos **uma única vez** em [`docs/specs/004-pagina-uf-presidencial/spec.md`](../004-pagina-uf-presidencial/spec.md)
e válidos sem alteração nesta rota: é o **mesmo** `<MunicipioTable>`, com o mesmo
`<MunicipioExplorer>` em volta, montado por `app/(gov)/uf/[sigla]/governador/page.tsx`.

⚠️ Não reescreva o texto aqui. Ele já esteve duplicado nas duas specs por algumas horas em
2026-09-20 e as duas cópias **nasceram divergentes** (uma trazia um critério de aceitação que a
outra não tinha). Requisito normativo em duas cópias é a mesma classe de defeito que o produto
passou o dia consertando no código.

## Emendas por specs posteriores

### Spec 021 — Votação (2026-09-26, noite)

O painel "Votação" (RF-192 emendado) entra em `/uf/[sigla]/governador` com as contagens **da UF**, em `<Panel>` próprio, imediatamente depois do `<ResultPanel>`.

### Spec 022 — A corrida em três círculos (2026-09-26)

O painel "A corrida" (RF-200..210) entra imediatamente **depois** do painel "Votação". Ordem na tela da UF: resultado → "Votação" → "A corrida" → evolução (spec 020).

### ADR-0053 — emenda 2026-09-27 (tarde): a lista passa a mostrar a base da disputa

Decisão do dono, opção A ([ADR-0053, emenda](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md#emenda-2026-09-27-tarde-a-lista-passa-a-mostrar-a-base-da-disputa)): sempre que a UF tem ao menos uma candidatura com `dvt = "Anulado"`, todo percentual publicado de candidatura que compete nesta rota (`<CandidateRow />`, `<MunicipioTable>`/`<MunicipioWaffleGrid />` por município, apuração por mesorregião) passa a ter como base os **votos em disputa** (`vvc − Σ votos das candidaturas anuladas`), não `vvc` inteiro — a mesma base que já decide o desfecho da UF (RF-006.8, spec 006; RF-213, spec 002). A candidatura anulada permanece na lista, ao final, só com votos absolutos (sem percentual). Sem candidatura anulada — o caso hoje observado —, nada muda: a base continua `vvc` inteiro, igual ao `pvap` do TSE. Ver RF-202/203/204/205/212 da [spec 022](../022-corrida-em-tres-circulos/spec.md) para o efeito nos três círculos "A corrida".

