// @vitest-environment happy-dom
/**
 * tests/unit/components/GovernorCard.duasBases.test.tsx — o cartão de UF das
 * capas `/governador` e `/senador` nas DUAS bases da chave "Parcial /
 * Projeção" (decisão do dono, 04/10/2026).
 *
 * O que cada caso mede:
 *   - sem `duasBases`, o cartão é o de antes (a home de Presidente);
 *   - com `duasBases`, a lista da projeção é BYTE A BYTE a lista de antes;
 *   - a lista da Parcial tem `pct_atual`, na ordem do apurado, "—" quando não
 *     medido (nunca 0), e o selo da MESMA base;
 *   - a cor dos números: a da Parcial é `--color-pct-votos` (CSS module).
 *
 * Toda fixture tem a ordem do APURADO diferente da da PROJEÇÃO — senão um
 * cartão que lesse `pct` nas duas listas passaria.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GovernorCard } from "@/components/blocks/GovernorCard";
import type { EdgeUfRow } from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

/** SP 62%: projeção Ana (PT) > Bruno (PL) > Célia (MDB) > Davi (PSD); apurado Célia > Ana > Davi > Bruno. */
function uf(over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla: "SP",
    pct_apurado: 62,
    lider: 1,
    margem_atual: 5,
    margem_projetada: 5,
    margem_projetada_ci: [3, 7],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: [
      { id: 1, pct: 40, pct_atual: 35, nome: "Ana Lima", partido: "PT" },
      { id: 2, pct: 30, pct_atual: 12, nome: "Bruno Reis", partido: "PL" },
      { id: 3, pct: 20, pct_atual: 36, nome: "Célia Mota", partido: "MDB" },
      { id: 4, pct: 6, pct_atual: 13, nome: "Davi Rios", partido: "PSD" },
    ],
    outros: { pct: 4, pct_atual: 4, n_candidatos: 3 },
    vai_a_2t: true,
    bucket: "vai_2t",
    ...over,
  };
}

const linhas = (el: Element | null | undefined) =>
  [...(el?.querySelectorAll("li") ?? [])].map((li) =>
    (li.textContent ?? "").replace(/\s+/g, " ").trim(),
  );

const lista = (doc: Document, base: "proj" | "parcial") =>
  doc.querySelector(`article > [data-view-only="${base}"] > ul`);

