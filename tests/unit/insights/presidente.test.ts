import { describe, expect, it } from "vitest";
import type { EdgeCandidate, EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import { insightsPresidenteDoPayload } from "@/lib/insights/presidente";
import fixture from "../../fixtures/edge-config/projection-current.json";

type Entrada = Pick<EdgePayload, "national" | "por_uf" | "pct_apurado_total">;

function cand(
  id: number,
  nome: string,
  partido: string,
  rank: number,
  pct: number,
  lo: number,
  hi: number,
) {
  return {
    id,
    nome,
    partido,
    rank,
    pct_projetado: pct,
    pct_projetado_lower: lo,
    pct_projetado_upper: hi,
  } as EdgeCandidate;
}

function entrada(
  cands: EdgeCandidate[],
  o: { pct?: number; p2t?: number | null; chamadas?: number } = {},
): Entrada {
  return {
    pct_apurado_total: o.pct ?? 40,
    national: { candidatos: cands, p_segundo_turno_overall: o.p2t === undefined ? 0.65 : o.p2t },
    por_uf: Array.from({ length: 27 }, (_, i) => ({
      sigla: `U${i}`,
      chamada: i < (o.chamadas ?? 3),
    })),
  } as unknown as Entrada;
}

describe("insightsPresidenteDoPayload", () => {
  it("ordena por rank (não pela ordem do array) e usa o nome de exibição", () => {
    const b = cand(22, "FLÁVIO BOLSONARO", "PL", 2, 40, 38, 42);
    const a = cand(13, "LULA", "PT", 1, 46, 44, 48);
    expect(insightsPresidenteDoPayload(entrada([b, a]))).toEqual([
      "LULA (PT) à frente com 46,0% — intervalo de 44,0% a 48,0% com 40,0% apurado.",
      "LULA abre 6,0 pp sobre FLÁVIO BOLSONARO (PL), acima da margem de incerteza.",
      "P(2º turno) = 65,0%. 3 de 27 unidades federativas já chamadas.",
    ]);
  });

  it("intervalos que se sobrepõem: sem vencedor projetado (inclusive no limite exato)", () => {
    const a = cand(13, "LULA", "PT", 1, 44, 42, 46);
    const b = cand(22, "FLÁVIO BOLSONARO", "PL", 2, 41, 39, 42);
    const r = insightsPresidenteDoPayload(entrada([a, b]));
    expect(r[1]).toBe(
      "Diferença de 3,0 pp para FLÁVIO BOLSONARO (PL) — os intervalos se sobrepõem, não há vencedor projetado.",
    );
  });

  it("P(2T) nulo: a frase de probabilidade sai, a de chamadas fica", () => {
    const r = insightsPresidenteDoPayload(
      entrada([cand(13, "LULA", "PT", 1, 46, 44, 48), cand(22, "X", "PL", 2, 40, 38, 42)], {
        p2t: null,
        chamadas: 0,
      }),
    );
    expect(r[2]).toBe("0 de 27 unidades federativas já chamadas.");
  });

  it("menos de 2 candidatos ou 0% apurado: vazio", () => {
    expect(insightsPresidenteDoPayload(entrada([cand(13, "LULA", "PT", 1, 46, 44, 48)]))).toEqual(
      [],
    );
    expect(
      insightsPresidenteDoPayload(
        entrada([cand(13, "LULA", "PT", 1, 46, 44, 48), cand(22, "X", "PL", 2, 40, 38, 42)], {
          pct: 0,
        }),
      ),
    ).toEqual([]);
  });

  it("roda sobre a fixture de projeção e mantém tom neutro", () => {
    const r = insightsPresidenteDoPayload(fixture as unknown as Entrada);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatch(/^Candidato PT \(PT\) à frente com 43,2%/);
    expect(r[2]).toBe(
      `P(2º turno) = 65,0%. ${(fixture.por_uf as unknown as EdgeUfRow[]).filter((u) => u.chamada).length} de 27 unidades federativas já chamadas.`,
    );
    for (const f of r) expect(f).not.toMatch(/expressiv|esmagador|consolid/i);
  });
});
