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
 * Sem rede: `fetch` é substituído por um 304. O relógio é o real — os casos
 * foram desenhados para que o caminho CORRETO nunca precise esperar (burst do
 * bucket), e para que o caminho ERRADO (bucket compartilhado) espere ou caia na
 * taxa errada, que é o que as asserções medem.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CargoTse, cargoInfo } from "@/lib/config/cargos";
import { detectChangedUfs } from "@/lib/tse/acompanhamento";
import { fetchEA20 } from "@/lib/tse/client";
import { getTseRateLimiter, resetTseRateLimiter } from "@/lib/tse/rate-limiter";

// `acompanhamento.ts` importa `targets.ts`, que importa `@/lib/db` — e o client
// do Neon lança na importação sem `DATABASE_URL`. Mockado só para o módulo
// carregar; nada aqui toca banco.
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(() => ({ from: () => Promise.resolve([]) })) },
  schema: {},
}));

const URL_QUALQUER = "https://exemplo.test/ea20.json";

/** Esvazia o burst do bucket e devolve quantos tokens ele tinha. */
function drenar(cargo: CargoTse | undefined): number {
  const bucket = getTseRateLimiter(cargo);
  let tokens = 0;
  for (let i = 0; i < 1000; i++) {
    if (bucket.tryAcquire()) tokens++;
    else break;
  }
  return tokens;
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
  it("cargo 6 (5 rps) criado PRIMEIRO não muda os 25 rps do cargo 1 na mesma instância", () => {
    // O defeito de origem: a 1ª chamada congelava a taxa e as seguintes
    // recebiam o mesmo bucket. Com o 6 na frente, o Presidente andava a 5 rps
    // e 6.110 alvos levavam ~1.222 s — muito além dos 300 s de maxDuration.
    // (A spec 027 acrescenta os cargos 7/8 a 1 rps: o mesmo defeito, pior.)
    expect(getTseRateLimiter(6)).toBeDefined();

    expect(drenar(6)).toBe(cargoInfo(6).rpsMax); // 5
    expect(drenar(1)).toBe(cargoInfo(1).rpsMax); // 25, não 5
  });

  it("vale nos dois sentidos e para todos os cargos: cada um tem o teto da tabela", () => {
    // Ordem invertida e cargo 6 no meio: nenhum herda de quem veio antes.
    for (const cargo of [1, 6, 3, 5] as const) {
      expect(drenar(cargo), `cargo ${cargo}`).toBe(cargoInfo(cargo).rpsMax);
    }
  });

  it("TSE_MAX_RPS é override global, mas aplicado a CADA bucket (não compartilhado)", () => {
    vi.stubEnv("TSE_MAX_RPS", "3");
    // Se o override criasse um bucket só, o segundo drenar devolveria 0.
    expect(drenar(1)).toBe(3);
    expect(drenar(6)).toBe(3);
  });
});

describe("(b) ciclos concorrentes de cargos diferentes não dividem bucket", () => {
  it("25 fetches do cargo 1 + 25 do cargo 3 em paralelo: ninguém espera", async () => {
    stubFetch304();

    await Promise.all([
      ...Array.from({ length: 25 }, () => fetchEA20({ url: URL_QUALQUER, cargo: 1 })),
      ...Array.from({ length: 25 }, () => fetchEA20({ url: URL_QUALQUER, cargo: 3 })),
    ]);

    // Cada cargo gastou o próprio burst de 25. Com um bucket só (50 pedidos
    // contra 25 tokens) haveria espera e uma das contas passaria de 25.
    expect(getTseRateLimiter(1).stats.acquired).toBe(25);
    expect(getTseRateLimiter(3).stats.acquired).toBe(25);
    expect(getTseRateLimiter(1).stats.waitedMs).toBe(0);
    expect(getTseRateLimiter(3).stats.waitedMs).toBe(0);
  });

  it("esgotar o bucket do cargo 6 não tira token do cargo 1", () => {
    expect(drenar(6)).toBe(5);
    expect(getTseRateLimiter(6).tryAcquire()).toBe(false);
    expect(getTseRateLimiter(1).tryAcquire()).toBe(true);
  });
});

describe("(c) ciclos concorrentes do MESMO cargo dividem o bucket do cargo", () => {
  it("getTseRateLimiter(cargo) devolve sempre o mesmo bucket", () => {
    expect(getTseRateLimiter(1)).toBe(getTseRateLimiter(1));
    expect(getTseRateLimiter(1)).not.toBe(getTseRateLimiter(3));
  });

  it("duas 'invocações' do cargo 1 drenando juntas somam 25, não 50", () => {
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
    expect(tokensA + tokensB).toBe(cargoInfo(1).rpsMax);
    expect(tokensA).toBeGreaterThan(0);
    expect(tokensB).toBeGreaterThan(0);
  });

  it("13 + 13 fetches concorrentes do cargo 1 ultrapassam o burst e UM deles espera", async () => {
    stubFetch304();

    await Promise.all([
      ...Array.from({ length: 13 }, () => fetchEA20({ url: URL_QUALQUER, cargo: 1 })), // ciclo A
      ...Array.from({ length: 13 }, () => fetchEA20({ url: URL_QUALQUER, cargo: 1 })), // ciclo B
    ]);

    // 26 pedidos contra 25 tokens: a 26ª espera ~40 ms. Com um bucket POR
    // INVOCAÇÃO ninguém esperaria — é a divisão do teto que este caso prova.
    const bucket = getTseRateLimiter(1);
    expect(bucket.stats.acquired).toBe(26);
    expect(bucket.stats.waitedMs).toBeGreaterThan(0);
  });
});

describe("(d) chamada sem cargo não contamina nenhum cargo", () => {
  it("o bucket sem cargo é próprio e fica no default seguro (5 rps), criado ou não antes", () => {
    expect(getTseRateLimiter()).not.toBe(getTseRateLimiter(1));
    expect(getTseRateLimiter()).not.toBe(getTseRateLimiter(6));
    expect(drenar(undefined)).toBe(5);
  });

  it("criar/esgotar o bucket sem cargo PRIMEIRO não altera a taxa de nenhum cargo", () => {
    expect(drenar(undefined)).toBe(5);
    expect(drenar(1)).toBe(cargoInfo(1).rpsMax);
    expect(drenar(3)).toBe(cargoInfo(3).rpsMax);
    expect(drenar(6)).toBe(cargoInfo(6).rpsMax);
  });

  it("esgotar um cargo não toca o bucket sem cargo, e fetchEA20 com cargo não o consome", async () => {
    drenar(1);
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
    drenar(1);
    drenar(6);
    drenar(undefined);

    resetTseRateLimiter();

    expect(getTseRateLimiter(1)).not.toBe(antes.um);
    expect(getTseRateLimiter(6)).not.toBe(antes.seis);
    expect(getTseRateLimiter()).not.toBe(antes.sem);
    expect(drenar(1)).toBe(cargoInfo(1).rpsMax);
    expect(drenar(6)).toBe(cargoInfo(6).rpsMax);
    expect(drenar(undefined)).toBe(5);
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
