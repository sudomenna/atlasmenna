---
id: ADR-0021
title: Extrapolação do apurado por zona, não swing vs. 2022
status: accepted
date: 2026-09-05
supersedes: ADR-0015
---

# ADR-0021 — Extrapolação do apurado por zona, não swing vs. 2022

## Status

Aceito.

### Emenda 2026-09-11 — ingestão por par, estimador intocado (ADR-0035 D1/D2)

**Nota 2026-09-11 ([ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) D1/D2).** A partir da
migration 0006, a ingestão TSE passou a ser por **par** (município, zona) — o EA20 de zona é
publicado um arquivo por par. O método deste ADR **não muda**: `api/model/zona_merge.py` soma os
pares de volta em zona, em memória, antes de `fetch_snapshots` alimentar o estimador — a extrapolação
continua operando sobre a zona, com o mesmo `k = te/esi` e o mesmo bootstrap não-paramétrico. O gate
OT-4 foi medido antes e depois da mudança de ingestão e ficou **idêntico ao dígito** (MAE@1h PT
2,3623pp / cobertura 82,5%, contra o fixture commitado `tests/fixtures/replay-2022/snapshots.json`)
— confirmação empírica de que a
unidade de ingestão e a unidade do estimador são, de propósito, desacopladas.

Este ADR **versiona a constituição § 8 para a versão 1.2** (o preâmbulo da constituição, `docs/constitution.md:11`, exige justificativa em ADR + atualização versionada para mudar um princípio).

### Nota 2026-09-29 — método estendido ao cargo 6 (ADR-0063)

