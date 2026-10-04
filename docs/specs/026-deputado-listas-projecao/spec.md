---
id: 026-deputado-listas-projecao
title: Deputado Federal — listas por agremiação, projeção com trava, extras e três correções
status: implementing
priority: M
personas: [P1, P2, P3]
screens: [T-11, T-12]
requirements: [RF-260, RF-261, RF-262, RF-263, RF-264, RF-265, RF-266, RF-267, RF-268, RF-269, RF-270, RF-271, RF-272, RF-273, RF-274, RF-275, RF-276, RF-277, RF-291, RF-297, RF-298, RF-299, RF-300]
depends_on: [017-deputado-federal, 018-identidade-candidatura]
amends: [017-deputado-federal, 011-sobre-o-modelo]
apis: [GET /uf/[sigla]/deputado-federal/lista, GET /deputado-federal/eleitos]
components: [DeputadoListaAgremiacao, MarcaDeputado, DeputadoMaisVotados, DeputadoPuxadores, DeputadoRegras, DeputadoConferencia, DeputadoMetodologia, CandidateListCollapse, VotacaoEleitorado, DeputadoBancadaPanel, BancadaEleitosNacional]
nfr: [RNF-002, RNF-003, RNF-006, RNF-007a, RNF-012, RNF-022, RNF-023, RNF-024, RNF-035]
# ADRs novos desta spec, a numerar pelo orquestrador (depois da 0062):
#   ADR-0063 — Projeção de deputado com trava de 25% e interruptor no Edge Config
#   ADR-0064 — Destino do voto no proporcional
#   ADR-0065 — Listas de candidaturas proporcionais em três faixas
adrs: [0001, 0005, 0017, 0021, 0023, 0026, 0027, 0034, 0036, 0038, 0049, 0051, 0053, 0063, 0064, 0065, 0073, 0074]
ship_blocked_on: [ADR-0063, ADR-0064 e ADR-0065 aceitos, G2 (replay sintético) reportado ao dono antes de ligar o interruptor, portões e2e de peso e acessibilidade em /uf/SP/deputado-federal com o Blob servido]
opens_after: 2026-09-29
---

# Spec 026 — Deputado Federal: listas, projeção com trava, extras e correções

**Rotas emendadas**: `/uf/[sigla]/deputado-federal` (T-12) e `/deputado-federal` (T-11).
**Rota nova**: `GET /uf/[sigla]/deputado-federal/lista` — fora de `/api` de propósito (o BotID roda
em `/api/*`, `proxy.ts:103`).
**Cargo TSE**: 6 · turno único · proporcional.

> **Numeração.** RF-260..RF-277 conferidos por grep em 2026-09-29 — nenhum uso anterior no
> repositório (a spec 025 reservou até RF-259). Os três ADRs novos são citados aqui como **ADR-0063**,
> **ADR-0064** e **ADR-0065** (títulos no frontmatter); o orquestrador troca pelos números definitivos.

## Pedido do dono (2026-09-29)

Enriquecer as telas de Deputado Federal: em cada estado, a lista de candidatos de cada partido ou
federação com votos, % dos válidos e três marcas — eleito na parcial, eleito na projeção, eleito
oficial do TSE —; construir agora a **projeção de deputado**, que não existe, com trava de 25% e
interruptor; e os extras aprovados (mais votados do estado e do país, linha de corte, puxadores,
regras com os números do estado). No mesmo pacote, corrigir três defeitos que o levantamento achou
(§ "Três correções").

## Status

`implementing` desde 2026-09-29. Corte de código na sexta 02/10 às 18h; virada em 03/10; eleição em
04/10 com deploy congelado das 16h às 05h — **no congelamento só o interruptor se mexe** (RF-265).

**Degradação pré-acordada** (plano de 29/09): se o replay sintético (G2) falhar feio ou a frente P2
atrasar, a projeção sobe **desligada** e todo o resto sobe normalmente. Nenhum RF abaixo depende da
projeção ligada para ser verdadeiro — com o interruptor desligado a tela é a de hoje mais as listas,
as correções e os extras.

## Objetivo

Deixar o leitor ver **quem** está entrando na Câmara, não só quantas cadeiras cada legenda tem — e
dizer, com a mesma honestidade da spec 017, o que é conta sobre o voto já contado, o que é
estimativa nossa e o que é o resultado oficial.

## Escopo

### Dentro

- Lista de candidatos por agremiação em três faixas (20 visíveis · 21–60 na página · 61+ sob demanda).
  *Emenda 04/10: visíveis = eleitos + 7 (RF-260).*
- As três marcas, com precedência do resultado oficial.
- Projeção de votos e de cadeiras por UF, zona a zona, com trava automática e interruptor sem deploy.
- Mais votados do estado e do país, linha de corte, puxadores, regras com os números do estado.
- Três correções: Conferência de verdade; `dvt` no cálculo de cadeiras; % apurado da UF.
- Contrato v2 aditivo do payload (objetos v1 continuam renderizando) e portões e2e com o Blob servido.
- *Emenda 04/10:* na capa, lista nacional de eleitos por agremiação, sob demanda, e cenário projetado
  nacional misto e rotulado, com a bancada como última seção de conteúdo (RF-299, RF-300).

### Fora

- **Bancada nacional projetada** — *emendado em 04/10 (decisão do dono; ADR-0063, emenda de 04/10 (2)).*
  O texto de 29/09 dizia: "A capa ganha só o selo de estado da projeção por UF; somar projeções de UFs
  liberadas com parciais de UFs aguardando produziria um número sem nome." A resposta do dono ao "número
  sem nome" foi **dar nome ao número**: o cenário misto entra (RF-300), sempre com o rótulo do que foi
  somado. **Continua fora**: voto projetado por candidato em página nacional (RF-297); faixa de cadeiras
  do cenário nacional; reordenar as agremiações pelo cenário; qualquer mudança no modelo ou no payload do
  Edge Config para isso (o cenário é montado na leitura, a partir dos objetos por UF); e a bancada
  nacional projetada das assembleias (spec 027 § Fora, inalterada).
- **Gravar a projeção de deputado em `projections`** — o `candidato_id` é `int4` e não comporta o
  `sqcand` de 11 dígitos. A projeção é reproduzível dos snapshots mais o código e mais o estado do
  interruptor registrado no log do ciclo (ADR-0063, constituição § 6).
- **Consertar a tabela `zonas`** (o par Macapá×0014 que falta no AP, achado do simulado de 28/09). É
  da ingestão (spec 001) e está escalado ao dono; aqui só se garante que a falta **apareça** (RF-269)
  e **feche a trava** (RF-264).
- Deputado Estadual/Distrital (inalterado desde a spec 017).

## Vocabulário

| Termo | Significa |
|---|---|
| **parcial** | a distribuição de cadeiras do ADR-0027 sobre o voto **já apurado** — "se a contagem parasse agora" |
| **projeção** | a mesma distribuição sobre o voto **projetado** para o total da UF (RF-263) — sempre "não oficial" |
| **TSE** | o `st` do candidato no agregado da UF, que só existe com totalização final (`tf = "s"`) |
| **via** | por onde a vaga veio **na nossa conta**: quociente partidário (`qp`) ou sobras (`sobra`). Não é o rótulo do TSE |
| **zona** | o par município×zona, unidade de ingestão desde o ADR-0036 (RR tem 16, AP 17 na nossa tabela) |
| **zona apurada** | zona cujo último boletim tem `e.esi > 0` e `v.vv > 0` |
| **destino** | o `cand.dvt` do EA20: `Válido`, `Válido (legenda)`, `Anulado`, `Anulado sub judice` |

## Requisitos Funcionais

### Listas

**RF-260 — Listas em três faixas**

