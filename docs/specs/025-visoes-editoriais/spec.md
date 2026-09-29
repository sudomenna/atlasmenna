---
id: 025-visoes-editoriais
title: Visões editoriais — hemiciclo por bloco, Senado e Câmara de 2027, impeachment, palanques, renovação, filtro e etiquetas nas telas
status: implementing
priority: S
personas: [P1, P2, P3]
screens: [T-02, T-09, T-10, T-13]
requirements: [RF-240, RF-241, RF-242, RF-243, RF-244, RF-245, RF-246, RF-247, RF-248, RF-249, RF-250, RF-251, RF-252, RF-253]
depends_on: [023-senado-2027, 024-etiquetas-editoriais, 006-grid-governadores, 017-deputado-federal, 004-pagina-uf-presidencial, 005-pagina-uf-governador, 011-sobre-o-modelo, 016-senador, 018-identidade-candidatura]
apis: []
components: [HemicicloPorBloco, SenadoDe2027Panel, Camara2027Panel, RenovacaoPanel, EtiquetaFiltro, PalanquesMapa, EtiquetaEditorial, EtiquetasLinha, EtiquetasAviso, GovernorCard, ResultPanel, CandidateResultRow, CandidatosGrid]
nfr: [RNF-002, RNF-007a, RNF-012, RNF-022, RNF-023, RNF-024, RNF-025, RNF-035]
adrs: [0024, 0049, 0051, 0053, 0055, 0057, 0059, 0060, 0061, 0062]
amends: [006-grid-governadores, 017-deputado-federal, 004-pagina-uf-presidencial, 005-pagina-uf-governador, 011-sobre-o-modelo, 024-etiquetas-editoriais]
ship_blocked_on: [critérios do dono para campo ideológico, palanque presidencial, centrão e impeachment (hoje "em definição" — nenhuma etiqueta dessas categorias vai à tela), canal de correção de redação, revisão final da constituição 1.6 pelo dono]
---

# Spec 025 — Visões editoriais

**Rotas novas**: `/sobre-as-etiquetas` (metodologia das etiquetas).
**Rotas emendadas**: `/senador` (T-09), `/governador` (T-02), `/deputado-federal`,
`/uf/[sigla]/governador`, `/uf/[sigla]/senador` (T-10), `/candidatos` (T-13),
`/sobre-o-modelo`.

**Pedido do dono (2026-09-28/29)**: com as etiquetas da spec 024 no lugar, mostrar
"quem terá maioria" no Senado e na Câmara de 2027 por relação com o governo Lula,
o placar do impeachment de ministros do STF, o mapa dos palanques, a renovação do
Senado, um filtro por etiqueta nas capas, as etiquetas ao lado dos candidatos, e a
página pública de critérios. Cada visão entra no ar **quando ficar pronta**,
inclusive durante a apuração — sem deploy (ADR-0060).

## Objetivo

Quero ver, com a fonte e a data ao lado, como o Senado e a Câmara de 2027 se
dividem entre base, independentes e oposição ao governo Lula e quão perto cada
lado está dos limiares de votação — sem que nenhuma etiqueta mude a ordem de
candidato, entre no modelo, apareça como "a classificar" ou vá ao ar antes de o
critério dela estar publicado e de todos os candidatos com chance estarem
classificados.

## Contexto

- **Infraestrutura pronta** (spec 024): catálogo, compilador, leitor (Blob + cópia
  do build), portão de cobertura, vigia e os três átomos (`EtiquetaEditorial`,
  `EtiquetasLinha`, `EtiquetasAviso`) — tudo desligado.
- **Hemiciclo generalizado** (spec 023, ADR-0061): `Hemiciclo` genérico,
  `ARCOS_SENADO = 5`, ângulo por cadeira e `marcaDeLimiar`, que já avisa quando a
  marca cai dentro de uma coluna (maioria absoluta: 41 no Senado, 257 na Câmara).
- **Constituição 1.6** (ADR-0059): § 2 (a)–(h) — em particular (a) critério escrito
  publicado ANTES do uso, (d) paleta neutra com piso de ΔE, (e) etiqueta nunca muda
  ordem, (f) "a classificar" nunca exibido e agregado só com o portão; § 8 —
  `/sobre-as-etiquetas` obrigatória, com link em toda superfície.
