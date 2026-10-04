---
id: ADR-0073
title: Painel desktop para telão — escala tipográfica fluida a partir de 960px, coluna de painéis proporcional nas rotas com mapa e páginas de Deputado largas em grade; mobile idêntico
status: accepted
date: 2026-10-04
amends: [0025, 0033]
---

# ADR-0073 — Painel desktop para telão

## Status

Aceito (2026-10-04). Decisão do dono, tomada na manhã do 1º turno, depois da revisão de UX medida em
produção a 1920×1080 e no código: ampliar o site inteiro no desktop (≥ 960px), com cara de painel de
controle, sem tirar nenhuma funcionalidade. O celular não muda.

**Emenda o [ADR-0025](0025-design-system-atlas-menna-restyle-in-place.md)** no que fixa a escala
tipográfica em pixels, de 10 a 64 (Decisão 3(a); o item 4 da Decisão trata das fontes, não da escala) —
a escala continua sendo a do kit abaixo de 960px e passa a ser fluida a partir dali. **Emenda o
[ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md)** no tamanho da coluna de
painéis do `<AppShellSplit>`, que nasceu do `--container-sidebar: 400px` do kit
(`app/globals.css:126`, `components/layout/AppShellSplit.module.css:130`) e que o código atribui à
Decisão 1 daquele ADR (o texto do ADR trata da moldura persistente e não fixa o número). Não toca
`--container-page` (1280px) nem `--container-sidebar` como tokens. Não supersede nenhum dos dois.

## Contexto

**1. O uso.** O site vai para um telão operado por uma pessoa, em 1920×1080, sem rotação automática
entre telas. A medição em produção e no código, a 1920 de largura:

- **Deputados, o pior caso.** Nome e votos de candidato em 11px; o percentual e o "nº · partido" em
  8,8px, porque o navegador encolhe todo `<small>` para 80% do tamanho do pai. Em
  `/uf/SP/deputado-estadual` são 740 textos em 11px e 422 em 8,8px. O voto aparece a 1.150px do nome, na
  mesma linha, e a coluna de conteúdo tem 1.280px numa tela de 1.920.
- **Rotas com mapa** (Presidente, Governador, Senador e as páginas de UF). O placar fica numa coluna de
  400px e o mapa leva os outros ~1.520px.
- **A escala é toda em px fixo** (`app/globals.css:136-156`) e não tem nenhum ponto de quebra acima de
  960px. Os `--type-*` derivam dos `--text-*`, o que permite mexer num lugar só.

**2. O que se descartou de saída.** Mexer em `--container-page` ou `--container-sidebar`: o
`tests/e2e/tokens.spec.ts:50-62` exige 1280px no `<main>` de `/`. Corrigir o `<small>` a 80% no preflight
global: o efeito seria o site inteiro, inclusive o celular. Adicionar classe ou atributo por linha de
candidato para dar hierarquia: SP tem cerca de 1.000 linhas, e cada byte por linha pesa no HTML, que já
está sob teto de peso ([ADR-0065](0065-listas-proporcionais-em-tres-faixas.md)). E contar só com o zoom
do navegador: amplia tudo por igual, mapa incluso, e não resolve a hierarquia (voto a 1.150px do nome) nem
a largura útil.

**3. Pré-condição.** Conferir se `tests/e2e/tokens.spec.ts` ou o axe a 1280 fixam tamanho de fonte. Se
fixarem, o teste é atualizado com a justificativa deste ADR — ou a rampa passa a começar em 1280.

## Decisão

**Escala tipográfica fluida a partir de 960px, em um bloco `@media (min-width: 960px)` de
`app/globals.css`**, depois do `@theme static`, redefinindo os `--text-*`. A rampa é ancorada em 960px (o
valor é o do kit, sem mudança) e cresce linearmente com a largura da janela: **+40%** a 1920px nos
pequenos (`2xs`, `xs`, `sm`), **+33%** em `md`/`base` e **+25%** nos grandes (`lg` a `5xl`), com teto de
1,7× nos pequenos e 1,45× nos grandes. Para o grupo pequeno a expressão é `clamp(B, calc(0.6B +
0.04167B·vw), 1.7B)`, e para o grande `calc(0.75B + 0.02604B·vw)` limitada a 1,45B (`B` é o valor do kit
em px). Valores resultantes:

