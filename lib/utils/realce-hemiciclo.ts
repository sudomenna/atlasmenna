/**
 * lib/utils/realce-hemiciclo.ts — o CSS do realce por grupo nos plenários
 * (spec 008, RF-294). Puro: recebe as chaves, devolve o texto do `<style>`.
 *
 * ## O efeito
 *
 * Ponteiro sobre uma cadeira (ou sobre a linha da legenda) de um grupo — um
 * partido, uma agremiação, um bloco —: as cadeiras dos OUTROS grupos vão a
 * `opacity: .2`, as linhas dos outros a `.45`, e a linha do grupo ganha fundo
 * leve. Vale nos dois sentidos porque o `:hover` é procurado em qualquer
 * descendente com o atributo, `<g>` ou `<li>`.
 *
 * ## Zero JavaScript (ADR-0049, ADR-0061; spec 017, spec 023)
 *
 * Os plenários são Server Components sem script, e continuam. O realce é CSS
 * com `:has()`, em duas metades:
 *
 *   1. **Estática, no módulo** (`RealceHemiciclo.module.css`): enquanto
 *      QUALQUER elemento com chave estiver sob o ponteiro, esmaece TODAS as
 *      cadeiras e linhas. Especificidade 0,1,0 (tudo em `:where()`).
 *   2. **Por chave, aqui**: enquanto o elemento com a chave K estiver sob o
 *      ponteiro, os elementos com a chave K voltam a `opacity: 1` e acendem
 *      `--realce`, que a metade estática usa como fundo da linha.
 *      Especificidade 0,4,0 — vence a metade estática.
 *
 * Uma regra por chave, e não a tríade "esmaece os que não são K" de cada
 * chave: o painel do Senado tem teto de 18 KiB de markup
 * (`senado-hemiciclo-peso.test.tsx`) e estava a ~2,8 KiB dele. Medido em
 * 03/10 no pior caso daquele teste (13 grupos): uma regra por chave = 1.663 B
 * de `<style>`, painel em 17.362 B; a tríade seria ~3× isso e estouraria o
 * teto. E o Next escreve o texto DUAS vezes no documento (HTML + payload RSC).
 *
 * 🔴 A consequência: chave SEM regra apaga tudo, inclusive o próprio grupo,
 * ao ser apontada. Por isso o teste de `RealceHemiciclo` exige que o conjunto
 * de chaves do CSS seja o mesmo dos `<g>` e dos `<li>`.
 *
 * ## Só onde há ponteiro de verdade
 *
 * Tudo dentro de `@media (hover: hover)`: no celular um toque deixaria o
 * `:hover` "grudado" e o plenário apagado. `prefers-reduced-motion` já está
 * coberto pelo reset global de transições (`app/globals.css`).
 *
 * ## Escape — o valor vem do payload
 *
 * Sigla e código de agremiação chegam do Edge Config. Dentro de `<style>` o
 * HTML não escapa nada, e um `</style>` na sigla fecharia o elemento e
 * injetaria marcação. `escaparValorCss` escapa `\`, `"`, quebras de linha e
 * `<` (como `\3c `), o que basta para o valor ficar dentro das aspas do
 * seletor de atributo e para o texto nunca conter `</`.
 */

/** O atributo que identifica o grupo de cada cadeira e de cada linha. */
export type AtributoRealce = "data-cod" | "data-partido" | "data-bloco";

/** Os três, para a metade estática (módulo CSS) e para os testes. */
export const ATRIBUTOS_REALCE: readonly AtributoRealce[] = [
  "data-cod",
  "data-partido",
  "data-bloco",
];

/** Atributo do invólucro — o `:has()` de cada regra parte dele. */
export const ATRIBUTO_RAIZ_REALCE = "data-realce-raiz";

/**
 * Escapa um valor para dentro de `"…"` num seletor de atributo CSS, e para
 * dentro de um `<style>` de HTML.
 */
export function escaparValorCss(valor: string): string {
  return valor
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n|\f/g, "\\a ")
    .replace(/</g, "\\3c ");
}

export interface CssDoRealce {
  /** Valor de `data-realce-raiz` do invólucro — único na página. */
  raiz: string;
  atributo: AtributoRealce;
  /** Os grupos que existem no desenho/legenda. Repetidos são descartados. */
  chaves: readonly string[];
}

/**
 * O texto do `<style>` do realce. `""` quando não há chave — o invólucro
 * então nem emite o `<style>`.
 */
export function cssDoRealce({ raiz, atributo, chaves }: CssDoRealce): string {
  const unicas = [...new Set(chaves)];
  if (unicas.length === 0) return "";
  const r = `[${ATRIBUTO_RAIZ_REALCE}="${escaparValorCss(raiz)}"]`;
  const regras = unicas.map((k) => {
    const sel = `[${atributo}="${escaparValorCss(k)}"]`;
    return `${r}:has(${sel}:hover) ${sel}{opacity:1;--realce:var(--surface-sunken)}`;
  });
  return `@media (hover:hover){${regras.join("")}}`;
}

/**
 * As chaves que um texto de CSS gerado por {@link cssDoRealce} cobre — o
 * inverso, para os testes compararem com os atributos do markup. Só desfaz o
 * escape de `\"` e `\\`, que é o que aparece em sigla real.
 */
export function chavesDoCss(css: string, atributo: AtributoRealce): string[] {
  const re = new RegExp(`:has\\(\\[${atributo}="((?:[^"\\\\]|\\\\.)*)"\\]:hover\\)`, "g");
  return [...css.matchAll(re)].map((m) => (m[1] ?? "").replace(/\\(["\\])/g, "$1"));
}