- **Critérios do dono publicados hoje**: `relacao_governo` (regra 65/35/30 nas
  votações disputadas + padrão do partido) e `trajetoria_cargo` (mapeamento do
  ADR-0058). Campo ideológico, palanque presidencial, centrão e impeachment ainda
  **sem critério** — medido no catálogo em 29/09.
- **Armadilha da spec 024 (open question 5)**: a cópia do build saía com todas as
  chaves desligadas e, com versão mais nova depois de um deploy, vencia a última
  publicação — o deploy apagava as visões em silêncio. Fechada aqui (RF-253).

## Escopo

**In**
- `HemicicloPorBloco` e as marcas de limiar (V1, Câmara 2027).
- V1 (Senado de 2027 por bloco), V2 (impeachment), Câmara 2027, V4 (renovação do
  Senado), a ligação do V3 (mapa dos palanques, componente de outra frente) à capa
  `/governador`.
- Etiquetas nas listas: cartões das capas, páginas de UF (Governador, Senador),
  `/candidatos`.
- Filtro por etiqueta em `/senador` e `/governador`.
- Aviso em toda superfície com etiqueta; página `/sobre-as-etiquetas`; parágrafo
  com link em `/sobre-o-modelo`.
- Critério publicado como porta de exibição (RF-250).
- Chaves por visão da cópia do build a partir do `publicar.json` versionado
  (RF-253, emenda à spec 024).

**Out**
- O componente do V3 (`PalanquesMapa`, `_palanques.ts`) — outra frente; aqui só a
  ligação na página.
- V4 de Governador (não há trajetória de governador nos dados; `governador.csv`
  vazio).
- Câmara 2027 deputado a deputado depois do resultado (a bancada nacional é por
  agremiação; a conferência dos 513 eleitos é W3) — pendência no `tasks.md`.
- Etiqueta na página de UF de Deputado Federal e de Presidente (Presidente não tem
  categoria no catálogo).
- Os critérios que o dono ainda não mandou; o preenchimento das classificações.
- `docs/_meta/*`, `docs/README.md`, `docs/design-system/components.md` (barreira,
  `spec-syncer`).

## Requisitos funcionais

### Hemiciclo por bloco

**RF-240 — Visão por bloco: ordem fixa, sem cor, "governo Lula" escrito**

WHEN uma visão por bloco é desenhada, the system SHALL ordenar as cadeiras pela
ordem fixa do catálogo (`ORDEM_BLOCOS_HEMICICLO`: Base do governo Lula →
Independentes → cadeiras sem dono → Oposição ao governo Lula), independentemente da
ordem de entrada e da apuração; SHALL distinguir os blocos por textura em tinta
neutra (`--text-primary` cheia, hachurada, vazada sobre `--surface-card`; cinza com
contorno tracejado para a cadeira sem dono) — nunca por cor de partido nem por tom
de cinza intermediário; SHALL nomear os blocos com "governo Lula"; e SHALL dizer, no
`<desc>`, que a posição reflete a relação com o governo Lula, não posição
ideológica. Acessibilidade: `role="img"`, `<title>`/`<desc>` e `aria-describedby`
apontando para o placar e para a lista de limiares, que existem no documento.

**Aceitação**:
- Given entradas em qualquer ordem, then a sequência de blocos no SVG é a do catálogo.
- Given o componente, then nenhum `--party-*`, `textForParty` ou hex próprio aparece
  nele, e a tinta passa ΔE76 ≥ 10 contra toda cor de partido nos dois temas.
- Given 81 cadeiras, then o HTML fica abaixo de 12 KiB; 513, abaixo de 36 KiB.

**RF-241 — Marcas de limiar: do total, entre a cadeira k−1 e a k, empate dito**

WHERE a visão é por bloco, the system SHALL desenhar, fora do arco externo, as
marcas de maioria absoluta (⌊N/2⌋+1), três quintos (⌈3N/5⌉) e dois terços (⌈2N/3⌉)
calculadas do TOTAL da casa — 41/49/54 com 81, 257/308/342 com 513 —, contadas da
esquerda, no ângulo entre a cadeira k−1 e a k; IF a marca cai dentro de uma coluna
(empate de ângulo — a maioria absoluta nas duas casas), the system SHALL usar uma
varredura com desempate tolerante por arco (arco interno primeiro), desenhar a
marca no ângulo da coluna e um traço curto tangencial entre o último arco de antes e
o primeiro de depois, e dizer em texto quantas cadeiras da coluna ficam antes; e
SHALL escrever o placar dos DOIS lados para cada limiar ("Base do governo Lula 34 —
faltam 7 para 41"; idem para a Oposição). A visão por partido (`CamaraHemiciclo`,
`SenadoHemiciclo`) continua SEM marca (ADR-0049 item 6, ADR-0061 item 4).

