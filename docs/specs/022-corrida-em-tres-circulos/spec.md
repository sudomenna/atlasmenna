---
id: 022-corrida-em-tres-circulos
title: A corrida em três círculos — válidos, votantes e eleitorado, por candidatura ou por partido
status: implementing
priority: M
personas: [P1, P2, P3]
screens: [T-01, T-03, T-10]
requirements: [RF-200, RF-201, RF-202, RF-203, RF-204, RF-205, RF-206, RF-207, RF-208, RF-209, RF-210]
depends_on: [001-ingestao-tse, 003-home-nacional, 004-pagina-uf-presidencial, 005-pagina-uf-governador, 006-grid-governadores, 016-senador, 021-votacao-eleitorado]
apis: []
components: [CorridaTresCirculos, VotacaoEleitorado, Panel, DetailUnavailable]
nfr: [RNF-002, RNF-007a, RNF-022, RNF-023, RNF-024, RNF-026]
adrs: [0001, 0017, 0018, 0024]
amends: [003-home-nacional, 004-pagina-uf-presidencial, 005-pagina-uf-governador, 006-grid-governadores, 016-senador, 021-votacao-eleitorado]
ship_blocked_on: []
---

# Spec 022 — A corrida em três círculos

**Rotas novas**: nenhuma.
**Superfícies emendadas**: `/`, `/governador`, `/senador`, `/uf/[sigla]`,
`/uf/[sigla]/governador`, `/uf/[sigla]/senador`.
**Pedido do dono (2026-09-26)**: três círculos sobre a **corrida** — distinto
do painel "Votação" (spec 021), que é sobre o **eleitorado**. É a hierarquia do
EA20 desenhada em três passos: voto válido → voto dado → eleitorado inteiro.

---

## Contexto medido

### 🔴 O voto por candidato que o payload publica NÃO é só voto válido

Medido na captura real do simulado (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`):

```
Σ vap das 13 candidaturas ...... 120.560.949
  ├─ dvt "Válido" .............. 100.982.116   == v.vv, exato
  ├─ dvt "Anulado" .............   9.075.260
  └─ dvt "Anulado sub judice" ...  10.503.573   == v.vansj, exato
```

O **mais votado** do arquivo (10,5 mi) é `Anulado sub judice`. Um círculo "só
válidos" montado com `votos_atuais` poria em 1º lugar alguém cujos votos não
são válidos. Na fixture do simulado o efeito é o mesmo: Σ `votos_atuais`
29.413.666 contra `validos` 24.607.620 (+19,5%), exatamente
`validos + anulados + sub_judice`.

O campo que separa é `cand[].dvt` (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:790-806`),
"disponível somente após a primeira totalização parcial". O pipeline o faz
parse (`lib/tse/ea20-schema.ts:84`) e **o descarta**: nenhum leitor o usa.
Ele já está persistido — `snapshots.payload` guarda o EA20 cru
(`lib/db/schema.ts:198`) — então **não há migration**.

### A fonte: o agregado do TSE, UM arquivo por abrangência

Os três círculos saem do **mesmo arquivo agregado** (`nivel` `"br"` para
Presidente nacional, `"uf"` para cada UF — RF-199, spec 021) que já alimenta
`votacao.contagens`. Consequência: eles fecham por **identidade do TSE**, sem
remendo, porque votos por candidatura e contagens são do mesmo instante.
Conferido na captura real: Σ `vap` com `dvt = "Válido"` = `v.vv` na unidade.

⚠️ **Não** usar os votos somados por zona (`national.candidatos[].votos_atuais`,
`EdgePayloadUf.candidatos[].votos_atuais`) nos círculos: vêm de outros
arquivos, possivelmente de outro ciclo, e o círculo deixaria de fechar. O
preço é conhecido e aceito: durante a noite o número de um candidato no
círculo pode diferir por um ciclo do número na lista acima. A metodologia do
painel o declara (RF-208).

⚠️ **Não** usar `top_candidatos` (handoff 26/09 § 2.3): é top-4 por projeção.

---

## Requisitos funcionais

### RF-200 — o painel, e onde ele fica

**Quando** a rota é `/`, `/governador` ou `/senador`, **o sistema deve**
renderizar o painel "A corrida" em `<Panel>` próprio **imediatamente depois**
do painel "Votação" (spec 021). Não pode ir antes: RF-192 fixa "Votação"
imediatamente após a lista de candidaturas.

**Quando** a rota é `/uf/[sigla]`, `/uf/[sigla]/governador` ou
`/uf/[sigla]/senador`, **o sistema deve** renderizar o painel imediatamente
depois do `<ResultPanel>` da UF.

**Onde** `/deputado-federal` e `/uf/[sigla]/deputado-federal` **não** recebem o
painel: a disputa é proporcional, não há colocados (decisão do dono, 26/09).

