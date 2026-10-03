---
id: 027-deputado-estadual-distrital
type: tasks
status: in_progress
spec: docs/specs/027-deputado-estadual-distrital/spec.md
started: 2026-09-29
---

# Tasks — spec 027 (Deputado Estadual e Distrital)

Plano aprovado pelo dono em 29/09. RF-278..RF-290 conferidos por grep (nenhum uso anterior). Cada
frente roda num worktree próprio a partir da `main` atual e **não commita** — o orquestrador mescla. Os
ADRs novos são **ADR-0066** (cargos 7/8 como proporcionais) e **ADR-0067** (orçamento de requisições;
emenda o ADR-0036), escritos pelo `adr-author` em paralelo.

| Frente | Dono | Janela | Portão da frente |
|---|---|---|---|
| D — documentação | orquestrador + `spec-implementer` (esta) · `adr-author` (0066, 0067) | ter 29/09 → qua 30/09 manhã | spec, design e tasks; ADRs aceitos |
| Passo 0 — EA20 reais de 7/8 | `tse-parser-builder` (só leitura) | qua 30/09 manhã | arquivos guardados ou "fora do ar" registrado |
| T — dados em TypeScript | `spec-implementer` (frente T) | qua 30/09; **tipos congelados qua 20h** | vitest, typecheck, lint, mutações T |
| P — modelo (Python) | `spec-implementer` (frente P) → `model-validator` | qua 30/09 → qui 01/10 | pytest, golden federal 511/513, mutações P |
| U-a — página da casa | `spec-implementer` (frente U-a) | qua → qui | vitest de tela, testes do federal sem edição, mutações U-a |
| U-b — capa e navegação | `spec-implementer` (frente U-b) | qua → qui | vitest de tela, mutações U-b, 320 px no navegador |
| S — modo simulado | `spec-implementer` (frente S), depois de T e da S da 026 | qui 01/10 | `pnpm sim:full` verde (no terminal do dono) |
| Fase 2 — zonas e projeção | `spec-implementer` → `model-validator` | qui 01/10 → sex 02/10 manhã | teste de crons, pior caso 81, G1/G2 das assembleias |
| G — portões | `model-validator` ‖ `a11y-perf-auditor` ‖ `constitution-guard` → `rf-coverage-checker` → `spec-syncer` | sex 02/10 até 18h | tudo verde → dono decide Fase 1 × Fase 2 e aprova o envio |

A divisão U-a (página da casa) × U-b (capa e navegação) é a deste arquivo; se o briefing já despachado
para a U-a recortou diferente, vale o despacho e esta tabela se ajusta.

## D — documentação

- [x] D1. `spec.md`, `design.md`, `tasks.md` desta spec.
- [x] D2. Emenda da spec 017 — "Deputado Estadual e Distrital" em Fora superado; RF-120/RF-128 em 60 min
      se a Fase 2 subir (`docs/specs/017-deputado-federal/spec.md` § Fora).
- [x] D3. Emenda da spec 018 — Fora e a aceitação `?cargo=7` do RF-147
      (`docs/specs/018-identidade-candidatura/spec.md`).
- [x] D4. Emenda da spec 011 — parágrafo das assembleias na seção 5 (`docs/specs/011-sobre-o-modelo/spec.md`
      § Emendas).
- [x] D5. 027 em `specs_in_flight` da sprint ativa (`docs/sprints/2026-S08-f7-enxergar.md`).
- [ ] D6. ADR-0066 e ADR-0067 (`adr-author`); nota no ADR-0044 (7/8 cobertos na eleição `21272`); a
      emenda do ADR-0036 vai pelo 0067. Links na spec e no design trocados pelo `spec-syncer`.
- [ ] D7. Linha "Deputado Estadual/Distrital (inalterado desde a spec 017)" em Fora da spec 026 —
      **não tocada aqui** (outra sessão trabalha na 026); `spec-syncer` na barreira.
- [ ] D8. Para o `spec-syncer` na barreira: `docs/_meta/traceability.md`, `docs/_meta/index.json`,
      `docs/README.md`, `docs/design-system/components.md` (`DeputadoCasaSeletor`,
      `DeputadoBancadaPanel`, T-17, T-18).
