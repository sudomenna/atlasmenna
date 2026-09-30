// Parser do cadastro de candidaturas 2026 — `data-pipeline/candidatos-parse.ts`.
//
// Spec 018 RF-140 (ingestão e recorte de PII), RF-141 (publicabilidade
// fail-closed), RF-152 (guarda de encolhimento). ADR-0039, ADR-0040.
//
// ⚠️ Todo teste aqui foi escrito para **derrubar uma mutação nomeada**. Se você
// mexer num assert, confirme antes que a mutação correspondente ainda fica
// vermelha — asserção de forma (`expect.any`, `toBeTruthy`) não serve: passa
// com o valor errado e foi exatamente assim que este repositório já aceitou
// teste que não discrimina.

import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { iterCsv, readCsvHeader } from "@/data-pipeline/_tse-common.ts";
import {
  avaliarEncolhimento,
  type CandidatoRow,
  campo,
  contarPublicaveis,
  ehPublicavel,
  LIMIAR_ENCOLHIMENTO,
  mapearCandidato,
  nomeDeUrna,
  opcional,
  unirCandidaturas,
} from "@/data-pipeline/candidatos-parse.ts";

// ---------------------------------------------------------------------------
// Helpers — header mínimo com as colunas que o parser realmente lê
// ---------------------------------------------------------------------------

const COLS_PRINCIPAL = [
  "DT_GERACAO",
  "HH_GERACAO",
  "NR_TURNO",
  "CD_ELEICAO",
  "SG_UF",
  "CD_CARGO",
  "SQ_CANDIDATO",
  "NR_CANDIDATO",
  "NM_CANDIDATO",
  "NM_URNA_CANDIDATO",
  "NR_PARTIDO",
  "SG_PARTIDO",
  "NM_PARTIDO",
  "SG_FEDERACAO",
  "NM_COLIGACAO",
] as const;

const COLS_COMPLEMENTAR = [
  "SQ_CANDIDATO",
  "ST_CANDIDATO_INSERIDO_URNA",
  "DS_SITUACAO_JULGAMENTO",
  "ST_SUBSTITUIDO",
  "SQ_SUBSTITUIDO",
] as const;

const headerDe = (cols: readonly string[]): Map<string, number> =>
  new Map(cols.map((c, i) => [c, i]));

const H_PRINCIPAL = headerDe(COLS_PRINCIPAL);
const H_COMPLEMENTAR = headerDe(COLS_COMPLEMENTAR);

/** Linha do arquivo principal, com os valores reais de CLÉCIO como base. */
function linhaPrincipal(over: Partial<Record<(typeof COLS_PRINCIPAL)[number], string>> = {}) {
  const base: Record<string, string> = {
    DT_GERACAO: "12/09/2026",
    HH_GERACAO: "19:31:30",
    NR_TURNO: "1",
    CD_ELEICAO: "6259",
    SG_UF: "AP",
    CD_CARGO: "3",
    SQ_CANDIDATO: "30002536311",
    NR_CANDIDATO: "44",
    NM_CANDIDATO: "CLÉCIO LUÍS VILHENA VIEIRA",
    NM_URNA_CANDIDATO: "CLÉCIO",
    NR_PARTIDO: "44",
    SG_PARTIDO: "UNIÃO",
    NM_PARTIDO: "UNIÃO BRASIL",
    SG_FEDERACAO: "UNIÃO/PP",
    NM_COLIGACAO: "JUNTOS POR TODO O AMAPÁ",
    ...over,
  };
  return COLS_PRINCIPAL.map((c) => base[c] ?? "");
}

function linhaComplementar(over: Partial<Record<(typeof COLS_COMPLEMENTAR)[number], string>> = {}) {
  const base: Record<string, string> = {
    SQ_CANDIDATO: "30002536311",
    ST_CANDIDATO_INSERIDO_URNA: "SIM",
    DS_SITUACAO_JULGAMENTO: "DEFERIDO",
    ST_SUBSTITUIDO: "N",
    SQ_SUBSTITUIDO: "-1",
    ...over,
  };
  return COLS_COMPLEMENTAR.map((c) => base[c] ?? "");
}

