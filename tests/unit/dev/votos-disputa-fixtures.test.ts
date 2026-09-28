/**
 * tests/unit/dev/votos-disputa-fixtures.test.ts
 *
 * `por_uf[].votos_disputa_projetados` (capas por região, ADR-0057, decisão do
 * dono de 2026-09-28) chegou aos ARQUIVOS de `tests/fixtures/simulacao/` — e
 * na conta que o gerador faz em `linhaUf` (`data-pipeline/simulacao-gerar.ts`):
 * Σ `votos_projetados` de quem COMPETE na UF, a anulada publicada fora e a sub
 * judice dentro, lido do payload POR UF da MESMA rodada.
 *
 * Mesma razão de existir de `votacao-fixtures.test.ts`: entre o gerador e o
 * disco há um comando (`pnpm sim:full`) que alguém precisa rodar. Se este teste
 * ficar vermelho depois de mexer no gerador, a correção quase sempre é
 * regenerar — `set -a; . ./.env.local; set +a; pnpm sim:full` (NUNCA `pnpm sim`
 * sozinho, `CLAUDE.md § 12`).
 *
 * ⚠️ O que este teste NÃO afirma: que `pct/100 × total` devolve os
 * `votos_projetados` de cada candidatura. No PRODUTOR isso vale por
 * construção (`tests/unit/model/test_votos_disputa_projetados.py`); no gerador
 * não, porque o `pct` do simulado é o share do perfil e os votos saem por
 * destinação (nota "O que NÃO mudou" em `resolverCorridaUf`). Afirmar a
 * igualdade aqui seria testar uma propriedade que a fixture não tem.
 */

import { describe, expect, it } from "vitest";

import type { EdgePayload, EdgePayloadUf } from "@/lib/edge-config/types";
import governador from "../../../tests/fixtures/simulacao/governador.json";
import governadorUf from "../../../tests/fixtures/simulacao/governador-uf.json";
import presidente from "../../../tests/fixtures/simulacao/presidente.json";
import presidenteUf from "../../../tests/fixtures/simulacao/presidente-uf.json";
import senador from "../../../tests/fixtures/simulacao/senador.json";
import senadorUf from "../../../tests/fixtures/simulacao/senador-uf.json";

const CASOS: Array<[string, EdgePayload, Record<string, EdgePayloadUf>]> = [
  [
    "presidente",
    presidente as unknown as EdgePayload,
    presidenteUf as unknown as Record<string, EdgePayloadUf>,
  ],
  [
    "governador",
    governador as unknown as EdgePayload,
    governadorUf as unknown as Record<string, EdgePayloadUf>,
  ],
  [
    "senador",
    senador as unknown as EdgePayload,
    senadorUf as unknown as Record<string, EdgePayloadUf>,
  ],
];

describe("fixture do simulado — por_uf[].votos_disputa_projetados", () => {
  for (const [cargo, nacional, porUf] of CASOS) {
    it(`${cargo}: toda UF apurada tem o total, inteiro, = Σ projetados de quem compete`, () => {
      const apuradas = nacional.por_uf.filter((l) => l.pct_apurado > 0);
      expect(apuradas.length).toBe(27);
      for (const linha of nacional.por_uf) {
        const total = linha.votos_disputa_projetados;
        if (linha.pct_apurado <= 0) {
          // sem apuração, sem projeção: chave ausente, nunca 0.
          expect(total, linha.sigla).toBeUndefined();
          continue;
        }
        expect(Number.isInteger(total), linha.sigla).toBe(true);
        const uf = porUf[linha.sigla];
        expect(uf, linha.sigla).toBeDefined();
        const cands = uf?.candidatos ?? [];
        const competem = cands
          .filter((c) => c.destino !== "anulado")
          .reduce((a, c) => a + (c.votos_projetados ?? 0), 0);
        expect(total, linha.sigla).toBe(competem);
        // A anulada, quando publicada, ficou FORA: o total é a soma de todas
        // menos os projetados dela (0 numa UF sem voto anulado, como AL no
        // Presidente, onde o destino nacional é publicado mas a UF não anula).
        const todos = cands.reduce((a, c) => a + (c.votos_projetados ?? 0), 0);
        const anulada = cands
          .filter((c) => c.destino === "anulado")
          .reduce((a, c) => a + (c.votos_projetados ?? 0), 0);
        expect(total, linha.sigla).toBe(todos - anulada);
      }
    });
  }

  it("a anulada com voto projetado sai do total em ao menos 20 UFs por cargo", () => {
    // Discrimina "esqueceu a anulada": se ela entrasse, total == todos em
    // toda UF e este caso ficaria vermelho.
    for (const [cargo, nacional, porUf] of CASOS) {
      const comAnuladaFora = nacional.por_uf.filter((l) => {
        const cands = porUf[l.sigla]?.candidatos ?? [];
        const todos = cands.reduce((a, c) => a + (c.votos_projetados ?? 0), 0);
        return (l.votos_disputa_projetados as number) < todos;
      });
      expect(comAnuladaFora.length, cargo).toBeGreaterThanOrEqual(20);
    }
  });

  it("senador: o total é em VOTOS (2 por eleitor), nunca pessoas", () => {
    const sen = senador as unknown as EdgePayload;
    const gov = governador as unknown as EdgePayload;
    for (const linha of sen.por_uf) {
      const g = gov.por_uf.find((l) => l.sigla === linha.sigla);
      // mesma UF, mesmo eleitorado: o Senado tem ~2× os votos do Governador.
      const razao =
        (linha.votos_disputa_projetados as number) / (g?.votos_disputa_projetados as number);
      expect(razao, linha.sigla).toBeGreaterThan(1.8);
      expect(razao, linha.sigla).toBeLessThan(2.2);
    }
  });
});