WHEN a página de UF de Deputado Federal renderiza a lista de uma agremiação, the system SHALL
mostrar os 20 primeiros candidatos por voto apurado; SHALL trazer do 21º ao 60º no próprio documento,
fora da vista até o leitor pedir, sem remover nó do DOM (ADR-0034 D21); e SHALL buscar do 61º em
diante só quando o leitor pedir, pela rota `GET /uf/[sigla]/deputado-federal/lista`, guardando a
resposta em memória na aba (ADR-0065).

> ⚠️ **Emenda 04/10 (decisão do dono): eleitos + 7.** "Para todas as telas de deputados federais e
> estaduais o padrão do sistema será sempre exibir os eleitos e + 7 abaixo do corte; a partir desses,
> só tocando no botão." A primeira faixa deixa de ser "os 20 primeiros" e passa a ser o **conjunto
> visível por padrão** de cada agremiação: rank ≤ **R = (maior rank eleito na tela, ou 0) + 7** — com
> "eleito na tela" = marca na parcial; na projeção, só com a projeção visível (RF-265); com a
> totalização final, só "Eleito (TSE)" (RF-267). As 7 são posições (uma linha com `destino` entre elas
> ocupa uma; contá-las só entre as válidas abriria as 60 linhas de uma agremiação com a candidatura
> inteira anulada). Agremiação sem eleito: as 7 primeiras. As linhas 1–60 continuam todas no
> documento; o que muda é quem fica recolhido (`li[data-f]`) e o N de "Mais N candidatos". Se R passa
> de 60, tudo o que está no documento fica visível. O voto projetado por candidatura (RF-297) sai
> exatamente nas linhas válidas desse conjunto. Regra única em `lib/utils/deputado-marcas.ts`
> (`ultimoRankVisivel`), espelhada no produtor (`api/model/deputado_payload.py`). Vale no celular e no
> computador; o 61+ segue pela rota.

**Aceitação**:
- Given uma agremiação de SP com 71 candidatos, when a página carrega, then as linhas de rank 1 a 60
  estão no documento, 20 visíveis, e **nenhuma** requisição à rota da lista foi feita. *(Emenda 04/10:
  visíveis = eleitos + 7 — o PL de SP da fixture de contrato, com 25 eleitos, mostra 1–32 e recolhe
  33–60, "Mais 28 candidatos de PL".)*
- Given o leitor aciona "ver mais", when a faixa abre, then as linhas 21–60 ficam visíveis e o botão
  passa a `aria-expanded="true"`. *(Emenda 04/10: as linhas recolhidas, de R + 1 a 60.)*
- Given o leitor aciona "mostrar todos", when a busca roda, then a lista tem `aria-busy="true"`
  durante, uma região viva anuncia quantos candidatos chegaram, o foco vai para a primeira linha nova
  (rank 61) e um segundo acionamento **não** refaz a requisição.
- Given a rota responde erro, when a busca falha, then aparece a mensagem com "tentar de novo" e as
  60 linhas continuam na tela.
- Given uma agremiação com até 20 candidatos, when renderiza, then nenhum botão aparece; com até 60,
  só o "ver mais". *(Emenda 04/10: nenhum botão quando eleitos + 7 cobre a agremiação inteira; sem
  eleito e com 8+ candidatos, "Mais N" aparece a partir do 8º.)*
- *(Emenda 04/10)* Given agremiações com 0, 1 e 15 eleitos, when renderizam, then mostram 7, 8 e 22
  linhas; given a projeção visível elegendo também o 10º de uma agremiação com 3 eleitos na parcial,
  then mostra 17 (oculta: 10); given 56 eleitos, then as 60 do documento ficam visíveis, sem "Mais N".
- ⚠️ **Só SP chega ao 61+.** Cada partido ou federação registra até 100% dos lugares mais 1 (Lei
  9.504 art. 10, redação da Lei 14.211/2021): SP (70 lugares) admite 71; MG (53), 54. A terceira
  faixa existe para SP, e com no máximo 11 linhas por agremiação — o que mantém a rota barata.

**RF-261 — A linha do candidato, sempre na ordem do voto apurado**

WHEN uma linha de candidato é exibida, the system SHALL mostrar a posição na agremiação, o nome, o
número de urna, o partido, os votos apurados e o % dos votos válidos da UF, and SHALL ordenar as
linhas pelo `rank` do payload — voto apurado —, NUNCA pela projeção (constituição § 2).

**Aceitação**:
- Given uma projeção liberada em que dois candidatos da mesma agremiação trocariam de posição, when a
  lista renderiza, then a ordem é a do voto apurado, idêntica à do interruptor desligado.
- Given um candidato com destino `Anulado` ou `Anulado sub judice`, when a linha renderiza, then os
  votos aparecem, o % dá lugar ao texto do destino ("votos anulados" / "sub judice — fora da conta")
  e nunca aparece `0,00%`.
- Given uma linha sem `numero`, when renderiza, then a linha sai sem número — nunca `undefined`.
- Given um objeto v1 (sem `candidatos`), when a página renderiza, then a lista é `eleitos` +
  `suplentes`, em `ordem`, sem % nem número, e nada quebra (RF-276).

### Marcas

**RF-262 — Eleito na parcial, via QP ou sobra, e sobra apertada**

WHEN uma UF tem cadeiras distribuídas, the system SHALL marcar "eleito na parcial" cada candidato
que a distribuição sobre o voto apurado elege; SHALL dizer se a vaga veio do quociente partidário ou
das sobras **na nossa conta**; e SHALL marcar "sobra apertada" a vaga de sobra cuja margem é menor
que a fatia ainda não apurada (RF-127, `deputado_payload.py::_marcar_indefinidas`).

**Aceitação**:
- Given qualquer UF, when a tela conta as marcas de parcial, then elas somam `lugares_a_preencher −
  vagas_nao_preenchidas`, e em cada agremiação batem com `cadeiras` (RF-125.1).
- Given 100% apurado ou `tf = "s"`, when a UF renderiza, then nenhuma vaga é "apertada".
- Given a nossa via é "QP" e o `st` do TSE diz "Eleito por média" — o simulado de 28/09 mostrou que
  os dois **não coincidem** —, when a linha renderiza, then a tela nunca apresenta os dois como a
  mesma coisa: a via é texto nosso, junto da marca de parcial; o TSE aparece só como "Eleito (TSE)".

**RF-267 — "Eleito (TSE)" com precedência sobre parcial e projeção**

WHEN o agregado da UF traz totalização final (`tf = "s"`), the system SHALL marcar "Eleito (TSE)"
cada candidato que o TSE publicou como eleito (`st` "Eleito por QP", "Eleito por média" ou
"Eleito"), and SHALL, nessa UF, suprimir as marcas de parcial e de projeção de **todos** os
candidatos — a marca oficial tem precedência.

**Aceitação**:
- Given `tf = "s"` e um candidato que a nossa conta elegia e o TSE não, when a linha renderiza, then
  ela não tem marca de eleito nenhuma; e o candidato que só o TSE elegeu tem "Eleito (TSE)".
- Given `tf ≠ "s"`, when qualquer linha renderiza, then não há marca do TSE — `cand.e`/`cand.st` só
  existem com totalização final (medido no simulado de 28/09).
- Given um `st` fora dos valores conhecidos, when o ciclo lê, then a linha sai sem `tse` e o ciclo
  loga `warn` — nunca se adivinha.

### Projeção

**RF-263 — Projeção de votos, cadeiras e eleitos**

WHILE a projeção de uma UF está liberada (RF-264), the system SHALL projetar para o total da UF os
votos de cada candidato válido e da legenda de cada agremiação, zona a zona — extrapolando cada zona
apurada pelo fator `e.te / e.esi` e imputando às zonas sem boletim o voto das apuradas de tamanho
parecido (pós-estratificação do ADR-0023, ADR-0063) —, and SHALL aplicar ao voto projetado a mesma
distribuição de cadeiras da parcial (ADR-0027), publicando por agremiação as cadeiras projetadas
(com faixa, quando houver — RF-127 emendado pelo ADR-0063) e por candidato a marca "eleito na projeção".

