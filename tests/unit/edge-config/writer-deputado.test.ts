/**
 * tests/unit/edge-config/writer-deputado.test.ts
 *
 * A escrita da corrida PROPORCIONAL — `writeDeputadoProjection` — e as duas
 * travas que o design 017 pede em torno dela.
 *
 * O que estes testes protegem:
 *
 *   1. **A chave.** Até 2026-09-12 `cargoFromTseNumeric` era
 *      `cargoTse === 3 ? "gov" : "pres"`: um payload de cargo 5 ou 6 ia para
 *      `projection-current-pres-t1` e sobrescrevia a projeção presidencial com
 *      outra eleição. Nenhum erro em lugar nenhum — chave válida, JSON válido,
 *      conteúdo de outra corrida. O teste que pega isso é o que confere a
 *      chave EXATA, e ele vale para os quatro cargos.
 *   2. **D1.** O envelope majoritário recusa cargo proporcional, em runtime —
 *      porque a ponte `/api/internal/edge-write` chama `writeProjection` com
 *      `any` e o tipo não a protege ali.
 *   3. **D2 / RF-125.1 — por asserção negativa.** `vagas_obtidas` não pode
 *      aparecer no que vai para o Blob, sob nome nenhum, e `Σ cadeiras` tem de
 *      fechar com `lugares_a_preencher`. A asserção positiva ("`cadeiras` está
 *      certo") passaria com os dois campos presentes.
 *   4. **RF-129.** O detalhe por UF vai para `deputado/uf/<SIGLA>.json` — Blob,
 *      não Global Config —, e uma falha de Blob não derruba a publicação do
 *      resumo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeputadoUfDetail } from "@/lib/blob/deputado-uf";
import type { EdgePayload, EdgePayloadDeputado } from "@/lib/edge-config/types";
import { writeDeputadoProjection, writeProjection } from "@/lib/edge-config/writer";

// Mesmo mock de `putJson` do `writer.test.ts`: o esquema de caminho e a URL
// determinística têm cobertura própria em `tests/unit/blob/paths.test.ts`.
const putJsonMock = vi.fn(async (pathname: string, value: unknown) => ({
  pathname,
  status: "written" as const,
  bytes: JSON.stringify(value).length,
  url: `https://exemplo.test/${pathname}`,
}));
vi.mock("@/lib/blob/write", () => ({
  BLOB_CACHE_CONTROL_MAX_AGE_SECONDS: 60,
  hasBlobWriteCredentials: () => true,
  putJson: (pathname: string, value: unknown) => putJsonMock(pathname, value),
}));

// ---------------------------------------------------------------------------
// Ambiente
// ---------------------------------------------------------------------------

const ENV_KEYS = ["EDGE_CONFIG_TOKEN", "EDGE_CONFIG_ID", "EDGE_CONFIG", "VERCEL_TEAM_ID"] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  putJsonMock.mockClear();
  process.env.EDGE_CONFIG_TOKEN = "tok";
  process.env.EDGE_CONFIG_ID = "ecfg_proj";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Roteia a API da Vercel: GET de metadados/itens e PATCH de upsert. */
