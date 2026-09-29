---
id: ADR-0023
title: Pós-estratificação por porte de zona no bootstrap de candidatos, não amostragem simples das zonas apuradas
status: accepted
date: 2026-09-07
---

# ADR-0023 — Pós-estratificação por porte de zona no bootstrap de candidatos, não amostragem simples das zonas apuradas

## Status

Aceito.

### Emenda 2026-09-11 — ingestão por par, estratos intocados (ADR-0035 D1/D2)

**Nota 2026-09-11 ([ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) D1/D2).** Mesma nota
aplicada ao ADR-0021: a ingestão passou a ser por par (município, zona), somada de volta à zona por
`api/model/zona_merge.py` antes do estimador. Os estratos por porte de zona (tercis de `te` sobre
`eleitorado`, agregada por `(uf, cod_zona)`) não mudam — `eleitorado` também passou a ser chaveada
por par, mas `fetch_eleitorado` (`api/model/project.py:319`) soma por zona na leitura, preservando o
peso a priori de cada estrato exatamente como este ADR definiu.

Este ADR **não supersede o ADR-0021** — é continuação direta dele. O método permanece "extrapolação do apurado por zona, sem 2022"; o que muda é *como as zonas apuradas são agregadas dentro do bootstrap de uma UF*, em resposta ao risco que o próprio ADR-0021 já havia nomeado como central e deixado, deliberadamente, sem solução: "o bootstrap não vê" o viés de composição.

### Nota 2026-09-29 — estratos estendidos ao cargo 6 (ADR-0063)

**Nota 2026-09-29 ([ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md)).**
Os estratos por porte de zona (tercis de `te`, UF com ≥ 12 zonas, mesma hierarquia de fallback)
passam a servir também à projeção de Deputado Federal — lá, além de ponderar o ponto, definem de
quais zonas apuradas cada zona **sem boletim** herda a intensidade de voto na imputação do estado
inteiro. Nada do que este ADR decide muda. A ressalva epistêmica abaixo (ordem de chegada sintética;
resíduo *dentro* dos estratos) vale integralmente para o cargo 6 e é o núcleo do risco de "voto de
reduto" registrado no ADR-0063.

## Contexto

O ADR-0021 estabeleceu a extrapolação por regra de três por zona (`k = te/esi`) como método de projeção de candidatos, com incerteza vinda de bootstrap não-paramétrico sobre as zonas já apuradas de cada UF. Naquele ADR, a seção de Consequências já registrava, como negativa central e não mitigada: *"o viés de composição em baixa apuração é o risco metodológico central desta mudança, e o bootstrap não o vê — reamostrar zonas já apuradas não corrige o fato de que as primeiras zonas a apurar podem ter perfil sistematicamente diferente do restante da UF"*. A mitigação prevista ali era só RF-018 (inflação de CI abaixo de 5% apurado) e o rótulo obrigatório de transparência — nenhuma correção estrutural do próprio estimador.

Em 06/09, o replay 2022 regenerado (dataset não-tautológico do ADR-0021, com apuração progressiva intra-zona e ordem de apuração sintética enviesada por porte + atraso regional) mediu esse viés: MAE@1h de 3,225pp (Lula) e 2,609pp (Bolsonaro) — acima do teto de 2pp do gate OT-4 — concentrado, segundo o `model-validator`, em UFs cuja composição de zonas apuradas em 1h não representa a UF inteira (zonas grandes chegam primeiro; o bootstrap, ao reamostrar só entre as zonas que já reportaram, trata essa amostra desbalanceada como se fosse representativa).

`docs/_meta/plano-modelo-regra-de-tres-2026-09-05.md`, na seção "Riscos e o que não fazer", já havia colocado uma trava explícita para esse cenário: *"RF-018 + rótulo são a mitigação — não inventar inflações extras sem ADR"*. Esta decisão é exatamente esse ADR — a resposta formal, e não uma correção ad hoc no código, ao gate falhando por viés de composição. `docs/reference/risks.md` também registra a regra geral do projeto: relaxar um gate falho por ADR só é aceitável após três tentativas de correção; esta é a segunda (a primeira, medida em 06/09, foi a implementação sem estratificação que gerou os números acima).