**Aceitação**:
- Given 100% apurado, when a projeção roda, then ela é **igual** à parcial cadeira a cadeira e
  candidato a candidato (G1).
- Given a mesma fração apurada em todas as zonas, when a projeção roda, then ela é igual à parcial
  (G1).
- Given a projeção liberada, when a UF é publicada, then Σ cadeiras projetadas + vagas não preenchidas
  da projeção == `lugares_a_preencher`, e cada agremiação tem tantas marcas de projeção quanto
  cadeiras projetadas.
- Given os mesmos snapshots e o mesmo estado do interruptor, when o ciclo roda duas vezes, then a
  saída é idêntica byte a byte (constituição § 6).
- Given um candidato com destino `Anulado` ou `Anulado sub judice`, when a projeção roda, then o voto
  dele não é projetado nem conta.

**RF-264 — Trava automática por UF**

WHEN o ciclo do cargo 6 calcula uma UF, the system SHALL liberar a projeção somente se,
cumulativamente: o interruptor está ligado (RF-265); nenhuma agremiação é coligação; `carg.nv` foi
publicado; o % apurado da UF (RF-275) é ≥ `pct_minimo` (25 por padrão); há pelo menos 2 zonas
apuradas; e o eleitorado das zonas que conhecemos fecha com o `e.te` do agregado do TSE. Caso
contrário SHALL publicar `projecao.estado` `aguardando` ou `indisponivel`, com o motivo, e **nenhuma**
marca nem número de projeção.

**Aceitação**:
- Given % apurado exatamente 25,00000 e as demais condições, when o ciclo roda, then `liberada`; com
  24,99999, `aguardando` / `pct_minimo`. (Teste de limiar com caso **no** limiar.)
- Given 30% apurado numa única zona, when o ciclo roda, then `aguardando` / `zonas_minimas`.
- Given o caso do AP no simulado de 28/09 — todas as 17 zonas da nossa tabela apuradas e o eleitorado
  delas 19,5% abaixo do agregado —, when o ciclo roda, then `indisponivel` / `cobertura`, mesmo com o
  % acima de 25.
- Given duas condições falhando ao mesmo tempo, when o ciclo roda, then o motivo publicado é o
  primeiro na ordem fixa do design (§ 2.7) — o mesmo em todo ciclo.
- Given `pct_apurado` vindo de `s.psa`, when o código é lido, then isso não existe: a trava usa o
  RF-275 (o `s.psa` do feed é binário, 0 ou 100).

**RF-265 — Interruptor sem deploy, com falha fechada**

WHERE a chave `interruptor-projecao-dep` do Global Config existe, é válida e diz `ligada: true`, the
system SHALL permitir a projeção; IF a chave falta, está malformada ou a leitura falha, THEN the
system SHALL tratá-la como **desligada** — tanto no ciclo do modelo quanto na renderização da página.

**Aceitação**:
- Given a projeção no ar e o dono desliga a chave, when a próxima requisição da página chega (sem
  deploy e sem esperar ciclo), then nenhuma marca, número ou selo de projeção aparece — em até 60 s,
  medido no ensaio de 03/10.
- Given a leitura da chave falha, when a página renderiza, then a projeção não aparece e o servidor
  loga `warn`.
- Given `pct_minimo` abaixo de 25 ou acima de 100 na chave, when é lida, then a chave é inválida e a
  projeção fica desligada.
- Given `pnpm dep:projecao`, when o dono o usa, then o script mostra o valor atual e o store alvo,
  pede confirmação, recusa o store de ensaio sem `--ensaio` e recusa qualquer outro com `--ensaio`.
- Given o texto do runbook e de `vercel.ts` sobre `TSE_DEPUTADO_GRANULARIDADE`, when relido, then não
  diz mais "sem deploy": variável de ambiente só chega a deploy novo na Vercel (ADR-0063).

**RF-266 — Rótulo não oficial, bloco "o que está movendo" e metodologia**

WHEN qualquer superfície mostra número, marca ou selo da projeção de Deputado, the system SHALL
rotulá-lo "projeção · não oficial" (constituição § 1); SHALL exibir na página da UF, com a projeção
liberada, o bloco "o que está movendo" (§ 8) em template determinístico (ADR-0005); e SHALL explicar
o método em `/sobre-o-modelo`, sem `<h2>` novo, e no `<DeputadoMetodologia>`.

**Aceitação**:
- Given as duas telas de Deputado, when o texto fora do bloco de metodologia é lido, then toda
  ocorrência de "projeção"/"projetad" está no mesmo elemento que "não oficial" (reescreve os testes
  (m5) e (t5) da spec 017).
- Given qualquer tela, when se procura "eleito" como marca, then ele nunca aparece sozinho: é sempre
  "eleito na parcial", "eleito na projeção · não oficial" ou "Eleito (TSE)".
- Given a projeção liberada, when o bloco "o que está movendo" renderiza, then ele diz a fração de
  eleitorado imputada e as agremiações cuja cadeira projetada difere da parcial — e nada mais.
- Given `/sobre-o-modelo`, when renderiza, then continua com oito `<h2>`
  (`tests/integration/sobre-o-modelo-page.test.tsx`).

### Três correções

**RF-268 — Destino do voto (`dvt`) no cálculo de cadeiras**

WHEN o EA20 de cargo 6 traz `cand.dvt`, the system SHALL contar como voto nominal elegível só o de
destino `Válido`; SHALL somar à legenda da agremiação o de `Válido (legenda)`; SHALL tirar do quociente
eleitoral, do quociente partidário e das sobras o de `Anulado` e `Anulado sub judice` — seguindo o que
o TSE marca, sem rederivar a lei (ADR-0064) —; and SHALL manter esses candidatos visíveis, com os votos
e sem %. IF nenhum candidato da UF tem `dvt` (`and = "n"`), THEN o resultado é bit a bit o de hoje.

**Aceitação**:
- Given um arquivo com `and ≠ "n"`, when as agremiações são montadas, then Σ (nominais elegíveis +
  legenda) == `v.vv` do mesmo arquivo; divergência loga `error` e alerta, **sem** abortar (§ 7).
  Identidades medidas em 417 arquivos do simulado: `par.tvtn = Σ vap[Válido]`, `par.tvtl = par.tval
  + Σ vap[Válido (legenda)]`, `v.vv = Σ (tvtn + tvtl)`.
- Given uma chapa inteira sub judice (o caso do AP), when a UF é publicada, then a agremiação aparece
  com 0 voto válido, 0 cadeira e todos os candidatos com votos e sem %.
- Given os votos de 2022, when o golden roda, then continua 511/513 com as mesmas duas exceções.
- Given um `dvt` fora dos quatro valores, when lido, then o candidato não entra no cálculo e o ciclo
  loga `warn` (o invariante com `v.vv` decide se é alarme).
- ⚠️ **Diferente do majoritário** (ADR-0053): lá o anulado sai da disputa por decisão nossa sobre a
  tela; aqui o TSE já publica o destino e a lei do proporcional (Lei 9.504 art. 16-A p.ú.; CE art. 175
  §§ 3º–4º) manda o voto do anulado para a legenda ou para fora. O ADR-0064 registra a diferença.

**RF-269 — Conferência que compara de verdade**

