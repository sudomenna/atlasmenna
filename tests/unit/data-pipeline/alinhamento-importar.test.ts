// Importador do alinhamento ao governo na Câmara — `data-pipeline/alinhamento-importar.ts`.
// ADR-0062 item 2 (lista branca, recusa de dado pessoal, nunca `raw/`) e item 3
// (`votos_disputadas`, não `amostra_pequena`).
//
// Fixtures pequenas e SINTÉTICAS, com o mesmo cabeçalho do `alinhamento.csv`
// real (25 colunas, medido em 29/09) — inclusive `nome`, que existe na origem
// e não pode sair daqui.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type AlinhamentoExportado,
  COLUNAS_LIDAS,
  ENTRADA_PADRAO,
  FONTE_DESCRICAO,
  FONTE_URL,
  importarAlinhamento,
  MIN_LINHAS_CHECAGEM_ESCALA,
  parseAlinhamentoCsv,
  parseCli,
  serializarAlinhamento,
  validarCorte,
  verificarCabecalho,
  verificarCaminhoEntrada,
} from "@/data-pipeline/alinhamento-importar.ts";

const CABECALHO_REAL =
  "deputado_id,nome,partido_atual,uf,em_exercicio,partidos_na_legislatura,trocou_partido," +
  "primeira_votacao,ultima_votacao,votacoes_no_periodo,votacoes_participou,presenca_aprox," +
  "votos_validos,votos_sim_nao,votos_alinhados,abstencoes,obstrucoes,art17,taxa_alinhamento," +
  "taxa_alinhamento_sim_nao,votos_disputadas,taxa_alinhamento_disputadas,outros_votos," +
  "amostra_pequena,url";

/**
 * Uma linha no leiaute real. `taxaGeral` e `amostra` são as colunas-armadilha:
 * valores DIFERENTES dos que a regra usa, para que ler a coluna errada mude a
 * saída (ADR-0062 item 3).
 */
function linha(
  id: number,
  votosDisp: number | string,
  taxaDisp: number | string,
  { nome = `Deputada Sintética ${id}`, taxaGeral = "11.1", amostra = "1" } = {},
): string {
  return [
    id,
    `"${nome}"`,
    "PX",
    "SP",
    "1",
    '"PX, PY"',
    "0",
    "2023-02-01",
    "2026-09-03",
    "871",
    "800",
    "91.8",
    "790",
    "780",
    "500",
    "3",
    "7",
    "0",
    taxaGeral,
    "64.1",
    votosDisp,
    taxaDisp,
    "0",
    amostra,
    `https://www.camara.leg.br/deputados/${id}`,
  ].join(",");
}

const csv = (...linhas: string[]) => `${[CABECALHO_REAL, ...linhas].join("\n")}\n`;

const FIXTURE = csv(
  linha(204433, 14, "100.0", { nome: "Fulana, a Parlamentar" }),
  linha(62881, 420, "67.6"),
  linha(230764, 30, "35.0"),
  linha(9, 0, "0.0"),
);

describe("verificarCabecalho — lista branca e recusa de dado pessoal", () => {
  it("o cabeçalho real passa e só as três colunas da lista branca são localizadas", () => {
    const pos = verificarCabecalho(CABECALHO_REAL.split(","));
    expect(Object.keys(pos)).toEqual([...COLUNAS_LIDAS]);
    expect(pos).toEqual({
      deputado_id: 0,
      votos_disputadas: 20,
      taxa_alinhamento_disputadas: 21,
    });
  });

  // MUTAÇÃO ALVO: o importador aceitar coluna proibida (tirar a recusa, ou
  // comparar com caixa exata e deixar `DT_NASCIMENTO` passar).
  it.each([
    "dataNascimento",
    "data_nascimento",
    "cpf",
    "nomeCivil",
    "DT_NASCIMENTO",
    "ufNascimento",
    "nr_cpf",
    "NOME_CIVIL",
  ])("RECUSA cabeçalho com %s", (proibida) => {
    expect(() => verificarCabecalho([...CABECALHO_REAL.split(","), proibida])).toThrow(
      /RECUSADA.*dado pessoal/,
    );
    expect(() =>
      parseAlinhamentoCsv(FIXTURE.replace("deputado_id,", `deputado_id,${proibida},`)),
    ).toThrow(/RECUSADA/);
  });

  it("lista TODAS as colunas proibidas, não só a primeira", () => {
    expect(() => verificarCabecalho(["deputado_id", "cpf", "dataNascimento"])).toThrow(
      /cpf, dataNascimento/,
    );
  });

  it("coluna obrigatória ausente ou repetida lança", () => {
    expect(() => verificarCabecalho(["deputado_id", "votos_disputadas"])).toThrow(
      /ausente: taxa_alinhamento_disputadas/,
    );
    expect(() =>
      verificarCabecalho([
        "deputado_id",
        "votos_disputadas",
        "taxa_alinhamento_disputadas",
        "votos_disputadas",
      ]),
    ).toThrow(/repetida/);
  });
});