A implementação já está no código, em `api/model/extrapolation.py` (parâmetros opcionais `estrato_by_cod_zona`/`te_total_by_estrato` de `estimate_uf_candidatos`) e `api/model/project.py` (`_compute_estratos_por_uf`, `_MIN_ZONAS_PARA_ESTRATIFICAR = 12`, `_N_ESTRATOS = 3`, e o ponto de chamada em `compute_uf_projections`). Este ADR formaliza uma decisão que já está em produção, não propõe uma mudança futura.

## Decisão

O bootstrap de candidatos por UF passa a ser um **bootstrap estratificado por porte de zona**, com estratos definidos como **tercis de `te`** (eleitores aptos da zona) calculados sobre **todas** as zonas conhecidas da UF na tabela `eleitorado` — inclusive as que ainda não reportaram no ciclo corrente. As zonas da UF são ordenadas por `te` crescente (desempate por `cod_zona`, determinístico) e cortadas em três grupos de contagem igual; o peso de cada estrato na agregação é a soma de `te` sobre todas as suas zonas, apuradas ou não. É essa dependência de `eleitorado` — que conhece o universo completo de zonas, ao contrário dos snapshots, que só conhecem quem já reportou — que fixa o peso de cada estrato *a priori* e neutraliza o mecanismo do viés: zonas grandes continuam chegando primeiro, mas o peso do estrato "grande" no cálculo não cresce por causa disso, porque esse peso já estava decidido antes de qualquer urna abrir.

Dentro de cada estrato, o bootstrap reamostra **apenas as zonas apuradas daquele estrato** — um `idx` de reamostragem por estrato, não mais um único `idx` sobre todas as zonas apuradas da UF. O share da UF passa a ser a **soma ponderada, sobre os três estratos, do share de cada estrato** (`Σ w_k·s_k / Σ w_k`, com `w_k` = `te` total a priori do estrato), tanto no ponto quanto em cada resample do bootstrap. Um estrato sem nenhuma zona apurada cai para a proporção da UF inteira (`s_v_uf`/`s_c_uf`, calculados sem estratificação) — a mesma hierarquia de fallback que o RF-013 já definia para uma zona individual sem apuração, sem inventar um nível novo.

Só UFs com **≥ 12 zonas** (`_MIN_ZONAS_PARA_ESTRATIFICAR`) são elegíveis; abaixo disso, três estratos deixariam pouquíssimas zonas por grupo e trocariam viés de composição por variância de amostra pequena — o remédio pior que a doença. Em 06/09 isso exclui RR (8 zonas), AC (9), ZT (10 — o pseudo-UF do exterior) e AP (10); a UF elegível seguinte é SE, com 29. UFs não elegíveis, e qualquer chamada em que o caller não passe `estrato_by_cod_zona`/`te_total_by_estrato`, seguem o caminho **original, byte a byte idêntico** ao pré-06/09 — nenhum sorteio adicional é consumido do RNG nesse caminho, o que preserva a exigência de determinismo da constituição § 6 mesmo tendo adicionado um modo novo ao mesmo estimador.

Os números medidos no replay 2022 regenerado (06/09), comparando com e sem estratificação:

| Métrica | Sem estratificar | Com estratificação | Gate OT-4 |
|---|---|---|---|
| MAE@1h Lula | 3,225pp | **2,590pp** | < 2pp |
| MAE@1h Bolsonaro | 2,609pp | **2,070pp** | < 2pp |
| Cobertura IC95@1h | 78,8% | **79,5%** | ≥ 90% |
| Custo de cômputo adicional | — | +7ms para as 27 UFs | — |

## O que esses números permitem — e não permitem — concluir

A leitura honesta desses números é desconfortável e precisa ficar registrada, não só medida: **o ponto melhorou cerca de 20% e o gate OT-4 continua reprovando nas duas métricas** — MAE ainda acima de 2pp para os dois candidatos, e a cobertura do intervalo de confiança **praticamente não se moveu** (78,8% → 79,5%, contra um piso de 90%).