WHEN a página de UF diz algo sobre bater com o TSE, the system SHALL basear a frase numa comparação
**efetivamente feita no ciclo**, dizendo o que foi comparado, contra qual boletim e o tamanho de
cada diferença. As comparações são: (a) o eleitorado das zonas que lemos × `e.te` do agregado da UF;
(b) a nossa conta sobre os votos do próprio agregado × `carg.qe` e `agr.vag` do mesmo arquivo — só
com `and ≠ "n"`, porque antes disso `agr.vag` é resto de ciclo anterior; (c) com `tf = "s"`, o
conjunto de eleitos, **por pessoa** (`cand.e`); (d) com `tf = "s"`, os votos válidos somados das zonas
× `v.vv`. Rótulo de via ("por QP", "por média") nunca é comparado.

**Aceitação**:
- Given nenhuma comparação (b) feita, when a Conferência renderiza, then o texto **não** diz que os
  números batem — hoje ele diz, e a comparação nunca foi feita (`deputado.py:502-503` zera o dado do
  TSE no modo por zona; `page.tsx:752-753` afirma que bate).
- Given o caso do AP, when a Conferência renderiza, then ela diz que o eleitorado das zonas que lemos
  está **19,5% abaixo** do boletim do TSE, com os dois números.
- Given `confere`, when renderiza, then a frase nomeia o horário do boletim do TSE comparado.
- Given `tf = "s"` e um eleito diferente, when renderiza, then a Conferência diz quantos eleitos são
  só nossos e quantos só do TSE.

**RF-275 — % apurado da UF medido pelo eleitorado**

WHEN o ciclo do cargo 6 calcula o % apurado de uma UF, the system SHALL usar Σ `e.esi` das zonas
dividido pelo eleitorado da UF — o `e.te` do agregado, ou Σ `e.te` das zonas se o agregado faltar,
o maior dos dois —, and SHALL NOT usar o maior percentual de uma zona nem `s.psa`.

**Aceitação**:
- Given o momento `m1` de RR no simulado (1 zona de 16 com boletim, 38,6% do eleitorado, 53% das
  seções dela), when o % é calculado, then dá o `e.esi/e.te` do estado (≈ 20%), e não 100%.
- Given o AP do simulado (as 17 zonas da nossa tabela completas, eleitorado delas 505.610 contra
  628.071 do agregado), when o % é calculado, then dá ≈ 80,5%, e não 100%.
- Given o mesmo número, when `_marcar_indefinidas` roda, then usa este %, não o de hoje.
- ⚠️ O `pct_apurado` gravado em `snapshots` é `s.psa` (`lib/tse/ingest-handler.ts:732-745`), que
  no feed é binário: 0 com `and = "n"`, 100 com qualquer boletim. `max(...)` sobre ele
  (`project.py:7923`) dá 100% assim que uma zona reporta.

### Extras

**RF-270 — Mais votados do estado**

WHEN a página de UF renderiza, the system SHALL mostrar os 10 candidatos com mais votos apurados na UF,
de todas as agremiações, com agremiação, % dos válidos, marcas e destino.

**Aceitação**:
- Given dois candidatos com os mesmos votos, when a lista é montada, then o de menor `sqcand` vem antes
  — sempre o mesmo (§ 6).
- Given um candidato sub judice entre os 10 mais votados, when renderiza, then ele aparece, com o
  destino escrito e sem %.
- Given o Blob, when a lista é montada, then vem do próprio objeto da UF, sem buscar a lista 61+.

**RF-271 — Mais votados do país, do payload**

WHEN a capa `/deputado-federal` renderiza, the system SHALL mostrar os 10 mais votados do país a
partir do payload nacional, and SHALL NOT ler o Blob de nenhuma UF para isso.

**Aceitação**:
- Given a capa renderizada no teste, when se conta a leitura de Blob, then `readDeputadoUfDetail` não
  foi chamado nenhuma vez.
- Given uma linha, when renderiza, then diz a UF e que o % é "dos válidos de {UF}".

**RF-272 — Linha de corte**

WHEN uma agremiação tem ao menos um eleito na parcial e um candidato válido de fora, the system SHALL
mostrar a linha de corte entre o último eleito e o primeiro de fora, com a diferença em votos, and
SHALL avisar quando o primeiro de fora está abaixo do piso de 10% do QE — ele só poderia entrar por
sobra aberta.

**Aceitação**:
- Given o corte na faixa 21–60 (o PL de SP com 25 eleitos), when a lista está fechada, then o
  cabeçalho da agremiação repete a diferença em texto — o corte não some porque a faixa está fechada.
  *(Emenda 04/10: com "eleitos + 7" o último eleito está sempre no conjunto visível, e a linha de
  corte também; a repetição no cabeçalho continua.)*
- Given uma agremiação sem eleito, when renderiza, then não há linha de corte.

**RF-273 — Puxadores**

WHEN um candidato válido tem votos ≥ 2 × QE, the system SHALL listá-lo como puxador na sua agremiação
e, entre os 30 maiores excedentes do país, na capa — com quantos quocientes fez sozinho e o excedente
(`⌊votos / QE⌋ − 1`), dizendo que o excedente soma para a agremiação e não elege nome nenhum.

**Aceitação**:
- Given votos exatamente 2 × QE, when o ciclo roda, then é puxador com excedente 1; com 2 × QE − 1,
  não é.
- Given um candidato sub judice com 5 × QE, when o ciclo roda, then não é puxador.

**RF-274 — Regras com os números do estado**

WHEN a página de UF renderiza e o QE existe, the system SHALL mostrar as regras do ADR-0027 com os
números da UF — lugares, QE, piso de 10% do candidato (`⌈QE/10⌉`), 80% para a agremiação disputar
sobra (`⌈0,8 · QE⌉`) e 20% para o candidato (`⌈0,2 · QE⌉`) —, todos vindos do payload.

**Aceitação**:
- Given um payload com QE 1.003, when o bloco renderiza, then os pisos lidos são 101, 803 e 201 — o
  teste injeta o número para que um literal no JSX seja pego (design 017 D8).
- Given QE ausente, when renderiza, then o bloco diz que as regras aparecem quando o TSE publicar as
  vagas e houver voto.

### Contrato e portões

**RF-276 — Tipos em dia e objeto v1 ainda renderiza**

WHEN o servidor lê um objeto do Blob de Deputado ou o payload nacional, the system SHALL tipar como
opcionais todos os campos v2 — inclusive `dado_ts` e `pares_atrasados`, que o produtor já publica e
o tipo `DeputadoUfDetail` não declara —, and SHALL renderizar um objeto v1 (sem `contrato`) sem erro,
degradando só os blocos que dependem do v2.

**Aceitação**:
- Given `tests/fixtures/blob/dep-uf.json` (v1, intocada), when a página renderiza, then não há erro,
  a lista sai de `eleitos` + `suplentes`, e os blocos de mais votados, corte, puxadores, regras e
  projeção não aparecem.
- Given um campo novo no topo do corpo de escrita, when a rota de escrita valida, then ele é
  descartado sem erro (`deputadoBodySchema`, `route.ts:273`) — por isso **todo** campo novo viaja
  dentro de `payload` ou `payloads_uf[UF]`, e um teste da rota prova que chega ao Blob.

**RF-277 — Portões de peso e acessibilidade em `/uf/SP/deputado-federal` com o Blob servido**

WHEN os portões e2e rodam, the system SHALL servir o Blob de Deputado (UF e lista 61+) e a chave do
interruptor a partir do servidor falso, and SHALL medir `/uf/SP/deputado-federal` com teto próprio de
**480 KiB** de documento e auditoria de acessibilidade completa, a 375 px e por teclado.

**Aceitação**:
- Given `pnpm build:e2e && pnpm start:e2e`, when `/uf/SP/deputado-federal` é aberta, then a página
  tem a lista — não "Detalhe indisponível" (hoje `BLOB_READ_WRITE_TOKEN=""` faz o portão medir página
  vazia).
- Given a medição, when o portão compara, then o documento cabe em 480 KiB (≈ 70 KiB gzip).
- Given o axe, when audita a página com a lista aberta e fechada, then zero violações.
- Given o SSR de SP, when medido, then o tempo é reportado no relatório do portão.

