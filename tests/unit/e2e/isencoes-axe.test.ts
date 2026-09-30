/**
 * tests/unit/e2e/isencoes-axe.test.ts — a isenção do texto do mapa dos
 * palanques no portão de acessibilidade é EXATA (M1 da auditoria de 29/09):
 * casa com os seletores que o axe gerou para os 54 `<text>` do ladrilho, e com
 * nada mais — nem outro elemento do mapa, nem texto fora de `g[data-uf]`.
 */

import { describe, expect, it } from "vitest";

import {
  CSS_LISTAS_DEPUTADO_VISIVEIS,
  isencaoPorSimbolo,
  isencaoAgremiacaoDeputadoPulada as isenta,
  TEXTO_DO_LADRILHO_DOS_PALANQUES as R,
  SELETOR_AGREMIACAO_DEPUTADO,
  SELETOR_LISTA_DEPUTADO,
} from "@/tests/e2e/_isencoes-axe";

describe("TEXTO_DO_LADRILHO_DOS_PALANQUES", () => {
  it("casa com os seletores medidos (sigla e código, com e sem atributos)", () => {
    for (const alvo of [
      'g[data-uf="TO"][fill="url(#palanques-proj-h-sem)"][data-palanque="sem_palanque_declarado"] > .PalanquesMapa-module__lTUHVG__sigla[y="102.0"][x="206.1"]',
      'g[data-uf="SE"][data-casamento="dividido"][fill="url(#palanques-proj-h-flavio)"] > .PalanquesMapa-module__lTUHVG__codigo[x="251.2"][y="193.0"]',
      'g[data-uf="SP"] > .PalanquesMapa-module__abc123__sigla',
    ]) {
      expect(R.test(alvo), alvo).toBe(true);
    }
  });

  it("🔴 NÃO casa com o resto do mapa, com texto solto, nem com outro componente", () => {
    for (const alvo of [
      'g[data-uf="SP"] > .PalanquesMapa-module__abc123__resumo',
      ".PalanquesMapa-module__abc123__sigla",
      'g[data-uf="SP"] > .PalanquesMapa-module__abc123__siglaX',
      'g[data-uf="SP"] > text',
      'g[data-uf="SP"] > .UfCartograma-module__abc123__sigla',
      'div > g[data-uf="SP"] > .PalanquesMapa-module__abc123__sigla',
      "p.PalanquesMapa-module__abc123__legendaTexto",
    ]) {
      expect(R.test(alvo), alvo).toBe(false);
    }
  });
});

describe("isencaoPorSimbolo — o '≠' da legenda, e só com o motivo `nonBmp`", () => {
  const ALVO =
    'div[data-testid="palanques-proj"] > figure > .PalanquesMapa-module__lTUHVG__legenda > .PalanquesMapa-module__lTUHVG__legendaLista:nth-child(2) > li:nth-child(2) > .PalanquesMapa-module__lTUHVG__codigoLegenda';

  it("casa com o nó medido em 29/09 quando o motivo é só `nonBmp`", () => {
    expect(isencaoPorSimbolo(ALVO, ["nonBmp"])).toBe(true);
  });

  it("🔴 outro motivo (fundo, oclusão), motivo nenhum, ou outra classe ⇒ NÃO isenta", () => {
    expect(isencaoPorSimbolo(ALVO, ["bgImage"])).toBe(false);
    expect(isencaoPorSimbolo(ALVO, ["nonBmp", "elmPartiallyObscured"])).toBe(false);
    expect(isencaoPorSimbolo(ALVO, [])).toBe(false);
    expect(isencaoPorSimbolo("p.PalanquesMapa-module__x__legendaTexto", ["nonBmp"])).toBe(false);
    expect(isencaoPorSimbolo(".Outro-module__x__codigoLegenda", ["nonBmp"])).toBe(false);
  });
});

describe("isencaoAgremiacaoDeputadoPulada — content-visibility nas listas de Deputado (30/09)", () => {
  it("isenta nó DENTRO de uma agremiação com os quatro motivos medidos, sozinhos ou juntos", () => {
    for (const m of [
      "bgOverlap",
      "elmPartiallyObscured",
      "elmPartiallyObscuring",
      "shortTextContent",
    ]) {
      expect(isenta(true, [m]), m).toBe(true);
    }
    expect(isenta(true, ["bgOverlap", "elmPartiallyObscuring"])).toBe(true);
  });

  it("🔴 fora da agremiação, motivo estranho (mesmo misturado) ou motivo nenhum ⇒ NÃO isenta", () => {
    expect(isenta(false, ["bgOverlap"])).toBe(false);
    expect(isenta(false, ["elmPartiallyObscuring"])).toBe(false);
    expect(isenta(true, ["bgImage"])).toBe(false);
    expect(isenta(true, ["nonBmp"])).toBe(false);
    expect(isenta(true, ["pseudoContent"])).toBe(false);
    expect(isenta(true, ["bgOverlap", "bgGradient"])).toBe(false);
    expect(isenta(true, [])).toBe(false);
  });

  it("os seletores são os `data-testid` do componente e da página — não classe com hash", () => {
    expect(SELETOR_LISTA_DEPUTADO).toBe('[data-testid="dep-lista-agremiacao"]');
    expect(SELETOR_AGREMIACAO_DEPUTADO).toBe(
      '[data-testid="uf-agremiacao"], [data-testid="dep-regras"]',
    );
    // A prova desliga o content-visibility exatamente no elemento que o tem.
    expect(CSS_LISTAS_DEPUTADO_VISIVEIS).toBe(
      '[data-testid="dep-lista-agremiacao"]{content-visibility:visible !important}',
    );
  });
});
