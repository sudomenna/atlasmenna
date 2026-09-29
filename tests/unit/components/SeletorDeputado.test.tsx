// @vitest-environment happy-dom
/**
 * tests/unit/components/SeletorDeputado.test.tsx — spec 027 (RF-283).
 *
 * O seletor "Federal · Estadual" (no DF, "Federal · Distrital"): destinos,
 * item atual e acessibilidade.
 *
 * Mutação aplicada à mão (29/09): `ehAtual` devolvendo sempre `false` derruba
 * "exatamente um aria-current"; trocar o `outro` do DF para 7 derruba o caso
 * do DF.
 */

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SeletorDeputado } from "@/components/layout/SeletorDeputado";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function itens(doc: Document) {
  return [...doc.querySelectorAll<HTMLAnchorElement>("[data-testid='seletor-deputado-item']")].map(
    (a) => ({
      texto: (a.textContent ?? "").trim(),
      href: a.getAttribute("href"),
      atual: a.getAttribute("aria-current"),
    }),
  );
}

describe("SeletorDeputado — destinos (RF-283)", () => {
  it("capa federal: Federal (atual) ↔ Estadual, sem UF", () => {
    expect(itens(parse(<SeletorDeputado atual={6} />))).toEqual([
      { texto: "Federal", href: "/deputado-federal", atual: "page" },
      { texto: "Estadual", href: "/deputado-estadual", atual: null },
    ]);
  });

  it("capa das assembleias: o Estadual é o atual (7, e também 8 — a capa é uma só)", () => {
    for (const cargo of [7, 8] as const) {
      expect(itens(parse(<SeletorDeputado atual={cargo} />)), String(cargo)).toEqual([
        { texto: "Federal", href: "/deputado-federal", atual: null },
        { texto: "Estadual", href: "/deputado-estadual", atual: "page" },
      ]);
    }
  });

  it("página de UF: a MESMA UF no outro cargo", () => {
    expect(itens(parse(<SeletorDeputado atual={6} uf="sp" />))).toEqual([
      { texto: "Federal", href: "/uf/SP/deputado-federal", atual: "page" },
      { texto: "Estadual", href: "/uf/SP/deputado-estadual", atual: null },
    ]);
    expect(itens(parse(<SeletorDeputado atual={7} uf="BA" />))).toEqual([
      { texto: "Federal", href: "/uf/BA/deputado-federal", atual: null },
      { texto: "Estadual", href: "/uf/BA/deputado-estadual", atual: "page" },
    ]);
  });

  it("🔴 DF: 'Federal · Distrital' — nunca 'Estadual', que levaria a uma casa inexistente", () => {
    const federal = parse(<SeletorDeputado atual={6} uf="DF" />);
    expect(itens(federal)).toEqual([
      { texto: "Federal", href: "/uf/DF/deputado-federal", atual: "page" },
      { texto: "Distrital", href: "/uf/DF/deputado-distrital", atual: null },
    ]);
    expect(federal.body.textContent).not.toMatch(/Estadual/);
    expect(
      federal.querySelector("[data-testid='seletor-deputado']")?.getAttribute("aria-label"),
    ).toBe("Deputado federal ou distrital");

    expect(itens(parse(<SeletorDeputado atual={8} uf="DF" />))).toEqual([
      { texto: "Federal", href: "/uf/DF/deputado-federal", atual: null },
      { texto: "Distrital", href: "/uf/DF/deputado-distrital", atual: "page" },
    ]);
  });

  it("combinação que não existe lança (estadual no DF, distrital fora dele)", () => {
    expect(() => renderToStaticMarkup(<SeletorDeputado atual={7} uf="DF" />)).toThrow();
    expect(() => renderToStaticMarkup(<SeletorDeputado atual={8} uf="SP" />)).toThrow();
  });
});

describe("SeletorDeputado — acessibilidade e forma", () => {
  it("é um <nav> nomeado, com exatamente um aria-current, em <a> reais", () => {
    for (const [atual, uf] of [
      [6, undefined],
      [7, undefined],
      [6, "SP"],
      [7, "SP"],
      [6, "DF"],
      [8, "DF"],
    ] as const) {
      const doc = parse(<SeletorDeputado atual={atual} uf={uf} />);
      const nav = doc.querySelector("[data-testid='seletor-deputado']");
      expect(nav?.tagName, `${atual}/${uf}`).toBe("NAV");
      expect(nav?.getAttribute("aria-label")).toMatch(/^Deputado federal ou (estadual|distrital)$/);
      expect(doc.querySelectorAll("[aria-current='page']").length, `${atual}/${uf}`).toBe(1);
      expect(doc.querySelectorAll("a").length).toBe(2);
    }
  });

  it("alvo de toque pelo token --tap-min e cores só por token (constituição § 2)", () => {
    const html = renderToStaticMarkup(<SeletorDeputado atual={6} uf="SP" />);
    const doc = parse(<SeletorDeputado atual={6} uf="SP" />);
    for (const a of doc.querySelectorAll("a")) {
      expect(a.getAttribute("style")).toContain("min-height:var(--tap-min)");
    }
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Nenhum percentual inline: a capa sem payload proíbe "%" no HTML.
    expect(html).not.toContain("%");
  });

  it("Server Component: sem 'use client' e sem hook", () => {
    const src = readFileSync("components/layout/SeletorDeputado.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toContain('"use client"');
    expect(src).not.toMatch(/\buse(State|Effect|Ref|Memo|Context|Pathname|Router)\s*\(/);
  });
});
