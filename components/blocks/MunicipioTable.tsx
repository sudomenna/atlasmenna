"use client";

/**
 * components/blocks/MunicipioTable.tsx
 *
 * RF-037 — a lista de municípios de uma UF: **ordenada por eleitorado** e
 * **paginada**. Começa com os 20 maiores colégios eleitorais e acrescenta 40 a
 * cada toque em "mostrar mais", até chegar aos 645 de São Paulo.
 *
 * ## 2026-09-20 — um modo só, no lugar de dois
 *
 * Até hoje este arquivo respondia de duas formas incompatíveis:
 *
 *   - `mode="default"` (rota presidencial): **todos** os municípios, numa
 *     janela de rolagem virtualizada de 480px — `rows.slice(startIndex,
 *     endIndex)` com spacers de altura fixa, ~24 linhas no DOM de cada vez,
 *     em ordem de PAYLOAD (que não é ordem nenhuma que o leitor reconheça).
 *   - `mode="top-by-eleitorado"` (rota de governador): **8** municípios, corte
 *     duro por `.slice(0, topN)`, ordenados com a capital forçada ao topo.
 *
 * O dono pediu a mesma lista nas três rotas de estado (Presidente, Governador
 * e Senador). Os dois modos foram SUBSTITUÍDOS por este, e não somados a ele,
 * por três razões:
 *
 *   1. **Virtualização e paginação não convivem.** As duas fatiam o mesmo
 *      array e as duas mandam na altura do contêiner. Juntas, a mesma tela
 *      responderia de três jeitos à mesma pergunta ("quantos municípios
 *      existem e quais eu estou vendo?").
 *   2. **A coluna "Δ vs 2022" do modo antigo nunca teve dado.** Nenhum dos
 *      dois `toMunicipioRows` (rota presidencial e de governador) preenchia
 *      `deltaVs2022` — o campo era opcional e ninguém o escrevia, então a
 *      coluna renderizava "—" em 100% das linhas em produção. Saiu junto com
 *      o modo.
 *   3. **A rolagem interna era um poço no celular.** `height: 480` +
 *      `contain: strict` cria uma área rolável dentro de uma página rolável:
 *      no toque, o dedo escolhe entre as duas por acidente. Sem virtualização
 *      não há contêiner rolável, e a página inteira rola como o leitor espera.
 *
 * ## A ordem mudou: eleitorado puro, e a capital perdeu o privilégio
 *
 * 🔴 **A regra "capital sempre em primeiro" (decisão E4 do plano de 11/09) foi
 * REVOGADA aqui, de propósito.** O pedido do dono, em 2026-09-20, é literal:
 * "os 20 maiores municípios em número de eleitores". Uma capital pequena
 * empurrada ao topo faria a primeira linha desmentir o título da lista. A
 * capital continua marcada com o kicker `· capital` ao lado do nome — o que
 * ela perdeu foi a posição, não a identidade. Quem for "consertar" isto de
 * volta: leia este parágrafo antes, é uma troca deliberada.
 *
 * ## Município nunca some por falta de eleitorado
 *
 * `EdgeUfMunicipio.eleitores` é **opcional** (ADR-0035 D2): um payload gravado
 * antes da migration 0006 é legítimo e não traz o campo. O modo antigo fazia
 * `filter(r => r.eleitorado != null)` e, com isso, transformava "todos os
 * municípios" em "nenhum município" diante de um payload legado. Aqui o filtro
 * não existe:
 *
 *   - quem tem eleitorado é ordenado por ele, do maior para o menor;
 *   - quem não tem vai para o FIM da lista, na ordem de entrada;
 *   - se NINGUÉM tiver, a lista degrada para a ordem de origem — estável,
 *     completa, e com a legenda dizendo por que a ordem é essa
 *     (constituição § 8: o leitor precisa saber o que está vendo).
 *
 * Em nenhum desses estados a lista fica vazia.
 *
 * ## Por que remover nós do DOM é permitido AQUI
 *
 * O [ADR-0017](../../docs/architecture/adrs/0017-transparencia-total-3-camadas.md)
 * exige que as três camadas visuais estejam "sempre presentes no DOM (sem
 * `display:none`, sem `hidden`, sem `<details>`)", e o
 * [ADR-0034](../../docs/architecture/adrs/0034-resultpanel-colapso-visual-corte-fora-do-kit.md)
 * (D21) generaliza a MECÂNICA de colapso. Os
 * dois falam de **candidaturas**: a palavra "município" não aparece uma vez no
 * ADR-0017, e o que ele protege é que nenhuma candidatura desapareça da
 * narrativa de quem usa leitor de tela ou a busca da página.
 *
 * A lista de municípios nunca esteve sob essa regra, e na prática já removia
 * nós antes desta mudança, nos DOIS modos (`slice` da virtualização e `slice`
 * do topN) — sem ADR, porque ninguém entendeu que a proibição a alcançava. O
 * que esta implementação garante no lugar:
 *
 *   - `aria-rowcount` é o **total real** de municípios, não o carregado;
 *   - o rótulo do botão diz quantos faltam, em número;
 *   - a linha de status declara "mostrando N de M" e é uma região viva.
 *
 * Assim, quem não vê a tela sabe o tamanho da lista e sabe que há mais.
 *
 * ## O que saiu de cada linha
 *
 * As colunas são três, e isso é um corte consciente: a largura útil no celular
 * a 360px é ~326px, e as quatro colunas do modo antigo reservavam 264px fixos,
 * sobrando ~64px para o NOME — "São Bernardo do Campo" cabia como "São Be…".
 *
 *   - **Eleitorado** virou subtítulo sob o nome (era coluna no modo de
 *     governador). Ele é a chave da ordenação e por isso precisa estar visível
 *     — uma lista ordenada por um número invisível parece aleatória.
 *   - **Votos** viraram a SEGUNDA linha do subtítulo em 2026-09-20 (ver o
 *     bloco seguinte). Entre 20/09 03h05 e 20/09 06h30 eles não estavam em
 *     lugar nenhum da tabela, o que não tinha sido pedido por ninguém.
 *   - **Δ vs 2022** saiu: nunca teve produtor (ver acima).
 *
 * ## Os votos voltam — e por que NÃO como quarta coluna
 *
 * 2026-09-20, pedido do dono: "tente achar um jeito de mostrar os votos da
 * melhor forma". A direção proposta era progressive disclosure por largura —
 * coluna de votos no desktop, subtítulo no celular. **A medição desmentiu a
 * premissa da direção**, e o que está implementado é o que os números
 * permitem. Tudo abaixo foi medido no Chromium com as fontes REAIS do projeto
 * (Archivo/JetBrains Mono, os `.woff2` que o `next/font` self-hospeda), com
 * `Range.selectNodeContents()` — a caixa do elemento não é o texto.
 *
 * ### 1. Nesta aplicação, tela maior NÃO dá mais largura à tabela
 *
 * As três rotas de estado vivem dentro do `<AppShellSplit>` (ADR-0033 § 1),
 * onde a coluna de painéis é `--container-sidebar` = **400px fixos** no
 * desktop e a moldura mobile é `--container-mobile` = **430px**. Descontando
 * o `px-4`/`md:px-6` do `<main>` e a barra de rolagem da coluna, a largura
 * REAL da tabela é:
 *
 * | viewport | ramo do shell | tabela |
 * |---|---|---|
 * | 360px  | mobile (body 360)   | **326px** |
 * | 430px  | mobile (body 430)   | **396px** ← o máximo que a tabela alcança |
 * | 768px  | mobile + `md:px-6`  | **380px** |
 * | 1440px | desktop (coluna 400)| **352px** (368px sem barra de rolagem) |
 *
 * A função não é monotônica: ela cresce até 430px de viewport e **encolhe**
 * depois. Uma `@media (min-width: …)` ligaria a coluna extra exatamente onde
 * há MENOS espaço. Se um dia alguém quiser a quarta coluna, o instrumento é
 * `@container` sobre a caixa da tabela — nunca a largura da janela.
 *
 * ### 2. A quarta coluna não cabe em largura nenhuma que esta aplicação tenha
 *
 * Medido: `"São Bernardo do Campo"` = **143,81px** em Archivo 13px, e a
 * **capital** — que está no topo da lista de toda UF — pede **149,83px**
 * ("Campo Grande" + o kicker `· capital`). Uma coluna de votos custa 75,42px
 * (o número `"9.322.444"`, 59,42px em JetBrains Mono 11px, mais o padding).
 * Descontada essa coluna, o nome cabe **numa única** das quatro larguras da
 * tabela acima: a de 396px, o celular de 430. Trunca no celular de 360, no
 * tablet de 768 (que passa raspando em São Bernardo e reprova na capital) e
 * no desktop de 1440. Uma apresentação que aparece num aparelho e some no
 * menor E nos dois maiores não é progressive disclosure, é defeito
 * intermitente. Por isso a coluna não existe, em largura nenhuma. A conta
 * está no teste (q) de `MunicipioTable.votos.test.tsx`, executável — se o
 * shell alargar `--container-sidebar`, ela reabre a decisão sozinha.
 *
 * ### 3. Os votos são a SEGUNDA linha do subtítulo, sempre
 *
 * `"587.412 eleitores"` / `"213.008 votos"`, uma linha cada, `nowrap`. Duas
 * linhas fixas — e não uma linha que quebra quando não cabe — porque o
 * comprimento do número varia de linha para linha: com quebra automática, São
 * Paulo (9 dígitos) quebraria e Sorocaba (6 dígitos) não, e a mesma lista
 * sairia com alturas de linha diferentes a esmo. Medido: as duas cabem sem
 * truncar já a 326px (o pior caso, `"9.322.444 eleitores"`, mede 125,42px
 * contra 166px de espaço).
 *
 * ### 4. Nada é abreviado — e isso é medição, não preferência
 *
 * O subtítulo é `--type-data`, que é **JetBrains Mono**: nela a largura é
 * função pura da CONTAGEM DE CARACTERES. `"238.276"` e `"238 mil"` têm sete
 * caracteres cada — a abreviação de milhares economiza **zero pixel**. Ela só
 * ganharia algo acima de 1.000.000 (`"4.132.887"` → `"4,1 mi"`, 3 caracteres
 * ≈ 20px), e o preço seria uma faixa de 100 mil votos escondida sob o mesmo
 * rótulo, em noite de apuração, exatamente nos municípios cujo número mais
 * pesa. Como a economia é nula onde não faz diferença e cara onde faria, o
 * número vai **exato**, em pt-BR, e continua exato no `textContent` (portanto
 * na busca da página e no leitor de tela). O detalhe por candidatura segue na
 * folha do município (`<MunicipioExplorer>`).
 *
 * ### 5. O orçamento de largura virou número, e o número virou teste
 *
 * Antes desta mudança a tabela reservava 96px + 72px para as duas colunas
 * numéricas com `px-3`, sobrando **134px** de conteúdo para o nome a 326px —
 * menos que os 143,81px de "São Bernardo do Campo". **O nome que o dono deu
 * como caso de teste já truncava**, e com ele 340 dos 5.570 municípios do
 * IBGE e 5 das 27 capitais. Quem media a `<td>` via 158px e concluía que
 * cabia: 158px é a CAIXA, 134px é o texto.
 *
 * O orçamento novo ({@link COL_MARGEM_PX}, {@link COL_APURADO_PX},
 * {@link CELULA_PAD_X_PX}) devolve **166px** ao nome a 326px sem tirar nada
 * das outras duas colunas (a de margem fica com os mesmos 72px de conteúdo de
 * antes; a de apurado desce para 40px, contra 36,88px de `"54.5%"`). Resultado
 * medido a 326px: os dois casos de teste do dono passam, as 27 capitais
 * passam, e sobram 30 municípios cujo nome ainda trunca — todos com 26
 * caracteres ou mais, nenhum deles alcançável sem vários "mostrar mais".
 * Truncar zero dos 5.570 a 326px é impossível numa tabela de três colunas:
 * o recordista ("Vila Bela da Santíssima Trindade") sozinho pede 191px.
 *
 * As medidas estão em **px**, não em `rem`, de propósito: toda a escala
 * tipográfica do projeto é px (`--text-sm: 13px`), então um orçamento em `rem`
 * mentiria assim que o leitor mudasse o tamanho de fonte padrão do navegador —
 * as colunas cresceriam e o texto não. `larguraDoNome()` existe para que essa
 * aritmética seja testável sem layout (o happy-dom devolve zero em
 * `getBoundingClientRect`).
 *
 * ## Foco depois de "mostrar mais"
 *
 * Enquanto sobram municípios, o botão NÃO é desmontado — só o rótulo muda —,
 * então o foco do teclado fica onde estava, no próprio botão. No clique que
 * esgota a lista o botão sai do DOM, e aí o foco iria para o `<body>`: por
 * isso, e só nesse caso, ele é movido para a linha de status, que acabou de
 * anunciar "Mostrando 645 de 645 municípios".
 *
 * ## A11y
 *   - `<table>` semântico. `aria-rowcount` com o total, `aria-rowindex` em
 *     cada linha (1-based, cabeçalho é 1).
 *   - Nenhum `sr-only` numa `<table>` — ver
 *     `tests/unit/design-system/sr-only-tabela.test.ts`.
 *   - O nome vira `<button>` de altura `--tap-min` quando há `onSelect`.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/atoms/controls/Button";
import { formatPercentTrim } from "@/lib/utils/format";

export interface MunicipioRow {
  cod_ibge: string;
  nome: string;
  /** ID do candidato líder no município. */
  lider: number;
  /**
   * Cor do líder (token CSS) — **cor de TEXTO, não de preenchimento**.
   *
   * 🔴 Este campo tem um único consumidor, a coluna "Margem" (`color:` de
   * `"{liderNome} +{margemPp}"`), e por isso o caller tem de montá-lo com
   * `candidateMarkerColor` (`--party-<slug>-text`), nunca com
   * `candidateColor` (`--party-<slug>`, que é preenchimento COM extensão —
   * barra, polígono, `<rect>`). A distinção é a de `_candidateColor.ts`:
   * preenchimento se conserta com contorno (`DATA_FILL_STROKE`), texto não
   * tem contorno a ganhar e se conserta com a variante escurecida.
   *
   * O defeito que motiva esta nota é medido, não teórico: com a variante de
   * preenchimento, 14 das 31 siglas ficavam abaixo do piso de 4,5:1 da
   * constituição § 4 / RNF-022 (PSOL 2,08:1 · "outros" — o destino de toda
   * FEDERAÇÃO — 2,39:1 · NOVO 2,72:1, tema claro, sobre `--surface-page`).
   * Foi registrado no handoff de 19/09 e sobreviveu à reescrita deste arquivo
   * em 20/09. O gate que impede a terceira reincidência é
   * `tests/unit/design-system/municipio-contraste.test.tsx`.
   *
   * ⚠️ Se um dia alguém precisar da cor de PREENCHIMENTO do líder aqui (uma
   * barrinha na linha, um quadrado), o caminho é um SEGUNDO campo com nome
   * próprio — não reaproveitar este.
   */
  liderCor: string;
  /** Sigla curta do líder pra exibir na coluna "margem". */
  liderNome: string;
  /** Margem em pp (sempre positiva — quem está na frente é `lider`). */
  margemPp: number;
  /** % apurado 0–100. */
  pctApurado: number;
  /**
   * Votos totais reportados no município — `Σ votos_reportados`, a mesma soma
   * que `votosPorCandidatoMunicipio()` usa como denominador na folha e no
   * balão do mapa (`lib/utils/municipio-votos.ts`). Base "votáveis"
   * (ADR-0020), nunca comparecimento.
   *
   * Renderizado na segunda linha do subtítulo desde 2026-09-20. Segue
   * **opcional** para que nenhum caller seja obrigado a computá-lo só para
   * preencher: ausente, a linha simplesmente não existe — ver
   * {@link estadoDosVotos}, que separa "ninguém publicou este número" de
   * "ninguém apurou ainda" de "apurou e deu zero".
   */
  votosReportados?: number;
  /**
   * Total de eleitores do município (não confundir com `votosReportados`).
   * **É a chave de ordenação da lista.** Opcional de propósito: payload
   * gravado antes da migration 0006 é legítimo e não traz o campo — nesse
   * caso o município vai para o fim da lista, nunca para fora dela.
   */
  eleitorado?: number;
  /**
   * `true` quando o município é a capital da UF. Vem de
   * `EdgeUfMunicipio.capital` (ADR-0035 D2), que é emitido **só quando
   * verdadeiro** — ausência significa "não é capital", não "desconhecido".
   *
   * Desde 2026-09-20 é **puramente informativo**: rende o kicker `· capital`
   * ao lado do nome e nada mais. A regra que a punha em primeiro lugar foi
   * revogada — ver o cabeçalho.
   */
  capital?: boolean;
}

