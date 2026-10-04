/**
 * components/atoms/data/Figure.tsx
 *
 * Número-manchete do design system Atlas Menna (ADR-0025, Bloco 1). Portado de
 * `docs/design-system/atlas-menna/components/data/Figure.jsx`.
 *
 * Um `Figure` é o par "rótulo em caixa alta + algarismo em mono": % apurado,
 * votos absolutos, probabilidade. Os dígitos saem das composições
 * `--type-figure-lg/-figure/-figure-sm` (JetBrains Mono, `tabular-nums`
 * global), então a coluna de números nunca dança entre atualizações.
 *
 * Server Component puro — zero JS novo (RNF-007a).
 *
 * Divergências deliberadas em relação ao `.jsx` do kit:
 *   - `tone="pt" | "pl"` foi removido. O kit resolvia essas variantes em
 *     `--party-pt` / `--party-pl`, tokens que ainda NÃO existem em
 *     `app/globals.css` (a paleta do ADR-0024 chega em `lib/utils/party-color.ts`,
 *     de outro agente). Cor ligada a dado entra pela prop `color`, sempre como
 *     `var(--token)` — nunca hex literal (constituição § 2).
 *   - `tone="accent"` usa `--accent-text` (#8E5D18, 5.12:1) e não
 *     `--accent-strong` (4.21:1): em `size="sm"` o algarismo tem 13px e
 *     reprovaria os 4.5:1 da constituição § 4 / RNF-022.
 *   - o `trend` é formatado por `formatPp()` (pt-BR, sinal explícito) em vez
 *     de `toFixed(1)` com ponto decimal; a seta fica `aria-hidden` porque o
 *     sinal já está no texto — cor não pode ser o único portador de
 *     significado (WCAG 1.4.1).
 */

import type { CSSProperties } from "react";

import { formatPp } from "@/lib/utils/format";

export type FigureSize = "lg" | "md" | "sm";
export type FigureAlign = "left" | "center" | "right";
export type FigureTone = "default" | "accent";

export interface FigureProps {
  /** Rótulo em caixa alta — ex. "Apurado". */
  label: string;
  /** Valor já formatado pelo caller (use `lib/utils/format`). */
  value: string | number;
  /** Unidade ao lado do valor — ex. "%". */
  unit?: string;
  /** Variação em pontos percentuais. Positivo sobe, negativo desce. */
  trend?: number;
  /** Nota de rodapé — ex. "Atualizado 21:47". */
  note?: string;
  size?: FigureSize;
  align?: FigureAlign;
  tone?: FigureTone;
  /**
   * Cor do algarismo ligada a dado (candidato, partido). Precisa ser um
   * `var(--token)`; vence `tone`.
   */
  color?: string;
  /**
   * Cor da `note`. Default `--text-muted`. Para quando a nota carrega um
   * número da PROJEÇÃO (ex. "projeção +3,2 pp"): `var(--color-pct-proj)`
   * (decisão do dono, 2026-10-04). Precisa ser um `var(--token)` medido como
   * texto.
   */
  noteColor?: string;
  className?: string;
  style?: CSSProperties;
}

const VALUE_FONT: Record<FigureSize, string> = {
  lg: "var(--type-figure-lg)",
  md: "var(--type-figure)",
  sm: "var(--type-figure-sm)",
};

const JUSTIFY: Record<FigureAlign, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

/** Cor do trend: verde/vermelho de status, ambos ≥ 4.5:1 sobre paper-0..2. */
function trendColor(trend: number): string {
  if (trend > 0) return "var(--color-success-strong)";
  if (trend < 0) return "var(--color-warning-strong)";
  return "var(--text-muted)";
}

function trendGlyph(trend: number): string {
  if (trend > 0) return "▲";
  if (trend < 0) return "▼";
  return "•";
}

export function Figure({
  label,
  value,
  unit,
  trend,
  note,
  size = "lg",
  align = "left",
  tone = "default",
  color,
  noteColor,
  className,
  style,
}: FigureProps) {
  const valueColor = color ?? (tone === "accent" ? "var(--accent-text)" : "var(--text-primary)");

  return (
    <div
      data-testid="figure"
      data-tone={tone}
      data-size={size}
      className={className}
      style={{ display: "grid", gap: "var(--space-1)", textAlign: align, ...style }}
    >
      <div
        data-testid="figure-label"
        style={{
          font: "var(--type-kicker)",
          letterSpacing: "var(--tracking-caps)",
          textTransform: "uppercase",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </div>
      <div
        className="flex items-baseline"
        style={{ gap: "var(--space-2)", justifyContent: JUSTIFY[align] }}
      >
        <span
          data-testid="figure-value"
          style={{
            font: VALUE_FONT[size],
            color: valueColor,
            letterSpacing: "var(--tracking-tight)",
          }}
        >
          {value}
        </span>
        {unit ? (
          <span style={{ font: "var(--type-figure-sm)", color: "var(--text-secondary)" }}>
            {unit}
          </span>
        ) : null}
        {trend != null && !Number.isNaN(trend) ? (
          <span
            data-testid="figure-trend"
            style={{ font: "var(--type-data)", color: trendColor(trend) }}
          >
            <span aria-hidden="true">{trendGlyph(trend)} </span>
            {formatPp(trend)}
          </span>
        ) : null}
      </div>
      {note ? (
        <div
          data-testid="figure-note"
          style={{ font: "var(--type-body-sm)", color: noteColor ?? "var(--text-muted)" }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
}