describe("parseAlinhamentoCsv — só as três colunas, escala percentual", () => {
  it("lê id, votos disputados e taxa das disputadas — e nada mais", () => {
    const m = parseAlinhamentoCsv(FIXTURE);
    expect([...m.keys()]).toEqual([204433, 62881, 230764, 9]);
    expect(m.get(62881)).toEqual({ votos_disputadas: 420, taxa_disputadas: 67.6 });
    expect(Object.keys(m.get(204433) as object)).toEqual(["votos_disputadas", "taxa_disputadas"]);
  });

  // MUTAÇÃO ALVO: dividir por 100 (ou multiplicar) — os limiares 65/35 são
  // percentuais; 67,6 tem de sair 67,6.
  it("a taxa sai na MESMA escala do CSV (0–100), sem conversão", () => {
    const m = parseAlinhamentoCsv(FIXTURE);
    expect(m.get(62881)?.taxa_disputadas).toBe(67.6);
    expect(m.get(204433)?.taxa_disputadas).toBe(100);
    expect(m.get(230764)?.taxa_disputadas).toBe(35);
  });

  // MUTAÇÃO ALVO: ler `taxa_alinhamento` (geral) ou `amostra_pequena` no
  // lugar das colunas das disputadas (ADR-0062 item 3).
  it("usa as colunas das DISPUTADAS, não a taxa geral nem amostra_pequena", () => {
    const m = parseAlinhamentoCsv(csv(linha(5, 40, "12.0", { taxaGeral: "88.8", amostra: "1" })));
    expect(m.get(5)).toEqual({ votos_disputadas: 40, taxa_disputadas: 12 });
  });

  it("taxa acima de 100, negativa ou não numérica lança", () => {
    expect(() => parseAlinhamentoCsv(csv(linha(1, 40, "100.1")))).toThrow(/fora de 0–100/);
    expect(() => parseAlinhamentoCsv(csv(linha(1, 40, "-3.0")))).toThrow(/fora de 0–100/);
    expect(() => parseAlinhamentoCsv(csv(linha(1, 40, "")))).toThrow(/fora de 0–100/);
    expect(() => parseAlinhamentoCsv(csv(linha(1, 40, "abc")))).toThrow(/fora de 0–100/);
  });

  // MUTAÇÃO ALVO: arquivo em fração (0–1) passar pela faixa 0–100 e jogar
  // todo deputado em "Oposição".
  it("arquivo inteiro em fração (0–1) é recusado", () => {
    const linhas = Array.from({ length: MIN_LINHAS_CHECAGEM_ESCALA }, (_, i) =>
      linha(i + 1, 40, (0.5 + i / 100).toFixed(3)),
    );
    expect(() => parseAlinhamentoCsv(csv(...linhas))).toThrow(/fração/);
    // …mas um arquivo pequeno não é julgado pelo máximo
    expect(parseAlinhamentoCsv(csv(linha(1, 40, "0.5"))).get(1)?.taxa_disputadas).toBe(0.5);
  });

  it("id inválido, votos não inteiros, id repetido e linha malformada lançam", () => {
    expect(() => parseAlinhamentoCsv(csv(linha(0, 40, "50.0")))).toThrow(/deputado_id/);
    expect(() => parseAlinhamentoCsv(csv(linha(1, "4.5", "50.0")))).toThrow(/votos_disputadas/);
    expect(() => parseAlinhamentoCsv(csv(linha(1, 40, "50.0"), linha(1, 41, "51.0")))).toThrow(
      /repetido/,
    );
    expect(() => parseAlinhamentoCsv(`${CABECALHO_REAL}\n1,2,3\n`)).toThrow(/campos/);
    expect(() => parseAlinhamentoCsv(`${CABECALHO_REAL}\n`)).toThrow(/sem nenhum/);
  });
});