/** Quantos municípios a lista mostra antes do primeiro "mostrar mais". */
export const MUNICIPIOS_PRIMEIRA_LEVA = 20;
/** Quantos municípios cada "mostrar mais" acrescenta. */
export const MUNICIPIOS_POR_LOTE = 40;

/* ---------------------------------------------------------------------------
 * O orçamento de largura da linha — ver § 5 do cabeçalho.
 *
 * Em **px** porque a escala tipográfica do projeto é px; em constantes
 * exportadas porque `larguraDoNome()` precisa ser testável sem layout; e com o
 * valor medido de cada consumidor ao lado, porque a única defesa contra alguém
 * "arredondar para 6rem" de novo é o número que justifica o atual.
 * ------------------------------------------------------------------------ */

/**
 * Padding lateral de toda célula (`px-2`). Era `px-3` (12px) até 2026-09-20;
 * os 4px devolvidos por lado, vezes as três colunas, são 24px que foram
 * inteiros para o nome.
 */
export const CELULA_PAD_X_PX = 8;

/**
 * Coluna "Margem". 88px de caixa = **72px de conteúdo**, exatamente o que a
 * coluna tinha antes (96px de caixa − 24px de `px-3`): a redução da caixa
 * paga o padding, não o conteúdo. Cabe `"Lula +12,3%"` (72,66px em Archivo
 * 13px/500 — encosta, e encostava igual antes). Primeiro nome mais longo entre
 * os medidos, `"Washington"`, mede 68,19px e continua cabendo inteiro numa
 * linha própria quando a célula quebra em duas — que é o comportamento de
 * hoje, preservado.
 */
