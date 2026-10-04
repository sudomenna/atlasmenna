// @vitest-environment happy-dom
/**
 * ADR-0076 — modo zerado em `/governador` e `/senador` (capas nacionais).
 *
 * Chave ausente ⇒ as 27 corridas no layout da apuração com as candidaturas
 * do cadastro (Blob) em 0, na ordem sorteada do dia. Leitura que FALHOU ⇒ tela
 * honesta de sempre, sem número.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GovernadorGridPage from "@/app/(gov)/governador/page";
import SenadoPage from "@/app/(sen)/senador/page";
import type { CandidatoIdentidade } from "@/lib/blob/candidatos";
import { ordemSorteada, SEMENTE_1T_2026 } from "@/lib/zerado/ordem";

const readProjectionMock = vi.fn();
const readProjectionResultMock = vi.fn();

vi.mock("@/lib/edge-config/reader", () => ({
  readProjection: (o: unknown) => readProjectionMock(o),
  readProjectionResult: (o: unknown) => readProjectionResultMock(o),
  readNationalProjection: () => Promise.resolve(null),
  readArchivedProjection: () => Promise.resolve(null),
}));

function cadastroDe(uf: string): CandidatoIdentidade[] {
  return [11, 22, 33].map(
    (n) =>
      ({
        sqcand: `28${uf}${n}`,
        numero: n,
        nome_urna: `Nome ${uf} ${n}`,
        nome: `Nome ${uf} ${n}`,
        partido: n === 11 ? "PP" : n === 22 ? "PL" : "PT",
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
          candidatos: cadastroDe(uf),
        },
      }),
  };
});

const PROIBIDAS = [
  "vence no 1º turno",
  "[0,0; 0,0]",
  "Disputa entre 0",
  // A nota de método da Parcial diz, como REGRA, "estado com a apuração
  // concluída conta igual à projeção" — não é afirmação sobre o estado. O que
  // não pode aparecer é a afirmação (ADR-0043, 13/09):
  "estão com a apuração concluída",
  "2º turno · projeção",
  "Vaga projetada",
  "Esta página ainda não recebeu dados",
  "A eleição ainda não começou",
  "Quem está concorrendo",
  "Matematicamente eleito",
];

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FIXTURE_VARIANT", "");
  readProjectionMock.mockReset().mockResolvedValue(null);
  readProjectionResultMock.mockReset().mockResolvedValue({ estado: "ausente" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function ordemSP(): string[] {
  return ordemSorteada(cadastroDe("SP"), (c) => c.sqcand, SEMENTE_1T_2026).map((c) => c.nome_urna);
}

describe("/governador — modo zerado", () => {
  it("chave ausente ⇒ 27 cartões, candidaturas de cada UF em 0, sem frase de espera", async () => {
    const h = renderToStaticMarkup(await GovernadorGridPage({}));
    for (const f of PROIBIDAS) expect(h, f).not.toContain(f);
    expect(h).toContain("Governadores 2026");
    expect(h).toContain("27 corridas");
    for (const uf of ["SP", "AC", "DF"]) expect(h).toContain(`Nome ${uf} 22`);
    // ordem sorteada dentro do cartão de SP
    const nomes = ordemSP();
    const pos = nomes.map((n) => h.indexOf(n));
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it("🔴 leitura FALHOU ⇒ tela honesta, sem cartão zerado", async () => {
    readProjectionResultMock.mockResolvedValue({ estado: "falha", erro: new Error("x") });
    const h = renderToStaticMarkup(await GovernadorGridPage({}));
    expect(h).not.toContain("Nome SP 22");
  });
});

describe("/senador — modo zerado", () => {
  it("chave ausente ⇒ 27 corridas em 0, 54 vagas em disputa, sem frase de espera", async () => {
    const h = renderToStaticMarkup(await SenadoPage());
    for (const f of PROIBIDAS) expect(h, f).not.toContain(f);
    expect(h).toContain("Senado 2026");
    for (const uf of ["SP", "AC", "DF"]) expect(h).toContain(`Nome ${uf} 22`);
    expect(h).toContain("54");
  });

  it("🔴 leitura FALHOU ⇒ tela honesta, sem cartão zerado", async () => {
    readProjectionResultMock.mockResolvedValue({ estado: "falha", erro: new Error("x") });
    const h = renderToStaticMarkup(await SenadoPage());
    expect(h).not.toContain("Nome SP 22");
  });
});
