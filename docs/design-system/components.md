---
title: Catálogo de Componentes
description: Catálogo de componentes com referência cruzada a RFs, arquivo real e teste
status: stable
source: PRD.md § 14.3
last_updated: 2026-09-18
---

# Catálogo de Componentes

> **Regra deste arquivo**: a coluna `Arquivo` só contém caminhos **verificados no disco**.
> Um componente que ainda não existe entra com status `planejada` e caminho *previsto*
> entre parênteses — nunca como se estivesse pronto. Saneado em 2026-09-05 (S07/Fase 3)
> após o catálogo acumular 8 entradas fantasma, 5 caminhos errados e 6 linhas duplicadas.

**Legenda de status**

| Status | Significado |
|---|---|
| ✅ | Arquivo existe no disco |
| 🕐 planejada | Componente ainda não construído; há RF vivo apontando para ele |
| ⛔ substituída | Nome mantido só porque `traceability.md`/specs ainda o citam; a função é cumprida por outro componente |

## Atoms

| Componente | Status | RFs atendidos | Arquivo | Testes |
|---|---|---|---|---|
| `<Needle />` | ✅ | RF-021, RF-039 | `components/atoms/needle/Needle.tsx` | `tests/unit/components/Needle.test.tsx` |
| `<CandidateBar />` | ✅ | RF-022, RF-023 | `components/atoms/bars/CandidateBar.tsx` | `tests/unit/components/CandidateBar.test.tsx` |
| `<ProjectionThermometer />` | ✅ S07 | RF-061, RF-062 | `components/atoms/bars/ProjectionThermometer.tsx` | `tests/unit/components/ProjectionThermometer.test.tsx` |
| `<TimeSeriesChart />` | ⛔ órfão | ~~RF-040~~ | `components/atoms/charts/TimeSeriesChart.tsx` | tests existem mas sem call site em produção |
| `<ProbabilityOverTime />` | ⛔ órfão | ~~RF-041~~ | `components/atoms/charts/ProbabilityOverTime.tsx` | tests existem mas sem call site em produção |
| `<TurnoutAreaChart />` | ⛔ órfão | ~~RF-042~~ | `components/atoms/charts/TurnoutAreaChart.tsx` | tests existem mas sem call site em produção |
| `<SerieApuracaoChart />` | ✅ S07 | RF-170, RF-171, RF-172, RF-173, RF-174, RF-175, RF-176 | `components/atoms/charts/SerieApuracaoChart.tsx` | `tests/unit/components/serie-apuracao-chart.test.tsx` (24 casos; 5 mutações aplicadas e mortas). **Integrado**: call site nas 4 rotas (`/`, `/uf/[sigla]`, `/uf/[sigla]/governador`, `/uf/[sigla]/senador`). Hoje renderiza os estados sem série (Fase 0); a série real chega na Fase 2. ⚠️ **2026-09-18 ([ADR-0047](../architecture/adrs/0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) D1)**: o `stroke` e o ponto final saem de `textForParty`, nunca de `colorForParty` — o traço é objeto gráfico (SC 1.4.11, piso 3:1) e 4 bases reprovam esse piso no tema claro. Gate no bloco “T8” |
| `<ChoroplethMapUF />` | ✅ | RF-034, RF-036 | `components/atoms/maps/ChoroplethMapUF.tsx` | — (sem teste dedicado) |
| `<BubbleMap />` | ⛔ órfão | ~~RF-035~~ | `components/atoms/maps/BubbleMap.tsx` | — (sem teste dedicado) |
| `<SwingArrowMap />` | ⛔ órfão | ~~RF-038~~ | `components/atoms/maps/SwingArrowMap.tsx` | — (sem teste dedicado) |
| `<MapSkeleton />` | ✅ | (ADR-0010 — placeholder de carga do chunk MapLibre) | `components/atoms/maps/MapSkeleton.tsx` | `tests/unit/components/MapSkeleton.test.tsx` |
| `<MapPlaceholder />` | ✅ | (ADR-0010 — fallback client dos wrappers dinâmicos) | `components/atoms/maps/MapPlaceholder.tsx` | — (sem teste dedicado) |
| `<CandidateRow />` | ✅ | RF-033 | `components/atoms/tables/CandidateRow.tsx` | `tests/unit/components/CandidateRow.test.tsx` |
| `<CandidateResultRow />` | ✅ S08 | RF-033 ext (ADR-0029 § 7 — parcial/projeção lado a lado; ADR-0055 D27 — versão D com cartões top-2 + linhas demais, selo em pílula) | `components/atoms/tables/CandidateResultRow.tsx` | `tests/unit/components/CandidateResultRow.test.tsx`, `ResultPanel.versaoD.test.tsx` |
| `<SeloPilula />` | ✅ S08 | (ADR-0055 — selo em pílula escura nos dois primeiros candidatos da base ativa) | `components/atoms/tables/CandidateResultRow.tsx` (exported) | coberto por `ResultPanel.versaoD.test.tsx`, `ResultPanel.test.tsx` |
| `<CandidateAvatar />` | ✅ | RF-151 | `components/atoms/data/CandidateAvatar.tsx` | `tests/unit/components/CandidateAvatar.test.tsx`. ⚠️ Spec 018 e `traceability.md` citam `<CandidatoAvatar>` (português) — nome divergente, mesmo componente |
| `<DestinoEtiqueta />` | ✅ | (spec 022 RF-203..205 — rótulo interno de destino do voto: válido/anulado/sub judice) | `components/atoms/data/DestinoEtiqueta.tsx` | unit (`tests/unit/design-system/destino-etiqueta-contraste.test.tsx`) |
| `<WinnerBanner />` | ✅ | RF-032 | `components/atoms/banners/WinnerBanner.tsx` | `tests/unit/components/WinnerBanner.test.tsx` |
| `<DadoParadoBanner />` | ✅ | (ADR-0038 D4 — degradação graceful quando `dado_ts` excede limiar por cargo) | `components/atoms/banners/DadoParadoBanner.tsx` | `tests/unit/components/DadoParadoBanner.test.tsx` |
| `<FasePreEleicaoBanner />` | ✅ S08 | RF-160 (spec 019) | `components/atoms/banners/FasePreEleicaoBanner.tsx` | `tests/unit/pages/fase-pre-eleicao.test.tsx`, bloco «RF-160» |
| `<NewsClippingPlaceholder />` | ⛔ órfão | (spec 004 — slot visual, sem RF formal) | `components/atoms/banners/NewsClippingPlaceholder.tsx` | tests não existem; componente órfão desde 08/09 |
| `<TurnoBadge />` | ✅ S05 | RF-030 ext | `components/atoms/badges/TurnoBadge.tsx` | `tests/unit/components/TurnoBadge.test.tsx` |
| `<RaceTypeIndicator />` | ✅ S05 | RF-030 ext | `components/atoms/badges/RaceTypeIndicator.tsx` | `tests/unit/components/RaceTypeIndicator.test.tsx` |
| `<MinorCandidatesList />` | ✅ S05 | RF-030 ext, RF-031..044 ext | `components/atoms/lists/MinorCandidatesList.tsx` | `tests/unit/components/MinorCandidatesList.test.tsx` |
| `<MapViewToggle />` | ✅ | RF-030.2 | `components/atoms/controls/MapViewToggle.tsx` | `tests/unit/components/MapViewToggle.test.tsx` |
| `<BaseToggle />` | ✅ S07 (não integrado) | RF-062 (E2b) | `components/atoms/controls/BaseToggle.tsx` | `tests/unit/components/BaseToggle.test.tsx` |
| `<ViewModeSwitch />` | ✅ S08 | RF-172 (spec 020, ADR-0029 § 2) | `components/atoms/controls/ViewModeSwitch.tsx` | coberto por `tests/unit/components/serie-apuracao-chart.test.tsx` (os dois grupos `data-view-only`); sem teste unit dedicado |
| `<Tabs />` | ✅ | RF-029, RF-030, RF-006.5 | `components/atoms/controls/Tabs.tsx` | `tests/unit/components/Tabs.test.tsx`, `Tabs.disabled.test.tsx` |
| `<UFBreadcrumb />` | ✅ | RF-031, RF-063 | `components/atoms/nav/UFBreadcrumb.tsx` | `tests/unit/components/UFBreadcrumb.test.tsx` |
| `<TrilhaKicker />` | ✅ S07 | RF-063 | `components/atoms/nav/TrilhaKicker.tsx` | `tests/unit/components/TrilhaKicker.test.tsx` |
| `<ExtrapolationIllustration />` | ✅ | (spec 011) | `app/sobre-o-modelo/page.tsx` (função local, não é arquivo próprio) | — (coberto por SSR da página) |
| `<ConfidenceBandIllustration />` | ✅ | (spec 011) | `app/sobre-o-modelo/page.tsx` (função local) | — |
| `<NeedleIllustration />` | ✅ | (spec 011) | `app/sobre-o-modelo/page.tsx` (função local) | — |
| `<ConfidenceBar />` | 🕐 planejada | RF-023 | *previsto*: `components/atoms/bars/ConfidenceBar.tsx` | — |
| `<DotPlotRange />` | 🕐 planejada | RF-025 | *previsto*: `components/atoms/charts/DotPlotRange.tsx` | — |
| `<ModelComposition />` | 🕐 planejada | RF-043 | *previsto*: `components/atoms/charts/ModelComposition.tsx` | — |
| `<ChoroplethMap />` | ⛔ substituída | RF-034, RF-036, RF-038 | — | — |
| `<EtiquetaEditorial />` | ✅ S09 | RF-235, RF-236, RF-245, RF-246 | `components/atoms/data/EtiquetaEditorial.tsx` | `tests/unit/design-system/etiqueta-editorial-contraste.test.tsx` |
| `<EtiquetasLinha />` | ✅ S09 | RF-235, RF-236, RF-245, RF-246 | `components/atoms/data/EtiquetasLinha.tsx` | (coberto pela linha que a exporta) |
| `<EtiquetaFiltro />` | ✅ S09 | RF-247 | `components/atoms/controls/EtiquetaFiltro.tsx` | `tests/unit/design-system/etiqueta-filtro-*.test.tsx` (comportamento do `<select>` nativo) |

