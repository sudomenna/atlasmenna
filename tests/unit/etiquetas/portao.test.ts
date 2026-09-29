/**
 * tests/unit/etiquetas/portao.test.ts
 *
 * Portão de cobertura (spec 024, RF-233) e invariância de ordem (RF-238).
 */

import { describe, expect, it } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";
import { PORTAO_MARGEM_PP } from "@/lib/etiquetas/catalogo";
import {
  avaliarCamara2027,
  avaliarCorridas,
  avaliarSenado2031,
  type CandidatoNaCorrida,
  type CorridaPortao,
  comChance,
  corridaDeUfRow,
  juntarPortoes,
  posicoesQueElegem,
} from "@/lib/etiquetas/portao";

import { expectOrdemInvariante } from "./ordem-invariante";

function cand(
  sqcand: string | null,
  pct_projetado: number,
  pct_atual?: number | null,
  destino?: CandidatoNaCorrida["destino"],
): CandidatoNaCorrida {
  return { sqcand, id: Number(sqcand?.slice(-2) ?? 0), pct_projetado, pct_atual, destino };
}

function corrida(
  candidatos: CandidatoNaCorrida[],
  over: Partial<CorridaPortao> = {},
): CorridaPortao {
  return { chave: "SP", posicoes: 2, preEleicao: false, pctApurado: 40, candidatos, ...over };
}

const ids = (r: { membros: CandidatoNaCorrida[] }) => r.membros.map((m) => String(m.sqcand));

describe("RF-233 — quem tem chance", () => {
  it("o colchão é o do catálogo (5 pp)", () => {
    expect(PORTAO_MARGEM_PP).toBe(5);
  });

  it("🔴 a exatamente 5,0 pp da última posição que elege está DENTRO; a 5,01, fora", () => {
    const c = corrida([cand("11", 40), cand("12", 30), cand("13", 25), cand("14", 24.99)], {
      pctApurado: 0,
    });
    expect(ids(comChance(c))).toEqual(["11", "12", "13"]);
  });

  it("tolerância de ponto flutuante no limite (23,4 − 18,4)", () => {
    const c = corrida([cand("11", 50), cand("12", 23.4), cand("13", 18.4)], { pctApurado: 0 });
    expect(ids(comChance(c))).toContain("13");
  });

  it("🔴 UNIÃO das bases: fora na Projeção mas dentro na Parcial entra", () => {
    const c = corrida([
      cand("11", 45, 20),
      cand("12", 40, 21),
      cand("13", 10, 30), // Projeção: 30 pp atrás; Parcial: lidera
    ]);
    expect(ids(comChance(c))).toEqual(["11", "12", "13"]);
    // e o inverso: dentro na Projeção, fora na Parcial
    const d = corrida([cand("11", 45, 60), cand("12", 40, 50), cand("13", 36, 5)]);
    expect(ids(comChance(d))).toEqual(["11", "12", "13"]);
  });

  it("Parcial só entra com a corrida apurando (zero apurado = empate que não é medição)", () => {
    const c = corrida([cand("11", 45, 0), cand("12", 40, 0), cand("13", 10, 0)], { pctApurado: 0 });
    expect(ids(comChance(c))).toEqual(["11", "12"]);
  });

  it("🔴 anulado não conta — e não empurra a linha de corte", () => {
    const c = corrida(
      [cand("11", 45), cand("12", 40, null, "anulado"), cand("13", 30), cand("14", 26)],
      {
        pctApurado: 0,
      },
    );
    // Sem o anulado, as 2 vagas são 01 e 03; 04 está a 4 pp de 03.
    expect(ids(comChance(c))).toEqual(["11", "13", "14"]);
  });

  it("sub_judice compete", () => {
    const c = corrida([cand("11", 45), cand("12", 40, null, "sub_judice"), cand("13", 10)], {
      pctApurado: 0,
    });
    expect(ids(comChance(c))).toEqual(["11", "12"]);
  });

  it("sem número numa base ⇒ com chance (não dá para descartar)", () => {
    const c = corrida([cand("11", 45, 30), cand("12", 40, 25), cand("13", 1, null)]);
    expect(ids(comChance(c))).toEqual(["11", "12", "13"]);
  });

  it("Senado usa as vagas da UF; Governador, 2 nos dois turnos", () => {
    expect(posicoesQueElegem(5, 1, 2)).toBe(2);
    expect(posicoesQueElegem(5, 1, 1)).toBe(1);
    expect(posicoesQueElegem(5, 1, null)).toBe(2);
    expect(posicoesQueElegem(3, 1)).toBe(2);
    expect(posicoesQueElegem(3, 2)).toBe(2);
  });

  it("pré-eleição: a corrida inteira, e exige o universo", () => {
    const c = corrida([cand("11", 0), cand("12", 0), cand("13", 0, null, "anulado")], {
      preEleicao: true,
    });
    const r = comChance(c);
    expect(ids(r)).toEqual(["11", "12"]);
    expect(r.exigeUniverso).toBe(true);
  });

  it("cauda que alcança o colchão exige o universo", () => {
    const c = corrida([cand("11", 45), cand("12", 20), cand("13", 10)], {
      pctApurado: 0,
      cauda: { pct: 16 },
    });
    expect(comChance(c).exigeUniverso).toBe(true);
    expect(comChance({ ...c, cauda: { pct: 14.9 } }).exigeUniverso).toBe(false);
  });
});

