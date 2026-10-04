// @vitest-environment happy-dom
/**
 * tests/unit/state/view-mode.test.ts
 *
 * Store do controle "Parcial / Projeção" (ADR-0029 § 2).
 *
 * O que estes testes protegem, em ordem de importância:
 *
 *   1. O snapshot do servidor é o literal `VIEW_MODE_DEFAULT`. Se ele passar a
 *      ler o DOM, o primeiro render do cliente diverge do HTML do servidor e
 *      React descarta a árvore hidratada — uma regressão que não aparece em
 *      nenhum teste de componente, só como flash no navegador.
 *   2. A store espelha o valor em `document.documentElement[data-view]`. Esse
 *      atributo é o ÚNICO canal entre a store e a cascata de `globals.css`;
 *      sem ele, o controle troca o estado e a tela não muda.
 *   3. Nada aqui toca rede, rota ou `searchParams` — é o que mantém a home e
 *      as 54 páginas de UF estáticas (ADR-0025 § 2 e § 5).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { isViewMode, VIEW_MODE_ATTRIBUTE, VIEW_MODE_DEFAULT } from "@/lib/state/view-mode";
import {
  __resetViewModeForTests,
  setViewMode,
  subscribeViewMode,
} from "@/lib/state/view-mode-client";

beforeEach(() => {
  __resetViewModeForTests();
});

describe("view-mode store (ADR-0029 § 2)", () => {
  it("(a) o default é 'parcial' (desde 04/10/2026) — e é ele que `app/layout.tsx` escreve no <html>", () => {
    expect(VIEW_MODE_DEFAULT).toBe("parcial");
    expect(VIEW_MODE_ATTRIBUTE).toBe("data-view");
  });

  it("(b) `setViewMode` espelha o valor no <html> — o canal para a cascata CSS", () => {
    setViewMode("parcial");
    expect(document.documentElement.getAttribute("data-view")).toBe("parcial");

    setViewMode("proj");
    expect(document.documentElement.getAttribute("data-view")).toBe("proj");
  });

  it("(c) notifica assinantes só quando o valor MUDA", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeViewMode(listener);

    setViewMode("proj");
    expect(listener).toHaveBeenCalledTimes(1);

    // Mesmo valor → nenhum re-render disparado nos assinantes.
    setViewMode("proj");
    expect(listener).toHaveBeenCalledTimes(1);

    setViewMode("parcial");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setViewMode("proj");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("(d) `isViewMode` rejeita valor arbitrário vindo do DOM", () => {
    expect(isViewMode("proj")).toBe(true);
    expect(isViewMode("parcial")).toBe(true);
    expect(isViewMode("projecao")).toBe(false);
    expect(isViewMode(null)).toBe(false);
    expect(isViewMode(undefined)).toBe(false);
  });
});
