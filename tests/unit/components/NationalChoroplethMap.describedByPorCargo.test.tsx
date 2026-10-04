// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.describedByPorCargo.test.tsx
 *
 * 2026-09-18 — `_NationalChoroplethMapImpl.tsx` cravava
 * `aria-describedby="state-grouped-table-heading"` incondicionalmente. Esse
 * id só existe no `<h2>` de `<StateGroupedTable>`, montada SÓ em
 * `app/(pres)/page.tsx`. Na trilha Governador (`/governador`) não há
 * `<StateGroupedTable>` — um leitor de tela anunciaria "descrito por:
 * [nada]" para um id que não existe no documento, o que é RNF-022 quebrado em
 * silêncio (pior que não descrever nada).
 *
 * A correção é condicionar o atributo ao `cargo`: só `"pres"` tem o alvo de
 * verdade hoje. `"gov"` omite o atributo inteiro em vez de inventar um id.
 *
 * 🔴 2026-09-18 (2ª rodada) — `"sen"` GANHA alvo: `app/(sen)/senador/page.tsx`
 * monta `<Panel titleId="corridas-heading">` com a lista textual das 27
 * corridas, o mesmo papel de `<StateGroupedTable>` em Presidente. Diferente
 * de `"gov"`, que continua sem equivalente.
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

function montar(cargo?: "pres" | "gov" | "sen") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NationalChoroplethMapImpl candidatoAId={null} rows={ROWS} view="winner" cargo={cargo} />,
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

describe("aria-describedby aponta só para um id que de fato existe (RNF-022)", () => {
  it('cargo="pres" (e o default, quando omitido) aponta para a tabela que existe nessa trilha', () => {
    const { host, root } = montar("pres");
    const alvo = host.querySelector('[role="img"]')?.getAttribute("aria-describedby");
    expect(alvo).toBe("state-grouped-table-heading");
    act(() => root.unmount());
    host.remove();

    const { host: host2, root: root2 } = montar(undefined);
    expect(host2.querySelector('[role="img"]')?.getAttribute("aria-describedby")).toBe(
      "state-grouped-table-heading",
    );
    act(() => root2.unmount());
    host2.remove();
  });

  it('cargo="gov" NÃO tem `<StateGroupedTable>` na trilha — o atributo é OMITIDO, não aponta pra id inexistente', () => {
    const { host, root } = montar("gov");
    const el = host.querySelector('[role="img"]');
    expect(el?.hasAttribute("aria-describedby")).toBe(false);
    act(() => root.unmount());
    host.remove();
  });

  it('cargo="sen" (2026-09-18) aponta para "corridas-heading" — a lista textual de `/senador`', () => {
    // Mutação: remover o ramo `cargo === "sen"` (deixando só pres/undefined)
    // faz este teste falhar, voltando o atributo a `undefined` mesmo havendo
    // alvo de verdade no documento.
    const { host, root } = montar("sen");
    const el = host.querySelector('[role="img"]');
    expect(el?.getAttribute("aria-describedby")).toBe("corridas-heading");
    act(() => root.unmount());
    host.remove();
  });
});
