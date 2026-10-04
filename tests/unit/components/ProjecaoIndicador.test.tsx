// @vitest-environment happy-dom
/**
 * tests/unit/components/ProjecaoIndicador.test.tsx
 *
 * A linha pequena "↑ 38,0% proj" sob o percentual apurado da visão Parcial
 * (decisão do dono, 2026-10-03 — `components/atoms/data/ProjecaoIndicador.tsx`).
 *
 * O que fica travado:
 *   - a SETA segue a direção na precisão exibida (↑ acima, ↓ abaixo, nenhuma
 *     quando os dois textos são iguais — 37,96 × 38,04 saem "38,0%" os dois);
 *   - trocar ↑ por ↓ (ou inverter a comparação) reprova (a) e (b);
 *   - projeção ausente/não-finita ⇒ NADA (nunca um número inventado);
 *   - apurado ausente ⇒ a projeção sai, sem seta;
 *   - a seta e o desenhado são `aria-hidden`, a frase inteira vai em `sr-only`;
 *   - a cor sai da folha, `--color-pct-proj`, e nunca de `style` inline.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  direcaoProjecao,
  ProjecaoIndicador,
  VotosProjetados,
  votosProjetadosExibiveis,
} from "@/components/atoms/data/ProjecaoIndicador";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function ind(projetado: number | null | undefined, parcial: number | null | undefined) {
  const doc = parse(<ProjecaoIndicador parcial={parcial} projetado={projetado} />);
  const raiz = doc.querySelector('[data-testid="projecao-indicador"]');
  const desenhado = raiz?.querySelector('[aria-hidden="true"]')?.textContent ?? null;
  const fala = raiz?.querySelector(".sr-only")?.textContent ?? null;
  return { doc, raiz, desenhado, fala };
}

describe("<ProjecaoIndicador />", () => {
  it("(a) projeção ACIMA do apurado ⇒ '↑ 38,0% proj' e 'acima do apurado'", () => {
    const { raiz, desenhado, fala } = ind(38, 35);
    expect(desenhado).toBe("↑ 38,0% proj");
    expect(fala).toBe("projeção 38,0%, acima do apurado");
    expect(raiz?.getAttribute("data-direcao")).toBe("acima");
  });

  it("(b) projeção ABAIXO do apurado ⇒ '↓ 31,2% proj' e 'abaixo do apurado'", () => {
    const { raiz, desenhado, fala } = ind(31.2, 39.6);
    expect(desenhado).toBe("↓ 31,2% proj");
    expect(fala).toBe("projeção 31,2%, abaixo do apurado");
    expect(raiz?.getAttribute("data-direcao")).toBe("abaixo");
  });

  it("(c) iguais ⇒ sem seta, 'igual ao apurado'", () => {
    const { desenhado, fala } = ind(16.9, 16.9);
    expect(desenhado).toBe("16,9% proj");
    expect(desenhado).not.toMatch(/[↑↓]/);
    expect(fala).toBe("projeção 16,9%, igual ao apurado");
  });

  it("(d) 🔴 iguais NA PRECISÃO EXIBIDA: 38,04 × 37,96 saem os dois '38,0%' ⇒ sem seta", () => {
    // Comparar os números crus daria "↑" — uma seta afirmando um movimento
    // que a tela (uma casa) não mostra.
    const { desenhado, fala } = ind(38.04, 37.96);
    expect(desenhado).toBe("38,0% proj");
    expect(fala).toContain("igual ao apurado");
    expect(direcaoProjecao(38.04, 37.96)).toBe("igual");
    expect(direcaoProjecao(37.96, 38.04)).toBe("igual");
    // E a menor diferença VISÍVEL já ganha seta, nos dois sentidos.
    expect(direcaoProjecao(38.06, 37.96)).toBe("acima");
    expect(direcaoProjecao(37.94, 38.04)).toBe("abaixo");
  });

  it("(e) projeção ausente ou não-finita ⇒ NADA no HTML (nunca inventar)", () => {
    for (const p of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const html = renderToStaticMarkup(<ProjecaoIndicador parcial={35} projetado={p} />);
      expect(html).toBe("");
    }
  });

  it("(f) apurado ausente ⇒ a projeção sai, sem seta e sem comparação na fala", () => {
    const { raiz, desenhado, fala } = ind(38, null);
    expect(desenhado).toBe("38,0% proj");
    expect(fala).toBe("projeção 38,0%");
    expect(raiz?.getAttribute("data-direcao")).toBe("sem-apurado");
    expect(direcaoProjecao(38, undefined)).toBeNull();
  });

  it("(g) a11y: o desenhado (seta incluída) é aria-hidden; a fala é sr-only", () => {
    const { raiz } = ind(38, 35);
    const visivel = raiz?.querySelector('[aria-hidden="true"]');
    expect(visivel?.textContent).toContain("↑");
    // A seta não existe fora do aria-hidden.
    const fora = [...(raiz?.childNodes ?? [])]
      .filter((n) => n !== visivel)
      .map((n) => n.textContent ?? "")
      .join("");
    expect(fora).not.toMatch(/[↑↓]/);
  });

  it("(h) 🔴 cor ÚNICA de projeção, pela folha: `--color-pct-proj`; nada inline", () => {
    const { raiz } = ind(38, 35);
    expect(raiz?.getAttribute("style")).toBeNull();
    expect(raiz?.querySelectorAll("[style]")).toHaveLength(0);
    const css = readFileSync(
      resolve(process.cwd(), "components/atoms/data/ProjecaoIndicador.module.css"),
      "utf-8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ");
    expect(css).toMatch(/\.indicador \{[^}]*color: var\(--color-pct-proj\)/);
    // Nunca verde/vermelho para "sobe/desce" (constituição § 2).
    expect(css).not.toMatch(/success|warning|status-|--party-|green|red/);
  });

  it("(i) `bloco` e `size` só trocam classe; o texto não muda", () => {
    const a = parse(<ProjecaoIndicador parcial={35} projetado={38} />);
    const b = parse(<ProjecaoIndicador bloco parcial={35} projetado={38} size="md" />);
    const ca = a.querySelector('[data-testid="projecao-indicador"]')?.getAttribute("class") ?? "";
    const cb = b.querySelector('[data-testid="projecao-indicador"]')?.getAttribute("class") ?? "";
    expect(cb.split(" ").length).toBe(ca.split(" ").length + 2);
    expect(a.body.textContent).toBe(b.body.textContent);
  });
});

/**
 * "≈ 172 mil votos projetados" — a linha de votos da visão Projeção (decisão do
 * dono, 2026-10-03). O átomo só FORMATA: o número vem do caller
 * (`votos_projetados` do payload), e a ausência é decidida por
 * `votosProjetadosExibiveis`.
 */