### Emenda de 03/10 — foto dos eleitos

> **Numeração.** RF-291 conferido por grep em 2026-10-03 — nenhum uso anterior no repositório
> (o último era RF-290, da spec 027). Vale para as três casas: a página de UF é o mesmo módulo
> (`app/(dep)/_pagina-uf-deputado.tsx`), e a spec 027 (RF-281) a herda.

**RF-291 — Mini-foto só de quem está sendo eleito, nas páginas de UF**

WHEN a página de UF de uma casa proporcional (`/uf/[sigla]/deputado-federal`,
`/uf/[sigla]/deputado-estadual`, `/uf/DF/deputado-distrital`) lista uma candidatura **eleita na
parcial** — ou, com a totalização final, **"Eleito (TSE)"** — nas listas por agremiação ou nos mais
votados da UF, the system SHALL mostrar à esquerda do nome um avatar circular de 28 px com a foto do
TSE (`candidatos/foto/<UF>/<sqcand>.jpg`) quando a fatia de candidaturas da UF × cargo diz
`foto_ok`, e as iniciais no mesmo círculo caso contrário (RF-151); AND the system SHALL NOT mostrar
avatar em linha não eleita (inclusive "eleito na projeção" sozinho), nem em página nacional.

**Aceitação**:
- Given uma lista com eleito com foto, eleito sem foto, só-projeção e não eleito, when renderiza,
  then só os dois eleitos têm avatar — foto com a URL do Blob e iniciais —, e os outros dois nenhum.
- Given a fatia de candidaturas indisponível (ou ambiente sem Blob), when renderiza, then os eleitos
  saem com as iniciais, nunca com `<img>` quebrada, e a página não falha.
- Given a capa `/deputado-federal` (mais votados do país), when renderiza, then nenhum avatar.
- Given o avatar, when auditado, then é decorativo (`alt=""`, `aria-hidden`), tem `width`/`height`
  explícitos e `loading="lazy"`, e o fundo é o par neutro do kit — mesma forma para todo partido
  (constituição § 2).
- Peso: decisão do dono de 03/10 ("não se preocupar com o tamanho em KB"); o teto que estourar sobe
  com o valor medido e o motivo escrito ao lado.
- Nota de 04/10: o avatar de 28 px vale **abaixo de 960 px**; a partir dali é de 36 px (RF-298, ADR-0073).

### Emenda de 04/10 — telão: voto projetado por candidato e painel desktop

> **Numeração.** RF-296, RF-297 e RF-298 conferidos por grep em `docs/` em 2026-10-04 — nenhum uso
> anterior (o último era RF-295, da spec 003). O RF-296 (atualização automática) mora na
> [spec 003](../003-home-nacional/spec.md), junto do RF-027 que ele substitui; esta spec leva o RF-297 e o
> RF-298. Como no RF-291, a página de UF é o mesmo módulo (`app/(dep)/_pagina-uf-deputado.tsx`) e a
> [spec 027](../027-deputado-estadual-distrital/spec.md) herda o RF-298 (T-17, T-18); o RF-297 é **só do
> Federal**.

**RF-297 — Voto projetado por candidatura (só Deputado Federal)**

WHILE a projeção de uma UF está liberada (RF-264), the system SHALL publicar `votos_projetados` (inteiro) em cada linha de candidato válido de `candidatos` do objeto da UF, and SHALL NOT publicá-lo em linha de `lista_restante` (rota 61+), nem em linha com `destino` (`anulado`, `sub_judice`, `valido_legenda`).
WHEN uma página de UF de Deputado Federal renderiza uma linha **eleita na parcial ou na projeção**, OR uma das **7 primeiras linhas, por `rank`, sem marca de eleito** de cada agremiação — inclusive onde a linha reaparece no "Mais votados em {UF}" (RF-270), que repassa o campo —, and a projeção está visível (RF-265) e a UF não tem totalização final (RF-267), the system SHALL exibir sob o voto apurado, no mesmo elemento, "projeção ≈ N · não oficial", com N em forma compacta arredondada a milhar ("652 mil", "1,2 mi"), na cor de projeção, sem reordenar a lista e sem substituir o voto apurado (ADR-0063 Decisão 5 e emenda de 04/10).
IF o interruptor está desligado, OR a UF não está `liberada`, OR a linha não está entre as acima, THEN the system SHALL NOT exibir o número, and a leitura da página SHALL remover o campo da linha.
The system SHALL NOT exibir voto projetado por candidato no Deputado Estadual, no Distrital nem em página nacional.

**Aceitação**:
- Given uma UF `liberada` e uma agremiação com 3 eleitos na parcial, 1 eleito só na projeção e 20 candidatos, when a página renderiza, then os 4 marcados e os 7 primeiros por `rank` entre os não marcados mostram o número, e nenhum dos outros 9.
- Given a mesma UF com o interruptor desligado, when a página renderiza, then nenhuma linha mostra o número, e a ordem das linhas é a mesma da página com ele ligado.
- Given `lista_restante` de SP, when o ciclo publica, then nenhuma linha dela tem `votos_projetados` (teste de modelo e da rota 61+).
- Given 100% apurado, when a projeção roda, then `votos_projetados` é igual ao voto apurado de cada candidato (identidade G1); given os mesmos snapshots e o mesmo estado do interruptor, when o ciclo roda duas vezes, then a saída é idêntica byte a byte.
- Given um candidato `anulado` ou `sub_judice` entre os 7 primeiros por `rank`, when renderiza, then ele não mostra número e não ocupa uma das 7 posições.
- Given a linha com o número, when o texto é lido, then "projeção" e "não oficial" estão no mesmo elemento (RF-266) e a legenda das marcas tem uma linha para ele.
- Given `votos_projetados` de 999.500 a 999.999, when formatado, then sai "1 mi", nunca "1.000 mil".
- Given `/uf/SP/deputado-federal` com o Blob servido, when o portão mede o documento, then o teto das páginas de UF de Deputado (SP, RJ, MG) é o valor medido pelo implementador (alvo ~590 KiB, ADR-0063 emenda de 04/10), registrado em `docs/nfr/performance.md` e em `tests/e2e/perf-budget.spec.ts` com o pior caso de cada campo.
- Given `/uf/SP/deputado-estadual` e `/deputado-federal`, when renderizam, then nenhum voto projetado por candidato aparece.

**RF-298 — Painel desktop: escala tipográfica fluida, coluna de painéis e telas de Deputado largas**

WHILE a largura da janela é ≥ 960 px, the system SHALL escalar a tipografia do site com uma rampa fluida ancorada em 960 px — sem alterar nada nessa largura — de modo que, a 1920 px, os tamanhos pequenos (`--text-2xs` a `--text-sm`) cresçam ~40%, os médios (`--text-base`, `--text-md`) ~33% e os grandes (`--text-lg` a `--text-5xl`) ~25%, com tetos de 1,7× nos pequenos e 1,45× nos grandes (ADR-0073); and SHALL manter o texto de `<small>` nas linhas de lista no tamanho do texto do dado (`--text-xs`), e derivar de tokens os tamanhos de fonte em px literais dos componentes de linha de candidato.
WHILE a largura da janela é ≥ 960 px, nas rotas com mapa, the system SHALL dimensionar a coluna de painéis como `clamp(400px, 36vw, 820px)`, mantendo `--container-page` e `--container-sidebar` inalterados.
WHILE a largura da janela é ≥ 960 px, nas páginas de Deputado (`/deputado-federal`, `/uf/[sigla]/deputado-federal` e, por herança, as de Estadual e Distrital), the system SHALL: (i) alargar o conteúdo até 1920 px com margem lateral fluida; (ii) dispor as agremiações em grade de colunas de ao menos 30 rem — 2 colunas a 1280–1440 px e 3 a 1920 px —, **na ordem do DOM**; (iii) dispor lado a lado, a partir de 1280 px, os pares Votação + Mais votados (e, nas capas, Câmara 2027 + Bancada, Mais votados + Puxadores); (iv) mostrar na linha do candidato o voto apurado em mono 600 maior que o nome, nº/partido e percentual em `--text-xs` e avatar de 36 px (RF-291 emendado **só ≥ 960 px**: abaixo disso o avatar continua de 28 px); (v) usar `--type-kpi` no resumo da UF e `--type-kpi-sm` no número de cadeiras do cabeçalho de cada agremiação; e (vi) deixar regras, conferência e metodologia em largura cheia, no fim.
WHILE a largura da janela é < 960 px, the system SHALL NOT alterar tipografia, larguras nem leiaute.
The system SHALL NOT acrescentar classe nem atributo por linha de candidato para esta frente.

