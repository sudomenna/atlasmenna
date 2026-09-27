/**
 * components/blocks/VotacaoEleitorado.tsx
 *
 * Painel "Votação" (spec 021) — o eleitorado inteiro em três arcos, contado e
 * projetado. Renderiza em `<Panel>` próprio, depois da lista de candidaturas
 * (RF-192; a ordem das seções é responsabilidade de quem monta a página).
 *
 * ## Os três arcos, e por que são três
 *
 *   1. **Sobre os aptos**, seis fatias, com o não apurado NOMEADO em cinza.
 *   2. **Sobre o eleitorado instalado**, cinco fatias, sem residual.
 *   3. **Sobre os aptos**, cinco fatias projetadas para o fim da noite, e o
 *      residual ali se chama "Anulados e sub judice" — num gráfico do FIM da
 *      apuração não existe seção por apurar (ver {@link fatiasCirculo3}).
 *
 * Existem três porque a aritmética do TSE não fecha num arco só. Do dicionário
 * oficial (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:459-468`):
 * `comparecimento + abstencao` fecha em `instalados`, **nunca** em `aptos`; e
 * `validos + brancos + nulos` deixa de fora `anulados` e `sub_judice`, que o
 * EA20 põe dentro do comparecimento sem pertencer a candidato, branco ou nulo.
 * Medido na captura real do simulado a 100% apurado
 * (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`): `aptos` 163.079.139
 * contra `instalados` 163.078.872, e `anulados + sub_judice` = 19.722.460 votos
 * — **14,2% do comparecimento**. Um arco só teria 14% de buraco mudo.
 *
 * ## 🔴 A quinta fatia é derivada por SUBTRAÇÃO, nunca por um campo
 *
 * Cada arco fecha na SUA base, e nenhum deles fecha por arredondamento:
 *
 *   - **arco 1** fecha em `aptos` por IDENTIDADE do TSE, porque as seis fatias
 *     são exatamente a decomposição de `aptos` (ver {@link fatiasCirculo1});
 *   - **arco 2** fecha em `instalados`, que é a soma das suas cinco;
 *   - **arco 3** fecha em `aptos` por CONSTRUÇÃO, porque a quinta fatia é
 *     `aptos − (as quatro projetadas)`.
 *
 * Em nenhum deles uma fatia é calculada à parte e torcida para caber: quando a
 * conta não bate, o arco devolve `null` e a tela diz que o dado não fecha, em
 * vez de publicar um círculo que não soma (constituição § 6).
 *
 * 🔴 **"Ainda não apurado" deixou de ser o resto de tudo em 2026-09-26.** Era
 * `aptos − (validos+brancos+nulos+abstencao)`, e por isso continha TAMBÉM os
 * votos anulados — duas coisas cuja proporção **se inverte ao longo da noite**.
 * Medido na fixture do simulado a 25% apurado, aquele resto era 96,1% de seção
 * por apurar e 3,9% de anulado; no fim da noite seria 0% e 100%, isto é, uma
 * fatia chamada "Ainda não apurado" contendo só voto anulado. Agora
 * `nao_apurado = aptos − instalados` e o anulado tem fatia própria, e os dois
 * rótulos seguem verdadeiros às 23h.
 *
 * ⚠️ No arco 3 a fatia "Ainda não apurado" simplesmente **não existe**: o
 * gráfico é do FIM da apuração, quando `aptos − instalados → 0`. O que sobra
 * ali é anulado, e é assim que o residual se chama.
 *
 * ## Senado: os três arcos contam VOTOS (RF-195c, spec 022 RF-210, 2026-09-27)
 *
 * Com duas vagas cada eleitor dá dois votos, e o TSE soma votos: nas capturas
 * reais do simulado, cargo 5, `tv == 2 × c` (`tests/fixtures/tse/2026-sim/senado/`).
 * Os campos de voto chegam em votos; `aptos`, `instalados` e `abstencao` em
 * pessoas. Por isso `votosPorEleitor` (a página passa `EdgePayloadUf.vagas`)
 * multiplica as PESSOAS — nunca divide os votos: não existe meio eleitor. A
 * base passa a se chamar "votos (2 por eleitor)" e a metodologia diz por quê.
 *
 * ## O seletor Parcial/Projeção escolhe os arcos (RF-195b, 2026-09-27)
 *
 * Arcos 1 e 2 são da visão "Parcial" e o arco 3 da "Projeção", via
 * `data-view-only` (ADR-0029 § 2): os três seguem no HTML e a cascata de
 * `app/globals.css` esconde o outro lado — nenhum JS novo. A metodologia tem um
 * parágrafo por visão. A grade ({@link GRADE_DOS_ARCOS}) mantém o tamanho do
 * arco igual nas duas visões.
 *
 * ## Três estados, e colapsar dois é o erro (RF-193b vs RF-198)
 *
 * | no payload                                   | o que é       | o que sai na tela            |
 * |----------------------------------------------|---------------|------------------------------|
 * | `votacao` ausente                            | não sabemos   | `<DetailUnavailable>`        |
 * | `contagens` com `aptos > 0`, resto `0`        | não começou   | arco 1 inteiro em "não apurado" |
 * | qualquer fatia `> 0`                         | apurando      | arco 1 normal                |
 *
 * São os três estados que o dono fixou em 14/09. O "não começou" cai fora da
 * subtração sozinho (`aptos − 0 = aptos`), então não há transição a programar
 * e **nenhum zero é fabricado**: o estado só é alcançável quando o produtor
 * publicou `aptos` de verdade. Já o arco 2 tem denominador ZERO nesse estado e
 * por isso NÃO renderiza fatias — renderiza "sem base apurada", presente no
 * DOM. Imprimir "0,0%" ali seria afirmar uma medição que não existe.
 *
 * ## Cor: nenhum partido é dono do voto nulo (constituição § 2)
 *
 * As cinco fatias são neutras por construção, e saem de {@link FATIA_COR} —
 * ponto único, para que a troca por tokens definitivos seja uma edição só.
 * Contrastes medidos contra `--surface-page` nos DOIS temas (claro #f3f4f6 /
 * escuro #14171b), porque um cinza que passa no claro costuma reprovar no
 * escuro:
 *
 *   --ink-1 ....................... 12,25:1 / 12,43:1
 *   --color-part-brancos-nulos ....  6,67:1 /  5,63:1
 *   --color-part-abstencao ........  8,19:1 /  5,67:1
 *
 * ⚠️ **Brancos e nulos dividem o MESMO token** porque o kit só tem um
 * (`--color-part-brancos-nulos`) — ele nasceu para a métrica agregada
 * "brancos e nulos" do hero, que esta spec separa em duas fatias. Em vez de
 * inventar um hex solto, "brancos" recebe a mesma cor com **hachura**: a
 * distinção é de padrão, não de matiz, o que também a torna legível para quem
 * não distingue as duas (WCAG 1.4.1 — a cor nunca é o único portador). Os
 * cinzas pálidos do kit foram medidos e REPROVAM: `--paper-3` dá 1,20:1 no
 * claro, e `--color-band-tossup` 1,28:1 (esses tokens de banda não são
 * redefinidos no tema escuro, então `--color-band-very_likely` cai a 1,85:1
 * lá). O residual usa `--surface-sunken` com contorno em `--border-strong`:
 * é o contorno que dá a borda perceptível, não o preenchimento.
 *
 * ## Nenhum texto dentro do SVG — de propósito
 *
 * O axe deste projeto joga contraste de texto em SVG no balde `incomplete`,
 * que **não reprova nada** (18 nós assim em `/sobre-o-modelo`). Aqui o SVG tem
 * só caminhos: o número grande e a legenda são HTML por cima do arco, em
 * `--text-primary` / `--text-secondary` sobre a superfície da página, onde o
 * contraste é medido de verdade. A tradução textual do gráfico (RNF-023) é a
 * legenda **visível** — não uma tabela escondida, que além de duplicar a
 * verdade cairia na armadilha de 2026-09-19 (`sr-only` não recorta `<table>`:
 * 2.424px de rolagem horizontal medidos no celular).
 *
 * Cada arco é um `<figure>` com `<figcaption>` que NOMEIA A BASE do
 * percentual, e é isso que satisfaz RF-196 sem repetir "de 163.079.139
 * eleitores aptos" em cinco linhas: as fatias estão dentro da figura cuja
 * legenda declara o denominador.
 *
 * Server Component puro — sem `"use client"`, sem estado, sem evento. O painel
 * entra no lado eager de `/` e das quatro telas de UF (spec 021 RF-192,
 * emendado em 2026-09-26 à noite: saiu das capas de Governador, Senador e
 * Deputado) e não pode custar bundle (RNF-007a, teto de 150 KiB de aplicação
 * acima da dobra). Numa UF, `kicker` e `votacao` são os DA UF — nenhum texto
 * deste componente diz "Brasil".
 */

