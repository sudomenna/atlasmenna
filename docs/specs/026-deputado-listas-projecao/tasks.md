---
id: 026-deputado-listas-projecao
type: tasks
status: in_progress
spec: docs/specs/026-deputado-listas-projecao/spec.md
started: 2026-09-29
---

# Tasks — spec 026 (Deputado Federal: listas, projeção com trava, extras, correções)

Plano de 29/09. RF-260..RF-277 conferidos por grep (nenhum uso anterior). Cada frente roda num
worktree próprio e **não commita** — o orquestrador mescla na ordem T → P → S → U na sexta 02/10.
Os ADRs novos são **ADR-0063** (projeção com trava e interruptor), **ADR-0064** (destino do voto no
proporcional) e **ADR-0065** (listas em três faixas); números a preencher.

| Frente | Dono | Janela | Portão da frente |
|---|---|---|---|
| D — documentação e contrato | orquestrador + `spec-implementer` (W0) · `adr-author` (A → B → C) | ter 29/09 13h → qua 30/09 09h | contrato congelado |
| T — dados em TypeScript | `spec-implementer` (frente T) | qua 30/09; **tipos congelados às 20h** | vitest, typecheck, lint, mutações T |
| P — modelo (Python) | `spec-implementer` (frente P) + `model-validator` (G1–G5) | P1 qua à noite · P2 qui 13h · P3 qui 20h | pytest, golden 511/513, mutações P |
| S — modo simulado | `spec-implementer` (frente S) | qui 01/10, depois de T | `pnpm sim:full` verde + contrato no simulado |
| U — telas | `spec-implementer` (frente U) | qua → qui; troca para o simulado qui 18h | vitest de tela, mutações U, olho no `dev:sim` |
| G — portões | `model-validator` ‖ `a11y-perf-auditor` ‖ `constitution-guard` → `rf-coverage-checker` → `spec-syncer` | sex 02/10 até 18h | tudo verde → dono aprova o envio |

## D — documentação e contrato (W0)

- [x] D1. `spec.md`, `design.md`, `tasks.md` desta spec.
- [x] D2. Emenda da spec 017 (D9 e "suplência nominal fora" superados; (m5), (t5), (t), (c3) a
      reescrever; (m6) fica) — `docs/specs/017-deputado-federal/{spec,design}.md`.
- [x] D3. Emenda da spec 011 (projeção de deputado na seção 5 de `/sobre-o-modelo`, sem `<h2>`).
- [x] D4. 026 em `specs_in_flight` da sprint ativa (`docs/sprints/2026-S08-f7-enxergar.md`).
- [x] D5. Fixtures de contrato à mão (`tests/fixtures/contrato/`, 4 UFs + lista 61+ + nacional) e
      `tests/unit/contrato/deputado-v2-fixtures.test.ts` (75 casos; 5 mutações aplicadas à mão na fixture, todas mortas).
- [x] D6. EA20 reais do simulado de cargo 6 (RR, AP) em `tests/fixtures/tse/2026-sim/dep/` —
      `tse-parser-builder`, só `SELECT`.
- [ ] D7. ADR-0063, ADR-0064, ADR-0065 (`adr-author`, em sequência) e troca de "ADR-0063/B/C" pelos números em
      `spec.md`, `design.md` e nas emendas.
- [ ] D8. Não tocados aqui, ficam para o `spec-syncer` na barreira: `docs/_meta/traceability.md`,
      `docs/_meta/index.json`, `docs/README.md`, `docs/design-system/components.md`.

## T — dados em TypeScript (entra primeiro)

- [ ] T1. `lib/blob/deputado-uf.ts`: tipos v2 do design § 2.2–2.5 (`DeputadoUfLinha`,
      `DeputadoUfAgremiacaoV2`, `DeputadoUfDetailV2`, `DeputadoUfLista`, `DeputadoRegras`,
      `DeputadoProjecaoUf`, `DeputadoConferencia`), `dado_ts`/`pares_atrasados` declarados;
      `readDeputadoUfLista`; `maisVotadosDaUf` (RF-276, RF-270).
- [ ] T1.9. Trocar os `as unknown as` de `tests/unit/contrato/deputado-v2-fixtures.test.ts` por
      `satisfies` contra os tipos novos — o teste passa a provar a forma.
- [ ] T2. `lib/blob/paths.ts`: `deputadoUfListaBlobPathname` (mesma validação de sigla).
- [ ] T3. `lib/edge-config/types.ts`: `EdgeDeputadoDestaque`, `EdgeDeputadoPuxador`,
      `mais_votados?`, `puxadores?`, `por_uf[].projecao?` (RF-271, RF-273).
- [ ] T4. `lib/edge-config/keys.ts` (`INTERRUPTOR_PROJECAO_DEP_KEY`) + `reader.ts`
      (`readInterruptorProjecao`, falha fechada, nunca lança) (RF-265).
