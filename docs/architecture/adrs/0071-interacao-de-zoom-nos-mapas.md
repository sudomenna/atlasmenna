---
id: ADR-0071
title: Zoom nos mapas do Brasil e do estado — gestos cooperativos abaixo de 960px, roda livre a partir de 960px, botões +/−/⟲ fora do chunk do MapLibre, limites de zoom e de arraste
status: accepted
date: 2026-10-03
---

# ADR-0071 — Interação de zoom nos mapas (Brasil por UF e estado por município)

## Status

Aceito (2026-10-03). Decisão do dono, tomada na véspera do 1º turno.

Este ADR **emenda uma decisão de desenho que nunca teve ADR**: a de `scrollZoom: false` nos mapas MapLibre,
tomada na S05 como correção inline de um bug de UX ("scroll do mouse na página não deve dar zoom no
mapa embedded") e registrada apenas na retrospectiva da
[sprint S05](../../sprints/2026-S05-f4c-multi-candidato.md) e em comentários do código dos dois mapas. Por isso
nenhum ADR é marcado `superseded`. A regra antiga vale agora só como histórico: **abaixo de 960px** ela continua
sendo respeitada na prática (a roda sozinha não amplia; exige Ctrl/⌘), e **a partir de 960px** ela deixa de valer.

## Contexto

Os dois mapas no ar — Brasil por UF (`components/blocks/_NationalChoroplethMapImpl.tsx`, usado por `/`,
`/governador`, `/senador`) e estado por município (`components/atoms/maps/ChoroplethMapUF.tsx`, usado por
`/uf/[sigla]*`) — não têm zoom de verdade. A roda está desligada (`scrollZoom: false`), não há botões de
ampliar/reduzir e não há limite: o usuário consegue afastar até o Brasil sumir (abaixo de z2 o dataset de UFs não
tem tiles e o desenho fica em branco), ou arrastar o mapa para fora do país. No celular, o arrasto de um dedo
sobre o mapa move o mapa em vez de rolar a página, e o mapa ocupa metade da tela
(`clamp(400px, 52vh, 520px)`, [ADR-0056](0056-mapa-celular-cromo-em-fluxo-versao-b.md)) — é fácil prender a rolagem dentro dele. Além disso, o
toque duplo para ampliar dispara junto o evento de clique que, em tela de toque, abre a ficha da UF
([ADR-0050](0050-clique-em-uf-desktop-navega-mobile-gaveta.md)) e, no desktop, navega para `/uf/[sigla]`.

Há duas restrições fortes. A primeira é de peso: o chunk do mapa está em ~285 KiB dos 300 KiB gzip do RNF-007b
([docs/nfr/performance.md](../../nfr/performance.md); o ADR-0050 já registrou 14,7 KiB de folga em 18/09, e o
ADR-0010 define a fronteira), então qualquer controle visual que viva dentro do chunk compete com esse orçamento.
A segunda é de convivência com a rolagem: no desktop a coluna do mapa (`AppShellSplit`, ≥ 960px) não rola, e
portanto a roda sobre o mapa não rouba nada da página; no celular e em telas estreitas (< 960px) o mapa está no
fluxo vertical do documento, e qualquer gesto de um dedo ou roda sem modificador que o mapa consuma impede o
usuário de passar por ele.

Opções consideradas para o celular: (a) um dedo move o mapa (comportamento atual), (b) gestos cooperativos —
um dedo rola a página, dois dedos movem e ampliam — e (c) deixar o mapa sem zoom e dar só os botões. Para os
botões: (i) o `NavigationControl` nativo do MapLibre, (ii) botões próprios sobre o mapa em todas as larguras e
(iii) botões próprios que, no celular, saem de cima do mapa. O dono escolheu (b) e (iii).

## Decisão

**Modo por largura.** A interação é decidida pela mesma largura que corta o layout (`matchMedia("(min-width:
960px)")`, o corte de `AppShellSplit.module.css`), com listener de `change`:

- **≥ 960px**: a roda do mouse e a pinça do trackpad ampliam e reduzem livremente, centradas no cursor
  (`scrollZoom` ligado, `cooperativeGestures` desligado); um botão do mouse arrasta o mapa.
- **< 960px**: gestos cooperativos do MapLibre. Um dedo rola a página; dois dedos movem e ampliam; com mouse em
  tela estreita, só Ctrl/⌘ + roda amplia. O aviso aparece em pt-BR por `locale` ("Use dois dedos para mover o
  mapa"; "Use Ctrl/⌘ + rolagem para ampliar o mapa").

**Desligados nos dois modos:** duplo clique/toque duplo (`doubleClickZoom: false` — o primeiro clique já navega
ou abre a ficha, ADR-0050, e o segundo não pode ampliar por cima), `boxZoom`, teclado do canvas (`keyboard:
false`), rotação (`dragRotate: false`, `touchPitch: false`, rotação de dois dedos desligada) e cópias do mundo
(`renderWorldCopies: false`).

**Limites**, aplicados *depois* do enquadramento inicial para não alterar o retrato atual:

- *Mapa do Brasil*: `minZoom` = zoom do enquadramento inicial, nunca abaixo de `UFS_PMTILES_MIN_ZOOM (2) +
  ZOOM_SAFETY_MARGIN (0,15)` — o piso abaixo do qual o mapa fica em branco; `maxZoom` = enquadramento + 4;
  `maxBounds` = caixa do Brasil expandida em ~25%, folga suficiente para não deslocar o enquadramento ancorado.
- *Mapa do estado*: `minZoom` = zoom do `fitBounds` inicial; `maxZoom` = 11 (os tiles vão até z10; z11 é
  sobre-amostragem leve); `maxBounds` = bbox do estado expandida em ~25%.

**Botões +/−/⟲ fora do chunk do MapLibre.** Um componente minúsculo, `components/atoms/maps/MapZoomControls.tsx`
(três `<button type="button">` com `aria-label`, ícones SVG inline, só tokens de cor, alvo mínimo `--tap-min` =
44px), lê um store Zustand, `lib/state/map-zoom-store.ts` (padrão de `lib/state/hover-store.ts`), no qual o mapa
ativo registra `{ zoomIn, zoomOut, reset }` no evento `load` e do qual se desregistra no `remove`/unmount; o
`unregister` só limpa se o controle registrado for o mesmo (corrida de montar/desmontar na troca Brasil → estado).
Sem mapa registrado, o componente não renderiza nada. O "voltar ao enquadramento" (⟲) fica desabilitado enquanto a
câmera está no enquadramento inicial. Posição: no desktop, dentro do cromo sobreposto existente, canto inferior
direito sem cobrir a legenda; no celular, na faixa abaixo do mapa (`mobileChrome > .bar`), preservando o ADR-0056 —
nada sobre o mapa no celular.

**Movimento reduzido.** As animações dos botões (`zoomIn/zoomOut({ duration: 250 })`, reset em 400 ms) não usam
`essential: true`: com isso o próprio MapLibre zera a duração sob `prefers-reduced-motion` (constituição § 4,
RNF-026).

**Teclado e leitor de tela.** O canvas do mapa do Brasil sai da ordem de Tab (`tabIndex = -1`, `aria-hidden`),
alinhando-o ao que `ChoroplethMapUF` já fazia; quem usa teclado opera o zoom pelos botões, e a tabela/lista
paralela continua sendo a alternativa acessível (RNF-025). O balão de passar o mouse fecha em `movestart`/
`zoomstart`, porque o mapa se move por baixo dele.

**Fora de escopo:** `flyTo` animado entre Brasil → estado (o componente é trocado e o mapa recriado; o ADR-0033
segue não especificando transição), os mapas órfãos (`BubbleMap`, `SwingArrowMap`, `UFMapDuo`) e os mapas SVG.

## Consequências

**Positivas**:
- Fecha as quatro queixas do dono: dá zoom de verdade, não deixa o mapa ficar em branco ao afastar, não deixa
  arrastá-lo para fora do país/estado e acaba com a rolagem presa dentro do mapa no celular.
- A rolagem da página no celular volta a funcionar sobre o mapa (um dedo rola); o aviso explica o gesto de dois
  dedos no primeiro contato.
- Os botões ficam fora do chunk do MapLibre: o RNF-007b não paga por eles, e o mesmo componente serve aos dois
  mapas e ao desktop e ao celular, trocando só o ponto de montagem.
- Preserva o ADR-0056 (nada sobre o mapa no celular), o ADR-0050 (o primeiro clique ainda navega/abre a ficha) e
  o RNF-026 (movimento reduzido sem código próprio).
- Teclado ganha um caminho de zoom que não existia (os botões); o canvas deixa de ser um foco sem anel visível.

**Negativas**:
- **Emenda a regra de 05/09 só parcialmente:** a partir de 960px a roda amplia sem modificador. Um leitor que
  passa o mouse sobre o mapa a caminho de outro conteúdo pode ampliá-lo sem querer; mitigado pelo fato de a
  coluna do mapa não rolar nesse layout, mas não eliminado (inclusive em janelas de desktop ≥ 960px que
  rolem verticalmente por zoom do navegador).
- **Descoberta do gesto de dois dedos no celular depende do aviso.** Quem espera mover o mapa com um dedo vai
  rolar a página; é o custo deliberado de não prender a rolagem.
- **Pinça de dois dedos não pode ser emulada** nas verificações automatizadas daqui; só o dono, no celular, a
  confirma. O BotID também bloqueia verificação automática em produção.
- **Duplo clique/toque duplo não amplia**, ao contrário do que a maioria dos mapas faz; é o custo de manter um
  único clique significativo (ADR-0050). O botão "+" cobre o caso.
- **Novo estado global (store) acoplando dois mapas e um componente fora do chunk:** um mapa que não desregistra
  deixa o botão apontando para um mapa destruído. A mitigação (desregistro no `remove` e `unregister` por
  identidade) exige teste de mutação e é o ponto mais frágil da decisão.
- **Largura como critério** (e não ponteiro): um desktop de janela estreita recebe gestos cooperativos e um
  tablet largo com toque recebe roda livre. É a mesma assimetria que o ADR-0050 resolveu por ponteiro para o
  clique; aqui o dono preferiu seguir o layout (a rolagem da página depende da largura, não do ponteiro).
- **Publicação na véspera do 1º turno**, com deploy congelado das 16h às 5h em 04/10
  ([ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md)). Mitigação: commit único,
  revertível por `git revert` + deploy, e horário de corte (se a verificação não estiver completa às 20h de 03/10,
  a publicação fica para 05/10, antes do 2º turno). Os portões e2e de peso e acessibilidade rodam antes de
  publicar.
- Mais DOM e CSS no fluxo do celular (a faixa de botões) e um pouco mais de JS no wrapper do mapa; o RNF-007a/b
  precisam ser remedidos pelo `a11y-perf-auditor`.

## Alternativas consideradas

- **`NavigationControl` nativo do MapLibre.** Rejeitado: seu estilo vem do CSS do MapLibre, fora dos tokens do
  design system, e ele é desenhado dentro do canvas do mapa — não sai de cima do mapa no celular, o que
  contraria o ADR-0056.
- **Um dedo move o mapa no celular (manter o comportamento atual).** Rejeitado: prende a rolagem da página
  dentro de um mapa que ocupa cerca de metade da tela; foi justamente o que motivou a mudança.
- **Botões sobre o mapa também no celular.** Rejeitado: contraria o ADR-0056 (nada por cima do mapa no celular)
  e disputa espaço com o próprio mapa em uma tela pequena.
- **Só botões, sem gestos de zoom.** Não prototipada em detalhe; rejeitada por entregar zoom pior que o de
  qualquer mapa que o leitor já usou, sem ganho de peso (os botões são necessários de qualquer forma).
- **Ampliar por duplo clique/toque duplo.** Rejeitada: o primeiro clique já navega ou abre a ficha (ADR-0050); o
  evento de duplo toque dispararia as duas coisas.

## Cross-refs

- [ADR-0010](0010-mapa-dynamic-import.md) — `next/dynamic({ ssr: false })` e o orçamento RNF-007b: motivo para os
  botões morarem fora do chunk do mapa.
- [ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md) — moldura persistente; a troca
  Brasil → estado recria o mapa (por isso o registro/desregistro no store); `flyTo` entre os dois segue não
  especificado.
- [ADR-0050](0050-clique-em-uf-desktop-navega-mobile-gaveta.md) — clique navega (desktop) ou abre a ficha
  (mobile): razão de desligar duplo clique/toque duplo; precedente de critério distinto por superfície.
- [ADR-0056](0056-mapa-celular-cromo-em-fluxo-versao-b.md) — nada sobre o mapa no celular: razão de os botões
  ficarem na faixa `.bar` abaixo dele.
- [ADR-0063](0063-projecao-deputado-federal-trava-25-e-interruptor-edge-config.md) — congelamento de deploy das
  16h às 5h em 04/10.
- Registro histórico da regra emendada: [sprint S05](../../sprints/2026-S05-f4c-multi-candidato.md) (retro,
  `scrollZoom: false` em todos os 4 mapas) — não editado, por ser retrospectiva.
- Specs afetadas: [003-home-nacional](../../specs/003-home-nacional/spec.md) (RF-292, RF-293, cobrindo os dois
  mapas) e [004-pagina-uf-presidencial](../../specs/004-pagina-uf-presidencial/spec.md) (mapa de estado, RF-034/
  RF-036); [005-pagina-uf-governador](../../specs/005-pagina-uf-governador/spec.md) e
  [016-senador](../../specs/016-senador/spec.md) usam os mesmos mapas — a conferir pelo `spec-syncer`.
- Constituição § 4 (acessibilidade — alvo de toque `--tap-min`, `prefers-reduced-motion`, navegação por
  teclado): [../../constitution.md](../../constitution.md).
- NFRs: RNF-007b ([performance.md](../../nfr/performance.md), chunk do mapa), RNF-025 e RNF-026
  ([accessibility.md](../../nfr/accessibility.md), alternativa textual ao mapa; movimento reduzido).
- Documentos atualizados junto: [mobile.md](../../mapas/mobile.md);
  [components.md](../../design-system/components.md) (`<MapZoomControls />`).
- Implementação (em andamento em paralelo pelo `map-builder`):
  `components/blocks/_NationalChoroplethMapImpl.tsx`, `components/atoms/maps/ChoroplethMapUF.tsx`,
  `components/atoms/maps/MapZoomControls.tsx`, `lib/state/map-zoom-store.ts`,
  `components/layout/PersistentMapFrame.tsx`, `components/blocks/NationalMapBlock.tsx`.