**Nota 2026-09-29 ([ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md)).**
O método deste ADR — extrapolação do apurado por zona, `k = te/esi`, razão de somas por chave — passa
a valer também para o cargo 6 (Deputado Federal), com duas diferenças que **não** alteram o método:
a zona conta como apurada com `esi > 0 ∧ vv > 0` (não `vvc`) e a projeção cobre o **estado inteiro**,
com imputação das zonas sem boletim a partir das apuradas do mesmo estrato de tamanho. Nada do que
este ADR decide muda; o ADR-0063 supera o D9 do design da spec 017 ("no cargo 6 não há projeção de
voto"). O texto abaixo segue descrevendo o cargo majoritário.

## Contexto

Hoje candidatos são projetados por **swing vs. 2022** (`swing_c(z) = p_c(z,t) − p_c^2022(z)`, spec 002 RF-011/012/013): 2022 é a âncora de todo o cálculo, via mapeamento de coligação 2026→2022 ("K-1", ADR-0015). Esse mapeamento **nunca ficou operacional** — o K-1 (`swing.resolve_k1_tier`, `party_mapping`, `pre_election_polls`, coluna `model_fallback_tier`) é código morto, não chamado por `api/model/project.py` em produção. Ao mesmo tempo, `historical_results.pct_validos` está `NULL` para todas as linhas gravadas — a tabela tem `votos INT NOT NULL` (`schema.ts:41`) mas nunca populou o percentual que o swing precisaria; esse gap é o bloqueador `fix-pct_validos-null-in-historical_results` no `ship_blocked_on` da spec 002.

O gate OT-4 que supostamente validava o swing é **tautológico**: `scripts/build-replay-fixtures.ts:11` constrói o dataset de replay a partir do próprio resultado de 2022, o que faz `swing ≡ 0` e a projeção colapsar no gabarito — já registrado como risco em `docs/reference/risks.md:27` ("dataset T21 era circular → swing efetivamente zero"). Não há, portanto, evidência empírica de que o método atual funcione fora desse circuito fechado.

Um achado independente da decisão de método, mas que a torna urgente: com o default de produção `TSE_GRANULARIDADE=uf`, **o modelo está quebrado hoje**. `compute_uf_projections` (`api/model/project.py:1010,1046`) e `compute_participacao` (`api/model/project.py:1542`) fazem `eleitorado.get((uf, cod_zona), 0)`; a linha de UF é gravada com `cod_zona = 0` (`lib/tse/targets.ts:410`), e a tabela `eleitorado` não tem linha `(uf, 0)` — o peso cai para zero, a zona é descartada, candidatos caem no caminho de fallback e mostram 2022 ± 10pp como se fosse projeção, e a participação devolve `None`. Ninguém percebeu porque em dev as páginas leem fixture, não Edge Config real. Além disso, o texto do modelo excluía da corrida qualquer candidato sem histórico em 2022 (`if p_2022 is None: continue`, `api/model/project.py:1034`) — o que teria excluído candidatos novos competitivos por construção, não por mérito.

No mesmo ciclo (D5, RF-020.1), abstenção e brancos/nulos **já passaram** a ser projetados por regra de três sem 2022 (`api/model/turnout.py`) — o ADR-0018 já assumia essa direção para participação ("regra de três... sem prior histórico de 2022"). O pedido de 2026-09-05 estende o mesmo princípio a candidatos e a tudo que deles deriva (`p_vitoria`, cenários de 2º turno, "Outros").

## Decisão

A projeção de cada candidato passa a ser **extrapolação do apurado por zona eleitoral**, sem uso de 2022 como insumo. Em cada zona apurada (`esi > 0 ∧ vvc > 0 ∧ w > 0`), calcula-se o fator de escala `k = te/esi` (aptos sobre eleitorado das seções instaladas) e projeta-se o total absoluto da zona multiplicando a contagem observada por `k` — `V_c(z) = vap_c·k` para cada candidato, com o mesmo `V_c` servindo às duas bases (só o denominador muda: votos a votáveis `vvc·k` ou comparecimento `c·k`). Na UF, o percentual projetado é razão de somas sobre as zonas apuradas (`Σvap_c/ΣB`), não média de percentuais zona a zona; `pct_atual` é literal (`Σvap_c/Σvvc` ou `Σvap_c/Σc`, sem `k`).

Zona sem urna aberta (**E3**) herda a proporção observada na UF até a primeira urna; UF inteira sem zona apurada (só cargo Presidente/1) herda a proporção nacional, com o intervalo de confiança inflado via `inflate_ci_zero_apurado` (RF-017) centrado no agregado nacional em vez de em 2022 — hierárquico, sem quebrar a regra de "total nacional completo desde o início". O intervalo de confiança continua vindo de **bootstrap não-paramétrico** (ADR-0006), mas agora com **um único `idx` de reamostragem de zonas por UF**, compartilhado entre todos os candidatos e as duas bases — hoje cada `(uf, candidato)` tem seed própria, o que torna o pareamento apenas nominal; com `idx` compartilhado, `p_vitoria` e os cenários de 2º turno passam a comparar resamples genuinamente pareados. O contrato de `estimates_by_uf[uf][cand]` (share fracionário, `(1000,)`, pareado) é **preservado sem mudança** — tudo a jusante (`compute_national`, `p_vitoria`, `p_passa_2t`, `p_fecha_1t`, `compute_two_round_scenarios`, `compute_outros_estimates`) continua agnóstico ao método de projeção.

2022 sai do caminho da projeção e passa a existir **só como comparação descritiva** na tela (setas/texto "mudou X pontos desde 2022", apurado de agora vs. resultado de 2022, fato observado — não insumo estatístico). O rótulo da base de candidatos é **"votáveis"**, nunca "válidos" — o EA20 e o ADR-0018 já proíbem essa confusão, porque `vvc` (votos a votáveis concorrentes) não é `vv` (válidos): `vvc = vv + van + vansj`. A base de comparecimento declara seu resíduo (anulados/sub judice) explicitamente na legenda, em vez de fingir que candidatos + brancos + nulos fecham 100% exato.

## Alternativas rejeitadas

- **Manter swing vs. 2022** (status quo). Rejeitada: inverificável hoje (K-1 nunca operacional, `pct_validos` nulo, gate OT-4 tautológico) e exclui por construção qualquer candidato sem correspondência clara em 2022 — o problema que o próprio ADR-0015 tentava mitigar com fallback de 3 tiers, sem nunca resolver de fato.
- **Regra de três por UF** (sem granularidade de zona). Rejeitada: não corrige o **viés de composição** — as primeiras urnas apuradas de um estado não são uma amostra representativa do estado inteiro (ex.: capital apura antes do interior), e a extrapolação por UF herdaria esse viés sem chance de correção pela agregação bottom-up que a zona permite.
- **Regra de três por município**. Rejeitada para esta janela: ~11.140 GETs por ciclo (2 cargos) não cabem em `maxDuration=180` sob nenhum rps permitido pelo rate limiter do TSE, e a tabela `snapshots` não tem coluna de granularidade municipal nem `TSE_GRANULARIDADE` a aceita hoje. Fica adiada para depois da eleição — zona (~5.200 GETs/ciclo, ~104s a 50rps) é o recorte mais fino viável antes de 04/10.

## Consequências

**Positivas**:
- Um método só, explicável numa frase: "a partir do que cada zona já apurou, projetamos o total daquela zona e somamos" — coerente entre candidatos e participação (mesmo princípio do `turnout.py`/ADR-0018).
- Independência de histórico: candidato novo entra na corrida por construção, sem depender de mapeamento de coligação 2022→2026.
- `p_vitoria` e os cenários de 2º turno passam a comparar resamples **pareados de verdade** (um `idx` por UF, compartilhado entre candidatos e bases), corrigindo um pareamento hoje apenas nominal.
- O bloqueador `fix-pct_validos-null-in-historical_results` desaparece — 2022 vira comparação descritiva que pode usar `historical_results.votos` diretamente, sem depender do campo nulo.

**Negativas**:
- **O viés de composição em baixa apuração é o risco metodológico central desta mudança, e o bootstrap não o vê** — reamostrar zonas já apuradas não corrige o fato de que as primeiras zonas a apurar podem ter perfil sistematicamente diferente do restante da UF. Mitigação: RF-018 (penalização de CI <5% apurado) e o rótulo obrigatório "projeção a partir do apurado" (RF-062) — não elimina o risco, só o comunica com honestidade.
- O replay de 2022 precisa ser **regenerado do zero** com um envelope EA20 sintético não-tautológico (apuração progressiva intra-zona, ordem de apuração enviesada) — até essa regeneração, **o gate OT-4 fica suspenso**, não validado.
- O MAE esperado no novo replay é **maior** que os 0,998pp reportados pelo gate tautológico anterior — isso é o gate ficando honesto, não uma regressão do modelo.

**Neutras**:
- A coluna `model_fallback_tier` e o campo `EdgePayloadUf.model_fallback_tier?` ficam no schema, marcados `@deprecated`, sem migration de remoção — o K-1 que ela suportava deixa de ser chamado, mas remover a coluna não é urgente.
- `api/model/turnout.py` permanece intocado por esta mudança (o novo estimador vive em módulo irmão, `api/model/extrapolation.py`) até uma fase posterior que unifica a base de brancos/nulos sob o mesmo `idx`.

## Relações com outros ADRs

- **Supersede o ADR-0015** (fallback K-1 em 3 tiers): o problema que aquele ADR resolvia — candidato sem bloco político mapeável em 2022 — deixa de existir, porque a projeção não usa mais 2022 como insumo.
- **Mantém o ADR-0006** (bootstrap não-bayesiano): o bootstrap continua sendo o mecanismo de incerteza; muda apenas a estatística reamostrada (zonas do apurado, não swings vs. 2022) e a unificação do `idx` por UF.
- **Mantém o ADR-0007** (zona como granularidade do modelo): reafirma zona como o recorte correto — o "achado urgente" desta decisão (modo `uf` quebrado em produção) é evidência adicional de que a granularidade de zona não é opcional para este modelo.
- **Mantém e estende o ADR-0018** (seis termômetros do hero 1T): aquele ADR já projetava participação (abstenção, brancos/nulos) "sem prior histórico de 2022"; este ADR estende o mesmo princípio a candidatos, unificando o método em toda a página.
- **Reafirma o ADR-0020** (conformidade Res. 23.751/2026): os denominadores `vvc` (votáveis) e `c` (comparecimento) continuam **não intercambiáveis** — art. 267 §4º veda alterar o conteúdo dos dados do TSE, e confundir bases produziria percentuais que não correspondem ao que o TSE publica.

## Cross-refs

- ADR-0015 (K-1 fallback — superseded por este ADR): [0015-k1-fallback-3-tier.md](0015-k1-fallback-3-tier.md)
- ADR-0006 (bootstrap não-bayesiano): [0006-bootstrap-nao-bayesiano.md](0006-bootstrap-nao-bayesiano.md)
- ADR-0007 (zona vs. município): [0007-zona-vs-municipio.md](0007-zona-vs-municipio.md)
- ADR-0018 (seis termômetros do hero 1T — precedente da extrapolação sem 2022 para participação): [0018-termometros-hero-1t.md](0018-termometros-hero-1t.md)
- ADR-0020 (conformidade Res. 23.751/2026 — denominadores não intercambiáveis, art. 267 §4º): [0020-conformidade-res-23751-2026.md](0020-conformidade-res-23751-2026.md)
- Constituição § 8 (transparência metodológica) — versionada para 1.2 por este ADR: [../../constitution.md](../../constitution.md)
- Spec 002 (modelo estatístico) — RF-011/012/013/017 a reescrever, RF-020.1 já entregue como precedente: `docs/specs/002-modelo-estatistico/spec.md`
- `docs/reference/risks.md:27` — gate OT-4 tautológico, origem empírica desta decisão
- `docs/reference/risks.md` — bloqueador `fix-pct_validos-null-in-historical_results`, resolvido por esta mudança
