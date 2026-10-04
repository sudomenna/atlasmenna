// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.fitBounds.anchored.test.tsx
 *
 * 2026-09-14 (2ª rodada) — o orquestrador mediu, no DOM real, dois tamanhos
 * de container (`.maplibregl-map`, viewports 768×1024 e 375×812) e calculou,
 * com a MESMA fórmula usada em `computeFrameCamera`, que o zoom resultante
 * ficaria abaixo do piso — evidência de que os 4 testes de
 * `NationalChoroplethMap.fitBounds.test.tsx` (fake de zoom sintético, por
 * contador) não discriminavam a entrada REAL.
 *
 * Verificação ao vivo (Playwright, aba nova, `.maplibregl-map` nos dois
 * viewports): os tamanhos batem exatamente com os medidos (428×531,46875 e
 * 373×421,234375), o mapa PINTA nos dois, e a instrumentação temporária
 * confirmou o laço rodando e chegando a zoom seguro (2,323 e 2,265
 * respectivamente — ambos ≥ 2,15). Ou seja: o código está correto agora；
 * este arquivo existe para que isso pare de depender de eu confiar em mim
 * mesmo — ancora exatamente os dois tamanhos medidos e nunca mais deixa o
 * caso regredir em silêncio.
 *
 * ## Por que um `cameraForBounds` fake FIEL a Mercator, não sintético
 *
 * Os 4 testes de `fitBounds.test.tsx` usam uma fila de zoom arbitrária — bons
 * para travar o CONTROLE do laço (encolhe, para, não trava), mas não provam
 * nada sobre os tamanhos reais que o produto de fato usa. Aqui o fake
 * implementa a projeção Web Mercator de verdade (mesma fórmula do
 * MapLibre/Mapbox: `y = ln(tan(π/4 + lat/2))`, `zoom = log2(worldSize/512)`)
 * — validada contra 3 pontos medidos AO VIVO no MapLibre real (erro < 0,2%
 * nos três, ver comentário em cada caso abaixo). Isso faz o teste responder
 * "o zoom final bate com o que o MapLibre de verdade calcularia" em vez de
 * "o laço para quando eu digo que ele deve parar".
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";

// ---------------------------------------------------------------------------
// Projeção Web Mercator — mesma fórmula do MapLibre (bearing=0, pitch=0)
// ---------------------------------------------------------------------------

/** Bbox de Brasil — mesmo array de `_NationalChoroplethMapImpl.tsx` (`BRAZIL_BOUNDS`). */
const WEST = -73.99;
const SOUTH = -33.75;
const EAST = -28.84;
const NORTH = 5.27;