describe("importarAlinhamento — o arquivo derivado", () => {
  const importar = () => importarAlinhamento(Buffer.from(FIXTURE, "utf8"), "2026-09-03");

  it("formato exato, chave a chave", () => {
    const e = importar();
    expect(Object.keys(e)).toEqual(["corte", "fonte", "por_deputado"]);
    expect(e.corte).toBe("2026-09-03");
    expect(e.fonte).toEqual({
      descricao: FONTE_DESCRICAO,
      url: FONTE_URL,
      sha256: createHash("sha256").update(FIXTURE).digest("hex"),
    });
    expect(e.fonte.descricao).toBe(
      "Câmara dos Deputados — Dados Abertos (votações nominais do plenário com orientação do governo)",
    );
    expect(e.fonte.url).toBe("https://dadosabertos.camara.leg.br");
    for (const x of Object.values(e.por_deputado)) {
      expect(Object.keys(x)).toEqual(["votos_disputadas", "taxa_disputadas"]);
    }
  });

  it("deputados em ordem numérica de id, chave texto", () => {
    expect(Object.keys(importar().por_deputado)).toEqual(["9", "62881", "204433", "230764"]);
  });

  it("o sha256 muda com um byte do CSV", () => {
    const outro = importarAlinhamento(Buffer.from(FIXTURE.replace("67.6", "67.7")), "2026-09-03");
    expect(outro.fonte.sha256).not.toBe(importar().fonte.sha256);
  });

  // MUTAÇÃO ALVO: qualquer coluna fora da lista branca (nome, UF, partido,
  // URL) vazando para o derivado.
  it("não carrega nome, partido, UF nem URL — asserção negativa sobre o texto", () => {
    const s = serializarAlinhamento(importar());
    for (const proibido of [
      "Fulana",
      "Sintética",
      "Parlamentar",
      '"PX"',
      "SP",
      "camara.leg.br/deputados",
      "nome",
      "nascimento",
      "cpf",
    ]) {
      expect(s).not.toContain(proibido);
    }
  });

  it("o texto é JSON que volta idêntico e cabe na largura do biome", () => {
    const e = importar();
    const s = serializarAlinhamento(e);
    expect(JSON.parse(s) as AlinhamentoExportado).toEqual(e);
    for (const l of s.split("\n").slice(7)) expect(l.length).toBeLessThanOrEqual(100);
  });
});

describe("corte, caminho e CLI", () => {
  it("corte é AAAA-MM-DD de uma data real", () => {
    expect(validarCorte("2026-09-03")).toBe("2026-09-03");
    for (const ruim of ["2026-02-30", "03/09/2026", "2026-9-3", ""]) {
      expect(() => validarCorte(ruim)).toThrow(/corte inválido/);
    }
  });

  it("--corte é obrigatório (informado, nunca inferido) e não pode repetir", () => {
    expect(() => parseCli([])).toThrow(/--corte/);
    expect(parseCli(["--corte", "2026-09-03"])).toMatchObject({
      corte: "2026-09-03",
      entrada: ENTRADA_PADRAO,
    });
    expect(() => parseCli(["--corte", "2026-09-03", "--corte", "2026-09-10"])).toThrow(/repetido/);
    expect(() => parseCli(["--corte", "2026-09-03", "--x", "1"])).toThrow(/desconhecido/);
  });

  it("a entrada padrão é o alinhamento.csv do projeto externo, fora da raw/", () => {
    expect(ENTRADA_PADRAO.endsWith("/alinhamento-governo-camara/alinhamento.csv")).toBe(true);
    expect(() => verificarCaminhoEntrada(ENTRADA_PADRAO)).not.toThrow();
  });

  it("RECUSA qualquer caminho sob raw/ e o votos.csv", () => {
    expect(() =>
      verificarCaminhoEntrada("/x/alinhamento-governo-camara/raw/deputados.csv"),
    ).toThrow(/raw/);
    expect(() => verificarCaminhoEntrada("/x/raw/alinhamento.csv")).toThrow(/raw/);
    expect(() => verificarCaminhoEntrada("/x/alinhamento-governo-camara/votos.csv")).toThrow(
      /votos\.csv/,
    );
  });
});
