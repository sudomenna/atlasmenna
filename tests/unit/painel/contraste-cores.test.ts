/**
 * tests/unit/painel/contraste-cores.test.ts
 *
 * Contraste de não-texto do painel privado (RNF-035, WCAG 1.4.11; ADR-0077):
 * cada cor de série (uma por cargo) e cada contorno das paradas da projeção
 * precisam de **≥ 3:1** contra o fundo REAL do gráfico (`--paper-1`, o fundo da
 * página) e contra `--paper-0` (o fundo dos cartões), nos DOIS temas.
 *
 * Os hex são lidos dos próprios arquivos de estilo — `painel.module.css` e
 * `app/globals.css` —, não copiados para cá: um hex trocado lá sem passar por
 * aqui reprova.
 *
 * Por que existe: na primeira versão, quatro tons do tema claro ficavam entre
 * 1,97:1 e 2,91:1 (auditoria de 05/10). O ADR-0047 já tratou o piso de 3:1 como
 * defeito a corrigir, não exceção a documentar.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const CSS_PAINEL = readFileSync(join(RAIZ, "components/painel/painel.module.css"), "utf8");
const CSS_GLOBAL = readFileSync(join(RAIZ, "app/globals.css"), "utf8");

/** Luminância relativa WCAG 2.x de um `#rrggbb`. */
function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (escuro + 0.05);
}

/** O corpo `{ … }` do primeiro bloco cujo seletor é exatamente `seletor`. */
function bloco(css: string, seletor: string): string {
  const i = css.indexOf(`${seletor} {`);
  if (i < 0) throw new Error(`bloco ${seletor} não encontrado`);
  const fim = css.indexOf("}", i);
  return css.slice(i, fim);
}

function hexDe(corpo: string, variavel: string): string {
  const m = new RegExp(`${variavel}:\\s*(#[0-9a-fA-F]{6})\\b`).exec(corpo);
  if (!m?.[1]) throw new Error(`${variavel} sem hex de 6 dígitos`);
  return m[1].toLowerCase();
}

/** As duas definições (claro, escuro) de um primitivo em `app/globals.css`. */
function claroEscuro(variavel: string): [string, string] {
  const todas = [...CSS_GLOBAL.matchAll(new RegExp(`${variavel}:\\s*(#[0-9a-fA-F]{6})\\b`, "g"))];
  if (todas.length < 2) throw new Error(`${variavel}: esperava claro e escuro em globals.css`);
  return [todas[0]?.[1] as string, todas[1]?.[1] as string];
}

const [PAPER0_CLARO, PAPER0_ESCURO] = claroEscuro("--paper-0");
const [PAPER1_CLARO, PAPER1_ESCURO] = claroEscuro("--paper-1");
const FUNDOS = {
  claro: [PAPER1_CLARO, PAPER0_CLARO],
  escuro: [PAPER1_ESCURO, PAPER0_ESCURO],
} as const;

const CARGOS = [1, 3, 5, 6, 7, 8] as const;
const TEMAS = {
  claro: bloco(CSS_PAINEL, ".painel"),
  escuro: bloco(CSS_PAINEL, ':root[data-theme="dark"] .painel'),
} as const;

describe("cores das séries do painel — ≥ 3:1 contra o fundo nos dois temas", () => {
  for (const tema of ["claro", "escuro"] as const) {
    for (const cd of CARGOS) {
      it(`cargo ${cd}, tema ${tema}`, () => {
        const cor = hexDe(TEMAS[tema], `--painel-cargo-${cd}`);
        for (const fundo of FUNDOS[tema]) {
          expect(
            contraste(cor, fundo),
            `${cor} contra ${fundo}: ${contraste(cor, fundo).toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  it("as seis cores são distintas entre si em cada tema", () => {
    for (const tema of ["claro", "escuro"] as const) {
      const cores = CARGOS.map((cd) => hexDe(TEMAS[tema], `--painel-cargo-${cd}`));
      expect(new Set(cores).size).toBe(6);
    }
  });
});

describe("contornos das paradas da projeção — ≥ 3:1 contra o fundo", () => {
  it("o painel usa os tokens que este teste mede", () => {
    expect(TEMAS.claro).toMatch(/--painel-falha:\s*var\(--color-warning\)/);
    expect(TEMAS.claro).toMatch(/--painel-neutro-borda:\s*var\(--color-text-muted\)/);
    // `--color-text-muted` é `var(--ink-2)` nos dois temas
    expect(CSS_GLOBAL).toMatch(/--color-text-muted:\s*var\(--ink-2\)/);
  });

  const [AVISO_CLARO, AVISO_ESCURO] = claroEscuro("--color-warning");
  const [INK2_CLARO, INK2_ESCURO] = claroEscuro("--ink-2");
  it.each([
    ["falha (claro)", AVISO_CLARO, "claro"],
    ["falha (escuro)", AVISO_ESCURO, "escuro"],
    ["sem novidade (claro)", INK2_CLARO, "claro"],
    ["sem novidade (escuro)", INK2_ESCURO, "escuro"],
  ] as const)("%s", (_nome, cor, tema) => {
    for (const fundo of FUNDOS[tema]) {
      expect(contraste(cor, fundo)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("a função de contraste mede certo (âncoras conhecidas)", () => {
  it("preto × branco = 21:1; cor consigo mesma = 1:1; #767676 × branco ≈ 4,54:1", () => {
    expect(contraste("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contraste("#2a78d6", "#2a78d6")).toBeCloseTo(1, 5);
    expect(contraste("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
  it("as cores antigas do tema claro REPROVARIAM (o teste discrimina)", () => {
    for (const antiga of ["#eb6834", "#1baf7a", "#eda100", "#e87ba4"]) {
      expect(contraste(antiga, PAPER1_CLARO)).toBeLessThan(3);
    }
  });
});

describe("linhas da corrida do Presidente (tokens de partido) — ≥ 3:1 nos dois temas", () => {
  // As linhas usam `textForParty(sigla)` = `var(--party-<sigla>-text)`
  // (`components/painel/SecaoCorrida.tsx`). Lidas do CSS gerado: a 1ª definição
  // é a do tema claro, a 2ª a do bloco `[data-theme="dark"]`.
  const CSS_PARTIDOS = readFileSync(join(RAIZ, "app/tokens-party.css"), "utf8");
  const tokens = (sigla: string): [string, string] => {
    const todas = [
      ...CSS_PARTIDOS.matchAll(new RegExp(`--party-${sigla}-text:\\s*(#[0-9a-fA-F]{6})\\b`, "g")),
    ];
    if (todas.length < 2) throw new Error(`--party-${sigla}-text: esperava claro e escuro`);
    return [todas[0]?.[1] as string, todas[1]?.[1] as string];
  };
  it("a seção usa o token de texto do partido", () => {
    const fonte = readFileSync(join(RAIZ, "components/painel/SecaoCorrida.tsx"), "utf8");
    expect(fonte).toMatch(/tinta:\s*textForParty\(/);
  });
  it.each(["pt", "pl"])("--party-%s-text", (sigla) => {
    const [claro, escuro] = tokens(sigla);
    for (const fundo of FUNDOS.claro) expect(contraste(claro, fundo)).toBeGreaterThanOrEqual(3);
    for (const fundo of FUNDOS.escuro) expect(contraste(escuro, fundo)).toBeGreaterThanOrEqual(3);
  });
});
