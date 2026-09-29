/**
 * lib/utils/vagas-eleitas.ts
 *
 * Ponto ÚNICO de "quem ocupa as vagas desta corrida, numa base" — correção de
 * 2026-09-29 (dono): **o Senado elege DOIS por estado em 2026**, e todo selo de
 * eleito — o oficial/chamado, o projetado e o da parcial — vale para os dois
 * primeiros, não só para o líder.
 *
 * Antes desta data a mesma regra ("os `vagas` primeiros que disputam") estava
 * escrita à mão em cinco lugares (`selosDaBase`, `<ResultPanel>`,
 * `<StateResultSheet>`, `<GovernorCard cargo="sen">`, `vagasDerivadas`) e
 * AUSENTE em dois (o ✓ de "chamada" do balão do mapa e o selo dos cartões da
 * capa `/senador`), que marcavam só o líder ou ninguém. Agora todos leem daqui.
 *
 * ## A regra
 *
 * 1. A lista chega **já na ordem da base** (Parcial ou Projeção — ADR-0051,
 *    constituição § 2, exceção de ordem por base). Esta função não reordena:
 *    quem ordena é o comparador de cada superfície (`ordensPorBase`,
 *    `ordenarTopCandidatosPorBase`), e é isso que garante que o selo caia na
 *    linha que a tela mostra naquela posição. Empate segue o desempate que o
 *    comparador já aplicou.
 * 2. **Anulada não ocupa vaga** (ADR-0053 / RF-213). Ela é tirada ANTES de
 *    contar — então o 3º que disputa sobe para a 2ª vaga quando uma anulada
 *    estava entre os dois primeiros. `sub_judice` e destino ausente competem.
 * 3. **`vagas` vem da tabela canônica** (`vagasDaCorrida`,
 *    `lib/config/cargos.ts`) ou do payload (`EdgePayloadUf.vagas`) — nunca de
 *    um literal. Valor inválido (não finito, < 1) ⇒ **ninguém** é marcado: é o
 *    lado seguro do erro (constituição § 1 — a tela não proclama o que não
 *    sabe), e o oposto do default silencioso `?? 1`, que marcaria o líder
 *    sozinho num Senado de duas vagas sem que nada reclamasse.
 *
 * Função pura, sem React e sem I/O — cabe no chunk do mapa (RNF-007b): importa
 * só `destino-voto`, que já está lá.
 */

import { type ComDestino, compete } from "@/lib/utils/destino-voto";

/**
 * Quantas vagas contar, ou `0` quando o número não serve. Fracionário é
 * truncado (`2.9` → 2): um payload com `vagas: 2.9` não elege três.
 */
function vagasValidas(vagas: number): number {
  if (!Number.isFinite(vagas)) return 0;
  const n = Math.trunc(vagas);
  return n >= 1 ? n : 0;
}

/**
 * Os ocupantes das vagas: os `vagas` primeiros QUE DISPUTAM, na ordem recebida
 * (a da base). Menos candidaturas que vagas ⇒ todas as que disputam.
 */
export function ocupantesDasVagas<T extends ComDestino>(
  ordenadaNaBase: readonly T[],
  vagas: number,
): T[] {
  const n = vagasValidas(vagas);
  const ocupantes: T[] = [];
  if (n === 0) return ocupantes;
  for (const c of ordenadaNaBase) {
    if (!compete(c)) continue;
    ocupantes.push(c);
    if (ocupantes.length === n) break;
  }
  return ocupantes;
}

/** O mesmo conjunto, por `id` — para quem marca linha a linha. */
export function idsDasVagas<T extends ComDestino & { id: number }>(
  ordenadaNaBase: readonly T[],
  vagas: number,
): ReadonlySet<number> {
  return new Set(ocupantesDasVagas(ordenadaNaBase, vagas).map((c) => c.id));
}
