/**
 * lib/etiquetas/juncao.ts
 *
 * A junção etiqueta ↔ lista de candidatos que as telas vão usar (spec 024,
 * RF-232/RF-238): cada item da lista ganha a resolução das suas etiquetas,
 * **na mesma ordem em que chegou**. É o único lugar em que uma lista de
 * candidatos encontra as etiquetas — e por isso é o lugar em que a regra
 * "etiqueta nunca muda a ordem" (constituição § 2) é garantida e testada
 * (`tests/unit/etiquetas/juncao.test.ts`, com o auxiliar de invariância de
 * ordem).
 *
 * Não filtra, não ordena, não agrupa. Quem precisar esconder (o filtro por
 * etiqueta, spec 025) esconde por cima desta lista, sem reordenar.
 */

import type { CategoriaId } from "./catalogo";
import type { Resolucao } from "./resolver";

export interface ItemComEtiquetas<T> {
  item: T;
  etiquetas: Record<CategoriaId, Resolucao>;
}

export function comEtiquetas<T>(
  itens: readonly T[],
  etiquetasDe: (item: T) => Record<CategoriaId, Resolucao>,
): ItemComEtiquetas<T>[] {
  return itens.map((item) => ({ item, etiquetas: etiquetasDe(item) }));
}
