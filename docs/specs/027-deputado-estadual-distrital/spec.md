---
id: 027-deputado-estadual-distrital
title: Deputado Estadual e Distrital — as 27 casas legislativas, pelo resumo do estado e, na Fase 2, zona a zona com projeção
status: implementing
priority: M
personas: [P1, P2, P3]
# T-17 e T-18 são telas novas (T-13..T-16 já existem — specs 018 e 019); T-11 e T-12 (spec 017)
# são emendadas pelo seletor da casa e pela aba "Deputados" (RF-283).
screens: [T-17, T-18, T-11, T-12]
requirements: [RF-278, RF-279, RF-280, RF-281, RF-282, RF-283, RF-284, RF-285, RF-286, RF-287, RF-288, RF-289, RF-290]
depends_on: [017-deputado-federal, 026-deputado-listas-projecao, 018-identidade-candidatura]
amends: [017-deputado-federal, 018-identidade-candidatura, 011-sobre-o-modelo]
apis: [GET /uf/[sigla]/deputado-estadual/lista, GET /uf/DF/deputado-distrital/lista, GET /api/ingest/deputado-estadual, GET /api/ingest/deputado-distrital, GET /api/ingest/deputado-estadual/[fatia]]
components: [CargoTabs, DeputadoCasaSeletor, DeputadoBancadaPanel, UfBandeirasGrid, DeputadoListaAgremiacao, MarcaDeputado, DeputadoMaisVotados, DeputadoPuxadores, DeputadoRegras, DeputadoConferencia, DeputadoMetodologia, VotacaoEleitorado]
nfr: [RNF-002, RNF-003, RNF-006, RNF-007a, RNF-012, RNF-019, RNF-022, RNF-023, RNF-024, RNF-035]
# ADRs novos desta spec, escritos em paralelo pelo adr-author (citados sem link até existirem):
#   ADR-0066 — Deputado Estadual e Distrital como cargos proporcionais (nomes, UFs por cargo,
#              totais fixos, interruptor único das assembleias)
#   ADR-0067 — Orçamento de requisições com as assembleias (Fase 1 em resumo a 1 rps; Fase 2 com o
#              cargo 7 intercalado na faixa de 5 rps do 6, volta de 60 min, pior caso 81); emenda o ADR-0036
adrs: [0001, 0005, 0012, 0021, 0023, 0026, 0027, 0036, 0038, 0039, 0044, 0049, 0063, 0064, 0065, 0066, 0067]
ship_blocked_on: [ADR-0066 e ADR-0067 aceitos, EA20 real de cargo 7 e 8 (Passo 0) ou primeiro ciclo vigiado em 04/10, portões e2e das três telas com o Blob servido, decisão do dono Fase 1 × Fase 2 (sex 02/10 18h), G2 das assembleias reportado ao dono antes de ligar interruptor-projecao-est]
opens_after: 2026-09-29
---

# Spec 027 — Deputado Estadual e Distrital

**Rotas novas**: `/deputado-estadual` (T-17, capa das 27 casas), `/uf/[sigla]/deputado-estadual`
(T-18, 26 UFs) e `/uf/DF/deputado-distrital` (T-18, DF).
**Rotas novas de dado**: `GET /uf/[sigla]/deputado-estadual/lista` e `GET /uf/DF/deputado-distrital/lista` (esta desde a emenda de 03/10 ao ADR-0065) — fora de `/api` pelo mesmo motivo da
rota do federal (BotID em `/api/*`, ADR-0065 D3).
**Rotas emendadas**: `/deputado-federal` (T-11) e `/uf/[sigla]/deputado-federal` (T-12) — seletor da casa
e aba "Deputados" (RF-283).
**Cargos TSE**: 7 (Deputado Estadual) e 8 (Deputado Distrital) · turno único · proporcionais · eleição
estadual `21272`.

> **Numeração.** RF-278..RF-290 conferidos por grep em 2026-09-29 — nenhum uso anterior no repositório
> (a spec 026 reservou até RF-277). T-17 e T-18 conferidos por grep (T-01..T-16 em uso). Os dois ADRs
> novos são citados como **ADR-0066** e **ADR-0067** (títulos no frontmatter), sem link até o
> `adr-author` terminar; o `spec-syncer` põe os links na barreira.

## Pedido do dono (2026-09-29)

Apurar Deputado Estadual reaproveitando o que foi feito para Deputado Federal (specs 017 e 026). Cada
estado tem sua casa — 26 Assembleias Legislativas — e o DF tem a Câmara Legislativa, com Deputado
**Distrital** (cargo separado no TSE). Até esta spec os cargos 7/8 eram "fora do escopo do produto"
(spec 017 § Fora, spec 018 § Fora e RF-147, spec 026 § Fora, `lib/config/cargos.ts:38-40`); isto é
mudança de escopo e é tratada como tal.

**Decisões do dono (29/09), não reabrir:**

1. No ar para a noite de **04/10**.
2. **DF incluído** (cargo 8, 24 distritais).
3. **Com projeção, como no federal.** O custo foi apresentado e aceito: para caber no limite de
   requisições do TSE, federal e estadual passam a atualizar **a cada 60 min** em vez de 30 (só se a
   Fase 2 subir — RF-286).
4. **Menu**: continuam quatro abas; a de deputado vira **"Deputados"**, com seletor **Federal ·
   Estadual** dentro das páginas.
5. **Capa nacional**: grade das 27 casas + mais votados do país + **soma por partido no Brasil**
   (1.059 cadeiras), com o aviso de que é a soma de 27 casas separadas, sem desenho de plenário.

## Status

`implementing` desde 2026-09-29. Duas fases, com degradação pré-acordada:

