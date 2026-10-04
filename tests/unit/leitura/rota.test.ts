/**
 * tests/unit/leitura/rota.test.ts — `app/api/internal/leitura-noite/route.ts`.
 *
 * O ciclo e a ligação de produção são mockados: nada de Edge Config, Blob,
 * feeds ou IA de verdade. Cobre a autenticação (500 sem `CRON_SECRET`, 401
 * sem/errado, Bearer e x-cron-secret), o `?ensaio=1` e a lista de exports.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/leitura/ciclo", () => ({
  executarCicloLeitura: vi.fn(async () => ({
    gravou: true,
    eventosNovos: 2,
    noticias: { buscou: false },
    ia: { tentou: false },
  })),
}));
vi.mock("@/lib/leitura/ciclo-producao", () => ({
  criarDepsProducao: vi.fn((opts: { ensaio: boolean }) => ({ marcador: "deps", ...opts })),
}));

import * as rota from "@/app/api/internal/leitura-noite/route";
import { executarCicloLeitura } from "@/lib/leitura/ciclo";
import { criarDepsProducao } from "@/lib/leitura/ciclo-producao";

const SEGREDO = "segredo-de-teste-123";
const URL_BASE = "http://localhost/api/internal/leitura-noite";

function req(opts: { url?: string; headers?: Record<string, string>; method?: string } = {}) {
  return new NextRequest(opts.url ?? URL_BASE, {
    method: opts.method ?? "GET",
    headers: opts.headers ?? {},
  });
}

beforeEach(() => {
  vi.mocked(executarCicloLeitura).mockClear();
  vi.mocked(criarDepsProducao).mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("rota leitura-noite — autenticação", () => {
  it("sem CRON_SECRET no ambiente: 500 e o ciclo não roda", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await rota.GET(req({ headers: { authorization: `Bearer ${SEGREDO}` } }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "misconfigured" });
    expect(executarCicloLeitura).not.toHaveBeenCalled();
  });

  it("sem segredo no pedido: 401", async () => {
    vi.stubEnv("CRON_SECRET", SEGREDO);
    const res = await rota.GET(req());
    expect(res.status).toBe(401);
    expect(executarCicloLeitura).not.toHaveBeenCalled();
  });

  it("segredo errado (Bearer, x-cron-secret, prefixo do certo): 401", async () => {
    vi.stubEnv("CRON_SECRET", SEGREDO);
    const tentativas: Array<Record<string, string>> = [
      { authorization: "Bearer outro" },
      { "x-cron-secret": "outro" },
      { authorization: `Bearer ${SEGREDO.slice(0, -1)}` },
      { "x-cron-secret": `${SEGREDO}x` },
    ];
    for (const headers of tentativas) {
      const res = await rota.POST(req({ method: "POST", headers }));
      expect(res.status).toBe(401);
    }
    expect(executarCicloLeitura).not.toHaveBeenCalled();
  });

  it("Bearer certo: roda o ciclo de produção (sem ensaio) e devolve o resultado", async () => {
    vi.stubEnv("CRON_SECRET", SEGREDO);
    const res = await rota.GET(req({ headers: { authorization: `Bearer ${SEGREDO}` } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ gravou: true, eventosNovos: 2 });
    expect(criarDepsProducao).toHaveBeenCalledWith({ ensaio: false });
    expect(executarCicloLeitura).toHaveBeenCalledTimes(1);
  });

  it("x-cron-secret certo com ?ensaio=1: deps de ensaio", async () => {
    vi.stubEnv("CRON_SECRET", SEGREDO);
    const res = await rota.POST(
      req({ method: "POST", url: `${URL_BASE}?ensaio=1`, headers: { "x-cron-secret": SEGREDO } }),
    );
    expect(res.status).toBe(200);
    expect(criarDepsProducao).toHaveBeenCalledWith({ ensaio: true });
  });

  it("loga uma linha por ciclo com o prefixo [leitura-noite]", async () => {
    vi.stubEnv("CRON_SECRET", SEGREDO);
    await rota.GET(req({ headers: { authorization: `Bearer ${SEGREDO}` } }));
    const linhas = vi.mocked(console.log).mock.calls.filter((c) => c[0] === "[leitura-noite]");
    expect(linhas).toHaveLength(1);
    expect(JSON.parse(String(linhas[0]?.[1]))).toMatchObject({ gravou: true, eventosNovos: 2 });
  });
});

describe("rota leitura-noite — exports", () => {
  it("só métodos HTTP e configuração de segmento (o next build reprova o resto)", () => {
    expect(Object.keys(rota).sort()).toEqual(["GET", "POST", "dynamic", "maxDuration", "runtime"]);
    expect(rota.runtime).toBe("nodejs");
    expect(rota.dynamic).toBe("force-dynamic");
    expect(rota.maxDuration).toBe(60);
  });
});
