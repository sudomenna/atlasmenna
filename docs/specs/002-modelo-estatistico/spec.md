---
id: 002-modelo-estatistico
title: Modelo estatístico (extrapolação do apurado, bootstrap, projeção)
status: implementing
priority: M
personas: []
screens: []
requirements: [RF-011, RF-012, RF-013, RF-014, RF-015, RF-016, RF-017, RF-018, RF-019, RF-020, RF-020.1, RF-020.2, RF-020.3, RF-213]
depends_on: [001-ingestao-tse]
apis: [POST /api/model/project]
components: []
nfr: [RNF-006]
adrs: [0006, 0007, 0012, 0014, 0018, 0020, 0021, 0023, 0035, 0038, 0053]
ship_blocked_on: [simulado-tse-2026, gate-ot4-reprovando]
---

# Spec 002 — Modelo estatístico

## Objetivo

Transformar snapshots de apuração em **projeção do resultado final** com intervalo de confiança e probabilidade de vitória, em <2s por execução, explicável e determinístico.

## Escopo

**In**:
- **Extrapolação do apurado por zona** — fator de escala `k(z) = te(z)/esi(z)` e votos projetados `V_c(z) = vap_c(z)·k(z)` ([ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md)). **Nota**: a partir de [ADR-0035 D2](../../architecture/adrs/0035-par-municipio-zona-unidade-de-ingestao.md), a ingestão TSE recebe dados por **par** (município, zona) via `fetch_snapshots`; o módulo `api/model/zona_merge.py` soma os pares de volta em zona, **em memória**, antes do estimador (operação determinística, mantém o contrato zona-a-zona intacto — o gate OT-4 medido **idêntico** antes/depois). O método do estimador não muda.
- Agregação por **razão de somas** — zona → UF → nacional, nas duas bases (`votáveis` e `comparecimento`).
- Bootstrap não-paramétrico (1000 resamples) para CI95, com **um único sorteio de zonas por UF** compartilhado entre todos os candidatos e as duas bases.
- Probabilidade de vitória P(>50%).
- Tratamento de casos de borda (zona sem urna aberta, UF sem nenhuma zona apurada, UF com <5% apurado).
- `votos_projetados` absolutos por candidato, somados UF → Brasil e persistidos em `projections`.
- Persistência de cada execução em `projections`.
- Projeção de **participação** — abstenção e brancos/nulos — por extrapolação do apurado (RF-020.1).
- Agregado **"Outros"** (candidatos de rank ≥ 4) com IC próprio, derivado dos resamples do bootstrap (RF-020.1).

**Out**:
- Visualização (specs 003+).
- Ingestão do TSE (spec 001).
- **Persistência da participação em `projections`** — deferida por incompatibilidade de schema (`projections.candidato_id NOT NULL` não comporta linhas de participação). O bloco `participacao` viaja **apenas** no payload do Edge Config. Ver RF-020.1.
- **Qualquer uso de 2022 como insumo do cálculo** — decisões D5 e E1 (2026-09-05), [ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md). Não há prior histórico de comparecimento/abstenção, não há swing vs. 2022, não há mapeamento de coligação 2026→2022 (o K-1 do ADR-0015 foi superseded). O resultado de 2022 sobrevive **apenas** como comparação descritiva exibida ao leitor (`swing_vs_2022` no payload de UF), computada fora do caminho da projeção.
- Mapeamento K-1 e fallback por vizinhança/pesquisa ([ADR-0015](../../architecture/adrs/0015-k1-fallback-3-tier.md), superseded).

## Personas e jornadas

Back-end. Atende todas as personas indiretamente. A explicabilidade do modelo serve **P2/P3** via página `/sobre-o-modelo` ([spec 011](../011-sobre-o-modelo/spec.md)).

## Notação

- `Z` = conjunto de zonas eleitorais (~3.000)
- `Z_t ⊂ Z` = zonas apuradas em t
- `c` = candidato (índice)
- `te(z)` = eleitores aptos da zona z (`e.te` do EA20)
- `k(z) = te(z)/esi(z)` = fator de escala da zona (regra de três)
- `vap_c(z)` = votos absolutos do candidato c na zona z (`cand[].vap`)
- `V_c(z) = vap_c(z)·k(z)` = votos projetados de c na zona z
- `A(U)` = zonas **apuradas** da UF U (`esi > 0 ∧ vvc > 0 ∧ w > 0`)
- `w(z)` = eleitores aptos 2026 de z segundo a tabela `eleitorado` (peso de agregação de RF-011..RF-018 e de RF-020.1)
- `esi(z)` = eleitorado das seções instaladas em z (campo `e.esi` do EA20)
- `c(z)` = comparecimento em z (`e.c`)
- `a(z)` = abstenção em z (`e.a`)
- `bn(z)` = brancos(z) + nulos(z)
- `vvc(z)` = votos a votáveis concorrentes em z (`v.vvc` — mesmo denominador do campo oficial `pvap`)

