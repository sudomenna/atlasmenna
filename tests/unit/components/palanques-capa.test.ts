/**
 * tests/unit/components/palanques-capa.test.ts — a ligação do V3 à capa
 * `/governador` (spec 025, RF-251): as três portas, e a leitura do payload de
 * Presidente SÓ depois delas.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const exibivelMock = vi.hoisted(() => ({ forcar: false }));
vi.mock("@/lib/etiquetas/catalogo", async (orig) => {
  const m = await orig<typeof import("@/lib/etiquetas/catalogo")>();
  return {
    ...m,
    categoriaExibivel: (c: string) => exibivelMock.forcar || m.categoriaExibivel(c),
  };
});

import { palanquesDaCapa, portaoPalanques } from "@/components/blocks/_palanques-capa";
import type { EdgePayload } from "@/lib/edge-config/types";
import { cand, payloadTresUfs, ufRow } from "@/tests/fixtures/senado/payload-senado";

import { etiquetasDeTeste, universoDoPayload } from "../etiquetas/_visoes-fixtures";

const gov = { ...payloadTresUfs(), cargo: 3 } as unknown as EdgePayload;
const universo = universoDoPayload(gov, 3);

function comPalanque(ligadas: ("v3" | "chips")[], faltando?: string) {
  return etiquetasDeTeste({
    universo,
    comFoto: false,
    ligadas,
    linhas: {
      "governador.csv": universo
        .filter((u) => u.sqcand !== faltando)
        .map((u) => ({
          chave: u.sqcand,
          categoria: "palanque_presidencial",
          valor: "palanque_lula",
          turno: "1",
        })),
    },
  });
}

const pres = {
  ...payloadTresUfs(),
  cargo: 1,
  por_uf: [ufRow("SP", 50, [cand(13, "PT", 50, { sqcand: "280002542548" })])],
} as unknown as EdgePayload;

beforeEach(() => {
  exibivelMock.forcar = false;
});

describe("RF-251 — V3 na capa de Governador", () => {
  it("🔴 sem critério publicado de palanque ⇒ null, e o payload de Presidente NÃO é lido", async () => {
    const ler = vi.fn(async () => pres);
    expect(portaoPalanques(gov, comPalanque(["v3"])).ok).toBe(true);
    expect(await palanquesDaCapa(gov, comPalanque(["v3"]), ler)).toBeNull();
    expect(ler).not.toHaveBeenCalled();
  });

  it("🔴 chave desligada ⇒ null, sem leitura", async () => {
    exibivelMock.forcar = true;
    const ler = vi.fn(async () => pres);
    expect(await palanquesDaCapa(gov, comPalanque([]), ler)).toBeNull();
    expect(ler).not.toHaveBeenCalled();
  });

  it("🔴 portão fechado (um com chance sem palanque) ⇒ null, sem leitura", async () => {
    exibivelMock.forcar = true;
    const ler = vi.fn(async () => pres);
    const faltando = gov.por_uf[0]?.top_candidatos[0]?.sqcand as string;
    expect(await palanquesDaCapa(gov, comPalanque(["v3"], faltando), ler)).toBeNull();
    expect(ler).not.toHaveBeenCalled();
  });

  it("três portas abertas: UMA leitura de Presidente, 27 ladrilhos por base", async () => {
    exibivelMock.forcar = true;
    const ler = vi.fn(async () => pres);
    const r = await palanquesDaCapa(gov, comPalanque(["v3"]), ler);
    expect(ler).toHaveBeenCalledTimes(1);
    expect(ler).toHaveBeenCalledWith(1);
    expect(r?.projecao).toHaveLength(27);
    expect(r?.parcial).toHaveLength(27);
    const sp = r?.projecao.find((u) => u.uf === "SP");
    expect(sp?.governador?.palanque).toBe("palanque_lula");
    expect(sp?.presidente).toEqual({ lider: "lula" });
  });
});