const mapear = (
  principal: string[] = linhaPrincipal(),
  // `null` (e não `undefined`) representa "sem par no complementar": o default
  // de parâmetro captura `undefined` e o teste de join quebrado passaria vazio.
  complementar: string[] | null = linhaComplementar(),
) =>
  mapearCandidato(
    principal,
    H_PRINCIPAL,
    complementar
      ? {
          sqCandidato: complementar[0]!,
          inseridoUrna: complementar[1]!,
          situacaoJulgamento: complementar[2]!,
          substituido: complementar[3]!,
          sqSubstituido: opcional(complementar[4]!),
        }
      : undefined,
  );

// ---------------------------------------------------------------------------
// RF-141 — publicabilidade fail-closed (ADR-0040)
// ---------------------------------------------------------------------------

describe("ehPublicavel — fail-closed (RF-141, ADR-0040)", () => {
  it('publica se e somente se ST_CANDIDATO_INSERIDO_URNA é exatamente "SIM"', () => {
    expect(ehPublicavel("SIM")).toBe(true);
    expect(ehPublicavel("NÃO")).toBe(false);
  });

  // MUTAÇÃO ALVO: `return true`. Um teste que só cubra SIM/NÃO passa com ela
  // em metade dos casos e some com o fail-closed inteiro.
  it.each([
    ["string vazia", ""],
    ["valor desconhecido", "TALVEZ"],
    ["valor futuro do TSE", "EM ANÁLISE"],
    ["minúsculo", "sim"],
    ["undefined (linha sem o campo)", undefined],
    ["null (linha ausente no complementar)", null],
  ])("trata %s como NÃO publicável", (_rotulo, valor) => {
    expect(ehPublicavel(valor as string | null | undefined)).toBe(false);
  });

  it("espaço em volta é ruído de transporte, não valor novo", () => {
    expect(ehPublicavel("  SIM  ")).toBe(true);
  });

  it("a linha mapeada herda a decisão em publicavel E em inserido_urna", () => {
    expect(
      mapear(linhaPrincipal(), linhaComplementar({ ST_CANDIDATO_INSERIDO_URNA: "TALVEZ" })),
    ).toMatchObject({ publicavel: false, inserido_urna: false });
    expect(
      mapear(linhaPrincipal(), linhaComplementar({ ST_CANDIDATO_INSERIDO_URNA: "SIM" })),
    ).toMatchObject({ publicavel: true, inserido_urna: true });
  });
});

// ---------------------------------------------------------------------------
// RF-140 — recorte de campos e PII
// ---------------------------------------------------------------------------