- **Fase 1 — assembleias pelo resumo do estado** (qua 30/09 → qui 01/10). Um arquivo-resumo por casa
  por rodada (26 + 1). Entrega a parcial com listas, marcas, mais votados, puxadores, regras,
  Conferência e selo do TSE. **Não mexe no ritmo do federal.**
- **Fase 2 — zonas e projeção** (qui 01/10 → sex 02/10 manhã). Cargo 7 zona a zona em fatias
  intercaladas com as do 6 (volta de 60 min para os dois), cargo 8 zona a zona, projeção calculada e
  publicada **desligada** atrás de `interruptor-projecao-est`.

**Degradação pré-acordada** (decidida na sexta 02/10, 18h): Fase 2 verde → sobe tudo, projeção das
assembleias desligada até o dono ligar · Fase 2 não verde → sobe só a Fase 1 e o federal continua em
30 min · Fase 1 não verde → nada sobe; o estadual entra depois de 05/10 com os arquivos finais do TSE
(que continuam no ar). Nenhum RF da Fase 1 depende da Fase 2 para ser verdadeiro.

## Objetivo

Deixar o leitor ver, na mesma noite e com a mesma honestidade do federal, quem está entrando em cada
uma das 27 casas legislativas estaduais — e deixar claro que a soma nacional é soma de casas
separadas, não um plenário.

## Escopo

### Dentro

- Cargos 7 e 8 como cargos cobertos: ingestão só das UFs em que a casa existe, nomes próprios de chave,
  Blob, rota e interruptor, totais fixos das casas.
- Página de cada casa com os blocos da spec 026; redirecionamento `/uf/DF/deputado-estadual` →
  `/uf/DF/deputado-distrital`.
- Capa `/deputado-estadual`: grade das 27 casas, mais votados do país, puxadores, soma por partido ou
  federação sobre 1.059.
- Aba "Deputados" e seletor Federal · Estadual (Federal · Distrital no DF) nas quatro telas de deputado.
- Fase 1 (resumo, 5 min) e, se o dono decidir, Fase 2 (zona, fatias intercaladas, 60 min).
- Projeção das assembleias com a trava de 25% da 026, atrás de interruptor próprio, publicada desligada.
- Candidaturas 7/8 no cadastro e em `/candidatos`.
- Portões e2e das três telas novas; golden de 2022 das assembleias.

### Fora

- **Hemiciclo nacional das assembleias.** Não existe plenário de 1.059 cadeiras; desenhar um sugeriria
  que existe (decisão 5 do dono).
- **Bancada nacional projetada das assembleias** — pelo mesmo motivo da spec 026 § Fora: somar
  projeções de casas liberadas com parciais de casas aguardando produz número sem nome.
- **Faixa de cadeiras somada entre casas.** O intervalo de uma casa não se soma ao de outra; a capa não
  mostra faixa nenhuma (design § 8.3).
- **Etiquetas editoriais** (specs 024/025) para candidaturas estaduais e distritais — o catálogo
  publicado e a revisão nominal que a constituição § 2 exige (condições a–h) foram feitos para
  Governador, Senador e Deputado Federal; estender exige o mesmo processo, que não cabe até 04/10.
- **Série da evolução da apuração** (spec 020) para 7/8 — o cargo 6 também não tem
  (`CARGOS_COM_SERIE_PERSISTIDA = {1, 3, 5}`).
- **Gravar a projeção em `projections`** — mesma razão do ADR-0063 D6.
- **Conselheiro Distrital** (eleição municipal `21274`, `ele-c.json`).

## Vocabulário

| Termo | Significa |
|---|---|
| **casa** | uma Assembleia Legislativa (26) ou a Câmara Legislativa do DF (1) |
| **resumo** | o EA20 de nível UF da casa (`<uf>-c0007-e021272-u.json`, `df-c0008-e021272-u.json`) — granularidade `uf` |
| **zona** | o par município×zona (ADR-0036), como no federal |
| **faixa de 5 rps** | a cota de requisições que o cargo 6 usa hoje e que, na Fase 2, os cargos 6 e 7 dividem sem nunca rodarem juntos (ADR-0067) |
| **volta** | o tempo para todas as fatias de um cargo rodarem uma vez: 30 min hoje (6), 60 min na Fase 2 (6 e 7) |
| **parcial**, **projeção**, **TSE**, **via**, **destino** | como na spec 026 § Vocabulário |

## Tamanho das casas (conferência, não denominador)

CF art. 27: o triplo da bancada federal até 36; acima disso, +1 por deputado federal além de 12. O DF
segue a mesma regra (CF art. 32 § 3º). A fonte do denominador **por UF** continua sendo `carg[].nv`
do EA20 (RF-124); a tabela abaixo é o que a soma das vagas publicadas tem de fechar, como o 513 do
federal.

| Casas | Cadeiras |
|---|---|
| SP 94 · MG 77 · RJ 70 · BA 63 · RS 55 · PR 54 · PE 49 · CE 46 · MA 42 · GO 41 · PA 41 · SC 40 · PB 36 · ES 30 · PI 30 · AL 27 | 795 |
| AC · AM · AP · MS · MT · RN · RO · RR · SE · TO — 24 cada | 240 |
| **26 Assembleias (cargo 7)** | **1.035** |
| **Câmara Legislativa do DF (cargo 8)** | **24** |
| **Soma das 27 casas (capa)** | **1.059** |

Cada agremiação registra até 100% dos lugares mais 1 (Lei 9.504 art. 10, redação da Lei 14.211/2021):
SP admite 95 candidatos por agremiação, MG 78, RJ 71, BA 64 — são as quatro casas com a terceira faixa
da lista (posições 61+). Nenhuma outra casa passa de 60; o DF, de 25.