## Requisitos Funcionais (EARS)

### Extrapolação do apurado (regra de três por zona)

**RF-011 — Fator de escala da zona e votos projetados**

WHEN um snapshot é processado para a zona z e a zona está apurada (`esi(z) > 0` ∧ `vvc(z) > 0` ∧ `w(z) > 0`), the system SHALL calcular o fator de escala `k(z) = te(z)/esi(z)` e projetar, para cada candidato c, `V_c(z) = vap_c(z)·k(z)`, além das bases `B_v(z) = vvc(z)·k(z)` (votáveis) e `B_c(z) = c(z)·k(z)` (comparecimento).

IF a zona não satisfaz `esi(z) > 0 ∧ vvc(z) > 0 ∧ w(z) > 0`, the system SHALL classificá-la como **não apurada** e tratá-la por RF-013 — nunca descartá-la silenciosamente do total da UF.

WHERE o valor `V_c(z)` é usado, the system SHALL usar **o mesmo** numerador nas duas bases; apenas o denominador muda ([ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md)).

**Aceitação**:
- Given uma zona com `te = 100.000`, `esi = 50.000` e `vap_c = 12.000`, when a projeção da zona é calculada, then `k = 2,0` e `V_c = 24.000`.
- Given a mesma zona com `esi = te` (todas as seções instaladas), when a projeção é calculada, then `k = 1,0` e `V_c = vap_c` (a extrapolação vira identidade).
- Given `historical_results` vazio e `historical_results` completo, when a projeção roda com o mesmo snapshot e o mesmo seed, then o resultado é **idêntico** — 2022 não é insumo (`test_orchestrator.py::test_do_project_e_invariante_a_historical`).

**RF-012 — Agregação para a UF por razão de somas, nas duas bases**

WHEN as zonas apuradas `A(U)` da UF U estão disponíveis, the system SHALL calcular o share projetado de cada candidato como **razão de somas** — `s_v_c(U) = Σ(z ∈ A) V_c(z) / Σ(z ∈ A) B_v(z)` na base votáveis e `s_c_c(U) = Σ(z ∈ A) V_c(z) / Σ(z ∈ A) B_c(z)` na base comparecimento — e **não** como média dos percentuais por zona.

WHEN o percentual apurado literal é exibido, the system SHALL calculá-lo **sem** o fator de escala: `pct_atual_v(U) = Σ vap_c(z) / Σ vvc(z)` e `pct_atual_c(U) = Σ vap_c(z) / Σ c(z)`.

WHERE a base votáveis é rotulada na UI ou no payload, the system SHALL usar o termo **"votáveis"** e nunca "válidos" — `vvc ≠ vv` no EA20 ([ADR-0018](../../architecture/adrs/0018-termometros-hero-1t.md), [ADR-0020](../../architecture/adrs/0020-conformidade-res-23751-2026.md), art. 267 §4º da Res. TSE 23.751/2026).

**Aceitação**:
- Given duas zonas apuradas, uma com 100.000 votos projetados e 60% para c e outra com 1.000 votos projetados e 20% para c, when a UF é agregada, then `s_v_c` ≈ 59,6% (razão de somas — a zona grande domina) e **não** 40% (média simples dos percentuais).
- Given uma UF com zonas apuradas, when o payload é emitido, then `pct_atual` e `pct_projetado` diferem sempre que existir zona não apurada ou `esi < te` em alguma zona.

### Projeção

**RF-013 — Zona não apurada: imputação pela proporção da própria UF**

WHILE existirem zonas não apuradas na UF U (decisão E3, 2026-09-05), the system SHALL imputá-las a partir das zonas apuradas da **própria UF**: `r_v(U) = Σ(z ∈ A) B_v(z) / Σ(z ∈ A) te(z)`, `B_v(z) = te(z)·r_v(U)` e `V_c(z) = s_v_c(U)·B_v(z)` — de modo que o **total absoluto** da UF fique completo desde o primeiro ciclo, enquanto o **share** da UF permanece algebricamente inalterado pela imputação.

