/**
 * components/atoms/overlays/HoverCard.tsx
 *
 * Tooltip que segue o ponteiro sobre o mapa (UF / município). Design system
 * Atlas Menna (ADR-0025, Bloco 1), portado de
 * `docs/design-system/atlas-menna/components/layout/HoverCard.jsx`.
 *
 * Mostra o par editorial central do design: **Parcial em tinta × Projeção em
 * ocre**, lado a lado, para a região sob o cursor.
 *
 * Server Component (sem `"use client"`): não tem estado nem evento — posição,
 * título e linhas vêm todos por prop, e `pointer-events: none` garante que ele
 * nunca intercepta o ponteiro. O pai (o mapa) é que é client; importar daqui
 * não obriga este arquivo a declarar a diretiva, e assim ele continua
 * renderizável no SSR.
 *
 * A11y: `aria-hidden`. O cartão espelha, em pixels, o que o hover do mouse já
 * revelou; para quem navega por teclado ou leitor de tela a informação tem que
 * vir da tabela/lista que acompanha o mapa (RNF-023), não de um tooltip que
 * segue um ponteiro que essa pessoa não tem.
 *
 * Divergências deliberadas em relação ao `.jsx` do kit:
 *   - percentuais por `formatPercent()` (pt-BR, determinístico) em vez de
 *     `toFixed(1).replace(".", ",")` inline.
 *   - o cabeçalho "Proj." usa `--accent-text` (5.12:1) e não `--accent-strong`
 *     (4.21:1): é texto de 10px (constituição § 4).
 *   - a célula vazia do canto do grid virou `aria-hidden` explícito.
 *
 * 2026-09-18 (pedido do dono — aproximar do tooltip do mapa eleitoral do
 * NYT): duas colunas novas, "Partido" e "Votos", com o mesmo tratamento
 * degradável de "Parcial" (some do cartão quando NENHUMA linha tem o dado —
 * ver `hasColumn` abaixo). E o tratamento da linha VENCEDORA (fundo cheio +
 * ✓) — desde 2026-10-04 só para candidato MATEMATICAMENTE eleito
 * (`EdgeUfRow.eleitos_definidos`, via `lib/utils/eleitos-definidos.ts`; até
 * essa data era `chamada === true`, uma leitura da projeção) — ver a docstring
 * de `winnerBackground` para por que ele não pode aparecer sempre.
 *
 * 2026-09-18 (mesmo dia, mapa MUNICIPAL) — "Proj." deixa de ser a única
 * coluna que TODA chamada deste átomo garante. Município não tem projeção:
 * o modelo extrapola por ZONA eleitoral e agrega para a UF (ADR-0021), nunca
 * publica um número projetado por município — mostrar um ali seria inventar
 * dado que o produto não tem (constituição § 1). "Proj." agora usa a MESMA
 * degradação de `hasColumn` que "Parcial"/"Votos"/"Partido" já tinham: some
 * do cartão inteiro quando NENHUMA linha a carrega, em vez de uma coluna de
 * travessões prometendo um número que não existe. O balão do mapa NACIONAL
 * não muda de comportamento: `EdgeUfRow.top_candidatos[].pct` é campo
 * obrigatório (nunca `undefined`) — lá a coluna continua sempre presente,
 * só que agora por CONSEQUÊNCIA do dado, não por um caminho de código à
 * parte que não sabia degradar.
 *
 * 2026-09-19 (pedido do dono), duas mudanças independentes:
 *
 *   1. **A linha "Outros"** — `HoverCardRow.kind`. O balão passou de 3 para 4
 *      candidaturas mais uma linha de agregado com o que sobrou. O átomo não
 *      calcula nada disso: quem soma a cauda é o caller (o payload, no mapa
 *      nacional; `votosPorCandidatoMunicipio`, no municipal). Aqui `kind` só
 *      decide duas coisas visuais — o ponto de cor vira espaçador invisível e
 *      o nome recua para `--text-secondary` — e barra o tratamento de
 *      vencedor chamado nessa linha.
 *
 *   2. **`flipY`** — o cartão vira para CIMA perto da borda de baixo. Até
 *      aqui o deslocamento vertical era fixo em `+12px` nos DOIS ramos do
 *      ternário de `transform`: só existia flip horizontal, e passar o mouse
 *      em RS/SC (o pé do mapa) abria o cartão para baixo, onde a moldura
 *      (`PersistentMapFrame`, `overflow: hidden`) o cortava. Como no eixo
 *      horizontal, quem DECIDE é o mapa, nunca o átomo — 2026-09-19 decidia
 *      por um proxy (`y > rect.height / 2`); 2026-09-20 passou a medir o
 *      cartão de verdade (`lib/utils/hover-card-placement.ts`) porque aquele
 *      proxy cortava o balão em janelas estreitas. As três razões de o
 *      átomo nunca se medir continuam as mesmas — ver a nota nos dois
 *      mapas.
 */

import type { CSSProperties } from "react";
import { Fragment } from "react";

import { DestinoEtiqueta } from "@/components/atoms/data/DestinoEtiqueta";
import type { EdgeDestinoVoto } from "@/lib/edge-config/types";
import { exibePercentual } from "@/lib/utils/destino-voto";
import { formatPercent, formatVotes } from "@/lib/utils/format";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