**Aceitação**:
- Given 375 px, when se mede `/`, `/uf/SP`, `/governador`, `/senador`, `/deputado-federal` e `/uf/SP/deputado-federal`, then o histograma de tamanhos de fonte e o `scrollHeight` são idênticos aos medidos antes da mudança (base de 04/10).
- Given 960 px, when se mede o corpo, then os tamanhos de fonte são os do kit (`--text-xs` = 11 px, `--text-md` = 15 px) e a coluna de painéis mede 400 px.
- Given 1920 px em `/uf/SP/deputado-federal`, when se mede o texto de dado, then nenhum está abaixo de 14 px, e a distância entre o nome e o voto de uma linha é menor que 550 px (era 1.150 px) e o tamanho do voto é maior que o do nome.
- Given `/uf/SP/deputado-federal`, when a janela mede 1920 px, then `[data-testid="uf-agremiacoes"]` tem 3 colunas; a 1280 px, 2; e em ambas a ordem das agremiações no DOM é a mesma de 375 px.
- Given 1920 px nas rotas com mapa, when se mede a coluna de painéis, then ela mede ~691 px; a 1280 px, ~461 px; nunca acima de 820 px.
- Given `tests/e2e/tokens.spec.ts`, when roda, then `--container-page` ainda vale 1280 px e o `<main>` de `/` também.
- Given o axe a 1280 px nos dois temas e `deputado-listas` a 375 e 320 px, when rodam, then zero violações e nenhuma rolagem horizontal.
- Given o documento de `/uf/SP/deputado-federal`, when se compara o peso antes e depois **desta frente** (só CSS), then o HTML não ganha bytes por linha.
- Given um bloco `<small>` dentro de uma lista de candidato a 1920 px, when se mede, then seu `font-size` é o de `--text-xs` e não 80% dele.

### Emenda de 04/10 (2) — capa: eleitos por agremiação e cenário projetado nacional

> **Decisão do dono, dia do 1º turno** ([ADR-0063, emenda de 04/10 (2)](../../architecture/adrs/0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md)).
> Revoga **em parte** o § Fora desta spec ("Bancada nacional projetada") e a última frase da Decisão 1 do
> ADR-0063. Nada muda no modelo Python nem no payload do Edge Config: tudo é lido, na hora, dos objetos por
> UF do Blob. O RF-297 (nenhum voto projetado por candidato em página nacional) e o RF-271 (a capa não lê o
> Blob de UF) continuam valendo. Só o Federal; a capa de Estadual/Distrital não muda.
>
> **Numeração.** RF-299 e RF-300 conferidos por grep em `docs/` em 2026-10-04 — nenhum uso anterior
> (o último era RF-298, desta spec; o RF-296 mora na spec 003).

**RF-299 — Lista nacional de eleitos por agremiação, sob demanda, e bancada como última seção da capa**

WHEN o leitor aciona o botão "Ver os eleitos" de uma agremiação do painel "Bancada apurada — Quem fica com as cadeiras" da capa `/deputado-federal`, the system SHALL buscar `GET /deputado-federal/eleitos` — rota **fora de `/api`** (ADR-0065 D3), com `Cache-Control: public, s-maxage=60, stale-while-revalidate=60` no sucesso e `no-store` em 404 (nenhuma UF com dado) e 502 (erro) —, no máximo **uma vez por aba** dentro da janela de 60 s e compartilhando a resposta entre todas as agremiações, and SHALL listar os candidatos dessa agremiação agrupados por UF (sigla e quantos eleitos dela há ali), cada um com nome, partido, voto apurado, % dos válidos da UF e a marca (RF-262, RF-267), em ordem fixa: UF por sigla e, dentro dela, `rank` de apuração (§ 2, § 6).
WHILE o seletor do topo está em "Parcial", the system SHALL listar só as candidaturas com marca de eleito na parcial ou "Eleito (TSE)", sob o cabeçalho "N eleitos na parcial em K estados · eleito na parcial não é resultado oficial".
The system SHALL mostrar avatar (RF-291) em **todo** nome listado — foto quando publicada, senão iniciais —, porque nesta lista todos estão sendo eleitos na base exibida (emenda de 04/10, revisão do dono na tela; a regra "só eleito na parcial/TSE" segue nas listas de UF, que mostram também quem não se elege); SHALL NOT exibir voto projetado por candidato (RF-297); SHALL NOT reordenar nada pela projeção; and SHALL NOT ler o Blob de nenhuma UF na renderização da capa (RF-271) — a leitura acontece só na rota, só sob demanda.
IF a rota falha, responde 404 ou a resposta não chega, THEN the system SHALL manter o painel e os números da bancada intactos e dizer, na própria agremiação, que a lista não está disponível agora, com "tentar de novo"; IF uma UF não pôde ser lida, THEN the system SHALL tratá-la como **sem dado** — dito na tela — e nunca como zero eleitos.
WHILE uma lista está aberta, the system SHALL acompanhar a atualização automática da página (ADR-0074) — a resposta em memória vale 60 s —, sem fechá-la nem tirar o foco.
The system SHALL dispor o painel da bancada como a **última seção de conteúdo** da capa — depois de "Estado a estado" e antes da nota de metodologia —, com o `Camara2027Panel` sozinho na sua linha; o hemiciclo do topo continua desenhando a parcial e o `aria-describedby="bancada-agremiacoes"` dele continua válido.

