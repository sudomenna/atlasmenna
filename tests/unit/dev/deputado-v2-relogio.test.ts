/**
 * dev:sim — o detalhe de UF de Deputado v2 (spec 026) anda com o relógio.
 *
 * O objeto de UF de Deputado tem TRÊS relógios desde a spec 026: `ts` (hora do
 * cálculo), `dado_ts` (hora do TSE — `null` no simulado, que não tem fonte) e
 * `conferencia.boletim_dado_ts` (hora do boletim do agregado comparado). Com
 * `FIXTURE_VARIANT=sim` o primeiro é reescrito para "agora"; se o terceiro
 * ficasse parado, a tela de RR diria "atualizado agora" no cabeçalho e "confere
 * com o boletim das 10h40" na Conferência — a mesma discordância de relógios
 * que a série por candidatura já teve (`serie-nacional-relogio.test.ts`).
 *
 * Lê a fixture GRAVADA (`tests/fixtures/simulacao/`), como a tela.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeputadoUfDetail } from "@/lib/blob/deputado-uf";
import {
  simulacaoDeputadoUf,
  simulacaoDeputadoUfLista,
  simulacaoInterruptorProjecao,
} from "@/lib/dev/simulacao";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dev:sim — Deputado v2 com o relógio reescrito (`sim`)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIXTURE_VARIANT", "sim");
  });

  it("🔴 a hora do boletim da Conferência anda JUNTO com o `ts` [mutação: não deslocar `conferencia.boletim_dado_ts`]", () => {
    const rr = simulacaoDeputadoUf("RR");
    expect(rr, "simulação desligada ou deputado-uf.json sem RR").not.toBeNull();
    const boletim = rr?.conferencia?.boletim_dado_ts;
    expect(typeof boletim, "RR sem boletim na Conferência").toBe("string");
    // No gerador o boletim do agregado é o próprio instante do estado
    // simulado (`ts`); deslocados pelo MESMO delta, continuam iguais.
    expect(boletim).toBe(rr?.ts);
    expect(Math.abs(Date.now() - Date.parse(rr?.ts as string))).toBeLessThan(60_000);
  });

  it("`dado_ts: null` continua `null` — o terceiro estado do ADR-0038 não vira hora", () => {
    const sp = simulacaoDeputadoUf("SP");
    expect(sp?.dado_ts).toBeNull();
    expect(sp?.pares_atrasados).toBeNull();
  });

  it("sem agregado lido, o boletim continua `null` (nada a deslocar)", () => {
    const semDado = ["AC", "AL", "AM", "BA"]
      .map((uf) => simulacaoDeputadoUf(uf))
      .find((d) => d?.conferencia?.estado === "sem_dado_tse");
    expect(semDado, "nenhuma UF lenta em sem_dado_tse").toBeDefined();
    expect(semDado?.conferencia?.boletim_dado_ts).toBeNull();
  });

  it("a lista 61+ de SP e o interruptor LIGADO vêm do disco", () => {
    const lista = simulacaoDeputadoUfLista("SP");
    expect(lista?.uf).toBe("SP");
    expect(lista?.agremiacoes.length).toBeGreaterThan(0);
    expect(simulacaoInterruptorProjecao()).toEqual({ ligada: true });
  });
});

describe("dev:sim-velho — o relógio como gravado", () => {
  it("o boletim da Conferência fica exatamente como no arquivo", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIXTURE_VARIANT", "sim-velho");
    const gravado = JSON.parse(
      readFileSync(resolve(process.cwd(), "tests/fixtures/simulacao/deputado-uf.json"), "utf8"),
    ) as Record<string, DeputadoUfDetail>;
    const rr = simulacaoDeputadoUf("RR");
    expect(rr?.conferencia?.boletim_dado_ts).toBe(gravado.RR?.conferencia?.boletim_dado_ts);
    expect(rr?.ts).toBe(gravado.RR?.ts);
  });
});
