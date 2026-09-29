// @vitest-environment happy-dom
/**
 * tests/unit/components/EtiquetaEditorial.test.tsx
 *
 * Os três componentes da spec 024 (RF-235, RF-236, RF-237) — ainda não
 * ligados a página nenhuma.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EtiquetaEditorial } from "@/components/atoms/data/EtiquetaEditorial";
import { EtiquetasLinha } from "@/components/atoms/data/EtiquetasLinha";
import { EtiquetasAviso, TEXTO_AVISO_ETIQUETAS } from "@/components/blocks/EtiquetasAviso";
import {
  CATEGORIAS,
  type CategoriaId,
  categoriaExibivel,
  ORDEM_CATEGORIAS,
} from "@/lib/etiquetas/catalogo";
import type { Resolucao } from "@/lib/etiquetas/resolver";

function classificado(categoria: CategoriaId, valor: string, rotulo: string | null): Resolucao {
  return {
    estado: "classificado",
    etiqueta: {
      categoria,
      valor,
      rotulo,
      origem: "partido",
      chave_origem: "partido:PL",
      fonte_url: "https://x.org",
      fonte_descricao: "d",
      data: "2026-09-20",
    },
  };
}

describe("RF-235 — <EtiquetaEditorial />", () => {
  it("texto do catálogo, com a categoria só para leitor de tela", () => {
    const html = renderToStaticMarkup(
      <EtiquetaEditorial categoria="relacao_governo" valor="base_governo" />,
    );
    expect(html).toContain(">Base do governo</span>");
    expect(html).toContain('<span class="sr-only">, relação com o governo Lula: </span>');
    expect(html).toContain('data-etiqueta="relacao_governo"');
    expect(html).toContain('data-valor="base_governo"');
  });

  it("🔴 nunca renderiza a_classificar, valor desconhecido, centrão 'nao' ou vazio", () => {
    for (const [cat, valor] of [
      ["relacao_governo", "a_classificar"],
      ["relacao_governo", "valor_do_futuro"],
      ["centrao", "nao"],
      ["categoria_nova", "x"],
      ["relacao_governo", null],
      ["relacao_governo", undefined],
    ] as const) {
      expect(
        renderToStaticMarkup(<EtiquetaEditorial categoria={cat} valor={valor} />),
        `${cat}/${valor}`,
      ).toBe("");
    }
  });

  it("centrão: rótulo diz tudo, sem prefixo de categoria — quando o critério está publicado", () => {
    const html = renderToStaticMarkup(<EtiquetaEditorial categoria="centrao" valor="sim" />);
    // Spec 025 (RF-250): sem critério publicado, nada vai à tela. O formato
    // do centrão com critério está em `etiqueta-qualificada.test.tsx`.
    if (categoriaExibivel("centrao")) {
      expect(html).toContain('<span class="sr-only">, </span>Centrão');
    } else {
      expect(html).toBe("");
    }
  });

  it("🔴 categoria sem critério publicado não vai à tela (spec 025, RF-250)", () => {
    for (const c of CATEGORIAS) {
      const primeiro = c.valores.find((v) => v.rotulo !== null);
      if (!primeiro) continue;
      const html = renderToStaticMarkup(<EtiquetaEditorial categoria={c.id} valor={primeiro.id} />);
      expect(html === "", c.id).toBe(!categoriaExibivel(c.id));
    }
  });

  it("🔴 nunca interativa — pode morar dentro de um <a>", () => {
    const html = renderToStaticMarkup(
      <a href="/uf/sp/senador">
        Fulano <EtiquetaEditorial categoria="relacao_governo" valor="oposicao" />
      </a>,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const etq = doc.querySelector("[data-testid='etiqueta-editorial']");
    expect(etq?.tagName).toBe("SPAN");
    expect(etq?.querySelectorAll("a,button,input,select,[tabindex],[role]")).toHaveLength(0);
    expect(etq?.getAttribute("tabindex")).toBeNull();
    expect(etq?.getAttribute("role")).toBeNull();
    expect(doc.querySelectorAll("a a")).toHaveLength(0);
  });
});

describe("RF-236 — <EtiquetasLinha />", () => {
  const resolucoes: Partial<Record<CategoriaId, Resolucao>> = {
    // Fora de ordem de propósito: a linha segue o catálogo, não a entrada.
    centrao: classificado("centrao", "sim", "Centrão"),
    relacao_governo: classificado("relacao_governo", "oposicao", "Oposição"),
    campo_ideologico: { estado: "a_classificar" },
    trajetoria_cargo: classificado("trajetoria_cargo", "estreante", "Estreante no cargo"),
    impeachment_stf: { estado: "nao_se_aplica" },
  };

  const textos = (html: string) =>
    [
      ...new DOMParser()
        .parseFromString(html, "text/html")
        .querySelectorAll("[data-testid='etiqueta-editorial']"),
    ].map((e) => e.getAttribute("data-etiqueta"));

  it("ordem do catálogo, só classificadas (e só as de critério publicado)", () => {
    const html = renderToStaticMarkup(<EtiquetasLinha resolucoes={resolucoes} />);
    const esperadas = ORDEM_CATEGORIAS.filter(
      (c) => ["relacao_governo", "centrao", "trajetoria_cargo"].includes(c) && categoriaExibivel(c),
    );
    expect(textos(html)).toEqual(esperadas);
    expect(esperadas.length).toBeGreaterThan(0);
    expect(html.startsWith('<span class="')).toBe(true);
  });

  it("só as categorias pedidas", () => {
    const html = renderToStaticMarkup(
      <EtiquetasLinha
        resolucoes={resolucoes}
        categorias={["trajetoria_cargo", "relacao_governo"]}
      />,
    );
    expect(textos(html)).toEqual(["relacao_governo", "trajetoria_cargo"]);
  });

  it("nada quando não sobra etiqueta (inclusive centrão 'nao')", () => {
    expect(
      renderToStaticMarkup(
        <EtiquetasLinha resolucoes={{ campo_ideologico: { estado: "a_classificar" } }} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <EtiquetasLinha resolucoes={{ centrao: classificado("centrao", "nao", null) }} />,
      ),
    ).toBe("");
    expect(renderToStaticMarkup(<EtiquetasLinha resolucoes={null} />)).toBe("");
  });
});

describe("RF-237 — <EtiquetasAviso />", () => {
  it("texto literal do dono + link para a metodologia", () => {
    expect(TEXTO_AVISO_ETIQUETAS).toBe(
      "Classificação editorial do AtlasMenna, com fonte e data — não é dado do TSE nem resultado do modelo.",
    );
    const html = renderToStaticMarkup(<EtiquetasAviso />);
    expect(html).toContain(TEXTO_AVISO_ETIQUETAS);
    expect(html).toContain('href="/sobre-as-etiquetas"');
  });
});
