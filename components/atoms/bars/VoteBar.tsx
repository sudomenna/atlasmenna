/**
 * components/atoms/bars/VoteBar.tsx
 *
 * Barra empilhada de participação no total (estilo NYT/AP) com marcador de
 * 50%. Design system Atlas Menna (ADR-0025, Bloco 1), portado de
 * `docs/design-system/atlas-menna/components/data/VoteBar.jsx`.
 *
 * Server Component puro — zero JS novo (RNF-007a).
 *
 * Divergências deliberadas em relação ao `.jsx` do kit:
 *   - o kit importava `partyColor(sigla)` de `PartyTag.jsx`. Aqui a cor é
 *     SEMPRE explícita no segmento (`color`), porque o mapeamento sigla → cor
 *     é do ADR-0024 e mora em `lib/utils/party-color.ts` — este átomo não
 *     conhece partido nenhum. Sem `color`, o segmento cai em
 *     `var(--party-outros, var(--color-cand-other))`: quando os tokens
 *     `--party-*` entrarem, o fallback deixa de ser usado sozinho.
 *   - percentuais são clampeados em [0, 100] e formatados por
 *     `formatPercent()` (pt-BR). Determinismo, constituição § 6.
 *   - a barra ganhou `role="img"` + `aria-label` com a série completa: uma
 *     divisão colorida sem texto alternativo é invisível para leitor de tela
 *     (RNF-022/023). Os `title` de cada segmento continuam, para o mouse.
 */

import type { CSSProperties } from "react";
import { DATA_FILL_STROKE } from "@/components/blocks/_candidateColor";

import { formatPercent } from "@/lib/utils/format";

/** Fallback enquanto os tokens `--party-*` (ADR-0024) não entram em globals.css. */
export const VOTE_BAR_FALLBACK_COLOR = "var(--party-outros, var(--color-cand-other))";

export interface VoteBarSegment {
  /**
   * Identidade estável do segmento — id do candidato, ou um literal como
   * `"outros"`. Só serve de chave React; não é exibida. Opcional porque
   * chamadores antigos passam só `label`, mas passe sempre que houver id:
   * o rótulo é o primeiro nome e pode repetir entre candidatos.
   */
  id?: string | number;
  /** Nome exibido no tooltip e no texto alternativo. */
  label: string;
  /** Participação em 0–100. */
  pct: number;
  /** Cor do segmento, sempre como `var(--token)`. */
  color?: string;
}