WHEN a UF é agregada, the system SHALL reportar `n_zonas` (apuradas) e `n_zonas_imputadas` no bloco `metodo` do payload, para que a UI possa dizer ao leitor de onde veio o número (constituição § 8).

**Aceitação**:
- Given uma UF com 2 zonas apuradas e 1 zona sem urna aberta, when a projeção roda, then `s_v_c` é **idêntico** ao caso sem a terceira zona, `base_votaveis_projetada` cresce por `Σte(todas)/Σte(A)` e `n_zonas_imputadas == 1`.
- Given uma UF em que toda zona está apurada, when a projeção roda, then `n_zonas_imputadas == 0` e o fator de escala da imputação é 1,0.

**RF-014 — Projeção nacional**

WHEN as projeções por UF estão disponíveis, the system SHALL calcular `votos_c^{proj}(BR) = Σ(U) votos_c^{proj}(U)` e `pct_c^{proj}(BR) = votos_c^{proj}(BR) / Σ(c') votos_{c'}^{proj}(BR)`.

### Incerteza

**RF-015 — Intervalo de confiança via bootstrap (1000 resamples)**

WHEN a projeção da UF é calculada, the system SHALL calcular CI95 via bootstrap não-paramétrico com 1000 resamples das zonas **apuradas** (as zonas imputadas por RF-013 são constantes e SHALL ficar fora do sorteio, sob pena de encolher o intervalo artificialmente).

WHERE uma UF é reamostrada, the system SHALL usar **um único sorteio de índices por UF**, compartilhado entre todos os candidatos e as duas bases — de modo que os arrays de resample sejam pareados de fato, e não apenas nominalmente ([ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md)).

WHERE o ponto projetado é reportado, the system SHALL usá-lo da **fórmula fechada** de RF-012, nunca da média do bootstrap — o bootstrap serve só ao intervalo.

**Aceitação**:
- Given 100 zonas apuradas em SP, when bootstrap roda, then retorna `{point, ci_lower, ci_upper}` com `ci_lower < point < ci_upper`.
- Given seed fixo, when bootstrap roda 2 vezes, then resultados são idênticos (reprodutibilidade bit a bit — `np.random.default_rng`, nunca `np.random.seed()` global).
- Given uma UF com exatamente 2 candidatos e sem sobra de votos, when os resamples são somados, then `estimates_A + estimates_B == 1` elemento a elemento — prova do sorteio compartilhado.

**RF-016 — Probabilidade de vitória P(>50%)**

WHEN as estimativas bootstrap dos candidatos A e B estão disponíveis, the system SHALL calcular `p_vitoria = mean(estimates_A > estimates_B)`.

### Casos de borda

**RF-017 — UF sem nenhuma zona apurada: imputação nacional**

IF uma UF não tem **nenhuma** zona apurada e a corrida tem âncora nacional (cargo Presidente), the system SHALL projetar essa UF com a **proporção observada no agregado nacional** até o momento, com o CI inflado para ±10pp em torno desse ponto, e SHALL marcar `metodo.tipo = "imputado_nacional"`.

IF uma UF não tem nenhuma zona apurada e a corrida **não** tem âncora nacional (cargo Governador — cada UF é uma corrida própria), the system SHALL **omitir** a UF da projeção, e a UI SHALL exibir "aguardando projeção" (ADR-0017 — a camada nunca sai do DOM).

WHERE a UF é imputada do nacional, the system SHALL reusar o **array nacional pareado** de resamples como `estimates` da UF, preservando a correlação com o restante do país em vez de emitir um array constante.

**Aceitação**:
- Given uma UF de presidente sem nenhuma zona apurada e um nacional com c em 40%, when a projeção roda, then `pct_projetado(c, UF) = 40%`, `lower/upper` = 40 ± 10pp (clipados em [0, 100]) e `metodo.tipo == "imputado_nacional"`.
- Given uma UF de governador sem nenhuma zona apurada, when a projeção roda, then a UF não aparece nas `rows` de projeção — e em nenhum ponto o resultado de 2022 é usado como centro do intervalo.

**RF-018 — UF com <5% apurado (Should)**

IF uma UF tem menos de 5% apurado, the system SHOULD inflar o CI em 50% adicional.

### Operação

**RF-019 — Recálculo a cada snapshot**

