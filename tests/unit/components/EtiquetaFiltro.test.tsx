// @vitest-environment happy-dom
/**
 * tests/unit/components/EtiquetaFiltro.test.tsx — o filtro por etiqueta
 * (spec 025, RF-247; V5):
 *
 *   - 🔴 a regra de CSS é montada para o token escolhido (`regraDoFiltro`) e
 *     só ESCONDE (`display: none`) — nunca reordena (`order`,
 *     `flex-direction`…); todo token do catálogo tem regra por construção, e
 *     nenhuma regra de filtro vai para a folha que bloqueia a renderização
 *     (B1 da auditoria de a11y/perf, 29/09 — eram 20 regras com `:has()`);
 *   - o componente só escreve no próprio invólucro (`data-filtro` e um
 *     `<style>` filho): não move, não remove, não reordena nó nenhum da página;
 *   - sem JavaScript, `data-filtro` fica vazio e não há regra;
 *   - 🔴 a região viva da contagem existe na árvore de acessibilidade ANTES do
 *     primeiro anúncio (M3, 29/09 — `:empty { display: none }` a tirava);
 *   - `<select>` nativo com `<optgroup>` por categoria; a contagem em
 *     `aria-live`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { EtiquetaFiltro, regraDoFiltro } from "@/components/atoms/controls/EtiquetaFiltro";
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

describe("RF-247 — a regra do filtro", () => {
  it("🔴 todo token do catálogo tem regra, e ela casa só com aquele token", () => {
    for (const t of todosOsTokensDoCatalogo()) {
      const r = regraDoFiltro(t, true) ?? "";
      expect(r, t).toContain(`main:has([data-filtro="${t}"]) [data-etq]:not([data-etq~="${t}"])`);
      expect(r, t).toContain(`[data-regiao]:not(:has([data-etq~="${t}"]))`);
    }
  });

  it("🔴 a regra só ESCONDE: uma declaração, `display:none`, nada de `order`/`position`…", () => {
    for (const t of todosOsTokensDoCatalogo()) {
      for (const regiao of [true, false]) {
        const r = regraDoFiltro(t, regiao) ?? "";
        const declaracoes = [...r.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
        expect(declaracoes).toEqual(["display:none"]);
        expect(r).not.toMatch(/\border\s*:|flex-direction|grid-row|grid-area|position\s*:/);
      }
    }
  });

  it("sem `esconderRegiao` (a capa de Governador) a região nunca some", () => {
    expect(regraDoFiltro("relacao_governo:oposicao", false)).not.toContain("data-regiao");
  });

  it("🔴 token fora da forma do catálogo não vira CSS (nada é interpolado cru)", () => {
    for (const ruim of ['a"]{}*{display:none}', "relacao_governo", "", "X:y", "a:b c"]) {
      expect(regraDoFiltro(ruim, true), ruim).toBeNull();
    }
  });

  it("🔴 nenhuma regra de filtro na folha de estilo (B1): o CSS module é só o controle", () => {
    const regras = CSS.replace(/\/\*.*?\*\//g, "");
    expect(regras).not.toContain("data-etq");
    expect(regras).not.toContain(":has(");
    expect(regras).not.toContain("data-filtro");
  });

  it("🔴 M3: a contagem vazia sai da VISTA, não da árvore (nada de `display: none`)", () => {
    const vazia = CSS.slice(CSS.indexOf(".contagem:empty"));
    const corpo = vazia.slice(vazia.indexOf("{") + 1, vazia.indexOf("}"));
    expect(corpo).not.toMatch(/display\s*:\s*none/);
    expect(corpo).not.toMatch(/visibility\s*:\s*hidden/);
    expect(corpo).toMatch(/position\s*:\s*absolute/);
    expect(corpo).toMatch(/clip-path\s*:\s*inset\(50%\)/);
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
    expect(d.querySelector("[role='status']")?.getAttribute("aria-live")).toBe("polite");
    // Sem JS não há regra nenhuma.
    expect(d.querySelector("style")).toBeNull();
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
    // A regra do token escolhido — e só ela — vive dentro do próprio filtro.
    const estilos = w?.querySelectorAll("style") ?? [];
    expect(estilos).toHaveLength(1);
    expect(estilos[0]?.textContent).toBe(regraDoFiltro("relacao_governo:oposicao", true));
    // Voltar para "Todas as corridas" tira a regra.
    await act(async () => {
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(w?.querySelector("style")).toBeNull();
    expect(w?.getAttribute("data-filtro")).toBe("");
    // Nenhum nó movido, removido ou reordenado.
    expect([...document.querySelectorAll("#lista li")].map((l) => l.textContent)).toEqual(antes);
    await act(async () => root.unmount());
  });
});
