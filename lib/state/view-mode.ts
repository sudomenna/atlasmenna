/**
 * lib/state/view-mode.ts
 *
 * Estado global do controle "Parcial / Projeção" do shell (ADR-0029 § 2).
 *
 * ## O que este estado É
 *
 * Apresentação pura. Os dois números — `pct_atual` (parcial) e
 * `pct_projetado` (projeção) — já vêm no MESMO payload do Edge Config, e as
 * duas colunas já estão sempre no DOM (ADR-0017: nada de collapsible). O
 * controle não busca dado novo, não muda rota e não muda o que o modelo
 * calculou: ele só diz **qual dos dois números a página enfatiza**.
 *
 * ## Por que não `searchParams` / `cookies()` / `headers()`
 *
 * A home e as 54 páginas de UF são pré-renderizadas estáticas. Qualquer uma
 * das três APIs acima torna a rota dinâmica (ADR-0025 § 2 e § 5) — é
 * exatamente a razão pela qual o `BaseToggle` da Fase 5 nunca foi ligado às
 * rotas (ver o cabeçalho de `components/blocks/ProjectionThermometers.tsx`).
 * Aqui o estado não precisa nem de rota nem de servidor: ele é uma
 * preferência de leitura do visitante, vive no cliente e some no reload.
 *
 * ## Como o estado chega na tela
 *
 * O valor é espelhado em `document.documentElement[data-view]`, e o CSS de
 * `app/globals.css` (bloco "ADR-0029 — ênfase Parcial/Projeção") decide, por
 * cascata, qual coluna fica em destaque e qual fica em segundo plano. Isso
 * significa que:
 *
 *   - o servidor renderiza `<html data-view="parcial">` (o default), então o
 *     primeiro paint já sai correto, sem flash e sem esperar hidratação;
 *   - componentes puramente textuais (linhas de candidato, o `<h1>` do
 *     painel) NÃO precisam virar Client Component para reagir — o CSS faz
 *     tudo, e o custo em JS deles é zero;
 *   - só quem precisa do valor em JavaScript de verdade — hoje apenas o
 *     mapa, que repinta o choropleth — assina a store via `useViewMode()`.
 *
 * Store própria em vez de `zustand` (que já é dependência, em
 * `lib/state/hover-store.ts`): este módulo entra ACIMA da dobra em todas as
 * rotas via o shell, e `useSyncExternalStore` (React, já no bundle) resolve
 * o caso com ~30 linhas. `zustand` custaria um pacote a mais no chunk do
 * shell para um estado de duas strings.
 *
 * ## Por que este arquivo NÃO importa React
 *
 * `app/layout.tsx` é Server Component e precisa de `VIEW_MODE_DEFAULT` para
 * escrever `data-view` no `<html>`. Um `import { useSyncExternalStore }` aqui
 * faria o Turbopack recusar o build inteiro ("You're importing a module that
 * depends on `useSyncExternalStore` into a React Server Component module") —
 * aconteceu de verdade em 2026-09-08, e só aparece no `next build`: typecheck,
 * lint e vitest passavam todos.
 *
 * Por isso o contrato (tipo, default, atributo, type guard) mora aqui, sem
 * React e sem `"use client"`, importável dos dois lados; e a store com o hook
 * mora em `lib/state/view-mode-client.ts`, que declara a diretiva.
 */

export type ViewMode = "parcial" | "proj";

/**
 * Base que a página abre. `parcial` desde 04/10/2026 ~17h (decisão do dono
 * na noite do 1º turno): abre no número oficial apurado pelo TSE, e a
 * projeção fica a um toque de distância. Até então era `proj` ("a projeção
 * é o produto", ADR-0029 § 2). Os dois números continuam visíveis lado a
 * lado nas linhas de candidato de qualquer forma.
 *
 * Precisa casar com o `data-view` que `app/layout.tsx` escreve no `<html>`,
 * senão o primeiro render do cliente diverge do HTML do servidor.
 */
export const VIEW_MODE_DEFAULT: ViewMode = "parcial";

/** Atributo espelhado no `<html>` — a ponte entre a store e a cascata CSS. */
export const VIEW_MODE_ATTRIBUTE = "data-view";

export function isViewMode(value: string | null | undefined): value is ViewMode {
  return value === "parcial" || value === "proj";
}
