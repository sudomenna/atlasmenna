/**
 * tests/unit/data-pipeline/candidatos-publish.test.ts
 *
 * O publicador de candidaturas — `data-pipeline/candidatos-publish.ts`.
 * Spec 018 RF-146/RF-150; ADR-0040 (publicabilidade fail-closed e situação de
 * julgamento como texto), ADR-0042 (`sqcand` é a identidade), constituição § 2
 * (ordem sem critério editorial) e § 6 (determinismo).
 *
 * ⚠️ Todo teste aqui foi escrito para **derrubar uma mutação nomeada**, e a
 * mutação está escrita ao lado da asserção. Se você mexer num assert, aplique a
 * mutação e confirme que ela fica vermelha — asserção de forma (`expect.any`,
 * `toBeTruthy`, "tem N itens") passa com o valor errado, e foi exatamente assim
 * que este repositório já aceitou teste que não discrimina.
 *
 * O teste mais importante é o do **guard do consumidor**: ele roda o objeto
 * que este produtor monta pelo `readCandidatosUf` real de
 * `lib/blob/candidatos.ts`. É a única prova de que produtor e consumidor
 * concordam sobre o contrato — os dois arquivos nasceram em paralelo, e um
 * `interface` copiado à mão divergiria sem o `tsc` ter nada a dizer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type CandidatoDbRow,
  montarCandidato,
  montarFatia,
  montarIndice,
  parseCli,
  sobRessalva,
  tamanhoBytes,
} from "@/data-pipeline/candidatos-publish.ts";
import { type CandidatosUfSlice, readCandidatosUf } from "@/lib/blob/candidatos";

const GERADO_TS = "2026-09-13T10:00:00.000Z";
const FONTE_TS = "2026-09-12T22:35:46.000Z";

/**
 * Linha de banco com valores **reais** do TSE por default.
 *
 * `situacao_julgamento` é um dos 9 valores medidos em 2026-09-13, nunca um
 * "APTO" inventado: fixture com valor que a fonte não emite deixa de provar
 * que o código aguenta o que a fonte realmente emite.
 */
