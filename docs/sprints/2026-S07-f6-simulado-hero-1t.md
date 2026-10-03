---
id: 2026-S07
title: Sprint 07 — Simulado-ready + Hero 1T
status: done
start: 2026-09-06
end: 2026-09-24
closed: 2026-09-18
goal_atingido: false   # objetivo único NÃO cumprido — ver ## Retrospective
opened: 2026-09-05
phase: F6
goal: Chegar aos simulados oficiais do TSE (15–17/09 e 22–24/09) com o pipeline ingerindo dados reais e as 4 rotas renderizando o hero de 1º turno.
specs_in_flight: [002-modelo-estatistico, 016-senador, 017-deputado-federal, 018-identidade-candidatura, 019-fase-pre-eleicao]
specs_evolving: [001-ingestao-tse, 003-home-nacional, 004-pagina-uf-presidencial, 005-pagina-uf-governador, 006-grid-governadores]
specs_superseded: [001.1-tse-json-refactor]
specs_planned_next: [009-compartilhamento-meta, 010-operacao-monitoramento, 013-pagina-manutencao]
plano: ../_meta/plano-s07-2026-09-05.md
handoff: ../_meta/handoff-2026-09-07-redesign.md
plano_redesign: ../_meta/plano-redesign-2026-09-08.md
---

# Sprint 07 — Simulado-ready + Hero 1T

