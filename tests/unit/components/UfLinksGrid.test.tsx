// @vitest-environment happy-dom
/**
 * tests/unit/components/UfLinksGrid.test.tsx — a lista de UFs da fase SEM
 * payload, agora com bandeira (2026-10-04, pedido do dono; ADR-0070, emenda).
 *
 * Até 03/10 esta lista era deliberadamente sem bandeira; a capa de Deputado
 * Federal sem dado mostrava a lista crua enquanto a Estadual, já com dado,
 * mostrava a grade com bandeiras. A bandeira é decorativa (`alt=""`): nome
 * por extenso e sigla continuam em texto (constituição § 4, RF-162/163).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UfLinksGrid } from "@/components/blocks/UfLinksGrid";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

describe("UfLinksGrid — bandeira ao lado do nome", () => {
  // 🔴 MUTAÇÃO (2026-10-04): tirar o `<UfFlag>` do item — (a) e (b) morrem.
  it("(a) um `<img>` decorativo por item, apontando para o arquivo da própria UF", () => {
    const doc = parse(<UfLinksGrid cargo={6} />);
    const itens = doc.querySelectorAll('[data-testid="uf-links-grid-item"]');
    expect(itens).toHaveLength(27);
    for (const item of itens) {
      const sigla = item.getAttribute("data-sigla");
      const imgs = item.querySelectorAll("img");
      expect(imgs, sigla ?? "").toHaveLength(1);
      expect(imgs[0]?.getAttribute("src")).toBe(`/bandeiras/${sigla}.webp`);
      expect(imgs[0]?.getAttribute("alt")).toBe("");
    }
  });

  it("(b) o filtro de siglas vale também para as bandeiras", () => {
    const doc = parse(<UfLinksGrid cargo={6} ufs={["sp", "RJ"]} />);
    const srcs = [...doc.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs.sort()).toEqual(["/bandeiras/RJ.webp", "/bandeiras/SP.webp"]);
  });

  it("(c) o texto do link não muda: nome por extenso e sigla", () => {
    const doc = parse(<UfLinksGrid cargo={6} />);
    const sp = doc.querySelector('[data-sigla="SP"]');
    expect(sp?.textContent).toBe("São PauloSP");
  });
});
