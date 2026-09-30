/**
 * tests/unit/tse/targets-assembleias.test.ts
 *
 * Spec 027 (RF-278, RF-285; ADR-0066/0067) — a lista de endereços que pedimos
 * ao TSE para Deputado Estadual (cargo 7) e Deputado Distrital (cargo 8).
 *
 * O que importa provar, e por asserção NEGATIVA:
 *
 *   - 🔴 o cargo 8 só existe no DF — nenhum alvo de outra UF;
 *   - 🔴 o cargo 7 não existe no DF — nenhum alvo do DF;
 *   - as URLs levam `-c0007-`/`-c0008-` e o código da eleição ESTADUAL
 *     (`e021272`), nunca o federal;
 *   - na Fase 1 (granularidade `"uf"`) os dois leem só o resumo de cada UF —
 *     sem consulta à tabela `zonas`;
 *   - o filtro também vale em zona (a Fase 2, ou `TSE_GRANULARIDADE=zona`), e
 *     no preview (whitelist).
 *
 * Um endereço que o TSE não publica é 404 a cada rodada, e 404 também conta
 * para o bloqueio de IP (constituição § 1): sem o filtro, o cargo 8 em zona
 * pediria ~6.090 endereços inexistentes por rodada.
 *
 * `@/lib/db` é mockado como em `targets.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const chain = {
    from: () => Object.assign(Promise.resolve([]), { where: () => Promise.resolve([]) }),
  };
  return {
    db: { select: vi.fn(() => chain) },
    schema: {
      zonas: { codZona: "cod_zona", codMunicipioTse: "cod_municipio_tse", uf: "uf" },
    },
  };
});

import { db } from "@/lib/db";
import { clearTargetsCache, getGranularidade, listIngestTargets } from "@/lib/tse/targets";

const FEDERAL = "ele2026/21270";
const ESTADUAL = "ele2026/21272";

/** Pares de três UFs, uma delas o DF — o caso que separa os dois cargos. */
const PARES = [
  { uf: "SP", codMunicipioTse: 71072, codZona: 1 },
  { uf: "SP", codMunicipioTse: 71072, codZona: 2 },
  { uf: "DF", codMunicipioTse: 97012, codZona: 1 },
  { uf: "DF", codMunicipioTse: 97012, codZona: 14 },
  { uf: "MG", codMunicipioTse: 40177, codZona: 4 },
];

function mockZonasRowsOnce(rows: Array<{ uf: string; codMunicipioTse: number; codZona: number }>) {
  const awaitable = Object.assign(Promise.resolve(rows), { where: () => Promise.resolve(rows) });
  vi.mocked(db.select).mockReturnValueOnce({ from: () => awaitable } as never);
}

beforeEach(() => {
  vi.stubEnv("TSE_COD_ELEICAO", "");
  vi.stubEnv("TSE_COD_ELEICAO_FEDERAL", FEDERAL);
  vi.stubEnv("TSE_COD_ELEICAO_ESTADUAL", ESTADUAL);
  vi.stubEnv("TSE_CARGOS", "");
  vi.stubEnv("TSE_GRANULARIDADE", "");
  vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearTargetsCache();
  vi.mocked(db.select).mockClear();
});

describe("RF-278/RF-285 — Fase 1: um resumo por casa, nas UFs do cargo", () => {
  it("🔴 cargo 8 (Distrital) gera SÓ o resumo do DF — um alvo, sem banco", async () => {
    const targets = await listIngestTargets("production", { cargo: 8 });

    expect(targets).toHaveLength(1);
    const [t] = targets;
    expect(t?.uf).toBe("DF");
    expect(t?.nivel).toBe("uf");
    expect(t?.cargo).toBe(8);
    expect(t?.url).toContain("/dados/df/df-c0008-e021272-u.json");
    expect(t?.codEleicao).toBe(ESTADUAL);
    // Asserção NEGATIVA: nenhuma outra UF, nenhum arquivo nacional.
    expect(targets.filter((x) => x.uf !== "DF")).toEqual([]);
    expect(targets.some((x) => x.nivel === "br")).toBe(false);
    // Em "uf" não se lê a tabela `zonas`.
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });

  it("🔴 cargo 7 (Estadual) gera os 26 resumos — e NUNCA o do DF", async () => {
    const targets = await listIngestTargets("production", { cargo: 7 });

    expect(targets).toHaveLength(26);
    expect(targets.some((t) => t.uf === "DF")).toBe(false);
    expect(targets.every((t) => t.nivel === "uf" && t.cargo === 7)).toBe(true);
    expect(targets.every((t) => /\/[a-z]{2}-c0007-e021272-u\.json$/.test(t.url))).toBe(true);
    expect(new Set(targets.map((t) => t.uf)).size).toBe(26);
    expect(vi.mocked(db.select)).not.toHaveBeenCalled();
  });

  it("as URLs das assembleias usam o código da eleição ESTADUAL, nunca o federal", async () => {
    const t7 = await listIngestTargets("production", { cargo: 7 });
    const t8 = await listIngestTargets("production", { cargo: 8 });
    for (const t of [...t7, ...t8]) {
      expect(t.url).toContain(`/${ESTADUAL}/dados/`);
      expect(t.url).not.toContain("21270");
    }
  });

  it("uma fatia pedida para 7/8 é ignorada em 'uf' — o resumo sai inteiro", async () => {
    // A rota fatiada recusa 7/8 (só aceita o 6), mas a garantia do builder é
    // própria: em "uf" o fatiamento não se aplica.
    const inteiro = await listIngestTargets("production", { cargo: 7 });
    clearTargetsCache();
    const fatiado = await listIngestTargets("production", {
      cargo: 7,
      fatia: { indice: 2, total: 6 },
    });
    expect(fatiado).toEqual(inteiro);
  });

  it("os cargos de antes seguem com as 27 UFs no agregado (o DF incluído)", async () => {
    mockZonasRowsOnce([...PARES]);
    const t6 = await listIngestTargets("production", { cargo: 6 });
    const ufsAgregado = t6.filter((t) => t.nivel === "uf").map((t) => t.uf);
    expect(ufsAgregado).toHaveLength(27);
    expect(ufsAgregado).toContain("DF");
    // E as zonas do DF continuam no federal.
    expect(t6.filter((t) => t.nivel === "zona" && t.uf === "DF")).toHaveLength(2);
  });
});

