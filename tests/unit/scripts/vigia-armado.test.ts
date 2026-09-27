/**
 * tests/unit/scripts/vigia-armado.test.ts
 *
 * Testes do núcleo puro do vigia de CONFIGURAÇÃO (incidente de 2026-09-22).
 *
 * O que estes testes precisam discriminar, e por quê:
 *
 *  1. **Ambiente, não só presença.** O defeito de 22/09 não foi "a variável não
 *     existe" — foi "a variável existe, em `preview`, e o cron só invoca
 *     `production`". Um vigia que só pergunta `envs.some(e => e.key === k)`
 *     teria dito "armado" naquela manhã e a janela teria se perdido do mesmo
 *     jeito. O teste de `preview`-só é o que mata essa mutação; sem ele, o
 *     resto da suíte passa com a verificação de alvo removida.
 *  2. **Cego nunca é igual a errado.** `null` (não consegui olhar) tem de sair
 *     `indeterminado`/1, jamais `desarmado`/2. Foi um 403 permanente lido como
 *     "ainda não publicado" que custou dois dos três dias da janela de 15–17/09.
 *  3. **O erro simétrico.** Chegar em 04/10 com `TSE_BASE_URL` de simulado
 *     ainda em produção é pior que o de 22/09: o site público serviria número
 *     de mentira na noite da eleição. Por isso `dia-d` reprova por SOBRA, não
 *     só por falta — e há um caso em que nada falta e ainda assim reprova.
 */

import { describe, expect, it } from "vitest";
import {
  avaliarArmado,
  type EnvDaVercel,
  EXIGIDAS,
  PROIBIDAS,
} from "../../../scripts/vigia-armado";

/** Monta a lista como a API da Vercel devolve, com alvo explícito. */
function env(key: string, ...target: string[]): EnvDaVercel {
  return { key, target };
}

/** Tudo que o modo simulado exige, corretamente em produção. */
function producaoCompletaSimulado(): EnvDaVercel[] {
  return EXIGIDAS.simulado.map((k) => env(k, "production"));
}

/** Tudo que o modo dia-d exige, corretamente em produção. */
function producaoCompletaDiaD(): EnvDaVercel[] {
  return EXIGIDAS["dia-d"].map((k) => env(k, "production"));
}

describe("avaliarArmado — cego nunca sai com cara de errado", () => {
  it("envs null devolve indeterminado e exit 1, NUNCA desarmado", () => {
    const v = avaliarArmado("simulado", null);
    expect(v.estado).toBe("indeterminado");
    expect(v.exitCode).toBe(1);
    expect(v.faltando).toEqual([]);
  });

  it("lista vazia NÃO é indeterminado — é desarmado, porque olhamos e não achou nada", () => {
    const v = avaliarArmado("simulado", []);
    expect(v.estado).toBe("desarmado");
    expect(v.exitCode).toBe(2);
  });
});

describe("avaliarArmado — o defeito de 22/09: variável certa, ambiente errado", () => {
  it("variável SÓ em preview conta como FALTANDO em produção", () => {
    const envs = EXIGIDAS.simulado.map((k) => env(k, "preview"));
    const v = avaliarArmado("simulado", envs);
    expect(v.estado).toBe("desarmado");
    expect(v.exitCode).toBe(2);
    expect(v.faltando).toEqual([...EXIGIDAS.simulado]);
  });

  it("a config exata de 22/09 — simulado em preview, resto em produção — reprova", () => {
    const soEmPreview = [
      "TSE_BASE_URL",
      "TSE_COD_ELEICAO_FEDERAL",
      "TSE_COD_ELEICAO_ESTADUAL",
      "INGEST_WINDOW",
    ];
    const envs: EnvDaVercel[] = [
      ...soEmPreview.map((k) => env(k, "preview")),
      ...EXIGIDAS.simulado.filter((k) => !soEmPreview.includes(k)).map((k) => env(k, "production")),
    ];
    const v = avaliarArmado("simulado", envs);
    expect(v.estado).toBe("desarmado");
    expect(v.faltando).toEqual(soEmPreview);
  });

  it("variável em preview E production conta como presente", () => {
    const envs = EXIGIDAS.simulado.map((k) => env(k, "preview", "production"));
    const v = avaliarArmado("simulado", envs);
    expect(v.estado).toBe("armado");
    expect(v.exitCode).toBe(0);
  });

  it("tudo em produção devolve armado", () => {
    const v = avaliarArmado("simulado", producaoCompletaSimulado());
    expect(v.estado).toBe("armado");
    expect(v.exitCode).toBe(0);
    expect(v.faltando).toEqual([]);
    expect(v.sobrando).toEqual([]);
  });

  it("UMA variável faltando já reprova, e a mensagem diz qual", () => {
    const envs = producaoCompletaSimulado().filter((e) => e.key !== "INGEST_WINDOW");
    const v = avaliarArmado("simulado", envs);
    expect(v.estado).toBe("desarmado");
    expect(v.faltando).toEqual(["INGEST_WINDOW"]);
    expect(v.mensagem).toContain("INGEST_WINDOW");
  });
});

