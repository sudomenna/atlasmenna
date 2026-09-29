/**
 * tests/unit/design-system/hemiciclo-bloco-neutro.test.ts — a visão por bloco
 * não usa cor (spec 025, RF-240; constituição 1.6 § 2 (d)).
 *
 * Os blocos se distinguem por TEXTURA em tinta neutra (cheia, hachurada,
 * vazada), não por tom: medido em 29/09, todo cinza intermediário fica a
 * ΔE76 < 10 de algum nível de "Outros" da paleta de partido. Aqui se trava que
 * a tinta é `--text-primary` e o fundo é `--surface-card`, e que essa tinta
 * passa o piso contra TODA cor de partido, nos dois temas.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PAPEL_BLOCO, TINTA_BLOCO } from "@/components/blocks/HemicicloPorBloco";

const LER = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const GLOBALS = LER("app/globals.css");
const ESCURO = GLOBALS.split(':root[data-theme="dark"] {')[1] ?? "";
const PARTIDOS = LER("app/tokens-party.css");
const INICIO_ESCURO = PARTIDOS.indexOf(':root[data-theme="dark"] {');
const COMPONENTE = LER("components/blocks/HemicicloPorBloco.tsx");

function hexDe(escopo: string, nome: string): string {
  const m = new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`).exec(escopo);
  if (!m?.[1]) throw new Error(`--${nome} não encontrado`);
  return m[1].toLowerCase();
}

function lin(v: number) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function lab(h: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => lin(Number.parseInt(h.slice(i, i + 2), 16))) as [
    number,
    number,
    number,
  ];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function deltaE(a: string, b: string) {
  const [la, aa, ba] = lab(a);
  const [lb, ab, bb] = lab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
}

describe("RF-240 — visão por bloco sem cor", () => {
  it("tinta = --text-primary; papel = --surface-card", () => {
    expect(TINTA_BLOCO).toBe("var(--text-primary)");
    expect(PAPEL_BLOCO).toBe("var(--surface-card)");
  });

  it("🔴 o componente não pinta com cor de partido nem com hex próprio", () => {
    expect(COMPONENTE).not.toMatch(/textForParty|colorForParty|--party-/);
    expect(COMPONENTE).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  for (const [tema, escopo, escuro] of [
    ["claro", GLOBALS, false],
    ["escuro", ESCURO, true],
  ] as const) {
    it(`tema ${tema}: a tinta fica a ΔE76 ≥ 10 de toda cor de partido`, () => {
      const tinta = hexDe(escopo, "ink-0");
      const cores = [...PARTIDOS.matchAll(/(--party-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)]
        .filter((m) => !m[1]?.endsWith("-ink") && m.index > INICIO_ESCURO === escuro)
        .map((m) => (m[2] as string).toLowerCase());
      expect(cores.length).toBeGreaterThan(100);
      const pior = Math.min(...cores.map((c) => deltaE(tinta, c)));
      expect(pior).toBeGreaterThanOrEqual(10);
    });
  }
});
