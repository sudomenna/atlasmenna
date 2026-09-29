/**
 * tests/unit/design-system/etiqueta-editorial-contraste.test.tsx
 *
 * Spec 024, RF-235 — a etiqueta editorial é neutra e legível nos DOIS temas.
 *
 * Os tokens locais (`--etq-*`, `EtiquetaEditorial.module.css`) são apelidos de
 * semânticos do site; este teste resolve a cadeia até o hex de
 * `app/globals.css`, tema a tema — nada de número copiado.
 *
 *   - sem área de cor: fundo transparente (ver o CSS para o porquê);
 *   - tinta ≥ 4,5:1 e borda ≥ 3:1 sobre cartão / página / fundo afundado
 *     (constituição § 4 / RNF-022; SC 1.4.11 — é a borda que desenha a caixa);
 *   - neutra: croma C* < 10 na tinta e na borda (nem vermelho, nem azul);
 *   - ΔE76 ≥ 10 entre tinta/borda e toda cor de `app/tokens-party.css` do
 *     mesmo tema (menos as `-ink`, que são a própria tinta do site).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const LER = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const GLOBALS = LER("app/globals.css");
const ESCURO = GLOBALS.split(':root[data-theme="dark"] {')[1] ?? "";
const MODULO = LER("components/atoms/data/EtiquetaEditorial.module.css");
const PARTIDOS = LER("app/tokens-party.css");
const INICIO_ESCURO = PARTIDOS.indexOf(':root[data-theme="dark"] {');

function primitivo(escopo: string, nome: string): string {
  const m = new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`).exec(escopo);
  if (!m?.[1]) throw new Error(`primitivo --${nome} não encontrado`);
  return m[1].toLowerCase();
}

function primitivoDoSemantico(semantico: string): string {
  const m = new RegExp(`--${semantico}:\\s*var\\(--([a-z0-9-]+)\\)`).exec(GLOBALS);
  if (!m?.[1]) throw new Error(`--${semantico} não aponta para um primitivo`);
  return m[1];
}

function tokenLocal(nome: string): string {
  const m = new RegExp(`--${nome}:\\s*var\\(--([a-z0-9-]+)\\)`).exec(MODULO);
  if (!m?.[1]) throw new Error(`--${nome} não é apelido de um semântico`);
  return m[1];
}

function hex(tema: string, local: string): string {
  return primitivo(tema, primitivoDoSemantico(tokenLocal(local)));
}

function canalLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgb(h: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminancia(h: string): number {
  const [r, g, b] = rgb(h).map(canalLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function lab(h: string): [number, number, number] {
  const [r, g, b] = rgb(h).map(canalLinear) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string): number {
  const [la, aa, ba] = lab(a);
  const [lb, ab, bb] = lab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
}

function croma(h: string): number {
  const [, a, b] = lab(h);
  return Math.hypot(a, b);
}

/** Cores de partido de UM tema, sem as tintas `-ink` (que são a tinta do site). */
function coresDePartido(escuro: boolean): Array<[string, string]> {
  return [...PARTIDOS.matchAll(/(--party-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)]
    .filter((m) => !m[1]?.endsWith("-ink") && m.index > INICIO_ESCURO === escuro)
    .map((m) => [m[1] as string, (m[2] as string).toLowerCase()]);
}

const TEMAS = [
  { id: "claro", escopo: GLOBALS, escuro: false },
  { id: "escuro", escopo: ESCURO, escuro: true },
] as const;

describe("RF-235 — etiqueta editorial neutra e legível nos dois temas", () => {
  it("tinta e borda são apelidos de semânticos do site; fundo transparente; borda tracejada", () => {
    expect(["etq-tinta", "etq-borda"].map(tokenLocal)).toEqual(["text-primary", "border-strong"]);
    expect(MODULO).toMatch(/--etq-fundo:\s*transparent;/);
    expect(MODULO).toMatch(/border:\s*1px dashed var\(--etq-borda\)/);
  });

  it("há cores de partido nos dois temas (o arquivo gerado foi lido)", () => {
    expect(INICIO_ESCURO).toBeGreaterThan(0);
    expect(coresDePartido(false).length).toBeGreaterThan(100);
    expect(coresDePartido(true).length).toBeGreaterThan(100);
  });

  for (const tema of TEMAS) {
    it(`tema ${tema.id}: tinta ≥ 4,5:1 e borda ≥ 3:1 sobre cartão, página e fundo afundado`, () => {
      const tinta = hex(tema.escopo, "etq-tinta");
      const borda = hex(tema.escopo, "etq-borda");
      for (const p of ["paper-0", "paper-1", "paper-2"]) {
        const sup = primitivo(tema.escopo, p);
        expect(contraste(tinta, sup), `tinta sobre ${p}`).toBeGreaterThanOrEqual(4.5);
        expect(contraste(borda, sup), `borda sobre ${p}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`tema ${tema.id}: neutra (C* < 10) e ΔE76 ≥ 10 contra toda cor de partido`, () => {
      for (const t of ["etq-tinta", "etq-borda"]) {
        const cor = hex(tema.escopo, t);
        expect(croma(cor), t).toBeLessThan(10);
        const [pior] = coresDePartido(tema.escuro)
          .map(([nome, c]) => [deltaE(cor, c), nome] as const)
          .sort((a, b) => a[0] - b[0]);
        expect(pior?.[0], `${t} × ${pior?.[1]}`).toBeGreaterThanOrEqual(10);
      }
    });
  }
});
