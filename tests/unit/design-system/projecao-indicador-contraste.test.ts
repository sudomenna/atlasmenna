/**
 * tests/unit/design-system/projecao-indicador-contraste.test.ts
 *
 * O par de cor da linha pequena "↑ 38,0% proj" da visão Parcial
 * (`<ProjecaoIndicador>`, decisão do dono de 2026-10-03):
 *
 * | elemento | frente | fundo | piso |
 * |---|---|---|---|
 * | seta + número + "proj" | `--color-pct-proj` (= `--accent-text`) | `--surface-page` | 4,5 (texto) |
 * | idem | idem | `--surface-card` | 4,5 (texto) |
 *
 * 11px — texto pequeno, então o piso é o de texto normal (constituição § 4),
 * sem a exceção de texto grande. **Os dois temas, sempre.**
 *
 * O teste amarra os dois lados, como `lista-resultado-contraste.test.ts`:
 * (1) o token aponta para `--accent-text` e a folha do átomo usa o token; (2)
 * os hexes resolvidos no `app/globals.css` passam o piso. Sem (1), trocar o
 * token para `--accent` (2,67:1, cor de preenchimento) passaria com (2) verde.
 *
 * Colorimetria reimplementada de propósito, pelo mesmo motivo de
 * `placar-contraste.test.tsx` (o teste não confia no código que audita).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const GLOBALS = readFileSync(resolve(RAIZ, "app/globals.css"), "utf-8");
const MODULO = readFileSync(
  resolve(RAIZ, "components/atoms/data/ProjecaoIndicador.module.css"),
  "utf-8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ");

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
  expect(achados.length, `${nome} precisa existir nos dois temas`).toBe(2);
  return [achados[0] as string, achados[1] as string];
}

const ACCENT_TEXT = primitivo("--accent-text");
const PAPER_0 = primitivo("--paper-0");
const PAPER_1 = primitivo("--paper-1");

const TEMAS = {
  claro: { proj: ACCENT_TEXT[0], page: PAPER_1[0], card: PAPER_0[0] },
  escuro: { proj: ACCENT_TEXT[1], page: PAPER_1[1], card: PAPER_0[1] },
} as const;

describe("contraste da linha 'proj' da visão Parcial (2026-10-03)", () => {
  it("(1) o token é `--accent-text`, a folha do átomo o usa, e as superfícies são as de sempre", () => {
    expect(GLOBALS).toMatch(/--color-pct-proj:\s*var\(--accent-text\)\s*;/);
    // Definido UMA vez (no `:root`): o tema escuro troca o `--accent-text`, não o token.
    expect([...GLOBALS.matchAll(/--color-pct-proj:/g)]).toHaveLength(1);
    expect(MODULO).toMatch(/\.indicador \{[^}]*color: var\(--color-pct-proj\)/);
    // E a linha "≈ N votos projetados" da visão Projeção (`<VotosProjetados>`,
    // 2026-10-03) — mesma tinta, mesmas superfícies, mesmo piso (11–12px).
    expect(MODULO).toMatch(/\.votos \{[^}]*color: var\(--color-pct-proj\)/);
    expect(GLOBALS).toMatch(/--surface-page:\s*var\(--paper-1\)\s*;/);
    expect(GLOBALS).toMatch(/--surface-card:\s*var\(--paper-0\)\s*;/);
  });

  // 🔴 2026-10-04 (dono): "sempre que exibir percentual projetado a cor deve
  // ser a cor padrão para projeção". As folhas que passaram a usar o token, e
  // o fundo de cada uma — todas sobre `--surface-card`/`--color-bg` (=
  // `--paper-0`) ou `--surface-page`, os dois fundos medidos em (2). Nenhum
  // número projetado foi pintado sobre fundo de partido, `--surface-inverse` ou
  // `--surface-sunken` (o ocre mede 3,19:1 sobre `--ink-0` e 4,72:1 sobre
  // `--paper-2` no claro — ver o relatório de 04/10).
  it("(1b) as folhas dos números projetados usam o token, sobre fundos medidos", () => {
    const folha = (p: string) =>
      readFileSync(resolve(RAIZ, p), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ");
    expect(GLOBALS).toMatch(/--color-bg:\s*var\(--paper-0\)\s*;/);
    const lista = folha("components/atoms/tables/CandidateResultRow.module.css");
    expect(lista).toMatch(/\.pctProj \{[^}]*color: var\(--color-pct-proj\)/);
    const gov = folha("components/blocks/GovernorCard.module.css");
    expect(gov).toMatch(/\.c li > span:nth-child\(4\) \{[^}]*color: var\(--color-pct-proj\)/);
    expect(gov).toMatch(/\.c \{[^}]*background-color: var\(--color-bg\)/);
    const regiao = folha("components/blocks/RegiaoConsolidada.module.css");
    expect(regiao).toMatch(
      /\.resumo\[data-view-only="proj"\] > ul > li > span \{[^}]*color: var\(--color-pct-proj\)/,
    );
    expect(regiao).toMatch(/\.regiao \{[^}]*background-color: var\(--color-bg\)/);
  });

  for (const [tema, t] of Object.entries(TEMAS)) {
    it(`(2) ${tema}: ≥ 4,5:1 sobre --surface-page e sobre --surface-card`, () => {
      const page = contraste(t.proj, t.page);
      const card = contraste(t.proj, t.card);
      expect(page, `${tema}: ${t.proj} sobre ${t.page}`).toBeGreaterThanOrEqual(4.5);
      expect(card, `${tema}: ${t.proj} sobre ${t.card}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("(3) os números medidos, para quem mexer no ocre saber de onde parte", () => {
    const r = (a: string, b: string) => Math.round(contraste(a, b) * 100) / 100;
    expect(r(TEMAS.claro.proj, TEMAS.claro.page)).toBe(5.12);
    expect(r(TEMAS.claro.proj, TEMAS.claro.card)).toBe(5.45);
    expect(r(TEMAS.escuro.proj, TEMAS.escuro.card)).toBeGreaterThanOrEqual(8.7);
    expect(r(TEMAS.escuro.proj, TEMAS.escuro.page)).toBeGreaterThan(
      r(TEMAS.escuro.proj, TEMAS.escuro.card),
    );
  });
});
