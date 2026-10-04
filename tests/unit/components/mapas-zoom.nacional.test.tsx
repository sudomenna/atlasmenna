// @vitest-environment happy-dom
/**
 * tests/unit/components/mapas-zoom.nacional.test.tsx
 *
 * ADR-0071 — interação de zoom do mapa do Brasil (`_NationalChoroplethMapImpl`):
 * opções do construtor, modo por largura (≥ 960px roda livre / < 960px gestos
 * cooperativos), limites de zoom e de arraste, registro dos botões +/−/⟲ na
 * `useMapZoomStore`, balão que fecha ao mover o mapa e canvas fora do Tab.
 *
 * MapLibre falso com espiões: `_spy-map.ts`. As suítes de enquadramento
 * (`NationalChoroplethMap.fitBounds*.test.tsx`) seguem intactas e provam que os
 * limites não mexem no retrato inicial.
 *
 * Mutações que este arquivo pega (feedback_teste_que_nao_discrimina):
 *   M1 — remover `desligarDoMapaVivo()` do cleanup do impl → "desregistra".
 *   M2 — trocar `Math.max(frameCamera.zoom, UFS_PMTILES_MIN_ZOOM + ...)` por
 *        `frameCamera.zoom` → "piso".
 *   M3 — inverter `if (desktop)` em `attachInteractionMode` → "modo por largura".
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";
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

import { NationalChoroplethMapImpl } from "@/components/blocks/_NationalChoroplethMapImpl";

const ROW_SP: EdgeUfRow = {
  sigla: "SP",
  pct_apurado: 40,
  lider: 13,
  margem_atual: 10,
  margem_projetada: 10,
  margem_projetada_ci: [8, 12],
  chamada: false,
  swing_vs_2022: null,
  top_candidatos: [
    { id: 13, pct: 55, nome: "FERNANDA DA SILVA", partido: "PT" },
    { id: 22, pct: 45, nome: "ROBERTO ALVES", partido: "PL" },
  ],
  vai_a_2t: null,
  bucket: "indefinido",
};

let host: HTMLElement;
let root: Root;
let mq: ReturnType<typeof instalaMatchMedia>;

function monta(desktop: boolean) {
  mq = instalaMatchMedia(desktop);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(<NationalChoroplethMapImpl candidatoAId={13} rows={[ROW_SP]} view="winner" />);
  });
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

describe("opções do construtor (ADR-0071)", () => {
  it("duplo clique, caixa de seleção, teclado, rotação, inclinação e cópias do mundo desligados; roda LIGADA", () => {
    const map = monta(true);
    expect(map.opts.doubleClickZoom).toBe(false);
    expect(map.opts.boxZoom).toBe(false);
    expect(map.opts.keyboard).toBe(false);
    expect(map.opts.renderWorldCopies).toBe(false);
    expect(map.opts.dragRotate).toBe(false);
    expect(map.opts.touchPitch).toBe(false);
    // Ctrl/⌘+roda do modo cooperativo só funciona com o scrollZoom LIGADO.
    expect(map.opts.scrollZoom).toBe(true);
    desmonta();
  });

  it("aviso cooperativo em pt-BR (celular e computador)", () => {
    const map = monta(true);
    const locale = map.opts.locale as Record<string, string>;
    expect(locale["CooperativeGesturesHandler.MobileHelpText"]).toBe(
      "Use dois dedos para mover o mapa",
    );
    expect(locale["CooperativeGesturesHandler.WindowsHelpText"]).toMatch(/Ctrl/);
    expect(locale["CooperativeGesturesHandler.MacHelpText"]).toMatch(/⌘/);
    desmonta();
  });

  it("rotação por dois dedos desligada", () => {
    const map = monta(true);
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalledTimes(1);
    desmonta();
  });
});

describe("canvas fora da ordem de Tab (ADR-0071)", () => {
  it("🔴 tabIndex -1 e aria-hidden no <canvas> [mutação: remover as 3 linhas do mount]", () => {
    const map = monta(true);
    expect(map.canvas.tabIndex).toBe(-1);
    expect(map.canvas.setAttribute).toHaveBeenCalledWith("aria-hidden", "true");
    expect(map.canvas.removeAttribute).toHaveBeenCalledWith("aria-label");
    desmonta();
  });
});

describe("modo por largura de tela (corte de 960px)", () => {
  it("🔴 ≥ 960px: cooperativo DESLIGADO e roda ligada [mutação M3: inverter o `if (desktop)`]", () => {
    const map = monta(true);
    expect(map.scrollZoom.enable).toHaveBeenCalled();
    expect(map.cooperativeGestures.disable).toHaveBeenCalled();
    expect(map.cooperativeGestures.enable).not.toHaveBeenCalled();
    desmonta();
  });

  it("🔴 < 960px: cooperativo LIGADO (um dedo rola a página) e roda continua ligada para Ctrl/⌘ [mutação M3]", () => {
    const map = monta(false);
    expect(map.cooperativeGestures.enable).toHaveBeenCalled();
    expect(map.cooperativeGestures.disable).not.toHaveBeenCalled();
    expect(map.scrollZoom.enable).toHaveBeenCalled();
    desmonta();
  });

  it("troca de modo ao cruzar o corte (girar o aparelho, redimensionar a janela)", () => {
    const map = monta(true);
    map.cooperativeGestures.enable.mockClear();
    map.cooperativeGestures.disable.mockClear();

    act(() => mq.setDesktop(false));
    expect(map.cooperativeGestures.enable).toHaveBeenCalledTimes(1);

    act(() => mq.setDesktop(true));
    expect(map.cooperativeGestures.disable).toHaveBeenCalledTimes(1);
    desmonta();
  });

  it("o listener da media query sai junto com o mapa", () => {
    monta(true);
    expect(mq.ouvintes.size).toBe(1);
    desmonta();
    expect(mq.ouvintes.size).toBe(0);
  });
});

describe("limites de zoom e de arraste", () => {
  it("🔴 aplicados DEPOIS do enquadramento inicial, que continua sendo um único jumpTo", () => {
    const map = monta(true);
    expect(map.jumpTo).toHaveBeenCalledTimes(1);
    expect(map.ordem).toEqual(["jumpTo", "setMaxZoom", "setMinZoom", "setMaxBounds"]);
    desmonta();
  });

  it("piso = o enquadramento; teto = enquadramento + 4 níveis", () => {
    config.cameraZoom = 3.4;
    const map = monta(true);
    expect(map.setMinZoom).toHaveBeenCalledWith(3.4);
    expect(map.setMaxZoom).toHaveBeenCalledWith(7.4);
    desmonta();
  });

  it("🔴 o piso NUNCA fica abaixo do nível em que o mapa some (z2 + folga) [mutação M2: usar só `frameCamera.zoom`]", () => {
    // `cameraForBounds` devolve 1,0 sempre: o laço de encolhimento esgota as 20
    // rodadas e o enquadramento sai abaixo do piso do dataset. O limite não
    // pode herdar isso.
    config.cameraZoom = 1;
    const map = monta(true);
    expect(map.setMinZoom).toHaveBeenCalledTimes(1);
    const piso = map.setMinZoom.mock.calls[0]?.[0] as number;
    expect(piso).toBeGreaterThanOrEqual(2.15);
    desmonta();
  });

  it("os limites de arraste cobrem a vista inicial inteira (senão o MapLibre ampliaria a câmera) e o Brasil", () => {
    // Vista inicial MAIS ALTA que o Brasil + folga — o caso da moldura com
    // legenda e cabeçalho reservando 35% da altura em cada lado.
    config.viewport = [
      [-90, -60],
      [-10, 30],
    ];
    const map = monta(true);
    const args = map.setMaxBounds.mock.calls[0] as unknown as [[number, number, number, number]];
    const [w, s, e, n] = args[0];
    expect(w).toBeLessThan(-90);
    expect(s).toBeLessThan(-60);
    expect(e).toBeGreaterThan(-10);
    expect(n).toBeGreaterThan(30);
    // e cobre o Brasil (BRAZIL_BOUNDS = [-73.99, -33.75, -28.84, 5.27])
    expect(w).toBeLessThanOrEqual(-73.99);
    expect(e).toBeGreaterThanOrEqual(-28.84);
    desmonta();
  });
});

describe("botões +/−/⟲ via useMapZoomStore", () => {
  it("🔴 registra no `load` com o rótulo do Brasil; antes do `load` não há controle", () => {
    const map = monta(true);
    expect(useMapZoomStore.getState().controls).toBeNull();
    carrega(map);
    expect(useMapZoomStore.getState().controls?.resetLabel).toBe("Ver o Brasil inteiro");
    desmonta();
  });

  it("🔴 desregistra no unmount [mutação M1: remover `desligarDoMapaVivo()` do cleanup]", () => {
    const map = monta(true);
    carrega(map);
    expect(useMapZoomStore.getState().controls).not.toBeNull();
    desmonta();
    expect(useMapZoomStore.getState().controls).toBeNull();
    expect(map.removido).toBe(true);
    // e o listener de `moveend` do mapa morto também saiu
    expect(map.quantosHandlers("moveend")).toBe(0);
  });

  it("🔴 não apaga o controle de OUTRO mapa registrado depois (corrida de montar/desmontar)", () => {
    const map = monta(true);
    carrega(map);
    const doOutroMapa: MapZoomControls = {
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      reset: vi.fn(),
      resetLabel: "Ver o estado inteiro",
    };
    useMapZoomStore.getState().register(doOutroMapa);
    desmonta();
    expect(useMapZoomStore.getState().controls).toBe(doOutroMapa);
  });

  it("+ e − chamam zoomIn/zoomOut do mapa, SEM `essential` (reduced-motion zera a duração)", () => {
    const map = monta(true);
    carrega(map);
    const c = useMapZoomStore.getState().controls as MapZoomControls;
    c.zoomIn();
    c.zoomOut();
    expect(map.zoomIn).toHaveBeenCalledWith({ duration: 250 });
    expect(map.zoomOut).toHaveBeenCalledWith({ duration: 250 });
    desmonta();
  });

  it("⟲ volta ao enquadramento do Brasil em 400 ms, sem `essential`", () => {
    config.cameraZoom = 3.2;
    const map = monta(true);
    carrega(map);
    (useMapZoomStore.getState().controls as MapZoomControls).reset();
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    const arg = map.easeTo.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg.zoom).toBe(3.2);
    expect(arg.duration).toBe(400);
    expect(arg).not.toHaveProperty("essential");
    desmonta();
  });

  it("⟲ só habilita quando a câmera sai do enquadramento (`moveend`)", () => {
    config.cameraZoom = 3.2;
    const map = monta(true);
    carrega(map);
    expect(useMapZoomStore.getState().canReset).toBe(false);

    map.zoom = 5; // o usuário ampliou
    act(() => map.emit("moveend"));
    expect(useMapZoomStore.getState().canReset).toBe(true);

    map.zoom = 3.2; // voltou
    act(() => map.emit("moveend"));
    expect(useMapZoomStore.getState().canReset).toBe(false);
    desmonta();
  });
});

describe("balão fecha quando o mapa se move por baixo dele", () => {
  function abreBalao(map: SpyMap) {
    act(() =>
      map.emit("mousemove:ufs-fill", {
        features: [{ properties: { SIGLA_UF: "SP" } }],
        originalEvent: { clientX: 10, clientY: 10 },
      }),
    );
  }

  it('🔴 `movestart` fecha o balão e limpa o hover do mapa [mutação: remover o `map.on("movestart")`]', () => {
    const map = monta(true);
    abreBalao(map);
    expect(host.querySelector('[data-testid="hover-card"]')).not.toBeNull();
    expect(useHoverStore.getState().hovered).toEqual({ type: "uf", sigla: "SP" });

    act(() => map.emit("movestart"));
    expect(host.querySelector('[data-testid="hover-card"]')).toBeNull();
    expect(useHoverStore.getState().hovered).toBeNull();
    desmonta();
  });

  it("`zoomstart` também fecha", () => {
    const map = monta(true);
    abreBalao(map);
    expect(host.querySelector('[data-testid="hover-card"]')).not.toBeNull();
    act(() => map.emit("zoomstart"));
    expect(host.querySelector('[data-testid="hover-card"]')).toBeNull();
    desmonta();
  });

  it("não apaga o destaque que veio da TABELA (a store aponta para outra origem)", () => {
    const map = monta(true);
    act(() => useHoverStore.getState().setHovered({ type: "uf", sigla: "RJ" }, "table"));
    act(() => map.emit("movestart"));
    expect(useHoverStore.getState().hovered).toEqual({ type: "uf", sigla: "RJ" });
    desmonta();
  });
});

describe("sanidade do harness", () => {
  it("um mapa por montagem", () => {
    monta(true);
    expect(instancias).toHaveLength(1);
    desmonta();
  });
});