describe("avaliarArmado — o erro simétrico: sobra de simulado na noite de 04/10", () => {
  it("dia-d com TSE_BASE_URL de simulado ainda em produção REPROVA, mesmo sem faltar nada", () => {
    const envs = [...producaoCompletaDiaD(), env("TSE_BASE_URL", "production")];
    const v = avaliarArmado("dia-d", envs);
    expect(v.estado).toBe("desarmado");
    expect(v.exitCode).toBe(2);
    expect(v.faltando).toEqual([]);
    expect(v.sobrando).toEqual(["TSE_BASE_URL"]);
  });

  it("dia-d com INGEST_WINDOW sobrando reprova — a janela diurna deixa o ciclo mudo às 17h", () => {
    const envs = [...producaoCompletaDiaD(), env("INGEST_WINDOW", "production")];
    const v = avaliarArmado("dia-d", envs);
    expect(v.sobrando).toEqual(["INGEST_WINDOW"]);
    expect(v.exitCode).toBe(2);
  });

  it("dia-d com EDGE_CONFIG_ID sobrando reprova — escrita e leitura cairiam em stores diferentes", () => {
    const envs = [...producaoCompletaDiaD(), env("EDGE_CONFIG_ID", "production")];
    const v = avaliarArmado("dia-d", envs);
    expect(v.sobrando).toEqual(["EDGE_CONFIG_ID"]);
    expect(v.exitCode).toBe(2);
  });

  it("dia-d acusa TODAS as sobras de uma vez, não só a primeira", () => {
    const envs = [
      ...producaoCompletaDiaD(),
      env("TSE_BASE_URL", "production"),
      env("EDGE_CONFIG_ID", "production"),
      env("TSE_GRANULARIDADE", "production"),
    ];
    const v = avaliarArmado("dia-d", envs);
    expect(v.sobrando).toEqual(["TSE_BASE_URL", "EDGE_CONFIG_ID", "TSE_GRANULARIDADE"]);
  });

  it("sobra SÓ em preview não reprova o dia-d — o cron não invoca preview", () => {
    const envs = [...producaoCompletaDiaD(), env("TSE_BASE_URL", "preview")];
    const v = avaliarArmado("dia-d", envs);
    expect(v.sobrando).toEqual([]);
    expect(v.estado).toBe("armado");
  });

  it("dia-d limpo devolve armado", () => {
    const v = avaliarArmado("dia-d", producaoCompletaDiaD());
    expect(v.estado).toBe("armado");
    expect(v.exitCode).toBe(0);
  });

  it("as MESMAS variáveis que reprovam no dia-d são aceitas no simulado", () => {
    const envs = [...producaoCompletaSimulado()];
    expect(avaliarArmado("simulado", envs).estado).toBe("armado");
    expect(PROIBIDAS.simulado).toEqual([]);
    expect(PROIBIDAS["dia-d"]).toContain("TSE_BASE_URL");
  });
});

describe("avaliarArmado — o que NÃO está na lista, e por quê", () => {
  it("TSE_TARGETS_WHITELIST não é exigido: em produção ele é no-op (preview only)", () => {
    expect(EXIGIDAS.simulado).not.toContain("TSE_TARGETS_WHITELIST");
    expect(EXIGIDAS["dia-d"]).not.toContain("TSE_TARGETS_WHITELIST");
  });

  it("target ausente ou malformado conta como NÃO-produção, nunca como presente", () => {
    const envs: EnvDaVercel[] = EXIGIDAS.simulado.map((k) => ({ key: k, target: null }));
    expect(avaliarArmado("simulado", envs).estado).toBe("desarmado");

    const comString: EnvDaVercel[] = EXIGIDAS.simulado.map((k) => ({
      key: k,
      target: "production",
    }));
    expect(avaliarArmado("simulado", comString).estado).toBe("armado");
  });
});
