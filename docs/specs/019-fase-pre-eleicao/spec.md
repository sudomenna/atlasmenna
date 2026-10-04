---
id: 019-fase-pre-eleicao
title: Fase pré-eleição — o placar zerado que não finge ser resultado
status: draft
priority: M
personas: [P1, P2, P3, P4]
screens: [T-15, T-16]
requirements: [RF-133, RF-153, RF-154, RF-155, RF-156, RF-157, RF-158, RF-159, RF-160, RF-161, RF-162, RF-163, RF-164, RF-165, RF-166]
depends_on: [002-modelo-estatistico, 003-home-nacional, 006-grid-governadores, 016-senador, 017-deputado-federal, 018-identidade-candidatura]
apis: []
components: [FasePreEleicaoBanner, UfLinksGrid, CandidaturasAguardando, CandidatosGrid, ResultPanel, RaceTypeIndicator, ForecastTransparency, ShellLiveBadge, NationalChoroplethMap, MapViewToggle, MapLegend, RemainingPanel, ChancesPanel, BulletinPanel, StateGroupedTable]
nfr: [RNF-002, RNF-007a, RNF-010, RNF-012, RNF-022, RNF-023, RNF-024]
adrs: [0043, 0012, 0017, 0024, 0029, 0038, 0042]
amends: [003-home-nacional, 004-pagina-uf-presidencial, 005-pagina-uf-governador, 006-grid-governadores, 016-senador, 017-deputado-federal, 018-identidade-candidatura]
ship_blocked_on: []
---

# Spec 019 — Fase pré-eleição

**Rotas novas**: nenhuma.
**Superfícies emendadas**: as quatro telas nacionais de cargo e o selo do shell.
**Mecanismo**: um campo `fase` no payload, um ponto único de leitura, e um
semeador que grava o payload zerado antes de 04/10.
**Decisão**: [ADR-0043](../../architecture/adrs/0043-fase-pre-eleicao-campo-proprio-nao-derivada.md).

## Status

`draft`. Escrita em 2026-09-13, implementada em 2026-09-13/14 conforme as
emendas do dono após leitura linha a linha dos componentes. **Código
implementado**: `lib/config/fase.ts`, `components/atoms/banners/FasePreEleicaoBanner.tsx`,
`components/blocks/UfLinksGrid.tsx`, emendas em `lib/edge-config/reader.ts`,
`app/(pres)/page.tsx`, `components/blocks/ForecastTransparency.tsx` e demais
superfícies mensuradas, **e desde 17/09** `data-pipeline/projection-seed.ts`
(semeador) e `scripts/edge-config-prune.ts` (fiscal) — os 14 RFs da spec têm
cobertura confirmada (`docs/_meta/traceability.md`).

Esta spec **não re-litiga a decisão**. O dono do produto quer o placar zerado
com os candidatos reais — nome, foto, partido, cor — no lugar do texto de
espera, antes de 04/10. A objeção foi levantada por escrito e mantida: um placar
zerado exibe a **forma** de um resultado, e a leitura natural de um humano não é
"ainda não começou", é "começou e ninguém pontuou". A decisão foi confirmada
pelo dono. O que esta spec faz é especificar **como fazer isso sem que a tela
minta** — e nomear, no fim, o risco residual que sobra e que ninguém consegue
eliminar.

## Objetivo

Entre hoje e 04/10/2026 as telas de apuração exibem o estado "aguardando o
primeiro boletim". O dono quer que exibam, no lugar, o placar de verdade — só
que zerado, com os candidatos que a spec 018 já trouxe do TSE.

O problema é que **o produto inteiro foi construído sob a premissa de que existe
apuração**. Os textos, os rótulos, os intervalos de confiança, o selo do topo, a
cor do mapa: todos assumem que há voto. Alimentar essa máquina com zeros não
produz "um placar vazio" — produz **nove afirmações falsas**, medidas abaixo,
que vão de "a apuração está concluída em todas as UFs" a um intervalo de
confiança `[0,0; 0,0]`, que é a forma tipográfica da certeza absoluta.

O objetivo desta spec é: **mostrar identidade sem deixar nenhuma superfície
afirmar medição**.

## Estados — não dois, três

A implementação de 2026-09-13/14 revelou que as telas têm **três** estados,
não dois, e a regra que os separa é simples: **a tela nunca afirma uma causa
que não mediu.**

| estado | como sabemos | o que a tela pode dizer |
|---|---|---|
| **Não começou** | payload traz `fase: "pre_eleicao"` | "A eleição ainda não começou. A votação é em 4 de outubro de 2026." |
| **Não sabemos** | não veio payload — ausência OU falha de leitura | "Esta página ainda não recebeu dados de apuração." + fato de calendário, **sem conjunção causal**. **Nenhum número na tela.** |
| **Está apurando** | payload **sem** `fase` | placar normal, mesmo com `pct_apurado_total: 0.01` |

A regra que atravessa: em "não sabemos" ela fala sobre si mesma, nunca sobre o
calendário — porque essa frase, dita às 21h de 04/10 durante uma falha de rede,
é falsa com toda a autoridade da marca.

## Escopo

### Dentro

- Campo `fase?: "pre_eleicao"` em `EdgePayload` e `EdgePayloadDeputado`, com
  ponto único de leitura.
- Supressão, correção ou reescrita de cada uma das nove superfícies mensuradas.
- Aviso em duas camadas — faixa no topo e texto no lugar de cada zero.
- Semeador do payload zerado no Global Config e fiscal de limpeza.
- A transição de 04/10, e a negativa dura sobre como **não** gateá-la.

### Fora

- **Reabrir a decisão do dono.** Ver [ADR-0043](../../architecture/adrs/0043-fase-pre-eleicao-campo-proprio-nao-derivada.md).
- **Qualquer número de intenção de voto, pesquisa ou favoritismo.** Nada nesta
  fase pode ordenar candidatos por expectativa de desempenho — nem
  explicitamente, nem por efeito colateral de ordenação (RF-161).
- **Deputado Federal semeado.** Decisão do dono, 13/09, registrada como decidida
  em RF-163.
- **Grade de candidatos nas telas nacionais de Governador e Senador.** Decisão
  do dono, 13/09, registrada como decidida em RF-162.
- **As páginas de UF.** Elas continuam sem payload e continuam no estado
  "aguardando dados" da spec 018 (T-14), que já funciona e já é honesto. A
  única mudança que as alcança é a do selo do shell (RF-159), que é global.
- **`/candidatos`, `/sobre-o-modelo`, `/status`, `/manutencao`.** Não exibem
  placar; nada a suprimir. Alcançadas só pelo selo.
- **Reusar `composition.pre_election`.** Negativa dura, em RF-153.

## A tabela de mentiras — medida em 2026-09-13

Esta é a evidência da spec, e é o que justifica cada supressão. Cada linha foi
lida no arquivo, na linha citada, contra o working tree de 13/09. Todas as
afirmações da coluna do meio são o que a tela **diria hoje** se recebesse um
payload zerado.

