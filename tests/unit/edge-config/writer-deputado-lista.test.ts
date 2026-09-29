/**
 * tests/unit/edge-config/writer-deputado-lista.test.ts
 *
 * Spec 026 / ADR-0065 D4 — o escritor SEPARA o campo de transporte
 * `lista_restante` do objeto da UF e o grava como objeto próprio em
 * `deputado/uf-lista/<UF>.json`.
 *
 * O que estes testes protegem:
 *
 *   1. 🔴 `lista_restante` **nunca** cai dentro de `deputado/uf/<UF>.json` —
 *      a página baixa esse objeto inteiro no primeiro render, e as posições
 *      61+ custariam peso a todo leitor para servir um clique que poucos dão.
 *      A asserção é sobre o CORPO gravado, serializado — não sobre um campo.
 *   2. A lista vai ao caminho próprio, com o MESMO carimbo `ts` da UF (as duas
 *      peças precisam poder ser datadas juntas, ADR-0065 D4) — e é gravada
 *      ANTES do objeto da UF (design § 2.5: quem lê `lista.restantes > 0` nunca
 *      acha uma lista mais velha que ele).
 *   3. Produtor v1 (sem o campo) ⇒ nenhuma lista gravada; lista sem nenhuma
 *      linha ⇒ não gravada (design § 2.5); malformada ⇒ não gravada, com aviso.
 *   4. Falha da lista não derruba o objeto da UF, nem o ciclo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeputadoUfDetailComTransporte } from "@/lib/blob/deputado-uf";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import { separarListaRestante, writeDeputadoProjection } from "@/lib/edge-config/writer";

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

const logInfoMock = vi.fn();
const logWarnMock = vi.fn();
const logErrorMock = vi.fn();
vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return {
    ...real,
    logInfo: (m: string, c?: unknown) => logInfoMock(m, c),
    logWarn: (m: string, c?: unknown) => logWarnMock(m, c),
    logError: (m: string, c?: unknown) => logErrorMock(m, c),
  };
});

const ENV_KEYS = ["EDGE_CONFIG_TOKEN", "EDGE_CONFIG_ID", "EDGE_CONFIG", "VERCEL_TEAM_ID"] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.EDGE_CONFIG_TOKEN = "tok";
  process.env.EDGE_CONFIG_ID = "ecfg_proj";
  putJsonMock.mockClear();
  logInfoMock.mockReset();
  logWarnMock.mockReset();
  logErrorMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && new URL(url).pathname.endsWith("/items")) {
        return Promise.resolve(new Response("[]", { status: 200 }));
      }
      if (method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify({ sizeInBytes: 40_000, itemCount: 10 }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  vi.unstubAllGlobals();
});

function payload(): EdgePayloadDeputado {
  return {
    ts: "2026-10-04T22:00:00-03:00",
    cargo: 6,
    turno: 1,
    pct_apurado_total: 40,
    ufs_apuradas: 1,
    atualizacao_min: 30,
    bancada: {
      total_cadeiras: 513,
      cadeiras_atribuidas: 70,
      ufs_calculadas: 1,
      ufs_aguardando: 26,
      por_agremiacao: [],
    },
    por_uf: [
      {
        sigla: "SP",
        pct_apurado: 40,
        lugares_a_preencher: 70,
        quociente_eleitoral: 100,
        cadeiras_definidas: 70,
        vagas_nao_preenchidas: 0,
        empates_indeterminados: 0,
        lider: null,
      },
    ],
    insights: [],
    composition: { pre_election: 0, model: 0, actual_results: 1 },
  };
}

/** Uma linha 61+ com nome reconhecível — é por ele que a asserção negativa procura. */
const LINHA_61 = {
  sqcand: 10002630061,
  nome: "SENTINELA-DA-FAIXA-3",
  partido: "PL",
  numero: 2261,
  votos: 4770,
  rank: 61,
  pct_validos: 0.10941,
};

function detalhe(
  uf: string,
  over: Partial<DeputadoUfDetailComTransporte> = {},
): DeputadoUfDetailComTransporte {
  return {
    ts: "2026-10-04T22:00:00-03:00",
    cargo: 6,
    turno: 1,
    contrato: 2,
    uf,
    pct_apurado: 40,
    lugares_a_preencher: 70,
    quociente_eleitoral: 100,
    quociente_eleitoral_tse: null,
    totalizacao_final: false,
    divergencias: [],
    vagas_nao_preenchidas: 0,
    empates_indeterminados: [],
    agremiacoes: [],
    lista: { restantes: 1 },
    ...over,
  };
}

function gravado(pathname: string): unknown {
  const call = putJsonMock.mock.calls.find((c) => c[0] === pathname);
  return call?.[1];
}

