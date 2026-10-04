/**
 * tests/unit/api/deputado-lista-assembleia-route.test.ts — spec 027, decisão
 * do dono de 03/10: as rotas de lista das assembleias devolvem TUDO o que a
 * página não levou ao documento (eleitos + 5, mínimo 10 por agremiação —
 * `lib/deputado/lista-documento.ts`).
 *
 *   - `GET /uf/<UF>/deputado-estadual/lista` — o resto do objeto da UF depois
 *     do corte + as 61+ do objeto de lista;
 *   - `GET /uf/DF/deputado-distrital/lista` — rota NOVA (até 03/10 o DF não
 *     tinha): o resto do objeto da UF (o DF não tem objeto de lista).
 *
 * O Blob é simulado com as fixtures do simulado das assembleias (as mesmas que
 * o servidor falso do e2e serve), e a página é cortada pela MESMA função —
 * o que se mede é a costura: documento ∪ resposta = 1..total, sem repetir nem
 * pular rank. O contrato do federal tem o seu teste
 * (`deputado-lista-route.test.ts`), que não muda.
 *
 * Mutação aplicada à mão (03/10) e que este arquivo derruba: o estadual
 * devolvendo só a lista 61+ (o comportamento do federal) — cai "SP estadual:
 * documento ∪ resposta = 1..95".
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as listaDistrital } from "@/app/(dep)/uf/[sigla]/deputado-distrital/lista/route";
import { GET as listaEstadual } from "@/app/(dep)/uf/[sigla]/deputado-estadual/lista/route";
import type { DeputadoUfDetail, DeputadoUfLista } from "@/lib/blob/deputado-uf";
import { linhasNoDocumento, ultimoRankNoDocumento } from "@/lib/deputado/lista-documento";
import distritalUf from "@/tests/fixtures/simulacao/deputado-distrital-uf.json" with {
  type: "json",
};
import estadualUf from "@/tests/fixtures/simulacao/deputado-estadual-uf.json" with { type: "json" };
import estadualLista from "@/tests/fixtures/simulacao/deputado-estadual-uf-lista.json" with {
  type: "json",
};

const BASE = "https://exemplo.test";
const ENV = ["BLOB_PUBLIC_BASE_URL", "BLOB_READ_WRITE_TOKEN", "FIXTURE_VARIANT"];
const salvo: Record<string, string | undefined> = {};

const SP = (estadualUf as unknown as Record<string, DeputadoUfDetail>).SP as DeputadoUfDetail;
const LISTA_SP = (estadualLista as unknown as Record<string, DeputadoUfLista>)
  .SP as DeputadoUfLista;
const DF = (distritalUf as unknown as Record<string, DeputadoUfDetail>).DF as DeputadoUfDetail;

beforeEach(() => {
  for (const k of ENV) salvo[k] = process.env[k];
  process.env.BLOB_PUBLIC_BASE_URL = BASE;
  delete process.env.FIXTURE_VARIANT;
});

afterEach(() => {
  for (const k of ENV) {
    if (salvo[k] === undefined) delete process.env[k];
    else process.env[k] = salvo[k];
  }
  vi.restoreAllMocks();
});

/** O Blob: caminho → corpo (ou status). O que não está no mapa é 404. */
function mockBlob(objetos: Record<string, unknown | number>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string) => {
    const caminho = String(url).slice(BASE.length + 1);
    const o = objetos[caminho];
    if (o === undefined) return new Response("not found", { status: 404 });
    if (typeof o === "number") return new Response("boom", { status: o });
    return new Response(JSON.stringify(o), { status: 200 });
  }) as typeof fetch);
}

function urls(spy: ReturnType<typeof mockBlob>): string[] {
  return spy.mock.calls.map((c) => String(c[0]).slice(BASE.length + 1));
}

function params(sigla: string) {
  return { params: Promise.resolve({ sigla }) };
}

const ate = (k: number) => Array.from({ length: k }, (_, i) => i + 1);

/** Por agremiação: os ranks que a página leva + os que a rota devolve. */
function costura(detalhe: DeputadoUfDetail, resposta: DeputadoUfLista) {
  return detalhe.agremiacoes.map((agr) => {
    // A página com a projeção oculta — o mesmo R da rota (o piso).
    const r = ultimoRankNoDocumento(agr, {
      totalizacaoFinal: detalhe.totalizacao_final,
      projecaoVisivel: false,
    });
    const doc = linhasNoDocumento(agr.candidatos ?? [], r).map((l) => l.rank);
    const rest =
      resposta.agremiacoes.find((a) => a.cod === agr.cod)?.candidatos.map((l) => l.rank) ?? [];
    return { cod: agr.cod, total: agr.total_candidatos ?? 0, ranks: [...doc, ...rest] };
  });
}

