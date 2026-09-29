// Trajetória na Câmara — o casamento puro de `data-pipeline/trajetoria-camara.ts`.
// Spec 018 RF-214, ADR-0058. A leitura das colunas do TSE (`trajetoriaDaLinha`)
// e o universo de cargo 6 estão em `trajetoria-camara-calculo.test.ts`.
//
// ⚠️ Cada caso de casamento isola UMA regra: os outros dois caminhos (e o
// exato) falham por construção, e isso está dito no próprio caso. Assim a
// remoção de qualquer regra derruba pelo menos um teste — um caso que casasse
// por duas regras sobreviveria à remoção de qualquer uma delas.
//
// Todos os nomes e datas são SINTÉTICOS. Reproduzem os padrões medidos em
// 26/09 (nome social diferente do civil; nome abreviado na Câmara; deputado
// estadual com ocupação "DEPUTADO"), não as pessoas.

import { describe, expect, it } from "vitest";
import {
  calcularTrajetoria,
  casarComCamara,
  categorizarTrajetoria,
  chaveDoNome,
  construirIndiceCamara,
  type DeputadoCamara,
  type IdentificacaoCandidato,
  isoDeDataTse,
  LEGISLATURA_ATUAL,
  parseDeputadosCsv,
  parseEmExercicioJson,
  registrosCsv,
  tokensDoNome,
} from "@/data-pipeline/trajetoria-camara.ts";

const NASC = "1970-01-02";

function dep(over: Partial<DeputadoCamara> = {}): DeputadoCamara {
  return {
    id: 101,
    nomeParlamentar: "Fulano Parlamentar",
    nomeCivil: "FULANO DE TAL",
    nascimento: NASC,
    legislaturaInicial: 55,
    legislaturaFinal: 56,
    ...over,
  };
}

function cand(over: Partial<IdentificacaoCandidato> = {}): IdentificacaoCandidato {
  return {
    nomeCivil: "CICRANO SOUZA",
    nomeUrna: "CICRANO",
    nomeSocial: null,
    nascimento: NASC,
    ...over,
  };
}

const casar = (c: IdentificacaoCandidato, ds: DeputadoCamara[], emEx: number[] = []) =>
  casarComCamara(c, construirIndiceCamara(ds, emEx));

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

