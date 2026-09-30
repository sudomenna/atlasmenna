/**
 * tests/unit/pages/deputado-dados-da-casa.test.ts — spec 027, frente U-a.
 *
 * O adaptador `app/(dep)/_dados-da-casa.ts` é o único lugar em que o módulo
 * comum das telas de deputado lê dado. Até a frente T trocar os leitores para
 * `(cargo, uf)`, ele RECUSA os cargos 7 e 8 — em vez de ler o federal e
 * pô-lo, com cara de dado certo, na página da assembleia.
 *
 * Mutação aplicada à mão (29/09): apagar a guarda `exigirLeitor` faz o caso
 * "🔴 cargo 7" cair (o leitor do federal é chamado com SP).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  lerCandidaturasAguardando,
  lerDadosDaCasa,
  lerListaDaCasa,
} from "@/app/(dep)/_dados-da-casa";
import { responderListaDeputado } from "@/app/(dep)/_rota-lista-deputado";

const readDeputadoProjectionMock = vi.fn();
const readInterruptorProjecaoMock = vi.fn();
const readDeputadoUfDetailMock = vi.fn();
const readDeputadoUfListaMock = vi.fn();
const readCandidatosUfMock = vi.fn();

vi.mock("@/lib/edge-config/reader", () => ({
  readDeputadoProjection: (...a: unknown[]) => readDeputadoProjectionMock(...a),
  readInterruptorProjecao: (...a: unknown[]) => readInterruptorProjecaoMock(...a),
  interpretarInterruptor: () => ({ ligada: false, pct_minimo: 25, origem: "ausente" }),
}));

vi.mock("@/lib/blob/deputado-uf", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/blob/deputado-uf")>();
  return {
    ...real,
    readDeputadoUfDetail: (...a: unknown[]) => readDeputadoUfDetailMock(...a),
    readDeputadoUfLista: (...a: unknown[]) => readDeputadoUfListaMock(...a),
  };
});

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: (uf: string, token: string) => readCandidatosUfMock(uf, token),
}));

const INDISPONIVEL = { status: "unavailable", reason: "not_found", url: null } as const;
const salvoFixture = process.env.FIXTURE_VARIANT;

beforeEach(() => {
  delete process.env.FIXTURE_VARIANT;
  for (const m of [
    readDeputadoProjectionMock,
    readInterruptorProjecaoMock,
    readDeputadoUfDetailMock,
    readDeputadoUfListaMock,
    readCandidatosUfMock,
  ]) {
    m.mockReset();
  }
  readDeputadoProjectionMock.mockResolvedValue(null);
  readInterruptorProjecaoMock.mockResolvedValue({
    ligada: false,
    pct_minimo: 25,
    origem: "ausente",
  });
  readDeputadoUfDetailMock.mockResolvedValue(INDISPONIVEL);
  readDeputadoUfListaMock.mockResolvedValue(INDISPONIVEL);
  readCandidatosUfMock.mockResolvedValue({
    status: "unavailable",
    reason: "not_configured",
    url: null,
  });
});

afterEach(() => {
  if (salvoFixture === undefined) delete process.env.FIXTURE_VARIANT;
  else process.env.FIXTURE_VARIANT = salvoFixture;
});

describe("cargo 6 — os leitores de sempre, com a UF pedida", () => {
  it("lerDadosDaCasa lê resumo, detalhe da UF e interruptor, em paralelo", async () => {
    const dados = await lerDadosDaCasa(6, "SP");
    expect(readDeputadoProjectionMock).toHaveBeenCalledWith(6);
    expect(readDeputadoUfDetailMock).toHaveBeenCalledWith(6, "SP");
    expect(readInterruptorProjecaoMock).toHaveBeenCalledTimes(1);
    expect(dados.nacional).toBeNull();
    expect(dados.detalhe).toEqual(INDISPONIVEL);
    expect(dados.interruptor.ligada).toBe(false);
  });

  it("lerListaDaCasa e a grade de candidaturas pedem a UF e o token do federal", async () => {
    await lerListaDaCasa(6, "RR");
    expect(readDeputadoUfListaMock).toHaveBeenCalledWith(6, "RR");
    await lerCandidaturasAguardando(6, "SP");
    expect(readCandidatosUfMock).toHaveBeenCalledWith("SP", "dep");
  });
});

describe("🔴 cargos 7 e 8 — recusados até a frente T, nunca lidos como federal", () => {
  for (const [cargo, uf] of [
    [7, "SP"],
    [8, "DF"],
  ] as const) {
    it(`cargo ${cargo} em ${uf}: as três leituras lançam e nenhum leitor é chamado`, async () => {
      await expect(lerDadosDaCasa(cargo, uf)).rejects.toThrow(/frente T/);
      await expect(lerListaDaCasa(cargo, uf)).rejects.toThrow(/frente T/);
      await expect(lerCandidaturasAguardando(cargo, uf)).rejects.toThrow(/frente T/);
      expect(readDeputadoProjectionMock).not.toHaveBeenCalled();
      expect(readDeputadoUfDetailMock).not.toHaveBeenCalled();
      expect(readDeputadoUfListaMock).not.toHaveBeenCalled();
      expect(readCandidatosUfMock).not.toHaveBeenCalled();
    });
  }
});

describe("responderListaDeputado — as UFs da casa", () => {
  it("sigla fora da casa ⇒ 404 `no-store` sem tocar o leitor (estadual no DF, distrital em SP)", async () => {
    for (const [cargo, uf] of [
      [7, "DF"],
      [8, "SP"],
      [6, "XX"],
    ] as const) {
      const res = await responderListaDeputado(cargo, uf);
      expect(res.status, `${cargo}/${uf}`).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(readDeputadoUfListaMock).not.toHaveBeenCalled();
  });
});
