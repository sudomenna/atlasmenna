/**
 * 🔴 05/10/2026 — trava da ingestão após o fechamento do 1º turno
 * (`lib/tse/ingest-suspensao.ts`). Uma chamada avulsa a `/api/ingest/*` não
 * pode rodar um ciclo e fazer o modelo regravar o resultado fechado.
 *
 * O ciclo é exercitado de verdade (`runIngestCycle`), com banco e TSE mockados
 * como em `cron-enabled.test.ts`. `VITEST` é apagado em cada caso para medir o
 * caminho de produção — com ele, a trava fica de fora (é o que deixa os demais
 * testes do ciclo rodarem).
 */

import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(() => ({ from: () => Promise.resolve([]) })) },
  schema: {},
}));
vi.mock("@/lib/tse/client", () => ({
  fetchEA20: vi.fn(),
  getClientStats: () => ({ rateLimited: 0, notFound: 0, errors: 0, requests: 0 }),
  resetClientStats: () => {},
}));

import { runIngestCycle } from "@/lib/tse/ingest-handler";
import {
  INGESTAO_SUSPENSA_ATE,
  ingestaoSuspensa,
  TURNOS_ENCERRADOS,
  travaAtiva,
  turnoEncerrado,
} from "@/lib/tse/ingest-suspensao";

const SEGREDO = "segredo-de-teste";
const req = (segredo = SEGREDO): NextRequest =>
  new Request("https://exemplo.test/api/ingest/presidente", {
    method: "POST",
    headers: { "x-cron-secret": segredo },
  }) as unknown as NextRequest;

const guardadas: Record<string, string | undefined> = {};
const CHAVES = ["VITEST", "CRON_SECRET", "TSE_TURNO", "INGEST_WINDOW_OVERRIDE"];

beforeEach(() => {
  for (const k of CHAVES) guardadas[k] = process.env[k];
  process.env.CRON_SECRET = SEGREDO;
  delete process.env.VITEST;
});
afterEach(() => {
  vi.useRealTimers();
  for (const k of CHAVES) {
    if (guardadas[k] === undefined) delete process.env[k];
    else process.env[k] = guardadas[k];
  }
});

describe("funções puras", () => {
  it("suspensa antes da data, liberada depois; data ilegível falha fechada", () => {
    const limite = Date.parse(INGESTAO_SUSPENSA_ATE);
    expect(ingestaoSuspensa(new Date(limite - 1))).toBe(true);
    expect(ingestaoSuspensa(new Date(limite))).toBe(false);
    expect(ingestaoSuspensa(new Date("2026-10-05T12:00:00-03:00"))).toBe(true);
    expect(ingestaoSuspensa(new Date("2030-01-01"), "lixo")).toBe(true);
  });

  it("o 1º turno está encerrado; o 2º não", () => {
    expect(TURNOS_ENCERRADOS).toEqual([1]);
    expect(turnoEncerrado(1)).toBe(true);
    expect(turnoEncerrado(2)).toBe(false);
  });

  it("a trava só sai do caminho com VITEST exatamente 'true'", () => {
    expect(travaAtiva({})).toBe(true);
    expect(travaAtiva({ VITEST: "1" })).toBe(true);
    expect(travaAtiva({ VITEST: "true" })).toBe(false);
  });
});

describe("runIngestCycle com a trava", () => {
  it("antes da data: 200 { skipped: 'ingestao_suspensa' }", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T20:00:00-03:00"));
    const res = await runIngestCycle(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      skipped: "ingestao_suspensa",
      ate: INGESTAO_SUSPENSA_ATE,
    });
  });

  it("segredo errado continua 401 — a trava não vaza antes da autenticação", async () => {
    const res = await runIngestCycle(req("errado"));
    expect(res.status).toBe(401);
  });

  it("depois da data, com TSE_TURNO=1: 200 { skipped: 'turno_encerrado' }", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T18:00:00-03:00"));
    process.env.TSE_TURNO = "1";
    process.env.INGEST_WINDOW_OVERRIDE = "true";
    const res = await runIngestCycle(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ skipped: "turno_encerrado", turno: 1 });
  });

  it("depois da data, com TSE_TURNO=2: a trava NÃO pula o ciclo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T18:00:00-03:00"));
    process.env.TSE_TURNO = "2";
    process.env.INGEST_WINDOW_OVERRIDE = "true";
    const res = await runIngestCycle(req());
    const corpo = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    expect(corpo.skipped).not.toBe("ingestao_suspensa");
    expect(corpo.skipped).not.toBe("turno_encerrado");
  });
});