function mockVercelApi(opts: { failPatchKeys?: string[] } = {}) {
  const mock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname;

    if (method === "GET" && path.endsWith("/items")) {
      return Promise.resolve(new Response("[]", { status: 200 }));
    }
    if (method === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify({ sizeInBytes: 40_000, itemCount: 10 }), { status: 200 }),
      );
    }

    const body = JSON.parse((init?.body as string) ?? "{}") as { items?: Array<{ key?: string }> };
    const key = body.items?.[0]?.key ?? "";
    if (opts.failPatchKeys?.includes(key)) {
      return Promise.resolve(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function keysWritten(mock: ReturnType<typeof mockVercelApi>): string[] {
  return mock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === "PATCH")
    .map((call) => {
      const init = call[1] as RequestInit;
      const body = JSON.parse(init.body as string) as { items: Array<{ key: string }> };
      return body.items[0]?.key ?? "";
    });
}

// ---------------------------------------------------------------------------
// Fixtures locais — mínimas e explícitas
// ---------------------------------------------------------------------------

function payloadDeputado(over: Partial<EdgePayloadDeputado> = {}): EdgePayloadDeputado {
  return {
    ts: "2026-10-04T22:00:00-03:00",
    cargo: 6,
    turno: 1,
    pct_apurado_total: 40,
    ufs_apuradas: 2,
    atualizacao_min: 15,
    bancada: {
      total_cadeiras: 18,
      cadeiras_atribuidas: 18,
      ufs_calculadas: 2,
      ufs_aguardando: 25,
      por_agremiacao: [
        {
          cod: "22",
          sigla: "PL",
          nome: "Partido Liberal",
          tipo: "partido",
          componentes: [],
          sigla_lider: "PL",
          cadeiras: 10,
          votos_nominais: 900,
          votos_legenda: 100,
          votos_validos: 1000,
          pct_votos: 60,
        },
      ],
    },
    por_uf: [
      {
        sigla: "SP",
        pct_apurado: 40,
        lugares_a_preencher: 10,
        quociente_eleitoral: 100,
        cadeiras_definidas: 10,
        vagas_nao_preenchidas: 0,
        empates_indeterminados: 0,
        lider: { cod: "22", sigla: "PL", cadeiras: 10 },
      },
      {
        sigla: "RJ",
        pct_apurado: 40,
        lugares_a_preencher: 8,
        quociente_eleitoral: 80,
        cadeiras_definidas: 8,
        vagas_nao_preenchidas: 0,
        empates_indeterminados: 0,
        lider: { cod: "22", sigla: "PL", cadeiras: 5 },
      },
    ],
    insights: [],
    composition: { pre_election: 0, model: 1, actual_results: 0 },
    ...over,
  };
}

/**
 * Detalhe de UF com DUAS agremiações cujas `cadeiras` somam
 * `lugares_a_preencher`, e com o bookkeeping `vagas_obtidas` deliberadamente
 * FORA — é o que a asserção negativa de D2 mede.
 */
function detalheUf(uf: string, lugares: number): DeputadoUfDetail {
  const a = Math.ceil(lugares / 2);
  const b = lugares - a;
  return {
    ts: "2026-10-04T22:00:00-03:00",
    cargo: 6,
    turno: 1,
    uf,
    pct_apurado: 40,
    lugares_a_preencher: lugares,
    quociente_eleitoral: 100,
    quociente_eleitoral_tse: 100,
    totalizacao_final: false,
    divergencias: [],
    vagas_nao_preenchidas: 0,
    empates_indeterminados: [],
    agremiacoes: [
      {
        cod: "22",
        sigla: "PL",
        nome: "Partido Liberal",
        tipo: "partido",
        componentes: [],
        sigla_lider: "PL",
        votos_nominais: 900,
        votos_legenda: 100,
        votos_validos: 1000,
        pct_votos: 60,
        quociente_partidario: 10,
        cadeiras: a,
        eleitos: Array.from({ length: a }, (_, i) => ({
          sqcand: 1000 + i,
          nome: `Eleito PL ${i + 1}`,
          partido: "PL",
          votos: 100 - i,
          ordem: i + 1,
        })),
        suplentes: [],
      },
      {
        cod: "13",
        sigla: "FE BRASIL",
        nome: "Federação Brasil da Esperança",
        tipo: "federacao",
        componentes: ["PT", "PCdoB", "PV"],
        sigla_lider: "PT",
        votos_nominais: 600,
        votos_legenda: 70,
        votos_validos: 670,
        pct_votos: 40,
        quociente_partidario: 6,
        cadeiras: b,
        eleitos: Array.from({ length: b }, (_, i) => ({
          sqcand: 2000 + i,
          nome: `Eleito FE ${i + 1}`,
          partido: "PT",
          votos: 90 - i,
          ordem: i + 1,
        })),
        suplentes: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. A chave
// ---------------------------------------------------------------------------

describe("writeDeputadoProjection — a chave", () => {
  it("grava em projection-current-dep-t1, e em nenhum alias", async () => {
    const mock = mockVercelApi();
    await writeDeputadoProjection(payloadDeputado());

    // Exatamente UMA chave. O alias `projection-current` só existiu para a
    // corrida presidencial; replicá-lo aqui criaria uma chave que ninguém lê e
    // que disputaria o 1 MB do store.
    expect(keysWritten(mock)).toEqual(["projection-current-dep-t1"]);
  });

  it("a chave sai do token do cargo, não de um default — o defeito de 11/09", async () => {
    // Asserção negativa: a chave presidencial NÃO pode ser tocada por uma
    // gravação de Deputado. Com o `cargoTse === 3 ? "gov" : "pres"` antigo,
    // era exatamente o que acontecia.
    const mock = mockVercelApi();
    await writeDeputadoProjection(payloadDeputado());

    expect(keysWritten(mock)).not.toContain("projection-current-pres-t1");
    expect(keysWritten(mock)).not.toContain("projection-current");
  });

  it("turno vem do cargo (único), não do payload — um `turno: 2` não inaugura chave", async () => {
    const mock = mockVercelApi();
    // @ts-expect-error — payload malformado é exatamente o caso sob teste.
    await writeDeputadoProjection(payloadDeputado({ turno: 2 }));

    expect(keysWritten(mock)).toEqual(["projection-current-dep-t1"]);
  });

  it.each([
    { cargo: 7, chave: "projection-current-est-t1" },
    { cargo: 8, chave: "projection-current-dis-t1" },
  ] as const)("spec 027 RF-279: payload de cargo $cargo grava em $chave — e não na do federal", async ({
    cargo,
    chave,
  }) => {
    const mock = mockVercelApi();
    await writeDeputadoProjection(payloadDeputado({ cargo }));
    expect(keysWritten(mock)).toEqual([chave]);
    expect(keysWritten(mock)).not.toContain("projection-current-dep-t1");
  });

  it("🔴 payload de cargo que não é proporcional LANÇA antes de gravar qualquer coisa", async () => {
    // A rota chama o escritor com `any`; o tipo não protege ali. Sem esta
    // trava, um cargo 1 viraria `projection-current-pres-t1` com o envelope
    // proporcional — a agulha presidencial sobrescrita pela Câmara.
    const mock = mockVercelApi();
    await expect(
      writeDeputadoProjection(payloadDeputado({ cargo: 1 as unknown as 6 })),
    ).rejects.toThrow(/não é proporcional/);
    expect(keysWritten(mock)).toEqual([]);
    expect(putJsonMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. D1 — o envelope majoritário recusa cargo proporcional
// ---------------------------------------------------------------------------

describe("writeProjection — guarda de cargo proporcional (design 017 § D1)", () => {
  it("recusa cargo 6 com mensagem que aponta a função certa", async () => {
    mockVercelApi();
    // O cast reproduz o que a ponte faz de verdade (`parsed.data.payload as
    // any`): é por isso que a guarda precisa ser de runtime.
    const majoritarioComCargo6 = {
      ts: "2026-10-04T22:00:00-03:00",
      cargo: 6,
      turno: 1,
      pct_apurado_total: 0,
      ufs_apuradas: 0,
      national: {
        candidatos: [],
        needle_position: 0,
        needle_band: "tossup",
        candidato_a_id: null,
        candidato_b_id: null,
        p_segundo_turno_overall: null,
        cenarios_2t: [],
      },
      por_uf: [],
      insights: [],
      composition: { pre_election: 1, model: 0, actual_results: 0 },
    } as unknown as EdgePayload;

    await expect(writeProjection(majoritarioComCargo6)).rejects.toThrow(
      /proporcional.*writeDeputadoProjection/s,
    );
  });

  it("os cargos majoritários continuam passando — a guarda não é um bloqueio geral", async () => {
    const mock = mockVercelApi();
    const senador = {
      ts: "2026-10-04T22:00:00-03:00",
      cargo: 5,
      turno: 1,
      pct_apurado_total: 0,
      ufs_apuradas: 0,
      national: { candidatos: [], needle_position: 0, needle_band: "tossup" },
      por_uf: [],
      insights: [],
      composition: { pre_election: 1, model: 0, actual_results: 0 },
    } as unknown as EdgePayload;

    await writeProjection(senador);

    // E vai para a chave do SENADO — não para a do presidente, que é onde o
    // default antigo o teria enfiado.
    expect(keysWritten(mock)).toContain("projection-current-sen-t1");
    expect(keysWritten(mock)).not.toContain("projection-current-pres-t1");
  });
});

// ---------------------------------------------------------------------------
// 3. D2 / RF-125.1 — asserção negativa sobre o payload de UF
// ---------------------------------------------------------------------------

describe("detalhe por UF — o bookkeeping não atravessa a fronteira (design 017 § D2)", () => {
  it("o objeto serializado não contém a string `vagas_obtidas`", async () => {
    mockVercelApi();
    await writeDeputadoProjection(payloadDeputado(), {
      SP: detalheUf("SP", 10),
      RJ: detalheUf("RJ", 8),
    });

    expect(putJsonMock).toHaveBeenCalledTimes(2);
    for (const [, value] of putJsonMock.mock.calls) {
      // A asserção POSITIVA ("cadeiras está certo") passaria com os dois
      // campos presentes. Só a negativa pega o vazamento.
      expect(JSON.stringify(value)).not.toContain("vagas_obtidas");
    }
  });

  it("Σ agremiacoes[].cadeiras === lugares_a_preencher em cada UF", async () => {
    mockVercelApi();
    await writeDeputadoProjection(payloadDeputado(), {
      SP: detalheUf("SP", 10),
      RJ: detalheUf("RJ", 8),
    });

    for (const [, value] of putJsonMock.mock.calls) {
      const detail = value as DeputadoUfDetail;
      const soma = detail.agremiacoes.reduce((acc, a) => acc + a.cadeiras, 0);
      expect(soma, `${detail.uf}: soma de cadeiras`).toBe(detail.lugares_a_preencher);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. RF-129 — Blob, caminho e independência
// ---------------------------------------------------------------------------

describe("writeDeputadoProjection — o detalhe vai para o Blob (RF-129)", () => {
  it("um objeto por UF em deputado/uf/<SIGLA>.json", async () => {
    mockVercelApi();
    await writeDeputadoProjection(payloadDeputado(), {
      SP: detalheUf("SP", 10),
      RJ: detalheUf("RJ", 8),
    });

    const caminhos = putJsonMock.mock.calls.map(([pathname]) => pathname).sort();
    expect(caminhos).toEqual(["deputado/uf/RJ.json", "deputado/uf/SP.json"]);
  });

  it("o `ts` do Blob é o da gravação, não o do payload nacional", async () => {
    // As duas escritas não são atômicas entre si: um ciclo pode publicar o
    // resumo e falhar o detalhe, e a UI precisa poder datar os dois
    // separadamente. Mesma decisão de `splitUfPayload` (ADR-0032).
    mockVercelApi();
    const payload = payloadDeputado();
    await writeDeputadoProjection(payload, { SP: detalheUf("SP", 10) });

    const [, value] = putJsonMock.mock.calls[0] as [string, DeputadoUfDetail];
    expect(value.ts).not.toBe(payload.ts);
    expect(Number.isFinite(Date.parse(value.ts))).toBe(true);
  });

  it("sem detalhes, nada vai para o Blob — e o resumo publica do mesmo jeito", async () => {
    const mock = mockVercelApi();
    await writeDeputadoProjection(payloadDeputado());

    expect(putJsonMock).not.toHaveBeenCalled();
    expect(keysWritten(mock)).toEqual(["projection-current-dep-t1"]);
  });

  it("falha de Blob NÃO derruba o ciclo — o resumo vale mais (ADR-0032 item 3)", async () => {
    mockVercelApi();
    vi.spyOn(console, "error").mockImplementation(() => {});
    putJsonMock.mockRejectedValueOnce(new Error("blob fora do ar"));

    await expect(
      writeDeputadoProjection(payloadDeputado(), { SP: detalheUf("SP", 10) }),
    ).resolves.toBeUndefined();
  });

  it("falha do Global Config lança, nomeando a chave", async () => {
    const mock = mockVercelApi({ failPatchKeys: ["projection-current-dep-t1"] });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(writeDeputadoProjection(payloadDeputado())).rejects.toThrow(
      /projection-current-dep-t1/,
    );
    expect(keysWritten(mock)).toEqual(["projection-current-dep-t1"]);
  });
});
