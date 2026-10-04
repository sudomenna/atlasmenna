// @vitest-environment happy-dom
/**
 * tests/unit/components/CandidateBar.test.tsx
 *
 * Unit tests do <CandidateBar /> — atom de barra de candidato.
 * RF-022, RF-023.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CandidateBar } from "@/components/atoms/bars/CandidateBar";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

describe("<CandidateBar />", () => {
  it("(a) renderiza %, votos e CI95 com aria-label completo", () => {
    const doc = parse(
      <CandidateBar
        nome="Lula"
        partido="PT"
        cor="var(--color-pt)"
        pctProjetado={53.2}
        pctLower={51.9}
        pctUpper={54.5}
        votos={79812408}
      />,
    );
    const meter = doc.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-valuenow")).toBe("53");
    expect(meter?.getAttribute("aria-label")).toContain("Lula");
    expect(meter?.getAttribute("aria-label")).toContain("PT");
    expect(meter?.getAttribute("aria-label")).toContain("53,2%");
    expect(meter?.getAttribute("aria-label")).toContain("aproximadamente 79,8 mi votos projetados");

    // Texto visível
    const text = doc.body.textContent ?? "";
    expect(text).toContain("Lula");
    expect(text).toContain("PT");
    expect(text).toContain("53,2%");
    expect(text).toContain("≈ 79,8 mi votos projetados");
  });

  it("(b) clamp: pct > 100 vira 100, < 0 vira 0", () => {
    const doc = parse(
      <CandidateBar nome="X" partido="P" cor="var(--color-pt)" pctProjetado={150} />,
    );
    const meter = doc.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-valuenow")).toBe("100");
  });

  it("(c) alignRight inverte ordem do header (segundo candidato)", () => {
    const doc = parse(
      <CandidateBar
        nome="Bolsonaro"
        partido="PL"
        cor="var(--color-pl)"
        pctProjetado={46.8}
        alignRight
      />,
    );
    // O fill da barra deve estar à direita (margin-left: auto).
    const fill = doc.querySelector('[role="meter"] > div');
    expect(fill?.getAttribute("style")).toContain("margin-left:auto");
  });

  it("(d) sem CI nem votos → não renderiza linha de metadados", () => {
    const doc = parse(
      <CandidateBar nome="X" partido="P" cor="var(--color-pt)" pctProjetado={50} />,
    );
    // Sem subline → o último filho de root div é a barra
    const meters = doc.querySelectorAll('[role="meter"]');
    expect(meters.length).toBe(1);
    expect(doc.body.textContent).not.toContain("CI95");
  });

  // 🔴 2026-09-20 — este caso testava o CONTRÁRIO até hoje. Ele se chamava
  // "sem `cor`, `rank=3` resolve cor via colorForRank" e exigia
  // `var(--color-cand-3)`: cravava a paleta por COLOCAÇÃO como contrato do
  // átomo, doze dias depois de o ADR-0024 tê-la aposentado. Invertido.
  it("(e) sem `cor`, o fallback sai da SIGLA — nunca da colocação", () => {
    const doc = parse(<CandidateBar nome="X" partido="MDB" pctProjetado={4.5} rank={3} />);
    const fill = doc.querySelector('[role="meter"] > div');
    expect(fill?.getAttribute("style")).toContain("var(--party-mdb)");
    expect(fill?.getAttribute("style")).not.toContain("--color-cand-");
  });

  // O caso que DISCRIMINA. Sem ele, um `colorForParty` trocado de volta por
  // `colorForRank` ainda passaria em (e) caso alguém alinhasse os números por
  // acaso — e, mais importante, este é o defeito que o dono viu: a mesma
  // pessoa mudando de tinta ao mudar de lugar.
  it("(e2) a MESMA sigla em posições diferentes recebe a MESMA cor", () => {
    const cores = [1, 2, 3, 7, undefined].map((rank) => {
      const doc = parse(<CandidateBar nome="X" partido="PSD" pctProjetado={20} rank={rank} />);
      return doc.querySelector('[role="meter"] > div')?.getAttribute("style") ?? "";
    });
    expect(new Set(cores).size).toBe(1);
    expect(cores[0]).toContain("var(--party-psd)");
  });

  // E siglas diferentes NÃO colapsam: sem isto, devolver uma constante para
  // tudo passaria em (e2).
  it("(e3) siglas diferentes recebem cores diferentes", () => {
    const cor = (partido: string) =>
      parse(<CandidateBar nome="X" partido={partido} pctProjetado={20} />)
        .querySelector('[role="meter"] > div')
        ?.getAttribute("style") ?? "";
    expect(cor("PT")).not.toBe(cor("PL"));
  });

  // Federação e sigla ausente caem no fallback ESTÁVEL da paleta, não na cor
  // da posição — é o caso concreto medido em 20/09: o PTB aparece nas fixtures
  // sem token próprio, e há 10 candidaturas sem partido em arquivos que
  // imitam produção. Qualquer uma delas trocando de lugar trocava de cor.
  it("(e4) federação e sigla ausente caem em `outros`, não na cor do rank", () => {
    for (const partido of ["PSDB/CIDADANIA", "FEDERACAO BRASIL DA ESPERANCA", ""]) {
      const doc = parse(<CandidateBar nome="X" partido={partido} pctProjetado={9} rank={1} />);
      const estilo = doc.querySelector('[role="meter"] > div')?.getAttribute("style") ?? "";
      expect(estilo).toContain("var(--party-outros)");
    }
  });

  it("(z) votos projetados 0 ⇒ não sabemos ⇒ sem linha de votos (2026-10-03)", () => {
    const doc = parse(
      <CandidateBar nome="Lula" partido="PT" cor="var(--color-pt)" pctProjetado={53.2} votos={0} />,
    );
    expect(doc.querySelector('[data-testid="votos-projetados"]')).toBeNull();
    expect(doc.body.textContent).not.toContain("0 votos");
  });
});