describe("GET /uf/<UF>/deputado-estadual/lista — o resto do documento", () => {
  it("🔴 SP estadual: documento ∪ resposta = 1..95 em toda agremiação, sem repetir nem pular", async () => {
    const spy = mockBlob({
      "deputado-estadual/uf/SP.json": SP,
      "deputado-estadual/uf-lista/SP.json": LISTA_SP,
    });
    const res = await listaEstadual(
      new Request("http://x/uf/SP/deputado-estadual/lista"),
      params("SP"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    const corpo = (await res.json()) as DeputadoUfLista;
    expect(corpo).toMatchObject({ ts: SP.ts, cargo: 7, uf: "SP", contrato: 2 });
    for (const a of costura(SP, corpo)) expect(a.ranks, a.cod).toEqual(ate(a.total));
    // Lê o objeto da UF e o de lista — e nada do federal.
    expect(urls(spy)).toEqual([
      "deputado-estadual/uf/SP.json",
      "deputado-estadual/uf-lista/SP.json",
    ]);
  });

  it("🔴 a UF declara lista 61+ e o objeto de lista não existe ⇒ 404 `no-store` (nunca o resto sem as 61+)", async () => {
    mockBlob({ "deputado-estadual/uf/SP.json": SP });
    const res = await listaEstadual(
      new Request("http://x/uf/SP/deputado-estadual/lista"),
      params("SP"),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("🔴 objeto de lista falhou ⇒ 502 `no-store`", async () => {
    mockBlob({ "deputado-estadual/uf/SP.json": SP, "deputado-estadual/uf-lista/SP.json": 503 });
    const res = await listaEstadual(
      new Request("http://x/uf/SP/deputado-estadual/lista"),
      params("SP"),
    );
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("🔴 objeto da UF falhou ⇒ 502 `no-store`, sem ler a lista", async () => {
    const spy = mockBlob({ "deputado-estadual/uf/SP.json": 503 });
    const res = await listaEstadual(
      new Request("http://x/uf/SP/deputado-estadual/lista"),
      params("SP"),
    );
    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(urls(spy)).toEqual(["deputado-estadual/uf/SP.json"]);
  });

  it("UF sem lista 61+ declarada: o resto vem só do objeto da UF, e a lista nem é lida", async () => {
    const semLista = structuredClone(SP);
    delete semLista.lista;
    for (const a of semLista.agremiacoes) a.total_candidatos = a.candidatos?.length ?? 0;
    const spy = mockBlob({ "deputado-estadual/uf/SP.json": semLista });
    const res = await listaEstadual(
      new Request("http://x/uf/SP/deputado-estadual/lista"),
      params("SP"),
    );
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as DeputadoUfLista;
    for (const a of costura(semLista, corpo)) expect(a.ranks, a.cod).toEqual(ate(a.total));
    expect(urls(spy)).toEqual(["deputado-estadual/uf/SP.json"]);
  });
});

describe("GET /uf/DF/deputado-distrital/lista — rota nova (03/10)", () => {
  it("🔴 o arquivo existe, fora de /api (BotID), e é dinâmico", async () => {
    const caminho = "app/(dep)/uf/[sigla]/deputado-distrital/lista/route.ts";
    expect(fs.existsSync(path.join(process.cwd(), caminho))).toBe(true);
    const modulo = await import("@/app/(dep)/uf/[sigla]/deputado-distrital/lista/route");
    expect(modulo.dynamic).toBe("force-dynamic");
    expect("revalidate" in modulo).toBe(false);
  });

  it("🔴 DF: documento ∪ resposta = 1..25, e o objeto de lista nunca é lido", async () => {
    const spy = mockBlob({ "deputado-distrital/uf/DF.json": DF });
    const res = await listaDistrital(
      new Request("http://x/uf/DF/deputado-distrital/lista"),
      params("df"),
    );
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as DeputadoUfLista;
    expect(corpo).toMatchObject({ cargo: 8, uf: "DF" });
    for (const a of costura(DF, corpo)) expect(a.ranks, a.cod).toEqual(ate(a.total));
    expect(urls(spy)).toEqual(["deputado-distrital/uf/DF.json"]);
  });

  it("🔴 outra UF (não tem Câmara Legislativa) ⇒ 404 `no-store`, sem tocar o Blob", async () => {
    const spy = mockBlob({});
    for (const sigla of ["SP", "GO", "ZZ"]) {
      const res = await listaDistrital(
        new Request(`http://x/uf/${sigla}/deputado-distrital/lista`),
        params(sigla),
      );
      expect(res.status, sigla).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("objeto do DF inexistente ⇒ 404 `no-store`", async () => {
    mockBlob({});
    const res = await listaDistrital(
      new Request("http://x/uf/DF/deputado-distrital/lista"),
      params("DF"),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