Notas dos atoms não construídos:

- `<ConfidenceBar />` — RF-023 é hoje atendido por `<HeadlineScore />` + `<CandidateBar />`
  (`role="meter"` com IC95 no rodapé) e, no 1º turno, por `<ProjectionThermometer />`.
  Mantido como planejado porque RF-023 segue vivo em `traceability.md`.
- `<DotPlotRange />` e `<UFForecastTable />` — RF-025 está **deferido** desde S05
  (`docs/specs/003-home-nacional/spec.md:15`, `tasks.md:94`): a spec 003 entrega dot-plot
  inline via `<StateGroupedTable />`.
- `<ModelComposition />` — RF-043 é hoje atendido por `<ForecastTransparency />` (shipped,
  com teste). Mantido como planejado porque `traceability.md:85` ainda o lista.
- `<ChoroplethMap />` — nunca existiu como arquivo. O mapa de UF em granularidade de
  município é `<ChoroplethMapUF />` (`mode='leader'` → RF-034, `mode='estimate'` → RF-036);
  o swing é `<SwingArrowMap />` (RF-038). Linha mantida só porque `traceability.md:76,78,80`
  e `docs/specs/005-pagina-uf-governador/spec.md:12` ainda a citam.

## Blocks

| Componente | Status | RFs atendidos | Arquivo | Testes |
|---|---|---|---|---|
| `<NationalNeedle />` | ✅ | RF-021, RF-022, RF-023 | `components/blocks/NationalNeedle.tsx` | `tests/unit/components/NationalNeedle.test.tsx` |
| `<HeadlineScore />` | ✅ | RF-022, RF-023, RF-030.5 | `components/blocks/HeadlineScore.tsx` | `tests/unit/components/HeadlineScore.test.tsx` |
| `<ProjectionThermometers />` | ✅ S07 | RF-061, RF-062 | `components/blocks/ProjectionThermometers.tsx` | `tests/unit/components/ProjectionThermometers.test.tsx` (testa `base` prop Fase 5) |
| `<NationalChoroplethMap />` | ✅ | RF-030.1-4 (Presidente), RF-006.3 (Governador), RF-104-106 (Senador — intensidade de cor, nome acessível); layout do cromo em fluxo no celular (ADR-0056) | `components/blocks/NationalChoroplethMap.tsx` | `tests/unit/components/NationalChoroplethMap.test.tsx` |
| `<_NationalChoroplethMapImpl />` | ✅ | RF-030.1..RF-030.4 (interno — só via `next/dynamic`, ADR-0010) | `components/blocks/_NationalChoroplethMapImpl.tsx` | coberto por `NationalChoroplethMap.test.tsx` |
| `<StateGroupedTable />` | ✅ | RF-030.6 | `components/blocks/StateGroupedTable.tsx` | `tests/unit/components/StateGroupedTable.test.tsx` |
| `<DecisiveUFsGrid />` | ⛔ órfão | ~~RF-024~~ | `components/blocks/DecisiveUFsGrid.tsx` | tests existem mas sem call site em produção |
| `<UFMapDuo />` | ⛔ órfão | ~~RF-035, RF-036~~ | `components/blocks/UFMapDuo.tsx` | — (sem teste dedicado) |
| `<UfMapsLazy />` | ⛔ órfão | ~~RF-034, RF-035, RF-036, RF-038~~ | `components/blocks/UfMapsLazy.tsx` | — (sem teste dedicado); exports `UfMapDuoLazy`/`UfSwingArrowMapLazy` órfãos |
| `<MunicipioTable />` | ✅ S07 | RF-005.4, RF-037 | `components/blocks/MunicipioTable.tsx` | `tests/unit/components/MunicipioTable.test.tsx` (paginação: 20 + 40 por toque, `aria-rowcount` total, foco), `MunicipioTable.ordem.test.tsx` (ordem por eleitorado desc; município sem eleitorado vai para o fim, nunca para fora). **2026-09-20**: os modos `default` (virtualizado) e `top-by-eleitorado` foram SUBSTITUÍDOS por um modo único, e as três rotas de estado o consomem igual — ver o cabeçalho do `.tsx`. `MunicipioTable.topByEleitorado.test.tsx` foi apagado junto com o modo. |
| `<MunicipioExplorer />` | ✅ S07 | (painel de folha de município com figura "Eleitores", novo em S07 ADR-0035) | `components/blocks/MunicipioExplorer.tsx` | `tests/unit/components/MunicipioExplorer.test.tsx`. **2026-09-20**: passou a ser montado também em `/uf/[sigla]/senador` — até então aquela rota escrevia no `useMunicipioSheetStore` (clique no mapa) sem ter leitor, e a folha nunca abria. As props `tableMode`/`topN` saíram. |
| `<MunicipioWaffleGrid />` | ✅ S06 | RF-005.2 | `components/blocks/MunicipioWaffleGrid.tsx` | `tests/unit/components/MunicipioWaffleGrid.test.tsx` |
| `<ForecastTransparency />` | ✅ S07+ | RF-043, RF-108 | `components/blocks/ForecastTransparency.tsx` | `tests/unit/components/ForecastTransparency.test.tsx` (S07: refator para props `granularidade` + `cadenciaMinutos` permitir cadência variável por cargo — 60s Presidente, 300s Senador; ⚠️ **não usado em Deputado Federal** conforme design.md D9: cargo 6 sem modelo, só aritmética do ADR-0027 sobre voto apurado, cadência vem do payload via `<DeputadoMetodologia />`) |
| `<InsightCard />` | ✅ | RF-044 | `components/blocks/InsightCard.tsx` | `tests/unit/components/InsightCard.test.tsx` |
| `<ApuracaoMeta />` | ✅ | RF-026 | `components/blocks/ApuracaoMeta.tsx` | `tests/unit/components/ApuracaoMeta.test.tsx` |
| `<NationalWinnerBanner />` | ✅ | RF-032 (variante nacional) | `components/blocks/NationalWinnerBanner.tsx` | `tests/unit/components/NationalWinnerBanner.test.tsx` |
| `<RunoffScenarios />` | ⛔ órfão | ~~RF-030.9~~ | `components/blocks/RunoffScenarios.tsx` | tests existem mas sem call site em produção |
| `<TurnoOneRecap />` | ✅ S06 | (ADR-0016 — sem RF formal) | `components/blocks/TurnoOneRecap.tsx` | `tests/unit/components/TurnoOneRecap.test.tsx` |
| `<TwoRoundIndicator />` | ⛔ órfão | ~~RF-030.7~~ | `components/blocks/TwoRoundIndicator.tsx` | tests existem mas sem call site em produção (RF-030.7 migrou para `<ChancesPanel />`) |
| `<CandidateRanking />` | ✅ S05 | RF-030 ext, RF-031..044 ext (rank 3–6) | `components/blocks/CandidateRanking.tsx` | `tests/unit/components/CandidateRanking.test.tsx` |
| `<GovernorCard />` | ✅ S06 | RF-006.3, RF-006.8 (selo com desfecho); também em `/senador` com `cargo="sen"`, sem selo (spec 016, nota 27/09); e na home `/` como consolidado regional de Presidente com `cargo="pres"` (ADR-0057, S09, variante sem selo) | `components/blocks/GovernorCard.tsx` | `tests/unit/components/GovernorCard.test.tsx` |
| `<RegiaoConsolidada />` | ✅ S09 | (ADR-0057 — consolidado visual de região IBGE: cabeçalho com nome, "N estados", líder regional, %, barra empilhada 100% e legenda) | `components/blocks/RegiaoConsolidada.tsx` | `tests/integration/capas-regioes.test.tsx` |
| `<RegiaoRecolhivel />` | ✅ S09 | (ADR-0057 — wrapper que colapsa/expande os cards de estado de uma região com `aria-expanded` no botão; reutiliza padrão de ADR-0017/ADR-0034 D21) | `components/blocks/RegiaoRecolhivel.tsx` | `tests/integration/capas-regioes.test.tsx` |
| `<HexCartogramBrasil />` | ✅ S06 — sem uso em `/governador` | RF-006.3 (histórico pré-ADR-0048) | `components/blocks/HexCartogramBrasil.tsx` | `tests/unit/components/HexCartogramBrasil.test.tsx` (verde, preservado por decisão explícita do dono) |
| `<RaceStatsCards />` | ✅ S06 | RF-006.1 | `components/blocks/RaceStatsCards.tsx` | `tests/unit/components/RaceStatsCards.test.tsx` |
| `<BreakingNewsTicker />` | ✅ S06 | RF-006.4 | `components/blocks/BreakingNewsTicker.tsx` | `tests/unit/components/BreakingNewsTicker.test.tsx` |
| `<GovernadoresPlacarTurno />` | ✅ S08 | RF-006.6 (2026-09-27) | `components/blocks/GovernadoresPlacarTurno.tsx` | `tests/unit/components/GovernadoresPlacarTurno.test.tsx` (placar 1º × 2º turno nas duas bases: projeção vs. contagem) |
| `<GovernadoresPorPartido />` | ✅ S08 | RF-006.7 (2026-09-27) | `components/blocks/GovernadoresPorPartido.tsx` | `tests/unit/components/GovernadoresPorPartido.test.tsx` (desfecho por partido nas duas bases com barra dividida) |
| `<ResultPanel />` | ✅ S07+ | RF-022, RF-023, RF-030.5, RF-030.6, RF-030.8, RF-105, RF-127 | `components/blocks/ResultPanel.tsx` | `tests/unit/components/ResultPanel.test.tsx` (S07: refator para duas vagas em Senador com marcação visual de ocupantes + margem 2º↔3º em Senador e `eleitos` em Deputado; a altura de linha e spacing para destacar a 2ª vaga no Senador está definida em tokens e no componente via `role="region"` com `aria-label="Ocupantes das vagas"`). **2026-09-27 (ADR-0055)**: lista vira top-2 em cartões lado a lado (foto 48px, % 32px mono, barra 12px com marca de projeção, selo pílula) + demais em linhas (foto 44px, % 20px, barra 8px, sem selo). Novos testes: `ResultPanel.versaoD.test.tsx`, `lista-resultado-contraste.test.ts`. |
| `<CandidateListCollapse />` | ✅ S07 | RF-030.8 (colapso visual preservando DOM, ADR-0034 D21) | `components/blocks/CandidateListCollapse.tsx` | coberto por `ResultPanel.test.tsx` |
| `<ReordenaListaPorBase />` | ✅ S08 | RF-181 (reordenação no DOM conforme base ativa, ADR-0051) | `components/blocks/ReordenaListaPorBase.tsx` | `tests/unit/components/ReordenaListaPorBase.test.tsx` (10 casos: reordenação real no DOM, foco preservado, idempotência, fase pré intocada, ausência de regra `order` em globals.css) |
| `<ChancesPanel />` | ✅ S07+ | RF-030.7, RF-107 (migrado de `TwoRoundIndicator`, ADR-0034 D21) | `components/blocks/ChancesPanel.tsx` | `tests/unit/components/ChancesPanel.test.tsx` (S07: refator para exibir composição de vagas projetadas por partido/federação em Senador nível nacional (54 vagas) e para Deputado também exibir `eleitos` por agremiação) |
| `<DeputadoMetodologia />` | ✅ S07 | RF-127, RF-128 | `components/blocks/DeputadoMetodologia.tsx` | — (Server Component sem testes dedicados; integrado em rotas de Deputado Federal). ⚠️ Propósito: explicar por que o cargo 6 **não usa** `<ForecastTransparency>` (design.md § D9) — não há modelo, só aritmética do ADR-0027 sobre voto apurado. Cadência (RF-128) vem do payload, nunca literal. |
| `<NationalMapBlock />` | ✅ S07+ | RF-030.1-4 (Presidente, refator layout ADR-0033, cromo em fluxo mobile ADR-0056), RF-006.3 (Governador, ADR-0048, cromo em fluxo mobile ADR-0056), RF-104-106 (Senador, ADR-0048, cromo em fluxo mobile ADR-0056) | `components/blocks/NationalMapBlock.tsx` | — (não tem componente separado de teste; coberto pelo smoke de home e governador/senador pages) |
| `<CandidatosGrid />` | ✅ | RF-146, RF-148, RF-149 | `components/blocks/CandidatosGrid.tsx` | `tests/unit/components/CandidatosGrid.test.tsx` |
| `<CandidaturasFonte />` | ✅ | RF-150 | `components/blocks/CandidaturasFonte.tsx` | — (sem teste dedicado; coberto indiretamente por `tests/unit/pages/candidatos.test.tsx`) |
| `<CandidaturasAguardando />` | ✅ S08 | RF-149 (compõe `<CandidatosGrid>` nos 4 estados de espera) | `components/blocks/CandidaturasAguardando.tsx` | `tests/unit/pages/aguardando-candidatos.test.tsx` |
| `<UfLinksGrid />` | ✅ S08 | RF-162, RF-163 (spec 019) | `components/blocks/UfLinksGrid.tsx` | `tests/unit/pages/fase-pre-eleicao.test.tsx`, bloco «RF-162 / RF-163»; `tests/integration/simulacao-gates.test.tsx` |
| `<RemainingPanel />` | ✅ | RF-154 (spec 019 — some inteiro em fase pré) | `components/blocks/RemainingPanel.tsx` | `tests/unit/components/RemainingPanel.test.tsx` |
| `<BulletinPanel />` | ✅ | RF-026, RF-044, RF-154 (spec 019 — some inteiro em fase pré) | `components/blocks/BulletinPanel.tsx` | `tests/unit/components/BulletinPanel.test.tsx` |
| `<CamaraHemiciclo />` | ✅ S07 | RF-131 | `components/blocks/CamaraHemiciclo.tsx` | `tests/unit/components/CamaraHemiciclo.test.tsx`, `tests/unit/components/camara-hemiciclo-peso.test.tsx` (ADR-0049: 513 cadeiras com arcos fixos, 12 linhas; estado indefinida com anel colorido; ordem por tamanho de bancada) |
| `<VotacaoEleitorado />` | ✅ S08 | RF-192, RF-193, RF-193b, RF-194, RF-195, RF-196, RF-197, RF-198, RF-199 (spec 021) | `components/blocks/VotacaoEleitorado.tsx` | `tests/unit/components/VotacaoEleitorado.test.tsx` (17 casos: três círculos independentes, fechamento por base, percentuais, transição entre estados, projeção no círculo 3) |
| `<CorridaTresCirculos />` | ✅ S08 | RF-200, RF-201, RF-202, RF-203, RF-204, RF-205, RF-206, RF-207, RF-208, RF-209, RF-210 (spec 022) | `components/blocks/CorridaTresCirculos.tsx` | `tests/unit/components/CorridaTresCirculos.test.tsx` (46 casos: estados, desempate, fechamento, rótulos), `tests/unit/model/test_corrida.py` (39 casos: mapeamento de dvt, agregação por partido, pendência), `tests/unit/data-pipeline/simulacao-gerar.test.ts` (18 casos novos de corrida), `tests/unit/edge-config/votacao-corrida-bytes.test.ts` (5 casos de orçamento) |
| `<Hemiciclo />` | ✅ S09 | RF-216, RF-240, RF-241 (spec 023/025 — render genérico do hemiciclo por arcos, usado por `<CamaraHemiciclo>`, `<SenadoHemiciclo>` e `<HemicicloPorBloco>`) | `components/blocks/Hemiciclo.tsx` | `tests/unit/components/senado-hemiciclo-peso.test.tsx`, `tests/unit/components/hemiciclo-geometria.test.tsx` (ADR-0061 — marcas de limiar com desempate, contagem) |
| `<SenadoHemiciclo />` | ✅ S09 | RF-216, RF-217, RF-218 (spec 023 — hemiciclo de 81 cadeiras do Senado com quatro estados por cadeira; generalização da geometria de `CamaraHemiciclo`) | `components/blocks/SenadoHemiciclo.tsx` | coberto por `tests/unit/components/senado-hemiciclo-peso.test.tsx` |
| `<HemicicloPorBloco />` | ✅ S09 | RF-240, RF-241 (spec 025 V1/V2/Câmara 2027 — visão por bloco de governo Lula com marcas de limiar qualificadas, textura neutra, sem cor de partido) | `components/blocks/HemicicloPorBloco.tsx` | `tests/unit/components/hemiciclo-por-bloco.test.tsx` (textura, ordem fixa de blocos, placar qualificado dos limiares, ΔE neutro) |
| `<RealceHemiciclo />` | ✅ 03/10 | RF-294 (spec 008 — realce por grupo nos plenários, ligado à legenda, **zero JS**: CSS `:has()` com metade estática no módulo e uma regra por grupo num `<style>` emitido pelo servidor, dentro de `@media (hover: hover)`; envolve `<SenadoHemiciclo>` em `SenadoHemicicloPanel` (`data-partido`), `<CamaraHemiciclo>` + legenda em `/deputado-federal` (`data-cod`) e é o contêiner de `<HemicicloPorBloco>` (`data-bloco`)) | `components/blocks/RealceHemiciclo.tsx` + `.module.css`; CSS por chave em `lib/utils/realce-hemiciclo.ts` | `tests/unit/components/RealceHemiciclo.test.tsx` (chaves do CSS == `<g>` == `<li>`, nas três ligações), `tests/unit/lib/realce-hemiciclo.test.ts` (escape, dedupe) |
| `<LegendaHemicicloCamara />` | ✅ 03/10 | RF-294 (spec 008 — legenda compacta sob o plenário da Câmara: bolinha `textForParty(sigla_lider)` + sigla inteira + nº de cadeiras, ordem das cunhas, só quem tem cadeira, `aria-hidden`; ligada ao realce por `data-cod`) | `components/blocks/LegendaHemicicloCamara.tsx` + `.module.css` | `tests/unit/components/LegendaHemicicloCamara.test.tsx` (ordem, filtro, sigla, cor, teto de 8 KiB com o `<style>`) |
| `<SenadoDe2027Panel />` | ✅ S09 | RF-242, RF-243 (spec 025 V1/V2 — composição do Senado por bloco de governo para 2027, com placar de impeachment qualificado em V2) | `components/blocks/SenadoDe2027Panel.tsx` | (integrado; sem teste dedicado — coberto pelos testes de visão editorial em desenvolvimento) |
| `<Camara2027Panel />` | ✅ S09 | RF-244 (spec 025 — composição da Câmara por bloco de governo para 2027, por agremiação) | `components/blocks/Camara2027Panel.tsx` | (integrado; sem teste dedicado) |
| `<RenovacaoPanel />` | ✅ S09 | RF-249 (spec 025 V4 — renovação do Senado: quantas vagas mudaram de mãos, quantas trocaram de partido, lista de quem perdeu) | `components/blocks/RenovacaoPanel.tsx` | (integrado; sem teste dedicado) |
| `<PalanquesMapa />` | ✅ S09 | RF-251 (spec 025 V3 — mapa dos palanques presidenciais por estado com hachura, código e contorno casado/dividido) | `components/blocks/PalanquesMapa.tsx` | `tests/unit/design-system/palanques-mapa-contraste.test.tsx` (ΔE neutro, hachura visível, legibilidade do código) |
| `<EtiquetasAviso />` | ✅ S09 | RF-237, RF-248 (spec 024/025 — banner de aviso e link para `/sobre-as-etiquetas`; aparece uma vez por superfície com etiqueta) | `components/blocks/EtiquetasAviso.tsx` | (integrado; sem teste dedicado — coberto pelo portão de cobertura de etiquetas em desenvolvimento) |
| `<UFForecastTable />` | 🕐 planejada | RF-025 (deferido desde S05) | *previsto*: `components/blocks/UFForecastTable.tsx` | — |
| `<MaintenancePageMessage />` | 🕐 planejada | RF-058 | *previsto*: `components/blocks/MaintenancePageMessage.tsx` | — |
| `<TurnoTransitionBanner />` | 🕐 planejada | RF-058.1 | *previsto*: `components/blocks/TurnoTransitionBanner.tsx` | — |

