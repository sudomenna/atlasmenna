// @vitest-environment happy-dom
/**
 * tests/unit/components/mapas-zoom.reenquadramento.test.tsx
 *
 * ADR-0071 — reenquadramento quando o CONTÊINER muda de tamanho depois do
 * mount (barra do navegador do celular, rotação, layout assentando). Antes o
 * enquadramento só era calculado no mount e o `minZoom` ficava travado nele: se
 * a área encolhia, nem pinça nem ⟲ afastavam o bastante; se crescia, o Brasil
 * ficava deslocado com o ⟲ habilitado sem o usuário ter tocado.
 *
 * Os dois mapas (`_NationalChoroplethMapImpl`, `ChoroplethMapUF`) usam o mesmo
 * helper (`attachReframeOnResize`); cada caso roda nos dois.
 *
 * Mutações que este arquivo pega:
 *   R1 — remover o `map.jumpTo` de `attachReframeOnResize` → "câmera no
 *        enquadramento + resize".
 *   R2 — remover o `applyZoomLimits` do `onResize` → "piso novo".
 *   R3 — trocar `!usuarioMexeu` por `true` (sempre move) → "usuário mexeu".
 *   R4 — remover `map.off("resize", ...)` → "listener removido".
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHoverStore } from "@/lib/state/hover-store";
import { useMapZoomStore } from "@/lib/state/map-zoom-store";

import { config, instalaMatchMedia, resetaSpyMap, type SpyMap, ultimoMapa } from "./_spy-map";

vi.mock("maplibre-gl", async () => {
  const { SpyMap } = await import("./_spy-map");
  return { default: { Map: SpyMap } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("@/components/atoms/maps/_pmtiles-protocol", () => ({
  registerPmtilesProtocolOnce: () => {},
  resetPmtilesProtocol: () => {},
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

import { ChoroplethMapUF } from "@/components/atoms/maps/ChoroplethMapUF";
import { NationalChoroplethMapImpl } from "@/components/blocks/_NationalChoroplethMapImpl";

let host: HTMLElement;
let root: Root;
const caixa = { w: 375, h: 600 };

function render(node: React.ReactNode) {
  instalaMatchMedia(false);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(node));
  return ultimoMapa();
}

const CASOS = [
  {
    nome: "Brasil",
    // zoom inicial → zoom do tamanho maior → zoom do tamanho menor (todos acima do piso do dataset)
    zoomInicial: 3.4,
    zoomMaior: 3.9,
    zoomMenor: 3.0,
    teto: (z: number) => z + 4,
    piso: (z: number) => z,
    monta: () => render(<NationalChoroplethMapImpl candidatoAId={13} rows={[]} view="winner" />),
    carrega: (m: SpyMap) => act(() => m.emit("load")),
  },
  {
    nome: "Estado",
    zoomInicial: 5.5,
    zoomMaior: 6.2,
    zoomMenor: 4.8,
    teto: (z: number) => Math.max(11, z + 2),
    piso: (z: number) => Math.max(z, 3),
    monta: () =>
      render(
        <ChoroplethMapUF
          ufSigla="SP"
          municipios={[{ cod_ibge: "3550308", cor: "var(--party-pt)", pctApurado: 40 }]}
          mode="leader"
        />,
      ),
    carrega: (m: SpyMap) => act(() => m.emit("load")),
  },
];

beforeEach(() => {
  resetaSpyMap();
  caixa.w = 375;
  caixa.h = 600;
  useMapZoomStore.setState({ controls: null, canReset: false });
  useHoverStore.getState().clear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        width: caixa.w,
        height: caixa.h,
        top: 0,
        left: 0,
        right: caixa.w,
        bottom: caixa.h,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe.each(CASOS)("reenquadramento no resize — $nome", (c) => {
  /** O contêiner cresce/encolhe: o enquadramento do tamanho novo muda e o MapLibre avisa. */
  function redimensiona(map: SpyMap, zoomNovo: number, w = 430, h = 932) {
    caixa.w = w;
    caixa.h = h;
    config.cameraZoom = zoomNovo;
    act(() => {
      map.emit("resize");
      // O MapLibre fecha o `resize` com um `moveend`.
      map.emit("moveend");
    });
  }

  function sobe() {
    config.cameraZoom = c.zoomInicial;
    const map = c.monta();
    c.carrega(map);
    return map;
  }

  it("🔴 câmera no enquadramento + resize → jumpTo no enquadramento novo [R1: remover o jumpTo]", () => {
    const map = sobe();
    const antes = map.jumpTo.mock.calls.length;
    redimensiona(map, c.zoomMaior);
    expect(map.jumpTo).toHaveBeenCalledTimes(antes + 1);
    const arg = map.jumpTo.mock.lastCall?.[0] as { zoom: number; center: number[] };
    expect(arg.zoom).toBe(c.piso(c.zoomMaior));
    expect(arg.center).toEqual([-51.415, -14.24]);
    expect(map.zoom).toBe(c.piso(c.zoomMaior));
  });

  it("🔴 piso e teto de zoom refeitos com o enquadramento novo [R2: remover o applyZoomLimits]", () => {
    const map = sobe();
    redimensiona(map, c.zoomMaior);
    expect(map.minZoom).toBe(c.piso(c.zoomMaior));
    expect(map.maxZoom).toBe(c.teto(c.zoomMaior));
    // e a caixa de arraste é recalculada DEPOIS do jumpTo (usa a vista nova)
    expect(map.ordem.at(-1)).toBe("setMaxBounds");
    expect(map.ordem.lastIndexOf("jumpTo")).toBeLessThan(map.ordem.lastIndexOf("setMinZoom"));
  });

  it("🔴 contêiner que ENCOLHE: o piso baixa ANTES do jumpTo (senão ele é travado) e o mapa chega ao enquadramento", () => {
    const map = sobe();
    expect(map.minZoom).toBe(c.piso(c.zoomInicial));
    const antes = map.ordem.length;
    redimensiona(map, c.zoomMenor, 320, 480);
    const depois = map.ordem.slice(antes);
    const iJump = depois.indexOf("jumpTo");
    expect(iJump).toBeGreaterThan(-1);
    expect(depois.slice(0, iJump)).toContain("setMinZoom");
    // o 1º setMinZoom do resize solta o piso (≤ zoom de destino)
    const primeiroPiso = map.setMinZoom.mock.calls.at(-2)?.[0] as number;
    expect(primeiroPiso).toBeLessThanOrEqual(c.piso(c.zoomMenor));
    expect(map.zoom).toBe(c.piso(c.zoomMenor));
    expect(map.minZoom).toBe(c.piso(c.zoomMenor));
  });

  it("🔴 reenquadrou → o ⟲ fica desabilitado (resize termina em moveend)", () => {
    const map = sobe();
    redimensiona(map, c.zoomMaior);
    expect(useMapZoomStore.getState().controls).not.toBeNull();
    expect(useMapZoomStore.getState().canReset).toBe(false);
  });

  it("🔴 usuário mexeu + resize → câmera fica onde está; piso novo permite voltar ao enquadramento [R3: sempre mover]", () => {
    const map = sobe();
    map.zoom = c.piso(c.zoomInicial) + 2; // o usuário ampliou
    act(() => map.emit("moveend"));
    const saltos = map.jumpTo.mock.calls.length;

    redimensiona(map, c.zoomMenor, 320, 480);

    expect(map.jumpTo).toHaveBeenCalledTimes(saltos);
    expect(map.zoom).toBe(c.piso(c.zoomInicial) + 2);
    expect(map.minZoom).toBeLessThanOrEqual(c.piso(c.zoomMenor));
    // e o ⟲ segue habilitado: ele não está no enquadramento
    expect(useMapZoomStore.getState().canReset).toBe(true);
  });

  it("contêiner 0×0 (aba escondida) → não faz nada", () => {
    const map = sobe();
    const antes = map.ordem.length;
    const minAntes = map.minZoom;
    caixa.w = 0;
    caixa.h = 0;
    config.cameraZoom = c.zoomMaior;
    act(() => map.emit("resize"));
    expect(map.ordem.length).toBe(antes);
    expect(map.minZoom).toBe(minAntes);
  });

  it("🔴 o listener de resize sai com o mapa [R4: remover o map.off]", () => {
    const map = sobe();
    expect(map.quantosHandlers("resize")).toBe(1);
    act(() => root.unmount());
    expect(map.quantosHandlers("resize")).toBe(0);
    expect(map.quantosHandlers("moveend")).toBe(0);
    // remonta um nó para o afterEach desmontar sem erro
    root = createRoot(host);
  });

  it("falha dentro do reenquadramento não derruba o mapa", () => {
    const map = sobe();
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    map.setMaxZoom.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => redimensiona(map, c.zoomMaior)).not.toThrow();
    expect(erro).toHaveBeenCalled();
  });
});