describe("tokensDoNome / chaveDoNome / isoDeDataTse", () => {
  it("NFD, descarta acento, maiúsculas, pontuação vira separador", () => {
    expect(tokensDoNome("José D'Ávila-Neto")).toEqual(["JOSE", "D", "AVILA", "NETO"]);
    expect(tokensDoNome("CONCEIÇÃO  a. l.")).toEqual(["CONCEICAO", "A", "L"]);
    expect(chaveDoNome("  Érika   Hílton ")).toBe("ERIKA HILTON");
  });

  it("vazio e nulo viram zero tokens", () => {
    expect(tokensDoNome("")).toEqual([]);
    expect(tokensDoNome(null)).toEqual([]);
    expect(chaveDoNome("#NULO#")).toBe("NULO");
  });

  it("DD/MM/AAAA vira AAAA-MM-DD; o resto vira vazio", () => {
    expect(isoDeDataTse("02/01/1970")).toBe("1970-01-02");
    expect(isoDeDataTse("#NULO#")).toBe("");
    expect(isoDeDataTse("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Casamento
// ---------------------------------------------------------------------------

describe("casarComCamara — passo 1, exato", () => {
  it("nome civil normalizado + data iguais casa como exato", () => {
    const r = casar(cand({ nomeCivil: "MARIA DA CONCEIÇÃO RAMOS" }), [
      dep({ id: 7, nomeCivil: "Maria da Conceicao Ramos" }),
    ]);
    expect(r).toEqual({ ids: [7], maiorLegislatura: 56, modo: "exato" });
  });

  // MUTAÇÃO ALVO: chave exata só pelo nome (sem a data) — e também "aproximado
  // entre todos, não só os nascidos no mesmo dia".
  it("mesmo nome com data de nascimento diferente NÃO casa", () => {
    const r = casar(cand({ nomeCivil: "MARIA DA CONCEIÇÃO RAMOS", nascimento: "1971-01-02" }), [
      dep({ id: 7, nomeCivil: "Maria da Conceicao Ramos" }),
    ]);
    expect(r.modo).toBe("nenhum");
    expect(r.ids).toEqual([]);
  });

  it("sem data de nascimento no TSE não casa, nem com homônimo sem data na Câmara", () => {
    const r = casar(cand({ nomeCivil: "MARIA DA CONCEIÇÃO RAMOS", nascimento: "" }), [
      dep({ id: 7, nomeCivil: "Maria da Conceicao Ramos", nascimento: "" }),
    ]);
    expect(r.modo).toBe("nenhum");
  });
});

describe("casarComCamara — passo 2, aproximado entre nascidos no mesmo dia", () => {
  // (a) sozinha: 3 tokens em comum de 4 (limiar max(2, 4−1) = 3). Primeiro
  // igual, último diferente → (b) falha; parlamentar ≠ urna → (c) falha.
  // MUTAÇÕES ALVO: remover (a); `>=` → `>`; `- 1` → `- 0`.
  it("(a) sobrenome trocado: tokens em comum no limiar casam", () => {
    const r = casar(cand({ nomeCivil: "ANA PAULA SOUZA LIMA", nomeUrna: "ANA PAULA" }), [
      dep({ id: 11, nomeCivil: "ANA PAULA SOUZA REIS", nomeParlamentar: "Paulinha Reis" }),
    ]);
    expect(r).toMatchObject({ ids: [11], modo: "aproximado" });
  });

  // MUTAÇÃO ALVO: `- 1` → `- 2` (limiar cairia para 2 e isto casaria).
  it("(a) um token abaixo do limiar não casa", () => {
    const r = casar(cand({ nomeCivil: "ANA PAULA SOUZA LIMA", nomeUrna: "ANA PAULA" }), [
      dep({ id: 11, nomeCivil: "ANA PAULA REIS COSTA", nomeParlamentar: "Paula Costa" }),
    ]);
    expect(r.modo).toBe("nenhum");
  });

  // MUTAÇÃO ALVO: `Math.max(2, …)` → `Math.max(1, …)`. Nome curto, um token em
  // comum: o piso de 2 é o que impede o casamento.
  it("(a) o piso de 2 tokens: um só em comum nunca basta", () => {
    const r = casar(cand({ nomeCivil: "CARLOS ALBERTO", nomeUrna: "CARLOS ALBERTO" }), [
      dep({ id: 12, nomeCivil: "CARLOS NUNES", nomeParlamentar: "Carlos Nunes" }),
    ]);
    expect(r.modo).toBe("nenhum");
  });

  // (b) sozinha — padrão "nome do meio abreviado na Câmara". 4 em comum de 7
  // (limiar 6) → (a) falha; parlamentar ≠ urna → (c) falha.
  // MUTAÇÃO ALVO: remover (b).
  it("(b) nome abreviado na Câmara: primeiro e último token iguais casam", () => {
    const r = casar(
      cand({ nomeCivil: "JOÃO CARLOS DE MORAES RIBEIRO BASTOS FARIAS", nomeUrna: "JOÃO FARIAS" }),
      [
        dep({
          id: 13,
          nomeCivil: "JOAO CARLOS DE M. R. B. FARIAS",
          nomeParlamentar: "João Carlos Farias",
        }),
      ],
    );
    expect(r).toMatchObject({ ids: [13], modo: "aproximado" });
  });

  // MUTAÇÃO ALVO: (b) só com o último token.
  it("(b) último igual e primeiro diferente não casa", () => {
    const r = casar(cand({ nomeCivil: "PEDRO SANTOS", nomeUrna: "PEDRO" }), [
      dep({ id: 14, nomeCivil: "LUCAS SANTOS", nomeParlamentar: "Lucas Santos" }),
    ]);
    expect(r.modo).toBe("nenhum");
  });

  // (c) sozinha — padrão "nome social diferente do civil na Câmara": só o
  // primeiro nome em comum (→ (a) falha), último diferente (→ (b) falha).
  // MUTAÇÃO ALVO: tirar o nome de URNA de `outros`.
  it("(c) nome parlamentar == nome de urna casa", () => {
    const r = casar(
      cand({ nomeCivil: "RAFAELA MOTA DUARTE", nomeUrna: "RAFA BRANDÃO", nomeSocial: null }),
      [dep({ id: 15, nomeCivil: "RAFAELA COSTA BRANDAO", nomeParlamentar: "Rafa Brandão" })],
    );
    expect(r).toMatchObject({ ids: [15], modo: "aproximado" });
  });

  // MUTAÇÃO ALVO: tirar o nome SOCIAL de `outros`.
  it("(c) nome parlamentar == nome social casa, mesmo com urna diferente", () => {
    const r = casar(
      cand({
        nomeCivil: "RAFAELA MOTA DUARTE",
        nomeUrna: "RAFAELA DUARTE",
        nomeSocial: "RAFA BRANDÃO",
      }),
      [dep({ id: 15, nomeCivil: "RAFAELA COSTA BRANDAO", nomeParlamentar: "Rafa Brandão" })],
    );
    expect(r).toMatchObject({ ids: [15], modo: "aproximado" });
  });

  // MUTAÇÃO ALVO: aproximado varrendo o histórico inteiro, não só a mesma data.
  it("a regra aproximada NÃO atravessa datas de nascimento", () => {
    const r = casar(
      cand({
        nomeCivil: "RAFAELA MOTA DUARTE",
        nomeUrna: "RAFA BRANDÃO",
        nascimento: "1980-05-05",
      }),
      [dep({ id: 15, nomeCivil: "RAFAELA COSTA BRANDAO", nomeParlamentar: "Rafa Brandão" })],
    );
    expect(r.modo).toBe("nenhum");
  });

  it("mesma data de nascimento com nome diferente não casa", () => {
    const r = casar(cand({ nomeCivil: "ROBERTO ALVES PINTO", nomeUrna: "BETO ALVES" }), [
      dep({ id: 16, nomeCivil: "MARCOS TEIXEIRA LOPES", nomeParlamentar: "Marcos Teixeira" }),
    ]);
    expect(r).toEqual({ ids: [], maiorLegislatura: null, modo: "nenhum" });
  });

  it("o exato tem precedência: com casamento exato, o aproximado não acrescenta ninguém", () => {
    const r = casar(cand({ nomeCivil: "ANA PAULA SOUZA LIMA", nomeUrna: "ANA PAULA" }), [
      dep({ id: 20, nomeCivil: "ANA PAULA SOUZA LIMA" }),
      dep({ id: 21, nomeCivil: "ANA PAULA SOUZA REIS", nomeParlamentar: "Paulinha Reis" }),
    ]);
    expect(r).toMatchObject({ ids: [20], modo: "exato" });
  });
});

// ---------------------------------------------------------------------------
// Categoria
// ---------------------------------------------------------------------------

describe("categorizarTrajetoria — precedência e fronteira da 57ª", () => {
  const cat = (ids: number[], maior: number | null, emEx: number[] = []) =>
    categorizarTrajetoria({ ids, maiorLegislatura: maior, modo: "exato" }, new Set(emEx));

  it("a legislatura atual é a 57ª", () => {
    expect(LEGISLATURA_ATUAL).toBe(57);
  });

  it("sem casamento é estreante, qualquer que seja o resto", () => {
    expect(cat([], 57, [7])).toBe("estreante");
  });

  // MUTAÇÃO ALVO: testar a legislatura antes do exercício.
  it("em exercício vence legislatura atual", () => {
    expect(cat([7], 57, [7])).toBe("em_exercicio");
  });

  it("57 sem exercício é legislatura_atual", () => {
    expect(cat([7], 57, [8])).toBe("legislatura_atual");
  });

  // MUTAÇÕES ALVO: `=== 57` → `=== 56`, `>= 56`, `<= 57`.
  it("56 é mandato_anterior — a fronteira é exatamente a 57ª", () => {
    expect(cat([7], 56, [8])).toBe("mandato_anterior");
    expect(cat([7], 1, [])).toBe("mandato_anterior");
  });
});

describe("calcularTrajetoria — ponta a ponta sobre o índice", () => {
  // MUTAÇÃO ALVO: maior legislatura só de `legislaturaInicial`.
  it("a legislatura final conta: 54→57 é legislatura_atual", () => {
    const idx = construirIndiceCamara(
      [dep({ id: 7, nomeCivil: "FULANO DE TAL", legislaturaInicial: 54, legislaturaFinal: 57 })],
      [999],
    );
    expect(calcularTrajetoria(cand({ nomeCivil: "FULANO DE TAL" }), idx)).toEqual({
      trajetoria: "legislatura_atual",
      camaraIds: [7],
      modo: "exato",
    });
  });

  // MUTAÇÃO ALVO: olhar só `ids[0]` (ou `every`) no teste de exercício. O id
  // em exercício é o MAIOR, então não é o primeiro depois da ordenação.
  it("dois homônimos casados: basta um em exercício; ids saem ordenados", () => {
    const idx = construirIndiceCamara(
      [
        dep({ id: 200, nomeCivil: "FULANO DE TAL", legislaturaInicial: 57, legislaturaFinal: 57 }),
        dep({ id: 100, nomeCivil: "FULANO DE TAL", legislaturaInicial: 50, legislaturaFinal: 51 }),
      ],
      [200],
    );
    expect(calcularTrajetoria(cand({ nomeCivil: "FULANO DE TAL" }), idx)).toEqual({
      trajetoria: "em_exercicio",
      camaraIds: [100, 200],
      modo: "exato",
    });
  });

  it("dois homônimos, nenhum em exercício: a MAIOR legislatura decide", () => {
    const idx = construirIndiceCamara(
      [
        dep({ id: 100, nomeCivil: "FULANO DE TAL", legislaturaInicial: 50, legislaturaFinal: 51 }),
        dep({ id: 200, nomeCivil: "FULANO DE TAL", legislaturaInicial: 56, legislaturaFinal: 57 }),
      ],
      [],
    );
    expect(calcularTrajetoria(cand({ nomeCivil: "FULANO DE TAL" }), idx).trajetoria).toBe(
      "legislatura_atual",
    );
  });

  it("estreante não carrega id (camaraIds null)", () => {
    const idx = construirIndiceCamara([dep({ nomeCivil: "FULANO DE TAL" })], []);
    expect(calcularTrajetoria(cand({ nomeCivil: "ROBERTO ALVES" }), idx)).toEqual({
      trajetoria: "estreante",
      camaraIds: null,
      modo: "nenhum",
    });
  });

  it("o resultado não carrega data de nascimento nem nome — asserção negativa", () => {
    const idx = construirIndiceCamara([dep({ nomeCivil: "FULANO DE TAL" })], []);
    const s = JSON.stringify(
      calcularTrajetoria(cand({ nomeCivil: "FULANO DE TAL", nomeSocial: "FULANA" }), idx),
    );
    for (const proibido of [NASC, "1970", "FULANO", "FULANA", "nascimento"]) {
      expect(s).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------------
// Parsing das fontes da Câmara e serialização
// ---------------------------------------------------------------------------

describe("fontes da Câmara", () => {
  it("registrosCsv: BOM, aspas, `;` e newline dentro de aspas, CRLF", () => {
    const t = '﻿"a";"b"\r\n"x;y";"linha\nquebrada"\r\n"com ""aspas""";""\n';
    expect(registrosCsv(t)).toEqual([
      ["a", "b"],
      ["x;y", "linha\nquebrada"],
      ['com "aspas"', ""],
    ]);
  });

  const CAB =
    '"uri";"nome";"idLegislaturaInicial";"idLegislaturaFinal";"nomeCivil";"cpf";"dataNascimento"';

  it("parseDeputadosCsv: id vem do fim da uri; legislaturas como número", () => {
    const t = `﻿${CAB}\n"https://x/api/v2/deputados/220593";"Fulano";"56";"57";"FULANO DE TAL";"";"1984-01-31"\n`;
    expect(parseDeputadosCsv(t)).toEqual([
      {
        id: 220593,
        nomeParlamentar: "Fulano",
        nomeCivil: "FULANO DE TAL",
        nascimento: "1984-01-31",
        legislaturaInicial: 56,
        legislaturaFinal: 57,
      },
    ]);
  });

  it("parseDeputadosCsv lança sem coluna obrigatória ou com legislatura ilegível", () => {
    expect(() => parseDeputadosCsv('"uri";"nome"\n"u/1";"x"\n')).toThrow(/coluna obrigatória/);
    expect(() =>
      parseDeputadosCsv(`${CAB}\n"https://x/deputados/1";"F";"";"57";"F";"";"1984-01-31"\n`),
    ).toThrow(/idLegislaturaInicial/);
  });

  it("parseEmExercicioJson: ids; lança em resposta paginada", () => {
    expect(parseEmExercicioJson('{"dados":[{"id":1},{"id":22}],"links":[]}')).toEqual([1, 22]);
    expect(() =>
      parseEmExercicioJson('{"dados":[{"id":1}],"links":[{"rel":"next","href":"x"}]}'),
    ).toThrow(/paginada/);
    expect(() => parseEmExercicioJson('{"x":1}')).toThrow(/dados/);
  });

  it("construirIndiceCamara conta quem não tem data e o deixa fora dos índices", () => {
    const idx = construirIndiceCamara([dep({ id: 1 }), dep({ id: 2, nascimento: "" })], [1]);
    expect(idx.totalDeputados).toBe(2);
    expect(idx.semNascimento).toBe(1);
    expect([...idx.porNascimento.values()].flat().map((d) => d.id)).toEqual([1]);
  });
});