**Aceitação**:
- Given a capa renderizada no teste, when se conta a leitura de Blob e as requisições à rota, then `readDeputadoUfDetail` não foi chamado nenhuma vez e nenhuma requisição à rota foi feita antes do clique (RF-271 segue).
- Given a capa, when se lê a ordem das seções, then "Estado a estado" vem antes do painel da bancada, que vem antes de `<DeputadoMetodologia>`, e o `Camara2027Panel` não divide linha com o painel.
- Given o leitor abre o PT e depois o PL, when as duas listas abrem, then houve **um** único fetch à rota na aba, os dois blocos usam a mesma resposta, e reacionar o botão dentro de 60 s não refaz a busca.
- Given uma agremiação com 3 eleitos na parcial em 2 UFs (2 em SP, 1 em BA) e o seletor em "Parcial", when abre, then há dois grupos — BA com "1 eleito", SP com "2 eleitos", nesta ordem de sigla —, dentro de cada um os nomes na ordem de `rank`, e o cabeçalho diz "3 eleitos na parcial em 2 estados".
- Given um candidato marcado só na projeção (UF liberada) e o seletor em "Parcial", when a lista renderiza, then ele não aparece.
- Given uma lista com eleito com foto, eleito sem foto e eleito só na projeção (base "Projeção"), when renderiza, then os três têm avatar — foto, iniciais, iniciais.
- Given o botão de abrir, when auditado, then tem `aria-expanded` e `aria-controls`; given o "Recolher" no fim da lista, when acionado, then a lista fecha, `aria-expanded` volta a `false` e o foco vai para o botão de abrir.
- Given a rota respondendo 404 (antes da apuração), when o leitor abre uma agremiação, then ela diz "lista ainda não disponível" com "tentar de novo", e os números da bancada são os de antes.
- Given 26 UFs lidas e 1 que falhou, when a rota responde, then a UF vem em `ufs_sem_dado`, a tela diz quantos estados ficaram fora e nenhuma UF aparece com "0 eleitos".
- Given o módulo da rota, when o teste procura o caminho, then ele não está sob `/api` (o teste falha se movido) e o sucesso leva `s-maxage=60` enquanto 404 e 502 levam `no-store`.
- Given a resposta da rota, when se procura `votos_projetados`, then ele não existe em linha nenhuma.
- Given o `cadeiras` da linha (vindo do payload) diferente da contagem de nomes da lista (vinda do Blob, de outro ciclo), when a agremiação está aberta, then a linha mostra o número do payload, a lista mostra a contagem dos nomes que recebeu, e nenhuma é ajustada para igualar a outra.
- Given a capa `/deputado-estadual`, when renderiza, then não há ilha, botão nem chamada à rota (inalterada).
- Given a capa a 375 px, when o axe audita com uma lista aberta e fechada, then zero violações e nenhuma rolagem horizontal; given o portão de peso, when mede o documento, then o teto da capa **não é subido por esta emenda** — se estourar, o implementador para e leva o número medido ao dono.

**RF-300 — Cenário projetado nacional, misto e rotulado**

WHILE o seletor do topo está em "Projeção" e a projeção de Deputado está ligada (RF-265), the system SHALL mostrar, em cada agremiação do painel da bancada da capa, o **cenário projetado nacional**: a soma, sobre as UFs lidas, das cadeiras projetadas (RF-263) nas UFs com projeção **liberada** (RF-264) e das cadeiras da parcial nas demais; and SHALL acompanhar o número, no mesmo elemento, do rótulo "projeção em X de 27 estados; nos outros Y, a parcial" — X e Y derivados dos dados, nunca literais —, acrescido de "Z sem dado agora, fora da conta" quando Z > 0, and de "projeção · não oficial" e "pontual" (RF-266; sem faixa, como na emenda de 29/09 do ADR-0063).
WHEN o leitor escolhe "Projeção" na capa, the system SHALL buscar a mesma rota do RF-299, compartilhando a resposta e a regra de uma busca por aba — o cenário não depende de o leitor abrir uma agremiação.
The system SHALL manter visível, ao lado do cenário e com o nome dela, a cadeira da parcial da agremiação (ADR-0063, Decisão 5 — o número da projeção nunca substitui o da parcial; precedente: RF-180, spec 003), and SHALL desenhar a barra de segmentos do painel com o cenário sob o mesmo rótulo.
WHEN o leitor abre uma agremiação nesse modo, the system SHALL listar, por UF, os candidatos eleitos na projeção das UFs liberadas, com "eleito na projeção · não oficial", e os eleitos na parcial das UFs travadas, sob o subtítulo "parcial — projeção ainda travada neste estado", sob o cabeçalho "N no cenário projetado · projeção em X de 27 estados; nos outros Y, a parcial"; "Eleito (TSE)" tem precedência sobre as duas marcas (RF-267). Cada nome diz de onde veio.
IF o interruptor está desligado, THEN the system SHALL NOT mostrar número, nome nem selo de projeção na capa — o número da linha é o da parcial e a tela diz "A projeção de deputados está desligada agora — mostrando a parcial." —; a rota SHALL omitir a projeção na própria resposta, and a página, que lê o interruptor a cada renderização (RF-265), SHALL entregar o estado à ilha, que SHALL ignorar qualquer campo de projeção da resposta quando a página diz "desligada" (dois pontos de leitura, ADR-0063 Decisão 4).
IF nenhuma UF está com a projeção liberada (X = 0), THEN the system SHALL NOT chamar a parcial de "cenário projetado": diz que nenhum estado tem projeção liberada ainda e mostra a parcial.
IF a busca ainda não terminou ou falhou, THEN the system SHALL manter a parcial com um aviso curto — nunca um zero.
WHERE uma agremiação tem cadeira no cenário e nenhuma linha no painel (zero cadeiras na parcial), the system SHALL acrescentá-la ao fim da lista, com a parcial em zero e o rótulo do cenário.
The system SHALL manter a ordem das agremiações e das linhas a da parcial (ADR-0063 Decisão 5, ADR-0051); SHALL manter o hemiciclo do topo na parcial (ADR-0049); SHALL NOT exibir voto projetado por candidato (RF-297); and SHALL NOT alterar o payload nacional nem o modelo.

**Aceitação**:
- Given uma agremiação com parcial 3 na UF A (liberada, 5 cadeiras projetadas) e parcial 4 na UF B (travada), e nenhuma cadeira nas demais UFs, when a capa está em "Projeção", then o cenário da linha é 9 e a parcial 7 continua visível, com o nome dela, ao lado.
- Given 19 UFs liberadas e 8 travadas, when o rótulo renderiza, then diz "projeção em 19 de 27 estados; nos outros 8, a parcial"; o teste repete com 3 liberadas e 24 travadas para pegar um literal escrito à mão, e o "27" vem da lista fechada de UFs, não do JSX (design 017 D8).
- Given uma UF travada cujo objeto traz `cadeiras_projetadas`, when o cenário soma, then essa UF conta a **parcial** — só `projecaoVisivel` faz a projeção contar.
- Given 1 UF cujo Blob falhou, when o cenário soma, then ela fica fora da soma, o rótulo diz "1 sem dado agora, fora da conta" e nada é somado como "0 cadeiras" em silêncio.
- Given o interruptor desligado e o seletor em "Projeção", when a capa renderiza, then nenhum número, nome ou selo de projeção aparece, o número da linha é o da parcial e a frase de desligada está na tela; given a mesma situação com a resposta da rota ainda trazendo projeção (cache do CDN), when a ilha a recebe, then a ignora e nada de projeção aparece.
- Given o seletor em "Parcial", when a capa renderiza, then o cenário, o rótulo e a versão da barra estão fora do DOM visível e da árvore de acessibilidade (cascata `[data-view-only]`, RF-180).
- Given nenhuma UF liberada, when a capa está em "Projeção", then não há a expressão "cenário projetado" aplicada a um número que é só a parcial, e a tela diz que nenhum estado tem projeção liberada.
- Given uma agremiação aberta em "Projeção" com a UF A liberada e a UF B travada, when a lista renderiza, then os nomes de A saem com "eleito na projeção · não oficial", os de B com "parcial — projeção ainda travada neste estado", e um nome com "Eleito (TSE)" mostra só essa marca.
- Given a capa em "Parcial" e em "Projeção", when se compara a ordem das linhas no DOM, then é a mesma — inclusive com uma agremiação cujo cenário é maior que o da linha de cima.
- Given o hemiciclo do topo, when o seletor está em "Projeção", then ele continua desenhando a parcial.
- Given a resposta da rota, o HTML e o payload RSC da capa, when se procura `votos_projetados`, then ele não existe.
- Given a capa em "Projeção", when o texto fora do bloco de metodologia é lido, then toda ocorrência de "projeção"/"projetad" está no mesmo elemento que "não oficial" (RF-266).
- Given `<DeputadoMetodologia>` da capa, when renderiza, then diz que o cenário nacional soma projeção nas UFs liberadas e parcial nas demais, que é pontual e sem faixa e que não substitui a parcial (§ 8).
- Given o leitor escolhe "Projeção" sem abrir nenhuma agremiação, when a capa reage, then há **um** fetch à rota; given que depois ele abre uma agremiação dentro de 60 s, then não há segundo fetch.
- Given o seletor virando de "Parcial" para "Projeção" com a busca ainda em andamento, when a resposta demora, then a linha continua com a parcial e o aviso curto até chegar — sem zero e sem salto de leiaute que esconda o número da parcial.