## Requisitos Funcionais

### Cobertura e ingestão

**RF-278 — Cargos 7 e 8 cobertos, cada um só nas UFs em que a casa existe**

WHEN o sistema enumera os alvos de ingestão de um cargo, the system SHALL tratar Deputado Estadual
(cargo 7) e Deputado Distrital (cargo 8) como cargos cobertos, proporcionais, da eleição estadual
(`21272`, ADR-0044), and SHALL enumerar alvos **somente** das UFs em que a casa existe — cargo 7 nas 26
UFs com Assembleia (todas menos o DF), cargo 8 só no DF — em **todo** construtor de alvos (produção e
preview; UF e zona; e o agregado de UF que o modo zona acrescenta), lendo a lista de UFs da tabela
`CARGOS`; it SHALL NOT requisitar ao TSE nenhuma URL de cargo 7 no DF nem de cargo 8 fora do DF
(constituição § 1: URL que não existe é 404, e 404 também pode bloquear o IP).

**Aceitação**:
- Given o cargo 8 em granularidade `uf`, when `listIngestTargets(production, {cargo: 8})` roda, then
  devolve **exatamente um** alvo, o resumo do DF (`df-c0008-e021272-u.json`).
- Given o cargo 7 em `uf`, when roda, then devolve 26 alvos e **nenhum** com `uf = "DF"`.
- Given o cargo 8 em `zona` (Fase 2), when roda, then devolve só pares do DF (19 no `mun-e021270-cm.json`
  do simulado de 24/09, município 97012) mais o agregado do DF — nenhum alvo de outra UF.
- Given o cargo 7 em `zona`, when as 6 fatias são unidas, then não há par do DF e os agregados somados
  são os 26 das UFs do cargo.
- Given `cargoInfo(7).eleicao` e `cargoInfo(8).eleicao`, then ambos `"estadual"` — a URL sai sob
  `21272`, nunca `21270`.
- Given qualquer construtor de alvos, when o código é lido, then não há `if (cargo === 8)` nem
  `?? TODAS_UFS`: a lista vem de `ufsDoCargo(cd)`, sem default, e o teste injeta 7 e 8.
  ⚠️ O `ele-c.json` do simulado lista os cargos 7 e 8 numa abrangência única `br` (medido em 29/09) e
  não diz em que UFs cada um existe; a regra é constitucional e fica em tabela, travada por teste.
- Given `parseCargoSegment("deputado-estadual")`, `("deputado-distrital")` e `("7")`, then 7, 8 e 7.

**RF-285 — Fase 1: assembleias pelo resumo do estado, a cada 5 min**

WHILE a Fase 1 vigora (granularidade `uf` configurada para os cargos 7 e 8), the system SHALL buscar
por rodada só o resumo de cada casa (26 arquivos do cargo 7 e 1 do cargo 8), a 1 rps por cargo, a cada
5 min; SHALL publicar a parcial com listas, marcas, mais votados, corte, puxadores, regras, Conferência
e selo do TSE; SHALL NOT calcular nem publicar projeção de cargo em modo resumo, qualquer que seja o
interruptor; SHALL NOT alterar cadência, fatias nem rps do cargo 6; AND WHERE a Conferência roda em
modo resumo, the system SHALL declarar como **não comparadas** as comparações que exigem zonas
(`eleitorado` e `votos_validos`), nunca como conferidas.

**Aceitação**:
- Given a tabela da Fase 1, when `piorCasoAgregadoRps()` roda, then **82** (25 + 25 + 25 + 5 + 1 + 1),
  em teste fixo que substitui o 80 de `tests/unit/config/cargos.test.ts:85`.
- Given `vercel.ts` da Fase 1, then os crons do 7 e do 8 disparam a cada 5 min e as seis entradas das
  fatias do 6 continuam idênticas às de hoje (volta de 30 min).
- Given `CADENCIA_SEGUNDOS` em TS (`lib/config/dado-freshness.ts`) e em Python (`api/model/cargos.py`),
  then 300 para 7 e 8, e o payload publica `atualizacao_min = 5` — a tela diz 5 sem literal (RF-128).
- Given modo resumo com agregado de `and ≠ "n"`, when a Conferência roda, then `comparou` não contém
  `eleitorado` nem `votos_validos`, o objeto da UF diz `granularidade: "uf"`, e a tela escreve as duas
  como "não comparado — este cargo é lido pelo resumo do estado".
- Given modo resumo e a comparação `algoritmo` feita sem divergência, when renderiza, then `confere`
  pode aparecer, e a frase nomeia só o que foi comparado (quociente, cadeiras) e o horário do boletim.
- Given modo resumo e `interruptor-projecao-est` ligada (erro de operação), when o ciclo roda, then
  nenhuma projeção é calculada e o objeto da UF sai **sem** `projecao`; a tela não mostra a linha de
  estado da projeção nem o bloco "o que está movendo".
- Given modo resumo, when o % apurado é calculado, then é `e.esi / e.te` do próprio resumo — o RF-275
  com uma linha só.

**RF-286 — Fase 2: zonas, fatias intercaladas, volta de 60 min**

WHERE a Fase 2 é ligada (decisão do dono na sexta 02/10), the system SHALL ingerir o cargo 7 por zona
em 6 fatias **intercaladas** com as 6 do cargo 6 dentro da mesma faixa de 5 rps — as do 6 nos minutos
0/10/20/30/40/50, as do 7 nos 5/15/25/35/45/55, cada fatia uma vez por hora e volta completa de 60 min
para os dois —; SHALL ingerir o cargo 8 por zona (os pares do DF mais o agregado) a 1 rps a cada 5 min,
sem fatia; SHALL declarar cadência de 3.600 s para 6 e 7 em todo ponto que deriva frescor (TS, Python,
`atualizacao_min`, vigias, textos da tela, runbook e roteiro da véspera); and SHALL manter o pior caso
agregado em **81 rps**.

