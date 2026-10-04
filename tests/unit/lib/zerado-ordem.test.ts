import { describe, expect, it } from "vitest";
import {
  ordemSorteada,
  pesoSorteado,
  SEMENTE_1T_2026,
  SEMENTE_2T_2026,
  sementeDoTurno,
} from "@/lib/zerado/ordem";

const candidaturas = Array.from({ length: 12 }, (_, i) => ({
  sqcand: String(280001000000 + i * 37),
  numero: 10 + i,
}));

describe("ordemSorteada (ADR-0076)", () => {
  it("é estável: mesma entrada e semente dão a mesma ordem", () => {
    const a = ordemSorteada(candidaturas, (c) => c.sqcand, SEMENTE_1T_2026);
    const b = ordemSorteada(candidaturas, (c) => c.sqcand, SEMENTE_1T_2026);
    expect(a.map((c) => c.sqcand)).toEqual(b.map((c) => c.sqcand));
  });

  it("não depende da ordem de entrada", () => {
    const a = ordemSorteada(candidaturas, (c) => c.sqcand, SEMENTE_1T_2026);
    const b = ordemSorteada([...candidaturas].reverse(), (c) => c.sqcand, SEMENTE_1T_2026);
    expect(a.map((c) => c.sqcand)).toEqual(b.map((c) => c.sqcand));
  });

  it("não é a ordem do número de urna", () => {
    const a = ordemSorteada(candidaturas, (c) => c.sqcand, SEMENTE_1T_2026);
    expect(a.map((c) => c.numero)).not.toEqual(candidaturas.map((c) => c.numero));
  });

  it("o 2º turno sorteia outra ordem", () => {
    const t1 = ordemSorteada(candidaturas, (c) => c.sqcand, sementeDoTurno(1));
    const t2 = ordemSorteada(candidaturas, (c) => c.sqcand, sementeDoTurno(2));
    expect(sementeDoTurno(2)).toBe(SEMENTE_2T_2026);
    expect(t1.map((c) => c.sqcand)).not.toEqual(t2.map((c) => c.sqcand));
  });

  it("não muta a entrada e preserva todos os itens", () => {
    const copia = [...candidaturas];
    const a = ordemSorteada(candidaturas, (c) => c.sqcand, SEMENTE_1T_2026);
    expect(candidaturas).toEqual(copia);
    expect(new Set(a)).toEqual(new Set(candidaturas));
  });

  it("peso é inteiro sem sinal de 32 bits", () => {
    const p = pesoSorteado("x", SEMENTE_1T_2026);
    expect(Number.isInteger(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(2 ** 32);
  });
});