Essa combinação é informativa por si: se o ponto melhora e a cobertura não, a incerteza residual não está sendo mal alocada *entre* estratos — ela está *dentro* deles. Duas fontes plausíveis, que a estratificação por porte não tem como enxergar: (1) as zonas grandes que reportam primeiro dentro do estrato "grande" ainda não são uma amostra representativa das outras zonas grandes do mesmo estrato — capital e zonas de grande porte no interior podem ter perfis eleitorais bem diferentes, e "grande" como critério de estrato não captura essa heterogeneidade; (2) apuração parcial *dentro* de cada zona (uma zona com `esi` baixo em relação a `te` carrega mais incerteza de extrapolação do que uma zona quase fechada, mas o bootstrap trata todas as zonas apuradas do estrato como intercambiáveis). O bootstrap não enxerga nenhuma das duas, pelo mesmo motivo estrutural do ADR-0021: ele reamostra exatamente as zonas que já reportaram, dentro do estrato que já reportaram — nunca gera uma zona "como as que ainda faltam".

## Ressalva epistêmica

A ordem de apuração usada no replay é **sintética**: `scripts/build-replay-fixtures.ts` ordena zonas por porte crescente com atraso adicional de 3 timesteps para Norte e Nordeste — uma hipótese de viés de composição escolhida por nós, não a ordem real observada em 2022 (que não está mais disponível no CDN do TSE). Isso tem uma consequência que precisa ficar explícita para quem for decidir o próximo passo: **o MAE medido acima é o erro sob a hipótese de viés que nós mesmos construímos**, não uma medição independente de quão enviesada a apuração real costuma ser. E o próprio limiar de 2pp do gate OT-4 **nunca teve base empírica** — foi herdado de um período em que o dataset de replay era tautológico (`swing ≡ 0` por construção; ver ADR-0021, Contexto) e qualquer MAE baixo era garantido pelo desenho do teste, não pelo método. Isso não invalida nem a decisão de estratificar nem o gate OT-4 em si — ambos continuam sendo o melhor instrumento disponível hoje — mas delimita exatamente o que os números desta seção provam: que a estratificação ajuda *sob a hipótese sintética adotada*, não que ela resolve o viés de composição real, cuja magnitude verdadeira só o simulado oficial do TSE (15–17/09) pode revelar.

## Alternativas consideradas

- **Estratos mais finos (quintis) ou uma segunda dimensão geográfica** (ex.: porte cruzado com região). Reduziria variância intra-estrato só se a heterogeneidade residual for majoritariamente *entre* subgrupos capturáveis por um corte estático conhecido a priori — mas a leitura da seção anterior sugere que boa parte do problema é a falta de representatividade *dentro* de um estrato já apurado, algo que subdividir o estrato não resolve sozinho, e piora o problema de amostra pequena que já limita a estratificação a UFs com ≥ 12 zonas.
- **Atacar a largura do intervalo em vez do ponto** (ex.: inflação adicional de CI proporcional ao desbalanceamento de composição observado, não só ao `pct_apurado` como hoje faz RF-018). Corrige diretamente a métrica que mais falhou (cobertura 79,5% vs. 90%), mas exige uma segunda hipótese de calibração sem dado real para validá-la — o mesmo problema epistêmico desta rodada, um nível acima.
- **Recalibrar o limiar do gate OT-4 com dado real do simulado oficial (15–17/09 e 22–24/09)**. Não muda o modelo; usa a primeira oportunidade de medir o viés de composição real, não a hipótese sintética que fabricamos, para decidir se 2pp/90% são metas corretas ou se precisam de revisão fundamentada.

Das três, **a recalibração com dado real do simulado é a mais promissora para a próxima tentativa**. A razão é que as outras duas alternativas continuam investindo em refinar um modelo cuja validação atual depende inteiramente de uma ordem de apuração que nós inventamos — o risco de otimizar contra a hipótese errada é real e cresce a cada camada nova de ajuste sintético. O simulado de 15–17/09 é a primeira chance de trocar "MAE sob viés que escolhemos" por "MAE sob viés real observado", o que tanto valida (ou invalida) esta estratificação quanto informa se vale a pena investir nas outras duas alternativas depois. Isto está alinhado com a regra de `docs/reference/risks.md` de que relaxar um gate por ADR só é aceitável após três tentativas — a terceira tentativa deveria ser a primeira a usar dado real, não mais uma hipótese sintética adicional.

## Consequências

