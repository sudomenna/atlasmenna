// @vitest-environment happy-dom
/**
 * ADR-0076 — modo zerado nas rotas de UF majoritárias:
 * `/uf/[sigla]` (Presidente), `/uf/[sigla]/governador`, `/uf/[sigla]/senador`.
 *
 * Chave da UF ausente ⇒ layout da apuração com as candidaturas do cadastro em
 * 0,0%, na ordem sorteada. Leitura que FALHOU ⇒ ramo honesto de sempre.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UFGovernadorPage from "@/app/(gov)/uf/[sigla]/governador/page";
import UFPage from "@/app/(pres)/uf/[sigla]/page";
import UFSenadorPage from "@/app/(sen)/uf/[sigla]/senador/page";
import type { CandidatoIdentidade } from "@/lib/blob/candidatos";
import { ordemSorteada, SEMENTE_1T_2026 } from "@/lib/zerado/ordem";

const readUfProjectionResultMock = vi.fn();

vi.mock("@/lib/edge-config/reader", () => ({
  readProjection: vi.fn(async () => null),
  readProjectionResult: vi.fn(async () => ({ estado: "ausente" })),
  readNationalProjection: vi.fn(async () => null),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: vi.fn(async () => null),
  readUfProjectionResult: (...a: unknown[]) => readUfProjectionResultMock(...a),
  readDeputadoProjection: vi.fn(async () => null),
}));

vi.mock("@/lib/blob/uf-detail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blob/uf-detail")>()),
  readUfDetail: async () => ({ status: "unavailable", reason: "not_configured", url: null }),
}));

function cadastroDe(uf: string, cargo: string): CandidatoIdentidade[] {
  return [11, 22, 33, 44].map(
    (n) =>
      ({
        sqcand: `28${uf}${cargo}${n}`,
        numero: n,
        nome_urna: `Nome ${uf} ${cargo} ${n}`,
        nome: `Nome ${uf} ${cargo} ${n}`,
        partido: n === 11 ? "PP" : n === 22 ? "PL" : n === 33 ? "PT" : "NOVO",
        sob_ressalva: false,
        foto_ok: false,
        situacao_julgamento: "DEFERIDO",
      }) as CandidatoIdentidade,
  );
}

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
          fonte_ts: "2026-10-03T00:00:00Z",
          gerado_ts: "2026-10-03T00:00:00Z",
          candidatos: cadastroDe(uf, cargo),
        },
      }),
  };
});

const PROIBIDAS = [
  "vence no 1º turno",
  "[0,0; 0,0]",
  "Disputa entre 0",
  "2º turno · projeção",
  "Vaga projetada",
  "Vaga na parcial",
  "Aguardando dados",
  "Esta página ainda não recebeu dados",
  "Quem está concorrendo",
  "disponível apenas no dia das eleições",
];

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FIXTURE_VARIANT", "");
  readUfProjectionResultMock.mockReset().mockResolvedValue({ estado: "ausente" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const CASOS = [
  {
    rota: "/uf/SP (Presidente)",
    render: () => UFPage({ params: Promise.resolve({ sigla: "sp" }) }),
    uf: "BR",
    cargo: "pres",
  },
  {
    rota: "/uf/SP/governador",
    render: () => UFGovernadorPage({ params: Promise.resolve({ sigla: "sp" }) }),
    uf: "SP",
    cargo: "gov",
  },
  {
    rota: "/uf/SP/senador",
    render: () => UFSenadorPage({ params: Promise.resolve({ sigla: "sp" }) }),
    uf: "SP",
    cargo: "sen",
  },
] as const;

describe.each(CASOS)("$rota — modo zerado", ({ render, uf, cargo }) => {
  const ordem = ordemSorteada(cadastroDe(uf, cargo), (c) => c.sqcand, SEMENTE_1T_2026).map(
    (c) => c.nome_urna,
  );

  it("chave ausente ⇒ todas as candidaturas em 0, na ordem sorteada, sem frase de espera", async () => {
    const h = renderToStaticMarkup(await render());
    for (const f of PROIBIDAS) expect(h, f).not.toContain(f);
    const pos = ordem.map((n) => h.indexOf(n));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(h).toContain("Apurado");
    expect(h).toContain('data-estado="zerado"');
    expect(h).not.toContain('data-testid="result-margem-parcial"');
  });

  it("🔴 leitura FALHOU ⇒ ramo honesto, sem placar zerado", async () => {
    readUfProjectionResultMock.mockResolvedValue({ estado: "falha", erro: new Error("x") });
    const h = renderToStaticMarkup(await render());
    expect(h).not.toContain('data-testid="candidate-result-row"');
    expect(h).not.toContain('data-estado="zerado"');
  });
});
