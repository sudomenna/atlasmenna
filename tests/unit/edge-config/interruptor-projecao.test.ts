/**
 * tests/unit/edge-config/interruptor-projecao.test.ts
 *
 * O interruptor da projeção de Deputado Federal — chave e LEITURA
 * (spec 026 RF-265, ADR-0063 D4).
 *
 * 🔴 A propriedade que importa é a **falha fechada nos dois sentidos**: só uma
 * leitura bem-sucedida com `ligada === true` liga. Chave ausente, leitura que
 * lança, valor inválido — inclusive um `false` cru gravado à mão no painel —
 * desligam. Uma regressão aqui não aparece em teste positivo nenhum: a tela
 * continuaria mostrando projeção, só que também quando não deveria.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
vi.mock("@vercel/edge-config", () => ({
  get: (key: string) => getMock(key),
}));

const logErrorMock = vi.fn();
const logWarnMock = vi.fn();
vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return {
    ...real,
    logError: (msg: string, ctx?: unknown) => logErrorMock(msg, ctx),
    logWarn: (msg: string, ctx?: unknown) => logWarnMock(msg, ctx),
  };
});

import {
  INTERRUPTOR_PROJECAO_DEP_KEY,
  interruptorProjecaoDepKey,
  isValidGlobalConfigKey,
} from "@/lib/edge-config/keys";
import {
  _reiniciarAvisosDoInterruptor,
  interpretarInterruptor,
  readInterruptorProjecao,
  TRAVA_PROJECAO_DEP_PCT,
} from "@/lib/edge-config/reader";

let edgeConfigOriginal: string | undefined;

beforeEach(() => {
  edgeConfigOriginal = process.env.EDGE_CONFIG;
  process.env.EDGE_CONFIG = "https://edge-config.vercel.com/ecfg_test?token=t";
  getMock.mockReset();
  logErrorMock.mockReset();
  logWarnMock.mockReset();
  _reiniciarAvisosDoInterruptor();
});

afterEach(() => {
  if (edgeConfigOriginal === undefined) delete process.env.EDGE_CONFIG;
  else process.env.EDGE_CONFIG = edgeConfigOriginal;
});

describe("interruptorProjecaoDepKey", () => {
  it("é exatamente `interruptor-projecao-dep` — a MESMA string que o modelo Python lê", () => {
    expect(interruptorProjecaoDepKey()).toBe("interruptor-projecao-dep");
    expect(INTERRUPTOR_PROJECAO_DEP_KEY).toBe("interruptor-projecao-dep");
    expect(isValidGlobalConfigKey(interruptorProjecaoDepKey())).toBe(true);
  });
});

describe("interpretarInterruptor — a regra inteira, pura", () => {
  it("só `{ligada: true}` lido com sucesso liga", () => {
    expect(interpretarInterruptor({ estado: "ok", valor: { ligada: true } })).toEqual({
      ligada: true,
      pct_minimo: 25,
      origem: "chave",
    });
  });

  it("🔴 chave AUSENTE desliga (falha fechada; 'começa ligada' é passo da virada)", () => {
    expect(interpretarInterruptor({ estado: "ausente" })).toEqual({
      ligada: false,
      pct_minimo: 25,
      origem: "ausente",
    });
  });

  it("🔴 leitura com FALHA desliga", () => {
    expect(interpretarInterruptor({ estado: "falha", erro: new Error("x") })).toEqual({
      ligada: false,
      pct_minimo: 25,
      origem: "falha",
    });
  });

  it("🔴 valor INVÁLIDO desliga — inclusive `true`/`false` crus e `ligada` não-booleano", () => {
    for (const valor of [true, false, null, "ligada", 1, [], { ligada: "true" }, { ligar: true }]) {
      expect(interpretarInterruptor({ estado: "ok", valor }), JSON.stringify(valor)).toEqual({
        ligada: false,
        pct_minimo: 25,
        origem: "invalida",
      });
    }
  });

  it("`{ligada: false}` é desligado PELA OPERAÇÃO — origem `chave`, não `invalida`", () => {
    expect(interpretarInterruptor({ estado: "ok", valor: { ligada: false } })).toEqual({
      ligada: false,
      pct_minimo: 25,
      origem: "chave",
    });
  });

  it("`pct_minimo` só SOBE: 25–100 vale; fora disso é IGNORADO (vale 25) sem mexer em `ligada`", () => {
    expect(TRAVA_PROJECAO_DEP_PCT).toBe(25);
    expect(
      interpretarInterruptor({ estado: "ok", valor: { ligada: true, pct_minimo: 40 } }),
    ).toEqual({ ligada: true, pct_minimo: 40, origem: "chave" });
    expect(
      interpretarInterruptor({ estado: "ok", valor: { ligada: true, pct_minimo: 25 } }).pct_minimo,
    ).toBe(25);
    for (const pct of [10, 24.9, 101, -1, "40", Number.NaN]) {
      expect(
        interpretarInterruptor({ estado: "ok", valor: { ligada: true, pct_minimo: pct } }),
        String(pct),
      ).toEqual({ ligada: true, pct_minimo: 25, origem: "chave", pct_minimo_ignorado: true });
    }
  });

  it("`em`/`por` são de auditoria e NÃO saem da leitura (nunca chegam à tela)", () => {
    const lido = interpretarInterruptor({
      estado: "ok",
      valor: { ligada: true, em: "2026-10-03T18:00:00Z", por: "plantao" },
    });
    expect(lido).not.toHaveProperty("em");
    expect(lido).not.toHaveProperty("por");
  });
});

describe("readInterruptorProjecao — leitura real (SDK mockado)", () => {
  it("lê a chave certa e liga com `{ligada: true}`", async () => {
    getMock.mockResolvedValue({ ligada: true });
    expect(await readInterruptorProjecao()).toEqual({
      ligada: true,
      pct_minimo: 25,
      origem: "chave",
    });
    expect(getMock).toHaveBeenCalledWith("interruptor-projecao-dep");
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("🔴 o SDK lança ⇒ DESLIGADA, com `logError`, e nunca propaga", async () => {
    getMock.mockRejectedValue(new Error("ECONNRESET"));
    expect(await readInterruptorProjecao()).toMatchObject({ ligada: false, origem: "falha" });
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0]?.[1]).toMatchObject({ fn: "readInterruptorProjecao" });
  });

  it("chave ausente (`undefined`) ⇒ DESLIGADA, com UM aviso por processo", async () => {
    getMock.mockResolvedValue(undefined);
    expect(await readInterruptorProjecao()).toMatchObject({ ligada: false, origem: "ausente" });
    await readInterruptorProjecao();
    await readInterruptorProjecao();
    expect(logWarnMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it("🔴 um `false` cru gravado no painel é INVÁLIDO — não vira 'ausente'", async () => {
    // `getFirst` trataria `false` como "não existe". A leitura do interruptor
    // não pode passar por ele.
    getMock.mockResolvedValue(false);
    expect(await readInterruptorProjecao()).toMatchObject({ ligada: false, origem: "invalida" });
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it("sem Global Config configurado ⇒ DESLIGADA, sem tentar ler", async () => {
    delete process.env.EDGE_CONFIG;
    expect(await readInterruptorProjecao()).toMatchObject({ ligada: false, origem: "ausente" });
    expect(getMock).not.toHaveBeenCalled();
  });

  it("`pct_minimo` abaixo do piso: liga, ignora a trava e avisa", async () => {
    getMock.mockResolvedValue({ ligada: true, pct_minimo: 10 });
    expect(await readInterruptorProjecao()).toEqual({
      ligada: true,
      pct_minimo: 25,
      origem: "chave",
      pct_minimo_ignorado: true,
    });
    expect(logWarnMock).toHaveBeenCalledTimes(1);
  });
});
