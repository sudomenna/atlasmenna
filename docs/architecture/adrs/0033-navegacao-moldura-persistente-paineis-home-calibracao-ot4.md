---
id: ADR-0033
title: Moldura persistente para o mapa entre rotas de UF, não SPA do protótipo nem troca de página inteira — conjunto de painéis da home fiel ao protótipo e OT-4 reportado como faixa de sensibilidade, não ajuste do fixture sintético
status: accepted
date: 2026-09-08
amends: 0029
amended_by: [ADR-0050, ADR-0056] # 0050: premissa de clique da Decisão 1, só no desktop; 0056: variante `frame` sem cromo sobreposto, só no celular
---

# ADR-0033 — Moldura persistente para o mapa entre rotas de UF, não SPA nem troca de página inteira

## Status

Aceito. **Nota 2026-09-19 (parcial, [ADR-0050](0050-clique-em-uf-desktop-navega-mobile-gaveta.md)).**
A premissa entre parênteses da Decisão 1 abaixo ("sem alterar o mecanismo de clique já decidido nesta
sessão") deixa de valer **no desktop**: o clique numa UF volta a navegar direto via `router.push`, em
vez de abrir a `<StateResultSheet>`. Segue o precedente de supersessão parcial já registrado no
[ADR-0017](0017-transparencia-total-3-camadas.md) `## Status`: este ADR mantém `status: accepted`
porque a decisão como um todo — a moldura persistente em `layout.tsx` de grupo de rotas, o mapa nunca
desmontando entre Brasil e UF do mesmo cargo — continua majoritariamente vigente e é, aliás, a razão
técnica pela qual o ADR-0050 escolhe `router.push` (navegação soft dentro da mesma moldura) e não um
`<a href>` cru. No mobile, o clique/toque continua abrindo a folha exatamente como esta Decisão 1
descreve; nada mais nesta Decisão 1, nem as Decisões 2 e 3, é tocado por essa nota.

**Nota 2026-09-27 (parcial, [ADR-0056](0056-mapa-celular-cromo-em-fluxo-versao-b.md)).** A
composição da variante `frame` do `<NationalMapBlock>` — "o mapa é a coluna inteira e todo o cromo
é overlay", reproduzida em `components/blocks/NationalMapBlock.tsx:98-102` como leitura desta
Decisão 1 — passa a valer **só no desktop** (≥ 960px). No celular, o cromo (título, seletor de
vista, `<UfPicker>`, "← Brasil", legenda) sai da sobreposição e vai para fluxo abaixo do mapa
(barra "Vista/Escolher UF" + legenda resumida + "Ver legenda" em folha). O restante da Decisão 1 —
moldura persistente em `layout.tsx`, mapa nunca desmontando entre Brasil e UF do mesmo cargo,
resolução client-side de `sigla` — não é tocado.

Decisão 3 **implementada em 2026-09-11**: `scripts/replay-sensitivity.ts` (novo) roda o
replay 2022 sob `REGIONAL_DELAY` ∈ {0, 1, 2, 3} timesteps (parametrizado via
`REPLAY_REGIONAL_DELAY` em `scripts/build-replay-fixtures.ts`, default 3, o gate oficial
inalterado) e grava a faixa medida em
[docs/testing/replay-sensitivity.md](../../testing/replay-sensitivity.md). O gate OT-4 continua
`FAIL` no ponto oficial (`delay=3`) — esta decisão muda **como o gate é reportado**, não o
veredito.

**Nota 2026-09-11 ([ADR-0035](0035-par-municipio-zona-unidade-de-ingestao.md) D1/D2).** No mesmo dia,
a ingestão TSE passou a ser por par (município, zona), com `api/model/zona_merge.py` somando os pares
de volta em zona antes do estimador. Os números desta faixa de sensibilidade (medidos com
`replay-sensitivity.ts`) foram usados pelo ADR-0035 como prova de que essa mudança de ingestão não
tocou o modelo: o ponto oficial (`delay=3`) reproduziu 2,3624pp/82,5% contra os 2,3623pp/82,5% de
referência aqui registrados — idêntico ao dígito, dentro de arredondamento. Este ADR não é alterado
em mais nada por essa nota; a Decisão 3 e a tabela de `docs/testing/replay-sensitivity.md` permanecem
como estavam.

Este ADR **emenda o ADR-0029** — a nota de emenda ao seu `## Status`, reproduzida na
Decisão 1 abaixo, foi aplicada diretamente por este documento (sem a restrição de processo que o
próprio ADR-0029 se impôs sobre 0017/0018 — aqui não há essa restrição). Não emenda nem supersede o
[ADR-0028](0028-corrida-explicita-por-rota.md) nem o [ADR-0012](0012-edge-config-chaves-nomeadas.md):
a Decisão 1 é construída **sobre** os dois, não como alternativa — a corrida continua explícita por
rota, o namespacing de chave por cargo/turno não muda. Também não toca o
[ADR-0021](0021-extrapolacao-do-apurado-sem-2022.md)/[ADR-0023](0023-pos-estratificacao-por-porte-de-zona.md)
(método do estimador): a Decisão 3 é sobre o **fixture de replay**, um artefato de teste, não sobre
o modelo em produção.

Este documento reúne três decisões do usuário tomadas na sessão de 2026-09-08, sobre assuntos
distintos — navegação (Decisão 1), composição de painéis da home (Decisão 2) e o gate OT-4
(Decisão 3) — registradas juntas porque nasceram da mesma comparação lado a lado entre a
implementação e o protótipo do kit Atlas Menna ("quero seguir exatamente o protótipo") e da mesma
pressão de calendário: fechar antes do simulado 1 (15–17/09/2026).

> **Nota de emenda ao ADR-0029 (D17, 2026-09-08).** A exceção aberta pelo item 6 daquele ADR — o
> hero de seis termômetros (`<ProjectionThermometers />`, ADR-0018) manter seu conteúdo e apenas
> **reposicionar** para abaixo do bloco de mapa, em vez de adotar a composição de hero do próprio
> protótipo (mapa + `Figure` "Apurado" + `Figure` "Margem" + `VoteBar` + linhas de candidato,
> descrita no Contexto daquele ADR) — foi **revogada** pelo usuário nesta data: o hero da home volta
> a ser o do protótipo. Este ADR **não** resolve, em nome do usuário, a tensão entre essa reversão e
> as quatro razões pelas quais o ADR-0018 rejeitou originalmente o duelo top-2 como hero do 1T
> multi-candidato (esconder o 3º colocado competitivo; omitir participação; misturar denominadores
> `v.vvc`/`e.c`/`e.esi`; IC de "Outros" incorreto por subtração de resamples) — razões que o próprio
> ADR-0029 reafirmou como vigentes um dia antes desta reversão (`0029-...md:55`, "o padrão do próprio
> protótipo reproduz exatamente o problema (i) e (ii)"). O ADR-0018 **não é emendado nem revogado**
> por esta nota: seu texto permanece como está. Cabe à implementação (e, se a equipe concluir que o
> conteúdo do hero muda — não só sua posição —, a um ADR de acompanhamento que reavalie
> explicitamente essas quatro razões) reconciliar a mudança. Registrado aqui como pendência aberta,
> não como decisão resolvida.

## Contexto

### Navegação e composição da home — medição de hoje

O usuário rodou novamente o protótipo (`docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx`)
lado a lado com a implementação e mediu: **home em 7.180px no mobile contra 3.147px do protótipo
(2,3×)** — pior que os 6.770px medidos em 07/09 pelo ADR-0029, apesar daquele ADR já ter reordenado
o mapa para o topo. O aumento reflete painéis novos adicionados depois do ADR-0029 (Cenários,
Redutos, Falta apurar, Placar por estado — "S07/Bloco 1") que a reordenação de posição, sozinha, não
compensa.

Três divergências estruturais adicionais, todas conferidas no disco:

**(1) Colunas.** O protótipo é grid de duas colunas no desktop
(`App.jsx:372`, `gridTemplateColumns: 'var(--sidebar-w) 1fr', height: '100vh'` — painéis rolam à
esquerda, mapa fixo à direita). A implementação é coluna única em todos os breakpoints
(`app/page.tsx:289`, `className="mx-auto flex max-w-page flex-col ..."`, sem `md:flex-row` nem
`md:grid-*` em nenhum ponto do arquivo). Os tokens `--sidebar-w`, `--mobile-max` e `--content-max`
**não existem** em `app/globals.css` (`grep` confere as três ausências). Esta divergência **não é
revista por este ADR** — o ADR-0029 já decidiu deliberadamente manter coluna única nos dois
breakpoints (`0029-...md:43`), e nada nesta sessão reabre essa decisão.

**(2) Ordem e conjunto de painéis.** No protótipo (`App.jsx:337-359`), a ordem é Result → Chances →
Strongholds → Remaining → Bulletin (`BulletinPanel` por último, `App.jsx:355`). Na implementação
(`app/page.tsx`), a ordem hoje é: Mapa (linha 316) → Resultado com Composição de Outros inline
(linha 355) → **Boletim** (linha 443, terceiro, não último) → Cenários condicional (linha 454,
inexistente no protótipo) → Redutos/Strongholds (linha 464) → Falta apurar/Remaining (linha 467) →
Unidades federativas/DecisiveUFsGrid (linha 474, inexistente no protótipo) → Placar por
estado/StateGroupedTable (linha 482, inexistente no protótipo) → Metodologia → Leitura do modelo →
Footer. `ChancesPanel` — 2º painel no protótipo (`App.jsx:350`) — **já existe como componente**
(`components/blocks/ChancesPanel.tsx`, com teste em `tests/unit/components/ChancesPanel.test.tsx`) e
já é usado em `/uf/[sigla]/page.tsx` e `/uf/[sigla]/governador/page.tsx`, mas **não está na home**
(`grep` em `app/page.tsx` não encontra `ChancesPanel`).

**(3) Navegação.** O protótipo navega inteiramente por estado do React, nunca tocando o endereço:
zero ocorrências de `pushState`/`history`/`location` em `App.jsx`. Clique no mapa faz `setUfSel`
(`App.jsx:311`); voltar é um botão "Brasil" desenhado sobre o próprio mapa (`App.jsx:313`), que
chama `goBack` (`App.jsx:303`). O mapa (`window.MapView`, `App.jsx:310`) nunca é desmontado — é o
mesmo componente React do início ao fim da sessão, só muda o `level`/`shade` que ele recebe.

A implementação, hoje, faz o oposto do protótipo, mas por um caminho mais sutil do que "troca de
página inteira" ingênua: uma decisão do usuário tomada **mais cedo nesta mesma sessão de 08/09**
(comentário em `components/blocks/_NationalChoroplethMapImpl.tsx:32-37` e
`components/blocks/StateResultSheet.tsx:4-8`) já havia mudado o clique no mapa de navegação direta
para abrir uma `<StateResultSheet>` (folha com resumo), com um botão "Ver detalhes do estado"
(`StateResultSheet.tsx:248`, `<Link href={...}>` do `next/link`) fazendo a navegação real. Como
`next/link` já é navegação client-side do App Router (não um `<a href>` cru forçando reload de
documento — a distinção que o comentário de `_NationalChoroplethMapImpl.tsx:36` registra é sobre
**semântica de link real e indexável**, não sobre soft/hard navigation), o problema não é o
mecanismo do clique — é que `app/page.tsx` e `app/uf/[sigla]/page.tsx` são dois `page.tsx`
**irmãos**, sem `layout.tsx` compartilhado entre eles além do `RootLayout` global. O App Router
desmonta a árvore de um `page.tsx` inteira ao navegar para outro `page.tsx`; como `HomeClientShell`
(que hospeda o mapa nacional) vive dentro de `app/page.tsx` (linha 317) e o mapa da página de UF
vive dentro de `app/uf/[sigla]/page.tsx`, o mapa sempre desmonta e remonta na transição — mesmo já
usando `next/link`, mesmo a folha já evitando um clique-navega-direto.

### Calibração do gate OT-4 — medição de hoje

O gate OT-4 (spec 002) reprova: **MAE@1h PT 2,3623pp; cobertura IC95 82,5%** contra os limiares
`< 2pp` e `≥ 90%` (`docs/sprints/2026-S07-f6-simulado-hero-1t.md:506` registra a medição anterior de
07/09, 2,590pp/79,5% — a medição de hoje já reflete trabalho de diagnóstico adicional na mesma
frente). Decompondo o erro por UF: **o DF responde por 17,0% do erro total; Norte + Nordeste por
72,7%**. O fixture de replay (`scripts/build-replay-fixtures.ts`) é sintético desde a reescrita da
Fase 5 (`:11`, "Os snapshots zona-a-zona reais sumiram do CDN do TSE") e usa um atraso regional fixo
codificado como constante: `REGIONAL_DELAY = 3` (`:129`, "Norte/Nordeste relatam 3 timesteps mais
tarde"). Zerar esse parâmetro faz o gate passar nos dois critérios: **MAE@1h PT 1,342pp, cobertura
93,3%** — medido, não estimado.

O próprio arquivo já continha, desde a reescrita da Fase 5 (06–07/09), uma advertência escrita antes
desta sessão contra exatamente esse movimento (`scripts/build-replay-fixtures.ts:46-48`): *"Resultado
esperado: MAE@1h MAIOR que os 0,998pp tautológicos — isso é o gate ficando honesto, não o modelo
piorando. Não ajustar os parâmetros de viés/ruído abaixo para 'melhorar' o MAE artificialmente."* A
medição de hoje prova que o atalho **funcionaria** — zerar `REGIONAL_DELAY` derruba o gate para
verde — o que torna a tentação mais concreta, não menos, e é exatamente por isso que o usuário
precisou decidir explicitamente em vez de deixar a advertência do comentário sozinha sustentando a
disciplina.

Esta não é a única frente aberta sobre o OT-4: `docs/sprints/2026-S07-f6-simulado-hero-1t.md:355`
(Fase 7b) já registra uma hipótese concorrente, não resolvida — a tabela `eleitorado` está inflada
21,8% de forma desigual por UF (SP 1,454×, BA 1,018×) porque o importador não filtra turno, e isso
pesa a agregação nacional. As duas frentes (atraso regional sintético; peso de UF inflado) são
investigações independentes sobre a mesma reprovação; este ADR decide só a primeira.

## Decisão

### 1. Navegação: moldura persistente com mapa nunca desmontado, endereço sempre muda ("jeito C")

Nem o modelo do protótipo (SPA por estado do React, endereço nunca muda) nem o modelo de hoje (cada
`/`, `/uf/[sigla]`, `/governador`, `/uf/[sigla]/governador` é um `page.tsx` irmão, o mapa desmonta e
remonta a cada troca de UF). O mapa passa a viver numa **moldura persistente do app** — um
`layout.tsx` de rota (ou grupo de rotas, sintaxe `(grupo)` do App Router, que não altera a URL) que
envolve `page.tsx` de Brasil e de UF do mesmo cargo — em vez de dentro do `page.tsx` de cada rota
individual. Como o App Router **não desmonta** um segmento de `layout.tsx` quando só o `page.tsx`
filho muda, o mapa passa a sobreviver à navegação de "Brasil" para "UF" e de volta.

Escopo desta decisão: cobre a transição **dentro do mesmo cargo** — Presidente (`/` ↔
`/uf/[sigla]`) e, separadamente, Governador (`/governador` ↔ `/uf/[sigla]/governador`), que hoje já
usam componentes de mapa **diferentes** entre nacional e UF (`NationalChoroplethMap` vs. os
componentes de spec 004/005 — `ChoroplethMapUF`, `UFMapDuo`, `BubbleMap`). A troca de **cargo**
(Presidente ↔ Governador ↔ Senador ↔ Deputado, via `<CargoTabs>`/`<TabBar>`, ADR-0029 § 3) não é
coberta — é uma mudança de contexto maior, com domínio de dado diferente, e o achado do usuário (o
mapa "some" ao trocar de UF) foi especificamente sobre a transição de UF, não de cargo.

Como se resolve concretamente, sem alterar o mecanismo de clique já decidido nesta sessão
(`StateResultSheet.tsx:248`, `next/link` — nenhuma mudança necessária aqui):

- O mapa nacional hoje recebe `rows`/`candidatos` como **props vindas de `app/page.tsx`** (Server
  Component, leitura de Edge Config em tempo de render — `app/HomeClientShell.tsx:46-64`). Um
  `layout.tsx` acima de `/` e `/uf/[sigla]` **não** recebe automaticamente o parâmetro `sigla` da
  rota filha via `params` do servidor (só layouts *aninhados dentro* do segmento dinâmico recebem
  esse parâmetro) — então o mapa, hospedado no `layout.tsx`, precisa resolver "qual UF está
  selecionada agora" no **cliente**, via `useParams()`/`usePathname()` (`next/navigation`), e buscar
  seus próprios dados (`GET /api/projection` / `GET /api/projection?uf=<sigla>`, já existentes,
  specs 003/004) em vez de recebê-los como prop de `page.tsx`. Isso desacopla o ciclo de vida do
  mapa do ciclo de vida de cada `page.tsx` — é a mudança estrutural que faz a persistência
  funcionar, não uma alteração ao componente de clique.
- `app/layout.tsx` (`RootLayout`) **não muda** e continua sem ler `cookies()`/`headers()`/
  `searchParams` (invariante do ADR-0025 § 2/§ 5, que mantém as 54 páginas de UF estáticas) — a
  moldura persistente do mapa é um `layout.tsx` **aninhado**, abaixo do `RootLayout`, que também
  pode continuar sendo um Server Component puro por fora, hospedando um Client Component (o mapa)
  por dentro; `usePathname()`/`useParams()` são hooks de cliente e não forçam o `layout.tsx` que os
  hospeda a virar dinâmico no servidor.

O que este ADR **não decide** — fica explicitamente para o `map-builder`: o mapa nacional
(`_NationalChoroplethMapImpl.tsx`, PMTiles de UF) e o mapa de UF (municipal) são hoje **duas
implementações MapLibre distintas**, com fontes PMTiles e camadas diferentes. "Nunca desmontar" no
sentido pleno — uma única instância WebGL que troca de fonte/camada e faz `flyTo` da visão nacional
para a UF, em vez de destruir e recriar o contexto MapLibre — é trabalho de mapa (câmera, troca de
`source`/`layer`, ADR-0003/ADR-0004) que este ADR autoriza como intenção mas não especifica. Uma
primeira versão aceitável desta decisão pode manter o `layout.tsx` estável (o wrapper React não
desmonta) mesmo que o `MapLibre.Map` interno ainda reinicialize ao trocar de fonte — o ganho já
seria não perder o cabeçalho, os controles nem o estado de carregamento do WebGL no salto entre
páginas, mesmo que a persistência da instância GL propriamente dita venha depois.

### 2. Conjunto de painéis da home: ordem do protótipo com duas exceções aditivas, duas remoções

A ordem de conteúdo da home passa a ser a do protótipo — **Resultado → Chances → Redutos → Falta
apurar → Boletim** — com duas exceções explícitas do usuário:

- **Fica, fora da ordem do protótipo**: o painel "Placar por estado" (`StateGroupedTable`,
  `app/page.tsx:482`) — não existe no protótipo, mas o usuário quer mantê-lo. Posição: continua na
  cauda da página (depois de Boletim, antes de Metodologia), sem reordenação — este ADR não move
  este painel, só preserva sua existência frente à tentação de cortá-lo por "fidelidade".
- **Entra, alinhado ao protótipo**: `<ChancesPanel />` (`components/blocks/ChancesPanel.tsx`,
  já existente e já testado, hoje só usado em `/uf/[sigla]` e `/uf/[sigla]/governador`) passa a
  aparecer também na home, na 2ª posição — mesma posição do `ChancesPanel` do protótipo
  (`App.jsx:350`).
- **Saem**: o painel condicional "Cenários" (`<RunoffScenarios />`, `app/page.tsx:454-458`) e o
  painel "Unidades federativas" (`<DecisiveUFsGrid />`, `app/page.tsx:474-480`, "UFs decisivas") —
  nenhum dos dois existe no protótipo, e nenhum dos dois tem o mesmo pedido explícito de retenção
  que "Placar por estado" recebeu.
- **Fica, redesenhado**: "Composição de Outros" (`<MinorCandidatesList />`, dentro do painel de
  Resultado, `app/page.tsx:399-423`) continua existindo — cortá-lo apagaria os candidatos de rank
  ≥ 4 da home, e o [ADR-0017](0017-transparencia-total-3-camadas.md) exige todo candidato sempre no
  DOM; a alternativa do próprio protótipo (botão "Todos os N candidatos", `App.jsx:39`) já foi
  rejeitada por esse mesmo ADR, reafirmado pelo [ADR-0029](0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md)
  item 9 — este ADR não reabre essa rejeição. "Redesenhado na densidade do protótipo" aqui é um
  refinamento de tipografia/espaçamento sobre o que o ADR-0029 item 7 já decidiu (formato
  `CandidateRow`, parcial+projeção lado a lado) — não uma mudança de conteúdo ou de regra.

`Metodologia` (agulha + `<ForecastTransparency />`) e `Leitura do modelo` (`<InsightCard />`) não são
tocados por esta decisão — permanecem como seções de encerramento obrigatórias (transparência do
modelo, ADR-0006), fora da comparação de fidelidade ao protótipo porque o protótipo não tem
equivalente algum para nenhuma das duas.

### 3. Calibração do gate OT-4: dado real de 2022, não ajuste do parâmetro sintético

O parâmetro `REGIONAL_DELAY` (`scripts/build-replay-fixtures.ts:129`) **não é alterado** para fazer
o gate OT-4 passar, apesar de a medição de hoje confirmar que zerá-lo derruba o gate para verde
(PT 1,342pp / 93,3% de cobertura). A decisão inicial do usuário foi calibrá-lo com **timestamps reais
de apuração por zona de 2022**.

> **Emenda do mesmo dia (08/09), antes de qualquer implementação.** A pesquisa que corria em paralelo
> a este ADR concluiu: **esse dado não existe em nenhuma fonte pública verificável.** Verificado
> diretamente, não por relato: a URL de zona de 2022 documentada no próprio `docs/PRD.md:1029`
> devolve **HTTP 404**, e `resultados.tse.jus.br/oficial/comum/config/ele-c.json` hoje lista **apenas
> `ele2024`**. `dadosabertos.tse.jus.br` bloqueia acesso automatizado (403) e, mesmo acessível, o
> Boletim de Urna carrega hora de abertura/encerramento da urna — horário fixo nacional, que não
> informa ordem de transmissão. O Wayback não capturou os endpoints JSON dinâmicos
> (`archived_snapshots: {}`). O dado é **efêmero por natureza**: só existiu ao vivo na noite de
> 02/10/2022, e não há indício de que alguém o tenha arquivado.
>
> **Decisão substituta: teste de sensibilidade.** Em vez de um MAE único sob um atraso suposto, o
> gate passa a reportar a **faixa** de MAE sob várias hipóteses de atraso regional. Dois pontos já
> estão medidos: atraso 3 → PT 2,3623pp / cobertura 82,5%; atraso 0 → PT 1,3420pp / 93,3%. Isso não
> inventa dado nenhum, é honesto sobre a incerteza que de fato existe, e destrava a decisão sem
> fabricar número. Muda o que o OT-4 significa — de um veredito binário para uma faixa reportada — e
> por isso é registrado aqui e não numa mudança silenciosa de script.
>
> **Estreitamento posterior**: os simulados oficiais de 15–17/09 e 22–24/09 permitem medir o atraso
> regional real da infraestrutura de 2026. Isso mede *outra coisa* (2026, não 2022) e não substitui a
> calibração perdida, mas é evidência medida e pode estreitar a faixa. Exige que o protocolo de
> coleta (`docs/testing/tse-simulados.md:59-70`) cubra as cinco regiões, e não só SP como hoje.

Enquanto a faixa não é implementada: o gate OT-4 **continua reprovando**, a spec 002 permanece
`implementing` (não promovível a `shipped` por este caminho), e a investigação paralela sobre o peso
de `eleitorado` inflado (Fase 7b da S07) — que já rendeu conserto medido, mas insuficiente — segue
como a outra frente aberta sobre a mesma reprovação.

## Alternativas rejeitadas

**Navegação:**
- **Adotar a SPA do protótipo integralmente** (estado de UF selecionada só em `useState`, endereço
  nunca muda) — rejeitada: elimina o link compartilhável por UF (`/uf/SP`) e reduz o Google a indexar
  só a home; o usuário nomeou isso como decisivo para a noite de apuração, quando o link de uma UF
  específica circula no WhatsApp.
- **Manter a troca de página inteira** (arquitetura de hoje, cada rota com seu próprio `page.tsx`
  auto-suficiente) — rejeitada: é exatamente a causa raiz do mapa "sumir" do campo de visão a cada
  clique, o problema original que motivou a comparação com o protótipo.
- **Mover o mapa para dentro de `app/layout.tsx` (`RootLayout`)**, sem grupo de rotas — rejeitada:
  obrigaria o `RootLayout` a resolver `sigla`/cargo por `params`, que ele não recebe de rotas abaixo
  de segmentos dinâmicos não aninhados diretamente nele, e quebraria a invariante documentada em
  `app/layout.tsx:52-64` de zero leitura de dado no layout raiz (ADR-0025 § 2/§ 5, 54 páginas
  estáticas). Um `layout.tsx` aninhado por grupo de rota preserva a invariante do raiz e ainda assim
  não muda nenhuma URL.

**Painéis da home:**
- **Cortar "Placar por estado" por fidelidade estrita ao protótipo** — rejeitada explicitamente pelo
  usuário; fidelidade ao protótipo não é absoluta quando o usuário value um conteúdo que o protótipo
  não tem.
- **Manter "Cenários" e "UFs decisivas" por já estarem implementados** ("custo afundado") —
  rejeitada: nenhum dos dois tem o mesmo pedido de retenção que "Placar por estado" recebeu, e ambos
  contribuem para a divergência de 2,3× de altura medida hoje.

**Calibração do OT-4:**
- **Zerar `REGIONAL_DELAY`** — rejeitada: o próprio código já advertia contra isso
  (`build-replay-fixtures.ts:47-48`); moveria o gate sem melhorar o modelo, e mascararia
  precisamente o viés de composição regional que o replay foi reescrito para expor (Fase 5).
- **Baixar o limiar do gate** (< 2pp → algo maior) — não levantada pelo usuário e rejeitada por
  extensão do mesmo raciocínio: mudaria a régua em vez de o que ela mede.
- **Deixar o gate reprovando indefinidamente, sem plano** — rejeitada: bloqueia a promoção da spec
  002 sem uma data ou critério de resolução; a pesquisa por dado real dá um caminho, mesmo que possa
  falhar.

## Consequências

**Positivas**:
- Resolve a queixa central da comparação com o protótipo (mapa desaparece a cada navegação) sem
  desistir de link compartilhável nem de indexação — as duas coisas que o usuário nomeou como
  decisivas para a noite de apuração.
- Reaproveita 100% do mecanismo de clique já decidido nesta sessão (`StateResultSheet` +
  `next/link`) — nenhuma reversão do trabalho de `_NationalChoroplethMapImpl.tsx`/
  `StateResultSheet.tsx` feito mais cedo hoje.
- Elimina, na prática, o recarregamento do bundle do mapa (~285–300KiB, ADR-0010/ADR-0030) a cada
  clique em UF — hoje cada navegação `/` → `/uf/[sigla]` reinicializa o `next/dynamic({ssr:false})`
  do zero; com o mapa fora do `page.tsx`, o chunk carrega uma vez por sessão de navegação dentro do
  mesmo cargo, não uma vez por clique.
- O conjunto de painéis revisado remove 2 blocos (Cenários, UFs decisivas) e adiciona 1 compacto
  (Chances), reduzindo a divergência de altura em vez de ignorá-la — mesmo sem eliminar por completo
  a diferença de 2,3× (Placar por estado continua sendo peso extra, deliberado).
- A recusa de ajustar `REGIONAL_DELAY` mantém o gate OT-4 honesto sobre o viés de composição regional
  que ele foi reescrito para expor (Fase 5) — o mesmo compromisso que already existia em comentário
  de código, agora com decisão de produto por trás.

**Negativas**:
- **A unificação real dos dois mapas (nacional/UF) numa única instância MapLibre não é decidida
  aqui** — fica para o `map-builder`, com escopo não trivial (fontes PMTiles diferentes, câmera,
  troca de camada). Até lá, "o mapa nunca desmonta" pode, na prática, significar só "o wrapper React
  e o cabeçalho não desmontam" — uma vitória parcial, não a paridade completa com o protótipo (onde
  é literalmente o mesmo componente D3/TopoJSON do início ao fim).
- **Nova classe de coordenação de estado**: hoje quase todo o app é RSC com ilhas de cliente
  autocontidas por página; um mapa em `layout.tsx` lendo `useParams()`/`usePathname()` e buscando seu
  próprio dado via `/api/projection` introduz um segundo consumidor client-side desses endpoints,
  com seu próprio ciclo de fetch/erro, dissociado do fetch server-side que a página ainda faz para
  seus próprios painéis — dois caminhos de dado para a mesma projeção, cada um podendo ficar
  dessincronizado do outro por alguns segundos (mitigado pela cadência de 60s do ADR-0011 e pelo
  cache de CDN do ADR-0002, mas não eliminado).
- **A troca de cargo continua desmontando o mapa** (fora do escopo desta decisão) — o achado do
  usuário sobre o protótipo era mais amplo que isso (o mapa do protótipo nunca desmonta, período);
  esta decisão fecha só a fatia UF-a-UF dentro do mesmo cargo.
- **`amended_by: ADR-0033` não foi adicionado ao frontmatter do ADR-0029** (só a nota em `##
  Status`) — segue o padrão observado no repositório, onde nem toda emenda posterior atualiza o
  campo `amended_by` do ADR emendado (ex.: ADR-0024 não lista o ADR-0031 no frontmatter); a
  navegação entre ADRs relacionados depende de quem lê a seção Status ou o `index.json`, não do
  frontmatter sozinho.
- **A tensão nomeada na nota de emenda ao ADR-0029 (D17) fica genuinamente aberta** — este ADR
  registra a reversão do usuário sem resolver se ela é só de posição ou também de conteúdo do hero;
  se for de conteúdo, reabre as quatro razões do ADR-0018 sem um ADR que as reavalie explicitamente.
- **Duas frentes de investigação abertas sobre o mesmo gate OT-4** (atraso regional sintético,
  decidido aqui; peso de `eleitorado` inflado, Fase 7b da S07, não decidido aqui) — resolver uma não
  garante que a outra não seja também necessária; o gate pode continuar reprovando mesmo depois de
  qualquer calibração de `REGIONAL_DELAY` com dado real, se o viés de `eleitorado` for a causa
  dominante.
- **A pesquisa de dado real de 2022 pode não existir** — risco declarado pelo próprio usuário: os
  timestamps zona-a-zona já sumiram uma vez do CDN do TSE. Se a pesquisa falhar, a spec 002 fica sem
  caminho de calibração não-sintético conhecido, e a equipe precisará decidir de novo (não
  antecipado por este ADR) entre um fixture sintético mais bem fundamentado, uma fonte de dado
  paga/terceirizada, ou aceitar o gate reprovando com uma justificativa documentada.

## Cross-refs

- [ADR-0029](0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md) — emendado por este ADR (D17,
  reversão do item 6; ver nota de Status acima). Itens 1–5, 7–9 permanecem intocados.
- [ADR-0018](0018-termometros-hero-1t.md) — **não emendado**, mas a nota de emenda ao ADR-0029 acima
  nomeia uma tensão não resolvida com o conteúdo deste ADR; ver Consequências.
- [ADR-0017](0017-transparencia-total-3-camadas.md) — base para manter "Composição de Outros" sempre
  no DOM (Decisão 2); não alterado.
- [ADR-0028](0028-corrida-explicita-por-rota.md) — a Decisão 1 é construída sobre este ADR (corrida
  explícita por rota); nenhuma mudança à semântica de `currentRace()`/call sites.
- [ADR-0012](0012-edge-config-chaves-nomeadas.md) — namespacing de chave por cargo/turno, inalterado;
  os dois endpoints que o mapa persistente passaria a consumir client-side (`GET /api/projection`,
  `GET /api/projection?uf=<sigla>`) já existem sob este contrato (specs 003/004).
- [ADR-0025](0025-design-system-atlas-menna-restyle-in-place.md) § 2/§ 5 — invariante de
  `app/layout.tsx` sem leitura de dado (54 páginas estáticas); a Decisão 1 preserva essa invariante
  ao propor um `layout.tsx` aninhado, não o `RootLayout`.
- [ADR-0010](0010-mapa-dynamic-import.md) / [ADR-0030](0030-orcamento-above-the-fold-piso-framework-vs-aplicacao.md)
  — chunk do mapa (`next/dynamic({ssr:false})`, teto 300KiB); a Decisão 1 muda **quando** ele é
  buscado (uma vez por sessão de navegação dentro do cargo, não por página), não seu tamanho.
- [ADR-0003](0003-pmtiles-nao-geojson.md) / [ADR-0004](0004-maplibre-nao-mapbox.md) — a unificação
  das duas implementações de mapa (nacional/UF) numa instância persistente fica para o `map-builder`,
  não decidida por este ADR.
- [ADR-0021](0021-extrapolacao-do-apurado-sem-2022.md) / [ADR-0023](0023-pos-estratificacao-por-porte-de-zona.md)
  — método do estimador, não tocado pela Decisão 3 (que é sobre o fixture de teste, não o modelo).
- `docs/sprints/2026-S07-f6-simulado-hero-1t.md` — Fase 7b (peso de `eleitorado` inflado, segunda
  frente aberta sobre o OT-4) e DoD/gates da sprint; `ship_blocked_on` da spec 002 permanece
  bloqueado por este gate.
- `docs/reference/risks.md` — risco do OT-4 e do fixture sintético; a decisão de não ajustar
  `REGIONAL_DELAY` deve ser refletida aqui pelo `spec-syncer`.
- `docs/specs/003-home-nacional/spec.md` — frontmatter `adrs:` deve passar a citar este ADR (mudança
  de composição de painéis e, indiretamente, de arquitetura de navegação do mapa).
- `docs/specs/004-pagina-uf-presidencial/spec.md`, `docs/specs/005-pagina-uf-governador/spec.md`,
  `docs/specs/006-grid-governadores/spec.md` — afetadas pela Decisão 1 (mapa persistente entre home/
  grid e página de UF do mesmo cargo).
- `docs/specs/002-modelo-estatistico/spec.md` — Decisão 3 (calibração do OT-4 com dado real, não
  ajuste do fixture) é pré-requisito declarado para promoção a `shipped`.
- `docs/design-system/components.md` — pendente de registro: `ChancesPanel` passa a ser consumido
  também pela home (Decisão 2); um novo componente de moldura de mapa (nome a definir pelo
  `map-builder`/`spec-implementer`) entra no catálogo quando implementado.
- Kit de origem: `docs/design-system/atlas-menna/ui_kits/atlas-menna/App.jsx` (linhas 303, 310, 311,
  313, 337-359, 372, 383).
- `scripts/build-replay-fixtures.ts:11,46-48,129` — fonte da medição e da advertência de código sobre
  a Decisão 3.
