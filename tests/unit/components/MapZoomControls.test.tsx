// @vitest-environment happy-dom
/**
 * tests/unit/components/MapZoomControls.test.tsx
 *
 * ADR-0071 — os botões +/−/⟲. Falam com o mapa SÓ pela `useMapZoomStore`
 * (este componente não importa `maplibre-gl` — RNF-007b).
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MapZoomControls } from "@/components/atoms/maps/MapZoomControls";
import styles from "@/components/atoms/maps/MapZoomControls.module.css";
import { type MapZoomControls as Controles, useMapZoomStore } from "@/lib/state/map-zoom-store";

let host: HTMLElement;
let root: Root;

function controle(): Controles {
  return {
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    reset: vi.fn(),
    resetLabel: "Ver o Brasil inteiro",
  };
}

function monta(variant: "desktop" | "bar" = "desktop") {
  act(() => root.render(<MapZoomControls variant={variant} />));
}

function botao(rotulo: string): HTMLButtonElement {
  const b = host.querySelector(`button[aria-label="${rotulo}"]`);
  expect(b, `botão "${rotulo}" não encontrado`).not.toBeNull();
  return b as HTMLButtonElement;
}

beforeEach(() => {
  useMapZoomStore.setState({ controls: null, canReset: false });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("<MapZoomControls>", () => {
  it("🔴 não renderiza NADA enquanto não há mapa registrado (nunca um botão que não faz nada)", () => {
    monta();
    expect(host.innerHTML).toBe("");
  });

  it("some de novo quando o mapa desregistra", () => {
    const c = controle();
    act(() => useMapZoomStore.getState().register(c));
    monta();
    expect(host.querySelectorAll("button")).toHaveLength(3);
    act(() => useMapZoomStore.getState().unregister(c));
    expect(host.innerHTML).toBe("");
  });

  it("três <button type=button> com nome acessível em pt-BR e ícone SVG decorativo", () => {
    act(() => useMapZoomStore.getState().register(controle()));
    monta();
    const botoes = [...host.querySelectorAll("button")];
    expect(botoes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Ampliar o mapa",
      "Reduzir o mapa",
      "Ver o Brasil inteiro",
    ]);
    for (const b of botoes) {
      expect(b.getAttribute("type")).toBe("button");
      const svg = b.querySelector("svg");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");
      expect(svg?.getAttribute("focusable")).toBe("false");
    }
  });

  it("o rótulo do ⟲ vem do mapa registrado (Brasil / estado)", () => {
    act(() =>
      useMapZoomStore.getState().register({ ...controle(), resetLabel: "Ver o estado inteiro" }),
    );
    monta();
    expect(botao("Ver o estado inteiro")).toBeDefined();
  });

  it("🔴 cada botão chama a função certa do mapa [mutação: trocar zoomIn por zoomOut no onClick]", () => {
    const c = controle();
    act(() => useMapZoomStore.getState().register(c));
    act(() => useMapZoomStore.getState().setCanReset(true));
    monta();

    act(() => botao("Ampliar o mapa").click());
    expect(c.zoomIn).toHaveBeenCalledTimes(1);
    expect(c.zoomOut).not.toHaveBeenCalled();

    act(() => botao("Reduzir o mapa").click());
    expect(c.zoomOut).toHaveBeenCalledTimes(1);

    act(() => botao("Ver o Brasil inteiro").click());
    expect(c.reset).toHaveBeenCalledTimes(1);
  });

  it("🔴 ⟲ fica desabilitado no enquadramento inicial e habilita quando a câmera sai dele", () => {
    act(() => useMapZoomStore.getState().register(controle()));
    monta();
    expect(botao("Ver o Brasil inteiro").disabled).toBe(true);
    // + e − seguem habilitados
    expect(botao("Ampliar o mapa").disabled).toBe(false);
    expect(botao("Reduzir o mapa").disabled).toBe(false);

    act(() => useMapZoomStore.getState().setCanReset(true));
    expect(botao("Ver o Brasil inteiro").disabled).toBe(false);
  });

  it("⟲ desabilitado não dispara o reset", () => {
    const c = controle();
    act(() => useMapZoomStore.getState().register(c));
    monta();
    act(() => botao("Ver o Brasil inteiro").click());
    expect(c.reset).not.toHaveBeenCalled();
  });

  it("as duas posições usam classes diferentes (desktop sobre o mapa / bar em fluxo no celular)", () => {
    act(() => useMapZoomStore.getState().register(controle()));
    monta("desktop");
    expect(host.firstElementChild?.className).toBe(styles.desktop);
    monta("bar");
    expect(host.firstElementChild?.className).toBe(styles.bar);
  });
});
