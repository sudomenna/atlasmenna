/**
 * components/atoms/maps/_map-interaction.ts
 *
 * Interação de zoom dos dois mapas vetoriais no ar (Brasil por estado,
 * `_NationalChoroplethMapImpl.tsx`; estado por município, `ChoroplethMapUF.tsx`).
 * ADR-0071. Pedaço do chunk lazy do MapLibre (ADR-0010): só importa TIPOS de
 * `maplibre-gl` e a store pequena de `lib/state/map-zoom-store.ts` — nenhuma
 * dependência nova (RNF-007b).
 *
 * ## A regra (ADR-0071)
 *
 *   - **Computador (≥ 960 px, o mesmo corte de `AppShellSplit.module.css`)**:
 *     roda do mouse e pinça do trackpad ampliam/reduzem, centradas no cursor —
 *     a coluna do mapa não rola, então não há rolagem de página a roubar.
 *   - **Celular / tela estreita (< 960 px)**: gestos cooperativos do MapLibre.
 *     Um dedo ROLA A PÁGINA (o CSS do MapLibre devolve `touch-action: pan-x
 *     pan-y` ao canvas); dois dedos movem e ampliam; roda do mouse só com
 *     Ctrl/⌘. O aviso "use dois dedos" é o do próprio MapLibre, em pt-BR.
 *   - **Duplo clique / toque duplo: desligado.** O 1º clique já navega (ponteiro
 *     fino) ou abre a ficha (toque); um zoom de duplo clique disparava os dois.
 *   - **Não gira, não inclina, sem seleção por caixa, sem teclado no canvas**
 *     (o teclado usa os botões `<MapZoomControls>`, que são focáveis).
 *   - **Limites**: não afasta além do enquadramento inicial, não aproxima além
 *     do detalhe dos dados e não arrasta para longe do país/estado.
 *
 * ## Por que o `scrollZoom` fica LIGADO nos dois modos
 *
 * No modo cooperativo o MapLibre só deixa passar a roda com Ctrl/⌘ se o
 * `scrollZoom` estiver habilitado (`ScrollZoomHandler.wheel` retorna cedo com
 * `!this.isEnabled()` ANTES de olhar o cooperativo). Desligá-lo abaixo de 960px
 * mataria o Ctrl+roda que o aviso promete. Quem decide se a roda passa é o
 * `cooperativeGestures`; o `scrollZoom` só precisa existir.
 */

import type maplibregl from "maplibre-gl";

import { type MapZoomControls, useMapZoomStore } from "@/lib/state/map-zoom-store";

/** Mesmo corte de `AppShellSplit.module.css` e de `NationalChoroplethMap.tsx` (`DESKTOP_QUERY`). */
export const MAP_DESKTOP_QUERY = "(min-width: 960px)";

/** Duração do passo dos botões +/−. Sob `prefers-reduced-motion` o MapLibre zera sozinho (sem `essential`). */
export const ZOOM_STEP_MS = 250;
/** Duração do "ver tudo". Idem. */
export const ZOOM_RESET_MS = 400;

/** Folga de `setMaxBounds` além da união (vista inicial + país/estado), por lado. */
const MAX_BOUNDS_SLACK = 0.2;

/** Tolerância (graus / níveis de zoom) abaixo da qual a câmera conta como "no enquadramento". */
const HOME_EPSILON = 0.02;

/**
 * Opções de construtor comuns aos dois mapas. `dragRotate`/`touchPitch` já
 * eram desligados antes do ADR-0071; o resto é novo. `scrollZoom: true` é o
 * default do MapLibre, escrito de propósito — ver o § no topo.
 */
export const MAP_INTERACTION_OPTIONS = {
  dragRotate: false,
  touchPitch: false,
  doubleClickZoom: false,
  boxZoom: false,
  keyboard: false,
  renderWorldCopies: false,
  scrollZoom: true,
  // Textos do aviso de gesto cooperativo (ADR-0071). Chaves exatas de
  // `maplibre-gl@5.24` (`default_locale`).
  locale: {
    "CooperativeGesturesHandler.WindowsHelpText": "Use Ctrl + rolagem para ampliar o mapa",
    "CooperativeGesturesHandler.MacHelpText": "Use ⌘ + rolagem para ampliar o mapa",
    "CooperativeGesturesHandler.MobileHelpText": "Use dois dedos para mover o mapa",
  },
} satisfies Partial<maplibregl.MapOptions>;

/** `[oeste, sul, leste, norte]` — mesma ordem de `UF_BBOX` e `BRAZIL_BOUNDS`. */
export type Bbox = [number, number, number, number];

/**
 * Liga o modo por largura de tela (§ no topo) e desliga a rotação por dois
 * dedos. Aplica o modo corrente na hora e reaplica a cada mudança da media
 * query. Devolve a função que remove o listener (chamar antes de `map.remove()`).
 */