WHEN um novo snapshot é ingerido, the system SHALL acionar `/api/model/project` para recalcular a projeção.

**RF-020 — Persistência de cada cálculo**

WHEN uma projeção é calculada, the system SHALL inserir um novo registro em `projections` com timestamp.

### Participação e agregados (S07 — hero de seis termômetros)

**RF-020.1 — Projeção de participação e do agregado "Outros"**

WHEN uma projeção é calculada para um cargo/turno, the system SHALL emitir, no payload do Edge Config, um bloco `participacao` com três métricas independentes — cada uma com `pct_atual`, `pct_projetado`, `lower`, `upper` (todos em **percentual 0–100**) e o rótulo explícito da sua base de cálculo:

- **(a) `abstencao`** — `base: "eleitores_instalados"`. Projetada por **extrapolação do apurado** (regra de três): a taxa `a(z) / esi(z)` observada nas zonas já apuradas, **ponderada por `w(z)`** (eleitores aptos 2026), extrapolada para o total da UF; agregação nacional ponderada pelo eleitorado total de cada UF.
- **(b) `brancos_nulos`** — `base: "comparecimento"`. Mesmo estimador de (a), com métrica `bn(z) / c(z)`.
- **(c) `outros`** — `base: "votaveis"`, mais `n_candidatos`. Agregado dos candidatos de rank ≥ 4, cujo IC95 é a **soma pareada por resample** dos arrays de bootstrap desses candidatos (RF-015) — nunca `100 − Σtop3`.

WHERE a projeção usa a extrapolação do apurado, the system SHALL derivar o IC95 de (a) e (b) por **bootstrap de zonas apuradas** no mesmo estilo de RF-015 e SHALL aplicar RF-017/RF-018 (inflação de CI em baixa apuração) sem reimplementá-los.

IF nenhuma zona da UF for utilizável para uma métrica (denominador da métrica ≤ 0 **ou** `w(z) ≤ 0` em todas as zonas), the system SHALL **omitir** a chave dessa métrica do payload — nunca emitir `0.0` como se fosse dado apurado. A UI renderiza o termômetro em estado "aguardando projeção" (ADR-0017: a camada nunca sai do DOM).

WHILE o bloco `participacao` é emitido, the system SHALL incluir `metodo: {tipo, n_zonas, pct_apurado}` com `tipo = "extrapolacao_apurado"`, de modo que a UI possa rotular a origem do número (constituição § 8 — transparência metodológica).

**Sem prior histórico** (decisão D5, 2026-09-05): a projeção de participação **não** usa nenhum dado de 2022. Não há tabela de prior, não se importa `detalhe_votacao_munzona`, e o rótulo exibido é "projeção a partir do apurado" — nunca "baseado em 2022". Consequência assumida e documentada em [ADR-0018](../../architecture/adrs/0018-termometros-hero-1t.md): a estimativa é volátil em apuração muito baixa e sujeita a viés de composição das zonas que apuram cedo.

**Denominadores não são intercambiáveis.** As três bases (`v.vvc`, `e.c`, `e.esi`) vêm decompostas no próprio EA20 e não podem ser normalizadas num denominador único: isso produziria percentuais de candidato divergentes dos publicados pelo TSE e alteraria o conteúdo dos dados distribuídos, vedado pelo art. 267 §4º da Res. TSE 23.751/2026 ([ADR-0020](../../architecture/adrs/0020-conformidade-res-23751-2026.md)).

**Persistência deferida — intencional.** O bloco `participacao` **não** é gravado em `projections`: a tabela é modelada por candidato (`candidato_id NOT NULL`) e não comporta linhas de participação. Portanto RF-020 **não** se aplica a RF-020.1, e a participação vive exclusivamente no payload do Edge Config, recalculada a cada ciclo. Isso é uma decisão de escopo (S07/Fase 1a), não uma pendência esquecida; qualquer persistência futura exige migration e ADR próprios.

