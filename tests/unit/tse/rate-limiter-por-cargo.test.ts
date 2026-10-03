/**
 * tests/unit/tse/rate-limiter-por-cargo.test.ts
 *
 * ADR-0068 — o bucket de taxa do TSE é POR CARGO dentro do processo, não um
 * singleton de processo. Cobre RF-010.3 (spec 001) e a premissa do pior caso
 * agregado (80 rps = soma dos tetos POR CARGO; 82 quando a spec 027 acrescentar
 * os cargos 7 e 8 a 1 rps cada — ADR-0067).
 *
 * "Mesma instância" aqui é literal: todos os casos rodam no mesmo módulo
 * carregado, que é o que o Fluid Compute faz ao multiplexar invocações.
 *
 * O que cada bloco trava:
 *   (a) criar o bucket do cargo 6 (5 rps) primeiro NÃO muda a taxa do cargo 1 (25);
 *   (b) ciclos concorrentes de cargos DIFERENTES não dividem bucket;
 *   (c) ciclos concorrentes do MESMO cargo dividem o bucket do cargo;
 *   (d) chamada sem cargo não contamina nenhum cargo (nem é contaminada);
 *   (e) `resetTseRateLimiter` limpa todos os buckets;
 *   (f) `fetchEA20` e `detectChangedUfs` pagam no bucket do cargo que recebem;
 *   (g) nenhum caminho de produção pede o bucket "sem cargo".
 *
 * Sem rede: `fetch` é substituído por um 304. Dois instrumentos:
 *   - a TAXA de cada bucket é medida pelo tempo que ele leva para entregar N
 *     tokens, em relógio falso (`medirBucket`, `_taxa-do-bucket.ts`);
 *   - a RAJADA (2 tokens, `TSE_BURST_INICIAL`) é o que sobra para os casos de
 *     fetch em relógio real: o caminho CORRETO nunca precisa esperar, e o
 *     caminho ERRADO (bucket compartilhado) espera, que é o que as asserções
 *     medem.
 *
 * Até 2026-10-03 a rajada era igual à taxa (25) e contar tokens com
 * `tryAcquire()` dava a taxa de graça; com a rajada fixa em 2 isso deixou de
 * valer — daí `medirBucket`.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CargoTse, cargoInfo } from "@/lib/config/cargos";
import { detectChangedUfs } from "@/lib/tse/acompanhamento";
import { fetchEA20 } from "@/lib/tse/client";
import { getTseRateLimiter, resetTseRateLimiter, TSE_BURST_INICIAL } from "@/lib/tse/rate-limiter";
import { medirBucket } from "./_taxa-do-bucket";

// `acompanhamento.ts` importa `targets.ts`, que importa `@/lib/db` — e o client
// do Neon lança na importação sem `DATABASE_URL`. Mockado só para o módulo
// carregar; nada aqui toca banco.
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(() => ({ from: () => Promise.resolve([]) })) },
  schema: {},
}));

const URL_QUALQUER = "https://exemplo.test/ea20.json";

/** Taxa (req/s em regime) do bucket do cargo, medida pelo tempo. */
async function taxaDe(cargo: CargoTse | undefined): Promise<number> {
  return (await medirBucket(getTseRateLimiter(cargo))).taxa;
}

/** Quantos tokens o bucket entrega sem esperar (a rajada). */
function rajadaDe(cargo: CargoTse | undefined): number {
  const bucket = getTseRateLimiter(cargo);
  let n = 0;
  for (let i = 0; i < 1000 && bucket.tryAcquire(); i++) n++;
  return n;
}

