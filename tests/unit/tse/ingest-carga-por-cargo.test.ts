/**
 * tests/unit/tse/ingest-carga-por-cargo.test.ts
 *
 * ADR-0068 — TESTE DE CARGA SIMULADA. Prova, com relógio falso e sem rede, o que
 * o ADR promete para o dia da apuração: ciclos de cargos DIFERENTES rodando
 * CONCORRENTES no MESMO processo (é o que o Fluid Compute faz ao multiplexar
 * invocações numa instância) não dividem nem trocam taxa entre si.
 *
 * O que roda de verdade (nada aqui é réplica):
 *   - `runIngestCycle` inteiro (semáforo de 20, `withRetry`, `fetchEA20`,
 *     `waitedMs` do ciclo) — um por cargo, em paralelo;
 *   - `listIngestTargets("production")`, o gerador de alvos de produção, sobre
 *     6.110 pares (município × zona) sintéticos nas 27 UFs — o número real
 *     medido em 2026-09-11, mais os 27 (+1 BR no cargo 1) agregados que o
 *     gerador soma por cima (RF-199);
 *   - o limitador por cargo de `lib/tse/rate-limiter.ts`.
 *
 * O que é simulado: o banco (`zonas` devolve os 6.110 pares; o repositório não
 * grava nada), o `fetch` (responde 304 instantâneo e anota "quem pediu, e em que
 * instante simulado") e o relógio (`setTimeout`/`Date` falsos — 4 minutos de
 * apuração rodam em segundos). Como o TSE conta 304 no limite (RF-010.4), o 304
 * é o pior caso honesto: toda requisição paga o bucket e nenhuma custa parse.
 *
 * O que NÃO simula: latência de rede (o `fetch` responde em 0 ms — o que torna
 * a rajada inicial o pior caso possível) e a concorrência ENTRE instâncias
 * (buckets de instâncias diferentes não se coordenam; quem evita duas do mesmo
 * cargo é o lock anti-overlap, que não é o objeto aqui).
 *
 * Mutação que este arquivo precisa matar: "voltar ao singleton" — um bucket só
 * para o processo, com a taxa do primeiro cargo que chamou. Ele reprova em duas
 * frentes: ciclos pesados passam de 300 s (dividindo 25 rps) e a taxa de um
 * cargo vira a de outro.
 */

import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Universo de alvos: 6.110 pares município×zona, distribuídos nas 27 UFs.
// ---------------------------------------------------------------------------

const H = vi.hoisted(() => {
  const UFS = [
    "AC",
    "AL",
    "AM",
    "AP",
    "BA",
    "CE",
    "DF",
    "ES",
    "GO",
    "MA",
    "MG",
    "MS",
    "MT",
    "PA",
    "PB",
    "PE",
    "PI",
    "PR",
    "RJ",
    "RN",
    "RO",
    "RR",
    "RS",
    "SC",
    "SE",
    "SP",
    "TO",
  ];
  const PARES = 6110;
  // ADR-0045 — o exterior: 186 localidades (EA12 federal de 04/10/2026), todas
  // na zona 0001. A tabela `zonas` não depende de cargo; só o cargo 1 as pede
  // (`ufsDoCargo`), e o teste de orçamento abaixo cobra que ele continue
  // cabendo em 300 s a 25 rps com elas.
  const PARES_EXTERIOR = 186;
  const zonas = [
    ...Array.from({ length: PARES }, (_, i) => ({
      uf: UFS[i % UFS.length] as string,
      codMunicipioTse: 10_000 + i,
      codZona: (i % 12) + 1,
    })),
    ...Array.from({ length: PARES_EXTERIOR }, (_, i) => ({
      uf: "ZZ",
      codMunicipioTse: 29_000 + i,
      codZona: 1,
    })),
  ];
  return { zonas, PARES, PARES_EXTERIOR, logs: [] as { notes?: string }[] };
});

vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(() => ({ from: () => Promise.resolve(H.zonas) })) },
  schema: {
    zonas: { codZona: "cod_zona", codMunicipioTse: "cod_municipio_tse", uf: "uf" },
  },
}));

