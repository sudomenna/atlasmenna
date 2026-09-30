/**
 * tests/unit/tse/rate-limiter.test.ts
 *
 * Unit tests para lib/tse/rate-limiter.ts (createTokenBucket + singleton).
 *
 * Cobre: RF-001 (respeitar o limite de 100 req/s/IP do TSE).
 *
 * Estratégia: relógio e sleep injetados via TokenBucketOptions — o "sleep"
 * apenas avança um relógio virtual em vez de esperar tempo real, tornando o
 * teste instantâneo mesmo simulando segundos de espera.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CARGOS, cargoInfo, piorCasoAgregadoRps, ufsDoCargo } from "@/lib/config/cargos";
import {
  createTokenBucket,
  getTseRateLimiter,
  resetTseRateLimiter,
  TSE_BURST_INICIAL,
} from "@/lib/tse/rate-limiter";
import { medirBucket } from "./_taxa-do-bucket";

// ---------------------------------------------------------------------------
// Virtual clock helper
// ---------------------------------------------------------------------------

function makeVirtualClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let clock = 0;
  return {
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
}

// ---------------------------------------------------------------------------
// createTokenBucket
// ---------------------------------------------------------------------------

describe("createTokenBucket", () => {
  it("burst inicial não espera — as primeiras `ratePerSec` chamadas são imediatas", async () => {
    const { now, sleep } = makeVirtualClock();
    const bucket = createTokenBucket({ ratePerSec: 10, now, sleep });

    for (let i = 0; i < 10; i++) {
      await bucket.acquire();
    }

    expect(bucket.stats.waitedMs).toBe(0);
    expect(bucket.stats.acquired).toBe(10);
  });

  it("10 rps → 25 acquire() concorrentes levam >= 1.5s virtuais de espera acumulada", async () => {
    const { now, sleep } = makeVirtualClock();
    const bucket = createTokenBucket({ ratePerSec: 10, now, sleep });

    const calls = Array.from({ length: 25 }, () => bucket.acquire());
    await Promise.all(calls);

    // Primeiras 10 saem do burst sem espera; as 15 restantes precisam
    // esperar ~100ms cada (1/10s) para repor 1 token — total ~1500ms.
    expect(bucket.stats.waitedMs).toBeGreaterThanOrEqual(1500);
    expect(bucket.stats.acquired).toBe(25);
  });

  it("stats.maxQueue reflete o pico de chamadas concorrentes aguardando", async () => {
    const { now, sleep } = makeVirtualClock();
    const bucket = createTokenBucket({ ratePerSec: 5, now, sleep });

    const calls = Array.from({ length: 12 }, () => bucket.acquire());
    expect(bucket.stats.maxQueue).toBe(12);
    await Promise.all(calls);
  });

  it("tryAcquire nunca espera — retorna false quando o bucket está vazio", async () => {
    const { now, sleep } = makeVirtualClock();
    const bucket = createTokenBucket({ ratePerSec: 2, burst: 2, now, sleep });

    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(false); // bucket vazio, relógio não andou
    expect(bucket.stats.waitedMs).toBe(0);
  });

  it("respeita `burst` diferente de `ratePerSec`", async () => {
    const { now, sleep } = makeVirtualClock();
    const bucket = createTokenBucket({ ratePerSec: 10, burst: 3, now, sleep });

    await bucket.acquire();
    await bucket.acquire();
    await bucket.acquire();
    expect(bucket.stats.waitedMs).toBe(0); // 3 tokens de burst, sem espera

    await bucket.acquire(); // 4ª chamada — precisa esperar 1/10s = 100ms
    expect(bucket.stats.waitedMs).toBeGreaterThanOrEqual(100);
  });

  it("lança erro para ratePerSec <= 0", () => {
    expect(() => createTokenBucket({ ratePerSec: 0 })).toThrow();
    expect(() => createTokenBucket({ ratePerSec: -5 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getTseRateLimiter (singleton + env)
// ---------------------------------------------------------------------------

describe("getTseRateLimiter", () => {
  afterEach(() => {
    resetTseRateLimiter();
    vi.unstubAllEnvs();
  });

  // Chamada SEM cargo (tse-watch, diagnóstico, código avulso) cai no teto dos
  // cargos leves — 5 rps. É o valor seguro quando não se sabe quem mais está
  // no ar: o caller sem cargo não pode reservar 35 rps do orçamento do IP.
  // Era 40 até 2026-09-11, quando o teto virou por cargo (ADR-0026).
  it("sem cargo, usa o teto conservador quando TSE_MAX_RPS está ausente (§ 1)", async () => {
    vi.stubEnv("TSE_MAX_RPS", "");
    // O teto sem cargo é o do cargo LEVE de fan-out (Deputado Federal, 5 rps),
    // e não o mínimo da tabela: desde a spec 027 as assembleias (7/8) estão a
    // 1 rps, mas leem no máximo 26 resumos por ciclo — não são referência para
    // uma chamada que não sabe quantos alvos tem (ADR-0067).
    const conservador = cargoInfo(6).rpsMax;
    expect(conservador).toBe(5);
    expect(conservador).toBeLessThan(
      Math.min(
        ...CARGOS.filter((c) => c.granularidade === "zona" && c.cd !== 6).map((c) => c.rpsMax),
      ),
    );
    const { rajada, taxa } = await medirBucket(getTseRateLimiter());

    // Desde 2026-10-03 a rajada é fixa (2); a taxa é medida pelo tempo.
    expect(rajada).toBe(TSE_BURST_INICIAL);
    expect(taxa).toBe(conservador);
  });

  // -------------------------------------------------------------------------
  // RF-010.3 item 2 — restrição AGREGADA (ADR-0035 D3, emenda de 11/09)
  //
  // Desde o cron por cargo, os QUATRO cargos podem ingerir ao mesmo tempo, cada
  // um num processo Fluid Compute isolado com seu PRÓPRIO bucket. Eles não se
  // coordenam, então o teto que importa perante o TSE é a SOMA.
  //
  // Por que isto é aritmética e não simulação: cada bucket já é testado
  // individualmente acima (nunca emite acima da taxa configurada). Com essa
  // garantia por bucket, o agregado de N processos é N × taxa — provar isso
  // "rodando dois buckets" num relógio virtual compartilhado seria teatro,
  // porque o `sleep` de um avançaria o relógio do outro e o resultado sairia
  // artificialmente baixo. O que protege de verdade é travar o NÚMERO.
  //
  // O modo de falha real que este teste pega: alguém acrescenta um cargo à
  // tabela, ou sobe o `rpsMax` de um existente, olhando só para o ceiling de 50
  // — sem notar que o que o TSE mede é a soma dos quatro. Foi exatamente assim
  // que o pico chegou a 160 rps em 2026-09-11, ao dar 40 aos cargos novos.
  // -------------------------------------------------------------------------
  it("os SEIS cargos em paralelo não passam de 82 rps agregados (RF-010.3 item 2, ADR-0067)", () => {
    // Reescrito em 2026-09-11. A versão anterior travava `2 × default = 80` com
    // um default único de 40 — correto enquanto existiam DOIS cargos. Com
    // Senador e Deputado (ADR-0026), os quatro crons de `vercel.ts` coincidem
    // nos minutos 0, 15, 30 e 45, e 4 × 40 daria **160 rps**: acima do teto
    // documentado de 100, que bloqueia o IP por 10 minutos. O teste passava
    // porque media dois cargos num mundo de quatro.
    //
    // A aritmética é sobre as taxas CONFIGURADAS, não sobre dois buckets
    // simulados: num relógio virtual compartilhado o `sleep` de um processo
    // avança o tempo do outro e a taxa medida sai artificialmente baixa — seria
    // um teste que sempre passa. Cada bucket já é testado individualmente; o
    // que protege aqui é travar o número.
    //
    // 2026-09-29 (spec 027 Fase 1, ADR-0067): Deputado Estadual e Distrital
    // entram a 1 rps cada — 80 → 82. O ADR-0036 já recusou 85.
    const TETO_AGREGADO_RPS = 82; // RF-010.3 item 2, emendado pelo ADR-0067
    const TETO_TSE_RPS = 100; // limite documentado, nunca alcançar

    expect(piorCasoAgregadoRps()).toBeLessThanOrEqual(TETO_AGREGADO_RPS);
    expect(piorCasoAgregadoRps()).toBeLessThan(TETO_TSE_RPS);
  });

  it("cada cargo usa o teto da tabela canônica quando TSE_MAX_RPS está ausente", async () => {
    for (const info of CARGOS) {
      resetTseRateLimiter();
      vi.stubEnv("TSE_MAX_RPS", "");
      const { rajada, taxa } = await medirBucket(getTseRateLimiter(info.cd));

      expect(taxa, `cargo ${info.cd} (${info.label})`).toBe(info.rpsMax);
      expect(rajada, `cargo ${info.cd}: rajada`).toBe(TSE_BURST_INICIAL);
    }
  });

  it("RF-285: o ciclo de resumo das assembleias (7/8, em UF) cabe no maxDuration a 1 rps", () => {
    // 26 resumos (7) e 1 (8) por invocação, a 1 rps: ~26 s e ~1 s — muito
    // abaixo dos 300 s. É por isso que 1 rps basta na Fase 1 (ADR-0067).
    const MAX_DURATION_S = 300;
    for (const info of CARGOS.filter((c) => c.granularidade === "uf")) {
      const duracao = ufsDoCargo(info.cd).length / info.rpsMax;
      expect(duracao, `cargo ${info.cd}`).toBeLessThan(MAX_DURATION_S / 10);
    }
    expect(ufsDoCargo(7).length / cargoInfo(7).rpsMax).toBe(26);
    expect(ufsDoCargo(8).length / cargoInfo(8).rpsMax).toBe(1);
  });

  it("o ciclo pesado cabe no maxDuration com o teto do seu cargo (por invocação)", () => {
    // 6.110 alvos por cargo em granularidade zona (medido em 2026-09-11).
    // `maxDuration` das rotas de ingestão é 300 s (ADR-0035 D3).
    //
    // Desde 2026-09-13 o cargo 6 (Deputado Federal) NÃO cabe como cargo
    // INTEIRO numa invocação só (~1.222 s a 5 rps, ver assert isolado abaixo)
    // — por isso ele é fatiado em `NUM_FATIAS_DEPUTADO` invocações
    // (`sliceTargets`, `lib/tse/targets.ts`), cada uma cobrindo ~1/6 do
    // fan-out. Presidente/Governador/Senador seguem cabendo como cargo
    // INTEIRO, numa invocação só (sem fatia) — só o cargo 6 usa o divisor.
    const ALVOS_ZONA = 6110;
    const MAX_DURATION_S = 300;
    const NUM_FATIAS_DEPUTADO = 6;

    for (const info of CARGOS.filter((c) => c.granularidade === "zona")) {
      const alvosPorInvocacao = info.cd === 6 ? ALVOS_ZONA / NUM_FATIAS_DEPUTADO : ALVOS_ZONA;
      const duracao = alvosPorInvocacao / info.rpsMax;
      expect(
        duracao,
        `cargo ${info.cd} (invocação de ${alvosPorInvocacao} alvos) levaria ${duracao.toFixed(0)}s`,
      ).toBeLessThan(MAX_DURATION_S);
    }
  });

  it("o cargo 6 INTEIRO (sem fatiar) NÃO cabe no maxDuration — é por isso que ele fatia", () => {
    // Trava a premissa do teste acima: se um dia isto passar a caber (rpsMax
    // subiu, ou maxDuration subiu), o fatiamento de `sliceTargets` pode ter
    // virado desnecessário — decisão humana, não regressão silenciosa deste
    // teste.
    const ALVOS_ZONA = 6110;
    const MAX_DURATION_S = 300;
    const duracaoCargoInteiro = ALVOS_ZONA / cargoInfo(6).rpsMax;
    expect(duracaoCargoInteiro).toBeGreaterThan(MAX_DURATION_S);
  });

  // O ceiling existe para janela SUPERVISIONADA (simulado, com alguém lendo
  // `rateLimited` ao vivo). Mesmo ele, dobrado, não pode encostar nos 100 do
  // TSE sem que a decisão seja consciente — se este teste falhar, o ceiling
  // subiu e RF-010.3 precisa ser revisto ANTES do código.
  it("nem o ceiling dobrado alcança o limite do TSE (RF-010.3, margem do ceiling)", async () => {
    vi.stubEnv("TSE_MAX_RPS", "500"); // clampa no ceiling
    const { taxa: ceiling } = await medirBucket(getTseRateLimiter());

    expect(ceiling).toBe(50);
    // O ceiling é escotilha de janela SUPERVISIONADA e vale para UM processo.
    // Com quatro cargos, subir todos ao ceiling daria 200 rps — por isso a
    // escotilha só é aceitável com alguém lendo `rateLimited` ao vivo, e o
    // teste trava o que importa: um processo sozinho não encosta nos 100.
    expect(ceiling * 2).toBeLessThanOrEqual(100);
  });

  it("respeita TSE_MAX_RPS dentro do clamp [1, 50]", async () => {
    vi.stubEnv("TSE_MAX_RPS", "7");
    const { taxa } = await medirBucket(getTseRateLimiter());
    expect(taxa).toBe(7);
  });

  // RF-010.3 (spec 001): a taxa efetiva nunca pode passar de 50 req/s, teto de
  // segurança abaixo dos 100 req/s documentados pelo TSE. Se este teste falhar
  // por o clamp ter subido, a spec é que manda — revise RF-010.3 antes do código.
  it("clampa valores acima de 50 para 50 (teto RF-010.3)", async () => {
    vi.stubEnv("TSE_MAX_RPS", "500");
    const { taxa } = await medirBucket(getTseRateLimiter());
    expect(taxa).toBe(50);
  });

  it("clampa valores abaixo de 1 para 1", async () => {
    vi.stubEnv("TSE_MAX_RPS", "0");
    const { taxa } = await medirBucket(getTseRateLimiter(), 20);
    expect(taxa).toBe(1);
  });

  // 2026-10-03 — a rajada inicial dos buckets de PRODUÇÃO é 2, não a taxa. Com
  // `burst = rps` o agregado dos quatro cargos punha 156 req no 1º segundo (o
  // TSE bloqueia o IP por 10 min acima de 100 req/s). Ver ADR-0068.
  it("um bucket recém-criado de 25 rps entrega no máximo 2 sem esperar", () => {
    vi.stubEnv("TSE_MAX_RPS", "");
    const bucket = getTseRateLimiter(1); // Presidente, 25 rps
    expect(cargoInfo(1).rpsMax).toBe(25);

    let semEsperar = 0;
    for (let i = 0; i < 30; i++) {
      if (bucket.tryAcquire()) semEsperar++;
    }
    expect(TSE_BURST_INICIAL).toBe(2);
    expect(semEsperar).toBe(2);
    expect(bucket.stats.waitedMs).toBe(0);
  });

  it("a rajada vale para todo bucket de produção: cada cargo, o sem cargo e o override", () => {
    for (const info of CARGOS) {
      resetTseRateLimiter();
      const b = getTseRateLimiter(info.cd);
      const n = [0, 1, 2, 3, 4].filter(() => b.tryAcquire()).length;
      expect(n, `cargo ${info.cd}`).toBe(TSE_BURST_INICIAL);
    }
    resetTseRateLimiter();
    const semCargo = getTseRateLimiter();
    expect([0, 1, 2, 3, 4].filter(() => semCargo.tryAcquire()).length).toBe(2);

    vi.stubEnv("TSE_MAX_RPS", "50");
    resetTseRateLimiter();
    const alto = getTseRateLimiter(1);
    expect([0, 1, 2, 3, 4].filter(() => alto.tryAcquire()).length).toBe(2);
  });

  it("reaproveita a mesma instância entre chamadas até resetTseRateLimiter()", () => {
    vi.stubEnv("TSE_MAX_RPS", "10");
    const a = getTseRateLimiter();
    const b = getTseRateLimiter();
    expect(a).toBe(b);

    resetTseRateLimiter();
    const c = getTseRateLimiter();
    expect(c).not.toBe(a);
  });
});
