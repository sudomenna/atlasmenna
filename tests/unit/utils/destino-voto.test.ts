/**
 * tests/unit/utils/destino-voto.test.ts
 *
 * ADR-0053 / RF-213 — o ponto único "esta candidatura compete?" da tela.
 *
 * O caso que mais importa é o do destino AUSENTE: o TSE só publica `dvt`
 * depois da 1ª totalização parcial, e o contrato proíbe "desconhecido ⇒
 * anulado". As três formas "positivas" de escrever o filtro
 * (`=== "valido"`, `=== "valido" || === "sub_judice"`, `in` sobre um conjunto
 * de válidos) passam em todo caso com destino preenchido e só morrem aqui.
 */

import { describe, expect, it } from "vitest";

import {
  anuladasAoFim,
  compete,
  etiquetaDestino,
  haAnulada,
  NOTA_ANULADAS,
  queCompetem,
  sufixoAriaDestino,
} from "@/lib/utils/destino-voto";

describe("compete", () => {
  it("🔴 destino ausente COMPETE — nunca supor anulado [mutação: `destino === 'valido'`]", () => {
    expect(compete({})).toBe(true);
    expect(compete({ destino: undefined })).toBe(true);
    expect(compete(undefined)).toBe(true);
  });

  it("sub judice COMPETE (segue o TSE) [mutação: filtrar também 'sub_judice']", () => {
    expect(compete({ destino: "sub_judice" })).toBe(true);
  });

  it("válido compete; anulado NÃO compete", () => {
    expect(compete({ destino: "valido" })).toBe(true);
    expect(compete({ destino: "anulado" })).toBe(false);
  });
});

describe("anuladasAoFim", () => {
  it("partição ESTÁVEL: competem na ordem recebida, depois as anuladas na ordem recebida", () => {
    const lista = [
      { id: 1, destino: "anulado" as const },
      { id: 2 },
      { id: 3, destino: "sub_judice" as const },
      { id: 4, destino: "anulado" as const },
      { id: 5, destino: "valido" as const },
    ];
    expect(anuladasAoFim(lista).map((c) => c.id)).toEqual([2, 3, 5, 1, 4]);
  });

  it("sem anulada devolve a MESMA ordem (cópia nova, sem mutar a entrada)", () => {
    const lista = [{ id: 3 }, { id: 1 }, { id: 2, destino: "sub_judice" as const }];
    const saida = anuladasAoFim(lista);
    expect(saida.map((c) => c.id)).toEqual([3, 1, 2]);
    expect(saida).not.toBe(lista);
  });
});

describe("queCompetem / haAnulada", () => {
  it("queCompetem tira só a anulada", () => {
    const lista = [
      { id: 1, destino: "anulado" as const },
      { id: 2 },
      { id: 3, destino: "sub_judice" as const },
    ];
    expect(queCompetem(lista).map((c) => c.id)).toEqual([2, 3]);
  });

  it("haAnulada: só `anulado` liga a nota — sub judice e ausente não", () => {
    expect(haAnulada([{ destino: "anulado" }])).toBe(true);
    expect(haAnulada([{ destino: "sub_judice" }, {}])).toBe(false);
    expect(haAnulada(undefined)).toBe(false);
    expect(haAnulada([])).toBe(false);
  });
});

describe("texto", () => {
  it("etiqueta só para anulado e sub judice", () => {
    expect(etiquetaDestino("anulado")).toBe("Anulado");
    expect(etiquetaDestino("sub_judice")).toBe("Sub judice");
    expect(etiquetaDestino("valido")).toBeNull();
    expect(etiquetaDestino(undefined)).toBeNull();
  });

  it("sufixo do nome acessível", () => {
    expect(sufixoAriaDestino("anulado")).toBe(", Anulado");
    expect(sufixoAriaDestino("sub_judice")).toBe(", Sub judice");
    expect(sufixoAriaDestino(undefined)).toBe("");
  });

  it("a nota da metodologia não carrega jargão", () => {
    for (const termo of ["vvc", "dvt", "destinação", "votáveis"]) {
      expect(NOTA_ANULADAS.toLowerCase()).not.toContain(termo);
    }
    expect(NOTA_ANULADAS).toContain("fim da lista");
    expect(NOTA_ANULADAS).toContain("não contam para definir quem lidera");
  });
});
