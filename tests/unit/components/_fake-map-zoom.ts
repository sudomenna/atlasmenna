/**
 * tests/unit/components/_fake-map-zoom.ts
 *
 * Superfície de API que os FakeMap da suíte precisam ter desde o ADR-0071
 * (interação de zoom): handlers de roda/gesto, limites, câmera e `off`. Todos
 * no-op — as suítes que AFEREM o comportamento novo
 * (`mapas-zoom-*.test.tsx`) usam um fake próprio com espiões.
 *
 * Só preenche o que o FakeMap NÃO tem (`cameraForBounds`, por exemplo, já
 * existe nos fakes nacionais e grava o que as suítes de enquadramento medem —
 * sobrescrevê-lo quebraria esses testes). Uso, dentro da fábrica do `vi.mock`:
 *
 *   vi.mock("maplibre-gl", async () => {
 *     const { addZoomApi } = await import("./_fake-map-zoom");
 *     class FakeMap { ... }
 *     addZoomApi(FakeMap.prototype);
 *     return { default: { Map: FakeMap } };
 *   });
 */

const noop = () => {};

const ZOOM_API: Record<string, unknown> = {
  getBounds: () => ({
    toArray: () => [
      [-80, -40],
      [-20, 10],
    ],
  }),
  getZoom: () => 3,
  getMinZoom: () => 0,
  getCenter: () => ({ lng: -51.415, lat: -14.24 }),
  cameraForBounds: () => ({ center: [-51.415, -14.24], zoom: 3 }),
  setMinZoom: noop,
  setMaxZoom: noop,
  setMaxBounds: noop,
  zoomIn: noop,
  zoomOut: noop,
  easeTo: noop,
  fitBounds: noop,
  off: noop,
  scrollZoom: { enable: noop, disable: noop },
  cooperativeGestures: { enable: noop, disable: noop },
  touchZoomRotate: { disableRotation: noop },
};

export function addZoomApi(proto: object): void {
  for (const [nome, valor] of Object.entries(ZOOM_API)) {
    if (!(nome in proto)) {
      Object.defineProperty(proto, nome, { value: valor, writable: true, configurable: true });
    }
  }
}
