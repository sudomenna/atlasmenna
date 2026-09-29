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
 * - **Nunca categoria sem critério publicado** (spec 025, RF-250;
 *   constituição § 2 (a)): `categoriaExibivel` diz não ⇒ nada. É o que torna
 *   verdadeira, por construção, a frase "critério em definição — nenhuma
 *   etiqueta desta categoria é exibida" de `/sobre-as-etiquetas`.
 * - **Nunca "A favor" solto** (spec 025, RF-246): categoria com qualificador
 *   (`QUALIFICADOR_VISIVEL`, hoje o impeachment de ministros do STF) mostra a
 *   frase inteira, visível — "Posição pública sobre impeachment de ministros
 *   do STF: a favor".
 */

import {
  categoriaExibivel,
  categoria as defCategoria,
  isCategoriaId,
  QUALIFICADOR_VISIVEL,
  rotuloDoValor,
} from "@/lib/etiquetas/catalogo";

import styles from "./EtiquetaEditorial.module.css";

export interface EtiquetaEditorialProps {
  categoria: string;
  valor: string | null | undefined;
}

export function EtiquetaEditorial({ categoria, valor }: EtiquetaEditorialProps) {
  const rotulo = rotuloDoValor(categoria, valor);
  if (rotulo === null || !categoriaExibivel(categoria)) return null;
  const qualificador = isCategoriaId(categoria) ? QUALIFICADOR_VISIVEL[categoria] : undefined;
  if (qualificador) {
    // A frase inteira é visível — o qualificador não é detalhe de leitor de
    // tela, é o que dá sentido ao valor.
    return (
      <span
        className={styles.etiqueta}
        data-etiqueta={categoria}
        data-valor={valor ?? undefined}
        data-testid="etiqueta-editorial"
      >
        <span className="sr-only">, </span>
        {`${qualificador}: ${rotulo.toLocaleLowerCase("pt-BR")}`}
      </span>
    );
  }
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
