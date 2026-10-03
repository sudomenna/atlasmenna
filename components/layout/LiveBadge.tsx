/**
 * components/layout/LiveBadge.tsx
 *
 * Badge "● AO VIVO" pulsante. Cobertura: RF-028 (Should).
 *
 * Server Component puro — animação via CSS @keyframes embutida.
 *
 * Estados
 *   - active=true  → ponto vermelho pulsando, texto "AO VIVO".
 *   - active=false → ponto cinza, texto "OFFLINE" (estado pré-eleição ou
 *                    erro persistente — caller decide).
 *
 * A11y
 *   - role="status" + aria-live="polite" — leitor de tela anuncia mudança.
 *   - aria-label descritivo.
 *   - `prefers-reduced-motion: reduce` → ponto estático (sem pulse).
 */

export interface LiveBadgeProps {
  /** Default true. */
  active?: boolean;
  /** Texto custom; default "AO VIVO" / "OFFLINE". */
  label?: string;
  className?: string;
}

export function LiveBadge({ active = true, label, className }: LiveBadgeProps) {
  const text = label ?? (active ? "AO VIVO" : "OFFLINE");
  const dotColor = active ? "var(--color-live)" : "var(--color-text-faint)";
  const containerClass = [
    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={`Status da apuração: ${text.toLowerCase()}`}
      className={containerClass}
      style={{
        backgroundColor: "var(--color-bg-muted)",
        color: "var(--color-text)",
        border: "1px solid var(--color-border)",
      }}
    >
      <span
        data-testid="live-badge-dot"
        aria-hidden="true"
        className="inline-block h-2 w-2 rounded-full"
        style={{
          backgroundColor: dotColor,
          animation: active ? "atlasmenna-pulse 1.6s ease-in-out infinite" : undefined,
        }}
      />
      <span>{text}</span>
      <style>{`
        @keyframes atlasmenna-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="live-badge-dot"] { animation: none !important; }
        }
      `}</style>
    </span>
  );
}