describe("<GovernorCard duasBases> — governador", () => {
  it("sem `duasBases` o cartão é o de antes: uma lista, sem `data-view-only`", () => {
    const doc = parse(<GovernorCard uf={uf()} candidatos={[]} />);
    expect(doc.querySelector("[data-view-only]")).toBeNull();
    expect(doc.querySelectorAll("article > ul")).toHaveLength(1);
    expect(doc.querySelector("article")?.getAttribute("aria-label")).toBe(
      "São Paulo, 2º turno pela projeção: Ana Lima (PT) com 40% e Bruno Reis (PL) com 30%, líder: Ana Lima (PT) com 40%, 62% apurado",
    );
  });

  it("🔴 a lista da Projeção é BYTE A BYTE a de antes", () => {
    const antes = parse(<GovernorCard uf={uf()} candidatos={[]} />).querySelector("article > ul");
    const depois = lista(parse(<GovernorCard uf={uf()} candidatos={[]} duasBases />), "proj");
    expect(depois?.innerHTML).toBe(antes?.innerHTML);
  });

  it("🔴 a Parcial ordena pelo APURADO e mostra `pct_atual`", () => {
    const doc = parse(<GovernorCard uf={uf()} candidatos={[]} duasBases />);
    expect(linhas(lista(doc, "proj"))).toEqual([
      expect.stringMatching(/^1° ?Ana Lima ?PT.*40%$/),
      expect.stringMatching(/^2° ?Bruno Reis ?PL.*30%$/),
      expect.stringMatching(/^3° ?Célia Mota ?MDB.*20%$/),
      expect.stringMatching(/^4° ?Davi Rios ?PSD.*6%$/),
      expect.stringMatching(/^Outros.*4%$/),
    ]);
    expect(linhas(lista(doc, "parcial"))).toEqual([
      expect.stringMatching(/^1° ?Célia Mota ?MDB.*36%$/),
      expect.stringMatching(/^2° ?Ana Lima ?PT.*35%$/),
      expect.stringMatching(/^3° ?Davi Rios ?PSD.*13%$/),
      expect.stringMatching(/^4° ?Bruno Reis ?PL.*12%$/),
      expect.stringMatching(/^Outros.*4%$/),
    ]);
  });

  it("o selo da Parcial é o da CONTAGEM, nos 2 primeiros do apurado — nunca 'eleito'", () => {
    const doc = parse(<GovernorCard uf={uf()} candidatos={[]} duasBases />);
    // Projeção: "2º turno · projeção" nos dois primeiros da projeção.
    const proj = linhas(lista(doc, "proj"));
    expect(proj[0]).toContain("2º turno · projeção");
    expect(proj[1]).toContain("2º turno · projeção");
    expect(proj.slice(2).join(" ")).not.toContain("2º turno");
    // Parcial: Célia lidera com 36% (< 50) ⇒ "2º turno · na parcial" em Célia e Ana.
    const parcial = linhas(lista(doc, "parcial"));
    expect(parcial[0]).toMatch(/Célia Mota.*2º turno · na parcial/);
    expect(parcial[1]).toMatch(/Ana Lima.*2º turno · na parcial/);
    expect(parcial.slice(2).join(" ")).not.toMatch(/turno/);
    expect(lista(doc, "parcial")?.textContent).not.toMatch(/eleito|projeção/i);

    const maioria = uf({
      top_candidatos: [
        { id: 1, pct: 48, pct_atual: 30, nome: "Ana Lima", partido: "PT" },
        { id: 3, pct: 40, pct_atual: 55, nome: "Célia Mota", partido: "MDB" },
      ],
    });
    const doc2 = parse(<GovernorCard uf={maioria} candidatos={[]} duasBases />);
    expect(linhas(lista(doc2, "parcial"))[0]).toMatch(
      /Célia Mota.*Venceria no 1º turno · na parcial/,
    );
    expect(lista(doc2, "parcial")?.textContent).not.toMatch(/eleito/i);
  });

  it("🔴 sem apurado: a Parcial cai INTEIRA na ordem da projeção, com '—' — nunca 0", () => {
    const zero = uf({
      pct_apurado: 0,
      top_candidatos: uf().top_candidatos.map(({ pct_atual: _, ...t }) => t),
      outros: { pct: 4, n_candidatos: 3 },
    });
    const doc = parse(<GovernorCard uf={zero} candidatos={[]} duasBases />);
    const parcial = linhas(lista(doc, "parcial"));
    expect(
      parcial.map((l) =>
        l
          .replace(/^\d° ?/, "")
          .split(/[A-Z]{2,}/)[0]
          ?.trim(),
      ),
    ).toEqual(["Ana Lima", "Bruno Reis", "Célia Mota", "Davi Rios", "Outros—"]);
    for (const l of parcial) expect(l).toMatch(/—$/);
    expect(lista(doc, "parcial")?.textContent).not.toMatch(/\d%/);
    // Nenhum selo de contagem sem contagem.
    expect(lista(doc, "parcial")?.querySelector("b")).toBeNull();
    // Rótulo sem a repetição "Na parcial, na parcial: …" (auditoria a11y 04/10).
    expect(lista(doc, "parcial")?.getAttribute("aria-label")).toBe(
      "Na parcial, aguardando apuração",
    );
  });

  it("'Outros' da Parcial é `outros.pct_atual`; ausente ⇒ '—'", () => {
    const semAtual = uf({ outros: { pct: 4, n_candidatos: 3 } });
    const doc = parse(<GovernorCard uf={semAtual} candidatos={[]} duasBases />);
    expect(linhas(lista(doc, "parcial")).at(-1)).toMatch(/^Outros ?—$/);
    expect(linhas(lista(doc, "proj")).at(-1)).toMatch(/^Outros.*4%$/);
  });

  it("a11y: o `<article>` diz UF e apurado; cada lista se descreve na sua base", () => {
    const doc = parse(<GovernorCard uf={uf()} candidatos={[]} duasBases />);
    expect(doc.querySelector("article")?.getAttribute("aria-label")).toBe("São Paulo, 62% apurado");
    expect(lista(doc, "proj")?.getAttribute("aria-label")).toBe(
      "Pela projeção, 2º turno pela projeção: Ana Lima (PT) com 40% e Bruno Reis (PL) com 30%, líder: Ana Lima (PT) com 40%",
    );
    expect(lista(doc, "parcial")?.getAttribute("aria-label")).toBe(
      "Na parcial, se a apuração parasse agora: 2º turno na parcial: Célia Mota (MDB) com 36% e Ana Lima (PT) com 35%, na frente: Célia Mota (MDB) com 36%",
    );
    // Um cabeçalho só — o título não é duplicado.
    expect(doc.querySelectorAll("h3")).toHaveLength(1);
  });
});

