"use client";

/**
 * components/atoms/maps/MapZoomControls.tsx
 *
 * Botões de ampliar (+), reduzir (−) e "ver tudo" (⟲) do mapa vivo (ADR-0071).
 *
 * 🔴 **Não importa `maplibre-gl`, de propósito.** O chunk do mapa está a poucos
 * KiB do teto de RNF-007b (300 KiB); estes botões moram fora dele e falam com o
 * mapa só pela store (`lib/state/map-zoom-store.ts`): o mapa registra três
 * funções no `load` e desregistra antes de `map.remove()`. Sem mapa registrado
 * (carregando, falhou, outra rota) o componente não renderiza nada — nunca um
 * botão que não faz nada.
 *
 * ## Posição
 *
 * Montado DUAS vezes por moldura, uma por breakpoint (a cópia inativa vira
 * `display: none`, fora da árvore de acessibilidade):
 *   - `variant="desktop"` — canto inferior direito, sobre o mapa (≥ 960px);
 *   - `variant="bar"` — faixa em fluxo logo abaixo do mapa, no celular
 *     (< 960px; ADR-0056: nada por cima do mapa no celular).
 *
 * ## Acessibilidade (RNF-025)
 *
 * `<button type="button">` com `aria-label` em pt-BR (o ícone é SVG
 * `aria-hidden`), alvo de `var(--tap-min)` (44px) e foco visível global.
 * Estes botões são o caminho de teclado do mapa: o `<canvas>` sai da ordem de
 * Tab (`tabIndex = -1`).
 */

import type { ReactNode } from "react";

import { useMapZoomStore } from "@/lib/state/map-zoom-store";

import styles from "./MapZoomControls.module.css";

export interface MapZoomControlsProps {
  /** `desktop`: coluna sobre o canto do mapa. `bar`: faixa em fluxo abaixo do mapa (celular). */
  variant: "desktop" | "bar";
}

/** Ícone decorativo: o nome acessível vem do `aria-label` do botão, nunca do SVG. */
function Icone({ children }: { children: ReactNode }) {
  return (
    <svg
      className={styles.icon}
      aria-hidden="true"
      focusable="false"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function MapZoomControls({ variant }: MapZoomControlsProps) {
  // Selectors finos (regra de `hover-store.ts`): um por campo.
  const controls = useMapZoomStore((s) => s.controls);
  const canReset = useMapZoomStore((s) => s.canReset);

  if (controls === null) return null;

  return (
    <div className={variant === "desktop" ? styles.desktop : styles.bar}>
      <button
        type="button"
        className={styles.btn}
        aria-label="Ampliar o mapa"
        onClick={() => controls.zoomIn()}
      >
        <Icone>
          <path d="M9 3v12M3 9h12" />
        </Icone>
      </button>
      <button
        type="button"
        className={styles.btn}
        aria-label="Reduzir o mapa"
        onClick={() => controls.zoomOut()}
      >
        <Icone>
          <path d="M3 9h12" />
        </Icone>
      </button>
      <button
        type="button"
        className={styles.btn}
        aria-label={controls.resetLabel}
        disabled={!canReset}
        onClick={() => controls.reset()}
      >
        {/* Quatro cantos apontando para fora: "enquadrar tudo". */}
        <Icone>
          <path d="M3 7V3h4M11 3h4v4M15 11v4h-4M7 15H3v-4" />
        </Icone>
      </button>
    </div>
  );
}
