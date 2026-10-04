/**
 * components/blocks/InsightCard.tsx
 *
 * RF-044 — a caixa "Análise". Até 04/10/2026 as frases saíam SÓ do engine de
 * templates (constituição § 2, ADR-0005: nunca LLM). O ADR-0072 revogou o
 * ADR-0005 **só para esta caixa, na home presidencial**: as frases podem vir
 * de uma IA, publicadas automaticamente pelo cron da leitura da noite. O
 * componente não escreve nem filtra texto — recebe as frases prontas e diz,
 * no rodapé, de onde elas vieram (`origem`).
 *
 * Stub minimal — compartilhado entre spec 003 (home) e spec 004 (UF). O
 * spec-implementer da 003 pode evoluir layout/estilo conforme necessidade.
 * Interface estável: recebe `frases: string[]` já geradas (1–4 sentenças).
 *
 * S07/Bloco 1 (ADR-0025) — perdeu a moldura. O card cinza com borda
 * arredondada era a única superfície "caixa" restante no fluxo da home, e a
 * gramática do design system Atlas Menna separa seções por filete, não por
 * card. O filete e o kicker agora vêm do `<Panel>` que envolve o bloco na
 * página; o `<h3>` virou o título em serifa e as frases, deck. Contrato de
 * dados e de a11y inalterados.
 *
 * `origem` (ADR-0072) é OPCIONAL de propósito: outras telas usam o
 * componente, e sem `origem` nada muda — nem `data-origem`, nem nota.
 *
 * Server Component puro.
 *
 * A11y: `<aside>` semântico + `aria-labelledby` apontando ao heading. Cada
 * frase é um `<p>` separado para que screen readers façam pausa entre elas.
 */

import { formatTimeHMS } from "@/lib/utils/format";

export interface InsightCardProps {
  /** Frases já prontas (1–4): do engine de templates ou da IA (ADR-0072). */
  frases: string[];
  /** Variação visual (opcional). */
  variant?: "national" | "uf";
  /** Heading customizado. Default: "Análise". */
  heading?: string;
  /**
   * De onde vieram as frases. Liga `data-origem` no `<aside>` e a nota de
   * rodapé que declara a origem. Ausente ⇒ sem nota (comportamento anterior).
   */
  origem?: "ia" | "regra";
  /** ISO 8601 de quando o texto foi escrito — aparece na nota da IA como HH:MM. */
  atualizadoEm?: string;
}

/** "HH:MM" no fuso de São Paulo, ou `null` para ISO ausente/inválido. */
function horaMinuto(iso: string | undefined): string | null {
  if (!iso) return null;
  const hms = formatTimeHMS(iso);
  return hms === "—" ? null : hms.slice(0, 5);
}

function notaDeOrigem(origem: "ia" | "regra", atualizadoEm: string | undefined): string {
  if (origem === "regra") {
    return "Frases montadas por regra fixa a partir da projeção não oficial do AtlasMenna. O resultado oficial é do TSE.";
  }
  const hora = horaMinuto(atualizadoEm);
  return [
    "Texto escrito por inteligência artificial a partir da projeção não oficial do AtlasMenna, publicado automaticamente, sem revisão humana; pode conter erros.",
    hora ? `Atualizado às ${hora}.` : null,
    "O resultado oficial é do TSE.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function InsightCard({
  frases,
  heading = "Análise",
  origem,
  atualizadoEm,
}: InsightCardProps) {
  if (frases.length === 0) {
    return null;
  }
  const headingId = "insight-card-heading";

  return (
    <aside
      aria-labelledby={headingId}
      data-origem={origem}
      className="flex flex-col"
      style={{ gap: "var(--space-3)" }}
    >
      <h3 id={headingId} style={{ margin: 0, font: "var(--type-title)", textWrap: "pretty" }}>
        {heading}
      </h3>
      {frases.map((f, i) => (
        <p
          // biome-ignore lint/suspicious/noArrayIndexKey: a IA pode repetir frase; a lista é posicional e nunca reordena.
          key={i}
          style={{ margin: 0, font: "var(--type-deck)", textWrap: "pretty" }}
        >
          {f}
        </p>
      ))}
      {origem ? (
        <p
          data-testid="insight-nota"
          style={{
            margin: 0,
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
          }}
        >
          {notaDeOrigem(origem, atualizadoEm)}
        </p>
      ) : null}
    </aside>
  );
}
