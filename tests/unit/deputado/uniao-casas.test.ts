/**
 * tests/unit/deputado/uniao-casas.test.ts — spec 027 (RF-280, RF-282),
 * design § 8.2: as uniões da capa das 27 casas, puras.
 *
 * Mutações aplicadas à mão (30/09, frente U-b) e que estes casos derrubam:
 *   - M31: `total` = `est.bancada.total_cadeiras` quando `dis` falta (1.035) —
 *     cai "só est: 1.059";
 *   - M4 (lado U-b): `total` = Σ `lugares_a_preencher` das casas presentes —
 *     cai "duas casas presentes: total fixo";
 *   - M33: mais votados só de `est` — cai "o candidato do DF entra no top 10";
 *   - M34: soma ignora `dis` — cai "a soma inclui o DF, pela chave estável";
 *   - `Math.max(0, …)` no aguardando — cai "aguardando negativo aparece".
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  maisVotadosDasCasas,
  puxadoresDasCasas,
  somaDasCasas,
  TOTAL_CADEIRAS_ASSEMBLEIAS,
  TOTAL_CADEIRAS_DA_CASA,
  TOTAL_CASAS,
} from "@/lib/deputado/uniao-casas";

import { agremiacao, destaque, linhaUf, payloadCasa, puxador } from "./_payload-casa";

describe("totais fixos — espelho do modelo Python", () => {
  it("1.035 (7) + 24 (8) = 1.059, os mesmos de api/model/cargos.py::TOTAL_CADEIRAS", () => {
    expect(TOTAL_CADEIRAS_DA_CASA).toEqual({ 7: 1035, 8: 24 });
    expect(TOTAL_CADEIRAS_ASSEMBLEIAS).toBe(1059);
    expect(TOTAL_CASAS).toBe(27);
    const py = readFileSync(join(process.cwd(), "api/model/cargos.py"), "utf8");
    const linha = /^TOTAL_CADEIRAS:\s*dict\[int, int\]\s*=\s*\{([^}]*)\}/m.exec(py)?.[1] ?? "";
    expect(linha).toMatch(/\b7:\s*1035\b/);
    expect(linha).toMatch(/\b8:\s*24\b/);
  });
});

describe("somaDasCasas — RF-280 / RF-282", () => {
  it("🔴 M31 — só est: total 1.059 (nunca 1.035), e as 24 do DF estão em 'aguardando'", () => {
    const est = payloadCasa(7, {
      agremiacoes: [agremiacao("22", "PL", 60), agremiacao("13", "PT", 40)],
      ufsCalculadas: 2,
    });
    const soma = somaDasCasas(est, null);
    expect(soma.total).toBe(1059);
    expect(soma.atribuidas).toBe(100);
    expect(soma.aguardando).toBe(959);
    expect(soma.casasCalculadas).toBe(2);
    expect(soma.casasAguardando).toBe(25);
  });

  it("só dis: total 1.059, e as 26 Assembleias aguardam", () => {
    const dis = payloadCasa(8, { agremiacoes: [agremiacao("22", "PL", 8)], ufsCalculadas: 1 });
    const soma = somaDasCasas(null, dis);
    expect(soma.total).toBe(1059);
    expect(soma.aguardando).toBe(1051);
    expect(soma.casasAguardando).toBe(26);
  });

  it("🔴 M4 — duas casas presentes (SP e RR, 118 vagas): total fixo, nunca a soma das vagas publicadas", () => {
    const est = payloadCasa(7, {
      agremiacoes: [agremiacao("22", "PL", 70)],
      porUf: [
        linhaUf("SP", { lugares_a_preencher: 94, cadeiras_definidas: 50 }),
        linhaUf("RR", { lugares_a_preencher: 24, cadeiras_definidas: 20 }),
      ],
    });
    const soma = somaDasCasas(est, null);
    expect(soma.total).toBe(1059);
    expect(soma.total).not.toBe(118);
    expect(soma.aguardando).toBe(989);
  });

  it("as duas presentes: total = Σ total_cadeiras publicados (RF-280 emendado: o DF com nv 28)", () => {
    const est = payloadCasa(7, { agremiacoes: [agremiacao("22", "PL", 10)], total: 1035 });
    const dis = payloadCasa(8, { agremiacoes: [agremiacao("22", "PL", 5)], total: 28 });
    expect(somaDasCasas(est, dis).total).toBe(1063);
  });

  it("🔴 M34 — a soma inclui o DF, pela chave estável `cod` (e não pela sigla nem por agr.n)", () => {
    const est = payloadCasa(7, {
      agremiacoes: [
        agremiacao("22", "PL", 60, { cadeiras_indefinidas: 2 }),
        agremiacao("fed:1", "Federação Brasil da Esperança", 40, {
          tipo: "federacao",
          componentes: ["PT", "PC do B", "PV"],
          sigla_lider: "PT",
        }),
      ],
    });
    const dis = payloadCasa(8, {
      agremiacoes: [
        agremiacao("22", "PL", 7, { cadeiras_indefinidas: 1 }),
        // Mesma federação, e o líder de cor no DF é outro: a cor segue a do est.
        agremiacao("fed:1", "Federação Brasil da Esperança", 5, {
          tipo: "federacao",
          componentes: ["PT", "PC do B", "PV"],
          sigla_lider: "PV",
        }),
        agremiacao("50", "PSOL", 3),
      ],
    });
    const soma = somaDasCasas(est, dis);
    const porCod = new Map(soma.por_agremiacao.map((a) => [a.cod, a]));
    expect(porCod.get("22")?.cadeiras).toBe(67);
    expect(porCod.get("22")?.cadeiras_indefinidas).toBe(3);
    expect(porCod.get("fed:1")?.cadeiras).toBe(45);
    expect(porCod.get("fed:1")?.sigla_lider).toBe("PT");
    expect(porCod.get("50")?.cadeiras).toBe(3);
    expect(soma.atribuidas).toBe(115);
    expect(soma.por_agremiacao.map((a) => a.cod)).toEqual(["22", "fed:1", "50"]);
    // Votos somados, % sobre os válidos das 27 casas somadas.
    expect(porCod.get("22")?.votos_validos).toBe(67 * 1100);
    const totalValidos = 115 * 1100;
    expect(porCod.get("22")?.pct_votos).toBeCloseTo((67 * 1100 * 100) / totalValidos, 6);
    // Nunca faixa: o intervalo de uma casa não se soma ao de outra.
    for (const a of soma.por_agremiacao) expect(a.cadeiras_ci95).toBeUndefined();
  });

  it("ordem (−cadeiras, sigla, cod) — empate de cadeiras e de sigla desempata pela chave", () => {
    const est = payloadCasa(7, {
      agremiacoes: [
        agremiacao("99", "ZZ", 5),
        agremiacao("12", "AA", 5),
        agremiacao("11", "AA", 5),
        agremiacao("30", "MM", 9),
      ],
    });
    expect(somaDasCasas(est, null).por_agremiacao.map((a) => a.cod)).toEqual([
      "30",
      "11",
      "12",
      "99",
    ]);
  });

  it("🔴 aguardando negativo aparece como negativo — nunca mascarado por max(0, …)", () => {
    const est = payloadCasa(7, { agremiacoes: [agremiacao("22", "PL", 1040)], total: 1035 });
    const dis = payloadCasa(8, { agremiacoes: [agremiacao("22", "PL", 24)], total: 24 });
    const soma = somaDasCasas(est, dis);
    expect(soma.aguardando).toBe(-5);
  });

  it("sem voto nenhum: pct 0, nunca NaN", () => {
    const est = payloadCasa(7, {
      agremiacoes: [agremiacao("22", "PL", 0, { votos_validos: 0 })],
    });
    expect(somaDasCasas(est, null).por_agremiacao[0]?.pct_votos).toBe(0);
  });
});

describe("mais votados e puxadores — a união dos dois payloads", () => {
  it("🔴 M33 — o candidato do DF entra no top 10 do país, na ordem (−votos, uf, sqcand)", () => {
    const est = payloadCasa(7, {
      agremiacoes: [],
      maisVotados: Array.from({ length: 10 }, (_, i) => destaque("SP", 100 + i, 50_000 - i * 1000)),
    });
    const dis = payloadCasa(8, {
      agremiacoes: [],
      maisVotados: [destaque("DF", 7, 45_500), destaque("DF", 8, 10)],
    });
    const top = maisVotadosDasCasas(est, dis) ?? [];
    expect(top).toHaveLength(10);
    expect(top.map((d) => `${d.uf}:${d.sqcand}`)).toContain("DF:7");
    expect(top.map((d) => `${d.uf}:${d.sqcand}`)).not.toContain("DF:8");
    // 45.500 fica entre SP:104 (46.000) e SP:105 (45.000).
    expect(top.findIndex((d) => d.uf === "DF")).toBe(5);
  });

  it("empate de votos: desempata por UF e depois por sqcand — sempre a mesma ordem", () => {
    const est = payloadCasa(7, {
      agremiacoes: [],
      maisVotados: [destaque("SP", 2, 100), destaque("RJ", 9, 100), destaque("SP", 1, 100)],
    });
    const dis = payloadCasa(8, { agremiacoes: [], maisVotados: [destaque("DF", 5, 100)] });
    expect((maisVotadosDasCasas(est, dis) ?? []).map((d) => `${d.uf}:${d.sqcand}`)).toEqual([
      "DF:5",
      "RJ:9",
      "SP:1",
      "SP:2",
    ]);
  });

  it("nenhuma fonte com a lista ⇒ undefined (o bloco não aparece); uma fonte com [] ⇒ []", () => {
    const semLista = payloadCasa(7, { agremiacoes: [] });
    expect(maisVotadosDasCasas(semLista, null)).toBeUndefined();
    expect(maisVotadosDasCasas(null, null)).toBeUndefined();
    const vazia = payloadCasa(8, { agremiacoes: [], maisVotados: [] });
    expect(maisVotadosDasCasas(semLista, vazia)).toEqual([]);
  });

  it("puxadores: os 30 maiores excedentes da união, (−excedente, −votos, uf, sqcand)", () => {
    const est = payloadCasa(7, {
      agremiacoes: [],
      puxadores: Array.from({ length: 30 }, (_, i) => puxador("SP", i + 1, 10_000, 2)),
    });
    const dis = payloadCasa(8, { agremiacoes: [], puxadores: [puxador("DF", 99, 5_000, 3)] });
    const lista = puxadoresDasCasas(est, dis) ?? [];
    expect(lista).toHaveLength(30);
    expect(lista[0]?.uf).toBe("DF");
    expect(lista.at(-1)?.sqcand).toBe(29);
  });
});
