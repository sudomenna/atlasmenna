// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalWinnerBanner.test.tsx
 *
 * 🔴 2026-10-04 (dono, ADR-0075) — a faixa nacional só aparece com eleição
 * MATEMATICAMENTE definida (`EdgeUfRow.eleitos_definidos`, via
 * `eleitosNacionais`). Até então ela dizia "ELEITO" / "Presidente eleito"
 * com `p_vitoria ≥ 0,99` OU apurado ≥ 99% — leitura da projeção. Os casos
 * (a)–(c) existem para matar a volta desse gatilho.
 *
 * Também: identidade pelo id (nunca o líder projetado), anulada nunca, cor do
 * PARTIDO do eleito com a tinta do mesmo par, aria-live.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ATRIBUICAO_TSE, NationalWinnerBanner } from "@/components/blocks/NationalWinnerBanner";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function makeCand(overrides: Partial<EdgeCandidate>): EdgeCandidate {
  return {
    id: 13,
    nome: "Lula",
    partido: "PT",
    cor: "var(--color-cand-1)",
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: 0,
    pct_projetado: 53.2,
    pct_projetado_lower: 51,
    pct_projetado_upper: 55,
    p_vitoria: 0.5,
    rank: 1,
    p_passa_2t: 1,
    p_fecha_1t: 0.5,
    ...overrides,
  };
}

const LULA = makeCand({});
const BOLS = makeCand({ id: 22, nome: "Bolsonaro", partido: "PL", rank: 2, pct_projetado: 46.8 });

function ufRow(sigla: string, over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla,
    pct_apurado: 99.5,
    lider: 13,
    margem_atual: 0,
    margem_projetada: 0,
    margem_projetada_ci: [0, 0],
    chamada: true,
    swing_vs_2022: null,
    top_candidatos: [
      { id: 13, nome: "Lula", partido: "PT", pct: 53.2, pct_atual: 53, votos_atuais: 53000 },
      { id: 22, nome: "Bolsonaro", partido: "PL", pct: 46.8, pct_atual: 47, votos_atuais: 47000 },
    ],
    vai_a_2t: false,
    bucket: "chamada",
    ...over,
  };
}

/** Brasil definido: o produtor põe o eleito em TODA UF onde ele está no top. */
function brasilDefinido(id: number): EdgeUfRow[] {
  return [ufRow("SP", { eleitos_definidos: [id] }), ufRow("BA", { eleitos_definidos: [id] })];
}

/** Brasil NÃO definido: projeção e apuração no limite, campo ausente. */
const SEM_DEFINICAO: EdgeUfRow[] = [ufRow("SP"), ufRow("BA")];

const vazio = (doc: Document) => (doc.body.textContent ?? "").trim() === "";