`<MaintenancePageMessage />` e `<TurnoTransitionBanner />` pertencem à
[spec 013](../specs/013-pagina-manutencao/) (`status: ready`, não implementada).
`app/manutencao/` existe no disco apenas como diretório vazio com `.gitkeep`.

## Layout

| Componente | Status | RFs atendidos | Arquivo | Testes |
|---|---|---|---|---|
| `<RaceHeader />` | ✅ S07 | RF-063 | `components/layout/RaceHeader.tsx` | `tests/integration/home-page.test.tsx`, `governador-page.test.tsx`, `uf-governador-page.test.tsx`, `tests/unit/components/UFPage.test.tsx` |
| `<LiveBadge />` | ✅ | RF-026, RF-028 | `components/layout/LiveBadge.tsx` | `tests/unit/components/LiveBadge.test.tsx` |
| `<ShellLiveBadge />` | ✅ S08 | RF-159 (spec 019 — selo do topo do shell, ADR-0029 § 4) | `components/layout/ShellLiveBadge.tsx` | `tests/unit/components/ShellLiveBadge.test.tsx`; `tests/unit/pages/fase-pre-eleicao.test.tsx`, bloco (D) |
| `<CargoTabs />` | ✅ S07 | (navegação global de cargos do shell — substitui `<UFBreadcrumb>`, ADR-0034 D23, ADR-0025 § 2) | `components/layout/CargoTabs.tsx` | `tests/unit/components/CargoTabs.test.tsx` |
| `<Footer />` | ✅ | RF-055 | `components/layout/Footer.tsx` | `tests/unit/components/Footer.test.tsx` |
| `<AppShellSplit />` | ✅ S07 | (shell de duas colunas, ADR-0033) | `components/layout/AppShellSplit.tsx` | — (coberto por smoke de UF pages) |
| `<PersistentMapFrame />` | ✅ S07 | RF-030.1-4 (moldura persistente, ADR-0033 § 1); cromo em fluxo no celular em vez de overlay (ADR-0056) | `components/layout/PersistentMapFrame.tsx` | — (coberto por smoke de UF pages) |
| `<UfPicker />` | ✅ S07 | (controle de UF no shell, ADR-0033) | `components/layout/UfPicker.tsx` | — (coberto por smoke de UF navigation) |
| `<ThemeToggle />` | ✅ S07 | (tema claro/escuro no masthead; persistência em `localStorage`, nunca cookie — ADR-0025 § 5) | `components/atoms/controls/ThemeToggle.tsx` | `tests/unit/state/theme.test.ts`, `tests/unit/shell/static-shell.test.ts` |