**Aceitação**:
- Given 81 cadeiras, then as marcas são 41 (empate, antes = arcos 1 e 3, depois =
  arco 4), 49 e 54; given 513, 257 (empate), 308 e 342.
- Given a marca de 49, then exatamente 49 cadeiras ficam à esquerda dela.

### Visões agregadas

**RF-242 — V1, "Senado de 2027: quem terá maioria"**

WHERE a chave `v1` está ligada, o critério de `relacao_governo` está publicado e o
portão passa (candidatos com chance nas 27 corridas + os 27 com mandato até 2031,
todos classificados em relação ao governo), the system SHALL mostrar em `/senador`,
logo depois do hemiciclo por partido de 81 cadeiras, o mesmo Senado por bloco:
os 27 pela etiqueta de cada senador (`senado:CODIGO`), as vagas em disputa pela
etiqueta de quem as ocupa na derivação da spec 023 (mesma função, `vagasDerivadas`),
as demais como "aguardando apuração"; IF qualquer condição falhar, OR a derivação
da spec 023 recusar o payload, the system SHALL não renderizar nada.

**Aceitação**:
- Given a chave desligada, then o HTML do painel é vazio.
- Given um candidato com chance sem classificação, then vazio e uma linha de log.
- Given tudo classificado, then 81 cadeiras, soma por bloco = 81, texto com "governo Lula".

**RF-243 — V2, impeachment de ministros do STF no Senado de 2027**

