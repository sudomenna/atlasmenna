---
id: 021-votacao-eleitorado
title: Votação — o eleitorado inteiro em três círculos, apurado e projetado
status: draft
priority: M
personas: [P1, P2, P3]
screens: [T-01, T-03, T-10, T-12]
requirements: [RF-192, RF-193, RF-193b, RF-194, RF-195, RF-195b, RF-195c, RF-196, RF-197, RF-198, RF-199]
depends_on: [001-ingestao-tse, 002-modelo-estatistico, 003-home-nacional, 006-grid-governadores, 016-senador, 017-deputado-federal]
apis: []
components: [VotacaoEleitorado, Panel, DetailUnavailable]
nfr: [RNF-002, RNF-007a, RNF-022, RNF-023, RNF-024, RNF-026]
adrs: [0001, 0017, 0018, 0022, 0031]
amends: [003-home-nacional, 006-grid-governadores, 016-senador, 017-deputado-federal]
ship_blocked_on: []
---

# Spec 021 — Votação: o eleitorado inteiro

**Rotas novas**: nenhuma.
**Superfícies emendadas**: `/` e as quatro telas de UF (`/uf/[sigla]`, `/uf/[sigla]/governador`, `/uf/[sigla]/senador`, `/uf/[sigla]/deputado-federal`). Até 2026-09-26 (tarde) eram as quatro capas nacionais — ver RF-192 emendado.
**Pedido do dono (2026-09-26)**: um painel próprio, **depois da lista de
candidaturas**, nas quatro telas nacionais, com **três** círculos —
(1) sobre os aptos, com o não apurado em cinza; (2) sobre o eleitorado já
apurado; (3) sobre os aptos, com valores **projetados**.

---

## Contexto medido — por que esta spec existe e o que ela NÃO pode inventar

### O dado existe por urna, e não chega à tela

`_extract_zone_participacao` (`api/model/project.py:2085`) já extrai, em
**contagens absolutas**, todos os campos necessários:
`eleitores_aptos`, `eleitores_instalados`, `comparecimento`, `abstencao`,
`brancos`, `nulos`, `validos`, `anulados`, `sub_judice`, `psa`
(`ZonaParticipacaoRaw`, `project.py:2059-2082`).

O payload publicado **não carrega nenhum deles como número absoluto**:
`EdgeParticipacao` (`lib/edge-config/types.ts:183`) só tem percentuais, e
funde brancos com nulos numa métrica única (`brancos_nulos`).

### 🔴 A aritmética oficial do TSE — as quatro fatias NÃO fecham em `te`

Do dicionário oficial
(`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:459-468`):

```
te (Total / aptos) ──> est (Totalizadas) + esnt (Não Totalizadas)
    est ───> esi (Instaladas) + esni (Não Instaladas)
        esi ─> c (Comparecimento) + a (Abstenção)
        esi ─> esa (Apuradas) + esna (Não Apuradas)
tv (Total de votos) ──> vvc (Votáveis) + vb (Brancos) + tvn (Nulos) + vscv
    vvc ───> vv (Válidos) + van (Anulados) + vansj (Sub Judice)
```

Consequências, ambas **medidas**, não deduzidas:

