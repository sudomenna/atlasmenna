/**
 * tests/unit/components/map-interaction.test.ts
 *
 * ADR-0071 — `maxBoundsAround`: a caixa de `setMaxBounds`. A propriedade que
 * importa é que ela CONTENHA a vista inicial: `setMaxBounds` com uma caixa menor
 * que a viewport faz o MapLibre ampliar a câmera até preenchê-la, deslocando o
 * enquadramento (e de novo a cada redimensionamento).
 */

import { describe, expect, it } from "vitest";

import { type Bbox, maxBoundsAround } from "@/components/atoms/maps/_map-interaction";

const BRASIL: Bbox = [-73.99, -33.75, -28.84, 5.27];

describe("maxBoundsAround", () => {
  it("contém a vista inicial E o país, com folga", () => {
    const vista: Bbox = [-90, -60, -10, 30];
    const [w, s, e, n] = maxBoundsAround(vista, BRASIL);
    expect(w).toBeLessThan(-90);
    expect(s).toBeLessThan(-60);
    expect(e).toBeGreaterThan(-10);
    expect(n).toBeGreaterThan(30);
  });

  it("vista menor que o país: vale o país, com folga", () => {
    const [w, s, e, n] = maxBoundsAround([-60, -20, -40, -5], BRASIL);
    expect(w).toBeLessThan(BRASIL[0]);
    expect(s).toBeLessThan(BRASIL[1]);
    expect(e).toBeGreaterThan(BRASIL[2]);
    expect(n).toBeGreaterThan(BRASIL[3]);
  });

  it("🔴 vista sem layout (NaN/Infinity) não contamina a caixa", () => {
    for (const ruim of [
      [Number.NaN, Number.NaN, Number.NaN, Number.NaN],
      [-Infinity, -Infinity, Infinity, Infinity],
    ] as Bbox[]) {
      const caixa = maxBoundsAround(ruim, BRASIL);
      expect(caixa.every(Number.isFinite)).toBe(true);
      expect(caixa[0]).toBeLessThan(BRASIL[0]);
      expect(caixa[2]).toBeGreaterThan(BRASIL[2]);
    }
  });
});
