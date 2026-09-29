/**
 * tests/unit/etiquetas/juncao.test.ts
 *
 * RF-232/RF-238 — a junção etiqueta ↔ candidatos, contra os arquivos
 * VERSIONADOS e a fixture do modo simulado:
 *
 *   - a junção nunca muda a ordem (auxiliar de invariância, todos os cenários);
 *   - `sqcand` de Deputado vem como `number` no Blob e junta igual ao texto;
 *   - a fixture do simulado (que usa `sqcand` reais) junta com o universo
 *     compilado — piso de 99%, e não 100%, porque o cadastro do TSE muda
 *     (substituição de candidatura) e a fixture é regenerada em outro ritmo.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { type CategoriaId, ORDEM_CATEGORIAS } from "@/lib/etiquetas/catalogo";
import {
  type ArquivoNacional,
  type ArquivoUf,
  isArquivoNacional,
  isArquivoUf,
} from "@/lib/etiquetas/formato";
import { comEtiquetas } from "@/lib/etiquetas/juncao";
import { montarEtiquetas } from "@/lib/etiquetas/leitor";
import type { Resolucao } from "@/lib/etiquetas/resolver";

import { expectOrdemInvariante } from "./ordem-invariante";

const json = (p: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), p), "utf8"));

function resolucaoFalsa(classificado: boolean): Record<CategoriaId, Resolucao> {
  const out = {} as Record<CategoriaId, Resolucao>;
  for (const c of ORDEM_CATEGORIAS) {
    out[c] = classificado
      ? {
          estado: "classificado",
          etiqueta: {
            categoria: c,
            valor: "x",
            rotulo: "X",
            origem: "partido",
            chave_origem: "partido:X",
            fonte_url: "https://x.org",
            fonte_descricao: "d",
            data: "2026-09-20",
          },
        }
      : { estado: "a_classificar" };
  }
  return out;
}

describe("RF-238 — a junção nunca reordena", () => {
  it("🔴 mesma ordem com etiqueta presente, ausente, parcial ou trocada", () => {
    const candidatos = [
      { sqcand: "13", pct: 40 },
      { sqcand: "22", pct: 38 },
      { sqcand: "45", pct: 12 },
      { sqcand: "50", pct: 9 },
    ];
    expectOrdemInvariante({
      ids: candidatos.map((c) => c.sqcand),
      ordenar: (classificado) =>
        comEtiquetas(candidatos, (c) => resolucaoFalsa(classificado(c.sqcand))).map(
          (x) => x.item.sqcand,
        ),
    });
  });
});

describe("RF-232 — junção com os arquivos versionados e a fixture do simulado", () => {
  const nacional = json("lib/data/etiquetas/nacional.generated.json");
  if (!isArquivoNacional(nacional)) throw new Error("nacional versionado fora do contrato");
  const nac: ArquivoNacional = nacional;

  it("Governador e Senador: a fixture junta com o universo compilado, no cargo certo", () => {
    for (const [arquivo, cargo] of [
      ["tests/fixtures/simulacao/governador.json", 3],
      ["tests/fixtures/simulacao/senador.json", 5],
    ] as const) {
      const p = json(arquivo) as { por_uf: Array<{ top_candidatos: Array<{ sqcand?: string }> }> };
      const sq = p.por_uf.flatMap((r) => r.top_candidatos.map((c) => c.sqcand));
      const juntam = sq.filter((s) => s && nac.candidatos[s]?.cargo === cargo).length;
      expect(sq.length, arquivo).toBeGreaterThan(50);
      expect(juntam / sq.length, arquivo).toBeGreaterThanOrEqual(0.99);
    }
  });

  it("Deputado: sqcand NÚMERO (Blob de UF) junta igual ao texto", () => {
    const fixture = json("tests/fixtures/simulacao/deputado-uf.json") as Record<
      string,
      { agremiacoes: Array<{ eleitos?: Array<{ sqcand: number }> }> }
    >;
    let total = 0;
    let juntam = 0;
    for (const [uf, v] of Object.entries(fixture)) {
      const arq = json(`lib/data/etiquetas/uf/${uf}.generated.json`);
      if (!isArquivoUf(arq, uf)) throw new Error(`UF ${uf} fora do contrato`);
      const e = montarEtiquetas(nac, "embutido", arq as ArquivoUf);
      const conhecidos = new Set(Object.values(arq.por_partido).flat());
      for (const a of v.agremiacoes) {
        for (const c of a.eleitos ?? []) {
          expect(typeof c.sqcand).toBe("number");
          total++;
          if (conhecidos.has(String(c.sqcand))) juntam++;
          expect(e.resolver(c.sqcand, 6, 1)).toEqual(e.resolver(String(c.sqcand), 6, 1));
        }
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(juntam / total).toBeGreaterThanOrEqual(0.99);
  });
});