**Aceitação**:
- Given uma UF com ao menos uma zona cujo denominador da métrica é > 0 e `w(z) > 0`, when a participação é estimada, then `pct_atual = Σ num / Σ den` (razão literal das zonas apuradas) e `pct_projetado` = média de `metric_value(z)` ponderada por `w(z)`, ambos em 0–100.
- Given a mesma entrada e o mesmo seed derivado de `(uf, métrica)`, when o cálculo roda duas vezes, then `pct_projetado`, `lower` e `upper` são **idênticos bit-a-bit** (constituição § 6 — determinismo; seed via `np.random.default_rng`, nunca `np.random.seed()` global).
- Given seeds diferentes para a mesma entrada, when o cálculo roda, then os CIs diferem — comprovando que o bootstrap é de fato semeado e não constante.
- Given uma UF com `pct_apurado < 5`, when o CI é calculado, then ele é inflado 1,5× ao redor do ponto por `inflate_ci_low_apurado` (RF-018), e o resultado é clipado em [0, 100].
- Given uma UF sem nenhuma zona utilizável, when o cálculo roda, then a métrica é omitida do payload e nenhuma chave com valor `0.0` é emitida.
- Given uma corrida com 5 candidatos, when `outros` é calculado, then ele soma os resamples dos ranks 4 e 5 e reporta `n_candidatos = 2`.
- Given uma corrida com 3 candidatos ou menos, when `outros` é calculado, then `n_candidatos = 0` e a chave `outros` é omitida (a UI cai no fallback `100 − Σtop3` **sem faixa**, rotulado "IC indisponível").
- Given um payload emitido pelo orchestrator com envelope EA20 real, when ele é validado, then `national.participacao` e `payloads_uf.<UF>.participacao` trazem `base ∈ {"eleitores_instalados", "comparecimento", "votaveis"}` e `metodo.tipo == "extrapolacao_apurado"`.
- Given qualquer execução, when os registros de `projections` são inspecionados, then **nenhuma** linha de participação foi inserida (persistência deferida).

**RF-020.2 — Duas bases de percentual por candidato, com resíduo declarado**

WHEN uma projeção de candidato é emitida, the system SHALL emitir os percentuais em **duas bases** — `votaveis` (denominador `vvc·k`, default da tela) e `comparecimento` (denominador `c·k`) — a partir do **mesmo** numerador `V_c`, cada uma com `pct_atual`, `pct_projetado`, `lower` e `upper` em 0–100.

WHERE a base `comparecimento` é exibida, the system SHALL declarar explicitamente o resíduo: candidatos + "Outros" + brancos + nulos somam 100% de quem compareceu **menos** os votos anulados e sub judice (identidade EA20: `Σvap + vb + tvn + van + vansj + vscv = c`). Nunca afirmar soma exata de 100%.

IF a chave `comparecimento` estiver ausente do payload para um candidato, the system SHALL renderizar "aguardando projeção" e SHALL **nunca** exibir o valor de `votaveis` sob o rótulo de comparecimento — seria publicar um número sob o denominador errado, o que o art. 267 §4º da Res. TSE 23.751/2026 veda ([ADR-0020](../../architecture/adrs/0020-conformidade-res-23751-2026.md)).

WHERE os denominadores são nomeados, the system SHALL manter `vvc` como **"votáveis"** (nunca "válidos"): `vvc = vv + van + vansj`.

**Aceitação**:
- Given uma UF com zonas apuradas, when o payload é emitido, then cada `EdgeCandidate`/`EdgeUfCandidate` traz `comparecimento: {pct_atual, pct_projetado, lower, upper}` e o share em `comparecimento` é **≤** o share em `votaveis` para o mesmo candidato (o denominador é maior).
- Given um fixture antigo sem a chave `comparecimento`, when a UI renderiza na segunda base, then o termômetro fica em "aguardando projeção" e nenhum número de `votaveis` é reexibido.

**RF-020.3 — Votos absolutos projetados, somados zona → UF → Brasil e persistidos**

WHEN a projeção de uma UF é calculada, the system SHALL derivar `votos_projetados(c, U) = s_v_c(U) · B_v(U)`, onde `B_v(U)` é a base votável projetada da UF (zonas apuradas mais as imputadas de RF-013).

WHEN as projeções por UF estão disponíveis, the system SHALL calcular `votos_projetados(c, BR) = Σ(U) votos_projetados(c, U)` — soma aritmética das UFs, sem novo sorteio aleatório (constituição § 6 — determinismo).

WHEN a projeção é persistida, the system SHALL gravar `votos_projetados` (inteiro) na coluna homônima de `projections`, junto de `pct_projetado` (RF-020).

**Aceitação**:
- Given um ciclo com pelo menos uma UF apurada, when o payload nacional é emitido, then `Σ_UF votos_projetados(c, U) == votos_projetados(c, BR)` e o total nacional é `> 0` desde o primeiro ciclo.
- Given uma execução completa, when `projections` é inspecionada, then nenhuma linha tem `votos_projetados` nulo para candidato com projeção.