🔴 **EMENDADO em 2026-09-26 (noite), decisão do dono**: o painel **sai** de
`/governador` e `/senador`. Fica em `/` e nas três telas de UF de Presidente,
Governador e Senador, sempre depois do painel "Votação" da UF (spec 021 RF-192
emendado). Com isso o modo **por partido** (RF-201) deixa de ter tela: o
produtor continua publicando `corrida_por_partido` (custa ~2 KB por cargo e
fica disponível), mas nenhum componente o lê. Remover o campo do contrato é
limpeza pós-2º turno, não agora.

### RF-201 — por candidatura onde há UMA corrida; por partido onde há 27

**Quando** a abrangência tem uma corrida só (`/` e as telas de UF), **o
sistema deve** dividir as fatias por **candidatura**.

**Quando** a rota é `/governador` (27 corridas), **o sistema deve** dividir as
fatias por **partido**, somando os votos válidos de todas as candidaturas do
partido nas 27 UFs.

⚠️ Um "1º colocado" nacional de Governador afirmaria uma eleição de governador
do Brasil que não existe (mesmo fato do RF-145). Medido na fixture: o topo por
candidato seria a corrida de SP.

### RF-202 — as fatias da corrida: quatro mais "Outros"

**O sistema deve** exibir as **quatro** candidaturas (ou partidos) de mais
votos **válidos** apurados, na ordem decrescente, e uma quinta fatia
**"Outros"** com a soma de todas as demais válidas.

**Onde** a ordem é por votos apurados, **nunca** por projeção; o desempate é
pelo número de urna (candidatura) ou pela sigla (partido), crescente — fixo e
testado, para a ordem não depender da ordem de chegada do arquivo.

**Onde** "Outros" some quando não há demais (ex.: corrida de 3 candidatos),
pela mesma regra de fatia zero do spec 021 (`VotacaoEleitorado.tsx:456-470`).

**Onde** a cor da fatia vem da **sigla** (`candidateColor`,
`components/blocks/_candidateColor.ts:124`, constituição § 2 / ADR-0024), nunca
do campo `cor` do payload (`tests/unit/components/cor-nunca-do-payload.test.ts`).
"Outros" é neutro.

### RF-203 — só voto válido entra numa fatia de candidatura

**O sistema deve** contar numa fatia de candidatura (ou somar num partido)
**somente** os votos de candidaturas com destinação `valido`. Os votos de
candidaturas `anulado` e `sub_judice` pertencem à fatia "Anulados e sub
judice" (círculos 2 e 3), nunca a uma fatia com nome de candidato.

### RF-204 — círculo 1: só os votos válidos

**O sistema deve** usar `contagens.validos` como base e exibir as fatias do
RF-202.

**Se** Σ (votos das candidaturas `valido`) ≠ `contagens.validos`, **então o
sistema deve** exibir o texto "não fecha" no lugar do círculo, nunca um círculo
esticado (constituição § 6; mesma regra de `fatiasCirculo1`,
`VotacaoEleitorado.tsx:291-304`).

### RF-205 — círculo 2: sobre quem votou

**O sistema deve** usar `contagens.comparecimento` como base e exibir as fatias
do RF-202 mais **Votos em branco**, **Votos nulos** e **Anulados e sub
judice** (`anulados + sub_judice`).

**Onde** o anulado é fatia própria e distinta de "nulo" (RF-197, spec 021;
hierarquia `tse-ea20-arquivo-de-resultado-unificado.txt:459-468`) — sem ela o
círculo não fecha em `comparecimento`.

**Se** a soma das fatias ≠ `comparecimento`, **então** "não fecha", como no
RF-204.

### RF-206 — círculo 3: sobre o eleitorado inteiro

**O sistema deve** usar `contagens.aptos` como base e exibir as fatias do
círculo 2 mais **Abstenção** e **Ainda não apurado** (`aptos − instalados`).

**Onde** "Ainda não apurado" é incluída por decisão do dono (26/09) —
sem ela, a 25% apurado, 75% do círculo seria um vão sem nome. Mesma subtração
específica do RF-193 (`naoApuradoInstalacao`), nunca "o resto de tudo".

⚠️ Este círculo é **apurado**, não projetado — diferente do arco 3 do painel
"Votação".

**Se** a soma das fatias ≠ `aptos`, **então** "não fecha".

### RF-207 — os estados, e nenhum deles fabrica zero

| no payload | o que é | o que a tela faz |
|---|---|---|
| `votacao.corrida` ausente | **não sabemos** | `<DetailUnavailable>` no lugar dos três círculos |
| `votacao.destino_pendente === true`, **ou** alguma entrada de `corrida` com `votos > 0` e **sem** `destino` | **aguardando a destinação** — o TSE ainda não fez a 1ª totalização parcial | os três círculos em "aguardando a separação dos votos válidos", no DOM |
| `contagens.validos == 0` | **não começou** | círculos 1 e 2 "sem votos apurados" (base zero não vira "0,0%"); círculo 3 segue o RF-206, que nesse estado é quase todo "Ainda não apurado" |
| rota de Senador | **aguardando medição** — ver RF-210 | os três círculos em "aguardando", no DOM |
| resto | **apurando** | RF-204..206 |