export const COL_MARGEM_PX = 88;

/**
 * Coluna "Apurado". 56px de caixa = 40px de conteúdo, contra 36,88px de
 * `"54,5%"` (o pior caso: `formatPercentTrim` só usa decimal quando o número
 * não é inteiro) e 33,25px de `"100%"`. Era 72px de caixa / 48px de conteúdo —
 * 8px que a coluna não usava.
 *
 * ⚠️ O separador virou VÍRGULA em 2026-09-20 (antes era `"54.5%"`, com ponto
 * decimal — o defeito que o dono relatou). **A medida não mudou**: em Archivo
 * a vírgula e o ponto têm o mesmo avanço — 3,61px em 400/13px e 3,75px em
 * 500/13px —, então `"54.5%"` e `"54,5%"` medem idêntico, com ou sem
 * `tabular-nums`. Idem `"Lula +12,3%"` na coluna de margem. Nenhuma das duas
 * constantes acima precisou se mexer.
 */
export const COL_APURADO_PX = 56;

/**
 * Quanto sobra para o TEXTO do nome, dada a largura da tabela. É a conta do
 * § 5 do cabeçalho, isolada para que um teste possa executá-la — o happy-dom
 * não faz layout, mas faz aritmética.
 *
 * O consumidor desta conta é o teste, não o render: o CSS chega ao mesmo
 * resultado sozinho, porque a coluna do nome é a única sem largura declarada.
 */