## Shared

| Componente | Status | RFs atendidos | Arquivo | Testes |
|---|---|---|---|---|
| `<SWRProvider />` / `useProjection()` | ✅ | RF-027 | `components/shared/swr-provider.tsx` | — (sem teste dedicado) |
| `useMunicipioSheetStore` | ✅ S07 | (estado da folha de município entre o mapa e a página) | `components/shared/municipio-sheet-store.ts` | `tests/unit/components/MunicipioExplorer.test.tsx` |
| `selosDaBase()` | ✅ S08 | (ADR-0055 — calcula rótulo do selo conforme cargo, turno, rota e base ativa) | `lib/utils/selo-resultado.ts` | `tests/unit/utils/selo-resultado.test.ts` |
| `consolidarRegiao()` | ✅ S09 | (ADR-0057 — agrega votos de uma região IBGE por partido/candidato; retorna top-6 + "Outros" com base em votos em disputa) | `lib/utils/consolidado-regiao.ts` | `tests/unit/utils/consolidado-regiao.test.ts` |
| `<HoverTooltip />` | 🕐 planejada | RF-045, RF-048 | *previsto*: `components/shared/HoverTooltip.tsx` | — |
| `<BottomSheet />` | 🕐 planejada | RF-049, RF-050 | *previsto*: `components/shared/BottomSheet.tsx` | — |