describe("mapearCandidato — o recorte de colunas (RF-140, constituição § 5)", () => {
  // MUTAÇÃO ALVO: acrescentar `cpf` (ou `data_nascimento`, ou `ocupacao`) ao
  // mapeamento. A asserção positiva — "os campos certos estão lá" — passaria
  // com o CPF ao lado; só o conjunto EXATO reprova.
  it("produz exatamente estas 19 chaves, nem uma a mais", () => {
    expect(Object.keys(mapear()).sort()).toEqual([
      "ano",
      "cargo",
      "cd_eleicao",
      "coligacao_nome",
      "federacao_sigla",
      "inserido_urna",
      "nome",
      "nome_urna",
      "numero",
      "partido_nome",
      "partido_numero",
      "partido_sigla",
      "publicavel",
      "situacao_julgamento",
      "sq_candidato",
      "sq_substituido",
      "substituido",
      "turno",
      "uf",
    ]);
  });

  it("nenhum destino de escrita carrega cpf, email ou título — asserção negativa", () => {
    const serializado = JSON.stringify(mapear()).toLowerCase();
    for (const proibido of ["cpf", "email", "titulo", "título", "nascimento", "ocupacao"]) {
      expect(serializado).not.toContain(proibido);
    }
  });

  it("mapeia os valores do TSE campo a campo", () => {
    expect(mapear()).toEqual({
      sq_candidato: "30002536311",
      ano: 2026,
      cd_eleicao: 6259,
      turno: 1,
      cargo: 3,
      uf: "AP",
      numero: 44,
      nome: "CLÉCIO LUÍS VILHENA VIEIRA",
      nome_urna: "CLÉCIO",
      partido_sigla: "UNIÃO",
      partido_numero: 44,
      partido_nome: "UNIÃO BRASIL",
      federacao_sigla: "UNIÃO/PP",
      coligacao_nome: "JUNTOS POR TODO O AMAPÁ",
      situacao_julgamento: "DEFERIDO",
      inserido_urna: true,
      substituido: false,
      sq_substituido: null,
      publicavel: true,
    });
  });

  // MUTAÇÃO ALVO: `Number(sq)` em qualquer ponto do trajeto.
  it("devolve SQ_CANDIDATO de 12 dígitos como a MESMA string, nunca number", () => {
    const row = mapear(
      linhaPrincipal({ SQ_CANDIDATO: "250002553928" }),
      linhaComplementar({ SQ_CANDIDATO: "250002553928" }),
    );
    expect(row.sq_candidato).toBe("250002553928");
    expect(typeof row.sq_candidato).toBe("string");
  });

  // MUTAÇÃO ALVO: `?? ""` no lugar de `|| nome`. `??` não pega string vazia e
  // o card renderizaria anônimo.
  it("NM_URNA_CANDIDATO vazio cai em NM_CANDIDATO", () => {
    expect(nomeDeUrna("", "CLÉCIO LUÍS VILHENA VIEIRA")).toBe("CLÉCIO LUÍS VILHENA VIEIRA");
    expect(nomeDeUrna("   ", "CLÉCIO LUÍS VILHENA VIEIRA")).toBe("CLÉCIO LUÍS VILHENA VIEIRA");
    expect(nomeDeUrna("CLÉCIO", "CLÉCIO LUÍS VILHENA VIEIRA")).toBe("CLÉCIO");
    expect(mapear(linhaPrincipal({ NM_URNA_CANDIDATO: "" })).nome_urna).toBe(
      "CLÉCIO LUÍS VILHENA VIEIRA",
    );
  });

  it("a situação de julgamento passa CRUA, sem normalização para enum", () => {
    const situacao = "INDEFERIDO EM PRAZO RECURSAL OU COM RECURSO";
    expect(
      mapear(linhaPrincipal(), linhaComplementar({ DS_SITUACAO_JULGAMENTO: situacao }))
        .situacao_julgamento,
    ).toBe(situacao);
    // Valor que o TSE ainda não publicou passa igual — sem `default` silencioso.
    expect(
      mapear(linhaPrincipal(), linhaComplementar({ DS_SITUACAO_JULGAMENTO: "CANCELADO" }))
        .situacao_julgamento,
    ).toBe("CANCELADO");
  });

  it("sentinelas do TSE viram null; valor real passa cru", () => {
    const row = mapear(linhaPrincipal({ SG_FEDERACAO: "#NULO", NM_COLIGACAO: "#NE" }));
    expect(row.federacao_sigla).toBeNull();
    expect(row.coligacao_nome).toBeNull();
    expect(opcional("PT/PC do B/PV")).toBe("PT/PC do B/PV");
  });

  it("Presidente vem com SG_UF = BR, como o CSV traz", () => {
    expect(
      mapear(linhaPrincipal({ CD_CARGO: "1", SG_UF: "BR", CD_ELEICAO: "6257" })),
    ).toMatchObject({ cargo: 1, uf: "BR", cd_eleicao: 6257 });
  });

  // MUTAÇÃO ALVO: `continue` no lugar do `throw` — importaria parcial em
  // silêncio, publicando candidatura sem saber se está na urna.
  it("join quebrado LANÇA, e a mensagem nomeia o sequencial órfão", () => {
    expect(() => mapear(linhaPrincipal(), null)).toThrowError(/Join quebrado.*30002536311/s);
  });

  it("coluna obrigatória ausente lança em vez de virar campo vazio", () => {
    expect(() => campo(["x"], new Map([["OUTRA", 0]]), "SQ_CANDIDATO")).toThrowError(
      /Coluna obrigatória ausente.*SQ_CANDIDATO/,
    );
  });
});

// ---------------------------------------------------------------------------
// União e descarte de cargos
// ---------------------------------------------------------------------------

