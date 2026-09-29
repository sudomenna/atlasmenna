/**
 * tests/e2e/_isencoes-axe.ts — as isenções do portão de acessibilidade que
 * precisam de teste próprio (sem Playwright aqui, para o vitest importar:
 * `tests/unit/e2e/isencoes-axe.test.ts`).
 */

/**
 * O `<text>` do ladrilho do mapa dos palanques (V3, spec 025), como o axe o
 * nomeia: `g[data-uf="SP"][…] > .PalanquesMapa-module__<hash>__sigla[…]`.
 * Só as classes `sigla` e `codigo`, só dentro de um `g[data-uf]` — nada mais
 * do mapa, nem de outro componente. O contraste dessas duas classes é medido
 * em `tests/unit/design-system/palanques-mapa-contraste.test.tsx`; ver a nota
 * da quarta isenção em `a11y-audit.spec.ts`.
 */
export const TEXTO_DO_LADRILHO_DOS_PALANQUES =
  /^g\[data-uf="[A-Z]{2}"\][^>]* > \.PalanquesMapa-module__[A-Za-z0-9_-]+__(sigla|codigo)(\[|$)/;

/** O código da legenda do mapa dos palanques ("=", "≠", "LU"…), como o axe o nomeia. */
export const CODIGO_DA_LEGENDA_DOS_PALANQUES =
  /(^|[ >])\.PalanquesMapa-module__[A-Za-z0-9_-]+__codigoLegenda$/;

/**
 * O "≠" da legenda: o axe o põe em `incomplete` com `messageKey: "nonBmp"`
 * ("o conteúdo é só símbolo, não texto") e não mede o contraste. Isento só
 * quando os DOIS batem — a classe exata e TODOS os motivos `nonBmp`; qualquer
 * outro motivo (fundo indecidível, oclusão) continua reprovando.
 */
export function isencaoPorSimbolo(alvo: string, motivos: readonly string[]): boolean {
  return (
    CODIGO_DA_LEGENDA_DOS_PALANQUES.test(alvo) &&
    motivos.length > 0 &&
    motivos.every((m) => m === "nonBmp")
  );
}