import type { CSSProperties } from "react";

import { DetailUnavailable } from "@/components/atoms/surfaces/DetailUnavailable";
import { Panel } from "@/components/atoms/surfaces/Panel";
import type {
  EdgeVotacao,
  EdgeVotacaoContagens,
  EdgeVotacaoProjetada,
} from "@/lib/edge-config/types";
import type { ViewMode } from "@/lib/state/view-mode";
import { formatPercent, formatVotes } from "@/lib/utils/format";

// ---------------------------------------------------------------------------
// A grade dos arcos — compartilhada com o painel da corrida (spec 022)
// ---------------------------------------------------------------------------

/** Vão horizontal entre arcos. Entra na conta da faixa mínima abaixo. */
const VAO_COLUNA = "var(--space-6)";

/**
 * Grade dos arcos, em faixas de UM TERÇO do painel (nunca menos de 260px).
 *
 * 🔴 Era `repeat(auto-fit, minmax(260px, 1fr))` até 2026-09-27, e deixou de
 * servir quando o seletor Parcial/Projeção passou a esconder arcos (spec 021
 * RF-195b, spec 022 RF-211). `auto-fit` COLAPSA as faixas vazias e o `1fr`
 * distribui a sobra entre os itens visíveis — medido no navegador em
 * `/uf/BA/deputado-federal` a 1280px: painel de 1.217px, três arcos de 390px
 * cada. Com o seletor escondendo arcos, os dois do Parcial passariam a 596px e
 * o único da Projeção a 1.217px: o mesmo gráfico com três tamanhos conforme a
 * visão.
 *
 * `auto-fill` mantém as faixas vazias no lugar, e a faixa mínima de um terço
 * fixa QUANTAS cabem — três num painel largo, sem que uma quarta de 260px se
 * encaixe e encolha as outras. O arco fica do mesmo tamanho nas duas visões,
 * alinhado à esquerda com o título do painel. Num painel estreito (a coluna
 * lateral da home, o celular) o terço fica abaixo de 260px, cabe UMA faixa e o
 * `1fr` a estica — igual a antes.
 *
 * O `- 1px` é folga de arredondamento: três terços exatos mais dois vãos somam
 * exatamente 100%, e um épsilon de ponto flutuante a mais derrubaria a grade
 * para duas faixas.
 *
 * ⚠️ Não há vão fantasma aqui (a armadilha de 2026-09-20, `app/globals.css`):
 * aquela era uma grade de faixas EXPLÍCITAS; nesta os itens escondidos saem do
 * posicionamento automático e os visíveis ocupam as primeiras faixas.
 */
export const GRADE_DOS_ARCOS: CSSProperties = {
  display: "grid",
  gridTemplateColumns: `repeat(auto-fill, minmax(max(260px, calc((100% - 2 * ${VAO_COLUNA}) / 3 - 1px)), 1fr))`,
  gap: `var(--space-5) ${VAO_COLUNA}`,
};

// ---------------------------------------------------------------------------
// Vocabulário das fatias
// ---------------------------------------------------------------------------

/** As cinco fatias, na ordem canônica do RF-193. */
/**
 * As seis fatias, na ordem canônica do RF-193.
 *
 * 🔴 `anulados` entrou em 2026-09-26, e a razão está na árvore do TSE
 * (`tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:459-468`):
 *
 *     tv ──> vvc (votáveis) + vb (brancos) + tvn (nulos) + vscv
 *       vvc ──> vv (válidos) + van (anulados) + vansj (sub judice)
 *
 * O **nulo** é IRMÃO de "votáveis": o eleitor não escolheu ninguém. O
 * **anulado** está DENTRO de votáveis, ao lado dos válidos: o eleitor escolheu
 * alguém e a Justiça anulou depois. São ramos diferentes, e por isso a fatia
 * não pode parecer uma variação de "nulo" — nem no rótulo, nem na cor.
 */
export type FatiaKey = "validos" | "brancos" | "nulos" | "anulados" | "abstencao" | "nao_apurado";

/** Ordem canônica do RF-193 — o arco 1 usa as seis. */
export const ORDEM_FATIAS: readonly FatiaKey[] = [
  "validos",
  "brancos",
  "nulos",
  "anulados",
  "abstencao",
  "nao_apurado",
] as const;

/**
 * As cinco fatias do eleitorado INSTALADO — tudo menos o que nem chegou a
 * abrir seção. É a composição do arco 2, e também a do arco 3 (onde a quinta
 * é derivada em vez de contada).
 */
export const FATIAS_INSTALADAS: readonly Exclude<FatiaKey, "nao_apurado">[] = [
  "validos",
  "brancos",
  "nulos",
  "anulados",
  "abstencao",
] as const;

/** As quatro fatias que a projeção publica. A quinta ela NÃO publica — ver {@link fatiasCirculo3}. */
export const FATIAS_PROJETADAS: readonly ("validos" | "brancos" | "nulos" | "abstencao")[] = [
  "validos",
  "brancos",
  "nulos",
  "abstencao",
] as const;

export const FATIA_LABEL: Record<FatiaKey, string> = {
  validos: "Votos válidos",
  brancos: "Votos em branco",
  nulos: "Votos nulos",
  anulados: "Anulados e sub judice",
  abstencao: "Abstenção",
  nao_apurado: "Ainda não apurado",
};