describe("<NationalWinnerBanner /> — gatilho é só `eleitos_definidos` (ADR-0075)", () => {
  it("(a) p_vitoria 0,995 SEM definido ⇒ nada, e nenhuma palavra 'eleito' [mutação: `p_vitoria ≥ 0,99`]", () => {
    for (const turno of [1, 2] as const) {
      const lider = makeCand({ p_vitoria: 0.995 });
      const doc = parse(
        <NationalWinnerBanner candidatos={[lider, BOLS]} porUf={SEM_DEFINICAO} turno={turno} />,
      );
      expect(vazio(doc), `turno ${turno}`).toBe(true);
      expect((doc.body.textContent ?? "").toLowerCase()).not.toContain("eleito");
    }
  });

  it("(b) apurado 99,5% em todas as UFs SEM definido ⇒ nada [mutação: `pct_apurado ≥ 99`]", () => {
    const rows = SEM_DEFINICAO.map((r) => ({ ...r, pct_apurado: 99.5 }));
    for (const turno of [1, 2] as const) {
      const doc = parse(
        <NationalWinnerBanner candidatos={[LULA, BOLS]} porUf={rows} turno={turno} />,
      );
      expect(vazio(doc), `turno ${turno}`).toBe(true);
    }
  });

  it("(c) sem `por_uf` (pré-apuração) ⇒ nada", () => {
    const doc = parse(
      <NationalWinnerBanner candidatos={[makeCand({ p_vitoria: 1 })]} porUf={[]} turno={2} />,
    );
    expect(vazio(doc)).toBe(true);
  });

  it("(d) definido no 2º turno ⇒ 'NOME (P) matematicamente eleito' + atribuição ao TSE", () => {
    const doc = parse(
      <NationalWinnerBanner candidatos={[LULA, BOLS]} porUf={brasilDefinido(13)} turno={2} />,
    );
    const strong = doc.querySelector("strong")?.textContent ?? "";
    expect(strong).toBe("Lula (PT) matematicamente eleito");
    expect(doc.body.textContent).toContain(ATRIBUICAO_TSE);
    expect(ATRIBUICAO_TSE).toBe("pela contagem oficial do TSE");
    // Nunca o "ELEITO" solto nem "Presidente eleito".
    expect(doc.body.textContent).not.toContain("ELEITO");
    expect(doc.body.textContent).not.toContain("Presidente eleito");
  });

  it("(e) definido no 1º turno ⇒ '… matematicamente eleito no 1º turno'", () => {
    const doc = parse(
      <NationalWinnerBanner candidatos={[LULA, BOLS]} porUf={brasilDefinido(13)} turno={1} />,
    );
    expect(doc.querySelector("strong")?.textContent).toBe(
      "Lula (PT) matematicamente eleito no 1º turno",
    );
  });

  it("(f) o nome sai do ID definido, mesmo com outro líder projetado e p_vitoria 0,999 [mutação: `rank === 1` / `candidato_a_id`]", () => {
    const liderProjetado = makeCand({ p_vitoria: 0.999, rank: 1 });
    const definido = makeCand({ ...BOLS, p_vitoria: 0.001, rank: 2 });
    const doc = parse(
      <NationalWinnerBanner
        candidatos={[liderProjetado, definido]}
        porUf={brasilDefinido(22)}
        turno={2}
      />,
    );
    const texto = doc.body.textContent ?? "";
    expect(texto).toContain("Bolsonaro (PL) matematicamente eleito");
    expect(texto).not.toContain("Lula");
    // A cor também é a do partido do DEFINIDO.
    const style = doc.querySelector('[role="status"]')?.getAttribute("style") ?? "";
    expect(style).toContain("var(--party-pl-chip)");
  });

  it("(g) anulada nunca, nem com o id dela em `eleitos_definidos`", () => {
    const anulada = makeCand({ destino: "anulado" });
    const rows = brasilDefinido(13).map((r) => ({
      ...r,
      top_candidatos: r.top_candidatos.map((t) =>
        t.id === 13 ? { ...t, destino: "anulado" as const } : t,
      ),
    }));
    for (const porUf of [rows, brasilDefinido(13)]) {
      const doc = parse(
        <NationalWinnerBanner candidatos={[anulada, BOLS]} porUf={porUf} turno={2} />,
      );
      expect(vazio(doc)).toBe(true);
    }
  });

  it("(h) dois ids definidos (dado incoerente para Presidente) ⇒ nada", () => {
    const rows = [
      ufRow("SP", { eleitos_definidos: [13] }),
      ufRow("BA", { eleitos_definidos: [22] }),
    ];
    const doc = parse(<NationalWinnerBanner candidatos={[LULA, BOLS]} porUf={rows} turno={2} />);
    expect(vazio(doc)).toBe(true);
  });

  it("(i) id definido sem nome em lugar nenhum ⇒ nada (nunca anunciar eleito sem nome)", () => {
    const doc = parse(
      <NationalWinnerBanner candidatos={[LULA]} porUf={brasilDefinido(99)} turno={2} />,
    );
    expect(vazio(doc)).toBe(true);
  });
});

describe("<NationalWinnerBanner /> — cor e acessibilidade", () => {
  it("(j) fundo e tinta do MESMO par medido, do partido — nunca da colocação", () => {
    for (const rank of [1, 2, 3, 7]) {
      const lider = makeCand({ rank, cor: `var(--color-cand-${rank})` });
      const doc = parse(
        <NationalWinnerBanner candidatos={[lider]} porUf={brasilDefinido(13)} turno={2} />,
      );
      const style = doc.querySelector('[role="status"]')?.getAttribute("style") ?? "";
      expect(style, `rank ${rank}`).toContain("var(--party-pt-chip)");
      expect(style, `rank ${rank}`).toContain("var(--party-pt-ink)");
      expect(style, `rank ${rank}`).not.toContain("--color-cand-");
    }
  });

  it("(k) aria-live='polite' + role='status', e o ouvido ouve a mesma frase da tela", () => {
    const doc = parse(
      <NationalWinnerBanner candidatos={[LULA, BOLS]} porUf={brasilDefinido(13)} turno={2} />,
    );
    const banner = doc.querySelector('[role="status"]');
    expect(banner?.getAttribute("aria-live")).toBe("polite");
    const aria = banner?.getAttribute("aria-label") ?? "";
    expect(aria).toContain("Lula (PT) matematicamente eleito");
    expect(aria).toContain(ATRIBUICAO_TSE);
    expect(aria).not.toContain("Presidente eleito");
  });
});
