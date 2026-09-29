// @vitest-environment happy-dom
/**
 * tests/unit/components/EtiquetaFiltro.test.tsx — o filtro por etiqueta
 * (spec 025, RF-247; V5):
 *
 *   - 🔴 uma regra de CSS por token do catálogo, e a regra ESCONDE
 *     (`display: none`) — nunca reordena (`order`, `flex-direction`…);
 *   - o componente só escreve `data-filtro` no próprio invólucro: não move,
 *     não remove, não reordena nó nenhum da página;
 *   - sem JavaScript, `data-filtro` fica vazio e nenhuma regra casa;
 *   - `<select>` nativo com `<optgroup>` por categoria; a contagem em
 *     `aria-live`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { EtiquetaFiltro } from "@/components/atoms/controls/EtiquetaFiltro";
import { type GrupoFiltro, todosOsTokensDoCatalogo } from "@/lib/etiquetas/telas";

/** O CSS com espaços colapsados — o formatador quebra seletor longo em linhas. */
const CSS = readFileSync(
  resolve(process.cwd(), "components/atoms/controls/EtiquetaFiltro.module.css"),
  "utf8",
).replace(/\s+/g, " ");

const GRUPOS: GrupoFiltro[] = [
  {
    categoria: "relacao_governo",
    rotulo: "Relação com o governo Lula",
    opcoes: [
      { token: "relacao_governo:base_governo", rotulo: "Base do governo" },
      { token: "relacao_governo:oposicao", rotulo: "Oposição" },
    ],
  },
];

describe("RF-247 — o CSS do filtro", () => {
  it("🔴 uma regra por token do catálogo — valor novo sem regra = filtro que não filtra", () => {
    for (const t of todosOsTokensDoCatalogo()) {
      expect(CSS, t).toContain(
        `.filtro[data-filtro="${t}"]) :global([data-etq]:not([data-etq~="${t}"]))`,
      );
      expect(CSS, t).toContain(`:global([data-regiao]:not(:has([data-etq~="${t}"])))`);
    }
  });

  it("🔴 as regras só ESCONDEM: nada de `order`, `flex-direction`, `grid-row`…", () => {
    const regras = CSS.slice(CSS.indexOf("/* biome-ignore-start"));
    expect(regras).not.toMatch(/\border\s*:/);
    expect(regras).not.toMatch(/flex-direction|grid-row|grid-area|position\s*:/);
    const declaracoes = [...regras.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]?.trim());
    expect(declaracoes.length).toBe(todosOsTokensDoCatalogo().length);
    for (const d of declaracoes) expect(d).toBe("display: none;");
  });

  it("app/globals.css não ganhou regra de filtro", () => {
    const globals = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    expect(globals).not.toContain("data-filtro");
    expect(globals).not.toContain("data-etq");
  });
});

describe("RF-247 — <EtiquetaFiltro>", () => {
  let raiz: HTMLDivElement | null = null;
  afterEach(() => {
    raiz?.remove();
    raiz = null;
  });

  it("sem JS (HTML do servidor): select nativo, optgroups, data-filtro vazio", () => {
    const html = renderToStaticMarkup(<EtiquetaFiltro grupos={GRUPOS} />);
    const d = new DOMParser().parseFromString(html, "text/html");
    const w = d.querySelector("[data-testid='etiqueta-filtro']");
    expect(w?.getAttribute("data-filtro")).toBe("");
    expect(d.querySelector("label")?.textContent).toBe("Filtrar corridas por etiqueta editorial");
    expect(d.querySelector("optgroup")?.getAttribute("label")).toBe("Relação com o governo Lula");
    expect([...d.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([
      "",
      "relacao_governo:base_governo",
      "relacao_governo:oposicao",
    ]);
    expect(d.querySelector("[aria-live='polite']")).not.toBeNull();
  });

  it("sem opção nenhuma ⇒ não renderiza", () => {
    expect(renderToStaticMarkup(<EtiquetaFiltro grupos={[]} />)).toBe("");
  });

  it("🔴 escolher uma opção escreve data-filtro, conta — e NÃO mexe na ordem da página", async () => {
    document.body.innerHTML = `<main>
      <div id="slot"></div>
      <ul id="lista">
        <li data-etq="relacao_governo:oposicao">RS</li>
        <li data-etq="relacao_governo:base_governo relacao_governo:oposicao">SP</li>
        <li data-etq="">AC</li>
        <li data-etq="relacao_governo:base_governo">BA</li>
      </ul>
    </main>`;
    raiz = document.getElementById("slot") as HTMLDivElement;
    const root = createRoot(raiz);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(<EtiquetaFiltro grupos={GRUPOS} esconderRegiaoVazia />));
    const antes = [...document.querySelectorAll("#lista li")].map((l) => l.textContent);
    const select = document.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "relacao_governo:oposicao";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const w = document.querySelector("[data-testid='etiqueta-filtro']");
    expect(w?.getAttribute("data-filtro")).toBe("relacao_governo:oposicao");
    expect(w?.getAttribute("data-regioes")).toBe("esconder");
    expect(document.querySelector("[aria-live='polite']")?.textContent).toContain(
      "2 corridas com Relação com o governo Lula: oposição",
    );
    // Nenhum nó movido, removido ou reordenado.
    expect([...document.querySelectorAll("#lista li")].map((l) => l.textContent)).toEqual(antes);
    await act(async () => root.unmount());
  });
});
