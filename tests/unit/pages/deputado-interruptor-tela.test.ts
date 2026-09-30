/**
 * tests/unit/pages/deputado-interruptor-tela.test.ts — spec 027 (RF-287),
 * frente U-b.
 *
 * `lerInterruptorDaTela(cargo, emSimulacao)` (`app/(dep)/_interruptor.ts`):
 * cada casa lê o SEU interruptor. Fora do simulado, o cargo vai ao leitor de
 * produção (que escolhe `-dep` ou `-est`); no simulado, só o federal tem
 * arquivo (`tests/fixtures/simulacao/interruptor-projecao-dep.json`, que diz
 * `ligada: true`) — e 7 e 8 ficam DESLIGADOS até a frente S emitir o das
 * assembleias. Ler o arquivo do federal para 7/8 ligaria a projeção das
 * assembleias com o interruptor da Câmara: o cruzamento que o RF-287 proíbe.
 *
 * `interpretarInterruptor` é o REAL aqui (só o leitor remoto é simulado): é
 * ele que transforma o arquivo `{"ligada": true}` em "ligada".
 *
 * Mutação aplicada à mão (30/09): o ramo `case 7: case 8:` de `valorSimulado`
 * devolvendo `simulacaoInterruptorProjecao()` derruba o caso "🔴 simulado".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lerInterruptorDaTela } from "@/app/(dep)/_interruptor";

const readInterruptorProjecaoMock = vi.fn();

vi.mock("@/lib/edge-config/reader", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/edge-config/reader")>();
  return {
    ...real,
    readInterruptorProjecao: (...a: unknown[]) => readInterruptorProjecaoMock(...a),
  };
});

beforeEach(() => {
  readInterruptorProjecaoMock.mockReset();
  readInterruptorProjecaoMock.mockResolvedValue({
    ligada: false,
    pct_minimo: 25,
    origem: "ausente",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fora do simulado — o cargo vai ao leitor de produção", () => {
  it("6, 7 e 8 pedem cada um o seu cargo (é o leitor que escolhe -dep ou -est)", async () => {
    await lerInterruptorDaTela(6, false);
    await lerInterruptorDaTela(7, false);
    await lerInterruptorDaTela(8, false);
    expect(readInterruptorProjecaoMock.mock.calls).toEqual([[6], [7], [8]]);
  });
});

describe("🔴 simulado — só o federal tem arquivo de interruptor", () => {
  it("6 lê o arquivo do federal (ligada); 7 e 8 ficam desligados, com a chave AUSENTE", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIXTURE_VARIANT", "sim");

    // Controle: o arquivo do federal existe e liga — senão o caso de baixo
    // passaria por falta de arquivo, não por causa da regra.
    const fed = await lerInterruptorDaTela(6, true);
    expect(fed.ligada).toBe(true);

    for (const cargo of [7, 8] as const) {
      const lido = await lerInterruptorDaTela(cargo, true);
      expect(lido.ligada, `cargo ${cargo}`).toBe(false);
      expect(lido.origem, `cargo ${cargo}`).toBe("ausente");
    }
    expect(readInterruptorProjecaoMock).not.toHaveBeenCalled();
  });
});
