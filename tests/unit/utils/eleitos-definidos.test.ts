/**
 * tests/unit/utils/eleitos-definidos.test.ts
 *
 * 2026-10-04 (dono, dia do 1º turno) — `definicaoDaUf` é o ponto único de
 * "quem está MATEMATICAMENTE eleito nesta UF" e do texto do cabeçalho do balão
 * do mapa nacional e da gaveta do celular. A fonte é só `eleitos_definidos` /
 * `segundo_turno_definido`, emitidos pelo produtor; `chamada` (leitura da
 * projeção) não decide nada aqui.
 */

import { describe, expect, it } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";
import {
  definicaoDaUf,
  ROTULO_ELEITO,
  ROTULO_ELEITOS,
  ROTULO_SEGUNDO_TURNO,
} from "@/lib/utils/eleitos-definidos";

type Linha = Pick<EdgeUfRow, "top_candidatos" | "eleitos_definidos" | "segundo_turno_definido">;

const TOP: EdgeUfRow["top_candidatos"] = [
  { id: 13, pct: 45 },
  { id: 22, pct: 30 },
  { id: 40, pct: 15 },
];

function linha(over: Partial<Linha> = {}): Linha {
  return { top_candidatos: TOP, ...over };
}

describe("definicaoDaUf", () => {
  it("textos exatos", () => {
    expect(ROTULO_ELEITO).toBe("Matematicamente eleito");
    expect(ROTULO_ELEITOS).toBe("Matematicamente eleitos");
    expect(ROTULO_SEGUNDO_TURNO).toBe("2º turno definido");
  });

  it("sem campos ⇒ ninguém e nenhum rótulo (nunca cai em `chamada`)", () => {
    const d = definicaoDaUf({ ...linha(), chamada: true } as Linha);
    expect(d.eleitos.size).toBe(0);
    expect(d.rotulo).toBeUndefined();
  });

  it("lista vazia ⇒ ninguém", () => {
    const d = definicaoDaUf(linha({ eleitos_definidos: [] }));
    expect(d.eleitos.size).toBe(0);
    expect(d.rotulo).toBeUndefined();
  });

  it("1 id nas linhas ⇒ singular", () => {
    const d = definicaoDaUf(linha({ eleitos_definidos: [22] }));
    expect([...d.eleitos]).toEqual([22]);
    expect(d.rotulo).toBe("Matematicamente eleito");
  });

  it("2 ids nas linhas ⇒ plural", () => {
    const d = definicaoDaUf(linha({ eleitos_definidos: [22, 13] }));
    expect(new Set(d.eleitos)).toEqual(new Set([13, 22]));
    expect(d.rotulo).toBe("Matematicamente eleitos");
  });

  it("id fora das linhas é ignorado — inclusive para o rótulo", () => {
    expect(definicaoDaUf(linha({ eleitos_definidos: [999] }))).toEqual({
      eleitos: new Set(),
      rotulo: undefined,
    });
    const d = definicaoDaUf(linha({ eleitos_definidos: [13, 999] }));
    expect([...d.eleitos]).toEqual([13]);
    expect(d.rotulo).toBe("Matematicamente eleito");
  });

  it("anulada nunca é eleita, mesmo listada", () => {
    const d = definicaoDaUf({
      top_candidatos: [
        { id: 9, pct: 50, destino: "anulado" },
        { id: 13, pct: 45 },
      ],
      eleitos_definidos: [9, 13],
    });
    expect([...d.eleitos]).toEqual([13]);
    expect(d.rotulo).toBe("Matematicamente eleito");
  });

  it("sub_judice disputa — pode ser eleita", () => {
    const d = definicaoDaUf({
      top_candidatos: [{ id: 13, pct: 60, destino: "sub_judice" }],
      eleitos_definidos: [13],
    });
    expect([...d.eleitos]).toEqual([13]);
  });

  it("segundo_turno_definido ⇒ '2º turno definido' e ninguém marcado", () => {
    const d = definicaoDaUf(linha({ segundo_turno_definido: true }));
    expect(d.eleitos.size).toBe(0);
    expect(d.rotulo).toBe("2º turno definido");
  });

  it("eleito prevalece sobre segundo_turno_definido", () => {
    const d = definicaoDaUf(linha({ eleitos_definidos: [13], segundo_turno_definido: true }));
    expect([...d.eleitos]).toEqual([13]);
    expect(d.rotulo).toBe("Matematicamente eleito");
  });

  it("payload malformado (não-array) ⇒ ninguém", () => {
    const d = definicaoDaUf(linha({ eleitos_definidos: 13 as unknown as number[] }));
    expect(d.eleitos.size).toBe(0);
    expect(d.rotulo).toBeUndefined();
  });
});
