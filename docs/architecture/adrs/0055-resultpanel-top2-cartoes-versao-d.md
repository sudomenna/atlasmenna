---
id: ADR-0055
title: Lista do ResultPanel vira top-2 em cartões lado a lado (versão D do protótipo) — emenda parcial ao ADR-0034 D22
status: accepted
date: 2026-09-27
---

# ADR-0055 — Lista do `<ResultPanel>` vira top-2 em cartões lado a lado (versão D do protótipo)

## Status

Aceito. Este ADR **emenda parcialmente o ADR-0034 (D22)** — não o supersede. O que muda é
só a forma da lista de candidatos dentro do `<ResultPanel>`; as duas `<Figure>` ("Apurado",
"Margem") e a `<VoteBar marker={50}>` que D22 introduziu acima da lista **ficam exatamente
como estão**. D21 (colapso visual via CSS, todos os candidatos sempre no DOM) e D23 (poda de
componentes sem contraparte no protótipo) do ADR-0034 também ficam intocados — nenhum dos
dois trata da lista em si.

## Contexto

Em 2026-09-27 o dono pediu um protótipo isolado (`docs/design-system/prototipos/apuracao-2026-09-27/`,
gerado por `gerar.py` a partir das fixtures do simulado e de `app/tokens-party.css`, sem tocar
banco nem rede) para escolher um novo visual para a lista de candidatos do `<ResultPanel>`
(`components/blocks/ResultPanel.tsx` + `<CandidateResultRow variant="kit">`,
`components/atoms/tables/CandidateResultRow.tsx`), usada nas quatro rotas de corrida única:
`/` (só no modo `multi-1t`), `/uf/[sigla]`, `/uf/[sigla]/governador` e `/uf/[sigla]/senador`. A
lista vigente, herdada literalmente do ADR-0034 D22, trata todo candidato como uma linha
uniforme — rank, sigla, votos, PARCIAL/PROJ — sem hierarquia visual entre quem está de fato
disputando a corrida (os dois primeiros da base ativa) e o resto.

Cinco versões foram desenhadas e mostradas lado a lado no protótipo (README da pasta, seção
"Como abrir e regenerar"): A (fiel ao exemplo, anel proporcional em vez de barra), B
(editorial, ampliação da identidade atual), C (placar compacto, faixa lateral colorida), D
(cartões com barra) e E (barra de corrida sóbria com linha tracejada de 50%). O dono comparou
as cinco nas quatro telas (Presidente BR e SP, Governador SP, Senador SP) e nas duas bases
(Parcial/Projeção), e escolheu **D**.

## Decisão

A lista de candidatos do `<ResultPanel>` passa a ter dois blocos visuais, calculados sobre a
lista já reordenada por `ReordenaListaPorBase`/`components/blocks/_lista-por-base.ts` segundo a
base ativa (Parcial ou Projeção — decisão preexistente do ADR-0051): os **dois primeiros**
`<li>` dessa lista viram cartões lado a lado por CSS (mesmo DOM, mesma ordem — nenhum novo
componente de dados, só um recorte visual dos dois primeiros nós), e os **demais** seguem em
um único cartão, em linhas.

**Cartões top-2** (foto 48px redonda, "PARTIDO – nº" — o `id` é o número na urna, ADR-0042 —
e NOME em caixa alta no mesmo peso 800, % grande 32px mono na cor `--party-<x>-text`
(`textForParty`, nunca a cor base — ADR-0024/0047, PSOL/PSB/NOVO/Outros reprovam contraste na
cor base), "apurado X%" pequeno abaixo só quando a base ativa é Projeção, barra de 12px, "N
votos apurados", selo em pílula escura).

**Cartão dos demais** (foto 44px, "PARTIDO – nº" e NOME em caixa alta 15px, % 20px na cor de
texto do partido à direita, "apurado X%" e os votos, barra de 8px na largura toda abaixo do
nome, sem selo).

**Barra**, nos dois formatos: o preenchimento (cor base do partido) é sempre o percentual
**apurado**. Na base Projeção, uma marca preta indica o percentual projetado sobre a mesma
barra; na Parcial, a marca não aparece — não há projeção a marcar.

Superfícies usam os tokens existentes (`--surface-card`, `--surface-page`), nunca `#fff`, para
o tema escuro continuar funcionando (nenhum token novo é introduzido por este ADR). Fontes de
rótulo e percentual aumentam de tamanho em relação à lista uniforme anterior, nas medidas do
protótipo D acima.

### Selo por candidato

O selo em pílula aparece **só nos dois primeiros** cartões da base ativa — nunca nas linhas do
cartão dos demais — e sempre nomeia a base de onde o número vem, nunca "Eleito"/"Não eleito"
soltos (constituição § 1; caso (h) de `tests/unit/components/ResultPanelVagas.test.tsx`):

- **Presidente e Governador**, 1º turno (`turno !== 2`): "2º turno · projeção" ou "2º turno · na
  parcial" nos dois primeiros da base ativa; se o líder **dessa base** passa de 50% dos votos
  válidos, **só nele**, o selo vira "Vence no 1º turno · projeção" ou "Venceria no 1º turno ·
  na parcial" (o segundo colocado nesse caso não recebe selo de 2º turno — não há 2º turno a
  disputar).
