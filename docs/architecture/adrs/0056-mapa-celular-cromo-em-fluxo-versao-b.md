---
id: ADR-0056
title: No celular, o cromo do mapa sai da sobreposição e vai para fluxo abaixo — barra "Vista/Escolher UF" + legenda resumida + "Ver legenda" em folha (versão B do protótipo) — emenda parcial ao ADR-0033 § 1
status: accepted
date: 2026-09-27
amends: 0033
---

# ADR-0056 — Cromo do mapa em fluxo abaixo no celular, não sobreposto (versão B do protótipo)

## Status

Aceito. Este ADR **emenda parcialmente o ADR-0033 § 1** (a Decisão "1. Navegação: moldura
persistente..."), especificamente na frase que o próprio `<NationalMapBlock>` reproduz em
código sobre a variante `frame`: *"o mapa é a coluna inteira e todo o cromo é overlay"*
(`components/blocks/NationalMapBlock.tsx:98-102`). Essa composição sobreposta passa a valer
**só no desktop** (≥ 960px); no celular (≤ 959px) o mesmo cromo — título, seletor de vista,
"Escolher UF", "← Brasil" e legenda — sai de cima do mapa e vai para fluxo normal de página,
abaixo dele. Nada mais do ADR-0033 é tocado: a moldura persistente em `layout.tsx` de grupo de
rotas, o mapa nunca desmontando entre Brasil e UF do mesmo cargo, e o restante da Decisão 1 (a
resolução client-side de `sigla` via `useParams()`/`usePathname()`) permanecem exatamente como
estão. O ADR-0033 recebe uma nota curta em seu `## Status` apontando para este documento.

## Contexto

O bloco de mapa nacional (`variant="frame"`, montado por `<PersistentMapFrame>` dentro do
`<AppShellSplit>`, ADR-0033 § 1) reserva uma altura fixa de viewport no celular (`52vh`, mínimo
`400px` — `components/layout/AppShellSplit.module.css`, herdado do ADR-0029 § 1) e sobrepõe a
essa área todo o cromo de navegação: o título do mapa (`<h2>`, ex. "PRESIDENTE · BRASIL"), o
`<MapViewToggle>` com as 4 vistas ("Por vencedor / Margem / Swing vs 2022 / % apurado"), o
`<UfPicker>` ("Escolher UF") e, no canto inferior esquerdo, `<CandidateLegendGroup>` — a legenda
por candidato. Em 2026-09-27 o dono comparou essa composição, no celular, contra três protótipos
alternativos (`docs/design-system/prototipos/mapa-celular-2026-09-27/`) e decidiu tirar tudo isso
de cima do mapa: a queixa registrada é que o cromo sobreposto compete visualmente com o próprio
mapa, o elemento que a ADR-0029 § 1 já elegeu como o de maior valor informativo imediato da home.

A composição sobreposta não é acidente de implementação — é o comportamento **documentado e
pretendido** da variante `frame`, com a fonte da decisão citada no próprio código:
`NationalMapBlock.tsx:98-102` descreve `frame` como "a mesma composição do `mapBlock` do kit
(`App.jsx`), onde o mapa é a coluna inteira e todo o cromo é overlay" — texto que remete
diretamente ao protótipo original do kit Atlas Menna, a mesma fonte que o ADR-0033 § 1 cita como
referência de fidelidade. O padding assimétrico que o `fitBounds` inicial usa hoje
(`initialFramePadding`, `components/blocks/_NationalChoroplethMapImpl.tsx:764-777`) existe
justamente para dar lugar a esse cromo flutuante: teto de 160px no topo (medido: cabeçalho de 3
linhas em telas <900px de largura, 142px + 18px de respiro) e 120px na base (medido: legenda de
até 3 candidatos, 87px de altura, começando a 108px do fundo do container). Sem a sobreposição no
celular, essa reserva de espaço deixa de fazer sentido do jeito que está calibrada hoje — ver
Consequências.

Três protótipos de composição alternativa foram desenhados e comparados lado a lado
(`docs/design-system/prototipos/mapa-celular-2026-09-27/README.md`): **A** (faixas de cromo acima
E abaixo do mapa — título/UF acima, vistas acima, legenda completa abaixo), **B** (mapa no topo
sem nada por cima; abaixo, uma barra com dois botões de 44px — "Vista: <atual> ▾" e "Escolher
UF" — depois título, legenda resumida em uma linha e um link "Ver legenda" que abre a legenda
completa numa folha) e **C** (uma linha fina única acima do mapa com "Vista ▾"/"UF", legenda
resumida abaixo, completa também em folha — a que reserva mais altura ao mapa). O dono escolheu
**B**, emprestando de C o padrão "Ver legenda" em folha para a legenda completa (em vez de deixá-la
sempre expandida em linha, como a versão B original do protótipo mostrava antes desse ajuste).

## Decisão

No celular (≤ 959px), a variante `frame` do `<NationalMapBlock>` deixa de sobrepor cromo ao mapa e
passa a compor, em fluxo vertical normal, de cima para baixo:

1. **O mapa**, sem nenhum elemento sobreposto — ocupa o topo da seção, na mesma altura de viewport
   de hoje (`clamp(400px, 52vh, 520px)`, salvo o ajuste de padding tratado em Consequências).
2. **Uma barra de dois botões de 44px** (piso de alvo de toque, RNF/constituição § 4): **"Vista:
   <atual> ▾"**, que abre a lista das 4 vistas existentes hoje (mesmo conteúdo do
   `<MapViewToggle>`, forma de abertura muda de segmented control sobreposto para botão que revela
   a lista), e **"Escolher UF"** (mesmo `<UfPicker>` de hoje, sem mudança de conteúdo). Nos mapas de
   estado (drill-down de UF), **"← Brasil"** — hoje flutuando sobre o canto do mapa
   (`backHref`/`<Link>`, `NationalMapBlock.tsx:151-155`) — entra nesta mesma barra, ao lado de
   "Escolher UF".
