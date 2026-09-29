// @vitest-environment happy-dom
/**
 * tests/unit/pages/sobre-as-etiquetas.test.tsx — a metodologia das etiquetas
 * (spec 025, RF-252; constituição 1.6 § 8), renderizada da CÓPIA DO BUILD
 * versionada (sem Blob configurado no teste):
 *
 *   - um `<h1>`, as nove seções, cada uma com `<h2>` e rótulo;
 *   - o critério de cada categoria sai do catálogo; categoria sem critério diz
 *     "Critério em definição — nenhuma etiqueta desta categoria é exibida";
 *   - portão, corte do alinhamento, data da foto do Senado, registro, canal
 *     de correção — sem inventar e-mail;
 *   - `/sobre-o-modelo` aponta para cá sem ganhar `<h2>`.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));

import SobreAsEtiquetasPage from "@/app/sobre-as-etiquetas/page";
import SobreOModeloPage from "@/app/sobre-o-modelo/page";
import { CATEGORIAS, CRITERIOS, PORTAO_MARGEM_PP } from "@/lib/etiquetas/catalogo";

async function render(): Promise<{ html: string; doc: Document }> {
  const html = renderToStaticMarkup(await SobreAsEtiquetasPage());
  return { html, doc: new DOMParser().parseFromString(html, "text/html") };
}

describe("RF-252 — /sobre-as-etiquetas", () => {
  it("um <h1> e nove seções com <h2>", async () => {
    const { doc } = await render();
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector("h1")?.textContent).toBe("Como classificamos os candidatos");
    const secoes = [...doc.querySelectorAll("article > section")].map((s) =>
      s.getAttribute("aria-labelledby"),
    );
    expect(secoes).toEqual([
      "sec-o-que-e",
      "sec-criterios",
      "sec-fontes",
      "sec-portao",
      "sec-metodo",
      "sec-publicadas",
      "sec-registro",
      "sec-limites",
      "sec-correcao",
    ]);
    for (const id of secoes) expect(doc.getElementById(id ?? "")?.tagName).toBe("H2");
  });

  it("🔴 cada categoria: o critério do catálogo, ou 'critério em definição' — nunca inventado", async () => {
    const { doc } = await render();
    const blocos = [...doc.querySelectorAll("[data-testid='etiquetas-categoria']")];
    expect(blocos.map((b) => b.getAttribute("data-categoria"))).toEqual(
      CATEGORIAS.map((c) => c.id),
    );
    for (const b of blocos) {
      const id = b.getAttribute("data-categoria") as keyof typeof CRITERIOS;
      const criterio = CRITERIOS[id];
      if (criterio) {
        expect(b.querySelector("[data-testid='etiquetas-criterio']")?.textContent).toBe(criterio);
      } else {
        expect(
          b.querySelector("[data-testid='etiquetas-criterio-em-definicao']")?.textContent,
        ).toBe("Critério em definição — nenhuma etiqueta desta categoria é exibida.");
      }
    }
    // O impeachment é nomeado com o qualificador, nunca "A favor" solto.
    expect(doc.body.textContent).toContain("Posição pública sobre impeachment de ministros do STF");
  });

  it("portão, corte da Câmara, foto do Senado — dos números do catálogo e dos arquivos", async () => {
    const { doc } = await render();
    expect(doc.getElementById("sec-portao")?.parentElement?.textContent).toContain(
      `${PORTAO_MARGEM_PP} pontos percentuais`,
    );
    expect(doc.querySelector("[data-testid='etiquetas-corte-camara']")?.textContent).toContain(
      "03/09/2026",
    );
    expect(doc.querySelector("[data-testid='etiquetas-foto-senado']")?.textContent).toMatch(
      /\d{2}\/\d{2}\/\d{4}/,
    );
  });

  it("nada revisado na cópia do build de hoje ⇒ 'nenhuma classificação no ar', sem tabela vazia", async () => {
    const { doc } = await render();
    // Se um dia houver linha revisada, este caso passa a exigir a tabela.
    const tabela = doc.querySelector("[data-testid='etiquetas-publicadas']");
    const nenhuma = doc.querySelector("[data-testid='etiquetas-nenhuma-publicada']");
    expect(Boolean(tabela) !== Boolean(nenhuma)).toBe(true);
  });

  it("🔴 canal de correção: o repositório público que o site já cita — nenhum e-mail inventado", async () => {
    const { html, doc } = await render();
    expect(
      doc
        .getElementById("sec-correcao")
        ?.parentElement?.querySelector("a[href='https://github.com/sudomenna/salacofre']"),
    ).not.toBeNull();
    expect(html).not.toMatch(/mailto:|@[a-z0-9-]+\.[a-z]{2,}/i);
  });

  it("🔴 nunca exibe 'a classificar' nem o id cru da sentinela", async () => {
    const { html } = await render();
    expect(html.toLowerCase()).not.toContain("a classificar");
    expect(html).not.toContain("a_classificar");
  });
});

describe("RF-252 — /sobre-o-modelo aponta para a metodologia das etiquetas", () => {
  it("um parágrafo com o link, sem <h2> novo (continuam oito)", () => {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(<SobreOModeloPage />),
      "text/html",
    );
    const p = doc.querySelector("[data-testid='sobre-o-modelo-etiquetas']");
    expect(p?.tagName).toBe("P");
    expect(p?.querySelector("a[href='/sobre-as-etiquetas']")).not.toBeNull();
    expect(p?.closest("section")?.getAttribute("aria-labelledby")).toBe("sec-limits");
    expect(doc.querySelectorAll("h2")).toHaveLength(8);
  });
});
