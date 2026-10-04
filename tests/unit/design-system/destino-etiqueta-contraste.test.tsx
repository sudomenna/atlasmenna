// @vitest-environment happy-dom
/**
 * tests/unit/design-system/destino-etiqueta-contraste.test.tsx
 *
 * ADR-0053 / RF-213 — contraste da etiqueta "Anulado" / "Sub judice"
 * (`components/atoms/data/DestinoEtiqueta.tsx`) nos DOIS temas, sobre as três
 * superfícies em que ela aparece: cartão (`--paper-0`: balão do mapa, ficha,
 * painel), página (`--paper-1`) e fundo afundado (`--paper-2`: recap do 1º
 * turno, `--color-bg-muted`).
 *
 * O teste lê a tinta que o COMPONENTE emite (não uma constante copiada) e
 * resolve o token até o hex de `app/globals.css`, tema a tema. Se alguém trocar
 * a tinta por `--text-muted` ou `--text-faint`, o número é recalculado aqui.
 *
 * Pisos: texto 4,5:1 (constituição § 4 / RNF-022; a etiqueta é texto de 10 px,
 * não "texto grande"). A borda é moldura, não carrega a informação — mesmo
 * assim é medida contra 3:1 (WCAG SC 1.4.11), porque é ela que desenha a caixa.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DestinoEtiqueta } from "@/components/atoms/data/DestinoEtiqueta";
import { HoverCard } from "@/components/atoms/overlays/HoverCard";

const GLOBALS_CSS = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const GLOBALS_ESCURO = GLOBALS_CSS.split(':root[data-theme="dark"] {')[1] ?? "";

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function primitivo(escopo: string, nome: string): string {
  const m = new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`).exec(escopo);
  if (!m?.[1]) throw new Error(`primitivo --${nome} não encontrado`);
  return m[1].toLowerCase();
}

/** `--text-primary` → `ink-0` (semântico declarado uma vez, em `var()`). */
function primitivoDoSemantico(semantico: string): string {
  const m = new RegExp(`--${semantico}:\\s*var\\(--([a-z0-9-]+)\\)`).exec(GLOBALS_CSS);
  if (!m?.[1]) throw new Error(`--${semantico} não aponta para um primitivo`);
  return m[1];
}

const TEMAS = [
  { id: "claro", escopo: GLOBALS_CSS },
  { id: "escuro", escopo: GLOBALS_ESCURO },
] as const;

const SUPERFICIES = ["paper-0", "paper-1", "paper-2"] as const;

function estiloEmitido(): { cor: string; borda: string } {
  const html = renderToStaticMarkup(<DestinoEtiqueta destino="anulado" />);
  const estilo = /style="([^"]+)"/.exec(html)?.[1] ?? "";
  const cor = /(?:^|;)color:\s*var\(--([a-z-]+)\)/.exec(estilo)?.[1];
  const borda = /border:\s*1px solid var\(--([a-z-]+)\)/.exec(estilo)?.[1];
  if (!cor || !borda) throw new Error(`estilo sem cor/borda: ${estilo}`);
  return { cor, borda };
}

