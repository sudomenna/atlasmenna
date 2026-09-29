// Leitura das respostas do Senado — `data-pipeline/senado-parse.ts`.
//
// As fixtures em `tests/fixtures/senado/` têm o formato REAL da API (XML→JSON:
// campo repetido é lista quando há vários e objeto solto quando há um) e valores
// SINTÉTICOS — nenhum nome ou data de pessoa real.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cadeiraDoFim,
  parseAfastados,
  parseDetalhe,
  parseListaAtual,
  parseListaLegislatura,
  parseOrientacoes,
  parseVotacoes,
} from "@/data-pipeline/senado-parse.ts";

const lerFixture = (nome: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/senado", nome), "utf8"));

describe("parseVotacoes", () => {
  const votacoes = parseVotacoes(lerFixture("votacoes-janela.json"));

  it("lê as 11 votações da janela", () => {
    expect(votacoes).toHaveLength(11);
    expect(votacoes[0]).toMatchObject({
      sequencialVotacao: 1001,
      dataSessao: "2025-03-11",
      casaSessao: "SF",
      votacaoSecreta: "N",
    });
  });

  it("sequencialVotacao nulo passa como nulo (é o caso das votações sem chave de junção)", () => {
    expect(votacoes.find((v) => v.dataSessao === "2025-04-05")?.sequencialVotacao).toBeNull();
  });

  // O Zod descarta o que não foi declarado: nenhum nome de senador chega à memória.
  it("descarta nome e demais campos que o pipeline não consome", () => {
    const voto = votacoes[0]?.votos[0] as Record<string, unknown>;
    expect(Object.keys(voto).sort()).toEqual([
      "codigoParlamentar",
      "siglaPartidoParlamentar",
      "siglaVotoParlamentar",
    ]);
    expect(JSON.stringify(votacoes)).not.toContain("Alfa");
  });

  it("formato fora do esperado lança com o caminho do campo, sem despejar o payload", () => {
    const ruim = [{ dataSessao: "11/03/2025", votacaoSecreta: "N", votos: [] }];
    expect(() => parseVotacoes(ruim)).toThrow(/votações fora do formato esperado.*dataSessao/);
    expect(() => parseVotacoes({ votacoes: [] })).toThrow(/fora do formato esperado/);
    expect(() => parseVotacoes([{ dataSessao: "2025-03-11", votacaoSecreta: "X" }])).toThrow(
      /votacaoSecreta/,
    );
  });
});

describe("parseOrientacoes", () => {
  it("lê as orientações por sequencial", () => {
    const o = parseOrientacoes(lerFixture("orientacoes-janela.json"));
    expect(o).toHaveLength(10);
    expect(o[0]?.sequencialVotacao).toBe(1001);
    expect(o[0]?.orientacoesLideranca.find((x) => x.partido === "Governo")?.voto).toBe("SIM");
  });

  it("janela sem votações: lista vazia ou objeto sem `votacoes` valem como zero votações", () => {
    expect(parseOrientacoes([])).toEqual([]);
    expect(parseOrientacoes({})).toEqual([]);
    expect(parseOrientacoes({ votacoes: null })).toEqual([]);
  });

  it("resposta de erro (objeto sem o formato) não passa por lista vazia", () => {
    expect(() => parseOrientacoes({ votacoes: "x" })).toThrow(/fora do formato esperado/);
  });
});

describe("parseListaAtual / parseAfastados / parseListaLegislatura", () => {
  it("lista atual: 3 em exercício, com o fim do mandato da cadeira", () => {
    const l = parseListaAtual(lerFixture("lista-atual.json"));
    expect(l.map((p) => [p.codigo, p.mandatos[0]?.fim, p.mandatos[0]?.participacao])).toEqual([
      [9101, "2027-01-31", "Titular"],
      [9102, "2027-01-31", "1º Suplente"],
      [9103, "2031-01-31", "Titular"],
    ]);
    expect(l[0]?.partido).toBe("PT");
  });

  it("afastados: titular e suplente, cada um com o mandato", () => {
    const a = parseAfastados(lerFixture("afastados.json"));
    expect(a.map((p) => [p.codigo, p.mandatos[0]?.participacao, p.mandatos[0]?.fim])).toEqual([
      [9104, "Titular", "2027-01-31"],
      [9105, "1º Suplente", "2027-01-31"],
      [9106, "Titular", "2031-01-31"],
    ]);
  });

  it("afastados vazio (nenhum afastado) é lista vazia", () => {
    expect(parseAfastados({ AfastamentoAtual: { Parlamentares: null } })).toEqual([]);
    expect(parseAfastados({ AfastamentoAtual: {} })).toEqual([]);
  });

  it("legislatura: `Mandato` solto (objeto) e em lista valem igual", () => {
    const l = parseListaLegislatura(lerFixture("legislatura.json"));
    const porCodigo = new Map(l.map((p) => [p.codigo, p]));
    expect(porCodigo.get(9101)?.mandatos).toHaveLength(1);
    expect(porCodigo.get(9107)?.mandatos).toHaveLength(1); // objeto solto
    expect(porCodigo.get(9108)?.mandatos).toHaveLength(2); // lista
    expect(porCodigo.get(9107)?.mandatos[0]?.fim).toBe("2019-01-31");
  });

  it("nome civil vazio vira nulo", () => {
    const l = parseListaLegislatura({
      ListaParlamentarLegislatura: {
        Parlamentares: {
          Parlamentar: {
            IdentificacaoParlamentar: {
              CodigoParlamentar: "1",
              NomeParlamentar: "X",
              NomeCompletoParlamentar: "  ",
            },
            Mandatos: null,
          },
        },
      },
    });
    expect(l).toHaveLength(1);
    expect(l[0]?.nomeCivil).toBeNull();
    expect(l[0]?.mandatos).toEqual([]);
  });
});

describe("parseDetalhe", () => {
  const detalhes = lerFixture("detalhes.json") as Record<string, unknown>;

  it("nome civil e nascimento", () => {
    expect(parseDetalhe(detalhes["9101"])).toEqual({
      codigo: 9101,
      nomeParlamentar: "Ana Alfa",
      nomeCivil: "Ana Alfa Souza",
      nascimento: "1961-03-14",
    });
  });

  it("sem data de nascimento: nulo (não lança)", () => {
    expect(parseDetalhe(detalhes["9109"]).nascimento).toBeNull();
  });

  it("descarta e-mail, endereço e telefone", () => {
    const d = parseDetalhe(detalhes["9101"]) as unknown as Record<string, unknown>;
    expect(Object.keys(d).sort()).toEqual(["codigo", "nascimento", "nomeCivil", "nomeParlamentar"]);
  });

  it("503 do serviço (problem+json) não é um detalhe", () => {
    expect(() =>
      parseDetalhe({
        detail: "Recurso de dados indisponível.",
        status: 503,
        title: "Service Unavailable",
      }),
    ).toThrow(/fora do formato esperado/);
  });
});

describe("cadeiraDoFim", () => {
  it("2027-01-31 é a cadeira em disputa; 2031-01-31, a que continua; o resto é desconhecido", () => {
    expect(cadeiraDoFim("2027-01-31")).toBe("2027");
    expect(cadeiraDoFim("2031-01-31")).toBe("2031");
    expect(cadeiraDoFim("2023-01-31")).toBeNull();
  });
});
