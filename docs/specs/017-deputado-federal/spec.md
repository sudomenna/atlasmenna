---
id: 017-deputado-federal
title: Deputado Federal — corrida proporcional com projeção de cadeiras
status: shipped
priority: M
personas: [P1, P2, P3]
screens: [T-11, T-12]
requirements: [RF-120, RF-121, RF-122, RF-123, RF-124, RF-125, RF-125.1, RF-126, RF-127, RF-128, RF-129, RF-130, RF-131]
depends_on: [001-ingestao-tse, 002-modelo-estatistico, 016-senador]
apis: [GET /api/ingest/deputado-federal, POST /api/ingest/deputado-federal, GET /api/projection?cargo=deputado-federal]
components: [CargoTabs, DeputadoMetodologia, VoteBar, Figure, Panel, Footer, CamaraHemiciclo]
nfr: [RNF-001, RNF-002, RNF-003, RNF-006, RNF-007a, RNF-022, RNF-023, RNF-024, RNF-035]
adrs: [0001, 0012, 0020, 0021, 0026, 0027, 0028, 0032, 0034, 0035, 0036, 0037, 0038, 0042, 0049]
ship_blocked_on: []
opens_after: 2026-09-11
---

# Spec 017 — Deputado Federal

**Rotas**: `/deputado-federal` (nacional) e `/uf/[sigla]/deputado-federal`
**Cargo TSE**: 6 · **Turno único** · **Proporcional** — 513 cadeiras, 8 a 70 por UF

## Status

`shipped` desde 2026-09-13 (`b1fbeca`), com os **4 gates aprovados** —
`rf-coverage-checker` (12 RFs, nenhum parcial), `constitution-guard` (PASS na
reexecução; a primeira rodada reprovou `<DeputadoMetodologia>`, corrigida em
`8cd955f`), `a11y-perf-auditor` e `spec-syncer`. O caminho completo, incluindo a
reprova, está em [traceability.md](../../_meta/traceability.md).

Escrita em 2026-09-11; cálculo de cadeiras validado em 12/09 (511/513) e a spec
implementada ponta a ponta no mesmo dia.

