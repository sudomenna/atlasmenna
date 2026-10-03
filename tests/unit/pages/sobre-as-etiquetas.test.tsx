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

  it("resumo OU 'nenhuma classificação no ar' — nunca tabela vazia, nunca as duas coisas", async () => {
    const { doc } = await render();
    const estados = ["etiquetas-resumo", "etiquetas-nenhuma-publicada"].filter((id) =>
      doc.querySelector(`[data-testid='${id}']`),
    );
    expect(estados).toHaveLength(1);
    const resumo = doc.querySelector("[data-testid='etiquetas-resumo']");
    if (resumo) expect(resumo.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
  });

  it("🔴 A3/M2: nenhum link abre aba nova, nenhuma célula com `style`", async () => {
    const { doc } = await render();
    // O rodapé do site (link do TSE) é de todas as páginas e fica fora daqui.
    expect(doc.querySelectorAll("article a[target='_blank']")).toHaveLength(0);
    expect(doc.querySelectorAll("td[style], th[style]")).toHaveLength(0);
  });

  it("🔴 § 8 — a lista COMPLETA (com as derivadas) é linkada: o CSV público", async () => {
    const { doc } = await render();
    const p = doc.querySelector("[data-testid='etiquetas-lista-completa']");
    expect(p?.querySelector("a[href='/sobre-as-etiquetas/classificacoes.csv']")).not.toBeNull();
    expect(p?.textContent).toContain("regra derivada");
    // A frase antiga ("não estão linha a linha aqui") era falsa e saiu.
    expect(doc.body.textContent).not.toContain("não estão linha a linha");
  });

  it("🔴 § 2 (b) — diz que a regra derivada só vale com o arquivo inteiro aprovado, com data", async () => {
    const { doc } = await render();
    const t = doc.querySelector("[data-testid='etiquetas-revisao-derivada']")?.textContent ?? "";
    expect(t).toContain("arquivo inteiro");
    expect(t).toContain("data e nome");
  });

  it("🔴 com todas as chaves desligadas, NÃO afirma que 'algumas telas mostram etiquetas'", async () => {
    // A cópia do build versionada tem tudo desligado (teste de deriva).
    const { doc } = await render();
    const deck = doc.querySelector("[data-testid='etiquetas-deck']")?.textContent ?? "";
    expect(deck).toContain("Nenhuma tela do AtlasMenna mostra etiquetas editoriais ainda");
    expect(deck).not.toContain("Algumas telas");
  });

  it("🔴 canal de correção: as issues do repositório público — nenhum e-mail inventado, nenhuma promessa circular", async () => {
    const { html, doc } = await render();
    const secao = doc.getElementById("sec-correcao")?.parentElement;
    expect(
      secao?.querySelector("a[href='https://github.com/sudomenna/atlasmenna/issues']"),
    ).not.toBeNull();
    expect(secao?.textContent).not.toContain("será publicado");
    expect(html).not.toMatch(/mailto:|@[a-z0-9-]+\.[a-z]{2,}/i);
  });

  it("🔴 nunca exibe 'a classificar' nem o id cru da sentinela", async () => {
    const { html } = await render();
    expect(html.toLowerCase()).not.toContain("a classificar");
    expect(html).not.toContain("a_classificar");
  });
});

describe("RF-252 — /sobre-o-modelo aponta para a metodologia das etiquetas", () => {
  it("um parágrafo com o link, sem <h2> novo (continuam oito)", async () => {
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(await SobreOModeloPage()),
      "text/html",
    );
    const p = doc.querySelector("[data-testid='sobre-o-modelo-etiquetas']");
    expect(p?.tagName).toBe("P");
    expect(p?.querySelector("a[href='/sobre-as-etiquetas']")).not.toBeNull();
    // Chaves todas desligadas na cópia do build ⇒ não afirma que telas mostram etiquetas.
    expect(p?.textContent).toContain("Nenhuma tela mostra");
    expect(p?.textContent).not.toContain("Algumas telas");
    // O canal de correção existe AQUI também — sem "será publicado" em círculo.
    expect(
      doc.querySelector(
        "a[data-testid='sobre-o-modelo-canal-correcao'][href='https://github.com/sudomenna/atlasmenna/issues']",
      ),
    ).not.toBeNull();
    expect(doc.body.textContent).not.toContain("contato de redação serão publicados");
    expect(p?.closest("section")?.getAttribute("aria-labelledby")).toBe("sec-limits");
    expect(doc.querySelectorAll("h2")).toHaveLength(8);
  });
});