WHERE a chave `v2` está ligada, o critério de `impeachment_stf` está publicado e o
portão passa para `impeachment_stf` nos mesmos 81, the system SHALL mostrar a barra
com a marca de dois terços (54 = ⌈2·81/3⌉, CF art. 52, parágrafo único), o placar
qualificado ("Posição pública sobre impeachment de ministros do STF: a favor — N de
81") e a lista das 81 cadeiras (por UF; dentro da UF, quem segue até 2031 primeiro)
com a posição, a fonte e a data; senão, nada.

**Aceitação**:
- Given o catálogo de hoje (sem critério de impeachment), then nada, mesmo ligada.
- Given critério e cobertura, then 81 linhas, cabeçalho qualificado, link de fonte por linha.

**RF-244 — Câmara 2027 por bloco**

WHERE a chave `camara2027` está ligada, o critério de `relacao_governo` está
publicado e toda agremiação com cadeira > 0 tem padrão classificado, the system
SHALL mostrar em `/deputado-federal`, depois do plenário por partido (inalterado), a
Câmara por bloco: cada cadeira de `bancada.por_agremiacao` com o padrão da
agremiação (partido → padrão do partido, caindo na federação do cadastro; federação
do payload — apelido do EA20, "FE BRASIL" — casada com a do cadastro pelos
partidos-membro, que precisam apontar para a mesma federação), as não atribuídas
como "ainda sem dono", e a lista das agremiações com bloco, fonte e data.

**Aceitação**:
- Given "FE BRASIL" com PT, PCdoB e PV, then o padrão de `federacao:PT/PC DO B/PV`.
- Given uma agremiação com cadeira sem padrão, then nada.

**RF-249 — V4, renovação do Senado**

WHERE a chave `v4` está ligada, o critério de `trajetoria_cargo` está publicado e,
em cada UF com a apuração concluída (`pct_apurado` ≥ 100), a corrida INTEIRA está
classificada em trajetória (e os vencedores têm `sqcand`), the system SHALL mostrar
quantas das vagas dessas UFs foram para quem não ocupava a cadeira (a PESSOA — eleito
cuja trajetória não é "tenta a reeleição"), quantas trocaram de partido contra a foto
dos 54 de hoje (número secundário), os eleitos de cada UF com a trajetória, e quem
tentava a reeleição e ficou sem vaga; nunca "eleito" solto.

**Aceitação**:
- Given AC concluída com PL (tenta a reeleição) e PT (estreante) eleitos, e PL + MDB
  hoje, then 1 mudou de mãos, 1 trocou de partido, MDB na lista de quem perdeu.
- Given nenhuma UF concluída, then nada.

**RF-251 — V3, mapa dos palanques na capa de Governador**

WHERE a chave `v3` está ligada, o critério de `palanque_presidencial` está publicado
e o portão passa para o palanque NO TURNO da página nas corridas de Governador, the
system SHALL ler o payload nacional de Presidente (uma leitura, só depois das três
portas) e mostrar `PalanquesMapa` nas duas bases, abaixo do painel "1º ou 2º turno";
senão, SHALL não ler o payload de Presidente nem desenhar nada.

**Aceitação**:
- Given o critério de palanque ausente (hoje), then nenhuma leitura de Presidente.

### Etiquetas nas telas

**RF-245 — Chips nas listas, sem mexer na ordem**

WHERE a chave `chips` está ligada, the system SHALL mostrar as etiquetas das
categorias de chip (campo ideológico, palanque presidencial do turno, relação com
o governo Lula, Centrão só quando `sim`, trajetória no cargo) — só as de critério
publicado e só classificadas — ao lado do nome: nos cartões das capas `/governador`
e `/senador`, só para quem tem chance na corrida (`comChance`); nas páginas de UF
de Governador e Senador e em `/candidatos`, para toda candidatura. A etiqueta SHALL
ser `<span>` de texto, nunca interativa (no `/senador` o cartão é um `<a>`), SHALL
ficar dentro do `<span>` do nome no cartão sem mudar o contrato estrutural da linha,
e SHALL nunca mudar a ordem das linhas, das corridas ou das regiões.

**Aceitação**:
- Given o auxiliar de invariância de ordem, when aplicado ao cartão e ao painel de
  UF, then passa.
- Given a chave desligada, then o cartão e o painel saem idênticos aos de antes.

**RF-246 — Impeachment sempre qualificado**

The system SHALL exibir a etiqueta de `impeachment_stf`, em qualquer superfície,
com a frase inteira visível — "Posição pública sobre impeachment de ministros do
STF: a favor" —, nunca o valor sozinho; e SHALL mostrá-la só em superfícies do
Senado (página de UF de Senador, `/candidatos` com cargo Senador, V2), nunca nos
cartões da capa.

**RF-247 — Filtro por etiqueta**

WHERE a chave `filtro` está ligada, the system SHALL oferecer em `/senador` e em
`/governador` (ao lado do filtro de status) um `<select>` nativo com um `<optgroup>`
por categoria (só categorias com critério e só valores presentes na página); SHALL
esconder, por CSS, as corridas inteiras que não carregam o token escolhido — o
componente escreve só `data-filtro` no próprio invólucro, e cada corrida carrega os
tokens dos candidatos com chance em `data-etq` —, NUNCA reordenar nem mover nó;
em `/senador`, SHALL esconder também a região sem nenhuma corrida no filtro; em
`/governador`, SHALL manter a região com o consolidado (que continua somando todos
os estados, ADR-0057); SHALL anunciar a contagem em `aria-live`; e sem JavaScript
ou sem `:has()`, SHALL deixar tudo visível. A página `/senador` continua estática
(sem `searchParams`).

**Aceitação**:
- Given o CSS do filtro, then há uma regra por token do catálogo, e toda regra é
  só `display: none`.
- Given uma escolha no `<select>`, then a ordem dos nós da página não muda.

**RF-248 — Aviso em toda superfície com etiqueta**

WHERE uma superfície mostra etiqueta ou visão editorial, the system SHALL mostrar
`EtiquetasAviso` (texto literal do dono + link para `/sobre-as-etiquetas`): uma vez
na seção de corridas das capas, dentro do painel de resultado da página de UF, sob a
grade de `/candidatos` e em cada painel de visão.

**RF-250 — Critério publicado é porta de exibição**

IF uma categoria não tem critério escrito no catálogo (`CRITERIOS`), the system
SHALL não exibir etiqueta nenhuma dela (o átomo devolve nada), não oferecê-la no
filtro, não liberar visão agregada que dependa dela e dizer na metodologia
"Critério em definição — nenhuma etiqueta desta categoria é exibida" — verdade por
construção, não por coincidência de nenhuma linha estar revisada (constituição 1.6
§ 2 (a)).

**Aceitação**:
- Given o catálogo de hoje, then só relação com o governo e trajetória podem ir à tela.

**RF-252 — Página de metodologia e o link em `/sobre-o-modelo`**

The system SHALL publicar `/sobre-as-etiquetas` com: o que a etiqueta é e nunca faz;
o catálogo com o critério de cada categoria (do catálogo) ou "critério em
definição"; a política de fontes e as três origens (individual, regra derivada,
padrão do partido); o portão de cobertura; o método do alinhamento (65/35/30, corte
da Câmara 03/09/2026, corte do Senado lido de `alinhamento-senado.json` quando
existir) e da trajetória; a data da foto do Senado; a tabela de TODAS as
classificações no ar com fonte, data, revisão e origem (as de categoria sem critério
contadas à parte); o registro de alterações (as 50 mais recentes + link para o
arquivo inteiro); limitações; e o canal de correção (o repositório público que o
site já cita — nenhum e-mail inventado). `/sobre-o-modelo` SHALL ganhar UM
parágrafo com link, na seção de limitações, sem `<h2>` novo.

