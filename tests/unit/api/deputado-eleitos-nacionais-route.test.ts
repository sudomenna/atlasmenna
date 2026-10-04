/**
 * tests/unit/api/deputado-eleitos-nacionais-route.test.ts
 *
 * GET /deputado-federal/eleitos — spec 026 RF-299 e RF-300 (ADR-0063,
 * emenda de 04/10 (2)). Molde: `deputado-lista-route.test.ts`.
 *
 * O que estes testes protegem:
 *
 *   1. 🔴 A rota fica FORA de `/api` — o BotID de `proxy.ts` barraria o
 *      clique do leitor com 403 `bot_detected` (ADR-0065 D3).
 *   2. Cache: sucesso `public, s-maxage=60, stale-while-revalidate=60`;
 *      🔴 ERRO `no-store` (404 e 502).
 *   3. Lê as 27 UFs do cargo 6 e o interruptor; UF que falhou vai para
 *      `ufs_sem_dado`, nunca vira zero; nenhuma UF ⇒ 404 (ou 502, se alguma
 *      falhou de verdade).
 *   4. Interruptor desligado ⇒ a resposta não leva projeção.
 *   5. Dinâmica (`force-dynamic`): o cache é do CDN, não do ISR.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeputadoUfDetail, DeputadoUfDetailResult } from "@/lib/blob/deputado-uf";
import type { EleitosNacionais } from "@/lib/deputado/eleitos-nacionais";
import { LN } from "@/lib/deputado/eleitos-nacionais-visao";
import type { InterruptorProjecaoLido } from "@/lib/edge-config/reader";
import { BIT_MARCA } from "@/lib/utils/deputado-marcas";
import contratoUf from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

const lerDetalheMock = vi.fn<(cargo: number, uf: string) => Promise<DeputadoUfDetailResult>>();
const lerFotosMock = vi.fn<(cargo: number, uf: string) => Promise<ReadonlySet<string>>>();
const lerInterruptorMock =
  vi.fn<(cargo: number, emSimulacao: boolean) => Promise<InterruptorProjecaoLido>>();

vi.mock("@/app/(dep)/_dados-da-casa", () => ({
  lerDetalheDaCasa: (cargo: number, uf: string) => lerDetalheMock(cargo, uf),
  lerFotosDaCasa: (cargo: number, uf: string) => lerFotosMock(cargo, uf),
}));
vi.mock("@/app/(dep)/_interruptor", () => ({
  lerInterruptorDaTela: (cargo: number, emSimulacao: boolean) =>
    lerInterruptorMock(cargo, emSimulacao),
}));

import { GET } from "@/app/(dep)/deputado-federal/eleitos/route";

const CAMINHO_ROTA = "app/(dep)/deputado-federal/eleitos/route.ts";
const LIGADO: InterruptorProjecaoLido = { ligada: true, pct_minimo: 25, origem: "chave" };
const DESLIGADO: InterruptorProjecaoLido = { ligada: false, pct_minimo: 25, origem: "ausente" };
const PROJ_BITS = BIT_MARCA.PROJECAO | BIT_MARCA.PROJECAO_SOBRA | BIT_MARCA.PROJECAO_APERTADA;

function contrato(uf: string): DeputadoUfDetail | undefined {
  const mapa = contratoUf as unknown as Record<string, DeputadoUfDetail>;
  return mapa[uf] ? structuredClone(mapa[uf]) : undefined;
}

/** As 4 UFs da fixture de contrato respondem; as outras 23, `not_found`. */
function blobDaFixture(falha: Partial<Record<string, "fetch_error" | "invalid">> = {}) {
  lerDetalheMock.mockImplementation(async (_cargo, uf) => {
    const motivo = falha[uf];
    if (motivo) return { status: "unavailable", reason: motivo, url: `x://${uf}` };
    const detail = contrato(uf);
    return detail
      ? { status: "ok", detail, url: `x://${uf}` }
      : { status: "unavailable", reason: "not_found", url: `x://${uf}` };
  });
}

beforeEach(() => {
  lerDetalheMock.mockReset();
  lerFotosMock.mockReset();
  lerInterruptorMock.mockReset();
  lerFotosMock.mockResolvedValue(new Set());
  lerInterruptorMock.mockResolvedValue(LIGADO);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
    const url = "/deputado-federal/eleitos";
    for (const prefixo of padroes.map((p) => p.split(":")[0] as string)) {
      expect(url.startsWith(prefixo), prefixo).toBe(false);
    }
  });

  it("a ilha cliente chama exatamente este endereço", async () => {
    const ilha = fs.readFileSync(
      path.join(process.cwd(), "components/blocks/BancadaEleitosNacional.tsx"),
      "utf8",
    );
    expect(ilha).toContain('ROTA_ELEITOS_NACIONAIS = "/deputado-federal/eleitos"');
  });
});