export function larguraDoNome(larguraDaTabelaPx: number): number {
  return larguraDaTabelaPx - COL_MARGEM_PX - COL_APURADO_PX - 2 * CELULA_PAD_X_PX;
}

export interface MunicipioTableProps {
  rows: MunicipioRow[];
  /** Tamanho da primeira leva. Default {@link MUNICIPIOS_PRIMEIRA_LEVA}. */
  inicial?: number;
  /** Tamanho de cada leva seguinte. Default {@link MUNICIPIOS_POR_LOTE}. */
  lote?: number;
  /**
   * Teto DURO da lista: só os `limite` maiores colégios eleitorais entram, e
   * não há "mostrar mais". Ausente, a lista pagina até o último município.
   *
   * 2026-10-03, pedido do dono para a rota de governador: "traga apenas a
   * lista dos 25 primeiros municípios rankeados por maiores colégios
   * eleitorais". Os demais seguem alcançáveis pelo mapa — o clique abre a
   * mesma folha (`<MunicipioExplorer>` recebe o payload inteiro, não o corte).
   * Cabeçalho, legenda e status dizem que a lista é um recorte e de quantos.
   */
  limite?: number;
  /**
   * Quando presente, o nome do município vira um `<button>` que devolve o
   * `cod_ibge` ao caller (tipicamente `<MunicipioExplorer>`, que abre a folha
   * do município no `<Sheet>`).
   *
   * Ausente, a tabela renderiza texto puro, sem nenhum nó interativo a mais.
   * As duas formas coexistem de propósito: nem toda superfície que mostra a
   * tabela precisa da folha.
   */
  onSelect?: (codIbge: string) => void;
}