**Aceitação**:
- Given o `vercel.ts` da Fase 2, when um teste percorre os 60 minutos de cada janela, then em nenhum
  minuto dispara mais de uma fatia da faixa (6 ou 7), e cada fatia de cada cargo dispara exatamente uma
  vez por hora.
- Given a tabela da Fase 2, when `piorCasoAgregadoRps()` roda, then **81** — a faixa compartilhada conta
  uma vez (25 + 25 + 25 + 5 + 1).
- Given as 6 fatias do cargo 7 unidas, then cobrem exatamente os pares das 26 UFs mais os 26 agregados,
  sem repetição e sem DF (mesma garantia de `sliceTargets`).
- Given `/api/ingest/deputado-estadual/<n>`, then aceita 1..6; `/api/ingest/deputado-distrital/1`
  responde 400 (8 não é fatiável).
- Given a fatia 1 do 6 em voo, when a fatia 1 do 7 dispara, then roda — a trava anti-sobreposição é
  por `(cargo, fatia)` (ADR-0036).
- Given o payload do cargo 6 na Fase 2, then `atualizacao_min = 60`, e a tela federal diz "a cada 60
  min" sem literal (RF-128 da spec 017).
- Given o banner de dado parado e o vigia, then o limiar usa 3.600 s para 6 e 7 — nenhum alarme em
  ciclo saudável.
- Given a Fase 2 não ligada, then nada deste RF vale e o 6 continua em 30 min (degradação).

### Dados e nomes

**RF-279 — Chaves e caminhos por cargo; gravar o estadual nunca toca o federal**

WHEN o ciclo de um cargo proporcional lê ou grava, the system SHALL usar as chaves e caminhos do
próprio cargo — slug, token, chave nacional, prefixo de Blob, rota da lista e interruptor, todos
derivados da tabela `CARGOS` (design § 2) —, and SHALL NOT escrever, sobrescrever nem apagar objeto de
outro cargo: nenhum ciclo de 7 ou 8 escreve em `projection-current-dep-t1`, `deputado/uf/*` ou
`deputado/uf-lista/*`, e o federal fica **intocado** (mesmas chaves, mesmos caminhos). IF o corpo de
escrita traz em `payloads_uf` uma UF que não pertence ao cargo, THEN the system SHALL descartá-la com log
`error` e alerta, e gravar as demais.

**Aceitação**:
- Given um POST de cargo 7 com `payloads_uf.SP`, when o writer grava contra o Blob simulado do teste,
  then há `put` em `deputado-estadual/uf/SP.json` e **nenhum** em `deputado/uf/SP.json`, cujo conteúdo
  prévio fica idêntico byte a byte.
- Given um POST de cargo 8 com `payloads_uf.DF`, then `deputado-distrital/uf/DF.json`, e nenhuma
  `uf-lista` (o DF tem até 25 candidatos por agremiação).
- Given um POST de cargo 7 com `payloads_uf.DF` ou de cargo 8 com `payloads_uf.SP`, when a rota
  processa, then a UF de fora não é gravada, há log `error` e alerta, e as demais UFs são gravadas.
- Given `app/api/internal/edge-write/route.ts` com `cargo: 7` ou `8`, then aceita (hoje
  `z.literal(6)` responde 400); com `cargo: 9`, 400.
- Given `cargoToken(7) = "est"`, `cargoToken(8) = "dis"`, then `cargoFromToken` faz a volta, sem
  colisão com `pres`, `gov`, `sen`, `dep`.
- Given o leitor da chave nacional de um cargo, when lê, then o objeto devolvido tem o `cargo` pedido —
  o tipo é discriminado por `cargo` (`6 | 7 | 8`), e `CargoMajoritario` deriva de `proporcional`, não de
  `Exclude<Cargo, "dep">`.

**RF-280 — Totais fixos das casas; "aguardando" nunca vem das casas presentes**

WHEN o payload nacional de um cargo proporcional é montado, the system SHALL publicar
`bancada.total_cadeiras` como fato fixo do cargo — **1.035** (cargo 7), **24** (cargo 8), **513**
(cargo 6, inalterado) —, e a capa `/deputado-estadual` SHALL usar **1.059** como total da soma; em todos
os casos "aguardando" SHALL ser `total − cadeiras_atribuídas`, and SHALL NOT be derivado da soma dos
`lugares_a_preencher` das UFs presentes no ciclo (a lição do 513: ADR-0049; handoff de 19/09). O
`carg[].nv` de cada UF continua sendo o denominador do quociente (RF-124), e a soma das vagas
publicadas é conferência.

**Aceitação**:
- Given só SP e RR com cadeiras no cargo 7, when o payload sai, then `total_cadeiras = 1035` e a tela
  diz quantas aguardam (1.035 − as atribuídas) — nunca "118 cadeiras em disputa".
- Given as 26 UFs com `nv` publicado e a soma ≠ 1.035 (ou ≠ 24 no DF), when o ciclo roda, then `error`
  e alerta (`conferir_total_de_cadeiras` por cargo), **e** o total publicado passa a ser a soma dos `nv`
  (o dado do TSE rege a distribuição — RF-124): com todas as UFs do cargo presentes, "aguardando" nunca
  fica negativo nem é escondido por `max(0, …)`. Com UF faltando, vale o total fixo. ⚠️ Não é
  hipótese: o simulado de 29/09 publicou `nv = 28` para o DF no cargo 8
  (`tests/fixtures/tse/2026-sim/dep-est/README.md`).