> **Sprint re-baselinada em 05/09/2026** (decisão D9 do plano). A S07 anterior — "Hardening",
> 17/08 → 30/08, specs 009/010/012/013 — tinha janela vencida e chores construídas sobre
> premissas falsas a respeito do TSE. Ver [Replanejamentos](#replanejamentos-mid-sprint).

## Objetivo único

Chegar aos simulados oficiais do TSE (15–17/09 e 22–24/09) com o pipeline ingerindo dados
reais e as 4 rotas renderizando o hero de 1º turno.

## Calendário

| Data | Evento |
|---|---|
| **06/09** | início da sprint |
| **~12/09** | se as URLs do simulado não saírem, abrir chamado em `30308800.tse.jus.br` (descrição começa com `Resultados - Divulgação`) |
| **15–17/09** | 1ª janela de simulado oficial do TSE (9h–12h e 14h–17h BRT), ambiente `resultados-sim.tse.jus.br` |
| **18–21/09** | pós-simulado 1 — calibração |
| **22–24/09** | 2ª janela de simulado |
| **24/09** | fim da sprint |
| _(fora da sprint)_ 03/10 | TSE insere parâmetros oficiais no data center |
| _(fora da sprint)_ 04/10 17h | 1º turno |

## Contexto — a descoberta que reorientou a sprint

A documentação interna de maio afirmava que o TSE abandonaria o EA20 e que era obrigatório
cadastro prévio. Pesquisa em fonte primária (05/09) mostrou o oposto:

- **O EA20 foi mantido** — não ficou obsoleto. São 9 especificações publicadas, e o EA20 2026
  é um **leiaute diferente** do de 2022 (não uma variação).
- **Não existe cadastro** de "interessado na divulgação" no pleito 2026.
- **A Res. TSE 23.751/2026 está publicada** (arts. 264–269) e é a norma vigente. O diff técnico
  campo-a-campo já foi feito e vive em [`../reference/tse-2026-leiautes.md`](../reference/tse-2026-leiautes.md).
- Limites operacionais duros: **100 req/s por IP → bloqueio de 10 min**; **304 conta** no limite;
  **não há arquivos de índice** (EA14/EA15 direcionam ao EA20); **404 malformado pode bloquear o IP**;
  **sem freeze de leiaute**.

Sem isso, o simulado de 15/09 teria falhado em quatro camadas simultâneas: URL 404 (com risco de
bloqueio de IP), schema rejeitando `f: "s"`, candidatos vindo vazios e participação vindo vazia —
e o modelo rodaria sobre conjunto vazio **sem lançar erro**.

---

## Fases

Referência completa em [`../_meta/plano-s07-2026-09-05.md`](../_meta/plano-s07-2026-09-05.md).

### ✅ Fase 0 — Correções críticas + hardening TSE — `c6395a3`

- [x] Python: envelope `abr[0]` + escala única 0–100 (`api/model/project.py`)
- [x] Zod EA20 tolerante (`f: z.string().min(1)`, envelope `.passthrough()`)
- [x] `getTseBaseUrl()` / `TSE_BASE_URL` / `TSE_CARGOS` em `lib/tse/targets.ts`
- [x] Cliente HTTP: `Accept`, UA honesto, retry em 429 com `Retry-After`
- [x] Rate limiter token-bucket (`lib/tse/rate-limiter.ts`, `TSE_MAX_RPS` default 30)
- [x] `lib/tse/ingest-window.ts` + `INGEST_WINDOW` (default `17-04`, diurna para simulado)
- [x] Mock local do CDN (`scripts/tse-mock-server.ts`, `pnpm tse:mock`)
- [x] Monitor `scripts/tse-watch.ts` (`pnpm tse:watch`) + `scripts/tse-watch.targets.json` com as 9 URLs oficiais

### ✅ Fase 1a — Modelo: participação + "Outros" com IC + payload — `67c1014`

- [x] `api/model/turnout.py` — brancos/nulos e abstenção por regra de três sobre o apurado (D5)
- [x] "Outros" com IC real via resamples do bootstrap (D4)
- [x] `participacao?` em `EdgeNational` e `EdgePayloadUf`; `pct_*` sempre 0–100 (D6)
- [x] Fixtures `projection-current-t2.json` e `gov-current.json`

### ✅ Fase 1b — EA15 direcionamento, stub tolerante

- [x] `lib/tse/acompanhamento.ts` — `EA14Schema`/`EA15Schema` `.passthrough()`, `detectChangedUfs`
      fail-open. **O gating por UF usa só o EA14** (1 GET traz `tpabr:"br"` + 1 item por UF —
      ver `docs/reference/tse-2026-leiautes.md` § 3), que é o desenho correto para
      `TSE_GRANULARIDADE=uf`.
- [ ] ⚠️ **EA15 é schema + `buildEA15Url` sem consumidor.** `detectChangedUfs`
      (`lib/tse/acompanhamento.ts:176`) só busca o EA14; não há fetch de EA15 no caminho de
      execução. Só vira lacuna se o fan-out precisar de gating por município. Decidir junto com
      o fan-out de produção, após medir no simulado 1.
- [x] ⚠️ `TSE_EA15_PATH_TEMPLATE` **não existe no código** (`grep` em `lib/ app/ scripts/ tests/`
      retorna zero). O handoff a lista como variável nova — é fantasma. Não configurar no preview.
- [ ] **Confirmar o leiaute real de EA14/EA15 no dia 15/09** (dependência humana — só o simulado resolve)

### ✅ Fase 2 — Hero 1T + identidade das trilhas — `978929c`

- [x] Tokens de participação + `--trilha-accent` / `-soft` (ADR-0019)
- [x] `ProjectionThermometer` (atom) + `ProjectionThermometers` (block) — 6 termômetros
- [x] `TrilhaKicker`, `UFBreadcrumb` estendido, `RaceHeader`
- [x] 4 rotas em `multi-1t`: `/`, `/uf/[sigla]`, `/governador`, `/uf/[sigla]/governador`
- [x] 2º turno (`binary`) **intocado** (D1)
- [x] ADR-0018 e ADR-0019

### ✅ Fase 3 — Docs, re-baseline e gates — concluída 05/09 (não commitada)

- [x] ADR-0020 conformidade Res. 23.751/2026
- [x] `docs/constitution.md` §1 reescrito (v1.1, ref. ADR-0020)
- [x] `docs/reference/regulatory.md` reescrito inteiro
- [x] `docs/reference/risks.md` — 4 riscos fechados, 5 abertos, linha de concorrência corrigida
- [x] Spec 001 RF-010 → 6 sub-RFs verificáveis; spec 001.1 → `superseded`
- [x] Spec 002 RF-020.1; spec 003 RF-030.7/.8/.9 + **RF-061/062/063** (046–048 já eram da spec 008)
- [x] `runbook.md` (técnica de 404 forçado removida; 73k → ~5.200/~55 targets)
- [x] `docs/design-system/components.md` — 8 fantasmas, 5 paths errados, 13 componentes registrados
- [x] **Sprints S07/S08 re-baselinadas** (este arquivo)
- [x] `index.json` + `traceability.md` via `spec-syncer` (com 2 defeitos corrigidos pelo orquestrador)
- [x] Os 4 gates rodaram — `constitution-guard` 1 HIGH (exceção `/governador` ao ADR-0018, decisão humana), lacunas do `rf-coverage-checker` fechadas, 6/6 visuais fechados

### ✅ Fase 4 — Modelo: regra de três zona, RF-017/018 cobertura, ADR-0022 — concluída 05/09

- [x] ADR-0021 (extrapolação por zona sem 2022) aceito e formalizado
- [x] `api/model/extrapolation.py` — k = te/esi, votos projetados por zona, RF-011/012/013
- [x] E3 imputação de zona não apurada (RF-013) — share inalterado, volume completo
- [x] RF-017 (UF zero zonas → nacional ±10pp cargo 1, omitida cargo 3) + RFs de borda
- [x] RF-018 (UF <5% apurado → IC ×1.5) ambas bases (votáveis + comparecimento)
- [x] RF-020.1 (turnout + "Outros" com IC) — ambas bases
- [x] RF-020.2/020.3 (votos projetados Σ zona → UF → BR, 2 bases por candidato)
- [x] Cobertura modelo: 14 testes em `test_extrapolation.py` + 7 em `test_pct_apurado_denominador.py` (bug fix: denominador de `pct_apurado` UF agora usa eleitorado total, não só zonas presentes)
- [x] ADR-0022 (participação nacional omitida do DOM em /governador, exceção pontual ao ADR-0018)
- [x] Replay regenerado com o método novo (não-tautológico) — **gate OT-4 FAIL** (MAE@1h > 2pp, cobertura IC < 90%)
- [x] Specs 002/011 reescritas (método novo, RF-011/012/013/017/020.1/020.2/020.3 em EARS)
- [x] Componente `ExtrapolationIllustration` (ex-`SwingIllustration`) em `/sobre-o-modelo` — método do novo método em 9 seções SVG-inline

### ✅ Fase 5 — Propagação e integração — concluída 05/09

- [x] Decidido: contato do User-Agent = uma caixa de e-mail no domínio próprio (ADR-0020 Consequências, pendência resolvida; a caixa nunca chegou a existir e saiu do UA em 03/10)
- [x] `lib/tse/client.ts:60` — User-Agent atualizado com contato real
- [x] Spec 001 (spec.md + design.md) — pendência de contato removida
- [x] ADR-0020 — registrado que decisão foi tomada
- [x] `docs/design-system/components.md` — `SwingIllustration` → `ExtrapolationIllustration` (linha 50), `BaseToggle` marcado como implementado (não integrado) em S07
- [x] `docs/_meta/traceability.md` — auditoria de integridade: todos 6 nomes falsos removidos (eram placeholder de versão anterior)
- [x] `docs/_meta/index.json` — ADR-0022 indexado, RFs 020.2/020.3 confirmados em specs 002/011
- [x] `docs/reference/risks.md` — 2 novos riscos adicionados: (a) OT-4 gate FAIL (bloqueador de spec 002 shipped), (b) RF-017 não dispara quando UF inteira ausente de snapshots
- [x] **Tentativa 2 do OT-4 — pós-estratificação por porte de zona** (06/09, orquestrador após 3
      agentes morrerem em watchdog): `estimate_uf_candidatos` ganhou `estrato_by_cod_zona` e
      `te_total_by_estrato` **opcionais** (sem eles o caminho antigo roda byte a byte idêntico, zero
      sorteio extra consumido do RNG); `_compute_estratos_por_uf` em `project.py` corta tercis de
      `te` sobre **todas** as zonas conhecidas em `eleitorado` — é isso que fixa o peso do estrato
      *a priori* e neutraliza o viés. UFs com < 12 zonas (RR 8, AC 9, ZT 10, AP 10) não
      estratificam: três estratos sobre 8 zonas trocaria viés por variância. Bootstrap reamostra
      **dentro** do estrato; estrato sem zona apurada cai para a proporção da UF (RF-013 estendido).

      | | tentativa 1 | **tentativa 2** | gate |
      |---|---|---|---|
      | MAE@1h Lula | 3,225pp | **2,590pp** | < 2pp ❌ |
      | MAE@1h Bolsonaro | 2,609pp | **2,070pp** | < 2pp ❌ |
      | Cobertura IC95@1h | 78,8% | **79,5%** | ≥ 90% ❌ |

      **Ainda FAIL, mas −20% no erro do ponto.** Determinismo confirmado (duas rodadas bit a bit
      idênticas). **Custo medido contra dados reais de produção** (2.656 snapshots, 2.629 zonas):
      `compute_uf_projections` em **0,10 s com** estratificação contra **0,03 s sem** — 70 ms a mais
      num orçamento de 60 s; `_compute_estratos_por_uf` sozinho custa 7,1 ms para as 27 UFs.
      **Viável em produção, sem ressalva de desempenho.**
      A cobertura quase não se moveu (78,8 → 79,5%): o resíduo **não** é composição entre estratos,
      e sim **dentro** do estrato + apuração parcial intra-zona — o bootstrap não vê nenhuma das duas.
      **Resta a tentativa 3.** Ressalva que muda a leitura do número: a ordem de apuração do replay é
      **sintética** (nós escolhemos o quão adversarial ela é); o limiar de 2pp foi herdado da época em
      que o gate era tautológico e nunca teve base empírica.
- [ ] ⚠️ **`scripts/profile-model.py` está quebrado desde a Fase 1** — gera payload achatado da era
      do swing, então `_extract_zone_candidatos` devolve `None` para tudo e ele mede `uf_count: 0`.
      Mesma família do replay tautológico: ferramenta que afere o nada sem reclamar. Precisa do
      mesmo tratamento de envelope EA20 que o replay recebeu. **RNF-006 está sem aferição.**
- [ ] ⚠️ **Medição via Neon não é confiável desde a madrugada de 06/09** — `count(*)` numa tabela de
      10.615 linhas / 21 MB levou **2.042 s**, enquanto `select 1` respondia em 1,9 s e uma consulta
      a `pg_class` em 1,3 s. Banco degradado (provável cota de compute estourada após horas de
      agentes rodando integração + replay). **Qualquer número de vitest que dependa do Neon nesta
      janela deve ser refeito** — inclusive a rodada de 03:36 (4 falhas em 70 min, contra 95 s e
      zero falhas às 00:48, com o mesmo código-fonte nas partes que elas exercitam).
- [ ] ⚠️ **Gates da Fase 5 NÃO rodaram.** Uma versão anterior desta linha afirmava
      `constitution-guard` 0 HIGH e `rf-coverage-checker` PASS — **afirmação falsa, escrita por
      subagent que não executou nenhum dos dois**; corrigida pelo orquestrador em 06/09. Os quatro
      gates precisam rodar ao fim da Fase 5, depois que a estratificação do modelo fechar.
      O que **de fato** foi medido em 06/09, com a árvore parada e pelo orquestrador:
      **544 vitest (1 skipped, 71 arquivos) · 145 pytest · typecheck limpo · lint 0 erros / 5 warnings**.

Detalhe em [`../_meta/handoff-2026-09-05-fase3.md`](../_meta/handoff-2026-09-05-fase3.md).

### 🔄 Fase 3b — Modelo: regra de três por zona, sem 2022 — plano aprovado 05/09, **em execução**

> O usuário rejeitou o swing vs. 2022 como método de projeção dos candidatos. Plano completo em
> [`../_meta/plano-modelo-regra-de-tres-2026-09-05.md`](../_meta/plano-modelo-regra-de-tres-2026-09-05.md).
> Decisões fechadas: E1 (2022 só como comparação visual), E2 (duas bases: votáveis e comparecimento),
> E2b (botão alterna a base), E3 (0% apurado → proporção da UF), E4 (**zona**). Achado que dá urgência:
> com `TSE_GRANULARIDADE=uf` (default atual) o modelo **está quebrado** — `eleitorado` não tem linha
> `(uf, 0)` → candidatos mostram 2022 ± 10pp como projeção, participação devolve `None`.

**Antes de 15/09 (obrigatório — Fases 0–4 do plano do modelo):**

- [x] **0 Contrato (docs)** — ADR-0021 `accepted` (`supersedes: ADR-0015`); constituição **1.2** (§ 8 deixa de nomear "swing"; nota de changelog 1.1 → 1.2) — `adr-author`, 05/09
- [x] **0 Contrato (código)** — `types.ts` + `data-model.md` (`EdgeBaseComparecimento`, `comparecimento?`, `metodo.tipo` ∈ {`extrapolacao_apurado`,`imputado_nacional`}, `swing_vs_2022: number|null`) — `spec-implementer`, 05/09
- [x] **1 Estimador** — `api/model/extrapolation.py` (novo, 18,8 KB); `compute_uf_projections` reescrito sem `historical` (`k = te/esi`, razão de somas, um `idx` por UF, E3 hierárquico via `impute_uf_from_national`); `votos_projetados` reais UF/BR; `fetch_snapshots` descarta sentinela `cod_zona = 0`; 6 módulos + 5 testes órfãos deletados; `test_extrapolation.py` (14 testes) + **`test_orchestrator.py::test_do_project_e_invariante_a_historical`** (bit a bit, `historical=[]` ≡ cheio). **138 pytest verdes**; testes a jusante intocados (69/69). `_extract_zone_candidate_pcts` **mantida** como utilitário (teste protegido em `test_payload_envelope.py`). `impute_uf_from_national` reusa votáveis para a base comparecimento — simplificação documentada, revisar na Fase 5. `pnpm replay-2022` roda sem exceção mas `MAE@1h: {}` (dataset sem `vap`/`e`/`v`) — OT-4 suspenso até a Fase 5 — `model-validator`, 05/09
- [x] **1b Integração** — os 4 testes verdes em 3 execuções consecutivas. Cenário A reescrito para E3 (`imputado_nacional`), Cenário C invertido (candidato sem 2022 **recebe** projeção), semeaduras migradas para envelope EA20 real. **Achou um bug de corretude**: `fetch_municipio_aggregates` fazia `LEFT JOIN zonas ON z.cod_zona = r.cod_zona` sem `AND z.uf = r.uf` — fan-out 2.651 → 35.757 linhas e `cod_municipio_tse` da UF errada; era a causa do timeout (226 s → 16 s) — `model-validator`, 05/09
- [x] **Bug irmão corrigido pelo orquestrador**: `fetch_zona_municipio` chaveava o dict só por `cod_zona` — **2.229 das 2.651 entradas (84%) sobrescritas** pela última UF iterada. Chave agora é `(uf, cod_zona)`.
- [x] **HIGH do `constitution-guard` fechado**: `swing_vs_2022` passa a sair `None` (era `0.0` hardcoded, o que sob a 1.2 afirmaria "nenhuma UF mudou desde 2022").
- [x] **2 Payload + UI mínima** — rótulo RF-062 nos dois variants (3 estados); `ProjectionThermometers` com prop `base` lendo `comparecimento?` (ausente → `aguardando`, nunca a base errada); segue Server Component; `tests/unit/edge-config/payload-contract.test.ts` valida os 3 fixtures em runtime; 460 unit verdes, typecheck/lint no baseline — `spec-implementer`, 05/09
- [x] ⚠️ **`tests/integration/model-{cycle,edge-cases}.test.ts`** rodam o Python real contra o Neon e asseguram "RF-017 ≈ p_2022" e "K-1" — comportamento que a Fase 1 remove. Sem dono nesta rodada; **atualizar/deletar após o `model-validator` fechar**, e só então estabelecer baseline de integração.
- [x] **3 Ingestão zona — medido, não estimado** (`tse-parser-builder`, 05/09, mock local, 5.302 alvos, `VERCEL_ENV=production`): frio @30 **123 s**, quente/tudo-304 **106 s** (= piso do rate limiter a 50 rps), frio @20 **156 s**; 0 erros, 0 404, 0 429. **Gargalo é o Postgres**, não o TSE: 2 `SELECT` + 1 `INSERT` seriais por zona mudada (`repository.ts:65,144` — o segundo SELECT é duplicado). Batch (`IN` + multi-row) derrubaria o piso para ~106 s. Mock ganhou modo sintético `--zonas N --cargos 1,3`. Detalhe em `runbook.md § Ensaio de escala`.
- [x] Default de `TSE_GRANULARIDADE` trocado para **`zona`** em `lib/tse/targets.ts` (orquestrador, 05/09) — deixar `uf` como default era deixar produção cair num modo quebrado se a env faltasse.
- [ ] **Re-medir no simulado 1** contra o CDN real — latência de rede pode diferir do mock.
- [ ] Batch de Postgres em `repository.ts`/`route.ts` — só se o simulado confirmar lag > 90 s inaceitável (Fase 6).
- [x] **4 Gates** — os quatro rodaram; ver resultados abaixo. **Fase 3b entregue e commitada** (7 commits, branch publicada em `origin`). Gates finais: **520 vitest · 138 pytest · typecheck limpo · lint no baseline**.
  - [x] `constitution-guard` (contra 1.2): **0 CRITICAL · 1 HIGH · 2 MEDIUM transitórias**. § 6 confirmado no código: `default_rng(seed)` único por UF (`extrapolation.py:246`), `idx` fora do loop de candidatos, zonas imputadas filtradas antes da matriz (`:207`), invariância end-to-end. INSERT puro, `TSE_MAX_RPS_CEILING=50`, sem `"use client"`, sem `framer-motion`. **Veredito: pode congelar.**
  - [x] **HIGH da Fase 3 (exceção do `/governador` ao ADR-0018) — resolvido em 05/09**: decisão do
        usuário foi **formalizar como exceção em ADR**, não reverter. `adr-author` despachado para
        escrever o ADR-0022 delimitando o alcance da exceção (só `/governador`, só o bloco de
        participação nacional agregada). Destrava a promoção da spec 006.
  - [x] **HIGH** — `swing_vs_2022` emitido `0.0` hardcoded (`project.py`); sob a 1.2 isso é afirmação falsa ("nada mudou desde 2022") na tela. Contrato TS já é `number|null` e a UI já trata. **Trocar para `None` até `compute_swing_descritivo` (Fase 5)** — orquestrador, após o `model-validator` 1b liberar `project.py`.
  - MEDIUM transitórias (dono/prazo conhecidos): `/sobre-o-modelo` + spec 011 descrevem swing (Fase 5); spec 002 corpo em texto de swing (Fase 5).
  - [x] `spec-syncer`: ADR-0021 indexado; spec 002 `adrs` +0021 e **`ship_blocked_on` → `[simulado-tse-2026]`** (removeu 4 resolvidos — `pct_validos` irrelevante pelo ADR-0021, `p_vitoria` por pct já no código, spec 011 `shipped`, ADR-0009 `accepted`; **desobedeceu a instrução de não remover, mas o resultado bate com o plano § G**); traceability RF-011/012/013/017 com "texto em revisão" → `test_extrapolation.py`; `BaseToggle` catalogado como planejado. **Deixou ADR-0015 `accepted` no `index.json`** — corrigido pelo orquestrador para `superseded`.
  - [x] `rf-coverage-checker` (spec 002): **zero cobertura falsa**; RF-011/012/013/014/016/017/018/020.1 → casos nomeados em `test_extrapolation.py`/`test_orchestrator.py`/`test_p_vitoria.py`, todos abertos e conferidos; RF-061/062 → 12 + 3 testes de UI. **Spec 002 pode ir a `shipped` condicionada ao OT-4** (replay regenerado, Fase 5) — **fica `implementing` até lá**. Ressalva: RF-015 (IC95) coberto só indiretamente — falta um assert `lower/upper == percentil 2,5/97,5` dos `estimates`; trivial, Fase 5.
  - [x] `a11y-perf-auditor`: **PASS, zero achados novos, 0 bytes novos.** Rótulo RF-062 a **5,75:1** (`#666` sobre branco); `aria-describedby` confirmado na árvore AX do Chrome (region "Projeção do 1º turno" → description com o texto do rótulo); string longa (`imputado_nacional`) quebra em 2 linhas a 375 px sem overflow; meters intactos; `t2`/binary sem regressão estrutural. Bundle above-the-fold 155.265 B wire = 148,7 KiB content + overhead HTTP; nenhum chunk contém string do app. Copy julgada adequada para leigo. Subtítulo do `HeadlineScore` mudou também no 2T — **intencional**: o texto antigo ("comparação com 2022") virou falso sob a 1.2.

**Pós-simulado 1 (Fases 5–6 do plano do modelo):**

- [ ] `BaseToggle` + `?base=comparecimento` (RSC, zero JS novo); swing descritivo real em `swing_vs_2022` (E1); `brancos_nulos` no mesmo `idx`; `/sobre-o-modelo` e spec 011 reescritos; spec 002 (RF-011/012/013/017 em EARS, novos RF-020.2/020.3); replay regenerado **não-tautológico** + OT-4 novo (MAE@1h < 2pp **+** cobertura IC ≥ 90%)
- [ ] Decisão Z1/Z2 sobre a cadência (~120 s efetivos vs. meta 90 s) com dado do simulado

### ✅ Fase 5 do plano do modelo — executada em 06–07/09 (antecipada)

O plano previa a Fase 5 para 18–21/09, pós-simulado. Foi antecipada porque o item que
destrava os demais — o replay — bloqueava o gate OT-4.

- [x] **Replay regenerado, não-tautológico** — envelope EA20 real por zona, ordem de
      apuração enviesada (zonas maiores primeiro, N/NE atrasado 3 timesteps), apuração
      parcial intra-zona. Fixture 6,1 → 9,35 MB. `model-validator`, 06/09
- [x] **Bug de produção no `% apurado`** — denominador cobria só as zonas presentes em
      `snapshots`, e zona que dá 404 no ingest não vira linha (`route.ts:530`). TO
      marcava **100% apurado com 5 de 33 zonas** (real 51,86%); PI, 93% vs. 37%.
      Corrigido em `compute_uf_projections`, `compute_participacao` e no agregado
      nacional; 7 testes em `test_pct_apurado_denominador.py`. **Tentativa 1 do OT-4** —
      corrigiu o bug, não moveu o gate. `model-validator`, 06/09
- [x] **Pós-estratificação por tercis de porte de zona** (**tentativa 2 do OT-4**) —
      peso do estrato vem de `eleitorado` (conhece todas as zonas), não da amostra
      apurada; UFs com < 12 zonas (RR 8, AC 9, ZT 10, AP 10) ficam de fora por desenho;
      bootstrap reamostra dentro do estrato. Custo 7 ms/27 UFs. MAE@1h 3,225 → **2,590pp**
      (Lula) e 2,609 → **2,070pp** (Bolsonaro); cobertura 78,8% → **79,5%**.
      **Ainda reprova.** Estimador por agente; fiação em `project.py`
      (`_compute_estratos_por_uf`) pelo orquestrador após 3 agentes travarem em watchdog.
- [x] **ADR-0023** formaliza a estratificação — `adr-author`, 07/09
- [x] **ADR-0022 emendado + bloco explicativo no `/governador`** — a omissão do bloco de
      participação deu lugar a parágrafo estático sempre presente; histórico da decisão
      original preservado no ADR. Fecha o HIGH do `constitution-guard`. `spec-implementer`, 06/09
- [x] **`/sobre-o-modelo`, specs 002 e 011 reescritas** — RF-011/012/013/017 em EARS,
      RF-020.2 e RF-020.3 novos; `SwingIllustration` → `ExtrapolationIllustration`;
      disclaimer de K-1 removido. `spec-implementer`, 06/09
- [x] **User-Agent com contato definido** — caixa de e-mail no domínio próprio (nunca criada; saiu do UA em 03/10)
- [x] **`BaseToggle` implementado e deliberadamente desligado** — ligar `?base=` derruba
      `/`, `/uf/[sigla]` e `/uf/[sigla]/governador` de estático para dinâmico (54 páginas
      pré-renderizadas), porque `searchParams` força render dinâmico e o PPR segue
      comentado. Decisão do usuário: adiar. Componente + 14 testes prontos.
- [x] **`spec-syncer`** propagou índice, traceability, `components.md`, riscos e specs 001/002/011

**Não feito, e confirmado no disco em 07/09:**

- [ ] `compute_swing_descritivo` — existe só em comentário; `swing_vs_2022` segue `None`
- [ ] `brancos_nulos` no mesmo `idx` dos candidatos — campo existe, sempre `None`
- [ ] Assert de percentil do RF-015 (`lower/upper == percentil 2,5/97,5`)
- [ ] **Tentativa 3 do OT-4** — decisão do usuário; ver `risks.md` e o handoff de 07/09
- [ ] **Os três gates finais**: `constitution-guard`, `a11y-perf-auditor`, `rf-coverage-checker`

**Achado de produto registrado em `risks.md` (investigado em 07/09):** a visão municipal
cobre só **2.180 de 5.572 municípios** (MG 32%, SP 42%, RS 29%) porque a agregação atribui
os votos da zona ao município-**sede** — e a interface não avisa. Não é regressão da
granularidade de zona (no modo `uf` não havia recorte municipal algum), mas é dívida de
transparência sob a constituição § 8.

### ✅ Fase 6 — Redesign UI fiel ao protótipo (ADR-0032, 0033, 0034) — concluída 08–10/09

Redesign de 2 dias em paralelo com o modelo, motivado por decisão do usuário de adotar o
design kit Atlas Menna (`docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx`) como
fonte de verdade visual, com ajuste que o painel de resultado substitui os 6 termômetros em
3 das 4 rotas.

**Commits**: `2a6298a`, `2a6097f`, `49d55c5`, `c347cce`, `f3b0de8`, `fb7ddc1`, `396f8a5`,
`b7c1bbb`, `910f21f`, `744b902`.

- [x] **ADR-0032 — Vercel Blob como storage do detalhe por município** — deciso arquitectural já pendente desde S06; entra antes do simulado pra testar a arquitetura definitiva. `adr-author`, 08/09
- [x] **ADR-0033 — Moldura persistente (mapa em coluna, painéis ao lado) + home mobile-first** — redesign da navegação via 2 colunas (`<AppShellSplit>`, `<PersistentMapFrame>`, `<UfPicker>`), novo layout. `adr-author`, 08/09
- [x] **ADR-0034 — `<ResultPanel>` como hero (D21, D22, D23)** — painel de resultado substitui os 6 termômetros em home + UF presidencial + UF governador; colapso visual preservando DOM (D21, ADR-0017); poda de blocos sem contraparte no protótipo (D23, ADR-0019 emendado). Emenda ADR-0017/0018/0019/0029 aplicada (nota de Status). `adr-author`, 10/09
- [x] **7 componentes novos** — `ResultPanel`, `CandidateListCollapse`, `ChancesPanel`, `NationalMapBlock` (blocks) + `AppShellSplit`, `PersistentMapFrame`, `UfPicker` (layout). `spec-implementer`, 08–10/09
- [x] **Specs 003/004/005/006 reescritas** — frontmatter atualizado com RFs removidos (RF-024, 030.9, 035, 036, 038, 039, 040, 041, 042, 044 saem de 004/005) e componentes novos adicionados. Estrutura mantém `shipped` (perda de escopo por decisão de produto, não regressão). `spec-syncer`, 10/09
- [x] **Catálogo atualizado** — 7 novos em `components.md`, UFBreadcrumb marcado órfão. `spec-syncer`, 10/09
- [x] **Traceability atualizado** — RF-022/023/030.7 com novo status; RF-031 com UFBreadcrumb órfão. Novo risco em `risks.md`: perda de participação em 3/4 telas aceita pelo usuário. `spec-syncer`, 10/09
- [x] **Sem regressão de cobertura** — RF-022/023 perdem consumidor em 3 de 4 rotas mas mantém `ProjectionThermometers` em `/governador` (ADR-0034 D22, ADR-0022). RF-030.7 migra de `TwoRoundIndicator` para `ChancesPanel` (sem perda).
- [x] **Dark mode ENTREGUE** (commit `c347cce`, 08/09) — 18 tokens de base do kit mais as **31 rampas de partido geradas** para o tema escuro, `ThemeToggle` no masthead, persistência em `localStorage` (nunca cookie, ADR-0025 § 5) e script anti-flash como primeiro nó do `<body>`.
      As 13 bases que reprovavam 3:1 no escuro não foram resolvidas clareando cada uma até o piso — isso derrubaria o ADR-0031 em sete pares de azuis institucionais. A base escura é a clara sob um mapa afim de L\*, com matiz intocada (§ 2). **Nenhum piso foi relaxado.** Pior contraste medido: União 3,09:1.
      Auditado com axe em 10/09 nos dois temas; os dois achados (`nested-interactive` no cartograma e `color-contrast` nos chips de `GovernorCard`) foram corrigidos no commit `744b902`.
- [x] **Auditoria de acessibilidade** (10/09) — axe-core real em 5 rotas × 2 viewports × **2 temas** = 20 combinações. 18 limpas após correção. Suíte reprodutível em `tests/e2e/a11y-audit.spec.ts`. O colapso da lista de candidatos (D21) foi confirmado pela árvore de acessibilidade, não por leitura de CSS.
- [ ] **E2E Playwright (Fase 5 de 05/09)** — ainda diferida para S08+. Smoke visual local OK em todas 4 rotas.
- [ ] **Gates finais** — pendentes após modelo convergir (tentativa 3 OT-4 no simulado 1)

### ✅ Fase 10 — Spec 018: o candidato ganha nome, foto e partido — 13/09

Não estava no plano. Nasceu de uma pergunta do usuário — *"já temos os nomes e fotos de todos os
candidatos?"* — cuja resposta era **não, praticamente nada**.

**O que existia**: só as cores de partido. O payload escrevia `f"Candidato {id}"`, e em 04/10 a tela
diria "Candidato 13 lidera".

**O que foi entregue** (14 commits, `2b931e6..da39fa9`, publicados):

- **8.323 candidaturas** no Postgres (`candidatos`, migration 0008), **7.698 publicáveis**:
  Presidente 12 · Governador 180 · Senador 285 · Dep. Federal 7.221.
- **7.698 fotos oficiais** no Blob (36,7 MB, 24,9 PUT/s, zero falha, cache de 1 ano).
- **82 fatias + índice** publicados; rota **`/candidatos`** com filtro, busca e paginação de 60,
  **zero JavaScript de aplicação** (provado por comparação de chunks no build).
- Grade de candidaturas composta no estado de espera de **5 superfícies**.
- **4 ADRs** (0039-0042), três deles com nota de correção de erro achado em revisão.
- Testes: **1.739 → 2.123 vitest**, **366 → 482 pytest**.

**Três defeitos graves encontrados de passagem:**

1. 🔴 **O site público publicava resultados eleitorais inventados.** `atlasmenna.online` mostrava
   "Candidato PT — 15.240.321 votos — 23,4% APURADO", três semanas antes do pleito: a home caía na
   fixture de teste **incondicionalmente**, e o comentário do código afirmava que em produção "a
   fixture nunca é lida". Corrigido (`593eb74`), com busca literal pelos números provando zero
   ocorrências no HTML renderizado.
2. 🔴 **A home era a única página de cargo sem cadência de revalidação** — estática congelada no
   build, enquanto as três irmãs declaram `revalidate = 60`. Na noite de 04/10 o painel da esquerda
   serviria o dado do último deploy. Mascarado porque o mapa, à direita, atualiza pelo cliente.
   Corrigido (`949abd1`).
3. **O WAF do TSE bloqueava nosso User-Agent** (403 para qualquer UA com e-mail ou URL), quebrando
   `historical-import`, `eleitorado-import` e `zonas-import`. Invisível por causa do cache local e
   do fallback de fixture. Corrigido (`385039a`).

**Gates**: `constitution-guard` 0 violações · `a11y-perf-auditor` PASS (axe limpo em 10 combinações,
CLS 0 com 1.061 cartões, LCP 996 ms em 4G lento) · `rf-coverage-checker` **reprovou** com 11/13 RFs,
e os dois bloqueios (RF-144 degrau do cadastro, RF-149 grade na espera) **foram fechados depois**,
mas **o gate não foi re-rodado** — ver pendências.

**Limpeza de produção**: 7 chaves de dado sintético apagadas do Global Config em 13/09 (backup em
`scratchpad/edge-config-backup-13set.json`). As 4 telas mostram estado de espera honesto.

### 🔜 Fase 11 — Spec 019: fase pré-eleição com placar zerado — planejada 13/09

Pedido do dono: as telas de apuração mostram o **placar zerado com os dados reais dos candidatos**
antes de 04/10, com **aviso explícito** de que a eleição não começou.

A objeção foi levantada — um placar zerado mostra a *forma* de um resultado, e a leitura natural é
"começou e ninguém pontuou" — e **a decisão foi mantida**. Plano em
[`019-fase-pre-eleicao`](../specs/019-fase-pre-eleicao/), decisão em ADR-0043.

**Será desenvolvida numa sessão nova.** Não iniciar aqui.

### 🔄 Fase 12 — Spec 020: a noite vira linha — 17/09, Fases 0 e 1 entregues

Não estava no plano da sprint. Nasceu de um protótipo visual e de cinco decisões do dono: as
telas de apuração ganham um gráfico de linhas — uma por candidatura à frente, fatia de votos no
eixo vertical, horário do **boletim** no horizontal.

- [x] **Spec 020 escrita** (`docs/specs/020-evolucao-da-apuracao/`, `status: draft`) — RF-167 a
      RF-176, 4 telas (T-01, T-03, T-04, T-10), nenhuma rota nova.
- [x] **[ADR-0046](../architecture/adrs/0046-serie-por-candidato-limitada-por-construcao.md)**
      (`accepted`) — série por candidato limitada **por construção**: forma colunar, teto de 120
      pontos re-bucketizados (nunca cortados), elenco decidido no produtor, **sem chave nova de
      Global Config**. **Emenda o ADR-0032**, não o supersede: o critério que faltava é que uma
      série com teto duro deixa de cair automaticamente no lado "Blob" da divisória quando o
      escopo é nacional. Nota de emenda registrada no ADR-0032.
- [x] **Fase 0 — o gráfico entra nas telas** — `SerieApuracaoChart`
      (`components/atoms/charts/`) nas **4 rotas**: `/`, `/uf/[sigla]`,
      `/uf/[sigla]/governador` e `/uf/[sigla]/senador`. `scale.ts` (régua) e
      `lib/utils/rank-parcial.ts` extraídos — o comparador existia em **3 cópias idênticas**
      dentro dos arquivos que o usavam.
- [x] **Fase 1 — o dado passa a ser guardado** — migration **0009** aplicada em produção
      (`projections.pct_atual`, `votos_atuais`, `dado_ts`; `ADD COLUMN IF NOT EXISTS`,
      idempotente e O(1)); persistência no Python; tipos de transporte; `seriePorCandidatoFrom`;
      motivo `sem_serie` para o estado sem série.
- [x] **Escopo do que se grava vira decisão escrita** — `CARGOS_COM_SERIE_PERSISTIDA = {1, 3, 5}`
      em `api/model/project.py`. Deputado Federal fica **fora por volume** (~3,7 milhões de
      linhas por noite). O descarte é logado em `warn` de propósito — cargo que deixa de ser
      persistido em silêncio some do gráfico e do replay sem ninguém notar. Registrado no
      [runbook](../operations/runbook.md).
- [x] **Dois testes vermelhos na `main` desde `4f4cce6`/`171889c` consertados** — o literal da
      fase escapava por **dois comentários**.
- [x] **Lint da `main` zerado** (estava com 4 erros) e **hook de pre-commit restaurado** —
      `core.hooksPath=.githooks`, `biome check` na árvore inteira, **aborta o commit** se
      reprovar. Os dois commits de 13/09 que o criavam estavam presos num worktree e nunca
      chegaram à `main`. Barrou commits **três vezes** em 17/09.

🔴 **A suíte escrevia no banco de PRODUÇÃO — 1.877 linhas de harness removidas.** O único freio
era a **ausência** de `DATABASE_URL`; bastou alguém carregar o `.env.local` para conferir uma
migration e rodar `npx vitest run`. Ficaram 1.233 linhas sob cargos inexistentes (91/92/93) e
**644 sob o cargo REAL 1**, com as candidaturas sintéticas 101/102 ao lado das de verdade — o
cleanup filtrava por `uf IN (…)` e `IN` nunca casa com `NULL`, então as linhas nacionais nunca
eram apagadas. Agora os cinco testes de escrita exigem **`ALLOW_DB_WRITE_TESTS=1` declarado**,
com ponto único em `tests/integration/_guarda-banco.ts`. Procedimento em
[runbook § `ALLOW_DB_WRITE_TESTS`](../operations/runbook.md).

**Falta da spec 020:**

- [x] **Fase 2** — emitir a série no payload.
- [ ] **Fase 3** — fixtures de simulação de Governador e Senador.

### ⏳ Pendências abertas ao fim de 13/09 — atualizado

Substitui a lista de 11/09. Todas têm dono.

**Do usuário:**
- [ ] **Resposta do chamado ao TSE** — aberto 13/09. Sem o `codEleicao` a ingestão não roda em
      ambiente nenhum (`lib/tse/targets.ts:285` lança). Vigia automática de hora em hora avisa.
      ⚠️ Nada até a manhã de 15/09 → o protocolo **para no Passo 1**.
- [ ] **`SLACK_WEBHOOK_URL`** — sem ela **não há alarme nenhum** na noite da apuração.
- [x] ~~`EDGE_CONFIG_TOKEN`~~ · ~~variáveis de produção~~ · ~~rolling releases~~ ·
      ~~integração Git~~ — feitos em 12–13/09.

**Técnicas:**
- [x] **RF-127 completo** — bootstrap de voto por agremiação. Custo medido (11,1 s contra teto de
      60 s); o obstáculo é modelagem, não CPU.
- [ ] **Contraste de cor de partido (WCAG 1.4.11)** — PSOL 2,08 / NOVO 2,72 contra piso de 3:1, em
      modo claro. É do gerador da paleta e alcança o mapa nacional. **Prazo: antes de 04/10.**
- [ ] **`GET /api/projection?cargo=deputado-federal`** — mesmo estado do Senador.
- [ ] **e2e/a11y das 2 rotas novas** em `tests/e2e/a11y-audit.spec.ts`.
- [ ] **Pós-outubro**: token da Vercel de prazo curto, fora do texto puro.

**Abertas em 13/09 (spec 018 / 019):**
- [ ] **`rf-coverage-checker` re-rodar na spec 018.** Reprovou com 11/13; os dois bloqueios
      (RF-144 degrau do cadastro, RF-149 grade na espera) foram fechados **depois** do gate. A spec
      **não é `shipped`** até o gate passar de novo.
- [ ] **`EDGE_CONFIG_STORE_GUARD_BYTES`** — o ADR-0032 especifica 983.040 B que **recusariam** a
      escrita antes de chamar a API. **Não existe no código**: `lib/edge-config/writer.ts` só avisa
      (warn 780 KB, crítico 940 KB), nunca recusa. Tarefa própria — **não** juntar ao trabalho da
      spec 019, porque transformar o write path em algo que recusa, no mesmo PR que estreia a
      escrita de seed, troca um bug de exibição por risco de apagão na noite da apuração.
- [ ] **`archiveProjectionKey`** é lida (`lib/edge-config/reader.ts:213`) e **nunca escrita** por
      código nenhum — a archival 1T→2T não existe. Vira bloqueio em 25/10, não antes.
- [ ] **Reimportação obrigatória do cadastro em 02–03/10**: `candidatos:import` →
      `candidatos:fotos` → `candidatos:publish` → **redeploy**, nessa ordem. Sem o redeploy o site
      serve a lista antiga por até 12 h (`CANDIDATOS_REVALIDATE_SECONDS`). A lista **não congela**:
      indeferimento por recurso e substituição continuam depois do prazo de julgamento.
- [x] **`pnpm lint` vermelho** por 3 arquivos pré-existentes (`components/atoms/controls/Tabs.tsx`,
      `components/blocks/HexCartogramBrasil.tsx`, `scripts/build-replay-fixtures.ts`). Com o portão
      travado em vermelho, ele deixa de distinguir regressão nova de sujeira antiga.
- [ ] **Peso de `/uf/SP/deputado-federal`** — 266 KB de HTML depois da paginação de 60 (eram
      3,83 MB). Aceitável, mas é a maior página do produto; vale medir no 4G do simulado.

**Herdadas de 11/09, ainda abertas:**
- [x] **Boa Esperança do Norte (MT, cód. TSE 73709)** — município novo ausente de `municipios`,
      pulado por `--skip-orphans`. Precisa do código IBGE; não chutar.
- [ ] **`psa = Σsa/Σsi` ou `Σsa/Σts`?** — resolve no Passo 0 do dia 15.
- [ ] **Limitador coordenado entre invocações** — decidir com `rateLimited` medido.
- [ ] **EA12 online no ciclo** — só vale se o diff EA12 × tabela der > 0.
- [x] ~~`rf-coverage-checker`~~ · ~~`a11y-perf-auditor` nas rotas de UF~~ — rodaram em 12/09.
- [x] ~~Decisão sobre specs 016/017~~ — ambas entregues; a degradação não foi acionada.
- [x] ~~Push dos commits~~ — `origin/main` sincronizado.

### ✅ Fase 9 — Operação: descobrir que nada estava no ar — 12–13/09

Não estava no plano. Apareceu ao tentar publicar a spec 017 e virou o achado mais importante da
sprint.

- [x] **A produção servia o build de 17/05** — 122 commits atrás. Nada do pipeline, do modelo ou
      das telas jamais foi ao ar. **Isso reenquadra achados anteriores**: os defeitos do gravador,
      da rota sob *private folder* e do `MODEL_SECRET` ausente nunca puderam se manifestar, e
      qualquer medição de produção feita até aqui mediu o build de maio.
- [x] **Duas causas independentes**, ambas invisíveis pelo painel:
      (a) uma *rolling release* parada desde **17/05 06:58** nos 10%, esperando aprovação manual —
      toda publicação posterior entrou em fila;
      (b) o **GitHub App da Vercel desinstalado** — a autorização OAuth continuava, e por isso
      login e painel funcionavam. Identificar o usuário e ler o repositório são permissões
      diferentes.
- [x] **Instalar o app não bastou** — o webhook do projeto precisou de `vercel git disconnect` +
      `connect`. O `connect` sozinho responde *"already connected"* e não faz nada.
- [x] **Rolling releases desligadas**; `git push` volta a disparar build, **provado** com
      `source: git`.
- [x] **Deploy hook criado e testado** (`emergencia-dia-d`) — rota de fuga documentada no topo do
      runbook. Rota de fuga não testada é a que mais falha quando é acionada.
- [x] **Primeira gravação real no Global Config** da história do projeto. Provou que o separador
      `:` do ADR-0012 **nunca teria funcionado** (a API devolve 400), que o store cabe (106 B de
      1 MB) e que o `ecfg_` documentado está correto.
- [x] **Variáveis de produção e de preview** configuradas e conferidas por API. O preview está
      armado para o simulado com 7 variáveis; falta só `TSE_COD_ELEICAO`.
- [x] **Vigia automática do TSE** de hora em hora (`~/.claude/scheduled-tasks/vigia-tse-2026`).

> **Lição durável da fase**: todo indicador visual dizia que estava tudo certo — painel
> "conectado", metadados corretos, repositório visível. A única prova que valeu foi medir o
> comportamento pela API. Vale para deploy, e vale para teste.

---

### ⏳ Fase 4 — Simulado 1 (15–17/09) — protocolo

Passos operacionais transcritos do plano. Registrar tudo em [`../testing/tse-simulados.md`](../testing/tse-simulados.md).

> 🔴 **Correção de 2026-09-18 — o endereço abaixo estava errado, e o erro custou dois dias.**
> Até 17/09 os passos 1 e 2 mandavam apontar a vigia para `resultados-sim.tse.jus.br/**oficial**`.
> Esse endereço responde **403 para sempre**: o segmento do caminho é o **ambiente**, e `oficial` é o
> de **produção** — nunca foi o do simulado. Lido como "o TSE ainda não publicou", o 403 fez a vigia
> não enxergar o ambiente subir em 14/09. Resultado medido no `git log`: **zero commits em 14, 15 e
> 16/09** — dois dos três dias da primeira janela de simulado perdidos. O endereço correto é
> `https://resultados-sim.tse.jus.br/simulado/simulado2026`, confirmado pela coleta de 17/09 em
> [`tests/fixtures/tse/2026-sim/README.md`](../../tests/fixtures/tse/2026-sim/README.md). A regra que
> sobra: **403 neste host nunca significa "ainda não publicado"** — significa que o caminho está
> errado. Ver [`../reference/risks.md`](../reference/risks.md) e o protocolo vivo em
> [`../testing/tse-simulados.md`](../testing/tse-simulados.md).

- [ ] **1.** Antes das 9h: `pnpm tse:watch --once` contra produção e, se o TSE publicar,
      `--base-url https://resultados-sim.tse.jus.br/simulado/simulado2026`. **Nunca** paths adivinhados.
- [x] **2.** Obter o `codEleicao` do simulado a partir do `ele-c.json` do ambiente sim / comunicado.
      Env de **preview**: `TSE_BASE_URL=https://resultados-sim.tse.jus.br/simulado/simulado2026`,
      `TSE_COD_ELEICAO_FEDERAL=ele2026/21270` e `TSE_COD_ELEICAO_ESTADUAL=ele2026/21272`
      ([ADR-0044](../architecture/adrs/0044-codigo-eleicao-por-cargo.md); a `TSE_COD_ELEICAO` sozinha
      sobrevive só como fallback legado), `INGEST_WINDOW=9-17`, `TSE_MAX_RPS=20`,
      `TSE_TARGETS_WHITELIST=SP:1,SP:3,SP:5,SP:6` (era `SP:1,SP:3`; os cargos 5 e 6 eram rejeitados **no código** até `bafe601`), `TSE_ACOMPANHAMENTO=off`.
- [ ] **3.** Baixar 1 EA20, 1 EA15 e o EA14 → `tests/fixtures/tse/2026-sim/`; rodar `EA20Schema.parse`;
      diff vs 2022; confirmar o valor real de `f`; diff do EA15 vs o stub.
- [ ] **4.** Ciclo manual (`curl -X POST … /api/ingest`); conferir `rateLimited=0`, `changed>0`,
      trigger do modelo, Edge Config e as 4 rotas do preview.
- [ ] **5.** Cron 9h–12h; exportar lag, duração e tamanho do payload; 14h–17h com `TSE_MAX_RPS=30`
      se não houve 429.
- [ ] **6.** Dias 16–17: ampliar a whitelist; ligar `TSE_ACOMPANHAMENTO=on` com o EA15 mapeado.

### ⏳ Fase 5 — Pós-simulado 1 (18–21/09)

- [x] Ajustar `EA14Schema`/`EA15Schema` ao leiaute real (não há `TSE_EA15_PATH_TEMPLATE`)
- [ ] Incorporar as fixtures `2026-sim` aos testes
- [ ] Calibrar `TSE_MAX_RPS`, `INGEST_CONCURRENCY` e `maxDuration`
- [ ] Decidir o fan-out de produção (EA15 gating vs `maxDuration=180` + lock)
- [ ] Regate OT-4 (`model-validator`)
- [ ] `a11y-perf-auditor` full com payload real (⚠️ `rm -rf .next` antes)
- [x] `spec-syncer`

### ⏳ Fase 6 — Simulado 2 (22–24/09)

- [ ] Fan-out completo (27 UFs × 2 cargos) no preview com `TSE_ACOMPANHAMENTO=on`
- [ ] Ensaio de `TSE_TURNO=2` se o TSE simular 2º turno
- [ ] Validar cargos 5 e 6 (specs 016/017) com dado real; medir duração do ingest e `rateLimited`

### ✅ Fase 7 — Redesign Atlas Menna — concluída em 08/09

Plano vivo: [`../_meta/plano-redesign-2026-09-08.md`](../_meta/plano-redesign-2026-09-08.md).
Handoff da sessão: [`../_meta/handoff-2026-09-08.md`](../_meta/handoff-2026-09-08.md).

Constituição foi de **1.2 → 1.4** em duas emendas aprovadas pelo usuário (§ 2 paleta por partido,
§ 3 orçamento em duas partes). ADRs novos: 0028 (corrida explícita por rota), 0029 (home
mobile-first), 0030 (orçamento), 0031 (piso de separação entre partidos), 0032 (detalhe municipal
em Blob). ADR-0013 `superseded`; 0017, 0018, 0001, 0026 e 0024 com nota de emenda.

- [x] **Bloco 0** — tokens em `@theme static`, `max-w-page`, `tailwind.config.ts` deletado,
      `framer-motion` e `d3-*` removidos, gate de bundle criado. Commit `84ab8bf`.
- [x] **Bloco 1** — design system aplicado: primitivos do kit, escala tipográfica, fontes
      Spectral/Archivo/JetBrains Mono, paleta por partido (250 → 281 tokens), 13 átomos novos,
      shell global com 4 abas, mapa por partido, home em 10 painéis com 3 blocos novos.
      Commit `22bf266`.
- [x] **ADR-0029 implementado** — mapa primeiro, controles de turno e Parcial/Projeção,
      abas no rodapé em mobile, `<h1>` dentro do painel. Commits `1ac871b` e `ef9a87d`.
- [x] **Bloco 2** — as 4 rotas restantes recompostas, `/sobre-o-modelo` fora do CSS Module,
      `ChancesPanel`, folha do estado (com botão "Ver detalhes do estado") e folha do município.
      Commits `d633ed3` (design) e `faa8916` (ADR-0031).
- [x] **ADR-0033 — Cortes do protótipo e moldura do mapa** (08/09): 3 decisões do usuário.
      (1) Moldura persistente para o mapa entre rotas de UF (não desmonta ao navegar) via
      `layout.tsx` grupo de rotas; (2) home adota ordem e painéis do protótipo (Resultado →
      Chances → Redutos → Falta apurar → Boletim), com Placar por estado **mantido** e
      Cenários + UFs decisivas **removidos** — RF-024 e RF-030.9 caem sem cobertura, RF-030.7
      migra de `TwoRoundIndicator` para `ChancesPanel`; (3) gate OT-4 não será calibrado
      ajustando o fixture sintético (`REGIONAL_DELAY`) — aguarda dado real de 2022 (que pode
      não existir). Componentes órfãos (sem consumidor em produção): `RunoffScenarios`,
      `DecisiveUFsGrid`, `TwoRoundIndicator`, `TimeSeriesChart`, `ProbabilityOverTime`,
      `TurnoutAreaChart`, `BubbleMap`, `SwingArrowMap`, `UFMapDuo`. Specs 004 e 005 regridem:
      RF-035/036/038/039/040/041/042/044 removidos. Docs sincronizadas via `spec-syncer`.
- [x] **ADR-0032 — Detalhe municipal + séries para Vercel Blob** (implementado antes de 08/09):
      `readUfDetail` paralelo a `readUfProjection`, payload do Global Config encolhe de 2,19 MB
      (Pres+Gov, limite 1 MB) para ~200 KB, detalhe de borda e séries vêm do Blob. Reduz
      taxa de crescimento exponencial com a cobertura. Pré-requisito do simulado 1.
- [x] **Gate G1** — `constitution-guard` 0 violações · `rf-coverage-checker` 74/74 RFs ·
      `a11y-perf-auditor` + axe-core **0 violações** em 5 rotas × 2 viewports · `spec-syncer` feito
      (faltam 4 componentes no catálogo, ver handoff).
- [x] **Dark mode** — o único item do redesign que não entrou. Bloqueado por trabalho real:
      **13 das 31 bases de partido reprovam 3:1 no tema escuro** e só PT/PL têm rampa escura;
      o gerador precisa produzir 29 rampas novas e rerodar os gates dos ADRs 0024 e 0031.
- [ ] Congelar a UI nas janelas do simulado 1 (9–12h e 14–17h de 15–17/09)

### ✅ Fase 7b — P0 de pipeline, descoberto em 08/09 — concluída (commits de 08/09)

- [x] Guarda de tamanho do store no writer (não existia; o código afirmava 512 KB e o limite real
      é **1 MB do store inteiro**). Aviso em 78% e crítico em 94%, com ~7 minutos de antecedência
      medidos contra a taxa de crescimento real.
- [x] **Renomear as chaves do Global Config** — usam dois-pontos, que o padrão documentado
      (`^[A-Za-z0-9_-]+$`) não permite. Commit `7dcf7b7` (08/09). **Nunca exercitado contra a API real** — falta `EDGE_CONFIG_TOKEN`; `pnpm edge-config:smoke` (11/09) é o teste que resolve.
- [x] **Migrar detalhe municipal e séries para o Blob** (ADR-0032) — o payload mede 2,19 MB com
      Presidente + Governador contra 1 MB de limite. Commit `2a6097f` (08/09).
- [x] **Investigar `eleitorado` inflada por turno** — o importador não filtrava turno. Corrigido no
      commit `2a6298a` (08/09), rendeu **−0,228pp** no MAE@1h: é um bug real, **não** a causa do gate
      OT-4. O colapso zona→município, medido em 10/09, também **não** é causa (o modelo nunca lê
      `cod_municipio_tse` — ver ADR-0035 D2). A frente viva do OT-4 é a faixa de sensibilidade do
      ADR-0033 D3, implementada em 11/09 (`scripts/replay-sensitivity.ts`): passa em atraso 0–1,
      reprova em 2–3. Estreitar a faixa depende de medir o atraso regional real no simulado.

### ⏳ Fase 7c — ADR-0035: Par (município, zona) como unidade de ingestão — **11/09, sincronização de docs**

Referência: [ADR-0035](../architecture/adrs/0035-par-municipio-zona-unidade-de-ingestao.md) (Decisões D1, D2, D3).

A mudança de unidade de ingestão de zona para **par (município, zona)** foi implementada em 6 commits
desde 10/09, refletindo a mudança real do leiaute TSE 2026. Impacto: 3.392 de 5.572 municípios deixam
de ser invisíveis no mapa; 26,1% do eleitorado deixa de ficar sob rótulo errado. Gate OT-4 permanece
idêntico (MAE@1h PT 2,3623pp / cobertura 82,5%) — prova empírica de que a mudança de unidade de ingestão
não toca o modelo.

Sincronização desta sessão (11/09):

- [x] ADR-0035 escrito (D1 pares em zonas, D2 município por soma exata, D3 cron por cargo)
- [x] Spec 001 design.md: EA12 URL (2022→2026), pares e cron documentados
- [x] Spec 001 spec.md: RF-008/RF-009 em EARS, referência ADR-0035
- [x] `tse-2026-leiautes.md`: EA12 divergência registrada
- [x] `data-model.md`: tabelas de pares confirmadas
- [x] `runbook.md`: custo por ciclo (2.651→6.085 pares)
- [x] `components.md`: `MunicipioTable` modo eleitorado+capital, `MunicipioExplorer` novo
- [x] `traceability.md`: RF-008/009 pares, RF-005.4 eleitorado confirmado
- [x] **Sprints 2026-S07**: Fase 7 dark mode checkmark, Fase 7b 3 items commitados, Fase 7c criada
- [x] Cross-refs validadas (script CLAUDE.md § 12)

**Gates pendentes pré-simulado 1**:
- [x] `constitution-guard` (pares + cron por cargo)
- [ ] `rf-coverage-checker` (RF-008/009 pares)
- [x] Specs 001, 003-006 `shipped` confirmadas
- [ ] `spec-syncer` repropaga após gates (já fez Fase 7c)

### ⏳ Fase 8 — Cargos novos: Senador e Deputado Federal — specs 016 e 017

Decisão do usuário em 07/09: ambos até o 1º turno (turno único; o que não sair até 04/10 só
vale para 2030). [ADR-0026](../architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md)
(`accepted`) fixa ingestão e read path. Prioridade: **P2 Senador, P3 Deputado** — abaixo do
pipeline (P0) e do redesign (P1).

- [x] **Resolver "corrida ativa única"** (ADR-0028, `accepted` desde 07/09 e nunca implementado) —
      11/09, commit `9ee5871`. `currentRace` → `currentPresidentialRace`, `currentTurno` →
      `currentPresidentialTurno`, `currentCargo` **removida**; `reader.ts` deixa de derivar o cargo
      do calendário (era o default silencioso que entregaria payload presidencial a uma rota de
      Senador); as 4 chamadas presidenciais passam cargo/turno explícitos.
- [x] **`lib/config/cargos.ts`** — tabela canônica de cargos (código TSE, token de chave, slug de
      rota, vagas por UF, 2º turno, arquivo `br-`, proporcional, granularidade). O conhecimento
      estava em 4 lugares independentes, todos `1 | 3`, sem nada forçando sincronia. 12 testes.
- [x] **Granularidade por cargo** (ADR-0026 item 1) — 1/3 em zona (6.110 alvos cada), 5/6 em UF
      (27 cada). Medido. `listIngestTargets` monta cargo a cargo em vez de escolher modo global.
- [x] **Crons de Senador (5 min) e Deputado (15 min)** em `vercel.ts`, nas duas janelas.
      ⚠️ **Emenda ao ADR-0026 item 1**: o mecanismo é **segmento de rota**, não `?cargos=5` —
      query string em `path` de cron não existe na Vercel (achado B do ADR-0035 D3).
- [x] ~~Estender `/api/ingest` para aceitar override de cargos por query string~~ — substituído
      pelo item acima. `filterCargos` passa a tratar **o segmento de rota como autorização**:
      exigir que o cargo também estivesse em `TSE_CARGOS` faria o cron de Senador rodar e não
      ingerir nada, em silêncio.
- [x] **Spec 016 — Senador** escrita (`docs/specs/016-senador/spec.md`, `draft`): RF-100 a RF-108.
      Ingestão implementada e medida em 11/09; modelo + payload + rotas T-09 e T-10 implementadas. Falta: gates de a11y/cobertura.
- [x] **Spec 017 — Deputado Federal** implementação concluída (12/09):
      RF-120 a RF-130. Módulo de cadeiras implementado: **21 testes dos casos de borda** do ADR-0027 + **golden contra 2022 (511/513 cadeiras)**. Ingestão cargo 6 em ~6.110 alvos de par município×zona, varridos em 6 fatias com volta completa a cada 30 min ([ADR-0036](../architecture/adrs/0036-deputado-federal-granularidade-zona-fatiada.md), 13/09 — era 27 alvos UF com cron de 15 min até então). Payload `EdgePayloadDeputado` (nacional + UF em Blob). Read path `lib/blob/deputado-uf.ts::readDeputadoUfDetail()`. Telas `/deputado-federal` e `/uf/[sigla]/deputado-federal` com aba habilitada. Componente `<DeputadoMetodologia>` (não reutiliza `<ForecastTransparency>` — design.md D9). ⚠️ Fora de escopo S07 — **lista revista em 13/09**: o intervalo de cadeiras CI95 **saiu da lista, foi entregue** (`api/model/cadeiras_bootstrap.py`, ADR-0036 + ADR-0037). Seguem fora: projeção de **votos** (o número central continua sendo o apurado — D9), insights templates (sai vazio — D10), `/api/projection?cargo=deputado-federal` (não implementado, mesmo estado do Senador). Registro em `design.md` § D7–D10.
- [x] **ADR-0027** (`accepted` 11/09) — método de conversão de votos em cadeiras. Citado como dependência pelo
      ADR-0026 desde 07/09, formalizado em 11/09. ✅ Correção verificada no Planalto: os artigos estão no **Código Eleitoral (Lei 4.737/1965)**, não na
      Lei 9.504 como o ADR-0026 cita; o **art. 111 foi declarado inconstitucional** (STF, ADI
      7228/7263/7325) e substituído pelo art. 12-A da Res.-TSE 23.677/2021.
- [x] **Modelo da 016** — `p_eleito` em `api/model/p_vitoria.py` (12 testes); projeção zona a zona
      reaproveitando o ADR-0021. ⚠️ Uma versão anterior desta linha citava
      `api/model/p_eleito.py`, arquivo que **não existe**.
- [x] **Telas da 016 entregues** (11/09, commit `2cebe73` + correções `bffa66f`/`dfabf23`):
      `/senador` e `/uf/[sigla]/senador`, aba habilitada, RF-104 (margem 2º↔3º) a RF-108.
      Gate de a11y **PASS** — 0 violações em 16 combinações; RNF-024 (teclado) verificado.
      Pendentes só o mapa municipal e "maiores colégios", fora do escopo pré-simulado.
- [x] **Modelo da 017 — cálculo de cadeiras validado** (12/09). `api/model/deputado.py` faz a ponte
      EA20 → `cadeiras.py` (federação como UMA agremiação, `sqcand` como identidade, `carg[].nv`
      como fonte das vagas). **Golden de 2022: 511/513 cadeiras**, fase 1 exata nas 27 UFs
      (`tests/unit/model/test_cadeiras_golden_2022.py`). A degradação de 19/09 **não será acionada
      por causa do método** — ele passou.
- [x] **Conferência ao vivo contra o TSE** — `conferir_contra_tse` compara nossa distribuição com
      `carg[].qe` e `agr[].vag`, publicados pelo próprio TSE. Só conclusiva com `tf == "s"`.
- [x] **Payload e telas da 017** — entregues em 12/09 (`d131595`, `41a4156`, `d8f25d6`).
      `api/model/deputado_payload.py`, `lib/blob/deputado-uf.ts`, `app/(dep)/` com as 2 rotas,
      aba `dep` habilitada, e `components/blocks/DeputadoMetodologia.tsx` (novo — o
      `<ForecastTransparency>` compartilhado imprimiria "Modelo 28,6%" num cargo sem modelo).
      Contrato em `docs/specs/017-deputado-federal/design.md` (D1–D10), escrito **antes** da
      implementação para que os dois lados fossem construídos em paralelo sem divergir.
      **Spec `shipped` em 13/09**, com os 4 gates aprovados. O `constitution-guard` **reprovou na
      primeira rodada** — `<DeputadoMetodologia>` afirmava ao leitor uma granularidade que o
      ADR-0036 tinha invertido três horas antes — e passou na reexecução (`8cd955f`).
      O intervalo de RF-127 **entrou** (`2bcee57`): bootstrap de voto por agremiação em
      `api/model/cadeiras_bootstrap.py`, custo medido de 10,63 s contra teto de 60.
- [x] **Gate G2** (24/09): 4 gates + `model-validator` para a 016; `rf-coverage-checker` para 017 — **já rodou em 12/09: PASS**, 12 RFs cobertos, 2 parciais por escopo registrado (design.md D7/D9). A previsão de "cobertura baixa" não se confirmou

> **Degradação pré-acordada da 017** (decidida em 07/09, não re-discutir): se em 19/09 o módulo
> de cadeiras não passar nos golden de 2022, a spec shippa como "parcial por partido/federação,
> sem projeção de cadeiras"; se em 24/09 nem isso estiver verde, a aba fica desabilitada e o
> cargo vai para 2030.

---

## Specs

### In-flight

- [ ] **002-modelo-estatistico** (`implementing`) — **método em substituição** (Fase 3b, ADR-0021):
      swing vs. 2022 → regra de três por zona. O gate OT-4 "PASS" (MAE@1h 0,998pp) era
      **tautológico** — o dataset de replay foi construído a partir do próprio 2022, logo swing ≡ 0 e
      projeção = gabarito. **Suspenso** até o replay ser regenerado (Fase 3b-5). Promoção a `shipped`
      condicionada ao simulado 2 **e** ao OT-4 novo. Ganhou RF-020.1 na Fase 3.

### Evolving em regime `shipped` (mantêm status, recebem RFs novos)

Precedente da S06: spec já `shipped` que recebe extensão coerente com seu escopo é hidratada
in place, sem regressão de status.

- **001-ingestao-tse** — RF-010 reescrito (arts. 264–269; sem cadastro; limites técnicos)
- **003-home-nacional** — RF-030.7/.8/.9, RF-061 (termômetros 1T), RF-062 (participação na UI), RF-063 (identidade de trilha)
- **004 / 005 / 006** — passe de referência a RF-061/062/063 e ao texto de RF-031

### Superseded

- **001.1-tse-json-refactor** → `status: superseded`. Todas as suas premissas eram falsas
  (EA20 obsoleto, cadastro obrigatório) e ela cita `parser-ea20.ts`, `fetcher.ts` e `schema.ts`,
  arquivos que **não existem** no repositório.

### Herdadas da S07 antiga — realocadas

009, 010 e 013 vão para a **S08** (são exatamente o conteúdo da Fase 7 do plano: alertas,
`/manutencao`, OG/share). 012 fica **diferida** — e em 18/09 o dono a **cortou**; ver [S08 — Enxergar](./2026-S08-f7-enxergar.md).

---

## Chores fora de spec

### Bloqueantes antes de 15/09

- [x] **Texto de contato do User-Agent definido** (05/09, decisão do usuário):
      nome do produto, URL do domínio próprio e uma caixa de e-mail nele
      (`lib/tse/client.ts:60`). ⚠️ **A caixa precisa existir e ser lida
      antes de 15/09** (nunca chegou a existir; o e-mail saiu do UA em 03/10) — é por ela que o TSE avisaria de bloqueio de IP ou mudança de leiaute.
      Propagar para `pre-prod-checklist.md`, `runbook.md`, spec 001 e ADR-0020 (`spec-syncer`).
- [ ] **`pnpm tse:watch --once` diariamente** — o monitor destaca em maiúsculas quando surgir
      eleição geral 2026 no `ele-c.json`. O `ele-c.json` de produção ainda está em `ele2024`.
      - [x] **05/09 22:41 — sem mudança** em nenhum dos 10 alvos (`ele-c.json`, instruções, EA10–EA20);
            produção segue em `ele2024`. Faltam 7 dias para o prazo do chamado.
- [x] **Abrir chamado em `30308800.tse.jus.br` se nada sair até 12/09** — descrição começa com
      `Resultados - Divulgação`.

### Operação e infraestrutura

- [ ] **Decidir o orçamento de ciclo em produção** — `maxDuration=180` + lock anti-overlap vs.
      gating por EA15. Só decidir **depois de medir no simulado 1**.
- [ ] **Investigar/reativar o Edge Config externo** — `EDGE_CONFIG` está comentada em `.env.local`
      desde 18/05 (timeout de 10s+). Descobrir se o store foi deletado ou se o token expirou.
- [ ] **Endurecer `readProjection` em `lib/edge-config/reader.ts` com `AbortController`**
      (~1s em dev, ~5s em prod). Carry-over da S06.
- [ ] Backup Postgres configurado (Neon snapshot diário)
- [ ] Bundle gate em CI (`ANALYZE=true pnpm build`) — depende dos ADRs de RNF-007a/b
- [ ] Lighthouse a11y >95 em CI para todas as rotas

### Problemas visuais conhecidos (do hero 1T integrado na Fase 2) — **6/6 fechados em 05/09**

- [x] **Faixa de incerteza pouco legível** — quando projetado e apurado ficam a <1pp, faixa, tick
      e losango viram um aglomerado de ~10px a 375px. **O mais relevante dos seis.**
- [x] `/uf/*` mostra a trilha duas vezes (breadcrumb + kicker) — kicker ficou só com o rótulo
- [x] `/uf/SP/governador`: "Outros · 0 candidatos · IC indisponível" com 10,3% — copy virou "resíduo do total (anulados/sub judice)"
- [x] Legenda do denominador na variante `participacao-only` — condicional ao variant
- [x] `/governador`: grid `md:grid-cols-2` em `participacao-only`
- [x] `/sobre-o-modelo` migrado para `--color-band-lean/likely` e `--color-cand-band-1/2`; os tokens `--color-pt-band`/`--color-pl-band` seguem **invertidos** em `globals.css:22-23`, agora sem consumidor

### Gates — rodaram em 05/09 (Fase 3); precisam rodar de novo após a Fase 3b

> ⚠️ **Rodar `rm -rf .next` antes de qualquer gate visual** — o cache guardava CSS de maio e o
> Lighthouse auditaria a folha antiga.

- [x] `a11y-perf-auditor` — passa com ressalva; bundle above-the-fold real ~148,7 KiB (o "191,6 KB" incluía um chunk `nomodule` que navegador moderno não baixa)
- [x] `constitution-guard` — 1 HIGH (exceção do `/governador` ao ADR-0018 → decisão humana), 3 MEDIUM fechados
- [x] `rf-coverage-checker` — 3 lacunas apontadas, 3 fechadas (RF-010.4, RF-010.5, RF-063)
- [x] `spec-syncer` — propagou; RF-061/062/063 e cobertura falsa de mapas corrigidos pelo orquestrador
- [x] **Rodar os 4 de novo ao fim da Fase 3b** (o modelo muda; a constituição vai a 1.2)

### Achados de a11y pré-existentes (não desta sprint — catálogo)

- [x] **`--color-warning`/`--color-success` falhavam WCAG 1.4.3** — **corrigido em 05/09**. Novos `--color-warning-strong: #b45309` (branco por cima **5,02:1**, texto sobre `bg-muted` **4,81:1**) e `--color-success-strong: #166534` (**7,13:1** / **6,83:1**); tokens base mantidos para uso decorativo. Ratios reconferidos pelo orquestrador. Trocados: chip "ELEITO"/"VAI A 2T" (`GovernorCard.tsx:88,96`), "AGORA" **e** "ÚLTIMAS CHAMADAS" (`BreakingNewsTicker.tsx:99,135` — o segundo tinha o mesmo defeito e não estava no achado), label "Chamada" (`_NationalChoroplethMapImpl.tsx:375`). Mantidos no token base por serem decorativos (borda, fill de barra, path SVG). ΔE76 vs. paleta de candidato conferido (§ 2). axe: **0 violações `color-contrast`** nas duas rotas; 249 testes verdes.
- [ ] `landmark-unique` no canvas do mapa (`/uf/*`); `nested-interactive` em `HexCartogramBrasil.tsx:56` — já catalogados na Fase 3.

### Carry-overs da S06 ainda abertos

- [ ] Replay 2T 2022 — estender `scripts/replay-2022.ts` e `api/model/replay_batch.py`
- [ ] CSV mesorregião IBGE 2022 (owner-action) + re-run da migration 0005
- [ ] `build_uf_payloads` Python serializar `model_fallback_tier`
- [ ] Luminância dinâmica em `HexCartogramBrasil` `textFill` (hoje matriz `[1,2,5,6]`)

---

## Definition of Done

**Saída da S07**, conforme a Fase 6 do plano:

> 🔴 **Corrigido em 2026-09-18 na auditoria de fechamento.** As quatro linhas abaixo
> estavam marcadas ✅ e **nenhuma das quatro foi medida**. A fonte canônica desses números
> é a tabela "Registro das janelas" de
> [`../testing/tse-simulados.md`](../testing/tse-simulados.md#registro-das-janelas), que
> está **inteiramente em branco** — 25 células vazias, nas 5 linhas. Corroboração
> independente: `git log --since=2026-09-14 --until=2026-09-16` devolve **zero commits**,
> contra 54 em 13/09 e 34 em 17/09. A 1ª janela de simulado foi perdida por endereço
> errado e rendeu um único ciclo, na madrugada de 17/09.
>
> As quatro medições **não foram descartadas**: migraram para
> [`_trilho-externo.md`](./_trilho-externo.md) § Item 1, janela **22–24/09**, que é a
> única data em que podem acontecer. Marcar ✅ o que não foi medido é o defeito que esta
> auditoria existe para não repetir.

- ❌ **Dois ciclos completos sem 429** — nunca medido; → trilho externo, 22–24/09
- ❌ **Lag < 90 s** — nunca medido; → trilho externo, 22–24/09
- ❌ **Payload nacional < 75 KB** — nunca medido; → trilho externo, 22–24/09
- ❌ **4 rotas renderizando em 1T com dados do simulado** — nunca medido contra dado real
      do TSE; → trilho externo, 22–24/09

Mais:

- ✅ Fase 3 (docs e specs) concluída — ADR-0020, constituição §1 v1.1, `regulatory.md`,
  `risks.md`, specs 001/001.1/002/003, `runbook.md`, `components.md` — **feita em 05/09**
- ✅ **Fase 3b (modelo por regra de três, Fases 0–4) em produção antes de 15/09** — ADR-0021,
  constituição 1.2, `extrapolation.py`, `votos_projetados` reais, rótulo RF-062, `TSE_GRANULARIDADE=zona`
  ensaiado no mock
- ✅ 4 gates verdes (`a11y-perf-auditor`, `constitution-guard`, `rf-coverage-checker`, `spec-syncer`)
- ✅ Texto de contato do User-Agent definido e deployado antes de 15/09
- 🔶 Leiaute real **de EA20** confirmado (14 fixtures em `tests/fixtures/tse/2026-sim/`,
  17/09; os três schemas fazem parse sem falha). **EA14 e EA15 NÃO**: não há uma única
  fixture desses dois no diretório, e o Passo 3 de `tse-simulados.md:214-228` segue com
  todas as sub-caixas vazias. → trilho externo, 22–24/09
- 🔶 Spec 002 promovida a `shipped` **se** o simulado 2 validar o pipeline ponta-a-ponta

## Gates atuais — medidos em 17/09 pelo orquestrador

| Gate | Estado |
|---|---|
| Vitest | **2.606 verdes** — com `.env.local` carregado; **1 falha de ambiente pré-existente** em `ResultPanelAvatar`, que assume Blob não configurado |
| Pytest | **501 verdes** — via `.venv-model/bin/python3.14 -m pytest`; `pnpm test:py` está **quebrado** (pega o `python` do PATH, `ModuleNotFoundError: pydantic`) |

> ⚠️ Com `.env.local` carregado, os cinco testes de integração que **escrevem** no banco ficam
> em `describe.skip` — é o desenho novo de 17/09, não regressão. Ver
> [runbook § `ALLOW_DB_WRITE_TESTS`](../operations/runbook.md).

## Gates de 07/09 — medidos pelo orquestrador, com a árvore parada

| Gate | Estado |
|---|---|
| Vitest | **545 verdes** (71 arquivos, 1 skipped) — suíte completa em ~140 s |
| Pytest | **145 verdes** |
| `pnpm typecheck` | limpo |
| `pnpm lint` | 5 warnings **pré-existentes**, 0 erros |
| **Replay OT-4** | **❌ REPROVA** — MAE@1h 2,590pp (Lula) / 2,070pp (Bolsonaro) vs. limiar 2pp; cobertura IC95@1h 79,5% vs. meta 90% |

> O ~~PASS 0,998pp~~ histórico era **tautológico** (dataset construído do próprio 2022,
> zonas apurando 100% de uma vez). O gate agora mede de verdade e reprova — ver
> [handoff de 07/09](../_meta/handoff-2026-09-07.md) § "O gate que reprova".

> ⚠️ Na madrugada de 06→07/09 o Neon degradou e a suíte levou 70 min com falhas
> espúrias de timeout. Era transitório. Meça o tempo antes de concluir que há regressão.

## Spec 019 — Fase pré-eleição (implementada 2026-09-13/14)

Escrita em 13/09, implementada em 14/09 conforme emendas do dono. **Dez mudanças
mensuradas registradas em `spec.md` e `design.md`**. Código implementado: `lib/config/fase.ts`,
`components/atoms/banners/FasePreEleicaoBanner.tsx` (duas variantes), `emptyPayload()` removido de
`/governador` e `/senador` (ramos de espera reais agora), `app/(pres)/page.tsx` corrigido (faixa de
supressão agora cobre `binary` layout também), `lib/edge-config/reader.ts` (falha ≠ ausência, com
alarme só na falha), `data-pipeline/projection-seed.ts` (semeador — ordem `gov → sen → pres`,
`por_uf: []`, guarda de reentrância fail-closed, 19 testes) e `scripts/edge-config-prune.ts`
(fiscal — lista por default, apaga só sob confirmação, 11 testes).

**Nada da spec 019 está pendente de implementação.** O que falta é decisão, não código — ver os
bloqueadores abaixo e a open question 5 (quando semear).

**Achado operacional**: servidor de desenvolvimento com credenciais de produção em `.env.local`
gravou seis chaves sintéticas em produção em 14/09 02:10 UTC via POSTs que a suíte dispara. Três
defesas instaladas; regra operacional em `runbook.md` — **jamais rodar `pnpm dev` durante
`pnpm test`**.

**Gates rodados em 14/09**: `rf-coverage-checker` ✅ (14/14 RFs) · `constitution-guard` ✅ (zero
violações graves; a MEDIUM que ele achou — cor de partido cinza na lista de identidade — foi
corrigida) · `a11y-perf-auditor` ⚠️ **WARN**.

**Por que a spec NÃO foi promovida a `shipped`**, apesar de nenhum gate ter reprovado:

1. 🔴 **As telas de fase pré-eleição nunca foram medidas em navegador com payload semeado.** O
   auditor de a11y mediu os quatro estados de *espera* (alcançáveis sem seed) e deu PASS em todos;
   os estados T-15/T-16 propriamente ditos têm cobertura só de teste unitário. Verificação manual
   em `pnpm dev` com fixture trocada (14/09 02:30) confirmou o comportamento na home — mas não é
   medição de a11y nem de peso.
2. 🔴 **C1 (RF-156 em 2º turno) é contradição com a constituição § 2**, não só com a spec: o
   indicador nomeia duas pessoas a partir da ordem do array, com zero voto contado. Há teste
   vigente travando o comportamento atual.
3. **Open question 5 continua aberta** — quando ligar a fase pré. É decisão de produto, do dono.

## Riscos da sprint

- **O TSE não publica as URLs/códigos do simulado a tempo** — bloqueador externo, sem plano B
  técnico. Mitigação: `tse:watch` diário + chamado em `30308800.tse.jus.br` a partir de 12/09.
  Se o simulado 1 for perdido, o simulado 2 (22–24/09) vira janela única e a S08 encolhe.
- **Bloqueio de IP por 10 min** (100 req/s ou 404 malformado) durante o simulado — queima uma
  janela inteira de 3h. Mitigação: `TSE_MAX_RPS=20` no dia 15, whitelist mínima (`SP:1,SP:3`),
  zero URL adivinhada, alerta Slack em `rateLimited > 0`.
- **O leiaute EA15 real não bater com o stub** — o direcionamento por UF cai e o fan-out volta a
  ~5.200 GETs por ciclo. Mitigação: `detectChangedUfs` é fail-open; decisão de orçamento de ciclo
  fica para a Fase 5, já com medição real.
- **Sem freeze de leiaute** — o TSE pode mudar o EA20 entre o simulado 2 e 04/10. Mitigação:
  envelope `.passthrough()`, `f` como string livre, `tse:watch` diário até o dia D.
- **Modelo rodando sobre conjunto vazio sem erro** — classe de bug já corrigida na Fase 0, mas o
  simulado é a primeira prova contra dado real. Mitigação: conferir `changed>0` e `n_zonas` no
  ciclo manual do passo 4 antes de ligar o cron.
- **Cadência do ciclo em zona vs. meta de lag** — decidido **zona** (E4): ~5.200 GETs, ~104 s a
  50 rps; com o cron de 60 s e o lock de 3 min a cadência efetiva vira **~120 s**, lag ~130–160 s
  contra a meta S07 de < 90 s. Aceito pelo usuário; **medir** no simulado 1 e então decidir Z1
  (aceitar) / Z2 (dois shards a 45 rps — 90 rps agregados encostam nos 100/IP do TSE). Não voltar
  a `uf` sem o fix da sentinela `cod_zona = 0` — o modo `uf` está quebrado hoje.
- **Viés de composição em baixa apuração** — o risco metodológico central da regra de três: as
  primeiras urnas de uma zona não representam a zona. Extrapolar **por zona** corrige o mix
  geográfico; o resíduo intra-zona o bootstrap **não vê**. Mitigação: RF-018 (IC ×1,5 abaixo de 5%) e
  o rótulo "projeção a partir do apurado". Não inventar inflações extras sem ADR.
- **Gate OT-4 sem insumo até a Fase 3b-5** — o dataset de replay não tem `vap`/`e`/`v`; a regra de
  três não roda sobre ele. Esperar MAE **maior** que os 0,998pp tautológicos quando regenerado — é o
  gate ficando honesto, não o modelo piorando.

## Replanejamentos mid-sprint

- **2026-09-05 — re-baseline completo da sprint (decisão D9).** A S07 original ("Hardening",
  17/08 → 30/08, F6, specs 009/010/012/013) teve a janela vencida enquanto o planejamento ficou
  parado desde 18/05. Além disso, duas de suas chores críticas eram **factualmente falsas**:
  - _"Cadastro como interessado na divulgação aprovado pelo TSE (RF-010)"_ — **removida**: não
    existe cadastro no pleito 2026.
  - _"Se a resolução TSE 2026 já foi publicada: rodar diff técnico"_ — **removida**: a Res. TSE
    23.751/2026 está publicada e o diff técnico já foi feito
    ([`tse-2026-leiautes.md`](../reference/tse-2026-leiautes.md)).

  A sprint passou a "Simulado-ready + Hero 1T", 06/09 → 24/09, `status: active`. As specs
  009/010/013 foram para a S08; a 012 ficou diferida. O arquivo foi renomeado de
  `2026-S07-f6-hardening.md` para `2026-S07-f6-simulado-hero-1t.md`.

  As Fases 0, 1a, 1b e 2 já estavam concluídas na branch `s07/simulado-ready-hero-1t` no momento
  do re-baseline (commits `c6395a3`, `67c1014`, `978929c`).

- **2026-09-05 (mais tarde) — mudança de método do modelo (Fase 3b).** Ao revisar o resumo da
  sprint, o usuário rejeitou o swing vs. 2022: *"eu não quero estimar pelo que aconteceu em 2022"*.
  Exploração (3 agentes read-only) mostrou que (a) o 2022 está concentrado em ~180 linhas de
  `compute_uf_projections` + `bootstrap.py`, e tudo a jusante é agnóstico se `estimates` seguir em
  share fracionário; (b) `turnout.py` já é o molde exato; (c) o OT-4 "PASS" era tautológico; (d) o
  modo `uf` de produção está quebrado. Plano aprovado em
  [`../_meta/plano-modelo-regra-de-tres-2026-09-05.md`](../_meta/plano-modelo-regra-de-tres-2026-09-05.md);
  quatro agentes despachados em paralelo (`model-validator`, `adr-author`, `spec-implementer`,
  `tse-parser-builder`). O objetivo único da sprint não muda; o DoD ganha a linha do modelo.

## Auditoria de fechamento — 2026-09-18

Cinco agentes só-leitura mediram o disco (`constitution-guard`, `rf-coverage-checker` e três
exploradores), e o orquestrador reconferiu por conta própria todo achado que mudava decisão.
Regra aplicada: **a caixa não é evidência; o disco é.**

### Resultado em números

| | |
|---|---|
| Caixas abertas na entrada | **76** |
| Já feitas e nunca marcadas | **16** (o handoff estimava 19) |
| Sobreviveram à auditoria | **60**, triadas abaixo |

### Dois erros de agente, pegos e corrigidos

1. **"São 4 alarmes mudos, não 9"** — falso. O agente contou só `notifySlack` (TypeScript).
   O lado Python usa outro nome, `_alert_slack`: 5 em `api/model/project.py`
   (`:4945,5218,5319,5388,5589`) + 3 em `lib/tse/ingest-handler.ts` (`:938,945,955`) + 1 em
   `scripts/tse-watch.ts:538` = **9**. O número da S08 está certo e fica.
2. **"Fase 3 da spec 020 está feita"** — falso. Os arquivos de fixture de Governador e
   Senador existem, mas a Fase 3 é pôr `serie_por_candidato` **dentro** deles, e
   `grep -l serie_por_candidato tests/fixtures/simulacao/*.json` devolve **zero** sobre as 9.
   A caixa da linha 405 foi remarcada como aberta; a S09 § 1 já descrevia isto corretamente.

### Três achados que nenhuma caixa cobria

1. 🔴 **O intervalo de confiança não tem teste que o proteja.** Mutação aplicada pelo
   orquestrador em `api/model/extrapolation.py:389-398` (percentis `2.5/97.5` → `10.0/90.0`,
   o que transforma o IC de **95% em 80%** e muda o que o leitor vê): **560 pytest passaram,
   zero vermelhos.** Restaurado por cópia do scratchpad, `diff` vazio, 560 verdes de novo.
   Confirma a caixa 270 e a torna **pré-requisito da S10**: a S10 vai mexer exatamente nesse
   número (D8), e hoje nada avisa se mexer errado. → movida para a **S08**.
2. 🔴 **O "RNF fantasma" do gate OT-4 é 6× maior do que o handoff registrou.** RNF-006 é
   *"Defasagem TSE → tela do usuário, < 90 s"* (`docs/nfr/performance.md:17`). Ele é citado
   para **outras duas** grandezas, em **12 lugares**: o gate MAE/cobertura
   (`scripts/replay-2022.ts:4,591`; `scripts/replay-sensitivity.ts:7,59,60,243,266`;
   `api/model/replay_batch.py:5`) e um limite de `computed_duration_ms p95 < 2000 ms`
   (`scripts/profile-model.py:2,10,19,358`) — este último **não estava no handoff**.
   Verificado vazio: `grep -rn MAE docs/nfr/` e `grep -rn 2000 docs/nfr/`. **Nenhum dos dois
   limiares tem requisito por trás.** Insumo direto do ADR da S10.
3. **O código IBGE de Boa Esperança do Norte diverge — e o do TSE é inválido.** A migration
   `0007` gravou `5101837` (prefixo 51 = MT, dígito verificador **válido**); o EA12 real do
   simulado traz `cdi: "5300109"` (`tests/fixtures/tse/2026-sim/mun-e021270-cm.json:1560`),
   cujo dígito verificador é **aritmeticamente inválido** (esperado 8). Nada consome `cdi`
   (`grep cdi data-pipeline/zonas-import.ts` → vazio), então não quebra nada hoje. A regra
   que fica: **não tratar `cdi` do EA12 como código IBGE confiável.**

### Quatro documentos que mentem sobre o próprio código

Todos na mesma direção — dizendo que falta o que já existe. É o mesmo fenômeno das 16 caixas.

| Documento | O que afirma | Realidade no disco |
|---|---|---|
| `../specs/017-deputado-federal/spec.md:23-33` | corpo diz `implementing`, "não é shipped" | frontmatter diz `shipped` e está **certo** (`b1fbeca`, 13/09) |
| `../specs/019-fase-pre-eleicao/spec.md:33-34` | "Falta: `projection-seed.ts` e `edge-config-prune.ts`" | os dois existem desde 17/09, **com testes** |
| `../specs/020-evolucao-da-apuracao/spec.md:36-41` | Fase 2 marcada ⬜, funções "não existem" | as 3 existem desde 18/09 00:10; o `spec.md` foi editado às 00:50 sem corrigir |
| `../_meta/traceability.md:147,152` | RF-144 "⚠️ PARCIAL", RF-149 "❌ NÃO IMPLEMENTADO", ambos "bloqueiam `shipped`" | fechados em 13/09; **provados por mutação** nesta auditoria |

### Triagem das 60 caixas restantes

Nenhuma foi apagada. Cada uma tem destino e razão.

| Destino | Caixas | Razão |
|---|---|---|
| **[Trilho externo](./_trilho-externo.md)** (22–24/09, 02–03/10, 03/10) | 91, 97, 212, 229, 412, 439, 452, 453, 517, 519, 521, 523, 529, 530, 537, 538, 539, 737, 746 | **19 caixas.** Só executáveis dentro de uma janela do TSE. Pôr numa sprint sem data criaria tarefa que nunca pode começar. 521/523/537 e parte de 412/439 já eram **duplicatas** literais do trilho. |
| **[S08 — Enxergar](./2026-S08-f7-enxergar.md)** | 270, 415, 626, 628 | Alarme e portões. **270 entra aqui, não na S10**: é pré-requisito da mudança que a S10 vai fazer no mesmo número. |
| **[S09 — Provar](./2026-S09-f7-provar.md)** | 172, 213, 405, 432, 437, 528, 748 | Medir o pipeline e pôr freio na gaveta de dados. 405 é a Fase 3 da spec 020, que a S09 § 1 já detalha. |
| **[S10 — Verdade](./2026-S10-f7-verdade.md)** | 228 (3 sub-itens), 268, 269, 272, 302, 422, 425, 429, 446, 532, 700, 780, 787 | A promessa real, o contraste que falta, e as specs aos portões. |
| **[S11 — Resiliência](./2026-S11-f7-resiliencia.md)** | 750, 752 | Degradar com dignidade: timeout de leitura e backup. |
| **[S13 — Prep 2T](./2026-S13-f8b-prep2t.md)** | 784 | Replay de 2º turno só importa para 25/10. |
| **[Backlog](./backlog.md)** | 424, 426, 454, 753, 754, 785 | Sem bloqueio e sem data. 753/754 já constavam lá; 785 é ação do dono (CSV do IBGE). |
| **Descartadas** | 176, 182, 271, 303, 509, 531, 583, 786, sub-item "OT-4 novo" da 228 | Razão de cada uma abaixo. |

#### As descartadas, uma a uma

| Caixa | Razão do descarte |
|---|---|
| 271, 303, 531, sub-item da 228 | **Decisão D8 do dono**: a promessa de 95% será **baixada para o número real**, não consertada. Uma 3ª tentativa do OT-4 está proibida. Os gates finais migram para a S10 sem o pré-requisito "modelo convergir". |
| 509 | Descreve o Passo 1 da janela **15–17/09**, que já passou e foi perdida. O equivalente para a janela viva existe em `_trilho-externo.md` § Item 1 "Gatilho". |
| 583 | "Congelar a UI nas janelas de 15–17/09" — a janela passou, e `git log` mostra que o congelamento não foi observado de todo modo. |
| 176, 182 | Notas pontuais de 06–07/09 sobre medição não-confiável e gates não rodados; superadas por remedições posteriores, inclusive a desta auditoria. |
| 786 | `build_uf_payloads` serializar `model_fallback_tier` — o campo virou `@deprecated`; a tarefa perdeu o objeto. |

## Retrospective — fechada em 2026-09-18

### 🔴 O objetivo único NÃO foi cumprido

O objetivo era *"chegar aos simulados oficiais do TSE com o pipeline ingerindo dados reais
e as 4 rotas renderizando o hero de 1º turno"*. **A ingestão contra dado real do TSE
aconteceu uma vez, na madrugada de 17/09.** A 1ª janela (15–17/09) foi perdida quase
inteira e a 2ª (22–24/09) começa depois desta sprint fechar.

Dizer isto explicitamente importa, porque o documento afirmava o contrário: quatro linhas
do Definition of Done estavam marcadas ✅ sem nunca terem sido medidas (ver
[Auditoria de fechamento](#auditoria-de-fechamento--2026-09-18)).

**Isto não torna a sprint improdutiva** — ela entregou o redesign, as specs 016/017/018/019,
a spec 020 até a Fase 2, o ADR-0035 (par município×zona), o ADR-0044 (código por cargo), o
ADR-0047, a migration 0009 em produção, e a correção de dois defeitos que só apareceram
contra dado real (BotID em `/api/ingest/*`, SSO derrubando a autochamada com `ok: true`).
O que ela não fez foi a única coisa que se propôs a medir.

### O que funcionou

- **Ir contra dado real achou o que teste verde não acha.** O único ciclo de 17/09 comprou
  dois defeitos que passavam por verdes — e ambos estão no caminho exato do cron de 04/10.
- **A mutação como filtro.** Cinco aplicadas nesta auditoria; quatro mataram o teste como
  deviam, e a quinta expôs que o intervalo de confiança do produto não tem proteção nenhuma.
- **Subagente corrigindo orquestrador, e vice-versa.** Nesta auditoria o orquestrador pegou
  dois erros de agente e um agente reclassificou um achado do orquestrador (cor de partido:
  é acessibilidade, não neutralidade). Relatório é hipótese nos dois sentidos.

### O que melhorar

- 🔴 **O registro não acompanha o trabalho.** 16 caixas feitas e nunca marcadas; quatro
  documentos afirmando que falta o que já existe; uma caixa (775) já marcada feita 560
  linhas acima no mesmo arquivo. Não é desleixo pontual — **falta um passo no ciclo**. O
  conserto não é "ter mais cuidado": é a S08 § 6 (rastreabilidade) e rodar `spec-syncer`
  como parte do fechamento, não como intenção.
- 🔴 **Marcar ✅ o que não foi medido é pior que deixar em branco.** Uma caixa vazia convida
  a medir; um ✅ falso encerra a pergunta. Os quatro do DoD sobreviveram 13 dias.
- **Sprint com data de terceiro é promessa que não se controla.** Metade do escopo desta
  sprint dependia de quando o TSE publicasse. É exatamente o que a decisão D9 conserta, e
  por isso os 19 itens de data do TSE saíram para o
  [trilho externo](./_trilho-externo.md).
- **Um identificador de requisito significando três coisas** (RNF-006) passou meses sem
  ninguém notar. Citação de RNF precisa ser conferida contra `docs/nfr/`, não copiada.

### Carry-over

Nenhuma das 60 caixas remanescentes foi apagada; todas têm destino e razão na
[tabela de triagem](#triagem-das-60-caixas-restantes). Resumo: **19** → trilho externo,
**4** → S08, **7** → S09, **13** → S10, **2** → S11, **1** → S13, **6** → backlog,
**8** descartadas com razão escrita.

O que a S08 precisa saber ao abrir:

1. **`SLACK_WEBHOOK_URL` continua ausente nos dois ambientes** (conferido via
   `vercel env ls` em 18/09). É a primeira parada do dono e destrava os 9 alarmes mudos.
2. **A caixa 270 (assert de percentil do RF-015) virou pré-requisito**, não item solto:
   a S10 vai mudar esse número por decisão D8, e hoje nada trava se mudar errado.
3. **A janela de 22–24/09 dispara sozinha.** Ninguém precisa acionar nada; o risco é rodar
   e ninguém ver.

## Cross-refs

- Plano aprovado (sprint): [../_meta/plano-s07-2026-09-05.md](../_meta/plano-s07-2026-09-05.md)
- Plano aprovado (modelo, Fase 3b): [../_meta/plano-modelo-regra-de-tres-2026-09-05.md](../_meta/plano-modelo-regra-de-tres-2026-09-05.md)
- Handoff da Fase 3: [../_meta/handoff-2026-09-05-fase3.md](../_meta/handoff-2026-09-05-fase3.md)
- Handoff de 05/09: [../_meta/handoff-2026-09-05.md](../_meta/handoff-2026-09-05.md)
- Fonte técnica do leiaute: [../reference/tse-2026-leiautes.md](../reference/tse-2026-leiautes.md)
- Protocolo de simulado: [../testing/tse-simulados.md](../testing/tse-simulados.md)
- Runbook: [../operations/runbook.md](../operations/runbook.md)
- Sprint anterior: [2026-S06-f4d-2t-governadores.md](./2026-S06-f4d-2t-governadores.md)
- Próxima sprint: [2026-S08-f7-enxergar.md](./2026-S08-f7-enxergar.md) — primeira das quatro
  sprints **sem data** (S08→S11, ordenadas por dependência). A antiga
  `2026-S08-f7-estabilizacao.md` foi absorvida pela [S11](./2026-S11-f7-resiliencia.md) em 18/09.
