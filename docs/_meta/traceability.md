---
title: Matriz de Rastreabilidade
description: RF ↔ Spec ↔ Componente ↔ Teste — cobertura de todos os 60+ RFs do PRD original
status: stable
---

# Matriz de Rastreabilidade

Atualizada a cada PR. Fonte de verdade para cobertura.

> **Nota S05 — Cobertura de testes e extensões**: a coluna "Teste" reflete o que está
> verde **hoje** (`pnpm test` + `tests/unit/**`). A suíte e2e Playwright
> (diretório `tests/e2e/` é `.gitkeep`) está **deferida para S05**. Specs 003
> e 004 foram promovidas a `shipped` com base em cobertura unit + integration
> para os RFs M (Must) e Should. Marcadores "e2e (deferred S05)" indicam
> validação de interação completa que exige browser real (hover de mapa
> MapLibre, click → router.push, brushing entre componentes).
>
> **Extensões S05 (sem RFs novos formais)**: RF-021..044 foram expandidos para suportar
> multi-candidato em 1T e 2º turno (novos componentes `<TurnoBadge />`, `<TwoRoundIndicator />`,
> `<CandidateRanking />`, `<MinorCandidatesList />`, `<RaceTypeIndicator />`). Cobertura
> desses componentes extensões está em `tests/unit/components/[nova-spec-05-componentes].test.tsx`.

## RFs → Specs → Componentes → Testes