function stubFetch304(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(null, { status: 304 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetTseRateLimiter();
  vi.stubEnv("TSE_MAX_RPS", "");
});

afterEach(() => {
  resetTseRateLimiter();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("(a) o bucket de um cargo não herda a taxa de outro", () => {
  it("cargo 6 (5 rps) criado PRIMEIRO não muda os 25 rps do cargo 1 na mesma instância", async () => {
    // O defeito de origem: a 1ª chamada congelava a taxa e as seguintes
    // recebiam o mesmo bucket. Com o 6 na frente, o Presidente andava a 5 rps
    // e 6.110 alvos levavam ~1.222 s — muito além dos 300 s de maxDuration.
    // (A spec 027 acrescenta os cargos 7/8 a 1 rps: o mesmo defeito, pior.)
    expect(getTseRateLimiter(6)).toBeDefined();

    expect(await taxaDe(6)).toBe(cargoInfo(6).rpsMax); // 5
    expect(await taxaDe(1)).toBe(cargoInfo(1).rpsMax); // 25, não 5
  });

  it("vale nos dois sentidos e para todos os cargos: cada um tem o teto da tabela", async () => {
    // Ordem invertida e cargo 6 no meio: nenhum herda de quem veio antes.
    for (const cargo of [1, 6, 3, 5] as const) {
      expect(await taxaDe(cargo), `cargo ${cargo}`).toBe(cargoInfo(cargo).rpsMax);
    }
  });

  it("TSE_MAX_RPS é override global, mas aplicado a CADA bucket (não compartilhado)", async () => {
    vi.stubEnv("TSE_MAX_RPS", "3");
    // Se o override criasse um bucket só, o segundo ficaria com a taxa (e a
    // rajada) já gastas pelo primeiro e mediria diferente de 3.
    expect(await taxaDe(1)).toBe(3);
    expect(await taxaDe(6)).toBe(3);
  });
});

describe("(b) ciclos concorrentes de cargos diferentes não dividem bucket", () => {
  it("2 fetches do cargo 1 + 2 do cargo 3 em paralelo: ninguém espera", async () => {
    stubFetch304();

    await Promise.all([
      ...Array.from({ length: TSE_BURST_INICIAL }, () =>
        fetchEA20({ url: URL_QUALQUER, cargo: 1 }),
      ),
      ...Array.from({ length: TSE_BURST_INICIAL }, () =>
        fetchEA20({ url: URL_QUALQUER, cargo: 3 }),
      ),
    ]);

    // Cada cargo gastou a própria rajada de 2. Com um bucket só (4 pedidos
    // contra 2 tokens) haveria espera.
    expect(getTseRateLimiter(1).stats.acquired).toBe(TSE_BURST_INICIAL);
    expect(getTseRateLimiter(3).stats.acquired).toBe(TSE_BURST_INICIAL);
    expect(getTseRateLimiter(1).stats.waitedMs).toBe(0);
    expect(getTseRateLimiter(3).stats.waitedMs).toBe(0);
  });

  it("esgotar o bucket do cargo 6 não tira token do cargo 1", () => {
    expect(rajadaDe(6)).toBe(TSE_BURST_INICIAL);
    expect(getTseRateLimiter(6).tryAcquire()).toBe(false);
    expect(getTseRateLimiter(1).tryAcquire()).toBe(true);
  });
});

describe("(c) ciclos concorrentes do MESMO cargo dividem o bucket do cargo", () => {
  it("getTseRateLimiter(cargo) devolve sempre o mesmo bucket", () => {
    expect(getTseRateLimiter(1)).toBe(getTseRateLimiter(1));
    expect(getTseRateLimiter(1)).not.toBe(getTseRateLimiter(3));
  });

  it("duas 'invocações' do cargo 1 drenando juntas somam a rajada de 2, não 4", () => {
    // Intercala duas invocações pedindo token ao mesmo tempo: o teto do cargo
    // vale por IP, então a soma é o teto — não o dobro.
    const a = getTseRateLimiter(1);
    const b = getTseRateLimiter(1);
    let tokensA = 0;
    let tokensB = 0;
    for (let i = 0; i < 100; i++) {
      if (a.tryAcquire()) tokensA++;
      if (b.tryAcquire()) tokensB++;
    }
    expect(tokensA + tokensB).toBe(TSE_BURST_INICIAL);
    expect(tokensA).toBeGreaterThan(0);
    expect(tokensB).toBeGreaterThan(0);
  });

  it("2 + 2 fetches concorrentes do cargo 1 ultrapassam a rajada e esperam", async () => {
    stubFetch304();

    await Promise.all([
      ...Array.from({ length: 2 }, () => fetchEA20({ url: URL_QUALQUER, cargo: 1 })), // ciclo A
      ...Array.from({ length: 2 }, () => fetchEA20({ url: URL_QUALQUER, cargo: 1 })), // ciclo B
    ]);

    // 4 pedidos contra 2 tokens: o 3º espera ~40 ms e o 4º ~80 ms. Com um bucket
    // POR INVOCAÇÃO ninguém esperaria — é a divisão do teto que este caso prova.
    const bucket = getTseRateLimiter(1);
    expect(bucket.stats.acquired).toBe(4);
    expect(bucket.stats.waitedMs).toBeGreaterThan(0);
  });
});

describe("(d) chamada sem cargo não contamina nenhum cargo", () => {
  it("o bucket sem cargo é próprio e fica no default seguro (5 rps), criado ou não antes", async () => {
    expect(getTseRateLimiter()).not.toBe(getTseRateLimiter(1));
    expect(getTseRateLimiter()).not.toBe(getTseRateLimiter(6));
    expect(await taxaDe(undefined)).toBe(5);
  });

  it("criar/esgotar o bucket sem cargo PRIMEIRO não altera a taxa de nenhum cargo", async () => {
    expect(await taxaDe(undefined)).toBe(5);
    expect(await taxaDe(1)).toBe(cargoInfo(1).rpsMax);
    expect(await taxaDe(3)).toBe(cargoInfo(3).rpsMax);
    expect(await taxaDe(6)).toBe(cargoInfo(6).rpsMax);
  });

  it("esgotar um cargo não toca o bucket sem cargo, e fetchEA20 com cargo não o consome", async () => {
    rajadaDe(1);
    expect(getTseRateLimiter().stats.acquired).toBe(0);

    stubFetch304();
    await fetchEA20({ url: URL_QUALQUER, cargo: 6 });
    expect(getTseRateLimiter().stats.acquired).toBe(0);
  });
});

describe("(e) resetTseRateLimiter limpa todos os buckets", () => {
  it("depois do reset, cada cargo e o sem cargo voltam com o burst cheio e objetos novos", () => {
    const antes = {
      um: getTseRateLimiter(1),
      seis: getTseRateLimiter(6),
      sem: getTseRateLimiter(),
    };
    rajadaDe(1);
    rajadaDe(6);
    rajadaDe(undefined);

    resetTseRateLimiter();

    expect(getTseRateLimiter(1)).not.toBe(antes.um);
    expect(getTseRateLimiter(6)).not.toBe(antes.seis);
    expect(getTseRateLimiter()).not.toBe(antes.sem);
    expect(rajadaDe(1)).toBe(TSE_BURST_INICIAL);
    expect(rajadaDe(6)).toBe(TSE_BURST_INICIAL);
    expect(rajadaDe(undefined)).toBe(TSE_BURST_INICIAL);
  });
});

describe("(f) o cliente paga no bucket do cargo que recebe", () => {
  it("fetchEA20 cobra só o bucket do cargo informado — inclusive no 304 (RF-010.4)", async () => {
    stubFetch304();

    await fetchEA20({ url: URL_QUALQUER, cargo: 6 });

    expect(getTseRateLimiter(6).stats.acquired).toBe(1);
    for (const outro of [1, 3, 5] as const) {
      expect(getTseRateLimiter(outro).stats.acquired, `cargo ${outro}`).toBe(0);
    }
    expect(getTseRateLimiter().stats.acquired).toBe(0);
  });

  it("detectChangedUfs cobra o bucket do cargo do ciclo que faz a leitura do EA14", async () => {
    stubFetch304();

    await detectChangedUfs({
      cargo: 6,
      codEleicao: "ele2026/21272",
      ufs: ["SP"],
      previous: { etag: '"x"', hashes: { SP: "h" } },
    });

    expect(getTseRateLimiter(6).stats.acquired).toBe(1);
    expect(getTseRateLimiter(3).stats.acquired).toBe(0);
    expect(getTseRateLimiter().stats.acquired).toBe(0);
  });
});

describe("(g) nenhum caminho de produção usa o bucket sem cargo", () => {
  // O bucket sem cargo (5 rps) NÃO entra em `piorCasoAgregadoRps()`. Um chamador
  // de cron que o usasse somaria +5 à conta (80 → 85, ADR-0068 Consequências).
  // O tipo já obriga `fetchEA20` e `detectChangedUfs` a receber `cargo`; este
  // teste cobre o resto — quem chama `getTseRateLimiter` direto.
  const RAIZ = join(__dirname, "..", "..", "..");
  const DIRS_DE_PRODUCAO = ["lib", "app", "scripts", "data-pipeline", "api"];
  // Os ÚNICOS arquivos de produção autorizados a pedir um bucket — todos com cargo.
  const CHAMADORES_AUTORIZADOS = [
    "lib/tse/acompanhamento.ts",
    "lib/tse/client.ts",
    "lib/tse/ingest-handler.ts",
  ];

  function arquivosTs(dir: string): string[] {
    let entradas: string[];
    try {
      entradas = readdirSync(dir);
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const nome of entradas) {
      if (nome === "node_modules" || nome === ".next" || nome.startsWith(".")) continue;
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) out.push(...arquivosTs(caminho));
      else if (/\.(ts|tsx|mjs)$/.test(nome)) out.push(caminho);
    }
    return out;
  }

  /** Tira comentários para a varredura não confundir prosa com chamada. */
  function semComentarios(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const chamadas: { arquivo: string; args: string }[] = [];
  for (const dir of DIRS_DE_PRODUCAO) {
    for (const abs of arquivosTs(join(RAIZ, dir))) {
      const arquivo = relative(RAIZ, abs).replaceAll("\\", "/");
      if (arquivo === "lib/tse/rate-limiter.ts") continue; // a definição
      const codigo = semComentarios(readFileSync(abs, "utf8"));
      for (const m of codigo.matchAll(/getTseRateLimiter\s*\(([^)]*)\)/g)) {
        chamadas.push({ arquivo, args: (m[1] ?? "").trim() });
      }
    }
  }

  it("a varredura enxerga os chamadores conhecidos (senão ela não prova nada)", () => {
    const arquivos = new Set(chamadas.map((c) => c.arquivo));
    for (const esperado of CHAMADORES_AUTORIZADOS) {
      expect(arquivos.has(esperado), esperado).toBe(true);
    }
  });

  it("todo `getTseRateLimiter(...)` de produção passa um cargo", () => {
    const semArgumento = chamadas.filter((c) => c.args === "");
    expect(semArgumento).toEqual([]);
  });

  it("só os três chamadores autorizados pedem bucket — chamador novo precisa passar por revisão", () => {
    const fora = [
      ...new Set(chamadas.map((c) => c.arquivo).filter((a) => !CHAMADORES_AUTORIZADOS.includes(a))),
    ];
    expect(fora).toEqual([]);
  });
});