/**
 * Textura desenhada por cima do preenchimento, na cor da superfície.
 *
 *   - `"listras"` — bandas finas ATRAVESSANDO a fita (brancos);
 *   - `"pontos"`  — malha de furos (anulados);
 *   - `"trilho"`  — uma linha fina CORRENDO AO LONGO da fita. Entrou com a
 *     spec 022 para a fatia "Outros" do painel da corrida, que divide o
 *     círculo com as três fatias cinzentas de cima e não tem tom neutro que as
 *     separe por luminância (ver `components/blocks/CorridaTresCirculos.tsx`).
 *
 * As três são geometricamente diferentes entre si — transversal, pontual,
 * longitudinal — para se distinguirem duas a duas sem depender de matiz.
 */
export type PadraoFatia = "listras" | "pontos" | "trilho";

/**
 * Como uma fatia é pintada. Genérico desde a spec 022: o arco serve tanto às
 * fatias neutras deste painel ({@link FATIA_COR}) quanto às de candidatura do
 * painel da corrida, que pintam pela sigla.
 */
export interface CorFatia {
  fill: string;
  padrao?: PadraoFatia;
  /** Linha de 1px ao longo do meio da fita — o residual pálido (RF-193). */
  contorno?: string;
  /**
   * Borda de 1px dos DOIS lados da fita (desenhada por baixo, 2px mais
   * larga). É o `DATA_FILL_STROKE` de `_candidateColor.ts` aplicado ao arco:
   * preenchimento com extensão em cor de partido precisa de borda, porque
   * quatro bases da paleta ficam abaixo de 3:1 contra o papel claro
   * (`docs/nfr/accessibility.md`, "Os dois remédios").
   */
  borda?: string;
}

/**
 * Ponto único da cor das fatias — ver o § "Cor" no cabeçalho do arquivo para
 * os contrastes medidos e para a razão de a distinção ser de PADRÃO e não de
 * matiz em duas delas.
 *
 * `padrao` desenha por cima do preenchimento, na cor da superfície:
 * `"listras"` são bandas finas atravessando a fita; `"pontos"`, uma malha de
 * furos. São texturas deliberadamente diferentes entre si, porque "brancos" e
 * "anulados" precisam se distinguir **um do outro** e de "nulos" — três
 * fatias que o kit não tem três tons neutros para separar.
 */
export const FATIA_COR: Record<FatiaKey, CorFatia> = {
  validos: { fill: "var(--ink-1)" },
  brancos: { fill: "var(--color-part-brancos-nulos)", padrao: "listras" },
  nulos: { fill: "var(--color-part-brancos-nulos)" },
  anulados: { fill: "var(--ink-2)", padrao: "pontos" },
  abstencao: { fill: "var(--color-part-abstencao)" },
  nao_apurado: { fill: "var(--surface-sunken)", contorno: "var(--border-strong)" },
};

// ---------------------------------------------------------------------------
// Aritmética — exportada porque é onde os defeitos moram
// ---------------------------------------------------------------------------

/** Uma fatia já resolvida: rótulo, absoluto e percentual sobre a base do arco. */
export interface Fatia {
  key: FatiaKey;
  label: string;
  abs: number;
  pct: number;
}

/** As quatro fatias que a projeção publica (`EdgeVotacaoProjetada`). */
export interface QuatroFatias {
  validos: number;
  brancos: number;
  nulos: number;
  abstencao: number;
}

/** `validos + brancos + nulos + abstencao` — o que a projeção publica. */
export function somaQuatro(q: QuatroFatias): number {
  return q.validos + q.brancos + q.nulos + q.abstencao;
}

/**
 * `anulados + sub_judice` — uma fatia só na tela, porque são o mesmo fato para
 * o leitor (voto dado a alguém e depois anulado) e o sub judice é a parte
 * ainda sob decisão. O RF-197 exige que a soma apareça declarada.
 */
export function anuladosTotal(c: EdgeVotacaoContagens): number {
  return c.anulados + c.sub_judice;
}

/**
 * "Ainda não apurado" = `aptos − instalados`.
 *
 * 🔴 Desde 2026-09-26 isto é uma SUBTRAÇÃO ESPECÍFICA, e não mais o resto de
 * tudo. A diferença não é cosmética: como resto, a fatia continha também os
 * votos anulados, e a proporção das duas coisas **se inverte ao longo da
 * noite**. Medido na fixture do simulado a 25% apurado, o resto do arco 1 era
 * 96,1% seção-não-apurada e 3,9% anulado — quase certo. No fim da noite seria
 * 0% e 100%: uma fatia chamada "Ainda não apurado" contendo só voto anulado.
 * Agora cada coisa tem a sua fatia e o rótulo continua verdadeiro às 23h.
 */
export function naoApuradoInstalacao(c: EdgeVotacaoContagens): number {
  return c.aptos - c.instalados;
}

// ---------------------------------------------------------------------------
// Senado: a unidade é VOTO, não eleitor (spec 022 RF-210, spec 021 RF-195c)
// ---------------------------------------------------------------------------

/**
 * `true` quando `k` pode ser o número de votos de cada eleitor: inteiro ≥ 1.
 *
 * Qualquer outra coisa (0, negativo, fração, `NaN`) faz as fatias devolverem
 * `null` — "não fecha" — em vez de multiplicar por um número que não existe.
 * Quem decide o `k` de uma corrida é a PÁGINA (a partir de
 * `EdgePayloadUf.vagas`), e ela recusa o que não for 1 ou 2; aqui a guarda é
 * só a de não fazer aritmética com lixo.
 */
export function votosPorEleitorValido(k: number): boolean {
  return Number.isSafeInteger(k) && k >= 1;
}

/**
 * Nome da unidade quando cada eleitor dá `k > 1` votos: "votos (2 por
 * eleitor)". Ponto único — os dois painéis (este e `CorridaTresCirculos`)
 * nomeiam a base com ele.
 */
export function unidadeVotos(k: number): string {
  return `votos (${k} por eleitor)`;
}

/**
 * Frase da metodologia do Senado, sem jargão (RF-210). Só existe com `k > 1`.
 * "dois" por extenso no caso de 2026; outro `k` sai em algarismo.
 */
export function fraseVotosPorEleitor(k: number): string {
  const n = k === 2 ? "dois" : String(k);
  return `No Senado cada eleitor dá ${n} votos, um para cada vaga em disputa — por isso estes gráficos contam votos, e não eleitores.`;
}

/** Percentual sobre uma base, com guarda de divisão por zero. */
function pctDe(parte: number, base: number): number {
  return base > 0 ? (parte / base) * 100 : 0;
}

/** Monta as fatias de um mapa de absolutos, na ordem canônica pedida. */
function montar(chaves: readonly FatiaKey[], abs: Record<string, number>, base: number): Fatia[] {
  return chaves.map((key) => ({
    key,
    label: FATIA_LABEL[key],
    abs: abs[key] ?? 0,
    pct: pctDe(abs[key] ?? 0, base),
  }));
}

