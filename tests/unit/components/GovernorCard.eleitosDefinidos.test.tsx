// @vitest-environment happy-dom
/**
 * tests/unit/components/GovernorCard.eleitosDefinidos.test.tsx
 *
 * 🔴 2026-10-04 (dono, auditoria constitucional P1/P8) — o cartão de UF das
 * capas (`/governador`, `/senador`, home de Presidente) só diz "eleito" para
 * quem está MATEMATICAMENTE eleito (`EdgeUfRow.eleitos_definidos`, pelo ponto
 * único `definicaoDaUf`). Até esta data o Senado dizia "● ELEITO" nos dois
 * ocupantes de vaga PROJETADOS assim que havia 1 voto apurado, e o Governador
 * dizia "● ELEITO" quando a projeção dava maioria (`classificarProjecao`).
 *
 * Fora da marca de eleito, cada lista leva o selo DA SUA BASE, com os textos
 * de `lib/utils/selo-resultado.ts`.
 *
 * Fixture com as duas ordens DIFERENTES: projeção Ana > Bruno > Célia;
 * apurado Célia > Ana > Bruno.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GovernorCard } from "@/components/blocks/GovernorCard";
import type { EdgeUfRow } from "@/lib/edge-config/types";

const ANA = 1;
const BRUNO = 2;
const CELIA = 3;

function uf(over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla: "MT",
    pct_apurado: 27,
    lider: ANA,
    margem_atual: 5,
    margem_projetada: 15,
    margem_projetada_ci: [10, 20],
    chamada: true,
    swing_vs_2022: null,
    top_candidatos: [
      { id: ANA, pct: 40, pct_atual: 35, nome: "Ana Lima", partido: "PT" },
      { id: BRUNO, pct: 30, pct_atual: 20, nome: "Bruno Reis", partido: "PL" },
      { id: CELIA, pct: 20, pct_atual: 36, nome: "Célia Mota", partido: "MDB" },
      { id: 4, pct: 6, pct_atual: 5, nome: "Davi Rios", partido: "PSD" },
    ],
    vai_a_2t: true,
    bucket: "chamada",
    ...over,
  };
}

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

/** nome → texto do selo, numa lista (`proj`/`parcial`) ou na lista única. */
function selos(doc: Document, base?: "proj" | "parcial"): Record<string, string> {
  const raiz = base ? doc.querySelector(`article > [data-view-only="${base}"]`) : doc;
  const out: Record<string, string> = {};
  for (const li of raiz?.querySelectorAll("li") ?? []) {
    const b = li.querySelector("b");
    const nome = li.querySelector("span:nth-child(2)")?.firstChild?.textContent ?? "";
    if (b) out[nome] = b.textContent ?? "";
  }
  return out;
}

const verdes = (doc: Document) => doc.querySelectorAll("b[data-s='e']").length;
const atribuicao = (doc: Document) =>
  doc.querySelector("[data-testid='governor-card-atribuicao']")?.textContent ?? null;

describe("Senado — sem eleitos_definidos, a projeção não elege", () => {
  it("🔴 pct_apurado > 0 e sem campo ⇒ nenhum 'eleito'; 'Vaga projetada' / 'Vaga na parcial' por lista [mutação: voltar `chipSenado` pela projeção]", () => {
    const doc = parse(<GovernorCard uf={uf()} candidatos={[]} cargo="sen" duasBases />);
    expect(selos(doc, "proj")).toEqual({
      "Ana Lima": "Vaga projetada",
      "Bruno Reis": "Vaga projetada",
    });
    expect(selos(doc, "parcial")).toEqual({
      "Célia Mota": "Vaga na parcial",
      "Ana Lima": "Vaga na parcial",
    });
    expect(doc.body.textContent).not.toMatch(/eleit/i);
    expect(verdes(doc)).toBe(0);
    expect(atribuicao(doc)).toBeNull();
    for (const ul of doc.querySelectorAll("ul")) {
      expect(ul.getAttribute("aria-label") ?? "").not.toMatch(/eleit/i);
    }
  });

  it("lista única (sem duasBases) — o mesmo: 'Vaga projetada', nunca 'eleito'", () => {
    const doc = parse(<GovernorCard uf={uf()} candidatos={[]} cargo="sen" />);
    expect(selos(doc)).toEqual({ "Ana Lima": "Vaga projetada", "Bruno Reis": "Vaga projetada" });
    expect(doc.body.textContent).not.toMatch(/eleit/i);
    expect(doc.querySelector("article")?.getAttribute("aria-label")).not.toMatch(/eleit/i);
  });
});

