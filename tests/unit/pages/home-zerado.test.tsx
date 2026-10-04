// @vitest-environment happy-dom
/**
 * ADR-0076 — modo zerado na home `/`.
 *
 * Antes do 1º boletim (chave ausente, fase pré ou lista vazia) a home abre no
 * layout da apuração com todas as candidaturas em 0,0%, na ordem SORTEADA do
 * dia. Leitura que FALHOU nunca entra no modo: segue a tela honesta, sem
 * número.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/(pres)/page";
import type { CandidatoIdentidade } from "@/lib/blob/candidatos";
import { ordemSorteada, SEMENTE_1T_2026 } from "@/lib/zerado/ordem";
import { payloadNormalApurando, payloadPreEleicao } from "@/tests/fixtures/spec-019/payloads";

const readNationalProjectionMock = vi.fn();
const readProjectionResultMock = vi.fn();

vi.mock("@/lib/edge-config/reader", () => ({
  readNationalProjection: () => readNationalProjectionMock(),
  readProjectionResult: (o: unknown) => readProjectionResultMock(o),
  readArchivedProjection: () => Promise.resolve(null),
}));

function cand(numero: number, nome: string, partido: string, sq: string): CandidatoIdentidade {
  return {
    sqcand: sq,
    numero,
    nome_urna: nome,
    nome,
    partido,
    sob_ressalva: false,
    foto_ok: false,
    situacao_julgamento: "DEFERIDO",
  } as CandidatoIdentidade;
}

const CADASTRO: CandidatoIdentidade[] = [
  cand(13, "Ana Treze", "PT", "280001000013"),
  cand(22, "Bruno Vinte", "PL", "280001000022"),
  cand(12, "Clara Doze", "PDT", "280001000012"),
  cand(30, "Davi Trinta", "NOVO", "280001000030"),
  cand(50, "Eva Cinquenta", "PSOL", "280001000050"),
];

vi.mock("@/lib/blob/candidatos", async (orig) => {
  const real = await orig<typeof import("@/lib/blob/candidatos")>();
  return {
    ...real,
    readCandidatosUf: (uf: string) =>
      Promise.resolve({
        status: "ok",
        url: "x",
        slice: {
          uf,
          cargo: "pres",
          fonte_ts: "2026-10-03T00:00:00Z",
          gerado_ts: "2026-10-03T00:00:00Z",
          candidatos: CADASTRO,
        },
      }),
  };
});

const ORDEM_SORTEADA = ordemSorteada(CADASTRO, (c) => c.sqcand, SEMENTE_1T_2026).map(
  (c) => c.nome_urna,
);

/** Frases de medição que o placar zerado não pode emitir (ADR-0043 contexto). */
const PROIBIDAS = [
  "vence no 1º turno",
  "[0,0; 0,0]",
  "Disputa entre 0",
  "apuração concluída",
  "2º turno · projeção",
  "Vaga projetada",
  "Esta página ainda não recebeu dados",
  "A eleição ainda não começou",
  "Quem está concorrendo",
  "disponível apenas no dia das eleições",
];

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FIXTURE_VARIANT", "");
  readNationalProjectionMock.mockReset().mockResolvedValue(null);
  readProjectionResultMock.mockReset().mockResolvedValue({ estado: "ausente" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function html(): Promise<string> {
  return renderToStaticMarkup(await HomePage());
}

function nomesNaOrdem(h: string): string[] {
  return ORDEM_SORTEADA.slice().sort((a, b) => h.indexOf(a) - h.indexOf(b));
}

describe("home — modo zerado (ADR-0076)", () => {
  it("chave ausente ⇒ layout da apuração, todas as candidaturas em 0,0%, ordem sorteada", async () => {
    const h = await html();
    for (const nome of ORDEM_SORTEADA) expect(h).toContain(nome);
    expect(nomesNaOrdem(h)).toEqual(ORDEM_SORTEADA);
    expect(h).toContain("Apurado");
    expect(h).toContain("0,0% apurado");
    expect(h).toContain('data-estado="zerado"');
    for (const f of PROIBIDAS) expect(h, f).not.toContain(f);
    expect(h).not.toContain('data-testid="result-margem-parcial"');
    expect(h).not.toContain('data-testid="result-identidade-lista"');
  });

  it("a ordem sorteada não é a do número na urna", () => {
    const porNumero = CADASTRO.slice()
      .sort((a, b) => a.numero - b.numero)
      .map((c) => c.nome_urna);
    expect(ORDEM_SORTEADA).not.toEqual(porNumero);
  });

  it("payload em fase pré ⇒ também zerado (sem a faixa de pré-eleição)", async () => {
    readNationalProjectionMock.mockResolvedValue(payloadPreEleicao());
    const h = await html();
    expect(nomesNaOrdem(h)).toEqual(ORDEM_SORTEADA);
    for (const f of PROIBIDAS) expect(h, f).not.toContain(f);
    expect(readProjectionResultMock).not.toHaveBeenCalled();
  });

  it("payload real com lista vazia ⇒ zerado", async () => {
    const vazio = payloadNormalApurando();
    vazio.national.candidatos = [];
    vazio.pct_apurado_total = 0;
    readNationalProjectionMock.mockResolvedValue(vazio);
    const h = await html();
    expect(nomesNaOrdem(h)).toEqual(ORDEM_SORTEADA);
  });

  it("🔴 leitura FALHOU ⇒ tela honesta, sem número e sem placar zerado", async () => {
    readProjectionResultMock.mockResolvedValue({ estado: "falha", erro: new Error("x") });
    const h = await html();
    expect(h).toContain("não recebeu dados");
    expect(h).not.toContain("0,0% apurado");
    expect(h).not.toContain('data-testid="candidate-result-row"');
  });

  it("payload real com candidaturas ⇒ renderiza como sempre (não zerado)", async () => {
    readNationalProjectionMock.mockResolvedValue(payloadNormalApurando());
    const h = await html();
    expect(h).not.toContain('data-estado="zerado"');
    expect(h).toContain("37,4% apurado");
    expect(readProjectionResultMock).not.toHaveBeenCalled();
  });
});