describe("GET — respostas", () => {
  it("UFs publicadas ⇒ 200 com o agregado e o cache do CDN declarado", async () => {
    blobDaFixture();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=60");
    const corpo = (await res.json()) as EleitosNacionais;
    expect(corpo.ufs_total).toBe(27);
    expect(corpo.ufs_liberadas).toEqual(["RR"]);
    expect(corpo.ufs_tse).toEqual(["AC"]);
    expect(corpo.ufs_parcial).toEqual(["AP", "SP"]);
    expect(corpo.ufs_sem_dado).toHaveLength(23);
    // Lê as 27 do cargo 6 — detalhe e fotos — e o interruptor do cargo 6.
    expect(lerDetalheMock).toHaveBeenCalledTimes(27);
    expect(new Set(lerDetalheMock.mock.calls.map(([c]) => c))).toEqual(new Set([6]));
    expect(lerFotosMock).toHaveBeenCalledTimes(27);
    expect(lerInterruptorMock).toHaveBeenCalledWith(6, expect.any(Boolean));
  });

  it("26 UFs lidas e 1 que falhou ⇒ 200, a UF em `ufs_sem_dado`, nada somado como zero", async () => {
    blobDaFixture({ RR: "fetch_error" });
    const res = await GET();
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as EleitosNacionais;
    expect(corpo.ufs_sem_dado).toContain("RR");
    expect(corpo.ufs_liberadas).toEqual([]);
    expect(corpo.agremiacoes.flatMap((a) => a.linhas).some((l) => l[LN.UF] === "RR")).toBe(false);
  });

  it("🔴 interruptor desligado ⇒ a resposta não leva projeção", async () => {
    blobDaFixture();
    lerInterruptorMock.mockResolvedValue(DESLIGADO);
    const corpo = (await (await GET()).json()) as EleitosNacionais;
    expect(corpo.projecao_desligada).toBe(true);
    expect(corpo.ufs_liberadas).toEqual([]);
    for (const a of corpo.agremiacoes) {
      expect(a.cenario).toBe(a.parcial);
      for (const l of a.linhas) expect(l[LN.MARCAS] & PROJ_BITS).toBe(0);
    }
  });

  it("nenhuma UF com dado (antes da apuração) ⇒ 404 `no-store`", async () => {
    lerDetalheMock.mockResolvedValue({ status: "unavailable", reason: "not_found", url: null });
    const res = await GET();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ error: "eleitos_inexistentes" });
  });

  it("ambiente sem Blob ⇒ 404 `no-store`", async () => {
    lerDetalheMock.mockResolvedValue({
      status: "unavailable",
      reason: "not_configured",
      url: null,
    });
    const res = await GET();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("🔴 nenhuma UF e o Blob falhou ⇒ 502 `no-store` (o erro nunca entra no cache)", async () => {
    lerDetalheMock.mockResolvedValue({ status: "unavailable", reason: "fetch_error", url: "x" });
    const res = await GET();
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ error: "blob_indisponivel" });
  });

  it("🔴 exceção inesperada ⇒ 502 `no-store`", async () => {
    lerDetalheMock.mockRejectedValue(new Error("boom"));
    const res = await GET();
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a resposta não tem `votos_projetados` em lugar nenhum (RF-297)", async () => {
    lerDetalheMock.mockImplementation(async (_c, uf) => {
      const detail = contrato(uf);
      if (!detail) return { status: "unavailable", reason: "not_found", url: null };
      for (const a of detail.agremiacoes) {
        a.votos_projetados = 4_242_424;
        for (const l of a.candidatos ?? []) l.votos_projetados = 4_242_424;
      }
      return { status: "ok", detail, url: "x" };
    });
    const texto = await (await GET()).text();
    expect(texto).not.toContain("votos_projetados");
    expect(texto).not.toContain("4242424");
  });

  it("a rota é dinâmica — o cache é do CDN, não do ISR (que guardaria o 502)", async () => {
    const modulo = await import("@/app/(dep)/deputado-federal/eleitos/route");
    expect(modulo.dynamic).toBe("force-dynamic");
    expect(modulo.runtime).toBe("nodejs");
    expect("revalidate" in modulo).toBe(false);
  });
});
