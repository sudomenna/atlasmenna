/**
 * tests/unit/state/store-por-pagina.servidor.test.ts
 *
 * Ambiente `node` (o default de `vitest.config.ts`) — **sem `window`**. É o que
 * o render de servidor vê.
 *
 * ## A decisão que este arquivo trava
 *
 * `storeUnicaPorPagina` registra a store no `globalThis` **só no navegador**.
 * No servidor, cada avaliação cria a sua e nada é pendurado no `globalThis`.
 *
 * Não é simetria estética: no navegador `globalThis` é um objeto por documento,
 * por pessoa; no servidor é **um objeto para todas as requisições de todas as
 * pessoas**. Uma store de UI pendurada ali é, por construção, estado de uma
 * visita visível para a visita seguinte.
 *
 * Hoje nenhuma escrita acontece durante o SSR — `useHoverStore` e
 * `useMunicipioSheetStore` só são escritas em evento de ponteiro, clique ou
 * foco, que não existem no servidor. Mas isso é verdade por acidente do que os
 * componentes fazem hoje, e é exatamente o tipo de premissa que some numa
 * refatoração sem deixar rastro. O teste existe para que a premissa deixe de
 * ser necessária.
 *
 * ## Mutação que este arquivo mata (aplicada de verdade em 2026-09-20)
 *
 *   3. remover o `if (typeof window === "undefined") return criar();` de
 *      `lib/state/store-por-pagina.ts` (registro global também no servidor)
 *      → morrem os dois casos abaixo.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  __limparRegistroDeStoresParaTestes,
  storeUnicaPorPagina,
} from "@/lib/state/store-por-pagina";

beforeEach(() => {
  __limparRegistroDeStoresParaTestes();
});

describe("no servidor (sem `window`)", () => {
  it("controle do instrumento: este arquivo roda mesmo sem DOM", () => {
    expect(typeof window, "o ambiente tem `window` — este arquivo não prova nada").toBe(
      "undefined",
    );
  });

  it("cada avaliação cria a SUA store — nada é compartilhado entre chamadas [mutação: registro global também no servidor]", () => {
    const primeira = storeUnicaPorPagina("servidor", () => ({ marca: 1 }));
    const segunda = storeUnicaPorPagina("servidor", () => ({ marca: 1 }));

    expect(
      primeira,
      "a store do servidor está sendo reaproveitada — no servidor isso é uma requisição enxergando a outra",
    ).not.toBe(segunda);
  });

  it("e NADA é pendurado no `globalThis` — o vazamento entre requisições nem tem onde morar", () => {
    storeUnicaPorPagina("servidor", () => ({ marca: 1 }));

    const chave = Symbol.for("atlasmenna/state/registro-de-stores");
    expect(
      (globalThis as unknown as Record<symbol, unknown>)[chave],
      "o registro global existe no servidor — estado de uma visita pode alcançar a seguinte",
    ).toBeUndefined();
  });
});
