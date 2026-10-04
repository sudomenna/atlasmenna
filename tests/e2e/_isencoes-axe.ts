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

/**
 * O contêiner de UMA lista de agremiação da página de UF de Deputado Federal
 * (`components/blocks/DeputadoListaAgremiacao.tsx`) — o elemento que leva
 * `content-visibility: auto`.
 */
export const SELETOR_LISTA_DEPUTADO = '[data-testid="dep-lista-agremiacao"]';

/**
 * O ESCOPO da isenção, conferido no navegador com `Element.closest()` — nunca
 * pelo texto do seletor que o axe gera (um `#id > li…` opaco, que não diz de
 * onde o nó vem). Dois blocos, e só eles, os dois medidos em 30/09:
 *
 *   - `uf-agremiacao` — o bloco INTEIRO de uma agremiação (cabeçalho com
 *     votos, federação e puxadores, e a lista logo abaixo). O cabeçalho não
 *     tem `content-visibility`, mas fica colado numa lista pulada, e o axe o
 *     declara `elmPartiallyObscuring`;
 *   - `dep-regras` — o painel "Regras" que vem logo DEPOIS da última
 *     agremiação: no WebKit a 375 px o 1º parágrafo dele sai
 *     `elmPartiallyObscuring` pelo mesmo motivo (some com o
 *     `content-visibility` desligado).
 *   - `uf-conferencia` (04/10) — o parágrafo de conferência, que também vem
 *     depois das agremiações: com a linha "projeção ≈ N mil · não oficial"
 *     (RF-297) as linhas ficaram mais altas, a fronteira do trecho montado
 *     mudou, e ele passou a sair `elmPartiallyObscuring` a 1280 px nos dois
 *     navegadores. Some com o `content-visibility` desligado (medido 04/10).
 */
export const SELETOR_AGREMIACAO_DEPUTADO =
  '[data-testid="uf-agremiacao"], [data-testid="dep-regras"], [data-testid="uf-conferencia"]';

/**
 * CSS que desliga o `content-visibility` das listas — para a PROVA: com ele, o
 * navegador monta todas as agremiações, e o axe mede o contraste de cada nó
 * que a isenção abaixo deixou passar.
 */
export const CSS_LISTAS_DEPUTADO_VISIVEIS = `${SELETOR_LISTA_DEPUTADO}{content-visibility:visible !important}`;

/**
 * Os motivos com que o axe declara "não consegui decidir o contraste" para um
 * nó de agremiação pulada pelo `content-visibility: auto` — medidos em 30/09
 * contra o build de `build:e2e` (fixture do simulado), `/uf/SP/deputado-federal`
 * aberta no topo, sem rolar:
 *
 *   `bgOverlap` .............. ~140 nós (1280 px): o miolo da lista pulada;
 *   `elmPartiallyObscuring` .. cabeçalho da agremiação colado na lista pulada;
 *   `elmPartiallyObscured` ... linhas na fronteira do trecho montado (375 px);
 *   `shortTextContent` ....... votos da 20ª linha, a última antes do recorte;
 *   `imgNode` (04/10) ........ `<small>nº …</small>` de linha de agremiação no
 *                               WebKit (375 e 1280 px), depois da linha de voto
 *                               projetado (RF-297) — zero com o
 *                               `content-visibility` desligado, nos dois temas.
 *
 * Com `CSS_LISTAS_DEPUTADO_VISIVEIS` aplicado, a MESMA página cai para UM nó
 * indecidido — a marca do masthead, isenta desde 18/09. Ou seja: os quatro
 * motivos vêm do `content-visibility`, e nada mais.
 *
 * ⚠️ Não é o que a auditoria G6 supôs: ela atribuiu a oclusão à rolagem
 * horizontal do celular. A rolagem sumiu com o conserto do botão, e a oclusão
 * continuou — inclusive a 1280 px, onde nunca houve rolagem.
 */
export const MOTIVOS_CONTENT_VISIBILITY: readonly string[] = [
  "bgOverlap",
  "elmPartiallyObscured",
  "elmPartiallyObscuring",
  "shortTextContent",
  "imgNode",
];

/**
 * A exceção CONHECIDA de `content-visibility: auto` nas listas de Deputado
 * (decisão do dono, 30/09 — auditoria G6 da spec 026: velocidade acima da
 * árvore de acessibilidade fora da tela).
 *
 * Isento só quando os DOIS batem: o nó está dentro do bloco de uma agremiação
 * E todos os motivos são de {@link MOTIVOS_CONTENT_VISIBILITY}. Qualquer outro
 * motivo (fundo em imagem, pseudo-elemento, símbolo) continua reprovando, e
 * os mesmos motivos fora de uma agremiação também.
 *
 * 🔴 Isenção CONDICIONADA A PROVA: quem a usa tem de repetir o axe com
 * {@link CSS_LISTAS_DEPUTADO_VISIVEIS} e exigir zero violação e zero
 * indecidido SEM esta isenção (`a11y-audit.spec.ts`). Sem a prova, isentar
 * seria desligar o portão de contraste para ~1.000 linhas.
 */
export function isencaoAgremiacaoDeputadoPulada(
  dentroDaAgremiacao: boolean,
  motivos: readonly string[],
): boolean {
  return (
    dentroDaAgremiacao &&
    motivos.length > 0 &&
    motivos.every((m) => MOTIVOS_CONTENT_VISIBILITY.includes(m))
  );
}