1. **`c + a = esi`, nunca `te`.** Válidos + brancos + nulos + abstenção somam
   o eleitorado das seções **instaladas**, não o total de aptos. O resto
   (`te − esi`) são eleitores de seções ainda não instaladas/totalizadas.
   Medido na captura real do simulado do TSE a 100% apurado
   (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`): `te` 163.079.139
   contra `esi` 163.078.872 — **267 eleitores de diferença**. No fim da noite
   o vão é irrelevante; durante a noite ele é todo o país ainda não contado.
2. **Anulados e sub judice não somem por sair da legenda.** Na mesma captura:
   `vv` 100.982.116 + `vb` 9.118.018 + `tvn` 9.040.537 = 119.140.671, contra
   `tv` 138.863.131. A diferença — **19.722.460 votos, 14,2% do
   comparecimento** — é exatamente `van` 9.218.887 + `vansj` 10.503.573.

### Decisão do dono sobre o vão

Três círculos em vez de um (2026-09-26). O vão deixa de ser problema de
arredondamento e vira **assunto de cada gráfico**: o (1) o nomeia em cinza, o
(2) o exclui do denominador, o (3) o projeta para zero.

---

## Requisitos funcionais

### RF-192 — o painel, e onde ele fica

🔴 **EMENDADO em 2026-09-27, decisão do dono — "A corrida" vem ANTES de
"Votação" em toda tela que tem os dois** (`/`, `/uf/[sigla]`,
`/uf/[sigla]/governador`, `/uf/[sigla]/senador`). Onde as cláusulas abaixo
dizem "imediatamente após o painel de resultado" ou "antes de 'A corrida'",
leia: imediatamente após o painel "A corrida" (spec 022 RF-200). Em
`/uf/[sigla]/deputado-federal`, que não tem "A corrida", "Votação" segue logo
após o painel de resultado. A ordem vale também para os painéis de
indisponibilidade (mesma posição dos de verdade).

**Quando** a rota é uma das quatro telas nacionais (`/`, `/governador`,
`/senador`, `/deputado-federal`), **o sistema deve** renderizar o painel
"Votação" em `<Panel>` próprio, **imediatamente após** o painel de resultado
com a lista de candidaturas e **antes** de qualquer outra seção.

⚠️ `<Panel>` próprio, e não um apêndice do painel de resultado: o painel de
resultado responde "quem está ganhando"; este responde "como o eleitorado se
comportou". Emenda as specs 003/006/016/017 na ordem das seções.

🔴 **EMENDADO em 2026-09-26 (noite), decisão do dono — o painel SAI das capas
nacionais de Governador, Senador e Deputado e ENTRA nas telas de UF.**

**Quando** a rota é `/`, **o sistema deve** renderizar o painel como acima.

**Quando** a rota é `/governador`, `/senador` ou `/deputado-federal`, **o
sistema NÃO deve** renderizar o painel.

**Quando** a rota é `/uf/[sigla]`, `/uf/[sigla]/governador`,
`/uf/[sigla]/senador` ou `/uf/[sigla]/deputado-federal`, **o sistema deve**
renderizar o painel com as contagens **daquela UF** (`EdgePayloadUf.votacao`,
spec 022 RF-209), imediatamente depois do `<ResultPanel>` da UF (na tela de
Deputado, do painel de resultado equivalente) e antes do painel "A corrida"
onde ele existir.

**Onde** o motivo é de conteúdo: o eleitorado do Brasil é praticamente o mesmo
número em todos os cargos — na capa de Governador ele repetia a de Presidente
sem dizer nada sobre a eleição de governador, que é estadual.

⚠️ O arco 3 (projeção) numa UF usa a mesma regra do RF-195 sobre as
contagens e a participação projetada **da UF** (`projetar_fatias_em_contagens`,
`api/model/project.py`). Sem participação projetada na UF, "aguardando
projeção" (RF-195), nunca o número nacional.

⚠️ Senado: com duas vagas cada eleitor vota duas vezes (spec 022 RF-210). Se
as contagens do TSE para cargo 5 não fecharem nas identidades do RF-193/194,
os arcos já devolvem "não fecha" em vez de desenhar torto — a guarda existe e
é o comportamento correto até a medição.

### RF-193 — círculo 1: o eleitorado inteiro, com o não apurado nomeado

**Quando** o painel renderiza o círculo 1, **o sistema deve** usar
`eleitores_aptos` como total e exibir **cinco** fatias, nesta ordem:
votos válidos, votos em branco, votos nulos, abstenção, e **"Ainda não
apurado"**.

**Onde** "Ainda não apurado" = `eleitores_aptos − instalados`, e **somente
isso** — o eleitorado de seções que ainda não foram apuradas.

🔴 **CORRIGIDO em 2026-09-26 (tarde).** A versão anterior definia o residual
como `aptos − (validos + brancos + nulos + abstencao)`, ou seja "tudo o que
sobra", o que enfiava anulados e sub judice dentro de uma fatia chamada "Ainda
não apurado". Ver o RF-197 para a medição que derrubou isso.

⚠️ Com a fatia de anulados separada, o arco 1 passa a ter **seis** fatias, e
elas fecham em `aptos` por **identidade do TSE**, não por subtração de resto:
`instalados = comparecimento + abstencao` e
`comparecimento = validos + brancos + nulos + anulados + sub_judice`, logo
`aptos = (aptos − instalados) + abstencao + validos + brancos + nulos + anulados + sub_judice`.

⚠️ A fatia cinza é **derivada por subtração**, nunca por um campo próprio: é a
única forma de o círculo fechar em 100% por construção, com qualquer
combinação de seções não instaladas e votos anulados. Uma quinta fatia
calculada à parte poderia divergir do total e publicar um círculo que não
soma — constituição § 6.

### RF-193b — antes de a apuração começar, o círculo cinza inteiro

**Quando** o bloco `votacao.contagens` existe com `aptos > 0` e
`validos + brancos + nulos + abstencao == 0`, **o sistema deve** renderizar o
círculo 1 **inteiramente na fatia "Ainda não apurado"** (decisão do dono,
2026-09-26).

🔴 **Isto NÃO é o mesmo estado do RF-198, e colapsar os dois é o erro.** São
os três estados que o dono fixou em 14/09 e que esta base já errou antes:

| no payload | o que é | o que a tela faz |
|---|---|---|
| `votacao` ausente | **não sabemos** — o produtor não publicou | `<DetailUnavailable>` (RF-198) |
| `contagens` com `aptos > 0`, resto `0` | **não começou** | círculo 100% cinza (este RF) |
| qualquer fatia `> 0` | **apurando** | RF-193 normal |

⚠️ O círculo cinza cai fora deste RF por construção assim que o primeiro
boletim chega — não há transição a programar, e **nenhum zero é fabricado**:
o estado "não começou" só é alcançável quando o produtor publicou `aptos` de
verdade. Um `contagens` ausente nunca vira zeros (RF-198).

### RF-194 — círculo 2: só o que já foi apurado

**Quando** o painel renderiza o círculo 2, **o sistema deve** usar
`instalados` como total e exibir **cinco** fatias — válidos, brancos, nulos,
anulados+sub judice, abstenção — sem fatia residual.

🔴 **CORRIGIDO em 2026-09-26 (tarde)**: a base era `validos + brancos + nulos +
abstencao`, que só fecha quando não há voto anulado. `instalados` é a soma
exata das cinco, por identidade do TSE, e é o que o rótulo já dizia ser.

**Onde** o rótulo do total nomeia a base ("eleitorado já apurado"), nunca
"eleitores aptos".

### RF-195 — círculo 3: a projeção para o fim da noite

**Quando** houver base amostral (ao menos uma zona apurada), **o sistema
deve** renderizar o círculo 3 com `eleitores_aptos` como total e as **quatro**
fatias projetadas para o fim da apuração.

**Enquanto** não houver base amostral, **o sistema deve** renderizar o estado
"aguardando projeção" no lugar do círculo, **sempre presente no DOM**
(ADR-0017/ADR-0018).

🔴 **CORRIGIDO em 2026-09-26 — a versão anterior deste RF mandava normalizar
e estava errada por duas ordens de grandeza.** Ela atribuía o vão ao ruído dos
bootstraps ("somam perto de 100%"). Medido na captura real de 100% apurado
(`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`), onde a verdade é
conhecida exatamente:

```
as 4 fatias ....... 143.356.412        aptos ....... 163.079.139
vão ............... 19.722.727
  ├─ anulados + sub judice .. 19.722.460   (99,9986% do vão)
  └─ seções não instaladas ..        267   (0,0014% do vão)
```

O bootstrap responde por **~0,0001%** do vão — as quatro projeções batem a
verdade com erro de +165, +15, +15 e +40 votos. O vão é **voto anulado**, e
voto anulado **não projeta para zero**. A frase "o (3) o projeta para zero",
no § Contexto, vale para 0,0014% do vão.

Fechar em `aptos` exigiria fator 1,1376 e publicaria **114.875.061 válidos
contra os 100.982.116 reais — 13.892.945 votos fabricados**, ao lado do
círculo 2 exibindo o número verdadeiro na mesma tela. Constituição § 6.

**Decisão do dono (2026-09-26): o círculo 3 é o círculo 1 projetado.** As
quatro fatias são publicadas **cruas** e o residual sai **por subtração**, a
mesma regra do RF-193. `EdgeVotacaoProjetada` perdeu o campo
`fator_normalizacao` — um campo que valeria sempre 1 e cuja simples presença
sugeriria uma normalização que não acontece.

⚠️ O cinza do círculo 3 **não vai a zero** no fim da noite: ele estaciona no
tamanho de `anulados + sub_judice`. É a verdade, e o RF-197 já manda declarar
essa soma na metodologia.

⚠️ O residual pode sair **negativo** se as quatro projeções somarem mais que
`aptos`. O consumidor tem de tratar esse caso explicitamente — um arco com
fatia negativa desenha errado em silêncio.

⚠️ O IC95 de cada métrica continua publicado em `EdgeParticipacao`, sobre a
base dela. Não há IC neste bloco, e não é esquecimento.

### RF-195b — o seletor Parcial/Projeção escolhe os arcos (decisão do dono, 2026-09-27)

**Enquanto** a visão ativa do seletor do shell é **"Parcial"**, **o sistema
deve** exibir só os arcos 1 ("Do eleitorado apto") e 2 ("Do eleitorado já
apurado").

**Enquanto** a visão ativa é **"Projeção"**, **o sistema deve** exibir só o
arco 3 ("Projeção para o fim da apuração").

**Onde** o mecanismo é o existente (ADR-0029 § 2): os três arcos continuam no
HTML (ADR-0017) com `data-view-only="parcial"` / `data-view-only="proj"`, e a
cascata de `app/globals.css` esconde o outro — o painel segue Server
Component, sem JS novo (RNF-007a). O texto de metodologia acompanha: frase
sobre o arco 3 só na Projeção, frases sobre arcos 1/2 só no Parcial.

### RF-195c — Senado em votos (decisão do dono, 2026-09-27)

**Quando** o cargo é Senador, **o sistema deve** exibir os três arcos em
**votos, 2 por eleitor**, pela regra da spec 022 RF-210: `aptos`,
`instalados` e `abstencao` multiplicados por `votos_por_eleitor`, base
nomeada "votos (2 por eleitor)". Sem isso, medido, todo arco do Senado
devolve "não fecha" (`tv = 2 × c` nas capturas reais do TSE).

### RF-196 — todo número tem base declarada

**Quando** o painel exibe um percentual, **o sistema deve** exibir junto o
número absoluto e a base sobre a qual o percentual foi calculado.

### RF-197 — anulados e sub judice são fatia PRÓPRIA

🔴 **REVERTIDO em 2026-09-26, pelo dono, depois de ver a tela.** A versão
anterior deste RF mandava mantê-los fora das fatias nomeadas e dentro do
residual. Estava errado por duas razões, e a segunda só apareceu na tela:

1. **São grandes.** Medido: 12,2% dos aptos na projeção da fixture do simulado,
   14,2% do comparecimento na captura real do TSE. Não é cauda.
2. 🔴 **O residual misturava DUAS coisas cuja proporção se inverte ao longo da
   noite.** Medido na mesma fixture, a 25% apurado:

   | | arco 1 | arco 3 (projetado) |
   |---|---|---|
   | ainda não apurado | 118.708.609 (96,1%) | **0** |
   | anulados + sub judice | 4.806.046 (3,9%) | 19.270.021 (**100%**) |

   Ou seja: o rótulo "Ainda não apurado" está quase certo no arco 1 **hoje**, e
   estará tão errado às 23h quanto já está no arco 3 agora — uma fatia com esse
   nome contendo só voto anulado. Um rótulo que só é verdadeiro em parte da
   noite é pior que um rótulo ausente.

**Quando** o painel renderiza qualquer um dos três círculos, **o sistema deve**
exibir `anulados + sub_judice` como **fatia própria e nomeada**, distinta de
"Votos nulos".

**Onde** a distinção não é cosmética, e vem da hierarquia oficial
(`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:459-468`):

```
tv ──> vvc (votáveis) + vb (brancos) + tvn (NULOS) + vscv
   vvc ──> vv (válidos) + van (ANULADOS) + vansj (sub judice)
```

O **nulo** é irmão de "votáveis": o eleitor não escolheu ninguém. O **anulado**
está dentro de votáveis, ao lado dos válidos: o eleitor escolheu alguém, e a
Justiça anulou depois. Ramos diferentes da árvore — a fatia nova não pode
parecer variação de "nulo", nem herdar a cor dele.

⚠️ No **arco 3** o anulado projetado NÃO é publicado: ele **é** o residual.
Isso só é correto porque a projeção é para o FIM da apuração, quando
`aptos − instalados → 0` e sobra apenas o anulado. Quem mexer aqui tem de
manter esse raciocínio escrito no código.

> **Histórico.** A 1ª versão do RF-197 (2026-09-26, manhã) dizia o oposto:
> "manter fora das fatias nomeadas e dentro do residual, declarando a soma no
> texto de metodologia". Foi o pedido original do dono — *"Anulados e anulados
> sub judice pode retirar"* — e ele o reverteu na mesma tarde, ao ver a tela.
> Fica registrado para quem encontrar a regra antiga em algum commit.

### RF-198 — o painel degrada, nunca some

**Enquanto** o payload não trouxer o bloco de contagens, **o sistema deve**
renderizar `<DetailUnavailable>` no lugar dos três círculos, no DOM
(ADR-0017).

### RF-199 — o payload publica as contagens absolutas

**Quando** o orchestrator monta o payload de uma abrangência, **o sistema
deve** publicar as contagens absolutas de `eleitores_aptos`,
`eleitores_instalados`, `comparecimento`, `abstencao`, `brancos`, `nulos`,
`validos`, `anulados` e `sub_judice`.

**Onde** a fonte para as telas nacionais é o **agregado que o próprio TSE
publica** (targets de nível `"br"`/`"uf"`, `lib/tse/targets.ts:61,245,256`).

🔴 **CORRIGIDO em 2026-09-26 — a versão anterior deste § dizia que o pipeline
"já busca" esse arquivo. Ele NÃO busca.** O erro foi meu e foi de forma, não de
conteúdo: o código sabe MONTAR a URL do agregado, e eu li isso como se ele a
PEDISSE. Verificado depois:

- os 4 cargos têm `granularidade: "zona"` (`lib/config/cargos.ts:196,209,222,235`);
- `buildProductionTargetsUf` é inalcançável nesse modo (`targets.ts:771`), e é
  o único caminho até `buildUfTarget`/`buildBrTarget` — os únicos produtores de
  `nivel: "uf"`/`"br"`;
- `scripts/vigia-armado.ts` põe `TSE_GRANULARIDADE` nas variáveis **proibidas**
  no dia D, então o modo que produziria o agregado é vedado justamente em 04/10.

**Decisão do dono (2026-09-26): passar a ingerir o agregado.**

⚠️ **ADITIVO, nunca um modo.** O agregado entra **junto com** as zonas, não no
lugar delas: `compute_uf_projections` (`project.py:2386-2612`) recebe só zonas,
e trocar a granularidade cegaria o modelo. Isto **não** é ligar
`TSE_GRANULARIDADE=uf` — é um nível de target novo, somado aos existentes.

⚠️ **Exige coluna `nivel` em `snapshots`** (migration numerada, manual). Hoje a
tabela não a tem (`lib/db/schema.ts:165-193`), o agregado seria gravado com o
sentinela `cod_zona = 0`, e `_discard_zero_zona_sentinel_when_real_zonas_exist`
(`project.py:368-381`) descartaria a família inteira sempre que houvesse zona
real mais recente — o que é o estado permanente. Sem a coluna, o dado entra e
some.

⚠️ **Achado latente, registrar em `risks.md`**: se uma linha `uf = "BR"` entrar
no banco, `compute_uf_projections` (`project.py:2490-2492`) e
`compute_participacao` (`project.py:3697-3699`) a tratam como **28ª UF**, sem
filtro. O cargo 6 (`project.py:5965-5967`) e `api/model/dado_ts.py:251-255`
filtram `"BR"`; o caminho majoritário não. Hoje é inofensivo porque nenhuma
linha `BR` é produzida — esta mudança é exatamente o que passa a produzi-la.

⚠️ **Custo operacional**: ~28 requisições a mais por cargo por ciclo. A 8 dias
de 04/10, mexer no cano da ingestão é risco que o dono aceitou explicitamente
depois de a alternativa (somar por zona, com guarda de cobertura) ter sido
apresentada e recusada.

⚠️ Nível `"br"` só existe para cargo 1 (`targets.ts:59`). Para Governador,
Senador e Deputado o total nacional é a **soma dos 27 agregados de UF** —
soma de contagens inteiras, exata, sem projeção envolvida.

---

## Fora de escopo

- ~~Telas de UF (`/uf/[sigla]*`).~~ **Entraram no escopo em 2026-09-26 (noite)** — ver RF-192 emendado.
- Série temporal das fatias ao longo da noite — é spec 020, não esta.
- Reabrir o denominador de `abstencao` em `turnout.py` (`eleitores_instalados`,
  `turnout.py:169-170`). Esta spec **lê** contagens; não altera a base de
  nenhuma métrica já publicada.

## Decisões do dono (2026-09-26)

1. **Três círculos, não um** — ver o § Contexto.
2. **Painel próprio, depois da lista de candidaturas** — RF-192.
3. **Fase pré-eleição: mostrar o círculo 100% cinza.** Ver RF-193b.
4. **O 2º turno usa os mesmos aptos.** Confere com o leiaute: cada arquivo do
   TSE é de UM turno (campo `t` do envelope,
   `tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:486`) e carrega o
   seu próprio `e.te`. Na prática **não há nada a implementar**: o payload de
   25/10 lê o `te` do arquivo de 25/10, e `turno` já é parte da chave
   (`EdgePayload.turno`; os targets são por turno). A regra operacional que
   sobra é negativa — **não cachear `te` entre turnos**, o que o pipeline já
   não faz.

## Open questions

Nenhuma aberta.
2. ~~**Turno 2**: `eleitores_aptos` muda entre turnos?~~ ✅ **FECHADA
   (2026-09-26) — a pergunta estava malformada.** Cada arquivo do TSE é de UM
   turno (campo `t` do envelope,
   `tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:486`) e carrega o
   seu próprio `e.te`. Não existe "reusar o número de 04/10 em 25/10": o
   payload de 25/10 lê o `te` do arquivo de 25/10, como já faz para todo o
   resto. Nada a decidir, e nada a implementar além de não cachear `te` entre
   turnos — o que o pipeline já não faz, porque `turno` é parte da chave
   (`EdgePayload.turno`, e os targets são por turno).

## Emendas por specs posteriores

### Spec 022 — A corrida em três círculos (2026-09-26)

O painel "A corrida" (RF-200..210) entra imediatamente **depois** do painel "Votação" em `/` e nas telas de UF de Presidente, Governador e Senador (`/uf/[sigla]`, `/uf/[sigla]/governador`, `/uf/[sigla]/senador`). Desde 2026-09-26 (noite) nenhum dos dois painéis existe nas capas `/governador`, `/senador` e `/deputado-federal` (RF-192 emendado).
