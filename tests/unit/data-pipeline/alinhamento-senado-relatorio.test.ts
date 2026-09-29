// Relatório de conferência do alinhamento — `data-pipeline/alinhamento-senado-relatorio.ts`.
//
// A regra do dono (ADR-0059 item 3): ≥ 65 Base · ≤ 35 Oposição · entre →
// Independente · menos de 30 votos disputados → amostra insuficiente. Os casos
// de fronteira estão no limiar, dos dois lados.

import { describe, expect, it } from "vitest";
import {
  AMOSTRA_MINIMA,
  classificarEmExercicio,
  classificarRelacao,
  contarRelacoes,
  LIMIAR_BASE,
  LIMIAR_OPOSICAO,
  porPartidoAtual,
  quantosMudaram,
  resumoDeVotos,
  taxaPorPartidoDaEpoca,
} from "@/data-pipeline/alinhamento-senado-relatorio.ts";

const l = (votosDisputadas: number, taxaDisputadas: number) => ({
  votosDisputadas,
  taxaDisputadas,
});

describe("classificarRelacao — os três limiares", () => {
  it("os limiares são os do dono", () => {
    expect([LIMIAR_BASE, LIMIAR_OPOSICAO, AMOSTRA_MINIMA]).toEqual([65, 35, 30]);
  });

  // MUTAÇÕES ALVO: `>=` → `>` em 65; `<=` → `<` em 35; `<` → `<=` em 30.
  it("65,0 é Base e 64,9 é Independente", () => {
    expect(classificarRelacao(l(40, 65))).toBe("base");
    expect(classificarRelacao(l(40, 64.9))).toBe("independente");
  });

  it("35,0 é Oposição e 35,1 é Independente", () => {
    expect(classificarRelacao(l(40, 35))).toBe("oposicao");
    expect(classificarRelacao(l(40, 35.1))).toBe("independente");
  });

  it("30 votos disputados bastam; 29 não", () => {
    expect(classificarRelacao(l(30, 90))).toBe("base");
    expect(classificarRelacao(l(29, 90))).toBe("insuficiente");
  });

  it("sem linha (nunca votou em disputada) é insuficiente, não 0%", () => {
    expect(classificarRelacao(undefined)).toBe("insuficiente");
  });

  it("a amostra pequena vale mesmo com taxa extrema (0% e 100%)", () => {
    expect(classificarRelacao(l(5, 0))).toBe("insuficiente");
    expect(classificarRelacao(l(5, 100))).toBe("insuficiente");
  });
});

describe("classificarEmExercicio / contagens", () => {
  const atuais = [
    { codigo: 1, partido: "PT" },
    { codigo: 2, partido: "PT" },
    { codigo: 3, partido: "PL" },
    { codigo: 4, partido: null },
  ];
  const linhas = [
    { codigo: 1, votosDisputadas: 35, alinhadasDisputadas: 35, taxaDisputadas: 100 },
    { codigo: 3, votosDisputadas: 35, alinhadasDisputadas: 1, taxaDisputadas: 2.9 },
    { codigo: 2, votosDisputadas: 10, alinhadasDisputadas: 10, taxaDisputadas: 100 },
    // 999 não está em exercício: fora da conta
    { codigo: 999, votosDisputadas: 35, alinhadasDisputadas: 35, taxaDisputadas: 100 },
  ];
  const cls = classificarEmExercicio(atuais, linhas);

  it("cada um dos em exercício ganha uma classe; quem não está em exercício não entra", () => {
    expect(cls.map((s) => [s.codigo, s.relacao])).toEqual([
      [1, "base"],
      [2, "insuficiente"],
      [3, "oposicao"],
      [4, "insuficiente"],
    ]);
    expect(cls[3]?.partido).toBe("(sem partido)");
    expect(contarRelacoes(cls)).toEqual({ base: 1, independente: 0, oposicao: 1, insuficiente: 2 });
  });

  it("por partido atual: maior primeiro", () => {
    expect(porPartidoAtual(cls)).toEqual([
      { partido: "PT", n: 2, base: 1, independente: 0, oposicao: 0, insuficiente: 1 },
      { partido: "(sem partido)", n: 1, base: 0, independente: 0, oposicao: 0, insuficiente: 1 },
      { partido: "PL", n: 1, base: 0, independente: 0, oposicao: 1, insuficiente: 0 },
    ]);
  });

  it("quantos mudaram de classe entre dois cálculos", () => {
    const outro = classificarEmExercicio(atuais, [
      { codigo: 1, votosDisputadas: 35, alinhadasDisputadas: 20, taxaDisputadas: 57.1 },
      ...linhas.slice(1),
    ]);
    expect(quantosMudaram(cls, outro)).toBe(1);
    expect(quantosMudaram(cls, cls)).toBe(0);
  });

  it("resumo dos votos disputados: mín, mediana (par e ímpar), máx", () => {
    expect(resumoDeVotos(cls)).toEqual({ min: 0, mediana: 22.5, max: 35 });
    expect(resumoDeVotos(cls.slice(0, 3))).toEqual({ min: 10, mediana: 35, max: 35 });
    expect(resumoDeVotos([])).toEqual({ min: 0, mediana: 0, max: 0 });
  });
});

describe("taxaPorPartidoDaEpoca — o teste de sanidade PT × PL", () => {
  it("ordena da maior taxa para a menor e ignora partido sem voto", () => {
    const t = taxaPorPartidoDaEpoca([
      { partido: "PL", votosDisputadas: 400, alinhadasDisputadas: 15 },
      { partido: "PT", votosDisputadas: 300, alinhadasDisputadas: 298 },
      { partido: "X", votosDisputadas: 0, alinhadasDisputadas: 0 },
    ]);
    expect(t).toEqual([
      { partido: "PT", votosDisputadas: 300, taxa: 99.3 },
      { partido: "PL", votosDisputadas: 400, taxa: 3.8 },
    ]);
  });
});
