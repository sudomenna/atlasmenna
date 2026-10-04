// @vitest-environment happy-dom
/**
 * ADR-0045 item 7 — o exterior (`ZZ`) tem página própria SÓ na rota
 * presidencial (`/uf/ZZ`); Governador e Senador devolvem 404 para `ZZ`. O
 * leitor nunca vê a sigla crua do TSE: título, kickers e metadados dizem
 * "Exterior". Harness de `uf-zerado.test.tsx` (mesmos mocks de leitura).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UFGovernadorPage, {
  generateStaticParams as paramsGov,
} from "@/app/(gov)/uf/[sigla]/governador/page";
import UFPage, { generateMetadata, generateStaticParams } from "@/app/(pres)/uf/[sigla]/page";
import UFSenadorPage, {
  generateStaticParams as paramsSen,
} from "@/app/(sen)/uf/[sigla]/senador/page";
import type { CandidatoIdentidade } from "@/lib/blob/candidatos";

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

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FIXTURE_VARIANT", "");
  readUfProjectionResultMock.mockReset().mockResolvedValue({ estado: "ausente" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** `notFound()` do Next lança um erro com `digest` começando por NEXT_HTTP_ERROR_FALLBACK;404. */
async function eh404(p: () => Promise<unknown>): Promise<boolean> {
  try {
    await p();
    return false;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? (e as Error).message;
    return /404|NOT_FOUND/.test(String(digest));
  }
}

describe("ADR-0045 — /uf/ZZ (exterior) na rota presidencial", () => {
  it('renderiza (sem 404) no placar zerado, como "Exterior", nunca "ZZ"', async () => {
    const h = renderToStaticMarkup(await UFPage({ params: Promise.resolve({ sigla: "zz" }) }));
    expect(h).toContain('data-estado="zerado"');
    expect(h).toContain("Exterior — Resultado parcial");
    expect(h).not.toMatch(/\bZZ\b/);
  });

  it('leitura que FALHOU ⇒ espera honesta, também como "Exterior"', async () => {
    readUfProjectionResultMock.mockResolvedValue({ estado: "falha", erro: new Error("x") });
    const h = renderToStaticMarkup(await UFPage({ params: Promise.resolve({ sigla: "ZZ" }) }));
    expect(h).toContain("Exterior — Aguardando dados");
    expect(h).not.toMatch(/\bZZ\b/);
  });

  it('metadados: título "Exterior — …", canônica /uf/ZZ', async () => {
    const m = await generateMetadata({ params: Promise.resolve({ sigla: "zz" }) });
    expect(m.title).toBe("Exterior — Apuração Presidencial 2026 | AtlasMenna");
    expect(m.alternates?.canonical).toBe("/uf/ZZ");
  });

  it("parâmetros estáticos: 28 no Presidente (com ZZ), 27 sem ZZ em Governador e Senador", () => {
    const pres = generateStaticParams().map((p) => p.sigla);
    expect(pres).toHaveLength(28);
    expect(pres).toContain("ZZ");
    for (const outros of [paramsGov(), paramsSen()]) {
      const siglas = outros.map((p) => p.sigla);
      expect(siglas).toHaveLength(27);
      expect(siglas).not.toContain("ZZ");
    }
  });

  it("sigla desconhecida continua 404 no Presidente", async () => {
    expect(await eh404(() => UFPage({ params: Promise.resolve({ sigla: "xx" }) }))).toBe(true);
  });

  it("🔴 /uf/ZZ/governador e /uf/ZZ/senador são 404 — o exterior só vota para Presidente", async () => {
    expect(await eh404(() => UFGovernadorPage({ params: Promise.resolve({ sigla: "zz" }) }))).toBe(
      true,
    );
    expect(await eh404(() => UFSenadorPage({ params: Promise.resolve({ sigla: "zz" }) }))).toBe(
      true,
    );
  });
});
