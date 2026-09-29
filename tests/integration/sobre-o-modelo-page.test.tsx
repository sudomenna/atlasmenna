// @vitest-environment happy-dom
/**
 * tests/integration/sobre-o-modelo-page.test.tsx
 *
 * S07/Bloco 2 — a página de metodologia saiu do CSS Module e passou a falar a
 * língua do design system Atlas Menna (ADR-0025).
 *
 * O ponto destes testes é o que a migração **não** podia mudar: o conteúdo. A
 * rota é a peça de transparência metodológica que a constituição § 8 exige, e
 * um restyle não pode encolher, reordenar ou perder nada dela. Por isso as
 * asserções são sobre as seções, o rodapé regulatório e as três ilustrações —
 * não sobre estilo, que é justamente o que mudou.
 *
 * 2026-09-13: a lista de seções cresceu de oito para nove (`sec-cadeiras`).
 * O conteúdo dessa seção nova é travado em
 * `tests/unit/pages/sobre-o-modelo.test.tsx`; aqui só a estrutura.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import SobreOModeloPage from "@/app/sobre-o-modelo/page";

// A página é async desde 29/09 (lê as chaves das etiquetas); renderiza uma vez.
let MARKUP = "";
beforeAll(async () => {
  MARKUP = renderToStaticMarkup(await SobreOModeloPage());
});

function parse(): Document {
  return new DOMParser().parseFromString(MARKUP, "text/html");
}

describe("/sobre-o-modelo — restyle em tokens (S07/Bloco 2)", () => {
  it("(a) as nove seções continuam lá, na mesma ordem", () => {
    const doc = parse();
    const secoes = [...doc.querySelectorAll("article > section")].map((s) =>
      s.getAttribute("aria-labelledby"),
    );
    // `sec-cadeiras` entrou em 2026-09-13 (RF-127 / ADR-0036 / ADR-0037) entre
    // a agulha e as limitações: é a segunda faixa que a página precisa
    // explicar, e ela não é feita como a das corridas majoritárias.
    expect(secoes).toEqual([
      "sec-modelo",
      "sec-regra-de-tres",
      "sec-ci",
      "sec-agulha",
      "sec-cadeiras",
      "sec-limits",
      "sec-team",
      "sec-fontes",
    ]);
    // A nona é o `<aside>` do aviso oficial.
    expect(doc.querySelector('aside[aria-label="Aviso oficial"]')).not.toBeNull();
  });

  it("(b) um único <h1>, e os oito <h2> de seção seguem existindo", () => {
    const doc = parse();
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    expect(doc.querySelector("h1")?.textContent).toBe("Como o AtlasMenna faz uma projeção");
    expect(doc.querySelectorAll("h2")).toHaveLength(8);
  });

  it("(c) o rodapé regulatório continua com 'Não oficial' e o link do TSE (constituição § 1)", () => {
    const doc = parse();
    const footer = doc.querySelector("footer");
    expect(footer?.textContent).toContain("Não oficial");
    const link = footer?.querySelector('a[href="https://resultados.tse.jus.br"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe("TSE");
  });

  it("(d) as três ilustrações SVG inline continuam na página", () => {
    const doc = parse();
    const svgs = [...doc.querySelectorAll("figure svg")];
    expect(svgs).toHaveLength(3);
    // Nenhuma delas perdeu o nome acessível.
    for (const svg of svgs) {
      expect(svg.getAttribute("role")).toBe("img");
      expect(svg.getAttribute("aria-label")).toBeTruthy();
    }
  });

  it("(e) o texto que descreve o método continua íntegro (ADR-0021)", () => {
    const texto = (parse().body.textContent ?? "").replace(/\s+/g, " ");
    expect(texto).toContain("k = eleitores aptos da zona ÷ eleitores das seções já instaladas");
    expect(texto).toContain("O resultado de 2022 não entra nessa conta.");
    expect(texto).toContain("As quatro bandas");
    expect(texto).toContain("O que o modelo não faz bem");
    expect(texto).toContain("De onde vêm os dados");
  });

  it("(f) a tabela de bandas mantém as quatro faixas com cabeçalho de coluna", () => {
    const doc = parse();
    const ths = [...doc.querySelectorAll("table th")];
    expect(ths.map((t) => t.textContent)).toEqual(["Banda", "Faixa", "Leitura"]);
    for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
    expect(doc.querySelectorAll("table tbody tr")).toHaveLength(4);
  });

  it("(g) nenhuma classe de CSS Module sobrou, e as cores saem de tokens", () => {
    const html = MARKUP;
    // Classes de módulo têm hash (`sobre-o-modelo_body__xxxxx`).
    expect(html).not.toMatch(/sobre-o-modelo_/);
    // Nada de hex cravado no markup — tudo por `var(--token)`.
    expect(html).not.toMatch(/(color|background)\s*:\s*#[0-9a-fA-F]{3,8}/);
    expect(html).toContain("var(--surface-page)");
    expect(html).toContain("var(--accent-text)");
  });

  it("(h) `--accent` e `--ink-3` não carregam texto nesta página (RNF-022)", () => {
    const html = MARKUP;
    expect(html).not.toMatch(/color:var\(--accent\)/);
    expect(html).not.toMatch(/color:var\(--ink-3\)/);
  });
});