// O repositório não grava: ETag conhecido ⇒ o fetch recebe If-None-Match e o
// CDN simulado responde 304 (o que conta no limite do TSE).
vi.mock("@/lib/tse/repository", () => ({
  getLastEtagAndHash: async () => ({ etag: '"etag-simulado"', hash: "hash-simulado" }),
  getLastIngestRun: async () => null,
  insertSnapshot: async () => {},
  logIngestRun: async (linha: { notes?: string }) => {
    H.logs.push(linha);
  },
}));

vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return { ...real, logInfo: () => {}, logDebug: () => {}, logWarn: () => {}, logError: () => {} };
});

vi.mock("@/lib/tse/alerts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/alerts")>();
  return { ...real, notifySlack: async () => {} };
});

import { type CargoTse, cargoInfo, piorCasoAgregadoRps } from "@/lib/config/cargos";
import { runIngestCycle } from "@/lib/tse/ingest-handler";
import { resetTseRateLimiter, TSE_BURST_INICIAL } from "@/lib/tse/rate-limiter";
import { clearTargetsCache } from "@/lib/tse/targets";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const SEGREDO = "segredo-de-carga";
const T0 = Date.parse("2026-10-04T20:00:00Z");
/** O teto do pior caso agregado que a constituição § 1 exige "bem abaixo" dos 100 do TSE. */
const TETO_AGREGADO_RPS = 80;
/** O limite documentado do TSE: 100 req/s por IP, bloqueio de 10 min acima disso. */
const LIMITE_TSE_RPS = 100;
/**
 * O teto do PICO — qualquer janela de 1 s, inclusive a do 1º segundo. Cada
 * bucket emite no máximo `taxa + rajada` numa janela de 1 s; com a rajada em
 * `TSE_BURST_INICIAL` (2) e os quatro cargos juntos: 27+27+27+7 = 88. Era 156
 * (49+49+49+9) com a rajada igual à taxa — acima dos 100 do TSE.
 */
const TETO_PICO_RPS = TETO_AGREGADO_RPS + 4 * TSE_BURST_INICIAL;
/** maxDuration das rotas de ingestão (ADR-0035 D3). */
const MAX_DURATION_MS = 300_000;

type Ciclo = { cargo: CargoTse; fatia?: { indice: number; total: number } };

interface Resultado {
  /** `durationMs` devolvido pelo próprio ciclo — relógio simulado. */
  duracaoMs: Map<string, number>;
  /** `filesFetched` devolvido pelo ciclo (alvos do ciclo). */
  alvos: Map<string, number>;
  /** `waitedMs` gravado no `ingest_log` do ciclo. */
  esperaMs: Map<string, number>;
  /** Instantes simulados (ms desde T0) de cada requisição, por cargo. */
  instantes: Map<CargoTse, number[]>;
}

const chaveDoCiclo = (c: Ciclo): string =>
  c.fatia ? `${c.cargo}/${c.fatia.indice}` : `${c.cargo}`;

function reqCron(): NextRequest {
  return new Request("https://exemplo.test/api/ingest", {
    method: "POST",
    headers: { "x-cron-secret": SEGREDO },
  }) as unknown as NextRequest;
}

/**
 * Roda os ciclos CONCORRENTES, na ordem dada (a ordem decide quem chega
 * primeiro à instância — exatamente o que o singleton antigo não perdoava), e
 * devolve o que o CDN simulado viu.
 */
