// @vitest-environment happy-dom
/**
 * tests/unit/pages/anulada-paginas.test.tsx
 *
 * ADR-0053 / RF-213 — os derivadores que vivem DENTRO das páginas (e não num
 * componente ou utilitário testável sozinho):
 *
 *   - `/` (Presidente): `lider`/`segundo`/`liderParcial` escolhidos por `rank`
 *     alimentam o painel "Segundo turno?" — com a anulada em `rank` 1, o painel
 *     diria "<anulada> vence no 1º turno" (com o `p_fecha_1t = 0` que o modelo
 *     dá a ela);
 *   - `/senador`: o cartão por estado (formato de `/governador` desde 27/09) e a margem da
 *     2ª vaga, montados a partir de `top_candidatos`;
 *   - `/uf/[sigla]/senador`: o elenco do painel de chances (`vagas + 1`).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/(pres)/page";
import SenadoPage from "@/app/(sen)/senador/page";
import UFSenadorPage from "@/app/(sen)/uf/[sigla]/senador/page";
import type {
  EdgeCandidate,
  EdgePayload,
  EdgePayloadUf,
  EdgeUfCandidate,
} from "@/lib/edge-config/types";
import fixture from "@/tests/fixtures/edge-config/projection-current.json" with { type: "json" };

const readProjectionMock = vi.fn();
const readNationalProjectionMock = vi.fn();
const readUfProjectionMock = vi.fn();

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));
vi.mock("@/lib/edge-config/reader", () => ({
  readProjection: (opts?: unknown) => readProjectionMock(opts),
  readNationalProjection: () => readNationalProjectionMock(),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: (sigla: string, opts?: unknown) => readUfProjectionMock(sigla, opts),
}));
vi.mock("@/lib/blob/uf-detail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blob/uf-detail")>()),
  readUfDetail: async () => ({ status: "unavailable", reason: "not_configured", url: null }),
}));

const parse = async (node: Promise<React.ReactElement> | React.ReactElement) =>
  new DOMParser().parseFromString(renderToStaticMarkup(await node), "text/html");

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  readProjectionMock.mockReset();
  readNationalProjectionMock.mockReset().mockResolvedValue(null);
  readUfProjectionMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/ (Presidente) — o líder nomeado pelo painel de chances", () => {
  function comAnuladaNoTopo(): EdgePayload {
    const p = structuredClone(fixture) as unknown as EdgePayload;
    const [primeiro, segundo] = p.national.candidatos;
    if (!primeiro || !segundo) throw new Error("fixture sem dois candidatos");
    primeiro.destino = "anulado";
    primeiro.p_fecha_1t = 0;
    segundo.p_fecha_1t = 0.4;
    p.national.candidato_a_id = segundo.id;
    return p;
  }

  it("🔴 com a anulada em `rank` 1, o painel nomeia o 1º QUE COMPETE [mutação: `rank === 1` cru]", async () => {
    const p = comAnuladaNoTopo();
    readNationalProjectionMock.mockResolvedValue(p);
    const doc = await parse(HomePage());
    const [anulada, valido] = p.national.candidatos as [EdgeCandidate, EdgeCandidate];
    const painel = doc.querySelector('[data-testid="chances-panel-meters"]')?.textContent ?? "";
    expect(painel).toContain(`${valido.nome} vence no 1º turno`);
    expect(painel).not.toContain(anulada.nome);
    // A lista do painel de resultado a mantém, no fim, com a etiqueta e a nota.
    const linhas = [...doc.querySelectorAll('[data-testid="candidate-result-row"]')];
    expect(linhas.at(-1)?.textContent).toContain(anulada.nome);
    expect(linhas.at(-1)?.textContent).toContain("Anulado");
    expect(doc.querySelector('[data-testid="result-nota-anuladas"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------

function natCand(id: number, nome: string, partido: string, pct: number): EdgeCandidate {
  return {
    id,
    nome,
    partido,
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: pct,
    pct_projetado: pct,
    pct_projetado_lower: pct - 2,
    pct_projetado_upper: pct + 2,
    p_vitoria: 0,
    rank: id,
    p_passa_2t: 0,
    p_fecha_1t: 0,
  };
}

function senadoNacional(): EdgePayload {
  return {
    ts: "2026-10-04T21:00:00Z",
    cargo: 5,
    turno: 1,
    pct_apurado_total: 55.5,
    ufs_apuradas: 1,
    national: {
      candidatos: [
        natCand(9, "Zé Anulado", "NOVO", 45),
        natCand(1, "Ana Lima", "PT", 40),
        natCand(2, "Bruno Reis", "PL", 30),
        natCand(3, "Célia Mota", "MDB", 29),
      ],
      needle_position: 0,
      needle_band: "tossup",
      candidato_a_id: null,
      candidato_b_id: null,
      p_segundo_turno_overall: 0,
      cenarios_2t: [],
    },
    por_uf: [
      {
        sigla: "SP",
        pct_apurado: 62,
        lider: 1,
        margem_atual: 10,
        margem_projetada: 10,
        margem_projetada_ci: [8, 12],
        chamada: false,
        swing_vs_2022: null,
        top_candidatos: [
          { id: 9, pct: 45, nome: "Zé Anulado", partido: "NOVO", destino: "anulado" },
          { id: 1, pct: 40, nome: "Ana Lima", partido: "PT", destino: "valido" },
          { id: 2, pct: 30, nome: "Bruno Reis", partido: "PL", destino: "sub_judice" },
          { id: 3, pct: 29, nome: "Célia Mota", partido: "MDB" },
        ],
        vai_a_2t: null,
        bucket: "indefinido",
      },
    ],
    insights: [],
    composition: { pre_election: 0, model: 1, actual_results: 0 },
  };
}

describe("/senador — o cartão por estado com anulada (2026-09-27: formato de /governador)", () => {
  function linhas(doc: Document): string[] {
    return [...doc.querySelectorAll("[data-uf='SP'] article li")].map((li) =>
      (li.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
  }

  it("🔴 quem disputa ganha as posições; a anulada vai ao fim, sem posição e sem %", async () => {
    readProjectionMock.mockResolvedValue(senadoNacional());
    const doc = await parse(SenadoPage());
    const l = linhas(doc);
    expect(l[0]).toMatch(/^1° ?Ana Lima ?PT/);
    expect(l[1]).toMatch(/^2° ?Bruno Reis ?PL,? ?Sub judice/i);
    expect(l[2]).toMatch(/^3° ?Célia Mota ?MDB.*29%$/);
    // Opção A do ADR-0053: a anulada sai SEM percentual e sem ordinal.
    const anulada = l.find((x) => x.includes("Zé Anulado")) ?? "";
    expect(anulada).toMatch(/^— ?Zé Anulado ?NOVO,? ?Anulado/i);
    expect(anulada).not.toContain("45%");
    expect(l.indexOf(anulada)).toBe(3);
    // Senado: a nota SEM a regra dos 50% (duas vagas, sem 2º turno).
    const nota = doc.querySelector("[data-testid='senado-nota-anuladas']")?.textContent ?? "";
    expect(nota).toContain("calculados sobre os votos em disputa");
    expect(nota).not.toContain("1º turno");
  });

  it("sem `destino`, a ordem é a do dado (e sem nota)", async () => {
    const p = senadoNacional();
    const row = p.por_uf[0];
    if (!row) throw new Error("fixture sem SP");
    row.top_candidatos = row.top_candidatos.map(({ destino: _d, ...t }) => t);
    readProjectionMock.mockResolvedValue(p);
    const doc = await parse(SenadoPage());
    const l = linhas(doc);
    expect(l[0]).toMatch(/^1° ?Zé Anulado ?NOVO.*45%$/);
    expect(l[1]).toMatch(/^2° ?Ana Lima ?PT/);
    expect(doc.querySelector("[data-testid='senado-nota-anuladas']")).toBeNull();
  });
});

describe("/uf/[sigla]/senador — o elenco do painel de chances", () => {
  function ufCand(
    id: number,
    nome: string,
    partido: string,
    pct: number,
    over: Partial<EdgeUfCandidate> = {},
  ): EdgeUfCandidate {
    return {
      id,
      nome,
      partido,
      votos_atuais: Math.round(pct * 10_000),
      votos_projetados: Math.round(pct * 20_000),
      pct_atual: pct,
      pct_projetado: pct,
      ci95: { lower: pct - 2, upper: pct + 2 },
      ...over,
    };
  }

  it("🔴 corrida com menos candidaturas que `vagas + 1`: a anulada não ganha medidor [mutação: sem `queCompetem` no elenco]", async () => {
    const payload: EdgePayloadUf = {
      uf: "SP",
      ts: "2026-10-04T21:00:00Z",
      cargo: 5,
      turno: 1,
      pct_apurado: 62,
      candidatos: [
        ufCand(9, "Zé Anulado", "NOVO", 50, { p_eleito: 0, destino: "anulado" }),
        ufCand(1, "Ana Lima", "PT", 30, { p_eleito: 0.9 }),
        ufCand(2, "Bruno Reis", "PL", 20, { p_eleito: 0.8 }),
      ],
      needle_position: 0,
      needle_band: "tossup",
      vagas: 2,
      granularidade: "uf",
    };
    readUfProjectionMock.mockResolvedValue(payload);
    const doc = await parse(UFSenadorPage({ params: Promise.resolve({ sigla: "SP" }) }));
    const medidores = doc.querySelector("[data-testid='chances-panel-meters']")?.textContent ?? "";
    expect(medidores).toContain("Ana Lima");
    expect(medidores).toContain("Bruno Reis");
    expect(medidores).not.toContain("Zé Anulado");
  });
});
