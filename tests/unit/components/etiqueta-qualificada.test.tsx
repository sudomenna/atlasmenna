// @vitest-environment happy-dom
/**
 * tests/unit/components/etiqueta-qualificada.test.tsx — a etiqueta com
 * critério publicado (spec 025, RF-246/250). O catálogo de hoje ainda não tem
 * critério para impeachment nem centrão; este arquivo liga `categoriaExibivel`
 * por mock para medir o FORMATO que essas etiquetas terão no dia em que o
 * critério entrar — sem inventar critério no código.
 *
 * 🔴 Nunca um "A favor" solto: o impeachment de ministros do STF sai com a
 * frase inteira, VISÍVEL.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/etiquetas/catalogo", async (orig) => {
  const m = await orig<typeof import("@/lib/etiquetas/catalogo")>();
  return { ...m, categoriaExibivel: () => true };
});

import { EtiquetaEditorial } from "@/components/atoms/data/EtiquetaEditorial";

function texto(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}

function textoVisivel(html: string): string {
  const d = new DOMParser().parseFromString(html, "text/html");
  for (const s of d.querySelectorAll(".sr-only")) s.remove();
  return d.body.textContent ?? "";
}

describe("RF-246 — impeachment de ministros do STF, sempre qualificado", () => {
  for (const [valor, fim] of [
    ["a_favor", "a favor"],
    ["contra", "contra"],
    ["sem_posicao_publica", "sem posição pública"],
  ] as const) {
    it(`🔴 ${valor}: a frase inteira é VISÍVEL — nunca o valor solto`, () => {
      const html = renderToStaticMarkup(
        <EtiquetaEditorial categoria="impeachment_stf" valor={valor} />,
      );
      expect(textoVisivel(html)).toBe(
        `Posição pública sobre impeachment de ministros do STF: ${fim}`,
      );
      expect(textoVisivel(html)).not.toMatch(/^(A favor|Contra)$/);
    });
  }

  it("dentro de um <a>, continua texto puro", () => {
    const html = renderToStaticMarkup(
      <a href="/uf/SP/senador">
        Fulano <EtiquetaEditorial categoria="impeachment_stf" valor="contra" />
      </a>,
    );
    const d = new DOMParser().parseFromString(html, "text/html");
    expect(d.querySelectorAll("a a, a button, a [tabindex], a [role]")).toHaveLength(0);
  });
});

describe("RF-235 — centrão com critério", () => {
  it("rótulo diz tudo; `nao` nunca vira etiqueta", () => {
    expect(texto(renderToStaticMarkup(<EtiquetaEditorial categoria="centrao" valor="sim" />))).toBe(
      ", Centrão",
    );
    expect(renderToStaticMarkup(<EtiquetaEditorial categoria="centrao" valor="nao" />)).toBe("");
  });
});
