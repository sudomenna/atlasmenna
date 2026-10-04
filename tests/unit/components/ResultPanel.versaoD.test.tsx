// @vitest-environment happy-dom
/**
 * tests/unit/components/ResultPanel.versaoD.test.tsx
 *
 * A lista do `<ResultPanel>` na versão D (decisão do dono, 2026-09-27;
 * `docs/design-system/prototipos/apuracao-2026-09-27/README.md`): os dois
 * primeiros DA BASE em cartões, os demais num cartão único, selo em pílula.
 *
 * O que se mede aqui é o contrato do DOM (happy-dom não faz layout):
 *
 *   1. o selo por base — só em quem é top-2 DAQUELA base, sob `data-view-only`,
 *      nunca na anulada, nunca em 2º turno, nunca no Presidente por UF;
 *   2. "PARTIDO – nº" na medição e AUSENTE na identidade (fase pré, RF-161);
 *   3. a mecânica posicional da folha: cartão por `:nth-child`, nunca `order`,
 *      nunca `display: none` em linha de candidato — e uma marcação só por
 *      candidatura (não há "a linha" e "o cartão" duplicados no DOM).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResultPanel, type ResultPanelCandidate } from "@/components/blocks/ResultPanel";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function cand(
  id: number,
  nome: string,
  partido: string,
  pctAtual: number,
  pctProjetado: number,
  over: Partial<ResultPanelCandidate> = {},
): ResultPanelCandidate {
  return {
    id,
    nome,
    partido,
    cor: `var(--color-cand-${id})`,
    votos_atuais: Math.round(pctAtual * 10_000),
    pct_atual: pctAtual,
    pct_projetado: pctProjetado,
    ...over,
  };
}

/**
 *   parcial → Célia (45) · Bruno (30) · Ana (15) · Davi (10)
 *   proj    → Ana (38)   · Bruno (33) · Célia (20) · Davi (9)
 */
const CORRIDA: ResultPanelCandidate[] = [
  cand(13, "Ana Lima", "PT", 15, 38),
  cand(22, "Bruno Reis", "PL", 30, 33),
  cand(15, "Célia Mota", "MDB", 45, 20),
  cand(55, "Davi Nunes", "PSD", 10, 9),
];

const linhaDe = (doc: Document, nome: string) =>
  [...doc.querySelectorAll("li[data-ord]")].find((li) => li.textContent?.includes(nome));

function selosDe(doc: Document, nome: string, base: "parcial" | "proj"): string[] {
  return [
    ...(linhaDe(doc, nome)?.querySelectorAll(
      `[data-view-only="${base}"] > [data-testid="result-selo"], [data-view-only="${base}"] > [data-testid="result-vaga-marker"]`,
    ) ?? []),
  ].map((el) => el.textContent ?? "");
}

const todosOsSelos = (doc: Document) =>
  doc.querySelectorAll('[data-testid="result-selo"], [data-testid="result-vaga-marker"]');

