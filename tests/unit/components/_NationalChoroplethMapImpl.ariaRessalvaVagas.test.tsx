// @vitest-environment happy-dom
/**
 * tests/unit/components/_NationalChoroplethMapImpl.ariaRessalvaVagas.test.tsx
 *
 * Irmão de `NationalChoroplethMap.ariaRessalvaVagas.test.tsx`, para a camada
 * `role="img"` (`_NationalChoroplethMapImpl.tsx`) — ver o docstring daquele
 * arquivo para o achado completo do `a11y-perf-auditor`.
 *
 * Mesmo mock mínimo de MapLibre de
 * `NationalChoroplethMap.describedByPorCargo.test.tsx`: este atributo não
 * depende do evento `load`, só do render.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";

vi.mock("maplibre-gl", async () => {
  const { addZoomApi } = await import("./_fake-map-zoom");
  class FakeMap {
    cameraForBounds() {
      return { center: [-51.415, -14.24] as [number, number], zoom: 3 };
    }
    jumpTo() {}
    setPaintProperty() {}
    setFilter() {}
    getCanvas() {
      return { style: {}, setAttribute() {}, removeAttribute() {}, tabIndex: 0 };
    }
    isStyleLoaded() {
      return true;
    }
    loaded() {
      return true;
    }
    remove() {}
    on() {}
  }
  addZoomApi(FakeMap.prototype);
  return { default: { Map: FakeMap } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("@/components/atoms/maps/_pmtiles-protocol", () => ({
  registerPmtilesProtocolOnce: () => {},
  resetPmtilesProtocol: () => {},
}));
// 🔴 2026-09-19 — `_NationalChoroplethMapImpl` passou a chamar `useRouter()`:
// no desktop o clique numa UF navega para a página do estado (decisão do dono;
// ver a docstring do topo daquele arquivo). Sem App Router montado o hook
// lança "invariant expected app router to be mounted" e o componente nem
// renderiza. Este mock é HARNESS, não asserção — nenhum caso deste arquivo
// observa navegação. Quem afere o clique-navega é
// `NationalChoroplethMap.cliqueDesktopNavega.test.tsx`.
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

const ROWS: EdgeUfRow[] = [];

function montar(cargo?: "pres" | "gov" | "sen", preEleicao = false) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NationalChoroplethMapImpl
        candidatoAId={null}
        rows={ROWS}
        view="winner"
        cargo={cargo}
        preEleicao={preEleicao}
      />,
    );
  });
  return { host, root };
}

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe('role="img" — ressalva de "2 vagas" no nome acessível (RF-106/RNF-025/WCAG 4.1.2)', () => {
  it('cargo="sen" — o aria-label contém a ressalva das 2 vagas', () => {
    // Mutação: remover `+ ariaRessalvaVagas(cargo)` (ou trocar `sen` por ""
    // no `Record`) faz este teste falhar.
    const { host, root } = montar("sen");
    expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toMatch(/vaga/i);
    act(() => root.unmount());
    host.remove();
  });

  it('cargo="sen" em fase pré-eleição — a ressalva CONTINUA presente', () => {
    const { host, root } = montar("sen", true);
    expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toMatch(/vaga/i);
    act(() => root.unmount());
    host.remove();
  });

  it('cargo="pres" — texto byte a byte igual ao de antes desta mudança (sem ressalva)', () => {
    const { host, root } = montar("pres");
    expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Mapa interativo do Brasil — UFs coloridas por projeção",
    );
    act(() => root.unmount());
    host.remove();
  });

  it('cargo="gov" e cargo omitido — sem ressalva (não regride)', () => {
    for (const cargo of ["gov", undefined] as const) {
      const { host, root } = montar(cargo);
      expect(host.querySelector('[role="img"]')?.getAttribute("aria-label")).not.toMatch(/vaga/i);
      act(() => root.unmount());
      host.remove();
    }
  });
});
