// Trajetória no Senado — `data-pipeline/trajetoria-senado.ts`.
//
// Roda sobre as fixtures de `tests/fixtures/senado/` (formato real da API,
// valores SINTÉTICOS) e sobre linhas de TSE montadas à mão. O universo de
// senadores da fixture:
//
//   9101 Ana Alfa       titular em exercício, cadeira 2027
//   9102 Beto Bravo     1º suplente em exercício, cadeira 2027
//   9103 Carla Charlie  titular em exercício, cadeira 2031
//   9104 Davi Delta     titular AFASTADO, cadeira 2027 (segue dono)
//   9105 Eva Echo       suplente AFASTADA, cadeira 2027 (não ocupa nada), já exerceu
//   9106 Fábio Foxtrot  titular afastado, cadeira 2031
//   9107 Gil Golf       ex-senador (mandato até 2019)
//   9108 Helena Hotel   ex-suplente que exerceu (mandato até 2023)
//   9109 Sem Data       só nos detalhes: o Senado não informa o nascimento

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { construirIndice, type IdentificacaoCandidato } from "@/data-pipeline/casamento-nome.ts";
import {
  type ParlamentarSenado,
  parseAfastados,
  parseDetalhe,
  parseListaAtual,
  parseListaLegislatura,
} from "@/data-pipeline/senado-parse.ts";
import {
  arquivosPorUf,
  type CandidatoSenadoTse,
  calcularTrajetoriaSenado,
  calcularTrajetorias,
  candidatoSenadoDaLinha,
  codigosDoUniverso,
  declaraOcupacaoSenador,
  FONTE_TRAJETORIA_SENADO,
  montarArquivoTrajetoria,
  montarHistorico,
  ocupacaoAtual,
  TRAJETORIAS_SENADO,
} from "@/data-pipeline/trajetoria-senado.ts";