- **Senador**: "Vaga projetada" ou "Vaga na parcial" — o texto do `<VagaBadge>` já existente
  (`components/atoms/tables/CandidateResultRow.tsx`), sem mudança de regra.
- **Presidente em `/uf/[sigla]` não recebe selo**, em nenhuma base. Quem vai ao 2º turno é
  decidido pelo total nacional, não pelo estado; um selo "2º turno" no 2º colocado de SP
  afirmaria algo que pode ser falso quando esse candidato é, por exemplo, o 3º colocado no
  Brasil. Na home (`/`) e em Governador/Senador por estado o selo existe, porque ali a
  disputa que o selo descreve é a própria disputa da tela.
- **2º turno** (`turno === 2`, Presidente e Governador): sem selo em nenhum cartão. A regra dos
  50% não distingue nada entre dois candidatos que já estão, por definição, no 2º turno, e
  rotular "1º turno" seria falso.

## Consequências

**Positivas**:
- Hierarquia visual entre "quem disputa a corrida" (top-2) e "o resto da lista" que a versão
  uniforme não tinha — o protótipo mediu que essa era exatamente a lacuna que o dono queria
  fechar, com referência a um app de resultados de prefeito.
- Reaproveita a ordenação e o recorte de base já existentes (`ReordenaListaPorBase`,
  ADR-0051) — os cartões são um recorte visual dos dois primeiros `<li>`, não uma segunda fonte
  de verdade sobre quem é 1º/2º.
- Fecha a lacuna de selo genérico "Eleito"/"Não eleito" com uma regra explícita por cargo e
  por turno, testável pelo caso (h) já existente em `ResultPanelVagas.test.tsx`.
- Cor por `textForParty` nos números grandes preserva o contraste que motivou o ADR-0024/0047
  — a versão D não reintroduz a cor base do partido como texto.

**Negativas**:
- **Duas classes de linha de candidato (cartão vs. linha) em vez de uma só** — mais superfície
  de CSS e de teste para manter em sincronia (ex.: se o cálculo de "apurado X%" mudar, precisa
  mudar nos dois lugares); a lista uniforme do ADR-0034 D22 era mais simples de manter.
- **A regra de selo agora depende de cargo, turno e rota simultaneamente** (Presidente em
  `/uf/[sigla]` sem selo; 2º turno sem selo; Senador com texto próprio) — mais ramos de
  decisão do que a versão anterior, que não tinha selo algum na lista uniforme; divergência
  entre esses ramos reproduziria a mesma classe de erro que o ADR-0034 já registra para outras
  regras de recorte por rota.
- **O corte para os "dois primeiros da base ativa" pode expor um candidato diferente a cada
  troca de Parcial/Projeção** (consequência já aceita pelo ADR-0051 para a ordem da lista
  inteira, agora também visível na composição dos cartões — a pessoa nos cartões muda, não só
  a posição dela na lista).
- **O número na urna é ilustrativo para Governador e Senador no protótipo** (o simulado usa ids
  falsos); no payload real o `id` é o número na urna (ADR-0042) — a implementação não herda
  nenhum dado do protótipo em si, só o layout.

## Alternativas consideradas

- **Versão A (fiel ao exemplo, anel proporcional em volta da foto em vez de barra)** — visual
  mais próximo da referência original, mas o anel exige SVG por candidato para o arco
  proporcional; rejeitada pelo dono em favor da barra, mais simples de ler e de implementar
  com HTML/CSS puro.
- **Versão B (editorial, ampliação da identidade atual — Spectral, mono, números de 40px)** —
  mantém a linguagem tipográfica vigente do produto, mas não introduz a distinção top-2 vs.
  resto que motivou o pedido; rejeitada.
