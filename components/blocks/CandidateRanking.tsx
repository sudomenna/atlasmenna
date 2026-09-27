/**
 * components/blocks/CandidateRanking.tsx
 *
 * Camada 2 do hero multi-candidato (ADR-0017 — transparência total).
 *
 * O CALLER filtra qual subset entra aqui (tipicamente rank 3..6). Este
 * componente é "burro": só recebe os candidatos a exibir e renderiza.
 *
 * S07/Bloco 2 (ADR-0029 § 7) — a linha deixou de ser "pct projetado + mini
 * barra" e passou a ser `<CandidateResultRow>`: parcial e projeção lado a
 * lado, com delta. É o formato do `CandidateRow` do kit Atlas Menna, e dá a
 * esta camada o mesmo nível de transparência que a Camada 1 já tinha
 * (constituição § 8). O botão "Mostrar todos os N candidatos" que o kit traz
 * no componente equivalente **não** é adotado: ele violaria a regra central
 * do ADR-0017 (todas as camadas sempre no DOM, sem collapsible), e o próprio
 * ADR-0029 o rejeita explicitamente.
 *
 * Cobertura
 *   - RF-030.8 (ranking multi-camada — S05/F4c, ADR-0017).
 *
 * Server Component puro — sem 'use client'. A reação ao controle
 * "Parcial / Projeção" do shell é CSS (ver `CandidateResultRow`), não JS.
 *
 * Ordem visual
 *   - Renderiza na ordem do array (caller já passa em rank ASC).
 *
 * A11y
 *   - `<ul>` + `<li>` semânticos (role implícito; biome regra
 *     `noRedundantRoles` proíbe `role="list"/"listitem"` explícito).
 *   - Cada `<li>` tem `aria-label` com as DUAS bases, na mesma ordem em que
 *     aparecem na tela — leitor de tela não precisa concatenar nodes nem
 *     adivinhar qual número é qual.
 */

import {
  CandidateResultRow,
  candidateResultRowProps,
} from "@/components/atoms/tables/CandidateResultRow";
import type { EdgeCandidate } from "@/lib/edge-config/types";
import { anuladasAoFim, sufixoAriaDestino } from "@/lib/utils/destino-voto";
import { formatPercent } from "@/lib/utils/format";

export interface CandidateRankingProps {
  /** Candidatos a exibir — caller filtra o slice (ex. rank 3..6). */
  candidatos: EdgeCandidate[];
  className?: string;
}

export function CandidateRanking({ candidatos, className }: CandidateRankingProps) {
  if (!candidatos || candidatos.length === 0) return null;

  return (
    <ul className={["flex flex-col", className].filter(Boolean).join(" ")}>
      {/* ADR-0053 / RF-213 — anulada no fim, com a etiqueta no nome acessível. */}
      {anuladasAoFim(candidatos).map((c, i) => {
        const props = candidateResultRowProps(c, i + 1);
        const ariaLabel =
          `${props.nome}${sufixoAriaDestino(c.destino)} (${c.partido}): ` +
          `${formatPercent(props.pctAtual, 1)} apurado, ` +
          `${formatPercent(props.pctProjetado, 1)} projetado`;

        return (
          <li aria-label={ariaLabel} key={c.id}>
            <CandidateResultRow {...props} />
          </li>
        );
      })}
    </ul>
  );
}
