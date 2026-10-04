// @vitest-environment happy-dom
/**
 * ADR-0076 (decisão do dono, 04/10/2026) — o placar ZERADO das telas de
 * Deputado: antes do primeiro boletim, o layout da apuração com tudo em zero —
 * todas as candidaturas do cadastro, com foto, na ordem sorteada do dia — em
 * vez da tela de espera.
 *
 * O gatilho é medido nos dois sentidos:
 *   - chave AUSENTE + detalhe 404 + cadastro ⇒ zerado;
 *   - leitura que FALHOU (Global Config ou Blob) ⇒ a espera honesta de sempre,
 *     sem número nenhum (regra do dono: nunca fabricar zeros sobre falha).
 *
 * Usa o adaptador REAL (`_dados-da-casa.ts`); só as leituras são falsas.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CandidatoIdentidade, CandidatosUfResult } from "@/lib/blob/candidatos";
import type { DeputadoUfDetailResult } from "@/lib/blob/deputado-uf";
import { ordemSorteada, sementeDoTurno } from "@/lib/zerado/ordem";

const readDeputadoProjectionMock = vi.fn();
const readDeputadoProjectionResultMock = vi.fn();
const readDeputadoUfDetailMock = vi.fn<() => Promise<DeputadoUfDetailResult>>();
const readDeputadoUfListaMock = vi.fn();
const readCandidatosUfMock = vi.fn<(uf: string, token: string) => Promise<CandidatosUfResult>>();

vi.mock("@/lib/edge-config/reader", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/edge-config/reader")>();
  return {
    ...real,
    readDeputadoProjection: (c: number) => readDeputadoProjectionMock(c),
    readDeputadoProjectionResult: (c: number) => readDeputadoProjectionResultMock(c),
    readInterruptorProjecao: async () => ({ ligada: false, pct_minimo: 25, origem: "ausente" }),
  };
});

vi.mock("@/lib/blob/deputado-uf", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/blob/deputado-uf")>();
  return {
    ...real,
    readDeputadoUfDetail: () => readDeputadoUfDetailMock(),
    readDeputadoUfLista: (...a: unknown[]) => readDeputadoUfListaMock(...a),
  };
});

vi.mock("@/lib/blob/candidatos", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/blob/candidatos")>();
  return { ...real, readCandidatosUf: (uf: string, t: string) => readCandidatosUfMock(uf, t) };
});

const { renderPaginaUfDeputado } = await import("@/app/(dep)/_pagina-uf-deputado");
const { responderListaDeputado } = await import("@/app/(dep)/_rota-lista-deputado");
const { default: DeputadoFederalPage } = await import("@/app/(dep)/deputado-federal/page");

// ---------------------------------------------------------------------------
// Cadastro: PL com 65 (passa dos 60), uma federação, e NOVO com uma sem foto.
// ---------------------------------------------------------------------------

function cand(sq: number, partido: string, extra: Partial<CandidatoIdentidade> = {}) {
  return {
    sqcand: String(250000000000 + sq),
    numero: 1000 + sq,
    nome_urna: `CANDIDATO ${sq}`,
    nome: `NOME CIVIL ${sq}`,
    partido,
    sob_ressalva: false,
    foto_ok: true,
    ...extra,
  } as CandidatoIdentidade;
}

const FED = "FEDERAÇÃO BRASIL DA ESPERANÇA - FE BRASIL";
const CADASTRO: CandidatoIdentidade[] = [
  ...Array.from({ length: 65 }, (_, i) => cand(i + 1, "PL")),
  cand(101, "PT", { federacao: FED }),
  cand(102, "PC do B", { federacao: FED }),
  cand(103, "PV", { federacao: FED }),
  cand(201, "NOVO"),
  cand(202, "NOVO", { foto_ok: false }),
];

function fatia(uf: string, token: string): CandidatosUfResult {
  return {
    status: "ok",
    url: "https://blob.teste/x.json",
    slice: { uf, cargo: token, candidatos: CADASTRO } as never,
  };
}

const NAO_ACHADO: DeputadoUfDetailResult = {
  status: "unavailable",
  reason: "not_found",
  url: null,
};

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

async function render(cargo: 6 | 7 | 8, uf: string): Promise<Document> {
  return parse(renderToStaticMarkup(await renderPaginaUfDeputado(cargo, uf)));
}

function texto(el: Element | Document | null): string {
  return ((el as Element | null)?.textContent ?? "").replace(/\s+/g, " ");
}

beforeEach(() => {
  vi.stubEnv("BLOB_PUBLIC_BASE_URL", "https://blob.teste");
  for (const m of [
    readDeputadoProjectionMock,
    readDeputadoProjectionResultMock,
    readDeputadoUfDetailMock,
    readDeputadoUfListaMock,
    readCandidatosUfMock,
  ]) {
    m.mockReset();
  }
  readDeputadoProjectionMock.mockResolvedValue(null);
  readDeputadoProjectionResultMock.mockResolvedValue({ estado: "ausente" });
  readDeputadoUfDetailMock.mockResolvedValue(NAO_ACHADO);
  readDeputadoUfListaMock.mockResolvedValue(NAO_ACHADO);
  readCandidatosUfMock.mockImplementation(async (uf, token) => fatia(uf, token));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ADR-0076 — página da UF, placar zerado (chave ausente, detalhe 404)", () => {
  it("federal SP: layout da apuração, 0 de 70, sem espera, sem mais votados, sem legenda de marcas", async () => {
    const doc = await render(6, "SP");
    expect(doc.querySelector("[data-testid='uf-dep-aguardando']")).toBeNull();
    expect(texto(doc)).not.toMatch(/Aguardando dados/);
    expect(texto(doc.querySelector("[data-testid='uf-resumo']"))).toContain("0 de 70");
    expect(texto(doc.querySelector("[data-testid='uf-resumo']"))).toMatch(/0,0\s?%/);
    expect(doc.querySelector("#mais-votados-uf-heading")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-legenda-marcas']")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-atualizacao']")).toBeNull();
    expect(doc.querySelector("[data-marca]")).toBeNull();
    expect(doc.querySelector("[data-testid='uf-agremiacoes']")?.hasAttribute("data-zerado")).toBe(
      true,
    );
  });

  it("agremiações e candidaturas na ORDEM SORTEADA do dia (ordemSorteada, semente do 1º turno)", async () => {
    const doc = await render(6, "SP");
    const semente = sementeDoTurno(1);
    const siglas = [...doc.querySelectorAll("[data-testid='uf-agremiacao'] h3")].map((h) =>
      texto(h).trim(),
    );
    expect(siglas).toEqual(ordemSorteada(["PL", FED, "NOVO"], (s) => s, semente));

    const pl = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='PL']");
    const nomes = [...(pl?.querySelectorAll("ol > li b") ?? [])].map((b) => texto(b));
    const esperado = ordemSorteada(
      CADASTRO.filter((c) => c.partido === "PL"),
      (c) => c.sqcand,
      semente,
    ).map((c) => c.nome_urna);
    // Federal zerado: os 7 visíveis no documento, o resto pela rota da lista.
    expect(nomes).toHaveLength(7);
    expect(nomes.map((n) => n.toUpperCase())).toEqual(esperado.slice(0, 7));
    // Todos com 0 voto.
    const votos = [...(pl?.querySelectorAll("ol > li > span:nth-child(3)") ?? [])].map((s) =>
      texto(s),
    );
    expect(votos.every((v) => v.startsWith("0"))).toBe(true);
  });

  it("toda candidatura tem avatar: foto quando `foto_ok`, iniciais quando não", async () => {
    const doc = await render(6, "SP");
    const novo = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='NOVO']");
    const linhas = novo?.querySelectorAll("ol > li") ?? [];
    expect(linhas).toHaveLength(2);
    const imgs = novo?.querySelectorAll("ol > li img") ?? [];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute("src")).toContain(String(250000000000 + 201));
    // A sem foto cai nas iniciais, no mesmo lugar — nunca um <img> quebrado.
    const semFoto = [...linhas].find((l) => texto(l).includes("CANDIDATO 202"));
    expect(semFoto?.querySelector("img")).toBeNull();
    expect(semFoto?.querySelector("[aria-hidden='true']")).not.toBeNull();
    // PL: 7 linhas no documento, 7 fotos.
    const pl = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='PL']");
    expect(pl?.querySelectorAll("ol > li img")).toHaveLength(7);
  });

  it("federal: 'mostrar todos' com o total; a rota serve o resto do cadastro (rank 8+)", async () => {
    const doc = await render(6, "SP");
    const pl = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='PL']");
    expect(texto(pl?.querySelector("[data-testid='dep-mostrar-todos']") ?? null)).toContain(
      "65 candidatos",
    );
    const res = await responderListaDeputado(6, "SP");
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as {
      agremiacoes: Array<{ cod: string; candidatos: Array<{ rank: number; votos: number }> }>;
    };
    const resto = corpo.agremiacoes.find((a) => a.cod === "PL")?.candidatos ?? [];
    expect(resto.map((l) => l.rank)).toEqual(Array.from({ length: 58 }, (_, i) => i + 8));
    expect(resto.every((l) => l.votos === 0)).toBe(true);
  });

  it("estadual SP: 7 visíveis por agremiação (eleitos 0 + 7) e o resto pela rota", async () => {
    const doc = await render(7, "SP");
    expect(texto(doc.querySelector("[data-testid='uf-resumo']"))).toContain("0 de 94");
    const pl = doc.querySelector("[data-testid='uf-agremiacao'][data-cod='PL']");
    expect(pl?.querySelectorAll("ol > li")).toHaveLength(7);
    expect(pl?.querySelector("[data-testid='dep-mostrar-todos']")).not.toBeNull();
    const res = await responderListaDeputado(7, "SP");
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as {
      agremiacoes: Array<{ cod: string; candidatos: Array<{ rank: number }> }>;
    };
    const resto = corpo.agremiacoes.find((a) => a.cod === "PL")?.candidatos ?? [];
    expect(resto[0]?.rank).toBe(8);
    expect(resto).toHaveLength(58);
  });

  it("distrital DF: 0 de 24", async () => {
    const doc = await render(8, "DF");
    expect(texto(doc.querySelector("[data-testid='uf-resumo']"))).toContain("0 de 24");
  });

  it("payload em `fase: pre_eleicao` também zera", async () => {
    readDeputadoProjectionMock.mockResolvedValue({
      ts: "2026-10-04T10:00:00Z",
      cargo: 6,
      turno: 1,
      fase: "pre_eleicao",
      pct_apurado_total: 0,
      ufs_apuradas: 0,
      atualizacao_min: 30,
      bancada: {
        total_cadeiras: 513,
        cadeiras_atribuidas: 0,
        ufs_calculadas: 0,
        ufs_aguardando: 27,
        por_agremiacao: [],
      },
      por_uf: [],
      insights: [],
      composition: { pre_election: 0, model: 0, actual_results: 0 },
    });
    const doc = await render(6, "SP");
    expect(doc.querySelector("[data-testid='uf-agremiacoes']")?.hasAttribute("data-zerado")).toBe(
      true,
    );
    expect(doc.querySelector("[data-testid='dep-atualizacao']")).toBeNull();
  });
});

describe("🔴 ADR-0076 — leitura que FALHOU nunca zera", () => {
  it("Global Config FALHOU (detalhe 404) ⇒ a espera de sempre, sem número", async () => {
    readDeputadoProjectionResultMock.mockResolvedValue({ estado: "falha", erro: new Error("x") });
    const doc = await render(6, "SP");
    expect(doc.querySelector("[data-testid='uf-dep-aguardando']")).not.toBeNull();
    expect(doc.querySelector("[data-testid='uf-agremiacoes']")).toBeNull();
    expect(texto(doc)).not.toMatch(/0 de 70/);
  });

  it("Blob do detalhe FALHOU (chave ausente) ⇒ a espera de sempre, sem número", async () => {
    readDeputadoUfDetailMock.mockResolvedValue({
      status: "unavailable",
      reason: "fetch_error",
      url: "https://blob.teste/deputado/uf/SP.json",
    });
    const doc = await render(6, "SP");
    expect(doc.querySelector("[data-testid='uf-dep-aguardando']")).not.toBeNull();
    expect(doc.querySelector("[data-testid='uf-agremiacoes']")).toBeNull();
  });

  it("leitura que LANÇA conta como falha, nunca como ausência", async () => {
    readDeputadoProjectionResultMock.mockRejectedValue(new Error("boom"));
    const doc = await render(7, "SP");
    expect(doc.querySelector("[data-testid='uf-dep-aguardando']")).not.toBeNull();
  });

  it("cadastro indisponível ⇒ a espera de sempre (nada a zerar)", async () => {
    readCandidatosUfMock.mockResolvedValue({
      status: "unavailable",
      reason: "fetch_error",
      url: null,
    });
    const doc = await render(6, "SP");
    expect(doc.querySelector("[data-testid='uf-dep-aguardando']")).not.toBeNull();
  });

  it("rota da lista com Global Config FALHO ⇒ 404 de sempre, nunca a lista zerada", async () => {
    readDeputadoProjectionResultMock.mockResolvedValue({ estado: "falha", erro: new Error("x") });
    expect((await responderListaDeputado(6, "SP")).status).toBe(404);
    expect((await responderListaDeputado(7, "SP")).status).toBe(404);
  });
});

describe("ADR-0076 — capa /deputado-federal", () => {
  it("chave ausente ⇒ plenário de 513 sem dono, agremiações a zero, sem espera", async () => {
    const doc = parse(renderToStaticMarkup(await DeputadoFederalPage()));
    expect(doc.querySelector("[data-testid='dep-aguardando']")).toBeNull();
    expect(texto(doc.querySelector("[data-testid='dep-cadeiras-label']"))).toContain(
      "513 cadeiras",
    );
    expect(texto(doc.querySelector("[data-testid='camara-hemiciclo-sem-dono']"))).toContain("513");
    const linhas = [...doc.querySelectorAll("[data-testid='bancada-linha']")];
    expect(linhas.length).toBe(3);
    expect(doc.querySelector("#mais-votados-pais-heading")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-atualizacao']")).toBeNull();
  });

  it("🔴 leitura FALHOU ⇒ a espera honesta, sem 513", async () => {
    readDeputadoProjectionResultMock.mockResolvedValue({ estado: "falha", erro: new Error("x") });
    const doc = parse(renderToStaticMarkup(await DeputadoFederalPage()));
    expect(doc.querySelector("[data-testid='dep-aguardando']")).not.toBeNull();
    expect(texto(doc)).not.toMatch(/513/);
  });
});
