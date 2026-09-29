/**
 * tests/unit/deputado/resumos-por-uf.test.ts — `resumosPorUf` depois de sair
 * da capa federal para `lib/` (spec 027, frente U-a).
 *
 * A regra não mudou; o que se trava aqui é o uso novo: a capa das assembleias
 * vai juntar os resumos de DOIS payloads (cargo 7 e cargo 8) numa grade só, e
 * cada payload só fala das UFs que traz — nenhuma UF ausente vira zero
 * (RF-124).
 */

import { describe, expect, it } from "vitest";

import { SEM_DADO } from "@/components/blocks/UfBandeirasGrid";
import { resumosPorUf } from "@/lib/deputado/resumos-por-uf";
import type { InterruptorProjecaoLido } from "@/lib/edge-config/reader";
import type { EdgeDeputadoUfRow, EdgePayloadDeputado } from "@/lib/edge-config/types";

const DESLIGADO: InterruptorProjecaoLido = { ligada: false, pct_minimo: 25, origem: "ausente" };
const LIGADO: InterruptorProjecaoLido = { ligada: true, pct_minimo: 25, origem: "chave" };

function linha(over: Partial<EdgeDeputadoUfRow>): EdgeDeputadoUfRow {
  return {
    sigla: "SP",
    pct_apurado: 80,
    lugares_a_preencher: 94,
    quociente_eleitoral: 200_000,
    cadeiras_definidas: 90,
    vagas_nao_preenchidas: 0,
    empates_indeterminados: 0,
    lider: { cod: "22", sigla: "PL", cadeiras: 20 },
    ...over,
  };
}

function payload(por_uf: EdgeDeputadoUfRow[]): EdgePayloadDeputado {
  return { por_uf } as unknown as EdgePayloadDeputado;
}

describe("resumosPorUf", () => {
  it("o texto de sempre: maior bancada, empates, vaga sem candidato, placar", () => {
    const r = resumosPorUf(
      payload([
        linha({ empates_indeterminados: 1, vagas_nao_preenchidas: 1 }),
        linha({ sigla: "RR", lider: null, lugares_a_preencher: null }),
      ]),
      DESLIGADO,
    );
    expect(r.SP).toEqual({
      detalhe:
        "maior bancada: PL (20) · 1 em empate sem desempate previsto · 1 vaga sem candidato elegível",
      vagas: "90 de 94",
    });
    // RF-124 — sem vagas publicadas não há placar.
    expect(r.RR).toEqual({ detalhe: SEM_DADO.detalhe, vagas: SEM_DADO.vagas });
  });

  it("dois payloads (26 assembleias + DF) juntam sem se apagar", () => {
    const estadual = resumosPorUf(payload([linha({})]), DESLIGADO);
    const distrital = resumosPorUf(
      payload([linha({ sigla: "DF", lugares_a_preencher: 24, cadeiras_definidas: 24 })]),
      DESLIGADO,
    );
    const juntos = { ...estadual, ...distrital };
    expect(Object.keys(juntos).sort()).toEqual(["DF", "SP"]);
    expect(juntos.DF?.vagas).toBe("24 de 24");
    expect(juntos.SP?.vagas).toBe("90 de 94");
  });

  it("o selo da projeção só com o interruptor ligado (RF-265)", () => {
    const comProjecao = linha({
      projecao: { estado: "liberada", pct_minimo: 25, zonas_apuradas: 10, zonas_total: 10 },
    } as Partial<EdgeDeputadoUfRow>);
    expect(resumosPorUf(payload([comProjecao]), DESLIGADO).SP?.selo).toBeUndefined();
    expect(resumosPorUf(payload([comProjecao]), LIGADO).SP?.selo).toMatch(/não oficial/);
  });
});