async function rodarConcorrentes(ciclos: Ciclo[]): Promise<Resultado> {
  // `setImmediate` NÃO é falsificado: é o que drena a fila de microtarefas entre
  // dois instantes simulados.
  const cedeAoEventLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(T0);

  const instantes = new Map<CargoTse, number[]>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const cargo = Number(/-c(\d{4})-/.exec(url)?.[1]) as CargoTse;
      const lista = instantes.get(cargo) ?? [];
      lista.push(Date.now() - T0);
      instantes.set(cargo, lista);
      return new Response(null, { status: 304 });
    }),
  );

  H.logs.length = 0;
  const duracaoMs = new Map<string, number>();
  const alvos = new Map<string, number>();
  let concluidos = 0;

  const promessas = ciclos.map(async (c) => {
    const res = await runIngestCycle(reqCron(), { cargo: c.cargo, fatia: c.fatia });
    const corpo = (await res.json()) as { durationMs: number; filesFetched: number };
    duracaoMs.set(chaveDoCiclo(c), corpo.durationMs);
    alvos.set(chaveDoCiclo(c), corpo.filesFetched);
    concluidos++;
  });

  // Bomba do relógio falso: deixa tudo que pode andar andar, e só então avança
  // para o próximo instante com timer pendente.
  let voltasSemTimer = 0;
  for (let i = 0; concluidos < ciclos.length; i++) {
    if (i > 2_000_000) throw new Error("simulação não terminou — possível deadlock");
    await cedeAoEventLoop();
    if (vi.getTimerCount() > 0) {
      voltasSemTimer = 0;
      vi.advanceTimersToNextTimer();
    } else if (++voltasSemTimer > 50) {
      throw new Error("ciclos pendentes e nenhum timer — deadlock na simulação");
    }
  }
  await Promise.all(promessas);

  const esperaMs = new Map<string, number>();
  for (const linha of H.logs) {
    const n = JSON.parse(linha.notes ?? "{}") as {
      running?: boolean;
      cargo?: number;
      fatia?: number;
      waitedMs?: number;
    };
    if (n.running === false && n.waitedMs !== undefined) {
      esperaMs.set(n.fatia !== undefined ? `${n.cargo}/${n.fatia}` : `${n.cargo}`, n.waitedMs);
    }
  }

  return { duracaoMs, alvos, esperaMs, instantes };
}

/** Quantas requisições caem em [inicio, inicio + 1000) — janela fixa de 1 s. */
function porSegundo(instantes: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const t of instantes) {
    const s = Math.floor(t / 1000);
    out.set(s, (out.get(s) ?? 0) + 1);
  }
  return out;
}

/** Maior número de requisições em QUALQUER janela deslizante de 1 s. */
function picoDeslizante(instantes: number[]): number {
  const ord = [...instantes].sort((a, b) => a - b);
  let pico = 0;
  let ini = 0;
  for (let fim = 0; fim < ord.length; fim++) {
    while ((ord[fim] as number) - (ord[ini] as number) >= 1000) ini++;
    pico = Math.max(pico, fim - ini + 1);
  }
  return pico;
}

let ambienteOriginal: Record<string, string | undefined> = {};
const VARS = [
  "CRON_SECRET",
  "VERCEL_ENV",
  "INGEST_WINDOW_OVERRIDE",
  "TSE_CARGOS",
  "TSE_MAX_RPS",
  "TSE_COD_ELEICAO_FEDERAL",
  "TSE_COD_ELEICAO_ESTADUAL",
  "TSE_ACOMPANHAMENTO",
  "TSE_GRANULARIDADE",
  "TSE_DEPUTADO_GRANULARIDADE",
  "MODEL_SECRET",
] as const;

beforeEach(() => {
  ambienteOriginal = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  process.env.CRON_SECRET = SEGREDO;
  process.env.VERCEL_ENV = "production";
  process.env.INGEST_WINDOW_OVERRIDE = "true";
  process.env.TSE_CARGOS = "1,3,5,6";
  process.env.TSE_COD_ELEICAO_FEDERAL = "ele2026/21270";
  process.env.TSE_COD_ELEICAO_ESTADUAL = "ele2026/21272";
  delete process.env.TSE_MAX_RPS;
  delete process.env.TSE_ACOMPANHAMENTO;
  delete process.env.TSE_GRANULARIDADE;
  delete process.env.TSE_DEPUTADO_GRANULARIDADE;
  delete process.env.MODEL_SECRET;
  resetTseRateLimiter();
  clearTargetsCache();
});