| # | superfície | a afirmação falsa | arquivo:linha |
|---|---|---|---|
| 1 | `RemainingPanel` (`por_uf: []`) | **"Todas as unidades federativas estão com a apuração concluída."** | `components/blocks/RemainingPanel.tsx:114-117, 183-188` |
| 2 | `RemainingPanel` (rodapé) | "Nenhuma unidade federativa combina apuração pendente com resultado local ainda em aberto." | `:256-258` |
| 3 | `RemainingPanel` (`por_uf` zerado) | "Líder projetado — Fulano (PT)" em UF sem um voto | `:190-244` |
| 4 | `ChancesPanel` | "Fulano vence no 1º turno — **0%**" | `components/blocks/ChancesPanel.tsx:128-130, 170-202` |
| 5 | `BulletinPanel` | 5 linhas com hora `formatTimeHMS(ts)` ao lado de zero voto; IC de 95% **`[0,0; 0,0]`** | `components/blocks/BulletinPanel.tsx:101-133, 181-186` |
| 6 | `RaceTypeIndicator` | **"Disputa entre 0 candidatos"** ao lado de 12 nomes | `components/atoms/badges/RaceTypeIndicator.tsx:41, 64-73` |
| 7 | `ResultPanel` | `<VoteBar>` 100% cinza "Outros" com marcador de 50%; margem "+0,0 pp"; 12 linhas com `rank` que não mede nada | `components/blocks/ResultPanel.tsx:180-186, 271-299, 352-361` |
| 8 | mapa nacional | 27 UFs coloridas com a identidade de `top_candidatos[0]` | `components/blocks/_NationalChoroplethMapImpl.tsx:204, 209, 215-219` |
| 9 | `ShellLiveBadge` | **"AO VIVO" pulsando**, `sr-only` "Apuração ao vivo" incondicional | `components/layout/ShellLiveBadge.tsx:44-54` |

Três leituras que essa tabela obriga:

**(a) A #4 sobrevive à guarda que existe.** `ChancesPanel` tem um guarda —
`has(p)` — e ele funciona: `has(null)` é `false`. Só que `EdgeCandidate.p_fecha_1t`
é declarado `number`, **não anulável** (`lib/edge-config/types.ts:308`), então o
que chega do payload zerado é `0`, e `has(0)` é `true`. O painel renderiza
"vence no 1º turno — 0%" com a barra vazia. É o padrão de
[default silencioso](../../reference/risks.md): a guarda existe, está correta
para o caso que o autor imaginou, e não cobre o que este payload produz.

**(b) A #8 tem guarda, e ela está no ramo errado.** `_NationalChoroplethMapImpl.tsx:204`
guarda zero **só quando `viewMode === "parcial"`**. O default do controle é
`proj` + `winner`, e nesse ramo a cor sai de `top_candidatos[0]` — que num
payload zerado é um candidato qualquer com 0%. O leitor vê o Brasil pintado.

**(c) A #9 já mente hoje, em produção, na tela honesta.** O selo do shell diz
"AO VIVO" e anuncia "Apuração ao vivo" a leitor de tela em **toda** rota,
inclusive na que exibe o parágrafo "ainda não recebemos o primeiro boletim".
Esta é a única linha da tabela que não é um defeito futuro — é um defeito
presente, que esta spec conserta de passagem.

### Duas telas que já renderizam zeros hoje

`/governador` e `/senador` **não têm ramo de espera**. Quando o reader devolve
`null`, elas caem em `emptyPayload()` — `app/(gov)/governador/page.tsx:184-206`
e `app/(sen)/senador/page.tsx:101-123` — e renderizam a estrutura completa com
zeros, hoje, em produção. `/governador:413` já diz "Nenhuma UF se encaixa no
filtro **Todas** no momento", que é a mentira #1 com outra roupa.

Ou seja: para metade das telas desta spec, o estado que o dono pediu **já é o
estado atual**, sem aviso nenhum. Isso muda o enquadramento — esta spec não está
só adicionando um modo novo, está fechando um buraco aberto.

## Requisitos Funcionais

### Contrato e ponto único de leitura

**RF-153 — `fase` no payload, lida em um só lugar, nunca derivada de percentual**

WHEN o payload de qualquer cargo é serializado, the system SHALL aceitar o campo
opcional `fase?: "pre_eleicao"` em `EdgePayload` e `EdgePayloadDeputado`,
tratando **ausência do campo como fase normal**; AND WHEN qualquer superfície
precisa saber em que fase está, the system SHALL perguntar exclusivamente a
`lib/config/fase.ts` (`isPreEleicao`, `faseDoPayload`); AND the system NÃO SHALL
derivar a fase de `pct_apurado_total`, de `ufs_apuradas`, de
`por_uf.length`, de `composition.pre_election` nem de data de calendário.

**Aceitação**:
- Given um payload **sem** o campo `fase` e com `pct_apurado_total: 0.01`, when
  qualquer uma das quatro telas renderiza, then está em **modo normal**:
  `RemainingPanel`, `ChancesPanel` e `BulletinPanel` presentes, mapa colorido,
  selo "AO VIVO". **Este é o teste mais importante da spec** — às 20h01 de
  04/10 o percentual real é 0,01%, e uma tela em modo pré-eleição naquele
  momento é a falha grave desta spec, não a leve.
- Given um payload **sem** `fase` e com `pct_apurado_total: 0` e `por_uf: []`,
  when as telas renderizam, then **também** modo normal — o único campo que
  decide é `fase`. (Este payload é o que `emptyPayload()` produz hoje; a
  mudança de estado dele passa a ser responsabilidade de quem grava, não de
  quem lê.)
- Given um payload com `fase: "pre_eleicao"` e `pct_apurado_total: 37.4`, when
  as telas renderizam, then **modo pré-eleição** — a incoerência é
  responsabilidade do emissor; o leitor não tenta adivinhar qual dos dois
  campos está certo, porque um leitor que adivinha é um leitor que às vezes
  adivinha errado.
- Given `grep` sobre `app/` e `components/`, when o teste estrutural roda, then
  a string `"pre_eleicao"` ocorre **somente** em `lib/config/fase.ts`,
  `lib/edge-config/types.ts`, `data-pipeline/projection-seed.ts` e nos testes —
  **asserção negativa**; a positiva ("o módulo é importado") passa com uma
  comparação literal solta num componente ao lado.
- Given `composition.pre_election`, when alguém propõe reusá-lo como sinal de
  fase, then o teste de contrato **reprova**: o campo é constante `0.0` nos dois
  emissores reais (`api/model/project.py:4051` e
  `api/model/deputado_payload.py:691`) e constante `1` nos dois `emptyPayload()`
  de TypeScript, ou seja, hoje ele **já não mede fase** — e quando a
  [spec 008](../008-interatividade-brushing/spec.md) o tornar dinâmico ele valerá
  ~0,95 em plena apuração, o que faria a tela voltar ao modo pré-eleição no meio
  da noite. É uma rede de segurança de mão única: a guarda parece existir e
  aponta para o lado errado.
- Given `EdgePayload` e `EdgePayloadDeputado`, when o campo é adicionado, then é
  **opcional** em ambos, e um payload pré-019 continua validando —
  `app/api/internal/edge-write/route.ts` aceita e repassa sem exigir.
