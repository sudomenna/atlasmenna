// @vitest-environment happy-dom
/**
 * tests/unit/components/GovernadoresPlacarTurno.test.tsx — spec 006, RF-006.6.
 *
 * O placar "1º × 2º turno" das 27 corridas, nas duas bases. A regra é do
 * módulo `lib/utils/desfecho-governador.ts` (testado à parte); aqui o que se
 * prova é o DESENHO: números, listas de siglas com nome por extenso, faixa de
 * 27, vocabulário condicional na contagem e nenhum zero fabricado.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GovernadoresPlacarTurno } from "@/components/blocks/GovernadoresPlacarTurno";
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
      { id: 1, pct: 45, partido: "PL", pct_atual: 44 },
      { id: 2, pct: 35, partido: "PT", pct_atual: 36 },
    ],
    vai_a_2t: true,
    bucket: "vai_2t",
    ...over,
  };
}

function numero(doc: Document, desfecho: string): string | null {
  return (
    doc.querySelector(
      `[data-testid="placar-grupo"][data-desfecho="${desfecho}"] [data-testid="placar-numero"]`,
    )?.textContent ?? null
  );
}

const SIM = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../fixtures/simulacao/governador.json"), "utf8"),
) as EdgePayload;

describe("<GovernadoresPlacarTurno />", () => {
  it("(a) simulado, projeção: 9 eleitos · 17 no 2º turno · 1 em aberto · 0 aguardando", () => {
    const doc = parse(<GovernadoresPlacarTurno porUf={SIM.por_uf} base="projecao" />);
    expect(numero(doc, "eleito_1t")).toBe("9");
    expect(numero(doc, "segundo_turno")).toBe("17");
    expect(numero(doc, "em_aberto")).toBe("1");
    expect(numero(doc, "aguardando")).toBe("0");
    // ES, GO e MG são `chamada` com `vai_a_2t: true` — o defeito que a spec
    // corrige. Estão no 2º turno, não entre os eleitos.
    const t2 = doc.querySelector('[data-desfecho="segundo_turno"] [data-testid="placar-siglas"]');
    for (const nome of ["Espírito Santo", "Goiás", "Minas Gerais"]) {
      expect(t2?.textContent).toContain(nome);
    }
  });

  it("(b) simulado, contagem: AL fecharia (líder com 52,04%) — 10 · 17 · sem grupo 'em aberto'", () => {
    const doc = parse(<GovernadoresPlacarTurno porUf={SIM.por_uf} base="contagem" />);
    expect(numero(doc, "eleito_1t")).toBe("10");
    expect(numero(doc, "segundo_turno")).toBe("17");
    expect(numero(doc, "aguardando")).toBe("0");
    expect(doc.querySelector('[data-testid="placar-grupo"][data-desfecho="em_aberto"]')).toBeNull();
    expect(
      doc.querySelector('[data-desfecho="eleito_1t"] [data-testid="placar-siglas"]')?.textContent,
    ).toContain("Alagoas");
  });

  it("(c) a faixa tem 27 células decorativas, uma por UF, na ordem dos grupos", () => {
    const doc = parse(<GovernadoresPlacarTurno porUf={SIM.por_uf} base="projecao" />);
    const faixa = doc.querySelector("ol");
    expect(faixa?.getAttribute("aria-hidden")).toBe("true");
    const celulas = [...(faixa?.querySelectorAll("li") ?? [])].map((li) =>
      li.getAttribute("data-desfecho"),
    );
    expect(celulas).toHaveLength(27);
    expect(celulas.slice(0, 9).every((d) => d === "eleito_1t")).toBe(true);
    expect(celulas.slice(9, 26).every((d) => d === "segundo_turno")).toBe(true);
    expect(celulas[26]).toBe("em_aberto");
  });

  it("(d) a sigla é desenhada, o leitor de tela recebe o nome do estado", () => {
    const doc = parse(
      <GovernadoresPlacarTurno
        porUf={[row("SP", { vai_a_2t: false, bucket: "chamada" })]}
        base="projecao"
      />,
    );
    const item = doc.querySelector('[data-desfecho="eleito_1t"] [data-testid="placar-siglas"] li');
    expect(item?.getAttribute("title")).toBe("São Paulo");
    expect(item?.querySelector('[aria-hidden="true"]')?.textContent).toBe("SP");
    expect(item?.querySelector(".sr-only")?.textContent).toBe("São Paulo");
  });

  it("(e) projeção fala 'vence' (ADR-0075: nunca 'eleito' da projeção); contagem no condicional", () => {
    const porUf = [
      row("SP", {
        vai_a_2t: false,
        bucket: "chamada",
        top_candidatos: [
          { id: 1, pct: 55, partido: "PL", pct_atual: 56 },
          { id: 2, pct: 30, partido: "PT", pct_atual: 30 },
        ],
      }),
      row("RJ"),
    ];
    const proj = parse(<GovernadoresPlacarTurno porUf={porUf} base="projecao" />).body.textContent;
    const cont = parse(<GovernadoresPlacarTurno porUf={porUf} base="contagem" />).body.textContent;
    expect(proj).toContain("vence no 1º turno");
    expect(proj?.toLowerCase()).not.toContain("eleito");
    expect(proj).toContain("vai ao 2º turno");
    expect(cont).toContain("fecharia no 1º turno");
    expect(cont).toContain("iria ao 2º turno");
    expect(cont?.toLowerCase()).not.toContain("eleito");
    expect(cont).toContain("não resultado nem projeção");
  });

  it("(f) sem nenhuma UF com desfecho, NÃO imprime zeros — diz em texto que não há", () => {
    const doc = parse(<GovernadoresPlacarTurno porUf={[]} base="contagem" />);
    expect(doc.querySelector('[data-testid="placar-turno"]')?.hasAttribute("data-vazio")).toBe(
      true,
    );
    expect(doc.querySelectorAll('[data-testid="placar-numero"]')).toHaveLength(0);
    expect(doc.body.textContent).not.toMatch(/\d/);
    expect(doc.body.textContent).toContain("Nenhum estado tem votos apurados");
  });

  it("(g) contagem com `pct_atual` ausente: a UF fica aguardando, não em 2º turno", () => {
    const doc = parse(
      <GovernadoresPlacarTurno
        porUf={[
          row("SP"),
          row("RJ", {
            top_candidatos: [
              { id: 1, pct: 45, partido: "PL" },
              { id: 2, pct: 35, partido: "PT" },
            ],
          }),
        ]}
        base="contagem"
      />,
    );
    expect(numero(doc, "segundo_turno")).toBe("1");
    expect(numero(doc, "aguardando")).toBe("26");
    expect(
      doc.querySelector('[data-desfecho="aguardando"] [data-testid="placar-siglas"]')?.textContent,
    ).toContain("Rio de Janeiro");
  });

  it("(h) tinta neutra, cheio × listrado — nenhuma cor de partido nem verde/tijolo no CSS do placar", () => {
    const css = readFileSync(
      path.resolve(__dirname, "../../../components/blocks/GovernadoresPlacarTurno.module.css"),
      "utf8",
    );
    // Decisão do dono 27/09: o mesmo código das barras por partido — cheio =
    // 1º turno, listrado = 2º. Verde/tijolo colidia com PL/PT logo abaixo.
    expect(css).toMatch(/\.eleito_1t\s*\{\s*background:\s*var\(--text-primary\);/);
    expect(css).toMatch(/\.segundo_turno\s*\{\s*background:\s*repeating-linear-gradient\(/);
    expect(css).not.toMatch(/--party-|--color-cand-|--color-success|--color-warning/);
  });
});