`<HoverTooltip />` e `<BottomSheet />` pertencem à
[spec 008 — Interatividade (Brushing & Linking)](../specs/008-interatividade-brushing/),
que está em `status: draft` e foi **diferida para S08+** (decisão de fechamento da S05).
Continuam catalogadas porque RF-045, RF-048, RF-049 e RF-050 seguem vivos em
`traceability.md:87-92`.

## Componentes novos da S07/Fase 2 (hero 1T + trilhas)

Introduzidos nos commits `978929c` e continuados em Bloco 1, sob ADR-0018 (termômetros) e ADR-0019 (trilhas):

| Componente | Tipo | RF | O que faz |
|---|---|---|---|
| `<ProjectionThermometer />` | atom | RF-061, RF-062 | Trilho com faixa IC95, tick do projetado, marcador do apurado e **denominador rotulado**. `role="meter"`. |
| `<ProjectionThermometers />` | block | RF-061, RF-062 | Hero de seis termômetros no 1T (1º/2º/3º/Outros em % votos a votáveis; brancos-nulos em % comparecimento; abstenção em % eleitores das seções instaladas). `variant="participacao-only"` renderiza só os dois últimos. |
| `<TrilhaKicker />` | atom (nav) | RF-063 | Rótulo `PRESIDÊNCIA · Brasil › SP` / `GOVERNADOR · SP`, colorido por `--trilha-accent`. |
| `<RaceHeader />` | layout | RF-063 | Cabeçalho compartilhado pelas 4 rotas de corrida: breadcrumb + kicker + `<h1>` + LiveBadge/TurnoBadge + Tabs. |

