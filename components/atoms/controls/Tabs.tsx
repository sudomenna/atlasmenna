/**
 * components/atoms/controls/Tabs.tsx
 *
 * Wrapper de tabs simples (Server Component) — usado para:
 *   - Presidente / Governador (RF-029) na home
 *   - 1º turno / 2º turno (RF-030) quando aplicável
 *
 * Apresentacional. O ativo é determinado por prop. Cada tab é um link
 * regular (`<a href>`) — evita JS no above-the-fold (RNF-007a).
 *
 * A11y
 *   - role="tablist" + role="tab" com aria-selected.
 *   - `aria-current` quando active e for link.
 */

export interface TabsOption {
  id: string;
  label: string;
  /** Caminho navegável; opcional para tabs puramente apresentacionais. */
  href?: string;
  /**
   * S06/F4d (Fase 3) — opção desabilitada (grayed out + tooltip).
   * Usada pra cargos ainda não cobertos pelo AtlasMenna (Senado, Câmara,
   * Assembleias) que aparecem na navegação como "coming soon".
   *
   * Quando true:
   *   - Renderiza como `<span>` mesmo se `href` presente (sem navegação).
   *   - Visual: opacity 0.4 + cursor not-allowed.
   *   - aria-disabled="true", tabIndex={-1} (não navegável por teclado).
   *   - `title` (tooltip nativo) com texto definido pelo caller via
   *     `disabledTooltip`.
   *   - Click ignorado (mesmo se onClick fosse adicionado).
   */
  disabled?: boolean;
  /**
   * Tooltip exibido em tabs desabilitadas. Default: "Disponível em breve".
   * Aparece como `title` HTML nativo (acessível via hover do mouse e
   * leitor de tela).
   */
  disabledTooltip?: string;
}

export interface TabsProps {
  options: ReadonlyArray<TabsOption>;
  /** ID ativo. */
  value: string;
  /** ARIA label do tablist. */
  ariaLabel: string;
  className?: string;
}

export function Tabs({ options, value, ariaLabel, className }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={["inline-flex gap-0 rounded-md border overflow-hidden text-sm", className]
        .filter(Boolean)
        .join(" ")}
      style={{ borderColor: "var(--color-border)" }}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        const disabled = opt.disabled === true;
        const baseClass = "px-4 py-1.5 transition-colors";
        // A aba ativa usa o accent da trilha (ADR-0019). O `:root` define
        // `--trilha-accent: var(--color-text)`, então páginas sem
        // `main[data-trilha]` renderizam exatamente como antes de S07.
        const styleObj: React.CSSProperties = {
          backgroundColor: active && !disabled ? "var(--trilha-accent)" : "transparent",
          color: disabled
            ? "var(--color-text-muted)"
            : active
              ? "var(--color-bg)"
              : "var(--color-text-muted)",
          fontWeight: active && !disabled ? 600 : 400,
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? "not-allowed" : undefined,
        };
        const tooltip = disabled ? (opt.disabledTooltip ?? "Disponível em breve") : undefined;

        if (opt.href && !disabled) {
          return (
            <a
              key={opt.id}
              href={opt.href}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              className={baseClass}
              style={styleObj}
            >
              {opt.label}
            </a>
          );
        }
        return (
          // Tabs estáticos (decorativos OU disabled) não recebem foco de
          // propósito: `tabIndex` é `-1` no disabled e ausente no decorativo.
          // Sem rede de lint aqui: `useFocusableInteractive` enxerga o atributo
          // `tabIndex` no JSX e se dá por satisfeita, sem avaliar o ternário.
          <span
            key={opt.id}
            role="tab"
            aria-selected={active}
            aria-disabled={disabled ? "true" : undefined}
            tabIndex={disabled ? -1 : undefined}
            title={tooltip}
            className={baseClass}
            style={styleObj}
          >
            {opt.label}
          </span>
        );
      })}
    </div>
  );
}
