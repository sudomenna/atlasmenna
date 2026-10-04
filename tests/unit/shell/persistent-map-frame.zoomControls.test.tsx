// @vitest-environment happy-dom
/**
 * tests/unit/shell/persistent-map-frame.zoomControls.test.tsx
 *
 * ADR-0071 — onde os botões +/−/⟲ do mapa do ESTADO moram nos três cargos
 * (Governador, Senador, Presidente): uma cópia sobre o canto do mapa (só
 * desktop) e uma na faixa em fluxo abaixo do mapa (só celular, ADR-0056 — nada
 * por cima do mapa no celular), DENTRO de `.mobileChrome` e ANTES da `.bar`.
 * Harness: o mesmo de `persistent-map-frame.celularCromo.test.tsx`.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useParams: () => ({ sigla: "sp" }),
  usePathname: () => "/uf/sp",
}));

vi.mock("@/components/blocks/NationalMapBlock", () => ({
  CHIP_STYLE: {},
  NationalMapBlock: () => <div data-testid="mapa-nacional-falso" />,
}));

vi.mock("@/components/blocks/UfMapsLazy", () => ({
  UfLeaderMapLazy: () => <div data-testid="uf-leader-map-fake" />,
}));

import zoomStyles from "@/components/atoms/maps/MapZoomControls.module.css";
import mapFrameStyles from "@/components/blocks/MapFrameMobile.module.css";
import { PersistentMapFrame } from "@/components/layout/PersistentMapFrame";
import type { UfPickerCargo } from "@/components/layout/UfPicker";
import { useDadoFrescorStore } from "@/lib/state/dado-freshness-store";
import { useMapZoomStore } from "@/lib/state/map-zoom-store";

const PAYLOAD_NACIONAL = {
  ts: "2026-09-27T20:00:00.000Z",
  cargo: 1,
  turno: 1,
  national: { candidatos: [], candidato_a_id: null },
  por_uf: [],
};

const UF_RESUMO = {
  uf: "SP",
  ts: "2026-09-27T20:00:00.000Z",
  cargo: 1,
  turno: 1,
  pct_apurado: 40,
  candidatos: [],
  needle_position: 0,
  needle_band: "tossup",
};

function respostaPara(url: string) {
  if (url.startsWith("/api/projection/municipios")) return { status: "ok", municipios: [] };
  if (url.startsWith("/api/projection?uf=")) return UF_RESUMO;
  if (url.startsWith("/api/projection")) return PAYLOAD_NACIONAL;
  throw new Error(`URL inesperada no fetch falso: ${url}`);
}

describe("PersistentMapFrame — botões de zoom no nível UF (ADR-0071)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    useMapZoomStore.setState({ controls: null, canReset: false });
    useDadoFrescorStore.setState({ pollers: {}, relogios: {} });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({ ok: true, json: async () => respostaPara(url) })),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function montar(cargo: UfPickerCargo) {
    await act(async () => {
      root.render(<PersistentMapFrame cargo={cargo} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function registra() {
    act(() =>
      useMapZoomStore.getState().register({
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        reset: vi.fn(),
        resetLabel: "Ver o estado inteiro",
      }),
    );
  }

  it.each([
    ["gov" as const],
    ["sen" as const],
    ["pres" as const],
  ])("🔴 cargo=%s — sem mapa registrado não há botão nenhum", async (cargo) => {
    await montar(cargo);
    expect(container.querySelectorAll('button[aria-label="Ampliar o mapa"]')).toHaveLength(0);
  });

  it.each([
    ["gov" as const],
    ["sen" as const],
    ["pres" as const],
  ])("🔴 cargo=%s — com mapa registrado: uma cópia sobre o mapa (desktop) e uma na faixa abaixo dele (celular), antes da barra [mutação: tirar o <MapZoomControls> de um dos dois lugares]", async (cargo) => {
    await montar(cargo);
    registra();

    expect(container.querySelectorAll('button[aria-label="Ampliar o mapa"]')).toHaveLength(2);

    const desktop = container.querySelector(`.${zoomStyles.desktop}`);
    expect(desktop, "cópia desktop ausente").not.toBeNull();
    // Sobre o mapa: NÃO dentro do cromo em fluxo do celular.
    expect(desktop?.closest(`.${mapFrameStyles.mobileChrome}`)).toBeNull();

    const mobileChrome = container.querySelector(`.${mapFrameStyles.mobileChrome}`);
    const faixa = mobileChrome?.querySelector(`.${zoomStyles.bar}`);
    expect(faixa, "faixa do celular ausente em `.mobileChrome`").not.toBeNull();
    // A faixa vem ANTES da `.bar` ("← Brasil" + "Escolher UF"): logo abaixo do mapa.
    const barra = mobileChrome?.querySelector(`.${mapFrameStyles.bar}`);
    expect(faixa?.nextElementSibling).toBe(barra);
    // O ⟲ leva o rótulo registrado pelo mapa.
    expect(faixa?.querySelector('button[aria-label="Ver o estado inteiro"]')).not.toBeNull();
  });
});
