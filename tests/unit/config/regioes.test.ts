/**
 * tests/unit/config/regioes.test.ts — ADR-0057 item 1.
 *
 * As 27 UFs, cada uma em EXATAMENTE uma região, e a ordem de exibição fixa.
 */

import { describe, expect, it } from "vitest";

import { UF_NOMES } from "@/components/atoms/maps/_shared";
import { agruparPorRegiao, REGIAO_DA_UF, REGIOES } from "@/lib/config/regioes";

describe("REGIOES (IBGE)", () => {
  it("ordem de exibição: Norte, Nordeste, Centro-Oeste, Sudeste, Sul", () => {
    expect(REGIOES.map((r) => r.nome)).toEqual([
      "Norte",
      "Nordeste",
      "Centro-Oeste",
      "Sudeste",
      "Sul",
    ]);
  });

  it("as 27 UFs estão em exatamente uma região", () => {
    const todas = REGIOES.flatMap((r) => r.siglas);
    expect(todas).toHaveLength(27);
    expect(new Set(todas).size).toBe(27);
    expect([...todas].sort()).toEqual(Object.keys(UF_NOMES).sort());
    for (const s of Object.keys(UF_NOMES)) {
      expect(REGIOES.filter((r) => r.siglas.includes(s))).toHaveLength(1);
    }
  });

  it("composição exata de cada região", () => {
    const por = Object.fromEntries(REGIOES.map((r) => [r.id, [...r.siglas]]));
    expect(por).toEqual({
      norte: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
      nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
      centro_oeste: ["DF", "GO", "MS", "MT"],
      sudeste: ["ES", "MG", "RJ", "SP"],
      sul: ["PR", "RS", "SC"],
    });
  });

  it("dentro da região, siglas em ordem alfabética", () => {
    for (const r of REGIOES) expect([...r.siglas]).toEqual([...r.siglas].sort());
  });

  it("REGIAO_DA_UF cobre as 27 e bate com REGIOES", () => {
    expect(Object.keys(REGIAO_DA_UF)).toHaveLength(27);
    expect(REGIAO_DA_UF.DF).toBe("centro_oeste");
    expect(REGIAO_DA_UF.TO).toBe("norte");
    expect(REGIAO_DA_UF.XX).toBeUndefined();
  });
});

describe("agruparPorRegiao", () => {
  it("sempre as 5 regiões, na ordem, com as linhas na ordem da região", () => {
    const rows = [{ sigla: "SP" }, { sigla: "AC" }, { sigla: "RS" }, { sigla: "ES" }];
    const g = agruparPorRegiao(rows);
    expect(g.map((x) => x.regiao.id)).toEqual([
      "norte",
      "nordeste",
      "centro_oeste",
      "sudeste",
      "sul",
    ]);
    expect(g[0]?.rows.map((r) => r.sigla)).toEqual(["AC"]);
    expect(g[1]?.rows).toEqual([]);
    expect(g[3]?.rows.map((r) => r.sigla)).toEqual(["ES", "SP"]);
    expect(g[4]?.rows.map((r) => r.sigla)).toEqual(["RS"]);
  });

  it("descarta sigla fora das 27 e repetida", () => {
    const g = agruparPorRegiao([{ sigla: "ZZ" }, { sigla: "SP", n: 1 }, { sigla: "SP", n: 2 }]);
    expect(g.flatMap((x) => x.rows)).toEqual([{ sigla: "SP", n: 1 }]);
  });
});
