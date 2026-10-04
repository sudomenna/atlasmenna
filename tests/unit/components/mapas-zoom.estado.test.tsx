// @vitest-environment happy-dom
/**
 * tests/unit/components/mapas-zoom.estado.test.tsx
 *
 * ADR-0071 — interação de zoom do mapa do estado por município
 * (`ChoroplethMapUF`). Mesmo contrato do mapa do Brasil
 * (`mapas-zoom.nacional.test.tsx`), com as diferenças do estado: o
 * enquadramento nasce do `bounds` do construtor (limites só no `load`), o teto
 * é z11 e o botão ⟲ refaz o `fitBounds` da UF.
 *
 * Mutações que este arquivo pega:
 *   M1 — remover `desligarDoMapaVivo()` do cleanup → "desregistra no unmount" e
 *        "troca de UF".
 *   M3 — inverter o `if (desktop)` de `attachInteractionMode` → "modo por largura".
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UF_BBOX } from "@/components/atoms/maps/_shared";
import { useHoverStore } from "@/lib/state/hover-store";
import { type MapZoomControls, useMapZoomStore } from "@/lib/state/map-zoom-store";

import {
  config,
  instalaMatchMedia,
  instancias,
  resetaSpyMap,
  type SpyMap,
  ultimoMapa,
} from "./_spy-map";

vi.mock("maplibre-gl", async () => {
  const { SpyMap } = await import("./_spy-map");
  return { default: { Map: SpyMap } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("@/components/atoms/maps/_pmtiles-protocol", () => ({
  registerPmtilesProtocolOnce: () => {},
  resetPmtilesProtocol: () => {},
}));

import { ChoroplethMapUF } from "@/components/atoms/maps/ChoroplethMapUF";

let host: HTMLElement;
let root: Root;
let mq: ReturnType<typeof instalaMatchMedia>;

function renderiza(ufSigla: string) {
  act(() => {
    root.render(
      <ChoroplethMapUF
        ufSigla={ufSigla}
        municipios={[{ cod_ibge: "3550308", cor: "var(--party-pt)", pctApurado: 40 }]}
        mode="leader"
        detalhe={[
          {
            cod_ibge: "3550308",
            nome: "São Paulo",
            pct_apurado: 40,
            lider: { candidato_id: 13, partido: "PT", votos: 100, margem_pp: 10 },
            votos_reportados: { 13: 900, 22: 500 },
          },
        ]}
        candidatos={[]}
      />,
    );
  });
}

function monta(desktop: boolean, ufSigla = "SP", ponteiroFino = false) {
  mq = instalaMatchMedia(desktop, ponteiroFino);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  renderiza(ufSigla);
  return ultimoMapa();
}

function desmonta() {
  act(() => root.unmount());
  host.remove();
}

function carrega(map: SpyMap) {
  act(() => map.emit("load"));
}

beforeEach(() => {
  resetaSpyMap();
  useMapZoomStore.setState({ controls: null, canReset: false });
  useHoverStore.getState().clear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("opções do construtor e canvas (ADR-0071)", () => {
  it("duplo clique, caixa de seleção, teclado, rotação e cópias do mundo desligados; roda ligada", () => {
    const map = monta(true);
    expect(map.opts.doubleClickZoom).toBe(false);
    expect(map.opts.boxZoom).toBe(false);
    expect(map.opts.keyboard).toBe(false);
    expect(map.opts.renderWorldCopies).toBe(false);
    expect(map.opts.dragRotate).toBe(false);
    expect(map.opts.touchPitch).toBe(false);
    expect(map.opts.scrollZoom).toBe(true);
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledTimes(1);
    desmonta();
  });

  it("canvas continua fora do Tab (regressão: já era assim antes do ADR-0071)", () => {
    const map = monta(true);
    expect(map.canvas.tabIndex).toBe(-1);
    desmonta();
  });
});

describe("modo por largura de tela (corte de 960px)", () => {
  it("🔴 ≥ 960px: cooperativo desligado [mutação M3: inverter o `if (desktop)`]", () => {
    const map = monta(true);
    expect(map.cooperativeGestures.disable).toHaveBeenCalled();
    expect(map.cooperativeGestures.enable).not.toHaveBeenCalled();
    desmonta();
  });

  it("🔴 < 960px: cooperativo ligado e roda mantida para Ctrl/⌘ [mutação M3]", () => {
    const map = monta(false);
    expect(map.cooperativeGestures.enable).toHaveBeenCalled();
    expect(map.cooperativeGestures.disable).not.toHaveBeenCalled();
    expect(map.scrollZoom.enable).toHaveBeenCalled();
    desmonta();
  });

  it("troca de modo ao cruzar o corte; o listener sai com o mapa", () => {
    const map = monta(true);
    map.cooperativeGestures.enable.mockClear();
    act(() => mq.setDesktop(false));
    expect(map.cooperativeGestures.enable).toHaveBeenCalledTimes(1);
    desmonta();
    expect(mq.ouvintes.size).toBe(0);
  });
});

describe("limites de zoom e de arraste (aplicados no `load`, depois do fitBounds do construtor)", () => {
  it("🔴 nada de limite antes do `load` — o enquadramento inicial sai intacto", () => {
    const map = monta(true);
    expect(map.setMinZoom).not.toHaveBeenCalled();
    expect(map.setMaxZoom).not.toHaveBeenCalled();
    expect(map.setMaxBounds).not.toHaveBeenCalled();
    expect(map.opts.bounds).toEqual(UF_BBOX.SP);
    desmonta();
  });

  it("piso = o enquadramento da UF; teto = z11", () => {
    config.cameraZoom = 6.3;
    const map = monta(true);
    carrega(map);
    expect(map.setMinZoom).toHaveBeenCalledWith(6.3);
    expect(map.setMaxZoom).toHaveBeenCalledWith(11);
    desmonta();
  });

  it("UF minúscula numa tela grande: o teto nunca fica abaixo do piso + 2", () => {
    config.cameraZoom = 10.8;
    const map = monta(true, "DF");
    carrega(map);
    expect(map.setMaxZoom).toHaveBeenCalledWith(12.8);
    desmonta();
  });

  it("limites de arraste cobrem a vista inicial e a UF", () => {
    config.viewport = [
      [-60, -30],
      [-30, -10],
    ];
    const map = monta(true);
    carrega(map);
    const args = map.setMaxBounds.mock.calls[0] as unknown as [[number, number, number, number]];
    const [w, s, e, n] = args[0];
    const [uw, us, ue, un] = UF_BBOX.SP as [number, number, number, number];
    expect(w).toBeLessThanOrEqual(Math.min(-60, uw));
    expect(s).toBeLessThanOrEqual(Math.min(-30, us));
    expect(e).toBeGreaterThanOrEqual(Math.max(-30, ue));
    expect(n).toBeGreaterThanOrEqual(Math.max(-10, un));
    desmonta();
  });
});

describe("botões +/−/⟲ via useMapZoomStore", () => {
  it("registra no `load` com o rótulo do estado", () => {
    const map = monta(true);
    expect(useMapZoomStore.getState().controls).toBeNull();
    carrega(map);
    expect(useMapZoomStore.getState().controls?.resetLabel).toBe("Ver o estado inteiro");
    desmonta();
  });

  it("🔴 desregistra no unmount [mutação M1: remover `desligarDoMapaVivo()` do cleanup]", () => {
    const map = monta(true);
    carrega(map);
    desmonta();
    expect(useMapZoomStore.getState().controls).toBeNull();
    expect(map.removido).toBe(true);
    expect(map.quantosHandlers("moveend")).toBe(0);
  });

  it("🔴 trocar de UF recria o mapa e o controle velho não sobra apontando para o mapa morto [mutação M1]", () => {
    const sp = monta(true, "SP");
    carrega(sp);
    const doSp = useMapZoomStore.getState().controls;
    expect(doSp).not.toBeNull();

    renderiza("RJ");
    expect(sp.removido).toBe(true);
    expect(instancias).toHaveLength(2);
    // O mapa novo ainda não carregou: nada registrado — e, em particular, não o do SP.
    expect(useMapZoomStore.getState().controls).toBeNull();

    carrega(ultimoMapa());
    const doRj = useMapZoomStore.getState().controls;
    expect(doRj).not.toBeNull();
    expect(doRj).not.toBe(doSp);
    desmonta();
  });

  it("não apaga o controle de OUTRO mapa registrado depois", () => {
    const map = monta(true);
    carrega(map);
    const doOutro: MapZoomControls = {
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      reset: vi.fn(),
      resetLabel: "Ver o Brasil inteiro",
    };
    useMapZoomStore.getState().register(doOutro);
    desmonta();
    expect(useMapZoomStore.getState().controls).toBe(doOutro);
  });

  it("+ / − / ⟲ chamam o mapa, sem `essential`", () => {
    const map = monta(true);
    carrega(map);
    const c = useMapZoomStore.getState().controls as MapZoomControls;
    c.zoomIn();
    c.zoomOut();
    c.reset();
    expect(map.zoomIn).toHaveBeenCalledWith({ duration: 250 });
    expect(map.zoomOut).toHaveBeenCalledWith({ duration: 250 });
    expect(map.fitBounds).toHaveBeenCalledWith(UF_BBOX.SP, {
      padding: 16,
      duration: 400,
      linear: true,
    });
    desmonta();
  });

  it("⟲ só habilita quando a câmera sai do enquadramento", () => {
    config.cameraZoom = 6.3;
    const map = monta(true);
    carrega(map);
    expect(useMapZoomStore.getState().canReset).toBe(false);
    map.zoom = 8;
    act(() => map.emit("moveend"));
    expect(useMapZoomStore.getState().canReset).toBe(true);
    map.zoom = 6.3;
    act(() => map.emit("moveend"));
    expect(useMapZoomStore.getState().canReset).toBe(false);
    desmonta();
  });
});

describe("balão fecha quando o mapa se move por baixo dele", () => {
  it('🔴 `movestart` fecha o balão e limpa o hover do mapa [mutação: remover o `map.on("movestart")`]', () => {
    // Ponteiro fino ligado: sem ele o balão nem abre (toque só abre a gaveta).
    const map = monta(true, "SP", true);
    act(() =>
      map.emit("mousemove:municipios-fill", {
        features: [{ properties: { CD_MUN: "3550308" } }],
        originalEvent: { clientX: 10, clientY: 10 },
      }),
    );
    expect(host.querySelector('[data-testid="hover-card"]')).not.toBeNull();
    expect(useHoverStore.getState().hovered).toEqual({ type: "municipio", codIbge: "3550308" });

    act(() => map.emit("movestart"));
    expect(host.querySelector('[data-testid="hover-card"]')).toBeNull();
    expect(useHoverStore.getState().hovered).toBeNull();
    desmonta();
  });
});