- **Versão C (placar compacto, faixa lateral na cor do partido, linhas densas)** — mais denso
  por linha, adequado a listas longas, mas sem destaque para os dois primeiros; rejeitada.
- **Versão E (barra de corrida sóbria, linha tracejada de 50% dos válidos)** — mais próxima do
  vocabulário de "corrida" já usado em `<VoteBar marker={50}>` acima da lista, mas redundante
  com essa barra e sem a hierarquia de cartões; rejeitada.
- **Renderizar os cartões duas vezes, uma por base (Parcial e Projeção), e alternar por CSS** —
  rejeitada: dobra os nós no DOM e o peso de página só para alternar um subconjunto de campos
  (RNF-007a, orçamento above-the-fold); a mesma alternância já é resolvida por `data-view`/
  `data-view-cell` no `<html>` (documentado em `ResultPanel.tsx`), sem duplicar nós.
- **Caminho escolhido: os dois primeiros `<li>` da lista já reordenada por
  `ReordenaListaPorBase` viram cartões por CSS** — reaproveita o DOM e a ordenação existentes;
  o corte visual (cartão vs. linha) é decidido por posição na lista já ordenada, não por uma
  segunda consulta ao payload.

## Cross-refs

- [ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md) — **emendado parcialmente**
  (D22): a forma da lista muda (top-2 em cartões + demais em linhas), mas as duas `<Figure>`
  ("Apurado", "Margem") e a `<VoteBar marker={50}>` que D22 introduziu acima da lista ficam
  como estão; D21 (colapso visual) e D23 (poda) seguem intocados.
- [ADR-0017](0017-transparencia-total-3-camadas.md) / [ADR-0034](0034-resultpanel-colapso-visual-corte-fora-do-kit.md)
  D21 — todos os candidatos continuam no DOM; os cartões não removem nem a lista completa nem
  o botão "Todos os N candidatos".
- [ADR-0029](0029-home-mobile-first-mapa-primeiro-fiel-ao-kit.md) § 7 / decisão de 20/09 — Base
  Projeção mostra os dois números (destaque no projetado, apurado menor); base Parcial mostra
  só o apurado. Este ADR não muda essa regra, só onde e em que tamanho cada número aparece.
- [ADR-0051](0051-ordem-de-candidatos-segue-base-de-apuracao-selecionada.md) — a ordem que
  decide quem entra nos cartões top-2 é a mesma ordem por base ativa que este ADR já rege;
  `ReordenaListaPorBase`/`components/blocks/_lista-por-base.ts` não mudam.
- [ADR-0024](0024-paleta-editorial-por-partido.md) / [ADR-0047](0047-serie-cor-legivel-e-ciclo-sem-hora-fora-do-eixo.md) —
  cor de preenchimento da barra é a cor base do partido; cor de texto (número grande, nome) é
  sempre `--party-<x>-text` via `textForParty`.
- [ADR-0042](0042-cargo-uf-numero-chave-identidade-candidatura.md) — o `id` exibido como "– nº"
  é o número na urna, chave de identidade junto com cargo e UF.
- [ADR-0053](0053-anulado-sai-da-disputa-sub-judice-segue-o-tse.md) — candidatura anulada vai ao
  fim da lista, com "—" no lugar do %, só os votos e a barra vazia; sub judice recebe etiqueta
  ao lado do nome. Nenhuma das duas regras muda por este ADR.
- Constituição § 1 (selo nunca "Eleito"/"Não eleito" soltos — sempre com a base de origem):
  [../../constitution.md](../../constitution.md).
- RNF-007a (orçamento above-the-fold): [../../nfr/performance.md](../../nfr/performance.md) —
  razão para rejeitar a alternativa "renderizar os cartões duas vezes, uma por base".
- Protótipo e decisão do dono:
  [docs/design-system/prototipos/apuracao-2026-09-27/README.md](../../design-system/prototipos/apuracao-2026-09-27/README.md).
- Implementação: `components/blocks/ResultPanel.tsx`,
  `components/atoms/tables/CandidateResultRow.tsx`,
  `tests/unit/components/ResultPanelVagas.test.tsx` (caso (h), regra de selo).
- Specs que devem passar a citar este ADR no frontmatter `adrs:`:
  `docs/specs/003-home-nacional/spec.md`, `docs/specs/004-pagina-uf-presidencial/spec.md`,
  `docs/specs/005-pagina-uf-governador/spec.md`, `docs/specs/016-senador/spec.md`.