describe("unirCandidaturas — descarte de cargo fora do produto", () => {
  // Até 29/09 os exemplos de "fora do produto" eram 7 e 8; desde a spec 027
  // (RF-288) eles são do produto, e o papel passou para 9/10 (suplentes de
  // Senador) e 2 (vice) — que continuam existindo no CSV do TSE.
  const principais = [
    linhaPrincipal({ SQ_CANDIDATO: "1", CD_CARGO: "1", SG_UF: "BR" }),
    linhaPrincipal({ SQ_CANDIDATO: "2", CD_CARGO: "6" }),
    linhaPrincipal({ SQ_CANDIDATO: "3", CD_CARGO: "9" }),
    linhaPrincipal({ SQ_CANDIDATO: "4", CD_CARGO: "9" }),
    linhaPrincipal({ SQ_CANDIDATO: "5", CD_CARGO: "10" }),
    linhaPrincipal({ SQ_CANDIDATO: "6", CD_CARGO: "2" }),
  ];
  const complementares = ["1", "2", "3", "4", "5", "6"].map((sq) =>
    linhaComplementar({ SQ_CANDIDATO: sq }),
  );

  // MUTAÇÃO ALVO: descartar em silêncio (sem incrementar o contador).
  it("descarta 9, 10 e 2 e CONTA cada descarte por código de cargo", () => {
    const r = unirCandidaturas(principais, H_PRINCIPAL, complementares, H_COMPLEMENTAR);
    expect(r.linhas.map((l) => l.cargo)).toEqual([1, 6]);
    expect([...r.descartadosPorCargo.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [2, 1],
      [9, 2],
      [10, 1],
    ]);
    expect(r.lidas).toBe(6);
  });

  it("um cargo fora do produto sem par no complementar NÃO derruba o ciclo", () => {
    const semPar = complementares.filter((c) => c[0] !== "3");
    const r = unirCandidaturas(principais, H_PRINCIPAL, semPar, H_COMPLEMENTAR);
    expect(r.linhas).toHaveLength(2);
    expect(r.descartadosPorCargo.get(9)).toBe(2);
  });

  it("RF-288: Deputado Estadual (7) e Distrital (8) ENTRAM — e deixam de ser descartados", () => {
    const comAssembleias = [
      ...principais,
      linhaPrincipal({ SQ_CANDIDATO: "20", CD_CARGO: "7", SG_UF: "SP" }),
      linhaPrincipal({ SQ_CANDIDATO: "21", CD_CARGO: "8", SG_UF: "DF" }),
    ];
    const r = unirCandidaturas(
      comAssembleias,
      H_PRINCIPAL,
      [...complementares, ...["20", "21"].map((sq) => linhaComplementar({ SQ_CANDIDATO: sq }))],
      H_COMPLEMENTAR,
    );
    expect(r.linhas.map((l) => l.cargo)).toEqual([1, 6, 7, 8]);
    // Asserção NEGATIVA: nem 7 nem 8 aparecem no contador de descarte.
    expect(r.descartadosPorCargo.has(7)).toBe(false);
    expect(r.descartadosPorCargo.has(8)).toBe(false);
  });

  it("RF-288: um cargo 7 sem par no complementar DERRUBA — agora ele é do produto", () => {
    const comEstadual = [
      ...principais,
      linhaPrincipal({ SQ_CANDIDATO: "20", CD_CARGO: "7", SG_UF: "SP" }),
    ];
    expect(() =>
      unirCandidaturas(comEstadual, H_PRINCIPAL, complementares, H_COMPLEMENTAR),
    ).toThrowError(/Join quebrado/);
  });

  it("mas um cargo DO produto sem par derruba", () => {
    const semPar = complementares.filter((c) => c[0] !== "2");
    expect(() => unirCandidaturas(principais, H_PRINCIPAL, semPar, H_COMPLEMENTAR)).toThrowError(
      /Join quebrado/,
    );
  });

  it("--uf e --cargo filtram e contam à parte do descarte por cargo", () => {
    const r = unirCandidaturas(principais, H_PRINCIPAL, complementares, H_COMPLEMENTAR, {
      cargo: 1,
    });
    expect(r.linhas).toHaveLength(1);
    expect(r.descartadosPorFiltro).toBe(1); // o cargo 6; 9/10/2 caem por cargo
  });

  it("partidos saem do universo INTEIRO, antes do filtro de cargo", () => {
    const r = unirCandidaturas(
      [
        ...principais,
        linhaPrincipal({
          SQ_CANDIDATO: "7",
          CD_CARGO: "7",
          NR_PARTIDO: "13",
          SG_PARTIDO: "PT",
          NM_PARTIDO: "PARTIDO DOS TRABALHADORES",
        }),
      ],
      H_PRINCIPAL,
      [...complementares, linhaComplementar({ SQ_CANDIDATO: "7" })],
      H_COMPLEMENTAR,
      { cargo: 1 },
    );
    expect(r.partidos.get(13)).toEqual({
      numero: 13,
      sigla: "PT",
      nome: "PARTIDO DOS TRABALHADORES",
    });
  });

  it("expõe DT_GERACAO + HH_GERACAO para conferência cruzada do frescor", () => {
    const r = unirCandidaturas(principais, H_PRINCIPAL, complementares, H_COMPLEMENTAR);
    expect(r.geracaoDeclarada).toBe("12/09/2026 19:31:30");
  });
});