- [ ] D9 (Passo 0). EA20 reais de cargo 7 e 8 do simulado, se no ar: `sp-c0007-e021272-u.json`, uma
      zona de SP do cargo 7 (endereço derivado da lista de zonas do EA12, nunca adivinhado),
      `df-c0008-e021272-u.json`; confirmar `carg.cd`, `nv`, `qe`, `dvt`, `par`, `tf`; guardar em
      `tests/fixtures/tse/2026-sim/dep-est/` com README. Fora do ar ⇒ registrar e seguir pelo leiaute.

## T — dados em TypeScript (entra primeiro)

- [ ] T1. `lib/config/cargos.ts`: `CargoTse` com 7 e 8; `CargoProporcional`; campo obrigatório `ufs`
      e `ufsDoCargo(cd)`; `faixaRps`; entradas 7/8 da Fase 1 (`granularidade: "uf"`, `rpsMax: 1`,
      `eleicao: "estadual"`); `piorCasoAgregadoRps()` por faixa (design § 2.1, § 5.2) (RF-278, RF-285).
- [ ] T2. `lib/config/calendar.ts:52` com `est` e `dis` (e corridas de 04/10); `CADENCIA_SEGUNDOS` de
      `lib/config/dado-freshness.ts:77` com 7 e 8 = 300; deixar o compilador apontar o resto
      (`app/sobre-as-etiquetas/page.tsx:152`, qualquer `Record<CargoTse, …>`) (RF-279, RF-285).
- [ ] T3. `lib/tse/targets.ts`: `ufsDoCargo` nos **quatro** construtores (`buildProductionTargetsUf`
      `:960`, `buildProductionTargetsZona` `:1032` e os dois de preview) e no agregado somado ao modo
      zona (`:788-790`); `TSE_DEPUTADO_GRANULARIDADE` (`:483`) vale para todo proporcional; `VALID_CARGOS`
      com 7/8 (RF-278).
- [ ] T4. `lib/tse/ingest-handler.ts` (`:246`, `:264`): interruptor lido pela chave do cargo e
      `projecao_dep` para todo proporcional em zona — nunca em resumo (RF-285, RF-287).
- [ ] T5. `lib/edge-config/keys.ts`: `INTERRUPTOR_PROJECAO_EST_KEY`; chave nacional por token.
      `reader.ts`: `readDeputadoProjection(cargo)`, `readInterruptorProjecao(cargo)`; `CargoMajoritario`
      (`:76`) derivado de `proporcional`. `types.ts:2052`: `cargo: CargoProporcional` (RF-279, RF-287).
- [ ] T6. `lib/blob/paths.ts` (`:208`, `:231`): construtores com cargo; os três caminhos do 6 fixados
      **literalmente** em teste; sigla validada por `ufsDoCargo` (RF-279).
- [ ] T7. `lib/blob/deputado-uf.ts` (`:200`, `:805`): `cargo: CargoProporcional`; leitores com cargo
      (RF-279).
- [ ] T8. `app/api/internal/edge-write/route.ts:342`: união dos proporcionais; UF fora do cargo em
      `payloads_uf`/`por_uf` descartada com `error` + alerta. `lib/edge-config/writer.ts` (`:1277`,
      `:1384`): chave e `cargo` do payload (RF-279).
- [ ] T9. Teste do writer: POST de cargo 7 com SP grava `deputado-estadual/uf/SP.json` e **não** toca
      `deputado/uf/SP.json` (RF-279).
- [ ] T10. `vercel.ts` da Fase 1: crons de 7 e 8 a cada 5 min, em minutos deslocados das fatias do 6;
      entradas novas com janela do simulado `12-19` (design § 5.4); **conferir o limite de crons do
      plano Vercel antes** (RF-285).
- [ ] T11. `data-pipeline/candidatos-parse.ts:48` `CARGOS_PRODUTO` com 7 e 8; publicador por token
      (`est.json`, `dis.json`); `/candidatos` aceita 7/8 nas UFs de cada um; reescrever
      `tests/unit/pages/candidatos.test.tsx:162` (RF-288).
- [ ] T12. `scripts/interruptor-projecao.ts --cargo estadual` (mesmas recusas de store e `--ensaio`)
      (RF-287).
- [ ] T13. `tests/unit/config/cargos.test.ts`: pior caso 82 (substitui o 80 de `:85`) e o caso da
      tabela da Fase 2 (81) (RF-285, RF-286).
