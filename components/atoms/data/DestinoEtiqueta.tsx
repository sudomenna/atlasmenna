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

export interface DestinoEtiquetaProps {
  destino: EdgeDestinoVoto | undefined;
}

export function DestinoEtiqueta({ destino }: DestinoEtiquetaProps) {
  const texto = etiquetaDestino(destino);
  if (texto === null) return null;
  return (
    <span data-destino={destino} data-testid="destino-etiqueta" style={ESTILO}>
      <span className="sr-only">, </span>
      {texto}
    </span>
  );
}