describe("Senado — com eleitos_definidos", () => {
  it("🔴 1 eleito (Célia, 3ª na projeção): marca NELA nas duas listas; a outra vaga segue com o selo da base; atribuição", () => {
    const doc = parse(
      <GovernorCard
        uf={uf({ eleitos_definidos: [CELIA] })}
        candidatos={[]}
        cargo="sen"
        duasBases
      />,
    );
    // Projeção: Célia eleita (pelo id, fora do top-2 projetado) + UMA vaga
    // projetada — nunca três marcas para duas cadeiras.
    expect(selos(doc, "proj")).toEqual({
      "Ana Lima": "Vaga projetada",
      "Célia Mota": "Matematicamente eleito",
    });
    expect(selos(doc, "parcial")).toEqual({
      "Célia Mota": "Matematicamente eleito",
      "Ana Lima": "Vaga na parcial",
    });
    expect(verdes(doc)).toBe(2); // Célia, uma vez em cada lista
    for (const b of doc.querySelectorAll("b[data-s='e']")) {
      expect(b.closest("li")?.textContent).toContain("Célia Mota");
    }
    expect(atribuicao(doc)).toBe("Cálculo do AtlasMenna sobre a contagem do TSE");
    expect(
      doc.querySelector("article > [data-view-only='proj'] > ul")?.getAttribute("aria-label"),
    ).toContain("matematicamente eleito: Célia Mota (MDB)");
  });

  it("2 eleitos: os dois marcados, nenhuma pílula de vaga", () => {
    const doc = parse(
      <GovernorCard uf={uf({ eleitos_definidos: [ANA, CELIA] })} candidatos={[]} cargo="sen" />,
    );
    expect(selos(doc)).toEqual({
      "Ana Lima": "Matematicamente eleito",
      "Célia Mota": "Matematicamente eleito",
    });
    expect(atribuicao(doc)).toBe("Cálculo do AtlasMenna sobre a contagem do TSE");
  });
});

describe("Governador", () => {
  const maioria = (over: Partial<EdgeUfRow> = {}) =>
    uf({
      top_candidatos: [
        { id: ANA, pct: 55, pct_atual: 40, nome: "Ana Lima", partido: "PT" },
        { id: BRUNO, pct: 30, pct_atual: 45, nome: "Bruno Reis", partido: "PL" },
      ],
      vai_a_2t: false,
      bucket: "decidido_1t",
      ...over,
    });

  it("🔴 `eleito_1t` projetado SEM definido ⇒ 'Vence no 1º turno · projeção', sem verde, sem 'eleito'", () => {
    const doc = parse(<GovernorCard uf={maioria()} candidatos={[]} duasBases />);
    expect(selos(doc, "proj")).toEqual({ "Ana Lima": "Vence no 1º turno · projeção" });
    expect(selos(doc, "parcial")).toEqual({
      "Bruno Reis": "2º turno · na parcial",
      "Ana Lima": "2º turno · na parcial",
    });
    expect(verdes(doc)).toBe(0);
    expect(doc.body.textContent).not.toMatch(/eleit/i);
    expect(atribuicao(doc)).toBeNull();
  });

  it("com eleitos_definidos (aviso do TSE) ⇒ 'Matematicamente eleito' no id, nenhum outro selo, sem atribuição", () => {
    const doc = parse(
      <GovernorCard uf={maioria({ eleitos_definidos: [ANA] })} candidatos={[]} duasBases />,
    );
    expect(selos(doc, "proj")).toEqual({ "Ana Lima": "Matematicamente eleito" });
    expect(selos(doc, "parcial")).toEqual({ "Ana Lima": "Matematicamente eleito" });
    expect(atribuicao(doc)).toBeNull();
  });
});

describe("Presidente por UF", () => {
  it("sem definido ⇒ nenhum selo (ADR-0055)", () => {
    const doc = parse(<GovernorCard uf={uf()} candidatos={[]} cargo="pres" duasBases />);
    expect(doc.querySelector("li b")).toBeNull();
  });

  it("país definido ⇒ 'No país: matematicamente eleito' no id, nas duas listas; sem atribuição", () => {
    const doc = parse(
      <GovernorCard
        uf={uf({ eleitos_definidos: [BRUNO] })}
        candidatos={[]}
        cargo="pres"
        duasBases
      />,
    );
    expect(selos(doc, "proj")).toEqual({ "Bruno Reis": "No país: matematicamente eleito" });
    expect(selos(doc, "parcial")).toEqual({ "Bruno Reis": "No país: matematicamente eleito" });
    expect(atribuicao(doc)).toBeNull();
  });
});
