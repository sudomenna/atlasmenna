/**
 * tests/unit/deputado/lista-documento.test.ts — spec 027: nas assembleias (7 e
 * 8) o documento leva, por agremiação, o conjunto visível por padrão — os
 * eleitos + as 7 linhas válidas seguintes ao último eleito (emenda 04/10,
 * decisão do dono; até 03/10, eleitos + 5 com mínimo de 10) —; a rota da lista
 * devolve o resto (`lib/deputado/lista-documento.ts`).
 *
 * Mutações que estes casos derrubam (aplicadas à mão em 04/10):
 *   - "7" virando "6" — cai "0 eleito ⇒ 7", "25 eleitos ⇒ 32" e a contagem
 *     das fixtures;
 *   - ignorar o eleito na projeção — cai "projeção visível: o eleito na
 *     projeção conta";
 *   - a rota cortando com a projeção (R maior que o da página) — cai "a rota
 *     corta SEM projeção";
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
  restanteForaDoDocumento,
  ultimoRankNoDocumento,
} from "@/lib/deputado/lista-documento";
import { type ContextoMarcas, VISIVEIS_ABAIXO_DO_CORTE } from "@/lib/utils/deputado-marcas";
import distritalUf from "@/tests/fixtures/simulacao/deputado-distrital-uf.json" with {
  type: "json",
};
import estadualUf from "@/tests/fixtures/simulacao/deputado-estadual-uf.json" with { type: "json" };
import estadualLista from "@/tests/fixtures/simulacao/deputado-estadual-uf-lista.json" with {
  type: "json",
};

const PARCIAL: ContextoMarcas = { totalizacaoFinal: false, projecaoVisivel: false };
const PROJ: ContextoMarcas = { totalizacaoFinal: false, projecaoVisivel: true };
const FINAL: ContextoMarcas = { totalizacaoFinal: true, projecaoVisivel: false };

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

describe("o corte do documento — eleitos + 7 (emenda 04/10)", () => {
  it("a constante é a da decisão do dono", () => {
    expect(VISIVEIS_ABAIXO_DO_CORTE).toBe(7);
  });

  it("🔴 0 eleito ⇒ as 7 primeiras (o mínimo de 10 caiu)", () => {
    expect(ultimoRankNoDocumento({ candidatos: linhas(95) }, PARCIAL)).toBe(7);
    expect(linhasNoDocumento(linhas(95), 7)).toHaveLength(7);
  });

  it("🔴 1 eleito ⇒ 8", () => {
    expect(ultimoRankNoDocumento({ candidatos: linhas(95, [1]) }, PARCIAL)).toBe(8);
  });

  it("🔴 3 eleitos ⇒ 10", () => {
    expect(ultimoRankNoDocumento({ candidatos: linhas(95, ate(3)) }, PARCIAL)).toBe(10);
  });

  it("🔴 25 eleitos ⇒ 32", () => {
    const c = linhas(95, ate(25));
    expect(ultimoRankNoDocumento({ candidatos: c }, PARCIAL)).toBe(32);
    expect(linhasNoDocumento(c, 32).map((l) => l.rank)).toEqual(ate(32));
  });

  it("agremiação com 7 candidaturas e 2 eleitos ⇒ as 7 (R = 9 passa do total)", () => {
    const c = linhas(7, ate(2));
    const r = ultimoRankNoDocumento({ candidatos: c }, PARCIAL);
    expect(r).toBe(9);
    expect(linhasNoDocumento(c, r)).toHaveLength(7);
  });

  it("as 7 contam do MAIOR rank eleito (sub judice no meio não abre buraco)", () => {
    // Rank 2 sub judice, eleitos 1, 3 a 8: o último eleito é o 8º ⇒ 15.
    const c = linhas(40, [1, 3, 4, 5, 6, 7, 8], { 2: { destino: "sub_judice" } });
    expect(ultimoRankNoDocumento({ candidatos: c }, PARCIAL)).toBe(15);
  });

  it("🔴 as 7 são POSIÇÕES: linha com destino depois do corte ocupa uma delas", () => {
    // Eleitos 1..3; o 5º anulado ⇒ R = 3 + 7 = 10 (e não 11).
    const c = linhas(40, ate(3), { 5: { destino: "anulado" } });
    expect(ultimoRankNoDocumento({ candidatos: c }, PARCIAL)).toBe(10);
  });

  it("🔴 agremiação com a candidatura inteira anulada ⇒ 7, não as 60", () => {
    // DRAP indeferido: nenhuma linha válida. Contar só válidas abriria tudo.
    const anuladas = Object.fromEntries(ate(60).map((r) => [r, { destino: "anulado" as const }]));
    expect(ultimoRankNoDocumento({ candidatos: linhas(60, [], anuladas) }, PARCIAL)).toBe(7);
  });

  it("🔴 'Eleito (TSE)' (tf = s): os eleitos são os do TSE, não os da parcial", () => {
    // A nossa parcial diria 3; o TSE elegeu 12 (e 1 suplente no 13º).
    const c = linhas(60, ate(3), {
      ...Object.fromEntries(ate(12).map((r) => [r, { tse: "eleito_qp" as const }])),
      13: { tse: "suplente" },
    });
    expect(ultimoRankNoDocumento({ candidatos: c }, FINAL)).toBe(19);
    // Sem totalização final, a mesma agremiação corta pela parcial.
    expect(ultimoRankNoDocumento({ candidatos: c }, PARCIAL)).toBe(10);
  });

  it("o primeiro de fora (RF-272) sempre no documento, mesmo além de último eleito + 7", () => {
    // Eleitos 1..8; ranks 9..15 anulados ⇒ R = 15; o primeiro de fora válido
    // é o 16º, e R estende até ele.
    const anulados = Object.fromEntries(
      [9, 10, 11, 12, 13, 14, 15].map((r) => [r, { destino: "anulado" as const }]),
    );
    const c = linhas(40, ate(8), anulados);
    expect(ultimoRankNoDocumento({ candidatos: c }, PARCIAL)).toBe(15);
    expect(ultimoRankNoDocumento({ candidatos: c, corte: { primeiro_fora: 1016 } }, PARCIAL)).toBe(
      16,
    );
  });

  it("🔴 projeção visível: o eleito na projeção conta; oculta, não", () => {
    const c = linhas(60, ate(4), { 22: { projecao: "sobra" } });
    expect(ultimoRankNoDocumento({ candidatos: c }, PROJ)).toBe(29);
    expect(ultimoRankNoDocumento({ candidatos: c }, PARCIAL)).toBe(11);
  });

  it("só as assembleias usam duas faixas — o federal recolhe por CSS", () => {
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
    expect(doResto[0]).toBe(12);
    const doDoc = linhasNoDocumento(todas.slice(0, 60), 11).map((l) => l.rank);
    expect([...doDoc, ...doResto]).toEqual(ate(95));
  });

  it("25 eleitos: o resto começa no 33", () => {
    const d = detalhe([{ cod: "22", candidatos: linhas(40, ate(25)), total_candidatos: 40 }]);
    const resto = restanteForaDoDocumento(d, null);
    expect(resto.agremiacoes[0]?.candidatos.map((l) => l.rank)).toEqual(
      Array.from({ length: 8 }, (_, i) => 33 + i),
    );
  });

  it("🔴 a rota corta SEM projeção: nunca depois da página (nunca buraco)", () => {
    // Página com a projeção visível: R = 22 + 7 = 29. A rota não lê o
    // interruptor e corta em 4 + 7 = 11 — devolve 12..40; a página já tem
    // 12..29 e o cliente une por `sqcand`.
    const c = linhas(40, ate(4), { 22: { projecao: "sobra" } });
    const d = detalhe([{ cod: "22", candidatos: c, total_candidatos: 40 }]);
    const rPagina = ultimoRankNoDocumento({ candidatos: c }, PROJ);
    const doResto = restanteForaDoDocumento(d, null).agremiacoes[0]?.candidatos.map((l) => l.rank);
    expect(doResto?.[0]).toBe(12);
    const doc = linhasNoDocumento(c, rPagina).map((l) => l.rank);
    expect([...new Set([...doc, ...(doResto ?? [])])].sort((a, b) => a - b)).toEqual(ate(40));
  });

  it("envelope: o `ts`, o cargo e a UF do objeto; agremiação sem resto não entra", () => {
    const d = detalhe([
      { cod: "22", candidatos: linhas(30), total_candidatos: 30 },
      { cod: "13", candidatos: linhas(6), total_candidatos: 6 },
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
    expect(ranks).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
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
      const r = ultimoRankNoDocumento(agr, {
        totalizacaoFinal: SP.totalizacao_final,
        projecaoVisivel: false,
      });
      const doc = linhasNoDocumento(agr.candidatos ?? [], r).map((l) => l.rank);
      noDocumento += doc.length;
      const rest = resto.agremiacoes.find((a) => a.cod === agr.cod)?.candidatos ?? [];
      expect([...doc, ...rest.map((l) => l.rank)], agr.cod).toEqual(ate(agr.total_candidatos ?? 0));
    }
    // 21 agremiações com 4 eleitos (⇒ 11), 2 com 5 (⇒ 12) e 3 sem eleito,
    // com a candidatura inteira anulada (⇒ 7): 276 linhas — eram 260 com
    // "eleitos + 5, mínimo 10" e 1.560 nas três faixas (60 por agremiação).
    expect(noDocumento).toBe(276);
  });

  it("🔴 DF distrital (sem objeto de lista): documento ∪ resto = 1..25", () => {
    const resto = restanteForaDoDocumento(DF, null);
    for (const agr of DF.agremiacoes) {
      const r = ultimoRankNoDocumento(agr, {
        totalizacaoFinal: DF.totalizacao_final,
        projecaoVisivel: false,
      });
      const doc = linhasNoDocumento(agr.candidatos ?? [], r).map((l) => l.rank);
      const rest = resto.agremiacoes.find((a) => a.cod === agr.cod)?.candidatos ?? [];
      expect([...doc, ...rest.map((l) => l.rank)], agr.cod).toEqual(ate(agr.total_candidatos ?? 0));
    }
  });
});
