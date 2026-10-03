/**
 * tests/unit/deputado/lista-documento.test.ts — spec 027, decisão do dono de
 * 03/10: nas assembleias (7 e 8) o documento leva, por agremiação, os eleitos
 * na parcial + os 5 seguintes por rank, com mínimo de 10; a rota da lista
 * devolve o resto (`lib/deputado/lista-documento.ts`).
 *
 * Mutações aplicadas à mão (03/10) e que estes casos derrubam:
 *   - "+5" virando "+0" — cai "25 eleitos ⇒ 30", "6 eleitos ⇒ 11", o do TSE
 *     e "o resto começa no 31" (com 3 eleitos o mínimo de 10 cobre, de
 *     propósito: é o caso do mínimo, não o do +5);
 *   - mínimo 10 removido — cai "0 eleito ⇒ 10", "3 eleitos ⇒ 10" e a
 *     contagem de 260 linhas das fixtures;
 *   - a rota do estadual devolvendo só as 61+ — cai em
 *     `tests/unit/api/deputado-lista-assembleia-route.test.ts`.
 */

import { describe, expect, it } from "vitest";

import type {
  DeputadoUfAgremiacao,
  DeputadoUfDetail,
  DeputadoUfLinha,
  DeputadoUfLista,
} from "@/lib/blob/deputado-uf";
import {
  linhasNoDocumento,
  listaEmDuasFaixas,
  MINIMO_NO_DOCUMENTO,
  restanteForaDoDocumento,
  SEGUINTES_AO_ULTIMO_ELEITO,
  ultimoRankNoDocumento,
} from "@/lib/deputado/lista-documento";
import distritalUf from "@/tests/fixtures/simulacao/deputado-distrital-uf.json" with {
  type: "json",
};
import estadualUf from "@/tests/fixtures/simulacao/deputado-estadual-uf.json" with { type: "json" };
import estadualLista from "@/tests/fixtures/simulacao/deputado-estadual-uf-lista.json" with {
  type: "json",
};

/** `n` linhas de rank 1..n; as de `eleitos` (ranks) com `parcial`. */
function linhas(
  n: number,
  eleitos: readonly number[] = [],
  extra: Partial<Record<number, Partial<DeputadoUfLinha>>> = {},
): DeputadoUfLinha[] {
  return Array.from({ length: n }, (_, i) => {
    const rank = i + 1;
    return {
      sqcand: 1000 + rank,
      nome: `C${rank}`,
      partido: "PX",
      votos: 10_000 - rank,
      rank,
      pct_validos: 1,
      ...(eleitos.includes(rank) ? { parcial: "qp" as const } : {}),
      ...extra[rank],
    };
  });
}

const ate = (k: number) => Array.from({ length: k }, (_, i) => i + 1);

