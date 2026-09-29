// @vitest-environment happy-dom
/**
 * tests/unit/components/HemicicloPorBloco.test.tsx — a visão por bloco
 * (spec 025, RF-240/RF-241; ADR-0061 item 4): ordem fixa dos blocos, marcas
 * de limiar fora do arco (41/49/54 · 257/308/342), a marca que cai dentro da
 * coluna, texto que diz "governo Lula" e "não posição ideológica", nenhuma cor
 * de partido, e o teto de peso.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  fraseEmpate,
  frasePlacar,
  HemicicloPorBloco,
  PAPEL_BLOCO,
  TINTA_BLOCO,
} from "@/components/blocks/HemicicloPorBloco";
import { type BlocoHemiciclo, ORDEM_BLOCOS_HEMICICLO } from "@/lib/etiquetas/catalogo";
import { type CadeiraDoBloco, ordenarPorBloco } from "@/lib/etiquetas/visoes";
import { ARCOS_CAMARA, ARCOS_SENADO } from "@/lib/utils/hemiciclo";

function cadeiras(n: Partial<Record<BlocoHemiciclo, number>>): CadeiraDoBloco[] {
  const out: CadeiraDoBloco[] = [];
  // Entrada EMBARALHADA de propósito: a ordem da saída não pode depender dela.
  for (const b of ["oposicao", "aguardando", "base_governo", "independente"] as const) {
    for (let i = 0; i < (n[b] ?? 0); i++) out.push({ bloco: b, origem: "projetada" });
  }
  return out;
}

function render(casa: "senado" | "camara", n: Partial<Record<BlocoHemiciclo, number>>) {
  const visao = ordenarPorBloco(cadeiras(n));
  const html = renderToStaticMarkup(
    <HemicicloPorBloco
      visao={visao}
      arcos={casa === "senado" ? ARCOS_SENADO : ARCOS_CAMARA}
      casa={casa}
      idPrefixo={`t-${casa}`}
      titulo="Teste por bloco"
      rotuloAguardando="Aguardando apuração"
    />,
  );
  return { html, doc: new DOMParser().parseFromString(html, "text/html") };
}

const SENADO = { base_governo: 34, independente: 9, aguardando: 8, oposicao: 30 };

describe("RF-240 — <HemicicloPorBloco> no Senado (81)", () => {
  it("role=img, <title>/<desc>, e o describedby aponta para o placar e os limiares que EXISTEM", () => {
    const { doc } = render("senado", SENADO);
    const svg = doc.querySelector("svg[role='img']");
    expect(svg).not.toBeNull();
    const ids = (svg?.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(ids.length).toBe(3);
    for (const id of ids) expect(doc.getElementById(id), id).not.toBeNull();
    const desc = doc.querySelector("desc")?.textContent ?? "";
    expect(desc).toContain("relação com o governo Lula, não posição ideológica");
    expect(desc).toContain("41 (maioria absoluta)");
  });

  it("🔴 blocos na ordem fixa: Base → Independentes → aguardando → Oposição", () => {
    const { doc } = render("senado", SENADO);
    const grupos = [...doc.querySelectorAll("svg g[data-bloco]")].map((g) =>
      g.getAttribute("data-bloco"),
    );
    expect(grupos).toEqual([...ORDEM_BLOCOS_HEMICICLO]);
    const circulos = [...doc.querySelectorAll("svg g[data-bloco]")].map(
      (g) => g.querySelectorAll("circle").length,
    );
    expect(circulos).toEqual([34, 9, 8, 30]);
  });

  it("🔴 marcas 41/49/54 fora do arco; 41 com empate e o traço de corte dentro da coluna", () => {
    const { doc } = render("senado", SENADO);
    const marcas = [...doc.querySelectorAll("[data-testid='hemiciclo-bloco-marcas'] > g")];
    expect(marcas.map((m) => m.getAttribute("data-k"))).toEqual(["41", "49", "54"]);
    const m41 = marcas[0];
    expect(m41?.getAttribute("data-empate")).toBe("true");
    expect(m41?.querySelector("[data-testid='hemiciclo-bloco-corte']")).not.toBeNull();
    expect(marcas[1]?.getAttribute("data-empate")).toBeNull();
    expect(marcas[1]?.querySelector("[data-testid='hemiciclo-bloco-corte']")).toBeNull();
    // A marca está FORA do arco externo: o viewBox ganhou folga (y negativo).
    const vb = doc.querySelector("svg")?.getAttribute("viewBox") ?? "";
    expect(Number(vb.split(" ")[1])).toBeLessThan(0);
    // E a frase do empate está em texto.
    expect(doc.querySelector("[data-testid='hemiciclo-bloco-nota-empate']")?.textContent).toContain(
      "A marca de 41 cai na coluna do meio: das 3 cadeiras dessa coluna, as 2 de dentro contam antes",
    );
  });

  it("placar em texto dos DOIS lados (critério simétrico)", () => {
    const { doc } = render("senado", SENADO);
    const lim = doc.querySelector("[data-testid='hemiciclo-bloco-limiares']")?.textContent ?? "";
    expect(lim).toContain("Base do governo Lula 34 — faltam 7 para 41");
    expect(lim).toContain("Oposição ao governo Lula 30 — faltam 11 para 41");
    expect(lim).toContain("54 — dois terços");
    expect(frasePlacar("X", 43, 41)).toBe("X 43 — alcança 41");
  });

  it("🔴 nenhuma cor de partido, nenhum 'a classificar', nunca 'eleito'", () => {
    const { html, doc } = render("senado", SENADO);
    expect(html).not.toMatch(/--party-/);
    expect(html.toLowerCase()).not.toContain("a classificar");
    expect(html.toLowerCase()).not.toContain("a_classificar");
    expect(html.toLowerCase()).not.toMatch(/\beleit/);
    const fills = new Set(
      [...doc.querySelectorAll("svg g[data-bloco]")].map((g) => g.getAttribute("fill")),
    );
    for (const f of fills) {
      expect(
        [TINTA_BLOCO, PAPEL_BLOCO, "var(--surface-sunken)"].includes(f ?? "") ||
          f?.startsWith("url(#"),
      ).toBe(true);
    }
  });

  it("frase do empate: singular e plural certos", () => {
    expect(fraseEmpate({ k: 257, colunaAntes: 4, colunaDepois: 3 })).toContain(
      "das 7 cadeiras dessa coluna, as 4 de dentro contam antes da marca e as 3 de fora, depois",
    );
  });
});

describe("RF-241 — <HemicicloPorBloco> na Câmara (513)", () => {
  it("marcas 257/308/342; 257 com empate; soma 513", () => {
    const { doc } = render("camara", {
      base_governo: 200,
      independente: 120,
      aguardando: 43,
      oposicao: 150,
    });
    const marcas = [...doc.querySelectorAll("[data-testid='hemiciclo-bloco-marcas'] > g")];
    expect(marcas.map((m) => m.getAttribute("data-k"))).toEqual(["257", "308", "342"]);
    expect(marcas[0]?.getAttribute("data-empate")).toBe("true");
    expect(doc.querySelectorAll("svg g[data-bloco] circle")).toHaveLength(513);
    expect(doc.querySelector("[data-testid='hemiciclo-bloco-limiares']")?.textContent).toContain(
      "autorizar processo de impeachment do presidente",
    );
  });
});

describe("peso (HTML) — o custo é markup, e ele tem teto", () => {
  const KIB = 1024;
  it("Senado: < 12 KiB", () => {
    const { html } = render("senado", SENADO);
    expect(new TextEncoder().encode(html).length, `${html.length}`).toBeLessThan(12 * KIB);
  });
  it("Câmara: < 36 KiB (o mesmo teto do plenário por partido)", () => {
    const { html } = render("camara", {
      base_governo: 200,
      independente: 120,
      aguardando: 43,
      oposicao: 150,
    });
    expect(new TextEncoder().encode(html).length, `${html.length}`).toBeLessThan(36 * KIB);
  });
  it("agrupamento por <g>: um por bloco, nunca um por cadeira", () => {
    const { doc } = render("camara", { base_governo: 300, oposicao: 213 });
    expect(doc.querySelectorAll("svg g[data-bloco]").length).toBe(2);
  });
});