- [ ] T14. Vigia do ciclo e checagens da véspera cobrem `projection-current-est-t1` e `-dis-t1` (dado
      parado de 7/8 alerta) (RNF-012; design § 13, `TSE_CARGOS`).

## P — modelo (Python)

- [ ] P1. `api/model/cargos.py`: 7 e 8 na tabela; `TOTAL_CADEIRAS` e `VAGAS_EM_DISPUTA_2026` com
      `7: 1035, 8: 24`; `CADENCIA_SEGUNDOS` com 7 e 8 = 300; `ufs_do_cargo`; `test_cargos_sync.py`
      (RF-278, RF-280).
- [ ] P2. `api/model/project.py`: `UFS_DA_ELEICAO` (`:7744`; usos `:8463, :8497, :8528`) → UFs do
      cargo; `CARGOS_COM_VOTACAO_UF` (`:4129`) com 7 e 8; `atualizacao_min` da cadência do cargo (`:8527`);
      alertas pelo rótulo (`:8168`, `:8512`); `zonas_para_o_modelo` (`:2667`) sem `warn` para resumo
      configurado (RF-280, RF-285).
- [ ] P3. Gate "granularidade `uf` ⇒ não projeta", **antes** da trava; objeto sem `projecao` (RF-285,
      RF-287).
- [ ] P4. Conferência em resumo: `eleitorado_lido=None`, `validos_lidos=None`, `nao_comparou`;
      `granularidade` no objeto da UF (design § 3.2, § 6) (RF-285).
- [ ] P5. `deputado_payload.py`: `cargo`; total fixo; `conferir_total_de_cadeiras` contra o total do
      cargo; `ufs_calculadas + ufs_aguardando = |UFs do cargo|` (RF-280).
- [ ] P6. Teste: 7 e 8 caem no ramo proporcional (`_e_proporcional`, `:5305`) (RF-278).
- [ ] P7. Golden: `scripts/build-cadeiras-golden.py --cargo` (hoje `CARGO = "6"` em `:47` e 513 em
      `:150`); teste por casa com divergências nomeadas — **depende do dono** (RF-290).

## U-a — página da casa

- [ ] Ua1. `lib/utils/casa-legislativa.ts` (`nomeDaCasa`, `nomeDaUnidade`), tabela fechada das 26 UFs;
      teste (RF-284).
- [ ] Ua2. Extrair `app/(dep)/uf/[sigla]/deputado-federal/page.tsx` para `app/(dep)/_pagina-uf-deputado.tsx`;
      federal fino; `tests/unit/pages/deputado-federal.test.tsx` passa **sem edição** (RF-281).
- [ ] Ua3. `app/(dep)/uf/[sigla]/deputado-estadual/page.tsx` e `…/deputado-distrital/page.tsx`;
      redirecionamentos 308 e 404 (design § 7.1) (RF-281).
- [ ] Ua4. `app/(dep)/_rota-lista-deputado.ts` + `app/(dep)/uf/[sigla]/deputado-estadual/lista/route.ts`;
      404 para sigla fora das 26 (RF-281).
- [ ] Ua5. `DeputadoListaAgremiacao`: `rotaLista: string | null`, cache por `slug:UF` (`:106`, `:126`,
      `:129`) (RF-281).
- [ ] Ua6. `DeputadoMaisVotados`, `DeputadoPuxadores`, `DeputadoRegras`, `DeputadoConferencia`,
      `DeputadoMetodologia` com cargo e nome da casa; Conferência lê `nao_comparou` (RF-281, RF-284,
      RF-285).
- [ ] Ua7. Sem `projecao` no objeto ⇒ sem linha de estado da projeção e sem "o que está movendo"
      (RF-285).
- [ ] Ua8. `app/(dep)/_interruptor.ts::lerInterruptorDaTela(cargo)` (RF-287).

## U-b — capa e navegação

- [ ] Ub1. `resumosPorUf` movido para `lib/`; uniões puras (mais votados, puxadores, soma por `cod`) em
      `lib/`, com teste (design § 8.2) (RF-282).
- [ ] Ub2. `components/blocks/DeputadoBancadaPanel.tsx` extraído de
      `app/(dep)/deputado-federal/page.tsx:520`; a capa federal passa nos testes de hoje sem edição
      (RF-282).