describe("<DestinoEtiqueta /> — contraste medido nos dois temas", () => {
  it("é texto visível e só existe para anulado / sub judice", () => {
    expect(renderToStaticMarkup(<DestinoEtiqueta destino="anulado" />)).toContain("Anulado");
    expect(renderToStaticMarkup(<DestinoEtiqueta destino="sub_judice" />)).toContain("Sub judice");
    expect(renderToStaticMarkup(<DestinoEtiqueta destino="valido" />)).toBe("");
    expect(renderToStaticMarkup(<DestinoEtiqueta destino={undefined} />)).toBe("");
  });

  for (const tema of TEMAS) {
    for (const sup of SUPERFICIES) {
      it(`tema ${tema.id}, sobre --${sup}: texto ≥ 4,5:1 e borda ≥ 3:1`, () => {
        const { cor, borda } = estiloEmitido();
        const fundo = primitivo(tema.escopo, sup);
        const tinta = primitivo(tema.escopo, primitivoDoSemantico(cor));
        const moldura = primitivo(tema.escopo, primitivoDoSemantico(borda));
        expect(contraste(tinta, fundo)).toBeGreaterThanOrEqual(4.5);
        expect(contraste(moldura, fundo)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

// ===========================================================================
// 2026-10-04 (auditoria de a11y, SÉRIA) — a etiqueta SOBRE a faixa do eleito
// ===========================================================================
//
// A faixa do matematicamente eleito (balão do mapa, gaveta do estado, gaveta
// do município) pinta o fundo com `--party-<sigla>-chip` e a tinta com
// `--party-<sigla>-ink` (`partyChipInk`). "Sub judice" compete e pode estar em
// `eleitos_definidos` — e a etiqueta, com `--text-primary`/`--border-strong`
// fixos, reprovava em 20/29 partidos no claro e 28/29 no escuro. Com
// `sobreFaixa` ela herda a tinta da faixa (`color: inherit`) e a moldura
// acompanha (`border-color: currentColor`).
//
// O teste lê o estilo EMITIDO e resolve a tinta efetiva: `inherit` ⇒ a tinta
// do par do partido; um `var(--x)` ⇒ o primitivo daquele tema. Mutação: o
// componente ignorar `sobreFaixa` (sempre `ESTILO`) ⇒ a tinta volta a ser
// `--text-primary` e dezenas de pares caem abaixo de 4,5:1.

const PARTY_CSS = readFileSync(resolve(process.cwd(), "app/tokens-party.css"), "utf8");
const [PARTY_CLARO = "", PARTY_ESCURO = ""] = PARTY_CSS.split(':root[data-theme="dark"] {');

/** `slug` → { chip, ink } de um bloco de tema de `tokens-party.css`. */
function paresDoTema(bloco: string): Map<string, { chip: string; ink: string }> {
  const pares = new Map<string, { chip?: string; ink?: string }>();
  for (const m of bloco.matchAll(/--party-([a-z0-9-]+?)-(chip|ink):\s*(#[0-9a-fA-F]{6})/g)) {
    const [, slug, tipo, hex] = m;
    if (!slug || !tipo || !hex) continue;
    const par = pares.get(slug) ?? {};
    par[tipo as "chip" | "ink"] = hex.toLowerCase();
    pares.set(slug, par);
  }
  const completos = new Map<string, { chip: string; ink: string }>();
  for (const [slug, { chip, ink }] of pares) if (chip && ink) completos.set(slug, { chip, ink });
  return completos;
}

function estiloSobreFaixa(): string {
  const html = renderToStaticMarkup(<DestinoEtiqueta destino="sub_judice" sobreFaixa />);
  return /style="([^"]+)"/.exec(html)?.[1] ?? "";
}

/** A cor efetiva de uma propriedade emitida, dado o tema e a tinta herdada. */
function corEfetiva(valor: string, escopoTema: string, herdada: string): string {
  if (valor === "inherit" || valor === "currentColor") return herdada;
  const token = /^var\(--([a-z-]+)\)$/.exec(valor)?.[1];
  if (!token) throw new Error(`cor não reconhecida: ${valor}`);
  return primitivo(escopoTema, primitivoDoSemantico(token));
}

describe("<DestinoEtiqueta sobreFaixa /> — sobre o chip de cada partido, nos dois temas", () => {
  const TEMAS_PARTY = [
    { id: "claro", globais: GLOBALS_CSS, pares: paresDoTema(PARTY_CLARO) },
    { id: "escuro", globais: GLOBALS_ESCURO, pares: paresDoTema(PARTY_ESCURO) },
  ] as const;

  it("o arquivo de tokens tem os pares (o laço abaixo mede de verdade)", () => {
    for (const t of TEMAS_PARTY) expect(t.pares.size, t.id).toBeGreaterThanOrEqual(29);
  });

  it("sem a prop, o estilo de sempre (cartão/página/fundo afundado)", () => {
    const html = renderToStaticMarkup(<DestinoEtiqueta destino="sub_judice" />);
    expect(html).toContain("color:var(--text-primary)");
  });

  for (const t of TEMAS_PARTY) {
    it(`tema ${t.id}: texto ≥ 4,5:1 e moldura ≥ 3:1 sobre o chip de TODO partido`, () => {
      const estilo = estiloSobreFaixa();
      const cor = /(?:^|;)color:\s*([^;]+)/.exec(estilo)?.[1]?.trim() ?? "";
      const borda =
        /border-color:\s*([^;]+)/.exec(estilo)?.[1]?.trim() ??
        /border:\s*1px solid ([^;]+)/.exec(estilo)?.[1]?.trim() ??
        "";
      const reprovados: string[] = [];
      for (const [slug, { chip, ink }] of t.pares) {
        const tinta = corEfetiva(cor, t.globais, ink);
        const moldura = corEfetiva(borda, t.globais, tinta);
        const rt = contraste(tinta, chip);
        const rb = contraste(moldura, chip);
        if (rt < 4.5 || rb < 3)
          reprovados.push(`${slug} texto ${rt.toFixed(2)} borda ${rb.toFixed(2)}`);
      }
      expect(reprovados).toEqual([]);
    });
  }
});

describe("<HoverCard> — a etiqueta na linha do eleito herda a tinta da faixa", () => {
  it("linha com `winnerBackground` ⇒ `color: inherit`; linha comum ⇒ `--text-primary` [mutação: tirar `sobreFaixa` do HoverCard]", () => {
    const html = renderToStaticMarkup(
      <HoverCard
        x={0}
        y={0}
        title="SP"
        rows={[
          {
            name: "ELEITA",
            color: "var(--party-pt-text)",
            proj: 55,
            destino: "sub_judice",
            winnerBackground: "var(--party-pt-chip)",
            winnerInk: "var(--party-pt-ink)",
          },
          { name: "OUTRA", color: "var(--party-pl-text)", proj: 30, destino: "sub_judice" },
        ]}
      />,
    );
    const etiquetas = [...html.matchAll(/data-testid="destino-etiqueta" style="([^"]+)"/g)].map(
      (m) => m[1] ?? "",
    );
    expect(etiquetas).toHaveLength(2);
    expect(etiquetas[0]).toMatch(/color:\s*inherit/);
    expect(etiquetas[1]).toContain("color:var(--text-primary)");
  });
});