describe("separarListaRestante — pura", () => {
  it("o detalhe sai SEM `lista_restante`; a lista sai com o carimbo, a UF e o contrato", () => {
    const { detalhe: d, lista } = separarListaRestante(
      detalhe("sp", { lista_restante: [{ cod: "22", candidatos: [LINHA_61] }] }),
      "2026-10-05T01:00:00.000Z",
    );
    expect(d).not.toHaveProperty("lista_restante");
    expect(JSON.stringify(d)).not.toContain("SENTINELA-DA-FAIXA-3");
    expect(d.ts).toBe("2026-10-05T01:00:00.000Z");
    expect(d.uf).toBe("SP");
    expect(lista).toEqual({
      ts: "2026-10-05T01:00:00.000Z",
      cargo: 6,
      turno: 1,
      contrato: 2,
      uf: "SP",
      agremiacoes: [{ cod: "22", candidatos: [LINHA_61] }],
    });
  });

  it("sem o campo (produtor v1) ⇒ `null`; sem NENHUMA linha ⇒ `null` (design § 2.5)", () => {
    expect(separarListaRestante(detalhe("SP"), "t").lista).toBeNull();
    expect(separarListaRestante(detalhe("SP", { lista_restante: [] }), "t").lista).toBeNull();
    expect(
      separarListaRestante(detalhe("SP", { lista_restante: [{ cod: "22", candidatos: [] }] }), "t")
        .lista,
    ).toBeNull();
  });

  it("malformada ⇒ lista `null`, com aviso — e o detalhe continua SEM o campo", () => {
    const bruto = {
      ...detalhe("SP"),
      lista_restante: "lixo",
    } as unknown as DeputadoUfDetailComTransporte;
    const { detalhe: d, lista } = separarListaRestante(bruto, "t");
    expect(lista).toBeNull();
    expect(d).not.toHaveProperty("lista_restante");
    expect(logWarnMock).toHaveBeenCalledTimes(1);
  });
});

describe("writeDeputadoProjection — dois objetos por UF, nunca um só", () => {
  it("🔴 a faixa 3 NUNCA vai para deputado/uf/<UF>.json; vai para deputado/uf-lista/<UF>.json", async () => {
    await writeDeputadoProjection(payload(), {
      SP: detalhe("SP", { lista_restante: [{ cod: "22", candidatos: [LINHA_61] }] }),
    });

    const principal = gravado("deputado/uf/SP.json");
    expect(principal).toBeDefined();
    expect(JSON.stringify(principal)).not.toContain("SENTINELA-DA-FAIXA-3");
    expect(JSON.stringify(principal)).not.toContain("lista_restante");

    const lista = gravado("deputado/uf-lista/SP.json") as { ts: string; agremiacoes: unknown[] };
    expect(JSON.stringify(lista)).toContain("SENTINELA-DA-FAIXA-3");
    // Mesmo carimbo nas duas peças do mesmo ciclo.
    expect(lista.ts).toBe((principal as { ts: string }).ts);
  });

  it("dentro da UF, a lista é gravada ANTES do objeto da UF (design § 2.5)", async () => {
    await writeDeputadoProjection(payload(), {
      SP: detalhe("SP", { lista_restante: [{ cod: "22", candidatos: [LINHA_61] }] }),
    });
    expect(putJsonMock.mock.calls.map((c) => c[0])).toEqual([
      "deputado/uf-lista/SP.json",
      "deputado/uf/SP.json",
    ]);
  });

  it("produtor v1 ⇒ só o objeto da UF é gravado", async () => {
    await writeDeputadoProjection(payload(), { SP: detalhe("SP") });
    expect(putJsonMock.mock.calls.map((c) => c[0])).toEqual(["deputado/uf/SP.json"]);
  });

  it("a linha de sucesso leva a contagem e os BYTES das listas", async () => {
    await writeDeputadoProjection(payload(), {
      SP: detalhe("SP", { lista_restante: [{ cod: "22", candidatos: [LINHA_61] }] }),
      RJ: detalhe("RJ"),
    });
    const sucesso = logInfoMock.mock.calls.find(
      (c) => c[0] === "global-config deputado projection written",
    )?.[1] as Record<string, number>;
    expect(sucesso.blobWritten).toBe(2);
    expect(sucesso.listasWritten).toBe(1);
    expect(sucesso.listasBytes).toBeGreaterThan(0);
  });

  it("falha na lista NÃO derruba o objeto da UF nem o ciclo — vira `error` no log", async () => {
    // A lista é a PRIMEIRA gravação da UF.
    putJsonMock.mockImplementationOnce(async () => {
      throw new Error("blob 503");
    });
    await expect(
      writeDeputadoProjection(payload(), {
        SP: detalhe("SP", { lista_restante: [{ cod: "22", candidatos: [LINHA_61] }] }),
      }),
    ).resolves.toBeUndefined();
    expect(gravado("deputado/uf/SP.json")).toBeDefined();
    const erro = logErrorMock.mock.calls.find((c) => c[0] === "blob deputado uf write failures");
    expect(String((erro?.[1] as { detail: string }).detail)).toContain("deputado/uf-lista/SP");
  });
});
