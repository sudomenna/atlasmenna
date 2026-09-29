/**
 * tests/unit/pages/candidatos-etiquetas-paralelo.test.tsx — B2 da auditoria
 * de a11y/perf de 29/09: em `/candidatos`, a leitura das etiquetas começa
 * JUNTO com a das candidaturas, e não depois dela. Até 29/09 a grade esperava
 * as duas em série — inclusive com a chave `chips` desligada, quando o
 * resultado é descartado.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CandidatosUfResult } from "@/lib/blob/candidatos";

const ordem = vi.hoisted(() => [] as string[]);
const soltar = vi.hoisted(() => ({ fn: null as null | ((r: CandidatosUfResult) => void) }));

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () => {
    ordem.push("candidatos");
    return new Promise<CandidatosUfResult>((r) => {
      soltar.fn = r;
    });
  },
}));

vi.mock("@/lib/etiquetas/leitor", async (orig) => {
  const m = await orig<typeof import("@/lib/etiquetas/leitor")>();
  return {
    ...m,
    lerEtiquetas: (o?: { uf?: string | null }) => {
      ordem.push(`etiquetas:${o?.uf ?? "nacional"}`);
      return m.lerEtiquetas(o);
    },
  };
});

import CandidatosPage from "@/app/(cand)/candidatos/page";

const tique = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  ordem.length = 0;
  soltar.fn = null;
});

async function abrir(params: Record<string, string>) {
  const pagina = CandidatosPage({ searchParams: Promise.resolve(params) });
  await tique();
  const antesDeResolver = [...ordem];
  soltar.fn?.({ status: "unavailable", reason: "not_found", url: null });
  await pagina;
  return antesDeResolver;
}

describe("B2 — /candidatos lê etiquetas em paralelo", () => {
  it("🔴 Governador: a leitura das etiquetas já começou ANTES de as candidaturas chegarem", async () => {
    const antes = await abrir({ cargo: "3", uf: "SP" });
    expect(antes).toContain("candidatos");
    expect(antes).toContain("etiquetas:nacional");
  });

  it("🔴 Deputado Federal: pede o arquivo da UF pedida", async () => {
    const antes = await abrir({ cargo: "6", uf: "MG" });
    expect(antes).toContain("etiquetas:MG");
  });

  it("Presidente (sem etiqueta no catálogo) e filtro inválido não leem etiquetas", async () => {
    await abrir({ cargo: "1", uf: "BR" });
    await abrir({ cargo: "99", uf: "SP" });
    expect(ordem.filter((x) => x.startsWith("etiquetas"))).toEqual([]);
  });
});