- [ ] Ub3. `app/(dep)/deputado-estadual/page.tsx` — ordem da spec § Telas; frescor por payload; total
      1.059; aviso (RF-280, RF-282).
- [ ] Ub4. `components/layout/CargoTabs.tsx:130-135`: "Deputados"; atual em toda rota de deputado
      (RF-283).
- [ ] Ub5. `components/layout/DeputadoCasaSeletor.tsx` nas quatro telas; `data-trilha="dep"` nas de
      7/8 (RF-283).
- [ ] Ub6. `/sobre-o-modelo` § 5: parágrafo das assembleias; oito `<h2>`
      (`tests/integration/sobre-o-modelo-page.test.tsx`) (emenda da spec 011).

## S — modo simulado (depois de T e da S da 026)

- [x] S1. ~~`data-pipeline/simulacao-gerar.ts::montarDeputado` por cargo~~ — **feito por outro
      caminho em 03/10**: `data-pipeline/simulacao-assembleias.py` roda o MODELO PYTHON real
      (`_do_project`) com conexão falsa sobre os EA20 reais de `tests/fixtures/tse/2026-sim/dep-est/`
      (RR, SP cargo 7; DF cargo 8 com `nv` 24 e listas de 25) e deriva as outras UFs do 7 de SP —
      sem banco e sem rede (`pnpm sim:full` lê produção). SP no pior caso: 94 lugares, agremiações
      de 95, nomes de 30 caracteres acentuados (RF-280, RF-289). Validador:
      `tests/unit/dev/assembleias-fixtures.test.ts` (M39, M40).
- [~] S2. Fase 1 coberta (`granularidade: "uf"`, sem `projecao`, `nao_comparou`); Fase 2 (as três
      saídas da trava) NÃO — o gerador não recebe a fase (RF-285, RF-287).
- [x] S3. Saídas `deputado-estadual{,-uf,-uf-lista}.json` e `deputado-distrital{,-uf}.json`;
      `lib/dev/simulacao.ts` lê por cargo (`simulacaoAssembleia*`); `app/(dep)/_dados-da-casa.ts`
      (`FONTES_DEV[7|8]`) e `app/(dep)/_interruptor.ts` (`interruptor-projecao-est.json`) ligados.
- [x] S4. `scripts/edge-config-falso.ts` serve `projection-current-est-t1`, `-dis-t1`,
      `interruptor-projecao-est` (desligado salvo fixture) e os Blobs dos dois prefixos (RF-289).
- [ ] S5. ~~`pnpm sim:full` no terminal do dono~~ — não é preciso para 7/8: o gerador das
      assembleias não lê banco (`.venv-model/bin/python3.14 data-pipeline/simulacao-assembleias.py`
      + `biome format --write tests/fixtures/simulacao`). `pnpm sim:full` continua sendo o do federal
      e não toca os arquivos das assembleias.

## Fase 2 — zonas e projeção

- [ ] F2.1. `CARGOS`: 7 em `zona` com `rpsMax: 5` e `faixaRps: "deputado-zona"` (o 6 também); 8 em
      `zona` com `rpsMax: 1` (RF-286).
- [ ] F2.2. `vercel.ts`: fatias do 6 nos minutos 0/10/20/30/40/50, do 7 nos 5/15/25/35/45/55, uma vez
      por hora; 8 a cada 5 min; teste que expande os crons de `vercel.ts` (design § 5.3) (RF-286).
- [ ] F2.3. `CARGOS_FATIAVEIS` (`app/api/ingest/[cargo]/[fatia]/route.ts:64`) com 7; trava por
      `(cargo, fatia)` provada com 6 e 7 (RF-286).
- [ ] F2.4. Cadência 3.600 s para 6 e 7 em `CADENCIA_SEGUNDOS` (TS e Python), `atualizacao_min`,
      vigias, textos de frescor, `docs/operations/runbook.md` e `docs/operations/vespera-03-10.md`
      (RF-286).
- [ ] F2.5. Projeção de 7/8 com `api/model/deputado_projecao.py` atrás de `interruptor-projecao-est`,
      publicada desligada (RF-287).
- [ ] F2.6. `model-validator`: G1 (100% apurado ⇒ projeção = parcial) e G2 (ensaio sintético a 25%) das
      assembleias — o G2 precisa dos dados de 2022 do dono; sem eles, `-est` fica desligada em 04/10.

