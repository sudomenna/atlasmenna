// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.toqueNaoAbreBalao.test.tsx
 *
 * 2026-09-20 — pedido do dono: "no mobile ao clicar no estado não deve abrir
 * o balão, mas apenas a gaveta com o botão de ver mais detalhes". O defeito:
 * Safari e Chrome em aparelhos de TOQUE disparam um `mousemove` SINTÉTICO
 * imediatamente antes do `click` — a premissa contrária ("em touch não há
 * mousemove antes do tap") estava cravada em dois comentários
 * (`_NationalChoroplethMapImpl.tsx`, `ChoroplethMapUF.tsx`) e era falsa nos
 * dois. Sem guarda, esse sintético abria o `<HoverCard>`, e como
 * `mouseleave` nunca dispara num tap, o balão ficava preso NA FRENTE da
 * `<StateResultSheet>` que o `click` seguinte abre.
 *
 * O remédio (`bloqueiaBalaoNoToque`, `_NationalChoroplethMapImpl.tsx`) é
 * ligado pelo WRAPPER (`NationalChoroplethMap.tsx`) via
 * `useHasFinePointer()` (`lib/utils/use-has-fine-pointer.ts`) — por isso
 * este arquivo monta o WRAPPER, não o impl direto: testar só o impl não
 * provaria a fiação entre os dois níveis, que é onde o defeito real vivia.
 *
 * ## O que cada caso mata
 *
 *   1. Toque não abre o balão — mata remover/pular a guarda
 *      `bloqueiaBalaoNoToqueRef` do `mousemove` no impl.
 *   2. Toque abre a gaveta (não navega) — já coberto por
 *      `NationalChoroplethMap.cliqueDesktopNavega.test.tsx`; repetido aqui
 *      NO MESMO teste do caso 1 para provar que "balão não abre" e "gaveta
 *      abre" são o MESMO tap, não dois setups diferentes.
 *   3. Mouse continua abrindo o balão — mata a guarda virando incondicional
 *      (bloquear todo mundo, não só toque).
 *
 * ## Harness
 *
 * Mesmo molde de `NationalChoroplethMap.cliqueDesktopNavega.test.tsx`:
 * MapLibre falso gravando handlers por evento/camada, `next/dynamic`
 * substituído por um carregador síncrono do impl real, `next/navigation`
 * mockado. `matchMedia` responde só à query de ponteiro
 * (`(hover: hover) and (pointer: fine)`) — as outras (largura,
 * `prefers-reduced-motion`) caem em `false`, irrelevantes aqui.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";

type Handler = (e: unknown) => void;

const espiao = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  push: vi.fn(),
}));

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: espiao.push,
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

/** Carrega o impl de verdade, sem o `React.lazy` do `next/dynamic`. */
vi.mock("next/dynamic", async () => {
  const mod = await import("@/components/blocks/_NationalChoroplethMapImpl");
  return { default: () => mod.NationalChoroplethMapImpl };
});

import { NationalChoroplethMap } from "@/components/blocks/NationalChoroplethMap";

const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

let temPonteiroFino = false;

function instalaMatchMedia() {
  window.matchMedia = ((query: string) => {
    const eFino = query === FINE_POINTER_QUERY;
    return {
      media: query,
      matches: eFino ? temPonteiroFino : false,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

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

function montar() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NationalChoroplethMap candidatoAId={13} rows={[ROW_SP]} view="winner" cargo="pres" />,
    );
  });
  return { host, root };
}

function tocaMousemoveEmSp() {
  const onMouseMove = espiao.handlers.get("mousemove:ufs-fill");
  expect(onMouseMove, "handler de mousemove não foi registrado").toBeDefined();
  act(() => {
    onMouseMove?.({
      features: [{ properties: { SIGLA_UF: "SP" } }],
      originalEvent: { clientX: 10, clientY: 10 },
    });
  });
}

function clicaEmSp() {
  const onClick = espiao.handlers.get("click:ufs-fill");
  expect(onClick, "handler de click não foi registrado").toBeDefined();
  act(() => {
    onClick?.({
      features: [{ properties: { SIGLA_UF: "SP" } }],
      originalEvent: { clientX: 10, clientY: 10 },
    });
  });
}

function desmonta(host: HTMLElement, root: Root) {
  act(() => root.unmount());
  host.remove();
}

beforeEach(() => {
  espiao.handlers.clear();
  espiao.push.mockClear();
  temPonteiroFino = false;
  instalaMatchMedia();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("toque não abre o balão — só a gaveta (pedido do dono, 2026-09-20)", () => {
  it("🔴 toque: `mousemove` sintético NÃO abre o balão, e o `click` seguinte abre a gaveta [mutação: remover `bloqueiaBalaoNoToqueRef` do mousemove no impl]", () => {
    temPonteiroFino = false;
    const { host, root } = montar();

    tocaMousemoveEmSp();
    expect(
      host.querySelector('[data-testid="hover-card"]'),
      "o mousemove sintético do toque abriu o balão",
    ).toBeNull();

    clicaEmSp();
    expect(espiao.push, "o toque navegou em vez de abrir a gaveta").not.toHaveBeenCalled();
    expect(
      host.querySelector('[data-testid="sheet"]'),
      "a gaveta não abriu no toque",
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="state-sheet-cta"]')).not.toBeNull();
    // O balão continua ausente mesmo depois do clique — a gaveta é o ÚNICO
    // caminho no toque, os dois não coexistem.
    expect(host.querySelector('[data-testid="hover-card"]')).toBeNull();

    desmonta(host, root);
  });

  it("mouse continua abrindo o balão normalmente (regressão) [mutação: bloquear incondicionalmente, sem checar ponteiro]", () => {
    temPonteiroFino = true;
    const { host, root } = montar();

    tocaMousemoveEmSp();
    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card, "o hover de mouse parou de abrir o balão").not.toBeNull();
    expect(host.querySelector('[data-testid="hover-card-title"]')?.textContent).toContain(
      "São Paulo",
    );

    desmonta(host, root);
  });
});
