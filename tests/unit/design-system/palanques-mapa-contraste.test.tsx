/**
 * tests/unit/design-system/palanques-mapa-contraste.test.tsx
 *
 * Mapa dos palanques (V3) — neutro e legível nos DOIS temas (constituição § 2 e
 * § 4; ADR-0059 § 2, condição 4). Molde: `etiqueta-editorial-contraste.test.tsx`.
 *
 * Os tokens locais `--pal-*` (`PalanquesMapa.module.css`) são apelidos de
 * semânticos do site; este teste resolve a cadeia até o hex de `app/globals.css`,
 * tema a tema — nada de número copiado.
 *
 *   - sem cor de partido, sem vermelho/azul, sem hex próprio no módulo;
 *   - tinta (texto, hachura) ≥ 4,5:1 sobre o papel do ladrilho (o halo do texto);
 *   - contorno ≥ 3:1 sobre cartão / página / fundo afundado (SC 1.4.11);
 *   - texto do estado quieto ≥ 4,5:1 sobre cartão / página / fundo afundado (não
 *     tem halo);
 *   - tinta e contorno: croma C* < 10 e ΔE76 ≥ 10 contra toda cor de
 *     `app/tokens-party.css` do mesmo tema (menos as tintas `-ink`, que SÃO a
 *     tinta do site).
 *
 * O papel do ladrilho é `--surface-card` — o próprio fundo do cartão, não uma
 * área de cor; por isso não entra no ΔE contra partidos (ver o CSS).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const LER = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const GLOBALS = LER("app/globals.css");
const ESCURO = GLOBALS.split(':root[data-theme="dark"] {')[1] ?? "";
const MODULO = LER("components/blocks/PalanquesMapa.module.css");
const PARTIDOS = LER("app/tokens-party.css");
const INICIO_ESCURO = PARTIDOS.indexOf(':root[data-theme="dark"] {');

/** O CSS sem comentários — o cabeçalho cita "vermelho/azul" para explicar por que não. */
const CODIGO = MODULO.replace(/\/\*[\s\S]*?\*\//g, "");

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
  const m = new RegExp(`--${nome}:\\s*var\\(--([a-z0-9-]+)\\)`).exec(CODIGO);
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

describe("mapa dos palanques — o CSS não tem cor própria nem cor de partido", () => {
  it("todo token local é apelido de um semântico do site", () => {
    expect(
      ["pal-tinta", "pal-borda", "pal-papel", "pal-quieto", "pal-tenue"].map(tokenLocal),
    ).toEqual([
      "text-primary",
      "border-strong",
      "surface-card",
      "text-secondary",
      "border-hairline",
    ]);
  });

  it("nenhum hex, rgb/hsl/oklch, cor nomeada, token de partido, de candidato ou de mapa", () => {
    expect(CODIGO).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(CODIGO).not.toMatch(/\b(rgb|hsl|hwb|oklch|oklab|lab|lch|color-mix)a?\(/i);
    expect(CODIGO).not.toMatch(/--party-|--color-cand|--map-|--chip-/);
    expect(CODIGO).not.toMatch(
      /:\s*(red|blue|green|orange|yellow|purple|pink|crimson|navy|teal|gold|black|white)\b/i,
    );
  });

  it("todo `fill` / `stroke` declarado é `none` ou um token (nunca um valor de cor)", () => {
    const decls = [...CODIGO.matchAll(/\b(fill|stroke):\s*([^;]+);/g)].map((m) => m[2]?.trim());
    expect(decls.length).toBeGreaterThan(5);
    for (const v of decls) expect(v, String(v)).toMatch(/^(none|var\(--pal-[a-z]+\))$/);
  });

  it("o módulo não seleciona `data-view-only` nem declara `display` fora dos filhos", () => {
    expect(CODIGO).not.toMatch(/data-view-only/);
    // `display` só em `.raiz`, `.figura`, `.mapa`, `.legenda*` — nunca no elemento das bases.
    const blocos = [...CODIGO.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [, seletor, corpo] of blocos) {
      if (/\bdisplay\s*:/.test(corpo ?? "")) {
        expect(seletor?.trim(), corpo).toMatch(
          /^\.(raiz|figura|mapa|legenda|legendaLista|legendaLista li)$/,
        );
      }
    }
  });
});

describe("mapa dos palanques — neutro e legível nos dois temas", () => {
  it("há cores de partido nos dois temas (o arquivo gerado foi lido)", () => {
    expect(INICIO_ESCURO).toBeGreaterThan(0);
    expect(coresDePartido(false).length).toBeGreaterThan(100);
    expect(coresDePartido(true).length).toBeGreaterThan(100);
  });

  for (const tema of TEMAS) {
    it(`tema ${tema.id}: tinta ≥ 4,5:1 sobre o papel do ladrilho (o halo do texto e o fundo da hachura)`, () => {
      const tinta = hex(tema.escopo, "pal-tinta");
      const papel = hex(tema.escopo, "pal-papel");
      expect(contraste(tinta, papel)).toBeGreaterThanOrEqual(4.5);
    });

    it(`tema ${tema.id}: contorno ≥ 3:1 sobre cartão, página e fundo afundado`, () => {
      const borda = hex(tema.escopo, "pal-borda");
      for (const p of ["paper-0", "paper-1", "paper-2"]) {
        expect(
          contraste(borda, primitivo(tema.escopo, p)),
          `contorno sobre ${p}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it(`tema ${tema.id}: texto do estado quieto ≥ 4,5:1 sobre cartão, página e fundo afundado`, () => {
      const quieto = hex(tema.escopo, "pal-quieto");
      for (const p of ["paper-0", "paper-1", "paper-2"]) {
        expect(
          contraste(quieto, primitivo(tema.escopo, p)),
          `quieto sobre ${p}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`tema ${tema.id}: tinta e contorno neutros (C* < 10) e ΔE76 ≥ 10 contra toda cor de partido`, () => {
      for (const t of ["pal-tinta", "pal-borda"]) {
        const cor = hex(tema.escopo, t);
        expect(croma(cor), t).toBeLessThan(10);
        const [pior] = coresDePartido(tema.escuro)
          .map(([nome, c]) => [deltaE(cor, c), nome] as const)
          .sort((a, b) => a[0] - b[0]);
        expect(pior?.[0], `${t} × ${pior?.[1]}`).toBeGreaterThanOrEqual(10);
      }
    });

    it(`tema ${tema.id}: texto quieto sem matiz (C* < 10) — nem vermelho, nem azul`, () => {
      expect(croma(hex(tema.escopo, "pal-quieto"))).toBeLessThan(10);
    });
  }
});