3. **Abaixo da barra**: o título do mapa (mesmo `<h2>`/`scopeLabel` de hoje, ex. "PRESIDENTE ·
   BRASIL"), depois a **legenda resumida** — uma linha com uma bolinha na cor de cada candidato,
   nome, e o texto fixo "· mais forte = mais vantagem" — e o link **"Ver legenda"**, que abre uma
   folha (`<Sheet>`, `components/atoms/overlays/Sheet.tsx`, já existente e já usado por
   `<StateResultSheet>`/`<UfPicker>`) com a legenda completa: as faixas de cor por candidato, "0 …
   +30" e "sem apuração" — o mesmo conteúdo que `<CandidateLegendGroup>` já monta hoje, só
   redistribuído entre a linha resumida (sempre visível) e a folha (sob demanda).
4. **Vistas sem legenda de candidato** — "Swing vs 2022", "% apurado", e as vistas de Governador/
   Senador (que não têm legenda por rank fora do cargo 1, ADR-0048) — mostram a linha de legenda
   resumida dizendo que não há legenda para essa vista (mesmo texto informativo que o site já não
   tem hoje para essas vistas), **sem** o link "Ver legenda" — não há folha para abrir.
5. **Fase pré-eleição** (`preEleicao`, RF-157/spec 019): a legenda de geografia que
   `<NationalChoroplethMap>` já monta para essa fase (em vez da legenda por partido) também vai
   para o fluxo abaixo do mapa, seguindo a mesma composição — nunca sobreposta.

**No desktop (≥ 960px), nada muda.** A coluna do mapa continua exatamente como está — cromo
sobreposto nos cantos, mesma composição do kit — porque o protótipo e a decisão do dono trataram
só do celular; o próprio README da pasta do protótipo registra isso como algo que "não decide" e
que "só o celular muda".

### Emenda ao texto do ADR-0033 § 1 / `NationalMapBlock.tsx`

A frase da Decisão 1 do ADR-0033 e o comentário homônimo em `NationalMapBlock.tsx:98-102` — que
descrevem a variante `frame` como tendo "todo o cromo... overlay" sem qualificar por breakpoint —
passam a valer **apenas para telas ≥ 960px**. Abaixo desse breakpoint, o cromo (título, seletor de
vista, `<UfPicker>`, "← Brasil", legenda) é fluxo de documento, não overlay posicionado sobre o
mapa. Isso não introduz uma segunda variante (`frame-mobile`) nem duplica o componente: é o mesmo
`variant="frame"`, com a composição interna ramificada por breakpoint — o mesmo padrão que
`<TabBar>`/`SegmentedControl` de cargo já usa por breakpoint desde o ADR-0029 § 3 (TabBar embaixo
no mobile, SegmentedControl no topo no desktop — a mesma prop de estado, forma diferente por
largura de tela).

O que **não muda**, e este ADR reafirma explicitamente para não ser lido como abertura de escopo
maior:

- O mapa continua vivendo no `layout.tsx` do grupo de rotas, sem desmontar entre Brasil e UF do
  mesmo cargo (ADR-0033 § 1).
- O mapa continua sendo o primeiro bloco de conteúdo no celular (ADR-0029 § 1).
- O mapa continua carregado via `next/dynamic({ ssr: false })`, fora do bundle above-the-fold
  (ADR-0010).
- Os orçamentos RNF-007a (above-the-fold) e RNF-007b (chunk do mapa) continuam valendo como estão
  — a barra, a legenda resumida e a folha de legenda completa são HTML/CSS simples (sem MapLibre,
  sem D3), e não entram no chunk lazy do mapa; ver Consequências para o que precisa ser remedido.
- O coroplético de Governador/Senador (ADR-0048) continua sem legenda por rank — a ausência do
  link "Ver legenda" nessas vistas não é regressão, é reflexo de uma limitação que já existia.
- O sufixo "· 2 vagas" que o cabeçalho de Senador carrega (ADR-0048 item 3) continua na superfície
  do mapa — muda de posição (vai para o título em fluxo, item 3 da Decisão), não de conteúdo nem
  de presença.

## Consequências

**Positivas**:
- Fecha a queixa central do dono — nada mais compete visualmente com o mapa no celular, o
  elemento que a própria ADR-0029 § 1 elegeu como prioridade de leitura imediata da home.
- Reaproveita 100% dos componentes existentes (`<MapViewToggle>`, `<UfPicker>`,
  `<CandidateLegendGroup>`, `<Sheet>`) — nenhum dado novo, nenhuma nova fonte de verdade sobre
  vistas ou candidatos; é recomposição de layout, não de conteúdo.
- O link "Ver legenda" (emprestado da versão C do protótipo) preserva a legenda completa sem
  forçá-la sempre visível — a linha resumida cobre o caso comum ("quem está ganhando, cor mais
  forte = mais vantagem") sem gastar altura de tela com as cinco faixas completas o tempo todo.
- Unifica o padrão de "cromo por breakpoint" já usado pelo ADR-0029 § 3 para a navegação de cargo
  (TabBar embaixo no mobile, SegmentedControl no topo no desktop) — mesma lógica de composição
  condicional, sem inventar mecanismo novo.

**Negativas**:
- **O padding assimétrico do `fitBounds` inicial (`initialFramePadding`,
  `_NationalChoroplethMapImpl.tsx:764-777`, hoje 160px no topo / 120px na base) foi calibrado
  exatamente para o cromo sobreposto que este ADR remove do celular** — sem nada flutuando sobre o
  mapa, essa reserva de espaço deixa de ter razão de ser do jeito como está e o Brasil deve
  aparecer visivelmente maior/mais alto no enquadramento inicial; este ADR não recalibra os
  números (fica para a implementação/`map-builder` remedir, o mesmo processo que produziu os
  160/120 originais em 2026-09-14), mas registra que a mudança é esperada, não uma regressão a
  investigar.
- **A seção de mapa fica mais alta no celular, não mais baixa** — a barra de dois botões e a linha
  de legenda resumida (mais o título) somam altura de fluxo que antes era "grátis" por estar
  sobreposta ao mapa; isso empurra o resto da página alguns pixels a mais para baixo, na direção
  oposta ao objetivo de redução de altura que motivou o ADR-0033 § 2 (composição de painéis da
  home) — os dois objetivos (mapa sem cromo por cima; página mais curta) não são simultaneamente
  maximizáveis aqui, e o dono priorizou o primeiro.
- **A legenda completa deixa de estar sempre visível no celular** — hoje ela está sobreposta e
  sempre à vista (mesmo que pequena); com "Ver legenda" ela passa a exigir um toque extra. A linha
  resumida mitiga o caso comum, mas quem precisa da faixa exata de intensidade ("+15 a +30", por
  exemplo) tem uma etapa a mais do que tinha antes.
- **Duas composições divergentes da mesma variante `frame` por breakpoint** — o mesmo tipo de
  risco que o ADR-0029 já nomeou para a navegação de cargo ("dois componentes com o mesmo estado
  precisam ficar sincronizados via a mesma prop/rota em ambos os breakpoints"): um bug de
  sincronização entre a composição desktop (overlay) e a composição mobile (fluxo) — por exemplo,
  a vista selecionada não refletindo igual nos dois — é uma classe de erro nova que não existia
  quando havia só uma composição.
- **RNF-007a/b precisam de remedição** — a barra, a legenda resumida e a `<Sheet>` de legenda
  completa são HTML/CSS puro fora do chunk lazy do mapa (por construção, este ADR não move nada
  para dentro do chunk MapLibre), mas ainda assim são DOM e CSS novos no fluxo above-the-fold do
  celular; a garantia teórica não substitui a medição real pelo `a11y-perf-auditor` após a
  implementação, no mesmo espírito da nota final do ADR-0029 sobre re-medição de LCP com o mapa na
  posição 1.
- **O protótipo é estático** (README, "o mapa do protótipo é uma imagem parada: as cores não mudam
  com a vista") — a composição foi validada visualmente, não funcionalmente; comportamento de
  abertura/fechamento da lista de vistas e da folha de legenda é decisão de implementação, não
  herdada do protótipo.

## Alternativas consideradas

- **Versão A do protótipo (faixas de cromo acima E abaixo do mapa)** — título e "Escolher UF"
  acima do mapa, fileira das 4 vistas também acima, legenda completa abaixo. Rejeitada: mantém
  cromo competindo pelo topo da dobra (ainda que sem sobrepor o mapa) e empurra a página mais para
  baixo do que B ou C, sem ganho adicional sobre elas.
- **Versão C do protótipo (linha única fina + folha)** — uma única linha acima do mapa com
  "Vista ▾"/"UF" compactados, legenda resumida abaixo, completa em folha. É a que dá mais altura
  ao mapa das três opções. Rejeitada em favor de B: os dois botões de 44px de B, abaixo do mapa,
  são alvos de toque maiores e mais discretos individualmente do que uma única linha fina
  compartilhando "Vista" e "UF"; o dono pediu emprestado de C só o padrão "Ver legenda" em folha,
  não o restante da composição.
- **Manter o cromo sobreposto e só encolher os controles** (reduzir o tamanho visual de
  título/toggle/legenda sem mudar sua posição) — não prototipada, considerada e rejeitada: não
  resolve o pedido do dono ("nada por cima do mapa"), só reduz o quanto cada elemento cobre; em
  telas pequenas, encolher abaixo de um certo ponto quebra o piso de alvo de toque de 44px que a
  constituição § 4/WCAG exige para os botões de vista e UF.

## Cross-refs

- [ADR-0033](0033-navegacao-moldura-persistente-paineis-home-calibracao-ot4.md) § 1 —
  **emendado parcialmente** por este ADR: a composição "todo o cromo é overlay" da variante
  `frame` passa a valer só no desktop (≥ 960px). O restante da Decisão 1 (moldura persistente,
  mapa nunca desmontando dentro do mesmo cargo, resolução client-side de `sigla`) não é tocado.
- [ADR-0029](0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md) § 1/§ 3 — mapa como primeiro
  bloco de conteúdo no celular (não alterado); precedente de composição condicional por breakpoint
  para o mesmo estado (cargo/vista), reaproveitado aqui para a variante `frame`.
- [ADR-0010](0010-mapa-dynamic-import.md) — `next/dynamic({ ssr: false })` do mapa, orçamento
  RNF-007a/b; a barra, a legenda resumida e a folha ficam fora do chunk lazy do mapa por
  construção, mas exigem remedição de RNF-007a (ver Consequências).
- [ADR-0048](0048-coropletico-substitui-cartograma-governador-estreia-senador.md) — ausência de
  legenda por rank fora do cargo 1 (Governador/Senador); razão pela qual essas vistas não ganham
  "Ver legenda" no celular. Sufixo "· 2 vagas" do Senador preservado, só muda de posição.
- [ADR-0050](0050-clique-em-uf-desktop-navega-mobile-gaveta.md) — precedente de composição
  diferente por breakpoint para a mesma interação (clique em UF); mesma lógica de "mobile e
  desktop podem divergir na forma, não no dado" usada aqui para a variante `frame`.
- `components/blocks/NationalMapBlock.tsx:98-102` — comentário que descreve a composição `frame`
  emendada por este ADR; `:135-160` (`scopeLabel`, `backHref`) — elementos que migram para a barra
  no celular sem mudança de contrato.
- `components/blocks/_NationalChoroplethMapImpl.tsx:764-777` (`initialFramePadding`) — padding
  calibrado para o cromo sobreposto que este ADR remove do celular; candidato a remedição, não
  alterado por este ADR.
- `components/atoms/overlays/Sheet.tsx` — componente reaproveitado para "Ver legenda".
  `components/layout/AppShellSplit.module.css` — altura do bloco de mapa no celular (`52vh`,
  mínimo `400px`), não alterada por este ADR.
- Constituição § 4 (acessibilidade — piso de alvo de toque de 44px, motivo da rejeição de "só
  encolher os controles"): [../../constitution.md](../../constitution.md).
- `docs/nfr/performance.md` (RNF-007a/b) — orçamentos que precisam de remedição pós-implementação.
- Protótipo e decisão do dono:
  [docs/design-system/prototipos/mapa-celular-2026-09-27/README.md](../../design-system/prototipos/mapa-celular-2026-09-27/README.md).
- Implementação: `components/blocks/NationalMapBlock.tsx`,
  `components/blocks/_NationalChoroplethMapImpl.tsx`, `components/layout/PersistentMapFrame.tsx`
  (em andamento em paralelo pelo `map-builder`).
- Specs que devem passar a citar este ADR no frontmatter `adrs:`:
  `docs/specs/003-home-nacional/spec.md`, `docs/specs/004-pagina-uf-presidencial/spec.md`,
  `docs/specs/005-pagina-uf-governador/spec.md`, `docs/specs/016-senador/spec.md`.