describe("RF-233 — avaliação", () => {
  const classificados = new Set(["11", "12"]);
  const f = (sq: string) => classificados.has(sq);

  it("ok quando todos com chance estão classificados", () => {
    const r = avaliarCorridas(
      [corrida([cand("11", 45), cand("12", 40), cand("13", 10)], { pctApurado: 0 })],
      f,
    );
    expect(r).toEqual({ ok: true, bloqueantes: [] });
  });

  it("lista quem bloqueia, com o motivo", () => {
    const r = avaliarCorridas(
      [
        corrida([cand("11", 45), cand("12", 40), cand("13", 37), cand(null, 36)], {
          pctApurado: 0,
        }),
      ],
      f,
    );
    expect(r.ok).toBe(false);
    expect(r.bloqueantes.map((b) => [b.chave, b.motivo])).toEqual([
      ["13", "a_classificar"],
      [null, "sem_sqcand"],
    ]);
  });

  it("universo exigido: sem ele bloqueia; com ele, confere todos (menos o anulado)", () => {
    const base = corrida([cand("11", 0), cand("12", 0), cand("19", 0, null, "anulado")], {
      preEleicao: true,
    });
    expect(avaliarCorridas([base], f).bloqueantes).toEqual([
      { corrida: "SP", chave: null, motivo: "cauda_sem_universo" },
    ]);
    const comUniverso = { ...base, universo: ["11", "12", "19", 4] };
    expect(avaliarCorridas([comUniverso], f).bloqueantes.map((b) => b.chave)).toEqual(["4"]);
  });

  it("senado2031: indisponível ou ≠ 27 bloqueia; todos classificados passa", () => {
    const cods = Array.from({ length: 27 }, (_, i) => String(5000 + i));
    expect(avaliarSenado2031({ disponivel: false, codigos: cods }, () => true).ok).toBe(false);
    expect(avaliarSenado2031({ disponivel: true, codigos: cods.slice(1) }, () => true).ok).toBe(
      false,
    );
    expect(avaliarSenado2031({ disponivel: true, codigos: cods }, () => true).ok).toBe(true);
    const r = avaliarSenado2031({ disponivel: true, codigos: cods }, (c) => c !== "5003");
    expect(r.bloqueantes).toEqual([
      { corrida: "senado2031", chave: "senado:5003", motivo: "a_classificar" },
    ]);
  });

  it("Câmara 2027: só agremiação com cadeira > 0", () => {
    const r = avaliarCamara2027(
      [
        { sigla: "PL", tipo: "partido", cadeiras: 90 },
        { sigla: "PT/PC do B/PV", tipo: "federacao", cadeiras: 80 },
        { sigla: "PCO", tipo: "partido", cadeiras: 0 },
      ],
      (s) => s === "PL",
    );
    expect(r.bloqueantes.map((b) => b.nome)).toEqual(["PT/PC do B/PV"]);
  });

  it("juntar", () => {
    expect(juntarPortoes({ ok: true, bloqueantes: [] }, { ok: false, bloqueantes: [] }).ok).toBe(
      false,
    );
  });

  it("adaptador da linha do payload (pct → Projeção, outros → cauda)", () => {
    const row = {
      sigla: "RJ",
      pct_apurado: 12,
      top_candidatos: [
        { id: 13, pct: 40, sqcand: "1", pct_atual: 41 },
        { id: 22, pct: 38, sqcand: "2", destino: "anulado" },
      ],
      outros: { pct: 3, pct_atual: 2, n_candidatos: 4 },
    } as unknown as EdgeUfRow;
    const c = corridaDeUfRow(row, { cargo: 5, turno: 1, preEleicao: false, vagasUf: 2 });
    expect(c).toMatchObject({
      chave: "RJ",
      posicoes: 2,
      pctApurado: 12,
      cauda: { pct: 3, pct_atual: 2 },
    });
    expect(c.candidatos[1]).toMatchObject({
      sqcand: "2",
      pct_projetado: 38,
      pct_atual: null,
      destino: "anulado",
    });
  });
});

describe("RF-238 — o portão nunca reordena", () => {
  const candidatos = [
    cand("11", 30, 10),
    cand("12", 45, 50),
    cand("13", 28, 49),
    cand("14", 44, 20),
  ];
  const c = corrida(candidatos);

  it("🔴 membros e bloqueantes na ordem de ENTRADA, com qualquer classificação", () => {
    expectOrdemInvariante({
      ids: ["11", "12", "13", "14"],
      ordenar: () => comChance(c).membros.map((m) => String(m.sqcand)),
    });
    // Os bloqueantes são um subconjunto — e sempre na ordem de entrada.
    for (const alvo of [new Set<string>(), new Set(["12"]), new Set(["11", "14"])]) {
      const r = avaliarCorridas([c], (sq) => alvo.has(sq));
      const ordem = r.bloqueantes.map((b) => b.chave as string);
      expect(ordem).toEqual(
        [...ordem].sort(
          (a, b) =>
            candidatos.findIndex((x) => x.sqcand === a) -
            candidatos.findIndex((x) => x.sqcand === b),
        ),
      );
    }
  });
});
