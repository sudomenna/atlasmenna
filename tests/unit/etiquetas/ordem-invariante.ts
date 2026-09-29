/**
 * tests/unit/etiquetas/ordem-invariante.ts
 *
 * Auxiliar de **invariância de ordem** (spec 024, RF-238; constituição § 2):
 * etiqueta presente, ausente, parcial ou trocada entre candidatos NUNCA muda a
 * ordem em que os candidatos aparecem.
 *
 * Feito para as frentes seguintes reusarem em toda superfície que junte
 * etiqueta a uma lista de candidatos (cartão, painel, filtro, hemiciclo):
 *
 * ```ts
 * import { expectOrdemInvariante } from "../etiquetas/ordem-invariante";
 * expectOrdemInvariante({
 *   ids: ["a", "b", "c"],
 *   ordenar: (classificado) => minhaTela(dados, classificado).map((c) => c.id),
 * });
 * ```
 *
 * `ordenar` recebe um predicado "este id está classificado?" e devolve a
 * sequência de ids que a superfície produz. O auxiliar roda com: ninguém
 * classificado, todos, cada candidato sozinho, o complemento de cada um, e
 * uma alternância — e exige a MESMA sequência em todos.
 */

import { expect } from "vitest";

export type Classificado = (id: string) => boolean;

export function cenariosDeEtiqueta(
  ids: readonly string[],
): Array<{ nome: string; f: Classificado }> {
  const cenarios: Array<{ nome: string; f: Classificado }> = [
    { nome: "ninguém classificado", f: () => false },
    { nome: "todos classificados", f: () => true },
    { nome: "alternado", f: (id) => ids.indexOf(id) % 2 === 0 },
    { nome: "alternado inverso", f: (id) => ids.indexOf(id) % 2 === 1 },
  ];
  for (const alvo of ids) {
    cenarios.push({ nome: `só ${alvo}`, f: (id) => id === alvo });
    cenarios.push({ nome: `todos menos ${alvo}`, f: (id) => id !== alvo });
  }
  return cenarios;
}

export function expectOrdemInvariante(args: {
  ids: readonly string[];
  ordenar: (classificado: Classificado) => readonly string[];
}): void {
  const cenarios = cenariosDeEtiqueta(args.ids);
  const referencia = args.ordenar(cenarios[0]?.f ?? (() => false));
  for (const c of cenarios) {
    expect(args.ordenar(c.f), `ordem mudou no cenário "${c.nome}"`).toEqual(referencia);
  }
}
