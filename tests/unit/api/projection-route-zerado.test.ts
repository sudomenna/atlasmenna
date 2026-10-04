/**
 * ADR-0076 — `/api/projection` no placar zerado: chave ausente (ou fase pré,
 * ou lista vazia) ⇒ 200 com o payload zerado e o marcador de tela, em vez do
 * 503 `no_payload`. Leitura que FALHOU ⇒ 503 de sempre, nunca zero.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readProjectionResultMock = vi.fn();
const readUfProjectionResultMock = vi.fn();
vi.mock("@/lib/edge-config/reader", () => ({
  readNationalProjection: vi.fn(async () => null),
  readProjection: vi.fn(async () => null),
  readUfProjection: vi.fn(async () => null),
  readProjectionResult: (o: unknown) => readProjectionResultMock(o),
  readUfProjectionResult: (...a: unknown[]) => readUfProjectionResultMock(...a),
}));

vi.mock("@/lib/dev/simulacao", () => ({
  simulacaoLigada: () => false,
  simulacaoNacional: vi.fn(),
  simulacaoSenadorUf: vi.fn(),
  simulacaoUfPresidente: vi.fn(),
  simulacaoGovernadorUf: vi.fn(),
}));

vi.mock("@/lib/blob/candidatos", async (orig) => {
  const real = await orig<typeof import("@/lib/blob/candidatos")>();
  return {
    ...real,
    readCandidatosUf: (uf: string, cargo: string) =>
      Promise.resolve({
        status: "ok",
        url: "x",
        slice: {
          uf,
          cargo,
          fonte_ts: "t",
          gerado_ts: "t",
          candidatos: [
            {
              sqcand: `1${uf}`,
              numero: 13,
              nome_urna: `A ${uf}`,
              nome: "A",
              partido: "PT",
              sob_ressalva: false,
              foto_ok: false,
              situacao_julgamento: "DEFERIDO",
            },
          ],
        },
      }),
  };
});

const { GET } = await import("@/app/api/projection/route");

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  readProjectionResultMock.mockReset().mockResolvedValue({ estado: "ausente" });
  readUfProjectionResultMock.mockReset().mockResolvedValue({ estado: "ausente" });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/projection — placar zerado", () => {
  it.each(["", "?cargo=gov", "?cargo=sen"])("nacional %s ausente ⇒ 200 zerado", async (q) => {
    const res = await GET(new Request(`http://x/api/projection${q}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.zerado).toBe(true);
    expect(body.por_uf).toHaveLength(27);
    expect(body.pct_apurado_total).toBe(0);
    expect(body.fase).toBeUndefined();
    expect(body.dado_ts).toBeUndefined();
  });

  it("UF ausente ⇒ 200 zerado com as candidaturas", async () => {
    const res = await GET(new Request("http://x/api/projection?uf=SP&cargo=gov"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.zerado).toBe(true);
    expect(body.candidatos[0].pct_projetado).toBe(0);
  });

  it("🔴 leitura FALHOU ⇒ 503, nunca zero", async () => {
    readProjectionResultMock.mockResolvedValue({ estado: "falha", erro: new Error("x") });
    readUfProjectionResultMock.mockResolvedValue({ estado: "falha", erro: new Error("x") });
    for (const q of ["", "?cargo=gov", "?cargo=sen", "?uf=SP&cargo=gov"]) {
      const res = await GET(new Request(`http://x/api/projection${q}`));
      expect(res.status, q).toBe(503);
    }
  });
});
