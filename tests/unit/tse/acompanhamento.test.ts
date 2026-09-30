/**
 * tests/unit/tse/acompanhamento.test.ts
 *
 * Unit tests para lib/tse/acompanhamento.ts (EA14/EA15 + detectChangedUfs).
 *
 * Cobre: Fase 1b do plano de prontidão pré-simulado (gating EA14 antes do
 * fan-out EA20). Fail-open é o comportamento central testado aqui — qualquer
 * falha de rede/parse deve marcar TODAS as UFs solicitadas como `changed:
 * true`, nunca lançar para o chamador.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { detectChangedUfs, EA14Schema } from "@/lib/tse/acompanhamento";
import { resetTseRateLimiter } from "@/lib/tse/rate-limiter";

const COD_ELEICAO = "ele2026/619";

function makeEA14(ufsAndamento: Record<string, string>): unknown {
  return {
    ele: "619",
    t: "1",
    f: "o",
    dg: "04/10/2026",
    hg: "20:00:00",
    idg: "1",
    abr: [
      { and: "p", tpabr: "br", cdabr: "br" },
      ...Object.entries(ufsAndamento).map(([uf, and]) => ({
        and,
        tpabr: "uf",
        cdabr: uf.toLowerCase(),
        dt: "04/10/2026",
        ht: "20:00:00",
        s: { ts: "100", st: "50", pst: "50,00" },
        e: { te: "10000", c: "5000" },
      })),
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetTseRateLimiter();
});

describe("EA14Schema", () => {
  it("parseia um EA14 válido com abr br + uf", () => {
    const fx = makeEA14({ sp: "p", rj: "f" });
    const parsed = EA14Schema.parse(fx);
    expect(parsed.abr).toHaveLength(3);
  });
});

describe("detectChangedUfs", () => {
  it("primeiro ciclo (previous: null) — todas as UFs voltam changed:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify(makeEA14({ sp: "p", rj: "p" })), { status: 200 }),
      ),
    );

    const signals = await detectChangedUfs({
      cargo: 1,
      codEleicao: COD_ELEICAO,
      ufs: ["SP", "RJ"],
      previous: null,
    });

    expect(signals).toHaveLength(2);
    expect(signals.every((s) => s.changed)).toBe(true);
    expect(signals.every((s) => s.hash !== null)).toBe(true);
  });

  it("2º ciclo sem mudança de conteúdo — changed:false para a UF cujo hash bate", async () => {
    const body = JSON.stringify(makeEA14({ sp: "p" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 200 })),
    );

    const first = await detectChangedUfs({
      cargo: 1,
      codEleicao: COD_ELEICAO,
      ufs: ["SP"],
      previous: null,
    });
    const firstHash = first[0]?.hash;
    expect(firstHash).not.toBeNull();

    const second = await detectChangedUfs({
      cargo: 1,
      codEleicao: COD_ELEICAO,
      ufs: ["SP"],
      previous: { etag: null, hashes: { SP: firstHash as string } },
    });

    expect(second[0]?.changed).toBe(false);
  });

  it("UF com `and` diferente entre ciclos — changed:true", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        const and = call === 1 ? "p" : "f"; // totalização avançou entre ciclos
        return new Response(JSON.stringify(makeEA14({ sp: and })), { status: 200 });
      }),
    );

    const first = await detectChangedUfs({
      cargo: 1,
      codEleicao: COD_ELEICAO,
      ufs: ["SP"],
      previous: null,
    });
    const second = await detectChangedUfs({
      cargo: 1,
      codEleicao: COD_ELEICAO,
      ufs: ["SP"],
      previous: { etag: null, hashes: { SP: first[0]?.hash as string } },
    });

    expect(second[0]?.changed).toBe(true);
  });

  it("304 (ETag hit) — todas as UFs voltam changed:false preservando hash anterior", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 304 })),
    );

    const signals = await detectChangedUfs({
      cargo: 1,
      codEleicao: COD_ELEICAO,
      ufs: ["SP", "RJ"],
      previous: { etag: '"abc"', hashes: { SP: "hash-sp", RJ: "hash-rj" } },
    });

    expect(signals.every((s) => s.changed === false)).toBe(true);
    expect(signals.find((s) => s.uf === "SP")?.hash).toBe("hash-sp");
  });

  it("fail-open em erro de rede — todas as UFs voltam changed:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const signals = await detectChangedUfs({
      cargo: 1,
      codEleicao: COD_ELEICAO,
      ufs: ["SP", "RJ", "MG"],
      previous: { etag: null, hashes: {} },
    });

    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s.changed)).toBe(true);
    expect(signals.every((s) => s.hash === null)).toBe(true);
  });

  it("fail-open em status HTTP inesperado (5xx)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("erro interno", { status: 500 })),
    );

    const signals = await detectChangedUfs({
      cargo: 1,
      codEleicao: COD_ELEICAO,
      ufs: ["SP"],
      previous: null,
    });

    expect(signals[0]?.changed).toBe(true);
  });

  it("fail-open em JSON malformado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{ isso não é json válido", { status: 200 })),
    );

    const signals = await detectChangedUfs({
      cargo: 1,
      codEleicao: COD_ELEICAO,
      ufs: ["SP"],
      previous: null,
    });

    expect(signals[0]?.changed).toBe(true);
  });

  it("fail-open individual quando a UF solicitada não aparece no EA14", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(makeEA14({ sp: "p" })), { status: 200 })),
    );

    const signals = await detectChangedUfs({
      cargo: 1,
      codEleicao: COD_ELEICAO,
      ufs: ["SP", "AC"], // AC não está no EA14 sintético
      previous: null,
    });

    expect(signals.find((s) => s.uf === "SP")?.hash).not.toBeNull();
    expect(signals.find((s) => s.uf === "AC")?.changed).toBe(true);
    expect(signals.find((s) => s.uf === "AC")?.hash).toBeNull();
  });
});