## Requisitos Não-Funcionais

- **RNF-002 / RNF-003** — LCP e INP da página de SP com ~1.000 linhas: `content-visibility: auto` por
  agremiação, linhas com classes de CSS em vez de estilo inline, tuplas compactas para o componente
  cliente (design § 8.3).
- **RNF-007a** — o componente de lista é o único JS novo acima da dobra.
- **RNF-006 / ADR-0038** — `dado_ts` e `pares_atrasados` passam a ser lidos do objeto da UF.
- **RNF-012** — Blob indisponível: resumo mantido, "detalhe indisponível" (RF-129 inalterado); rota da
  lista indisponível: as 60 linhas ficam e o erro diz "tentar de novo".
- **RNF-022 / RNF-035** — marca vazada (projeção) e cheia (TSE) com contraste de texto e de borda;
  cor nunca é o único sinal.
- **RNF-023 / RNF-024** — listas são `<ol>` de verdade; botões com `aria-expanded`; busca com
  `aria-busy` e região viva.

## Telas

### `/uf/[sigla]/deputado-federal`, nesta ordem

1. `DadoParadoBanner` (inalterado).
2. **Resumo** (`<h1>`), com uma linha nova: o estado da projeção da UF ("projeção liberada · não
   oficial", "projeção a partir de 25% apurado", "projeção indisponível: …").
3. **Votação** (`VotacaoEleitorado`, inalterado).
4. **Mais votados em {UF}** (RF-270).
5. **Cadeiras e candidatos por agremiação** — por agremiação: cabeçalho com cadeiras na parcial [faixa]
   e projetadas [faixa] (se liberada), votos nominais e de legenda, QP; linha de corte (RF-272);
   puxadores (RF-273); lista em três faixas (RF-260, RF-261); uma legenda única das marcas para o
   painel inteiro.
6. **Regras com os números de {UF}** (RF-274).
7. **Conferência**, com texto verdadeiro (RF-269).
8. `DeputadoMetodologia` estendido como o bloco "o que está movendo" (RF-266).
9. Rodapé.

### `/deputado-federal`

Os blocos atuais, mais **Mais votados do país** (RF-271) e **Puxadores** (RF-273), ambos do payload
nacional, e o selo do estado da projeção em cada linha da tabela estado a estado.

*Emenda 04/10 (RF-299, RF-300).* O painel "Bancada apurada — Quem fica com as cadeiras" (`DeputadoBancadaPanel`)
sai do par com o `Camara2027Panel` e passa a ser a **última seção de conteúdo**, depois de "Estado a estado"
e antes da nota de metodologia (`DeputadoMetodologia`); o `Camara2027Panel` fica sozinho na linha. Cada
agremiação do painel ganha o botão "Ver os eleitos" (ilha cliente `BancadaEleitosNacional`, uma por linha)
e, com o seletor em "Projeção", o cenário projetado nacional rotulado ao lado da parcial. O hemiciclo do
topo continua na parcial.

## Open questions

1. **Puxador a partir de 2 × QE** (excedente ≥ 1) — decisão deste design, para que "puxador" seja quem
   de fato leva voto a mais para a legenda. A alternativa é listar a partir de 1 × QE (quem se elegeu
   sozinho), com excedente 0. Muda só a contagem; o contrato é o mesmo. Dono pode trocar.
2. **Mais votados com candidato sub judice.** Incluídos, com o destino escrito — esconder o mais
   votado do estado porque o registro está em juízo seria esconder o fato. Dono pode trocar.
3. **Projeção em UF já totalizada.** Continua calculada (é idêntica à parcial pelo G1) e a precedência
   do TSE a esconde na tela. Alternativa: publicar `indisponivel` com motivo próprio. Sem efeito
   visível; decidido pela simplicidade.
4. **Par de zona ausente da tabela `zonas`** (AP 0014 no simulado). Esta spec só fecha a trava e mostra
   o tamanho da falta; o conserto é da ingestão e foi escalado ao dono. Se a produção de 04/10 tiver o
   mesmo buraco, a projeção daquela UF fica indisponível a noite inteira — por construção.
5. **`snapshots.pct_apurado = s.psa`** vale para todos os cargos. Esta spec deixa de usá-lo no cargo 6;
   se outro cargo usa `max(pct_apurado)` do mesmo jeito, é outra investigação.
6. **UF já totalizada no rótulo do cenário (RF-300).** Uma UF com totalização final e projeção liberada
   conta `cadeiras_projetadas`, idêntica à parcial pelo G1 (questão 3); o RF-300 só manda que os **nomes**
   dela saiam "Eleito (TSE)". Em qual balde do rótulo "projeção em X de 27 estados; nos outros Y, a
   parcial" ela entra (X, porque o objeto está liberado, ou Y, porque o número é oficial) **não está
   decidido**; o número do cenário é o mesmo nos dois casos. Dono pode decidir; não bloqueia.

## Emendas a outras specs

- **Spec 017** — o design D9 ("o número central é voto apurado; a tela não pode chamar isso de
  projeção") e a "suplência nominal" em **Fora** ficam superados por esta spec e pelo ADR-0063. Os testes
  (m5), (t5), (t) e (c3) de `tests/unit/pages/deputado-federal.test.tsx` são reescritos; o (m6)
  ("não existe barra 'Modelo x%'") fica como está. Registro em
  [017 § Emendas](../017-deputado-federal/spec.md#emendas-por-specs-posteriores).
- **Spec 011** — `/sobre-o-modelo` explica a projeção de deputado dentro da seção 5 ("Cadeiras"),
  sem `<h2>` novo. Registro em [011 § Emendas](../011-sobre-o-modelo/spec.md#emendas-por-specs-posteriores).
  *Emenda 04/10:* a mesma seção, e o `<DeputadoMetodologia>` da capa, passam a explicar o cenário nacional
  misto (RF-300, constituição § 8). Registro em 011 § Emendas **pendente**.
- **Spec 027** — o § Fora "Bancada nacional projetada das assembleias" **continua valendo**: a emenda de
  04/10 (RF-299, RF-300) é só do Deputado Federal. Estendê-la às assembleias exige decisão própria (ADR-0066,
  ponto em aberto "Soma nacional na capa").

## Cross-refs

- [Design 026](./design.md) — o contrato de dados, ordem e desempate, marcas, trava, telas, peso
- [Tasks 026](./tasks.md) — frentes T/P/S/U, donos, ondas e a lista de mutações
- [Spec 017](../017-deputado-federal/spec.md) e [design 017](../017-deputado-federal/design.md) — a base
- [ADR-0027](../../architecture/adrs/0027-conversao-votos-em-cadeiras-deputado-federal.md) — o método de cadeiras
- [ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md) e
  [ADR-0023](../../architecture/adrs/0023-pos-estratificacao-por-porte-de-zona.md) — a extrapolação por zona
- [ADR-0063, emenda de 04/10 (2)](../../architecture/adrs/0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) —
  o cenário nacional misto rotulado (RF-299, RF-300); [ADR-0051](../../architecture/adrs/0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md) —
  por que o cenário não reordena
- [ADR-0053](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md) — o destino no majoritário
- [ADR-0017](../../architecture/adrs/0017-transparencia-total-3-camadas.md) e
  [ADR-0034](../../architecture/adrs/0034-resultpanel-colapso-visual-corte-fora-do-kit.md) — colapso sem remover nó
- `tests/fixtures/tse/2026-sim/dep/README.md` — os fatos medidos no simulado de 28/09
- `tests/fixtures/contrato/README.md` — as fixtures de contrato v2