describe("o corte do documento — eleitos + 5, mínimo 10", () => {
  it("as constantes são as da decisão do dono", () => {
    expect(MINIMO_NO_DOCUMENTO).toBe(10);
    expect(SEGUINTES_AO_ULTIMO_ELEITO).toBe(5);
  });

  it("🔴 0 eleito ⇒ 10", () => {
    expect(ultimoRankNoDocumento({ candidatos: linhas(95) }, false)).toBe(10);
    expect(linhasNoDocumento(linhas(95), 10)).toHaveLength(10);
  });

  it("🔴 3 eleitos ⇒ 8 ⇒ mínimo 10", () => {
    expect(ultimoRankNoDocumento({ candidatos: linhas(95, ate(3)) }, false)).toBe(10);
  });

  it("🔴 25 eleitos ⇒ 30", () => {
    const c = linhas(95, ate(25));
    expect(ultimoRankNoDocumento({ candidatos: c }, false)).toBe(30);
    expect(linhasNoDocumento(c, 30).map((l) => l.rank)).toEqual(ate(30));
  });

  it("6 eleitos ⇒ 11 (passa do mínimo)", () => {
    expect(ultimoRankNoDocumento({ candidatos: linhas(95, ate(6)) }, false)).toBe(11);
  });

  it("agremiação com 7 candidaturas ⇒ as 7", () => {
    const c = linhas(7, ate(2));
    const r = ultimoRankNoDocumento({ candidatos: c }, false);
    expect(linhasNoDocumento(c, r)).toHaveLength(7);
  });

  it("os 5 seguintes contam do MAIOR rank eleito (anulado no meio não abre buraco)", () => {
    // Rank 2 sub judice, eleitos 1, 3 a 8: o último eleito é o 8º ⇒ 13.
    const c = linhas(40, [1, 3, 4, 5, 6, 7, 8], { 2: { destino: "sub_judice" } });
    expect(ultimoRankNoDocumento({ candidatos: c }, false)).toBe(13);
  });

  it("🔴 'Eleito (TSE)' (tf = s): os eleitos são os do TSE, não os da parcial", () => {
    // A nossa parcial diria 3; o TSE elegeu 12 (e 1 suplente no 13º).
    const c = linhas(60, ate(3), {
      ...Object.fromEntries(ate(12).map((r) => [r, { tse: "eleito_qp" as const }])),
      13: { tse: "suplente" },
    });
    expect(ultimoRankNoDocumento({ candidatos: c }, true)).toBe(17);
    // Sem totalização final, a mesma agremiação corta pela parcial.
    expect(ultimoRankNoDocumento({ candidatos: c }, false)).toBe(10);
  });

  it("o primeiro de fora (RF-272) sempre no documento, mesmo além de último eleito + 5", () => {
    // Eleitos 1..8; ranks 9..14 anulados; o primeiro de fora válido é o 15º.
    const anulados = Object.fromEntries(
      [9, 10, 11, 12, 13, 14].map((r) => [r, { destino: "anulado" as const }]),
    );
    const c = linhas(40, ate(8), anulados);
    expect(ultimoRankNoDocumento({ candidatos: c, corte: { primeiro_fora: 1015 } }, false)).toBe(
      15,
    );
  });

  it("marca de projeção nunca atrás do clique (ADR-0065 D1)", () => {
    const c = linhas(60, ate(4), { 22: { projecao: "sobra" } });
    expect(ultimoRankNoDocumento({ candidatos: c }, false)).toBe(22);
  });

  it("só as assembleias usam duas faixas — o federal fica nas três", () => {
    expect(listaEmDuasFaixas(6)).toBe(false);
    expect(listaEmDuasFaixas(7)).toBe(true);
    expect(listaEmDuasFaixas(8)).toBe(true);
  });
});

/** Objeto de UF mínimo com as agremiações dadas. */
function detalhe(
  agremiacoes: Array<Pick<DeputadoUfAgremiacao, "cod" | "candidatos" | "total_candidatos">>,
  over: Partial<DeputadoUfDetail> = {},
): DeputadoUfDetail {
  return {
    ts: "2026-10-04T22:00:00Z",
    cargo: 7,
    turno: 1,
    uf: "SP",
    totalizacao_final: false,
    agremiacoes,
    ...over,
  } as unknown as DeputadoUfDetail;
}

