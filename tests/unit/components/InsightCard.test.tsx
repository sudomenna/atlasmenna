// @vitest-environment happy-dom
/**
 * tests/unit/components/InsightCard.test.tsx — RF-044.
 * Compartilhado entre spec 003 (home) e spec 004 (UF).
 *
 * (e)–(h): `origem` (ADR-0072) — a caixa declara se as frases vieram da IA ou
 * da regra fixa. Sem `origem`, nada muda (outras telas usam o componente).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InsightCard } from "@/components/blocks/InsightCard";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

describe("<InsightCard />", () => {
  it("(a) renderiza 1-3 frases em <p> separados", () => {
    const doc = parse(
      <InsightCard
        frases={["Lula amplia margem em MG.", "SP em disputa apertada.", "Bolsonaro mantém o Sul."]}
      />,
    );
    expect(doc.querySelectorAll("aside p").length).toBe(3);
    expect(doc.body.textContent).toContain("Lula amplia margem em MG.");
  });

  it("(b) frases vazias → null (não renderiza nada)", () => {
    const doc = parse(<InsightCard frases={[]} />);
    expect(doc.querySelector("aside")).toBeNull();
  });

  it("(c) heading customizável (default 'Análise')", () => {
    const docDefault = parse(<InsightCard frases={["x"]} />);
    expect(docDefault.querySelector("h3")?.textContent).toBe("Análise");
    const docCustom = parse(<InsightCard frases={["x"]} heading="Insight" />);
    expect(docCustom.querySelector("h3")?.textContent).toBe("Insight");
  });

  it("(d) aside tem aria-labelledby ligado ao h3", () => {
    const doc = parse(<InsightCard frases={["x"]} />);
    const aside = doc.querySelector("aside");
    const h3 = doc.querySelector("h3");
    expect(aside?.getAttribute("aria-labelledby")).toBe(h3?.id);
  });

  it("(e) sem `origem` nada muda: sem data-origem e sem nota", () => {
    const doc = parse(<InsightCard frases={["x", "y"]} />);
    expect(doc.querySelector("aside")?.hasAttribute("data-origem")).toBe(false);
    expect(doc.querySelector('[data-testid="insight-nota"]')).toBeNull();
    expect(doc.querySelectorAll("aside p").length).toBe(2);
  });

  it("(f) origem='ia' → data-origem e nota com aviso de IA, hora HH:MM de São Paulo e TSE", () => {
    const doc = parse(
      <InsightCard frases={["Frase da IA."]} origem="ia" atualizadoEm="2026-10-04T23:47:11Z" />,
    );
    expect(doc.querySelector("aside")?.getAttribute("data-origem")).toBe("ia");
    const nota = doc.querySelector('[data-testid="insight-nota"]')?.textContent ?? "";
    expect(nota).toBe(
      "Texto escrito por inteligência artificial a partir da projeção não oficial do AtlasMenna, publicado automaticamente, sem revisão humana; pode conter erros. Atualizado às 20:47. O resultado oficial é do TSE.",
    );
  });

  it("(g) origem='ia' sem hora legível → nota sem o 'Atualizado às'", () => {
    const doc = parse(<InsightCard frases={["x"]} origem="ia" atualizadoEm="ontem" />);
    const nota = doc.querySelector('[data-testid="insight-nota"]')?.textContent ?? "";
    expect(nota).toContain("inteligência artificial");
    expect(nota).not.toContain("Atualizado às");
    expect(nota).toContain("O resultado oficial é do TSE.");
  });

  it("(h) origem='regra' → nota de regra fixa, sem falar em IA", () => {
    const doc = parse(<InsightCard frases={["x"]} origem="regra" />);
    expect(doc.querySelector("aside")?.getAttribute("data-origem")).toBe("regra");
    const nota = doc.querySelector('[data-testid="insight-nota"]')?.textContent ?? "";
    expect(nota).toBe(
      "Frases montadas por regra fixa a partir da projeção não oficial do AtlasMenna. O resultado oficial é do TSE.",
    );
  });

  it("(i) frase repetida (a IA pode repetir) renderiza as duas vezes", () => {
    const doc = parse(<InsightCard frases={["Igual.", "Igual."]} origem="ia" />);
    const frases = [...doc.querySelectorAll("aside p:not([data-testid])")].map(
      (p) => p.textContent,
    );
    expect(frases).toEqual(["Igual.", "Igual."]);
  });
});
