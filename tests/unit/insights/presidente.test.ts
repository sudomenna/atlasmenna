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

/**
 * `chamadas`: quantas UFs com `chamada: true` (leitura da PROJEÇÃO) — por
 * padrão 3, para provar que ela NÃO vira frase. `eleito`: id que o produtor
 * declara em `eleitos_definidos` em toda UF (Brasil definido).
 */
function entrada(
  cands: EdgeCandidate[],
  o: { pct?: number; p2t?: number | null; chamadas?: number; eleito?: number } = {},
): Entrada {
  return {
    pct_apurado_total: o.pct ?? 40,
    national: { candidatos: cands, p_segundo_turno_overall: o.p2t === undefined ? 0.65 : o.p2t },
    por_uf: Array.from({ length: 27 }, (_, i) => ({
      sigla: `U${i}`,
      chamada: i < (o.chamadas ?? 3),
      lider: cands.find((c) => c.rank === 1)?.id,
      top_candidatos: cands.map((c) => ({ id: c.id, nome: c.nome, partido: c.partido })),
      ...(o.eleito !== undefined ? { eleitos_definidos: [o.eleito] } : {}),
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
      "P(2º turno) = 65,0%.",
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

  it("🔴 2026-10-04 — `chamada` (projeção) em 27 UFs, sem eleito definido: nenhuma frase de definição", () => {
    const r = insightsPresidenteDoPayload(
      entrada([cand(13, "LULA", "PT", 1, 46, 44, 48), cand(22, "X", "PL", 2, 40, 38, 42)], {
        chamadas: 27,
      }),
    );
    expect(r[2]).toBe("P(2º turno) = 65,0%.");
    for (const f of r) expect(f).not.toMatch(/chamad|eleit/i);
  });

  it("P(2T) nulo e nada definido: a terceira frase não existe", () => {
    const r = insightsPresidenteDoPayload(
      entrada([cand(13, "LULA", "PT", 1, 46, 44, 48), cand(22, "X", "PL", 2, 40, 38, 42)], {
        p2t: null,
        chamadas: 27,
      }),
    );
    expect(r).toHaveLength(2);
  });

  it("Brasil definido: nomeia o eleito pelo id de `eleitos_definidos`, mesmo não sendo o rank 1", () => {
    const r = insightsPresidenteDoPayload(
      entrada([cand(13, "LULA", "PT", 1, 46, 44, 48), cand(22, "X", "PL", 2, 40, 38, 42)], {
        p2t: null,
        eleito: 22,
      }),
    );
    expect(r[2]).toBe("X (PL) matematicamente eleito pela contagem oficial do TSE.");
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
    // A fixture tem UFs com `chamada: true` e nenhum `eleitos_definidos`.
    expect((fixture.por_uf as unknown as EdgeUfRow[]).some((u) => u.chamada)).toBe(true);
    expect(r[2]).toBe("P(2º turno) = 65,0%.");
    for (const f of r) expect(f).not.toMatch(/expressiv|esmagador|consolid/i);
  });
});