- Given o payload do cargo 7, then `ufs_calculadas + ufs_aguardando = 26`; do cargo 8, `= 1` (hoje o
  tipo diz 27).
- Given a capa com `est` presente e `dis` ausente, when renderiza, then total 1.059, e as 24 do DF estão
  em "aguardando" — nunca total 1.035.

### Telas

**RF-281 — Página da casa**

WHEN o leitor abre `/uf/[sigla]/deputado-estadual` (26 UFs) ou `/uf/DF/deputado-distrital`, the system
SHALL renderizar a página da casa com os blocos da página de UF da spec 026 — resumo com `<h1>` nomeando
a casa (RF-284), Votação, mais votados, cadeiras e candidatos por agremiação (três faixas, marcas, corte,
puxadores), regras com os números da casa, Conferência e metodologia —, lendo **só** o payload, o Blob e
a rota do próprio cargo; AND WHEN o leitor abre `/uf/DF/deputado-estadual`, the system SHALL
redirecionar para `/uf/DF/deputado-distrital`.

**Aceitação**:
- Given `/uf/SP/deputado-estadual` com os leitores simulados contando chamadas por chave e caminho, when
  renderiza, then leu `projection-current-est-t1` e `deputado-estadual/uf/SP.json`, e **nada** do
  federal.
- Given `/uf/DF/deputado-estadual`, when requisitada, then redireciona (308) para
  `/uf/DF/deputado-distrital`.
- Given `/uf/SP/deputado-distrital`, when requisitada, then redireciona (308) para
  `/uf/SP/deputado-estadual` (open question 1).
- Given `/uf/ZZ/deputado-estadual`, then 404.
- Given uma agremiação de SP com 95 candidatos, when a página carrega, then o documento traz os eleitos
  + os 5 seguintes por `rank` (mínimo 10 linhas), todas visíveis e nenhuma oculta no DOM, e "mostrar
  todos (N)" busca `GET /uf/SP/deputado-estadual/lista`, que devolve do primeiro candidato fora do
  documento em diante; a rota responde 404 para sigla fora das 26. O DF tem a sua, em
  `/uf/DF/deputado-distrital/lista`. **Emenda 2026-10-03 (ADR-0065, emenda de 03/10):** substitui o
  "1–60, 20 visíveis" e o "distrital não tem rota de lista".
- Given o leitor abriu a lista 61+ de SP no federal e depois abre a de SP no estadual, na mesma aba,
  when a segunda busca roda, then ela **faz** a requisição — o cache em memória é chaveado por
  `slug:UF`, nunca só por UF.
- Given o bloco de regras, when renderiza, then lugares, QE e pisos vêm do objeto da casa (94 lugares
  em SP), nenhum número da Câmara dos Deputados — o teste injeta o número (design 017 D8).
- Given o Blob da casa indisponível, then o resumo fica e o bloco diz "detalhe indisponível" (RNF-012,
  como o RF-129).
- Given nenhum payload do cargo, then a página diz que aguarda os dados — sem zeros fabricados (três
  estados, decisão de 14/09) — e mostra a grade de candidaturas da casa (T-14, spec 018) quando houver
  cadastro.

**RF-282 — Capa das assembleias `/deputado-estadual`**

WHEN o leitor abre `/deputado-estadual`, the system SHALL mostrar a grade das 27 casas, cada uma com o
link para a sua página (DF → `/uf/DF/deputado-distrital`); os 10 mais votados do país e os puxadores,
unindo `mais_votados`/`puxadores` dos payloads `est` e `dis`; e a soma das cadeiras por partido ou
federação no Brasil sobre **1.059**, no mesmo painel que o aviso de que é a soma de 27 casas separadas;
and SHALL NOT ler Blob de nenhuma UF nem desenhar plenário nacional.

**Aceitação**:
- Given a capa renderizada no teste, then o leitor de Blob de UF (de qualquer cargo) teve **0**
  chamadas e não há `CamaraHemiciclo` no documento.
- Given `est.mais_votados` e `dis.mais_votados`, then a lista é os 10 primeiros da união por
  `(−votos, uf, sqcand)` — sempre a mesma —, e cada % diz "dos válidos de {UF}".
