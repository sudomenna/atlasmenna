// @vitest-environment happy-dom
/**
 * tests/unit/components/ResultPanel.test.tsx
 *
 * O painel de resultado do protótipo do kit (`App.jsx:20-43`), traduzido em
 * `components/blocks/ResultPanel.tsx`.
 *
 * O invariante que este arquivo existe para proteger é **um só**: o colapso da
 * lista é visual, e nenhum candidato sai do DOM em nenhum estado do botão.
 * Um teste que só contasse linhas visíveis passaria numa implementação com
 * `rows.slice(0, limit)` — que é exatamente a do kit, e exatamente o que os
 * ADRs 0017 / 0029 § 7 / 0033 § 2 rejeitam.
 *
 * O resto cobre a aritmética das três derivações de UI (`counted`, `total`,
 * margem) — nenhuma delas vem pronta do payload, e todas aparecem na tela como
 * se fossem dado, então erram em silêncio se ninguém medir.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResultPanel } from "@/components/blocks/ResultPanel";
import type { EdgeCandidate } from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function cand(over: Partial<EdgeCandidate> & { id: number; rank: number }): EdgeCandidate {
  return {
    nome: `Candidato ${over.rank}`,
    partido: "PT",
    cor: `var(--color-cand-${over.rank})`,
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: 0,
    pct_projetado: 0,
    pct_projetado_lower: 0,
    pct_projetado_upper: 0,
    p_vitoria: 0,
    p_passa_2t: 0,
    p_fecha_1t: 0,
    ...over,
  };
}

/** Os mesmos números do fixture nacional 1T, arredondados para conta redonda. */
const ONZE: EdgeCandidate[] = [
  cand({
    id: 1,
    rank: 1,
    nome: "Ana Lima",
    partido: "PT",
    votos_atuais: 15_240_321,
    pct_atual: 43.5,
    pct_projetado: 43.2,
  }),
  cand({
    id: 2,
    rank: 2,
    nome: "Bruno Sá",
    partido: "PL",
    votos_atuais: 13_400_000,
    pct_atual: 38.2,
    pct_projetado: 38.0,
  }),
  cand({
    id: 3,
    rank: 3,
    nome: "Célia Rocha",
    partido: "MDB",
    votos_atuais: 1_580_000,
    pct_atual: 4.5,
    pct_projetado: 4.5,
  }),
  cand({
    id: 4,
    rank: 4,
    nome: "Davi Nunes",
    partido: "PDT",
    votos_atuais: 1_050_000,
    pct_atual: 3.0,
    pct_projetado: 3.0,
  }),
  cand({
    id: 5,
    rank: 5,
    nome: "Elza Mota",
    partido: "UNIÃO",
    votos_atuais: 700_000,
    pct_atual: 2.0,
    pct_projetado: 2.0,
  }),
  cand({
    id: 6,
    rank: 6,
    nome: "Fábio Reis",
    partido: "NOVO",
    votos_atuais: 525_000,
    pct_atual: 1.5,
    pct_projetado: 1.5,
  }),
  cand({
    id: 7,
    rank: 7,
    nome: "Gilda Paz",
    partido: "PTB",
    votos_atuais: 350_000,
    pct_atual: 1.0,
    pct_projetado: 1.0,
  }),
  cand({
    id: 8,
    rank: 8,
    nome: "Hugo Braga",
    partido: "UP",
    votos_atuais: 280_000,
    pct_atual: 0.8,
    pct_projetado: 0.8,
  }),
  cand({
    id: 9,
    rank: 9,
    nome: "Ivo Cardoso",
    partido: "PCB",
    votos_atuais: 175_000,
    pct_atual: 0.5,
    pct_projetado: 0.5,
  }),
  cand({
    id: 10,
    rank: 10,
    nome: "Joana Dias",
    partido: "PSTU",
    votos_atuais: 105_000,
    pct_atual: 0.3,
    pct_projetado: 0.3,
  }),
  cand({
    id: 11,
    rank: 11,
    nome: "Kaio Freire",
    partido: "DC",
    votos_atuais: 70_000,
    pct_atual: 0.2,
    pct_projetado: 0.2,
  }),
];

function render(over: Partial<React.ComponentProps<typeof ResultPanel>> = {}) {
  return (
    <ResultPanel
      candidatos={ONZE}
      kicker="Projeção Atlas Menna · não oficial"
      pctApurado={23.4}
      title="Resultado parcial"
      titleId="resultado-heading"
      {...over}
    />
  );
}

