/**
 * tests/unit/pages/deputado-dados-da-casa.test.ts — spec 027, frente U-a.
 *
 * O adaptador `app/(dep)/_dados-da-casa.ts` é o único lugar em que o módulo
 * comum das telas de deputado lê dado. Desde a frente T os leitores recebem o
 * cargo; o adaptador passa o cargo da página a TODAS as leituras — resumo,
 * detalhe, lista, interruptor, candidaturas — e, nas fontes de
 * desenvolvimento, serve a cada casa o SEU simulado (frente S) e nunca a
 * fixture de `pnpm dev` (que é do FEDERAL) como assembleia.
 *
 * (Até 30/09 este arquivo provava o contrário: que 7 e 8 eram RECUSADOS até a
 * frente T. A frente U-b trocou a recusa pela leitura por cargo.)
 *
 * Mutações aplicadas à mão (30/09, frente U-b): `readDeputadoProjection(6)`
 * fixo no adaptador derruba "cargo 7 lê o estadual"; `FONTES_DEV[7]` apontando
 * para as fontes do 6 derruba os dois casos de desenvolvimento; o interruptor
 * lido sempre com 6 derruba o caso do interruptor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  lerCandidaturasAguardando,
  lerDadosDaCasa,
  lerFotosDaCasa,
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

describe("🔴 cargos 7 e 8 — cada casa lê a SUA fonte, nunca a do federal", () => {
  for (const [cargo, uf, token] of [
    [7, "SP", "est"],
    [8, "DF", "dis"],
  ] as const) {
    it(`cargo ${cargo} em ${uf}: resumo, detalhe, lista, interruptor e candidaturas pedidos com ${cargo}`, async () => {
      await lerDadosDaCasa(cargo, uf);
      await lerListaDaCasa(cargo, uf);
      await lerCandidaturasAguardando(cargo, uf);

      expect(readDeputadoProjectionMock.mock.calls).toEqual([[cargo]]);
      expect(readDeputadoUfDetailMock.mock.calls).toEqual([[cargo, uf]]);
      expect(readDeputadoUfListaMock.mock.calls).toEqual([[cargo, uf]]);
      expect(readInterruptorProjecaoMock.mock.calls).toEqual([[cargo]]);
      expect(readCandidatosUfMock.mock.calls).toEqual([[uf, token]]);
      // Nenhuma leitura do federal, em nenhum dos cinco leitores.
      for (const m of [
        readDeputadoProjectionMock,
        readDeputadoUfDetailMock,
        readDeputadoUfListaMock,
        readInterruptorProjecaoMock,
      ]) {
        expect(m.mock.calls.some((c) => c[0] === 6)).toBe(false);
      }
    });
  }
});

describe("🔴 fontes de desenvolvimento — 7 e 8 nunca recebem as do federal", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("`pnpm dev` (fixture): o federal recebe a fixture; o estadual e o distrital, nada", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fed = await lerDadosDaCasa(6, "SP");
    // Controle: a fixture existe e é servida ao federal — senão o caso de
    // baixo passaria por falta de fixture, não por causa da regra.
    expect(fed.nacional?.cargo).toBe(6);
    expect(fed.detalhe.status).toBe("ok");

    const est = await lerDadosDaCasa(7, "SP");
    expect(est.nacional).toBeNull();
    expect(est.detalhe.status).toBe("unavailable");
    const dis = await lerDadosDaCasa(8, "DF");
    expect(dis.nacional).toBeNull();
    expect(dis.detalhe.status).toBe("unavailable");
  });

  it("modo simulado: nenhuma leitura remota, e cada casa lê o SEU simulado — nunca o do federal", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIXTURE_VARIANT", "sim");
    // Controle: o simulado do federal existe e chega ao federal.
    const fed = await lerDadosDaCasa(6, "SP");
    expect(fed.nacional?.cargo).toBe(6);
    expect((await lerListaDaCasa(6, "SP")).status).toBe("ok");

    // Frente S: o estadual lê `deputado-estadual*.json` (cargo 7, 94 lugares
    // em SP) — se lesse o do federal, viria cargo 6 e 70 lugares.
    const est = await lerDadosDaCasa(7, "SP");
    expect(est.nacional?.cargo).toBe(7);
    expect(est.nacional?.bancada.total_cadeiras).toBe(1035);
    expect(est.detalhe.status).toBe("ok");
    if (est.detalhe.status !== "ok") throw new Error("inalcançável");
    expect(est.detalhe.detail.cargo).toBe(7);
    expect(est.detalhe.detail.lugares_a_preencher).toBe(94);
    const lista = await lerListaDaCasa(7, "SP");
    expect(lista.status).toBe("ok");
    if (lista.status !== "ok") throw new Error("inalcançável");
    expect(lista.lista.cargo).toBe(7);

    // O distrital lê `deputado-distrital*.json` (24 lugares no DF); sem lista
    // 61+ (a casa tem 24) e sem DF no estadual nem SP no distrital.
    const dis = await lerDadosDaCasa(8, "DF");
    expect(dis.nacional?.cargo).toBe(8);
    expect(dis.detalhe.status === "ok" && dis.detalhe.detail.lugares_a_preencher).toBe(24);
    expect((await lerListaDaCasa(8, "DF")).status).toBe("unavailable");
    expect((await lerDadosDaCasa(7, "DF")).detalhe.status).toBe("unavailable");
    expect((await lerDadosDaCasa(8, "SP")).detalhe.status).toBe("unavailable");

    // Interruptor das assembleias no simulado: sem `interruptor-projecao-est.json`
    // (Fase 1) ⇒ ausente ⇒ desligado — nunca o arquivo do federal.
    expect(est.interruptor.ligada).toBe(false);
    expect(readDeputadoProjectionMock).not.toHaveBeenCalled();
    expect(readDeputadoUfDetailMock).not.toHaveBeenCalled();
    expect(readDeputadoUfListaMock).not.toHaveBeenCalled();
    expect(readInterruptorProjecaoMock).not.toHaveBeenCalled();
  });
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

describe("spec 026 RF-291 — lerFotosDaCasa: quem tem foto publicada, por casa", () => {
  const fatia = (cargo: string, uf: string) => ({
    status: "ok",
    url: `https://x/candidatos/uf/${uf}/${cargo}.json`,
    slice: {
      uf,
      cargo,
      fonte_ts: "2026-10-03T08:00:00Z",
      gerado_ts: "2026-10-03T09:00:00Z",
      candidatos: [
        { sqcand: "250002553928", foto_ok: true },
        { sqcand: "250002553929", foto_ok: false },
        { sqcand: "250002553930", foto_ok: true },
      ],
    },
  });

  for (const [cargo, uf, token] of [
    [6, "SP", "dep"],
    [7, "SP", "est"],
    [8, "DF", "dis"],
  ] as const) {
    it(`cargo ${cargo} em ${uf}: lê a fatia ${token} e devolve só os foto_ok`, async () => {
      readCandidatosUfMock.mockResolvedValue(fatia(token, uf));
      const comFoto = await lerFotosDaCasa(cargo, uf);
      expect(readCandidatosUfMock.mock.calls).toEqual([[uf, token]]);
      expect([...comFoto].sort()).toEqual(["250002553928", "250002553930"]);
    });
  }

  it("fatia indisponível ⇒ conjunto vazio, sem lançar", async () => {
    expect((await lerFotosDaCasa(6, "SP")).size).toBe(0);
  });
});
