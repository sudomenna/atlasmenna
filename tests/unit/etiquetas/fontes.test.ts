/**
 * tests/unit/etiquetas/fontes.test.ts — `numerarFontes` (auditoria de
 * a11y/perf de 29/09, A2): a descrição de cada fonte sai UMA vez, e a
 * numeração segue a ordem da LISTA, nunca a da classificação.
 */

import { describe, expect, it } from "vitest";

import { numerarFontes } from "@/lib/etiquetas/fontes";

const A = { fonte_url: "https://a.org", fonte_descricao: "Levantamento A" };
const B = { fonte_url: "https://b.org", fonte_descricao: "Levantamento B" };

describe("numerarFontes", () => {
  it("mesma URL e mesma descrição dividem o número; ordem da primeira aparição", () => {
    const f = numerarFontes([B, A, null, B, { ...A }]);
    expect(f.lista.map((x) => [x.n, x.fonte_url])).toEqual([
      [1, "https://b.org"],
      [2, "https://a.org"],
    ]);
    expect(f.numero(B)).toBe(1);
    expect(f.numero({ ...A })).toBe(2);
    expect(f.numero(null)).toBeNull();
  });

  it("🔴 mesma URL com descrição diferente NÃO se funde (a descrição é o que o leitor lê)", () => {
    const f = numerarFontes([A, { ...A, fonte_descricao: "Outra matéria" }]);
    expect(f.lista).toHaveLength(2);
  });

  it("fonte que não está na lista ⇒ null (nunca um número emprestado)", () => {
    expect(numerarFontes([A]).numero(B)).toBeNull();
  });
});