### Destino do voto (`dvt`) nas decisões de corrida (2026-09-27, decisão do dono)

**RF-213 — Candidatura anulada sai da disputa; sub judice segue contando como o TSE conta**

WHEN a projeção classifica candidaturas para decisões de corrida — `lider`, `cand_a`/`cand_b`, `p_vitoria`, `p_fecha_1t`, `p_segundo_turno_overall`, `cenarios_2t`, `chamada`, `vai_a_2t` e, no Senado, `p_eleito` (RF-103) — the system SHALL excluir do universo considerado toda candidatura cujo `cand[].dvt` mapeie para `"anulado"` (`destino_do_dvt`, `api/model/project.py:3912`, spec 022 RF-209), e SHALL recalcular a base da regra de maioria absoluta do 1º turno como `vvc − van` (válidos + sub judice), nunca `vvc` inteiro.

WHERE `cand[].dvt` mapeia para `"sub_judice"`, the system SHALL manter a candidatura no universo de decisão exatamente como antes desta regra — elegível a liderar, a compor o par de 2º turno e a contar na base de maioria absoluta —, refletindo que o TSE a mantém formalmente em disputa. **Ponto aberto** ([ADR-0053](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md)): pendente confirmação jurídica se sub judice deve mesmo contar no denominador da maioria absoluta.

IF `cand[].dvt` está ausente para toda a corrida (nenhuma candidatura publicou destino — estado normal antes da 1ª totalização parcial do TSE) OU IF candidaturas do mesmo `id` reportam `dvt` divergente entre arquivos do mesmo ciclo, the system SHALL manter o comportamento vigente antes deste RF (nenhuma exclusão, base = `vvc` inteiro) e SHALL emitir aviso no log — nunca tratar ausência ou divergência como exclusão silenciosa.

IF `cand[].dvt` traz valor fora do dicionário conhecido (`_DESTINO_POR_DVT`), the system SHALL tratá-lo como ausente para efeito desta regra — nunca como `"anulado"` nem como `"válido"`.

WHERE a exibição de percentuais por candidato ocorre (listas, termômetros, mapas), the system SHALL continuar usando `vvc` inteiro como denominador ([ADR-0018](../../architecture/adrs/0018-termometros-hero-1t.md)) — esta regra afeta apenas as decisões de corrida, nunca o número exibido. Uma candidatura anulada pode aparecer na lista com seu percentual de `vvc` mesmo excluída do ranking de decisão; a UI/metodologia (spec 011) SHALL declarar essa divergência explicitamente.

WHERE a exclusão é aplicada, the system SHALL implementá-la na **fronteira das decisões** (fora de `_extract_zone_candidatos`) — por reamostra dos resultados já extraídos, retirando as candidaturas anuladas e renormalizando as frações remanescentes por `f_i / (1 − Σ f_anulados)` DEPOIS de `estimate_uf_candidatos` (intocado: ele produz os percentuais publicados sobre `vvc`) e antes de alimentar `compute_national`, `compute_p_fecha_1t`, `compute_two_round_scenarios`, `p_vitoria`, `p_eleito` e o bloco por UF (`lider`, `margem`, `chamada`, `vai_a_2t`).

**Aceitação**:
- Given a captura real do simulado do TSE (`vvc` 120.704.576, `van` 9.218.887, `vansj` 10.503.573) com um líder hipotético em 46% de `vvc` cujo `dvt = "Anulado"`, when a projeção classifica a corrida, then esse candidato sai de `lider`, `cand_a`/`cand_b`, `p_vitoria`, do par de `cenarios_2t` e de `chamada`/`vai_a_2t`, e `p_fecha_1t` é recalculado sobre `vvc − van` sem ele.
- Given o mesmo cenário sem a candidatura anulada, when a base é recalculada, then um segundo colocado com 41,83%–50% de `vvc` pode passar a ter >50% da nova base (`vvc − van`) e é reclassificado como líder, com `p_fecha_1t` correspondente.
- Given uma candidatura com `dvt = "Anulado sub judice"`, when a projeção roda, then ela permanece elegível a `lider`, ao par de `cenarios_2t` e, no Senado, ao top-2 de `p_eleito` — sem mudança de comportamento em relação ao estado anterior a este RF.
- Given um ciclo sem nenhum `dvt` publicado (antes da 1ª totalização parcial), when a projeção roda, then nenhuma candidatura é excluída, a base é `vvc` inteiro e o log registra que a regra está inativa nesta corrida.
- Given dois arquivos do mesmo ciclo com `dvt` divergente para o mesmo `id`, when a projeção roda, then a candidatura NÃO é excluída e o log registra a divergência.
- Given uma candidatura excluída da decisão, when a lista de resultados é exibida, then seu percentual sobre `vvc` continua visível, com nota metodológica de que ela não compete pelas vagas.
- Given o replay 2022 (fixture sem `dvt`, `vvc == vv`), when a projeção roda, then o resultado é bit-a-bit idêntico ao anterior a este RF (gate OT-4 preservado).

