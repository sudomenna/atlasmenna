/**
 * components/atoms/lists/MinorCandidatesList.tsx
 *
 * Camada 3 do hero multi-candidato (ADR-0017 — transparência total). Lista
 * dos candidatos "minoritários" (rank 7+, ou rank 4+ quando a Camada 1 são os
 * seis termômetros do ADR-0018 — o caller decide o filtro).
 *
 * Não é collapsible, e nunca será: em 1T todos os candidatos permanecem
 * visíveis (ADR-0017; o botão "Mostrar todos" do kit Atlas Menna foi
 * explicitamente rejeitado pelo ADR-0029 § 7).
 *
 * S07/Bloco 2 (ADR-0029 § 7) — a lista horizontal separada por `·` virou uma
 * pilha de `<CandidateResultRow compact>`: parcial e projeção lado a lado.
 * O formato antigo cabia mais nomes por linha, mas só conseguia mostrar UM
 * número por candidato, e era o projetado — justamente a base que o leitor
 * não pode conferir contra o boletim do TSE. Com as duas colunas, a Camada 3
 * passa a ter a mesma transparência das outras (constituição § 8).
 * `compact` mantém a densidade que o ADR-0017 pede para esta camada em telas
 * estreitas.
 *
 * Cobertura
 *   - RF-030.8 (ranking multi-camada — S05/F4c, ADR-0017).
 *
 * Server Component puro — sem 'use client'. A reação ao controle
 * "Parcial / Projeção" do shell é CSS (ver `CandidateResultRow`), não JS.
 *
 * A11y
 *   - `<ul>` + `<li>` semânticos (biome `noRedundantRoles` proíbe
 *     `role="list"/"listitem"` explícito — o role é implícito da tag).
 *   - Cada `<li>` tem `aria-label` com as duas bases rotuladas.
 */

import {
  CandidateResultRow,
  candidateResultRowProps,
} from "@/components/atoms/tables/CandidateResultRow";
import type { EdgeCandidate } from "@/lib/edge-config/types";
import { anuladasAoFim, ariaNumerosResultado, sufixoAriaDestino } from "@/lib/utils/destino-voto";

export interface MinorCandidatesListProps {
  /** Candidatos a exibir — caller filtra (ex. rank 4+, rank 7+, pct < 1%). */
  candidatos: EdgeCandidate[];
  className?: string;
}

export function MinorCandidatesList({ candidatos, className }: MinorCandidatesListProps) {
  if (!candidatos || candidatos.length === 0) return null;

  return (
    <ul className={["flex flex-col", className].filter(Boolean).join(" ")}>
      {/* ADR-0053 / RF-213 — anulada no fim, com a etiqueta no nome acessível. */}
      {anuladasAoFim(candidatos).map((c, i) => {
        const props = candidateResultRowProps(c, i + 1, true);
        const ariaLabel =
          `${props.nome}${sufixoAriaDestino(c.destino)} (${c.partido}): ` +
          // Emenda "opção A" — a anulada é lida com os votos, nunca com o %.
          ariaNumerosResultado(c, props.pctAtual, props.pctProjetado);

        return (
          <li aria-label={ariaLabel} key={c.id}>
            <CandidateResultRow {...props} />
          </li>
        );
      })}
    </ul>
  );
}