- Rationale do molde: `lib/config/fase.ts` copia a forma de
  `lib/config/dado-freshness.ts` — tabela estática, funções puras, zero I/O,
  decisão calculada no servidor a partir do que já veio no JSON. É o mesmo
  padrão que o [ADR-0038](../../architecture/adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md)
  estabeleceu para o relógio do dado, aplicado ao estado da corrida.

### Supressão — o princípio "mede ⇒ cala; identifica ⇒ fala"

O critério é único e verificável componente a componente: **se o bloco existe
para comunicar uma medição, ele some; se existe para comunicar identidade, ele
fica.** Não há um terceiro caso, e um bloco novo que apareça no produto depois
desta spec é classificado por essa mesma pergunta.

**RF-154 — Os quatro painéis de medição somem inteiros**

WHILE `isPreEleicao(payload)`, the system SHALL **não renderizar**
`RemainingPanel`, `ChancesPanel`, `BulletinPanel` e `StateGroupedTable` — nem
vazios, nem com placeholder, nem com estado "sem dados".

**Aceitação**:
- Given um payload em fase pré, when cada uma das quatro telas renderiza, then
  os quatro `data-testid` correspondentes **não existem no DOM** — asserção
  negativa por `queryBy…` devolvendo `null`, nunca por `toBeEmpty()`, que
  passaria com o painel presente e vazio.
- Given o payload em fase pré, when a árvore é serializada, then as strings
  `"apuração concluída"`, `"vence no 1º turno"`, `"Líder projetado"` e
  `"combina apuração pendente"` **não ocorrem** em nenhum lugar da página —
  asserção sobre o texto, não sobre o componente, porque um refactor que mova a
  frase para outro bloco deve derrubar o teste.
