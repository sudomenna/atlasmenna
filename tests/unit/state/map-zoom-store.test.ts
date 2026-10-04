/**
 * tests/unit/state/map-zoom-store.test.ts
 *
 * ADR-0071 — a ponte entre o mapa vivo e os botões +/−/⟲. O ponto que importa:
 * `unregister(c)` só limpa se `c` for o controle registrado AGORA. Trocar
 * Brasil → estado destrói um mapa e cria outro; o desregistro do morto pode
 * chegar depois do registro do vivo.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { type MapZoomControls, useMapZoomStore } from "@/lib/state/map-zoom-store";

function controle(resetLabel = "Ver o Brasil inteiro"): MapZoomControls {
  return { zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn(), resetLabel };
}

beforeEach(() => {
  useMapZoomStore.setState({ controls: null, canReset: false });
});

describe("useMapZoomStore", () => {
  it("nasce vazia", () => {
    expect(useMapZoomStore.getState().controls).toBeNull();
    expect(useMapZoomStore.getState().canReset).toBe(false);
  });

  it("register guarda o controle e zera o `canReset` (mapa novo nasce no enquadramento)", () => {
    useMapZoomStore.setState({ canReset: true });
    const c = controle();
    useMapZoomStore.getState().register(c);
    expect(useMapZoomStore.getState().controls).toBe(c);
    expect(useMapZoomStore.getState().canReset).toBe(false);
  });

  it("unregister do controle registrado limpa controle e `canReset`", () => {
    const c = controle();
    useMapZoomStore.getState().register(c);
    useMapZoomStore.getState().setCanReset(true);
    useMapZoomStore.getState().unregister(c);
    expect(useMapZoomStore.getState().controls).toBeNull();
    expect(useMapZoomStore.getState().canReset).toBe(false);
  });

  it("🔴 unregister de um controle que NÃO é o registrado não apaga nada [mutação: remover a comparação `get().controls !== controls`]", () => {
    const velho = controle("Ver o Brasil inteiro");
    const novo = controle("Ver o estado inteiro");
    useMapZoomStore.getState().register(velho);
    useMapZoomStore.getState().register(novo); // o mapa novo registrou antes de o velho sair
    useMapZoomStore.getState().setCanReset(true);

    useMapZoomStore.getState().unregister(velho);

    expect(useMapZoomStore.getState().controls).toBe(novo);
    expect(useMapZoomStore.getState().canReset).toBe(true);
  });

  it("unregister sem nada registrado é inofensivo", () => {
    expect(() => useMapZoomStore.getState().unregister(controle())).not.toThrow();
    expect(useMapZoomStore.getState().controls).toBeNull();
  });
});