describe("RF-278 — o filtro vale também em zona (Fase 2 ou TSE_GRANULARIDADE=zona)", () => {
  beforeEach(() => {
    vi.stubEnv("TSE_GRANULARIDADE", "zona");
  });

  it("🔴 cargo 8 em zona: só as zonas do DF (a tabela `zonas` tem o país inteiro)", async () => {
    mockZonasRowsOnce([...PARES]);
    const targets = await listIngestTargets("production", { cargo: 8 });
    const zonas = targets.filter((t) => t.nivel === "zona");
    expect(zonas.map((t) => t.codZona).sort((a, b) => a - b)).toEqual([1, 14]);
    expect(targets.every((t) => t.uf === "DF")).toBe(true);
    expect(targets.every((t) => t.url.includes("-c0008-"))).toBe(true);
  });

  it("🔴 cargo 7 em zona: nenhuma zona do DF", async () => {
    mockZonasRowsOnce([...PARES]);
    const targets = await listIngestTargets("production", { cargo: 7 });
    expect(targets.some((t) => t.uf === "DF")).toBe(false);
    expect(targets.filter((t) => t.nivel === "zona")).toHaveLength(3); // SP ×2 + MG
    expect(targets.filter((t) => t.nivel === "uf")).toHaveLength(26);
  });
});

describe("RF-278 — preview: a whitelist também não pede endereço fantasma", () => {
  it("DF:7 e SP:8 caem com aviso; SP:7 e DF:8 ficam", async () => {
    vi.stubEnv("TSE_GRANULARIDADE", "uf");
    vi.stubEnv("TSE_TARGETS_WHITELIST", "DF:7,SP:7,SP:8,DF:8,RJ:6");
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    const t7 = await listIngestTargets("preview", { cargo: 7 });
    const t8 = await listIngestTargets("preview", { cargo: 8 });

    expect(t7.map((t) => t.uf)).toEqual(["SP"]);
    expect(t8.map((t) => t.uf)).toEqual(["DF"]);
    const avisos = aviso.mock.calls.map((c) => String(c[0]));
    expect(avisos.some((m) => m.includes('"DF:7"'))).toBe(true);
    expect(avisos.some((m) => m.includes('"SP:8"'))).toBe(true);
    aviso.mockRestore();
  });
});

describe("TSE_DEPUTADO_GRANULARIDADE vale para os TRÊS proporcionais (spec 027)", () => {
  it("sem a variável: 6 em zona, 7 e 8 em uf (o padrão da tabela)", () => {
    expect(getGranularidade(6)).toBe("zona");
    expect(getGranularidade(7)).toBe("uf");
    expect(getGranularidade(8)).toBe("uf");
  });

  it("=uf reverte o 6 e mantém 7/8 em uf — sem tocar os majoritários", () => {
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "uf");
    expect(getGranularidade(6)).toBe("uf");
    expect(getGranularidade(7)).toBe("uf");
    expect(getGranularidade(8)).toBe("uf");
    expect(getGranularidade(1)).toBe("zona");
    expect(getGranularidade(3)).toBe("zona");
    expect(getGranularidade(5)).toBe("zona");
  });

  it("=zona alcança 7 e 8 (a chave agora é de todo proporcional), nunca os majoritários", () => {
    vi.stubEnv("TSE_GRANULARIDADE", "uf");
    vi.stubEnv("TSE_DEPUTADO_GRANULARIDADE", "zona");
    expect(getGranularidade(7)).toBe("zona");
    expect(getGranularidade(8)).toBe("zona");
    expect(getGranularidade(1)).toBe("uf");
  });
});
