/**
 * tests/unit/utils/desfecho-governador.test.ts
 *
 * Spec 006 — RF-006.6 (placar 1º × 2º turno), RF-006.7 (por partido) e
 * RF-006.8 (regra única de desfecho). A regra vive em
 * `lib/utils/desfecho-governador.ts`; selo, filtro e gráficos leem dela.
 *
 * Os casos-limite foram escolhidos para MATAR mutações concretas:
 *   - `chamada` + `vai_a_2t: true`  → mata "chamada conta como eleito";
 *   - `pct_atual` exatamente 50     → mata `> 50` → `>= 50`;
 *   - 50,01                          → mata `> 50` → `> 50.5` (ou arredondamento);
 *   - `pct_atual` ausente            → mata "ausente vira 0";
 *   - líder resgatado (RF-190)       → mata "líder da contagem = top_candidatos[0]";
 *   - `false` + `indefinido`         → mata "vai_a_2t false basta".
 */

import { describe, expect, it } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";
import {
  agregarPorPartido,
  agruparPorDesfecho,
  classificarContagem,
  classificarProjecao,
  SIGLAS_UF,
} from "@/lib/utils/desfecho-governador";

type Top = EdgeUfRow["top_candidatos"];

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
      { id: 3, pct: 15, partido: "PSD", pct_atual: 15 },
    ],
    vai_a_2t: true,
    bucket: "vai_2t",
    ...over,
  };
}

function top(...cands: Array<[number, string | undefined, number, number | undefined]>): Top {
  return cands.map(([id, partido, pct, pct_atual]) => {
    const c: Top[number] = { id, pct };
    if (partido !== undefined) c.partido = partido;
    if (pct_atual !== undefined) c.pct_atual = pct_atual;
    return c;
  });
}

describe("classificarProjecao (RF-006.8)", () => {
  it("🔴 `chamada` com `vai_a_2t: true` vai ao 2º turno — margem grande não é eleição", () => {
    expect(classificarProjecao({ bucket: "chamada", vai_a_2t: true })).toBe("segundo_turno");
  });

  it("`chamada` com `vai_a_2t: false` é eleito no 1º turno", () => {
    expect(classificarProjecao({ bucket: "chamada", vai_a_2t: false })).toBe("eleito_1t");
  });

  it("`decidido_1t` com `vai_a_2t: false` é eleito no 1º turno", () => {
    expect(classificarProjecao({ bucket: "decidido_1t", vai_a_2t: false })).toBe("eleito_1t");
  });

  it("`vai_a_2t: false` com `indefinido` fica em aberto — quem ganha não está definido", () => {
    expect(classificarProjecao({ bucket: "indefinido", vai_a_2t: false })).toBe("em_aberto");
  });

  it("`vai_a_2t: true` com `indefinido` vai ao 2º turno — a ordem 1º/2º não importa", () => {
    expect(classificarProjecao({ bucket: "indefinido", vai_a_2t: true })).toBe("segundo_turno");
  });

  it("`vai_a_2t: null` (2º turno, ou não aplicável) fica em aberto em QUALQUER bucket", () => {
    for (const bucket of ["chamada", "decidido_1t", "vai_2t", "indefinido"] as const) {
      expect(classificarProjecao({ bucket, vai_a_2t: null }), bucket).toBe("em_aberto");
    }
  });

  it("`vai_a_2t` ausente (payload pré-S05) fica em aberto, nunca eleito", () => {
    const legado = { bucket: "decidido_1t" } as unknown as Pick<EdgeUfRow, "vai_a_2t" | "bucket">;
    expect(classificarProjecao(legado)).toBe("em_aberto");
  });
});