### Publicação

**RF-253 — Chaves por visão da cópia do build = `publicar.json` versionado**
*(emenda aos RF-228 e RF-231 da spec 024; ADR-0060, emenda de 29/09)*

WHEN o compilador roda, the system SHALL gravar na cópia do build as chaves de
`editorial/etiquetas/publicar.json` (ausente ou inválido ⇒ erro de compilação),
FORA do `conteudo_sha256` (ligar uma visão não gera versão nem histórico); the
system SHALL honrar essas chaves na leitura, qualquer que seja a fonte escolhida
(Blob ou build); e o publicador SHALL recusar publicar quando `publicar.json`
divergir das chaves da cópia do build.

**Aceitação**:
- Given o dono ligou `v1` em `publicar.json`, compilou e publicou, when um deploy leva
  uma compilação mais nova, then a cópia do build vence pela versão e a V1 continua ligada.
- Given `publicar.json` alterado sem recompilar, when publica, then recusa.

## Requisitos não-funcionais aplicáveis

- [RNF-002](../../nfr/performance.md) — nenhuma leitura nova no caminho do LCP do
  cliente; as leituras de etiqueta são no servidor, com Data Cache de 60 s; o V3 só
  lê Presidente depois das três portas; tudo abaixo da dobra.
- [RNF-007a](../../nfr/performance.md) — só o filtro é cliente (~1–2 KB); visões zero JS.
- [RNF-012](../../nfr/availability.md) — Blob fora ⇒ cópia do build, com as chaves dela.
- [RNF-022/023/024/025](../../nfr/accessibility.md) — texto e textura, não cor;
  `role="img"` + lista paralela; nada interativo dentro de link.
- [RNF-035](../../nfr/accessibility.md) — tinta neutra ≥ 3:1 contra o papel.

## Open questions

- ? **Critérios do dono** para campo ideológico, palanque presidencial, centrão e
  impeachment — sem eles, por RF-250, essas categorias ficam fora da tela, e o V2 e o
  V3 não aparecem. O critério mora no código (`CRITERIOS`, catálogo): publicá-lo
  exige deploy — precisa entrar ANTES da virada de 03/10 para valer na noite.
- ? **Canal de correção.** O site não expõe e-mail de redação ("será publicado em
  Sobre o modelo antes do dia da eleição"); a página aponta para o repositório
  público. Confirmar com o dono.
- ? **Peso dos chips em `/governador`.** Pior caso medido: +4,3 KiB de HTML por
  cartão (4 linhas × 5 chips + tokens) ⇒ ~116 KiB nos 27 cartões, antes de gzip.
  Hoje, com 2 categorias exibíveis, ~15 KiB. Aceitável? Se não, cortar categorias
  nos cartões.
- ? **Câmara 2027 depois do resultado**: deputado a deputado exige ler os 27 payloads
  de UF em `/deputado-federal` (ou um agregado novo) — W3.
- ? **Região escondida pelo filtro em `/senador`** (instrução da frente) vs. região
  mantida em `/governador` (coerência com o filtro de status, ADR-0057 item 5).
  Confirmar que o dono quer os dois comportamentos.