- Given a soma, then é pela **chave nacional estável** da agremiação — partido isolado pelo número do
  partido (`par[0].n`), federação pela composição —, ordenada por `(−cadeiras, sigla, chave)`, com
  "aguardando" = 1.059 − Σ; o aviso "soma de 27 casas separadas" está no mesmo painel. ⚠️ **Nunca** por
  `agr[].n`: é número de registro por cargo×UF (leiaute EA20, `n` "conforme inscrição no Sistema de
  Candidaturas"); medido em 29/09, 21 partidos comuns a RR e AP no cargo 6 e zero com o mesmo `agr.n`.
  O conserto da chave nacional é da spec 026 (29/09) e a 027 o herda.
- Given os dois payloads com cadências diferentes (60 e 5 min na Fase 2), when a capa renderiza, then
  diz a cadência e o horário do dado de cada um — nunca um "atualizado às" único (ADR-0026 item 5,
  constituição § 8).
- Given só `dis` presente, then o DF aparece e as 26 Assembleias estão "aguardando"; sem nenhum dos dois,
  a capa diz que aguarda os dados, com a grade das 27 casas.
- Given faixas de cadeiras nos payloads, then a capa não mostra faixa nenhuma (não se soma intervalo
  entre casas).

**RF-283 — Aba "Deputados" e seletor da casa**

WHEN qualquer página renderiza a barra de cargos, the system SHALL manter quatro abas, com a de
deputado rotulada visivelmente **"Deputados"**, nome acessível começando pelo texto visível (WCAG 2.5.3)
e marcada como atual em todas as telas de deputado; AND WHEN uma tela de deputado renderiza, the system
SHALL mostrar o seletor **"Federal · Estadual"** ("Federal · Distrital" no DF) em links servidos pelo
servidor, com o atual em `aria-current="page"`, levando da capa à outra capa e, na página de UF, à mesma
UF no outro cargo.

**Aceitação**:
- Given 320 px, when a barra renderiza num navegador de verdade, then "Deputados" cabe sem corte nem
  quebra (happy-dom não mede largura).
- Given `/uf/SP/deputado-federal`, then o seletor leva a `/uf/SP/deputado-estadual`; em
  `/uf/DF/deputado-federal`, o rótulo é "Distrital" e leva a `/uf/DF/deputado-distrital`; em
  `/deputado-federal`, leva a `/deputado-estadual`, e vice-versa.
- Given JavaScript desabilitado, then os links funcionam (são `<a href>`).
- Given `/deputado-estadual`, `/uf/SP/deputado-estadual` e `/uf/DF/deputado-distrital`, then a aba
  "Deputados" está marcada como atual e o `<main>` tem `data-trilha="dep"`.

**RF-284 — Nome da casa e vocabulário**

WHEN uma tela, título, metadado ou texto de acessibilidade nomeia a casa de um cargo 7 ou 8, the system
SHALL usar "Assembleia Legislativa de/do/da {nome da UF}" com a preposição certa de cada UF e "Câmara
Legislativa do Distrito Federal" no DF, saídos de uma função só (`lib/utils/casa-legislativa.ts`), and
SHALL dizer "distrito" / "Distrito Federal" onde a tela do federal diz "estado", quando a casa é a CLDF.

**Aceitação**:
- Given SP, RJ, BA, MT, PB e AL, then "de São Paulo", "do Rio de Janeiro", "da Bahia", "de Mato
  Grosso", "da Paraíba", "de Alagoas".
- Given a tabela das 26 UFs, when uma UF falta ou está duplicada, then o teste falha — não há
  preposição padrão.
- Given `/uf/DF/deputado-distrital`, when o texto é varrido, then "Assembleia" e "estado" (como nome da
  unidade) não aparecem.
- Given o `<title>` e a descrição de metadados, then nomeiam a casa, não "Deputado Federal".

### Projeção

**RF-287 — Projeção das assembleias atrás de interruptor próprio, publicada desligada**

WHERE a Fase 2 está no ar e a chave `interruptor-projecao-est` existe, é válida e diz `ligada: true`,
the system SHALL permitir a projeção dos cargos 7 e 8 com o método, a trava de 25% (RF-264, mesma ordem
fixa de motivos) e os rótulos da spec 026; IF a chave falta, está malformada, a leitura falha ou o cargo
está em modo resumo, THEN the system SHALL tratá-la como desligada — no ciclo e no render. A chave SHALL
ser publicada **desligada**; `interruptor-projecao-dep` SHALL NOT afetar 7 e 8, nem
`interruptor-projecao-est` o 6.

**Aceitação**:
- Given `-dep` ligada e `-est` ausente, when os três ciclos rodam, then o 6 tem projeção e 7 e 8 saem
  `indisponivel` / `interruptor`.
- Given `-est` ligada e `-dep` desligada, then o inverso.
- Given o DF com 25,00000% apurado e 2 zonas com boletim, then `liberada`; com 24,99999%, `aguardando` /
  `pct_minimo` (caso **no** limiar).
- Given `pnpm dep:projecao --cargo estadual`, then o script mostra e grava `interruptor-projecao-est`,
  com as mesmas recusas de store e de `--ensaio` do ADR-0063 D4; sem `--cargo`, continua sendo o
  federal.
- Given o G2 das assembleias sem rodar (sem os dados de 2022 do dono), then a chave fica desligada em
  04/10 (degradação).
- Given a projeção liberada numa casa, then toda ocorrência de "projeção" está no mesmo elemento que
  "não oficial" (RF-266).

### Cadastro

**RF-288 — Candidaturas 7 e 8 no cadastro e em `/candidatos`**

WHEN o importador de candidaturas roda (reimportação de 02–03/10), the system SHALL importar, publicar
e fotografar as candidaturas de cargo 7 e 8 pelas regras da spec 018 (recorte do ADR-0039,
publicabilidade que falha fechada, foto no Blob pelo caminho de hoje), and `/candidatos` SHALL aceitar
`?cargo=7` e `?cargo=8` como filtros válidos, cada um só nas UFs do cargo.

**Aceitação**:
- Given o arquivo do TSE, when importado, then as linhas de cargo 7 e 8 entram — 11.276 contadas como
  "Deputado Estadual" em 13/09 (spec 018 § O universo); a divisão 7 × 8 é medida na reimportação e
  registrada — e a asserção negativa de PII do RF-140 continua passando.
- Given `?cargo=7&uf=SP`, then só Deputado Estadual em SP; `?cargo=8&uf=SP` e `?cargo=7&uf=DF`, then o
  estado vazio nomeado ("nenhuma candidatura para este filtro").
- Given o publicador, then grava `candidatos/uf/<UF>/est.json` nas 26 e `candidatos/uf/DF/dis.json`, e
  nenhum arquivo de cargo 7 no DF.
- Given `?cargo=2` ou `?cargo=4` (vices), then o estado vazio nomeado continua (a rota não revela cargo
  que o produto não cobre).

### Portões

**RF-289 — Portões e2e de peso e acessibilidade nas três telas novas**

WHEN os portões e2e rodam (`pnpm build:e2e && pnpm start:e2e`, depois `pnpm test:e2e`), the system SHALL
servir pelo servidor falso as chaves `projection-current-est-t1`, `projection-current-dis-t1` e
`interruptor-projecao-est` e os Blobs `deputado-estadual/uf/*`, `deputado-estadual/uf-lista/*` e
`deputado-distrital/uf/DF.json`, and SHALL medir `/deputado-estadual`, `/uf/SP/deputado-estadual` e
`/uf/DF/deputado-distrital` no portão de peso e no de acessibilidade (axe, 375 px, teclado, lista aberta
e fechada).

**Aceitação**:
- Given as três rotas, then nenhuma é a casca "ainda não recebeu dados" nem "detalhe indisponível" — o
  portão reprova se achar.
- Given `/uf/SP/deputado-estadual` com fixture no tamanho real (94 lugares, até 95 candidatos por
  agremiação), when medida, then cabe num **teto próprio** registrado em `tests/e2e/perf-budget.spec.ts`
  como exceção nomeada — proposto pelo `a11y-perf-auditor` a partir da medição e aprovado pelo dono,
  como os 480 KiB do federal (ADR-0065 D5); o teto global de 300 KiB não muda.
- Given as outras duas rotas, then cabem no teto global. ⚠️ **Emenda 2026-10-03 (dono):** com o corte das
  listas (eleitos + 5, mínimo 10 — ADR-0065, emenda 03/10) mediram SP estadual 373,6 KiB e DF distrital
  356,3 KiB (o resto é o cabeçalho das agremiações); as DUAS páginas de UF têm teto próprio de **400 KiB**
  em `tests/e2e/perf-budget.spec.ts`. A capa `/deputado-estadual` cabe no global. Enxugar os cabeçalhos
  fica para depois do 1º turno.
- Given o axe, then zero violações nas três, com a lista aberta e fechada.
- Given `/uf/SP/deputado-federal`, then continua cabendo nos seus 480 KiB (sem regressão).

**RF-290 — Golden de 2022 das assembleias**

WHEN o módulo de cadeiras roda sobre os votos oficiais de 2022 de cada casa por agremiação, the system
SHALL reproduzir a distribuição de cadeiras das 27 casas candidato por candidato, com toda divergência
**nomeada** no teste, and `scripts/build-cadeiras-golden.py` SHALL ser parametrizado por cargo (hoje
`CARGO = "6"` e 513 fixos).

**Aceitação**:
- Given os dois conjuntos de 2022 que o dono baixa em `build/tse-archives/`, when o golden roda para 7 e
  8, then as vagas somam 1.035 e 24, e o teste falha se surgir divergência nova **ou** se uma nomeada
  sumir (a regra do RF-126).
- Given o gabarito, then é o resultado **recalculado** depois das ADIs 7228/7263/7325 (a retroação de
  13/03/2025 vale para as assembleias como para a Câmara, ADR-0027) — nunca o proclamado em 2022.
- Given os dados não baixados, then o RF-290 fica pendente, registrado, e não bloqueia a Fase 1; a
  projeção das assembleias fica desligada (o G2 depende do mesmo dado).
- Given o golden federal, then 511/513 inalterado.

## Requisitos Não-Funcionais

- **RNF-002 / RNF-003** — `/uf/SP/deputado-estadual` tem até 60 linhas por agremiação no documento,
  como o federal; valem as mesmas defesas (tuplas compactas, CSS Module, `content-visibility`, spec 026
  RNF). Medido no portão (RF-289).
- **RNF-006 / ADR-0038** — `dado_ts` e `pares_atrasados` lidos do objeto da casa, como no federal; no
  modo resumo a unidade é o arquivo da UF, e o texto da tela não pode chamá-la de "zona".
- **RNF-007a** — nenhum JS novo acima da dobra: o seletor da casa é `<a>` servido pelo servidor; o único
  componente cliente continua sendo a lista.
- **RNF-012** — Blob da casa indisponível: resumo mantido, "detalhe indisponível"; payload `est` ou `dis`
  ausente na capa: a outra parte renderiza e a ausente fica "aguardando".
- **RNF-019** — as candidaturas 7/8 seguem o recorte do ADR-0039; nada novo de dado pessoal.
- **RNF-022 / RNF-035** — marcas e seletor com contraste de texto e de borda; o atual do seletor não é
  sinalizado só por cor.
- **RNF-023 / RNF-024** — listas `<ol>`, botões com `aria-expanded`, seletor navegável por teclado.

## Telas

| Id | Rota | O que é |
|---|---|---|
| **T-17** | `/deputado-estadual` | Capa das 27 casas: enquadramento (26 Assembleias + CLDF, 1.059 cadeiras), soma por partido ou federação com o aviso, mais votados do país, puxadores, grade das 27 casas |
| **T-18** | `/uf/[sigla]/deputado-estadual` · `/uf/DF/deputado-distrital` | Página de uma casa, na ordem da página de UF da spec 026 |

### `/uf/[sigla]/deputado-estadual` e `/uf/DF/deputado-distrital`, nesta ordem

1. Seletor da casa (RF-283) e `DadoParadoBanner`.
2. **Resumo** (`<h1>` com o nome da casa, RF-284); a linha de estado da projeção só com projeção no
   objeto (Fase 2).
3. **Votação** (`VotacaoEleitorado`, do objeto da casa).
4. **Mais votados em {UF}** (RF-270 da 026).
5. **Cadeiras e candidatos por agremiação** (RF-260..RF-262, RF-272, RF-273 da 026).
6. **Regras com os números da casa** (RF-274 da 026).
7. **Conferência** (RF-269 da 026; em modo resumo, RF-285).
8. `DeputadoMetodologia` (o bloco "o que está movendo" só com projeção liberada).
9. Rodapé.

### `/deputado-estadual`

1. Seletor da casa; frescor de `est` e de `dis`, cada um com a sua cadência.
2. Enquadramento (`<h1>`): 26 Assembleias e a Câmara Legislativa do DF, 1.059 cadeiras, turno único.
3. **Soma por partido ou federação no Brasil** (`DeputadoBancadaPanel`), com o aviso.
4. **Mais votados do país** e **Puxadores** (payloads `est` + `dis`).
5. **As 27 casas** (`UfBandeirasGrid`, DF → distrital).
6. Rodapé.

## Open questions

1. **`/uf/XX/deputado-distrital` com XX ≠ DF.** Este design redireciona (308) para
   `/uf/XX/deputado-estadual`, simétrico ao DF. Alternativa: 404. Dono pode trocar; muda uma linha.
2. **Crons do 7/8 na janela do simulado (12–20 UTC).** Cada cargo hoje tem duas entradas (apuração e
   simulado). Com as duas janelas, a Fase 1 leva `vercel.ts` de 19 para 23 entradas e a Fase 2 para 33
   (design § 5.4). Se o simulado do TSE não estiver mais no ar (Passo 0), as entradas da janela do
   simulado não servem; o limite de crons do plano Vercel precisa ser conferido antes (frente T).
3. **Fotos de 7/8 na reimportação de 02–03/10.** A regra do RF-142 (foto de candidatura publicável dos
   cargos cobertos) passa a incluir ~11 mil fotos a mais no Blob, pelo delta de hoje. Se a janela da
   reimportação não comportar, as fotos de 7/8 ficam para depois e a tela usa o avatar de reserva
   (RF-151). Decisão do dono na hora, com o tempo medido.
4. **Líder de federação na soma da capa** (`sigla_lider`, que dá a cor): este design usa o de `est` (26
   das 27 casas) e o de `dis` só quando a agremiação não existe em `est` — determinístico, cor estável a
   noite toda (constituição § 2). Alternativa: recalcular sobre os votos somados, o que exigiria votos
   por componente no payload.
5. **Aba "Deputados" leva a `/deputado-federal`**, como hoje. Alternativa: uma página de escolha. Fica
   como está.

## Emendas a outras specs

- **Spec 017** — "Deputado Estadual e Distrital" em **Fora** fica superado; se a Fase 2 subir, a volta
  do RF-120 e o texto do RF-128 passam de 30 para 60 min (RF-286, ADR-0067). Registro em
  [017 § Fora](../017-deputado-federal/spec.md#fora).
- **Spec 018** — "Deputado Estadual e Distrital" em **Fora** e a aceitação `?cargo=7` do RF-147 ficam
  superadas (RF-288). Registro nas próprias linhas de
  [018](../018-identidade-candidatura/spec.md).
- **Spec 011** — `/sobre-o-modelo` ganha, na seção 5, o parágrafo das assembleias, sem `<h2>` novo.
  Registro em [011 § Emendas](../011-sobre-o-modelo/spec.md#emendas-por-specs-posteriores).
- **Spec 026** — a linha "Deputado Estadual/Distrital (inalterado desde a spec 017)" de **Fora** fica
  superada; **não editada aqui** (outra sessão trabalha na 026) — o `spec-syncer` registra na barreira.
  O contrato v2 da 026 ganha dois campos opcionais (design § 3.2), aditivos.
- **ADR-0036** (volta de 30 min) é emendado pelo ADR-0067; **ADR-0044** ganha a nota de que 7/8
  passam a ser cobertos na eleição `21272` — ambos pelo `adr-author`.

## Cross-refs

- [Design 027](./design.md) — um ciclo de 7/8, nomes, Fase 1 × Fase 2, orçamento, Conferência em
  resumo, capa, peso, riscos
- [Tasks 027](./tasks.md) — frentes D/T/P/U-a/U-b/S/Fase 2/G, mutações e ações do dono
- [Spec 026](../026-deputado-listas-projecao/spec.md) e [design 026](../026-deputado-listas-projecao/design.md) — as telas, o contrato v2, a trava
- [Spec 017](../017-deputado-federal/spec.md) — a base do proporcional
- [Spec 018](../018-identidade-candidatura/spec.md) — o cadastro de candidaturas
- [ADR-0027](../../architecture/adrs/0027-conversao-votos-em-cadeiras-deputado-federal.md) — o método de cadeiras (CE arts. 106–109), igual para as assembleias
- [ADR-0036](../../architecture/adrs/0036-deputado-federal-granularidade-zona-fatiada.md) — fatias, faixa de 5 rps, trava por `(cargo, fatia)`
- [ADR-0044](../../architecture/adrs/0044-codigo-eleicao-por-cargo.md) — eleição por cargo, sem default
- [ADR-0049](../../architecture/adrs/0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md) — total fixo, nunca a soma das UFs presentes
- [ADR-0063](../../architecture/adrs/0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md), [ADR-0064](../../architecture/adrs/0064-destino-do-voto-proporcional-segue-o-dvt-do-tse.md), [ADR-0065](../../architecture/adrs/0065-listas-proporcionais-em-tres-faixas.md) — projeção, destino do voto, listas
- `tests/fixtures/tse/2026-sim/ele-c.json` — cargos 7 e 8 na eleição `21272`
- `tests/fixtures/tse/2026-sim/README.md` § `df/` — as 19 zonas do DF
