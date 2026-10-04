/**
 * components/atoms/data/DestinoEtiqueta.tsx
 *
 * A etiqueta "Anulado" / "Sub judice" ao lado do nome de uma candidatura —
 * ADR-0053 / RF-213, decisão de exibição do dono (2026-09-27).
 *
 * - **Texto, não cor.** A marca é a palavra; a borda é só moldura. Quem não
 *   distingue cor (ou lê a página em alto contraste) recebe a mesma
 *   informação (WCAG SC 1.4.1).
 * - **Visível e audível.** A palavra é texto comum do DOM, dentro da linha:
 *   entra no que o leitor de tela lê para a linha, na ordem nome → etiqueta →
 *   partido. A vírgula `sr-only` antes dela só dá a pausa ("Fulano, Anulado"),
 *   sem aparecer.
 * - **Contraste.** Tinta `--text-primary` sobre o fundo de quem a hospeda
 *   (cartão, página, fundo afundado). Pior caso medido nos dois temas — ver
 *   `tests/unit/components/DestinoEtiqueta.test.tsx`, que calcula a razão a
 *   partir dos valores de `app/globals.css` e não de um número copiado.
 * - **Sobre a faixa do eleito** (`sobreFaixa`, 2026-10-04 — auditoria de
 *   a11y): a faixa usa o par (fundo, tinta) do partido (`partyChipInk`,
 *   medido ≥ 4,5:1 para a TINTA dele). `--text-primary`/`--border-strong`
 *   fixos sobre esse fundo reprovavam em 20/29 partidos no claro e 28/29 no
 *   escuro. Com a prop, a etiqueta herda a tinta da faixa (`inherit`) e a
 *   moldura acompanha (`currentColor`). Sub judice compete — pode ser eleita.
 * - `"valido"` e ausente ⇒ **nada** (`null`). Destino ausente não é "válido"
 *   nem "anulado": é "o TSE ainda não publicou", e não há o que etiquetar.
 */

import type { CSSProperties } from "react";

import type { EdgeDestinoVoto } from "@/lib/edge-config/types";
import { etiquetaDestino } from "@/lib/utils/destino-voto";

const ESTILO: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  flex: "none",
  padding: "1px var(--space-1)",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-xs)",
  color: "var(--text-primary)",
  font: "var(--type-kicker)",
  letterSpacing: "var(--tracking-caps)",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

/** A etiqueta sobre a faixa do eleito: tinta e moldura herdadas da faixa. */
const ESTILO_SOBRE_FAIXA: CSSProperties = {
  ...ESTILO,
  color: "inherit",
  borderColor: "currentColor",
};

export interface DestinoEtiquetaProps {
  destino: EdgeDestinoVoto | undefined;
  /**
   * A linha está sobre a faixa colorida do eleito (fundo do partido). Herda a
   * tinta da faixa em vez de `--text-primary` — ver o cabeçalho.
   */
  sobreFaixa?: boolean;
}

export function DestinoEtiqueta({ destino, sobreFaixa = false }: DestinoEtiquetaProps) {
  const texto = etiquetaDestino(destino);
  if (texto === null) return null;
  return (
    <span
      data-destino={destino}
      data-testid="destino-etiqueta"
      style={sobreFaixa ? ESTILO_SOBRE_FAIXA : ESTILO}
    >
      <span className="sr-only">, </span>
      {texto}
    </span>
  );
}
