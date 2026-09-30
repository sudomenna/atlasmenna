/**
 * tests/unit/api/edge-write-assembleias.test.ts
 *
 * Spec 027 RF-279 — o teste de COLISÃO da gravação: um corpo de Deputado
 * Estadual (cargo 7) que chega a `/api/internal/edge-write` grava em
 * `projection-current-est-t1` e em `deputado-estadual/uf/SP.json` — e **não
 * toca** `deputado/uf/SP.json` nem `projection-current-dep-t1`.
 *
 * Por que a rota inteira, com o escritor REAL: o defeito que isto pega não mora
 * numa função só. Até 29/09 havia três pontos fixos no cargo 6 em série — o
 * schema (`z.literal(6)`), a chave (`currentProjectionKey(cargoToken(6), 1)`)
 * e o caminho (`deputado/uf/<SIGLA>`) —, e consertar só um deles produz uma
 * gravação que PASSA: SP estadual escrito por cima de SP federal, com JSON
 * válido e 200 na resposta. Só o percurso inteiro mostra isso.
 *
 * Simulados: a API da Vercel (`fetch`) e o `putJson` do Blob. Nada fala com a
 * rede.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const logErrorMock = vi.fn();
vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return {
    ...real,
    logInfo: () => {},
    logWarn: () => {},
    logError: (m: string, c?: unknown) => logErrorMock(m, c),
  };
});

import { POST } from "@/app/api/internal/edge-write/route";

const SEGREDO = "segredo-assembleias";
const ENV = [
  "MODEL_SECRET",
  "EDGE_CONFIG_TOKEN",
  "EDGE_CONFIG_ID",
  "EDGE_CONFIG",
  "VERCEL_TEAM_ID",
];
const envOriginal: Record<string, string | undefined> = {};

/** A API da Vercel: metadados/itens do store (guarda de tamanho) e o PATCH. */
function apiVercel() {
  const mock = vi.fn((url: string, init?: RequestInit) => {
    const metodo = init?.method ?? "GET";
    const caminho = new URL(url).pathname;
    if (metodo === "GET" && caminho.endsWith("/items")) {
      return Promise.resolve(new Response("[]", { status: 200 }));
    }
    if (metodo === "GET") {
      return Promise.resolve(
        new Response(JSON.stringify({ sizeInBytes: 40_000, itemCount: 10 }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function chavesGravadas(mock: ReturnType<typeof apiVercel>): string[] {
  return mock.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")
    .map((c) => {
      const corpo = JSON.parse((c[1] as RequestInit).body as string) as {
        items: Array<{ key: string }>;
      };
      return corpo.items[0]?.key ?? "";
    });
}

const caminhosGravados = () => putJsonMock.mock.calls.map((c) => c[0]);

beforeEach(() => {
  for (const k of ENV) {
    envOriginal[k] = process.env[k];
    delete process.env[k];
  }
  process.env.MODEL_SECRET = SEGREDO;
  process.env.EDGE_CONFIG_TOKEN = "tok";
  process.env.EDGE_CONFIG_ID = "ecfg_proj";
  putJsonMock.mockClear();
  logErrorMock.mockReset();
});

afterEach(() => {
  for (const k of ENV) {
    if (envOriginal[k] === undefined) delete process.env[k];
    else process.env[k] = envOriginal[k];
  }
  vi.unstubAllGlobals();
});

function linha(rank: number) {
  return { sqcand: 2600 + rank, nome: `C ${rank}`, partido: "PL", votos: 900 - rank, rank };
}

/** Objeto da UF como o Python manda, com a lista 61+ de transporte. */
function objetoUf(uf: string, cargo: number, comLista = false): Record<string, unknown> {
  return {
    ts: "2026-10-04T23:41:07.312Z",
    cargo,
    turno: 1,
    contrato: 2,
    uf,
    pct_apurado: 40,
    lugares_a_preencher: uf === "DF" ? 24 : 94,
    quociente_eleitoral: 100,
    quociente_eleitoral_tse: null,
    totalizacao_final: false,
    divergencias: [],
    agremiacoes: [{ cod: "22", sigla: "PL", cadeiras: 1, candidatos: [linha(1)] }],
    vagas_nao_preenchidas: 0,
    empates_indeterminados: [],
    ...(comLista ? { lista_restante: [{ cod: "22", candidatos: [linha(61)] }] } : {}),
  };
}

function corpo(cargo: number, payloadsUf: Record<string, unknown>): Record<string, unknown> {
  return {
    payload: {
      ts: "2026-10-04T23:41:07.312Z",
      dado_ts: "2026-10-04T23:30:04Z",
      pares_atrasados: 0,
      cargo,
      turno: 1,
      pct_apurado_total: 40,
      ufs_apuradas: Object.keys(payloadsUf).length,
      atualizacao_min: 5,
      bancada: {
        total_cadeiras: cargo === 8 ? 24 : cargo === 7 ? 1035 : 513,
        cadeiras_atribuidas: 1,
        ufs_calculadas: 1,
        ufs_aguardando: 0,
        por_agremiacao: [],
      },
      por_uf: Object.keys(payloadsUf).map((sigla) => ({ sigla, pct_apurado: 40 })),
      insights: [],
      composition: { pre_election: 0, model: 0, actual_results: 1 },
    },
    payloads_uf: payloadsUf,
  };
}

function req(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/internal/edge-write", {
    method: "POST",
    headers: { "x-model-secret": SEGREDO, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("RF-279 — gravar uma assembleia não toca a casa federal", () => {
  it("🔴 cargo 7: grava `projection-current-est-t1` e `deputado-estadual/uf/SP.json` — e NÃO toca `deputado/uf/SP.json`", async () => {
    const api = apiVercel();
    const res = await POST(req(corpo(7, { SP: objetoUf("SP", 7, true) })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, keys_written: 1 });

    // Global Config: a chave do estadual, e SÓ ela.
    expect(chavesGravadas(api)).toEqual(["projection-current-est-t1"]);
    // Blob: o objeto da UF e a lista 61+ no prefixo do estadual.
    expect(caminhosGravados().sort()).toEqual([
      "deputado-estadual/uf-lista/SP.json",
      "deputado-estadual/uf/SP.json",
    ]);
    // Asserções NEGATIVAS — as que discriminam a colisão.
    expect(caminhosGravados()).not.toContain("deputado/uf/SP.json");
    expect(caminhosGravados()).not.toContain("deputado/uf-lista/SP.json");
    expect(caminhosGravados().some((c) => c.startsWith("deputado/"))).toBe(false);
    expect(chavesGravadas(api)).not.toContain("projection-current-dep-t1");
  });

  it("o objeto gravado leva o `cargo` do payload (autodescritivo, o leitor confere)", async () => {
    apiVercel();
    await POST(req(corpo(7, { SP: objetoUf("SP", 7) })));
    const gravado = putJsonMock.mock.calls.find((c) => c[0] === "deputado-estadual/uf/SP.json");
    expect(gravado?.[1]).toMatchObject({ cargo: 7, uf: "SP" });
  });

  it("cargo 8: grava `projection-current-dis-t1` e `deputado-distrital/uf/DF.json`", async () => {
    const api = apiVercel();
    const res = await POST(req(corpo(8, { DF: objetoUf("DF", 8) })));
    expect(res.status).toBe(200);
    expect(chavesGravadas(api)).toEqual(["projection-current-dis-t1"]);
    expect(caminhosGravados()).toEqual(["deputado-distrital/uf/DF.json"]);
  });

  it("controle: cargo 6 continua gravando onde sempre gravou", async () => {
    const api = apiVercel();
    const res = await POST(req(corpo(6, { SP: objetoUf("SP", 6) })));
    expect(res.status).toBe(200);
    expect(chavesGravadas(api)).toEqual(["projection-current-dep-t1"]);
    expect(caminhosGravados()).toEqual(["deputado/uf/SP.json"]);
  });

  it("🔴 um objeto de UF que declara OUTRO cargo não é gravado em lugar nenhum", async () => {
    // Produtor que misturasse as casas: o SP federal dentro do corpo do
    // estadual. Não pode ir para `deputado-estadual/uf/SP.json` (seria o
    // federal mostrado como estadual) nem para `deputado/uf/SP.json`.
    apiVercel();
    const res = await POST(req(corpo(7, { SP: objetoUf("SP", 6), RJ: objetoUf("RJ", 7) })));
    expect(res.status).toBe(200); // o resumo publica; a falha é da UF
    expect(caminhosGravados()).toEqual(["deputado-estadual/uf/RJ.json"]);
    const erro = logErrorMock.mock.calls.find((c) => c[0] === "blob deputado uf write failures");
    expect(String((erro?.[1] as { detail: string }).detail)).toContain("deputado-estadual/uf/SP");
  });

  it("🔴 o DF no corpo do estadual não vira endereço (o DF não tem assembleia)", async () => {
    apiVercel();
    await POST(req(corpo(7, { SP: objetoUf("SP", 7), DF: objetoUf("DF", 7) })));
    expect(caminhosGravados()).toEqual(["deputado-estadual/uf/SP.json"]);
    expect(caminhosGravados().some((c) => c.includes("/DF.json"))).toBe(false);
  });

  it("cargo fora da tabela (9) ⇒ 400, nada gravado", async () => {
    const api = apiVercel();
    const res = await POST(req(corpo(9, { SP: objetoUf("SP", 9) })));
    expect(res.status).toBe(400);
    expect(chavesGravadas(api)).toEqual([]);
    expect(caminhosGravados()).toEqual([]);
  });
});
