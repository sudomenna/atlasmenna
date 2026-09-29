/**
 * tests/unit/utils/vagas-eleitas.test.ts
 *
 * O ponto único de "quem ocupa as vagas" (`lib/utils/vagas-eleitas.ts`) e a
 * leitura sem default de quantas vagas cada corrida elege
 * (`vagasDaCorrida`, `lib/config/cargos.ts`) — 2026-09-29, decisão do dono:
 * "são 2 senadores eleitos".
 *
 * `VAGAS_SENADO` é LITERAL de propósito (mesma razão de
 * `tests/unit/pages/senador.test.tsx`): se o teste lesse a tabela, uma troca
 * na tabela passaria sem ninguém reclamar.
 */

import { describe, expect, it } from "vitest";

import { vagasDaCorrida } from "@/lib/config/cargos";
import type { EdgeDestinoVoto } from "@/lib/edge-config/types";
import { idsDasVagas, ocupantesDasVagas } from "@/lib/utils/vagas-eleitas";

const VAGAS_SENADO = 2;

const c = (id: number, destino?: EdgeDestinoVoto) => ({ id, ...(destino ? { destino } : {}) });

const ids = (lista: readonly { id: number }[]) => lista.map((x) => x.id);

describe("ocupantesDasVagas — os `vagas` primeiros que DISPUTAM, na ordem da base", () => {
  it("Senado: os DOIS primeiros, nunca só o líder, nunca o 3º", () => {
    // Mutação "vagas=1 para o Senado" / "só o rank 1": devolveria [1].
    expect(ids(ocupantesDasVagas([c(1), c(2), c(3), c(4)], VAGAS_SENADO))).toEqual([1, 2]);
  });

  it("anulada não ocupa vaga — o 3º que disputa sobe (ADR-0053 / RF-213)", () => {
    // Mutação "anulada contada": devolveria [1, 9].
    expect(ids(ocupantesDasVagas([c(1), c(9, "anulado"), c(2), c(3)], VAGAS_SENADO))).toEqual([
      1, 2,
    ]);
    // Anulada no topo também não rouba a 1ª vaga.
    expect(ids(ocupantesDasVagas([c(9, "anulado"), c(1), c(2)], VAGAS_SENADO))).toEqual([1, 2]);
  });

  it("sub judice e destino ausente disputam", () => {
    expect(ids(ocupantesDasVagas([c(1, "sub_judice"), c(2, "valido"), c(3)], 2))).toEqual([1, 2]);
  });

  it("a ORDEM recebida manda — a função não reordena (é a base de quem chama)", () => {
    expect(ids(ocupantesDasVagas([c(3), c(1), c(2)], VAGAS_SENADO))).toEqual([3, 1]);
  });

  it("vaga única: só o primeiro que disputa (Governador/Presidente intocados)", () => {
    expect(ids(ocupantesDasVagas([c(1), c(2), c(3)], 1))).toEqual([1]);
    expect(ids(ocupantesDasVagas([c(9, "anulado"), c(2), c(3)], 1))).toEqual([2]);
  });

  it("menos candidaturas que disputam do que vagas: todas as que disputam", () => {
    expect(ids(ocupantesDasVagas([c(1), c(9, "anulado")], VAGAS_SENADO))).toEqual([1]);
    expect(ocupantesDasVagas([], VAGAS_SENADO)).toEqual([]);
  });

  it("vagas inválidas marcam NINGUÉM — nunca o default silencioso de uma vaga", () => {
    for (const v of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ocupantesDasVagas([c(1), c(2)], v)).toEqual([]);
    }
    // Fracionário trunca: 2,9 vagas são 2.
    expect(ids(ocupantesDasVagas([c(1), c(2), c(3)], 2.9))).toEqual([1, 2]);
  });

  it("idsDasVagas é o mesmo conjunto, por id", () => {
    const set = idsDasVagas([c(1), c(9, "anulado"), c(2), c(3)], VAGAS_SENADO);
    expect([...set]).toEqual([1, 2]);
  });
});

describe("vagasDaCorrida — da tabela canônica, sem default", () => {
  it("Senado elege 2 por UF em 2026; Presidente e Governador, 1", () => {
    expect(vagasDaCorrida(5)).toBe(VAGAS_SENADO);
    expect(vagasDaCorrida(1)).toBe(1);
    expect(vagasDaCorrida(3)).toBe(1);
  });

  it("cargo proporcional LANÇA em vez de cair em 1 vaga", () => {
    expect(() => vagasDaCorrida(6)).toThrow(/proporcional/);
  });
});