describe("<VotosProjetados /> e votosProjetadosExibiveis", () => {
  function vp(votos: number, extra: { dentroDaProjecao?: boolean } = {}) {
    const doc = parse(<VotosProjetados votos={votos} {...extra} />);
    return doc.querySelector('[data-testid="votos-projetados"]');
  }

  it("(a) compacto, com '≈' e 'votos projetados' — mil e mi", () => {
    expect(vp(172_418)?.textContent).toBe("≈ aproximadamente 172 mil votos projetados");
    expect(vp(1_512_345)?.textContent).toBe("≈ aproximadamente 1,5 mi votos projetados");
  });

  it("(b) a11y: '≈' é aria-hidden; quem ouve recebe 'aproximadamente 172 mil votos projetados'", () => {
    const raiz = vp(172_418);
    expect(raiz?.querySelector('[aria-hidden="true"]')?.textContent).toBe("≈ ");
    expect(raiz?.querySelector(".sr-only")?.textContent).toBe("aproximadamente ");
    // O que um leitor de tela lê: tudo menos o aria-hidden.
    const fala = [...(raiz?.childNodes ?? [])]
      .filter((n) => !(n instanceof Element && n.getAttribute("aria-hidden") === "true"))
      .map((n) => n.textContent ?? "")
      .join("");
    expect(fala).toBe("aproximadamente 172 mil votos projetados");
  });

  it('(c) só na visão Projeção: `data-view-only="proj"` na raiz — salvo `dentroDaProjecao`', () => {
    expect(vp(172_418)?.getAttribute("data-view-only")).toBe("proj");
    expect(vp(172_418, { dentroDaProjecao: true })?.hasAttribute("data-view-only")).toBe(false);
  });

  it("(d) 🔴 cor da projeção pela folha (`.votos` → `--color-pct-proj`), nada inline", () => {
    const raiz = vp(172_418);
    expect(raiz?.getAttribute("style")).toBeNull();
    expect(raiz?.querySelectorAll("[style]")).toHaveLength(0);
    const css = readFileSync(
      resolve(process.cwd(), "components/atoms/data/ProjecaoIndicador.module.css"),
      "utf-8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ");
    expect(css).toMatch(/\.votos \{[^}]*color: var\(--color-pct-proj\)/);
    // A raiz carrega `data-view-only`: `display` na folha brigaria com a cascata.
    expect(css).not.toMatch(/\.votos \{[^}]*display/);
  });

  it("(e) 🔴 ausente, zero, negativo ou não-finito ⇒ null (o produtor grava `or 0`)", () => {
    for (const v of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(votosProjetadosExibiveis(v)).toBeNull();
    }
    expect(votosProjetadosExibiveis(1)).toBe(1);
    expect(votosProjetadosExibiveis(172_418)).toBe(172_418);
  });
});
