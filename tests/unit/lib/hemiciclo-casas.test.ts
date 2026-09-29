/**
 * tests/unit/lib/hemiciclo-casas.test.ts — spec 023: a geometria por casa
 * (arcos da Câmara × do Senado) e as marcas de limiar.
 *
 * `tests/unit/lib/hemiciclo.test.ts` (spec 017) continua intocado e verde: ele
 * trava o default. Este arquivo trava o que a spec 023 acrescentou. Cada bloco
 * nomeia a mutação que o derruba; elas foram aplicadas à mão — ver o registro
 * em `docs/specs/023-senado-2027/tasks.md`.
 */

import { describe, expect, it } from "vitest";

import {
  ARCOS_CAMARA,
  ARCOS_PADRAO,
  ARCOS_SENADO,
  arcosPara,
  EPS_ANGULO,
  layoutHemiciclo,
  marcaDeLimiar,
  pontoNoAngulo,
  RAIO_EXTERNO,
} from "@/lib/utils/hemiciclo";

const senado = () => layoutHemiciclo(81, { arcos: ARCOS_SENADO });

describe("hemiciclo por casa — o default é a Câmara, e ela não muda", () => {
  it("ARCOS_PADRAO é o da Câmara (12); o Senado tem 5", () => {
    expect(ARCOS_PADRAO).toBe(ARCOS_CAMARA);
    expect(ARCOS_CAMARA).toBe(12);
    expect(ARCOS_SENADO).toBe(5);
  });

  // 🔴 MUTAÇÃO: trocar o default de `layoutHemiciclo` para `ARCOS_SENADO`, ou
  // ler `opcoes.arcos` antes de normalizar. A Câmara mudaria de forma.
  it("sem opção, o layout é idêntico ao da Câmara pedido explicitamente", () => {
    for (const n of [4, 77, 120, 513, 531]) {
      expect(JSON.stringify(layoutHemiciclo(n)), `n=${n}`).toBe(
        JSON.stringify(layoutHemiciclo(n, { arcos: ARCOS_CAMARA })),
      );
    }
  });

  it("número de arcos inválido cai no default, nunca em zero arcos", () => {
    for (const arcos of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(arcosPara(513, arcos), `arcos=${arcos}`).toBe(ARCOS_CAMARA);
      expect(layoutHemiciclo(513, { arcos }).assentos).toHaveLength(513);
    }
  });

  it("a guarda do extremo pequeno vale por casa: 5 arcos só abaixo de 10 cadeiras encolhem", () => {
    expect(arcosPara(10, ARCOS_SENADO)).toBe(5);
    expect(arcosPara(9, ARCOS_SENADO)).toBe(4);
    expect(arcosPara(81, ARCOS_SENADO)).toBe(5);
  });
});

describe("hemiciclo do Senado — 81 cadeiras em 5 arcos (RF-216)", () => {
  // 🔴 MUTAÇÃO: apagar os maiores restos (floor simples) — saem 80 bolinhas,
  // que é a soma dos "10/13/16/19/22" que o plano de 29/09 escreveu à mão.
  it("81 cadeiras, distribuídas 10/13/16/19/23 (o plano dizia 22 no externo: soma 80)", () => {
    const l = senado();
    expect(l.assentos).toHaveLength(81);
    expect(l.porArco).toEqual([10, 13, 16, 19, 23]);
    expect(l.porArco.reduce((a, b) => a + b, 0)).toBe(81);
    expect([10, 13, 16, 19, 22].reduce((a, b) => a + b, 0)).toBe(80);
  });

  it("as bolinhas saem redondas: o raio vem do menor espaçamento e os dois quase coincidem", () => {
    const l = senado();
    const radial = (RAIO_EXTERNO * (1 - 0.45)) / (ARCOS_SENADO - 1);
    const angularExterno = (Math.PI * RAIO_EXTERNO) / 23;
    expect(radial).toBeCloseTo(13.75, 6);
    expect(angularExterno).toBeCloseTo(13.659, 3);
    expect(l.raioAssento).toBeCloseTo(0.4 * angularExterno, 3);
  });

  it("nenhum assento sai da caixa do viewBox", () => {
    const { assentos, width, height, raioAssento } = senado();
    for (const a of assentos) {
      expect(a.cx - raioAssento).toBeGreaterThanOrEqual(0);
      expect(a.cx + raioAssento).toBeLessThanOrEqual(width);
      expect(a.cy - raioAssento).toBeGreaterThanOrEqual(0);
      expect(a.cy + raioAssento).toBeLessThanOrEqual(height);
    }
  });

  it("determinístico: mesmo pedido ⇒ mesmo layout, campo a campo", () => {
    expect(JSON.stringify(senado())).toBe(JSON.stringify(senado()));
  });

  it("o centro e os raios expostos são os que posicionam as cadeiras", () => {
    const l = senado();
    for (const a of l.assentos) {
      const r = l.raios[a.arco] as number;
      const p = pontoNoAngulo(l, a.theta, r);
      expect(p.x, `cadeira ${a.i}`).toBeCloseTo(a.cx, 2);
      expect(p.y, `cadeira ${a.i}`).toBeCloseTo(a.cy, 2);
    }
  });
});

