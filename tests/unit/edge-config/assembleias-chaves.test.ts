/**
 * tests/unit/edge-config/assembleias-chaves.test.ts
 *
 * Spec 027 (RF-279, RF-287; ADR-0066) — chaves do Global Config, caminhos do
 * Blob e leitores dos TRÊS cargos proporcionais: Deputado Federal (6),
 * Estadual (7) e Distrital (8).
 *
 * A propriedade central é a de NÃO COLIDIR: SP estadual e SP federal são
 * objetos diferentes, em endereços diferentes, e nenhum leitor devolve um no
 * lugar do outro. E a do interruptor: o das assembleias é OUTRA chave, e o
 * federal ligado não liga as assembleias. As asserções que discriminam são as
 * NEGATIVAS (o endereço do outro cargo não aparece).
 */

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const getMock = vi.fn();
vi.mock("@vercel/edge-config", () => ({
  get: (key: string) => getMock(key),
}));

const logErrorMock = vi.fn();
vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return {
    ...real,
    logError: (msg: string, ctx?: unknown) => logErrorMock(msg, ctx),
    logWarn: () => {},
  };
});

import {
  type DeputadoUfDetail,
  readDeputadoUfDetail,
  readDeputadoUfLista,
  sanearDeputadoUfDetail,
} from "@/lib/blob/deputado-uf";
import {
  deputadoUfBlobPathname,
  deputadoUfListaBlobPathname,
  prefixoBlobDeputado,
} from "@/lib/blob/paths";
import type { CargoProporcional } from "@/lib/config/cargos";
import { UFS_DA_ELEICAO, ufsDoCargo } from "@/lib/config/cargos";
import {
  currentProjectionKey,
  INTERRUPTOR_PROJECAO_DEP_KEY,
  INTERRUPTOR_PROJECAO_EST_KEY,
  interruptorProjecaoKey,
  isValidGlobalConfigKey,
} from "@/lib/edge-config/keys";
import {
  _reiniciarAvisosDoInterruptor,
  type CargoMajoritario,
  readDeputadoProjection,
  readInterruptorProjecao,
} from "@/lib/edge-config/reader";

const BASE = "https://exemplo.test";
let edgeOriginal: string | undefined;
let baseOriginal: string | undefined;

beforeEach(() => {
  edgeOriginal = process.env.EDGE_CONFIG;
  baseOriginal = process.env.BLOB_PUBLIC_BASE_URL;
  process.env.EDGE_CONFIG = "https://edge-config.vercel.com/ecfg_test?token=t";
  process.env.BLOB_PUBLIC_BASE_URL = BASE;
  getMock.mockReset();
  logErrorMock.mockReset();
  _reiniciarAvisosDoInterruptor();
});