export function attachInteractionMode(map: maplibregl.Map): () => void {
  map.touchZoomRotate.disableRotation();
  const mq = window.matchMedia(MAP_DESKTOP_QUERY);
  const apply = (desktop: boolean) => {
    map.scrollZoom.enable();
    if (desktop) map.cooperativeGestures.disable();
    else map.cooperativeGestures.enable();
  };
  apply(mq.matches);
  const onChange = (e: MediaQueryListEvent) => apply(e.matches);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Caixa de `setMaxBounds`: a união da vista inicial com o país/estado, mais uma
 * folga por lado.
 *
 * 🔴 Por que a vista inicial entra na conta: `setMaxBounds` com uma caixa MENOR
 * que a viewport faz o MapLibre ampliar o mapa até a caixa preencher a tela. O
 * enquadramento inicial deixa folga grande em volta do Brasil (a moldura
 * flutuante reserva até 35% da altura em cada lado), então uma caixa só em
 * volta do Brasil deslocaria a câmera logo na montagem — e de novo a cada
 * redimensionamento (barra de endereço do celular aparecendo/sumindo muda a
 * altura da viewport). A folga de 20% por lado absorve esse tipo de variação.
 */
export function maxBoundsAround(viewport: Bbox, base: Bbox): Bbox {
  // Contêiner ainda sem layout (0×0) faz `getBounds()` devolver NaN/Infinity;
  // `Math.min(NaN, x)` é NaN e `setMaxBounds` com NaN trava o mapa. Sem vista
  // utilizável, vale só a caixa do país/estado.
  if (!viewport.every(Number.isFinite)) {
    const dx = (base[2] - base[0]) * MAX_BOUNDS_SLACK;
    const dy = (base[3] - base[1]) * MAX_BOUNDS_SLACK;
    return [base[0] - dx, base[1] - dy, base[2] + dx, base[3] + dy];
  }
  const w = Math.min(viewport[0], base[0]);
  const s = Math.min(viewport[1], base[1]);
  const e = Math.max(viewport[2], base[2]);
  const n = Math.max(viewport[3], base[3]);
  const dx = (e - w) * MAX_BOUNDS_SLACK;
  const dy = (n - s) * MAX_BOUNDS_SLACK;
  return [w - dx, s - dy, e + dx, n + dy];
}

/**
 * Aplica os limites de zoom e de arraste. Chamar DEPOIS do enquadramento
 * inicial (a vista atual é o que `maxBoundsAround` precisa enxergar), nunca
 * antes — senão o próprio limite altera o retrato inicial.
 */
export function applyZoomLimits(
  map: maplibregl.Map,
  { minZoom, maxZoom, base }: { minZoom: number; maxZoom: number; base: Bbox },
): void {
  // `setMinZoom`/`setMaxZoom` LANÇAM com valor não numérico ou min > max. Um
  // limite que falha não pode derrubar o mapa (constituição § 7): sem limite, o
  // mapa segue desenhando com o enquadramento que já tem.
  try {
    const [[w, s], [e, n]] = map.getBounds().toArray();
    map.setMaxZoom(maxZoom);
    map.setMinZoom(minZoom);
    map.setMaxBounds(maxBoundsAround([w, s, e, n], base));
  } catch (err) {
    console.error("[mapa] limites de zoom não aplicados (ADR-0071)", err);
  }
}

/** Câmera de enquadramento, em graus/níveis. */
export interface HomeCamera {
  lng: number;
  lat: number;
  zoom: number;
}

/**
 * Registra no `useMapZoomStore` os controles deste mapa e acompanha `moveend`
 * para habilitar o ⟲ só quando a câmera saiu do enquadramento. Devolve o
 * "desligar" — chamar ANTES de `map.remove()` (e antes do retry do self-heal).
 *
 * Sem `essential: true` em nenhuma animação: assim o MapLibre zera a duração
 * sob `prefers-reduced-motion` (constituição § 4, RNF-026).
 */
export function attachZoomControls(
  map: maplibregl.Map,
  { resetLabel, home, reset }: { resetLabel: string; home: () => HomeCamera; reset: () => void },
): () => void {
  const controls: MapZoomControls = {
    zoomIn: () => {
      map.zoomIn({ duration: ZOOM_STEP_MS });
    },
    zoomOut: () => {
      map.zoomOut({ duration: ZOOM_STEP_MS });
    },
    reset,
    resetLabel,
  };

  const sync = () => {
    const store = useMapZoomStore.getState();
    // Mapa que já foi substituído não fala com a store.
    if (store.controls !== controls) return;
    const h = home();
    const c = map.getCenter();
    store.setCanReset(
      Math.abs(map.getZoom() - h.zoom) > HOME_EPSILON ||
        Math.abs(c.lng - h.lng) > HOME_EPSILON ||
        Math.abs(c.lat - h.lat) > HOME_EPSILON,
    );
  };

  map.on("moveend", sync);
  useMapZoomStore.getState().register(controls);

  return () => {
    map.off("moveend", sync);
    useMapZoomStore.getState().unregister(controls);
  };
}

/** `LngLatLike` → `{ lng, lat }` (a câmera de `cameraForBounds` vem como `LngLat`; a reserva, como tupla). */
export function toLngLat(c: maplibregl.LngLatLike): { lng: number; lat: number } {
  if (Array.isArray(c)) return { lng: c[0], lat: c[1] };
  if ("lng" in c) return { lng: c.lng, lat: c.lat };
  return { lng: c.lon, lat: c.lat };
}
