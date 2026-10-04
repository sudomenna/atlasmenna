/**
 * tests/unit/utils/eleitos-definidos.test.ts
 *
 * 2026-10-04 (dono, dia do 1º turno) — `definicaoDaUf` é o ponto único de
 * "quem está MATEMATICAMENTE eleito nesta UF" e do texto do cabeçalho do balão
 * do mapa nacional e da gaveta do celular. A fonte é só `eleitos_definidos` /
 * `segundo_turno_definido`, emitidos pelo produtor; `chamada` (leitura da
 * projeção) não decide nada aqui.
 */

import { describe, expect, it } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";
import {
  ATRIBUICAO_OFICIAL,
  ATRIBUICAO_SENADO,
  atribuicaoDaDefinicao,
  comEscopo,
  definicaoDaUf,
  ROTULO_ELEITO,
  ROTULO_ELEITOS,
  ROTULO_SEGUNDO_TURNO,
  rotuloComEscopo,
} from "@/lib/utils/eleitos-definidos";

type Linha = Pick<
  EdgeUfRow,
  "top_candidatos" | "eleitos_definidos" | "segundo_turno_definido" | "definicao_oficial"
>;

const TOP: EdgeUfRow["top_candidatos"] = [
  { id: 13, pct: 45 },
  { id: 22, pct: 30 },
  { id: 40, pct: 15 },
];

function linha(over: Partial<Linha> = {}): Linha {
  return { top_candidatos: TOP, ...over };
}

describe("definicaoDaUf", () => {
  it("textos exatos", () => {
    expect(ROTULO_ELEITO).toBe("Matematicamente eleito");
    expect(ROTULO_ELEITOS).toBe("Matematicamente eleitos");
    expect(ROTULO_SEGUNDO_TURNO).toBe("2º turno definido");
  });

  it("sem campos ⇒ ninguém e nenhum rótulo (nunca cai em `chamada`)", () => {
    const d = definicaoDaUf({ ...linha(), chamada: true } as Linha);
    expect(d.eleitos.size).toBe(0);
    expect(d.rotulo).toBeUndefined();
  });

  it("lista vazia ⇒ ninguém", () => {
    const d = definicaoDaUf(linha({ eleitos_definidos: [] }));
    expect(d.eleitos.size).toBe(0);
    expect(d.rotulo).toBeUndefined();
  });

  it("1 id nas linhas ⇒ singular", () => {
    const d = definicaoDaUf(linha({ eleitos_definidos: [22] }));
    expect([...d.eleitos]).toEqual([22]);
    expect(d.rotulo).toBe("Matematicamente eleito");
  });

  it("2 ids nas linhas ⇒ plural", () => {
    const d = definicaoDaUf(linha({ eleitos_definidos: [22, 13] }));
    expect(new Set(d.eleitos)).toEqual(new Set([13, 22]));
    expect(d.rotulo).toBe("Matematicamente eleitos");
  });

  it("id fora das linhas é ignorado — inclusive para o rótulo", () => {
    expect(definicaoDaUf(linha({ eleitos_definidos: [999] }))).toEqual({
      eleitos: new Set(),
      rotulo: undefined,
      oficial: false,
    });
    const d = definicaoDaUf(linha({ eleitos_definidos: [13, 999] }));
    expect([...d.eleitos]).toEqual([13]);
    expect(d.rotulo).toBe("Matematicamente eleito");
  });

  it("anulada nunca é eleita, mesmo listada", () => {
    const d = definicaoDaUf({
      top_candidatos: [
        { id: 9, pct: 50, destino: "anulado" },
        { id: 13, pct: 45 },
      ],
      eleitos_definidos: [9, 13],
    });
    expect([...d.eleitos]).toEqual([13]);
    expect(d.rotulo).toBe("Matematicamente eleito");
  });

  it("sub_judice disputa — pode ser eleita", () => {
    const d = definicaoDaUf({
      top_candidatos: [{ id: 13, pct: 60, destino: "sub_judice" }],
      eleitos_definidos: [13],
    });
    expect([...d.eleitos]).toEqual([13]);
  });

  it("segundo_turno_definido ⇒ '2º turno definido' e ninguém marcado", () => {
    const d = definicaoDaUf(linha({ segundo_turno_definido: true }));
    expect(d.eleitos.size).toBe(0);
    expect(d.rotulo).toBe("2º turno definido");
  });

  it("eleito prevalece sobre segundo_turno_definido", () => {
    const d = definicaoDaUf(linha({ eleitos_definidos: [13], segundo_turno_definido: true }));
    expect([...d.eleitos]).toEqual([13]);
    expect(d.rotulo).toBe("Matematicamente eleito");
  });

  it("payload malformado (não-array) ⇒ ninguém", () => {
    const d = definicaoDaUf(linha({ eleitos_definidos: 13 as unknown as number[] }));
    expect(d.eleitos.size).toBe(0);
    expect(d.rotulo).toBeUndefined();
  });
});

