// @vitest-environment happy-dom
/**
 * tests/unit/components/ChoroplethMapUF.toqueNaoAbreBalao.test.tsx
 *
 * 2026-09-20 — pedido do dono: "na visão de município também não deve abrir
 * o balão, apenas a gaveta". Mesmo defeito e mesmo remédio do mapa NACIONAL
 * (`NationalChoroplethMap.toqueNaoAbreBalao.test.tsx`): Safari/Chrome em
 * toque disparam um `mousemove` sintético antes do `click`, e sem guarda ele
 * abria o `<HoverCard>` — que nunca fechava sozinho (`mouseleave` não
 * dispara num tap).
 *
 * `ChoroplethMapUF` não tem wrapper/impl separados (é um átomo só) — chama
 * `useHasFinePointer()` (`lib/utils/use-has-fine-pointer.ts`) direto, mesmo
 * padrão que já usa para `prefers-reduced-motion`.
 *
 * 🔴 **O clique JÁ era a gaveta, mesmo antes desta correção** — o handler de
 * `click` sempre escreveu em `useMunicipioSheetStore` sem checar ponteiro
 * nenhum (ver `ChoroplethMapUF.tsx`). O que faltava era só o balão do
 * `mousemove` não competir com ela. Por isso o caso abaixo confere as DUAS
 * coisas no MESMO tap: balão ausente, e o store da gaveta recebendo o
 * `cod_ibge` normalmente.
 *
 * Harness: mesmo MapLibre falso de `ChoroplethMapUF.hoverCard.test.tsx`.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMunicipioSheetStore } from "@/components/shared/municipio-sheet-store";

type Handler = (e: unknown) => void;

const espiao = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
}));

vi.mock("maplibre-gl", async () => {
  const { addZoomApi } = await import("./_fake-map-zoom");
  class FakeMap {
    setFeatureState() {}
    setFilter() {}
    setPaintProperty() {}
    getCanvas() {
      return {
        style: {} as Record<string, string>,
        setAttribute() {},
        removeAttribute() {},
        tabIndex: 0,
      };
    }
    isStyleLoaded() {
      return true;
    }
    loaded() {
      return true;
    }
    remove() {}
    on(event: string, a: unknown, b?: unknown) {
      if (typeof a === "function") {
        espiao.handlers.set(event, a as Handler);
      } else {
        espiao.handlers.set(`${event}:${String(a)}`, b as Handler);
      }
    }
  }
  addZoomApi(FakeMap.prototype);
  return { default: { Map: FakeMap } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("@/components/atoms/maps/_pmtiles-protocol", () => ({
  registerPmtilesProtocolOnce: () => {},
  resetPmtilesProtocol: () => {},
}));

import { ChoroplethMapUF } from "@/components/atoms/maps/ChoroplethMapUF";

const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
let temPonteiroFino = false;

function instalaMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: query === FINE_POINTER_QUERY ? temPonteiroFino : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function montar() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <ChoroplethMapUF
        ufSigla="SP"
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
  return { host, root };
}

function tocaMousemoveEmSp() {
  const onMouseMove = espiao.handlers.get("mousemove:municipios-fill");
  expect(onMouseMove, "handler de mousemove não foi registrado").toBeDefined();
  act(() => {
    onMouseMove?.({
      features: [{ properties: { CD_MUN: "3550308" } }],
      originalEvent: { clientX: 10, clientY: 10 },
    });
  });
}

function clicaEmSp() {
  const onClick = espiao.handlers.get("click:municipios-fill");
  expect(onClick, "handler de click não foi registrado").toBeDefined();
  act(() => {
    onClick?.({
      features: [{ properties: { CD_MUN: "3550308" } }],
    });
  });
}

function desmonta(host: HTMLElement, root: Root) {
  act(() => root.unmount());
  host.remove();
}

beforeEach(() => {
  espiao.handlers.clear();
  temPonteiroFino = false;
  instalaMatchMedia();
  useMunicipioSheetStore.getState().clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  useMunicipioSheetStore.getState().clear();
});

describe("toque no mapa de município não abre o balão — só a gaveta (pedido do dono, 2026-09-20)", () => {
  it("🔴 toque: `mousemove` sintético NÃO abre o balão, e o `click` seguinte seleciona o município na gaveta [mutação: remover `bloqueiaBalaoNoToqueRef` do mousemove]", () => {
    temPonteiroFino = false;
    const { host, root } = montar();

    tocaMousemoveEmSp();
    expect(
      host.querySelector('[data-testid="hover-card"]'),
      "o mousemove sintético do toque abriu o balão",
    ).toBeNull();

    clicaEmSp();
    expect(useMunicipioSheetStore.getState().codIbge, "o clique não selecionou o município").toBe(
      "3550308",
    );
    // O balão continua ausente — o clique nunca abriu balão nenhum, só a
    // gaveta (comportamento herdado, não mudou nesta correção).
    expect(host.querySelector('[data-testid="hover-card"]')).toBeNull();

    desmonta(host, root);
  });

  it("mouse continua abrindo o balão normalmente (regressão) [mutação: bloquear incondicionalmente, sem checar ponteiro]", () => {
    temPonteiroFino = true;
    const { host, root } = montar();

    tocaMousemoveEmSp();
    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card, "o hover de mouse parou de abrir o balão").not.toBeNull();
    expect(host.querySelector('[data-testid="hover-card-title"]')?.textContent).toBe("São Paulo");

    desmonta(host, root);
  });
});