- Given a supressão, when alguém a implementa devolvendo `null` de dentro do
  painel, then **reprova** a revisão: a decisão é do chamador. Um `null`
  interno condicionado a `fase` colocaria a regra de fase em quatro arquivos e
  violaria o ponto único do RF-153 — e é exatamente assim que a guarda do mapa
  (#8) acabou no ramo errado.
- Given a mesma supressão, when a fase é normal, then os quatro painéis
  renderizam **idênticos** ao que renderizam hoje — o teste compara contra o
  snapshot vigente, porque a regressão barata desta spec é apagar um painel na
  noite de 04/10.
- Rationale, painel a painel: `RemainingPanel` responde "quanto falta apurar" —
  medição; `ChancesPanel` responde "qual a chance" — medição, e é o que a
  constituição § 1 obriga a rotular como não oficial, que em fase pré não tem
  nem o que rotular; `BulletinPanel` é um diário de eventos que não ocorreram;
  `StateGroupedTable` agrupa UFs por status de apuração que não começou.

**RF-155 — `ResultPanel` em modo identidade: sem barra de maioria, sem margem, sem rank**

WHILE `isPreEleicao(payload)`, the system SHALL renderizar `ResultPanel` com
`poles={false}`, **sem** a figura de margem e **sem** a coluna de `rank`,
mantendo nome, partido, foto e cor de cada candidatura.

**Aceitação**:
- Given a fase pré, when o painel renderiza, then **nenhum** `<VoteBar>` existe
  — a barra 100% cinza "Outros" com marcador de 50% é a figura mais eloquente da
  tabela de mentiras: ela desenha uma corrida em que ninguém pontuou.
- Given a fase pré, when o painel renderiza, then a string `"pp"` e o rótulo
  `"Margem"` **não ocorrem** — e o mesmo vale para `"+0,0"`.
- Given a fase pré, when o painel renderiza, then nenhuma linha exibe posição
  ordinal (`1`, `2`, `3`…) ao lado do nome. O `rank` é derivado de
  `pct_projetado` e num payload zerado ele ordena por nada — pior, ordena por
  empate resolvido em desempate arbitrário, o que produz um **falso
  favoritismo** estável entre recarregamentos (constituição § 2).
- Given `poles`, when a implementação o usa, then usa a prop que **já existe**
  (`components/blocks/ResultPanel.tsx:118`, `:243`) — não um segundo caminho.
  `mostrarPoles = poles ?? !multiVaga` já resolve o default; a fase pré só
  precisa passar `false` explícito.
- Given a fase normal, when o painel renderiza, then barra, margem e rank estão
  todos lá, sem mudança.

**RF-156 — `RaceTypeIndicator` conta quem concorre, não quem pontuou**

WHILE `isPreEleicao(payload)`, the system SHALL derivar o número exibido de
`candidatos.length`, e NÃO SHALL aplicar o limiar `pct_projetado >= 0.5`.

**Aceitação**:
- Given 12 candidaturas presidenciais com `pct_projetado: 0`, when o indicador
  renderiza em fase pré, then diz **"Disputa entre 12 candidatos"** — hoje diria
  "0", porque o filtro de `PCT_THRESHOLD_1T` zera a contagem
  (`RaceTypeIndicator.tsx:64-73`).
- Given a fase normal com os mesmos 12 candidatos e distribuição real de
  projeção, when renderiza, then o limiar de 0,5% **continua valendo** — o
  teste roda os dois modos sobre o mesmo array e exige números diferentes; um
  teste só do modo pré passaria com o limiar removido de vez.
- Given `turno === 2` em fase pré, when renderiza, then cai no ramo de fallback
  já existente — não existe 2º turno antes do 1º, e esse ramo não precisa de
  caso novo.
- Given a contagem, when o número é escrito, then vem de `candidatos.length` do
  payload e **não** é literal no JSX (lição D8 da spec 017).

**RF-157 — Mapa: cor neutra na primeira linha de `resolveColor`, controle de vista suprimido, legenda trocada**

WHILE `isPreEleicao(payload)`, the system SHALL devolver `--map-uncounted` na
**primeira linha** de `resolveColor`, antes do `switch` e antes de qualquer
leitura de `viewMode`; AND SHALL não renderizar `MapViewToggle`; AND SHALL
substituir a legenda de partidos por uma legenda de geografia; AND SHALL manter
o mapa e o `UfPicker` na tela.

**Aceitação**:
- Given a fase pré e `viewMode` em **cada um** dos valores possíveis
  (`proj`/`parcial` × `winner`/`margin`/`swing`), when o mapa pinta, then **as
  27 UFs** saem `--map-uncounted` — o teste varre a matriz inteira, porque a
  guarda de hoje (`:204`) cobre só uma das combinações e é exatamente esse o
  defeito.
- Given a guarda, when posicionada, then está **antes** da linha 209
  (`const liderId = …`) — se ficar depois do `switch`, três casos já leram
  `top_candidatos[0]` e um refactor futuro reintroduz a cor sem tocar na guarda.
- Given a fase pré, when a página renderiza, then `MapViewToggle` **não existe
  no DOM** — um controle que alterna entre três vistas idênticas é um controle
  que não controla nada, e sugere ao leitor que há o que ver.
- Given a fase pré, when a legenda renderiza, then não cita partido, nem cor de
  candidato, nem faixa de margem; diz o que o mapa de fato mostra (as unidades
  federativas, e que nenhuma apurou).
- Given a fase pré, when a página renderiza, then o mapa **permanece** e o
  `UfPicker` **permanece** — geografia e navegação são verdadeiras em qualquer
  fase, e tirar o mapa deixaria a tela sem a única coisa que ela pode mostrar
  sem mentir.
- Given a fase normal, when o mapa pinta, then a guarda antiga de
  `parcial && pct_apurado === 0` continua valendo — esta spec **acrescenta** uma
  guarda, não substitui a que existe.

**RF-158 — `ForecastTransparency` vira parágrafo, e não some**

WHILE `isPreEleicao(payload)`, the system SHALL manter o bloco
`ForecastTransparency` na página, substituindo a decomposição numérica por um
parágrafo que diz o que o modelo fará quando houver voto.

**Aceitação**:
- Given a fase pré, when a página renderiza, then o bloco **está presente** —
  a constituição [§ 8](../../constitution.md#8-transparência-metodológica) exige
  "Bloco 'O que está movendo o forecast' presente em toda página com projeção", e
  esta spec não cria exceção a princípio constitucional; é a única superfície da
  tabela que **não** pode sumir.
- Given a fase pré, when o bloco renderiza, then **não** exibe as três frações
  (`pre_election` / `model` / `actual_results`) nem barra nem percentual — elas
  são medição, e em fase pré somariam 100% de coisa nenhuma.
- Given a fase pré, when o bloco renderiza, then o texto usa o **futuro**
  ("quando os primeiros boletins chegarem…"), nunca o presente — e a palavra
  "projeção" aparecendo aqui é exceção registrada e única (ver RF-161).
- Given a fase normal, when renderiza, then volta à decomposição numérica sem
  alteração.

**RF-159 — O selo do shell para de afirmar liveness, para os olhos e para o leitor de tela**

WHEN qualquer rota renderiza, the system SHALL fazer o rótulo visível de
`ShellLiveBadge` vir de custom property publicada pela página; AND WHILE a fase
é pré-eleição, SHALL remover a animação do ponto; AND SHALL resolver o texto
acessível emitindo **os dois textos no DOM** e escondendo um deles com
`display: none`, nunca por `content` de CSS.

**Aceitação**:
- Given uma página em fase pré, when o selo renderiza, then o texto visível
  **não** contém "AO VIVO" nem "ao vivo", e o ponto **não** tem animação —
  `prefers-reduced-motion` já cobre parte disso, mas o problema aqui não é
  movimento, é a afirmação de que algo está acontecendo.
- Given um leitor de tela numa página em fase pré, when percorre o selo, then
  ouve o texto da fase pré e **não** ouve "Apuração ao vivo" — asserção negativa
  sobre o conteúdo acessível.
- Given a implementação, when o texto acessível é trocado, then **não** usa
  `content` de CSS: `content` não conserta texto acessível, é lido de forma
  inconsistente entre leitores de tela, e o próprio cabeçalho do componente já
  documenta isso como a razão de o número não ser anunciado dali
  (`ShellLiveBadge.tsx`, seção "Acessibilidade"). Os dois `<span class="sr-only">`
  existem no DOM; uma custom property decide qual tem `display: none`.
- Given uma rota que **não publica** custom property nenhuma — `/candidatos`,
  `/sobre-o-modelo`, `/status` —, when o selo renderiza, then o fallback
  **não afirma liveness** em nenhuma das duas camadas. O fallback de hoje é
  `"ao vivo"` no `content` e `"Apuração ao vivo"` no `sr-only`
  (`ShellLiveBadge.tsx:44-54`), e essas rotas nunca foram ao vivo, em fase
  nenhuma — esta é a correção do defeito presente, não uma concessão à fase pré.
- Given a fase normal com percentual publicado, when o selo renderiza, then diz
  "23,4% apurado" como hoje, com o ponto animado e o `sr-only` de apuração ao
  vivo — o comportamento de 04/10 é o atual.
- Given o `app/layout.tsx`, when a mudança é feita, then **nenhuma** rota deixa
  de ser pré-renderizada estaticamente: o shell continua sem ler Edge Config,
  `searchParams` ou `cookies()` ([ADR-0025](../../architecture/adrs/0025-design-system-atlas-menna-restyle-in-place.md)),
  e a comunicação continua sendo só a custom property, como o
  [ADR-0029 § 4](../../architecture/adrs/0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md) desenhou.

### O aviso, em duas camadas

Uma camada só não basta, e a razão é a objeção do dono registrada no ADR-0043:
uma faixa no topo é lida uma vez, no primeiro segundo, e depois o leitor rola
para o placar e o interpreta sozinho. A segunda camada existe para que **o
lugar onde o zero estaria** também diga o que está acontecendo.

**RF-160 — Camada A: faixa `FasePreEleicaoBanner`, primeiro filho do `<main>`, não dispensável**

WHILE a página está em fase pré-eleição, the system SHALL renderizar
`FasePreEleicaoBanner` como **primeiro filho** do `<main>`, marcado como
`<section aria-labelledby>`, sem controle de dispensa e sem persistência de
estado.

**Aceitação**:
- Given a página em fase pré, when o DOM é inspecionado, then a faixa é o
  **primeiro elemento filho** de `<main>` — antes do kicker, antes do `<h1>`,
  antes de qualquer painel. O teste é de **ordem**, não de presença: a mesma
  lição do RF-149 da spec 018, onde um teste de presença passaria com a faixa
  enterrada no rodapé.
- Given a faixa, when renderiza, then é `<section aria-labelledby="…">` e **não**
  `role="alert"` — `alert` interrompe o leitor de tela e é para mudança
  inesperada e urgente; um estado estável de semanas anunciado como alerta a
  cada navegação é ruído que treina o usuário a ignorar alertas de verdade
  (RNF-023).
- Given a faixa, when renderiza, then **não** existe botão de fechar, nem `×`,
  nem `localStorage`, nem cookie — um aviso que o leitor pode dispensar é um
  aviso que produz, do segundo acesso em diante, exatamente a tela contra a qual
  esta spec inteira foi escrita.
- Given o texto da faixa, when lido, then afirma que **a eleição ainda não
  começou** e diz a data em que começa; não usa "aguardando", "carregando" nem
  "em breve", que descrevem um sistema, e o leitor precisa de um fato sobre o
  mundo.
- Given `AguardandoNacional` de `/deputado-federal`
  (`app/(dep)/deputado-federal/page.tsx:650`), when renderiza, then a faixa
  **também** está lá, primeiro — aquela tela não tem payload e portanto não tem
  `fase`; o chamador decide (ver RF-163 e design § D5).
- Given a faixa, when a fase é normal, then **não existe no DOM** em rota
  nenhuma.

**RF-161 — Camada B: o texto no lugar de cada zero, e a palavra proibida**

WHILE a página está em fase pré-eleição, the system SHALL substituir o kicker,
o `<h1>` e a `note` do `ResultPanel` por texto de candidatura; AND SHALL ordenar
as candidaturas por **número de urna**; AND a palavra "projeção" (em qualquer
caixa ou flexão) NÃO SHALL ocorrer em nenhuma das quatro telas em fase pré,
exceto no bloco do RF-158.

**Aceitação**:
- Given qualquer uma das quatro telas em fase pré, when o HTML renderizado é
  varrido, then a raiz `projeç`/`projec` ocorre **zero** vezes fora do
  `ForecastTransparency` — **esta é a métrica de aceitação da spec**, medida
  sobre o HTML, não sobre a lista de componentes, porque a palavra pode vazar
  por um `note`, um `aria-label`, um `title` ou uma legenda que ninguém pensou
  em revisar.
- Given a tela em fase pré, when o `<h1>` renderiza, then diz **"Quem está
  concorrendo"** (ou o equivalente daquele cargo), nunca "Apuração" nem
  "Resultado".
- Given a tela em fase pré, when a `note` do `ResultPanel` renderiza, then
  explica que a lista é de candidaturas registradas e que nenhum voto foi
  contado.
- Given as candidaturas, when listadas em fase pré, then a ordem é pelo
  **número de urna**, crescente, estável entre recarregamentos. Ordenar por
  `pct_projetado` zerado produz a ordem do desempate, que o leitor lê como
  ranking (constituição § 2, "sempre na mesma ordem dentro de uma mesma
  corrida"). Número de urna é uma ordem que não carrega juízo e que o leitor
  reconhece da própria urna.
- Given a tela em fase pré, when varrida, then também não ocorrem "apurado",
  "apuradas", "boletim", "intervalo de confiança" nem "chance de" fora dos
  blocos autorizados — o teste é uma **lista negra de vocabulário de medição**,
  varrida sobre o HTML, e ela cresce quando alguém achar uma palavra nova.
- 🔴 **Emenda 2026-09-17 — o caractere `%` deixa de reprovar.** O teste carregava,
  além da lista acima, um `not.toContain("%")` sobre o `<main>` inteiro. Ele
  nunca esteve neste requisito nem em nenhum outro: era rede acrescentada no
  código do teste para impedir a volta de dois números medidos em 13/09.
  **Decisão do dono**: *"0% apurado é uma verdade antes da eleição"* — o leitor
  pode recebê-la, e o que era falso naquele dia não era o zero, era afirmar
  **conclusão, vitória e certeza** sobre ele. Os três casos que a motivavam
  seguem cobertos por guardas que medem a afirmação, não o símbolo:
  `"Apurado 0,0%"` pela palavra "apurado"; `"UFs apuradas 0/27"` por "apuradas"
  e pelo `/27`, que **continua** proibido; `"Fulano vence no 1º turno — 0%"`
  pela frase "vence no 1º turno" do RF-154. Consequência aceita: a escala de um
  eixo ("0%", "50%") passa a ser permitida — foi o que destravou a régua do
  gráfico da [spec 020](../020-evolucao-da-apuracao/spec.md). Se um número de
  **resultado** voltar a vazar com `%` e sem nenhuma dessas palavras, a rede
  volta com o alvo nomeado, nunca com o caractere.
- Given a fase normal, when as mesmas telas renderizam, then a palavra
  "projeção" volta a ocorrer normalmente e a ordem volta a ser por
  `pct_projetado` — o teste roda nos dois modos.

### As três telas que não recebem grade

**RF-162 — Governador e Senador nacionais: 27 links, nenhuma grade de rostos**

WHERE a tela é `/governador` ou `/senador` em fase pré, the system SHALL exibir
27 links para `/uf/<sigla>/governador` e `/uf/<sigla>/senador`, e NÃO SHALL
exibir grade de candidaturas nem nome de candidato.

**Aceitação**:
- Given `/governador` em fase pré, when renderiza, then existem **27** links,
  um por UF, e **nenhum** nome de candidatura no documento — asserção negativa
  sobre nome, porque a positiva ("os 27 links estão lá") passa com uma grade de
  rostos logo abaixo.
- Given `/senador` em fase pré, when renderiza, then o mesmo.
- Rationale (decidido pelo dono em 13/09, **não é opção em aberto**): são **27
  corridas**, não uma. É a mesma razão que produziu o
  [RF-145](../018-identidade-candidatura/spec.md) — no bloco nacional de cargo 3
  e 5, `national.candidatos` é a união de 27 corridas sob o mesmo espaço de
  `id`, e qualquer nome atribuído ali é ambíguo **por construção**. Uma grade
  nacional de rostos de governador não teria uma pergunta que respondesse: 180
  candidaturas publicáveis sem a UF ao lado não formam uma corrida.
- Given os 27 links, when o leitor segue um, then chega a uma página de UF que
  já mostra a grade daquela corrida pelo caminho da spec 018 (T-14) — os rostos
  entram por ali, onde a grade já funciona e já é honesta.
- Given os 27 links, when renderizam, then são uma lista semântica navegável por
  teclado, com o nome da UF em texto (RNF-023, RNF-024).

**RF-163 — Deputado Federal não é semeado, e a tela de espera ganha o aviso**

WHERE o cargo é Deputado Federal, the system SHALL **não** semear payload
nenhum; AND `AguardandoNacional` SHALL ganhar a faixa do RF-160, o selo
corrigido do RF-159 e 27 links para as UFs.

**Aceitação**:
- Given o semeador, when roda, then **nenhuma** chave de cargo `dep` é escrita —
  asserção negativa sobre o conjunto de chaves gravadas, verificada contra o
  store real, não contra a intenção do script.
- Given `/deputado-federal` em fase pré, when renderiza, then o parágrafo
  `data-testid="dep-aguardando"` (`app/(dep)/deputado-federal/page.tsx:665`)
  **continua presente e não é reescrito**, a faixa do RF-160 está acima dele, e
  os 27 links abaixo.
- Rationale (decidido pelo dono em 13/09, **não é opção em aberto**): a tela de
  Deputado Federal lista **cadeiras por partido**, não pessoas. Semeá-la
  produziria "0 cadeiras" para cada legenda — que é a mentira #1 desta spec em
  outra unidade — e **nenhuma identidade ganharia**: a tela não tem onde pôr
  rosto. O ganho que justifica a fase pré nos outros três cargos não existe
  aqui; sobra só o custo.
- Given os 7.221 candidatos a Deputado Federal publicáveis (spec 018), when o
  leitor quer vê-los, then chega por `/uf/<sigla>/deputado-federal` ou por
  `/candidatos?cargo=6`, ambos já existentes.

### Semeadura, fiscal e transição

**RF-164 — O semeador: `por_uf` vazio, ordem `gov → sen → pres`, reentrância fechada**

WHEN o operador roda `data-pipeline/projection-seed.ts`, the system SHALL gravar
o payload zerado com `fase: "pre_eleicao"` e `por_uf: []` para os cargos
Presidente, Governador e Senador, **nesta ordem: `gov`, depois `sen`, depois
`pres`**; AND SHALL recusar a gravação se a chave de destino já existir **sem**
`fase`.

**Aceitação**:
- Given o store vazio, when o semeador roda, then grava as três chaves nomeadas
  `projection-current-<cargo>-t1` e o alias `projection-current`, e o payload
  total fica em **~10 KB** — medido, não estimado, e comparado ao teto do
  Global Config ([ADR-0032](../../architecture/adrs/0032-detalhe-municipal-vercel-blob.md)).
- Given a ordem `gov → sen → pres`, when o semeador termina, then o alias
  `projection-current` aponta para o payload **presidencial**. O writer grava a
  chave nomeada **e** o alias a cada chamada
  (`lib/edge-config/writer.ts:738-740`), então o alias fica com quem escreveu
  por último — e o único leitor do alias é a corrida presidencial
  (`lib/edge-config/reader.ts:131`, `:252`). Trocar a ordem faria a home
  presidencial ler o payload de Senador; o teste afirma **qual cargo** está no
  alias, não que o alias existe.
- Given uma chave de destino que já existe **com** `fase: "pre_eleicao"`, when o
  semeador roda de novo, then sobrescreve normalmente — re-semear é operação
  esperada.
- Given uma chave de destino que já existe **sem** `fase` — ou seja, um payload
  real do orchestrator —, when o semeador roda, then **recusa, não grava nada, e
  falha com erro nomeado**. Esta é a guarda de reentrância, e o modo de falha
  que ela previne é o pior desta spec: rodar o semeador por engano às 21h de
  04/10 apagaria a apuração ao vivo e poria o país inteiro de volta em zero.
- Given o `--force`, when usado, then a recusa acima é a **única** que ele
  levanta, e o uso fica registrado no log do ciclo.
- Given o runner, when o script é executado, then roda por `tsx`, como os
  demais de `data-pipeline/`.
- Given qualquer payload semeado, when inspecionado, then `por_uf` é `[]` — o
  semeador **não** inventa 27 linhas zeradas. Linhas em `por_uf` são a matéria
  prima das mentiras #1, #2 e #3 da tabela; não produzi-las é mais barato e mais
  seguro que suprimir os painéis que as leem, e as duas defesas coexistem de
  propósito.

**RF-165 — Fiscal de limpeza: `scripts/edge-config-prune.ts`**

WHEN o operador roda `scripts/edge-config-prune.ts`, the system SHALL listar e
remover do Global Config as chaves que ainda carregam `fase: "pre_eleicao"`, e
SHALL nunca tocar em chave sem esse campo.

**Aceitação**:
- Given um store com chaves semeadas e chaves reais misturadas, when o fiscal
  roda, then remove **só** as que têm `fase: "pre_eleicao"` — asserção sobre o
  conjunto que sobrou, não sobre o que foi apagado.
- Given o fiscal, when roda sem argumento, then **lista e não apaga**; apagar
  exige confirmação explícita.
- Given uma chave semeada que foi sobrescrita por payload real, when o fiscal
  roda, then ele não a encontra — porque ela já não tem `fase` — e isso é o
  caminho normal: o fiscal existe para o caso em que a transição do RF-166 **não**
  aconteceu para algum cargo, não para o caso feliz.
- Rationale: sem o fiscal, um cargo cujo orchestrator falhe em 04/10 fica com o
  payload de setembro no ar, com a faixa "a eleição ainda não começou" por cima,
  enquanto o país vota. O fiscal é a alavanca manual de 30 segundos que o
  runbook precisa ter.

**RF-166 — A transição de 04/10: o primeiro upsert real apaga a fase**

WHEN o orchestrator grava qualquer payload, the system SHALL **nunca** emitir o
campo `fase`; AND WHEN o primeiro payload real de um cargo é gravado sobre a
chave semeada, the system SHALL substituí-la por inteiro, de modo que a fase
deixe de existir para aquele cargo.

**Aceitação**:
- Given `api/model/project.py` e `api/model/deputado_payload.py`, when o
  payload é serializado, then a chave `fase` **não** ocorre — asserção negativa
  sobre o JSON emitido; um emissor que escrevesse `fase: null` ou
  `fase: "normal"` passaria num teste positivo e falharia aqui.
- Given a chave semeada de um cargo, when o orchestrator escreve o primeiro
  payload real daquele cargo, then a gravação é **substituição integral** do
  valor, não merge — um merge preservaria `fase` do valor antigo e a tela ficaria
  em modo pré-eleição com dado real por baixo, indefinidamente, sem alarme.
- Given `pct_apurado_total: 0.01` às 20h01, when a tela renderiza, then está em
  modo normal (é o mesmo caso do RF-153, repetido aqui de propósito, porque a
  regressão pode entrar pelos dois lados: pela leitura e pela escrita).
- Given os três cargos semeados, when o primeiro deles vira real e os outros dois
  ainda não, then a tela do cargo real está em modo normal e as outras duas
  continuam em fase pré — a transição é **por cargo**, não global, porque os
  crons são independentes e um deles atrasar não pode arrastar os demais.
- Given a transição, when o operador quer conferir, then `/status`
  ([spec 012](../012-dashboard-status/spec.md)) mostra quais chaves ainda
  carregam `fase` — o operador não deve precisar abrir quatro abas para saber.

**RF-133 — Sem dado, a tela DIZ que não há dado, e não inventa número**

> **Emendado pelo [ADR-0076](../../architecture/adrs/0076-placar-zerado-antes-do-primeiro-boletim.md) (04/10/2026):** nos casos chave ausente, `fase: "pre_eleicao"` ou lista de candidatos vazia, a tela abre no leiaute de apuração zerado (sem frase de espera); o texto de espera abaixo vale só para **falha de leitura**.

> **Formalizado em 2026-09-19, e por isso fora da faixa desta spec (RF-153-166).**
> O ID **já era citado** em `docs/reference/risks.md` desde 13/09, ao registrar a
> correção do incidente em que `app/(pres)/page.tsx` renderizava a fixture do
> modelo **incondicionalmente**, ignorando `NODE_ENV` — o site publicou resultado
> eleitoral inventado. A citação nomeava um RF que **nunca existiu**: varredura
> de 19/09 não o achou em spec, matriz, índice nem código.
>
> Preservar o número em vez de renumerar foi decisão de 19/09 porque 133 já
> estava **queimado** (ninguém poderia reusá-lo sem colidir com a citação), e
> porque não há número livre no fim da faixa da 019 — RF-167 já é da spec 020.
> Qualquer escolha seria ilha; esta ao menos torna verdadeira uma referência que
> já circulava. A lacuna RF-132/134-139 continua livre.

WHEN uma tela de qualquer cargo não tem payload, ou tem payload sem apuração,
the system SHALL exibir uma frase que **declara a ausência de dado** — hoje
"Aguardando o primeiro boletim" —, e SHALL **nunca** exibir número de voto,
percentual de apuração ou projeção que não tenha vindo de boletim do TSE; AND the
system NÃO SHALL recorrer a fixture, a semente ou a qualquer valor de
conveniência para preencher esses campos fora de `NODE_ENV === "development"`.

**Aceitação**:
- Given produção sem payload, when a home renderiza, then o texto de espera
  aparece **e** nenhum número de voto ou percentual de apuração está no DOM — a
  asserção negativa é o que discrimina: uma tela que mostrasse "0%" passaria num
  teste que só procurasse a frase.
- Given `NEXT_PUBLIC_MODEL_FALLBACK_TIER=remote` e o modelo indisponível, when a
  home renderiza, then exibe a espera, **não** a fixture do modelo. É o caso
  exato do incidente de 13/09, e a razão de este RF existir.
- Given `total_cadeiras: 0` no payload de Deputado, when a tela renderiza, then
  ela **não** escreve "0 cadeiras em disputa" — ausência de contagem não é
  contagem zero (`app/(dep)/deputado-federal/page.tsx`, ramo de espera).
- Given a tela de espera, when o leitor a lê, then ela diz **o que vai acontecer**
  ("a contagem aparece quando o primeiro boletim chegar"), não só que algo falta:
  é a mesma exigência de transparência da constituição § 8 aplicada ao estado
  vazio.

**Cobertura hoje** (a comportamento já está no ar; o que faltava era a norma):
`tests/integration/home-page.test.tsx:626` e
`tests/unit/pages/fase-pre-eleicao.test.tsx:472`.

⚠️ **Este RF é o irmão de RF-153/RF-166 pelo outro lado.** Aqueles governam a
fase pré-eleição, que é um estado **declarado** no payload; este governa a
ausência de dado, que é a **falta** de payload. A distinção importa porque os dois
produzem telas parecidas por motivos opostos, e confundi-los é o que faz alguém
"consertar" um exibindo a fixture do outro. Ver [ADR-0043](../../architecture/adrs/0043-fase-pre-eleicao-campo-proprio-nao-derivada.md).

## Requisitos Não-Funcionais

- **RNF-002 (CLS)** — a faixa do RF-160 é o primeiro filho do `<main>` e empurra
  todo o conteúdo para baixo. Ela é renderizada **no servidor**, com altura
  determinada por conteúdo, e nunca aparece depois da hidratação; um banner que
  entra no cliente é CLS medido exatamente onde mais dói.
- **RNF-007a (bundle above-the-fold, medido em 2026-09-14: 17,6 KiB de 150 KiB aplicação na home, 23,3 KiB em `/uf/SP`, folga de ~130 KiB)** — Medição anterior de "148,7 KiB de 150, folga de 1,3 KiB" era anterior ao ADR-0030 (08/09), que mudou o orçamento de "total above-the-fold" para "total menos o piso de framework (153.482 B)". Esta spec é **toda de supressão**, e `FasePreEleicaoBanner` e `UfLinksGrid` são Server Components sem JavaScript de cliente. Supressão de `MapViewToggle` renderizado (RF-157) oferece delta ~neutro (o componente é importado no topo do módulo, o bytecode permanece; o delta não é negativo, é ~neutro); o teste (`tests/e2e/perf-budget.spec.ts`) mede, não estima.
- **RNF-010 / RNF-012 (degradação)** — a fase pré **não** é degradação. Se o
  Global Config estiver indisponível, as telas caem no caminho de espera que já
  existe, sem faixa de fase pré (que afirmaria um fato sobre o calendário com
  base numa falha de rede).
- **RNF-022 (contraste)** — a faixa usa tinta do kit com contraste medido; não
  reusa o âmbar de `DadoParadoBanner`, que significa "algo está errado" e aqui
  nada está.
- **RNF-023 (alternativa textual e semântica)** — `<section aria-labelledby>` e
  não `role="alert"` (RF-160); os dois `sr-only` do selo (RF-159); a lista
  semântica dos 27 links (RF-162).
- **RNF-024 (teclado)** — os 27 links são navegáveis por teclado, em ordem de
  documento; a faixa não é focável (não tem controle).
- **Constituição [§ 2](../../constitution.md#2-neutralidade-política)** — a ordem
  por número de urna do RF-161 é o cumprimento literal de "sempre na mesma ordem
  dentro de uma mesma corrida". Cor de partido continua vindo de
  [ADR-0024](../../architecture/adrs/0024-paleta-editorial-por-partido.md).
- **Constituição [§ 8](../../constitution.md#8-transparência-metodológica)** — o
  RF-158 existe por causa dela: o bloco de transparência é o único que não pode
  sumir.

## Telas

| Tela | O que é | Onde |
|---|---|---|
| **T-15** | Fase pré-eleição **com** placar de identidade — faixa, `ResultPanel` sem medição, mapa neutro, `ForecastTransparency` em prosa | `/` (Presidente) |
| **T-16** | Fase pré-eleição **sem** placar — faixa + 27 links para as UFs | `/governador`, `/senador`, `/deputado-federal` |

Ambas são **estados**, não rotas: entram por composição dentro de T-01, T-09 e
T-11, que já existem. Nenhuma rota é criada por esta spec.

A grade de rostos das páginas de UF continua sendo **T-14** (spec 018), sem
mudança de comportamento — mas com uma consequência de fiação que o design § D5
resolve: o gatilho de T-14 hoje é "não há payload", e para Presidente o
semeador faz o payload existir.

## Open questions

1. **"6 chaves" é 6 nomes distintos ou 6 upserts?** O desenho aprovado diz "6
   chaves (~10 KB)". A leitura de `lib/edge-config/writer.ts:738-740` produz, para
   três cargos, **3 chaves nomeadas + 1 alias = 4 nomes distintos**, escritos em
   **6 upserts** (cada chamada grava a nomeada e o alias). Esta spec adota a
   leitura de 4 nomes / 6 upserts, que é a que o código sustenta, e o RF-164
   afirma o conteúdo do alias em vez de contar chaves. Se a intenção era 6 nomes
   distintos — por exemplo semeando também turno 2 —, é preciso dizer qual é o
   6º e por quê; semear turno 2 antes do turno 1 parece errado por construção.

2. **Onde mora a decisão de fase nas três telas sem payload.** ✅ **FECHADA
   2026-09-14**. `AguardandoNacional` de `/deputado-federal` (RF-163) ganhou a
   faixa, e o chamador (`app/(dep)/deputado-federal/page.tsx:650+`) decide
   incondicionalmente `<FasePreEleicaoBanner variante="sem_dados">` naquele
   ramo. A alternativa (gate por data de calendário) foi rejeitada e não é
   reaberta. O RFC-160 esclarece que nenhum componente **infere** fase: quem sabe
   o estado é quem tentou ler o Global Config.

3. **`/governador` e `/senador` hoje não têm ramo de espera** — caem em
   `emptyPayload()` (`:184-206` e `:101-123`). Depois desta spec, o semeador
   passa a alimentá-las, mas `emptyPayload()` continua lá como fallback para
   quando o Global Config falhar. ✅ **FECHADA 2026-09-14**: `emptyPayload()`
   foi **removido** — a página agora monta um ramo de espera de verdade com a
   faixa (`FasePreEleicaoBanner variante="sem_dados"`) e os 27 links
   (`UfLinksGrid`). Vive em `app/(gov)/governador/page.tsx` e
   `app/(sen)/senador/page.tsx`, substituindo o que estava em linhas
   `:184-206` e `:101-123` do design anterior.

4. **`por_uf: []` e a home presidencial.** O RF-164 grava `por_uf` vazio, e os
   painéis que o leem são suprimidos pelo RF-154. Mas `_NationalChoroplethMapImpl`
   também o lê para montar o mapa, e o comportamento dele com `por_uf: []` (27
   UFs sem `row`) não foi medido — o fallback de UF sem row é
   `--map-uncounted`, que é o resultado desejado, mas isso precisa ser
   **verificado no browser**, não deduzido. Se já for neutro sem a guarda, o
   RF-157 continua necessário como rede: `por_uf` pode voltar a ser populado.

5. **Quanto tempo a fase pré fica no ar.** Não decidido. Semear em 20/09 e
   semear em 03/10 são produtos diferentes: quanto mais cedo, mais leitor forma a
   impressão de "placar zerado" antes de haver qualquer voto, que é justamente o
   risco residual do § Riscos. Uma data de ligamento fecha a exposição.

## Riscos

| # | risco | mitigação | residual |
|---|---|---|---|
| R1 | **O leitor entende "começou e ninguém pontuou".** Um placar zerado exibe a forma de um resultado; a leitura natural de um humano não é "ainda não começou". | Faixa não dispensável (RF-160), `<h1>` "Quem está concorrendo" (RF-161), supressão de todo vocabulário de medição (RF-161), nenhuma barra e nenhum rank (RF-155). | 🔴 **Assumido pelo dono e NÃO eliminável.** As mitigações reduzem a probabilidade; não a zeram. Um leitor que chega por link direto, rola até o placar e não lê a faixa pode sair com a impressão errada. Isso é consequência da decisão de produto, foi objetado por escrito, e a decisão foi mantida. Registrado aqui para que ninguém depois o descubra como surpresa. |
| R2 | **Semeador rodado por engano durante a apuração** apaga dado real. | Guarda de reentrância do RF-164 (recusa se a chave existe sem `fase`), `--force` registrado em log. | Baixo. A guarda é fail-closed e o teste injeta o caso. |
| R3 | **A transição não acontece para um cargo** e a tela fica em setembro enquanto o país vota. | Substituição integral no upsert (RF-166), fiscal `edge-config-prune` (RF-165), visibilidade em `/status`. | Médio. Depende de alguém **olhar** o `/status` na noite. Entra no runbook como item de checagem às 20h05. |
| R4 | **Alguém "conserta" a fase gateando em `pct_apurado_total === 0`.** É a mudança mais natural do mundo para quem chega depois e não leu o ADR. | Negativa dura no RF-153 com teste dedicado (payload sem `fase` + `pct: 0.01` ⇒ modo normal). | Baixo, **se o teste existir**. Sem ele, alto — é a mutação que esta spec mais teme. |
| R5 | **Supressão sobrevive à transição** e um painel some na noite de 04/10. | Cada RF de supressão tem critério espelhado no modo normal (RF-154, RF-155, RF-156, RF-157, RF-158); os testes rodam nos dois modos sobre o mesmo payload. | Baixo. |
| R6 | **Vocabulário de medição vaza** por `aria-label`, `title`, `alt` ou legenda que ninguém revisou. | A métrica do RF-161 é varrida sobre o **HTML renderizado**, não sobre a lista de componentes. | Baixo, e a lista negra cresce quando alguém achar palavra nova. |
| R7 | **`emptyPayload()` das telas de Governador e Senador** cai em modo normal e exibe a mentira #1 quando o Global Config falhar. | Removido: as duas páginas agora montam um ramo de espera de verdade com `FasePreEleicaoBanner variante="sem_dados"` e `UfLinksGrid`. Implementado em 2026-09-14. | ✅ **FECHADO.** Não bloqueia mais `shipped`. |

## Contradições não resolvidas (registradas, aguardando decisão)

Achados em 2026-09-14 durante sincronização — **não foram editados**, apenas
reportados para o dono da decisão.

| # | Contradição | Escopo | Dono da decisão | Ação |
|---|---|---|---|---|
| **C1** | **RF-156 × código em 2º turno.** O RF afirma que `turno === 2` em fase pré "cai no ramo de fallback já existente". **Não cai**: `RaceTypeIndicator` nomeia duas pessoas — "Segundo turno entre X e Y" — a partir da ordem do array, com zero voto contado. É falso favoritismo estável, a mesma classe que a constituição § 2 proíbe (RF-155 removeu dela do rank). Existe teste vigente travando o comportamento atual. | RF-156 (especificação) | Dono da implementação + designer de teste | Verificar se o comportamento de 2T em fase pré foi testado; se teste passa sem validar ordinalidade (só valida existência de duas pessoas), é mutação a cuidar. |
| **C2** | **RF-161 × o segmentado do shell.** O critério manda medir "sobre o HTML renderizado", e a palavra "Projeção" continua nos **bytes** do DOM no controle do shell, removida só por `display:none`. Sem conserto dentro do desenho vigente (`app/layout.tsx` não pode ler a fase sem tirar 55 páginas do pré-render — ADR-0025 §§ 2 e 5). | RF-161 (métrica de aceitação) | Dono de spec / constitucionalista | Esclarecer fronteira de medição: medir sobre `<main>` innerText ou sobre `page.content()`? Primeira é viável hoje; segunda exige redesenho do layout. |
| **C3** | **Colisão de alvo de toque** entre barra inferior de cargos (`<nav>` do shell) e primeira linha de `UfLinksGrid` em `/senador` e `/deputado-federal`, mobile 412×823 px. | WCAG 2.2 (fora do escopo declarado 2.1 AA) | Accessibility lead | Triage: WCAG 2.1 AA vs. 2.2. Se 2.1 for teto, deixar. Se 2.2 for obrigatório, separar. |
| **C4** | **`tests/e2e/a11y-audit.spec.ts` não visita `/senador` nem `/deputado-federal`.** Ponto cego antigo (anterior a spec 019). | a11y gate (cobertura) | QA/a11y lead | Estender e2e audit pra rotas novas antes de shipped. |
| **C5** | **Open question 5: quanto tempo a fase pré fica no ar.** Semear em 20/09 vs. 03/10 produzem experiências diferentes. Não foi decidida na implementação de 14/09. | Timing operacional | Dono de produto | Deliberar: qual data de semadura minimiza o risco residual de R1 (leitor confundir com resultado) vs. janela de "parecer desligado"? |

## Cross-refs

- [ADR-0043](../../architecture/adrs/0043-fase-pre-eleicao-campo-proprio-nao-derivada.md) — a decisão, a objeção registrada e por que `composition.pre_election` não serve
- [ADR-0012](../../architecture/adrs/0012-edge-config-chaves-nomeadas.md) — chaves nomeadas por cargo e turno, e o alias dinâmico que o RF-164 depende
- [ADR-0017](../../architecture/adrs/0017-transparencia-total-3-camadas.md) — "um bloco de página com payload não some quando a fonte dele falha"; a supressão do RF-154 **não** é o caso que ele proíbe (ver design § D3)
- [ADR-0029](../../architecture/adrs/0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md) § 4 — o selo do shell e a custom property, que o RF-159 estende
- [ADR-0038](../../architecture/adrs/0038-dado-ts-hora-do-dado-nao-hora-do-calculo.md) — precedente de "o relógio do dado, não o do cálculo"; `lib/config/dado-freshness.ts` é o molde de `lib/config/fase.ts`
- [ADR-0042](../../architecture/adrs/0042-cargo-uf-numero-chave-identidade-candidatura.md) — a chave de identidade que alimenta o placar zerado
- [Spec 018](../018-identidade-candidatura/spec.md) — de onde vêm nome, foto, partido e cor; RF-145 é o precedente direto do RF-162
- [Design 019](./design.md) — onde cada mudança entra, o contrato do semeador e os testes que discriminam
- Constituição [§ 1](../../constitution.md#1-conformidade-regulatória-tse), [§ 2](../../constitution.md#2-neutralidade-política), [§ 7](../../constitution.md#7-resiliência-operacional), [§ 8](../../constitution.md#8-transparência-metodológica)