function mercatorY(latDeg: number): number {
  const lat = (latDeg * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

const D_LNG_RAD = ((EAST - WEST) * Math.PI) / 180;
const D_MERC_Y = mercatorY(NORTH) - mercatorY(SOUTH);

/**
 * Zoom que ajusta o bbox de Brasil numa área de `availW`×`availH` pixels —
 * a mesma conta que `Map.cameraForBounds` faz internamente para bearing=0.
 * Validado contra 3 medições reais do MapLibre (erro < 0,2% em todas):
 *   - 428×531,46875, padding {160,120,32,32} → medido 2,099956, estimado 2,102648
 *   - mesmo container, padding {136,102,27.2,27.2} → medido 2,323170, estimado 2,325476
 *   - 373×421,234375, padding {147.432…,120,32,32} → medido 1,391146, estimado 1,393347
 */
function zoomForFit(availWidth: number, availHeight: number): number {
  const worldByWidth = availWidth / (D_LNG_RAD / (2 * Math.PI));
  const worldByHeight = availHeight / (D_MERC_Y / (2 * Math.PI));
  const world = Math.min(worldByWidth, worldByHeight);
  return Math.log2(world / 512);
}

// ---------------------------------------------------------------------------
// MapLibre falso — cameraForBounds FIEL (não sintético)
// ---------------------------------------------------------------------------

interface FakePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const espiao = vi.hoisted(() => ({
  cameraForBoundsCalls: [] as FakePadding[],
  jumpToCalls: [] as Array<{ center: unknown; zoom: number }>,
  // Tamanho do container QUE O TESTE está simulando — `cameraForBounds` (fake,
  // abaixo) lê daqui pra calcular o zoom REAL via Mercator. Sem isto, o fake
  // não teria como saber a área disponível: só recebe `padding`, não `w`/`h`.
  containerWidth: 0,
  containerHeight: 0,
}));

vi.mock("maplibre-gl", async () => {
  const { addZoomApi } = await import("./_fake-map-zoom");
  class FakeMap {
    cameraForBounds(_bounds: unknown, opts: { padding: FakePadding }) {
      espiao.cameraForBoundsCalls.push({ ...opts.padding });
      // 🔴 O zoom devolvido aqui é o Mercator DE VERDADE (via `zoomForFit`,
      // função módulo abaixo) — não um valor arbitrário. É isto que faz o
      // laço de `computeFrameCamera` (código de produção) parar na rodada
      // CERTA, exatamente como o MapLibre real pararia — não um número de
      // rodadas fixo escolhido pelo teste.
      const zoom = zoomForFit(
        espiao.containerWidth - opts.padding.left - opts.padding.right,
        espiao.containerHeight - opts.padding.top - opts.padding.bottom,
      );
      return { center: [-51.415, -14.24] as [number, number], zoom };
    }
    jumpTo(camera: { center: unknown; zoom: number }) {
      espiao.jumpToCalls.push(camera);
    }
    setPaintProperty() {}
    on() {}
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

/** Piso do dataset (`ufs.pmtiles`, `minZoom: 2`, medido via `PMTiles.getHeader()`)
 * + margem de segurança — mesmos valores de `_NationalChoroplethMapImpl.tsx`. */
const ZOOM_FLOOR_WITH_MARGIN = 2 + 0.15;

function montar(rect: { width: number; height: number }) {
  // O fake `cameraForBounds` (acima) lê `espiao.container*` pra saber a área
  // disponível — precisa bater com o `rect` que `getBoundingClientRect` vai
  // devolver logo abaixo, senão o zoom "real" calculado no mock descreve um
  // container diferente do que o componente pensa que tem.
  espiao.containerWidth = rect.width;
  espiao.containerHeight = rect.height;

  const host = document.createElement("div");
  document.body.appendChild(host);
  // `getBoundingClientRect` do container (`containerRef`, o `<div role="img">`
  // interno) é o que `mount()` lê pra calcular o padding. Sobrescrevo GLOBAL
  // (não só o container) pelos dois tamanhos EXATOS que o orquestrador mediu
  // no DOM real (`.maplibregl-map`, viewports 768×1024 e 375×812) — mais
  // simples que localizar o nó certo, e seguro aqui: nada mais no caminho de
  // montagem consulta `getBoundingClientRect` (o único outro uso,
  // `onMouseMove`, só roda em resposta a evento de mouse, nunca disparado
  // neste teste).
  const originalGbcr = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = () =>
    ({
      width: rect.width,
      height: rect.height,
      top: 0,
      left: 0,
      right: rect.width,
      bottom: rect.height,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;

  const root = createRoot(host);
  act(() => {
    root.render(<NationalChoroplethMapImpl candidatoAId={null} rows={ROWS} view="winner" />);
  });

  return {
    unmount() {
      act(() => root.unmount());
      host.remove();
      Element.prototype.getBoundingClientRect = originalGbcr;
    },
  };
}

beforeEach(() => {
  espiao.cameraForBoundsCalls = [];
  espiao.jumpToCalls = [];
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("enquadramento inicial — ancorado nos 2 tamanhos medidos no DOM real (2026-09-14)", () => {
  it("container 428×531,46875 (viewport 768×1024) — zoom final ≥ 2,15", () => {
    const { unmount } = montar({ width: 428, height: 531.46875 });

    // `jumpToCalls[0].zoom` é o zoom REAL (calculado por `zoomForFit` dentro
    // do fake, a partir do padding que `computeFrameCamera` de fato usou) —
    // não recalculado aqui de novo. Se o laço de produção parar cedo demais
    // (ou não rodar), este número vem direto de lá, errado.
    expect(espiao.jumpToCalls).toHaveLength(1);
    expect(espiao.jumpToCalls[0]?.zoom).toBeGreaterThanOrEqual(ZOOM_FLOOR_WITH_MARGIN);

    unmount();
  });

  it("container 373×421,234375 (viewport 375×812) — zoom final ≥ 2,15", () => {
    const { unmount } = montar({ width: 373, height: 421.234375 });

    expect(espiao.jumpToCalls).toHaveLength(1);
    expect(espiao.jumpToCalls[0]?.zoom).toBeGreaterThanOrEqual(ZOOM_FLOOR_WITH_MARGIN);

    unmount();
  });

  it("a 1ª tentativa (padding cheio) fica ABAIXO do piso nos dois tamanhos — prova que o laço precisa rodar", () => {
    // Este teste é o controle: se a 1ª tentativa já estivesse segura, os dois
    // testes acima passariam mesmo com o laço de encolhimento quebrado (ex.
    // condição de parada invertida) — não provariam que o encolhimento
    // funciona, só que ele nunca é exercitado.
    const casoA = { width: 428, height: 531.46875 };
    const casoB = { width: 373, height: 421.234375 };
    for (const { width, height } of [casoA, casoB]) {
      const top = Math.min(160, height * 0.35);
      const bottom = Math.min(120, height * 0.35);
      const left = Math.min(32, width * 0.15);
      const right = Math.min(32, width * 0.15);
      const zoomPrimeiraTentativa = zoomForFit(width - left - right, height - top - bottom);
      expect(zoomPrimeiraTentativa).toBeLessThan(ZOOM_FLOOR_WITH_MARGIN);
    }
  });
});