describe("a coluna central do Senado — onde a leitura atravessa os arcos", () => {
  it("39 cadeiras à esquerda do centro; a coluna central é dos arcos 1, 3 e 4, nessa ordem", () => {
    const { assentos } = senado();
    const esquerda = assentos.filter((a) => a.theta > Math.PI / 2 + EPS_ANGULO);
    expect(esquerda).toHaveLength(39);
    expect(esquerda.every((a) => a.i < 39)).toBe(true);

    const centro = assentos.filter((a) => Math.abs(a.theta - Math.PI / 2) < EPS_ANGULO);
    expect(centro.map((a) => a.i)).toEqual([39, 40, 41]);
    expect(centro.map((a) => a.arco)).toEqual([1, 3, 4]);
  });

  it("⚠️ achado: no centro da Câmara a ordem entre arcos é do último bit do θ, não 'interno primeiro'", () => {
    // Registrado no design 023 § D7. A ordem é determinística (× e ÷ do
    // IEEE-754 são corretamente arredondados), e NÃO foi mudada — mudar
    // mudaria o plenário da Câmara, que tem de sair byte a byte igual. Este
    // caso trava o fato, para que ninguém volte a confiar no comentário.
    const { assentos } = layoutHemiciclo(513);
    const centro = assentos.filter((a) => Math.abs(a.theta - Math.PI / 2) < EPS_ANGULO);
    expect(centro.map((a) => a.arco)).toEqual([7, 0, 2, 3, 9, 11, 5]);
    expect((Math.PI * 6.5) / 13).not.toBe((Math.PI * 9.5) / 19);
  });
});

describe("marcaDeLimiar — a marca entre a cadeira k−1 e a k", () => {
  /**
   * A propriedade que define a marca: sem empate, a linha radial no ângulo
   * dela deixa EXATAMENTE as k primeiras de um lado. Com empate, a separação é
   * exata fora da coluna, e a coluna se parte pelo índice.
   */
  function confereSeparacao(total: number, arcos: number): string[] {
    const l = layoutHemiciclo(total, { arcos });
    const falhas: string[] = [];
    for (let k = 1; k < total; k++) {
      const m = marcaDeLimiar(l, k);
      if (!m) {
        falhas.push(`k=${k}: null`);
        continue;
      }
      for (const a of l.assentos) {
        const naColuna = Math.abs(a.theta - m.theta) < EPS_ANGULO;
        const antes = a.i < k;
        if (m.empate && naColuna) {
          const lado = antes ? m.arcosAntes : m.arcosDepois;
          if (!lado.includes(a.arco)) falhas.push(`k=${k}: cadeira ${a.i} fora do lado certo`);
          continue;
        }
        if (naColuna) falhas.push(`k=${k}: cadeira ${a.i} em cima da marca sem empate`);
        if (antes && !(a.theta > m.theta)) falhas.push(`k=${k}: cadeira ${a.i} devia estar antes`);
        if (!antes && !(a.theta < m.theta))
          falhas.push(`k=${k}: cadeira ${a.i} devia estar depois`);
      }
    }
    return falhas;
  }

  // 🔴 MUTAÇÃO: trocar `assentos[k - 1]`/`assentos[k]` por `assentos[k]`/
  // `assentos[k + 1]` — a marca passa a deixar k+1 cadeiras antes dela, e a
  // propriedade quebra em praticamente todo k.
  it("no Senado, para todo k de 1 a 80, a marca separa exatamente as k primeiras", () => {
    expect(confereSeparacao(81, ARCOS_SENADO)).toEqual([]);
  });

  it("na Câmara, para todo k de 1 a 512, idem", () => {
    expect(confereSeparacao(513, ARCOS_CAMARA)).toEqual([]);
  });

  it("🔴 a marca de maioria do Senado (41) cai NA coluna central: empate, arcos 1 e 3 antes, 4 depois", () => {
    const m = marcaDeLimiar(senado(), 41);
    expect(m).toEqual({
      k: 41,
      theta: expect.closeTo(Math.PI / 2, 9),
      empate: true,
      arcosAntes: [1, 3],
      arcosDepois: [4],
    });
  });

  it("40 também cai na coluna (1 antes; 3 e 4 depois); 39 e 42 não", () => {
    const l = senado();
    expect(marcaDeLimiar(l, 40)).toMatchObject({
      empate: true,
      arcosAntes: [1],
      arcosDepois: [3, 4],
    });
    expect(marcaDeLimiar(l, 39)?.empate).toBe(false);
    expect(marcaDeLimiar(l, 42)?.empate).toBe(false);
  });

  it("49 e 54 (as outras marcas do Senado) não têm empate", () => {
    const l = senado();
    for (const k of [49, 54]) {
      const m = marcaDeLimiar(l, k);
      expect(m?.empate, `k=${k}`).toBe(false);
      expect(m?.arcosAntes).toEqual([]);
      expect(m?.arcosDepois).toEqual([]);
    }
  });

  it("a maioria da Câmara (257) também é empate na coluna central — dado para a spec 025", () => {
    const m = marcaDeLimiar(layoutHemiciclo(513), 257);
    expect(m?.empate).toBe(true);
    expect(m?.arcosAntes).toEqual([7, 0, 2, 3]);
    expect(m?.arcosDepois).toEqual([9, 11, 5]);
  });

  it("sem cadeira dos dois lados, não há marca", () => {
    const l = senado();
    for (const k of [0, -1, 81, 82, 1.5, Number.NaN]) {
      expect(marcaDeLimiar(l, k), `k=${k}`).toBeNull();
    }
    expect(marcaDeLimiar(layoutHemiciclo(0), 1)).toBeNull();
  });

  it("pontoNoAngulo fora do arco externo: θ = π/2 fica exatamente acima do centro", () => {
    const l = senado();
    const p = pontoNoAngulo(l, Math.PI / 2, RAIO_EXTERNO + 8);
    expect(p.x).toBeCloseTo(l.centro.cx, 3);
    expect(p.y).toBeCloseTo(l.centro.cy - (RAIO_EXTERNO + 8), 3);
  });
});