| token | 960 | 1280 | 1440 | 1920 | 2560 |
|---|---|---|---|---|---|
| `xs` (11) | 11 | 12,5 | 13,2 | 15,4 | 18,3 |
| `sm` (13) | 13 | 14,7 | 15,6 | 18,2 | 21,7 |
| `md` (15) | 15 | 16,7 | 17,5 | 20 | 23,3 |
| `xl` (22) | 22 | 23,8 | 24,8 | 27,5 | 31,2 |
| `4xl` (48) | 48 | 52 | 54 | 60 | 68 |

Dois tokens novos de número em destaque, `--type-kpi` e `--type-kpi-sm`: no celular valem o mesmo que
`--type-figure-sm`; no desktop, mono 600 em `--text-2xl` e `--text-xl`. A correção do `<small>` a 80% fica
**no escopo do bloco ≥ 960px**, nunca no preflight: `.lista small { font-size: var(--text-xs) }` em
`components/blocks/DeputadoListaAgremiacao.module.css` e o mesmo em `SenadoDe2027Panel.module.css:164`.
Os tamanhos em px literais viram tokens com `calc(var(--text-xs) * 12 / 11)`, que dá o mesmo px no celular
(`CandidateResultRow.module.css`, `ProjecaoIndicador.module.css:17,27`, `GovernorCard.module.css:122`).

**Coluna de painéis das rotas com mapa**: `--largura-paineis: clamp(400px, 36vw, 820px)` em
`AppShellSplit.module.css` — 461px a 1280, 691px a 1920, 820px de teto — com `padding-inline` fluido.
Em 960px a coluna continua de 400px.

**Páginas de Deputado** (`/deputado-federal`, `/deputado-estadual`, `/uf/[sigla]/deputado-*`), em um
módulo novo, `app/(dep)/_painel-desktop.module.css`: o `.main` vai até 1920px com margem lateral fluida; as
agremiações viram uma grade `repeat(auto-fill, minmax(min(100%, 30rem), 1fr))` — 2 colunas a 1280–1440 e 3
a 1920, **na ordem do DOM**; os pares Votação + Mais votados (e, nas capas, Câmara 2027 + Bancada, Mais
votados + Puxadores) ficam lado a lado a partir de 1280px (`display: contents` no celular); o resumo da UF
usa `--type-kpi` e o número de cadeiras do cabeçalho de cada agremiação usa `--type-kpi-sm`; regras,
conferência e metodologia ficam no fim, em largura cheia. **Hierarquia da linha do deputado**, em um
bloco ≥ 960px no fim de `DeputadoListaAgremiacao.module.css` (vale também para Mais votados e Puxadores):
o voto apurado em mono 600 `--text-lg` (22,5px a 1920), maior que o nome (`--text-md` 600); nº/partido e
percentual em `--text-xs`; avatar de 36px. **Nenhuma classe ou atributo novo por linha.** O celular
(< 960px) fica idêntico: o histograma de tamanhos de fonte e o `scrollHeight` a 375px devem coincidir
com os medidos antes da mudança.

**Orientação ao operador do telão.** Saída de vídeo em **1920×1080 como tela estendida**, não espelhada;
navegador em tela cheia; zoom do navegador só como ajuste fino no local; não é preciso recarregar a
página ([ADR-0074](0074-atualizacao-automatica-das-paginas-por-router-refresh.md)). Em 1366 ou 1440 o
ganho de tamanho é menor. Cuidado com o zoom: o ponto de quebra de 960px é em pixels CSS, então a janela
efetiva cai abaixo dele e a página vira o leiaute de celular com zoom acima de ~200% a 1920, de ~150% a
1440 e de ~142% a 1366 (cálculo, não medição).

## Consequências

**Positivas**:
- O texto de dado passa a ser legível à distância: a 1920px nada de dado abaixo de 14px (o 8,8px do
  `<small>` some), contra 740 textos em 11px e 422 em 8,8px em `/uf/SP/deputado-estadual`.
- O voto passa a ficar perto do nome (alvo: menos de 550px, hoje 1.150px) e a ser o maior elemento da
  linha; a grade de 2–3 colunas usa a largura que antes era vazia.
- Nenhuma funcionalidade sai; o celular não muda e isso é verificável por medição.
- Tudo passa por tokens: o ajuste fino futuro é num lugar só (o bloco ≥ 960px).
- Sem classe nova por linha, o HTML de SP não ganha peso por causa desta frente (só CSS).

**Negativas**:
- **O mapa perde largura.** A 1920px sobram ~1.229px (1920 − 691) contra ~1.520px; a 1280px, 819 contra
  880. O enquadramento do mapa ([ADR-0071](0071-interacao-de-zoom-nos-mapas.md)) é recalculado para a
  área menor, e o desenho encolhe.
