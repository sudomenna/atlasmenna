/**
 * tests/e2e/_css-stub-loader.mjs — hook de carregamento do Node para o
 * renderizador `_serie-fixture-render.tsx`.
 *
 * O renderizador roda o gráfico com `tsx`, fora do Next. Desde 2026-10-04
 * (34783b3) o gráfico importa `SerieBaseAlternavel.module.css`, e o Node não
 * sabe carregar `.css` (ERR_UNKNOWN_FILE_EXTENSION) — o que derrubava a
 * COLETA do `serie-apuracao-a11y.spec.ts` e, com ela, o `pnpm test:e2e`
 * inteiro.
 *
 * Aqui todo `.css` vira um módulo cujo default devolve o próprio nome da
 * classe (`styles.chave` → "chave"). O HTML sai com nomes de classe que NÃO
 * casam com os nomes com hash do CSS compilado que o spec injeta: o estilo
 * próprio da chave Apuração | Projeção não é aplicado neste portão. Os tokens
 * de cor (globals.css) continuam valendo, e a chave com o estilo real é
 * auditada pelo `a11y-audit.spec.ts` nas rotas, que servem o gráfico com dado
 * do Edge Config falso.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".css") || url.includes(".css?")) {
    return {
      format: "module",
      shortCircuit: true,
      source:
        'export default new Proxy({}, { get: (_, k) => (typeof k === "string" ? k : undefined) });',
    };
  }
  return nextLoad(url, context);
}