describe("classificarContagem (RF-006.8)", () => {
  it("🔴 líder com exatamente 50% NÃO fecha — é preciso MAIS da metade", () => {
    const r = row("SP", { top_candidatos: top([1, "PL", 50, 50], [2, "PT", 40, 40]) });
    expect(classificarContagem(r)).toBe("segundo_turno");
  });

  it("líder com 50,01% fecha no 1º turno", () => {
    const r = row("SP", { top_candidatos: top([1, "PL", 50, 50.01], [2, "PT", 40, 39.99]) });
    expect(classificarContagem(r)).toBe("eleito_1t");
  });

  it("líder abaixo de 50% vai ao 2º turno, qualquer que seja a projeção", () => {
    const r = row("SP", { vai_a_2t: false, bucket: "decidido_1t" });
    expect(classificarContagem(r)).toBe("segundo_turno");
  });

  it("`pct_apurado === 0` → aguardando, mesmo com `pct_atual` presente", () => {
    const r = row("SP", {
      pct_apurado: 0,
      top_candidatos: top([1, "PL", 60, 70], [2, "PT", 30, 30]),
    });
    expect(classificarContagem(r)).toBe("aguardando");
  });

  it("🔴 `pct_atual` ausente → aguardando, nunca tratado como 0", () => {
    // Se o ausente virasse 0, o líder medido (55%) fecharia no 1º turno.
    const r = row("SP", { top_candidatos: top([1, "PL", 40, undefined], [2, "PT", 38, 55]) });
    expect(classificarContagem(r)).toBe("aguardando");
  });

  it("🔴 `pct_atual` ausente num NÃO-líder também → aguardando (não usa a ordem da projeção)", () => {
    // O líder por projeção TEM 55% medido. Sem saber o outro, a ordem da
    // contagem não existe; cair na ordem de projeção publicaria o líder do
    // modelo sob o título "se a apuração parasse agora".
    const r = row("SP", { top_candidatos: top([1, "PL", 40, 55], [2, "PT", 38, undefined]) });
    expect(classificarContagem(r)).toBe("aguardando");
    expect(agregarPorPartido([r], "contagem")).toEqual([]);
  });

  it("`pct_atual` ausente em TODOS → aguardando", () => {
    const r = row("SP", {
      top_candidatos: top([1, "PL", 60, undefined], [2, "PT", 30, undefined]),
    });
    expect(classificarContagem(r)).toBe("aguardando");
  });

  it("`top_candidatos` vazio → aguardando", () => {
    expect(classificarContagem(row("SP", { top_candidatos: [] }))).toBe("aguardando");
  });

  it("🔴 o líder da contagem pode ser o RESGATADO (RF-190), fora do prefixo da projeção", () => {
    // Os 4 primeiros são o prefixo por projeção; o 5º foi resgatado por liderar
    // o apurado com 51%. Olhar `top_candidatos[0]` (38%) daria 2º turno.
    const r = row("SP", {
      top_candidatos: top(
        [1, "PL", 38, 20],
        [2, "PT", 30, 15],
        [3, "PSD", 15, 8],
        [4, "MDB", 10, 6],
        [5, "NOVO", 5, 51],
      ),
    });
    expect(classificarContagem(r)).toBe("eleito_1t");
    expect(agregarPorPartido([r], "contagem")).toEqual([
      { partido: "NOVO", eleitos: 1, segundo_turno: 0 },
    ]);
  });
});

describe("agruparPorDesfecho (RF-006.6)", () => {
  it("as 27 UFs sempre aparecem — as ausentes de `por_uf` como aguardando", () => {
    const g = agruparPorDesfecho([row("SP", { vai_a_2t: false, bucket: "chamada" })], "projecao");
    expect(g.eleito_1t.map((u) => u.sigla)).toEqual(["SP"]);
    expect(g.aguardando).toHaveLength(26);
    expect(g.aguardando.map((u) => u.sigla)).not.toContain("SP");
    const total = Object.values(g).reduce((a, v) => a + v.length, 0);
    expect(total).toBe(27);
  });

  it("`por_uf` vazio → 27 aguardando nas duas bases", () => {
    expect(agruparPorDesfecho([], "projecao").aguardando).toHaveLength(27);
    expect(agruparPorDesfecho([], "contagem").aguardando).toHaveLength(27);
  });

  it("sigla fora das 27 é ignorada e sigla repetida conta uma vez", () => {
    const g = agruparPorDesfecho(
      [
        row("ZZ", { vai_a_2t: false, bucket: "decidido_1t" }),
        row("RJ", { vai_a_2t: false, bucket: "decidido_1t" }),
        row("RJ", { vai_a_2t: true, bucket: "vai_2t" }),
      ],
      "projecao",
    );
    expect(g.eleito_1t.map((u) => u.sigla)).toEqual(["RJ"]);
    expect(g.segundo_turno).toHaveLength(0);
    expect(Object.values(g).reduce((a, v) => a + v.length, 0)).toBe(27);
  });

  it("dentro do grupo a ordem é alfabética de sigla e traz o nome por extenso", () => {
    const g = agruparPorDesfecho(
      [row("PR"), row("AM"), row("PE"), row("AP")].map((r) => ({ ...r, vai_a_2t: true })),
      "projecao",
    );
    expect(g.segundo_turno.map((u) => u.sigla)).toEqual(["AM", "AP", "PE", "PR"]);
    expect(g.segundo_turno[0]).toEqual({ sigla: "AM", nome: "Amazonas" });
    expect(SIGLAS_UF).toHaveLength(27);
  });

  it("as duas bases podem discordar para a MESMA UF", () => {
    // Projeção: vai ao 2º turno. Contagem: o líder já passou de 50%.
    const r = row("BA", { top_candidatos: top([1, "PT", 48, 52], [2, "UNIÃO", 40, 38]) });
    expect(agruparPorDesfecho([r], "projecao").segundo_turno.map((u) => u.sigla)).toEqual(["BA"]);
    expect(agruparPorDesfecho([r], "contagem").eleito_1t.map((u) => u.sigla)).toEqual(["BA"]);
  });
});