export interface HoverCardRow {
  name: string;
  /**
   * Que espécie de linha é esta (2026-09-19, pedido do dono — o balão passou
   * a mostrar 4 candidaturas + o agregado do resto).
   *
   * **Ausente ⇒ `"candidatura"`**, e é por isso que este campo é opcional em
   * vez de obrigatório: todo call-site anterior a esta data segue válido sem
   * uma letra de mudança, e um `kind` esquecido cai no caso comum, não no
   * caso especial.
   *
   * 🔴 **Não é uma união discriminada de propósito.** A grade é um único
   * `rows.map` contra um `gridTemplateColumns` COMPARTILHADO — as cinco
   * colunas têm de existir (ou não existir) igualmente em todas as linhas,
   * senão a tabela desalinha. Uma união (`{kind:"outros", n:number} | {...}`)
   * obrigaria um ramo discriminado dentro de cada uma das cinco células para
   * ler campos que, no fim, são os MESMOS quatro números. O discriminador
   * aqui muda só duas coisas visuais (o ponto de cor vira espaçador; o nome
   * vai para `--text-secondary`), e nada da estrutura.
   */
  kind?: "candidatura" | "outros";
  /**
   * Cor do candidato/partido, `var(--token)`. Vira o ponto de 8×8 (linha
   * comum) — some quando `winnerBackground` está definido (o ✓ toma o lugar).
   *
   * **Opcional desde 2026-09-19, e só por causa de `kind: "outros"`**: aquela
   * linha não representa ninguém — é a soma de todo mundo que sobrou — e
   * portanto não tem identidade nem cor de identidade. O ponto de 8×8 dela é
   * um espaçador invisível (ver `HoverCard`), não um ponto cinza: um ponto
   * cinza inventaria identidade visual para "o resto". Toda linha
   * `"candidatura"` continua passando cor; um valor sentinela (`"transparent"`)
   * só para satisfazer um campo obrigatório seria pior — diria "esta linha tem
   * cor, e a cor é nenhuma", que é diferente de "esta linha não tem cor".
   */
  color?: string;
  /** Parcial (% de votos válidos apurados deste candidato nesta UF) em
   * 0–100. Ausente ou não-finita ⇒ a coluna "Parcial" some do cartão
   * inteiro (ver `HoverCard`), em vez de exibir uma coluna de travessões. */
  pct?: number;
  /**
   * Projeção em 0–100. Mesma degradação de `pct`/`votos`/`partido`
   * (2026-09-18): `undefined`/não-finita não vira mais travessão garantido —
   * a coluna "Proj." inteira some quando NENHUMA linha a carrega (ver
   * `hasColumn` em `HoverCard`). É o caso do mapa MUNICIPAL: não existe
   * projeção por município (ADR-0021 — o modelo extrapola por zona e agrega
   * para a UF), então nenhuma linha desse cartão tem `proj`, e a coluna nunca
   * chega a existir. O mapa NACIONAL continua com a coluna sempre visível
   * porque `EdgeUfRow.top_candidatos[].pct` é campo obrigatório — a garantia
   * hoje vem do DADO, não de um caminho de renderização que não sabia
   * degradar.
   */
  proj?: number;
  /** Sigla do partido — coluna "Partido". `undefined`/vazio ⇒ "—" na
   * linha; coluna inteira some quando NENHUMA linha a tem. */
  partido?: string;
  /** Votos absolutos apurados — coluna "Votos". `0` é publicado como "0"
   * (fato real, zero boletim chegado); só `undefined` vira "—". Coluna
   * inteira some quando NENHUMA linha tem o dado. */
  votos?: number;
  /**
   * Par (fundo, tinta) já RESOLVIDO pelo caller para a linha do candidato
   * MATEMATICAMENTE eleito — nunca calculado aqui. 🔴 2026-10-04 (dono): o
   * caller do mapa nacional (`buildHoverRows`) só o preenche para ids de
   * `EdgeUfRow.eleitos_definidos` (`lib/utils/eleitos-definidos.ts`); até essa
   * data preenchia por `chamada` (margem projetada > 10 pp). O texto abaixo,
   * que fala em "chamado", é histórico — a regra do átomo (obedecer o campo,
   * não o índice) continua a mesma. Este átomo não conhece partido (teste
   * (h), `HoverCard.test.tsx`): quem sabe se a UF foi chamada e qual token
   * de contraste usar é `_NationalChoroplethMapImpl.buildHoverRows`
   * (`partyChipInk`/`strongForRank`, medidos ≥4,5:1). `undefined` (o caso
   * comum — UF ainda não chamada) não pinta fundo nenhum; a linha marcada
   * recebe um negrito sóbrio (ver `HoverCard`) e a marca de vitória.
   *
   * 🔴 2026-09-20 — deixou de ser "só a linha de ÍNDICE 0". Desde que
   * `buildHoverRows` passou a reordenar as linhas pelo seletor
   * Parcial/Projeção (pedido do dono), o candidato CHAMADO (sempre o líder
   * PROJETADO — `row.chamada` é calculado sobre a margem projetada, nunca a
   * apurada) pode estar em qualquer posição da lista exibida. O caller marca
   * este campo por IDENTIDADE (o `id` do candidato chamado, onde quer que ele
   * caia depois de reordenar), nunca por posição — e o átomo obedece o campo,
   * não o índice.
   */
  winnerBackground?: string;
  /** Tinta legível sobre `winnerBackground` — anda sempre em par com ele. */
  winnerInk?: string;
  /**
   * ADR-0053 / RF-213 — `"anulado"`/`"sub_judice"` ganham a etiqueta textual
   * ao lado do nome. Quem monta as linhas é quem ordena (anulada no fim, antes
   * de "Outros"). `"anulado"` também apaga as células "Parcial" e "Proj." da
   * linha (emenda "opção A"): só os votos.
   */
  destino?: EdgeDestinoVoto;
  /**
   * 2026-09-29 (dono: "são 2 senadores eleitos") — o texto do selo de vaga
   * desta linha ("Vaga projetada" / "Vaga na parcial"), JÁ DECIDIDO pelo
   * caller. 🔴 2026-10-04 — o nome ficou, o conteúdo cresceu: é o selo de
   * BASE da linha, qualquer que seja a regra — também o de turno de
   * Governador ("2º turno · na parcial", "Vence no 1º turno · projeção"),
   * decidido por `selosDaBase` (`lib/utils/selo-resultado.ts`) dentro de
   * `buildHoverRows` (`_NationalChoroplethMapImpl.tsx`), que sabe a regra do
   * cargo, a base em que a lista foi ordenada, o turno e quem disputa. Este
   * átomo só desenha a pílula — a mesma forma do `<SeloPilula>` dos cartões,
   * em tamanho de balão. Ausente (Presidente na UF, 2º turno, quem está fora
   * dos dois primeiros/das vagas) ⇒ nada.
   */
  vaga?: string;
}