describe("selo por base no DOM", () => {
  const doc = parse(
    <ResultPanel candidatos={CORRIDA} pctApurado={40} selo="turno" title="T" turno={1} />,
  );

  it("projeção: Ana e Bruno (top-2 da projeção) — e só eles", () => {
    expect(selosDe(doc, "Ana Lima", "proj")).toEqual(["2º turno · projeção"]);
    expect(selosDe(doc, "Bruno Reis", "proj")).toEqual(["2º turno · projeção"]);
    expect(selosDe(doc, "Célia Mota", "proj")).toEqual([]);
    expect(selosDe(doc, "Davi Nunes", "proj")).toEqual([]);
  });

  it("parcial: Célia e Bruno (top-2 da parcial) — e só eles", () => {
    expect(selosDe(doc, "Célia Mota", "parcial")).toEqual(["2º turno · na parcial"]);
    expect(selosDe(doc, "Bruno Reis", "parcial")).toEqual(["2º turno · na parcial"]);
    expect(selosDe(doc, "Ana Lima", "parcial")).toEqual([]);
    expect(selosDe(doc, "Davi Nunes", "parcial")).toEqual([]);
  });

  it("em cada base, exatamente 2 selos — nenhum fora de `data-view-only`", () => {
    for (const base of ["parcial", "proj"]) {
      expect(
        doc.querySelectorAll(`[data-view-only="${base}"] > [data-testid="result-selo"]`),
      ).toHaveLength(2);
    }
    for (const s of todosOsSelos(doc)) expect(s.closest("[data-view-only]")).not.toBeNull();
  });

  it("🔴 turno 2 ⇒ nenhum selo", () => {
    const t2 = parse(
      <ResultPanel
        candidatos={CORRIDA.slice(0, 2)}
        pctApurado={40}
        selo="turno"
        title="T"
        turno={2}
      />,
    );
    expect(todosOsSelos(t2)).toHaveLength(0);
  });

  it("🔴 sem `selo` e com uma vaga (Presidente por UF) ⇒ nenhum selo", () => {
    const uf = parse(<ResultPanel candidatos={CORRIDA} pctApurado={40} title="T" />);
    expect(todosOsSelos(uf)).toHaveLength(0);
    const explicito = parse(
      <ResultPanel candidatos={CORRIDA} pctApurado={40} selo="nenhum" title="T" turno={1} />,
    );
    expect(todosOsSelos(explicito)).toHaveLength(0);
  });

  it("🔴 anulada nunca tem selo — nem sendo a mais votada", () => {
    const comAnulada = [cand(99, "Zeca Anulado", "PP", 60, 60, { destino: "anulado" }), ...CORRIDA];
    const d = parse(
      <ResultPanel candidatos={comAnulada} pctApurado={40} selo="turno" title="T" turno={1} />,
    );
    expect(selosDe(d, "Zeca Anulado", "proj")).toEqual([]);
    expect(selosDe(d, "Zeca Anulado", "parcial")).toEqual([]);
    // E os selos vão para quem disputa.
    expect(selosDe(d, "Ana Lima", "proj")).toEqual(["2º turno · projeção"]);
    expect(selosDe(d, "Célia Mota", "parcial")).toEqual(["2º turno · na parcial"]);
  });

  it("🔴 anulada na posição 2 da lista (uma só disputa): continua sem selo", () => {
    // O caso em que a ordem NÃO protege: com uma candidatura só disputando,
    // o "top-2" cru da lista é ela + a anulada. Só a exclusão explícita da
    // regra impede o selo de cair na anulada.
    const d = parse(
      <ResultPanel
        candidatos={[
          cand(13, "Ana Lima", "PT", 40, 40),
          cand(99, "Zeca Anulado", "PP", 60, 60, { destino: "anulado" }),
        ]}
        pctApurado={40}
        selo="vaga"
        title="T"
        vagas={2}
      />,
    );
    expect(selosDe(d, "Zeca Anulado", "proj")).toEqual([]);
    expect(selosDe(d, "Zeca Anulado", "parcial")).toEqual([]);
    expect(selosDe(d, "Ana Lima", "proj")).toEqual(["Vaga projetada"]);
  });

  it("maioria na base: só o líder, com o texto do 1º turno", () => {
    const maioria = [cand(13, "Ana Lima", "PT", 48, 51), cand(22, "Bruno Reis", "PL", 40, 39)];
    const d = parse(
      <ResultPanel candidatos={maioria} pctApurado={40} selo="turno" title="T" turno={1} />,
    );
    expect(selosDe(d, "Ana Lima", "proj")).toEqual(["Vence no 1º turno · projeção"]);
    expect(selosDe(d, "Bruno Reis", "proj")).toEqual([]);
    expect(selosDe(d, "Ana Lima", "parcial")).toEqual(["2º turno · na parcial"]);
    expect(selosDe(d, "Bruno Reis", "parcial")).toEqual(["2º turno · na parcial"]);
  });
});

