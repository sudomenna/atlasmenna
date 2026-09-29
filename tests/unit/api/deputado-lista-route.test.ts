/**
 * tests/unit/api/deputado-lista-route.test.ts
 *
 * GET /uf/<SIGLA>/deputado-federal/lista — a faixa 3 (posições 61+) da lista
 * de candidaturas de Deputado Federal (spec 026 RF-260, ADR-0065 D3,
 * design § 8.5).
 *
 * O que estes testes protegem:
 *
 *   1. 🔴 A rota fica FORA de `/api` — o BotID de `proxy.ts` roda em `/api/*`
 *      e barraria o clique do leitor com 403 `bot_detected`.
 *   2. Cache: sucesso com `public, s-maxage=60, stale-while-revalidate=300`;
 *      🔴 ERRO com `no-store` — um soluço não pode ficar 6 min no CDN.
 *   3. Sigla fora das 27 ⇒ 404, sem montar caminho de Blob com entrada livre.
 *   4. 200 = o `DeputadoUfLista`; objeto inexistente ⇒ 404; Blob falhou ⇒ 502.
 *   5. Modo simulado: a leitura remota não roda.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/(dep)/uf/[sigla]/deputado-federal/lista/route";
import listaContrato from "@/tests/fixtures/contrato/deputado-uf-lista.json" with { type: "json" };

const BASE = "https://exemplo.test";
const CAMINHO_ROTA = "app/(dep)/uf/[sigla]/deputado-federal/lista/route.ts";

const ENV = ["BLOB_PUBLIC_BASE_URL", "BLOB_READ_WRITE_TOKEN", "FIXTURE_VARIANT"];
const salvo: Record<string, string | undefined> = {};
let nodeEnv: string | undefined;

beforeEach(() => {
  for (const k of ENV) salvo[k] = process.env[k];
  nodeEnv = process.env.NODE_ENV;
  process.env.BLOB_PUBLIC_BASE_URL = BASE;
  delete process.env.FIXTURE_VARIANT;
});

afterEach(() => {
  for (const k of ENV) {
    if (salvo[k] === undefined) delete process.env[k];
    else process.env[k] = salvo[k];
  }
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  vi.restoreAllMocks();
});

/** A lista de SP da fixture de contrato, na UF pedida. */
function lista(uf = "SP"): Record<string, unknown> {
  const sp = (listaContrato as unknown as Record<string, Record<string, unknown>>).SP;
  return { ...JSON.parse(JSON.stringify(sp)), uf };
}

function mockBlob(impl: (url: string) => Promise<Response>) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(((url: string) => impl(String(url))) as typeof fetch);
}

async function pedir(sigla: string): Promise<Response> {
  return GET(new Request(`http://localhost/uf/${sigla}/deputado-federal/lista`), {
    params: Promise.resolve({ sigla }),
  });
}

describe("onde a rota mora — fora do BotID", () => {
  it("🔴 o arquivo está sob app/(dep), e não sob app/api", () => {
    expect(fs.existsSync(path.join(process.cwd(), CAMINHO_ROTA))).toBe(true);
    expect(CAMINHO_ROTA.startsWith("app/api/")).toBe(false);
  });

  it("🔴 a URL da rota não casa com o matcher do BotID em proxy.ts", () => {
    const proxy = fs.readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");
    const bloco = /matcher:\s*\[([^\]]*)\]/.exec(proxy)?.[1] ?? "";
    const padroes = [...bloco.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
    expect(padroes.length).toBeGreaterThan(0);
    // `/api/:path*` → o prefixo literal antes do primeiro `:`.
    const url = "/uf/SP/deputado-federal/lista";
    for (const prefixo of padroes.map((p) => p.split(":")[0] as string)) {
      expect(url.startsWith(prefixo), prefixo).toBe(false);
    }
  });
});

describe("GET — respostas (design § 8.5)", () => {
  it("lista publicada ⇒ 200 com o `DeputadoUfLista`, e o cache do CDN declarado", async () => {
    const spy = mockBlob(async () => new Response(JSON.stringify(lista()), { status: 200 }));
    const res = await pedir("SP");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    expect(await res.json()).toEqual(lista());
    expect(spy).toHaveBeenCalledWith(`${BASE}/deputado/uf-lista/SP.json`, {
      next: { revalidate: 60 },
    });
  });

  it("sigla minúscula é normalizada", async () => {
    mockBlob(async () => new Response(JSON.stringify(lista()), { status: 200 }));
    const res = await pedir("sp");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { uf: string }).uf).toBe("SP");
  });

  it("🔴 sigla fora das 27 ⇒ 404 `no-store`, sem tocar o Blob", async () => {
    const spy = mockBlob(async () => new Response("{}"));
    for (const sigla of ["XX", "ZZ", "SPX", "..", "br"]) {
      const res = await pedir(sigla);
      expect(res.status, sigla).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("objeto de lista inexistente (404 do CDN) ⇒ 404 `no-store`", async () => {
    mockBlob(async () => new Response("not found", { status: 404 }));
    const res = await pedir("RR");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ error: "lista_inexistente", uf: "RR" });
  });

  it("🔴 Blob falhou ⇒ 502 com `no-store` (o erro nunca entra no cache)", async () => {
    mockBlob(async () => new Response("boom", { status: 503 }));
    const res = await pedir("SP");
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ error: "blob_indisponivel", motivo: "fetch_error" });
  });

  it("Blob respondeu a lista de OUTRA UF ⇒ 502 `invalid`, `no-store`", async () => {
    mockBlob(async () => new Response(JSON.stringify(lista("RJ")), { status: 200 }));
    const res = await pedir("SP");
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a rota é dinâmica — o cache é do CDN, não do ISR (que guardaria o 502)", async () => {
    const modulo = await import("@/app/(dep)/uf/[sigla]/deputado-federal/lista/route");
    expect(modulo.dynamic).toBe("force-dynamic");
    expect("revalidate" in modulo).toBe(false);
  });
});

describe("GET — modo simulado", () => {
  it("simulação ligada ⇒ o Blob remoto NÃO é lido", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.FIXTURE_VARIANT = "sim";
    const spy = mockBlob(async () => new Response(JSON.stringify(lista()), { status: 200 }));
    const res = await pedir("SP");
    const temFixture = fs.existsSync(
      path.join(process.cwd(), "tests/fixtures/simulacao/deputado-uf-lista.json"),
    );
    expect(res.status).toBe(temFixture ? 200 : 404);
    expect(spy).not.toHaveBeenCalled();
  });
});