/**
 * Arco 1 (RF-193): as SEIS fatias sobre `aptos`.
 *
 * ## Por que elas fecham — identidade, não sorte
 *
 * Do dicionário do TSE:
 *
 *     instalados   = comparecimento + abstencao
 *     comparecimento = validos + brancos + nulos + anulados + sub_judice (+ vscv)
 *
 * Logo `aptos = (aptos − instalados) + abstencao + validos + brancos + nulos +
 * anulados + sub_judice`, que são exatamente as seis fatias. Conferido nas
 * quatro fixtures do simulado: `vscv = 0` e a soma bate `aptos` na casa da
 * unidade.
 *
 * ⚠️ Mas `vscv` (votos sem candidato válido) existe no leiaute e o payload não
 * o carrega. Se algum dia vier diferente de zero, as seis somam MENOS que
 * `aptos` e o anel não fecha. Por isso a checagem abaixo é explícita: devolve
 * `null` e a tela diz que o dado não fecha, em vez de desenhar um anel com um
 * vão mudo ou de inflar uma fatia para tapá-lo (constituição § 6).
 *
 * ## `votosPorEleitor` — o Senado (spec 022 RF-210, spec 021 RF-195c)
 *
 * Os campos de VOTO (`validos`, `brancos`, `nulos`, `anulados`, `sub_judice`)
 * chegam em votos; `aptos`, `instalados` e `abstencao` chegam em PESSOAS.
 * Com uma vaga as duas unidades coincidem. Com duas, cada eleitor dá dois
 * votos, e o TSE soma assim — medido nas capturas reais do simulado, cargo 5
 * (`tests/fixtures/tse/2026-sim/senado/`): `tv == 2 × c`, exato nas 4 UFs.
 * Somar votos com pessoas faz o arco "não fechar". A regra: as quantidades de
 * PESSOAS × `k` (abstenção e o não apurado `aptos − instalados`), os campos
 * de voto como vêm, e a base é `aptos × k`. A alternativa — dividir os votos
 * por `k` — é proibida pelo RF-210: não existe meio eleitor.
 */
export function fatiasCirculo1(c: EdgeVotacaoContagens, votosPorEleitor = 1): Fatia[] | null {
  if (!votosPorEleitorValido(votosPorEleitor)) return null;
  const k = votosPorEleitor;
  const base = c.aptos * k;
  const abs: Record<FatiaKey, number> = {
    validos: c.validos,
    brancos: c.brancos,
    nulos: c.nulos,
    anulados: anuladosTotal(c),
    abstencao: c.abstencao * k,
    nao_apurado: naoApuradoInstalacao(c) * k,
  };
  if (Object.values(abs).some((v) => v < 0)) return null;
  const soma = Object.values(abs).reduce((s, v) => s + v, 0);
  if (soma !== base) return null;
  return montar(ORDEM_FATIAS, abs, base);
}

/**
 * Arco 2 (RF-194): as CINCO fatias do eleitorado instalado, sem "ainda não
 * apurado" — por construção, aqui só entra quem já teve seção aberta.
 *
 * A base é `instalados`, que é exatamente a soma das cinco. É mais honesta que
 * a soma-das-quatro que este arco usava até 2026-09-26: aquela deixava os
 * anulados fora do denominador **e** fora da legenda, e o gráfico fechava em
 * 100% escondendo 12% do eleitorado.
 *
 * Devolve `[]` quando `instalados` é zero (RF-193b — a apuração não começou),
 * e `null` quando as cinco não fecham em `instalados`.
 *
 * Senado (`votosPorEleitor = k > 1`): base `instalados × k` e abstenção × k;
 * os votos como vêm — ver {@link fatiasCirculo1}.
 */
export function fatiasCirculo2(c: EdgeVotacaoContagens, votosPorEleitor = 1): Fatia[] | null {
  if (!votosPorEleitorValido(votosPorEleitor)) return null;
  if (c.instalados <= 0) return [];
  const k = votosPorEleitor;
  const base = c.instalados * k;
  const abs: Record<string, number> = {
    validos: c.validos,
    brancos: c.brancos,
    nulos: c.nulos,
    anulados: anuladosTotal(c),
    abstencao: c.abstencao * k,
  };
  if (Object.values(abs).some((v) => v < 0)) return null;
  const soma = Object.values(abs).reduce((s, v) => s + v, 0);
  if (soma !== base) return null;
  return montar(FATIAS_INSTALADAS, abs, base);
}

/**
 * Arco 3 (RF-195): as quatro projeções CRUAS mais uma quinta fatia derivada
 * por subtração — e essa quinta se chama **"Anulados e sub judice"**, não
 * "Ainda não apurado".
 *
 * 🔴 Este rótulo não foi escolhido por analogia com o arco 1; ele é o que a
 * subtração de fato contém, e a razão é a palavra "projeção". O arco 3 mostra
 * o **fim da apuração**, e no fim `aptos − instalados → 0`: não sobra seção
 * por apurar, por definição. O que sobra dentro de `aptos` depois das quatro
 * projeções é o voto anulado, que **não projeta para zero** — ele continua
 * existindo depois da última urna contada.
 *
 * Medido na fixture do simulado a 25% apurado: o residual do arco 3 era
 * 19.270.021, e `anulados + sub_judice` era 19.270.021 — 100%, contra 3,9% no
 * arco 1 no mesmo instante. Era esse descompasso que punha a fatia "Ainda não
 * apurado" dentro de um gráfico do fim da apuração, que é uma contradição.
 *
 * Por isso `EdgeVotacaoProjetada` só tem quatro campos: o anulado projetado
 * não é publicado porque ele **é** o residual, e derivá-lo garante que o anel
 * feche em `aptos` por construção.
 *
 * Senado (`votosPorEleitor = k > 1`): a projeção segue a mesma divisão de
 * unidades das contagens — `validos`, `brancos` e `nulos` projetados são
 * VOTOS; `abstencao` projetada são PESSOAS, e entra × k. A base é
 * `aptos × k`, e o residual continua sendo o anulado projetado, em votos.
 */
export function fatiasCirculo3(
  c: EdgeVotacaoContagens,
  p: EdgeVotacaoProjetada,
  votosPorEleitor = 1,
): Fatia[] | null {
  if (!votosPorEleitorValido(votosPorEleitor)) return null;
  const k = votosPorEleitor;
  const base = c.aptos * k;
  if (p.validos < 0 || p.brancos < 0 || p.nulos < 0 || p.abstencao < 0) return null;
  const abstencao = p.abstencao * k;
  const residual = base - (p.validos + p.brancos + p.nulos + abstencao);
  if (residual < 0) return null;
  const abs: Record<string, number> = {
    validos: p.validos,
    brancos: p.brancos,
    nulos: p.nulos,
    anulados: residual,
    abstencao,
  };
  return montar(FATIAS_INSTALADAS, abs, base);
}

// ---------------------------------------------------------------------------
// Geometria do arco — semicírculo, SVG inline, zero dependência
// ---------------------------------------------------------------------------

const VB_W = 320;
const VB_H = 180;
const CX = VB_W / 2;
const CY = 164;
const R = 132;
const ESPESSURA = 26;
/** Vão entre fatias, em graus. Só aplicado quando a fatia é larga o bastante
 *  para sobrar arco — sem isso uma fatia de 0,3% desapareceria no vão. */
const VAO_DEG = 1.2;

