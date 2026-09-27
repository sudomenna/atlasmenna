/**
 * components/atoms/badges/RaceTypeIndicator.tsx
 *
 * Texto descritivo do tipo da disputa — "Disputa entre N candidatos"
 * em 1T ou "Segundo turno entre A e B" em 2T. Atomo informacional
 * usado em headers e contexto do hero multi-camada.
 *
 * Cobertura
 *   - RF-030.8 (ranking multi-camada — S05/F4c, ADR-0017).
 *   - Suporte ao princípio ADR-0017: deixa explícito o "shape" da
 *     corrida sem o usuário precisar contar dots.
 *
 * Server Component puro — sem 'use client', sem state.
 *
 * Lógica
 *   - 1T: conta candidatos com `pct_projetado >= 0.5` (>= 0,5%). Usa
 *     plural/singular ("1 candidato" / "N candidatos"). O threshold
 *     0,5% é menor que o color-lock de 1% (ADR-0013): aqui é só pra
 *     EVITAR contar lista de "outros" (10 partidos com pct < 0,5%);
 *     o objetivo é número honesto, não enxuto.
 *   - 2T: pega os 2 primeiros (caller passa candidatos já ordenados
 *     por rank/pct desc).
 *
 * A11y
 *   - Texto solto — leitor de tela lê linearmente.
 *   - Cor neutra (`--color-text-muted`) — constituição § 2.
 */

import type { EdgeCandidate, Turno } from "@/lib/edge-config/types";
import { compete } from "@/lib/utils/destino-voto";
import { nomeExibicao } from "@/lib/utils/nome-candidato";

export interface RaceTypeIndicatorProps {
  candidatos: EdgeCandidate[];
  turno: Turno;
  /**
   * **RF-156 (spec 019)** — conta quem CONCORRE, não quem pontuou.
   *
   * Com `pct_projetado` zerado em todo mundo, o limiar de 0,5% abaixo zera a
   * contagem inteira e o selo diz **"Disputa entre 0 candidatos"** ao lado de
   * uma lista com 12 nomes visíveis. Não é bug do filtro: o filtro está certo
   * para a pergunta que ele foi escrito para responder ("quantos são
   * competitivos"), e essa pergunta não existe antes do primeiro voto.
   *
   * Ligada, a contagem passa a ser `candidatos.length` — o número vem do
   * payload, nunca de literal no JSX (lição D8 da spec 017). Desligada (o
   * default, e o estado de 04/10 em diante), **nada muda**: o limiar continua
   * valendo, e o teste do RF-156 roda os dois modos sobre o mesmo array
   * exigindo números diferentes — um teste só do modo pré passaria com o
   * limiar removido de vez.
   *
   * Quem decide é o chamador, que é quem lê `isPreEleicao(payload)`
   * (`lib/config/fase.ts`, ponto único do RF-153).
   */
  preEleicao?: boolean;
  className?: string;
}

/**
 * Threshold de "candidato real" em 1T — pct_projetado >= 0.5%.
 * Abaixo disso entra na contagem de "outros" e não no headline.
 */
const PCT_THRESHOLD_1T = 0.5;

export function RaceTypeIndicator({
  candidatos,
  turno,
  preEleicao = false,
  className,
}: RaceTypeIndicatorProps) {
  const classes = ["text-sm", className].filter(Boolean).join(" ");

  if (turno === 2) {
    const a = candidatos[0];
    const b = candidatos[1];
    if (!a || !b) {
      // Fallback raro (payload 2T incompleto) — degrada graciosamente.
      return (
        <p className={classes} style={{ color: "var(--color-text-muted)" }}>
          Segundo turno
        </p>
      );
    }
    return (
      <p className={classes} style={{ color: "var(--color-text-muted)" }}>
        Segundo turno entre {nomeExibicao(a.nome, a.sqcand)} e {nomeExibicao(b.nome, b.sqcand)}
      </p>
    );
  }

  // 1T. Em fase pré-eleição o limiar NÃO se aplica — ver a prop `preEleicao`.
  // O 2T acima cai no fallback já existente e não precisa de caso novo: não
  // existe segundo turno antes do primeiro.
  // ADR-0053 / RF-213 — "disputa entre N": a candidatura anulada não
  // disputa, então não entra na contagem (ela segue na lista, com etiqueta).
  const n = preEleicao
    ? candidatos.length
    : candidatos.filter(
        (c) =>
          compete(c) && Number.isFinite(c.pct_projetado) && c.pct_projetado >= PCT_THRESHOLD_1T,
      ).length;
  const word = n === 1 ? "candidato" : "candidatos";

  return (
    <p className={classes} style={{ color: "var(--color-text-muted)" }}>
      Disputa entre {n} {word}
    </p>
  );
}
