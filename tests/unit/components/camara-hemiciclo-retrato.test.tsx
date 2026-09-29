// @vitest-environment happy-dom
/**
 * tests/unit/components/camara-hemiciclo-retrato.test.tsx — spec 023, design § D5.
 *
 * 🔴 A extração de `<Hemiciclo>` não pode mudar um byte do plenário da Câmara.
 *
 * O retrato (`tests/fixtures/hemiciclo/camara-retrato.json`) foi gerado com o
 * `<CamaraHemiciclo>` de `a791e6d`, ANTES de qualquer linha da extração, sobre
 * os casos de `tests/fixtures/hemiciclo/casos-camara.ts`. Este teste renderiza
 * os mesmos casos com o código de hoje e exige string idêntica.
 *
 * Mutações que ele pega (aplicadas à mão, registro no tasks.md da spec 023):
 * reordenar um atributo do `<g>`, mudar a fração do contorno, partir o
 * `<title>` em dois nós de texto, mexer na legenda.
 *
 * ⚠️ NÃO regenere o JSON a partir do código novo: aí ele passa a retratar a
 * extração, e este teste deixa de provar qualquer coisa. Se a Câmara PRECISAR
 * mudar de propósito, o retrato muda no mesmo PR, com a razão no commit.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CamaraHemiciclo } from "@/components/blocks/CamaraHemiciclo";
import retrato from "@/tests/fixtures/hemiciclo/camara-retrato.json" with { type: "json" };
import { casosRetratoCamara } from "@/tests/fixtures/hemiciclo/casos-camara";

const esperado = retrato as Record<string, string>;
const casos = casosRetratoCamara();

describe("CamaraHemiciclo — saída byte a byte igual à de antes da extração", () => {
  it("o retrato e os casos cobrem exatamente os mesmos nomes", () => {
    expect(Object.keys(casos).sort()).toEqual(Object.keys(esperado).sort());
    expect(Object.keys(casos).length).toBeGreaterThanOrEqual(10);
  });

  for (const [nome, props] of Object.entries(casos)) {
    it(`caso "${nome}"`, () => {
      expect(renderToStaticMarkup(<CamaraHemiciclo {...props} />)).toBe(esperado[nome]);
    });
  }

  it("o retrato não é vazio onde há cadeira (anti-engano: comparar vazio com vazio)", () => {
    expect((esperado.simulado ?? "").match(/<circle/g)).toHaveLength(513);
    expect((esperado.tres_estados_com_moldura ?? "").match(/<circle/g)).toHaveLength(120);
    expect(esperado.sem_cadeira).toBe("");
  });
});