export interface VoteBarProps {
  /** Segmentos na ordem em que devem aparecer, da esquerda para a direita. */
  segments: readonly VoteBarSegment[];
  height?: number;
  /** Posição do marcador em 0–100. `null` remove a linha. Default 50. */
  marker?: number | null;
  /** Linha de rótulos abaixo da barra (primeiro segmento, marcador, segundo). */
  showLabels?: boolean;
  /**
   * Cor do PERCENTUAL nos rótulos de baixo (o nome segue em `--text-secondary`).
   * Ausente ⇒ o rótulo sai inteiro na cor de sempre. Para a barra da projeção:
   * `var(--color-pct-proj)` (decisão do dono, 2026-10-04).
   */
  pctLabelColor?: string;
  /** Sobrescreve o texto alternativo gerado a partir dos segmentos. */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

function clampPct(pct: number): number {
  if (Number.isNaN(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/** "Lula 41,2%, Flávio 36,8%, Outros 22,0%" — série completa para leitor de tela. */
export function voteBarLabel(segments: readonly VoteBarSegment[]): string {
  return segments.map((s) => `${s.label} ${formatPercent(s.pct)}`).join(", ");
}

/**
 * Um rótulo de baixo: "NOME 38,0%". Sem `pctColor`, o texto de sempre (string
 * única); com ele, o percentual num `<span>` próprio na cor pedida — o texto
 * renderizado é o mesmo nos dois casos.
 */
function rotuloSegmento(seg: VoteBarSegment | undefined, pctColor: string | undefined) {
  if (!seg) return "";
  if (!pctColor) return `${seg.label} ${formatPercent(seg.pct)}`;
  return (
    <>
      {seg.label} <span style={{ color: pctColor }}>{formatPercent(seg.pct)}</span>
    </>
  );
}

export function VoteBar({
  segments,
  height = 14,
  marker = 50,
  showLabels = true,
  pctLabelColor,
  ariaLabel,
  className,
  style,
}: VoteBarProps) {
  const first = segments[0];
  const second = segments[1];

  return (
    <div data-testid="vote-bar" className={className} style={style}>
      <div
        role="img"
        aria-label={ariaLabel ?? voteBarLabel(segments)}
        data-testid="vote-bar-track"
        className="relative flex overflow-hidden rounded-xs"
        // RNF-035 / WCAG SC 1.4.11 — o contorno da CALHA delimita a extensão
        // da barra contra a página. Sem ele, um segmento de cor clara
        // (PSOL 2,08:1 · PSB 2,19 · outros 2,39 · NOVO 2,72 no tema claro)
        // encosta no papel sem fronteira e o leitor perde onde a barra acaba.
        // `--text-secondary` mede 5,52:1 sobre a página e 5,09:1 sobre a
        // calha — é o mesmo traço de `DATA_FILL_STROKE`.
        style={{
          height,
          background: "var(--surface-sunken)",
          border: DATA_FILL_STROKE,
        }}
      >
        {segments.map((s, i) => (
          <div
            // A identidade do segmento é o `id`, com o rótulo só como reserva.
            //
            // O rótulo NÃO serve como chave: ele é o primeiro nome do candidato
            // (`nome.split(" ")[0]`), e dois candidatos podem compartilhá-lo —
            // "José Silva" e "José Almeida" na mesma corrida colidiriam.
            // Medido em 09/09 com a fixture ("Candidato PT" e "Candidato PL"):
            // o React acusou duas chaves `Candidato` e avisou que pode duplicar
            // ou omitir filhos. O protótipo tem o mesmo defeito
            // (`App.jsx:35`) — não copiar.
            key={s.id ?? `${i}:${s.label}`}
            data-testid="vote-bar-segment"
            data-label={s.label}
            title={`${s.label} ${formatPercent(s.pct)}`}
            style={{
              width: `${clampPct(s.pct)}%`,
              background: s.color ?? VOTE_BAR_FALLBACK_COLOR,
              transition: "width var(--dur-slow) var(--ease-out)",
              // 🔴 O separador era `--surface-card`, que mede **1,15:1** sobre a
              // calha — invisível, nos DOIS temas (medido em 18/09). Não é
              // detalhe estético: na barra de bancada o resto não apurado é um
              // segmento pintado com a COR DA PRÓPRIA CALHA, então a fronteira
              // entre "já contado" e "falta contar" era o único sinal de onde o
              // dado acaba — e ela não existia.
              //
              // `--border-strong` restaura o limite sem o peso de um traço de
              // texto entre cada partido numa barra de muitos segmentos.
              borderRight: i < segments.length - 1 ? "1px solid var(--border-strong)" : undefined,
            }}
          />
        ))}
        {marker != null ? (
          <div
            data-testid="vote-bar-marker"
            aria-hidden="true"
            className="absolute"
            style={{
              top: -2,
              bottom: -2,
              left: `${clampPct(marker)}%`,
              width: 2,
              background: "var(--border-strong)",
            }}
          />
        ) : null}
      </div>
      {showLabels ? (
        <div
          aria-hidden="true"
          data-testid="vote-bar-labels"
          className="flex justify-between"
          style={{
            marginTop: "var(--space-2)",
            font: "var(--type-data)",
            color: "var(--text-secondary)",
          }}
        >
          <span>{rotuloSegmento(first, pctLabelColor)}</span>
          <span>{marker != null ? `${Math.round(clampPct(marker))}%` : ""}</span>
          <span>{rotuloSegmento(second, pctLabelColor)}</span>
        </div>
      ) : null}
    </div>
  );
}
