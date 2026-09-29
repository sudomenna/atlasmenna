---
id: 026-deputado-listas-projecao
title: Deputado Federal — listas por agremiação, projeção com trava, extras e três correções
status: implementing
priority: M
personas: [P1, P2, P3]
screens: [T-11, T-12]
requirements: [RF-260, RF-261, RF-262, RF-263, RF-264, RF-265, RF-266, RF-267, RF-268, RF-269, RF-270, RF-271, RF-272, RF-273, RF-274, RF-275, RF-276, RF-277]
depends_on: [017-deputado-federal, 018-identidade-candidatura]
amends: [017-deputado-federal, 011-sobre-o-modelo]
apis: [GET /uf/[sigla]/deputado-federal/lista]
components: [DeputadoListaAgremiacao, MarcaDeputado, DeputadoMaisVotados, DeputadoPuxadores, DeputadoRegras, DeputadoConferencia, DeputadoMetodologia, CandidateListCollapse, VotacaoEleitorado]
nfr: [RNF-002, RNF-003, RNF-006, RNF-007a, RNF-012, RNF-022, RNF-023, RNF-024, RNF-035]
# ADRs novos desta spec, a numerar pelo orquestrador (depois da 0062):
#   ADR-0063 — Projeção de deputado com trava de 25% e interruptor no Edge Config
#   ADR-0064 — Destino do voto no proporcional
#   ADR-0065 — Listas de candidaturas proporcionais em três faixas
adrs: [0001, 0005, 0017, 0021, 0023, 0026, 0027, 0034, 0036, 0038, 0049, 0053, 0063, 0064, 0065]
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
- As três marcas, com precedência do resultado oficial.
- Projeção de votos e de cadeiras por UF, zona a zona, com trava automática e interruptor sem deploy.
- Mais votados do estado e do país, linha de corte, puxadores, regras com os números do estado.
- Três correções: Conferência de verdade; `dvt` no cálculo de cadeiras; % apurado da UF.
- Contrato v2 aditivo do payload (objetos v1 continuam renderizando) e portões e2e com o Blob servido.

### Fora

- **Bancada nacional projetada.** A capa ganha só o selo de estado da projeção por UF; somar
  projeções de UFs liberadas com parciais de UFs aguardando produziria um número sem nome.
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

**Aceitação**:
- Given uma agremiação de SP com 71 candidatos, when a página carrega, then as linhas de rank 1 a 60
  estão no documento, 20 visíveis, e **nenhuma** requisição à rota da lista foi feita.
- Given o leitor aciona "ver mais", when a faixa abre, then as linhas 21–60 ficam visíveis e o botão
  passa a `aria-expanded="true"`.
- Given o leitor aciona "mostrar todos", when a busca roda, then a lista tem `aria-busy="true"`
  durante, uma região viva anuncia quantos candidatos chegaram, o foco vai para a primeira linha nova
  (rank 61) e um segundo acionamento **não** refaz a requisição.
- Given a rota responde erro, when a busca falha, then aparece a mensagem com "tentar de novo" e as
  60 linhas continuam na tela.
- Given uma agremiação com até 20 candidatos, when renderiza, then nenhum botão aparece; com até 60,
  só o "ver mais".
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

## Emendas a outras specs

- **Spec 017** — o design D9 ("o número central é voto apurado; a tela não pode chamar isso de
  projeção") e a "suplência nominal" em **Fora** ficam superados por esta spec e pelo ADR-0063. Os testes
  (m5), (t5), (t) e (c3) de `tests/unit/pages/deputado-federal.test.tsx` são reescritos; o (m6)
  ("não existe barra 'Modelo x%'") fica como está. Registro em
  [017 § Emendas](../017-deputado-federal/spec.md#emendas-por-specs-posteriores).
- **Spec 011** — `/sobre-o-modelo` explica a projeção de deputado dentro da seção 5 ("Cadeiras"),
  sem `<h2>` novo. Registro em [011 § Emendas](../011-sobre-o-modelo/spec.md#emendas-por-specs-posteriores).

## Cross-refs

- [Design 026](./design.md) — o contrato de dados, ordem e desempate, marcas, trava, telas, peso
- [Tasks 026](./tasks.md) — frentes T/P/S/U, donos, ondas e a lista de mutações
- [Spec 017](../017-deputado-federal/spec.md) e [design 017](../017-deputado-federal/design.md) — a base
- [ADR-0027](../../architecture/adrs/0027-conversao-votos-em-cadeiras-deputado-federal.md) — o método de cadeiras
- [ADR-0021](../../architecture/adrs/0021-extrapolacao-do-apurado-sem-2022.md) e
  [ADR-0023](../../architecture/adrs/0023-pos-estratificacao-por-porte-de-zona.md) — a extrapolação por zona
- [ADR-0053](../../architecture/adrs/0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md) — o destino no majoritário
- [ADR-0017](../../architecture/adrs/0017-transparencia-total-3-camadas.md) e
  [ADR-0034](../../architecture/adrs/0034-resultpanel-colapso-visual-corte-fora-do-kit.md) — colapso sem remover nó
- `tests/fixtures/tse/2026-sim/dep/README.md` — os fatos medidos no simulado de 28/09
- `tests/fixtures/contrato/README.md` — as fixtures de contrato v2