## Escala de percentuais (fronteira de conversão)

O modelo trabalha internamente em **fração [0, 1]** — é o espaço do bootstrap (RF-015), de RF-017/RF-018 e de `p_vitoria` (RF-016). A **fronteira única de conversão** são `compute_uf_projections` e `compute_national`: ambas convertem para **percentual 0–100** antes de devolver `rows`, via `_frac_to_pct` (arredondamento em 5 casas, a precisão de `projections.pct_projetado NUMERIC(8,5)`).

O que **não** cruza a fronteira: `estimates_by_uf` e `national_estimates` — os arrays de resample — permanecem em fração, porque são o insumo de `aggregate_national_estimates`, `p_vitoria`, `compute_p_passa_2t`, `compute_p_fecha_1t`, `compute_two_round_scenarios` e do agregado "Outros" de RF-020.1. Comparações e somas entre candidatos acontecem **sempre** nesse espaço.

Consequências diretas: `insert_projections` grava 0–100; os consumidores downstream que já assumiam 0–100 (`build_edge_payload`, `build_uf_payloads`, os limiares `top_pct < 50.0` e `margem > 10.0`) passam a receber o valor correto; e `replay_batch.py` converte de volta para fração ao serializar, preservando o gate OT-4 (`MAE@1h < 0.02`). `turnout.py` segue a mesma convenção: `pct_*` em 0–100, `estimates` em fração.

