/**
 * tests/unit/e2e/isencoes-axe.test.ts — a isenção do texto do mapa dos
 * palanques no portão de acessibilidade é EXATA (M1 da auditoria de 29/09):
 * casa com os seletores que o axe gerou para os 54 `<text>` do ladrilho, e com
 * nada mais — nem outro elemento do mapa, nem texto fora de `g[data-uf]`.
 */

import { describe, expect, it } from "vitest";

import { isencaoPorSimbolo, TEXTO_DO_LADRILHO_DOS_PALANQUES as R } from "@/tests/e2e/_isencoes-axe";

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
