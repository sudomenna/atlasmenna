// @vitest-environment happy-dom
/**
 * tests/unit/components/GovernadoresPorPartido.test.tsx — spec 006, RF-006.7.
 *
 * A barra dividida por partido, nas duas bases. A soma e a ordem são do
 * módulo `lib/utils/desfecho-governador.ts` (testado à parte); aqui: o texto
 * de cada linha, a sigla abreviada com a inteira para o leitor de tela, a cor
 * por IDENTIDADE (nunca por posição), o contorno obrigatório e a nota de que
 * o 2º turno conta dois candidatos.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DATA_FILL_STROKE } from "@/components/blocks/_candidateColor";
import {
  GovernadoresPorPartido,
  PARTIDO_NAO_INFORMADO,
} from "@/components/blocks/GovernadoresPorPartido";
import type { EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function row(sigla: string, over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla,
    pct_apurado: 40,
    lider: 1,
    margem_atual: 5,
    margem_projetada: 5,
    margem_projetada_ci: [3, 7],
    chamada: false,
    swing_vs_2022: 0,
    top_candidatos: [
      { id: 1, pct: 45, partido: "REPUBLICANOS", pct_atual: 44 },
      { id: 2, pct: 35, partido: "PT", pct_atual: 36 },
    ],
    vai_a_2t: true,
    bucket: "vai_2t",
    ...over,
  };
}

function linhas(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>('[data-testid="por-partido-linha"]')];
}

const SIM = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../fixtures/simulacao/governador.json"), "utf8"),
) as EdgePayload;

describe("<GovernadoresPorPartido />", () => {
  it("(a) simulado, projeção: PT 11 (2 + 9) e PL 10 (2 + 8) no topo", () => {
    const doc = parse(<GovernadoresPorPartido porUf={SIM.por_uf} base="projecao" />);
    const ls = linhas(doc);
    expect(ls[0]?.getAttribute("data-partido")).toBe("PT");
    expect(ls[0]?.textContent).toContain("11 · 2 vencem no 1º turno + 9 no 2º turno");
    expect(ls[1]?.getAttribute("data-partido")).toBe("PL");
    expect(ls[1]?.textContent).toContain("10 · 2 vencem no 1º turno + 8 no 2º turno");
  });

  it("(b) soma das linhas = eleitos + 2 × estados em 2º turno (9 + 2 × 17 = 43)", () => {
    const doc = parse(<GovernadoresPorPartido porUf={SIM.por_uf} base="projecao" />);
    const soma = linhas(doc).reduce(
      (a, l) =>
        a + Number(l.getAttribute("data-eleitos")) + Number(l.getAttribute("data-segundo-turno")),
      0,
    );
    expect(soma).toBe(43);
    expect(doc.body.textContent).toContain("conta dois candidatos");
  });

  it("(c) contagem fala no condicional ('fecharia'), nunca 'eleito'", () => {
    const porUf = [
      row("SP", {
        top_candidatos: [
          { id: 1, pct: 48, partido: "PL", pct_atual: 53 },
          { id: 2, pct: 40, partido: "PT", pct_atual: 30 },
        ],
      }),
    ];
    const doc = parse(<GovernadoresPorPartido porUf={porUf} base="contagem" />);
    expect(linhas(doc)[0]?.textContent).toContain("1 · 1 fecharia");
    expect(doc.body.textContent?.toLowerCase()).not.toContain("eleito");
  });

  it("(d) sigla desenhada abreviada, sigla INTEIRA para o leitor de tela", () => {
    const doc = parse(<GovernadoresPorPartido porUf={[row("SP")]} base="projecao" />);
    const rep = linhas(doc).find((l) => l.getAttribute("data-partido") === "REPUBLICANOS");
    expect(rep?.querySelector('[aria-hidden="true"]')?.textContent).toBe("REP");
    expect(rep?.querySelector(".sr-only")?.textContent).toBe("REPUBLICANOS");
    // Sigla que não abrevia não ganha par duplicado.
    const pt = linhas(doc).find((l) => l.getAttribute("data-partido") === "PT");
    expect(pt?.querySelector(".sr-only")).toBeNull();
  });

  it("(e) cor pela SIGLA (ADR-0024), não pela posição na lista", () => {
    const doc = parse(<GovernadoresPorPartido porUf={[row("SP")]} base="projecao" />);
    const estilos = linhas(doc).map((l) => l.getAttribute("style") ?? "");
    const rep = estilos.find((s) => s.includes("--party-republicanos"));
    const pt = estilos.find((s) => s.includes("--party-pt"));
    expect(rep).toBeDefined();
    expect(pt).toBeDefined();
    expect(estilos.join(" ")).not.toContain("--color-cand-");
  });

  it("(f) partido ausente vira a linha 'Partido não informado', na cor de fallback", () => {
    const porUf = [
      row("AC", {
        top_candidatos: [
          { id: 1, pct: 45, pct_atual: 44 },
          { id: 2, pct: 35, partido: "PT", pct_atual: 36 },
        ],
      }),
    ];
    const doc = parse(<GovernadoresPorPartido porUf={porUf} base="projecao" />);
    const semPartido = linhas(doc).find((l) => l.getAttribute("data-partido") === "");
    expect(semPartido?.textContent).toContain(PARTIDO_NAO_INFORMADO);
    expect(semPartido?.getAttribute("style")).toContain("--party-outros");
  });

  it("(g) a barra é decorativa e a parte vazia não é desenhada", () => {
    const doc = parse(<GovernadoresPorPartido porUf={[row("SP")]} base="projecao" />);
    const pt = linhas(doc).find((l) => l.getAttribute("data-partido") === "PT");
    const trilha = pt?.querySelector('[aria-hidden="true"]:not(.sr-only)');
    expect(trilha?.getAttribute("aria-hidden")).toBe("true");
    // PT: 0 eleitos + 1 no 2º turno → só a parte listrada.
    expect(pt?.textContent).toContain("1 · 1 no 2º turno");
    expect(pt?.textContent).not.toContain("eleito");
  });

  it("(h) sem partido nenhum somando, NÃO imprime lista vazia nem zero", () => {
    const doc = parse(<GovernadoresPorPartido porUf={[]} base="contagem" />);
    expect(linhas(doc)).toHaveLength(0);
    expect(doc.body.textContent).not.toMatch(/\d/);
  });

  it("(i) o contorno do CSS é o mesmo `DATA_FILL_STROKE` do resto do produto (RNF-035)", () => {
    const css = readFileSync(
      path.resolve(__dirname, "../../../components/blocks/GovernadoresPorPartido.module.css"),
      "utf8",
    );
    expect(css).toContain(`border: ${DATA_FILL_STROKE};`);
  });

  it("(j) o título 'Por partido' respeita o nível pedido", () => {
    const doc = parse(
      <GovernadoresPorPartido porUf={[row("SP")]} base="projecao" headingLevel={3} />,
    );
    expect(doc.querySelector("h3")?.textContent).toBe("Por partido");
    expect(doc.querySelector("h4")).toBeNull();
  });
});