describe("<GovernorCard cargo='sen' duasBases> — Senado", () => {
  it("🔴 Projeção: 'Vaga projetada' nos 2 da projeção; Parcial: 'Vaga na parcial' nos 2 do apurado — nunca 'eleito'", () => {
    const doc = parse(<GovernorCard uf={uf()} candidatos={[]} cargo="sen" duasBases />);
    const proj = linhas(lista(doc, "proj"));
    expect(proj[0]).toMatch(/Ana Lima.*Vaga projetada/);
    expect(proj[1]).toMatch(/Bruno Reis.*Vaga projetada/);
    expect(proj.slice(2).join(" ")).not.toContain("Vaga");
    const parcial = linhas(lista(doc, "parcial"));
    expect(parcial[0]).toMatch(/Célia Mota.*Vaga na parcial/);
    expect(parcial[1]).toMatch(/Ana Lima.*Vaga na parcial/);
    expect(parcial.slice(2).join(" ")).not.toContain("Vaga");
    expect(doc.querySelector("article")?.textContent).not.toMatch(/eleito/i);
    expect(doc.querySelectorAll("b[data-s='e']")).toHaveLength(0);
    // Selo neutro na Parcial: verde (`e`) é a cor de "eleito".
    expect(lista(doc, "parcial")?.querySelectorAll("b[data-s='e']")).toHaveLength(0);
    expect(lista(doc, "parcial")?.querySelectorAll("b[data-s='a']")).toHaveLength(2);
  });

  it("UF sem contagem demonstrável ⇒ nenhum selo na Parcial (a lista continua)", () => {
    // Anulada no corte + cauda maior que o 2º que disputa: o 2º não é provável.
    const duvida = uf({
      top_candidatos: [
        { id: 1, pct: 40, pct_atual: 35, nome: "Ana Lima", partido: "PT" },
        { id: 2, pct: 30, pct_atual: 30, nome: "Bruno Reis", partido: "PL", destino: "anulado" },
        { id: 3, pct: 20, pct_atual: 10, nome: "Célia Mota", partido: "MDB" },
      ],
      outros: { pct: 10, pct_atual: 25, n_candidatos: 4 },
    });
    const doc = parse(<GovernorCard uf={duvida} candidatos={[]} cargo="sen" duasBases />);
    expect(lista(doc, "parcial")?.querySelector("b")).toBeNull();
    expect(lista(doc, "parcial")?.getAttribute("aria-label")).toBe("Na parcial");
  });
});

describe("GovernorCard.module.css — a cor dos números por base", () => {
  const css = readFileSync(
    resolve(__dirname, "../../../components/blocks/GovernorCard.module.css"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");

  it("Projeção: `--color-pct-proj`; Parcial: `--color-pct-votos`, mais específica", () => {
    expect(css).toContain(".c li > span:nth-child(4) {");
    expect(css).toMatch(/\.c li > span:nth-child\(4\) \{[^}]*color: var\(--color-pct-proj\)/);
    expect(css).toMatch(
      /\.c \[data-view-only="parcial"\] li > span:nth-child\(4\) \{ color: var\(--color-pct-votos\); \}/,
    );
  });
});