- **O site inteiro cresce no desktop**, não só o telão: todos os usos de `text-*` mudam acima de 960px (o
  mesmo risco que o ADR-0025 registrou ao trocar a escala). Componentes dimensionados para a coluna de
  400px — a fileira de pílulas do `<StrongholdsPanel>` pedia 358px numa coluna de 336px úteis
  (`AppShellSplit.module.css:152-155`) — podem quebrar linha entre 960 e ~1100px, onde a coluna ainda é
  de 400px e o texto já cresce (~6% a 1100px). O portão e2e a 1280 e a conferência visual a 960–1024
  cobrem; nada disso foi medido antes do aceite.
- **Texto dentro de SVG e do mapa fica de fora** do escopo de hoje: gráficos como a série da apuração
  (ADR-0046, calibrada para uma coluna de 400px) não acompanham o crescimento do texto HTML. A coluna
  mais larga dá mais pixels por ponto ao gráfico, mas o texto dele fica relativamente menor.
- **O zoom do navegador rende menos que 1:1** (a rampa responde à largura da janela): a 1920px, zoom de
  150% leva a janela a 1280px e o `xs` de 15,4 para ~18,8px device — +22% em vez de +50% — e, passados os
  limiares acima, a página vira celular.
- **A grade de agremiações convive com `content-visibility: auto` por agremiação**
  ([ADR-0065](0065-listas-proporcionais-em-tres-faixas.md), emenda de 30/09): a altura intrínseca de cada
  célula precisa ser reservada para não haver salto de leiaute. A conferir no portão (CLS), não suposto.
- **Dois pontos de decisão visual sobrepostos**: `--container-page` (1280px, travado por teste) convive
  com um `.main` de 1920px nas páginas de Deputado; quem ler só o token vai achar que 1280 é o teto do
  site.
- **Publicação no dia do 1º turno**, antes do congelamento (ADR-0063), em commit próprio por frente
  (escala, painéis), de modo que cada uma possa ser revertida isoladamente.

## Alternativas consideradas

- **Só o zoom do navegador.** Insuficiente (ver Contexto 2); fica como ajuste fino do operador.
- **Mudar `--container-page`/`--container-sidebar`.** Rejeitada: o `tokens.spec.ts` exige 1280px no
  `<main>` de `/`; a coluna proporcional vive em uma variável própria, `--largura-paineis`.
- **Corrigir o `<small>` no preflight global.** Rejeitada: mudaria o celular.
- **Hierarquia por classes novas em cada linha.** Rejeitada: ~1.000 linhas em SP, peso no HTML.
- **Começar a rampa em 1280px em vez de 960px.** Só entra se algum teste fixar tamanho de fonte em
  1280px (Contexto 3).

## Cross-refs

- [ADR-0025](0025-design-system-atlas-menna-restyle-in-place.md) Decisão 3(a) e Consequências negativas
  (escala) — emendado. [ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md)
  Decisão 1 (coluna de painéis) — emendado.
- [ADR-0046](0046-serie-por-candidato-limitada-por-construcao.md) D2 — a densidade do gráfico foi
  calibrada para a coluna de 400px.
- [ADR-0056](0056-mapa-celular-cromo-em-fluxo-versao-b.md) — altura do mapa no celular; não alterada.
- [ADR-0065](0065-listas-proporcionais-em-tres-faixas.md) — tetos de peso e `content-visibility`.
- [ADR-0071](0071-interacao-de-zoom-nos-mapas.md) — o mapa, agora numa coluna menor no desktop.
- [ADR-0074](0074-atualizacao-automatica-das-paginas-por-router-refresh.md) — o telão não precisa de F5.
- Specs: 026 (RF-298; RF-291 emendado só ≥ 960px), 027 (herda a página de UF), 003, 004, 005 e 016
  (rotas com mapa).
- NFRs: RNF-007a ([performance.md](../../nfr/performance.md); só CSS), RNF-022 e RNF-024
  ([accessibility.md](../../nfr/accessibility.md)).
- Constituição § 3 (LCP/INP, bundle) e § 4 (contraste 4.5:1, teclado):
  [../../constitution.md](../../constitution.md).
- Pendente de propagação (spec-syncer): `docs/design-system/tokens.md` (a escala passa a ter duas
  colunas, < 960 e ≥ 960), `docs/design-system/components.md`, `docs/operations/runbook.md` (orientação ao
  operador).
