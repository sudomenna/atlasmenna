/**
 * tests/unit/utils/anuncios-definidos.test.ts
 *
 * A faixa "AGORA" (e os demais textos de definição) seguem A MESMA regra do
 * balão do mapa — decisão do dono em 2026-10-04: só anunciam quem está
 * MATEMATICAMENTE eleito (`eleitos_definidos`) ou o 2º turno definido do
 * Governador, nunca a `chamada` da projeção.
 */

import { describe, expect, it } from "vitest";
import type { EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import {
  anunciosDeDefinicao,
  eleitosNacionais,
  itensFaixaAgora,
} from "@/lib/utils/anuncios-definidos";

const TS = "2026-10-04T21:40:00-03:00";

function row(sigla: string, o: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla,
    pct_apurado: 60,
    lider: 1,
    margem_atual: 20,
    margem_projetada: 20,
    margem_projetada_ci: [15, 25],
    chamada: true,
    swing_vs_2022: null,
    top_candidatos: [
      { id: 1, pct: 50, nome: "CLÉCIO LUÍS", partido: "UNIÃO" },
      { id: 2, pct: 30, nome: "RANDOLFE", partido: "PT" },
      { id: 3, pct: 20, nome: "FULANO", partido: "PL" },
    ],
    vai_a_2t: null,
    bucket: "chamada",
    ...o,
  } as EdgeUfRow;
}

function payload(
  cargo: number,
  por_uf: EdgeUfRow[],
): Pick<EdgePayload, "cargo" | "por_uf" | "national" | "ts"> {
  return {
    cargo,
    ts: TS,
    por_uf,
    national: { candidatos: [] },
  } as unknown as Pick<EdgePayload, "cargo" | "por_uf" | "national" | "ts">;
}

describe("anunciosDeDefinicao", () => {
  it("🔴 `chamada: true` em toda UF, sem eleito definido ⇒ NENHUM anúncio", () => {
    expect(anunciosDeDefinicao(payload(3, [row("AP"), row("DF"), row("MG")]))).toEqual([]);
    expect(anunciosDeDefinicao(payload(5, [row("AP"), row("DF")]))).toEqual([]);
    expect(anunciosDeDefinicao(payload(1, [row("AP"), row("DF")]))).toEqual([]);
  });

  it("Governador: eleito definido ⇒ um anúncio com o nome PELO ID, mesmo com outro líder projetado", () => {
    // `lider: 1` (projeção), mas o definido é o 2.
    const r = anunciosDeDefinicao(payload(3, [row("AP", { eleitos_definidos: [2] }), row("DF")]));
    expect(r).toEqual([{ chave: "AP", texto: "AP: RANDOLFE (PT) matematicamente eleito" }]);
  });

  it("Governador: 2º turno definido ⇒ 'AP: 2º turno definido', sem nome", () => {
    const r = anunciosDeDefinicao(
      payload(3, [
        row("AP", { segundo_turno_definido: true }),
        row("SP", { eleitos_definidos: [1] }),
      ]),
    );
    expect(r.map((a) => a.texto)).toEqual([
      "AP: 2º turno definido",
      "SP: CLÉCIO LUÍS (UNIÃO) matematicamente eleito",
    ]);
  });

  it("Senado: um eleito (singular) e dois eleitos (plural)", () => {
    const r = anunciosDeDefinicao(
      payload(5, [row("MT", { eleitos_definidos: [1, 2] }), row("GO", { eleitos_definidos: [3] })]),
    );
    expect(r.map((a) => a.texto)).toEqual([
      "GO: FULANO (PL) matematicamente eleito",
      "MT: CLÉCIO LUÍS (UNIÃO) e RANDOLFE (PT) matematicamente eleitos",
    ]);
  });

  it("Presidente: UM anúncio nacional, não um por UF", () => {
    const ufs = ["AC", "BA", "SP", "RJ"].map((s) => row(s, { eleitos_definidos: [2] }));
    const r = anunciosDeDefinicao(payload(1, ufs));
    expect(r).toEqual([{ chave: "BR", texto: "Brasil: RANDOLFE (PT) matematicamente eleito" }]);
    expect(eleitosNacionais(ufs)).toEqual([2]);
  });

  it("id fora de `top_candidatos` e anulada não são anunciados", () => {
    const anulada = row("AP", {
      eleitos_definidos: [1, 99],
      top_candidatos: [{ id: 1, pct: 50, nome: "X", partido: "Y", destino: "anulado" }],
    } as Partial<EdgeUfRow>);
    expect(anunciosDeDefinicao(payload(3, [anulada]))).toEqual([]);
  });

  it("nenhum texto contém 'chamada'", () => {
    const r = anunciosDeDefinicao(
      payload(3, [
        row("AP", { eleitos_definidos: [1] }),
        row("RJ", { segundo_turno_definido: true }),
      ]),
    );
    for (const a of r) expect(a.texto).not.toMatch(/chamad/i);
  });
});

describe("itensFaixaAgora", () => {
  it("carimba cada item com o `ts` do payload", () => {
    const r = itensFaixaAgora(payload(3, [row("AP", { eleitos_definidos: [1] })]));
    expect(r).toEqual([{ ts: TS, texto: "AP: CLÉCIO LUÍS (UNIÃO) matematicamente eleito" }]);
  });
});
