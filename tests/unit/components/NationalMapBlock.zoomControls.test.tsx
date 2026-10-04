// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalMapBlock.zoomControls.test.tsx
 *
 * ADR-0071 — onde os botões +/−/⟲ do mapa do BRASIL moram em
 * `<NationalMapBlock variant="frame">`: uma cópia sobre o canto do mapa (só
 * desktop, dentro da `<section>` do canvas) e uma na faixa em fluxo abaixo do
 * mapa (só celular), em `.mobileChrome` e antes da `.bar` (ADR-0056: nada por
 * cima do mapa no celular). Harness: o mesmo de
 * `NationalMapBlock.celularCromo.test.tsx`.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/blocks/NationalChoroplethMap", async (importActual) => {
  const actual = await importActual<typeof import("@/components/blocks/NationalChoroplethMap")>();
  return {
    ...actual,
    NationalChoroplethMap: () => <div data-testid="mapa-real-falso" />,
  };
});

import zoomStyles from "@/components/atoms/maps/MapZoomControls.module.css";
import mapFrameStyles from "@/components/blocks/MapFrameMobile.module.css";
import { NationalMapBlock } from "@/components/blocks/NationalMapBlock";
import { useMapZoomStore } from "@/lib/state/map-zoom-store";
import { porUfApurado } from "@/tests/fixtures/spec-019/payloads";

describe("NationalMapBlock (variant=frame) — botões de zoom (ADR-0071)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    useMapZoomStore.setState({ controls: null, canReset: false });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <NationalMapBlock
          action={<a href="/uf/SP">Escolher estado</a>}
          candidatoAId={13}
          candidatos={[]}
          cargo="pres"
          rankByLider={{ 13: 1 }}
          rows={porUfApurado()}
          scopeLabel="Presidente · Brasil"
          variant="frame"
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("🔴 sem mapa registrado não há botão nenhum", () => {
    expect(container.querySelectorAll('button[aria-label="Ampliar o mapa"]')).toHaveLength(0);
  });

  it("🔴 com mapa registrado: uma cópia no canto do mapa (desktop) e uma na faixa abaixo dele (celular), antes da barra [mutação: tirar o <MapZoomControls> de um dos dois lugares]", () => {
    act(() =>
      useMapZoomStore.getState().register({
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        reset: vi.fn(),
        resetLabel: "Ver o Brasil inteiro",
      }),
    );

    expect(container.querySelectorAll('button[aria-label="Ampliar o mapa"]')).toHaveLength(2);

    // Desktop: dentro da <section> do canvas, não do cromo do celular.
    const section = container.querySelector('section[aria-label="Mapa coroplético do Brasil"]');
    expect(section?.querySelector(`.${zoomStyles.desktop}`)).not.toBeNull();

    // Celular: em `.mobileChrome`, imediatamente antes da `.bar`.
    const mobileChrome = container.querySelector(`.${mapFrameStyles.mobileChrome}`);
    const faixa = mobileChrome?.querySelector(`.${zoomStyles.bar}`);
    expect(faixa).not.toBeNull();
    expect(faixa?.nextElementSibling).toBe(mobileChrome?.querySelector(`.${mapFrameStyles.bar}`));
    expect(faixa?.querySelector('button[aria-label="Ver o Brasil inteiro"]')).not.toBeNull();
    // E a cópia do celular NÃO está dentro do canvas.
    expect(section?.querySelector(`.${zoomStyles.bar}`)).toBeNull();
  });
});
