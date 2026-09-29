/**
 * tests/unit/tse/trigger-projecao-dep.test.ts
 *
 * Spec 026 (design § 2.11, ADR-0063 D4) — o ciclo de ingestão lê o
 * interruptor da projeção de Deputado UMA vez e o manda ao modelo no corpo do
 * POST, como `projecao_dep`. O Python não lê o Edge Config.
 *
 * O que importa provar:
 *   - 🔴 falha fechada chega ao modelo: chave ausente ou leitura com falha ⇒
 *     `ligada: false` no corpo (nunca a ausência do campo, que o modelo também
 *     trataria como desligado, mas sem registro do que foi lido);
 *   - `pct_minimo` sai INTEIRO e para CIMA — o campo Python é `int`, e um
 *     decimal faria o POST inteiro voltar 422;
 *   - só o cargo 6 leva o campo.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(() => ({ from: () => Promise.resolve([]) })) },
  schema: {},
}));

const getMock = vi.fn();
vi.mock("@vercel/edge-config", () => ({
  get: (key: string) => getMock(key),
}));

vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return { ...real, logError: () => {}, logWarn: () => {} };
});

import { TIMEOUT_INTERRUPTOR_MS } from "@/lib/edge-config/reader";
import { corpoDoTriggerModel, lerProjecaoDepParaOModelo } from "@/lib/tse/ingest-handler";

let edgeConfigOriginal: string | undefined;

beforeEach(() => {
  edgeConfigOriginal = process.env.EDGE_CONFIG;
  process.env.EDGE_CONFIG = "https://edge-config.vercel.com/ecfg_test?token=t";
  getMock.mockReset();
});

afterEach(() => {
  if (edgeConfigOriginal === undefined) delete process.env.EDGE_CONFIG;
  else process.env.EDGE_CONFIG = edgeConfigOriginal;
});

describe("lerProjecaoDepParaOModelo", () => {
  it("chave `{ligada: true}` ⇒ ligada com a trava do modelo (25)", async () => {
    getMock.mockResolvedValue({ ligada: true });
    expect(await lerProjecaoDepParaOModelo()).toEqual({ ligada: true, pct_minimo: 25 });
    expect(getMock).toHaveBeenCalledWith("interruptor-projecao-dep");
  });

  it("🔴 chave ausente ⇒ `ligada: false` (falha fechada até a virada gravar)", async () => {
    getMock.mockResolvedValue(undefined);
    expect(await lerProjecaoDepParaOModelo()).toEqual({ ligada: false, pct_minimo: 25 });
  });

  it("🔴 leitura com falha ⇒ `ligada: false`, sem lançar (o ciclo segue)", async () => {
    getMock.mockRejectedValue(new Error("edge config fora"));
    await expect(lerProjecaoDepParaOModelo()).resolves.toEqual({ ligada: false, pct_minimo: 25 });
  });

  it("🔴 Edge Config MUDO ⇒ o ciclo espera no máximo o teto e segue com `ligada: false`", async () => {
    // O `await` desta leitura fica ANTES do disparo do modelo e do marcador
    // final do lock (`runIngestCycle`, passo 6a). Sem teto, um `get` que nunca
    // volta prenderia o ciclo inteiro.
    vi.useFakeTimers();
    try {
      getMock.mockReturnValue(new Promise(() => {}));
      let corpo: unknown = null;
      const p = lerProjecaoDepParaOModelo().then((r) => {
        corpo = r;
      });
      await vi.advanceTimersByTimeAsync(TIMEOUT_INTERRUPTOR_MS);
      await p;
      expect(corpo).toEqual({ ligada: false, pct_minimo: 25 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("trava subida decimal sai INTEIRA e para CIMA (o campo Python é `int`)", async () => {
    getMock.mockResolvedValue({ ligada: true, pct_minimo: 40.2 });
    expect(await lerProjecaoDepParaOModelo()).toEqual({ ligada: true, pct_minimo: 41 });
  });
});

describe("corpoDoTriggerModel", () => {
  const dep = { ligada: true, pct_minimo: 25 };
  it("cargo 6 leva `projecao_dep`", () => {
    expect(corpoDoTriggerModel(6, 1, "2026-10-04T20:00:00Z", dep)).toEqual({
      cargo: 6,
      turno: 1,
      trigger_ts: "2026-10-04T20:00:00Z",
      projecao_dep: dep,
    });
  });
  it("os majoritários não levam o campo — e o corpo deles não muda", () => {
    for (const cargo of [1, 3, 5]) {
      expect(corpoDoTriggerModel(cargo, 1, "t", dep)).toEqual({ cargo, turno: 1, trigger_ts: "t" });
    }
  });
});