afterEach(() => {
  for (const v of VARS) {
    const original = ambienteOriginal[v];
    if (original === undefined) delete process.env[v];
    else process.env[v] = original;
  }
  resetTseRateLimiter();
  clearTargetsCache();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// O cenário do dia da apuração: Presidente, Governador, Senador e uma fatia
// do Deputado Federal no ar ao mesmo tempo, na mesma instância.
// ---------------------------------------------------------------------------

const PESADOS: CargoTse[] = [1, 3, 5];
const FATIA_DEP: Ciclo = { cargo: 6, fatia: { indice: 1, total: 6 } };

const ORDENS: { nome: string; ciclos: Ciclo[] }[] = [
  {
    nome: "Presidente chega primeiro",
    ciclos: [{ cargo: 1 }, { cargo: 3 }, { cargo: 5 }, FATIA_DEP],
  },
  {
    // O caso que o singleton não perdoava: o cargo leve (5 rps) chega antes e
    // congelava a taxa do processo inteiro.
    nome: "a fatia do Deputado (5 rps) chega primeiro",
    ciclos: [FATIA_DEP, { cargo: 5 }, { cargo: 3 }, { cargo: 1 }],
  },
];

describe.each(ORDENS)("carga concorrente — $nome", ({ ciclos }) => {
  // Uma simulação por ordem, compartilhada pelos quatro casos (cada um lê uma
  // propriedade diferente da MESMA apuração simulada).
  let cache: Resultado | undefined;
  const obter = async (): Promise<Resultado> => {
    cache ??= await rodarConcorrentes(ciclos);
    return cache;
  };

  it("os três cargos pesados terminam em ≤ 300 s simulados, perto dos ~244 s de 25 rps", async () => {
    const r = await obter();

    for (const cargo of PESADOS) {
      const n = r.alvos.get(`${cargo}`) as number;
      const duracao = r.duracaoMs.get(`${cargo}`) as number;
      const rps = cargoInfo(cargo).rpsMax;

      // O universo é o real: ~6.110 zonas + os agregados de UF (+1 BR no cargo 1).
      // ADR-0045: o cargo 1 tem, além disso, as 186 localidades do exterior e o
      // agregado `zz-c0001` — exatamente 6.110 + 186 + 28 UFs + 1 BR. Os
      // demais NUNCA veem o exterior: exatamente 6.110 + 27.
      if (cargo === 1) {
        expect(n, "cargo 1: alvos").toBe(H.PARES + H.PARES_EXTERIOR + 28 + 1);
      } else {
        expect(n, `cargo ${cargo}: alvos`).toBe(H.PARES + 27);
      }

      // Cabe no maxDuration — com folga, não no fio.
      expect(duracao, `cargo ${cargo}: ${(duracao / 1000).toFixed(1)} s`).toBeLessThanOrEqual(
        MAX_DURATION_MS,
      );
      // E não cabe POR TRAPAÇA: a duração é a do bucket (N alvos a `rps`, menos a
      // rajada inicial de `TSE_BURST_INICIAL` tokens). Um teste que passasse com
      // 0 s não provaria que a taxa foi exercida.
      const esperado = ((n - TSE_BURST_INICIAL) / rps) * 1000;
      expect(duracao, `cargo ${cargo}: duração do bucket`).toBeGreaterThanOrEqual(esperado * 0.99);
      expect(duracao, `cargo ${cargo}: duração do bucket`).toBeLessThanOrEqual(esperado * 1.05);
    }
  }, 180_000);

  it("a fatia do cargo 6 anda a 5 rps e termina em ≤ 300 s (~204 s)", async () => {
    const r = await obter();

    const n = r.alvos.get("6/1") as number;
    const duracao = r.duracaoMs.get("6/1") as number;
    expect(n).toBeGreaterThanOrEqual(1018);
    expect(n).toBeLessThanOrEqual(1030);
    expect(duracao).toBeLessThanOrEqual(MAX_DURATION_MS);

    const esperado = ((n - TSE_BURST_INICIAL) / 5) * 1000;
    expect(duracao).toBeGreaterThanOrEqual(esperado * 0.99);
    expect(duracao).toBeLessThanOrEqual(esperado * 1.05);
  }, 180_000);

  it("taxa observada por cargo nunca passa do teto do cargo; o total, nunca de 80 rps", async () => {
    const r = await obter();

    // O PICO do agregado — o gate que importa para o IP. Os quatro buckets
    // começam juntos e o CDN simulado responde em 0 ms, o pior caso possível.
    // Com a rajada igual à taxa (até 2026-10-03) isto media 156 req no 1º
    // segundo (49+49+49+9), acima dos 100 do TSE. Com a rajada em 2 o teto
    // teórico é 88 — e nenhuma janela de 1 s, deslizante OU fixa, passa dele.
    const todos = PESADOS.concat(6).flatMap((c) => r.instantes.get(c) as number[]);
    const pico = picoDeslizante(todos);
    expect(pico, "pico deslizante do agregado").toBeLessThanOrEqual(TETO_PICO_RPS);
    expect(pico, "pico deslizante do agregado").toBeLessThan(LIMITE_TSE_RPS);
    expect(
      Math.max(...porSegundo(todos).values()),
      "pico em janela fixa de 1 s",
    ).toBeLessThanOrEqual(TETO_PICO_RPS);

    // Regime permanente = janelas fixas de 1 s a partir do 2º segundo: a rajada
    // inicial do bucket (`TSE_BURST_INICIAL` tokens, instantânea) já foi gasta na
    // janela 0.
    const somaPorSegundo = new Map<number, number>();
    for (const cargo of [...PESADOS, 6] as CargoTse[]) {
      const teto = cargoInfo(cargo).rpsMax;
      const janelas = porSegundo(r.instantes.get(cargo) as number[]);
      for (const [s, n] of janelas) {
        if (s >= 1) {
          expect(n, `cargo ${cargo}, janela ${s}s`).toBeLessThanOrEqual(teto);
          somaPorSegundo.set(s, (somaPorSegundo.get(s) ?? 0) + n);
        } else {
          // Janela 0: rajada (2) + reposição de 1 s (`teto`) é o limite teórico
          // de um token bucket — o "pico instantâneo" que o ADR-0035 já registra.
          expect(n, `cargo ${cargo}, janela 0`).toBeLessThanOrEqual(teto + TSE_BURST_INICIAL);
        }
      }

      // Nenhuma janela DESLIZANTE de 1 s passa de rajada + taxa.
      expect(
        picoDeslizante(r.instantes.get(cargo) as number[]),
        `cargo ${cargo}`,
      ).toBeLessThanOrEqual(teto + TSE_BURST_INICIAL);

      // E a média do ciclo inteiro não passa do teto do cargo.
      const total = (r.instantes.get(cargo) as number[]).length;
      const ultimo = Math.max(...(r.instantes.get(cargo) as number[]));
      expect(total / (ultimo / 1000), `cargo ${cargo}: média do ciclo`).toBeLessThanOrEqual(
        teto * 1.01,
      );
    }

    const maxTotalPermanente = Math.max(...somaPorSegundo.values());
    expect(maxTotalPermanente).toBeLessThanOrEqual(TETO_AGREGADO_RPS);
    // A tabela inteira soma os quatro simulados aqui + as assembleias da spec
    // 027 (cargos 7 e 8 a 1 rps cada, resumo por UF — ADR-0067): 80 + 2 = 82.
    // O teste simula só os quatro de fan-out; a soma da tabela tem de bater e
    // continuar bem abaixo dos 100 do TSE (constituição § 1).
    expect(piorCasoAgregadoRps()).toBe(
      TETO_AGREGADO_RPS + cargoInfo(7).rpsMax + cargoInfo(8).rpsMax,
    );
    expect(piorCasoAgregadoRps()).toBe(82);
    // Com os quatro no ar, o regime permanente encosta no teto da soma — e
    // nunca o passa. (Se caísse muito abaixo, a simulação estaria errada.)
    expect(maxTotalPermanente).toBeGreaterThanOrEqual(TETO_AGREGADO_RPS - 1);
  }, 180_000);

  it("o ciclo reporta `waitedMs` do SEU cargo — soma dos deltas, sem misturar cargos", async () => {
    const r = await obter();

    for (const cargo of PESADOS) {
      const espera = r.esperaMs.get(`${cargo}`) as number;
      const duracao = r.duracaoMs.get(`${cargo}`) as number;
      // O ciclo espera quase a duração inteira no bucket do próprio cargo
      // (o resto é o burst). Um `waitedMs` somado de outro bucket passaria da
      // duração do ciclo; um que não contasse o bucket ficaria perto de zero.
      expect(espera, `cargo ${cargo}`).toBeGreaterThan(duracao * 0.95);
      expect(espera, `cargo ${cargo}`).toBeLessThanOrEqual(duracao);
    }
    const espera6 = r.esperaMs.get("6/1") as number;
    const duracao6 = r.duracaoMs.get("6/1") as number;
    expect(espera6).toBeGreaterThan(duracao6 * 0.95);
    expect(espera6).toBeLessThanOrEqual(duracao6);
  }, 180_000);
});