afterEach(() => {
  if (edgeOriginal === undefined) delete process.env.EDGE_CONFIG;
  else process.env.EDGE_CONFIG = edgeOriginal;
  if (baseOriginal === undefined) delete process.env.BLOB_PUBLIC_BASE_URL;
  else process.env.BLOB_PUBLIC_BASE_URL = baseOriginal;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Chaves
// ---------------------------------------------------------------------------

describe("RF-279 — chaves nacionais por cargo, sem colisão", () => {
  it("dep, est e dis: três chaves distintas e válidas", () => {
    const chaves = (["dep", "est", "dis"] as const).map((t) => currentProjectionKey(t, 1));
    expect(chaves).toEqual([
      "projection-current-dep-t1",
      "projection-current-est-t1",
      "projection-current-dis-t1",
    ]);
    for (const k of chaves) expect(isValidGlobalConfigKey(k)).toBe(true);
  });

  it.each([
    { cargo: 6, chave: "projection-current-dep-t1" },
    { cargo: 7, chave: "projection-current-est-t1" },
    { cargo: 8, chave: "projection-current-dis-t1" },
  ] as const)("readDeputadoProjection($cargo) lê SÓ $chave", async ({ cargo, chave }) => {
    getMock.mockResolvedValue({ cargo });
    await readDeputadoProjection(cargo);
    expect(getMock.mock.calls.map((c) => c[0])).toEqual([chave]);
  });

  it("🔴 um cargo que não é proporcional (por `as`) LANÇA — nunca lê a chave de outro", async () => {
    await expect(readDeputadoProjection(1 as unknown as CargoProporcional)).rejects.toThrow(
      /não é proporcional/,
    );
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe("CargoMajoritario — derivado de `proporcional`, não de uma lista", () => {
  it("é exatamente pres | gov | sen — `est` e `dis` NÃO entram no leitor majoritário", () => {
    // Com o antigo `Exclude<Cargo, "dep">`, `readProjection({ cargo: "est" })`
    // compilaria e leria o payload proporcional tipado como `EdgePayload`. Esta
    // trava é de TIPO: quem a pega é o `pnpm typecheck` (os testes entram no
    // `tsc`), não o vitest.
    expectTypeOf<CargoMajoritario>().toEqualTypeOf<"pres" | "gov" | "sen">();
  });
});

describe("RF-287 — o interruptor das assembleias é OUTRA chave", () => {
  it("6 → dep; 7 e 8 → est (uma chave só para as duas casas estaduais)", () => {
    expect(interruptorProjecaoKey(6)).toBe("interruptor-projecao-dep");
    expect(interruptorProjecaoKey(7)).toBe("interruptor-projecao-est");
    expect(interruptorProjecaoKey(8)).toBe("interruptor-projecao-est");
    expect(INTERRUPTOR_PROJECAO_EST_KEY).toBe("interruptor-projecao-est");
    expect(INTERRUPTOR_PROJECAO_EST_KEY).not.toBe(INTERRUPTOR_PROJECAO_DEP_KEY);
    expect(isValidGlobalConfigKey(INTERRUPTOR_PROJECAO_EST_KEY)).toBe(true);
  });

  it("um cargo fora dos proporcionais (por `as`) LANÇA — não cai na chave do federal", () => {
    expect(() => interruptorProjecaoKey(1 as unknown as CargoProporcional)).toThrow(
      /sem interruptor/,
    );
  });

  it.each([
    7, 8,
  ] as const)("readInterruptorProjecao(%s) lê `interruptor-projecao-est`", async (cargo) => {
    getMock.mockResolvedValue({ ligada: true });
    expect(await readInterruptorProjecao(cargo)).toMatchObject({ ligada: true, origem: "chave" });
    expect(getMock.mock.calls.map((c) => c[0])).toEqual(["interruptor-projecao-est"]);
  });

  it("🔴 federal LIGADO e o das assembleias AUSENTE ⇒ as assembleias ficam DESLIGADAS", async () => {
    getMock.mockImplementation(async (chave: string) =>
      chave === "interruptor-projecao-dep" ? { ligada: true } : undefined,
    );
    expect(await readInterruptorProjecao(6)).toMatchObject({ ligada: true });
    expect(await readInterruptorProjecao(7)).toMatchObject({ ligada: false, origem: "ausente" });
    expect(await readInterruptorProjecao(8)).toMatchObject({ ligada: false, origem: "ausente" });
  });

  it("🔴 e o inverso: assembleias ligadas não ligam o federal", async () => {
    getMock.mockImplementation(async (chave: string) =>
      chave === "interruptor-projecao-est" ? { ligada: true } : undefined,
    );
    expect(await readInterruptorProjecao(6)).toMatchObject({ ligada: false, origem: "ausente" });
    expect(await readInterruptorProjecao(7)).toMatchObject({ ligada: true });
  });

  it("🔴 falha FECHADA para qualquer cargo: leitura que lança ⇒ desligada, sem propagar", async () => {
    getMock.mockRejectedValue(new Error("ECONNRESET"));
    for (const cargo of [6, 7, 8] as const) {
      expect(await readInterruptorProjecao(cargo)).toMatchObject({
        ligada: false,
        origem: "falha",
      });
    }
  });

  it("🔴 cargo sem interruptor (por `as`) ⇒ desligada, com alarme, sem ler nada", async () => {
    getMock.mockResolvedValue({ ligada: true });
    const lido = await readInterruptorProjecao(3 as unknown as CargoProporcional);
    expect(lido).toMatchObject({ ligada: false, origem: "falha" });
    expect(getMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Caminhos do Blob
// ---------------------------------------------------------------------------

describe("RF-279 — caminhos do Blob por cargo; o federal INALTERADO", () => {
  it("federal idêntico ao de antes da spec 027", () => {
    expect(deputadoUfBlobPathname(6, "SP")).toBe("deputado/uf/SP.json");
    expect(deputadoUfListaBlobPathname(6, "sp")).toBe("deputado/uf-lista/SP.json");
    expect(prefixoBlobDeputado(6)).toBe("deputado");
  });

  it("estadual e distrital com prefixo próprio", () => {
    expect(deputadoUfBlobPathname(7, "SP")).toBe("deputado-estadual/uf/SP.json");
    expect(deputadoUfListaBlobPathname(7, "SP")).toBe("deputado-estadual/uf-lista/SP.json");
    expect(deputadoUfBlobPathname(8, "DF")).toBe("deputado-distrital/uf/DF.json");
    expect(deputadoUfListaBlobPathname(8, "df")).toBe("deputado-distrital/uf-lista/DF.json");
  });

  it("🔴 nenhum par (cargo, UF) divide caminho com outro — nem objeto da UF, nem lista", () => {
    const vistos = new Map<string, string>();
    for (const cargo of [6, 7, 8] as const) {
      for (const uf of ufsDoCargo(cargo)) {
        for (const caminho of [
          deputadoUfBlobPathname(cargo, uf),
          deputadoUfListaBlobPathname(cargo, uf),
        ]) {
          expect(vistos.get(caminho), caminho).toBeUndefined();
          vistos.set(caminho, `${cargo}:${uf}`);
        }
      }
    }
    // 27 + 26 + 1 UFs, dois objetos cada.
    expect(vistos.size).toBe((27 + 26 + 1) * 2);
    // E o prefixo de um cargo nunca é prefixo do caminho de outro.
    expect(deputadoUfBlobPathname(7, "SP").startsWith("deputado/")).toBe(false);
  });

  it("🔴 UF sem a corrida do cargo LANÇA — o endereço fantasma nem é montado", () => {
    expect(() => deputadoUfBlobPathname(8, "SP")).toThrow(/UF sem corrida/);
    expect(() => deputadoUfBlobPathname(7, "DF")).toThrow(/UF sem corrida/);
    expect(() => deputadoUfListaBlobPathname(8, "RJ")).toThrow(/UF sem corrida/);
    // O federal existe nas 27.
    for (const uf of UFS_DA_ELEICAO) expect(() => deputadoUfBlobPathname(6, uf)).not.toThrow();
  });

  it("cargo que não é proporcional (por `as`) LANÇA", () => {
    expect(() => deputadoUfBlobPathname(5 as unknown as CargoProporcional, "SP")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Leitores do Blob
// ---------------------------------------------------------------------------

function objetoUf(uf: string, cargo: number | undefined): Record<string, unknown> {
  return {
    ts: "2026-10-04T22:00:00-03:00",
    ...(cargo === undefined ? {} : { cargo }),
    turno: 1,
    uf,
    pct_apurado: 40,
    lugares_a_preencher: 94,
    quociente_eleitoral: 100,
    quociente_eleitoral_tse: 100,
    totalizacao_final: false,
    divergencias: [],
    agremiacoes: [],
    vagas_nao_preenchidas: 0,
    empates_indeterminados: [],
  };
}

describe("RF-279 — o leitor do Blob pede o endereço do cargo e confere o `cargo` do objeto", () => {
  it("readDeputadoUfDetail(7, 'SP') busca o objeto ESTADUAL, nunca o federal", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(objetoUf("SP", 7)) as Response);
    const r = await readDeputadoUfDetail(7, "SP");
    expect(r.status).toBe("ok");
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual([`${BASE}/deputado-estadual/uf/SP.json`]);
  });

  it("🔴 objeto do FEDERAL servido no caminho estadual ⇒ `invalid`, nunca `ok`", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(objetoUf("SP", 6)) as Response);
    const r = await readDeputadoUfDetail(7, "SP");
    expect(r).toMatchObject({ status: "unavailable", reason: "invalid" });
  });

  it("objeto sem `cargo` (anterior ao campo) continua aceito", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(objetoUf("SP", undefined)) as Response,
    );
    expect((await readDeputadoUfDetail(6, "SP")).status).toBe("ok");
  });

  it("🔴 cargo 8 em UF que não é o DF ⇒ `invalid` SEM ir à rede", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    expect(await readDeputadoUfDetail(8, "SP")).toMatchObject({
      status: "unavailable",
      reason: "invalid",
      url: null,
    });
    expect(await readDeputadoUfLista(8, "SP")).toMatchObject({ reason: "invalid", url: null });
    expect(f).not.toHaveBeenCalled();
  });

  it("a lista 61+ também confere o cargo", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        ts: "t",
        cargo: 6,
        turno: 1,
        contrato: 2,
        uf: "SP",
        agremiacoes: [],
      }) as Response,
    );
    expect(await readDeputadoUfLista(7, "SP")).toMatchObject({ reason: "invalid" });
    expect(String(f.mock.calls[0]?.[0])).toBe(`${BASE}/deputado-estadual/uf-lista/SP.json`);
  });
});

// ---------------------------------------------------------------------------
// Campos novos do objeto da UF (design 027 § 3.2) — opcionais, aditivos
// ---------------------------------------------------------------------------

describe("spec 027 — `granularidade` e `conferencia.nao_comparou` no leitor tolerante", () => {
  const conferencia = {
    estado: "sem_dado_tse",
    boletim_dado_ts: null,
    totalizacao_final: false,
    comparou: [],
    divergencias: [],
  };

  it("`granularidade: 'uf'` e `nao_comparou` válidos passam intactos", () => {
    const bruto = {
      ...objetoUf("SP", 7),
      granularidade: "uf",
      conferencia: {
        ...conferencia,
        nao_comparou: [
          { comparacao: "eleitorado", motivo: "granularidade_uf" },
          { comparacao: "votos_validos", motivo: "granularidade_uf" },
        ],
      },
    } as unknown as DeputadoUfDetail;
    const saida = sanearDeputadoUfDetail(bruto);
    expect(saida.granularidade).toBe("uf");
    expect(saida.conferencia?.nao_comparou).toHaveLength(2);
    // Em modo resumo a projeção vem AUSENTE — e continua ausente.
    expect(saida).not.toHaveProperty("projecao");
  });

  it("`granularidade` desconhecida sai; o resto do objeto fica", () => {
    const saida = sanearDeputadoUfDetail({
      ...objetoUf("SP", 7),
      granularidade: "municipio",
    } as unknown as DeputadoUfDetail);
    expect(saida).not.toHaveProperty("granularidade");
    expect(saida.uf).toBe("SP");
  });

  it("`nao_comparou` malformado sai SOZINHO — a Conferência continua", () => {
    const saida = sanearDeputadoUfDetail({
      ...objetoUf("SP", 7),
      conferencia: {
        ...conferencia,
        nao_comparou: [{ comparacao: "algoritmo", motivo: "preguica" }],
      },
    } as unknown as DeputadoUfDetail);
    expect(saida.conferencia).toBeDefined();
    expect(saida.conferencia?.estado).toBe("sem_dado_tse");
    expect(saida.conferencia).not.toHaveProperty("nao_comparou");
  });
});
