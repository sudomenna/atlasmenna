/**
 * tests/unit/blob/deputado-uf.test.ts
 *
 * A leitura do drill-down de Deputado Federal no Blob (RF-129) e a ordenação
 * determinística que o consumidor reaplica.
 *
 * O que estes testes protegem:
 *   - Que **toda** falha devolva um MOTIVO, e não `null` nem exceção: a UI
 *     escolhe o texto do estado "detalhe indisponível" a partir dele, e um 404
 *     numa UF sem boletim não é a mesma notícia que uma falha de rede
 *     (ADR-0017, ADR-0032 item 3, constituição § 7).
 *   - Que o blob de OUTRA UF seja recusado. É a razão de o objeto carregar a
 *     própria sigla, redundante com o caminho: um CDN que sirva o objeto
 *     errado não pode virar uma lista de eleitos atribuída ao estado errado.
 *   - Que a ordem de exibição tenha desempate explícito (constituição § 6):
 *     duas agremiações empatadas em cadeiras não podem trocar de lugar entre
 *     ciclos.
 *   - **D2 / RF-125.1, sobre a fixture real**: o objeto de UF não menciona
 *     `vagas_obtidas`, e `Σ cadeiras` fecha com `lugares_a_preencher`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agremiacoesFrom,
  type DeputadoDivergenciaChave,
  type DeputadoUfAgremiacao,
  type DeputadoUfDetail,
  ordenarAgremiacoes,
  ordenarCandidatos,
  readDeputadoUfDetail,
} from "@/lib/blob/deputado-uf";
import depUfFixture from "@/tests/fixtures/blob/dep-uf.json" with { type: "json" };

const BASE = "https://exemplo.test";
const URL_SP = `${BASE}/deputado/uf/SP.json`;

function agremiacao(over: Partial<DeputadoUfAgremiacao> = {}): DeputadoUfAgremiacao {
  return {
    cod: "22",
    sigla: "PL",
    nome: "Partido Liberal",
    tipo: "partido",
    componentes: [],
    sigla_lider: "PL",
    votos_nominais: 900,
    votos_legenda: 100,
    votos_validos: 1000,
    pct_votos: 50,
    quociente_partidario: 5,
    cadeiras: 5,
    eleitos: [],
    suplentes: [],
    ...over,
  };
}

function detalhe(uf = "SP"): DeputadoUfDetail {
  return {
    ts: "2026-10-04T22:00:00-03:00",
    cargo: 6,
    turno: 1,
    uf,
    pct_apurado: 40,
    lugares_a_preencher: 10,
    quociente_eleitoral: 100,
    quociente_eleitoral_tse: 100,
    totalizacao_final: false,
    divergencias: [],
    agremiacoes: [agremiacao(), agremiacao({ cod: "13", sigla: "FE BRASIL", cadeiras: 5 })],
    vagas_nao_preenchidas: 0,
    empates_indeterminados: [],
  };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

describe("readDeputadoUfDetail — degradação com motivo (RF-129)", () => {
  const savedBase = process.env.BLOB_PUBLIC_BASE_URL;
  const savedToken = process.env.BLOB_READ_WRITE_TOKEN;

  beforeEach(() => {
    process.env.BLOB_PUBLIC_BASE_URL = BASE;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (savedBase === undefined) delete process.env.BLOB_PUBLIC_BASE_URL;
    else process.env.BLOB_PUBLIC_BASE_URL = savedBase;
    if (savedToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = savedToken;
    vi.restoreAllMocks();
  });

  function mockFetch(impl: () => Promise<Response>) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
  }

  it("200 com objeto válido → ok, na URL determinística e sem cargo/turno no caminho", async () => {
    const spy = mockFetch(async () => new Response(JSON.stringify(detalhe()), { status: 200 }));

    const result = await readDeputadoUfDetail(6, "SP");

    // Deputado se decide em turno único e não divide caminho com nenhuma
    // outra corrida — por isso `deputado/uf/SP.json` e não
    // `.../dep/t1.json`.
    expect(spy).toHaveBeenCalledWith(URL_SP, { next: { revalidate: 60 } });
    expect(result.status).toBe("ok");
    expect(agremiacoesFrom(result)).toHaveLength(2);
    if (result.status === "ok") expect(result.url).toBe(URL_SP);
  });

  it("sigla em minúscula resolve para o mesmo caminho canônico", async () => {
    const spy = mockFetch(async () => new Response(JSON.stringify(detalhe()), { status: 200 }));
    await readDeputadoUfDetail(6, "sp");
    expect(spy).toHaveBeenCalledWith(URL_SP, { next: { revalidate: 60 } });
  });

  it("404 → not_found, e o acessor coalesce para vazio", async () => {
    mockFetch(async () => new Response("", { status: 404 }));
    const result = await readDeputadoUfDetail(6, "SP");
    expect(result).toEqual({ status: "unavailable", reason: "not_found", url: URL_SP });
    expect(agremiacoesFrom(result)).toEqual([]);
  });

  it("5xx → fetch_error", async () => {
    mockFetch(async () => new Response("boom", { status: 503 }));
    expect(await readDeputadoUfDetail(6, "SP")).toMatchObject({
      status: "unavailable",
      reason: "fetch_error",
    });
  });

  it("rede caiu → fetch_error, sem propagar exceção", async () => {
    mockFetch(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await readDeputadoUfDetail(6, "SP")).toMatchObject({
      status: "unavailable",
      reason: "fetch_error",
    });
  });

  it("JSON inválido → invalid", async () => {
    mockFetch(async () => new Response("não é json", { status: 200 }));
    expect(await readDeputadoUfDetail(6, "SP")).toMatchObject({
      status: "unavailable",
      reason: "invalid",
    });
  });

  it("blob de OUTRA UF → invalid (o objeto é autodescritivo por isto)", async () => {
    mockFetch(async () => new Response(JSON.stringify(detalhe("RJ")), { status: 200 }));
    expect(await readDeputadoUfDetail(6, "SP")).toMatchObject({
      status: "unavailable",
      reason: "invalid",
    });
  });

  it("ambiente sem Blob → not_configured, sem sequer tentar o fetch", async () => {
    delete process.env.BLOB_PUBLIC_BASE_URL;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const spy = mockFetch(async () => new Response("", { status: 200 }));

    expect(await readDeputadoUfDetail(6, "SP")).toEqual({
      status: "unavailable",
      reason: "not_configured",
      url: null,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("sigla malformada → invalid, sem lançar", async () => {
    expect(await readDeputadoUfDetail(6, "SPP")).toEqual({
      status: "unavailable",
      reason: "invalid",
      url: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Ordenação determinística — constituição § 6
// ---------------------------------------------------------------------------

describe("ordenação — desempate explícito (constituição § 6)", () => {
  it("agremiações: cadeiras desc → votos desc → sigla asc", () => {
    const entrada = [
      agremiacao({ cod: "1", sigla: "ZZZ", cadeiras: 3, votos_validos: 100 }),
      agremiacao({ cod: "2", sigla: "AAA", cadeiras: 5, votos_validos: 500 }),
      // Empatada em cadeiras com "1" e com MAIS votos: passa na frente dela.
      agremiacao({ cod: "3", sigla: "MMM", cadeiras: 3, votos_validos: 200 }),
      // Empatada em cadeiras E em votos com "1": desempata pela sigla.
      agremiacao({ cod: "4", sigla: "BBB", cadeiras: 3, votos_validos: 100 }),
    ];

    expect(ordenarAgremiacoes(entrada).map((a) => a.sigla)).toEqual(["AAA", "MMM", "BBB", "ZZZ"]);
  });

  it("a ordenação não depende da ordem de entrada — o mesmo conjunto embaralhado dá o mesmo resultado", () => {
    // Asserção negativa disfarçada: se o comparador tivesse um empate sem
    // desempate, duas permutações do MESMO conjunto sairiam diferentes, e a
    // lista trocaria de ordem entre ciclos sem nenhum dado ter mudado.
    const base = [
      agremiacao({ cod: "1", sigla: "ZZZ", cadeiras: 3, votos_validos: 100 }),
      agremiacao({ cod: "4", sigla: "BBB", cadeiras: 3, votos_validos: 100 }),
      agremiacao({ cod: "3", sigla: "MMM", cadeiras: 3, votos_validos: 100 }),
    ];
    const esperado = ordenarAgremiacoes(base).map((a) => a.cod);

    expect(ordenarAgremiacoes([...base].reverse()).map((a) => a.cod)).toEqual(esperado);
    expect(
      ordenarAgremiacoes([base[1], base[2], base[0]] as DeputadoUfAgremiacao[]).map((a) => a.cod),
    ).toEqual(esperado);
  });

  it("candidatos: ordem asc, com sqcand como desempate estável", () => {
    const entrada = [
      { sqcand: 300, nome: "C", partido: "PL", votos: 10, ordem: 2 },
      { sqcand: 100, nome: "A", partido: "PL", votos: 30, ordem: 1 },
      { sqcand: 200, nome: "B", partido: "PL", votos: 20, ordem: 2 },
    ];
    expect(ordenarCandidatos(entrada).map((c) => c.sqcand)).toEqual([100, 200, 300]);
  });
});

// ---------------------------------------------------------------------------
// D2 / RF-125.1 sobre a fixture real
// ---------------------------------------------------------------------------

describe("fixture dep-uf.json — o contrato de D2 (RF-125.1)", () => {
  const fixture = depUfFixture as unknown as Record<string, DeputadoUfDetail>;

  it("nenhum objeto de UF menciona `vagas_obtidas`", () => {
    // `vagas_obtidas` é o bookkeeping do denominador da média (Res.-TSE 23.677
    // art. 11 § 5º, ADI 5.420): conta o quociente partidário INTEIRO ainda que
    // não preenchido, e numa UF de 10 vagas soma 11. Ele fica dentro do
    // `cadeiras.py` e não atravessa a fronteira, sob nome nenhum.
    expect(JSON.stringify(fixture)).not.toContain("vagas_obtidas");
  });

  it("Σ cadeiras + vagas não preenchidas === lugares_a_preencher, em toda UF", () => {
    for (const [uf, detail] of Object.entries(fixture)) {
      const soma = detail.agremiacoes.reduce((acc, a) => acc + a.cadeiras, 0);
      expect(soma + detail.vagas_nao_preenchidas, `${uf}`).toBe(detail.lugares_a_preencher);
    }
  });

  it("cada agremiação tem exatamente `cadeiras` eleitos", () => {
    for (const [uf, detail] of Object.entries(fixture)) {
      for (const agr of detail.agremiacoes) {
        expect(agr.eleitos.length, `${uf}/${agr.sigla}`).toBe(agr.cadeiras);
      }
    }
  });

  it("`sqcand` é único dentro da UF — a identidade não é `cand.n`", () => {
    // No proporcional o número de urna se repete entre UFs e entre partidos.
    // Se alguém trocar a identidade por ele, este teste cai.
    for (const [uf, detail] of Object.entries(fixture)) {
      const ids = detail.agremiacoes.flatMap((a) =>
        [...a.eleitos, ...a.suplentes].map((c) => c.sqcand),
      );
      expect(new Set(ids).size, `${uf}`).toBe(ids.length);
    }
  });

  it("`sigla_lider` existe em toda agremiação, e em partido isolado é a própria sigla", () => {
    // É esta igualdade que autoriza a tela a chamar `colorForParty(sigla_lider)`
    // sem perguntar `tipo` (ADR-0024 linha 41, design 017 § D5/D6). Se o
    // produtor parar de mantê-la, o ramo único passa a colorir partidos
    // isolados pelo campo errado — e nada mais falharia.
    for (const [uf, detail] of Object.entries(fixture)) {
      for (const agr of detail.agremiacoes) {
        expect(typeof agr.sigla_lider, `${uf}/${agr.sigla}`).toBe("string");
        expect(agr.sigla_lider.length, `${uf}/${agr.sigla}`).toBeGreaterThan(0);
        if (agr.tipo === "partido") {
          expect(agr.sigla_lider, `${uf}/${agr.sigla} isolado`).toBe(agr.sigla);
        }
      }
    }
  });

  it("em federação, `sigla_lider` é um dos `componentes`", () => {
    // Um líder fora da composição seria um partido que não está na federação
    // dando a cor dela.
    for (const [uf, detail] of Object.entries(fixture)) {
      for (const agr of detail.agremiacoes) {
        if (agr.tipo !== "federacao") continue;
        expect(agr.componentes, `${uf}/${agr.sigla}`).toContain(agr.sigla_lider);
      }
    }
  });

  it("`divergencias[].o_que` fica no conjunto fechado (design 017 § D6, ampliado pelo 026 § 2.8)", () => {
    // Spec 026 (P1, `9926fc0`) ampliou o conjunto com `eleitos`, `eleitorado`
    // e `votos_validos` — mudança de contrato, espelhada no tipo
    // `DeputadoDivergenciaChave` (`lib/edge-config/types.ts`).
    const CHAVES: readonly DeputadoDivergenciaChave[] = [
      "quociente_eleitoral",
      "cadeiras",
      "eleitos",
      "eleitorado",
      "votos_validos",
    ];
    for (const [uf, detail] of Object.entries(fixture)) {
      for (const d of detail.divergencias) {
        expect(CHAVES as readonly string[], `${uf}`).toContain(d.o_que);
        // O código da agremiação vai em `detalhe`, não embutido na chave — a
        // tela não decifra strings do modelo.
        expect(d.detalhe.length, `${uf}`).toBeGreaterThan(0);
      }
    }
  });

  it("votos_nominais + votos_legenda === votos_validos (RF-121)", () => {
    for (const [uf, detail] of Object.entries(fixture)) {
      for (const agr of detail.agremiacoes) {
        expect(agr.votos_nominais + agr.votos_legenda, `${uf}/${agr.sigla}`).toBe(
          agr.votos_validos,
        );
      }
    }
  });
});
