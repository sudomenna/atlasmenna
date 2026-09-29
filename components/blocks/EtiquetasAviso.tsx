/**
 * components/blocks/EtiquetasAviso.tsx
 *
 * O aviso obrigatório em toda superfície que mostra etiqueta editorial
 * (spec 024, RF-237; ADR-0059 — constituição 1.6 § 8): diz que a
 * classificação é nossa, que tem fonte e data, e que não é dado do TSE nem
 * resultado do modelo — e leva à página de critérios.
 *
 * O texto é do dono (29/09) e é literal; a frase mora aqui, num lugar só.
 */

import Link from "next/link";

import styles from "./EtiquetasAviso.module.css";

export const TEXTO_AVISO_ETIQUETAS =
  "Classificação editorial do AtlasMenna, com fonte e data — não é dado do TSE nem resultado do modelo.";

export const ROTA_METODOLOGIA_ETIQUETAS = "/sobre-as-etiquetas";

export function EtiquetasAviso() {
  return (
    <p className={styles.aviso} data-testid="etiquetas-aviso">
      {TEXTO_AVISO_ETIQUETAS} <Link href={ROTA_METODOLOGIA_ETIQUETAS}>Como classificamos</Link>
    </p>
  );
}
