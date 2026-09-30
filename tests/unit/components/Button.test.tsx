// @vitest-environment happy-dom
/**
 * tests/unit/components/Button.test.tsx
 *
 * `<Button />` — botão editorial do design system Atlas Menna (ADR-0025).
 *
 * O que estes testes travam:
 *   - `size="md"` (default) tem `var(--tap-min)` = 44px, o alvo de toque
 *     mínimo do projeto (constituição § 4);
 *   - `variant="accent"` usa `--accent-ink` sobre `--accent` (4.63:1 medido) e
 *     NÃO o `#1B1206` cravado do kit — hex literal em componente é violação
 *     da constituição § 2;
 *   - o arquivo é Server Component: hover é CSS (`hover:`), não `useState`,
 *     porque RNF-007a não tem folga acima da dobra;
 *   - `type="button"` por default (um botão dentro de form não pode submeter
 *     por acidente).
 */

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/atoms/controls/Button";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function btn(doc: Document): HTMLButtonElement | null {
  return doc.querySelector("[data-testid='button']");
}

/** Código do componente sem comentários — o cabeçalho fala de "use client",
 *  `useState` etc. justamente para explicar por que eles não estão lá. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("<Button />", () => {
  it("(a) default: primary, md, type=button", () => {
    const el = btn(parse(<Button>Ver município</Button>));
    expect(el?.tagName).toBe("BUTTON");
    expect(el?.getAttribute("type")).toBe("button");
    expect(el?.getAttribute("data-variant")).toBe("primary");
    expect(el?.getAttribute("data-size")).toBe("md");
    expect(el?.textContent).toBe("Ver município");
  });

  it("(b) md tem 44px (var(--tap-min)); sm tem 32px", () => {
    expect(btn(parse(<Button>x</Button>))?.getAttribute("style")).toContain(
      "height:var(--tap-min)",
    );
    expect(btn(parse(<Button size="sm">x</Button>))?.getAttribute("style")).toContain(
      "height:32px",
    );
  });

  it("(c) primary é tinta sobre papel invertido; secondary e ghost são transparentes", () => {
    const primary = btn(parse(<Button variant="primary">x</Button>))?.getAttribute("style") ?? "";
    expect(primary).toContain("var(--surface-inverse)");
    expect(primary).toContain("var(--text-inverse)");

    const secondary =
      btn(parse(<Button variant="secondary">x</Button>))?.getAttribute("style") ?? "";
    expect(secondary).toContain("var(--border-strong)");
    expect(secondary).toContain("background:transparent");

    const ghost = btn(parse(<Button variant="ghost">x</Button>))?.getAttribute("style") ?? "";
    expect(ghost).toContain("var(--text-secondary)");
    expect(ghost).toContain("border-color:transparent");
  });

  it("(d) accent usa --accent-ink sobre --accent, sem hex literal", () => {
    const html = renderToStaticMarkup(<Button variant="accent">Projeção</Button>);
    expect(html).toContain("var(--accent-ink)");
    expect(html).toContain("var(--accent)");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("(e) disabled marca o atributo e as classes de estado", () => {
    const el = btn(parse(<Button disabled>x</Button>));
    expect(el?.hasAttribute("disabled")).toBe(true);
    expect(el?.getAttribute("class")).toContain("disabled:opacity-45");
    expect(el?.getAttribute("class")).toContain("disabled:cursor-not-allowed");
  });

  it("(f) full estica para 100%", () => {
    expect(btn(parse(<Button full>x</Button>))?.getAttribute("style")).toContain("width:100%");
    expect(btn(parse(<Button>x</Button>))?.getAttribute("style")).not.toContain("width:100%");
  });

  it("(g) o ícone é decorativo — aria-hidden", () => {
    const doc = parse(<Button icon={<span>@</span>}>Buscar</Button>);
    expect(doc.querySelector("[data-testid='button'] [aria-hidden='true']")?.textContent).toBe("@");
  });

  it("(h) aria-label passa adiante (botão só de ícone)", () => {
    expect(
      btn(parse(<Button aria-label="Fechar" icon={<span>×</span>} />))?.getAttribute("aria-label"),
    ).toBe("Fechar");
  });

  it("(h2) o par aria-expanded/aria-controls passa adiante (colapso do <ResultPanel>)", () => {
    // A interface deste átomo é fechada — sem passthrough de props arbitrárias.
    // O par entrou junto com `CandidateListCollapse`, e sem ele o botão de
    // "Todos os N candidatos" seria um controle mudo para leitor de tela.
    const b = btn(
      parse(
        <Button aria-controls="lista-cands" aria-expanded={false} size="sm" variant="ghost">
          Todos os 11 candidatos
        </Button>,
      ),
    );
    expect(b?.getAttribute("aria-expanded")).toBe("false");
    expect(b?.getAttribute("aria-controls")).toBe("lista-cands");
  });

  it("(f2) wrap: rótulo quebra, altura vira MÍNIMA (44px) e nunca passa do contêiner", () => {
    const b = btn(parse(<Button wrap>Mostrar todos os 71 candidatos de PT/PC do B/PV</Button>));
    expect(b?.className).toContain("whitespace-normal");
    expect(b?.className).not.toContain("whitespace-nowrap");
    expect(b?.style.minHeight).toBe("var(--tap-min)");
    expect(b?.style.height).toBe("");
    expect(b?.style.maxWidth).toBe("100%");
    // Sem `wrap`, nada muda para os demais botões do produto.
    const n = btn(parse(<Button>Ver</Button>));
    expect(n?.className).toContain("whitespace-nowrap");
    expect(n?.style.height).toBe("var(--tap-min)");
    expect(n?.style.minHeight).toBe("");
  });

  it("(i) o arquivo NÃO é Client Component — hover é CSS, não useState", () => {
    const src = codeOf("components/atoms/controls/Button.tsx");
    expect(src).not.toContain('"use client"');
    expect(src).not.toContain("useState");
    expect(src).toContain("hover:");
  });
});