Os denominadores e os tokens `--color-part-*` / `--trilha-accent*` estão em
[tokens.md](./tokens.md#participação-e-trilhas-s07fase-2).

---

## Componentes novos da Bloco 1 — Design system Atlas Menna (ADR-0024, ADR-0025)

Intoduzidos em 2026-09-07 para o redesign Atlas Menna (paleta por partido, tipografia nova, primitivos do kit):

### Atoms — Surfaces

| Componente | Tipo | Status | Papel | Arquivo | Cliente? |
|---|---|---|---|---|---|
| `<Panel />` | atom | ✅ | Superfície com padding padrão (space-4), borda, radius-md, shadow-float. Componente base para card, sidebar, drawer. | `components/atoms/surfaces/Panel.tsx` | RSC |
| `<DetailUnavailable />` | atom | ✅ | Estado "detalhe indisponível" de uma seção cuja fonte (Vercel Blob) não respondeu — texto explícito com o motivo, **sempre no DOM**, nunca escondendo o bloco (ADR-0032 item 3, ADR-0017). | `components/atoms/surfaces/DetailUnavailable.tsx` | RSC |
| `<DetailFreshness />` | atom | ✅ | Idade do detalhe vinda do `ts` próprio do objeto Blob, com a defasagem em minutos contra o `ts` do resumo quando ≥ 2 min (ADR-0032 — a UI não deve silenciar a diferença). | `components/atoms/surfaces/DetailUnavailable.tsx` | RSC |

### Atoms — Data

| Componente | Tipo | Status | Papel | Arquivo | Cliente? |
|---|---|---|---|---|---|
| `<Figure />` | atom | ✅ | Número em display (64px Spectral 600), com rótulo muted abaixo. Usa tabular-nums. | `components/atoms/data/Figure.tsx` | RSC |
| `<PartyTag />` | atom | ✅ | Rótulo de partido/federação com fundo `--party-{sigla}-1` e texto `--party-{sigla}-4`. Badge comprimida, radius-pill. | `components/atoms/data/PartyTag.tsx` | RSC |
| `<ProbabilityMeter />` | atom | ✅ | Barra visual de probabilidade 0–100% com label numerado. Usa `role="meter"`. | `components/atoms/data/ProbabilityMeter.tsx` | RSC |

### Atoms — Controles

| Componente | Tipo | Status | Papel | Arquivo | Cliente? |
|---|---|---|---|---|---|
| `<Button />` | atom | ✅ | Botão semântico com variants: `primary` (accent), `secondary` (outline), `minimal` (text-only). `aria-label` condicional. | `components/atoms/controls/Button.tsx` | RSC |
| `<SegmentedControl />` | atom | ✅ | Grupo de abas horizontal (like Tabs mas sem panel role). Comunica seleção via `onChange`. | `components/atoms/controls/SegmentedControl.tsx` | RSC |
| `<SearchInput />` | atom | ✅ | Campo de busca com ícone de lupa, placeholder colapsável em mobile, clearing rápido (Backspace). | `components/atoms/controls/SearchInput.tsx` | Client (useCallback) |

### Atoms — Barras

| Componente | Tipo | Status | Papel | Arquivo | Cliente? |
|---|---|---|---|---|---|
| `<VoteBar />` | atom | ✅ | Barra horizontal segmentada de votos por candidato/partido. Stack horizontal com cores por `--party-*-3`, labels percentuais. | `components/atoms/bars/VoteBar.tsx` | RSC |

### Atoms — Mapas

| Componente | Tipo | Status | Papel | Arquivo | Cliente? |
|---|---|---|---|---|---|
| `<MapLegend />` | atom | ✅ | Legenda de mapa: título, lista de cores com labels (partido, resultado, status). Posicionável (top-right, bottom-left, etc.); em celular moved para fluxo abaixo do mapa (ADR-0056). | `components/atoms/maps/MapLegend.tsx` | RSC |

### Atoms — Overlays

| Componente | Tipo | Status | Papel | Arquivo | Cliente? |
|---|---|---|---|---|---|
| `<HoverCard />` | atom | ✅ | Card flutuante que segue mouse ou se ancora a um trigger. Conteúdo renderizado sob demanda (lazy). Sem dependência de `framer-motion`. | `components/atoms/overlays/HoverCard.tsx` | Client (useEffect posicionamento) |
| `<Sheet />` | atom | ✅ | Bottom/side sheet (drawer) com backdrop, animação em CSS puro. Fecha em ESC ou clique no backdrop. | `components/atoms/overlays/Sheet.tsx` | Client (@react-dialog ou sem deps) |
| `<StateResultSheet />` | block | ✅ S08 | Folha de resumo de estado (UF) acionada por toque no mapa nacional (mobile/sem-hover) ou desktop com ADR-0050. Mostra ranking de candidatos, margem, e botão "Ver detalhes" navegando para `/uf/[sigla]`. | `components/blocks/StateResultSheet.tsx` | Client (folha aberta/fechada) |
| `<UfHoverLink />` | atom | ✅ S08 | Link aninhado num container hover-state (balão do mapa). Navega para `/uf/[sigla]`, preservando cargo e base ativa (ADR-0050). | `components/atoms/overlays/UfHoverLink.tsx` | Client (router) |

### Layout

| Componente | Tipo | Status | Papel | Arquivo | Cliente? |
|---|---|---|---|---|---|
| `<TopBar />` | layout | ✅ | Barra de topo (height 56px) com wordmark + mínima navegação. Sticky. Parte da shell global em `app/layout.tsx`. | `components/layout/TopBar.tsx` | RSC |
| `<TabBar />` | layout | ✅ | Barra de navegação de cargo (Presidente, Governador, Senador, Deputado) com `data-trilha` para estilo condicional. Sticky abaixo de TopBar. | `components/layout/TabBar.tsx` | RSC |

---

**Notas de implementação — Bloco 1:**

- Todos os 13 componentes são **RSC por padrão** (excepto `<SearchInput>` e `<HoverCard>` que usam hooks mínimos). Zero JS novo no above-the-fold.
- Nenhum depende de `framer-motion` ou `d3-*` — declarações removidas conforme ADR-0025 § 4.
- Cores de partido/federação via `lib/utils/party-color.ts` (sigla → `--party-{sigla}-{nível}`).
- Testes unitários: `tests/unit/components/{nome}.test.tsx` (11 dos 13 têm cobertura dedicada; `<HoverCard>` e `<Sheet>` cobertos por integração).
- Todos constroem com `pnpm typecheck` 0 erros e `pnpm lint` sem warnings novos.
- Dark mode prototipado mas **adiado para Bloco 2** (10 tokens de partido falhariam 3:1 em tema escuro, conforme medição em globals.css).

## Componentes órfãos (removidos de rotas 08/09, ADR-0033)

Os seguintes componentes **existem no disco mas não têm consumidor em produção** desde 2026-09-08:

| Componente | Motivo | Decisão |
|---|---|---|
| `<RunoffScenarios />` | RF-030.9 removido da home (protótipo não o contém) | Arquivo mantido para possível futura reativação |
| `<DecisiveUFsGrid />` | RF-024 removido da home (protótipo não o contém) | Arquivo mantido para possível futura reativação |
| `<TwoRoundIndicator />` | RF-030.7 migrou de `TwoRoundIndicator` para `ChancesPanel` | Arquivo mantido para possível futura reativação |
| `<TimeSeriesChart />` | RF-040 removido de specs 004/005 (protótipo não o contém) | Arquivo mantido para possível futura reativação |
| `<ProbabilityOverTime />` | RF-041 removido de specs 004/005 (protótipo não o contém) | Arquivo mantido para possível futura reativação |
| `<TurnoutAreaChart />` | RF-042 removido de specs 004/005 (protótipo não o contém) | Arquivo mantido para possível futura reativação |
| `<BubbleMap />` | RF-035 removido de specs 004/005 (protótipo não o contém) | Arquivo mantido para possível futura reativação |
| `<SwingArrowMap />` | RF-038 removido de specs 004/005 (protótipo não o contém) | Arquivo mantido para possível futura reativação |
| `<UFMapDuo />` | RF-035/036 removido de specs 004/005 (protótipo não os contém) | Arquivo mantido; exports `UfMapDuoLazy`/`UfSwingArrowMapLazy` órfãos |
| `<UfMapsLazy />` | Wrapper `next/dynamic` sem consumidor (RF-034 usa direto `<UfLeaderMapLazy />`) | Arquivo mantido para possível futura reativação |
| `<NewsClippingPlaceholder />` | Slot visual spec 004 nunca teve RF formal; removido com ADR-0033 | Arquivo mantido para possível futura reativação |

## Lacunas de teste conhecidas

Componentes shipped **sem teste dedicado** (para o `rf-coverage-checker`):
`<ChoroplethMapUF />`, `<BubbleMap />`, `<SwingArrowMap />`, `<UFMapDuo />`,
`<UfMapsLazy />`, `<MapPlaceholder />`, `<SWRProvider />` e as três ilustrações
inline de `/sobre-o-modelo`. `traceability.md:76-80` declara "unit (mock MapLibre)"
para os mapas de UF — não existe tal arquivo de teste hoje.

## Rotas novas em S07 (specs 016 e 017)

| Rota | Tela | Cargo | Spec |
|---|---|---|---|
| `app/(sen)/senador/page.tsx` | T-09 | Senador nacional (agregado) | [016](../specs/016-senador/) |
| `app/(sen)/uf/[sigla]/senador/page.tsx` | T-10 | Senador por UF | [016](../specs/016-senador/) |
| `app/(dep)/deputado-federal/page.tsx` | T-11 | Deputado Federal nacional (agregado) | [017](../specs/017-deputado-federal/) |
| `app/(dep)/uf/[sigla]/deputado-federal/page.tsx` | T-12 | Deputado Federal por UF | [017](../specs/017-deputado-federal/) |

Pasta `lib/config/cargos.ts` define tabela canônica de cargos com slugs e metadados (granularidade, cadência, `temArquivoBr`, etc.).
Pasta `lib/config/private-folders.ts` define roteamento de private folders `(sen)` e `(dep)`.

## Cross-refs

- Estrutura de pastas: [../architecture/folder-structure.md](../architecture/folder-structure.md)
- Tokens de cor e trilha: [./tokens.md](./tokens.md)
- Matriz completa RF → spec → componente → teste: [../_meta/traceability.md](../_meta/traceability.md)