Fonte canônica da convenção: [`data-model.md` § "Escala de percentuais"](../../architecture/data-model.md#escala-de-percentuais).

## Estado dos bloqueadores de ship

`ship_blocked_on:` é mantido — a spec segue em `implementing`. Estado auditado em 2026-09-11:

| Bloqueador | Estado | Evidência |
|---|---|---|
| `simulado-tse-2026` | **Aberto** | Simulados oficiais em 15–17/09 e 22–24/09/2026; nenhum ciclo executado contra o TSE real até aqui. O fixture de replay **já foi regerado** (Fase 5 da S07, 06–07/09): deixou de ser tautológico e o MAE subiu de 0,998pp para ~2,36pp, como se esperava. O que falta é dado real. |
| `gate-ot4-reprovando` | **Aberto** | No ponto oficial (atraso regional de 3 timesteps): MAE@1h PT **2,3623pp** contra teto de 2, cobertura IC95 **82,5%** contra piso de 90%. A faixa medida passa em 0 e 1 timestep e reprova em 2 e 3 — ver `design.md` § Gate e [`docs/testing/replay-sensitivity.md`](../../testing/replay-sensitivity.md). **Calibrar com dado de 2022 não é caminho**: os timestamps zona a zona não existem em fonte pública (verificado 08/09), e o [ADR-0033](../../architecture/adrs/0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md) D3 substituiu a calibração pelo reporte da faixa. O que pode estreitá-la é medir o atraso regional real de 2026 no simulado. |
| `fix-p_vitoria-a-by-pct` | **Resolvido em S05, não removido aqui** | "A" passou a ser o líder por `pct_projetado`, não o menor `candidato_id`. Falta apenas a confirmação formal do gate para retirar o item — decisão do orquestrador, não desta passagem de docs. |
| `fix-pct_validos-null-in-historical_results` | **Dissolvido pelo ADR-0021** | A projeção não consulta mais 2022, e a comparação descritiva pode usar `historical_results.votos` (`INT NOT NULL`) diretamente. O campo nulo deixou de bloquear qualquer caminho de cálculo. |
| `sobre-o-modelo-page` | **Resolvido em S04, não removido aqui** | [Spec 011](../011-sobre-o-modelo/spec.md) está `shipped`. |
| `botid-adr` | **Resolvido, não removido aqui** | [ADR-0009](../../architecture/adrs/0009-botid-vercel.md) está `accepted`. |

Nenhum item foi removido do frontmatter nesta passagem: retirar bloqueador é ato de gate, e os gates (`rf-coverage-checker`, `constitution-guard`, `model-validator`) ainda não rodaram sobre a S07.

## Requisitos Não-Funcionais aplicáveis

- **Defasagem TSE → tela do usuário <90s** — [RNF-006](../../nfr/performance.md) (linha 17).
  Verificável em tempo real pelo `dado_ts` do payload
  ([ADR-0038 D1](../../architecture/adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md)).
  O componente deste requisito que cabe ao modelo é o tempo de cálculo de
  `api/model/project.py`, cujo teto **duro** é o `maxDuration: 60` declarado em
  [`vercel.ts:256-262`](../../../vercel.ts) — mesmo budget do ciclo de ingestão.
  Referência medida ali: bootstrap n=1000 × ~150 zonas em <5s.

> ⚠️ **Correção de 2026-09-21.** Até esta data esta seção dizia *"Defasagem
> total <30s — RNF-006. Componente: `model.compute_duration_ms` p95 <2000ms"*.
> **Os dois números eram inventados**: o RNF-006 real é 90s, não 30s
> (`docs/nfr/performance.md:17`), e `grep -rn "2000" docs/nfr/*.md` não
> devolve nada — nunca existiu requisito de 2000ms em lugar nenhum do
> repositório. A suspeita já estava registrada em
> [`docs/sprints/2026-S07-f6-simulado-hero-1t.md:985-990`](../../sprints/2026-S07-f6-simulado-hero-1t.md)
> ("nenhum dos dois limiares tem requisito por trás") e foi confirmada em
> auditoria de 2026-09-21. Uma sessão que fosse otimizar desempenho contra
> "2000ms" estaria mirando num alvo que ninguém escreveu.

## Open questions

- **Resolvida pelo [ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md)**: "como tratar candidato 2026 sem bloco político mapeável em 2022". A pergunta deixou de existir — a projeção não usa 2022, e o conjunto de candidatos é a união dos vistos nas zonas apuradas. Não existe caminho de "modelo desabilitado" no código.
- Bootstrap usa resample uniforme das zonas apuradas — a ponderação por volume já emerge da razão de somas (RF-012), mas resta avaliar se vale reamostrar proporcionalmente a `te(z)` (probabilidade proporcional ao tamanho). Só com dado de simulado.
- **Viés de composição** (consequência negativa central do ADR-0021): reamostrar zonas apuradas não mede o quanto elas diferem das que faltam. Mitigação atual é RF-018 + rótulo RF-062. Qualquer inflação adicional de IC exige ADR próprio — não improvisar.

## Cross-refs

- Design técnico: [./design.md](./design.md)
- Spec ingestão: [../001-ingestao-tse/](../001-ingestao-tse/)
- Página sobre o modelo: [../011-sobre-o-modelo/](../011-sobre-o-modelo/)
- Validação por replay: [../../testing/replay.md](../../testing/replay.md)
- ADR-0006 Bootstrap vs Bayesiano: [../../architecture/adrs/0006-bootstrap-nao-bayesiano.md](../../architecture/adrs/0006-bootstrap-nao-bayesiano.md)
- ADR-0007 Granularidade zona vs município: [../../architecture/adrs/0007-zona-vs-municipio.md](../../architecture/adrs/0007-zona-vs-municipio.md)
- ADR-0021 Extrapolação do apurado por zona, sem 2022 (supersede ADR-0015 — origem de RF-011/012/013/017/020.2/020.3): [../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md)
- ADR-0018 Seis termômetros no hero do 1T (origem de RF-020.1 — denominador misto, "Outros" com IC real, participação por regra de três): [../../architecture/adrs/0018-termometros-hero-1t.md](../../architecture/adrs/0018-termometros-hero-1t.md)
- Consumo de RF-020.1 na UI: [spec 003](../003-home-nacional/spec.md) (RF-062)
- ADR-0053 Anulado sai da disputa, sub judice segue o TSE (origem de RF-213): [../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md)
- Consumo de RF-213 nas decisões por UF: [spec 006](../006-grid-governadores/spec.md) (RF-006.8), [spec 016](../016-senador/spec.md) (RF-102/103/104)
- Escala de percentuais: [../../architecture/data-model.md](../../architecture/data-model.md)