describe("'PARTIDO – nº' — o número na urna", () => {
  it("na medição, cada linha traz a sigla e o `id` (ADR-0042)", () => {
    const doc = parse(<ResultPanel candidatos={CORRIDA} pctApurado={40} title="T" />);
    expect(linhaDe(doc, "Ana Lima")?.textContent).toContain("PT – 13");
    expect(linhaDe(doc, "Davi Nunes")?.textContent).toContain("PSD – 55");
  });

  it("🔴 na identidade (fase pré, RF-161) NÃO aparece — e a variante não mudou", () => {
    const zerados = CORRIDA.map((c) => ({ ...c, pct_atual: 0, pct_projetado: 0, votos_atuais: 0 }));
    const doc = parse(
      <ResultPanel candidatos={zerados} pctApurado={0} title="T" variant="identidade" />,
    );
    expect(doc.body.textContent).not.toContain("–");
    expect(doc.body.textContent).not.toContain("13");
    expect(doc.querySelectorAll('[data-testid="candidatura-identidade-row"]')).toHaveLength(4);
    expect(doc.querySelector('[data-testid="candidate-result-row"]')).toBeNull();
    expect(todosOsSelos(doc)).toHaveLength(0);
  });
});

describe("mecânica posicional da versão D", () => {
  const CSS = readFileSync(
    path.join(process.cwd(), "components", "atoms", "tables", "CandidateResultRow.module.css"),
    "utf-8",
  ).replace(/\s+/g, " ");

  it("UMA marcação por candidatura: 4 candidaturas, 4 linhas, 4 nomes", () => {
    const doc = parse(<ResultPanel candidatos={CORRIDA} pctApurado={40} title="T" />);
    expect(doc.querySelectorAll("li[data-ord]")).toHaveLength(4);
    expect(doc.querySelectorAll('[data-testid="candidate-result-row"]')).toHaveLength(4);
    expect(doc.querySelectorAll('[data-testid="candidate-result-name"]')).toHaveLength(4);
  });

  it("cartão = os dois primeiros filhos; linha = do 3º em diante", () => {
    expect(CSS).toContain(".lista > li:nth-child(-n + 2) {");
    expect(CSS).toContain(".lista > li:nth-child(n + 3) {");
    expect(CSS).toContain(".lista > li:nth-child(-n + 2) > .linha {");
  });

  it("🔴 nenhum `order` e nenhum `display: none` em linha de candidato", () => {
    // `order` move pixel sem mover documento (WCAG SC 1.3.2) e compõe com a
    // reordenação no DOM. `display: none` em `<li>` tiraria o candidato da
    // árvore de acessibilidade (ADR-0017 / D21).
    expect(CSS).not.toMatch(/(^|[;{\s])order\s*:/);
    const regrasDeLi = [...CSS.matchAll(/([^{}]*li[^{}]*)\{([^}]*)\}/g)];
    for (const [, seletor, corpo] of regrasDeLi) {
      // As únicas regras com `display: none` alcançam o selo e o " apurados",
      // descendentes da linha — nunca a linha nem o `<li>`.
      if (/display:\s*none/.test(corpo ?? "")) {
        expect(seletor).toMatch(/\.(selo|apurados)\s*$/);
      }
    }
  });

  it("🔴 o fundo do cartão único é POR LINHA — nenhum pseudo-elemento com fundo", () => {
    // Portão de a11y (2026-09-27): um `::before` com fundo atrás da lista faz o
    // axe mandar TODO o texto por cima dele para `results.incomplete`
    // (`pseudoContent`), e `tests/e2e/a11y-audit.spec.ts` reprova esse balde.
    const semComentarios = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(semComentarios).not.toMatch(/::?(before|after)/);
    expect(CSS).toMatch(
      /\.lista > li:nth-child\(n \+ 3\) \{[^}]*background: var\(--surface-card\)/,
    );
  });

  it("🔴 o último VISÍVEL fecha o cartão: aberta, recolhida por base, e com anulada", () => {
    // Aberta (e com anulada, que nunca recolhe e fica no fim): `:last-child`.
    expect(CSS).toContain(".lista > li:nth-child(n + 3):last-child,");
    // Recolhida sem anulada: quem vem antes da 1ª excedente DA BASE ATIVA.
    for (const base of ["proj", "parcial"]) {
      expect(CSS).toContain(
        `:root[data-view="${base}"] .lista[data-collapsed="true"]:not(:has(> [data-anulado])) > li:nth-child(n + 3):has(+ [data-extra-row~="${base}"])`,
      );
    }
    // E o DOM entrega os ganchos que a folha lê.
    const comAnulada = [...CORRIDA, cand(99, "Zeca Anulado", "PP", 1, 1, { destino: "anulado" })];
    const d = parse(<ResultPanel candidatos={comAnulada} pctApurado={40} title="T" />);
    expect(linhaDe(d, "Zeca Anulado")?.hasAttribute("data-anulado")).toBe(true);
    expect(d.querySelectorAll("li[data-anulado]")).toHaveLength(1);
  });

  it("as folgas do cartão único moram na `.linha`, nunca no padding vertical do `<li>`", () => {
    // `<li>` recolhido é `height: 0`: padding vertical nele não encolhe e
    // sobraria como faixa solta de fundo abaixo do cartão.
    const semComentarios = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    // Regras cujo ALVO é o próprio `<li>` das linhas (não um descendente, e
    // não os dois cartões, que nunca recolhem).
    const regras = [...semComentarios.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) =>
      (sel ?? "").split(",").some((s) => /> li[^\s>]*\s*$/.test(s.trim()) && !s.includes("-n + 2")),
    );
    expect(regras.length).toBeGreaterThan(0);
    for (const [, sel, corpo] of regras) {
      expect(corpo, sel).not.toMatch(/padding-(top|bottom)\s*:/);
      const padding = corpo
        ?.match(/padding:\s*([^;]+);/)?.[1]
        ?.trim()
        .split(/\s+/);
      if (padding) expect(padding[0], sel).toBe("0");
    }
  });
});

