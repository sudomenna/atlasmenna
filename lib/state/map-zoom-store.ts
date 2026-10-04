/**
 * lib/state/map-zoom-store.ts
 *
 * Ponte entre o mapa vivo (MapLibre, dentro do chunk lazy do ADR-0010) e os
 * botões de ampliar/reduzir/ver tudo (`<MapZoomControls>`, que moram FORA desse
 * chunk). ADR-0071.
 *
 * O mapa registra no `load` um objeto `controls` — três funções que fecham
 * sobre a instância dele — e desregistra ANTES de `map.remove()`. Os botões só
 * leem a store e chamam essas funções; nunca importam `maplibre-gl` (RNF-007b:
 * o chunk do mapa está a poucos KiB do teto de 300 KiB).
 *
 * 🔴 **`unregister(c)` só limpa se `c` for o controle registrado agora.** Trocar
 * Brasil → estado destrói um mapa e cria outro; o `cleanup` do antigo pode rodar
 * DEPOIS de o novo já ter registrado (React monta o filho novo antes de rodar o
 * cleanup do velho em alguns caminhos). Sem a comparação, o desregistro do mapa
 * morto apagaria o controle do vivo e os botões sumiriam sem erro nenhum.
 *
 * Regra de selector (a mesma de `hover-store.ts`): use selector fino.
 *
 * Instância única por página via `storeUnicaPorPagina` — produtor (o impl do
 * mapa, atrás do `next/dynamic`) e consumidor (os botões, no pacote da moldura)
 * ficam em lados opostos do import dinâmico; ver `store-por-pagina.ts`.
 */

import { create } from "zustand";

import { storeUnicaPorPagina } from "./store-por-pagina";

export interface MapZoomControls {
  /** Aproxima um nível, com animação curta (some sob `prefers-reduced-motion`). */
  zoomIn: () => void;
  /** Afasta um nível. */
  zoomOut: () => void;
  /** Volta ao enquadramento inicial (Brasil inteiro / estado inteiro). */
  reset: () => void;
  /** Texto do botão "voltar ao enquadramento" ("Ver o Brasil inteiro" etc.). */
  resetLabel: string;
}

interface MapZoomState {
  controls: MapZoomControls | null;
  /** `true` quando a câmera saiu do enquadramento inicial (habilita o ⟲). */
  canReset: boolean;
  register: (controls: MapZoomControls) => void;
  unregister: (controls: MapZoomControls) => void;
  setCanReset: (canReset: boolean) => void;
}

export const useMapZoomStore = storeUnicaPorPagina("lib/state/map-zoom-store.ts", () =>
  create<MapZoomState>((set, get) => ({
    controls: null,
    canReset: false,
    register: (controls) => set({ controls, canReset: false }),
    unregister: (controls) => {
      if (get().controls !== controls) return;
      set({ controls: null, canReset: false });
    },
    setCanReset: (canReset) => {
      if (get().canReset !== canReset) set({ canReset });
    },
  })),
);
