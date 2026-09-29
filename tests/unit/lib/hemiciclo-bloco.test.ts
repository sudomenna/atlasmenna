/**
 * tests/unit/lib/hemiciclo-bloco.test.ts — a geometria da visão por bloco
 * (spec 025, RF-240/241; ADR-0061 item 4): limiares do TOTAL, a varredura com
 * desempate tolerante e a marca entre a cadeira k−1 e a k.
 */

import { describe, expect, it } from "vitest";

import { ARCOS_CAMARA, ARCOS_SENADO, layoutHemiciclo, marcaDeLimiar } from "@/lib/utils/hemiciclo";
import { layoutPorBloco, limiaresDaCasa, marcaDoBloco } from "@/lib/utils/hemiciclo-bloco";

describe("limiaresDaCasa — do total, nunca literal", () => {
  it("Senado de 81: 41 (maioria absoluta), 49 (três quintos), 54 (dois terços)", () => {
    expect(limiaresDaCasa(81).map((l) => [l.id, l.k])).toEqual([
      ["maioria_absoluta", 41],
      ["tres_quintos", 49],
      ["dois_tercos", 54],
    ]);
  });

  it("Câmara de 513: 257, 308, 342", () => {
    expect(limiaresDaCasa(513).map((l) => l.k)).toEqual([257, 308, 342]);
  });

  it("casa degenerada não tem limiar", () => {
    expect(limiaresDaCasa(2)).toEqual([]);
    expect(limiaresDaCasa(Number.NaN)).toEqual([]);
  });
});

describe("layoutPorBloco — mesma geometria, desempate tolerante", () => {
  for (const [n, arcos] of [
    [81, ARCOS_SENADO],
    [513, ARCOS_CAMARA],
  ] as const) {
    it(`${n} cadeiras: os MESMOS pontos do layout por partido, só em outra ordem`, () => {
      const base = layoutHemiciclo(n, { arcos });
      const bloco = layoutPorBloco(n, arcos);
      expect(bloco.total).toBe(n);
      expect(bloco.assentos.map((a) => a.i)).toEqual([...Array(n).keys()]);
      const pontos = (l: typeof base) => l.assentos.map((a) => `${a.cx},${a.cy}`).sort();
      expect(pontos(bloco)).toEqual(pontos(base));
    });
  }

  it("na coluna central, arco interno primeiro (o que o layout por partido promete e o bit não cumpre)", () => {
    const l = layoutPorBloco(513, ARCOS_CAMARA);
    const centro = l.assentos.filter((a) => Math.abs(a.theta - Math.PI / 2) < 1e-9);
    const arcos = centro.map((a) => a.arco);
    expect(arcos).toEqual([...arcos].sort((a, b) => a - b));
    // O layout por partido percorre 7, 0, 2, 3, 9, 11, 5 (design 023 § D7).
    const base = layoutHemiciclo(513, { arcos: ARCOS_CAMARA }).assentos.filter(
      (a) => Math.abs(a.theta - Math.PI / 2) < 1e-9,
    );
    expect(base.map((a) => a.arco)).toEqual([7, 0, 2, 3, 9, 11, 5]);
  });
});

describe("marcaDoBloco — entre a cadeira k−1 e a k", () => {
  it("🔴 49 no Senado: o ângulo é a média do θ das cadeiras 48 e 49 (índices), sem empate", () => {
    const l = layoutPorBloco(81, ARCOS_SENADO);
    const m = marcaDoBloco(l, { id: "tres_quintos", k: 49 });
    expect(m?.empate).toBe(false);
    const a = l.assentos[48]?.theta as number;
    const b = l.assentos[49]?.theta as number;
    expect(m?.theta).toBeCloseTo((a + b) / 2, 12);
    // k e não k−1: a marca separa EXATAMENTE 49 cadeiras à esquerda (θ maior).
    const antes = l.assentos.filter((x) => x.theta > (m?.theta as number)).length;
    expect(antes).toBe(49);
  });

  it("🔴 41 no Senado cai DENTRO da coluna central: empate, antes = arcos de dentro, corte entre os arcos", () => {
    const l = layoutPorBloco(81, ARCOS_SENADO);
    const m = marcaDoBloco(l, { id: "maioria_absoluta", k: 41 });
    expect(m).not.toBeNull();
    expect(m?.empate).toBe(true);
    expect(m?.arcosAntes).toEqual([1, 3]);
    expect(m?.arcosDepois).toEqual([4]);
    expect(m?.theta).toBeCloseTo(Math.PI / 2, 12);
    const r3 = l.raios[3] as number;
    const r4 = l.raios[4] as number;
    expect(m?.raioCorte).toBeCloseTo((r3 + r4) / 2, 9);
    expect([m?.colunaAntes, m?.colunaDepois]).toEqual([2, 1]);
  });

  it("257 na Câmara: com a varredura por bloco, antes = 0, 2, 3, 5 (dentro), depois = 7, 9, 11", () => {
    const l = layoutPorBloco(513, ARCOS_CAMARA);
    const m = marcaDoBloco(l, { id: "maioria_absoluta", k: 257 });
    expect(m?.empate).toBe(true);
    expect(m?.arcosAntes).toEqual([0, 2, 3, 5]);
    expect(m?.arcosDepois).toEqual([7, 9, 11]);
    expect(Math.max(...(m?.arcosAntes ?? []))).toBeLessThan(Math.min(...(m?.arcosDepois ?? [])));
  });

  it("com o layout por PARTIDO a coluna da maioria da Câmara não separa por raio ⇒ sem marca", () => {
    // Defesa: um layout de outra origem não ganha traço cortando no lugar errado.
    const base = layoutHemiciclo(513, { arcos: ARCOS_CAMARA });
    expect(marcaDeLimiar(base, 257)?.empate).toBe(true);
    expect(marcaDoBloco(base, { id: "maioria_absoluta", k: 257 })).toBeNull();
  });
});