// 2026-10-04 (auditoria constitucional P1/P8) — escopo por superfície e
// atribuição do Senado. As constantes acima não mudam.
describe("rotuloComEscopo / comEscopo / atribuicaoDaDefinicao", () => {
  const eleito = { rotulo: ROTULO_ELEITO };
  const eleitos = { rotulo: ROTULO_ELEITOS };
  const segundo = { rotulo: ROTULO_SEGUNDO_TURNO };

  it("município de Governador/Senado ⇒ 'No estado: …'", () => {
    for (const cargo of ["gov", "sen"] as const) {
      const o = { cargo, superficie: "municipio" } as const;
      expect(rotuloComEscopo(eleito, o)).toBe("No estado: matematicamente eleito");
      expect(rotuloComEscopo(eleitos, o)).toBe("No estado: matematicamente eleitos");
      expect(rotuloComEscopo(segundo, o)).toBe("No estado: 2º turno definido");
    }
  });

  it("Presidente ⇒ 'No país: …' em QUALQUER superfície", () => {
    for (const superficie of ["estado", "municipio"] as const) {
      expect(rotuloComEscopo(eleito, { cargo: "pres", superficie })).toBe(
        "No país: matematicamente eleito",
      );
    }
  });

  it("superfície de um estado (balão, gaveta, cartão) de Gov/Sen ⇒ texto intacto", () => {
    expect(rotuloComEscopo(eleito, { cargo: "gov", superficie: "estado" })).toBe(ROTULO_ELEITO);
    expect(rotuloComEscopo(eleitos, { cargo: "sen", superficie: "estado" })).toBe(ROTULO_ELEITOS);
  });

  it("sem definição ⇒ undefined, nunca texto vazio nem só o prefixo", () => {
    expect(rotuloComEscopo({ rotulo: undefined }, { cargo: "pres", superficie: "municipio" })).toBe(
      undefined,
    );
  });

  it("comEscopo sobre o rótulo de linha", () => {
    expect(comEscopo(ROTULO_ELEITO, { cargo: "sen", superficie: "estado" })).toBe(ROTULO_ELEITO);
    expect(comEscopo(ROTULO_ELEITO, { cargo: "gov", superficie: "municipio" })).toBe(
      "No estado: matematicamente eleito",
    );
  });

  it("atribuição: SÓ Senado e SÓ com alguém eleito", () => {
    const com = { eleitos: new Set([13]), oficial: false };
    const sem = { eleitos: new Set<number>(), oficial: false };
    expect(ATRIBUICAO_SENADO).toBe("Cálculo do AtlasMenna sobre a contagem do TSE");
    expect(atribuicaoDaDefinicao("sen", com)).toBe(ATRIBUICAO_SENADO);
    expect(atribuicaoDaDefinicao("sen", sem)).toBeUndefined();
    expect(atribuicaoDaDefinicao("gov", com)).toBeUndefined();
    expect(atribuicaoDaDefinicao("pres", com)).toBeUndefined();
  });

  // 04/10 (para o 2º turno) — depois da totalização final a marca do Senado é
  // a do TSE, e a tela não pode continuar dizendo que a conta é nossa.
  it("atribuição pela ORIGEM: Senado oficial ⇒ 'Definição oficial do TSE'; Gov/Pres nada", () => {
    expect(ATRIBUICAO_OFICIAL).toBe("Definição oficial do TSE");
    const oficial = { eleitos: new Set([13]), oficial: true };
    expect(atribuicaoDaDefinicao("sen", oficial)).toBe(ATRIBUICAO_OFICIAL);
    expect(atribuicaoDaDefinicao("sen", { eleitos: new Set<number>(), oficial: true })).toBe(
      undefined,
    );
    expect(atribuicaoDaDefinicao("gov", oficial)).toBeUndefined();
    expect(atribuicaoDaDefinicao("pres", oficial)).toBeUndefined();
  });

  it("definicaoDaUf carrega a origem só quando há definição", () => {
    expect(definicaoDaUf(linha({ eleitos_definidos: [13], definicao_oficial: true })).oficial).toBe(
      true,
    );
    expect(definicaoDaUf(linha({ eleitos_definidos: [13] })).oficial).toBe(false);
    expect(
      definicaoDaUf(linha({ segundo_turno_definido: true, definicao_oficial: true })).oficial,
    ).toBe(true);
    // Origem sem definição (id fora das linhas) não sobra.
    expect(
      definicaoDaUf(linha({ eleitos_definidos: [999], definicao_oficial: true })).oficial,
    ).toBe(false);
  });
});