describe("🔴 votos projetados na lista do painel (decisão do dono, 2026-10-03)", () => {
  it("cada linha mostra o `votos_projetados` DELA na Projeção; sem o campo, a linha de sempre", () => {
    // Números distantes por candidatura — trocar uma pela outra (ou pelo
    // apurado) muda o texto. Davi fica SEM o campo: nada projetado nele.
    const corrida = [
      cand(13, "Ana Lima", "PT", 15, 38, { votos_projetados: 3_812_000 }),
      cand(22, "Bruno Reis", "PL", 30, 33, { votos_projetados: 2_450_000 }),
      cand(15, "Célia Mota", "MDB", 45, 20, { votos_projetados: 172_418 }),
      cand(55, "Davi Nunes", "PSD", 10, 9),
    ];
    const doc = parse(
      <ResultPanel candidatos={corrida} pctApurado={40} selo="turno" title="T" turno={1} />,
    );
    const vp = (nome: string) =>
      linhaDe(doc, nome)?.querySelector('[data-testid="votos-projetados"]')?.textContent ?? null;
    expect(vp("Ana Lima")).toBe("≈ aproximadamente 3,8 mi votos projetados");
    expect(vp("Bruno Reis")).toBe("≈ aproximadamente 2,5 mi votos projetados");
    expect(vp("Célia Mota")).toBe("≈ aproximadamente 172 mil votos projetados");
    expect(vp("Davi Nunes")).toBeNull();
    // A Parcial segue com o apurado (Célia: 45 × 10.000).
    expect(
      linhaDe(doc, "Célia Mota")?.querySelector('[data-view-only="parcial"] [class*="apurados"]')
        ?.parentElement?.textContent,
    ).toBe("450.000 votos apurados");
  });
});