## G — portões (sex 02/10 até 18h)

- [ ] G1. Suítes: `pnpm test` (só as suítes de banco podem falhar na coleta — filtrar `^ FAIL`, nunca
      `tail`), `.venv-model/bin/python3.14 -m pytest`, `pnpm typecheck`, `pnpm lint`.
- [ ] G2. `model-validator`: golden das assembleias (RF-290), golden federal 511/513, G1/G2 das
      assembleias (se Fase 2), replay presidencial inalterado (MAE@1h PT 2,3623 pp, cobertura 82,5%).
- [ ] G3. `a11y-perf-auditor`: `pnpm build:e2e && pnpm start:e2e` + `pnpm test:e2e` com
      `/deputado-estadual`, `/uf/SP/deputado-estadual`, `/uf/DF/deputado-distrital` em
      `tests/e2e/perf-budget.spec.ts` e `tests/e2e/a11y-audit.spec.ts` (375 px, teclado, lista aberta e
      fechada); teto próprio de SP estadual proposto ao dono; `/uf/SP/deputado-federal` sem regressão
      (RF-289).
- [ ] G4. Olho no `pnpm dev:sim`: as três telas, o seletor, a aba "Deputados" a 320 px, e SP federal
      intacto depois de navegar para o estadual na mesma aba (RF-281, RF-283).
- [ ] G5. `constitution-guard` (§§ 1, 2, 4, 6, 8) → `rf-coverage-checker` → `spec-syncer`.
- [ ] G6. Decisão Fase 1 × Fase 2 com o dono (sex 18h); envio só com aprovação dele.

## Mutações

**Aplique você mesmo e confira que o teste cai** — relatório de agente não conta. Em Python, limpe
`__pycache__` nos dois lados (o `.pyc` mascara mutação de um dígito). Teste de limiar precisa de caso
**no** limiar; mutação que sobrevive quase sempre é fixture que não alcança a linha.

As oito primeiras vêm da § Verificação do plano de 29/09.