- [ ] T5. `lib/edge-config/writer.ts::writeDeputadoProjection`: separa `lista_restante`, grava
      `deputado/uf-lista/<UF>.json` antes do objeto da UF, só se houver linha; `warn` acima de 3,5 MB
      de corpo (design § 2.1, § 2.5).
- [ ] T6. Teste da rota `app/api/internal/edge-write/route.ts`: campo v2 dentro de `payload`,
      `payload.por_uf[i]` e `payloads_uf[UF]` chega; o mesmo no topo some sem erro (RF-276).
- [ ] T7. Rota `app/(dep)/uf/[sigla]/deputado-federal/lista/route.ts` (`revalidate = 60`,
      `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, 200/404/502) (RF-260).
- [ ] T8. `lib/tse/ingest-handler.ts`: lê o interruptor e manda `projecao_dep` no POST do modelo
      (design § 2.11) (RF-265).
- [ ] T9. `scripts/interruptor-projecao.ts` + `pnpm dep:projecao` (mostra, confirma, `--ensaio`)
      (RF-265).
- [ ] T10. `scripts/edge-config-falso.ts` serve o Blob (`/deputado/uf/…`, `/deputado/uf-lista/…`) e
      a chave do interruptor; `build:e2e`/`start:e2e` com `BLOB_PUBLIC_BASE_URL` apontado para ele
      (RF-277).
- [ ] T11. Texto "sem deploy" sobre `TSE_DEPUTADO_GRANULARIDADE` corrigido em
      `docs/operations/runbook.md:870` e `vercel.ts:184` (RF-265).

## P — modelo (Python)

### P1 — as três correções (qua 30/09, noite)

- [ ] P1.1. `deputado.py`: `_DESTINO_PROPORCIONAL` (quatro valores, sem default), `Candidato` só
      para `Válido`, legenda = Σ `par.tvtl`, `destino` na identidade; `dvt` ausente no arquivo ⇒
      caminho de hoje (design § 7) (RF-268).
- [ ] P1.2. Invariante Σ (nominais válidos + legenda) == `v.vv` por arquivo: `error` + alerta, sem
      abortar; teste com os EA20 reais de `tests/fixtures/tse/2026-sim/dep/` (RF-268).
- [ ] P1.3. Golden de 2022 inalterado (511/513) e teste de bit-identidade com `dvt` ausente (RF-268).
- [ ] P1.4. `project.py` (ramo proporcional): `pct_apurado` = Σ `e.esi` ÷ `max(e.te agregado, Σ e.te)`,
      no lugar do `max` de `:7923`; alimenta `_marcar_indefinidas` (RF-275).
- [ ] P1.5. Conferência (design § 2.8): as quatro comparações, `comparou`, `diferenca_pct`, estado;
      `quociente_eleitoral_tse` volta a vir do agregado; `CHAVES_DE_DIVERGENCIA` ampliado (RF-269).
- [ ] P1.6. `st` por `sqcand` do agregado com `tf = "s"` → `tse` (tabela fechada) (RF-267).

### P2 — projeção (qui 01/10, 13h)

- [x] P2.1. `api/model/deputado_projecao.py`, puro: zona apurada, fator `te/esi`, razão das somas
      por chave, tercis (≥ 12 zonas), imputação do estado inteiro, arredondamento por maiores restos,
      `distribuir_cadeiras`, apertada (design § 5) (RF-263).
- [x] P2.2. Trava na ordem fixa do design § 2.7, com os sete motivos (RF-264).
- [x] P2.3. Log `dep_projecao`, uma linha por ciclo (design § 5.9) (RF-263, § 6 da constituição).
- [x] P2.4. `ProjectRequest.projecao_dep` opcional; ausente ⇒ desligado (RF-265).
- [ ] P2.5. Faixa `cadeiras_projetadas_ci95` se couber no ciclo (opcional) (RF-127 emendado).
      **Adiada (orquestrador, 29/09):** o bootstrap custou ~10,5 s nas 27 UFs (M4) — o mesmo do
      da parcial —, e os dois juntos (~21 s locais) deixariam o ciclo perto do `maxDuration` de
      60 s na Vercel. O campo fica ausente (opcional no contrato); pendência para depois de 04/10.

### P3 — payload v2 (qui 01/10, 20h)

- [x] P3.1. `deputado_payload.py`: `DeputadoUfLinha` com `rank` (design § 3.1), `numero`,
      `pct_validos`, `parcial`/`indefinido`, `projecao`/`projecao_apertada`, `tse`, `destino`;
      `candidatos` (1..60 ∪ marcados ∪ `primeiro_fora`), `total_candidatos`, `lista_restante`
      (RF-260, RF-261, RF-262).
- [x] P3.2. `corte`, `puxadores`, `regras`, `mais_votados` (UF, por referência), `lista.restantes`,
      `projecao`, `conferencia`, `contrato: 2` (RF-270, RF-272, RF-273, RF-274).
- [x] P3.3. Nacional: `mais_votados`, `puxadores` (até 30), `por_uf[].projecao` (RF-271, RF-273).
- [x] P3.4. `eleitos`/`suplentes`/`divergencias` v1 mantidos com a semântica v1 (design § 2.12).
- [x] P3.5. Teste: o payload produzido a partir dos EA20 reais passa pelas mesmas invariantes de
      `tests/unit/contrato/deputado-v2-fixtures.test.ts` (reescritas em pytest ou por exportação de
      JSON para o vitest).

## S — modo simulado (qui 01/10, depois de T)

- [ ] S1. `data-pipeline/simulacao-gerar.ts::montarDeputado` emite v2: projeção com ruído
      decrescente com o % apurado; os três estados da trava; uma UF a 100% com `totalizacao_final`;
      destinos em duas UFs (inclusive chapa inteira sub judice); puxador em SP; os três estados da
      Conferência, um deles com magnitude de eleitorado.
- [ ] S2. `tests/fixtures/simulacao/deputado-uf-lista.json` novo; `pnpm sim:full` continua sendo a
      cadeia inteira (nunca `pnpm sim` sozinho).
- [ ] S3. O teste de contrato roda também sobre a fixture do simulado (parametrizar a fonte).

## U — telas

- [ ] U1. `lib/utils/deputado-marcas.ts` (`marcasDaLinha`, bitmask, precedência do TSE, rótulos)
      (RF-262, RF-266, RF-267).
- [ ] U2. `components/atoms/badges/MarcaDeputado.tsx` — texto primeiro; projeção vazada, TSE cheia
      (RF-262, RF-266, RF-267).
- [ ] U3. `components/blocks/DeputadoListaAgremiacao.tsx` + CSS Module — três faixas, tuplas
      compactas, `aria-expanded`/`aria-busy`/região viva/foco/erro, linha de corte,
      `content-visibility` (RF-260, RF-261, RF-272).
- [ ] U4. `DeputadoMaisVotados`, `DeputadoPuxadores`, `DeputadoRegras`, `DeputadoConferencia`
      (RF-269, RF-270, RF-271, RF-273, RF-274).
- [ ] U5. `/uf/[sigla]/deputado-federal` na ordem da spec § Telas; linha de estado da projeção no
      resumo; `readInterruptorProjecao` em paralelo com as duas leituras de hoje (RF-264, RF-265).
- [ ] U6. `DeputadoMetodologia` estendido como bloco "o que está movendo" (RF-266).
- [ ] U7. Capa `/deputado-federal`: mais votados do país, puxadores, selo por UF; teste de 0 leituras
      de Blob (RF-271, RF-273).
- [ ] U8. `/sobre-o-modelo` seção 5: parágrafos da projeção de deputado; oito `<h2>` (RF-266).
- [ ] U9. Reescrever (m5), (t5), (t), (c3) em `tests/unit/pages/deputado-federal.test.tsx`; (m6) fica.
- [ ] U10. v1 renderiza (`tests/fixtures/blob/dep-uf.json`) (RF-276).
- [ ] U11. e2e: `/uf/SP/deputado-federal` em `tests/e2e/perf-budget.spec.ts` com teto próprio de
      480 KiB e em `tests/e2e/a11y-audit.spec.ts`, lista aberta e fechada, 375 px (RF-277).

## G — portões (sex 02/10 até 18h)

- [ ] G1. Identidades: a 100% apurado e com fração igual em todas as zonas, projeção == parcial
      (`model-validator`).
- [ ] G2. Replay sintético: totais do golden 2022 espalhados pelas zonas de 2026, 3 concentrações ×
      3 ordens de chegada × 20 sementes, pontos de 25–90%; cadeiras e eleitos trocados, projeção ×
      parcial. **O resultado a 25% vai ao dono** — ele decide se liga (`model-validator`).
- [ ] G3. Replay com a geografia real de 2022 — só se o dono baixar os dois `.zip` (links no plano).
- [ ] G4. Simulado: SELECT dos snapshots de cargo 6 — quando a trava abre, tempo do ciclo,
      Conferência.
- [ ] G5. Replay presidencial inalterado: MAE@1h PT 2,3623 pp, cobertura 82,5%.
- [ ] G6. `a11y-perf-auditor`: `pnpm build:e2e && pnpm start:e2e` + `pnpm test:e2e`; 375 px;
      teclado; tempo de SSR de SP.
- [ ] G7. `constitution-guard` (§§ 1, 2, 4, 6, 8) → `rf-coverage-checker` → `spec-syncer`.
- [ ] G8. Suítes: `pnpm test` (só as 10 suítes de banco podem falhar na coleta),
      `.venv-model/bin/python3.14 -m pytest` (base 919), `pnpm lint`, `pnpm typecheck`.

## Mutações

O plano de 29/09 manda "mutações" em cada frente sem listá-las; a lista abaixo sai das invariantes
do design. **Aplique você mesmo e confira que o teste cai** — relatório de agente não conta. Em
Python, limpe `__pycache__` nos dois lados (o `.pyc` mascara mutação de um dígito). Teste de limiar
precisa de caso **no** limiar; mutação que sobrevive quase sempre é fixture que não alcança a linha.

| # | Frente | Mutação | Quem tem de matar |
|---|---|---|---|
| M1 | P1 | `pct_apurado` volta ao `max(...)` das linhas | teste com o `m1` real de RR (≈ 20%, não 100) |
| M2 | P1 | denominador só Σ `e.te` das zonas (sem o `max` com o agregado) | teste com o AP real (≈ 80,5%, não 100) |
| M3 | P1 | `dvt` ignorado (todo `vap` vira `Candidato`) | invariante com `v.vv`; chapa sub judice não elege |
| M4 | P1 | `Válido (legenda)` descartado em vez de ir para a legenda | invariante com `v.vv` |
| M5 | P1 | `dvt` ausente tratado como excluído | bit-identidade + golden 511/513 |
| M6 | P1 | `confere` sem ter feito a comparação `algoritmo` | teste de Conferência (estado × `comparou`) |
| M7 | P1 | Conferência compara rótulo do TSE com a nossa via | caso real em que "Eleito por QP" ≠ nossa via e o conjunto bate |
| M8 | P1 | `agr.vag` usado com `and = "n"` | `sem_dado_tse` no agregado de `m0-zero` de RR |
| M9 | P2 | `>=` → `>` no `pct_minimo` | caso em exatamente 25,00000 |
| M10 | P2 | `zonas_minimas` 2 → 1 | caso com uma zona só a 30% |
| M11 | P2 | zona apurada `esi > 0 ∨ vv > 0` | zona com `esi > 0` e `vv = 0` |
| M12 | P2 | condição de cobertura removida | AP real fica `liberada` |
| M13 | P2 | ordem dos motivos trocada | duas condições falhando juntas |
| M14 | P2 | marca de projeção emitida com `aguardando` | invariante "marcas só com liberada" |
| M15 | P2/T | interruptor ausente ou ilegível ⇒ ligado | falha fechada no ciclo e no render |
| M16 | P2 | `round()` no lugar de maiores restos | Σ cadeiras projetadas == lugares; G1 |
| M17 | P2 | imputação aplicada a 100% apurado | G1 |
| M18 | P3 | `rank` desempata por `sqcand` antes do destino | empate de votos entre válido e sub judice |
| M19 | P3 | excedente sem o `− 1` | teste de puxador |
| M20 | P3 | puxador a partir de 1 × QE | caso em 2 × QE − 1 |
| M21 | P3 | piso com `floor` em vez de `⌈ ⌉` | QE 1.003 (pisos 101, 803, 201) |
| M22 | P3 | linha marcada com rank > 60 fora do Blob / rank ≤ 60 na lista | invariantes de faixa |
| M23 | P3 | `pct_validos` numérico para sub judice | invariante "`null` ⇔ anulado/sub judice" |
| M24 | T | writer grava o objeto da UF com `lista_restante` dentro | teste do writer (objeto da UF sem a chave) |
| M25 | T | campo v2 no topo do corpo de escrita | teste da rota (chega ao Blob só por dentro) |
| M26 | T | `pct_minimo` < 25 aceito na chave | teste do reader |
| M27 | T | script aceita o store de ensaio sem `--ensaio` | teste do script |
| M28 | U | lista reordenada pela projeção | teste de ordem com projeção que inverte dois |
| M29 | U | precedência invertida (parcial visível com `tf`) | fixture AC |
| M30 | U | marca de projeção só com `estado` (sem o interruptor) no render | interruptor desligado + objeto liberado |
| M31 | U | "eleito" sozinho em algum rótulo | varredura de texto |
| M32 | U | linhas 21–60 removidas do DOM em vez de escondidas | contagem de `<li>` com a lista fechada |
| M33 | U | segundo "mostrar todos" refaz o `fetch` | contagem de chamadas |
| M34 | U | capa lê Blob | `readDeputadoUfDetail` com 0 chamadas |
| M35 | U | "batem com o TSE" sem `algoritmo` em `comparou` | fixture SP (`sem_dado_tse`) |
| M36 | U | corte na faixa fechada sem a repetição no cabeçalho | PL de SP (25 eleitos) |
| M37 | S | simulado com marca de projeção em UF `aguardando` | contrato rodando sobre o simulado (S3) |