// ---------------------------------------------------------------------------
// RF-152 — guarda de encolhimento
// ---------------------------------------------------------------------------

describe("avaliarEncolhimento — a rede contra download truncado (RF-152)", () => {
  const contagem = (cargo: number, uf: string, total: number) => ({ cargo, uf, total });

  it("o limiar é 2% e está declarado, não espalhado por comparações", () => {
    expect(LIMIAR_ENCOLHIMENTO).toBe(0.02);
  });

  // MUTAÇÃO ALVO: `>=` no lugar de `>`, ou simplesmente não abortar.
  it("queda de 3% ABORTA", () => {
    const r = avaliarEncolhimento([contagem(6, "SP", 1000)], [contagem(6, "SP", 970)]);
    expect(r.ok).toBe(false);
    expect(r.motivos).toHaveLength(1);
    expect(r.motivos[0]).toContain("cargo 6");
    expect(r.porCargo).toEqual([{ cargo: 6, antes: 1000, depois: 970, queda: 0.03 }]);
  });

  it("queda de 1% PASSA", () => {
    const r = avaliarEncolhimento([contagem(6, "SP", 1000)], [contagem(6, "SP", 990)]);
    expect(r.ok).toBe(true);
    expect(r.motivos).toEqual([]);
  });

  // Fronteira exata: 2% é "cair 2%", não "cair MAIS de 2%".
  it("queda de exatamente 2% PASSA; 2,1% aborta", () => {
    expect(avaliarEncolhimento([contagem(6, "SP", 1000)], [contagem(6, "SP", 980)]).ok).toBe(true);
    expect(avaliarEncolhimento([contagem(6, "SP", 1000)], [contagem(6, "SP", 979)]).ok).toBe(false);
  });

  it("crescer nunca dispara", () => {
    expect(avaliarEncolhimento([contagem(6, "SP", 1000)], [contagem(6, "SP", 1200)]).ok).toBe(true);
  });

  it("primeira importação (nada antes) não dispara — não há do que encolher", () => {
    expect(avaliarEncolhimento([], [contagem(6, "SP", 7221)]).ok).toBe(true);
  });

  // Segundo gatilho, e não é redundante: truncar costuma zerar uma UF inteira
  // sem mover o total do cargo além de 2%.
  it("par (cargo, UF) que tinha publicáveis e zera ABORTA, mesmo com o total estável", () => {
    const r = avaliarEncolhimento(
      [contagem(6, "SP", 500), contagem(6, "AC", 8)],
      [contagem(6, "SP", 500)],
    );
    expect(r.ok).toBe(false);
    expect(r.zerados).toEqual([{ cargo: 6, uf: "AC", antes: 8 }]);
    expect(r.motivos.some((m) => m.includes("AC"))).toBe(true);
  });

  it("os dois gatilhos aparecem juntos quando os dois disparam", () => {
    const r = avaliarEncolhimento(
      [contagem(6, "SP", 500), contagem(6, "AC", 100)],
      [contagem(6, "SP", 490)],
    );
    expect(r.ok).toBe(false);
    expect(r.motivos).toHaveLength(2);
  });

  it("contarPublicaveis ignora quem não é publicável", () => {
    const linhas = [
      { cargo: 6, uf: "BA", publicavel: true },
      { cargo: 6, uf: "BA", publicavel: false },
      { cargo: 1, uf: "BR", publicavel: true },
    ] as CandidatoRow[];
    expect(contarPublicaveis(linhas)).toEqual([
      { cargo: 1, uf: "BR", total: 1 },
      { cargo: 6, uf: "BA", total: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Ponta a ponta contra a fixture de linhas REAIS do TSE
// ---------------------------------------------------------------------------

const FIXTURE_PRINCIPAL = resolve(
  __dirname,
  "../../../data-pipeline/fixtures/candidatos-sample.csv",
);
const FIXTURE_COMPLEMENTAR = resolve(
  __dirname,
  "../../../data-pipeline/fixtures/candidatos-complementar-sample.csv",
);

async function lerFixture(path: string): Promise<string[][]> {
  const out: string[][] = [];
  for await (const campos of iterCsv(path)) out.push(campos);
  return out;
}

describe("fixture real do TSE (42 linhas de 12/09/2026)", () => {
  it("passa pelo parser inteiro e produz só os cargos do produto (7 e 8 incluídos, RF-288)", async () => {
    const [hA, hB] = await Promise.all([
      readCsvHeader(FIXTURE_PRINCIPAL),
      readCsvHeader(FIXTURE_COMPLEMENTAR),
    ]);
    const [a, b] = await Promise.all([
      lerFixture(FIXTURE_PRINCIPAL),
      lerFixture(FIXTURE_COMPLEMENTAR),
    ]);
    expect(a).toHaveLength(42);
    expect(b).toHaveLength(42);

    const r = unirCandidaturas(a, hA, b, hB);
    // Desde a spec 027 (RF-288) os cargos 7 e 8 são do produto: as linhas deles
    // na fixture passam a entrar. O 2 (vice) continua descartado E contado.
    expect(new Set(r.linhas.map((l) => l.cargo))).toEqual(new Set([1, 3, 5, 6, 7, 8]));
    expect([...r.descartadosPorCargo.keys()].sort((x, y) => x - y)).toEqual([2]);
    expect(r.linhas.length + [...r.descartadosPorCargo.values()].reduce((x, y) => x + y, 0)).toBe(
      42,
    );
    // 2 linhas com ST_CANDIDATO_INSERIDO_URNA = "NÃO" na fixture.
    expect(r.linhas.filter((l) => !l.publicavel)).toHaveLength(2);
  });

  it("o ARQUIVO de fixture não carrega PII de pessoa real", async () => {
    const { readFile } = await import("node:fs/promises");
    const bruto = await readFile(FIXTURE_PRINCIPAL, "latin1");
    // CPF, título e nascimento mascarados na geração da fixture; as colunas
    // continuam lá para que a fixture tenha a forma real de 50 colunas.
    // O ÚNICO valor de 11 dígitos entre aspas no arquivo é a máscara de CPF.
    expect(new Set(bruto.match(/"\d{11}"/g) ?? [])).toEqual(new Set(['"00000000000"']));
    expect(new Set(bruto.match(/"\d{12}"/g) ?? [])).toEqual(new Set(['"000000000000"']));
    expect(new Set(bruto.match(/"\d{2}\/\d{2}\/19\d{2}"/g) ?? [])).toEqual(
      new Set(['"01/01/1900"']),
    );
    expect(bruto).not.toContain("@");
  });

  it("as 13 candidaturas de Presidente vêm sob uf BR e cd_eleicao 6257", async () => {
    const [hA, hB] = await Promise.all([
      readCsvHeader(FIXTURE_PRINCIPAL),
      readCsvHeader(FIXTURE_COMPLEMENTAR),
    ]);
    const [a, b] = await Promise.all([
      lerFixture(FIXTURE_PRINCIPAL),
      lerFixture(FIXTURE_COMPLEMENTAR),
    ]);
    const pres = unirCandidaturas(a, hA, b, hB, { cargo: 1 }).linhas;
    expect(pres).toHaveLength(13);
    expect(pres.filter((p) => p.publicavel)).toHaveLength(12);
    expect(new Set(pres.map((p) => p.uf))).toEqual(new Set(["BR"]));
    expect(new Set(pres.map((p) => p.cd_eleicao))).toEqual(new Set([6257]));
  });
});