function temEleitorado(r: MunicipioRow): r is MunicipioRow & { eleitorado: number } {
  return typeof r.eleitorado === "number" && Number.isFinite(r.eleitorado);
}

/**
 * Ordena por eleitorado **decrescente**, sem perder ninguém.
 *
 * Exportada para teste direto: é a regra que o dono pediu por escrito, e a
 * mutação que a troca por ordem alfabética precisa morrer em algum lugar
 * nomeado.
 *
 * Contrato:
 *   - quem tem eleitorado vem primeiro, do maior para o menor;
 *   - empate preserva a ordem de entrada (`Array.prototype.sort` é estável
 *     desde ES2019);
 *   - quem não tem eleitorado vai para o fim, na ordem de entrada;
 *   - `rows` nunca encolhe: `saída.length === entrada.length`, sempre.
 */
export function ordenarPorEleitorado(rows: readonly MunicipioRow[]): MunicipioRow[] {
  // `com` carrega a narrowing do type guard: sem isso o `sort` abaixo
  // precisaria de `?? 0`, e um `?? 0` é exatamente o tipo de default silencioso
  // que já mordeu este projeto três vezes.
  const com: Array<MunicipioRow & { eleitorado: number }> = [];
  const sem: MunicipioRow[] = [];
  for (const r of rows) {
    if (temEleitorado(r)) com.push(r);
    else sem.push(r);
  }
  com.sort((a, b) => b.eleitorado - a.eleitorado);
  return [...com, ...sem];
}

/**
 * Kicker `· capital` ao lado do nome, como o protótipo do kit
 * (`ui_kits/atlas-menna/App.jsx:140`). Fica DENTRO do rótulo do botão de
 * propósito: quem navega por teclado/leitor de tela ouve "São Paulo · capital"
 * de uma vez, em vez de um fragmento solto depois do alvo interativo.
 */
function CapitalKicker() {
  return (
    <span
      data-testid="municipio-capital"
      className="flex-none"
      style={{
        font: "var(--type-kicker)",
        letterSpacing: "var(--tracking-caps)",
        textTransform: "uppercase",
        color: "var(--text-muted)",
      }}
    >
      {/* Espaço explícito no texto: o `gap` do flex resolve o visual, mas
          `textContent` (leitor de tela, busca da página, teste) precisa do
          separador para não ler "Uberaba· capital". */}
      {" · capital"}
    </span>
  );
}