describe("o resto que a rota devolve", () => {
  it("🔴 documento ∪ resto = 1..total, sem repetir nem pular (objeto 1..60 + lista 61..95)", () => {
    const todas = linhas(95, ate(4));
    const d = detalhe([{ cod: "22", candidatos: todas.slice(0, 60), total_candidatos: 95 }]);
    const lista: DeputadoUfLista = {
      ts: d.ts,
      cargo: 7,
      turno: 1,
      contrato: 2,
      uf: "SP",
      agremiacoes: [{ cod: "22", candidatos: todas.slice(60) }],
    };
    const resto = restanteForaDoDocumento(d, lista);
    const doResto = resto.agremiacoes[0]?.candidatos.map((l) => l.rank) ?? [];
    expect(doResto[0]).toBe(11);
    const doDoc = linhasNoDocumento(todas.slice(0, 60), 10).map((l) => l.rank);
    expect([...doDoc, ...doResto]).toEqual(ate(95));
  });

  it("25 eleitos: o resto começa no 31", () => {
    const d = detalhe([{ cod: "22", candidatos: linhas(40, ate(25)), total_candidatos: 40 }]);
    const resto = restanteForaDoDocumento(d, null);
    expect(resto.agremiacoes[0]?.candidatos.map((l) => l.rank)).toEqual(
      Array.from({ length: 10 }, (_, i) => 31 + i),
    );
  });

  it("envelope: o `ts`, o cargo e a UF do objeto; agremiação sem resto não entra", () => {
    const d = detalhe([
      { cod: "22", candidatos: linhas(30), total_candidatos: 30 },
      { cod: "13", candidatos: linhas(7), total_candidatos: 7 },
    ]);
    const resto = restanteForaDoDocumento(d, null);
    expect(resto).toMatchObject({ ts: d.ts, cargo: 7, turno: 1, contrato: 2, uf: "SP" });
    expect(resto.agremiacoes.map((a) => a.cod)).toEqual(["22"]);
  });

  it("a mesma candidatura nos dois objetos sai uma vez só", () => {
    const todas = linhas(20);
    const d = detalhe([{ cod: "22", candidatos: todas, total_candidatos: 20 }]);
    const lista = {
      ts: d.ts,
      cargo: 7 as const,
      turno: 1 as const,
      contrato: 2 as const,
      uf: "SP",
      agremiacoes: [{ cod: "22", candidatos: todas.slice(15) }],
    };
    const ranks = restanteForaDoDocumento(d, lista).agremiacoes[0]?.candidatos.map((l) => l.rank);
    expect(ranks).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });
});

describe("as fixtures das assembleias (o simulado do e2e)", () => {
  const SP = (estadualUf as unknown as Record<string, DeputadoUfDetail>).SP as DeputadoUfDetail;
  const LISTA_SP = (estadualLista as unknown as Record<string, DeputadoUfLista>)
    .SP as DeputadoUfLista;
  const DF = (distritalUf as unknown as Record<string, DeputadoUfDetail>).DF as DeputadoUfDetail;

  it("🔴 SP estadual: em TODA agremiação, documento ∪ resto = 1..total_candidatos", () => {
    const resto = restanteForaDoDocumento(SP, LISTA_SP);
    let noDocumento = 0;
    for (const agr of SP.agremiacoes) {
      const r = ultimoRankNoDocumento(agr, SP.totalizacao_final);
      const doc = linhasNoDocumento(agr.candidatos ?? [], r).map((l) => l.rank);
      noDocumento += doc.length;
      const rest = resto.agremiacoes.find((a) => a.cod === agr.cod)?.candidatos ?? [];
      expect([...doc, ...rest.map((l) => l.rank)], agr.cod).toEqual(ate(agr.total_candidatos ?? 0));
    }
    // 23 agremiações com 4–5 eleitos (⇒ 10) e 3 sem eleito (⇒ 10): 260 linhas,
    // contra 1.560 das três faixas (60 por agremiação).
    expect(noDocumento).toBe(260);
  });

  it("🔴 DF distrital (sem objeto de lista): documento ∪ resto = 1..25", () => {
    const resto = restanteForaDoDocumento(DF, null);
    for (const agr of DF.agremiacoes) {
      const r = ultimoRankNoDocumento(agr, DF.totalizacao_final);
      const doc = linhasNoDocumento(agr.candidatos ?? [], r).map((l) => l.rank);
      const rest = resto.agremiacoes.find((a) => a.cod === agr.cod)?.candidatos ?? [];
      expect([...doc, ...rest.map((l) => l.rank)], agr.cod).toEqual(ate(agr.total_candidatos ?? 0));
    }
  });
});
