/**
 * tests/unit/components/_spy-map.ts
 *
 * MapLibre falso COM ESPIÕES para as suítes de interação de zoom (ADR-0071):
 * `mapas-zoom.nacional.test.tsx` e `mapas-zoom.estado.test.tsx`. Ao contrário
 * do `addZoomApi` (no-op, só para os demais testes não quebrarem), aqui cada
 * chamada fica gravada, os eventos são disparáveis (`emit`) e o `matchMedia` é
 * controlável (largura de tela).
 *
 * Uso — dentro da fábrica do `vi.mock`:
 *
 *   vi.mock("maplibre-gl", async () => {
 *     const { SpyMap } = await import("./_spy-map");
 *     return { default: { Map: SpyMap } };
 *   });
 */

import { vi } from "vitest";

type Handler = (e?: unknown) => void;

/** Botões de regulagem do fake — resetados por `resetaSpyMap()` a cada caso. */
export const config = {
  /** Zoom que `cameraForBounds` devolve (o enquadramento). */
  cameraZoom: 3,
  /** Retângulo visível devolvido por `getBounds().toArray()`: `[[o, s], [l, n]]`. */
  viewport: [
    [-80, -40],
    [-20, 10],
  ] as [[number, number], [number, number]],
};

export const instancias: SpyMap[] = [];

export function resetaSpyMap() {
  instancias.length = 0;
  config.cameraZoom = 3;
  config.viewport = [
    [-80, -40],
    [-20, 10],
  ];
}

export class SpyMap {
  opts: Record<string, unknown>;
  handlers = new Map<string, Handler[]>();
  /** Nomes dos métodos de câmera/limite chamados, em ordem — p/ afirmar "depois do enquadramento". */
  ordem: string[] = [];
  zoom = 3;
  minZoom = 0;
  maxZoom = 22;
  center = { lng: -51.415, lat: -14.24 };
  removido = false;
  canvas = {
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    tabIndex: 0,
  };

  scrollZoom = { enable: vi.fn(), disable: vi.fn() };
  cooperativeGestures = { enable: vi.fn(), disable: vi.fn() };
  touchZoomRotate = { disableRotation: vi.fn() };

  jumpTo = vi.fn((cam: { zoom: number; center: unknown }) => {
    this.ordem.push("jumpTo");
    this.zoom = cam.zoom;
  });
  setMinZoom = vi.fn((z: number) => {
    this.ordem.push("setMinZoom");
    this.minZoom = z;
  });
  setMaxZoom = vi.fn((z: number) => {
    this.ordem.push("setMaxZoom");
    this.maxZoom = z;
  });
  setMaxBounds = vi.fn(() => {
    this.ordem.push("setMaxBounds");
  });
  zoomIn = vi.fn();
  zoomOut = vi.fn();
  easeTo = vi.fn();
  fitBounds = vi.fn();
  setFilter = vi.fn();
  setPaintProperty = vi.fn();
  setFeatureState = vi.fn();

  constructor(opts: Record<string, unknown>) {
    this.opts = opts;
    this.zoom = 3;
    // `bounds` no construtor = o `fitBounds` inicial do mapa estadual.
    if (opts.bounds) this.zoom = config.cameraZoom;
    instancias.push(this);
  }

  cameraForBounds() {
    return { center: { lng: -51.415, lat: -14.24 }, zoom: config.cameraZoom };
  }
  getBounds() {
    return { toArray: () => config.viewport };
  }
  getZoom() {
    return this.zoom;
  }
  getMinZoom() {
    return this.minZoom;
  }
  getCenter() {
    return this.center;
  }
  getCanvas() {
    return this.canvas;
  }
  isStyleLoaded() {
    return true;
  }
  loaded() {
    return true;
  }
  remove() {
    this.removido = true;
  }

  on(event: string, a: unknown, b?: unknown) {
    const [key, fn] =
      typeof a === "function" ? [event, a as Handler] : [`${event}:${String(a)}`, b as Handler];
    this.handlers.set(key, [...(this.handlers.get(key) ?? []), fn]);
  }
  off(event: string, fn: Handler) {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((h) => h !== fn),
    );
  }
  /** Dispara os handlers de `chave` (`"load"`, `"moveend"`, `"mousemove:ufs-fill"`…). */
  emit(chave: string, e?: unknown) {
    for (const h of this.handlers.get(chave) ?? []) h(e);
  }
  quantosHandlers(chave: string): number {
    return (this.handlers.get(chave) ?? []).length;
  }
}

/** O mapa vivo mais recente. */
export function ultimoMapa(): SpyMap {
  const m = instancias[instancias.length - 1];
  if (!m) throw new Error("nenhum mapa foi construído");
  return m;
}

/**
 * `window.matchMedia` controlável. Responde `(min-width: 960px)` com a largura
 * simulada; `(hover: hover) and (pointer: fine)` com `ponteiroFino`; qualquer
 * outra query (movimento reduzido) com `false`. `ouvintes` conta os listeners de `change` ainda pendurados.
 */
export function instalaMatchMedia(inicialDesktop: boolean, ponteiroFino = false) {
  const ouvintes = new Set<(e: { matches: boolean }) => void>();
  let desktop = inicialDesktop;
  window.matchMedia = ((query: string) => {
    const eLargura = query === "(min-width: 960px)";
    return {
      media: query,
      get matches() {
        if (eLargura) return desktop;
        return query === "(hover: hover) and (pointer: fine)" ? ponteiroFino : false;
      },
      onchange: null,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        if (eLargura) ouvintes.add(fn);
      },
      removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        if (eLargura) ouvintes.delete(fn);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
  return {
    ouvintes,
    /** Simula atravessar o corte de 960px. */
    setDesktop(valor: boolean) {
      desktop = valor;
      for (const fn of [...ouvintes]) fn({ matches: valor });
    },
  };
}