Três estados que o dono fixou em 14/09 continuam distintos: ausente ≠ zerado ≠
apurando.

### RF-208 — todo número tem base declarada, e a fonte também

**O sistema deve** exibir em cada círculo o absoluto e o percentual de cada
fatia, e o `<figcaption>` deve nomear a base (RF-196, spec 021).

**O sistema deve** declarar em texto de metodologia que os círculos vêm do
total que o TSE publica para a abrangência e podem diferir por um ciclo dos
votos da lista de candidaturas acima (constituição § 8).

### RF-209 — o payload publica a destinação e a corrida do agregado

**Quando** o produtor monta `votacao` de uma abrangência (nacional ou UF),
**o sistema deve** publicar `votacao.corrida`: uma entrada por candidatura do
arquivo agregado, com número de urna, sigla, votos (`vap`) e destinação
(`dvt` mapeado para `"valido" | "anulado" | "sub_judice"`; ausente enquanto o
TSE não a publicou — **nunca** um default).

**Quando** a abrangência é nacional de Governador ou Senador, **o sistema
deve** publicar `votacao.corrida_por_partido` (Σ `vap` das candidaturas
`valido` por sigla, somando as 27 UFs) **em vez de** `corrida`.

**Quando** qualquer candidatura com `vap > 0` da abrangência (nas 27 UFs, no
caso de `corrida_por_partido`) está sem destinação, **o sistema deve**
publicar `votacao.destino_pendente: true` e **omitir** `corrida_por_partido` —
uma soma por partido sem saber quem é válido seria o número errado do Contexto.

**Quando** o produtor monta `EdgePayloadUf`, **o sistema deve** publicar
`votacao` com `contagens` (do agregado da UF), `corrida` e — **emendado em
2026-09-26 (noite)** — `projetada` pela participação projetada DA UF, porque
o painel "Votação" passou a existir nas telas de UF (spec 021 RF-192
emendado). Deputado (cargo 6) recebe `votacao` por UF **sem** `corrida`, e sem
`projetada` em produção: o ciclo proporcional não calcula participação.

⚠️ Mapeamento de `dvt` sem default silencioso (memória
`feedback_default_silencioso_enum`): valor desconhecido ⇒ a entrada sai **sem**
`destino`, o que põe a tela em "aguardando" (RF-207), e um aviso no log. Nunca
"desconhecido ⇒ válido".

⚠️ **Dois achados da implementação (2026-09-26)**:

1. O dicionário lista um 4º valor de `dvt`, **"Válido (legenda)"** — voto de
   candidatura indeferida que vai para o partido, fato da eleição
   proporcional. Não está no contrato: sai **sem** `destino` e com aviso no
   log, o que põe a tela em "aguardando". Correto para cargo majoritário (onde
   não deve aparecer); se aparecer na noite, a falha é visível, nunca um
   número errado.
2. Na captura real (`br-c0001-e021270-u.json`), Σ `vap` das candidaturas
   `"Anulado"` = 9.075.260, mas `v.van` = 9.218.887: **143.627 votos anulados
   não pertencem a candidatura nenhuma**. Válidos e sub judice batem na
   unidade. Inofensivo aqui porque a fatia "Anulados e sub judice" sai de
   `contagens`, não da corrida (RF-205) — e é por isso que ela NÃO pode passar
   a ser derivada da soma das candidaturas.

### RF-210 — Senado fica em "aguardando" (decisão do dono, 26/09)

**Quando** a rota é de Senador, **o sistema deve** renderizar o painel com os
três círculos em "aguardando", sempre no DOM.

**Motivo**: com duas vagas cada eleitor vota duas vezes, e não há captura real
de Senador no repositório para medir como o TSE conta isso em `vv`/`tv`/`c`. A
fixture do simulado não responde: copia **as mesmas** contagens para os três
cargos. O produtor publica `corrida_por_partido`/`corrida` para Senador mesmo
assim — o bloqueio é só da tela, até a medição.

---

## Fora de escopo

- Projeção dos círculos (é o arco 3 do painel "Votação", spec 021).
- Deputado Federal (RF-200).
- O `return` antecipado da home em produção sem código de eleição (handoff
  26/09 § 1.2).

## Decisões do dono (2026-09-26)

1. **(a) por candidatura + (b) por partido**, Deputado fora — RF-200/201.
2. **Levar a destinação do voto até a tela** (opção A) — RF-203/209.
3. **Destravar os círculos 2 e 3 das telas de UF junto** — RF-209.
4. **Antes da destinação, "aguardando"** — RF-207.
5. **Senado em "aguardando"** — RF-210.
6. **Círculo 3 com "Ainda não apurado"** — RF-206.

## Open questions

1. Senado: como `vv`, `tv` e `c` contam os dois votos por eleitor. Fecha com
   uma captura real de cargo 5 do simulado.