| RF | Descrição (resumo) | Prioridade | Spec | Componentes | Teste |
|---|---|---|---|---|---|
| RF-001 | Consumir feed EA20 TSE | M | [001](../specs/001-ingestao-tse/) | — | unit, integration |
| RF-002 | Polling a cada 60s | M | [001](../specs/001-ingestao-tse/) | — | unit, integration |
| RF-003 | ETag (If-None-Match) | M | [001](../specs/001-ingestao-tse/) | — | unit, integration |
| RF-004 | Snapshots append-only | M | [001](../specs/001-ingestao-tse/) | — | unit, integration |
| RF-005 | Replay completo | M | [001](../specs/001-ingestao-tse/) | — | `scripts/replay-2022.ts` (gate OT-4) — sem teste em `tests/` por desenho |
| RF-006 | Histórico 2022 zona | M | [001](../specs/001-ingestao-tse/) | — | unit |
| RF-007 | Histórico 2018 zona | S | [001](../specs/001-ingestao-tse/) | — | unit |
| RF-008 | Mapeamento par (município, zona) ↔ UF (IBGE × TSE, ADR-0035) | M | [001](../specs/001-ingestao-tse/) | — | unit (`geo-coverage.test.ts`: `zonas` ≥ 6.000 pares, municípios distintos ≥ 5.500) |
| RF-009 | Eleitorado por par (município, zona) para 2026 (ADR-0035) | M | [001](../specs/001-ingestao-tse/) | — | unit (`geo-coverage.test.ts`: `eleitorado` ≥ 6.000 pares, `SUM BETWEEN 155e6..157e6`) |
| RF-010 | Conformidade com Res. TSE 23.751/2026 (arts. 264–269) | M | [001](../specs/001-ingestao-tse/) | — | — |
| RF-010.1 | Integridade dado oficial (append-only, sem alteração) | M | [001](../specs/001-ingestao-tse/) | — | unit |
| RF-010.2 | Projeção rotulada como conteúdo derivado | M | [001](../specs/001-ingestao-tse/) | — | unit |
| RF-010.3 | Rate limiter saída no teto por cargo (25 / 25 / 25 / 5, `cargos.ts`), ≤50 ceiling, ≤80 agregado | M | [001](../specs/001-ingestao-tse/) | — | unit (por invocação **e agregada** — `rate-limiter.test.ts`, RF-010.3 item 2) |
| RF-010.4 | Requisição condicional (304 conta para cota) | M | [001](../specs/001-ingestao-tse/) | — | unit (`client.test.ts` — `If-None-Match`, 304, e assert de que o 304 consome token do rate limiter) |
| RF-010.5 | Proibição sondar URL adivinhada | M | [001](../specs/001-ingestao-tse/) | — | unit (`no-url-probing.test.ts` — varredura de fonte: o host do TSE só pode aparecer nas 2 constantes de base URL) + `targets.test.ts` (builders) |
| RF-010.6 | Identificação honesta no User-Agent | M | [001](../specs/001-ingestao-tse/) | — | unit |
| RF-011 | Extrapolação do apurado por zona: `k = te/esi`, `V_c = vap_c·k` (ADR-0021) | M | [002](../specs/002-modelo-estatistico/) | — | pytest (`test_extrapolation.py::test_esi_metade_de_te_dobra_votos_projetados`, `::test_reprodutibilidade_bit_a_bit_mesmo_seed_duas_bases`, `test_orchestrator.py::test_do_project_e_invariante_a_historical`) |
| RF-012 | Agregação por UF: razão de somas nas duas bases, rótulo "votáveis" (ADR-0021) | M | [002](../specs/002-modelo-estatistico/) | — | pytest (`test_extrapolation.py::test_razao_de_somas_diferente_de_media_simples`, `::test_soma_estimates_comparecimento_igual_vv_sobre_c_zona_unica`) |
| RF-013 | Zona não apurada imputada pela proporção da própria UF; share inalterado, volume completo (ADR-0021) | M | [002](../specs/002-modelo-estatistico/) | — | pytest (`test_extrapolation.py::test_e3_zona_nao_apurada_nao_altera_share_soma_volume`) |
| RF-014 | Projeção nacional | M | [002](../specs/002-modelo-estatistico/) | — | unit, replay |
| RF-015 | CI95 bootstrap | M | [002](../specs/002-modelo-estatistico/) | — | unit |
| RF-016 | P(vitória) | M | [002](../specs/002-modelo-estatistico/) | — | unit |
| RF-017 | UF sem zona apurada: proporção nacional com IC ±10pp (cargo 1) ou UF omitida (cargo 3) (ADR-0021) | M | [002](../specs/002-modelo-estatistico/) | — | pytest (`test_extrapolation.py::test_impute_uf_from_national_ci_10pp_e_volume`, `::test_impute_uf_from_national_clipa_perto_das_bordas`, `::test_zero_zonas_retorna_none`) |
| RF-018 | UF <5% apurado (penalização IC ×1.5, nas duas bases) | S | [002](../specs/002-modelo-estatistico/) | — | pytest (`test_extrapolation.py::test_rf018_infla_ci_1_5x_nas_duas_bases`, `test_edge_cases.py`) |
| RF-019 | Recálculo por snapshot | M | [002](../specs/002-modelo-estatistico/) | — | integration |
| RF-020 | Persistir cada cálculo | M | [002](../specs/002-modelo-estatistico/) | — | integration |
| RF-020.1 | Projeção de participação e agregado "Outros" com IC | M | [002](../specs/002-modelo-estatistico/) | — | pytest (`test_turnout.py`, `test_outros.py`, `test_orchestrator.py::test_do_project_e_invariante_a_historical`) — requisito **do modelo**; a contraparte de UI é RF-062 |
| RF-020.2 | Duas bases por candidato (votáveis e comparecimento) com resíduo declarado (ADR-0021/0020) | M | [002](../specs/002-modelo-estatistico/) | `<ProjectionThermometers />` | pytest (`test_extrapolation.py::test_pareamento_2_candidatos_soma_1_base_votaveis`, `::test_soma_estimates_comparecimento_igual_vv_sobre_c_zona_unica`) + vitest (`ProjectionThermometers.test.tsx`) |
| RF-020.3 | `votos_projetados` = Σ zona → UF → BR, persistido em `projections` (ADR-0021) | M | [002](../specs/002-modelo-estatistico/) | `<HeadlineScore />` | pytest (`test_extrapolation.py::test_aggregate_national_votos_soma_por_candidato_e_total`, `test_orchestrator.py`) |
| RF-021 | Agulha hero | M | [003](../specs/003-home-nacional/), [006](../specs/006-grid-governadores/) | `<Needle />`, `<NationalNeedle />` | unit |
| RF-022 | Votos absolutos projetados | M | [003](../specs/003-home-nacional/), [006](../specs/006-grid-governadores/) | `<ResultPanel />` (home, UF-pres, UF-gov), `<HeadlineScore />` (home), `<NationalNeedle />` (home), `<ProjectionThermometers />` (gov, `/governador`) | ⚠️ **perdeu consumidor em 3 de 4 rotas** — hero mudou para `<ResultPanel>`, que não exibe participação; mantém em `/governador` via `ProjectionThermometers` (ADR-0034 D22) |
| RF-023 | % projetado com CI | M | [003](../specs/003-home-nacional/), [006](../specs/006-grid-governadores/) | `<ResultPanel />` (home, UF-pres, UF-gov), `<HeadlineScore />` (home), `<ConfidenceBar />` (planejada), `<NationalNeedle />` (home), `<ProjectionThermometers />` (gov, `/governador`) | ⚠️ **perdeu consumidor em 3 de 4 rotas** (mesmo que RF-022); mantém em `/governador` |
| RF-024 | UFs decisivas (top 6) | M | ~~[003](../specs/003-home-nacional/)~~ | ⚠️ **sem cobertura** — removido em 08/09 (ADR-0033, D2) | — |
| RF-025 | Tabela 27 UFs com dot-plot | M | [003](../specs/003-home-nacional/), [006](../specs/006-grid-governadores/) | `<UFForecastTable />`, `<DotPlotRange />` | deferred S05 |
| RF-026 | Timestamp última atualização | M | [003](../specs/003-home-nacional/) | `<LiveBadge />` | unit |
| RF-027 | Atualização sem reload | M | [003](../specs/003-home-nacional/), [006](../specs/006-grid-governadores/) | (SWR) | unit |
| RF-028 | "Ao vivo" pulsante | S | [003](../specs/003-home-nacional/) | `<LiveBadge />` | unit |
| RF-029 | Tabs Pres/Gov | M | [003](../specs/003-home-nacional/), [006](../specs/006-grid-governadores/) | `<Tabs />` | unit |
| RF-030 | Switch 1T/2T | M (no 2T) | [003](../specs/003-home-nacional/) | (Tabs/Switch) | unit |
| RF-005.1 | K-1 disclaimer adaptativo | M | [005](../specs/005-pagina-uf-governador/) | `<K1Banner />` | unit |
| RF-005.2 | Waffle de municípios | M | [005](../specs/005-pagina-uf-governador/) | `<MunicipioWaffleGrid />` | unit |
| RF-005.3 | Apuração por mesorregião | M | [005](../specs/005-pagina-uf-governador/) | (tabela condicional) | unit |
| RF-005.4 | Municípios por eleitorado. **2026-09-20**: deixou de ser um corte de 8 com a capital forçada ao topo — virou a lista completa, ordenada por eleitorado decrescente e paginada (20 + 40 por toque), igual nas três rotas de estado | M | [005](../specs/005-pagina-uf-governador/) | `<MunicipioTable />` | unit (`MunicipioTable.ordem.test.tsx`) |
| RF-006.1 | Header com contagem de chamadas | M | [006](../specs/006-grid-governadores/) | `<RaceStatsCards />` | unit |
| RF-006.2 | Filtros por status | M | [006](../specs/006-grid-governadores/) | `<FilterBar />` | unit |
| RF-006.3 | Mapa coroplético nacional por líder de UF | M | [006](../specs/006-grid-governadores/) | `<NationalMapBlock>`, `<NationalChoroplethMap>` | integration (`governador-page.test.tsx`); `<HexCartogramBrasil />` preservado sem uso |
| RF-006.4 | Breaking news ticker | M | [006](../specs/006-grid-governadores/) | `<BreakingNewsTicker />` | unit |
| RF-006.5 | Tabs cargo com disabled | M | [006](../specs/006-grid-governadores/) | `<Tabs disabled />` | unit |
| RF-030.1 | Mapa coroplético hero | M | [003](../specs/003-home-nacional/) | `<NationalChoroplethMap />` | unit (SSR shell) + e2e (deferred S05) |
| RF-030.2 | Toggles de visualização | M | [003](../specs/003-home-nacional/) | `<MapViewToggle />` | unit |
| RF-030.3 | Interação com UF por capacidade de ponteiro (desktop mouse → balão+link, mobile/toque → gaveta) | M | [003](../specs/003-home-nacional/), [008](../specs/008-interatividade-brushing/) | `<NationalChoroplethMap />`, `<HoverCard />`, `<StateResultSheet />`, `<UfHoverLink />` | unit (contrato semântico) + e2e (deferred S05) |
| RF-030.4 | Hachura UFs que viraram | S | [003](../specs/003-home-nacional/) | `<NationalChoroplethMap />` | deferred S05 |
| RF-030.5 | Scoreboard com gatilho 50%+1 | M | [003](../specs/003-home-nacional/) | `<HeadlineScore />` | unit |
| RF-030.6 | Tabela agrupada por margem | M | [003](../specs/003-home-nacional/) | `<StateGroupedTable />` | unit |
| RF-030.7 | Indicador P(2º turno) | M | [003](../specs/003-home-nacional/) | `<ChancesPanel />` (novo em S07, ADR-0034) | unit |
| RF-030.8 | Transparência total (sem collapsible) | M | [003](../specs/003-home-nacional/) | `<MinorCandidatesList />`, `<RaceTypeIndicator />` | unit |
| RF-030.9 | Cenários 2º turno | S | ~~[003](../specs/003-home-nacional/)~~ | ⚠️ **sem cobertura** — removido em 08/09 (ADR-0033, D2) | — |
| RF-061 | Hero de seis termômetros no 1º turno | M | [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/) | `<ProjectionThermometer />`, `<ProjectionThermometers />` | unit (`ProjectionThermometer.test.tsx`, `ProjectionThermometers.test.tsx`) + integration (`home-page.test.tsx`, `UFPage.test.tsx`, `uf-governador-page.test.tsx`) |
| RF-062 | Participação e "Outros" na interface; rótulo "Projeção a partir do apurado · N zonas · X% apurado" (ADR-0021) | M | [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [006](../specs/006-grid-governadores/) | `<ProjectionThermometers />`, `<BaseToggle />` (Fase 5) | unit (`participacao.test.ts`, `ProjectionThermometers.test.tsx`, `payload-contract.test.ts`) + integration (`governador-page.test.tsx`) |
| RF-063 | Identidade visual por trilha | M | [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [006](../specs/006-grid-governadores/) | `<TrilhaKicker />`, `<RaceHeader />`, `<UFBreadcrumb />` | unit (`TrilhaKicker.test.tsx`, `RaceHeader.test.tsx`, `UFBreadcrumb.test.tsx`) + integration (4 smokes SSR) |
| RF-031 | Breadcrumb voltar nacional | M | [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/) | ~~`<UFBreadcrumb />`~~ ⛔ **órfão desde 08/09** — removido do layout por ADR-0034 D23 (sem contraparte no protótipo); breadcrumb eliminado, navegação passa a ser via `<CargoTabs>` + título do painel | — |
| RF-032 | Winner banner P>95% | M | [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/) | `<WinnerBanner />` | unit |
| RF-033 | Tabela de candidatos | M | [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/) | `<CandidateRow />` | unit |
| RF-034 | Mapa estado choropleth (município) | M | [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/) | `<ChoroplethMapUF />` | ⚠️ **sem cobertura** — nenhum teste importa o componente (verificado 05/09); e2e deferido |
| RF-035 | Mapa votos reportados (bubbles) | M | ~~[004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/)~~ | ⚠️ **sem cobertura** — removido em 08/09 (ADR-0033, D1); nenhum teste, nenhuma rota | — |
| RF-036 | Mapa estimativa do que falta | M | ~~[004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/)~~ | ⚠️ **sem cobertura** — removido em 08/09 (ADR-0033, D1); nenhum teste, nenhuma rota | — |
| RF-037 | Tabela de municípios. **Virtualizada até 2026-09-20; paginada desde então** (20 na primeira leva, +40 por toque) e presente também em `/uf/[sigla]/senador` | M | [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [016](../specs/016-senador/) | `<MunicipioTable />` | unit (`MunicipioTable.test.tsx`) |
| RF-038 | Mapa swing vs 2022 | S | ~~[004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/)~~ | ⚠️ **sem cobertura** — removido em 08/09 (ADR-0033, D1); nenhum teste, nenhuma rota | — |
| RF-039 | Agulha estadual + margem | M | ~~[004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/)~~ | ⚠️ **sem cobertura** — removido em 08/09 (ADR-0033, D1); nenhuma rota | — |
| RF-040 | Margem ao longo do tempo | S | ~~[004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/)~~ | ⚠️ **sem cobertura** — removido em 08/09 (ADR-0033, D1); nenhuma rota | — |
| RF-041 | Probabilidade ao longo do tempo | S | ~~[004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/)~~ | ⚠️ **sem cobertura** — removido em 08/09 (ADR-0033, D1); nenhuma rota | — |
| RF-042 | Turnout cumulativo | S | ~~[004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/)~~ | ⚠️ **sem cobertura** — removido em 08/09 (ADR-0033, D1); nenhuma rota | — |
| RF-043 | "O que está movendo o forecast" | M | [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [003](../specs/003-home-nacional/) | `<ForecastTransparency />`, `<ModelComposition />` | unit |
| RF-044 | Insight textual por template | M | ~~[004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/)~~, [003](../specs/003-home-nacional/) | ⚠️ **sem cobertura em 004/005** — removido em 08/09 (ADR-0033, D1); cobre RF-044 ainda na home | home unit |
| RF-045 | Hover destaca em todas visualizações | M | [008](../specs/008-interatividade-brushing/) | (hover-store + consumers) | e2e brushing |
| RF-046 | Hover em linha tabela destaca mapas | M | [008](../specs/008-interatividade-brushing/) | (hover-store) | e2e brushing |
| RF-047 | Click navega para drill-down | M | [008](../specs/008-interatividade-brushing/) | — | e2e |
| RF-048 | Tooltip flutuante breakdown | M | [008](../specs/008-interatividade-brushing/) | `<HoverTooltip />` | e2e |
| RF-049 | Mobile tap-to-select | M | [008](../specs/008-interatividade-brushing/) | (hover-store + isMobile) | e2e mobile |
| RF-050 | Tooltip vira bottom-sheet mobile | M | [008](../specs/008-interatividade-brushing/) | `<BottomSheet />` | e2e mobile |
| RF-051 | OG image dinâmica | S | [009](../specs/009-compartilhamento-meta/) | `app/opengraph-image.tsx` | manual |
| RF-052 | Botões de share | S | [009](../specs/009-compartilhamento-meta/) | `<ShareBar />` | manual |
| RF-053 | URL com timestamp (snapshot) | C | [009](../specs/009-compartilhamento-meta/) | — | — |
| RF-054 | Página Sobre o Modelo | M | [011](../specs/011-sobre-o-modelo/), [009](../specs/009-compartilhamento-meta/) | (MDX) | manual |
| RF-055 | Footer fontes + disclaimer | M | [009](../specs/009-compartilhamento-meta/) | `<Footer />` | unit |
| RF-056 | Dashboard saúde pipeline | M | [010](../specs/010-operacao-monitoramento/) | `<MetricCard />` | manual — diferido S11 (a 012 foi cortada em 18/09; dono único para o gate ver) |
| RF-012.1 | Botão "Pausar Cron" (`/_status`) | M | [012](../specs/012-dashboard-status/) | — | ❌ **SEM COBERTURA — a spec 012 não foi implementada.** `app/_status/` contém **só** um `.gitkeep`; não existe rota, componente nem teste. A ausência aqui é de **código**, não de linha na matriz: enquanto `/_status` não existir, não há o que testar. Bloqueia `shipped` da spec 012. |
| RF-012.2 | Botão "Forçar refresh" (`/_status`) | M | [012](../specs/012-dashboard-status/) | — | ❌ **SEM COBERTURA — idem RF-012.1.** Mesma causa: `app/_status/` só tem `.gitkeep`. Bloqueia `shipped` da spec 012. |
| RF-057 | Alertas Slack se lag >60s | M | [010](../specs/010-operacao-monitoramento/) | — | `tests/unit/tse/alerts.test.ts` (13 casos) — ✅ 18/09. A **regra** (`alertasDoCiclo`) e o **transporte** (`notifySlack`) testados em separado, sem banco, sem rede e sem `SLACK_WEBHOOK_URL`. ⚠️ Antes dizia só "manual (forçar)" — e o manual nunca foi feito: `grep -rln notifySlack tests/` devolvia **zero** |
| RF-058 | Modo manutenção amigável | M | [010](../specs/010-operacao-monitoramento/), [013](../specs/013-pagina-manutencao/) | — | ❌ **SEM COBERTURA.** `app/manutencao/` só tem `.gitkeep`; `<MaintenancePageMessage />` não existe no disco. 🔴 **Duas donas no frontmatter** — `010.requirements` e `013.requirements` listam RF-058; não corrigido aqui, ver "Divergências não corrigidas" |
| RF-058.1 | Modo transição 1T→2T | M | [013](../specs/013-pagina-manutencao/) | `<TurnoTransitionBanner />` | ❌ **SEM COBERTURA — cobertura nominal encontrada em 18/09.** A linha dizia "unit" sem arquivo nenhum: `<TurnoTransitionBanner />` não existe em `components/`, `tests/unit/**/*TurnoTransition*` devolve vazio. Bloqueia `shipped` da spec 013. |
| RF-058.2 | Roteamento e redirect manutenção | M | [013](../specs/013-pagina-manutencao/) | (middleware) | ❌ **SEM COBERTURA — idem RF-058.1.** Nenhum middleware de manutenção existe; `app/manutencao/` é diretório vazio. Bloqueia `shipped` da spec 013. |
| RF-059 | Rolling release rollback | M | [010](../specs/010-operacao-monitoramento/) | — | manual |
| RF-060 | Cron toggle via env var | M | [010](../specs/010-operacao-monitoramento/) | — | `tests/unit/tse/cron-enabled.test.ts` (3 casos, sem banco) — ✅ 18/09. ⚠️ Antes dizia só "unit" e o único teste vivia em `tests/integration/ingest-cycle.test.ts:367`, atrás da guarda `ALLOW_DB_WRITE_TESTS`: **nunca executava**, nem local nem no CI |
| RF-100 | Ingestão do cargo 5 em granularidade de zona | M | [016](../specs/016-senador/) | — | unit (`tse/targets.test.ts`, um alvo por par + guarda contra volta a `uf`; `config/cargos.test.ts`) |
| RF-101 | Suplentes preservados no snapshot | M | [016](../specs/016-senador/) | — | unit (`ea20-senador-suplentes.test.ts`) |
| RF-102 | Projeção por regra de três, zona a zona | M | [016](../specs/016-senador/) | — | pytest (`test_senador.py`) |
| RF-103 | `p_eleito` para duas vagas | M | [016](../specs/016-senador/) | — | pytest (`test_p_eleito.py`), unit (`ResultPanelVagas.test.tsx`) |
| RF-104 | Margem relevante é a do 2º para o 3º, inclusive na cor do mapa | M | [016](../specs/016-senador/) | `<ResultPanel>`, `<NationalChoroplethMap>` (intensidade), `lib/utils/margem-senado.ts` | integration (`senador.test.tsx`) |
| RF-105 | Painel de resultado com duas vagas, reaproveitado no mapa nacional | M | [016](../specs/016-senador/) | `<ResultPanel>`, `<StateResultSheet>` | integration (`senador.test.tsx`), unit (`ResultPanelVagas.test.tsx`) |
| RF-106 | Rótulo explícito de duas vagas, incluindo no nome acessível do mapa | M | [016](../specs/016-senador/) | `<RaceHeader />`, `<NationalChoroplethMap>` (`aria-label`), `lib/utils/margem-senado.ts::ariaRessalvaVagas` | integration (`senador.test.tsx`) |
| RF-107 | Composição nacional das 54 vagas (T-09) | M | [016](../specs/016-senador/) | `<ChancesPanel />` | integration (`senador.test.tsx`) |
| RF-108 | Transparência de cadência | M | [016](../specs/016-senador/) | `<ForecastTransparency />` | integration (`senador.test.tsx`) |
| RF-120 | Ingestão do cargo 6 em granularidade zona (6 fatias) | M | [017](../specs/017-deputado-federal/) | — | unit (`tse/targets.test.ts` — ~6.110 alvos par (município×zona), fatiado em 6, sem tocar o banco); cron em `vercel.ts` com ciclo ~300s (ADR-0036) |
| RF-121 | Votos de legenda preservados | M | [017](../specs/017-deputado-federal/) | — | pytest (`test_deputado.py` — legenda do agregado e fallback pela soma dos partidos); golden 2022 usa legenda real |
| RF-122 | Federação conta como uma agremiação | M | [017](../specs/017-deputado-federal/) | — | pytest (`test_deputado.py::test_federacao_vira_uma_agremiacao*`, verificado por mutação); `test_cadeiras.py::test_caso6_*` mede 2 cadeiras de diferença |
| RF-123 | Quociente eleitoral com o arredondamento da lei | M | [017](../specs/017-deputado-federal/) | — | pytest (`test_cadeiras.py::test_caso1_*`, 3 casos). ⚠️ O golden de 2022 **exercita** mas **não discrimina** esta regra — ver `test_cadeiras_golden_2022.py::test_o_golden_exercita_mas_nao_discrimina_o_arredondamento` |
| RF-124 | Número de vagas NUNCA hardcoded | M | [017](../specs/017-deputado-federal/) | — | pytest (`test_deputado.py` — `lugares_a_preencher` sai de `carg[].nv`; ausente vira `None`, nunca palpite); 2º critério (`f93f98f`) — `conferir_total_de_cadeiras()` compara a soma das **27** contra `TOTAL_CADEIRAS[6]`, alarma sem abortar, e **não** alarma abaixo de 27: `test_deputado_payload.py::test_a_soma_das_27_que_fecha_em_513_nao_produz_divergencia`, `::test_a_soma_das_27_fora_de_513_produz_divergencia`, `::test_ciclo_com_as_27_fora_de_513_alarma_e_nao_aborta`, `::test_ciclo_com_poucas_ufs_nao_alarma` |
| RF-125 | Distribuição em três fases, conforme ADR-0027 | M | [017](../specs/017-deputado-federal/) | — | pytest (`test_cadeiras.py`, 9 casos de borda do ADR-0027) + `test_cadeiras_golden_2022.py` (511/513 cadeiras reais) |
| RF-125.1 | Cadeiras exibidas ≠ vagas obtidas para o denominador | M | [017](../specs/017-deputado-federal/) | — | pytest (`test_cadeiras.py::test_caso2b_*`) + golden 2022 (Σ cadeiras == vagas nas 27 UFs) |
| RF-126 | Testes golden contra 2022 | M | [017](../specs/017-deputado-federal/) | — | pytest (`test_cadeiras_golden_2022.py`) — **511/513 cadeiras de 2022**; fase 1 exata nas 27 UFs; 2 divergências nomeadas (MG, RS) sem explicação pelo dado |
| RF-127 | Bancada projetada com incerteza explícita | M | [017](../specs/017-deputado-federal/) | `<VoteBar>`, `<Figure>`, `<DeputadoMetodologia>` | ✅ Telas `/deputado-federal` e `/uf/[sigla]/deputado-federal` implementadas com intervalo CI95 de cadeiras (bootstrap por agremiação em `api/model/cadeiras_bootstrap.py`, testes em `tests/unit/model/test_cadeiras_bootstrap.py`); intervalo coexiste com marcação de cadeira indefinida (dois sinais independentes). |
| RF-128 | Cadência de 30 minutos visível | M | [017](../specs/017-deputado-federal/) | `<DeputadoMetodologia>` | ✅ Telas implementadas. `<ForecastTransparency />` deliberadamente NÃO reutilizado (design.md D9: cadências variam por cargo; ForecastTransparency calcula pctModel = 100 − pctApurado, inválido para cargo 6 sem modelo). A cadência é LIDA de `atualizacao_min` do payload, nunca literal no JSX (design.md D8) — teste injeta 7 e exige que a tela diga 7 (ciclo completo: 6 fatias × 5 min = 30 min, ADR-0036) |
| RF-129 | Drill-down por UF vem do Blob | M | [017](../specs/017-deputado-federal/) | — | ✅ Implementado: `lib/blob/deputado-uf.ts::readDeputadoUfDetail()` + testes (`tests/unit/blob/deputado-uf.test.ts`). Payload `DeputadoUfDetail` em `deputado/uf/<SIGLA>.json` |
| RF-130 | Voto de legenda visível | M | [017](../specs/017-deputado-federal/) | `<VoteBar>`, `<Figure>` | ✅ Telas `/deputado-federal` (nacional) e `/uf/[sigla]/deputado-federal` (UF) implementadas. Separa nominais e legenda (design.md D4, D6) |
| RF-131 | Hemiciclo da Câmara: um assento por cadeira, três estados, ordem por tamanho de bancada | M | [017](../specs/017-deputado-federal/) | `<CamaraHemiciclo />` | ✅ Implementado em `16d4a26`: componente `components/blocks/CamaraHemiciclo.tsx` + helpers `lib/utils/hemiciclo.ts`, `lib/utils/bancada.ts` (ADR-0049). Testes nos **quatro** arquivos: `tests/unit/lib/hemiciclo.test.ts` (geometria), `tests/unit/components/CamaraHemiciclo.test.tsx`, `tests/unit/components/camara-hemiciclo-peso.test.tsx` (teto de 36 KiB de markup), `tests/unit/pages/deputado-federal-hemiciclo.test.tsx`. Renderizado em `app/(dep)/deputado-federal/page.tsx` pelo símbolo `<CamaraHemiciclo>` — citado por símbolo e não por linha **de propósito**: uma coordenada morta impede de conferir o fato e a afirmação vira folclore (handoff de 19/09 § 4.6) |
| RF-133 | Sem dado, a tela DIZ que não há dado, e não inventa número | M | [019](../specs/019-fase-pre-eleicao/) | `<ResultPanel>`, `<AguardandoNacional>` | ✅ `tests/integration/home-page.test.tsx:626` e `tests/unit/pages/fase-pre-eleicao.test.tsx:472` — o comportamento já estava no ar desde 13/09 (`app/(pres)/page.tsx`); o que faltava era a **norma**. ⚠️ Fora da faixa da spec (RF-153-166) de propósito: o ID já era citado em `risks.md` e estava queimado — ver o bloco de histórico no próprio RF |
| RF-140 | Ingestão do cadastro de candidaturas, dois pacotes unidos por `SQ_CANDIDATO` | M | [018](../specs/018-identidade-candidatura/) | — | unit (`data-pipeline/tests/unit/data-pipeline/candidatos-parse.test.ts`), integration (ingestão real contra TSE em 12/09) |
| RF-141 | Publicabilidade fail-closed; situação de julgamento é texto, nunca filtro | M | [018](../specs/018-identidade-candidatura/) | — | unit (`candidatos-parse.test.ts::test_publicavel_fail_closed*`, asserts de 7.698 publicáveis), integration |
| RF-142 | Foto de candidato no Blob, binária, cache de um ano | M | [018](../specs/018-identidade-candidatura/) | — | unit (`tests/unit/blob/write.test.ts::test_putBinary_cacheControlMaxAge_imutavel`), integration (387 fotos Acre) |
| RF-143 | Chave de identidade e resolução determinística de colisão | M | [018](../specs/018-identidade-candidatura/) | — | unit (`candidatos-resolve.test.ts::test_resolve_candidato_4_colisoes_bahia_determinismo`, teste de mutação contra os 4 casos) |
| RF-144 | Nome real no payload de UF, resolvido em quatro degraus | M | [018](../specs/018-identidade-candidatura/) | — | ✅ **4 de 4 degraus** (fechado em 13/09, `62b9aec`). `tests/unit/model/test_identidade_cand.py` cobre `nmu` → `nm` → placeholder; o degrau do cadastro entrou com `fetch_identidade_cadastro`/`merge_identidade_cadastro` (`api/model/project.py:2847`, `:2969`), lendo a tabela `candidatos` por `(uf, numero)` quando o boletim não traz nome, chamado no orquestrador (`:5933-5935`). unit (`tests/unit/model/test_identidade_cadastro.py`, 24 casos). |
| RF-145 | Nome real proibido no bloco nacional de cargo 3 e 5 | M | [018](../specs/018-identidade-candidatura/) | — | unit (`tests/unit/model/test_national_sem_nome_em_cargo_3_5.py`) |
| RF-146 | Rota `/candidatos` | M | [018](../specs/018-identidade-candidatura/) | `<CandidatosGrid>`, `<CandidaturasFonte>`, form inline (⚠️ não é o `<CandidatosFiltros>` do frontmatter — ver nota) | ✅ Implementado em 13/09: `app/(cand)/candidatos/page.tsx` RSC, lê Blob via `readCandidatosIndex()`, sem JS novo (RNF-007a) |
| RF-147 | Filtro por cargo e por UF, sem JavaScript | M | [018](../specs/018-identidade-candidatura/) | `<form method="get">` inline em `app/(cand)/candidatos/page.tsx` — **não existe** `<CandidatosFiltros>` como arquivo separado (`grep -rln CandidatosFiltros` vazio) | unit (formulário com `method="get"`, `searchParams` parseados sem erro) |
| RF-148 | Busca por nome | M | [018](../specs/018-identidade-candidatura/) | `<SearchField>` inline (variante não-controlada de `components/atoms/controls/SearchInput.tsx`), grade | unit (busca case-insensitive, com acento) |
| RF-149 | Grade de candidatos no estado "aguardando dados" de cada cargo | M | [018](../specs/018-identidade-candidatura/) | `<CandidatosGrid>`, `<CandidaturasAguardando>` | ✅ **Implementado** (fechado em 13/09, `d12f647`). `<CandidaturasAguardando>` (`components/blocks/CandidaturasAguardando.tsx`) compõe `<CandidatosGrid>` nos quatro estados de espera — usado em `app/(pres)/page.tsx`, `app/(pres)/uf/[sigla]/page.tsx`, `app/(gov)/uf/[sigla]/governador/page.tsx`, `app/(sen)/uf/[sigla]/senador/page.tsx`, `app/(dep)/uf/[sigla]/deputado-federal/page.tsx`. unit (`tests/unit/pages/aguardando-candidatos.test.tsx` + `tests/unit/components/CandidatosGrid.test.tsx`, 54 casos): ordem no DOM (parágrafo antes da grade), grade some quando chega voto, Blob fora do ar não derruba a página, nome vem da fatia e não do payload. |
| RF-150 | "Fonte: TSE" visível e carimbo de frescor | M | [018](../specs/018-identidade-candidatura/) | `<CandidaturasFonte>` | unit (injeta `fonte_ts`, tela diz aquele valor — nunca literal) |
| RF-151 | Fallback de avatar quando não há foto | M | [018](../specs/018-identidade-candidatura/) | `<CandidateAvatar>` (⚠️ arquivo é `components/atoms/data/CandidateAvatar.tsx`, inglês — frontmatter da spec 018 cita `CandidatoAvatar`, português; mesmo componente) | unit (dimensões 161×225 sem foto, CLS zero, sem `colorForParty` como área) |
| RF-152 | Cadência de reimportação e guarda de encolhimento | M | [018](../specs/018-identidade-candidatura/) | — | unit (`candidatos-import.test.ts::test_encolhimento_aborta_98_pctile`, `test_encolhimento_janela_critica_02_03_outubro`) |
| RF-153 | `fase` no payload, lida em um só lugar, nunca derivada de percentual | M | [019](../specs/019-fase-pre-eleicao/) | — (`lib/config/fase.ts`) | ✅ unit (`tests/unit/config/fase.test.ts`, 12 casos + `tests/unit/api/edge-write-fase.test.ts`, 5 casos). O caso que discrimina é o **M2**: payload **sem** `fase`, com `pct_apurado_total: 0` e `por_uf: []` ⇒ modo **NORMAL** (`fase.test.ts:51`) — qualquer derivação por percentual zerado inverteria esse caso, e o par M3 (com `fase` e 37,4% apurado ⇒ modo PRÉ, `:72`) fecha a pinça nos dois sentidos. Complementos: comparação por **igualdade exata** do literal (`:108`), `composition.pre_election: 1` sem `fase` **não** liga o modo ([ADR-0043](../architecture/adrs/0043-fase-pre-eleicao-campo-proprio-nao-derivada.md) D2, `:90`), e guarda **estrutural** de que a string `pre_eleicao` não ocorre em `app/` nem `components/` (`:174`) e fora deles só vive nos donos declarados (`:197`). Na borda de escrita: `fase: "pre_eleicao"` atravessa **até o writer** sem ser descartado em silêncio (`edge-write-fase.test.ts:106`) e qualquer outro valor é 400 nos dois envelopes (`:130`, `:139`). |
| RF-154 | Os quatro painéis de medição somem inteiros | M | [019](../specs/019-fase-pre-eleicao/) | `<RemainingPanel />`, `<ChancesPanel />`, `<BulletinPanel />`, `<StateGroupedTable />` (suprimidos **pelo chamador**) | ✅ unit (`tests/unit/pages/fase-pre-eleicao.test.tsx`, bloco «RF-154», `:185-244`). O par que discrimina é **M4 × M6**: em fase pré os quatro `data-testid` **não existem** no DOM (`:195`, `queryBy…` devolvendo `null` — nunca `toBeEmpty()`), e em modo normal **zerado**, sem `fase`, os quatro **continuam lá** (`:202`). Sem esse segundo caso, supressão por `fase` e supressão por número zero passariam iguais. Mais o controle positivo de que os quatro seletores devolvem não-nulo em modo normal (`:186`) e a varredura **sobre o texto**, não sobre o componente, das quatro frases da tabela de mentiras (M5, `:211`), com o par de que a frase do `RemainingPanel` de fato aparece quando deve (`:226`). |
| RF-155 | `ResultPanel` em modo identidade: sem barra, sem margem, sem rank | M | [019](../specs/019-fase-pre-eleicao/) | `<ResultPanel />` | ✅ unit (`fase-pre-eleicao.test.tsx`, bloco «RF-155», `:245-299`). Três asserções negativas, **cada uma com seu controle positivo em modo normal** — que é o que impede um seletor quebrado de passar: nenhum `<VoteBar>` em fase pré (`:246`) vs. presente em modo normal (`:252`); as strings `"pp"`, `"Margem"` e `"+0,0"` ausentes (`:257`) vs. presentes (`:268`); nenhuma linha de candidatura com posição ordinal (`:274`) vs. lista ordinal (`:289`). Repetido nos dois layouts da home (`binary` e `multi-1t`, `:1275`). |
| RF-156 | `RaceTypeIndicator` conta quem concorre, não quem pontuou | M | [019](../specs/019-fase-pre-eleicao/) | `<RaceTypeIndicator />` | ✅ unit (`tests/unit/components/RaceTypeIndicator.preEleicao.test.tsx`, 5 casos + `fase-pre-eleicao.test.tsx:300`). O caso que discrimina é o **M7**: o **mesmo array** produz **12** em fase pré e **7** em fase normal (`RaceTypeIndicator.preEleicao.test.tsx:30`) — um número igual nos dois lados provaria que a contagem não mudou de fonte. Reforços: 12 candidaturas zeradas dizem 12, onde hoje diria "0" (`:47`); o número sai de `candidatos.length` e **nunca** de literal no JSX (`:61`, lição D8 da spec 017); `turno === 2` cai no fallback já existente (`:70`); e sem a prop o default é fase **normal** (`:81`). Na página, o mesmo M7 (`fase-pre-eleicao.test.tsx:306`) e a frase "Disputa entre 12 candidatos" (`:301`). |
| RF-157 | Mapa: cor neutra na 1ª linha de `resolveColor`, controle suprimido, legenda trocada | M | [019](../specs/019-fase-pre-eleicao/) | `<NationalChoroplethMap />`, `<MapViewToggle />`, `<MapLegend />` | ✅ unit (`tests/unit/components/NationalChoroplethMap.preEleicao.test.tsx` + `NationalMapBlock.preEleicao.test.tsx` + `NationalChoroplethMap.legend.test.tsx:211`). **M8**: em fase pré as 27 UFs saem `--map-uncounted` nas **seis** combinações de vista (`preEleicao.test.tsx:251`), com o controle de que em modo normal as mesmas seis pintam com cor de identidade (`:237`) e de que a guarda antiga (`parcial` + 0% apurado) continua valendo em fase normal (`:264`). **M9** é o que não deixa a guarda migrar para o ramo errado — três asserções **estruturais** sobre `resolveColor`: vem antes de resolver `liderId` a partir de `top_candidatos[0]` (`:320`), antes do `switch (view)` e de qualquer leitura de `viewMode` (`:326`), e é a **primeira instrução do corpo** (`:334`). Chrome do bloco: `<MapViewToggle>` fora do DOM em fase pré com par de controle (`NationalMapBlock…:68`, `:76`), o `<UfPicker>` **permanece** — navegação não é medição (`:83`) —, legenda de partidos trocada pela de geografia (`:95` e `legend.test.tsx:211`), título deixa de dizer "quem lidera" (`:112`) e o mapa continua na tela (RNF-023, `:119`). |
| RF-158 | `ForecastTransparency` vira parágrafo, e não some | M | [019](../specs/019-fase-pre-eleicao/) | `<ForecastTransparency />` | ✅ unit (`tests/unit/components/ForecastTransparency.test.tsx`, bloco de prosa `:121-176` + `fase-pre-eleicao.test.tsx`, bloco «RF-158», `:320-363`). **M10**: o bloco está presente nas três telas semeadas em fase pré **sem fração, barra nem percentual** (`:321`) — é o "e não some" que a constituição § 8 exige, e `/deputado-federal` tem o bloco de metodologia dele (`:340`); o controle é a decomposição numérica voltar em modo normal (`:352`). No componente, as duas variantes são distinguidas pelo que **podem afirmar**: `nao_comecou` pode dizer que ninguém votou (`:125`), `sem_dados` **não** afirma a causa e fala só de nós (`:134`), o default do ramo é `nao_comecou` (`:147`), e o fail-safe — `variante` sem `preEleicao` liga a prosa (`:152`) — tem o par de controle sem nenhuma das props (`:166`). |
| RF-159 | O selo do shell para de afirmar liveness, para os olhos e para o leitor de tela | M | [019](../specs/019-fase-pre-eleicao/) | `<ShellLiveBadge />` | ✅ unit (`tests/unit/components/ShellLiveBadge.test.tsx`, bloco «RF-159», `:144-245` + `fase-pre-eleicao.test.tsx`, bloco (D), `:1072-1154`). **M11**: em fase pré o leitor de tela **não ouve** "Apuração ao vivo" (`:172`), com o par de modo normal em que, havendo percentual publicado, o selo **volta** a afirmar liveness (`:181`). O que sustenta a asserção: as duas frases acessíveis moram no DOM e **nunca** em `content` de CSS (`:145`) — uma frase em CSS não seria vista por `getByText` nem por leitor de tela —, e todo default do CSS é silêncio (`:159`). Variante `sem_dados`: publica **uma** só propriedade e não afirma causa nenhuma (`:222`); na cascata real, o leitor não ouve **nenhuma** das duas frases (`:233`). Por rota: cada rota em espera publica o selo silencioso (`fase-pre-eleicao.test.tsx:1074`), o par semeado publica as quatro (`:1093`), e há controle de que o helper `declaracoes` lê mesmo o que a página publica (`:1106`). |
| RF-160 | Camada A: faixa `FasePreEleicaoBanner`, primeiro filho do `<main>`, não dispensável | M | [019](../specs/019-fase-pre-eleicao/) | `<FasePreEleicaoBanner />` | ✅ unit (`fase-pre-eleicao.test.tsx`, bloco «RF-160», `:364-507`). A asserção que discrimina é de **ordem, não de presença**: **M12** — a faixa é `firstElementChild` do `<main>` em cada rota (`:373`), repetido no ramo de espera da home (`:947`) e nos dois layouts (`:1341`); uma faixa presente mas abaixo do `<h1>` passaria num teste de presença e falha aqui. **M13** fixa a forma: `<section aria-labelledby>`, **sem** `role="alert"` e sem roubar foco (`:380`). Mais: a faixa traz a data e não fala como máquina (`:412`); "a eleição ainda não começou" só nas telas **semeadas**, nunca no ramo de espera (`:430`), onde a faixa diz "sem dados" (`:959`) e **não promete** uma lista de estados que a home não tem (`:976`, com par em que os estados existem, `:992`); em fase normal a faixa não existe em rota nenhuma (`:455`); e em `/deputado-federal` fica **acima** do parágrafo honesto, que continua lá (`:466`). |
| RF-161 | Camada B: texto no lugar de cada zero, proibição de "projeção", ordem por número na urna | M | [019](../specs/019-fase-pre-eleicao/) | `<ResultPanel />`, `<FasePreEleicaoBanner />` | ✅ unit (`fase-pre-eleicao.test.tsx`, bloco «RF-161», `:508-669` + `tests/unit/components/ResultPanelAvatar.test.tsx:171`). **M14** é uma **varredura de vocabulário sobre o HTML renderizado**, não sobre uma lista de componentes: "projeç"/"projec" ocorre **zero** vezes fora do bloco do RF-158, rota a rota (`:520`), com o controle de que em modo normal a palavra **volta** a ocorrer (`:603`); a lista negra de medição não ocorre (`:527`) e a divergência de `/deputado-federal` está fixada em **exatamente três** ocorrências nomeadas (`:555`), o que impede a quarta entrar sem alarme. **M15** cobre a ordem: por **número na urna**, crescente, com o payload chegando **desordenado** de propósito (`:631`) e estável entre renders (`:647`), com par em modo normal onde a ordem volta a ser a de `pct_projetado` (`:657`). Mais o `<h1>` dizendo "Quem está concorrendo" (`:609`) e a `note` explicando que a lista é de registro (`:624`). O avatar é refém da mesma varredura: `ResultPanelAvatar.test.tsx:171` proíbe `%` **dentro do atributo `style`**, porque a varredura não distingue um `18%` de corte de um percentual na tela — e já reprovou a linha de identidade por isso em 14/09. |
| RF-162 | Governador e Senador nacionais: 27 links, nenhuma grade de rostos | M | [019](../specs/019-fase-pre-eleicao/) | `<UfLinksGrid />` | ✅ unit (`fase-pre-eleicao.test.tsx`, bloco «RF-162 / RF-163», `:670-760` + `tests/unit/data-pipeline/projection-seed.test.ts:241`). **M16** são duas asserções, e a que discrimina é a negativa: exatamente **27** links de UF por rota (`:678`) **e nenhum nome de candidatura no documento** (`:693`) — a positiva sozinha passaria com os 27 links e uma grade de rostos logo abaixo. No semeador, a mesma regra do lado do dado: só o cargo 1 recebe identidade, `gov` e `sen` ficam **sem nome** (`projection-seed.test.ts:241`). Também coberto: com payload ausente, `/governador` e `/senador` não mostram percentual nem zero solto (`:763`), as duas frases do `emptyPayload()` não ocorrem (`:769`) e a estrutura fica de pé (constituição § 3, `:776`), com o controle 🔴 de que o payload antigo **dispara todas** as varreduras (`:802`). |
| RF-163 | Deputado Federal não é semeado; a tela de espera ganha faixa, selo e 27 links | M | [019](../specs/019-fase-pre-eleicao/) | `<UfLinksGrid />`, `AguardandoNacional` | ✅ unit (`projection-seed.test.ts`, bloco «RF-163 / RF-164», `:179-273` + `fase-pre-eleicao.test.tsx:702`, `:466`). **M17** é uma asserção **negativa sobre o conjunto de chaves efetivamente gravadas**, verificada contra o store, não contra a intenção do script: **nenhuma** chave de cargo `dep` é escrita (`projection-seed.test.ts:180`). Na tela: o semeador não alimenta `/deputado-federal`, que continua sem payload (`fase-pre-eleicao.test.tsx:702`), e a faixa do RF-160 fica **acima** do parágrafo `data-testid="dep-aguardando"`, que **não é reescrito** (`:466`). |
| RF-164 | Semeador `projection-seed.ts`: `por_uf` vazio, ordem `gov → sen → pres`, reentrância fechada | M | [019](../specs/019-fase-pre-eleicao/) | — (`data-pipeline/projection-seed.ts`) | ✅ unit (`tests/unit/data-pipeline/projection-seed.test.ts`, blocos «RF-164» `:122-178` e `:319-386`). Payload: `fase: "pre_eleicao"` com `por_uf: []` (`:123`), **todo** campo de medição da candidatura zerado enquanto a identidade sobrevive (`:136`), `ehSemeado` por igualdade exata — a dúvida resolve para **não escrever** (`:167`) — e o tamanho **medido, não estimado**: ~10 KB ([ADR-0032](../architecture/adrs/0032-detalhe-municipal-vercel-blob.md), `:251`), com `dryRun` que mede sem gravar (`:261`). Ordem (**M18**): a ordem **declarada** é `gov → sen → pres` (`:214`) **e** a ordem de gravação **observada** é a declarada (`:219`) — declarar sem observar deixaria a constante certa e o laço errado; o alias `projection-current` carrega o payload do **cargo 1** (`:199`). Reentrância (**M19**): chave existente **sem** `fase` ⇒ não grava **nada** e lança (`:322`), a recusa **nomeia** as chaves ocupadas (`:338`), chave **com** `fase` sobrescreve (re-semear é esperado, `:348`), `--force` levanta **só** essa recusa (`:358`), e a guarda cobre os **quatro** destinos — as três nomeadas e o alias (`:377`). |
| RF-165 | Fiscal de limpeza `scripts/edge-config-prune.ts` | M | [019](../specs/019-fase-pre-eleicao/) | — (`scripts/edge-config-prune.ts`) | ✅ unit (`tests/unit/scripts/edge-config-prune.test.ts`, 11 casos em 2 blocos). A asserção que discrimina é sobre **o que sobrou**, não sobre o que foi apagado: com as duas flags, remove só as chaves que têm `fase` (`:71`), e **nunca** toca chave sem o campo, mesmo quando ela se parece com uma semeada (`:86`). Duas travas: sem argumento apenas **lista** (`:48`) e `--apagar` sem `--confirmar` continua não apagando (`:62`). O que impede o fiscal de virar adivinho: varre o store **inteiro**, não uma lista fixa de nomes esperados (`:108`); `carregaFaseSemeada` é igualdade exata, gravação fora do contrato não é apagada (`:121`); e ele **não deriva a fase** de `pct_apurado_total`, `por_uf.length` nem `composition.pre_election` (`:157`) — a mesma proibição do RF-153, do outro lado do pipeline. Operação: o relatório traz cargo, turno e bytes (`:128`), uma falha ao apagar não derruba o ciclo e a chave conta como sobrevivente (`:135`), flag desconhecida é erro e não silêncio (`:150`), e no caminho feliz (transição concluída) não encontra nada (`:99`). |
| RF-166 | Transição de 04/10: o primeiro upsert real apaga a fase | M | [019](../specs/019-fase-pre-eleicao/) | — (produtor Python) | ✅ unit (`projection-seed.test.ts`, bloco «RF-166», `:274-318` + `tests/unit/model/test_fase_ausente_no_emissor.py`, 4 casos). Do lado da gravação: é **substituição integral** — um merge deixaria `fase` por baixo do dado real e a tela ficaria em modo pré indefinidamente, sem alarme (`:275`) — e a transição é **por cargo**: um cron atrasado não arrasta os outros dois (`:299`). Do lado do produtor, a prova é **negativa sobre o JSON emitido**: `api/model/project.py` e `api/model/deputado_payload.py` **nunca** emitem a chave `fase` (`test_fase_ausente_no_emissor.py:133`, `:145`) — um emissor que escrevesse `fase: null` ou `fase: "normal"` passaria num teste positivo e falha aqui —, inclusive com zero apurado (`:155`), e `composition.pre_election` continua existindo **sem** ser a fase (`:169`). Fecha com a guarda estrutural de `tests/unit/config/fase.test.ts:214`: os dois emissores Python não conhecem o literal. |
| RF-167 | O percentual por candidatura é persistido, não recalculado | M | [020](../specs/020-evolucao-da-apuracao/) | — (produtor Python) | ✅ unit (`tests/unit/model/test_projections_serie.py`, 15 casos): migration 0009 **aplicada em produção**, e `linhas_para_projections`/`insert_projections` (`api/model/project.py`) gravam `pct_atual`/`votos_atuais`/`dado_ts`. 8 mutações aplicadas, todas mortas — entre elas `?? 0` sobre linha sem medição, `dado_ts or now()` (o relógio do ciclo no lugar do boletim, ADR-0038), nacional como média das UFs em vez de razão de somas, e tirar `dado_ts` da lista do INSERT. Escopo travado por `CARGOS_COM_SERIE_PERSISTIDA = {1, 3, 5}` (2 casos: Deputado Federal fora, Presidente/Governador/Senador dentro). |
| RF-168 | A série é limitada por construção, nunca por corte | M | [020](../specs/020-evolucao-da-apuracao/) | — (produtor Python) | ⚠️ **sem cobertura** — `fetch_series_por_candidato` (cadência adaptativa, teto de 120, último-do-balde) é **Fase 2** e não existe no repositório (grep vazio em `api/`, `lib/`, `tests/`). O teto e a forma colunar estão decididos no [ADR-0046](../architecture/adrs/0046-serie-por-candidato-limitada-por-construcao.md) D2 e tipados em `lib/edge-config/types.ts`, mas **tipo não é teste**. ⚠️ **Nota 2026-09-18**: a Fase 2 entrou — `fetch_series_por_candidato`/`montar_serie_por_candidato` existem (`api/model/project.py`) com testes em `tests/unit/model/test_serie_por_candidato.py`, e o eixo ganhou a regra do [ADR-0047](../architecture/adrs/0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) D2 (RF-168e: linha sem `dado_ts` não vira ponto; `test_sql_descarta_a_linha_sem_hora_do_boletim`). O **veredito de cobertura desta linha aguarda `rf-coverage-checker`** — esta nota registra o estado do código, não um gate. |
| RF-169 | O último ponto é o número publicado ao lado | M | [020](../specs/020-evolucao-da-apuracao/) | — (produtor Python) | ⚠️ **sem cobertura** — depende de `anexar_ponto_corrente` (**Fase 2**), que não existe no repositório. Hoje a leitura da série precede o INSERT do ciclo em `api/model/project.py`, então o defeito **existe e não é detectado**. ⚠️ **Nota 2026-09-18**: `anexar_ponto_corrente` entrou (`api/model/project.py:1028`), com testes em `tests/unit/model/test_serie_por_candidato.py`, e ganhou a regra do [ADR-0047](../architecture/adrs/0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) D2 (RF-169d: sem hora legível, o ponto do ciclo **não** é publicado — `test_ponto_corrente_sem_hora_do_boletim_vira_buraco_e_nao_ponto`, e `test_com_o_coalesce_de_volta_na_leitura_o_ciclo_cego_ressuscita` para a meia-correção). O **veredito de cobertura aguarda `rf-coverage-checker`**. |
| RF-170 | Quatro linhas, escolhidas agora, desenhadas desde o início | M | [020](../specs/020-evolucao-da-apuracao/) | `<SerieApuracaoChart />`, `rankByParcial` | 🟡 **parcial** — o comparador tem cobertura própria (`tests/unit/utils/rank-parcial.test.ts`, 6 casos, 6 mutações mortas). A **seleção das 4 no produtor** é **Fase 2** e não tem teste. |
| RF-171 | A cor é do partido; o rank escolhe quem entra, nunca de que cor | M | [020](../specs/020-evolucao-da-apuracao/) | `<SerieApuracaoChart />` | ✅ unit (`tests/unit/components/serie-apuracao-chart.test.tsx`, bloco “T7: mata a cor por rank”): cor estável sob inversão da ordem, partidos distintos com cores distintas, e asserção **negativa** de que `--color-cand-` não ocorre no HTML. Mutação aplicada e morta. ✅ **Emenda de 2026-09-18 ([ADR-0047](../architecture/adrs/0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) D1):** a cor sai de `textForParty` (variante legível), não da base — bloco “T8”, que mede a cor **emitida** contra os dois papéis de cada tema, com fixture dos 4 partidos cuja base reprova o piso de 3:1 do SC 1.4.11 (PSOL 2,08:1, PSB 2,19:1, `outros` 2,39:1, NOVO 2,72:1). Mutação `textForParty → colorForParty` aplicada e morta. |
| RF-172 | As duas visões alternam pelo controle que já existe | M | [020](../specs/020-evolucao-da-apuracao/) | `<SerieApuracaoChart />`, `<ViewModeSwitch />` | ✅ unit (`tests/unit/components/serie-apuracao-chart.test.tsx`): os dois grupos `data-view-only` no HTML do servidor. ⚠️ O item (b) — 0 B de bundle — **ainda não é medido**: depende de `tests/e2e/perf-budget.spec.ts` rodar sobre as 4 rotas. |
| RF-173 | Senador: quatro linhas, duas vagas legíveis sem cor | M | [020](../specs/020-evolucao-da-apuracao/) | `<SerieApuracaoChart />` | ✅ unit (`tests/unit/components/serie-apuracao-chart.test.tsx`, bloco “RF-173: Senador elege duas”, 4 casos): espessura maior nas 2 primeiras, ausência de `opacity`, régua da 2ª vaga, e a legenda nomeando as duas. |
| RF-174 | Antes de 04/10 o gráfico desenha os eixos e diz que ainda não é hora | M | [020](../specs/020-evolucao-da-apuracao/) | `<SerieApuracaoChart />` | ✅ unit (`tests/unit/components/serie-apuracao-chart.test.tsx`, 4 casos): sem traçado, “projeção” ausente de toda superfície, régua de 0–50% e horários do protótipo. ✅ integration: as 4 rotas conferem `data-estado="antes-do-dia"` quando o payload **nacional** traz a fase. |
| RF-175 | Três estados degradados, nenhum silencioso | M | [020](../specs/020-evolucao-da-apuracao/) | `<SerieApuracaoChart />`, `<DetailUnavailable />` | ✅ unit (`tests/unit/components/serie-apuracao-chart.test.tsx`, blocos “T3” e “T5”): 0/1/**2** pontos (o caso NO limiar), traço interrompido em dois segmentos no furo, nenhuma coordenada na linha de zero e a célula dizendo “sem medição”. Mutação `?? 0` aplicada e morta. |
| RF-176 | Tabela completa para leitor de tela, com as duas bases | M | [020](../specs/020-evolucao-da-apuracao/) | `<SerieApuracaoChart />` | ✅ unit (`tests/unit/components/serie-apuracao-chart.test.tsx`, bloco “RF-176”, 4 casos): uma linha por instante, hora legível (nunca ISO cru), legenda declarando a projeção como não oficial, SVG com papel de imagem. ⚠️ O item (e) — axe nas 4 rotas × 2 temas × 2 viewports — **ainda não foi rodado**. |

## RFs adicionados pelas specs (não estavam no PRD)

> **O que esta tabela é**: um índice de **origem** — qual RF nasceu em qual spec.
> **O que ela não é**: afirmação de cobertura. A coluna "Teste" existe só na matriz
> principal acima, e é só ela que o gate `rf-coverage-checker` lê. Desde 2026-09-18
> todo RF listado aqui **também** tem linha lá em cima; se um dia um RF aparecer só
> aqui, isso é um defeito, não uma escolha de organização.

| RF spec-local | Descrição | Spec |
|---|---|---|
| RF-005.1 | K-1 disclaimer adaptativo | [005](../specs/005-pagina-uf-governador/) |
| RF-005.2 | Waffle de municípios | [005](../specs/005-pagina-uf-governador/) |
| RF-005.3 | Apuração por mesorregião | [005](../specs/005-pagina-uf-governador/) |
| RF-005.4 | Maiores municípios | [005](../specs/005-pagina-uf-governador/) |
| RF-006.1 | Header com contagem de chamadas | [006](../specs/006-grid-governadores/) |
| RF-006.2 | Filtros por status | [006](../specs/006-grid-governadores/) |
| RF-006.3 | Cartograma hexagonal | [006](../specs/006-grid-governadores/) |
| RF-006.4 | Breaking news ticker | [006](../specs/006-grid-governadores/) |
| RF-006.5 | Tabs cargo com disabled | [006](../specs/006-grid-governadores/) |
| RF-012.1 | Botão "Pausar Cron" | [012](../specs/012-dashboard-status/) |
| RF-012.2 | Botão "Forçar refresh" | [012](../specs/012-dashboard-status/) |
| RF-010.1 | Integridade dado oficial | [001](../specs/001-ingestao-tse/) |
| RF-010.2 | Projeção rotulada como derivada | [001](../specs/001-ingestao-tse/) |
| RF-010.3 | Rate limiter saída | [001](../specs/001-ingestao-tse/) |
| RF-010.4 | Requisição condicional (304 conta) | [001](../specs/001-ingestao-tse/) |
| RF-010.5 | Proibição sondar URL | [001](../specs/001-ingestao-tse/) |
| RF-010.6 | User-Agent honesto | [001](../specs/001-ingestao-tse/) |
| RF-030.7 | Indicador P(2º turno) | [003](../specs/003-home-nacional/) |
| RF-030.8 | Transparência total (sem collapsible) | [003](../specs/003-home-nacional/) |
| RF-030.9 | Cenários 2º turno | [003](../specs/003-home-nacional/) — ⚠️ **cortado em 08/09** (ADR-0033); esta tabela registra a ORIGEM do RF, não que ele esteja vigente. Ver a linha dele na matriz principal |
| RF-061 | Hero seis termômetros 1T | [003](../specs/003-home-nacional/) |
| RF-063 | Identidade visual por trilha | [003](../specs/003-home-nacional/) |
| RF-100 | Ingestão do cargo 5 em granularidade de zona | [016](../specs/016-senador/) |
| RF-101 | Suplentes preservados no snapshot | [016](../specs/016-senador/) |
| RF-102 | Projeção por regra de três, zona a zona | [016](../specs/016-senador/) |
| RF-103 | `p_eleito` para duas vagas | [016](../specs/016-senador/) |
| RF-104 | Margem relevante é a do 2º para o 3º | [016](../specs/016-senador/) |
| RF-105 | Painel de resultado com duas vagas | [016](../specs/016-senador/) |
| RF-106 | Rótulo explícito de duas vagas | [016](../specs/016-senador/) |
| RF-107 | Composição nacional das 54 vagas | [016](../specs/016-senador/) |
| RF-108 | Transparência de cadência | [016](../specs/016-senador/) |
| RF-120 | Ingestão do cargo 6 em granularidade zona (6 fatias) | [017](../specs/017-deputado-federal/) |
| RF-121 | Votos de legenda preservados | [017](../specs/017-deputado-federal/) |
| RF-122 | Federação conta como uma agremiação | [017](../specs/017-deputado-federal/) |
| RF-123 | Quociente eleitoral com arredondamento | [017](../specs/017-deputado-federal/) |
| RF-124 | Número de vagas NUNCA hardcoded | [017](../specs/017-deputado-federal/) |
| RF-125 | Distribuição em três fases | [017](../specs/017-deputado-federal/) |
| RF-125.1 | Cadeiras exibidas ≠ vagas obtidas | [017](../specs/017-deputado-federal/) |
| RF-126 | Testes golden contra 2022 | [017](../specs/017-deputado-federal/) |
| RF-127 | Bancada projetada com incerteza | [017](../specs/017-deputado-federal/) |
| RF-128 | Cadência de 30 minutos visível | [017](../specs/017-deputado-federal/) |
| RF-129 | Drill-down por UF vem do Blob | [017](../specs/017-deputado-federal/) |
| RF-130 | Voto de legenda visível | [017](../specs/017-deputado-federal/) |
| RF-131 | Hemiciclo da Câmara | [017](../specs/017-deputado-federal/) |
| RF-140 | Ingestão do cadastro de candidaturas | [018](../specs/018-identidade-candidatura/) |
| RF-141 | Publicabilidade fail-closed | [018](../specs/018-identidade-candidatura/) |
| RF-142 | Foto de candidato no Blob | [018](../specs/018-identidade-candidatura/) |
| RF-143 | Chave de identidade e resolução | [018](../specs/018-identidade-candidatura/) |
| RF-144 | Nome real no payload de UF | [018](../specs/018-identidade-candidatura/) |
| RF-145 | Nome real proibido em cargo 3/5 | [018](../specs/018-identidade-candidatura/) |
| RF-146 | Rota `/candidatos` | [018](../specs/018-identidade-candidatura/) |
| RF-147 | Filtro por cargo e UF | [018](../specs/018-identidade-candidatura/) |
| RF-148 | Busca por nome | [018](../specs/018-identidade-candidatura/) |
| RF-149 | Grade no estado "aguardando" | [018](../specs/018-identidade-candidatura/) |
| RF-150 | "Fonte: TSE" e carimbo de frescor | [018](../specs/018-identidade-candidatura/) |
| RF-151 | Fallback de avatar | [018](../specs/018-identidade-candidatura/) |
| RF-152 | Cadência de reimportação e guarda | [018](../specs/018-identidade-candidatura/) |
| RF-167 | Percentual por candidatura persistido | [020](../specs/020-evolucao-da-apuracao/) |
| RF-168 | Série limitada por construção, cadência adaptativa | [020](../specs/020-evolucao-da-apuracao/) |
| RF-169 | Último ponto síncrono com payload | [020](../specs/020-evolucao-da-apuracao/) |
| RF-170 | Quatro linhas, escolhidas agora, desenhadas desde o início | [020](../specs/020-evolucao-da-apuracao/) |
| RF-171 | Cor por partido, não por rank | [020](../specs/020-evolucao-da-apuracao/) |
| RF-172 | Duas visões alternam por controle existente | [020](../specs/020-evolucao-da-apuracao/) |
| RF-173 | Senador: duas vagas legíveis sem cor | [020](../specs/020-evolucao-da-apuracao/) |
| RF-174 | Antes de 04/10: eixos e mensagem de espera | [020](../specs/020-evolucao-da-apuracao/) |
| RF-175 | Três estados degradados, nenhum silencioso | [020](../specs/020-evolucao-da-apuracao/) |
| RF-176 | Tabela a11y com duas bases, horas formatadas | [020](../specs/020-evolucao-da-apuracao/) |
| RF-153 | `fase` no payload, lida em um só lugar | [019](../specs/019-fase-pre-eleicao/) |
| RF-154 | Os quatro painéis de medição somem inteiros | [019](../specs/019-fase-pre-eleicao/) |
| RF-155 | `ResultPanel` em modo identidade | [019](../specs/019-fase-pre-eleicao/) |
| RF-156 | `RaceTypeIndicator` conta quem concorre | [019](../specs/019-fase-pre-eleicao/) |
| RF-157 | Mapa: cor neutra, controle suprimido, legenda trocada | [019](../specs/019-fase-pre-eleicao/) |
| RF-158 | `ForecastTransparency` vira parágrafo | [019](../specs/019-fase-pre-eleicao/) |
| RF-159 | Selo do shell para de afirmar liveness | [019](../specs/019-fase-pre-eleicao/) |
| RF-160 | Camada A: faixa `FasePreEleicaoBanner` | [019](../specs/019-fase-pre-eleicao/) |
| RF-161 | Camada B: texto no lugar de cada zero, proibição de "projeção" | [019](../specs/019-fase-pre-eleicao/) |
| RF-162 | Governador e Senador: 27 links sem grade de rostos | [019](../specs/019-fase-pre-eleicao/) |
| RF-163 | Deputado Federal não é semeado, tela de espera ganha aviso | [019](../specs/019-fase-pre-eleicao/) |
| RF-164 | Semeador `projection-seed.ts`: `por_uf` vazio, ordem `gov → sen → pres` | [019](../specs/019-fase-pre-eleicao/) |
| RF-165 | Fiscal de limpeza `edge-config-prune.ts` | [019](../specs/019-fase-pre-eleicao/) |
| RF-166 | Transição de 04/10: o primeiro upsert real apaga a fase | [019](../specs/019-fase-pre-eleicao/) |

## Cobertura

**154 RFs distintos**, todos na matriz principal.

> **Critério da contagem** (escrito aqui porque a ausência dele foi o que deixou
> este número divergir do `README.md` até 2026-09-18): conta-se **identificador
> distinto**, e um RF com sufixo decimal conta como **um** identificador próprio —
> `RF-030` e `RF-030.1` são dois, não um. Sob esse critério: **66 vêm do PRD**
> (RF-001..RF-060 mais RF-030.1..RF-030.6) e **88 foram acrescentados pelas specs**
> (RF-005.1-4, RF-006.1-5, RF-010.1-6, RF-012.1-2, RF-020.1-3, RF-030.7-9,
> RF-058.1-2, RF-061-063, RF-100-108, RF-120-**131** + RF-125.1, **RF-133**, RF-140-176).
> Medido em 2026-09-19 contando IDs únicos na primeira coluna da matriz principal
> (era 152/86 até RF-131 entrar em `ff7edab`).
>
> ✅ **RF-133 deixou de ser órfão em 2026-09-19** — foi formalizado na spec 019 e tem linha na matriz acima. O parágrafo abaixo fica como histórico do que ele era.
>
> ~~🔴 **RF-133 é um ID ÓRFÃO — não o reutilize e não o trate como existente.**~~
> `docs/reference/risks.md:105` cita "RF-133" ao descrever o estado de espera
> ("Aguardando o primeiro boletim…") implementado em 13/09. Verificado em 19/09: o
> ID **não existe** em nenhuma spec, nem nesta matriz, nem em `index.json`, nem em
> código — é referência de narrativa que nunca foi formalizada. O comportamento que
> ela descreve **é real e está no ar**; o que não existe é o requisito. Resolver
> exige decisão do dono (formalizar o RF ou remover a citação), e é por isso que
> fica registrado aqui em vez de consertado: renumerar ou inventar o RF para
> "fechar o buraco" criaria um requisito que ninguém escreveu.

**Os 16 RFs que viviam só no índice de origem foram promovidos em 2026-09-18.** Até
essa data, `RF-012.1`, `RF-012.2` (spec 012) e `RF-153..RF-166` (spec 019) apareciam
**apenas** na tabela "RFs adicionados pelas specs", que não tem coluna "Teste" — e é a
coluna "Teste" da matriz principal a única coisa que o gate `rf-coverage-checker` lê.
Consequência: 16 RFs eram invisíveis ao portão, e a spec 019 podia ser promovida a
`shipped` sem que nada os confrontasse. As 16 linhas agora existem lá em cima, com a
coluna "Teste" preenchida contra arquivo e número de linha conferidos no disco.

**Estado depois da migração**:

- **RF-153..RF-166 (spec 019) — 14 de 14 com cobertura confirmada.** Todos os arquivos
  citados foram abertos; as asserções descritas na matriz são as que **discriminam**
  (o par M2/M3 do RF-153, o par M4/M6 do RF-154, o mesmo array dando 12 e 7 no RF-156,
  a ordem `firstElementChild` do RF-160, a varredura de vocabulário do RF-161, a
  asserção sobre o conjunto de chaves gravadas do RF-163/165), não a mera presença de
  um arquivo com o nome certo.
- **RF-012.1 e RF-012.2 (spec 012) — sem cobertura, porque não há código.** `app/_status/`
  contém só um `.gitkeep`: a rota `/_status` nunca foi implementada. Esta é uma ausência
  de **implementação**, não de linha na matriz — e é a diferença que importa: as outras 14
  estavam testadas e invisíveis; estas duas estão visíveis e não testadas. Bloqueia
  `shipped` da spec 012.

✅ **Divergência de 2026-09-18 corrigida no mesmo dia** (`437fed2`): o frontmatter de
[`docs/specs/012-dashboard-status/spec.md`](../specs/012-dashboard-status/spec.md) agora declara
`requirements: [RF-012.1, RF-012.2]` — só os dois RFs que são dela; RF-056/RF-057 ficaram
com dono único na spec 010, desfazendo o ciclo `depends_on` 010↔012. RF-012.1/RF-012.2
continuam sem cobertura (ver acima), mas agora o `rf-coverage-checker` os enxerga.

## RNFs

NFRs cobertos em [../nfr/](../nfr/). Duas contagens, porque dependem do critério — e é
por não declararem o critério que este arquivo dizia 34 e o [`README.md`](../README.md)
dizia 36 até 2026-09-18:

- **34 identificadores-base**: RNF-001..RNF-034, sem buracos.
- **36 metas mensuráveis vigentes**: os 34 acima, menos RNF-007 — que deixou de valer
  sozinho quando foi desdobrado em RNF-007a/b/c ([../nfr/performance.md](../nfr/performance.md), § do
  refinamento de 2026-05-17: a meta original "<150KB total" era inalcançável com MapLibre) —, mais
  os três desdobramentos. 33 + 3 = 36. `RNF-007a-floor` **não** entra: é linha
  informacional (piso de framework medido), não meta.

Medido em 2026-09-18 por IDs únicos em `docs/nfr/*.md`. Cada spec lista no frontmatter quais
NFRs aplicam.

## ADRs

**47 ADRs** em [../architecture/adrs/](../architecture/adrs/) (ADR-0001..ADR-0047) — **44 `accepted`,
3 `superseded`** (ADR-0013, ADR-0015, ADR-0018). Critério: um arquivo `.md` por ADR no diretório,
contado em 2026-09-18 (`ls docs/architecture/adrs/*.md | wc -l`), com o status lido do frontmatter
de cada um. Specs referenciam ADRs aplicáveis no frontmatter.

> As listas "Novos em ..." abaixo são um **log de destaques**, não o inventário completo — o
> número autoritativo é o do parágrafo acima, medido no diretório. ADR-0044 (código de eleição por
> cargo) e ADR-0045 (exterior ZZ) são de 2026-09-17 e não aparecem aqui.

**Novos em 2026-09-07**:
- ADR-0024 (paleta editorial por partido) — hoje `accepted`; supersede o ADR-0013
- ADR-0025 (design system Atlas Menna restyle-in-place) — `accepted`, afeta specs 003/004/005/006/011
- ADR-0026 (Senador e Deputado Federal) — `accepted`, emenda ADR-0001 (Vercel Blob como exceção ao read path para Deputado)

**Novos em 2026-09-11** (Fase 8, S07):
- ADR-0027 (Conversão de votos em cadeiras para Deputado Federal) — `accepted`, fecha lacuna do ADR-0026

**Novos em 2026-09-13** (Fase 8, S07):
- ADR-0036 (Cargo 6 em granularidade zona fatiada em 6) — `accepted`, emenda ADR-0026 (cargo 5 idem em 11/09)
- ADR-0037 (UF sem faixa entra como constante no IC95 nacional) — `accepted`

**Novos em 2026-09-17** (spec 020):
- ADR-0046 (série por candidato limitada por construção) — `accepted`, **emenda** o ADR-0032 (não o supersede): forma colunar, teto de 120 pontos re-bucketizado, elenco decidido no produtor, e o escopo nacional na chave de Global Config já existente em vez de chave nova. Ver [../architecture/data-model.md](../architecture/data-model.md) § «Série por candidatura».

**Novos em 2026-09-18** (spec 020):
- [ADR-0047](../architecture/adrs/0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) (as duas
  emendas do dono à série) — `accepted`, **emenda** o ADR-0046 (D5, cor da linha) e o ADR-0038 (D1, o
  que fazer sem hora do dado); **não supersede** nenhum dos dois. D1: a linha usa `textForParty` (a
  variante legível), não a cor-base — quatro partidos reprovavam o piso de 3:1 do SC 1.4.11 no tema
  claro. D2: ciclo sem `dado_ts` vira **buraco na linha**, não ponto no relógio de cálculo. Já citado
  no corpo desta matriz por RF-168, RF-169 e RF-171.

Spec 016 (Senador) — `draft`, implementada em S07. Spec 017 (Deputado Federal) — **`shipped` em 13/09**, com os 4 gates aprovados: `rf-coverage-checker` PASS (12 RFs), `constitution-guard` PASS **na reexecução** (a primeira rodada reprovou — `<DeputadoMetodologia>` afirmava ao leitor uma granularidade que o ADR-0036 tinha acabado de inverter; corrigido em `8cd955f`), `a11y-perf-auditor` PASS (Lighthouse a11y 100/100, axe 0 violações em 12 combinações, bundle idêntico byte a byte), e `spec-syncer` executado. RF-127 completo desde `2bcee57` — o intervalo de cadeiras existe, e a marcação de cadeira indefinida **coexiste** com ele.

## RFs adicionados pelas specs

Além dos 66 RFs do PRD (RF-001..RF-060 + RF-030.1..RF-030.6), as specs adicionaram 88 RFs próprios.
Vide frontmatters de cada spec (`requirements:` no YAML). Soma global: 154 RFs únicos.

| RF-177 | Balão do mapa com 4 candidaturas + agregado "Outros", **reordenado pela base ativa** | M | [003](../specs/003-home-nacional/) | `<NationalChoroplethMap />`, `<HoverCard />`, `lib/utils/lider-por-base.ts` | unit (`NationalChoroplethMap.hoverOutros.test.tsx`, casos a–e: 5 linhas + 4 colunas, agregação + ausência, cruzamento pct↔pct_atual, "Outros" sem camada de vencedor) + unit (`NationalChoroplethMap.hoverOrdemPorBase.test.tsx`, 4 casos: ordem por projeção, ordem INVERTE por parcial, `pct_atual` ausente degrada sem fabricar zero, ✓ segue a identidade do líder projetado) |
| RF-178 | Orientação vertical adaptativa do balão do mapa | M | [003](../specs/003-home-nacional/) | `<HoverCard />`, `lib/utils/hover-card-placement.ts` | unit (`NationalChoroplethMap.hoverFlipVertical.test.tsx`, 5 casos: metade cima/baixo × dois eixos independentes, regra de altura não largura) |
| RF-179 | Mapa municipal de Senador no nível UF | M | [016](../specs/016-senador/) | `<ChoroplethMapUF />`, `<MunicipioTable />`, `<MunicipioExplorer />` | integration (`tests/unit/pages/senador.test.tsx` — cobertura estrutural de `/uf/[sigla]/senador`; cobertura parcial por par município×zona apurado) |
| RF-180 | A barra é o apurado; o traço é a projeção, e só existe na visão de Projeção | M | [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [016](../specs/016-senador/) | `<CandidateResultRow />` | unit (`CandidateResultRow.test.tsx`, 27 casos: UM preenchimento sempre apurado, UM traço sempre projeção só na visão Projeção, coluna de projeção fora do DOM na Parcial, guarda do zero sobre `pct_projetado`, grade sem a 4ª faixa na Parcial) |
| RF-181 | Lista de candidatos reordena ao trocar base ativa | M | [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [016](../specs/016-senador/) | `<ResultPanel />`, `<CandidateRanking />` | unit (`ResultPanel.ordemPorBase.test.tsx`, 22 casos: ordem projeção/parcial, numeração, margem, vagas, cor invariante) |
| RF-182 | Tabela de municípios paginada (20 inicial + 40 por toque) | M | [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [016](../specs/016-senador/) | `<MunicipioTable />` | unit (`MunicipioTable.test.tsx`, casos de paginação: primeira leva 20, botão "Ver mais", +40 por toque) |
| RF-183 | Ordem da tabela de municípios por eleitorado decrescente | M | [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [016](../specs/016-senador/) | `<MunicipioTable />` | unit (`MunicipioTable.ordem.test.tsx`, 13 casos: ordem eleitorado desc, município sem eleitorado no fim nunca filtrado, capital não força topo, payload legado, MG caso real) |
| RF-184 | VagaBadge mostra estado de ocupação por base (Senador) | M | [016](../specs/016-senador/) | `<ResultPanelVagas />` | unit (`ResultPanelVagas.test.tsx`, casos de VagaBadge: textos por base, top-2 vs indefinido) |
| RF-185 | Painel de chances acompanha a base ativa | M | [003](../specs/003-home-nacional/), [016](../specs/016-senador/) | `<ChancesPanel />` | unit (`ChancesPanel.test.tsx`, casos a–g: medidores por campo, ausência sem zero, rótulos por base) |
| RF-186 | Ficha do mapa (StateResultSheet) exibe apurado E projetado por candidatura | M | [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [016](../specs/016-senador/) | `<StateResultSheet />` | unit (`StateResultSheet.parcialEProjecao.test.tsx`, 4 cenários: completo, sem parcial, sem projeção, misto; nunca fabrica zero) |
| RF-187 | Seletor Parcial/Projeção renderizado dentro do conteúdo (desktop) | M | [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [016](../specs/016-senador/) | `<ShellControls />`, `<BaseToggle />` | unit (`ShellControls.test.tsx`, casos a/b/d: tablist + dois tabs com aria-selected, altura tap-min) |
| RF-188 | Interação com o mapa segue capacidade de ponteiro, não viewport | M | [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [008](../specs/008-interatividade-brushing/), [016](../specs/016-senador/) | `<NationalChoroplethMap />`, `<ChoroplethMapUF />` | unit (`NationalChoroplethMap.toqueNaoAbreBalao.test.tsx`, 3 casos: toque NÃO abre balão, gaveta abre, mouse continua; `ChoroplethMapUF.toqueNaoAbreBalao.test.tsx` análogo) |
| RF-189 | A cor e a intensidade do mapa coroplético seguem a base ativa | M | [003](../specs/003-home-nacional/), [006](../specs/006-grid-governadores/), [016](../specs/016-senador/) | `<NationalChoroplethMap />`, `<NationalMapBlock />`, `lib/utils/lider-por-base.ts` | unit (`NationalChoroplethMap.corPorBase.test.tsx`, 4 casos: pré-condição de tokens, cor por partido muda na view `winner`, intensidade muda na view `margin` com líder constante, UF sem boletim segue cinza) + unit (`lider-por-base.test.ts`, 9 casos) |
| RF-190 | O payload resgata quem lidera o apurado fora do corte por projeção (união top-4-projeção ∪ top-2-apurado) | M | [003](../specs/003-home-nacional/) | `api/model/project.py` (`RESGATE_POR_APURADO`), `data-pipeline/simulacao-gerar.ts` (`selecionarComResgate`) | unit (`test_resgate_por_apurado.py`, 9 casos: resgata o 1º e o 2º do apurado, entram DEPOIS do prefixo, saem da cauda, ordens concordantes não resgatam nada, ausência de `pct_atual` não resgata pelo id, o 3º do apurado não entra) — **6 mutações mortas**, 2 delas só depois de casos escritos por exigência da própria mutação. Espelho TS em `tests/unit/data-pipeline/selecionar-com-resgate.test.ts` (`selecionarComResgate`, 7 casos, **6 mutações mortas**) — a regra existe em dois idiomas e testar um lado só prova metade |
| RF-191 | A ficha do mapa reordena pela base ativa, e o `<VagaBadge>` segue junto | M | [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [006](../specs/006-grid-governadores/), [016](../specs/016-senador/) | `<StateResultSheet />`, `lib/utils/lider-por-base.ts` | unit (`StateResultSheet.ordemPorBase.test.tsx`, 9 casos: ordem por base com as duas ordens OPOSTAS por construção, degradação sem `pct_atual`, rótulo e `aria-label` nomeando a base realmente usada, dupla eleita muda de ALFA+BETA para DELTA+GAMA, 1 vaga não ganha selinho) — **4 mutações mortas**, 1 equivalente documentada. ⚠️ A mutação `liderIdPorBase → row.lider` sobreviveu às 7 primeiras versões: a linha "Líder:" não era medida |
| RF-192 | O painel "Votação" renderiza em `/`, `/uf/[sigla]`, `/uf/[sigla]/governador`, `/uf/[sigla]/senador`, `/uf/[sigla]/deputado-federal`, imediatamente após `<ResultPanel>` (ou equivalente); ausente em `/governador`, `/senador`, `/deputado-federal` | M | [021](../specs/021-votacao-eleitorado/), [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [017](../specs/017-deputado-federal/) | `<VotacaoEleitorado />`, `app/` (5 rotas), `components/blocks/` (integração) | unit (`VotacaoEleitorado.test.tsx`, cobertura transversal de renderização em telas nacionais e de UF); integration (`tests/integration/uf-governador-page.test.tsx`, telas de UF rendeirizam Votação depois de ResultPanel) |
| RF-200 | O painel "A corrida" renderiza imediatamente após "Votação" nas rotas `/`, `/uf/[sigla]`, `/uf/[sigla]/governador`, `/uf/[sigla]/senador`; ausente em `/governador`, `/senador`, `/deputado-federal` | M | [022](../specs/022-corrida-em-tres-circulos/), [003](../specs/003-home-nacional/), [004](../specs/004-pagina-uf-presidencial/), [005](../specs/005-pagina-uf-governador/), [021](../specs/021-votacao-eleitorado/) | `<CorridaTresCirculos />`, `app/` (4 rotas), `components/blocks/` (integração) | unit (`CorridaTresCirculos.test.tsx`, cobertura transversal de posicionamento em testes de states/rendering); integration (`uf-governador-corrida-inteira.test.tsx`, integração na tela UF) |
| RF-201 | Por candidatura quando há uma corrida só; por partido quando há 27 (nível nacional de Governador/Senador) | M | [022](../specs/022-corrida-em-tres-circulos/) | `api/model/project.py` (`somar_corrida_por_partido`, `montar_corrida_nacional`), `<CorridaTresCirculos />` (modo renderização) | unit (`CorridaTresCirculos.test.tsx`, bloco "RF-201 — candidatura e partido", 2+ casos); unit (`test_corrida.py`, `test_gov_sen_nacional_por_partido_so_valido`, `test_gov_sen_uma_candidatura_pendente_em_uma_uf_omite_a_soma`) |
| RF-202 | As quatro candidaturas de mais votos válidos, ordem decrescente, mais "Outros"; desempate por ID/sigla crescente; "Outros" some se não há demais | M | [022](../specs/022-corrida-em-tres-circulos/) | `api/model/project.py` (`extrair_corrida`), `<CorridaTresCirculos />` | unit (`CorridaTresCirculos.test.tsx`, bloco "RF-202 — as fatias da corrida", 5+ casos: quatro+Outros, desempate por número, desempate por sigla, Outros some com <5 válidas) |
| RF-203 | Somente votos de candidaturas com destinação `valido` entram em fatia de candidatura; `anulado` e `sub_judice` vão para "Anulados e sub judice" (círculos 2 e 3) | M | [022](../specs/022-corrida-em-tres-circulos/) | `api/model/project.py` (`destino_do_dvt`, filtro por `dvt`), `<CorridaTresCirculos />` (renderização) | unit (`CorridaTresCirculos.test.tsx`, bloco "RF-203 — só voto válido entra em fatia com nome", 4 casos: sub judice mais votada fica fora, nem anulado/sub judice/sem destino entram, no render não aparecem em legenda, vão para círculos 2/3) |
| RF-204 | Círculo 1 (válidos): usa `contagens.validos` como base e exibe fatias RF-202; se soma ≠ base, exibe "não fecha" | M | [022](../specs/022-corrida-em-tres-circulos/) | `api/model/project.py` (agregação), `<CorridaTresCirculos />` (círculo 1) | unit (`CorridaTresCirculos.test.tsx`, bloco "RF-204..206 — cada círculo fecha na sua base", casos: fechamento exato, não fecha por 1 voto → null, fatia negativa com soma batendo → null, "não fecha" no DOM) |
| RF-205 | Círculo 2 (votantes): usa `contagens.comparecimento` como base; exibe fatias RF-202 mais Votos em branco, Votos nulos, Anulados e sub judice (não pode desdobrar: sai de `contagens`) | M | [022](../specs/022-corrida-em-tres-circulos/) | `api/model/project.py` (agregação de `contagens`), `<CorridaTresCirculos />` (círculo 2) | unit (`CorridaTresCirculos.test.tsx`, bloco "RF-204..206", casos: fechamento `comparecimento`, anulados distintos de nulos) |
| RF-206 | Círculo 3 (eleitorado): usa `contagens.aptos` como base; exibe fatias círculo 2 mais Abstenção e Ainda não apurado (`aptos − instalados`) | M | [022](../specs/022-corrida-em-tres-circulos/) | `api/model/project.py` (agregação de `contagens`), `<CorridaTresCirculos />` (círculo 3) | unit (`CorridaTresCirculos.test.tsx`, bloco "RF-204..206", casos: fechamento em `aptos`, "Ainda não apurado" como diferença, círculo 3 apurado não projetado) |
| RF-207 | Ausência do payload: `<DetailUnavailable>`; aguardando destinação (destino ausente ou `destino_pendente=true`): "aguardando a separação" no DOM; `contagens.validos == 0`: círculos sem votos apurados; Senador: "aguardando" sempre (RF-210); resto: apurando (RF-204..206) | M | [022](../specs/022-corrida-em-tres-circulos/) | `api/model/project.py` (publicar `destino_pendente`), `<CorridaTresCirculos />` (condicionalização de estado) | unit (`CorridaTresCirculos.test.tsx`, bloco "RF-207 — os estados, e nenhum fabrica zero", 4+ casos: ausência vs. zerado vs. aguardando vs. apurando, nunca fabrica zero) |
| RF-208 | Cada círculo exibe absoluto e percentual por fatia, com `<figcaption>` nomeando a base; metodologia declara que círculos vêm do agregado TSE e podem diferir por um ciclo dos votos da lista | M | [022](../specs/022-corrida-em-tres-circulos/) | `<CorridaTresCirculos />` (rótulos de base), documentação (metodologia no componente ou spec) | unit (`CorridaTresCirculos.test.tsx`, bloco "RF-208 — base e fonte declaradas", casos: figcaption nominada, rótulos de percentual) |
| RF-209 | Payload publica `votacao.corrida` (por candidatura com `vap` e `dvt`) ou `votacao.corrida_por_partido` (Governador/Senador nacional, soma por sigla); `votacao.destino_pendente: true` quando alguma candidatura `vap > 0` está sem destinação; mapeamento de `dvt` sem default, desconhecido ⇒ sem `destino` + aviso no log | M | [022](../specs/022-corrida-em-tres-circulos/) | `api/model/project.py` (`montar_corrida_nacional`, `build_votacao_uf_payloads`, mapeamento `dvt`), `lib/edge-config/types.ts` (contrato `votacao.corrida`/`corrida_por_partido`) | unit (`test_corrida.py`, 15+ casos: mapeamento de dvt (conhecido/ausente/desconhecido), captura real fecha em `vv`/`vansj`, ordem por id, presidencial vs. gov/sen, pendente só com voto, destinação ausente marca pendente, UF agregada); unit (`votacao-corrida-bytes.test.ts`, 5 casos: bytes por UF e globais) |
| RF-210 | Senador: renderiza os três círculos em "aguardando" sempre no DOM (bloqueio da tela até medição real) | M | [022](../specs/022-corrida-em-tres-circulos/), [016](../specs/016-senador/) | `<CorridaTresCirculos />` (renderização condicional por cargo) | unit (`CorridaTresCirculos.test.tsx`, bloco "RF-210 — Senado em 'aguardando'", casos: cargo 5 em aguardando independente de estado do payload) |

---

## Comportamentos entregues sem RF formal (2026-09-19/20)

Estes 15 itens existem em código desde 2026-09-19 (6 itens) e 2026-09-20 (9 itens), mas não 
têm RF correspondente. Registrados aqui para visibilidade — **cada um é uma dívida de especificação** 
(falta RF ou RF é genérico demais) ou um **padrão novo que merece formalização**.

### De 2026-09-19 (balão do mapa, hemiciclo)

1. Balão do mapa com 4 candidatos + linha "Outros" (compos `top_candidatos[0..3]` + `others_count`)
2. Balão com flip vertical quando próximo à borda (prevenção de clip)
3. Mapa municipal de Senador no nível UF (coroplético + lista)

### De 2026-09-20 (paginação, ordem, marca)

Os itens 4–12 de 2026-09-20 foram formalizados como **RF-180 a RF-188**. Consulte a matriz acima.

🔴 **Emenda da 4ª sessão de 20/09.** Três entradas acima descreviam o
comportamento ANTERIOR e foram corrigidas, não acrescentadas:

- **RF-180** dizia "o traço marca a base não-ativa" e citava "dois traços, um
  por base". A 2ª rodada de decisões do dono, no mesmo dia, deixou UM
  preenchimento (sempre o apurado) e UM traço (sempre a projeção, só na visão
  Projeção). A spec foi reescrita em `4774f96`; esta matriz ficou uma sessão
  atrás.
- **RF-177** ganhou a reordenação do balão pela base ativa e o teste que a
  cobre.
- **RF-189** é novo: *a cor e a intensidade do mapa seguem a base ativa*. O
  comportamento **não existia** — `row.lider` e `top_candidatos[0].id` vêm do
  mesmo `ordered[0]` ordenado por `pct_projetado` (`api/model/project.py`),
  então o ternário que "escolhia" a base tinha dois braços idênticos, e
  `margem_atual`/`margem_projetada` recebem a mesma variável. Corrigido em
  `b3029e8`, com o RF escrito depois do código — inversão da ordem que o SDD
  pede, registrada aqui em vez de escondida.

### Comportamentos que NÃO foram formalizados como RF (2026-09-20)

Três itens mencionados no briefing não se enquadram em RF (requisito funcional de comportamento observável do usuário) e receberam cobertura alternativa:

1. **Percentual em pt-BR com vírgula decimal** — Não é RF; é **restrição de localização (Constituição § 2)**. Cobertura: `tests/unit/lib/format.test.ts` (56 casos: separador, arredondamento, casas decimais). Os cinco pontos de formatação percentual do codebase (`formatPercentTrim()`, `formatPercent()`, etc.) convergem para este único testador.

2. **Cor de candidatura NUNCA vem da posição na lista** — Não é RF; é **restrição arquitetural (ADR-0024 supersedes ADR-0013)**. Cobertura: `tests/unit/components/cor-nunca-da-posicao.test.ts` (varredura negativa estrutural: `colorForRank`, `bandForRank`, `strongForRank`, `rankFromColorVar`, tokens literais `var(--color-cand-N)` proibidos em `app/`, `components/`, `lib/`). Complementos: `cor-nunca-do-payload.test.ts` (varredura de leitura do campo `.cor`), `candidate-color.test.ts` (contrato de `candidateColor()`).

3. **Votos por município na lista + três estados (desconhecido / não sabemos / apurando)** — Já coberto por **RF-037 "Tabela de municípios"** (em traceability) + **RF-182 "Paginação"** (novo). Cobertura adicional: `tests/unit/components/MunicipioTable.votos.test.tsx` (largura sem truncamento, orçamento de glifos medidos), `tests/unit/lib/municipio-votos.test.ts` (três estados de voto: ausência vs. zero medido).

---

## Como manter atualizado

A cada PR que altera escopo (novo RF, mudança de prioridade, mudança de componente):

1. Atualizar o frontmatter da spec afetada.
2. Atualizar esta matriz.
3. Atualizar `index.json` se mudou estado de spec.

## Cross-refs

- Convenções: [./conventions.md](./conventions.md)
- Index JSON: [./index.json](./index.json)