/**
 * Célula de nome do município. Vira botão quando há `onSelect`; caso
 * contrário mantém o `<span title>` de sempre.
 */
function NomeCell({
  nome,
  codIbge,
  capital,
  onSelect,
}: {
  nome: string;
  codIbge: string;
  capital?: boolean;
  onSelect?: (codIbge: string) => void;
}) {
  const conteudo = (
    <>
      <span className="truncate">{nome}</span>
      {capital ? <CapitalKicker /> : null}
    </>
  );

  if (!onSelect) {
    return (
      <span className="flex min-w-0 items-baseline" style={{ gap: "var(--space-1)" }} title={nome}>
        {conteudo}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="municipio-open"
      data-cod={codIbge}
      onClick={() => onSelect(codIbge)}
      title={nome}
      className="flex w-full min-w-0 items-baseline text-left"
      style={{
        gap: "var(--space-1)",
        minHeight: "var(--tap-min)",
        border: 0,
        background: "transparent",
        padding: 0,
        color: "inherit",
        font: "inherit",
        cursor: "pointer",
        textDecoration: "underline",
        textDecorationColor: "var(--accent)",
        textUnderlineOffset: 2,
      }}
    >
      {conteudo}
    </button>
  );
}

function fmtVotos(v: number): string {
  return new Intl.NumberFormat("pt-BR").format(v);
}

/**
 * Os três estados possíveis do número de votos de um município.
 *
 * São TRÊS de propósito, e colapsá-los em dois é o defeito que esta união
 * existe para impedir — a mesma regra que a decisão do dono de 2026-09-14
 * fixou para a página inteira ("não começou" / "não sabemos" / "apurando"):
 * **a tela nunca afirma uma medição que não fez, e nunca fabrica zero.**
 *
 *   - `desconhecido` — o caller não publica o número. Não é "zero votos", é
 *     "ninguém contou isso aqui". A linha não é renderizada: um `"0 votos"`
 *     nessa posição seria um número inventado com a autoridade da marca.
 *   - `sem_apuracao` — o número existe, vale 0, e `pct_apurado` também é 0.
 *     Os dois juntos dizem uma coisa só: nenhum boletim deste município
 *     chegou. A tela fala do NOSSO estado ("aguardando boletim"), não do
 *     mundo.
 *   - `medido` — há apuração. `votos` pode ser 0 **e isso é um fato**: um
 *     boletim com apenas brancos e nulos zera `Σ votos_reportados` sem zerar
 *     `pct_apurado`. É o único caminho pelo qual `"0 votos"` chega à tela, e
 *     ele é honesto.
 *
 * ⚠️ A guarda de `desconhecido` é `typeof === "number" && Number.isFinite`, e
 * não `if (votosReportados)`: `0` é falsy, e um `if` truthy mandaria todo
 * município de zero votos para o balde errado — o mesmo erro que o teste (e)
 * de `MunicipioTable.ordem.test.tsx` já trava para o eleitorado.
 */
export type EstadoDosVotos =
  | { tipo: "desconhecido" }
  | { tipo: "sem_apuracao" }
  | { tipo: "medido"; votos: number };

export function estadoDosVotos(
  row: Pick<MunicipioRow, "votosReportados" | "pctApurado">,
): EstadoDosVotos {
  const v = row.votosReportados;
  if (typeof v !== "number" || !Number.isFinite(v)) return { tipo: "desconhecido" };
  if (v === 0 && !(row.pctApurado > 0)) return { tipo: "sem_apuracao" };
  return { tipo: "medido", votos: v };
}

/**
 * O texto da segunda linha do subtítulo, ou `null` quando não há linha.
 *
 * Exportada para que a mutação "trocar `aguardando boletim` por `0 votos`"
 * morra num teste nomeado, sem precisar montar a tabela inteira.
 */
export function textoDosVotos(estado: EstadoDosVotos): string | null {
  switch (estado.tipo) {
    case "desconhecido":
      return null;
    case "sem_apuracao":
      return "aguardando boletim";
    case "medido":
      return `${fmtVotos(estado.votos)} ${estado.votos === 1 ? "voto" : "votos"}`;
  }
}

/**
 * As duas linhas do subtítulo compartilham o estilo — e compartilham por
 * motivo, não por economia: são dois fatos do mesmo nível (contexto do
 * município), e dar destaque a um deles sugeriria uma hierarquia que não
 * existe. O que os distingue é a PALAVRA que cada um carrega
 * ("eleitores"/"votos"), não a tinta.
 *
 * `nowrap` + reticências: a medição diz que as duas cabem a partir de 326px
 * (pior caso 125,42px contra 166px), então a reticência é rede de segurança
 * para uma largura que ninguém previu — nunca o plano. Sem ela, um contêiner
 * mais estreito quebraria a linha e a altura da linha da tabela passaria a
 * variar de município para município.
 */
const SUBTITULO_STYLE = {
  font: "var(--type-data)",
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
} as const;

/** A segunda linha do subtítulo. Ausente quando não há número a declarar. */
function VotosLinha({ row }: { row: MunicipioRow }) {
  const texto = textoDosVotos(estadoDosVotos(row));
  if (texto === null) return null;
  return (
    <span data-testid="municipio-votos" className="block" style={SUBTITULO_STYLE}>
      {texto}
    </span>
  );
}

/**
 * A legenda que explica a ordem. Três textos porque são três situações reais,
 * e colapsá-las mentiria em duas delas (constituição § 8).
 */
function textoDaOrdem(comEleitorado: number, total: number, limite?: number): string {
  if (total === 0) return "Nenhum município apurado até agora nesta corrida.";
  // Recorte por `limite`: a frase só promete "maiores" quando TODOS têm
  // eleitorado — senão a ordem de origem entra no corte e "maiores" mentiria.
  if (limite !== undefined && total > limite) {
    const n = limite.toLocaleString("pt-BR");
    return comEleitorado === total
      ? `Os ${n} maiores colégios eleitorais do estado, do maior para o menor. Os demais municípios abrem pelo mapa.`
      : `Os ${n} primeiros municípios: quem tem eleitorado publicado vem antes, do maior para o menor. Os demais abrem pelo mapa.`;
  }
  if (comEleitorado === 0) {
    return "Esta corrida não publica o eleitorado por município, então a lista segue a ordem em que o payload chega — nenhum município fica de fora.";
  }
  if (comEleitorado < total) {
    return "Ordenados pelo eleitorado do município, do maior para o menor. Os municípios cujo eleitorado o payload não publica ficam no fim da lista.";
  }
  return "Ordenados pelo eleitorado do município, do maior para o menor.";
}

export function MunicipioTable({
  rows,
  inicial = MUNICIPIOS_PRIMEIRA_LEVA,
  lote = MUNICIPIOS_POR_LOTE,
  limite,
  onSelect,
}: MunicipioTableProps) {
  const [carregados, setCarregados] = useState(inicial);

  // Ajuste de estado durante o render — o idioma do React para "prop mudou,
  // estado derivado precisa voltar ao começo". Sem isto, ir de `/uf/SP` para
  // `/uf/MG` (mesmo componente de página, árvore preservada pelo App Router)
  // chegaria em MG já com os 60 de SP carregados. Não é `useEffect` de
  // propósito: um efeito pintaria a tela errada uma vez antes de corrigir.
  const [rowsAnteriores, setRowsAnteriores] = useState(rows);
  if (rowsAnteriores !== rows) {
    setRowsAnteriores(rows);
    setCarregados(inicial);
  }

  const ordenadasTodas = useMemo(() => ordenarPorEleitorado(rows), [rows]);
  // Total da UF (para dizer "de quantos") vs. o que a lista contém.
  const totalUf = ordenadasTodas.length;
  const ordenadas = useMemo(
    () => (limite !== undefined ? ordenadasTodas.slice(0, limite) : ordenadasTodas),
    [ordenadasTodas, limite],
  );
  const recortada = ordenadas.length < totalUf;
  const comEleitorado = useMemo(() => rows.filter(temEleitorado).length, [rows]);

  const tabelaId = useId();
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  // Só o clique que ESGOTA a lista move o foco — ver "Foco depois de
  // 'mostrar mais'" no cabeçalho.
  const moverFoco = useRef(false);

  // `carregados` não é LIDO no corpo — é o GATILHO. O efeito precisa rodar
  // depois do render que desmontou o botão, e é essa a única coisa que muda
  // entre os dois renders. Sem a dependência o efeito rodaria só na montagem e
  // o foco nunca se moveria: a regra do linter aponta para um `useRef` que o
  // React não sabe observar, não para uma dependência sobrando. Mesma forma do
  // `ufSigla` em `MunicipioExplorer.tsx`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: carregados é gatilho, não leitura — ver acima
  useEffect(() => {
    if (!moverFoco.current) return;
    moverFoco.current = false;
    statusRef.current?.focus();
  }, [carregados]);

  const total = ordenadas.length;
  // Com teto, o recorte É a lista inteira: não há leva nem "mostrar mais".
  const visiveis = limite !== undefined ? total : Math.min(carregados, total);
  const lista = ordenadas.slice(0, visiveis);
  const restantes = total - visiveis;
  const proximoLote = Math.min(lote, restantes);

  function carregarMais() {
    const proximo = Math.min(total, visiveis + lote);
    moverFoco.current = proximo >= total;
    setCarregados(proximo);
  }

  return (
    <section aria-labelledby="municipios-heading" data-testid="municipios-lista">
      <h3
        id="municipios-heading"
        className="mb-2 text-lg"
        style={{ fontFamily: "var(--font-serif)", color: "var(--color-text)" }}
      >
        {recortada
          ? `Municípios — ${total.toLocaleString("pt-BR")} maiores de ${totalUf.toLocaleString("pt-BR")}`
          : `Municípios (${total.toLocaleString("pt-BR")})`}
      </h3>

      <p
        data-testid="municipios-ordem"
        style={{
          margin: "0 0 var(--space-3)",
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
        }}
      >
        {textoDaOrdem(comEleitorado, totalUf, limite)}
      </p>

      <table
        aria-rowcount={total}
        className="w-full border-collapse"
        id={tabelaId}
        style={{ tableLayout: "fixed" }}
      >
        {/* Só as duas colunas numéricas declaram largura; a do nome é o resto.
            Os números vêm de `larguraDoNome()` — ver § 5 do cabeçalho. */}
        <colgroup>
          <col />
          <col style={{ width: COL_MARGEM_PX }} />
          <col style={{ width: COL_APURADO_PX }} />
        </colgroup>
        <thead
          style={{
            backgroundColor: "var(--color-bg-muted)",
            color: "var(--color-text-muted)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          {/* `px-2`, não `px-3`: ver {@link CELULA_PAD_X_PX}. */}
          <tr>
            <th
              scope="col"
              className="px-2 py-2 text-left text-xs uppercase tracking-wide font-normal"
            >
              Município
            </th>
            <th
              scope="col"
              className="px-2 py-2 text-right text-xs uppercase tracking-wide font-normal"
            >
              Margem
            </th>
            <th
              scope="col"
              className="px-2 py-2 text-right text-xs uppercase tracking-wide font-normal"
            >
              Apurado
            </th>
          </tr>
        </thead>
        <tbody>
          {lista.map((m, i) => (
            <tr
              key={m.cod_ibge}
              // 1-based, e o cabeçalho é o índice 1.
              aria-rowindex={i + 2}
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <td className="px-2 py-2 text-sm" style={{ color: "var(--color-text)" }}>
                <NomeCell
                  nome={m.nome}
                  codIbge={m.cod_ibge}
                  capital={m.capital}
                  onSelect={onSelect}
                />
                {/* O eleitorado é a chave da ordem: sem ele à vista, a lista
                    parece embaralhada. Ausente, a linha simplesmente não tem
                    subtítulo — inventar "0 eleitores" seria afirmar um número
                    que ninguém mediu (constituição § 8). */}
                {temEleitorado(m) ? (
                  <span data-testid="municipio-sub" className="block" style={SUBTITULO_STYLE}>
                    {fmtVotos(m.eleitorado)} eleitores
                  </span>
                ) : null}
                {/* Os votos, segunda linha — ver §§ 3 e 4 do cabeçalho. Linha
                    própria e `nowrap` para que a altura da linha da tabela não
                    dependa de quantos dígitos o município tem. */}
                <VotosLinha row={m} />
              </td>
              <td
                className="px-2 py-2 text-right text-sm tabular-nums"
                style={{
                  color: m.liderCor,
                  fontWeight: 500,
                  // `liderNome` é o primeiro nome da candidatura, e nada limita
                  // o comprimento dele: `"Washington"` mede 68,19px contra 72px
                  // de conteúdo, e um primeiro nome mais longo que isso seria
                  // uma palavra sem ponto de quebra vazando para fora da célula
                  // — que é como nasce rolagem horizontal numa tabela de
                  // `table-layout: fixed`. Com `anywhere` a palavra quebra em
                  // vez de vazar; no caso normal (quebra no espaço antes do
                  // `+N%`) nada muda.
                  overflowWrap: "anywhere",
                }}
              >
                {m.liderNome} +{formatPercentTrim(m.margemPp)}
              </td>
              <td
                className="px-2 py-2 text-right text-sm tabular-nums"
                style={{ color: "var(--color-text-muted)" }}
              >
                {formatPercentTrim(m.pctApurado)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Região viva E alvo de foco. Ver "Foco depois de 'mostrar mais'". */}
      <p
        data-testid="municipios-status"
        ref={statusRef}
        role="status"
        tabIndex={-1}
        style={{
          margin: "var(--space-3) 0 0",
          font: "var(--type-data)",
          color: "var(--text-muted)",
        }}
      >
        Mostrando {visiveis.toLocaleString("pt-BR")} de {totalUf.toLocaleString("pt-BR")}{" "}
        {totalUf === 1 ? "município" : "municípios"}.
      </p>

      {restantes > 0 ? (
        <Button
          aria-controls={tabelaId}
          data-testid="municipios-carregar-mais"
          full
          onClick={carregarMais}
          // `md` = 44px (`--tap-min`): é alvo primário de toque no celular.
          size="md"
          style={{ marginTop: "var(--space-2)" }}
          variant="secondary"
        >
          Mostrar mais {proximoLote.toLocaleString("pt-BR")} · faltam{" "}
          {restantes.toLocaleString("pt-BR")}
        </Button>
      ) : null}
    </section>
  );
}
