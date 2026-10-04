/**
 * tests/unit/design-system/lista-resultado-contraste.test.ts
 *
 * Os pares de cor NOVOS da lista do `<ResultPanel>` na versão D (decisão do
 * dono, 2026-09-27; `components/atoms/tables/CandidateResultRow.module.css`).
 *
 * O percentual grande usa `--color-pct-votos` desde 2026-10-03 (decisão do
 * dono; até então `--party-<x>-text`), que aponta para `--text-primary` — o
 * par "nome, votos do cartão" abaixo cobre o contraste dele. O que a versão D
 * trouxe e ninguém media:
 *
 * | elemento | frente | fundo | piso |
 * |---|---|---|---|
 * | selo em pílula | `--text-inverse` | `--surface-inverse` | 4,5 (texto) |
 * | "PT – 13", "apurado X%", votos | `--text-secondary` | `--surface-card` | 4,5 (texto) |
 * | nome, votos do cartão, percentual | `--text-primary` | `--surface-card` | 4,5 (texto) |
 * | marca da projeção (sobra) | `--text-primary` | `--surface-card` | 3 (não-texto) |
 * | marca da projeção (trilho) | `--text-primary` | `--surface-sunken` | 3 (não-texto) |
 *
 * **Os dois temas, sempre** — o cartão é `--surface-card`, nunca `#fff`,
 * justamente porque há tema escuro (a pílula INVERTE lá: fundo quase branco,
 * tinta escura).
 *
 * O teste amarra os dois lados: (1) a folha da lista USA esses tokens nesses
 * papéis, e (2) os tokens, resolvidos no `app/globals.css` commitado, passam o
 * piso. Sem (1), trocar a pílula para `--accent` passaria com (2) verde.
 *
 * Colorimetria reimplementada de propósito, pelo mesmo motivo de
 * `placar-contraste.test.tsx`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const GLOBALS = readFileSync(resolve(RAIZ, "app/globals.css"), "utf-8");
const MODULO = readFileSync(
  resolve(RAIZ, "components/atoms/tables/CandidateResultRow.module.css"),
  "utf-8",
).replace(/\s+/g, " ");

function luminancia(hex: string): number {
  const canal = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(canal(1)) + 0.7152 * lin(canal(3)) + 0.0722 * lin(canal(5));
}

function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Os valores de um primitivo, na ordem do arquivo: [claro, escuro]. */
function primitivo(nome: string): [string, string] {
  const achados = [...GLOBALS.matchAll(new RegExp(`${nome}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "g"))].map(
    (m) => (m[1] as string).toLowerCase(),
  );
  expect(achados.length, `${nome} precisa existir nos dois temas`).toBeGreaterThanOrEqual(2);
  return [achados[0] as string, achados[1] as string];
}

const INK_0 = primitivo("--ink-0");
const INK_2 = primitivo("--ink-2");
const PAPER_0 = primitivo("--paper-0");
const PAPER_2 = primitivo("--paper-2");

/** Os semânticos, resolvidos por tema — com a sincronia com o CSS afirmada. */
const TEMAS = {
  claro: {
    card: PAPER_0[0],
    sunken: PAPER_2[0],
    primary: INK_0[0],
    secondary: INK_2[0],
    inverse: INK_0[0],
    textInverse: PAPER_0[0],
  },
  escuro: {
    card: PAPER_0[1],
    sunken: PAPER_2[1],
    primary: INK_0[1],
    secondary: INK_2[1],
    inverse: INK_0[1],
    // O escuro sobrescreve `--text-inverse` com hex literal (ver abaixo).
    textInverse: "#14171b",
  },
} as const;

describe("os semânticos resolvem como este teste supõe (sincronia com globals.css)", () => {
  it.each([
    "--surface-card: var(--paper-0)",
    "--surface-sunken: var(--paper-2)",
    "--surface-inverse: var(--ink-0)",
    "--text-primary: var(--ink-0)",
    "--text-secondary: var(--ink-2)",
    "--text-inverse: var(--paper-0)",
  ])("%s", (decl) => {
    expect(GLOBALS).toContain(decl);
  });

  it("o tema escuro inverte a tinta da pílula", () => {
    const escuro = GLOBALS.slice(GLOBALS.indexOf(':root[data-theme="dark"]'));
    expect(escuro).toMatch(/--text-inverse:\s*#14171b;/);
  });
});

describe("a folha da lista usa os tokens nos papéis medidos", () => {
  it("pílula: `--text-inverse` sobre `--surface-inverse`", () => {
    expect(MODULO).toMatch(/\.pilula \{[^}]*background: var\(--surface-inverse\)/);
    expect(MODULO).toMatch(/\.pilula \{[^}]*color: var\(--text-inverse\)/);
  });

  it("cartões sobre `--surface-card` — nunca `#fff`", () => {
    expect(MODULO).toMatch(/li:nth-child\(-n \+ 2\) \{[^}]*background: var\(--surface-card\)/);
    expect(MODULO).toMatch(/li:nth-child\(n \+ 3\) \{[^}]*background: var\(--surface-card\)/);
    expect(MODULO).not.toMatch(/#fff\b|#ffffff|:\s*white\b/i);
  });

  it("marca da projeção em `--text-primary`; trilho em `--surface-sunken`", () => {
    expect(MODULO).toMatch(/\.marca \{[^}]*background: var\(--text-primary\)/);
    expect(MODULO).toMatch(/\.clip \{[^}]*background: var\(--surface-sunken\)/);
  });

  it("🔴 a calha da barra tem o contorno `DATA_FILL_STROKE` (§ 4, WCAG 1.4.11)", () => {
    // Sem o contorno, PSOL/PSB/NOVO/Outros (< 3:1 contra a calha e o cartão)
    // perdem a fronteira do preenchimento. Mesmo traço da `<VoteBar>`.
    expect(MODULO).toMatch(/\.clip \{[^}]*border: 1px solid var\(--text-secondary\)/);
  });

  it("textos secundários em `--text-secondary`", () => {
    expect(MODULO).toMatch(/\.partido \{[^}]*color: var\(--text-secondary\)/);
    expect(MODULO).toMatch(/\.sub, \.votos \{[^}]*color: var\(--text-secondary\)/);
  });

  // 🔴 Decisão do dono, 2026-10-03: o percentual de votos sai na cor ÚNICA
  // `--color-pct-votos`, não mais na cor de texto do partido (`--cor-texto`).
  // O token aponta para `--text-primary`, então o contraste dele é o do caso
  // "texto primário sobre o cartão" medido abaixo, nos dois temas.
  it("o percentual lê a cor ÚNICA de percentual de votos — nunca a do partido", () => {
    expect(MODULO).toMatch(/\.pct \{[^}]*color: var\(--color-pct-votos\)/);
    expect(MODULO).not.toContain("var(--cor-texto");
    expect(GLOBALS).toMatch(/--color-pct-votos:\s*var\(--text-primary\)\s*;/);
  });

  // 🔴 Emenda do dono, 2026-10-04: o percentual PROJETADO (bloco da visão
  // Projeção) sai na cor da projeção. O contraste do token sobre o cartão está
  // em `projecao-indicador-contraste.test.ts` (5,45:1 claro, ≥ 8,7:1 escuro).
  it("o percentual projetado lê a cor da PROJEÇÃO (`.pctProj`, declarada depois de `.pct`)", () => {
    expect(MODULO).toMatch(/\.pctProj \{[^}]*color: var\(--color-pct-proj\)/);
    expect(MODULO.indexOf(".pctProj {")).toBeGreaterThan(MODULO.indexOf(".pct {"));
  });
});

describe.each(Object.entries(TEMAS))("contraste — tema %s", (_tema, t) => {
  it("pílula ≥ 4,5:1", () => {
    expect(contraste(t.textInverse, t.inverse)).toBeGreaterThanOrEqual(4.5);
  });

  it("texto secundário sobre o cartão ≥ 4,5:1", () => {
    expect(contraste(t.secondary, t.card)).toBeGreaterThanOrEqual(4.5);
  });

  it("texto primário sobre o cartão ≥ 4,5:1", () => {
    expect(contraste(t.primary, t.card)).toBeGreaterThanOrEqual(4.5);
  });

  it("contorno da barra ≥ 3:1 sobre a calha e sobre o cartão", () => {
    expect(contraste(t.secondary, t.sunken)).toBeGreaterThanOrEqual(3);
    expect(contraste(t.secondary, t.card)).toBeGreaterThanOrEqual(3);
  });

  it("marca da projeção ≥ 3:1 sobre o cartão (a sobra) e sobre o trilho", () => {
    expect(contraste(t.primary, t.card)).toBeGreaterThanOrEqual(3);
    expect(contraste(t.primary, t.sunken)).toBeGreaterThanOrEqual(3);
  });
});
