// Casamento por nome civil + data de nascimento — `data-pipeline/casamento-nome.ts`.
//
// Porte dos casos de `trajetoria-camara.test.ts` (ADR-0058): as mesmas regras,
// com a casa legislativa generalizada. Cada caso de casamento isola UMA regra —
// os outros dois caminhos (e o exato) falham por construção, e isso está dito no
// próprio caso. Assim a remoção de qualquer regra derruba pelo menos um teste.
//
// Todos os nomes e datas são SINTÉTICOS.

import { describe, expect, it } from "vitest";
import {
  casaAproximado,
  casar,
  chaveDoNome,
  construirIndice,
  type IdentificacaoCandidato,
  isoDeDataTse,
  type PessoaCasavel,
  tokensDoNome,
} from "@/data-pipeline/casamento-nome.ts";

const NASC = "1970-01-02";

interface P extends PessoaCasavel {
  id: number;
}

function pessoa(over: Partial<P> = {}): P {
  return {
    id: 101,
    nomeParlamentar: "Fulano Parlamentar",
    nomeCivil: "FULANO DE TAL",
    nascimento: NASC,
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

const casarCom = (c: IdentificacaoCandidato, ps: P[]) => {
  const r = casar(c, construirIndice(ps));
  return { ids: r.casados.map((p) => p.id), modo: r.modo };
};

describe("tokensDoNome / chaveDoNome / isoDeDataTse", () => {
  it("NFD, descarta acento, maiúsculas, pontuação vira separador", () => {
    expect(tokensDoNome("José D'Ávila-Neto")).toEqual(["JOSE", "D", "AVILA", "NETO"]);
    expect(tokensDoNome("CONCEIÇÃO  a. l.")).toEqual(["CONCEICAO", "A", "L"]);
    expect(chaveDoNome("  Érika   Hílton ")).toBe("ERIKA HILTON");
  });

  it("vazio e nulo viram zero tokens", () => {
    expect(tokensDoNome("")).toEqual([]);
    expect(tokensDoNome(null)).toEqual([]);
    expect(tokensDoNome(undefined)).toEqual([]);
  });

  it("DD/MM/AAAA vira AAAA-MM-DD; o resto vira vazio", () => {
    expect(isoDeDataTse("02/01/1970")).toBe("1970-01-02");
    expect(isoDeDataTse(" 02/01/1970 ")).toBe("1970-01-02");
    expect(isoDeDataTse("#NULO#")).toBe("");
    expect(isoDeDataTse("")).toBe("");
    expect(isoDeDataTse("1970-01-02")).toBe("");
    expect(isoDeDataTse("2/1/1970")).toBe("");
  });
});

describe("construirIndice", () => {
  it("quem não tem data de nascimento fica fora dos dois índices, e é contado", () => {
    const idx = construirIndice([pessoa({ id: 1 }), pessoa({ id: 2, nascimento: "" })]);
    expect(idx.total).toBe(2);
    expect(idx.semNascimento).toBe(1);
    expect(idx.porNascimento.get(NASC)?.map((p) => p.id)).toEqual([1]);
  });
});

describe("casar — passo 1, exato", () => {
  it("nome civil normalizado + data iguais casa como exato", () => {
    const r = casarCom(cand({ nomeCivil: "MARIA DA CONCEIÇÃO RAMOS" }), [
      pessoa({ id: 7, nomeCivil: "Maria da Conceicao Ramos" }),
    ]);
    expect(r).toEqual({ ids: [7], modo: "exato" });
  });

  // MUTAÇÃO ALVO: chave exata só pelo nome (sem a data) — e também "aproximado
  // entre todos, não só os nascidos no mesmo dia".
  it("mesmo nome com data de nascimento diferente NÃO casa", () => {
    const r = casarCom(cand({ nomeCivil: "MARIA DA CONCEIÇÃO RAMOS", nascimento: "1971-01-02" }), [
      pessoa({ id: 7, nomeCivil: "Maria da Conceicao Ramos" }),
    ]);
    expect(r).toEqual({ ids: [], modo: "nenhum" });
  });

  it("sem data de nascimento no TSE não casa, nem com homônimo sem data no histórico", () => {
    const r = casarCom(cand({ nomeCivil: "MARIA DA CONCEIÇÃO RAMOS", nascimento: "" }), [
      pessoa({ id: 7, nomeCivil: "Maria da Conceicao Ramos", nascimento: "" }),
    ]);
    expect(r.modo).toBe("nenhum");
  });
});

describe("casar — passo 2, aproximado entre nascidos no mesmo dia", () => {
  // (a) sozinha: 3 tokens em comum de 4 (limiar max(2, 4−1) = 3). Primeiro
  // igual, último diferente → (b) falha; parlamentar ≠ urna → (c) falha.
  // MUTAÇÕES ALVO: remover (a); `>=` → `>`; `- 1` → `- 0`.
  it("(a) sobrenome trocado: tokens em comum no limiar casam", () => {
    const r = casarCom(cand({ nomeCivil: "ANA PAULA SOUZA LIMA", nomeUrna: "ANA PAULA" }), [
      pessoa({ id: 11, nomeCivil: "ANA PAULA SOUZA REIS", nomeParlamentar: "Paulinha Reis" }),
    ]);
    expect(r).toEqual({ ids: [11], modo: "aproximado" });
  });

  // MUTAÇÃO ALVO: `- 1` → `- 2`.
  it("(a) um token abaixo do limiar não casa", () => {
    const r = casarCom(cand({ nomeCivil: "ANA PAULA SOUZA LIMA", nomeUrna: "ANA PAULA" }), [
      pessoa({ id: 11, nomeCivil: "ANA PAULA REIS COSTA", nomeParlamentar: "Paula Costa" }),
    ]);
    expect(r.modo).toBe("nenhum");
  });

  // MUTAÇÃO ALVO: `Math.max(2, …)` → `Math.max(1, …)`.
  it("(a) o piso de 2 tokens: um só em comum nunca basta", () => {
    const r = casarCom(cand({ nomeCivil: "CARLOS ALBERTO", nomeUrna: "CARLOS ALBERTO" }), [
      pessoa({ id: 12, nomeCivil: "CARLOS NUNES", nomeParlamentar: "Carlos Nunes" }),
    ]);
    expect(r.modo).toBe("nenhum");
  });

  // (b) sozinha — "nome do meio abreviado no histórico". 4 em comum de 7
  // (limiar 6) → (a) falha; parlamentar ≠ urna → (c) falha.
  // MUTAÇÃO ALVO: remover (b).
  it("(b) nome abreviado: primeiro e último token iguais casam", () => {
    const r = casarCom(
      cand({ nomeCivil: "JOÃO CARLOS DE MORAES RIBEIRO BASTOS FARIAS", nomeUrna: "JOÃO FARIAS" }),
      [
        pessoa({
          id: 13,
          nomeCivil: "JOAO CARLOS DE M. R. B. FARIAS",
          nomeParlamentar: "João Carlos Farias",
        }),
      ],
    );
    expect(r).toEqual({ ids: [13], modo: "aproximado" });
  });

  // MUTAÇÃO ALVO: (b) só com o último token.
  it("(b) último igual e primeiro diferente não casa", () => {
    const r = casarCom(cand({ nomeCivil: "PEDRO SANTOS", nomeUrna: "PEDRO" }), [
      pessoa({ id: 14, nomeCivil: "LUCAS SANTOS", nomeParlamentar: "Lucas Santos" }),
    ]);
    expect(r.modo).toBe("nenhum");
  });

  // (c) sozinha — "nome social diferente do civil": só o primeiro nome em
  // comum (→ (a) falha), último diferente (→ (b) falha).
  // MUTAÇÃO ALVO: tirar o nome de URNA de `outros`.
  it("(c) nome parlamentar == nome de urna casa", () => {
    const r = casarCom(
      cand({ nomeCivil: "RAFAELA MOTA DUARTE", nomeUrna: "RAFA BRANDÃO", nomeSocial: null }),
      [pessoa({ id: 15, nomeCivil: "RAFAELA COSTA BRANDAO", nomeParlamentar: "Rafa Brandão" })],
    );
    expect(r).toEqual({ ids: [15], modo: "aproximado" });
  });

  // MUTAÇÃO ALVO: tirar o nome SOCIAL de `outros`.
  it("(c) nome parlamentar == nome social casa, mesmo com urna diferente", () => {
    const r = casarCom(
      cand({
        nomeCivil: "RAFAELA MOTA DUARTE",
        nomeUrna: "RAFAELA DUARTE",
        nomeSocial: "RAFA BRANDÃO",
      }),
      [pessoa({ id: 15, nomeCivil: "RAFAELA COSTA BRANDAO", nomeParlamentar: "Rafa Brandão" })],
    );
    expect(r).toEqual({ ids: [15], modo: "aproximado" });
  });

  it("(c) nome parlamentar vazio nunca casa com nome de urna vazio", () => {
    expect(
      casaAproximado(cand({ nomeCivil: "AAA BBB", nomeUrna: "", nomeSocial: null }), {
        nomeCivil: "CCC DDD",
        nomeParlamentar: "",
        nascimento: NASC,
      }),
    ).toBe(false);
  });

  // MUTAÇÃO ALVO: aproximado varrendo o histórico inteiro, não só a mesma data.
  it("a regra aproximada NÃO atravessa datas de nascimento", () => {
    const r = casarCom(
      cand({
        nomeCivil: "RAFAELA MOTA DUARTE",
        nomeUrna: "RAFA BRANDÃO",
        nascimento: "1980-05-05",
      }),
      [pessoa({ id: 15, nomeCivil: "RAFAELA COSTA BRANDAO", nomeParlamentar: "Rafa Brandão" })],
    );
    expect(r.modo).toBe("nenhum");
  });

  it("mesma data de nascimento com nome diferente não casa", () => {
    const r = casarCom(cand({ nomeCivil: "ROBERTO ALVES PINTO", nomeUrna: "BETO ALVES" }), [
      pessoa({ id: 16, nomeCivil: "MARCOS TEIXEIRA LOPES", nomeParlamentar: "Marcos Teixeira" }),
    ]);
    expect(r).toEqual({ ids: [], modo: "nenhum" });
  });

  it("o exato tem precedência: com casamento exato, o aproximado não acrescenta ninguém", () => {
    const r = casarCom(cand({ nomeCivil: "ANA PAULA SOUZA LIMA", nomeUrna: "ANA PAULA" }), [
      pessoa({ id: 20, nomeCivil: "ANA PAULA SOUZA LIMA" }),
      pessoa({ id: 21, nomeCivil: "ANA PAULA SOUZA REIS", nomeParlamentar: "Paulinha Reis" }),
    ]);
    expect(r).toEqual({ ids: [20], modo: "exato" });
  });
});
