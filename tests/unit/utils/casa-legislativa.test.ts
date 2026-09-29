/**
 * tests/unit/utils/casa-legislativa.test.ts — spec 027 (RF-284, RF-281).
 *
 * O nome de cada casa, conferido UF a UF contra uma lista escrita à mão aqui
 * — não derivada da tabela do código. Um teste que montasse o esperado com a
 * mesma tabela de preposições passaria com a tabela errada (a classe "teste
 * que não discrimina").
 *
 * Mutação aplicada à mão (29/09): trocar a preposição da BA para "do" derruba
 * o caso das 26; trocar o ramo do cargo 8 para devolver a Câmara dos
 * Deputados derruba o do DF.
 */

import { describe, expect, it } from "vitest";

import {
  CARGOS_DEPUTADO,
  hrefDaCasa,
  localDaDisputa,
  nomeDaCasa,
  rotuloCargo,
  slugDoCargo,
  termoDoTerritorio,
  ufsDaCasa,
  ufTemCasa,
} from "@/lib/utils/casa-legislativa";

/** As 26 assembleias, escritas por extenso — a referência independente do código. */
const ASSEMBLEIAS: Record<string, string> = {
  AC: "Assembleia Legislativa do Acre",
  AL: "Assembleia Legislativa de Alagoas",
  AM: "Assembleia Legislativa do Amazonas",
  AP: "Assembleia Legislativa do Amapá",
  BA: "Assembleia Legislativa da Bahia",
  CE: "Assembleia Legislativa do Ceará",
  ES: "Assembleia Legislativa do Espírito Santo",
  GO: "Assembleia Legislativa de Goiás",
  MA: "Assembleia Legislativa do Maranhão",
  MG: "Assembleia Legislativa de Minas Gerais",
  MS: "Assembleia Legislativa de Mato Grosso do Sul",
  MT: "Assembleia Legislativa de Mato Grosso",
  PA: "Assembleia Legislativa do Pará",
  PB: "Assembleia Legislativa da Paraíba",
  PE: "Assembleia Legislativa de Pernambuco",
  PI: "Assembleia Legislativa do Piauí",
  PR: "Assembleia Legislativa do Paraná",
  RJ: "Assembleia Legislativa do Rio de Janeiro",
  RN: "Assembleia Legislativa do Rio Grande do Norte",
  RO: "Assembleia Legislativa de Rondônia",
  RR: "Assembleia Legislativa de Roraima",
  RS: "Assembleia Legislativa do Rio Grande do Sul",
  SC: "Assembleia Legislativa de Santa Catarina",
  SE: "Assembleia Legislativa de Sergipe",
  SP: "Assembleia Legislativa de São Paulo",
  TO: "Assembleia Legislativa do Tocantins",
};

const TODAS_27 = [...Object.keys(ASSEMBLEIAS), "DF"].sort();

describe("RF-284 — nomeDaCasa, as 27 UFs", () => {
  it("cargo 7: as 26 assembleias, cada uma com a preposição certa", () => {
    const obtido = Object.fromEntries(
      Object.keys(ASSEMBLEIAS).map((uf) => [uf, nomeDaCasa(7, uf)] as const),
    );
    expect(obtido).toEqual(ASSEMBLEIAS);
  });

  it("cargo 8: a Câmara Legislativa do Distrito Federal", () => {
    expect(nomeDaCasa(8, "DF")).toBe("Câmara Legislativa do Distrito Federal");
    expect(nomeDaCasa(8, "df")).toBe("Câmara Legislativa do Distrito Federal");
  });

  it("cargo 6: a Câmara dos Deputados nas 27 — a UF só diz de onde vem a bancada", () => {
    for (const uf of TODAS_27) expect(nomeDaCasa(6, uf), uf).toBe("Câmara dos Deputados");
  });

  it("🔴 combinação que não existe LANÇA — nunca um nome plausível", () => {
    // Estadual no DF (não há assembleia), distrital fora do DF, sigla inventada.
    expect(() => nomeDaCasa(7, "DF")).toThrow(/não tem casa/);
    expect(() => nomeDaCasa(8, "SP")).toThrow(/não tem casa/);
    expect(() => nomeDaCasa(6, "XX")).toThrow(/não tem casa/);
    expect(() => nomeDaCasa(7, "XX")).toThrow(/não tem casa/);
  });
});

describe("ufsDaCasa — em que UFs cada cargo tem corrida", () => {
  it("federal: as 27; estadual: as 26 sem o DF; distrital: só o DF", () => {
    expect([...ufsDaCasa(6)].sort()).toEqual(TODAS_27);
    expect(ufsDaCasa(7)).toHaveLength(26);
    expect(ufsDaCasa(7)).not.toContain("DF");
    expect([...ufsDaCasa(7)].sort()).toEqual(Object.keys(ASSEMBLEIAS).sort());
    expect(ufsDaCasa(8)).toEqual(["DF"]);
  });

  it("ufTemCasa normaliza a caixa e recusa sigla com espaço", () => {
    expect(ufTemCasa(6, "sp")).toBe(true);
    expect(ufTemCasa(7, "df")).toBe(false);
    expect(ufTemCasa(8, "df")).toBe(true);
    // Sem `trim`: a mesma string vai para o caminho do Blob.
    expect(ufTemCasa(6, " SP")).toBe(false);
  });
});

describe("rótulo, slug, território", () => {
  it("rotuloCargo e slugDoCargo para os três", () => {
    expect(CARGOS_DEPUTADO.map(rotuloCargo)).toEqual([
      "Deputado Federal",
      "Deputado Estadual",
      "Deputado Distrital",
    ]);
    expect(CARGOS_DEPUTADO.map(slugDoCargo)).toEqual([
      "deputado-federal",
      "deputado-estadual",
      "deputado-distrital",
    ]);
  });

  it("o DF não é estado: 'o Distrito Federal', 'do Distrito Federal'", () => {
    expect(termoDoTerritorio("DF")).toEqual({
      nome: "Distrito Federal",
      este: "o Distrito Federal",
      deste: "do Distrito Federal",
      doTerritorio: "do Distrito Federal",
    });
    for (const uf of Object.keys(ASSEMBLEIAS)) {
      expect(termoDoTerritorio(uf).deste, uf).toBe("deste estado");
    }
  });

  it("localDaDisputa: o federal fala da UF; as assembleias, da casa", () => {
    expect(localDaDisputa(6, "SP")).toBe("em SP");
    expect(localDaDisputa(6, "DF")).toBe("em DF");
    expect(localDaDisputa(7, "SP")).toBe("na Assembleia Legislativa de São Paulo");
    expect(localDaDisputa(8, "DF")).toBe("na Câmara Legislativa do Distrito Federal");
  });

  it("hrefDaCasa: páginas de UF por cargo; a capa do 8 é a das assembleias", () => {
    expect(hrefDaCasa(6)).toBe("/deputado-federal");
    expect(hrefDaCasa(7)).toBe("/deputado-estadual");
    expect(hrefDaCasa(8)).toBe("/deputado-estadual");
    expect(hrefDaCasa(6, "sp")).toBe("/uf/SP/deputado-federal");
    expect(hrefDaCasa(7, "SP")).toBe("/uf/SP/deputado-estadual");
    expect(hrefDaCasa(8, "DF")).toBe("/uf/DF/deputado-distrital");
  });
});
