// @vitest-environment happy-dom
/**
 * tests/unit/components/HeadlineScore.test.tsx
 * RF-022, RF-023, RF-030.5.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HeadlineScore } from "@/components/blocks/HeadlineScore";
import type { EdgeCandidate } from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

const lula: EdgeCandidate = {
  id: 13,
  nome: "Lula",
  partido: "PT",
  cor: "var(--color-pt)",
  votos_atuais: 18650432,
  votos_projetados: 79812408,
  pct_atual: 53.0,
  pct_projetado: 53.2,
  pct_projetado_lower: 51.9,
  pct_projetado_upper: 54.5,
  p_vitoria: 0.78,
  rank: 1,
  p_passa_2t: 0.99,
  p_fecha_1t: 0.65,
};
const bolso: EdgeCandidate = {
  id: 22,
  nome: "Bolsonaro",
  partido: "PL",
  cor: "var(--color-pl)",
  votos_atuais: 16450112,
  votos_projetados: 70140992,
  pct_atual: 47.0,
  pct_projetado: 46.8,
  pct_projetado_lower: 45.5,
  pct_projetado_upper: 48.1,
  p_vitoria: 0.22,
  rank: 2,
  p_passa_2t: 0.95,
  p_fecha_1t: 0.0,
};

describe("<HeadlineScore />", () => {
  it("(a) headline com 'Lula à frente' + % + votos + CI95", () => {
    const doc = parse(<HeadlineScore candidatos={[lula, bolso]} />);
    const text = doc.body.textContent ?? "";
    expect(text).toContain("Lula à frente");
    expect(text).toContain("53,2%");
    expect(text).toContain("46,8%");
    expect(text).toContain("≈ aproximadamente 79,8 mi votos projetados");
    expect(text).toContain("≈ aproximadamente 70,1 mi votos projetados");
    expect(text).toContain("[51,9; 54,5]");
  });

  it("(b) gatilho 50%+1: atingido quando líder >= 50", () => {
    const doc = parse(<HeadlineScore candidatos={[lula, bolso]} />);
    expect(doc.body.textContent).toContain("50%+1");
    expect(doc.body.textContent).toContain("(atingido)");
  });

  it("(c) gatilho não-atingido quando líder < 50", () => {
    const lulaBaixo: EdgeCandidate = { ...lula, pct_projetado: 48.0 };
    const bolsoMaior: EdgeCandidate = { ...bolso, pct_projetado: 47.0 };
    const doc = parse(<HeadlineScore candidatos={[lulaBaixo, bolsoMaior]} />);
    expect(doc.body.textContent).toContain("(não atingido)");
  });

  it("(d) disputa apertada quando |diff| < 1", () => {
    const a: EdgeCandidate = { ...lula, pct_projetado: 50.3 };
    const b: EdgeCandidate = { ...bolso, pct_projetado: 49.7 };
    const doc = parse(<HeadlineScore candidatos={[a, b]} />);
    expect(doc.body.textContent).toContain("Disputa apertada");
  });

  it("(e) sem candidatos → 'Aguardando candidatos'", () => {
    const doc = parse(<HeadlineScore candidatos={[]} />);
    expect(doc.body.textContent).toContain("Aguardando candidatos");
  });

  it("(f) 1 candidato só → confirmado, sem gatilho", () => {
    const doc = parse(<HeadlineScore candidatos={[lula]} />);
    expect(doc.body.textContent).toContain("Lula confirmado");
    expect(doc.body.textContent).not.toContain("50%+1");
  });

  it("(g) link 'Como funciona' aponta pra /sobre-o-modelo", () => {
    const doc = parse(<HeadlineScore candidatos={[lula, bolso]} />);
    const a = doc.querySelector('a[href="/sobre-o-modelo"]');
    expect(a).not.toBeNull();
    expect(a?.textContent).toContain("Como funciona");
  });

  it("(h) mode='multi-1t' smoke: renderiza top-2 hero e SEM marca 50%+1 interna", () => {
    const terceiro: EdgeCandidate = {
      ...lula,
      id: 25,
      nome: "Terceiro",
      partido: "MDB",
      cor: "var(--color-cand-3)",
      pct_projetado: 4.5,
      rank: 3,
    };
    const doc = parse(
      <HeadlineScore candidatos={[lula, bolso, terceiro]} mode="multi-1t" turno={1} />,
    );
    // Hero ainda mostra top-2
    expect(doc.body.textContent).toContain("Lula");
    expect(doc.body.textContent).toContain("Bolsonaro");
    // SEM marca 50%+1 (gatilho 2º turno) — substituída por TwoRoundIndicator no caller
    expect(doc.body.textContent).not.toContain("50%+1");
    expect(doc.body.textContent).not.toContain("gatilho de 2º turno");
  });

  it("(i) headline em 1T multi menciona o terceiro candidato", () => {
    const terceiro: EdgeCandidate = {
      ...lula,
      id: 25,
      nome: "Terceiro Lugar",
      partido: "MDB",
      cor: "var(--color-cand-3)",
      pct_projetado: 4.5,
      rank: 3,
    };
    const doc = parse(
      <HeadlineScore candidatos={[lula, bolso, terceiro]} mode="multi-1t" turno={1} />,
    );
    expect(doc.body.textContent).toContain("Terceiro Lugar");
    expect(doc.body.textContent).toContain("briga pela 2ª vaga");
  });

  it("(j) transição binary → multi: headline muda quando mode muda", () => {
    const terceiro: EdgeCandidate = {
      ...lula,
      id: 25,
      nome: "Tercio",
      partido: "MDB",
      cor: "var(--color-cand-3)",
      pct_projetado: 4.5,
      rank: 3,
    };
    const cands = [lula, bolso, terceiro];
    const docBinary = parse(<HeadlineScore candidatos={cands} mode="binary" />);
    const docMulti = parse(<HeadlineScore candidatos={cands} mode="multi-1t" turno={1} />);
    // Binary: headline tradicional ("X à frente")
    expect(docBinary.body.textContent).toContain("Lula à frente");
    // Multi: headline menciona o terceiro
    expect(docMulti.body.textContent).toContain("Tercio");
    // Marca 50%+1 só aparece em binary
    expect(docBinary.body.textContent).toContain("50%+1");
    expect(docMulti.body.textContent).not.toContain("50%+1");
  });

  it("(k) mode='binary' renderiza slot `recap` acima do hero (ADR-0016)", () => {
    const recapNode = <div data-testid="recap-slot">RECAP_1T_AQUI</div>;
    const doc = parse(<HeadlineScore candidatos={[lula, bolso]} mode="binary" recap={recapNode} />);
    expect(doc.body.textContent).toContain("RECAP_1T_AQUI");
    // Recap deve vir antes do header
    const html = renderToStaticMarkup(
      <HeadlineScore candidatos={[lula, bolso]} mode="binary" recap={recapNode} />,
    );
    expect(html.indexOf("RECAP_1T_AQUI")).toBeLessThan(html.indexOf("Apuração Presidencial"));
  });

  it("(l) mode='multi-1t' ignora a prop `recap` (não renderiza)", () => {
    const recapNode = <div>RECAP_1T_NAO_DEVE_APARECER</div>;
    const doc = parse(
      <HeadlineScore candidatos={[lula, bolso]} mode="multi-1t" turno={1} recap={recapNode} />,
    );
    expect(doc.body.textContent).not.toContain("RECAP_1T_NAO_DEVE_APARECER");
  });

  it("(m) mode='binary' sem prop `recap` segue funcionando (backward-compat)", () => {
    const doc = parse(<HeadlineScore candidatos={[lula, bolso]} mode="binary" />);
    expect(doc.body.textContent).toContain("Apuração Presidencial");
    expect(doc.body.textContent).toContain("50%+1");
  });

  it("(n) `votos_projetados` > 0 aparece formatado em pt-BR nos dois modos", () => {
    // Até S07/Fase 2 o payload nacional chegava com `votos_projetados: 0`
    // hardcoded — a barra imprimia "0 votos". Com a extrapolação do apurado
    // o número passa a ser real (Σ zona → UF → BR); o componente já
    // formatava, então o teste trava o contrato de exibição.
    // 2026-10-03 (decisão do dono): estimativa sai abreviada, com "≈" e
    // "projetados" — o número cheio afirmava precisão que o modelo não tem.
    const binary = parse(<HeadlineScore candidatos={[lula, bolso]} mode="binary" />);
    const linhas = [...binary.querySelectorAll('[data-testid="votos-projetados"]')].map(
      (e) => e.textContent,
    );
    expect(linhas).toEqual([
      "≈ aproximadamente 79,8 mi votos projetados",
      "≈ aproximadamente 70,1 mi votos projetados",
    ]);
    expect(binary.body.textContent).not.toContain("79.812.408");
    // O placar só mostra projeção: a linha não pode sumir na visão Parcial.
    for (const e of binary.querySelectorAll('[data-testid="votos-projetados"]')) {
      expect(e.closest("[data-view-only]")).toBeNull();
    }

    const multi = parse(<HeadlineScore candidatos={[lula, bolso]} mode="multi-1t" turno={1} />);
    expect(multi.body.textContent).toContain("79,8 mi votos projetados");
  });

  it("(o) subtítulo default descreve extrapolação do apurado, não comparação com 2022", () => {
    // S07/Fase 2: 2022 saiu da projeção (vira comparação descritiva — E1).
    const doc = parse(<HeadlineScore candidatos={[lula, bolso]} />);
    const texto = doc.body.textContent ?? "";
    expect(texto).toContain("extrapolação da apuração real do TSE");
    expect(texto).not.toContain("comparação com 2022");
  });
});
