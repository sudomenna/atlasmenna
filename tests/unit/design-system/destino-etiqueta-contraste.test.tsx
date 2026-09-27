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