> **Histórico**: de 2026-09-12 a 2026-09-19 esta seção dizia `implementing` e
> justificava o bloqueio assim — "o RF-127 saiu pela metade: a marcação de
> cadeira indefinida entrou, o **intervalo** não — falta o bootstrap de voto por
> agremiação (design.md D7)". As duas afirmações venceram em **2026-09-13** e o
> corpo não acompanhou. O bootstrap entrou em `2bcee57`
> (`api/model/cadeiras_bootstrap.py`, 23 testes em
> `tests/unit/model/test_cadeiras_bootstrap.py`), fechando o RF-127 — que
> `docs/_meta/traceability.md` registra como ✅ citando esse arquivo pelo nome —,
> e horas depois `b1fbeca` promoveu o frontmatter a `shipped` **sem tocar neste
> corpo**. O resultado foi um texto que contradizia a linha 4 do próprio arquivo
> e ainda apontava como pendência algo já entregue. Corrigido em 2026-09-19, na
> mesma emenda que acrescentou o [RF-131](#telas) ao escopo.

### O que está pronto

| camada | estado |
|---|---|
| Ingestão (cargo 6, ~6.110 alvos de zona, 6 fatias, volta de 30 min — [ADR-0036](../../architecture/adrs/0036-deputado-federal-granularidade-zona-fatiada.md)) | ✅ `9ee5871`, `e2f3240` |
| Método de cadeiras (ADR-0027) | ✅ `api/model/cadeiras.py`, 21 casos de borda |
| Ponte EA20 → cadeiras | ✅ `api/model/deputado.py`, 28 testes |
| **Golden contra 2022 (RF-126)** | ✅ **511/513 cadeiras**, fase 1 exata nas 27 UFs |
| Conferência ao vivo contra o TSE | ✅ `conferir_contra_tse` — compara com `carg[].qe` e `agr[].vag` |
| Payload (`EdgePayloadDeputado` nacional + UF) | ✅ `lib/edge-config/`, `lib/blob/` |
| Read path do Blob (`deputado/uf/<SIGLA>.json`) | ✅ `lib/blob/deputado-uf.ts::readDeputadoUfDetail` + testes |
| Telas `/deputado-federal` e `/uf/[sigla]/deputado-federal` | ✅ rotas implementadas, aba habilitada |
| Aba no `CargoTabs` | ✅ `href="/deputado-federal"`, `disabled: false` |
| **Intervalo de cadeiras (RF-127)** | ✅ `2bcee57` — `api/model/cadeiras_bootstrap.py`, 23 testes |
| **Hemiciclo da Câmara (RF-131)** | ✅ `16d4a26` — [ADR-0049](../../architecture/adrs/0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md); `CamaraHemiciclo.tsx`, `lib/utils/hemiciclo.ts`, `lib/utils/bancada.ts` |

**A degradação de 19/09 não foi acionada por causa do cálculo** — ele passou em
12/09, e o marco venceu sem disparar (desfecho registrado abaixo da tabela de
degradação).

## Objetivo

Mostrar, ao vivo, como a bancada da Câmara está se formando — por partido e
federação —, com a honestidade de dizer quando ainda não dá para dizer. Cadeira
projetada é a informação que o leitor quer e a mais fácil de errar: numa eleição
proporcional, **um partido pode ganhar votos e perder cadeira**, e a última vaga
de um estado costuma se decidir por algumas centenas de votos.

## Escopo

### Dentro

- Ingestão do cargo 6 em granularidade **zona** (par município×zona, ~6.110
  arquivos), varrida em **6 fatias** de ~1.019 alvos, uma a cada 5 min — volta
  completa a cada **30 minutos**. Implementada em UF em 2026-09-11; movida para
  zona fatiada em 2026-09-13 ([ADR-0036](../../architecture/adrs/0036-deputado-federal-granularidade-zona-fatiada.md)),
  porque com um arquivo por estado o bootstrap do RF-127 tem uma única unidade
  de reamostragem e o intervalo degenera.
- Leitura da hierarquia proporcional do EA20: `carg[] → (fed[] | agr[].par[]) → cand[]`
  e os **votos de legenda** `v.vl` (`lib/tse/ea20-schema.ts:269`), que existem
  neste cargo e não nos majoritários.
- Projeção de votos por agremiação pela regra de três do ADR-0021, em nível de UF.
- **Módulo de cadeiras** implementando o ADR-0027, com testes golden contra 2022.
- Read path híbrido: resumo nacional no Global Config; drill-down por UF no
  **Vercel Blob** ([ADR-0026](../../architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md) item 4,
  `deputadoUfBlobPathname` em `lib/blob/paths.ts:168-171`, hoje sem caller).

### Fora

- **Deputado Estadual e Distrital** (cargos 7/8). Fora do escopo do produto.
- **Projeção zona a zona.** Mesma razão da spec 016.
- **Suplência nominal.** O ADR-0027 descreve a regra (Código Eleitoral art. 112),
  mas exibir lista de suplentes não entra nesta janela.

## Requisitos Funcionais

### Ingestão e dado

**RF-120 — Ingestão do cargo 6, varrida em 6 fatias, volta completa em 30 minutos**

> **Reescrito em 2026-09-13 ([ADR-0036](../../architecture/adrs/0036-deputado-federal-granularidade-zona-fatiada.md)).**
> A redação anterior — "a cada 15 minutos, produzindo 27 alvos de nível UF" —
> descrevia a granularidade que o ADR-0036 substituiu, e a sua aceitação
> (`then devolve 27 alvos nivel: "uf"`) passou a afirmar o **oposto** do
> comportamento correto. ADR vence spec (constituição, hierarquia), então o
> requisito acompanha.

WHILE estamos na janela de apuração, the system SHALL acionar
`/api/ingest/deputado-federal/<fatia>` a cada 5 minutos, uma fatia por
invocação, cobrindo as 6 fatias — e portanto os ~6.110 alvos de nível zona — a
cada 30 minutos.

**Aceitação**:
- Given o cron da fatia N dispara, when `listIngestTargets(production, {cargo: 6, fatia: N})`
  roda, then devolve ~1.019 alvos `nivel: "zona"`.
- Given as 6 fatias, when unidas, then o resultado é **exatamente** o conjunto
  dos ~6.110 alvos — sem sobra e sem repetição (disjunção par a par).
- Given `TSE_DEPUTADO_GRANULARIDADE=uf` (interruptor de emergência), when
  qualquer fatia roda, then devolve os 27 alvos `nivel: "uf"` e a fatia é
  ignorada.

**RF-121 — Votos de legenda preservados**

WHEN o parser lê um envelope de cargo 6, the system SHALL persistir `v.vl` (votos
de legenda) e somá-lo aos votos nominais ao compor os **votos válidos da
agremiação**, conforme ADR-0027.

**Aceitação**:
- Given `v.vl = 1000` e Σ nominais = 9000, when os votos da agremiação são
  computados, then o total é **10.000**.
- Given brancos e nulos presentes no envelope, when os votos válidos são
  computados, then eles **não** entram (Lei 9.504 art. 5º; Res.-TSE 23.677 art. 9º p.ú.).

**RF-122 — Federação conta como uma agremiação**

WHEN o sistema agrega votos para o cálculo de cadeiras, the system SHALL tratar
cada federação como **uma única** agremiação, somando os partidos que a compõem,
e NÃO como partidos separados.

**Aceitação**:
- Given uma federação de 3 partidos, when o quociente partidário é calculado,
  then há **um** quociente para a federação, não três.
- Given a tela renderizada, when exibe a bancada, then a federação aparece com
  identidade própria, com os partidos componentes legíveis (constituição § 2 —
  cor por federação sem sugerir fusão).

### Cadeiras

**RF-123 — Quociente eleitoral com o arredondamento da lei**

WHEN o sistema calcula o quociente eleitoral de uma UF, the system SHALL usar
`QE = votos_válidos / lugares_a_preencher`, **desprezando a fração se ≤ 0,5 e
arredondando para 1 se > 0,5** (Código Eleitoral art. 106).

**Aceitação**:
- Given fração exatamente 0,5, when o QE é calculado, then ela é **desprezada**
  (não é `round()` de linguagem nenhuma — é a classe de erro que passa
  despercebida).
- Given fração 0,5000001, when o QE é calculado, then arredonda para cima.

**RF-124 — Número de vagas NUNCA hardcoded**

WHEN o sistema precisa de `lugares_a_preencher` de uma UF, the system SHALL
obtê-lo do dado publicado pelo TSE ou de tabela versionada com verificação contra
o simulado, e NUNCA de constante embutida no código.

**Aceitação**:
- Given a tabela de bancadas, when o valor de uma UF diverge do que o TSE publica,
  then o ciclo registra erro e aciona alerta — errar o denominador do QE corrompe
  a projeção inteira daquela UF.
- Given as **27** UFs já publicaram `carg[].nv`, when a soma não fecha com as 513
  cadeiras da Câmara, then o ciclo registra `error` e aciona o alerta, **sem
  abortar** (constituição § 7) — é o mesmo critério acima, medido no único ponto
  em que uma UF errada é detectável sem uma segunda fonte por UF.
  (`api/model/deputado_payload.py::conferir_total_de_cadeiras`,
  `api/model/project.py`.) ⚠️ Com **menos** de 27 UFs a divergência é o estado
  normal do começo da noite e **não** pode alarmar.
- Rationale: a Res.-TSE 23.748/2026 art. 7º § 1º remete à LC 78/1993. ~~e a
  redistribuição pelo Censo 2022 (PLP 177/2023) tem desfecho **não confirmado**.~~

> ⚠️ **Corrigido em 2026-09-19 — o desfecho existe desde julho/2025.** O PLP
> 177/2023, que elevaria a Câmara a 531 cadeiras pela redistribuição do Censo
> 2022, foi aprovado pela Câmara e pelo Senado em junho/2025, **vetado
> integralmente pela Presidência da República em julho/2025**, e o **STF decidiu
> manter a distribuição atual de 513** para este pleito, regido pela **Resolução
> TSE 23.751/2026** ([regulatory.md](../../reference/regulatory.md)). A Câmara de
> 04/10/2026 tem **513 cadeiras, todas em disputa** — diferente do Senado, que
> renova 54 de 81.
>
> **O RF-124 não muda, e não é ele que estava errado.** Ele rege o
> `lugares_a_preencher` de **uma UF**, que continua vindo do dado publicado pelo
> TSE, e ele já autorizava "tabela versionada com verificação contra o simulado".
> O que a premissa falsa autorizava, em outro lugar, era derivar o **total
> nacional** da soma das UFs presentes: até 2026-09-19
> `api/model/deputado_payload.py` publicava essa soma como
> `bancada.total_cadeiras`, e com três estados pequenos apurando a tela nacional
> escrevia "26 cadeiras em disputa". Hoje o total é fato fixo
> (`api/model/cargos.py::TOTAL_CADEIRAS`, `VAGAS_EM_DISPUTA_2026` — os mesmos
> dicionários que o Senado já usava) e a soma virou a conferência do segundo
> critério de aceitação acima. Ver a emenda de
> [ADR-0049](../../architecture/adrs/0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md).

**RF-125 — Distribuição em três fases, conforme ADR-0027**

WHEN o sistema converte votos em cadeiras, the system SHALL executar, nesta ordem:
(1) cadeiras por quociente partidário com a cláusula de 10% do QE por candidato;
(2) sobras restritas aos partidos com ≥80% do QE e candidatos com ≥20% do QE;
(3) sobras abertas a **todos**, sem piso algum, quando a fase 2 se esgotar
(STF, ADI 7228; Res.-TSE 23.677 art. 11 § 4º).

**Aceitação**:
- Given um partido abaixo de 80% do QE, when a fase 2 termina sem candidatos
  elegíveis, then esse partido **participa** da fase 3.
- Given cadeiras contadas pelo QP mas não preenchidas por falta de candidato acima
  de 10%, when a média é calculada, then o **QP inteiro** entra no denominador
  (ADI 5.420; Res. art. 11 § 5º).
- Given nenhum partido atinge o QE, when o sistema distribui, then aplica o
  algoritmo de médias a **todas** as cadeiras (Res. art. 12-A) e **não** elege os
  mais votados — o art. 111 do Código Eleitoral foi declarado inconstitucional.

**RF-125.1 — Cadeiras exibidas ≠ vagas obtidas para o denominador**

WHEN o sistema exibe a contagem de cadeiras de uma agremiação, the system SHALL usar o número de
candidatos **efetivamente eleitos**, e NUNCA a variável de bookkeeping que alimenta o denominador
da média — que conta o quociente partidário inteiro, ainda que não preenchido (Res.-TSE 23.677
art. 11 § 5º, ADI 5.420).

**Aceitação**:
- Given uma UF, when a apuração termina, then `Σ cadeiras_exibidas` sobre todas as agremiações é
  **exatamente** `lugares_a_preencher`.
- Given um partido com quociente para 3 cadeiras e apenas 2 candidatos acima de 10% do QE, when a
  tela renderiza, then ele aparece com **2** cadeiras, não 3.
- Rationale: com a variável errada, uma UF de 10 vagas exibiria 11 — a vaga não ocupada vai para as
  sobras, possivelmente para outro partido, e seria contada duas vezes.

**RF-126 — Testes golden contra 2022** ✅ **cumprido em 2026-09-12**

WHEN o módulo de cadeiras é alterado, the system SHALL reproduzir a distribuição
oficial de cadeiras de 2022 para todas as 27 UFs.

**Resultado medido**: **511 das 513** cadeiras, candidato por candidato
(`tests/unit/model/test_cadeiras_golden_2022.py`). A fase 1 (quociente
partidário + cláusula dos 10%) é **exata nas 27 UFs**. As 2 divergências estão
em rodada de sobras, nomeadas no teste, e viraram a open question 4 abaixo.

**Aceitação**:
- Given os votos de 2022 por (UF, agremiação), when o módulo roda, then a
  distribuição bate com a oficial em cada UF — **511/513**, com as 2 exceções
  nomeadas; o teste falha se surgir uma terceira **ou se uma das duas sumir**.
- ⚠️ O gabarito tem de ser o resultado **recalculado** após a ADI 7228: os
  embargos julgados em 13/03/2025 derrubaram a modulação, e a decisão **retroage
  a 2022**. Usar os números proclamados à época produziria um golden errado que
  passaria com um algoritmo errado.

### Telas

**RF-127 — Bancada projetada com incerteza explícita**

WHEN uma tela de Deputado exibe cadeiras projetadas, the system SHALL exibir o
intervalo, não só o número central, e SHALL marcar as cadeiras cuja atribuição
depende de sobras ainda indefinidas.

**Aceitação**:
- Given uma UF com a última vaga dentro do IC entre duas agremiações, when a tela
  renderiza, then isso é legível — não uma cadeira atribuída com falsa firmeza.

**RF-128 — Cadência de 30 minutos visível**

> **15 → 30 em 2026-09-13 ([ADR-0036](../../architecture/adrs/0036-deputado-federal-granularidade-zona-fatiada.md)):**
> a volta completa das 6 fatias. O número **não** é literal no JSX — sai de
> `atualizacao_min` do payload (design § D8), e é por isso que a tela
> acompanhou a mudança sozinha.

WHEN uma tela exibe Deputado Federal, the system SHALL exibir "atualizado a cada
30 min" e o `ts` do payload, e NÃO um "atualizado às" único quando a tela mistura
cargos de cadências diferentes (ADR-0026 item 5, ADR-0036, constituição § 8).

**Aceitação**:
- Given um payload com `atualizacao_min` diferente de 30, when a tela renderiza,
  then ela diz **aquele** valor — o teste injeta 7 e exige que a tela diga 7,
  para que um literal esquecido no JSX seja pego.

**RF-129 — Drill-down por UF vem do Blob**

WHEN `/uf/[sigla]/deputado-federal` precisa da lista completa de candidatos, the
system SHALL lê-la do Vercel Blob via `fetch` no servidor com revalidate, e NÃO
do Global Config.

**Aceitação**:
- Given o payload por UF (~10–15 KB × 27), when gravado, then vai para
  `deputado/uf/<SIGLA>.json`, não para o Global Config — cujo limite de 1 MB já é
  compartilhado por três cargos.
- Given o Blob indisponível, when a página renderiza, then exibe estado de detalhe
  indisponível e **mantém** o resumo (constituição § 7).

**RF-130 — Voto de legenda visível**

WHEN a tela exibe a votação de uma agremiação, the system SHALL distinguir votos
nominais de votos de legenda.

**Aceitação**:
- Given uma agremiação com legenda relevante, when a tela renderiza, then os dois
  números são distinguíveis — somá-los sem dizer esconde um fato que decide
  cadeira.

**RF-131 — Hemiciclo da Câmara: um assento por cadeira, três estados, ordem por tamanho de bancada**

WHEN a tela nacional de Deputado Federal dispõe de uma bancada com ao menos uma
cadeira publicada, the system SHALL desenhar o plenário como um hemiciclo com
**exatamente `total_cadeiras` assentos**, em que: (1) o total sai do payload e
NUNCA de constante embutida em **nenhuma camada da tela** — componente, geometria
ou teste — sendo o **produtor** do payload quem o fixa em 513
(`api/model/cargos.py`), conferido contra a soma dos `carg[].nv` das 27 UFs
(RF-124); (2) cada assento está em um de três estados — `definida`, `indefinida`
(a cadeira que o modelo já atribuiu, decidida em rodada de sobras por margem
apertada) e `nao_atribuida` (a cadeira cuja UF ainda não apurou o suficiente) —
cuja soma é `total_cadeiras` **por construção**, não por conferência (RF-125.1);
(3) a cor que identifica a agremiação é a variante de texto do token de partido,
nunca a cor-base (RNF-035, [ADR-0047](../../architecture/adrs/0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) D1);
e (4) a ordem dos assentos é a **mesma** da lista textual de agremiações da
página — cadeiras desc, sigla asc —, sem rótulo de espectro nas extremidades do
arco e sem marcador de maioria, porque o produto não mede posição ideológica de
partido (constituição § 2).

> **Histórico**: este RF é **novo em 2026-09-19** e não substitui texto anterior —
> ele fecha uma lacuna. O hemiciclo entrou em produção em 2026-09-18 (`16d4a26`)
> e passou a ser o elemento de maior destaque visual do produto **sem que nenhum
> RF publicado descrevesse a peça**: RF-124, RF-125.1 e RF-127 normatizam os
> *dados* que ele desenha, nenhum deles normatiza que a tela desenhe um
> hemiciclo, nem os três estados de cadeira, nem a regra de cor, nem a regra de
> ordem. A lacuna foi nomeada pelo próprio
> [ADR-0049](../../architecture/adrs/0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md)
> (Consequências, negativa final), que é a fonte normativa deste requisito. O
> texto acima descreve o comportamento **já implementado e testado** — nada muda
> na tela por causa desta emenda.

**Aceitação**:
- Given `total_cadeiras = 531` — ~~a redistribuição pelo Censo 2022, PLP
  177/2023~~ ⚠️ **corrigido em 2026-09-19**: não há 531 por vir (o PLP 177/2023
  foi vetado em julho/2025 e o STF manteve as 513); 531 permanece aqui como
  **caso de robustez**, e é justamente por não ser o número da eleição que ele
  prova o que precisa provar — when o hemiciclo renderiza, then há **531**
  assentos, o número de arcos é o mesmo de 513 e nenhum arco muda mais de 2
  cadeiras. O desenho não pode ter escondido o tamanho da casa em camada nenhuma
  ([ADR-0049](../../architecture/adrs/0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md)
  Decisão 2; `tests/unit/lib/hemiciclo.test.ts`, `tests/unit/pages/deputado-federal-hemiciclo.test.tsx`).
- Given o payload real do cargo 6, when a tela nacional renderiza, then o total
  desenhado e escrito é **513** em qualquer hora da noite — ele vem do payload,
  onde é fato fixo, e **nunca** da soma das UFs já apuradas, que às 18h daria 26
  e mudaria a forma do plenário (RF-124, segundo critério de aceitação).
- Given um payload com qualquer `total_cadeiras`, when o `<title>` do SVG é lido,
  then ele nomeia **aquele** número e **não** contém a string `513` — a fixture
  dos testes usa totais deliberadamente diferentes de 513, porque um teste que
  usasse 513 passaria por coincidência com o número cravado no JSX.
- Given uma agremiação com `cadeiras_indefinidas > 0`, when o hemiciclo
  renderiza, then essas cadeiras saem **cinzas com anel na cor da agremiação** —
  nem cor chapada (afirmaria firmeza que não existe), nem cinza chapado
  (descartaria de quem a cadeira é hoje, que é exatamente o que RF-127 manda
  tornar legível). Decisão do dono, ADR-0049 Decisão 3.
- Given `Σ cadeiras < total_cadeiras`, when o hemiciclo renderiza, then o resto
  sai em cinza com anel **neutro** e nenhuma agremiação é nomeada nesses
  assentos — cadeira sem apuração suficiente não tem dono a exibir.
- Given a mesma bancada renderizada duas vezes, uma com `cadeiras_ci95`
  preenchido em **todas** as linhas e outra sem valor algum, when os dois `<svg>`
  são comparados, then o `outerHTML` é **string idêntica**: o intervalo do
  RF-127 vive na lista textual ao lado, não no desenho — "entre 85 e 93 cadeiras"
  não tem representação em bolinhas que não invente de quem seriam
  (ADR-0049 Decisão 4).
- Given duas agremiações empatadas em cadeiras, when a tela renderiza, then a
  n-ésima cunha da esquerda e a n-ésima linha da lista são a **mesma**
  agremiação, porque as duas superfícies chamam a mesma `ordenarBancada`
  (`lib/utils/bancada.ts`) — com duas implementações da regra, elas divergiriam
  só na noite em que houvesse empate.
- Given `total_cadeiras = 0` (nenhuma cadeira publicada ainda), when a tela
  renderiza, then **nenhum** plenário é desenhado — uma Câmara de tamanho padrão
  para preencher o espaço seria número escrito à mão.
- Given o SVG renderizado, when um leitor de tela o alcança, then ele tem
  `role="img"`, `<title>` nomeando o total lido do payload, e `aria-describedby`
  apontando para alvos **existentes** no documento, um deles a lista textual de
  agremiações (constituição § 4).
- ⚠️ **Rationale de custo**: nenhum dos três orçamentos de RNF-007 enxerga este
  widget — todos somam `request.resourceType() === "script"`, e o hemiciclo é
  zero JavaScript. O teto que morde hoje é
  `tests/unit/components/camara-hemiciclo-peso.test.tsx` (36 KiB sobre o markup
  determinístico); o caso de documento em `tests/e2e/perf-budget.spec.ts` está
  marcado **PROVISÓRIO** no próprio código, porque o e2e não roda contra build
  local. Ver ADR-0049, Consequências negativa 1.

## Requisitos Não-Funcionais

Herda RNF-001/002/003, RNF-006 (relaxado para a cadência de 30 min — ADR-0036),
RNF-007a (o payload por UF é o maior do produto — o drill-down vai para Blob por
isso), RNF-022/023/024.

## Degradação pré-acordada — decidida em 2026-09-07, **não re-discutir**

| Marco | Condição | Consequência |
|---|---|---|
| **19/09** | Módulo de cadeiras não passa nos golden de 2022 | Spec shippa **parcial**: votos por partido/federação, **sem** projeção de cadeiras. RF-123 a RF-127 saem do escopo desta janela. |
| **24/09** | Nem o parcial por partido está verde | A aba fica **desabilitada** e o cargo vai para **2030**. |

A degradação é sobre a **projeção de cadeiras**, não sobre a ingestão: o cargo 6
continua sendo ingerido e persistido de todo jeito (append-only, constituição § 10),
para que 2030 comece com histórico.

> **Desfecho do marco de 19/09 — registro, não re-discussão.** A condição **não**
> se verificou: o módulo de cadeiras passa nos golden de 2022 desde 2026-09-12 —
> 511/513 cadeiras, fase 1 exata nas 27 UFs
> (`tests/unit/model/test_cadeiras_golden_2022.py`, 7 casos verdes, reconferidos
> em 2026-09-19). **RF-123 a RF-127 permanecem no escopo** e estão implementados;
> o RF-127 fechou por inteiro em `2bcee57`. O marco venceu sem disparar, e esta
> nota existe só para que a linha da tabela não seja lida como pendência aberta
> por quem chegar depois. O marco de **24/09** fica como está — a decisão de
> 2026-09-07 não é reaberta aqui.

## Open questions

4. **As duas cadeiras de 2022 que a aritmética não explica.** MG (NELY AQUINO,
   PODE) e RS (BIBO NUNES, PL), ambas "ELEITO POR MÉDIA". Nos dois casos o TSE
   deu a vaga à agremiação de **menor** média, tendo a de maior média candidato
   acima do piso de 20% — o que a leitura literal do art. 109 I não admite.
   Descartado pelo dado: o quociente de MG bate por duas fontes independentes
   (210.400, ao voto), os votos nominais batem exatamente entre os dois datasets
   do TSE, e a ordem não muda incluindo ou excluindo legenda da média.
   Hipótese **não confirmada**: decisão judicial posterior — `DS_SIT_TOT_TURNO`
   registra o desfecho jurídico, que não precisa coincidir com a aritmética.
   Ambos são troca entre duas agremiações, forma típica desse tipo de decisão.
   **Não bloqueia o ship**: 511/513 com fase 1 exata é evidência suficiente de
   que o método está certo. Reabrir se o simulado mostrar padrão parecido.

5. **O golden exercita, mas não discrimina, o arredondamento do art. 106.**
   Quatro UFs de 2022 caem na fração exata de 0,5 (AP, MT, SC, TO), mas 1 voto
   de diferença no quociente não move cadeira nelas — verificado por mutação.
   Quem protege a regra são os casos sintéticos de `test_cadeiras.py`. Registrado
   para que ninguém trate o golden como prova completa.

1. **"Candidato com ≥20% do QE" — precisa estar não eleito?** O texto do art. 109
   § 2º não qualifica. A leitura operacional é que sim (a cadeira precisa ser
   ocupável), mas não há dispositivo nem acórdão que resolva. **Travar com fixture
   do simulado** antes de 04/10.
2. **Tabela de cadeiras por UF em 2026** — o total de 513 está confirmado; a
   distribuição por UF, não. Ver RF-124.
3. **Empate de médias que sobrevive aos dois critérios de desempate** (maior
   votação total, depois maior votação nominal) — a norma não prevê sorteio. A
   decisão desta spec é **marcar como indeterminado na tela**, nunca escolher.

## Emendas por specs posteriores

### Spec 021 — Votação (2026-09-26)

O painel "Votação" (RF-192..199) entra na tela de UF `/uf/[sigla]/deputado-federal`, imediatamente após o `<ResultPanel>` (que em Deputado mostra a lista de eleitos e suplentes, não uma ranking de candidatos). O painel renderiza com `EdgePayloadUf.votacao` — as contagens DE DEPUTADO na UF (voto proporcional, sem projeção de cadeiras, apenas participação apurada).

### Spec 022 — A corrida em três círculos (2026-09-26)

O painel "A corrida" (RF-200..210) **não entra** em nenhuma tela de Deputado Federal (`/deputado-federal` nacional nem `/uf/[sigla]/deputado-federal` de UF) — a disputa é proporcional, sem colocados (RF-200 limitação de escopo).

## Cross-refs

- [ADR-0027](../../architecture/adrs/0027-conversao-votos-em-cadeiras-deputado-federal.md) — o método de cadeiras, com o texto legal vigente e a jurisprudência
- [ADR-0049](../../architecture/adrs/0049-hemiciclo-camara-geometria-fixa-anel-na-indefinida.md) — o hemiciclo: `total_cadeiras` em runtime, 12 arcos fixos independentes de N, cadeira indefinida com anel colorido, e o intervalo do RF-127 deliberadamente fora do desenho (fonte normativa do RF-131)
- [ADR-0026](../../architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md) — ingestão e read path híbrido (⚠️ cita "Lei 9.504 art. 111"; o correto é **Código Eleitoral** art. 111, e ele está inconstitucional — ver ADR-0027)
- [ADR-0032](../../architecture/adrs/0032-detalhe-municipal-vercel-blob.md) — o mesmo mecanismo de Blob, já em uso para detalhe municipal
- [Spec 016](../016-senador/spec.md) — o outro cargo novo, majoritário
- `lib/config/cargos.ts` — tabela canônica (`proporcional: true`, `vagasPorUf: null`)