function ponto(angDeg: number): [number, number] {
  const rad = (angDeg * Math.PI) / 180;
  return [CX + R * Math.cos(rad), CY + R * Math.sin(rad)];
}

/**
 * Caminho de um setor do semicírculo superior — 180° (esquerda) a 360°
 * (direita). `largeArc` é sempre 0: nenhuma fatia de um semicírculo passa de
 * 180°.
 */
export function caminhoArco(inicioDeg: number, fimDeg: number): string {
  const [x1, y1] = ponto(inicioDeg);
  const [x2, y2] = ponto(fimDeg);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * Ângulos de cada fatia, proporcionais ao absoluto, cobrindo 180°. Genérico na
 * chave desde a spec 022 — o painel da corrida tem fatias por candidatura.
 */
export function angulosDasFatias<K extends string>(
  fatias: readonly { key: K; abs: number }[],
  total: number,
): { key: K; inicio: number; fim: number }[] {
  if (total <= 0) return [];
  let cursor = 180;
  return fatias.map((f) => {
    const sweep = (f.abs / total) * 180;
    const inicio = cursor;
    cursor += sweep;
    // Vão só quando sobra arco depois de tirá-lo dos dois lados.
    const cabeVao = sweep > VAO_DEG * 2 + 0.4;
    return {
      key: f.key,
      inicio: cabeVao ? inicio + VAO_DEG / 2 : inicio,
      fim: cabeVao ? cursor - VAO_DEG / 2 : cursor,
    };
  });
}

// ---------------------------------------------------------------------------
// Arco + legenda
// ---------------------------------------------------------------------------

/**
 * Uma fatia pronta para desenhar: a {@link Fatia} com a chave aberta para
 * qualquer texto e a cor resolvida por quem chama. É o que torna o {@link Arco}
 * reutilizável fora deste painel (spec 022) sem que ele conheça `FATIA_COR`.
 *
 * A `key` vira sufixo de `data-testid` e chave de React, e por isso tem de ser
 * única dentro de um arco.
 */
export interface FatiaDesenho {
  key: string;
  label: string;
  abs: number;
  pct: number;
  /** Como pintar. Não se chama `cor` para não se confundir com o campo banido do payload. */
  pintura: CorFatia;
}

/** As fatias neutras deste painel, com a cor de {@link FATIA_COR}. */
export function comCorNeutra(fatias: readonly Fatia[]): FatiaDesenho[] {
  return fatias.map((f) => ({ ...f, pintura: FATIA_COR[f.key] }));
}

/** Estilo do marcador de legenda de uma fatia — repete a cor E o padrão do arco. */
function estiloMarcador(cor: CorFatia): CSSProperties {
  const borda = cor.contorno ?? cor.borda;
  return {
    flex: "none",
    width: 12,
    height: 12,
    marginTop: 3,
    background: cor.fill,
    // 🔴 O marcador repete o PADRÃO do arco (medido no navegador
    // em 2026-09-26). Sem isto, "brancos" e "nulos" saíam com o
    // mesmo quadrado — as fatias dividem o token, e era só o
    // padrão que as separava no desenho. A legenda é a tradução
    // textual do gráfico (RNF-023): um marcador que não
    // corresponde ao setor quebra justamente a ligação que ela
    // existe para fazer. Com "anulados" são TRÊS cinzas, e os
    // dois padrões têm de diferir entre si também.
    backgroundImage:
      cor.padrao === "listras"
        ? "repeating-linear-gradient(45deg, transparent 0 2px, var(--surface-page) 2px 3px)"
        : cor.padrao === "pontos"
          ? "radial-gradient(var(--surface-page) 1.1px, transparent 1.2px)"
          : cor.padrao === "trilho"
            ? "linear-gradient(to bottom, transparent 0 5px, var(--surface-page) 5px 7px, transparent 7px)"
            : undefined,
    backgroundSize: cor.padrao === "pontos" ? "4px 4px" : undefined,
    border: borda ? `1px solid ${borda}` : undefined,
  };
}

/** Título de um arco (`<figcaption>`). */
const ESTILO_TITULO_ARCO: CSSProperties = {
  font: "var(--type-kicker)",
  letterSpacing: "var(--tracking-caps)",
  textTransform: "uppercase",
  color: "var(--accent-text)",
};

/** Texto de um arco que não pode ser desenhado (espera, inconsistência). */
const ESTILO_ESPERA_ARCO: CSSProperties = {
  margin: 0,
  font: "var(--type-body-sm)",
  color: "var(--text-muted)",
  borderTop: "1px solid var(--border-hairline)",
  paddingTop: "var(--space-2)",
};

export interface ArcoProps {
  id: string;
  /**
   * Prefixo dos `id` de `<defs>`. Separado de `id` porque `id` também alimenta
   * os `data-testid`, que são estáveis por contrato, enquanto este precisa ser
   * único por INSTÂNCIA do painel: `id` de SVG é global ao documento, e dois
   * painéis na mesma página colidiriam. Sai de `titleId`, que já é a prop que
   * um segundo painel obrigatoriamente sobrescreve (dois `titleId` iguais
   * seriam dois `aria-labelledby` apontando para o mesmo heading).
   *
   * 🔴 Achado MEDINDO no navegador em 2026-09-26, com duas instâncias na mesma
   * página: os três `<pattern>` do segundo painel repetiam os ids do primeiro,
   * e o segundo passaria a pintar com a definição do primeiro — silenciosamente.
   */
  defsPrefix: string;
  /** Título da figura — vira o `<figcaption>`. */
  titulo: string;
  /** Nome da BASE do percentual. É o que satisfaz RF-196 para as fatias todas. */
  baseLabel: string;
  /** Total da base, em absoluto. Vai no centro do arco. */
  total: number;
  fatias: readonly FatiaDesenho[];
  /** Renderizado no lugar das fatias quando não há o que desenhar. */
  vazio?: { testid: string; texto: string };
  /**
   * Visão do seletor Parcial/Projeção em que este arco aparece (ADR-0029 § 2,
   * `data-view-only`). Ausente ⇒ aparece nas duas.
   *
   * O atributo vai num `<div>` EM VOLTA da `<figure>`, e não nela: a figura
   * declara `display: flex` inline, e estilo inline vence a regra
   * `[data-view-only] { display: none }` da folha — o arco nunca sumiria. O
   * invólucro não tem `display` próprio, então `display: revert` o devolve a
   * `block`. Os estados vazios moram dentro da figura e somem com ela.
   */
  visao?: ViewMode;
}

/**
 * Um arco semicircular com legenda — exportado desde a spec 022, que o reusa
 * no painel da corrida (`CorridaTresCirculos`). Não conhece o vocabulário de
 * fatias de nenhum dos dois painéis: recebe cada fatia com a cor resolvida.
 */
export function Arco({ visao, ...props }: ArcoProps) {
  if (!visao) return <ArcoFigura {...props} />;
  return (
    <div data-view-only={visao} data-testid={`${props.id}-visao`}>
      <ArcoFigura {...props} />
    </div>
  );
}

function ArcoFigura({
  id,
  defsPrefix,
  titulo,
  baseLabel,
  total,
  fatias,
  vazio,
}: Omit<ArcoProps, "visao">) {
  // Não existe mais "denominador da geometria" separado do total. Ele existia
  // para o arco 3 fechar o anel quando as projeções não somavam `aptos`; desde
  // a correção do RF-195 o arco 3 tem a quinta fatia por subtração e fecha em
  // `aptos` pela mesma construção do arco 1. Um segundo denominador hoje só
  // serviria para reintroduzir a divergência entre os dois arcos.
  const geomTotal = total;
  // 🔴 Fatia de valor ZERO sai do arco E da legenda (achado do próprio teste,
  // 2026-09-26). Duas razões, e as duas são de correção, não de estilo:
  //
  //   1. um setor de 0° ainda produzia um `<path>` no DOM — invisível na tela,
  //      mas presente para teste, inspetor e leitor de tela;
  //   2. pior, a legenda imprimia "Ainda não apurado — 0,0% · 0" no fim da
  //      noite, que é o zero fabricado que a spec proíbe justamente na fatia
  //      que o RF-193 manda DESAPARECER quando o residual zera.
  //
  // Some das duas superfícies ao mesmo tempo, de propósito: uma linha de
  // legenda dizendo 0,0% ao lado de um arco sem aquela faixa obrigaria o
  // leitor a decidir qual das duas está certa. `somaAbs` abaixo continua
  // somando as fatias TODAS — tirar um zero não muda soma, e é ela que prova
  // que o arco fecha em 100%.
  const visiveis = fatias.filter((f) => f.abs > 0);
  const arcos = angulosDasFatias(visiveis, geomTotal);
  const somaAbs = fatias.reduce((s, f) => s + f.abs, 0);

  return (
    <figure
      data-testid={id}
      data-total={String(total)}
      data-soma-abs={String(somaAbs)}
      style={{ margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
    >
      <figcaption style={ESTILO_TITULO_ARCO}>{titulo}</figcaption>

      {vazio ? (
        <p data-testid={vazio.testid} style={ESTILO_ESPERA_ARCO}>
          {vazio.texto}
        </p>
      ) : (
        <div style={{ position: "relative" }}>
          {/* Só caminhos aqui dentro — nenhum `<text>`. Ver o § "Nenhum texto
              dentro do SVG" no cabeçalho: o axe não reprova contraste de texto
              em SVG, então o texto vive em HTML por cima. */}
          <svg
            role="img"
            aria-label={`${titulo} — ${formatVotes(total)} ${baseLabel}`}
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            style={{ width: "100%", height: "auto", display: "block" }}
          >
            {/* Malha de furos do padrão "pontos". O `id` leva o `id` do arco
                E o `defsPrefix` do painel, porque `id` de SVG é global ao
                documento: sem o primeiro, os arcos 2 e 3 pintariam com a
                definição do arco 1; sem o segundo, um segundo painel na mesma
                página pintaria com a definição do primeiro. Os dois casos
                falham em SILÊNCIO — o desenho sai, só que errado. */}
            <defs>
              <pattern
                id={`${defsPrefix}-${id}-pontos`}
                width={6}
                height={6}
                patternUnits="userSpaceOnUse"
              >
                <circle cx={3} cy={3} r={1.5} fill="var(--surface-page)" />
              </pattern>
            </defs>
            {arcos.map(({ key, inicio, fim }, i) => {
              // `arcos` sai de `visiveis`, na mesma ordem e com o mesmo tamanho.
              const fatia = visiveis[i];
              if (!fatia) return null;
              const cor = fatia.pintura;
              const d = caminhoArco(inicio, fim);
              return (
                <g key={key}>
                  {cor.borda ? (
                    // Borda dos dois lados da fita: um traço 2px mais largo por
                    // BAIXO do preenchimento. Ver `CorFatia.borda`.
                    <path
                      data-testid={`${id}-borda-${key}`}
                      d={d}
                      fill="none"
                      stroke={cor.borda}
                      strokeWidth={ESPESSURA + 2}
                    />
                  ) : null}
                  <path
                    data-testid={`${id}-fatia-${key}`}
                    data-pct={fatia.pct.toFixed(4)}
                    data-abs={String(fatia.abs)}
                    d={d}
                    fill="none"
                    stroke={cor.fill}
                    strokeWidth={ESPESSURA}
                  />
                  {cor.contorno ? (
                    // O residual é pálido de propósito ("em cinza", RF-193) e é
                    // o contorno que lhe dá borda perceptível nos dois temas —
                    // o preenchimento sozinho mede 1,2:1.
                    <path
                      d={d}
                      fill="none"
                      stroke={cor.contorno}
                      strokeWidth={1}
                      style={{ opacity: 0.9 }}
                    />
                  ) : null}
                  {cor.padrao ? (
                    // Textura na cor da superfície por cima do preenchimento.
                    // "listras" (brancos) e "pontos" (anulados) são padrões
                    // DIFERENTES entre si de propósito: as três fatias
                    // cinzentas — brancos, nulos e anulados — precisam se
                    // distinguir duas a duas, e o kit não tem três tons
                    // neutros que passem contraste nos dois temas. A cor
                    // nunca é o único portador (WCAG 1.4.1): o rótulo é.
                    <path
                      data-testid={`${id}-padrao-${key}`}
                      data-padrao={cor.padrao}
                      d={d}
                      fill="none"
                      stroke={
                        cor.padrao === "pontos"
                          ? `url(#${defsPrefix}-${id}-pontos)`
                          : "var(--surface-page)"
                      }
                      strokeWidth={cor.padrao === "trilho" ? 3 : ESPESSURA}
                      strokeDasharray={cor.padrao === "listras" ? "2 5" : undefined}
                    />
                  ) : null}
                </g>
              );
            })}
          </svg>

          {/* Número grande + base, em HTML, centrados na boca do arco.

              🔴 O `<span>` com fundo opaco (2026-09-26) é o que deixa o axe
              MEDIR este contraste. Sem ele, os 12 nós `*-circulo-N-total` /
              `-base` de uma home caíam em `incomplete` com
              `messageKey: "imgNode"`: o axe desce a pilha de fundo a partir do
              texto, não acha cor opaca antes de chegar no `<svg>` do arco
              logo abaixo, e desiste ("contém um nó de imagem") — reprovando o
              portão de a11y em 24 casos. O `pointerEvents: "none"` do wrapper
              NÃO era a causa: forçá-lo para `auto` no navegador deixou os
              mesmos 12 nós no mesmo balde.

              Por que isto não muda o visual, medido e não suposto: (1) o fundo
              efetivo por trás do arco é o `<body>`, pintado com
              `--surface-page` (`#f3f4f6` claro, `#14171b` escuro) — o `<Panel>`
              é transparente — e é a MESMA cor que a textura "pontos" já usa;
              (2) nenhum traço do arco passa sob a caixa dos glifos: amostrando
              a caixa pixel a pixel com `elementsFromPoint`, 0 pontos caem num
              `<path>` nas 7 rotas × 2 temas × 375/1280 px. ⚠️ Se este arco for
              posto sobre outra superfície (um cartão com fundo próprio), o
              fundo daqui tem de acompanhar — senão vira um retângulo visível. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "6%",
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            <div
              data-testid={`${id}-total`}
              style={{
                font: "var(--type-figure)",
                fontVariantNumeric: "tabular-nums",
                color: "var(--text-primary)",
                lineHeight: 1.05,
              }}
            >
              <span style={FUNDO_DO_ROTULO}>{formatVotes(total)}</span>
            </div>
            <div
              data-testid={`${id}-base`}
              style={{
                font: "var(--type-body-sm)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
              }}
            >
              <span style={FUNDO_DO_ROTULO}>{baseLabel}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tradução textual do gráfico (RNF-023), VISÍVEL. Cada linha traz o
          absoluto e o percentual; a base é a da figura, declarada no
          `<figcaption>` e no rótulo central (RF-196). */}
      {visiveis.length > 0 ? (
        <ul
          data-testid={`${id}-legenda`}
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "var(--space-2) var(--space-3)",
          }}
        >
          {visiveis.map((f) => (
            <li
              key={f.key}
              data-testid={`${id}-legenda-${f.key}`}
              data-pct={f.pct.toFixed(4)}
              data-abs={String(f.abs)}
              data-base={baseLabel}
              style={{
                display: "flex",
                gap: "var(--space-2)",
                alignItems: "flex-start",
                borderTop: "1px solid var(--border-hairline)",
                paddingTop: "var(--space-1)",
              }}
            >
              <span aria-hidden="true" style={estiloMarcador(f.pintura)} />
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    font: "var(--type-body-sm)",
                    color: "var(--text-primary)",
                  }}
                >
                  {f.label}
                </span>
                <span
                  style={{
                    display: "block",
                    font: "var(--type-body-sm)",
                    fontSize: "var(--text-xs)",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--text-secondary)",
                  }}
                >
                  {formatPercent(f.pct, 1)} · {formatVotes(f.abs)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// O painel
// ---------------------------------------------------------------------------

export interface VotacaoEleitoradoProps {
  /**
   * Bloco `votacao` do payload. Ausente ou `null` ⇒ `<DetailUnavailable>`
   * (RF-198), nunca zeros. Não confundir com `contagens` zeradas, que é o
   * estado "não começou" do RF-193b.
   */
  votacao?: EdgeVotacao | null;
  /** Kicker do `<Panel>` — ex. "Presidente · Brasil". */
  kicker?: string;
  heading?: string;
  headingLevel?: 1 | 2 | 3 | 4;
  /** `id` do heading; amarra o `aria-labelledby` da `<section>` do Panel. */
  titleId?: string;
  className?: string;
  /**
   * Quantos votos cada eleitor dá nesta corrida (spec 022 RF-210, spec 021
   * RF-195c). 1 em Presidente, Governador e Deputado; no Senado é o número de
   * vagas em disputa na UF (2 em 2026), e quem o passa é a página, a partir de
   * `EdgePayloadUf.vagas` — sem supor. Com `k > 1` os três arcos contam
   * VOTOS: as quantidades de pessoas × k, a base nomeada "votos (k por
   * eleitor)". Valor que não seja inteiro ≥ 1 ⇒ `<DetailUnavailable>`.
   */
  votosPorEleitor?: number;
}

const TITLE_ID_PADRAO = "votacao-eleitorado-heading";

/**
 * Fundo opaco do número central e da base do `Arco`, na cor da superfície por
 * trás do arco. Existe para o axe conseguir medir o contraste desses textos
 * (ver o comentário no JSX do `Arco`). `display: inline` de propósito: o fundo
 * cobre só a caixa do texto, não a largura inteira da boca do arco.
 */
const FUNDO_DO_ROTULO: CSSProperties = { background: "var(--surface-page)" };

/** Parágrafo da metodologia — a margem é dele, não do invólucro (ver o JSX). */
const ESTILO_PARAGRAFO_METODOLOGIA: CSSProperties = { margin: "var(--space-4) 0 0" };

export function VotacaoEleitorado({
  votacao,
  kicker,
  heading = "Votação",
  headingLevel = 2,
  titleId = TITLE_ID_PADRAO,
  className,
  votosPorEleitor = 1,
}: VotacaoEleitoradoProps) {
  // RF-198 — o painel degrada, nunca some. `votacao` ausente é "não sabemos";
  // é DIFERENTE de `contagens` zeradas, que é "não começou" (RF-193b).
  // `votosPorEleitor` inválido também é "não sabemos": sem a unidade, qualquer
  // arco desenhado estaria na unidade errada.
  if (!votacao?.contagens || !votosPorEleitorValido(votosPorEleitor)) {
    return (
      <Panel
        kicker={kicker}
        title={heading}
        titleId={titleId}
        headingLevel={headingLevel}
        className={className}
      >
        <DetailUnavailable label="A votação do eleitorado" reason="not_found" />
      </Panel>
    );
  }

  const c = votacao.contagens;
  const projetada = votacao.projetada;

  // `null` significa que as fatias NÃO fecham na base do arco. Não é um estado
  // de espera: é um payload que não soma, e cada arco o diz na própria caixa em
  // vez de desenhar torto. `[]` no arco 2 é outra coisa — é a apuração não ter
  // começado (RF-193b), e tem texto próprio.
  const k = votosPorEleitor;
  const c1 = fatiasCirculo1(c, k);
  const c2 = fatiasCirculo2(c, k);
  const c3 = projetada ? fatiasCirculo3(c, projetada, k) : null;

  // Bases nomeadas na unidade dos arcos (RF-196 + RF-210): com `k > 1` o
  // número grande é de VOTOS, e chamá-lo de "eleitores" seria o dobro de
  // gente que não existe.
  const emVotos = k > 1;
  const base1 = emVotos ? `${unidadeVotos(k)} do eleitorado apto` : "eleitores aptos";
  const base2 = emVotos ? `${unidadeVotos(k)} do eleitorado já apurado` : "eleitorado já apurado";
  const base3 = emVotos
    ? `${unidadeVotos(k)} do eleitorado apto (projetado)`
    : "eleitores aptos (projetado)";
  // "sobre os N eleitores aptos" — ou, no Senado, "sobre os 2N votos dos N
  // eleitores aptos": as duas quantidades, cada uma com o seu nome.
  const sobreAptos = emVotos
    ? `${formatVotes(c.aptos * k)} votos dos ${formatVotes(c.aptos)} eleitores aptos`
    : `${formatVotes(c.aptos)} eleitores aptos`;

  const anuladosESubJudice = anuladosTotal(c);
  const naoInstalados = Math.max(0, naoApuradoInstalacao(c));
  // O residual do arco 3 — o anulado PROJETADO, não o contado até agora.
  const anuladosProjetados = c3?.find((f) => f.key === "anulados")?.abs ?? 0;

  return (
    <Panel
      kicker={kicker}
      title={heading}
      titleId={titleId}
      headingLevel={headingLevel}
      className={className}
    >
      <div
        data-testid="votacao-eleitorado"
        data-instalados={String(c.instalados)}
        data-votos-por-eleitor={String(k)}
        style={GRADE_DOS_ARCOS}
      >
        {/* RF-195b — o seletor do shell escolhe os arcos: 1 e 2 são o que JÁ
            foi contado ("Parcial"); o 3 é o fim projetado ("Projeção"). Os
            três seguem no HTML (ADR-0017); a cascata esconde o outro lado. */}

        {/* Arco 1 — RF-193 / RF-193b. As SEIS fatias sobre os aptos. */}
        <Arco
          visao="parcial"
          id="votacao-circulo-1"
          defsPrefix={titleId}
          titulo="Do eleitorado apto"
          baseLabel={base1}
          total={c.aptos * k}
          fatias={comCorNeutra(c1 ?? [])}
          vazio={
            c1
              ? undefined
              : {
                  testid: "votacao-circulo-1-inconsistente",
                  texto:
                    "As contagens publicadas não somam o eleitorado apto — não é possível montar este gráfico sem inventar um número.",
                }
          }
        />

        {/* Arco 2 — RF-194. As CINCO fatias do eleitorado instalado, base
            própria e nomeada, sem "ainda não apurado". Denominador zero
            (RF-193b) NÃO vira "0,0%": vira texto. */}
        <Arco
          visao="parcial"
          id="votacao-circulo-2"
          defsPrefix={titleId}
          titulo="Do eleitorado já apurado"
          baseLabel={base2}
          total={c.instalados * k}
          fatias={comCorNeutra(c2 ?? [])}
          vazio={
            c2 === null
              ? {
                  testid: "votacao-circulo-2-inconsistente",
                  texto:
                    "As contagens publicadas não somam o eleitorado das seções instaladas — não é possível montar este gráfico sem inventar um número.",
                }
              : c2.length === 0
                ? {
                    testid: "votacao-circulo-2-sem-base",
                    texto:
                      "A apuração ainda não começou — não há eleitorado apurado para servir de base a este gráfico.",
                  }
                : undefined
          }
        />

        {/* Arco 3 — RF-195. CINCO fatias: as quatro projetadas mais o
            residual, que aqui se chama "Anulados e sub judice" e NÃO "Ainda
            não apurado" — num gráfico do fim da apuração não existe seção por
            apurar. Sem base amostral, "aguardando projeção", sempre no DOM
            (ADR-0017 / ADR-0018). Projeção que não fecha é um terceiro caso,
            com texto próprio: confundi-lo com "aguardando" mandaria o operador
            esperar por um dado que já chegou, e errado. */}
        <Arco
          visao="proj"
          id="votacao-circulo-3"
          defsPrefix={titleId}
          titulo="Projeção para o fim da apuração"
          baseLabel={base3}
          total={c.aptos * k}
          fatias={comCorNeutra(c3 ?? [])}
          vazio={
            c3
              ? undefined
              : projetada
                ? {
                    testid: "votacao-circulo-3-inconsistente",
                    texto:
                      "A projeção publicada soma mais que o eleitorado apto — não é possível montar este gráfico sem inventar um número.",
                  }
                : {
                    testid: "votacao-circulo-3-aguardando",
                    texto:
                      "Aguardando projeção — ainda não há zona apurada suficiente para projetar o fim da apuração.",
                  }
          }
        />
      </div>

      {/* Metodologia (constituição § 8). RF-197 exige que a soma de anulados
          e sub judice seja DECLARADA: são 14,2% do comparecimento na captura
          real do simulado. Desde 2026-09-26 eles têm fatia própria, mas a
          declaração continua — e ganhou um segundo dever, explicar que anulado
          NÃO é nulo, porque são ramos diferentes da árvore do TSE e a tela põe
          os dois lado a lado em cinza.

          🔴 RF-195b (2026-09-27): o texto acompanha o seletor. Um parágrafo
          por visão, cada um falando SÓ dos arcos que a sua visão mostra —
          frase que cite um gráfico escondido ("o terceiro gráfico…" na visão
          Parcial) é defeito, e a mesma verdade não se repete dentro de uma
          visão. A distinção anulado ≠ nulo aparece nas duas porque as duas têm
          a fatia "Anulados e sub judice"; cada visão a diz uma vez. A margem
          fica em cada parágrafo, não no invólucro: sem projeção não há
          parágrafo da Projeção, e o invólucro não deixa um vão vazio. */}
      <div
        data-testid="votacao-metodologia"
        style={{
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
        }}
      >
        {/* RF-210 — a frase do Senado vale nas DUAS visões (os três arcos
            contam votos), e por isso não leva `data-view-only`. */}
        {emVotos ? (
          <p data-testid="votacao-metodologia-votos" style={ESTILO_PARAGRAFO_METODOLOGIA}>
            {fraseVotosPorEleitor(k)}
          </p>
        ) : null}
        <p
          data-view-only="parcial"
          data-testid="votacao-metodologia-parcial"
          style={ESTILO_PARAGRAFO_METODOLOGIA}
        >
          Os dois gráficos têm bases diferentes e não devem ser comparados fatia a fatia: o primeiro
          é sobre os {sobreAptos}; o segundo, só sobre o eleitorado das seções já instaladas.
          {anuladosESubJudice > 0 ? (
            <>
              {" "}
              <strong style={{ fontWeight: 600 }}>
                {formatVotes(anuladosESubJudice)} votos anulados e sub judice
              </strong>{" "}
              têm fatia própria e não se confundem com voto nulo: no voto nulo o eleitor não
              escolheu ninguém, enquanto o anulado foi dado a uma candidatura e anulado depois pela
              Justiça — sub judice é a parte ainda sob decisão.
            </>
          ) : null}
          {naoInstalados > 0 ? (
            <>
              {" "}
              {emVotos ? (
                <>
                  “Ainda não apurado” são os {formatVotes(naoInstalados * k)} votos de{" "}
                  {formatVotes(naoInstalados)} eleitores de seções ainda não instaladas ou não
                  totalizadas — e só isso.
                </>
              ) : (
                <>
                  “Ainda não apurado” são {formatVotes(naoInstalados)} eleitores de seções ainda não
                  instaladas ou não totalizadas — e só isso.
                </>
              )}
            </>
          ) : null}
        </p>
        {c3 ? (
          <p
            data-view-only="proj"
            data-testid="votacao-metodologia-proj"
            style={ESTILO_PARAGRAFO_METODOLOGIA}
          >
            A projeção é sobre os {sobreAptos}, e as quatro projeções são publicadas como saem do
            modelo, sem reescala. Neste gráfico não existe fatia “ainda não apurado”, porque ele
            mostra o fim da apuração, quando não há mais seção por apurar.
            {anuladosProjetados > 0 ? (
              <>
                {" "}
                O que sobra ali são os votos anulados e sub judice, que{" "}
                <strong style={{ fontWeight: 600 }}>não chegam a zero no fim da apuração</strong> —
                continuam existindo depois de a última urna ser contada — e não se confundem com
                voto nulo: no voto nulo o eleitor não escolheu ninguém, enquanto o anulado foi dado
                a uma candidatura e anulado depois pela Justiça; sub judice é a parte ainda sob
                decisão.
              </>
            ) : null}{" "}
            O intervalo de confiança de cada métrica é publicado à parte, sobre a base de cada uma.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