const lerFixture = (nome: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/senado", nome), "utf8"));

const atuais = parseListaAtual(lerFixture("lista-atual.json"));
const afastados = parseAfastados(lerFixture("afastados.json"));
const legislatura = parseListaLegislatura(lerFixture("legislatura.json"));
const detalhes = new Map(
  Object.entries(lerFixture("detalhes.json") as Record<string, unknown>).map(([k, v]) => [
    Number(k),
    parseDetalhe(v),
  ]),
);
const codigos = codigosDoUniverso([atuais, afastados, legislatura]);
const historico = montarHistorico(codigos, detalhes);
const indice = construirIndice(historico.senadores);
const ocupacao = ocupacaoAtual(atuais, afastados);

function id(over: Partial<IdentificacaoCandidato>): IdentificacaoCandidato {
  return { nomeCivil: "FULANO", nomeUrna: "FULANO", nomeSocial: null, nascimento: "", ...over };
}
const calc = (over: Partial<IdentificacaoCandidato>) =>
  calcularTrajetoriaSenado(id(over), indice, ocupacao);

// ---------------------------------------------------------------------------
// Universo e ocupação
// ---------------------------------------------------------------------------

describe("universo de senadores e quem ocupa hoje uma cadeira", () => {
  it("une as listas por código: 9101–9108 (o 9109 só existe nos detalhes)", () => {
    expect(codigos).toEqual([9101, 9102, 9103, 9104, 9105, 9106, 9107, 9108]);
  });

  it("donos hoje: em exercício (titular e suplente) e titular afastado; suplente afastado não", () => {
    expect([...ocupacao.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [9101, "2027"],
      [9102, "2027"],
      [9103, "2031"],
      [9104, "2027"], // titular afastado segue dono da cadeira
      [9106, "2031"],
    ]);
    expect(ocupacao.has(9105)).toBe(false); // suplente afastada
    expect(ocupacao.has(9107)).toBe(false); // ex-senador
  });

  it("em exercício vale mais que afastado se o código estiver nas duas listas", () => {
    const tambemAfastado: ParlamentarSenado = {
      codigo: 9101,
      nomeParlamentar: "Ana Alfa",
      nomeCivil: null,
      partido: null,
      uf: "SP",
      mandatos: [{ uf: "SP", inicio: "2023-02-01", fim: "2031-01-31", participacao: "Titular" }],
    };
    expect(ocupacaoAtual(atuais, [tambemAfastado]).get(9101)).toBe("2027");
  });

  it("fim de mandato que não é 2027 nem 2031 lança (formato novo não some em silêncio)", () => {
    const estranho: ParlamentarSenado = {
      codigo: 1,
      nomeParlamentar: "X",
      nomeCivil: null,
      partido: null,
      uf: "SP",
      mandatos: [{ uf: "SP", inicio: "2023-02-01", fim: "2028-01-31", participacao: "Titular" }],
    };
    expect(() => ocupacaoAtual([estranho], [])).toThrow(/nem 2027 nem 2031/);
  });

  it("montarHistorico: código sem detalhe lança — o senador sumiria do índice", () => {
    expect(() => montarHistorico([9101, 424242], detalhes)).toThrow(/senador 424242 sem detalhe/);
  });

  it("montarHistorico: sem nascimento entra no histórico mas não nos índices, e é contado", () => {
    const h = montarHistorico([9101, 9109], detalhes);
    expect(h.semNascimento).toBe(1);
    const idx = construirIndice(h.senadores);
    expect(idx.semNascimento).toBe(1);
    expect(idx.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Categoria
// ---------------------------------------------------------------------------

describe("calcularTrajetoriaSenado — as três categorias", () => {
  it("titular em exercício de cadeira 2027 → em_exercicio (casamento exato)", () => {
    expect(calc({ nomeCivil: "ANA ALFA SOUZA", nascimento: "1961-03-14" })).toEqual({
      t: "em_exercicio",
      senado_codigos: [9101],
      modo: "exato",
      cadeira2031: false,
    });
  });

  it("suplente EM EXERCÍCIO de cadeira 2027 → em_exercicio", () => {
    expect(calc({ nomeCivil: "ROBERTO BRAVO LIMA", nascimento: "1975-11-02" }).t).toBe(
      "em_exercicio",
    );
  });

  it("titular AFASTADO de cadeira 2027 → em_exercicio (segue dono da cadeira)", () => {
    expect(calc({ nomeCivil: "DAVI DELTA NUNES", nascimento: "1959-01-30" }).t).toBe(
      "em_exercicio",
    );
  });

  // MUTAÇÃO ALVO: a categoria de quem casou com senador cai em `estreante`.
  it("ex-senador (mandato encerrado) → mandato_anterior", () => {
    expect(calc({ nomeCivil: "GILBERTO GOLF MOREIRA", nascimento: "1950-05-17" })).toEqual({
      t: "mandato_anterior",
      senado_codigos: [9107],
      modo: "exato",
      cadeira2031: false,
    });
  });

  it("suplente AFASTADO que já exerceu → mandato_anterior (não ocupa cadeira hoje)", () => {
    expect(calc({ nomeCivil: "EVA ECHO PRADO", nascimento: "1972-09-09" }).t).toBe(
      "mandato_anterior",
    );
  });

  it("ex-suplente que exerceu, casado pela regra aproximada (a) → mandato_anterior", () => {
    // "HELENA HOTEL CUNHA SILVA" × "HELENA HOTEL CUNHA": 3 tokens em comum, limiar max(2, 3−1) = 2.
    expect(
      calc({
        nomeCivil: "HELENA HOTEL CUNHA SILVA",
        nomeUrna: "HELENA HOTEL",
        nascimento: "1966-04-04",
      }),
    ).toEqual({
      t: "mandato_anterior",
      senado_codigos: [9108],
      modo: "aproximado",
      cadeira2031: false,
    });
  });

  it("sem casamento → estreante, com lista de códigos vazia", () => {
    expect(calc({ nomeCivil: "ZELIA ZULU PEREIRA", nascimento: "1985-01-01" })).toEqual({
      t: "estreante",
      senado_codigos: [],
      modo: "nenhum",
      cadeira2031: false,
    });
  });

  it("mesmo nome com nascimento diferente NÃO casa → estreante", () => {
    expect(calc({ nomeCivil: "ANA ALFA SOUZA", nascimento: "1962-03-14" }).t).toBe("estreante");
  });

  it("mesmo nascimento com nome diferente NÃO casa → estreante", () => {
    expect(
      calc({ nomeCivil: "PAULO PAPA QUEBEC", nomeUrna: "PAULO PAPA", nascimento: "1961-03-14" }).t,
    ).toBe("estreante");
  });

  it("candidato sem data de nascimento legível não casa (estreante), mesmo com o nome igual", () => {
    expect(calc({ nomeCivil: "ANA ALFA SOUZA", nascimento: "" }).t).toBe("estreante");
  });

  it("o nome parlamentar do Senado == nome de urna casa (regra c), no mesmo dia", () => {
    // Nome civil sem nenhum token em comum: (a) e (b) falham; só (c) casa.
    const r = calc({
      nomeCivil: "LUCIA MARIA PEREIRA",
      nomeUrna: "Ana Alfa",
      nascimento: "1961-03-14",
    });
    expect(r).toMatchObject({ t: "em_exercicio", senado_codigos: [9101], modo: "aproximado" });
  });

  // Quem tem cadeira de 2031 não deveria concorrer ao Senado em 2026: é anomalia
  // e vem marcada — nem "tenta a reeleição" (a cadeira dele não está em disputa)
  // nem silêncio.
  it("casou com dono de cadeira 2031 → mandato_anterior + marca cadeira2031", () => {
    expect(calc({ nomeCivil: "CARLA CHARLIE ROCHA", nascimento: "1968-07-21" })).toEqual({
      t: "mandato_anterior",
      senado_codigos: [9103],
      modo: "exato",
      cadeira2031: true,
    });
    expect(calc({ nomeCivil: "FABIO FOXTROT DIAS", nascimento: "1980-12-05" }).cadeira2031).toBe(
      true,
    );
  });

  it("as categorias do dado são exatamente três", () => {
    expect([...TRAJETORIAS_SENADO]).toEqual(["em_exercicio", "mandato_anterior", "estreante"]);
  });
});

describe("calcularTrajetoriaSenado — homônimos e precedência", () => {
  // Dois "FULANO DE TAL" nascidos no mesmo dia: o ex-senador (9107) vem primeiro no
  // índice e o dono de cadeira 2027 (9101) depois. MUTAÇÃO ALVO: olhar só o
  // primeiro casado (ou `every`) na hora de decidir `em_exercicio`.
  it("dois casados, só um dono de 2027: em_exercicio, com os dois códigos em ordem crescente", () => {
    const homonimos = [
      {
        codigo: 9107,
        nomeCivil: "FULANO DE TAL",
        nomeParlamentar: "Fulano",
        nascimento: "1970-01-02",
      },
      {
        codigo: 9101,
        nomeCivil: "FULANO DE TAL",
        nomeParlamentar: "Fulano",
        nascimento: "1970-01-02",
      },
    ];
    const r = calcularTrajetoriaSenado(
      id({ nomeCivil: "FULANO DE TAL", nascimento: "1970-01-02" }),
      construirIndice(homonimos),
      ocupacao,
    );
    expect(r).toMatchObject({ t: "em_exercicio", senado_codigos: [9101, 9107], modo: "exato" });
  });
});

// ---------------------------------------------------------------------------
// Leitura do TSE
// ---------------------------------------------------------------------------

describe("candidatoSenadoDaLinha / declaraOcupacaoSenador / arquivosPorUf", () => {
  const COLS = [
    "CD_CARGO",
    "SQ_CANDIDATO",
    "SG_UF",
    "NM_CANDIDATO",
    "NM_URNA_CANDIDATO",
    "NM_SOCIAL_CANDIDATO",
    "DT_NASCIMENTO",
    "DS_OCUPACAO",
  ];
  const H = new Map(COLS.map((c, i) => [c, i]));
  const linha = (o: Partial<Record<(typeof COLS)[number], string>>) =>
    COLS.map(
      (c) =>
        ({
          CD_CARGO: "5",
          SQ_CANDIDATO: "250001",
          SG_UF: "SP",
          NM_CANDIDATO: "ANA ALFA SOUZA",
          NM_URNA_CANDIDATO: "ANA ALFA",
          NM_SOCIAL_CANDIDATO: "#NULO",
          DT_NASCIMENTO: "14/03/1961",
          DS_OCUPACAO: "SENADOR",
          ...o,
        })[c] ?? "",
    );

  it("cargo 5: sqcand como TEXTO, UF, identificação com nascimento ISO e social sem sentinela", () => {
    expect(candidatoSenadoDaLinha(linha({}), H)).toEqual({
      sqcand: "250001",
      uf: "SP",
      identificacao: {
        nomeCivil: "ANA ALFA SOUZA",
        nomeUrna: "ANA ALFA",
        nomeSocial: null,
        nascimento: "1961-03-14",
      },
    });
    expect(
      candidatoSenadoDaLinha(linha({ NM_SOCIAL_CANDIDATO: "ANINHA" }), H)?.identificacao.nomeSocial,
    ).toBe("ANINHA");
  });

  // MUTAÇÃO ALVO: aceitar qualquer cargo (Deputado Federal também tem nascimento).
  it("outro cargo devolve nulo: só o cargo 5 é lido", () => {
    for (const cargo of ["1", "3", "6", "9", "10"]) {
      expect(candidatoSenadoDaLinha(linha({ CD_CARGO: cargo }), H)).toBeNull();
    }
  });

  it("data ilegível vira nascimento vazio (não casa), não erro", () => {
    expect(
      candidatoSenadoDaLinha(linha({ DT_NASCIMENTO: "#NULO#" }), H)?.identificacao.nascimento,
    ).toBe("");
  });

  it("coluna obrigatória ausente lança", () => {
    const semNascimento = new Map(COLS.filter((c) => c !== "DT_NASCIMENTO").map((c, i) => [c, i]));
    expect(() => candidatoSenadoDaLinha(linha({}), semNascimento)).toThrow(/DT_NASCIMENTO/);
  });

  it("DS_OCUPACAO = SENADOR só para a conferência", () => {
    expect(declaraOcupacaoSenador(linha({}), H)).toBe(true);
    expect(declaraOcupacaoSenador(linha({ DS_OCUPACAO: "ADVOGADO" }), H)).toBe(false);
    expect(declaraOcupacaoSenador(linha({ DS_OCUPACAO: " senador " }), H)).toBe(true);
  });

  it("arquivosPorUf: 27 por UF; `_BR` e `_BRASIL` ficam de fora", () => {
    const nomes = [
      "consulta_cand_2026_AC.csv",
      "consulta_cand_2026_SP.csv",
      "consulta_cand_2026_BR.csv",
      "consulta_cand_2026_BRASIL.csv",
      "leiame.pdf",
      "consulta_cand_2026_SP.csv.bak",
    ];
    expect(arquivosPorUf(nomes)).toEqual([
      "consulta_cand_2026_AC.csv",
      "consulta_cand_2026_SP.csv",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Conjunto de candidaturas e arquivo derivado
// ---------------------------------------------------------------------------

function tse(sqcand: string, over: Partial<IdentificacaoCandidato>): CandidatoSenadoTse {
  return { sqcand, uf: "SP", identificacao: id(over) };
}

const CANDIDATOS: CandidatoSenadoTse[] = [
  // Fora de ordem de propósito: a saída ordena por sqcand NUMÉRICO.
  tse("250000000012", { nomeCivil: "ZELIA ZULU PEREIRA", nascimento: "1985-01-01" }),
  tse("90001", { nomeCivil: "ANA ALFA SOUZA", nascimento: "1961-03-14" }),
  tse("250000000003", { nomeCivil: "GILBERTO GOLF MOREIRA", nascimento: "1950-05-17" }),
  tse("90001", { nomeCivil: "REPETIDO", nascimento: "1999-09-09" }), // sqcand repetido: o primeiro vale
  tse("1000000000007", { nomeCivil: "CARLA CHARLIE ROCHA", nascimento: "1968-07-21" }),
];

describe("calcularTrajetorias", () => {
  const calc2 = calcularTrajetorias(CANDIDATOS, indice, ocupacao);

  it("uma entrada por sqcand (o primeiro vale) na ordem NUMÉRICA — 90001 < 2,5e11 < 1e12", () => {
    expect([...calc2.porSqcand.keys()]).toEqual([
      "90001",
      "250000000003",
      "250000000012",
      "1000000000007",
    ]);
    expect(calc2.porSqcand.get("90001")?.t).toBe("em_exercicio");
  });

  it("resumo: categorias, modos, anomalia de 2031", () => {
    expect(calc2.resumo).toEqual({
      total: 4,
      porCategoria: { em_exercicio: 1, mandato_anterior: 2, estreante: 1 },
      porModo: { exato: 3, aproximado: 0, nenhum: 1 },
      comMaisDeUmCasado: [],
      cadeira2031: ["1000000000007"],
    });
  });
});

describe("montarArquivoTrajetoria — formato e lista branca", () => {
  const GERADO = "2026-09-29T15:00:00.000Z";
  const arq = montarArquivoTrajetoria(calcularTrajetorias(CANDIDATOS, indice, ocupacao), GERADO);

  it("tem exatamente as chaves do contrato, na ordem", () => {
    expect(Object.keys(arq)).toEqual(["gerado_em", "fonte", "universo", "por_sqcand"]);
    expect(arq.gerado_em).toBe(GERADO);
    expect(arq.fonte).toEqual(FONTE_TRAJETORIA_SENADO);
  });

  // `universo` é o que permite afirmar "este sqcand não está no arquivo" em vez de
  // inferir "estreante" por ausência.
  it("universo = número de candidaturas do arquivo", () => {
    expect(arq.universo).toBe(4);
    expect(Object.keys(arq.por_sqcand)).toHaveLength(arq.universo);
  });

  it("cada entrada é SÓ { t, senado_codigos }; estreante tem lista vazia (nunca ausente)", () => {
    for (const v of Object.values(arq.por_sqcand)) {
      expect(Object.keys(v)).toEqual(["t", "senado_codigos"]);
      expect(TRAJETORIAS_SENADO).toContain(v.t);
      expect(Array.isArray(v.senado_codigos)).toBe(true);
    }
    expect(arq.por_sqcand["250000000012"]).toEqual({ t: "estreante", senado_codigos: [] });
    expect(arq.por_sqcand["90001"]).toEqual({ t: "em_exercicio", senado_codigos: [9101] });
  });

  it("estreante ⇔ nenhum código", () => {
    for (const v of Object.values(arq.por_sqcand)) {
      expect(v.t === "estreante").toBe(v.senado_codigos.length === 0);
    }
  });

  // Asserção NEGATIVA (a positiva passaria com o nome ao lado): nem nome civil,
  // nem nome parlamentar, nem nascimento — dos candidatos ou dos senadores —, e
  // nem o modo do casamento nem a marca de anomalia.
  it("não carrega nome, nascimento, modo do casamento nem marca de anomalia", () => {
    const s = JSON.stringify(arq);
    const proibidos = [
      // candidatos
      "ZELIA",
      "ZULU",
      "GILBERTO",
      "REPETIDO",
      "1985",
      "1950-05-17",
      "1961-03-14",
      // senadores (civil, parlamentar, nascimento)
      "Alfa",
      "ALFA",
      "Golf",
      "Charlie",
      "Souza",
      "1968-07-21",
      "1966-04-04",
      // campos que não vão a arquivo
      "nome",
      "nascimento",
      "cpf",
      "email",
      "modo",
      "exato",
      "aproximado",
      "cadeira2031",
    ];
    for (const p of proibidos) expect(s, `vazou "${p}"`).not.toContain(p);
    // A única data do arquivo é o carimbo `gerado_em`.
    expect(s.match(/\d{4}-\d{2}-\d{2}/g)).toEqual(["2026-09-29"]);
  });
});
