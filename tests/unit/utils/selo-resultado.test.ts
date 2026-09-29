/**
 * tests/unit/utils/selo-resultado.test.ts
 *
 * A regra do selo dos dois cartões da versão D (`lib/utils/selo-resultado.ts`).
 * Função pura: cada caso é uma combinação turno × cargo × base que a tela vai
 * encontrar, com a lista JÁ na ordem da base (é assim que o painel chama).
 */

import { describe, expect, it } from "vitest";

import type { EdgeDestinoVoto } from "@/lib/edge-config/types";
import {
  type CandidatoSelo,
  selosDaBase,
  TURNO_LABEL,
  VAGA_LABEL,
} from "@/lib/utils/selo-resultado";

const c = (
  id: number,
  pct_atual: number,
  pct_projetado: number,
  destino?: EdgeDestinoVoto,
): CandidatoSelo => ({ id, pct_atual, pct_projetado, ...(destino ? { destino } : {}) });

/** Já ordenada pela base de uso em cada caso. */
const DISPUTADA = [c(1, 40, 41), c(2, 35, 36), c(3, 15, 14), c(4, 10, 9)];

const comoObjeto = (m: Map<number, string>) => Object.fromEntries(m);

describe("regra 'turno' — Presidente na home e Governador por UF, 1º turno", () => {
  it("sem maioria: os dois primeiros, com o texto da base", () => {
    expect(comoObjeto(selosDaBase(DISPUTADA, "proj", { regra: "turno", turno: 1 }))).toEqual({
      1: "2º turno · projeção",
      2: "2º turno · projeção",
    });
    expect(comoObjeto(selosDaBase(DISPUTADA, "parcial", { regra: "turno", turno: 1 }))).toEqual({
      1: "2º turno · na parcial",
      2: "2º turno · na parcial",
    });
  });

  it("🔴 líder > 50% NA BASE: só ele, com o texto do 1º turno; o 2º fica sem selo", () => {
    const lista = [c(1, 49, 52), c(2, 30, 30), c(3, 21, 18)];
    expect(comoObjeto(selosDaBase(lista, "proj", { regra: "turno", turno: 1 }))).toEqual({
      1: "Vence no 1º turno · projeção",
    });
    // Na parcial o MESMO líder tem 49% ⇒ 2º turno para os dois.
    expect(comoObjeto(selosDaBase(lista, "parcial", { regra: "turno", turno: 1 }))).toEqual({
      1: "2º turno · na parcial",
      2: "2º turno · na parcial",
    });
    const vencendoNaParcial = [c(1, 55, 49), c(2, 30, 30)];
    expect(
      comoObjeto(selosDaBase(vencendoNaParcial, "parcial", { regra: "turno", turno: 1 })),
    ).toEqual({ 1: "Venceria no 1º turno · na parcial" });
  });

  it("🔴 exatamente 50,0% NÃO é maioria absoluta — continua 2º turno", () => {
    const lista = [c(1, 50, 50), c(2, 30, 30)];
    expect(comoObjeto(selosDaBase(lista, "proj", { regra: "turno", turno: 1 }))).toEqual({
      1: "2º turno · projeção",
      2: "2º turno · projeção",
    });
  });

  it("turno ausente é tratado como 1º turno", () => {
    expect(selosDaBase(DISPUTADA, "proj", { regra: "turno" }).size).toBe(2);
  });
});

describe("2º turno ⇒ nenhum selo, em regra nenhuma", () => {
  it.each(["turno", "vaga"] as const)("regra %s", (regra) => {
    expect(selosDaBase(DISPUTADA, "proj", { regra, turno: 2, vagas: 2 }).size).toBe(0);
    expect(selosDaBase(DISPUTADA, "parcial", { regra, turno: 2, vagas: 2 }).size).toBe(0);
  });
});

describe("regra 'vaga' — Senador", () => {
  it("duas vagas: os dois primeiros, com o texto do `<VagaBadge>`", () => {
    expect(comoObjeto(selosDaBase(DISPUTADA, "proj", { regra: "vaga", vagas: 2 }))).toEqual({
      1: VAGA_LABEL.proj,
      2: VAGA_LABEL.proj,
    });
    expect(comoObjeto(selosDaBase(DISPUTADA, "parcial", { regra: "vaga", vagas: 2 }))).toEqual({
      1: VAGA_LABEL.parcial,
      2: VAGA_LABEL.parcial,
    });
  });

  it("maioria não muda nada no Senado — não há 1º turno a vencer", () => {
    const lista = [c(1, 70, 70), c(2, 20, 20), c(3, 10, 10)];
    expect(selosDaBase(lista, "proj", { regra: "vaga", vagas: 2 }).size).toBe(2);
  });

  it("uma vaga: só o primeiro; vagas absurdas não passam dos dois cartões", () => {
    expect([...selosDaBase(DISPUTADA, "proj", { regra: "vaga", vagas: 1 }).keys()]).toEqual([1]);
    expect(selosDaBase(DISPUTADA, "proj", { regra: "vaga", vagas: 9 }).size).toBe(2);
    expect(selosDaBase(DISPUTADA, "proj", { regra: "vaga", vagas: Number.NaN }).size).toBe(1);
  });
});

describe("regra 'nenhum' — Presidente na tela do estado", () => {
  it("nunca há selo, nem com maioria", () => {
    expect(selosDaBase(DISPUTADA, "proj", { regra: "nenhum", turno: 1 }).size).toBe(0);
    expect(selosDaBase([c(1, 80, 80), c(2, 20, 20)], "proj", { regra: "nenhum" }).size).toBe(0);
  });
});

describe("🔴 ADR-0053 — a anulada nunca ganha selo", () => {
  it("anulada no topo da lista: os selos vão para as duas primeiras que DISPUTAM", () => {
    const lista = [c(9, 45, 45, "anulado"), c(1, 30, 30), c(2, 15, 15), c(3, 10, 10)];
    expect(comoObjeto(selosDaBase(lista, "proj", { regra: "turno", turno: 1 }))).toEqual({
      1: "2º turno · projeção",
      2: "2º turno · projeção",
    });
    expect(selosDaBase(lista, "proj", { regra: "vaga", vagas: 2 }).has(9)).toBe(false);
  });

  it("a maioria é medida no líder que DISPUTA, não na anulada", () => {
    const lista = [c(9, 60, 60, "anulado"), c(1, 30, 30), c(2, 10, 10)];
    expect(selosDaBase(lista, "proj", { regra: "turno", turno: 1 }).get(9)).toBeUndefined();
    expect(selosDaBase(lista, "proj", { regra: "turno", turno: 1 }).get(1)).toBe(
      "2º turno · projeção",
    );
  });

  it("sub judice disputa, e ganha selo normalmente", () => {
    const lista = [c(1, 40, 40, "sub_judice"), c(2, 30, 30)];
    expect(selosDaBase(lista, "proj", { regra: "turno", turno: 1 }).get(1)).toBe(
      "2º turno · projeção",
    );
  });
});

describe("constituição § 1 — todo selo diz de que base vem", () => {
  it("nenhum texto é 'Eleito'/'Não eleito' solto", () => {
    const todos = [
      ...Object.values(VAGA_LABEL),
      ...Object.values(TURNO_LABEL.primeiro),
      ...Object.values(TURNO_LABEL.segundo),
    ];
    for (const t of todos) {
      expect(t).not.toMatch(/eleit/i);
      expect(t).toMatch(/projeç|projetad|parcial/);
    }
  });
});
