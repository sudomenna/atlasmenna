/**
 * tests/unit/lib/format.test.ts
 *
 * O **ponto único de formatação numérica da UI** (`lib/utils/format.ts`).
 *
 * ## Por que este arquivo nasceu em 2026-09-20
 *
 * Até esta data `lib/utils/format.ts` não tinha teste nenhum — e o buraco
 * cobrou: cinco componentes carregavam a MESMA cópia inline de um formatador
 * de percentual, e as cinco emitiam ponto decimal em vez da vírgula do
 * português. Na lista de municípios de `/uf/SP` o leitor via
 * `"9.322.444 eleitores"` (certo, milhar em pt-BR) ao lado de `"13%"` e
 * `"17.5%"` (errado, decimal em inglês) na MESMA linha.
 *
 * As cinco eram:
 *   - `components/blocks/MunicipioTable.tsx`      (`fmtPct`)
 *   - `components/blocks/MunicipioWaffleGrid.tsx` (`fmtPct`)
 *   - `components/blocks/GovernorCard.tsx`        (`fmtPct`)
 *   - `components/blocks/ForecastTransparency.tsx` (`formatPercent` LOCAL,
 *     que sombreava o de `lib/utils/format` com outro comportamento)
 *   - `components/atoms/tables/CandidateRow.tsx`  (`formatPct`)
 *
 * Todas viraram {@link formatPercentTrim}.
 *
 * ## O que este arquivo protege, e o que ele NÃO protege
 *
 * Protege as três coisas que um "conserto de pontuação" pode quebrar sem que
 * ninguém veja: o **separador**, o **arredondamento** e o **número de casas**.
 * As duas últimas são conteúdo eleitoral — mover uma casa decimal muda o
 * resultado publicado, não o enfeite dele.
 *
 * NÃO protege largura de coluna: isso é
 * `tests/unit/components/MunicipioTable.votos.test.tsx`, que guarda os
 * glifos medidos em Chromium.
 */

import { describe, expect, it } from "vitest";

import {
  formatCI,
  formatPercent,
  formatPercentTrim,
  formatPp,
  formatVotes,
  formatVotesCompact,
} from "@/lib/utils/format";

/* =========================================================================
 * 1. A vírgula — o defeito que o dono relatou
 * ====================================================================== */

