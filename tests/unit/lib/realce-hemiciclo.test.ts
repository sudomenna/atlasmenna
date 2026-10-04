/**
 * tests/unit/lib/realce-hemiciclo.test.ts — o CSS do realce por grupo nos
 * plenários (spec 008, RF-294): escape do valor que vem do payload, uma regra
 * por chave única, vazio → "".
 */

import { describe, expect, it } from "vitest";

import { chavesDoCss, cssDoRealce, escaparValorCss } from "@/lib/utils/realce-hemiciclo";

describe("RF-294 — escaparValorCss", () => {
  it("escapa aspas e barra invertida para o valor ficar dentro das aspas do seletor", () => {
    expect(escaparValorCss('A"B')).toBe('A\\"B');
    expect(escaparValorCss("A\\B")).toBe("A\\\\B");
    // A barra é escapada ANTES da aspa: senão `\"` viraria `\\"` e fecharia.
    expect(escaparValorCss('\\"')).toBe('\\\\\\"');
  });

  it("🔴 `<` vira `\\3c ` — nenhum `</style>` vindo do payload fecha o elemento", () => {
    const v = escaparValorCss("</style><script>alert(1)</script>");
    expect(v).not.toContain("<");
    expect(v.startsWith("\\3c /style>")).toBe(true);
  });

  it("quebra de linha vira `\\a ` (string CSS não pode ter newline crua)", () => {
    expect(escaparValorCss("A\nB")).toBe("A\\a B");
  });

  it("sigla comum, acentuada ou com barra passa intacta", () => {
    for (const s of ["PT", "UNIÃO", "PT/PC do B/PV", "fed:101", "Sem partido"]) {
      expect(escaparValorCss(s)).toBe(s);
    }
  });
});

describe("RF-294 — cssDoRealce", () => {
  const base = { raiz: "camara", atributo: "data-cod" } as const;

  it("sem chave ⇒ string vazia (o invólucro nem emite <style>)", () => {
    expect(cssDoRealce({ ...base, chaves: [] })).toBe("");
  });

  it("uma regra por chave ÚNICA, na ordem de entrada, dentro de @media (hover:hover)", () => {
    const css = cssDoRealce({ ...base, chaves: ["13", "22", "13", "fed:101"] });
    expect(css.startsWith("@media (hover:hover){")).toBe(true);
    expect(css.endsWith("}}")).toBe(true);
    expect(chavesDoCss(css, "data-cod")).toEqual(["13", "22", "fed:101"]);
    expect(css.match(/\{opacity:1;/g)?.length).toBe(3);
  });

  it("a regra parte da raiz, procura o :hover na chave, e devolve a chave a opacity 1 com fundo", () => {
    const css = cssDoRealce({ ...base, chaves: ["13"] });
    expect(css).toBe(
      '@media (hover:hover){[data-realce-raiz="camara"]:has([data-cod="13"]:hover) ' +
        '[data-cod="13"]{opacity:1;--realce:var(--surface-sunken)}}',
    );
  });

  it("🔴 o valor escapado vale nas DUAS pontas da regra e na raiz", () => {
    const css = cssDoRealce({ raiz: 'r"<', atributo: "data-partido", chaves: ['X"</style>'] });
    expect(css).not.toContain("<");
    expect(css).toContain('[data-realce-raiz="r\\"\\3c "]');
    expect(css.split('[data-partido="X\\"\\3c /style>"]').length - 1).toBe(2);
    expect(chavesDoCss(css, "data-partido")).toEqual(['X"\\3c /style>']);
  });

  it("chavesDoCss não confunde atributos", () => {
    const css = cssDoRealce({ raiz: "s", atributo: "data-partido", chaves: ["PT"] });
    expect(chavesDoCss(css, "data-cod")).toEqual([]);
    expect(chavesDoCss(css, "data-partido")).toEqual(["PT"]);
  });
});