export interface HoverCardProps {
  /** Deslocamento do ponteiro dentro do contêiner do mapa, em px. */
  x: number;
  y: number;
  /** Vira o cartão para a esquerda quando ele encostaria na borda direita. */
  flip?: boolean;
  /**
   * Vira o cartão para CIMA quando ele encostaria na borda de baixo
   * (2026-09-19 — queixa do dono: hover em RS/SC abria o cartão para baixo e
   * a moldura do mapa o cortava).
   *
   * Simétrico a {@link flip} em tudo: mesmo default `false`, mesmo dono da
   * decisão (o MAPA, que conhece o contêiner; o átomo nunca se mede) e mesmo
   * deslocamento de 12px. Ver `_NationalChoroplethMapImpl.tsx` /
   * `ChoroplethMapUF.tsx` para o predicado e para o limite conhecido dele.
   */
  flipY?: boolean;
  title: string;
  kicker?: string;
  /** % apurado da região, 0–100. */
  apurado?: number;
  rows: readonly HoverCardRow[];
  /**
   * 2026-10-04 (dono) — uma linha discreta de rodapé, sob a tabela. Usada para
   * a atribuição da marca de eleito do Senado ("Cálculo do AtlasMenna sobre a
   * contagem do TSE", decidida pelo caller). Não alarga o cartão: a caixa tem
   * `contain: inline-size`, então ocupa a largura que a tabela já deu e quebra
   * linha dentro dela. Ausente ⇒ nada.
   */
  nota?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Piso da coluna do nome, em px — inclui o ponto de 8×8 e o `gap` que o separa
 * do texto. É o que impede o nome de ser espremido a zero pelas colunas
 * numéricas (ver o `minmax` em `HoverCard`). Dimensionado para caber um
 * primeiro nome inteiro mais o começo do segundo em `--type-body-sm`; nomes
 * longos truncam com reticências, que é o comportamento desejado — o defeito
 * era truncar ANTES da primeira letra terminar.
 */
const NOME_MIN_PX = 116;

/**
 * Quanto o teto de largura do cartão cresce por coluna opcional presente
 * ("Partido", "Votos", "Parcial"). Os 280px de base são o teto histórico do
 * cartão de duas colunas; cada coluna nova precisa do seu próprio espaço, ou
 * ela o toma do nome.
 */
const COLUNA_EXTRA_PX = 72;

/**
 * Quanto o teto de largura cresce quando alguma linha leva o selo de vaga
 * (2026-09-29): a pílula "Vaga projetada" mede ~90px + o `gap`, e sai da
 * coluna do NOME. Sem este acréscimo o teto antigo apertaria o nome — e entre
 * linha mais larga e nome cortado, o nome ganha (decisão do dono, 14/09).
 */
const SELO_VAGA_EXTRA_PX = 100;

/**
 * 2026-10-04 — o selo deixou de ser só o de vaga: Governador ganhou o de turno
 * ("Venceria no 1º turno · na parcial", 33 caracteres, mais que o dobro de
 * "Vaga projetada"). O acréscimo passa a acompanhar o MAIOR texto de selo do
 * cartão — ~6px por caractere a 10px bold, mais o `padding` e o `gap` —, com
 * {@link SELO_VAGA_EXTRA_PX} de piso, para o caso de vaga não mudar um pixel.
 */
const SELO_PX_POR_CARACTERE = 6;
const SELO_FOLGA_PX = 20;

/**
 * A pílula do selo de vaga — `--surface-inverse` + `--text-inverse`, o MESMO
 * par do `<SeloPilula>` (`CandidateResultRow.module.css`, `.pilula`), já medido
 * nos dois temas; só o tamanho é o do balão.
 */
const SELO_VAGA_STYLE: CSSProperties = {
  flex: "none",
  padding: "1px 6px",
  borderRadius: 999,
  background: "var(--surface-inverse)",
  color: "var(--text-inverse)",
  font: "700 10px / 1.3 var(--font-sans)",
  whiteSpace: "nowrap",
};

const HEAD_STYLE: CSSProperties = {
  // O `rowGap` da grade saiu em 19/09 (ver `CELULA_PADDING_BLOCK`); sem isto o
  // cabeçalho encostaria na 1ª candidatura.
  paddingBottom: "var(--space-1)",
  font: "var(--type-kicker)",
  letterSpacing: "var(--tracking-caps)",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  textAlign: "right",
};

/**
 * Cabeçalho da coluna de TEXTO ("Part."), alinhado à esquerda. Derivado de
 * {@link HEAD_STYLE} em vez de mutá-lo: o mesmo objeto é usado pelos quatro
 * cabeçalhos, e trocar `textAlign` nele levaria "Votos", "Parcial" e "Proj."
 * junto — números alinhados à esquerda perdem a coluna decimal, que é o que
 * torna a tabela comparável de relance.
 */
const HEAD_TEXT_STYLE: CSSProperties = { ...HEAD_STYLE, textAlign: "left" };

/**
 * Respiro vertical de cada célula, acima E abaixo do texto.
 *
 * Substitui o `rowGap` da grade desde 2026-09-19 — ver o comentário no
 * `display: "grid"`. Sendo `padding`, ele entra na altura da linha, e a faixa
 * que o fio separador desenha passa a conter o texto CENTRADO em vez de
 * encostado no topo. Mesmo valor do `rowGap` anterior, para o cartão não mudar
 * de altura: o que muda é de que lado a folga fica.
 */
const CELULA_PADDING_BLOCK = "var(--space-1)";

/**
 * Margem negativa que faz uma faixa de largura total (fundo do vencedor, fio
 * separador) **sangrar** até as bordas do cartão, desfazendo o `padding` dele.
 *
 * Constante e não literal repetido porque os dois valores têm de andar juntos:
 * o `padding` do cartão é `var(--space-3)`, e uma sangria que não o espelhe
 * deixa a faixa curta (faltando um lado) ou vazando para fora da borda. Quem
 * mudar o padding encontra esta constante ao lado.
 */
const SANGRIA = "calc(-1 * var(--space-3))";

function fmt(value: number | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : formatPercent(value);
}

function fmtVotos(value: number | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : formatVotes(value);
}

function fmtPartido(value: string | undefined): string {
  // 2026-09-19 — a coluna de partido do balão é DESENHADA, então abrevia
  // (`lib/utils/sigla-partido.ts`). O balão é o lugar mais apertado do
  // produto: ele se ajusta ao ponteiro e precisa caber ao lado do cursor em
  // 1280 px sem empurrar as colunas de número. O travessão de "sem partido"
  // atravessa a tabela intacto — não está nela.
  return value?.trim() ? siglaExibicao(value) : "—";
}

/**
 * Uma coluna numérica opcional ("Parcial", "Votos") só existe quando ALGUMA
 * linha tem o dado de verdade — nunca uma coluna inteira de travessões
 * prometendo um dado que o produto não tem.
 *
 * Até 2026-09-18 isto só valia para "Parcial": o payload do Edge Config
 * carregava parcial **agregada por região** (`pct_apurado`, no cabeçalho do
 * cartão), não por candidato — `EdgeUfRow.top_candidatos` só tinha
 * `pct_projetado`. Desde então `top_candidatos[]` também publica
 * `pct_atual`/`votos_atuais` por candidato (`api/model/project.py`), mas o
 * princípio de degradação continua: payload pré-migração ou sob
 * `model_fallback_tier` ainda não tem os campos, e a coluna some em vez de
 * mostrar travessão em toda linha.
 *
 * Mesmo dia, mesma função, um consumidor a mais: "Proj." passa a usar
 * `hasColumn` também (era a única coluna sem essa checagem — ver a docstring
 * de `HoverCardRow.proj`). O mapa municipal é quem nunca preenche `proj` em
 * linha nenhuma; o nacional preenche em todas (campo obrigatório do
 * payload), então na prática a coluna nunca sumiu de lá.
 */
function hasColumn(rows: readonly HoverCardRow[], pick: (r: HoverCardRow) => number | undefined) {
  return rows.some((r) => {
    const v = pick(r);
    return v != null && Number.isFinite(v);
  });
}

/** Mesma degradação de `hasColumn`, para a coluna de texto "Partido". */
function hasPartido(rows: readonly HoverCardRow[]): boolean {
  return rows.some((r) => !!r.partido && r.partido.trim() !== "");
}

export function HoverCard({
  x,
  y,
  flip = false,
  flipY = false,
  title,
  kicker,
  apurado,
  rows,
  nota,
  className,
  style,
}: HoverCardProps) {
  const parcial = hasColumn(rows, (r) => r.pct);
  const votos = hasColumn(rows, (r) => r.votos);
  const partido = hasPartido(rows);
  // 🔴 2026-09-18 (mapa municipal) — `proj` agora passa pelo MESMO `hasColumn`
  // das outras três. Antes era incondicional (comentário aqui dizia "é a
  // única métrica que TODA linha tem"), premissa que só valia para o mapa
  // NACIONAL. Município não tem projeção (ver docstring de `HoverCardRow.proj`)
  // e não deve fingir uma coluna vazia de travessões.
  const proj = hasColumn(rows, (r) => r.proj);
  // `minmax(NOME_MIN_PX, 1fr)` (nome) + uma coluna `auto` por dado disponível,
  // "Partido"/"Votos"/"Parcial"/"Proj." na ordem pedida pelo dono — cada uma
  // condicionada à sua própria checagem de presença, "Proj." incluída.
  //
  // 🔴 **`minmax`, não `1fr` puro** (2026-09-18, reportado pelo dono com
  // captura). `1fr` é *fração do que sobrar*, e com quatro colunas `auto`
  // numéricas não sobrava nada: o nome colapsava para a largura de UMA letra
  // ("FLAVIO BOLSONARO" virava "F") e o `text-ellipsis` não tinha nem espaço
  // para as reticências. `1fr` funcionava quando o balão tinha duas colunas;
  // ele não foi reavaliado quando o balão passou a ter cinco.
  //
  // O piso vence a fração: `minmax` garante a largura mínima do nome ANTES de
  // distribuir sobra, e as colunas numéricas (todas `auto`, conteúdo curto e
  // `whitespace-nowrap`) cedem o excedente. O nome ainda trunca com reticências
  // quando é longo de verdade — o que muda é que agora trunca legível.
  // `extras` NÃO conta `proj` (2026-09-18): o teto de `maxWidth` abaixo (280px
  // + `COLUNA_EXTRA_PX` por extra) já tratava "nome + Proj." como a base de
  // DUAS colunas do balão original — `proj` sempre esteve embutido nos 280,
  // nunca contado como extra. Mudar isso agora encolheria/alargaria o teto do
  // balão NACIONAL (que sempre tem `proj`) sem nenhum pedido do dono para tal;
  // no municipal, `proj` ausente só significa um teto ligeiramente folgado —
  // inofensivo, porque `width: max-content` já dimensiona pelo conteúdo real.
  const extras = [partido, votos, parcial].filter(Boolean).length;
  const temSeloVaga = rows.some((r) => r.kind !== "outros" && !!r.vaga);
  const maiorSelo = rows.reduce(
    (max, r) => (r.kind !== "outros" && r.vaga ? Math.max(max, r.vaga.length) : max),
    0,
  );
  const seloExtraPx = temSeloVaga
    ? Math.max(SELO_VAGA_EXTRA_PX, maiorSelo * SELO_PX_POR_CARACTERE + SELO_FOLGA_PX)
    : 0;
  const colunas = [
    { chave: "nome", trilho: `minmax(${NOME_MIN_PX}px, 1fr)`, presente: true },
    { chave: "partido", trilho: "auto", presente: partido },
    { chave: "votos", trilho: "auto", presente: votos },
    { chave: "parcial", trilho: "auto", presente: parcial },
    { chave: "proj", trilho: "auto", presente: proj },
  ].filter((c) => c.presente);
  const gridTemplateColumns = colunas.map((c) => c.trilho).join(" ");
  /**
   * Coluna de cada campo, 1-based, derivada da MESMA lista que monta o
   * template — nunca de um número escrito à mão.
   *
   * 🔴 **Toda célula precisa de linha E coluna explícitas.** O fio separador é
   * `gridColumn: "1 / -1"`: ele consome a faixa inteira da sua linha. Enquanto
   * as células eram auto-posicionadas, o CSS Grid não tinha onde encaixá-las
   * naquela linha e criava COLUNAS IMPLÍCITAS à direita — medido ao vivo em
   * 2026-09-19: um cartão declarando 5 colunas computava
   * `grid-template-columns` com **10**, e a coluna do nome caía para 15px
   * ("WILDER MORAIS" virava uma letra e reticências).
   *
   * Com linha e coluna definidas em todo item, não há auto-posicionamento
   * nenhum: o fio SOBREPÕE a linha em vez de disputá-la (o CSS Grid permite
   * itens sobrepostos quando as duas coordenadas são explícitas), e nenhuma
   * coluna implícita nasce.
   */
  const colDe = (chave: string): number => colunas.findIndex((c) => c.chave === chave) + 1;
  return (
    <div
      aria-hidden="true"
      data-testid="hover-card"
      data-flip={flip ? "true" : "false"}
      data-flip-y={flipY ? "true" : "false"}
      className={["pointer-events-none absolute rounded-sm", className].filter(Boolean).join(" ")}
      style={{
        left: x,
        top: y,
        // 🔴 **Um ternário por EIXO, nunca um de quatro casos** (2026-09-19).
        // As quatro combinações escritas à mão (`flip && flipY ? … : flip ? …
        // : flipY ? … : …`) são quatro strings que precisam concordar entre
        // si sobre os mesmos 12px; a primeira vez que alguém ajustar o
        // deslocamento, três delas mudam e uma fica para trás. Aqui os dois
        // eixos são independentes por construção, e os dois casos que já
        // existiam (`translate(12px, 12px)` e
        // `translate(calc(-100% - 12px), 12px)`) saem byte a byte idênticos
        // ao que saíam antes — é o que `HoverCard.test.tsx` (c) trava.
        transform: `translate(${flip ? "calc(-100% - 12px)" : "12px"}, ${
          flipY ? "calc(-100% - 12px)" : "12px"
        })`,
        zIndex: 20,
        // 🔴 **Encolhe para o conteúdo** (2026-09-18, 2ª queixa do dono sobre a
        // mesma coluna). Sem isto o cartão ocupava SEMPRE o `maxWidth`, a
        // coluna do nome (`1fr`) engolia toda a sobra, e com nome curto
        // ("LULA") abria um vão de ~200px até a sigla do partido. No tooltip do
        // NYT esse vão não existe: a caixa é larga porque os NOMES são longos
        // ("Donald J. Trump"), não porque há espaço morto.
        //
        // `max-content` faz `1fr` resolver para o tamanho do conteúdo; o
        // `minWidth` segue como piso do cartão, o `maxWidth` como teto, e o
        // piso `NOME_MIN_PX` da coluna continua impedindo o colapso quando o
        // teto aperta. Os dois defeitos — nome espremido a uma letra e nome
        // com vão enorme — eram o MESMO parâmetro mal calibrado nas duas
        // pontas.
        width: "max-content",
        minWidth: 220,
        // A largura máxima ACOMPANHA o número de colunas. Os 280px eram o teto
        // do balão de duas colunas (nome + projeção); com "Partido", "Votos" e
        // "Parcial" o mesmo teto espremia o nome até sumir. Cada coluna extra
        // ganha `COLUNA_EXTRA_PX`, e `min(92vw, …)` impede que o balão
        // ultrapasse a viewport — ele é posicionado junto ao cursor e um teto
        // em px puro sairia da tela em janela estreita.
        maxWidth: `min(92vw, ${280 + extras * COLUNA_EXTRA_PX + seloExtraPx}px)`,
        padding: "var(--space-3)",
        background: "var(--surface-card)",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-float)",
        animation: "am-fade var(--dur-fast) var(--ease-out)",
        ...style,
      }}
    >
      {kicker ? (
        <div
          style={{
            font: "var(--type-kicker)",
            letterSpacing: "var(--tracking-caps)",
            textTransform: "uppercase",
            color: "var(--text-secondary)",
          }}
        >
          {kicker}
        </div>
      ) : null}
      <div
        className="flex items-baseline justify-between"
        style={{ gap: "var(--space-3)", marginTop: 2, marginBottom: "var(--space-2)" }}
      >
        <div data-testid="hover-card-title" style={{ font: "var(--type-title)" }}>
          {title}
        </div>
        {apurado != null ? (
          <div
            data-testid="hover-card-apurado"
            className="whitespace-nowrap"
            style={{ font: "var(--type-data)", color: "var(--text-muted)" }}
          >
            {`${Math.round(Math.max(0, Math.min(100, apurado)))}% apurado`}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns,
          // 🔴 **Só `columnGap`. O respiro vertical mora na CÉLULA, não aqui**
          // (2026-09-19). Com `rowGap`, a folga entre linhas caía inteira
          // ABAIXO do texto: o fio separador é `border-top` de uma faixa que
          // começa no topo exato da linha, então a linha encostava no texto e
          // os 4px de sobra ficavam só embaixo. Medido: faixa de 23px, texto de
          // 19px, 0px acima e 4px abaixo.
          //
          // `paddingBlock` em cada célula ({@link CELULA_PADDING_BLOCK}) divide
          // a mesma folga nos dois lados, e o texto passa a ficar centrado
          // entre dois fios. O `rowGap` não pode voltar junto: os dois somados
          // dariam de novo uma sobra assimétrica, e a assimetria é invisível em
          // teste estático — só aparece medindo a tela.
          columnGap: "var(--space-3)",
          // 🔴 **`center`, não o `stretch` padrão** (2026-09-19, 2ª queixa do
          // dono sobre a mesma linha).
          //
          // As colunas não usam a mesma fonte: nome e sigla são
          // `--type-body-sm`, os números são `--type-figure-sm`, e as duas têm
          // `line-height` diferente. Com `stretch`, a linha toma a altura da
          // caixa mais ALTA e todas as outras são esticadas até ela — e dentro
          // de uma caixa esticada o texto fica no TOPO. Resultado: os números
          // subiam alguns pixels em relação ao nome, e a linha inteira parecia
          // encostada no fio de cima.
          //
          // ⚠️ Foi isto que a minha primeira medição não pegou: eu medi a
          // CAIXA da célula (que de fato tinha 4px acima e 4px abaixo) em vez
          // do texto dentro dela. A caixa estava centrada; o texto, não. Medir
          // a coisa errada com precisão dá um número certo sobre a pergunta
          // errada.
          alignItems: "center",
          font: "var(--type-body-sm)",
        }}
      >
        <span aria-hidden="true" />
        {/* "PART." abreviado a pedido do dono (2026-09-18), e alinhado à
            ESQUERDA como no tooltip do NYT — lá `PARTY`/`Dem.`/`Rep.`/`Lib.`
            têm as bordas esquerdas alinhadas, e só as colunas numéricas
            (`VOTES`, `PCT.`, `E.V.`) vão à direita. Alinhar a sigla à esquerda
            também a encosta no nome, que era a queixa: com o partido à direita
            sobrava um vão entre "LULA" e "PT". */}
        {partido ? <span style={HEAD_TEXT_STYLE}>Part.</span> : null}
        {votos ? <span style={HEAD_STYLE}>Votos</span> : null}
        {parcial ? <span style={HEAD_STYLE}>Parcial</span> : null}
        {proj ? <span style={{ ...HEAD_STYLE, color: "var(--accent-text)" }}>Proj.</span> : null}
        {rows.map((row, i) => {
          // 🔴 2026-09-20 — `winnerBackground != null` sozinho, SEM checar
          // `i === 0`. Até este commit a linha dizia "a líder é sempre a de
          // índice 0" — verdade enquanto o balão só existia numa ordem (a de
          // projeção). Desde que o caller (`buildHoverRows`,
          // `_NationalChoroplethMapImpl.tsx`) passou a reordenar as linhas
          // pelo seletor Parcial/Projeção, o líder CHAMADO (sempre o
          // projetado — `row.chamada` é calculado sobre a margem projetada)
          // pode aparecer em QUALQUER posição da lista exibida quando a base
          // ativa é "Parcial". Uma guarda de índice apagaria o ✓ da tela
          // inteira nesse caso — pior que mostrá-lo na linha errada, porque
          // não mostra nada. `winnerBackground` já É a decisão do caller
          // sobre QUEM foi chamado (ele resolve isso por IDENTIDADE, não por
          // posição); o átomo só precisa obedecer.
          //
          // 🔴 2026-09-19 — a linha "Outros" NUNCA recebe o tratamento de
          // vencedor chamado, nem que o caller mande `winnerBackground` nela.
          // Isso é o `!isOutros` abaixo: `buildHoverRows` nunca preenche
          // `winnerBackground` na linha de Outros, mas basta alguém escrever
          // um caller novo que preencha para uma UF chamada declarar "✓
          // Outros (7)" como vencedora da corrida. Um agregado de
          // candidaturas não vence eleição (constituição § 1).
          const isOutros = row.kind === "outros";
          const isCalledWinner = !isOutros && row.winnerBackground != null;
          const ink = isCalledWinner ? row.winnerInk : undefined;
          // 🔴 Emenda "opção A" ao ADR-0053 (dono, 2026-09-27) — a linha da
          // candidatura anulada não mostra PERCENTUAL nenhum, nem o apurado
          // nem o projetado: o dela é sobre `vvc`, o das demais sobre os votos
          // em disputa. Fica só a coluna "Votos". O portão é AQUI, no átomo,
          // e não em cada caller: são três balões (nacional, municipal,
          // cartograma) e um quarto caller esqueceria.
          const comPercentual = exibePercentual(row);
          return (
            <Fragment key={row.name}>
              {isCalledWinner ? (
                // 🔴 **Só a coluna do NOME**, não a linha inteira — correção de
                // uma leitura errada minha das capturas do NYT (2026-09-18).
                // Ali a faixa colorida cobre `✓ Hillary Clinton` e **termina
                // antes de `Dem.`**: os números (`385,234`, `48.3%`, `5`)
                // seguem em tinta escura sobre o fundo do cartão. Pintar a
                // linha toda troca a cor de quatro colunas de números e afoga
                // a comparação que a tabela existe para permitir.
                //
                // Sangra só à ESQUERDA, até a borda do cartão (no NYT a faixa
                // encosta na lateral); à direita ela para onde a coluna acaba.
                //
                // Item de grid explícito na linha `i + 2` (a 1ª é o
                // cabeçalho), desenhado ANTES das células de texto no DOM para
                // ficar por baixo delas — CSS Grid empilha por ordem de
                // pintura, não por posição (mesma regra do `z-index: auto`).
                <span
                  aria-hidden="true"
                  style={{
                    gridColumn: "1 / 2",
                    gridRow: i + 2,
                    // `stretch` explícito: a grade agora centra (ver
                    // `alignItems` acima) e uma FAIXA centrada encolheria para
                    // a altura do conteúdo — que aqui é zero. Ela precisa
                    // cobrir a linha inteira, de fio a fio.
                    alignSelf: "stretch",
                    background: row.winnerBackground,
                    // **Sangra até as bordas do cartão** (2026-09-18, fidelidade
                    // ao NYT): lá a faixa do vencedor encosta nas laterais da
                    // caixa, não para na primeira coluna. As margens negativas
                    // desfazem o `padding` do cartão; `SANGRIA` mantém os dois
                    // números amarrados — mudar o padding sem mudar a sangria
                    // deixaria a faixa curta ou vazando.
                    marginLeft: SANGRIA,
                    // Cantos retos: a faixa encosta na lateral esquerda do
                    // cartão e acompanha o raio dele em vez de desenhar o seu.
                    borderRadius: 0,
                  }}
                />
              ) : null}
              {/* Fio separador entre candidatos (NYT). Só a partir da 2ª linha
                  — acima da 1ª está o cabeçalho, que já se separa pelo peso e
                  pela cor. Nunca colide com a faixa do vencedor: ela só existe
                  em `i === 0` e o fio só em `i > 0`.

                  🔴 **Este `<span>` é `gridColumn: "1 / -1"` — ele OCUPA a
                  linha inteira da grade, não flutua sobre ela.** Enquanto as
                  células de texto eram auto-posicionadas, o CSS Grid colocava
                  primeiro os itens com linha explícita (os fios, em 3, 4, 5,
                  6…) e depois empurrava o texto para as linhas livres
                  seguintes. Resultado, medido em 2026-09-19 com 5 linhas: os
                  QUATRO fios empilhados logo abaixo do 1º colocado e nenhum
                  entre os demais.

                  O defeito existia desde que o fio foi escrito, mas com 3
                  candidatos eram dois fios juntos — passava por "espaçamento".
                  A 4ª linha e a de "Outros" o tornaram impossível de ignorar.
                  Por isso TODA célula desta linha declara `gridRow` abaixo:
                  auto-posicionamento e posicionamento explícito na mesma grade
                  não convivem. */}
              {i > 0 ? (
                <span
                  aria-hidden="true"
                  style={{
                    gridColumn: "1 / -1",
                    gridRow: i + 2,
                    // `stretch` explícito, pelo mesmo motivo da faixa do
                    // vencedor — e aqui o efeito é mais crítico: este `<span>`
                    // não tem conteúdo, e centrado ele viraria uma caixa de
                    // altura zero no MEIO da linha, desenhando o fio por cima
                    // do texto em vez de acima dele.
                    alignSelf: "stretch",
                    marginInline: SANGRIA,
                    borderTop: "1px solid var(--border-hairline)",
                  }}
                />
              ) : null}
              <span
                className="flex min-w-0 items-center"
                style={{
                  // Linha E coluna explícitas — ver o 🔴 em `colDe` acima.
                  gridRow: i + 2,
                  gridColumn: colDe("nome"),
                  paddingBlock: CELULA_PADDING_BLOCK,
                  gap: "var(--space-2)",
                  // 🔴 Negrito **só no vencedor chamado** (2026-09-18). Antes era
                  // `isLeading`, e isso é ênfase sem fato por trás: liderar a
                  // projeção com 12% apurado não é vencer, e o negrito era a
                  // única marca da linha 0 num cartão onde nada mais dizia por
                  // que ela se destacava. Quem lidera já se lê pela POSIÇÃO (a
                  // lista vem ordenada) e pela cor do estado no mapa. No NYT o
                  // único nome destacado é o do vencedor — e lá a apuração está
                  // em 100%. Constituição § 1: a tela não afirma o que não sabe.
                  fontWeight: isCalledWinner ? 600 : 400,
                  // `ink` (tinta legível sobre a faixa) vale SÓ aqui: a faixa
                  // cobre apenas esta coluna, e pintar os números de branco os
                  // deixaria ilegíveis sobre o fundo claro do cartão.
                  //
                  // 🔴 "Outros" em `--text-secondary` e **sem itálico**
                  // (2026-09-19). O recuo de cor diz "isto não é uma pessoa,
                  // é o resto da lista" sem tirar a linha da tabela. Itálico
                  // faria outra coisa: lê como comentário editorial do
                  // produto sobre o número, e este número é dado medido igual
                  // aos quatro de cima — mesma base, mesmo denominador.
                  color: isOutros ? "var(--text-secondary)" : ink,
                }}
              >
                {isCalledWinner ? (
                  // ✓ substitui o ponto de cor: a identidade partidária já
                  // está no FUNDO da linha inteira, um ponto da mesma cor por
                  // cima ficaria redundante (e às vezes ilegível contra ele).
                  <span aria-hidden="true" className="flex-none">
                    ✓
                  </span>
                ) : isOutros ? (
                  // 🔴 **Espaçador invisível de 8px, não um ponto cinza**
                  // (2026-09-19). Sem ele o rótulo "Outros (N)" perde os 8px
                  // do ponto mais o `gap` e desalinha das quatro linhas
                  // acima — a coluna de nomes deixa de ter uma borda
                  // esquerda só. Com um ponto CINZA o defeito seria outro e
                  // pior: inventaria uma identidade visual ("a cor de todo
                  // mundo que sobrou") para um agregado que, por definição,
                  // junta partidos de cores diferentes. O balão do NYT faz o
                  // mesmo — "Others" entra sem marcador.
                  <span aria-hidden="true" className="flex-none" style={{ width: 8, height: 8 }} />
                ) : (
                  <span
                    className="flex-none"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "var(--radius-xs)",
                      background: row.color,
                    }}
                  />
                )}
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{row.name}</span>
                {/* Nunca na linha "Outros": um agregado não ocupa vaga. */}
                {row.vaga && !isOutros ? (
                  <span data-testid="hover-card-vaga" style={SELO_VAGA_STYLE}>
                    {row.vaga}
                  </span>
                ) : null}
                {/* Sobre a faixa do eleito, a etiqueta herda a tinta dela. */}
                <DestinoEtiqueta destino={row.destino} sobreFaixa={isCalledWinner} />
              </span>
              {partido ? (
                <span
                  data-testid="hover-card-partido"
                  style={{
                    gridRow: i + 2,
                    gridColumn: colDe("partido"),
                    paddingBlock: CELULA_PADDING_BLOCK,
                    font: "var(--type-body-sm)",
                    textAlign: "left",
                  }}
                >
                  {fmtPartido(row.partido)}
                </span>
              ) : null}
              {votos ? (
                <span
                  data-testid="hover-card-votos"
                  style={{
                    gridRow: i + 2,
                    gridColumn: colDe("votos"),
                    paddingBlock: CELULA_PADDING_BLOCK,
                    font: "var(--type-figure-sm)",
                    textAlign: "right",
                  }}
                >
                  {fmtVotos(row.votos)}
                </span>
              ) : null}
              {parcial && comPercentual ? (
                <span
                  data-testid="hover-card-parcial"
                  style={{
                    gridRow: i + 2,
                    gridColumn: colDe("parcial"),
                    paddingBlock: CELULA_PADDING_BLOCK,
                    font: "var(--type-figure-sm)",
                    textAlign: "right",
                  }}
                >
                  {fmt(row.pct)}
                </span>
              ) : null}
              {proj && comPercentual ? (
                <span
                  data-testid="hover-card-proj"
                  style={{
                    gridRow: i + 2,
                    gridColumn: colDe("proj"),
                    paddingBlock: CELULA_PADDING_BLOCK,
                    font: "var(--type-figure-sm)",
                    textAlign: "right",
                    // 🔴 04/10 (dono): percentual projetado ⇒ cor da projeção.
                    // A faixa do vencedor cobre só a coluna do nome; esta
                    // célula fica sobre o `--surface-card` do balão.
                    color: "var(--color-pct-proj)",
                  }}
                >
                  {fmt(row.proj)}
                </span>
              ) : null}
            </Fragment>
          );
        })}
      </div>
      {nota ? (
        <div
          data-testid="hover-card-nota"
          style={{
            // `inline-size` contido: o tamanho intrínseco da nota é zero, então
            // ela nunca alarga o cartão (`width: max-content`) — só quebra
            // linha na largura que a tabela já definiu.
            contain: "inline-size",
            marginTop: "var(--space-2)",
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          {nota}
        </div>
      ) : null}
    </div>
  );
}