| # | Frente | Mutação | Quem tem de matar |
|---|---|---|---|
| M1 | P | `_e_proporcional` volta a ser só `cargo == 6` | P6 — 7 e 8 no ramo proporcional |
| M2 | T | prefixo do Blob sem cargo (o 7 grava em `deputado/uf/`) | T9 — SP federal intocado |
| M3 | T | filtro de UF por cargo removido de **um** construtor (aplicar nos quatro, um de cada vez) | RF-278: 8 só DF, 7 nunca DF, nos quatro |
| M4 | P · U-b | total = Σ `lugares_a_preencher` das casas presentes | payload e capa com 2 casas presentes mantêm "aguardando" |
| M5 | U-a | cache da lista chaveado só por UF | SP federal e depois SP estadual: 2 `fetch` |
| M6 | T · P | `interruptor-projecao-est` ausente ⇒ ligado | falha fechada no ciclo e no render |
| M7 | T | `faixaRps` ignorado (soma todos os `rpsMax`) | pior caso 81 na Fase 2 (daria 86) |
| M8 | P | modo resumo põe `eleitorado` em `comparou` | Conferência em resumo não diz "confere" do eleitorado |
| M9 | T | `ufsDoCargo` com default (`?? TODAS_UFS`) | cargo 8 = `["DF"]`; tabela sem `ufs` não compila |
| M10 | T | `eleicao` do 7 = `"federal"` | URL do 7 sob `21272` |
| M11 | T | rota de escrita grava UF fora do cargo | POST de 7 com DF: DF não gravado, `error` |
| M12 | T | `cargoToken(7)` devolve `"dep"` | ida e volta sem colisão |
| M13 | T | POST do modelo do 7 leva o estado de `-dep` | teste do corpo do POST por cargo |
| M14 | T | `--cargo estadual` grava `interruptor-projecao-dep` | teste do script |
| M15 | T | `/candidatos?cargo=8&uf=SP` lista candidaturas | estado vazio nomeado |
| M16 | T | `CADENCIA_SEGUNDOS[7] = 1800` na Fase 1 | payload e frescor dizem 5 min |
| M17 | P | `UFS_DA_ELEICAO = 27` no cargo 7 | `ufs_calculadas + ufs_aguardando = 26` |
| M18 | P | `conferir_total_de_cadeiras` contra 513 no 7 | soma 1.035 sem alarme; 1.034 com alarme |
| M19 | P | resumo com `-est` ligada calcula projeção | objeto sem `projecao` |
| M20 | P | gate de resumo depois da trava (sai `aguardando/zonas_minimas`) | campo ausente, não `aguardando` |
| M21 | P | `nao_comparou` lista `votos_validos` sem `tf = "s"` | caso resumo com `tf = "n"` |
| M22 | P | alerta do 7 diz "Deputado Federal" | texto pelo rótulo do cargo |
| M23 | P | golden com 513 fixo | golden por casa (1.035 / 24) |
| M24 | U-a | página estadual lê `projection-current-dep-t1` | contagem de leituras por chave |
| M25 | U-a | redirecionamento do DF removido | `/uf/DF/deputado-estadual` → 308 |
| M26 | U-a | rota da lista do 7 aceita DF | 404 |
| M27 | U-a | preposição com default `"de"` | tabela fechada das 26 |
| M28 | U-a | linha de estado da projeção renderiza sem `projecao` | fixture da Fase 1 |
| M29 | U-a | Conferência em resumo escreve "confere" sobre o eleitorado | fixture com `nao_comparou` |
| M30 | U-b | capa lê Blob de UF | 0 chamadas |
| M31 | U-b | capa com total 1.035 quando `dis` falta | total 1.059, DF em "aguardando" |
| M32 | U-b | capa com "atualizado às" único | as duas cadências no texto |
| M33 | U-b | mais votados só de `est` | fixture com candidato do DF no top 10 do país |
| M34 | U-b | soma ignora `dis` | soma inclui as cadeiras do DF |
| M35 | U-b | aba com nome acessível que não começa por "Deputados" | teste de nome acessível |
| M36 | U-b | seletor na UF leva à capa | `href` = mesma UF no outro cargo |
| M37 | U-b | seletor no DF diz "Estadual" | "Distrital" → `/uf/DF/deputado-distrital` |
| M38 | U-b | `CamaraHemiciclo` na capa estadual | ausente |
| M39 | S | simulado emite cargo 7 com DF | validador do gerador |
| M40 | S | simulado com total derivado das casas presentes | validador do gerador |
| M41 | F2 | uma fatia do 7 no mesmo minuto de uma do 6 | teste de expansão de `vercel.ts` |
| M42 | F2 | `CARGOS_FATIAVEIS` sem o 7 | rota da fatia do 7 responde 200 |
| M43 | F2 | trava anti-sobreposição só por fatia | fatia 1 do 7 roda com a fatia 1 do 6 em voo |
| M44 | F2 | `ATUALIZACAO_MIN_DEPUTADO` 30 mantido com cadência 3.600 | payload diz 60 |
| M45 | F2 | cargo 8 fatiado | `/api/ingest/deputado-distrital/1` → 400; alvos do 8 inteiros |
| M46 | F2 | `-dep` liga a projeção do 7 | teste cruzado do RF-287 |

## Ações do dono

1. **Baixar no navegador** os resultados de 2022 do TSE (votação por candidato e por partido, por zona —
   `dadosabertos.tse.jus.br/dataset/resultados-2022`) e deixar em `build/tse-archives/`. É o que permite
   conferir o cálculo das assembleias contra 2022 (RF-290) e ensaiar a projeção (G2). O TSE bloqueia
   robôs.
2. Rodar `pnpm sim:full` quando a frente S pedir.
3. Na **reimportação de candidatos de 02–03/10**: ela passa a trazer os estaduais e distritais (e, se a
   janela comportar, as fotos deles — open question 3 da spec).
4. **Antes do congelamento de 04/10**: se `TSE_CARGOS` existir em produção, incluir 7 e 8 — sem eles os
   crons de 7/8 rodam e não buscam nada, sem erro, e a variável só muda com deploy novo. Vai para o
   roteiro da véspera (`docs/operations/vespera-03-10.md`).
5. **Sexta 02/10, 18h**: decidir Fase 2 ou só Fase 1. Depois do ensaio e do G2, decidir se liga a
   projeção das assembleias (`pnpm dep:projecao --cargo estadual`).