describe("<ResultPanel />", () => {
  it("(a) o colapso é visual: TODOS os candidatos ficam no DOM (ADR-0017 / D21)", () => {
    const doc = parse(render());
    const linhas = [...doc.querySelectorAll('[data-testid="candidate-result-row"]')];

    expect(linhas).toHaveLength(ONZE.length);
    for (const c of ONZE) {
      expect(doc.body.textContent).toContain(c.nome);
    }
  });

  it("(b) nenhum candidato é removido da árvore de acessibilidade", () => {
    const doc = parse(render());

    // As três formas de sumir que os ADRs proíbem por nome.
    expect(doc.querySelector("details")).toBeNull();
    expect(doc.querySelector("[hidden]")).toBeNull();
    expect(
      doc.querySelector("[aria-hidden='true'] [data-testid='candidate-result-row']"),
    ).toBeNull();
    expect(renderToStaticMarkup(render())).not.toMatch(/display\s*:\s*none/);

    // As excedentes são marcadas — quem as clipa é a cascata de
    // `app/globals.css` (`height: 0; overflow: hidden`), que preserva o layout
    // do conteúdo e portanto a exposição a leitor de tela.
    //
    // A marca passou a ser POR BASE em 2026-09-20 (antes era uma classe do
    // módulo): em cada base o colapso clipa `total - limit` linhas, mas QUAIS
    // linhas depende da ordem daquela base. Contar `[data-extra-row]` sem
    // qualificar a base voltaria a passar com o clip preso a uma ordem só.
    for (const base of ["parcial", "proj"]) {
      const extras = [...doc.querySelectorAll(`[data-extra-row~="${base}"]`)];
      expect(extras).toHaveLength(ONZE.length - 6);
      for (const li of extras) {
        expect(li.getAttribute("style") ?? "").not.toMatch(/display/);
      }
    }
  });

  it("(c) o botão de colapso existe, é honesto e aponta para a lista", () => {
    const doc = parse(render());
    const botao = doc.querySelector('[data-testid="button"]');

    expect(botao?.textContent).toContain("Todos os 11 candidatos");
    // SSR: fechado. `aria-expanded` só é verdade quando o estado muda no
    // cliente — o que importa aqui é que o atributo existe e nasce coerente.
    expect(botao?.getAttribute("aria-expanded")).toBe("false");
    const alvo = botao?.getAttribute("aria-controls");
    expect(alvo).toBeTruthy();
    expect(doc.getElementById(alvo as string)?.tagName).toBe("OL");
    expect(doc.getElementById(alvo as string)?.getAttribute("data-collapsed")).toBe("true");
  });

  it("(d) com 6 candidatos ou menos não há botão — um controle sem função", () => {
    const doc = parse(render({ candidatos: ONZE.slice(0, 5) }));
    expect(doc.querySelector('[data-testid="button"]')).toBeNull();
    expect(doc.querySelectorAll('[data-testid="candidate-result-row"]')).toHaveLength(5);
  });

  it("(e) DERIVAÇÃO — `counted` soma os votos e `total` é counted ÷ %apurado", () => {
    const doc = parse(render());
    // Σ votos_atuais = 33.475.321 → "33,5 mi"; ÷ 0,234 = 143.056.928 → "143,1 mi".
    expect(doc.body.textContent).toContain("33,5 mi de 143,1 mi votos válidos");
  });

  it("(e2) sem apuração não há razão possível — a nota não imprime divisão por zero", () => {
    const doc = parse(render({ pctApurado: 0 }));
    const texto = doc.body.textContent ?? "";
    expect(texto).toContain("votos válidos apurados");
    expect(texto).not.toContain("NaN");
    expect(texto).not.toContain("Infinity");
  });

  it("(f) DERIVAÇÃO — margem = 1º − 2º, nas duas bases, cada uma com a outra na nota", () => {
    const doc = parse(render());

    const parcial = doc.querySelector('[data-testid="result-margem-parcial"]');
    const proj = doc.querySelector('[data-testid="result-margem-proj"]');

    // 43,5 − 38,2 = 5,3 pp (parcial); 43,2 − 38,0 = 5,2 pp (projeção).
    expect(parcial?.textContent).toContain("Margem Ana");
    expect(parcial?.textContent).toContain("+5,3");
    expect(parcial?.textContent).toContain("projeção +5,2 pp");

    expect(proj?.textContent).toContain("+5,2");
    expect(proj?.textContent).toContain("parcial +5,3 pp");
  });

  it("(g) Parcial × Projeção é CSS: `data-view-only` nas figuras e nas barras", () => {
    const doc = parse(render());
    const exclusivos = [...doc.querySelectorAll("[data-view-only]")]
      // As linhas de candidato também usam `data-view-only` no preenchimento
      // da barra; aqui interessam os do painel.
      .filter((el) => el.closest('[data-testid="candidate-result-row"]') === null)
      .map((el) => el.getAttribute("data-view-only"));

    // margem parcial, margem proj, barra parcial, barra proj.
    expect(exclusivos).toEqual(["parcial", "proj", "parcial", "proj"]);

    // 🔴 2026-09-20 (2ª rodada), refeito em 2026-09-27 (versão D) — a visão
    // Parcial não mostra NENHUMA leitura do modelo. Na versão D a Parcial tem
    // o apurado grande (exclusivo dela) e a Projeção tem o projetado grande +
    // "apurado X%" pequeno (exclusivos dela). A intenção que continua sendo
    // medida: o número PROJETADO só existe dentro de `data-view-only="proj"`,
    // e o APURADO aparece nas duas visões.
    const linha = doc.querySelector('[data-testid="candidate-result-row"]');
    // Ana: 43,5% apurado, 43,2% projetado.
    const proj = [...(linha?.querySelectorAll('[data-view-only="proj"]') ?? [])];
    const parcial = [...(linha?.querySelectorAll('[data-view-only="parcial"]') ?? [])];
    expect(parcial.map((el) => el.textContent).join("|")).toContain("43,5%");
    expect(parcial.map((el) => el.textContent).join("|")).not.toContain("43,2%");
    expect(proj.map((el) => el.textContent).join("|")).toContain("43,2%");
    expect(proj.map((el) => el.textContent).join("|")).toContain("apurado 43,5%");
    // Mutação que morre: tirar o projetado de `data-view-only`. Todo nó de
    // texto com "43,2%" tem um ancestral `data-view-only="proj"`.
    const walker = doc.createTreeWalker(linha as Node, 4 /* NodeFilter.SHOW_TEXT */);
    let achados = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.includes("43,2%")) continue;
      achados++;
      expect(n.parentElement?.closest("[data-view-only]")?.getAttribute("data-view-only")).toBe(
        "proj",
      );
    }
    expect(achados).toBeGreaterThan(0);
    expect(
      linha?.querySelector('[data-testid="result-bar-marker"][data-view-only="proj"]'),
    ).not.toBeNull();
    // A versão D não usa `data-view-cell` (recuo de cor) na linha: cada número
    // é de uma visão só.
    expect(linha?.querySelectorAll("[data-view-cell]")).toHaveLength(0);
  });

  it("(h) a barra de maioria tem os três segmentos do kit e o marcador em 50%", () => {
    const doc = parse(render());
    const barras = [...doc.querySelectorAll('[data-testid="vote-bar"]')];
    expect(barras).toHaveLength(2);

    const rotulos = [...barras[0]!.querySelectorAll('[data-testid="vote-bar-segment"]')].map((s) =>
      s.getAttribute("data-label"),
    );
    expect(rotulos).toEqual(["Ana", "Outros", "Bruno"]);
    expect(barras[0]?.querySelector('[data-testid="vote-bar-marker"]')).not.toBeNull();
  });

  it("(i) versão D: 'PARTIDO – nº', votos por extenso, % na cor de TEXTO do partido", () => {
    const doc = parse(render());
    const linha = doc.querySelector('[data-testid="candidate-result-row"]');
    // A sigla em texto, com o número na urna (`id`, ADR-0042) — não mais a
    // `<PartyTag>` do kit de 09/09.
    expect(linha?.textContent).toContain("PT – 1");
    expect(doc.querySelector('[data-testid="party-tag"]')).toBeNull();
    expect(doc.body.textContent).toContain("15.240.321 votos");
    // O percentual pinta com `--party-<x>-text` (≥ 4,5:1), via custom
    // property da linha; a base só no preenchimento.
    expect(linha?.getAttribute("style")).toContain("--cor-texto:var(--party-pt-text)");
    expect(linha?.getAttribute("style")).toContain("--cor-base:var(--party-pt)");
  });

  it("(j) nenhuma cor de identidade vira tinta de texto (constituição § 4)", () => {
    const html = renderToStaticMarkup(render());
    expect(html).not.toMatch(/color\s*:\s*var\(--color-cand-/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("(k) a nota metodológica do kit sai como parágrafo do painel", () => {
    const doc = parse(render({ note: "Projeção por regra de três." }));
    expect(doc.body.textContent).toContain("Projeção por regra de três.");
  });
});
