/**
 * components/atoms/data/EtiquetaEditorial.tsx
 *
 * UMA etiqueta editorial ("Base do governo", "Palanque de Lula", "Centrão") —
 * spec 024, RF-235. Molde: `DestinoEtiqueta`.
 *
 * - **Texto, não cor.** A palavra é a informação; a cor é neutra e a borda,
 *   tracejada — para não ser confundida nem com cor de partido nem com a
 *   etiqueta de destino do voto, que é dado do TSE (ver o CSS).
 * - **Nunca interativa.** Um `<span>` sem `tabIndex`, `role` ou handler: no
 *   /senador ela mora dentro do `<a>` do cartão, e controle dentro de link é
 *   HTML inválido e armadilha de teclado.
 * - **Nunca "a classificar".** `rotuloDoValor` devolve `null` para a
 *   sentinela, para id desconhecido e para `centrao: nao` — e aí nada é
 *   renderizado. Não existe caminho de id cru para a tela.
 * - **Leitor de tela** ouve "Fulano, relação com o governo Lula: Base do
 *   governo" — a vírgula e o nome da categoria vão num `sr-only`, sem
 *   aparecer.
 */

import { categoria as defCategoria, isCategoriaId, rotuloDoValor } from "@/lib/etiquetas/catalogo";

import styles from "./EtiquetaEditorial.module.css";

export interface EtiquetaEditorialProps {
  categoria: string;
  valor: string | null | undefined;
}

export function EtiquetaEditorial({ categoria, valor }: EtiquetaEditorialProps) {
  const rotulo = rotuloDoValor(categoria, valor);
  if (rotulo === null) return null;
  const acessivel = isCategoriaId(categoria) ? defCategoria(categoria).rotuloAcessivel : null;
  return (
    <span
      className={styles.etiqueta}
      data-etiqueta={categoria}
      data-valor={valor ?? undefined}
      data-testid="etiqueta-editorial"
    >
      <span className="sr-only">{acessivel ? `, ${acessivel}: ` : ", "}</span>
      {rotulo}
    </span>
  );
}