**Positivas**:
- Redução de ~20% no MAE@1h para os dois candidatos líderes no replay regenerado, sem custo de cômputo relevante (+7ms para as 27 UFs).
- Resposta formal e revisável ao risco que o próprio ADR-0021 já havia nomeado como central ("o bootstrap não vê" o viés de composição) — deixa de ser um risco só descrito para virar um risco parcialmente mitigado e medido.
- Determinismo preservado (constituição § 6): quando os parâmetros de estrato não são passados, o caminho original roda byte a byte idêntico, sem sorteio adicional do RNG — testes de reprodutibilidade cobrem isso.
- Nenhuma mudança no contrato a jusante: `estimates_by_uf[uf][cand]` continua share fracionário, `(1000,)`, pareado — `compute_national`, `p_vitoria`, cenários de 2º turno e `compute_outros_estimates` seguem agnósticos ao método interno do estimador.

**Negativas**:
- **O gate OT-4 continua reprovando nas duas métricas** — MAE ainda acima de 2pp (Lula 2,590pp, Bolsonaro 2,070pp) e cobertura do IC95 muito abaixo do piso de 90% (79,5%). Esta decisão é uma melhoria mensurável, não uma correção suficiente; não deve ser lida como "problema resolvido".
- **A projeção passa a depender da completude da tabela `eleitorado`** de um jeito novo e silencioso: o peso a priori de cada estrato vem inteiramente dela. Se `eleitorado` estiver desatualizada ou incompleta para uma UF (zonas novas não cadastradas, redistritamento não refletido), os pesos de estrato ficam errados sem que nada no pipeline sinalize isso — ao contrário do caminho não-estratificado, que só usa `eleitorado` para peso de zona individual, não para fixar a composição de um grupo inteiro a priori.
- **Quatro UFs pequenas seguem sem a correção** (RR, AC, ZT, AP) — assimetria consciente, aceita porque estratificar amostras tão pequenas trocaria o viés que a decisão busca reduzir por variância de estimativa, mas significa que o comportamento do modelo não é uniforme entre UFs, algo que precisa estar visível para quem interpretar diferenças de qualidade de projeção entre estados.
- A cobertura do intervalo praticamente não respondeu à mudança — indício de que a incerteza residual está dentro dos estratos (zonas grandes que reportam primeiro ainda não representam as outras grandes do mesmo estrato, mais apuração parcial intra-zona), não resolvido por esta decisão e candidato natural à próxima tentativa.
- Os números que justificam esta decisão vêm de uma ordem de apuração sintética, não da ordem real de 2022 (indisponível). O gate e a melhoria medida são válidos sob essa hipótese; não são evidência independente da magnitude do viés de composição real.

## Cross-refs

- ADR-0021 (extrapolação do apurado por zona — método que esta decisão estende; risco de viés de composição nomeado ali e endereçado, não resolvido, aqui): [0021-extrapolacao-do-apurado-sem-2022.md](0021-extrapolacao-do-apurado-sem-2022.md)
- ADR-0006 (bootstrap não-bayesiano — mecanismo de incerteza mantido; muda apenas a partição das zonas reamostradas): [0006-bootstrap-nao-bayesiano.md](0006-bootstrap-nao-bayesiano.md)
- ADR-0007 (zona como granularidade do modelo — a estratificação depende de conhecer todas as zonas da UF via `eleitorado`, reforçando a necessidade dessa granularidade): [0007-zona-vs-municipio.md](0007-zona-vs-municipio.md)
- Constituição § 6 (determinismo — caminho não-estratificado byte a byte idêntico, zero sorteios extras) e § 8 (transparência metodológica): [../../constitution.md](../../constitution.md)
- `docs/_meta/plano-modelo-regra-de-tres-2026-09-05.md` § "Riscos e o que não fazer" — regra que exige ADR para qualquer inflação/correção extra sobre o viés de composição
- `docs/reference/risks.md` — risco "Modelo: validação dinâmica pendente até simulado oficial TSE 2026" e a regra de três tentativas antes de relaxar um gate via ADR
- Spec 002 (modelo estatístico) — RF-011/012/013/018, estimador estendido por esta decisão: `docs/specs/002-modelo-estatistico/spec.md`
- `api/model/extrapolation.py` — implementação do estimador estratificado (`estrato_by_cod_zona`, `te_total_by_estrato`, bloco "Pós-estratificação por porte de zona")
- `api/model/project.py` — `_compute_estratos_por_uf`, `_MIN_ZONAS_PARA_ESTRATIFICAR`, `_N_ESTRATOS`, chamada em `compute_uf_projections`