describe("agregarPorPartido (RF-006.7)", () => {
  it("eleito conta o partido do 1º; 2º turno conta os DOIS primeiros", () => {
    const linhas = agregarPorPartido(
      [
        row("SP", {
          vai_a_2t: false,
          bucket: "decidido_1t",
          top_candidatos: top([1, "PL", 55, 54]),
        }),
        row("RJ"), // 2T: PL + PT (ordem de projeção)
      ],
      "projecao",
    );
    expect(linhas).toEqual([
      { partido: "PL", eleitos: 1, segundo_turno: 1 },
      { partido: "PT", eleitos: 0, segundo_turno: 1 },
    ]);
  });

  it("🔴 `chamada` + `vai_a_2t: true` conta como 2º turno para os dois, não eleito", () => {
    const linhas = agregarPorPartido(
      [row("ES", { bucket: "chamada", vai_a_2t: true })],
      "projecao",
    );
    expect(linhas.find((l) => l.partido === "PL")).toEqual({
      partido: "PL",
      eleitos: 0,
      segundo_turno: 1,
    });
  });

  it("a base da contagem usa a ordem da CONTAGEM para os dois do 2º turno", () => {
    // Projeção: PL, PT, PSD. Contagem: PSD 40, PL 35, PT 20 → 2T entre PSD e PL.
    const r = row("MG", {
      top_candidatos: top([1, "PL", 45, 35], [2, "PT", 35, 20], [3, "PSD", 15, 40]),
    });
    const partidos = agregarPorPartido([r], "contagem").map((l) => l.partido);
    expect(partidos).toEqual(["PL", "PSD"]);
    expect(agregarPorPartido([r], "projecao").map((l) => l.partido)).toEqual(["PL", "PT"]);
  });

  it("em aberto e aguardando não somam para ninguém", () => {
    expect(agregarPorPartido([row("AL", { vai_a_2t: null })], "projecao")).toEqual([]);
    expect(agregarPorPartido([row("AL", { pct_apurado: 0 })], "contagem")).toEqual([]);
  });

  it('partido ausente vira a linha `null` ("Partido não informado")', () => {
    const r = row("AC", { top_candidatos: top([1, undefined, 45, 44], [2, "  ", 35, 36]) });
    expect(agregarPorPartido([r], "projecao")).toEqual([
      { partido: null, eleitos: 0, segundo_turno: 2 },
    ]);
  });

  it("ordem: total desc → eleitos desc → sigla pt-BR; sem partido por último no empate", () => {
    const eleito = (sigla: string, partido: string | undefined) =>
      row(sigla, {
        vai_a_2t: false,
        bucket: "decidido_1t",
        top_candidatos: top([1, partido, 55, 55]),
      });
    const turno2 = (sigla: string, a: string, b: string) =>
      row(sigla, { top_candidatos: top([1, a, 40, 40], [2, b, 35, 35]) });
    const linhas = agregarPorPartido(
      [
        // PT: 2 no 2T (total 2, eleitos 0). MDB: 1 eleito + 1 2T (total 2, eleitos 1).
        turno2("AC", "PT", "UNIÃO"),
        turno2("AL", "PT", "MDB"),
        eleito("AM", "MDB"),
        // Empate total 1 / eleitos 1: ÁGUIA (acento), AVANTE, e sem partido.
        eleito("AP", undefined),
        eleito("BA", "AVANTE"),
        eleito("CE", "ÁGUIA"),
      ],
      "projecao",
    );
    expect(linhas.map((l) => l.partido)).toEqual(["MDB", "PT", "ÁGUIA", "AVANTE", null, "UNIÃO"]);
  });

  it("soma das linhas = eleitos + 2 × estados em 2º turno (mesma regra do placar)", () => {
    const porUf = [
      row("SP", { vai_a_2t: false, bucket: "chamada" }),
      row("RJ"),
      row("MG", { bucket: "chamada" }),
      row("BA", { vai_a_2t: null }),
    ];
    const g = agruparPorDesfecho(porUf, "projecao");
    const soma = agregarPorPartido(porUf, "projecao").reduce(
      (a, l) => a + l.eleitos + l.segundo_turno,
      0,
    );
    expect(g.eleito_1t).toHaveLength(1);
    expect(g.segundo_turno).toHaveLength(2);
    expect(soma).toBe(1 + 2 * 2);
  });
});