describe("formatPercentTrim() — o separador decimal é pt-BR", () => {
  it("(a) 🔴 percentual com decimal sai com VÍRGULA, nunca com ponto", () => {
    // 🔴 MUTAÇÃO 1 do briefing: trocar a vírgula por ponto em qualquer um dos
    // pontos únicos. Estes são exatamente os três números que o dono leu em
    // `/uf/SP` (São Paulo, Guarulhos, Campinas) antes do conserto.
    expect(formatPercentTrim(17.5)).toBe("17,5%");
    expect(formatPercentTrim(29.2)).toBe("29,2%");
    expect(formatPercentTrim(5.4)).toBe("5,4%");
    expect(formatPercentTrim(11.3)).toBe("11,3%");

    // E o `not`, porque um `toContain("17,5%")` sozinho passaria numa string
    // que trouxesse as duas formas.
    expect(formatPercentTrim(17.5)).not.toContain(".");
  });

  it("(b) 🔴 percentual inteiro NÃO ganha decimal espúrio", () => {
    // Esta é a razão de `formatPercentTrim` existir ao lado de
    // `formatPercent`: `"13%"`, não `"13,0%"`. Na coluna "Apurado" da
    // `<MunicipioTable>` são 40px de conteúdo, e o `,0` é enfeite pago em
    // pixel. Mutação que morre aqui: trocar `maximumFractionDigits` por
    // `minimumFractionDigits`.
    expect(formatPercentTrim(13)).toBe("13%");
    expect(formatPercentTrim(100)).toBe("100%");
    expect(formatPercentTrim(8)).toBe("8%");
    // E o contraste com a irmã, que SEMPRE mostra a casa:
    expect(formatPercent(13, 1)).toBe("13,0%");
  });

  it("(c) zero sai como zero — nem '0,0%', nem '—', nem vazio", () => {
    // 0% apurado é um FATO (a seção não começou a contar), e é diferente de
    // "não sabemos". Quem confunde os dois publica ausência como medição.
    expect(formatPercentTrim(0)).toBe("0%");
    expect(formatPercentTrim(-0)).toBe("0%");
    expect(formatPercentTrim(0, 2)).toBe("0%");
  });

  it("(d) NaN e ±Infinity viram '—', nunca 'NaN%'", () => {
    // As cinco cópias inline emitiam literalmente `"NaN%"` na tela. "—" é o
    // vocabulário que o resto do arquivo e do produto usa para "não sabemos".
    expect(formatPercentTrim(Number.NaN)).toBe("—");
    expect(formatPercentTrim(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatPercentTrim(Number.NEGATIVE_INFINITY)).toBe("—");
  });
});

/* =========================================================================
 * 2. O arredondamento — conteúdo eleitoral, não pontuação
 * ====================================================================== */

describe("formatPercentTrim() — o arredondamento e as casas decimais", () => {
  it("(e) 🔴 arredonda para UMA casa por default, half-up", () => {
    // 🔴 MUTAÇÃO 2 do briefing: mudar o número de casas decimais. Com
    // `decimals = 2` o primeiro vira "54,47%" e reprova; com `decimals = 0`
    // vira "54%" e reprova. Prova que o teste protege o NÚMERO, não só a
    // pontuação.
    expect(formatPercentTrim(54.47)).toBe("54,5%");
    expect(formatPercentTrim(54.44)).toBe("54,4%");
    expect(formatPercentTrim(54.45)).toBe("54,5%");
    // O transbordo para o inteiro seguinte não deixa um ",0" para trás.
    expect(formatPercentTrim(99.95)).toBe("100%");
  });

  it("(f) `decimals` muda as casas, e a elisão do zero vale em todas elas", () => {
    expect(formatPercentTrim(17.456, 2)).toBe("17,46%");
    expect(formatPercentTrim(17.5, 2)).toBe("17,5%"); // 17,50 → "17,5"
    expect(formatPercentTrim(13, 2)).toBe("13%"); // 13,00 → "13"
    expect(formatPercentTrim(54.5, 0)).toBe("55%");
    expect(formatPercentTrim(54.4, 0)).toBe("54%");
  });

  it("(g) 🔴 `toFixed().replace(',')` NÃO é equivalente: ele arredonda para baixo", () => {
    // 🔴 O caso que discrimina `Intl` de `toFixed`, e o motivo pelo qual "é só
    // trocar o ponto pela vírgula" não é uma refatoração inócua.
    //
    // `toFixed` opera sobre o DOUBLE, e o double mais próximo de 0,15 é
    // 0,1499999999999999944 — logo `(0.15).toFixed(1) === "0.1"`. Este código
    // arredonda com `Math.round(v * 10) / 10` (0,15 × 10 dá exatamente 1,5) e
    // publica "0,2%".
    //
    // Medido em 2026-09-20 varrendo 0–100 em passos de 0,0001: a divergência
    // ocorre em **400 valores**. Cada um é um percentual de apuração que um
    // `toFixed` publicaria um décimo ABAIXO do verdadeiro.
    expect(formatPercentTrim(0.15)).toBe("0,2%");
    expect((0.15).toFixed(1).replace(".", ",")).toBe("0,1"); // o que NÃO queremos

    expect(formatPercentTrim(0.95)).toBe("1%");
    expect((0.95).toFixed(1).replace(".", ",")).toBe("0,9");

    expect(formatPercentTrim(2.05)).toBe("2,1%");
    expect((2.05).toFixed(1).replace(".", ",")).toBe("2,0");

    expect(formatPercentTrim(1.45)).toBe("1,5%");
    expect((1.45).toFixed(1).replace(".", ",")).toBe("1,4");
  });

  it("(h) 🔴 `Intl` também traz o separador de MILHAR, que o `replace` esquece", () => {
    // O segundo caso que mata a troca por `toFixed().replace()`: ele conhece
    // um separador só. Percentual de eleição não passa de 100, mas a função é
    // genérica e a próxima chamada pode ser com pp acumulado ou contagem.
    expect(formatPercentTrim(1234.5)).toBe("1.234,5%");
    expect((1234.5).toFixed(1).replace(".", ",")).toBe("1234,5"); // sem o ponto de milhar
    expect(formatPercentTrim(10000)).toBe("10.000%");
  });

  it("(i) não clampa em 0–100 — dado fora da faixa aparece, não é maquiado", () => {
    // Diferença deliberada em relação a `formatPercent`, que clampa. As cinco
    // cópias substituídas não clampavam, e um `pct_apurado` de 118 é defeito
    // de ingestão que tem de ficar visível.
    expect(formatPercentTrim(118.3)).toBe("118,3%");
    expect(formatPercentTrim(-4)).toBe("−4%");
  });

  it("(i2) 🔴 o negativo usa U+2212, e NÃO o hífen que o `Intl` entregaria", () => {
    // 🔴 Achado de 2026-09-20, e a razão de o sinal ser prefixado à mão:
    // `Intl.NumberFormat("pt-BR")` escreve negativo com HYPHEN-MINUS (U+002D).
    // O projeto decidiu por MINUS SIGN (U+2212) — é o que `formatPp` emite e o
    // que `tests/unit/components/Figure.test.tsx` trava.
    //
    // Mutação que morre aqui: deixar o `Intl` formatar o valor COM sinal
    // (`rounded.toLocaleString(...)` em vez de `Math.abs(rounded)`). O texto
    // fica visualmente quase igual e o code point muda.
    expect(formatPercentTrim(-4).codePointAt(0)).toBe(0x2212); // MINUS SIGN
    expect(formatPercentTrim(-4)).not.toContain("-"); // HYPHEN-MINUS
    expect((-4).toLocaleString("pt-BR")).toBe("-4"); // o que o Intl faria sozinho

    expect(formatPercentTrim(-12.34)).toBe("−12,3%");
    // `-0` não é negativo: sem sinal, nunca "−0%".
    expect(formatPercentTrim(-0)).toBe("0%");
    expect(formatPercentTrim(-0.04)).toBe("0%");
  });
});

/* =========================================================================
 * 3. O sinal — a decisão registrada é U+2212, não o hífen
 * ====================================================================== */

describe("formatPp() — o sinal explícito", () => {
  it("(j) 🔴 positivo usa '+' ASCII e negativo usa U+2212 (MINUS SIGN)", () => {
    // A decisão vive em `lib/utils/format.ts` (`formatPp`) e estava travada
    // num único teste, em `tests/unit/components/Figure.test.tsx:75`. Está
    // aqui também porque é o ponto único que a emite, e porque um editor que
    // "normalize" o arquivo para ASCII troca o glifo sem que nada reprove.
    expect(formatPp(5.4)).toBe("+5,4 pp");
    expect(formatPp(-4)).toBe("−4,0 pp");

    // Os dois code points, nomeados — a asserção acima sozinha passaria com
    // hífen se alguém colasse um hífen aqui e lá ao mesmo tempo.
    expect(formatPp(-4).codePointAt(0)).toBe(0x2212); // MINUS SIGN
    expect(formatPp(5.4).codePointAt(0)).toBe(0x002b); // PLUS SIGN
    expect(formatPp(-4)).not.toContain("-"); // HYPHEN-MINUS
  });

  it("(k) zero não ganha sinal, e continua com a casa decimal", () => {
    // "0,0 pp" sem sinal é uma medição de empate; "+0,0" ou "−0,0" sugeririam
    // uma direção que o número não tem.
    expect(formatPp(0)).toBe("0,0 pp");
    expect(formatPp(-0)).toBe("0,0 pp");
  });

  it("(l) NaN vira '—' — ausência não é empate", () => {
    expect(formatPp(Number.NaN)).toBe("—");
  });
});

/* =========================================================================
 * 4. As irmãs do ponto único — a mesma locale, o mesmo contrato
 * ====================================================================== */

describe("o resto de lib/utils/format.ts fala pt-BR", () => {
  it("(m) 🔴 milhar com PONTO e decimal com VÍRGULA, na mesma linha da tela", () => {
    // É o par que o dono leu em `/uf/SP`: o milhar já estava certo e o decimal
    // não. Estão juntos aqui de propósito — é a inconsistência dentro de uma
    // mesma linha que denunciava o defeito.
    expect(formatVotes(9_322_444)).toBe("9.322.444");
    expect(formatPercentTrim(13)).toBe("13%");
    expect(formatPercent(54.47, 1)).toBe("54,5%");
    expect(formatCI(52.1, 54.3)).toBe("[52,1; 54,3]");
  });

  it("(n) formatPercent continua clampando e mostrando a casa fixa", () => {
    // Controle: a mudança de 2026-09-20 acrescentou uma função, não mexeu
    // nesta. Sem este controle, uma "unificação" futura das duas passaria
    // despercebida.
    expect(formatPercent(150, 1)).toBe("100,0%");
    expect(formatPercent(-3, 1)).toBe("0,0%");
    expect(formatPercent(53.4, 0)).toBe("53%");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

/* =========================================================================
 * 2026-09-30 (auditoria G6 da spec 026): os formatadores passaram a usar
 * `Intl.NumberFormat` em cache de módulo em vez de `toLocaleString` por valor
 * (~83 ms de hidratação a 4× de CPU em /uf/SP/deputado-federal). A troca só
 * vale se a saída for IDÊNTICA — aqui ela é conferida contra a forma antiga,
 * escrita por extenso, numa varredura com os arredondamentos traiçoeiros
 * (0,15 · 0,35 · 99,95), `-0`, milhar e valores fora da faixa. Na troca, uma
 * varredura de 3,5 milhões de comparações (-20 a 1.200 em passos de 0,007 +
 * 20 mil valores sorteados, 0 a 3 casas) deu zero diferença; esta é a versão
 * que cabe na suíte.
 * ====================================================================== */
describe("formatadores em cache — saída idêntica à de `toLocaleString`", () => {
  const L = "pt-BR";
  const casas = (d: number) => ({ minimumFractionDigits: d, maximumFractionDigits: d });
  const valores: number[] = [0, -0, 0.15, 0.35, 0.85, 99.95, 100, 101, -5, -0.4, 1234.5, 1e9];
  for (let i = -2000; i <= 120000; i += 97) valores.push(i / 100);

  it("formatPercent, formatPercentTrim, formatPp e formatCI, com 0 a 3 casas", () => {
    for (const v of valores) {
      for (const d of [0, 1, 2, 3]) {
        const c = Number(Math.max(0, Math.min(100, v)).toFixed(d));
        expect(formatPercent(v, d)).toBe(
          d === 0 ? `${Math.round(c)}%` : `${c.toLocaleString(L, casas(d))}%`,
        );
        const r = Math.round(v * 10 ** d) / 10 ** d;
        expect(formatPercentTrim(v, d)).toBe(
          `${r < 0 ? "−" : ""}${Math.abs(r).toLocaleString(L, { maximumFractionDigits: d })}%`,
        );
        expect(formatPp(v, d)).toBe(
          `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString(L, casas(d))} pp`,
        );
        expect(formatCI(v, v + 1, d)).toBe(
          `[${v.toLocaleString(L, casas(d))}; ${(v + 1).toLocaleString(L, casas(d))}]`,
        );
      }
    }
  });

  it("formatVotes e formatVotesCompact", () => {
    for (const base of valores) {
      const v = base * 1000;
      expect(formatVotes(v)).toBe(Math.round(v).toLocaleString(L));
      const a = Math.abs(v);
      expect(formatVotesCompact(v)).toBe(
        a >= 1e6
          ? `${(v / 1e6).toLocaleString(L, { maximumFractionDigits: 1 })} mi`
          : a >= 1e3
            ? `${Math.round(v / 1e3).toLocaleString(L)} mil`
            : v.toLocaleString(L),
      );
    }
  });
});
