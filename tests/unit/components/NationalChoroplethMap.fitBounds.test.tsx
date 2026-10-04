// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.fitBounds.test.tsx
 *
 * Enquadramento inicial do mapa hero (2026-09-14, pedido do dono: "deixe ele
 * com mais folga para caber inteiro no hero").
 *
 * O que estes testes travam — a causa raiz descoberta nesta sessão, não só o
 * sintoma:
 *
 *   `ufs.pmtiles` tem `minZoom: 2` (medido direto do header do arquivo via
 *   `new PMTiles(url).getHeader()`). Abaixo desse zoom o MapLibre não pede
 *   NENHUM tile — zero rede, zero `error`, zero log — e o canvas fica em
 *   branco pra sempre, do tamanho certo, sem nenhum sinal de que algo deu
 *   errado. Um padding vertical grande o bastante (a moldura cheia: cabeçalho
 *   de 3 linhas + legenda de 3 candidatos, ~250px, sobre um container de
 *   ~467px de altura) empurra o `fitBounds` pra ESSE precipício — não pra um
 *   bbox inválido (que o teto proporcional em `initialFramePadding` já
 *   evita), mas pra um zoom válido e abaixo do piso do dataset.
 *
 *   `computeFrameCamera` (`_NationalChoroplethMapImpl.tsx`) resolve isso
 *   consultando `map.cameraForBounds` (puro, síncrono, não desenha nada) e
 *   encolhendo o padding em rodadas até o zoom ficar seguro — melhor Brasil
 *   parcialmente atrás do cabeçalho do que Brasil nenhum.
 *
 * Estratégia: mesmo padrão de `NationalChoroplethMap.preEleicao.test.tsx` —
 * MapLibre falso, e aqui o espião grava CADA chamada de `cameraForBounds`
 * (com o padding usado) e a câmera final passada a `jumpTo`. Isto testa o
 * EFEITO observável (o que o componente pede e o que ele aplica), não o
 * código interno — o arquivo continua sem exportar `computeFrameCamera` de
 * propósito (mesmo padrão de `resolveColor`/`applyColors`, não exportados,
 * testados via o componente público).
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";

// ---------------------------------------------------------------------------
// MapLibre falso — grava cameraForBounds() e jumpTo()
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
  /** Fila de zoom que `cameraForBounds` devolve, uma por chamada — o último
   * valor da fila se repete se o teste consumir mais chamadas do que
   * forneceu (evita `undefined` explodir o teste por engano). */
  zoomQueue: [] as number[],
}));

vi.mock("maplibre-gl", async () => {
  const { addZoomApi } = await import("./_fake-map-zoom");
  class FakeMap {
    cameraForBounds(_bounds: unknown, opts: { padding: FakePadding }) {
      espiao.cameraForBoundsCalls.push({ ...opts.padding });
      const zoom =
        espiao.zoomQueue.length > 1 ? espiao.zoomQueue.shift()! : (espiao.zoomQueue[0] ?? 3);
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

function montar() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<NationalChoroplethMapImpl candidatoAId={null} rows={ROWS} view="winner" />);
  });
  return { host, root };
}

beforeEach(() => {
  espiao.cameraForBoundsCalls = [];
  espiao.jumpToCalls = [];
  espiao.zoomQueue = [];
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("enquadramento inicial — piso de zoom do dataset (ufs.pmtiles minZoom=2)", () => {
  it("zoom já seguro na 1ª tentativa → nenhuma rodada de encolhimento", () => {
    espiao.zoomQueue = [3];
    const { host, root } = montar();

    expect(espiao.cameraForBoundsCalls).toHaveLength(1);
    expect(espiao.jumpToCalls).toHaveLength(1);
    expect(espiao.jumpToCalls[0]?.zoom).toBe(3);

    act(() => root.unmount());
    host.remove();
  });

  it("zoom abaixo do piso → encolhe o padding e tenta de novo, até ficar seguro", () => {
    // 1ª tentativa: zoom 1,5 (abaixo de 2 + margem). 2ª: ainda 1,8 (abaixo).
    // 3ª: 2,3 (seguro) — o laço para aqui, não continua até o teto de rodadas.
    espiao.zoomQueue = [1.5, 1.8, 2.3];
    const { host, root } = montar();

    expect(espiao.cameraForBoundsCalls).toHaveLength(3);
    // Cada rodada usa um padding vertical MENOR que a anterior — é o
    // encolhimento, não uma repetição do mesmo valor.
    const [p1, p2, p3] = espiao.cameraForBoundsCalls;
    expect(p2!.top).toBeLessThan(p1!.top);
    expect(p2!.bottom).toBeLessThan(p1!.bottom);
    expect(p3!.top).toBeLessThan(p2!.top);
    expect(p3!.bottom).toBeLessThan(p2!.bottom);

    // A câmera aplicada é a última (segura), não a primeira (que cobriria
    // Brasil atrás do cabeçalho sem necessidade).
    expect(espiao.jumpToCalls).toHaveLength(1);
    expect(espiao.jumpToCalls[0]?.zoom).toBe(2.3);

    act(() => root.unmount());
    host.remove();
  });

  it("zoom NUNCA fica seguro → para depois de um teto de rodadas e ainda assim aplica alguma câmera", () => {
    // Fila de 1 elemento: `cameraForBounds` sempre devolve 1,0 (nunca cruza
    // o piso). Trava que o laço TERMINA (não é infinito) e que o componente
    // não desiste de desenhar o mapa — aplicar uma câmera abaixo do ideal é
    // estritamente melhor que não aplicar nenhuma (mesma filosofia de
    // degradação do resto do produto: nunca uma UF sem cor, aqui nunca um
    // mapa sem câmera).
    espiao.zoomQueue = [1.0];
    const { host, root } = montar();

    // 1 tentativa inicial + no máximo um teto pequeno de rodadas — o número
    // exato pina `MAX_SHRINK_ROUNDS` (hoje 20) em `_NationalChoroplethMapImpl.tsx`;
    // o que importa aqui é que É FINITO e que o `jumpTo` acontece mesmo assim.
    expect(espiao.cameraForBoundsCalls.length).toBeGreaterThan(1);
    expect(espiao.cameraForBoundsCalls.length).toBeLessThanOrEqual(21);
    expect(espiao.jumpToCalls).toHaveLength(1);
    expect(espiao.jumpToCalls[0]?.zoom).toBe(1.0);

    act(() => root.unmount());
    host.remove();
  });

  it("o padding inicial nunca excede o teto proporcional ao container (armadilha do dono)", () => {
    // `getBoundingClientRect()` no happy-dom devolve 0×0 (sem layout real) —
    // o componente cai no piso defensivo de 400×400 (`initialFramePadding`).
    // Mesmo assim, top+bottom não deve passar de 70% de 400 (280), nem
    // left+right de 30% de 400 (120) — a garantia que evita bbox inválido
    // independente do container.
    espiao.zoomQueue = [3];
    const { host, root } = montar();

    const primeira = espiao.cameraForBoundsCalls[0]!;
    expect(primeira.top + primeira.bottom).toBeLessThanOrEqual(400 * 0.7);
    expect(primeira.left + primeira.right).toBeLessThanOrEqual(400 * 0.3);

    act(() => root.unmount());
    host.remove();
  });
});
