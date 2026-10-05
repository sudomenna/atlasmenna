/**
 * tests/unit/painel/ler.test.ts
 *
 * Leitura do retrato (`lib/painel/ler.ts`, ADR-0077): a validação de forma e o
 * caminho do Blob PRIVADO (com `@vercel/blob` simulado — nenhum teste vai à
 * rede). O caminho do arquivo local (`NODE_ENV=development`) é o que o
 * `pnpm dev` usa e foi conferido no navegador.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob", () => ({ get }));

import { montarRetrato } from "@/lib/painel/agregar";
import { lerRetrato, validarRetrato } from "@/lib/painel/ler";
import { PAINEL_BLOB_PATHNAME } from "@/lib/painel/tipos";

const T0 = Date.parse("2026-10-04T19:30:00Z");

function retratoValido() {
  return montarRetrato({
    deMs: T0,
    ateMs: T0 + 30 * 60_000,
    turno: 1,
    ambiente: "production",
    geradoEmMs: T0,
    nomes: {
      1: "Presidente",
      3: "Governador",
      5: "Senador",
      6: "Deputado Federal",
      7: "Deputado Estadual",
      8: "Deputado Distrital",
    },
    ingest: [],
    novidades: [],
    rodadas: [],
    agregadosPresidente: [],
    ultimasVersoes: [],
    commits: [],
    gitRef: "origin/main",
    correcoesDeMs: T0,
    correcoesAteMs: T0,
  });
}

function respostaDoBlob(corpo: string) {
  return {
    statusCode: 200,
    stream: new Response(corpo).body,
    headers: new Headers(),
    blob: {},
  };
}

beforeEach(() => {
  get.mockReset();
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validarRetrato", () => {
  it("aceita o que montarRetrato produz", () => {
    const r = retratoValido();
    expect(validarRetrato(JSON.parse(JSON.stringify(r)))).not.toBeNull();
  });

  it("recusa outra versão, lista faltando e série com tamanho diferente do eixo", () => {
    const r = retratoValido();
    expect(validarRetrato({ ...r, versao: 2 })).toBeNull();
    expect(validarRetrato({ ...r, ciclos: undefined })).toBeNull();
    const truncado = JSON.parse(JSON.stringify(r));
    truncado.porMinuto.pedidosEstimados["6"].pop();
    expect(validarRetrato(truncado)).toBeNull();
    expect(validarRetrato(null)).toBeNull();
    expect(validarRetrato("texto")).toBeNull();
  });
});

describe("lerRetrato fora de desenvolvimento — Blob PRIVADO", () => {
  it("sem credencial do Blob: 'ausente', sem chamar o Blob", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const r = await lerRetrato();
    expect(r.status).toBe("ausente");
    expect(get).not.toHaveBeenCalled();
  });

  it("lê do caminho certo, com access 'private', e valida", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_teste_123");
    get.mockResolvedValue(respostaDoBlob(JSON.stringify(retratoValido())));
    const r = await lerRetrato();
    expect(r.status).toBe("ok");
    expect(get).toHaveBeenCalledWith(
      PAINEL_BLOB_PATHNAME,
      expect.objectContaining({ access: "private" }),
    );
  });

  it("blob inexistente vira 'ausente'; JSON quebrado e formato errado viram 'erro' — nunca exceção", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_teste_123");
    get.mockResolvedValueOnce(null);
    expect((await lerRetrato()).status).toBe("ausente");
    get.mockResolvedValueOnce(respostaDoBlob("{quebrado"));
    expect((await lerRetrato()).status).toBe("erro");
    get.mockResolvedValueOnce(respostaDoBlob(JSON.stringify({ versao: 99 })));
    expect((await lerRetrato()).status).toBe("erro");
    get.mockRejectedValueOnce(new Error("store não aceita privado"));
    expect((await lerRetrato()).status).toBe("erro");
  });
});