function linha(over: Partial<CandidatoDbRow> = {}): CandidatoDbRow {
  return {
    sq_candidato: "250002553928",
    cargo: 6,
    uf: "SP",
    numero: 2222,
    nome: "FULANO DE TAL E QUAL",
    nome_urna: "FULANO",
    partido_sigla: "PL",
    federacao_sigla: null,
    coligacao_nome: null,
    situacao_julgamento: "DEFERIDO",
    foto_ok: true,
    publicavel: true,
    fonte_ts: FONTE_TS,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// RF-141 / ADR-0040 — publicabilidade fail-closed
// ---------------------------------------------------------------------------

describe("publicabilidade — ADR-0040, fail-closed", () => {
  it("candidatura com publicavel = false NÃO entra na fatia", () => {
    // Mutação alvo: remover o `.filter((r) => r.publicavel)` de `montarFatia`
    // (ou o `WHERE publicavel` da query, se ele fosse a única defesa).
    // São 1.532 candidaturas fora da urna (7,3%) no arquivo de 12/09 — nenhuma
    // delas pode chegar à tela.
    const fatia = montarFatia(
      "SP",
      6,
      [
        linha({ sq_candidato: "250002553928", numero: 1111, publicavel: true }),
        linha({ sq_candidato: "250002553929", numero: 2222, publicavel: false }),
        linha({ sq_candidato: "250002553930", numero: 3333, publicavel: true }),
      ],
      GERADO_TS,
    );

    expect(fatia.candidatos.map((c) => c.numero)).toEqual([1111, 3333]);
    expect(fatia.candidatos.map((c) => c.sqcand)).not.toContain("250002553929");
  });

  it("fonte_ts da fatia é o mais RECENTE das linhas, não o primeiro que chegou", () => {
    // Uma reimportação parcial pode deixar linhas de dois ciclos na mesma
    // fatia. A data honesta é a mais recente representada ali — e ela é o que
    // a tela carimba para o leitor (RF-150). Mutação alvo: pegar a primeira
    // linha, que faria o carimbo depender da ordem de chegada do Postgres.
    const fatia = montarFatia(
      "SP",
      6,
      [
        linha({ numero: 1111, fonte_ts: "2026-09-01T00:00:00.000Z" }),
        linha({ sq_candidato: "250002553929", numero: 2222, fonte_ts: "2026-09-12T22:35:46.000Z" }),
        linha({ sq_candidato: "250002553930", numero: 3333, fonte_ts: "2026-09-05T00:00:00.000Z" }),
      ],
      GERADO_TS,
    );
    expect(fatia.fonte_ts).toBe("2026-09-12T22:35:46.000Z");
  });

  it("fatia inteiramente não publicável sai vazia, não sai 'toda publicada'", () => {
    const fatia = montarFatia(
      "AC",
      5,
      [linha({ uf: "AC", cargo: 5, publicavel: false })],
      GERADO_TS,
    );
    expect(fatia.candidatos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ADR-0042 — `sqcand` é string, e é a identidade
// ---------------------------------------------------------------------------

describe("sqcand — string, nunca number (ADR-0042)", () => {
  it("sequenciais de 11 e de 12 dígitos saem como string no JSON, com o valor intacto", () => {
    // Mutação alvo: `Number(row.sq_candidato)` em `montarCandidato`. O tipo
    // TypeScript sozinho não pega isso num `as`; a asserção é sobre o JSON
    // **serializado**, que é o que o CDN entrega.
    const fatia = montarFatia(
      "SP",
      6,
      [
        linha({ sq_candidato: "90002553929", numero: 1111 }), // 11 dígitos
        linha({ sq_candidato: "250002553928", numero: 2222 }), // 12 dígitos
      ],
      GERADO_TS,
    );

    const serializada = JSON.parse(JSON.stringify(fatia)) as CandidatosUfSlice;
    const sqcands = serializada.candidatos.map((c) => c.sqcand);

    expect(sqcands).toEqual(["90002553929", "250002553928"]);
    for (const sq of sqcands) expect(typeof sq).toBe("string");

    // E o JSON cru não pode ter o sequencial sem aspas — `"sqcand":250002553928`
    // é o que um `Number()` produziria, e `JSON.parse` o devolveria como number
    // sem reclamar.
    expect(JSON.stringify(fatia)).toContain('"sqcand":"250002553928"');
    expect(JSON.stringify(fatia)).not.toContain('"sqcand":250002553928');
  });

  it("numero continua number — a assimetria com sqcand é deliberada", () => {
    // Zero ocorrências de zero à esquerda em 8.323 números medidos; o join com
    // `projections.candidato_id` (integer) e `EdgeCandidate.id` (number) é o
    // que decidiu o tipo. Mutação alvo: `String(row.numero)`.
    const c = montarCandidato(linha({ numero: 2222 }));
    expect(c.numero).toBe(2222);
    expect(typeof c.numero).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// RF-141 / ADR-0040 — `sob_ressalva` derivado na publicação
// ---------------------------------------------------------------------------

describe("sob_ressalva — derivado aqui, nunca no componente (ADR-0040)", () => {
  it("DEFERIDO não é ressalva; INDEFERIDO EM PRAZO RECURSAL é", () => {
    // Mutação alvo 1: inverter a comparação.
    expect(sobRessalva("DEFERIDO")).toBe(false);
    expect(sobRessalva("INDEFERIDO EM PRAZO RECURSAL OU COM RECURSO")).toBe(true);
  });

  it('"DEFERIDO EM PRAZO RECURSAL OU COM RECURSO" É ressalva — não é prefixo que vale', () => {
    // Mutação alvo 2, a perigosa: trocar a igualdade exata por
    // `startsWith("DEFERIDO")`. Essa É a regra certa em
    // `candidatos-resolve.ts` (que responde a outra pergunta: qual das duas
    // candidaturas colididas eu prefiro) e seria a regra ERRADA aqui: as 84
    // candidaturas deferidas sob recurso perderiam a ressalva em silêncio.
    expect(sobRessalva("DEFERIDO EM PRAZO RECURSAL OU COM RECURSO")).toBe(true);
  });

  it("os 9 valores reais do TSE classificam como o ADR-0040 mede", () => {
    // Distribuição medida em 2026-09-13 no arquivo gerado pelo TSE em 12/09.
    // Só o primeiro é "sem ressalva"; os outros oito são todos litígio,
    // renúncia ou pendência.
    const tabela: Array<[string, boolean]> = [
      ["DEFERIDO", false],
      ["INDEFERIDO EM PRAZO RECURSAL OU COM RECURSO", true],
      ["AGUARDANDO JULGAMENTO", true],
      ["RENÚNCIA", true],
      ["INDEFERIDO", true],
      ["DEFERIDO EM PRAZO RECURSAL OU COM RECURSO", true],
      ["PEDIDO NÃO CONHECIDO", true],
      ["PENDENTE DE JULGAMENTO", true],
      ["CANCELADO", true],
    ];
    for (const [situacao, esperado] of tabela) {
      expect(sobRessalva(situacao), situacao).toBe(esperado);
    }
  });

  it("valor desconhecido ou vazio vira ressalva — fail-closed, não fail-open", () => {
    // A primeira redação do ADR-0040 conhecia 8 dos 9 valores: uma lista de
    // valores conhecidos já nasceu incompleta. O default conservador exibe uma
    // ressalva a mais (visível, corrigível); o otimista esconderia um litígio.
    expect(sobRessalva("")).toBe(true);
    expect(sobRessalva("SITUACAO QUE O TSE AINDA NAO PUBLICOU")).toBe(true);
  });

  it("situacao_julgamento viaja CRU para a fatia — não normalizado em enum", () => {
    // RF-141: o texto é o que a tela mostra ao leitor. Mutação alvo:
    // normalizar para um enum com `default` silencioso — o defeito que já
    // mordeu este repositório três vezes.
    const c = montarCandidato(linha({ situacao_julgamento: "AGUARDANDO JULGAMENTO" }));
    expect(c.situacao_julgamento).toBe("AGUARDANDO JULGAMENTO");
    expect(c.sob_ressalva).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Constituição § 2 e § 6 — ordem
// ---------------------------------------------------------------------------

describe("ordenação — por número, nunca por critério editorial", () => {
  it("ordena por número crescente, e não por nome, partido nem ordem de chegada", () => {
    // Mutação alvo: ordenar por `nome_urna`, por `partido` ou não ordenar.
    // A fixture é construída para que os três critérios produzam ordens
    // DIFERENTES — sem isso o teste passaria com qualquer um deles.
    //
    //   por número  : 1111 (ZULMIRA/PT) · 2222 (ANDRÉ/PL) · 3333 (MARIA/AVANTE)
    //   por nome    : ANDRÉ · MARIA · ZULMIRA          → 2222, 3333, 1111
    //   por partido : AVANTE · PL · PT                 → 3333, 2222, 1111
    //   chegada     : 3333, 1111, 2222
    const fatia = montarFatia(
      "SP",
      6,
      [
        linha({
          sq_candidato: "250002553930",
          numero: 3333,
          nome_urna: "MARIA",
          partido_sigla: "AVANTE",
        }),
        linha({
          sq_candidato: "250002553928",
          numero: 1111,
          nome_urna: "ZULMIRA",
          partido_sigla: "PT",
        }),
        linha({
          sq_candidato: "250002553929",
          numero: 2222,
          nome_urna: "ANDRÉ",
          partido_sigla: "PL",
        }),
      ],
      GERADO_TS,
    );

    expect(fatia.candidatos.map((c) => c.numero)).toEqual([1111, 2222, 3333]);
    expect(fatia.candidatos.map((c) => c.nome_urna)).toEqual(["ZULMIRA", "ANDRÉ", "MARIA"]);
  });

  it("número repetido desempata por sequencial — a ordem não depende do Postgres", () => {
    // `(cargo, uf, numero)` colide 4× no dado real (ADR-0042, migration 0008):
    // MARLI LIMA em `6|BA|2727` e BRUNO ELIAS em `6|BA|2717` repetem NOME e
    // número. Sem segundo critério, a ordem dessas fatias dependeria da ordem
    // em que o banco devolveu as linhas — o mesmo banco produzindo dois
    // arquivos diferentes (constituição § 6).
    //
    // O desempate é por BigInt: comparação de texto entre 11 e 12 dígitos
    // ordenaria "90002553929" depois de "250002553928", que é o erro que só
    // apareceria como candidato trocado.
    const entrada = [
      linha({ sq_candidato: "250002543999", numero: 2727, nome_urna: "MARLI LIMA" }),
      linha({ sq_candidato: "90002542551", numero: 2727, nome_urna: "MARLI LIMA" }),
    ];
    const direta = montarFatia("BA", 6, entrada, GERADO_TS);
    const invertida = montarFatia("BA", 6, [...entrada].reverse(), GERADO_TS);

    expect(direta.candidatos.map((c) => c.sqcand)).toEqual(["90002542551", "250002543999"]);
    expect(invertida.candidatos.map((c) => c.sqcand)).toEqual(
      direta.candidatos.map((c) => c.sqcand),
    );
  });
});

// ---------------------------------------------------------------------------
// Cargo — o conversor único, não um ternário local
// ---------------------------------------------------------------------------

describe("cargo — token no corpo, via `cargoToken`", () => {
  it("cada um dos quatro códigos vira o SEU token", () => {
    // Mutação alvo: `cargo === 3 ? "gov" : "pres"` — o padrão de default
    // silencioso que já mandou todo o payload de Senador para a chave do
    // Presidente. Os quatro casos juntos, porque um ternário passa em dois.
    expect(montarFatia("BR", 1, [linha({ cargo: 1, uf: "BR" })], GERADO_TS).cargo).toBe("pres");
    expect(montarFatia("SP", 3, [linha({ cargo: 3 })], GERADO_TS).cargo).toBe("gov");
    expect(montarFatia("SP", 5, [linha({ cargo: 5 })], GERADO_TS).cargo).toBe("sen");
    expect(montarFatia("SP", 6, [linha({ cargo: 6 })], GERADO_TS).cargo).toBe("dep");
  });

  it("uf é normalizada para maiúscula — é o que o caminho do blob usa", () => {
    expect(montarFatia("sp", 6, [linha()], GERADO_TS).uf).toBe("SP");
  });
});

// ---------------------------------------------------------------------------
// Campos opcionais
// ---------------------------------------------------------------------------

describe("federacao e coligacao — ausentes são OMITIDOS, nunca null", () => {
  it("sem federação nem coligação, as chaves não existem — nem no objeto, nem no JSON", () => {
    // O contrato declara `federacao?: string`. Um `null` seria um terceiro
    // estado que o consumidor não declara aceitar — e `federacao === null`
    // renderizaria "null" num card que fizesse interpolação ingênua.
    //
    // As DUAS asserções são necessárias, e é por pouco: `JSON.stringify` apaga
    // uma chave cujo valor é `undefined`, então o teste do JSON sozinho passa
    // com `candidato.federacao = undefined` atribuído explicitamente — e aí
    // `Object.keys(candidato)` no lado de cá já traz a chave. Mutação alvo:
    // atribuir sempre, em vez de só quando há valor.
    const candidato = montarCandidato(linha());
    expect("federacao" in candidato).toBe(false);
    expect("coligacao" in candidato).toBe(false);
    expect(Object.keys(candidato).sort()).toEqual(
      [
        "foto_ok",
        "nome",
        "nome_urna",
        "numero",
        "partido",
        "situacao_julgamento",
        "sob_ressalva",
        "sqcand",
      ].sort(),
    );

    const serializado = JSON.parse(JSON.stringify(candidato));
    expect("federacao" in serializado).toBe(false);
    expect("coligacao" in serializado).toBe(false);
  });

  it("sentinela do TSE (#NULO, #NE, string vazia) também vira ausência", () => {
    for (const sentinela of ["#NULO", "#NULO#", "#NE", "", "   "]) {
      const c = montarCandidato(linha({ federacao_sigla: sentinela, coligacao_nome: sentinela }));
      expect(c.federacao, sentinela).toBeUndefined();
      expect(c.coligacao, sentinela).toBeUndefined();
    }
  });

  it('"PARTIDO ISOLADO" e "FEDERAÇÃO" NÃO são nomes de coligação — são rótulos de ausência', () => {
    // Medido em 2026-09-13 nas 7.698 publicáveis: `PARTIDO ISOLADO` em 5.246
    // linhas (68,1%) e `FEDERAÇÃO` em 2.259 (29,3%). Só 193 (2,5%) têm nome
    // próprio de coligação. Copiar a coluna crua faria 7.505 cards dizerem
    // "Coligação: PARTIDO ISOLADO" — texto falso mostrado ao leitor
    // (constituição § 8).
    //
    // Mutação alvo: trocar `coligacaoReal` por `opcional` em `montarCandidato`
    // — que é exatamente o estado em que este publicador rodou a primeira vez
    // contra o Blob real, e o defeito apareceu no `curl`, não no teste.
    for (const rotulo of ["PARTIDO ISOLADO", "FEDERAÇÃO"]) {
      const c = montarCandidato(linha({ coligacao_nome: rotulo }));
      expect(c.coligacao, rotulo).toBeUndefined();
      expect("coligacao" in c, rotulo).toBe(false);
    }
  });

  it("coligação com nome próprio sobrevive — o filtro é igualdade exata, não prefixo", () => {
    // Mutação alvo: `startsWith("FEDERA")` ou `includes("ISOLADO")`. Nenhuma
    // das 91 coligações reais medidas colide hoje, mas um filtro por prefixo
    // apagaria em silêncio uma coligação futura com esse nome — que é como
    // este tipo de filtro erra.
    for (const nome of [
      "TRABALHAR PARA TRANSFORMAR O AMAPÁ",
      "FEDERAÇÃO DO POVO PARAENSE",
      "O PARTIDO ISOLADO NÃO NOS REPRESENTA",
    ]) {
      expect(montarCandidato(linha({ coligacao_nome: nome })).coligacao, nome).toBe(nome);
    }
  });

  it("federação real chega inteira — não vira cor, vira texto (ADR-0024)", () => {
    const c = montarCandidato(
      linha({ federacao_sigla: "PT/PC do B/PV", coligacao_nome: "COLIGAÇÃO EXEMPLO" }),
    );
    expect(c.federacao).toBe("PT/PC do B/PV");
    expect(c.coligacao).toBe("COLIGAÇÃO EXEMPLO");
    // A cor sai de `partido`, nunca da sigla composta.
    expect(c.partido).toBe("PL");
  });
});

// ---------------------------------------------------------------------------
// Sem PII — constituição § 5, RNF-019
// ---------------------------------------------------------------------------

describe("sem PII na fatia publicada (constituição § 5, RNF-019)", () => {
  it("o conjunto de chaves de uma candidatura é EXATAMENTE o do contrato", () => {
    // Asserção de conjunto exato, não de presença: "os campos certos estão lá"
    // passaria com o CPF ao lado. Reprova quem acrescentar campo novo, mesmo
    // que pareça inofensivo.
    const chaves = Object.keys(
      montarCandidato(linha({ federacao_sigla: "UNIÃO/PP", coligacao_nome: "X" })),
    ).sort();
    expect(chaves).toEqual(
      [
        "coligacao",
        "federacao",
        "foto_ok",
        "nome",
        "nome_urna",
        "numero",
        "partido",
        "situacao_julgamento",
        "sob_ressalva",
        "sqcand",
      ].sort(),
    );
  });

  it("nenhum nome de campo de PII aparece no JSON serializado", () => {
    const json = JSON.stringify(montarFatia("SP", 6, [linha()], GERADO_TS));
    for (const proibido of ["cpf", "email", "titulo_eleitoral", "data_nascimento", "ocupacao"]) {
      expect(json.toLowerCase(), proibido).not.toContain(proibido);
    }
  });
});

// ---------------------------------------------------------------------------
// O índice
// ---------------------------------------------------------------------------

describe("candidatos/index.json", () => {
  const fatias = [
    {
      uf: "SP",
      cargo: 6 as const,
      slice: montarFatia(
        "SP",
        6,
        [linha({ numero: 1 }), linha({ sq_candidato: "250002553929", numero: 2 })],
        GERADO_TS,
      ),
    },
    {
      uf: "BA",
      cargo: 6 as const,
      slice: montarFatia("BA", 6, [linha({ uf: "BA", numero: 3 })], GERADO_TS),
    },
    {
      uf: "BR",
      cargo: 1 as const,
      slice: montarFatia("BR", 1, [linha({ uf: "BR", cargo: 1, numero: 13 })], GERADO_TS),
    },
  ];

  it("total é a soma exata das contagens das fatias", () => {
    // Mutação alvo: contar errado (ex. `fatias.length`, ou uma contagem
    // separada do banco que pode divergir do que foi de fato publicado).
    const indice = montarIndice(fatias, GERADO_TS);
    const somaDasFatias = fatias.reduce((a, f) => a + f.slice.candidatos.length, 0);

    expect(indice.total).toBe(4);
    expect(indice.total).toBe(somaDasFatias);
  });

  it("por_cargo_uf bate fatia a fatia, chaveado pelo token do cargo", () => {
    const indice = montarIndice(fatias, GERADO_TS);
    expect(indice.por_cargo_uf).toEqual({ dep: { SP: 2, BA: 1 }, pres: { BR: 1 } });

    // E a soma de todas as contagens tem de fechar com `total` — a mesma
    // verdade contada pelos dois caminhos que o consumidor tem.
    const soma = Object.values(indice.por_cargo_uf)
      .flatMap((porUf) => Object.values(porUf))
      .reduce((a, v) => a + v, 0);
    expect(soma).toBe(indice.total);
  });

  it("carrega os dois relógios, separados (ADR-0038)", () => {
    const indice = montarIndice(fatias, GERADO_TS);
    expect(indice.fonte_ts).toBe(FONTE_TS);
    expect(indice.gerado_ts).toBe(GERADO_TS);
    expect(indice.fonte_ts).not.toBe(indice.gerado_ts);
  });

  it("fonte_ts do índice é o mais RECENTE entre as fatias, não o primeiro que aparece", () => {
    const antiga = montarFatia(
      "AC",
      5,
      [linha({ uf: "AC", cargo: 5, fonte_ts: "2026-09-01T00:00:00.000Z" })],
      GERADO_TS,
    );
    const nova = montarFatia(
      "AL",
      5,
      [linha({ uf: "AL", cargo: 5, fonte_ts: "2026-09-12T22:35:46.000Z" })],
      GERADO_TS,
    );
    const indice = montarIndice(
      [
        { uf: "AC", cargo: 5, slice: antiga },
        { uf: "AL", cargo: 5, slice: nova },
      ],
      GERADO_TS,
    );
    expect(indice.fonte_ts).toBe("2026-09-12T22:35:46.000Z");
  });
});

// ---------------------------------------------------------------------------
// O teste que mais importa: produtor × consumidor
// ---------------------------------------------------------------------------

describe("guard do consumidor — `readCandidatosUf` aceita o que este produtor monta", () => {
  const BASE = "https://exemplo.test";
  const savedBase = process.env.BLOB_PUBLIC_BASE_URL;

  beforeEach(() => {
    process.env.BLOB_PUBLIC_BASE_URL = BASE;
  });

  afterEach(() => {
    if (savedBase === undefined) delete process.env.BLOB_PUBLIC_BASE_URL;
    else process.env.BLOB_PUBLIC_BASE_URL = savedBase;
    vi.unstubAllGlobals();
  });

  /** Serve a fatia como o CDN serviria: JSON puro, ida e volta por `JSON.parse`. */
  function servir(slice: unknown): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(slice), { status: 200 })),
    );
  }

  it("a fatia produzida é lida com status ok — nenhum campo do contrato falta", async () => {
    // Mutação alvo: omitir qualquer campo que o guard confere (`uf`, `cargo`,
    // `fonte_ts`, `gerado_ts`, `candidatos`). Este é o teste que prova que os
    // dois arquivos — produtor e consumidor, escritos separados — concordam.
    const fatia = montarFatia(
      "SP",
      6,
      [
        linha({
          sq_candidato: "90002553929",
          numero: 1111,
          situacao_julgamento: "INDEFERIDO EM PRAZO RECURSAL OU COM RECURSO",
        }),
        linha({ sq_candidato: "250002553928", numero: 2222 }),
      ],
      GERADO_TS,
    );
    servir(fatia);

    const res = await readCandidatosUf("SP", "dep");

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.slice.uf).toBe("SP");
    expect(res.slice.cargo).toBe("dep");
    expect(res.slice.fonte_ts).toBe(FONTE_TS);
    expect(res.slice.gerado_ts).toBe(GERADO_TS);
    expect(res.slice.candidatos.map((c) => c.sqcand)).toEqual(["90002553929", "250002553928"]);
    expect(res.slice.candidatos[0]?.sob_ressalva).toBe(true);
    expect(res.slice.candidatos[1]?.sob_ressalva).toBe(false);
  });

  it("o guard recusa a fatia do CARGO errado — a prova de que `cargo` não é decorativo", async () => {
    // Se `montarFatia` publicasse sempre o mesmo token, a lista do Senado sairia
    // sob o rótulo da Câmara sem erro em lugar nenhum. O guard é quem detecta.
    servir(montarFatia("SP", 5, [linha({ cargo: 5 })], GERADO_TS));
    const res = await readCandidatosUf("SP", "dep");
    expect(res.status).toBe("unavailable");
    if (res.status !== "unavailable") return;
    expect(res.reason).toBe("invalid");
  });

  it("o guard recusa a fatia da UF errada", async () => {
    servir(montarFatia("RJ", 6, [linha({ uf: "RJ" })], GERADO_TS));
    const res = await readCandidatosUf("SP", "dep");
    expect(res.status).toBe("unavailable");
    if (res.status !== "unavailable") return;
    expect(res.reason).toBe("invalid");
  });

  it("cada um dos seis cargos passa pelo guard sob o seu próprio token", async () => {
    // 7 e 8 (spec 027 RF-288): `est` e `dis`. O distrital só existe no DF.
    for (const [uf, cargo, token] of [
      ["SP", 1, "pres"],
      ["SP", 3, "gov"],
      ["SP", 5, "sen"],
      ["SP", 6, "dep"],
      ["SP", 7, "est"],
      ["DF", 8, "dis"],
    ] as const) {
      servir(montarFatia(uf, cargo, [linha({ cargo, uf })], GERADO_TS));
      const res = await readCandidatosUf(uf, token);
      expect(res.status, token).toBe("ok");
    }
  });

  it("RF-288: SP estadual e SP federal são fatias DIFERENTES — uma não responde pela outra", async () => {
    // O caminho sai do token (`candidatos/uf/SP/est.json` × `.../dep.json`);
    // o leitor ainda confere o `cargo` do corpo. Servir a fatia do 6 no pedido
    // do `est` tem de ser `invalid`, nunca `ok`.
    servir(montarFatia("SP", 6, [linha({ cargo: 6 })], GERADO_TS));
    const res = await readCandidatosUf("SP", "est");
    expect(res.status).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// CLI e instrumentação
// ---------------------------------------------------------------------------

describe("CLI", () => {
  it("sem flags, publica os seis cargos e todas as UFs", () => {
    const cli = parseCli([]);
    // 7 e 8 desde 2026-09-29 (spec 027 RF-288).
    expect(cli.cargos).toEqual([1, 3, 5, 6, 7, 8]);
    expect(cli.ufs).toBeNull();
    expect(cli.dryRun).toBe(false);
  });

  it("--uf e --cargo aceitam lista, e --cargo aceita código OU token", () => {
    expect(parseCli(["--uf", "sp,rj"]).ufs).toEqual(["SP", "RJ"]);
    expect(parseCli(["--cargo", "5,6"]).cargos).toEqual([5, 6]);
    expect(parseCli(["--cargo", "sen,dep"]).cargos).toEqual([5, 6]);
    // RF-288: as assembleias, por código e por token.
    expect(parseCli(["--cargo", "7,8"]).cargos).toEqual([7, 8]);
    expect(parseCli(["--cargo", "est,dis"]).cargos).toEqual([7, 8]);
    expect(parseCli(["--dry-run"]).dryRun).toBe(true);
  });

  it("cargo fora dos cobertos LANÇA — não cai num default", () => {
    // Cargo 2 (Vice-Presidente) existe no TSE e está fora do produto — desde a
    // spec 027 o 7 (Deputado Estadual) é coberto e deixou de servir de exemplo.
    // Mutação alvo: `?? 1` ou um `default:` que o mandasse para Presidente.
    expect(() => parseCli(["--cargo", "2"])).toThrow(/não reconhece/);
    expect(() => parseCli(["--cargo", "9"])).toThrow(/não reconhece/);
    expect(() => parseCli(["--cargo", "estadual"])).toThrow(/não reconhece/);
    expect(() => parseCli(["--uf", "SAO"])).toThrow(/não reconhece/);
    expect(() => parseCli(["--que-flag-e-essa"])).toThrow(/Flag desconhecida/);
  });
});

describe("tamanhoBytes", () => {
  it("conta bytes UTF-8, não unidades UTF-16 — a fatia é feita de nomes acentuados", () => {
    // `"á".length` é 1; em UTF-8 são 2 bytes. É a diferença entre o número que
    // `putJson` loga e o `content-length` que um `curl` mostra.
    expect(tamanhoBytes("á")).toBe(4); // `"á"` com as duas aspas do JSON
    expect(tamanhoBytes("a")).toBe(3);
  });
});
