/**
 * tests/unit/edge-config/writer.test.ts
 *
 * Unit tests for lib/edge-config/writer.ts.
 *
 * Covers
 *   - T03 acceptance: "unit test que mocka `fetch` e confirma PATCH com
 *     payload correto".
 *   - RF-020 (write side da projeção).
 *   - ADR-0001 (Global Config no read path — este é o gatekeeper de gravação).
 *   - Guarda de tamanho do STORE contra o limite real de 1 MB da Vercel:
 *     caminho feliz, limiar, estouro, e falha da medição.
 *
 * Strategy
 *   - `fetch` global é stubado via `vi.stubGlobal('fetch', mockFn)` igual a
 *     `tests/unit/tse/client.test.ts` — sem MSW. Resposta é construída via
 *     `new Response(body, { status })` que é nativo no runtime do vitest.
 *   - `writeProjection` agora faz um `GET` de metadados antes dos `PATCH`,
 *     então os testes de fan-out contam **só as chamadas PATCH** via
 *     `patchCalls()`, em vez do total bruto de `fetch`. Contar o total
 *     tornaria o teste refém da instrumentação.
 *   - O tamanho do store é dirigido pelo `sizeInBytes` que o mock devolve —
 *     não construímos payloads de 800 KB de verdade. O número que a guarda
 *     usa é o da Vercel, e é exatamente esse que estamos injetando.
 *   - Variáveis de ambiente são manipuladas direto em `process.env` e
 *     restauradas em `afterEach` para não vazar entre testes.
 *   - `vi.spyOn(console, ...)` captura warn / log estruturados. `lib/tse/log`
 *     manda warn E error para `console.error`, e info para `console.log`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdgePayload, UfPayloadInput } from "@/lib/edge-config/types";
import { vercelApiUrl, writeEdgePayload, writeProjection } from "@/lib/edge-config/writer";

/**
 * ADR-0032: `writeProjection` passou a escrever TAMBÉM no Vercel Blob, um
 * objeto por UF com payload explícito. O primitivo de escrita é mockado aqui
 * para o teste inspecionar caminho e conteúdo sem tocar rede — a URL
 * determinística e o esquema de caminho têm cobertura própria em
 * `tests/unit/blob/paths.test.ts`.
 */
const putJsonMock = vi.fn(async (pathname: string, value: unknown) => ({
  pathname,
  status: "written" as const,
  bytes: JSON.stringify(value).length,
  url: `https://exemplo.test/${pathname}`,
}));
vi.mock("@/lib/blob/write", () => ({
  BLOB_CACHE_CONTROL_MAX_AGE_SECONDS: 60,
  hasBlobWriteCredentials: () => true,
  putJson: (pathname: string, value: unknown) => putJsonMock(pathname, value),
}));

// ---------------------------------------------------------------------------
// Env management
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "EDGE_CONFIG_TOKEN",
  "EDGE_CONFIG_ID",
  "EDGE_CONFIG",
  // `VERCEL_TEAM_ID` entra aqui porque `vercelApiUrl` anexa `?teamId=` quando
  // ela existe. Quem roda a suíte depois de `. ./.env.local` a tem exportada,
  // e sem esta limpeza as asserções de URL exata abaixo passariam ou
  // quebrariam conforme o shell de quem rodou — o pior tipo de teste.
  "VERCEL_TEAM_ID",
] as const;

/** Snapshot original das envs antes de cada teste. */
const originalEnv: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  EDGE_CONFIG_TOKEN: undefined,
  EDGE_CONFIG_ID: undefined,
  EDGE_CONFIG: undefined,
  VERCEL_TEAM_ID: undefined,
};

beforeEach(() => {
  // Snapshot e limpa.
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  // Restaura o ambiente original — outros testes podem depender.
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stuba `fetch` para resolver uma vez. Retorna a `vi.fn()` para inspeção. */
function mockFetchOnce(status: number, body: string | object = "") {
  const responseBody = typeof body === "string" ? body : JSON.stringify(body);
  const mock = vi.fn().mockResolvedValueOnce(new Response(responseBody, { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/**
 * Stuba a Vercel API inteira, roteando por método/URL:
 *   - `GET /v1/edge-config/<id>`        → metadados (`sizeInBytes`, `itemCount`)
 *   - `GET /v1/edge-config/<id>/items`  → listagem de itens
 *   - `PATCH .../items`                 → upsert
 *
 * Cada rota aceita um override de status ou uma rejeição de rede, para os
 * testes de degradação da guarda.
 */
function mockVercelApi(
  opts: {
    /** Tamanho do store reportado pela Vercel. Default: pequeno (caminho feliz). */
    storeSizeInBytes?: number;
    itemCount?: number;
    /** Força um status non-2xx na leitura de metadados. */
    metaStatus?: number;
    /** Força uma falha de rede na leitura de metadados. */
    metaNetworkError?: Error;
    /** Itens devolvidos pela listagem (tier 2, só acima do limiar). */
    items?: Array<{ key: string; value: unknown }>;
    itemsStatus?: number;
    /** Chaves cujo PATCH deve falhar com 500. */
    failPatchKeys?: string[];
  } = {},
) {
  const mock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    // Roteia pelo PATH, não pela string inteira: desde `vercelApiUrl` a URL
    // pode carregar `?teamId=…`, e `endsWith("/items")` deixaria de casar.
    const path = new URL(url).pathname;

    if (method === "GET" && path.endsWith("/items")) {
      if (opts.itemsStatus !== undefined && opts.itemsStatus >= 400) {
        return Promise.resolve(new Response("nope", { status: opts.itemsStatus }));
      }
      return Promise.resolve(new Response(JSON.stringify(opts.items ?? []), { status: 200 }));
    }

    if (method === "GET") {
      if (opts.metaNetworkError) return Promise.reject(opts.metaNetworkError);
      if (opts.metaStatus !== undefined && opts.metaStatus >= 400) {
        return Promise.resolve(new Response("nope", { status: opts.metaStatus }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "ecfg_proj",
            slug: "atlasmenna",
            digest: "abc123",
            sizeInBytes: opts.storeSizeInBytes ?? 40_000,
            itemCount: opts.itemCount ?? 56,
          }),
          { status: 200 },
        ),
      );
    }

    const body = JSON.parse((init?.body as string) ?? "{}") as {
      items?: Array<{ key?: string }>;
    };
    const key = body.items?.[0]?.key ?? "";
    if (opts.failPatchKeys?.includes(key)) {
      return Promise.resolve(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  });

  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Só as chamadas PATCH — a guarda de tamanho adiciona GETs que não são fan-out. */
function patchCalls(mock: ReturnType<typeof mockVercelApi>) {
  return mock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "PATCH");
}

/** Chaves gravadas, na ordem dos PATCH. */
function keysWritten(mock: ReturnType<typeof mockVercelApi>): string[] {
  return patchCalls(mock).map((call) => {
    const init = call[1] as RequestInit;
    const body = JSON.parse(init.body as string) as { items: Array<{ key: string }> };
    return body.items[0]?.key ?? "";
  });
}

/**
 * Captura `console.error` (warn + error do logger) e devolve as linhas
 * emitidas, já como strings.
 */
function captureErrorLines() {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  return {
    lines: () => spy.mock.calls.map((call) => String(call[0])),
    find: (needle: string) =>
      spy.mock.calls.map((call) => String(call[0])).find((line) => line.includes(needle)),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * `vercelApiUrl` — escopo de time na URL.
 *
 * O store `ecfg_*` do AtlasMenna pertence a um TIME. Um token de escopo de
 * time que chama a API sem `?teamId=` é resolvido no escopo pessoal do dono
 * do token, onde o store não existe: a resposta é 403/404, não um erro de
 * autenticação legível. Como nenhuma das três chamadas do writer jamais
 * rodou contra a API real (a suíte inteira usa `fetch` mockado), estes
 * testes são a única guarda automatizada de que o parâmetro é anexado —
 * `scripts/edge-config-smoke.ts` é a contraparte manual.
 */
describe("vercelApiUrl — escopo de time", () => {
  it("anexa ?teamId= quando VERCEL_TEAM_ID está no ambiente", () => {
    process.env.VERCEL_TEAM_ID = "team_AqxGDYz4Zxs5wUBUDzIpcwBm";

    expect(vercelApiUrl("/v1/edge-config/ecfg_x/items")).toBe(
      "https://api.vercel.com/v1/edge-config/ecfg_x/items?teamId=team_AqxGDYz4Zxs5wUBUDzIpcwBm",
    );
  });

  it("devolve a URL nua quando VERCEL_TEAM_ID está ausente — token pessoal é caso legítimo", () => {
    expect(vercelApiUrl("/v1/edge-config/ecfg_x")).toBe(
      "https://api.vercel.com/v1/edge-config/ecfg_x",
    );
  });

  it("trata VERCEL_TEAM_ID vazia como ausente, não como escopo vazio", () => {
    process.env.VERCEL_TEAM_ID = "";

    expect(vercelApiUrl("/v1/edge-config/ecfg_x/items")).toBe(
      "https://api.vercel.com/v1/edge-config/ecfg_x/items",
    );
  });

  it("usa & quando o path já carrega query string", () => {
    process.env.VERCEL_TEAM_ID = "team_abc";

    const url = vercelApiUrl("/v1/edge-config/ecfg_x/items?limit=10");

    expect(url).toBe("https://api.vercel.com/v1/edge-config/ecfg_x/items?limit=10&teamId=team_abc");
    // Uma única `?` — duas quebrariam o parse do lado da Vercel.
    expect(url.match(/\?/g)).toHaveLength(1);
  });

  it("escapa o valor de VERCEL_TEAM_ID", () => {
    process.env.VERCEL_TEAM_ID = "team a&b";

    expect(vercelApiUrl("/v1/edge-config/ecfg_x")).toBe(
      "https://api.vercel.com/v1/edge-config/ecfg_x?teamId=team%20a%26b",
    );
  });

  it("as três chamadas do writer passam o teamId: PATCH de item, metadados e listagem", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_proj";
    process.env.VERCEL_TEAM_ID = "team_xyz";

    // Store acima do limiar de 780 KB para forçar TAMBÉM a listagem de itens,
    // que no caminho saudável nunca é chamada.
    const fetchMock = mockVercelApi({
      storeSizeInBytes: 800_000,
      items: [{ key: "projection-archive-pres-t1", value: { filler: "x".repeat(20_000) } }],
    });
    captureErrorLines();

    await writeProjection(buildPayload(["SP"]));

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(new URL(url).searchParams.get("teamId")).toBe("team_xyz");
    }

    // E os três endpoints distintos foram de fato exercitados.
    const paths = new Set(urls.map((url) => new URL(url).pathname));
    expect(paths).toContain("/v1/edge-config/ecfg_proj");
    expect(paths).toContain("/v1/edge-config/ecfg_proj/items");
  });

  it("avisa UMA única vez por processo quando VERCEL_TEAM_ID está ausente", async () => {
    // O aviso é estado de módulo: a ausência é propriedade do ambiente, não
    // do request. Um ciclo do cron grava 2+2N chaves e mede o store — sem a
    // trava, seriam ~60 linhas idênticas afogando o log. `resetModules` dá um
    // processo novo do ponto de vista do módulo.
    vi.resetModules();
    const fresh = await import("@/lib/edge-config/writer");
    const logs = captureErrorLines();

    fresh.vercelApiUrl("/v1/edge-config/ecfg_x");
    fresh.vercelApiUrl("/v1/edge-config/ecfg_x/items");
    fresh.vercelApiUrl("/v1/edge-config/ecfg_y");

    const warnings = logs.lines().filter((line) => line.includes("VERCEL_TEAM_ID ausente"));
    expect(warnings).toHaveLength(1);

    const parsed = JSON.parse(warnings[0] as string) as { level: string; msg: string };
    expect(parsed.level).toBe("warn");
    expect(parsed.msg).toContain("teamId");
  });
});

describe("writeEdgePayload — happy path", () => {
  it("envia PATCH com URL, headers e body corretos quando ambas credenciais estão setadas", async () => {
    process.env.EDGE_CONFIG_TOKEN = "test-token-abc";
    process.env.EDGE_CONFIG_ID = "ecfg_testid123";

    const fetchMock = mockFetchOnce(200, { status: "ok" });

    const payload = { ts: "2026-10-04T20:00:00Z", cargo: 1, turno: 1 };
    await writeEdgePayload("projection-current", payload);

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch not called");
    const [url, init] = call as [string, RequestInit];

    // URL deve usar o ID e o endpoint /items.
    expect(url).toBe("https://api.vercel.com/v1/edge-config/ecfg_testid123/items");

    // Verb + headers.
    expect(init.method).toBe("PATCH");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer test-token-abc",
      "Content-Type": "application/json",
    });

    // Body: { items: [{ operation: "upsert", key, value }] }
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody).toEqual({
      items: [
        {
          operation: "upsert",
          key: "projection-current",
          value: payload,
        },
      ],
    });
  });

  it("aceita EDGE_CONFIG (connection string) e extrai o ecfg_* corretamente", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG = "https://edge-config.vercel.com/ecfg_fromConnString?token=readtoken";

    const fetchMock = mockFetchOnce(200);
    await writeEdgePayload("k", { a: 1 });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch not called");
    expect(call[0]).toBe("https://api.vercel.com/v1/edge-config/ecfg_fromConnString/items");
  });

  it("dá preferência a EDGE_CONFIG_ID explícito sobre EDGE_CONFIG", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_explicit";
    process.env.EDGE_CONFIG = "https://edge-config.vercel.com/ecfg_fromConnString?token=x";

    const fetchMock = mockFetchOnce(200);
    await writeEdgePayload("k", { a: 1 });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("fetch not called");
    const url = call[0] as string;
    expect(url).toContain("ecfg_explicit");
    expect(url).not.toContain("ecfg_fromConnString");
  });
});

describe("writeEdgePayload — no-op friendly", () => {
  it("não chama fetch quando EDGE_CONFIG_TOKEN está ausente; loga warn estruturado", async () => {
    process.env.EDGE_CONFIG_ID = "ecfg_present";
    // EDGE_CONFIG_TOKEN faltando.

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // `lib/tse/log` escreve em console.error para warn — capturamos.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(writeEdgePayload("k", { a: 1 })).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    // Garante que a linha de log inclui a chave e a razão.
    const logged = errorSpy.mock.calls[0]?.[0] as string;
    expect(logged).toContain("global-config write skipped");
    expect(logged).toContain('"key":"k"');
    expect(logged).toContain('"hasToken":false');
  });

  it("não chama fetch quando o ID do Edge Config não pode ser resolvido", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok-only";
    // Sem EDGE_CONFIG_ID e sem EDGE_CONFIG.

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await writeEdgePayload("k", {});

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("writeEdgePayload — error handling", () => {
  it("lança Error com status e snippet do corpo quando fetch retorna 401", async () => {
    process.env.EDGE_CONFIG_TOKEN = "bad-token";
    process.env.EDGE_CONFIG_ID = "ecfg_x";

    mockFetchOnce(401, { error: { message: "invalid token" } });

    // Uma única chamada — o snippet do body é parte da MESMA mensagem do error.
    await expect(writeEdgePayload("projection-current", {})).rejects.toThrow(
      /http 401.*invalid token/s,
    );
  });

  it("lança Error com status quando fetch retorna 403", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_x";

    mockFetchOnce(403, "forbidden");

    await expect(writeEdgePayload("k", {})).rejects.toThrow(/http 403/);
  });

  it("encadeia cause quando o fetch falha por rede", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_x";

    const netErr = new Error("ECONNREFUSED");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(netErr));

    await expect(writeEdgePayload("k", {})).rejects.toMatchObject({
      message: expect.stringMatching(/network/),
      cause: netErr,
    });
  });
});

// ---------------------------------------------------------------------------
// A trava de esquema de chave no write path
// ---------------------------------------------------------------------------

describe("writeEdgePayload — trava de esquema de chave", () => {
  it("recusa chave com dois-pontos ANTES de chamar a API da Vercel", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_x";

    const fetchMock = mockFetchOnce(200, { ok: true });

    // Este é literalmente o esquema que o repositório gravava até 2026-09-08.
    await expect(writeEdgePayload("projection:current:pres:t1", {})).rejects.toThrow(
      /chave de Global Config inválida.*":"/s,
    );

    // O ponto da trava: a requisição nem sai. Uma chave fora do padrão
    // documentado nunca chega ao store.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa mesmo SEM credencial — senão CI e dev local passariam cegos", async () => {
    // Sem token/id, `writeEdgePayload` é no-op por design. Se a validação de
    // chave viesse depois desse curto-circuito, toda a suíte (que roda sem
    // credencial) aceitaria chaves inválidas e o erro só apareceria em
    // produção. A ordem é parte da trava.
    delete process.env.EDGE_CONFIG_TOKEN;
    delete process.env.EDGE_CONFIG_ID;

    await expect(writeEdgePayload("projection:uf:SP", {})).rejects.toThrow(
      /chave de Global Config inválida/,
    );
  });

  it("recusa outros caracteres fora de [A-Za-z0-9_-]", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_x";
    const fetchMock = mockFetchOnce(200, { ok: true });

    for (const bad of ["projection.current", "projection current", "projection/uf/SP", ""]) {
      await expect(writeEdgePayload(bad, {})).rejects.toThrow(/inválida/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("todas as chaves que writeProjection produz passam pelo padrão documentado", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_proj";

    const fetchMock = mockVercelApi();
    captureErrorLines();

    await writeProjection(buildPayload(["SP", "RJ", "MG", "DF"]));

    const keys = keysWritten(fetchMock);
    expect(keys.length).toBeGreaterThan(0);
    // Regex transcrita da doc da Vercel, não importada do código — se o
    // padrão em `keys.ts` for afrouxado, este teste ainda pega.
    for (const key of keys) {
      expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(key.length).toBeLessThanOrEqual(256);
    }
  });
});

describe("writeEdgePayload — 200 resolves", () => {
  it("resolve sem erro quando fetch retorna 200", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_x";

    mockFetchOnce(200, { ok: true });

    await expect(writeEdgePayload("k", { hello: "world" })).resolves.toBeUndefined();
  });

  it("resolve em 204 No Content também (Vercel API às vezes retorna 204)", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_x";

    // 204 não aceita body via Response constructor — passar string vazia.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })));

    await expect(writeEdgePayload("k", {})).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// writeProjection (T14) — multi-key serialization
// ---------------------------------------------------------------------------

/**
 * Builda um EdgePayload mínimo com N UFs no `por_uf`. Não cobre todos os
 * campos do shape (national/composition/insights são placeholders) — o
 * teste se importa com a quantidade de chaves gravadas, não com o
 * conteúdo do payload em si.
 */
function buildPayload(ufs: string[]): EdgePayload {
  return {
    ts: "2026-10-04T20:00:00Z",
    cargo: 1,
    turno: 1,
    pct_apurado_total: 12.5,
    ufs_apuradas: ufs.length,
    national: {
      candidatos: [],
      needle_position: 0,
      needle_band: "tossup",
      candidato_a_id: null,
      candidato_b_id: null,
      p_segundo_turno_overall: null,
      cenarios_2t: [],
    },
    por_uf: ufs.map((sigla) => ({
      sigla,
      pct_apurado: 0,
      lider: 1,
      margem_atual: 0,
      margem_projetada: 0,
      margem_projetada_ci: [-5, 5],
      chamada: false,
      swing_vs_2022: 0,
      top_candidatos: [],
      vai_a_2t: null,
      bucket: "indefinido" as const,
    })),
    insights: [],
    composition: { pre_election: 1, model: 0, actual_results: 0 },
  };
}

describe("writeProjection — multi-key fan-out", () => {
  it("grava chaves nomeadas + aliases legacy (2 nacionais + 2 por UF) quando tudo OK", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_proj";

    const fetchMock = mockVercelApi();
    captureErrorLines();

    const payload = buildPayload(["SP", "RJ", "MG"]);
    await writeProjection(payload);

    // 2 nacionais (nomeada + alias) + 2 × 3 UFs (nomeada + alias) = 8 PATCH
    // (S05/F4c ADR-0012). GETs da guarda de tamanho não entram na conta.
    expect(patchCalls(fetchMock)).toHaveLength(8);

    const keys = keysWritten(fetchMock);
    // Nomeadas (S05+).
    expect(keys).toContain("projection-current-pres-t1");
    expect(keys).toContain("projection-uf-SP-pres-t1");
    expect(keys).toContain("projection-uf-RJ-pres-t1");
    expect(keys).toContain("projection-uf-MG-pres-t1");
    // Aliases legacy (backward-compat S04).
    expect(keys).toContain("projection-current");
    expect(keys).toContain("projection-uf-SP");
    expect(keys).toContain("projection-uf-RJ");
    expect(keys).toContain("projection-uf-MG");
  });

  it("warna quando payload nacional ultrapassa 450KB", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_proj";

    mockVercelApi();
    const logs = captureErrorLines();

    // Infla `insights` com strings longas para ultrapassar 450KB.
    // 1 char ≈ 1 byte em JSON ASCII. 500_000 chars > 450 KB com folga.
    const payload = buildPayload(["SP"]);
    payload.insights = ["x".repeat(500_000)];

    await writeProjection(payload);

    expect(logs.find("global-config projection oversize")).toBeDefined();
  });

  it("best-effort: se uma UF falha (500), demais continuam e exceção final agrega", async () => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_proj";

    // Ambas chaves SP (nomeada e alias) falham; as demais gravam.
    const fetchMock = mockVercelApi({
      failPatchKeys: ["projection-uf-SP", "projection-uf-SP-pres-t1"],
    });
    captureErrorLines();

    const payload = buildPayload(["SP", "RJ", "MG"]);

    // 2 chaves SP falham (nomeada + alias) de 8 totais → "2/8".
    await expect(writeProjection(payload)).rejects.toThrow(
      /writeProjection: 2\/8 chave\(s\) falharam.*projection-uf-SP/s,
    );

    // Mesmo com SP falhando, RJ e MG foram tentados (8 PATCH ao todo).
    expect(patchCalls(fetchMock)).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Guarda de tamanho do STORE (limite real: 1 MB, por store inteiro)
// ---------------------------------------------------------------------------

/**
 * O limite da Vercel é **1 MB por store, somando todas as chaves e valores**
 * (`/docs/global-config/global-config-limits`), e a escrita que estouraria o
 * limite é RECUSADA — não truncada. Estes testes fixam os quatro
 * comportamentos que importam na noite da apuração: silêncio quando está
 * tudo bem, aviso acionável no limiar, escalada para `error` perto do
 * estouro, e degradação (nunca queda) quando a medição falha.
 *
 * Limiares em `lib/edge-config/writer.ts`: warn em 780.000 B (78%),
 * crítico em 940.000 B (94%), limite em 1.000.000 B.
 */
describe("writeProjection — guarda de tamanho do store", () => {
  beforeEach(() => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_proj";
  });

  it("caminho feliz: store pequeno não gera warn, e mede via metadados (sem baixar itens)", async () => {
    const fetchMock = mockVercelApi({ storeSizeInBytes: 120_000 });
    const logs = captureErrorLines();

    await writeProjection(buildPayload(["SP", "RJ"]));

    // Nenhum aviso de tamanho.
    expect(logs.find("global-config store size warning")).toBeUndefined();
    expect(logs.find("global-config store size CRÍTICO")).toBeUndefined();
    expect(logs.find("global-config store guard")).toBeUndefined();

    // Exatamente UM GET, e é o de metadados — a listagem de itens (cara)
    // não é tocada abaixo do limiar.
    const gets = fetchMock.mock.calls.filter(
      (call) => ((call[1] as RequestInit | undefined)?.method ?? "GET") === "GET",
    );
    expect(gets).toHaveLength(1);
    expect(gets[0]?.[0]).toBe("https://api.vercel.com/v1/edge-config/ecfg_proj");
  });

  it("limiar: acima de 780 KB emite warn com tamanho, limite, folga, maiores chaves e remédio", async () => {
    const fetchMock = mockVercelApi({
      storeSizeInBytes: 800_000,
      itemCount: 56,
      // Chaves que este ciclo NÃO reescreve — o arquivo congelado do 1T.
      items: [
        { key: "projection-archive-pres-t1", value: { filler: "x".repeat(48_000) } },
        { key: "projection-archive-uf-SP-pres-t1", value: { filler: "x".repeat(12_000) } },
      ],
    });
    const logs = captureErrorLines();

    await writeProjection(buildPayload(["SP", "RJ"]));

    const line = logs.find("global-config store size warning");
    expect(line).toBeDefined();
    const parsed = JSON.parse(line as string) as {
      level: string;
      msg: string;
      ctx: Record<string, number | string>;
    };

    // Severidade: limiar é warn, não error.
    expect(parsed.level).toBe("warn");

    // Aritmética da projeção: nenhuma chave do store está no conjunto de
    // escrita, então o total projetado é store + entrada, sem subtração.
    expect(parsed.ctx.storeBytes).toBe(800_000);
    expect(parsed.ctx.projectedBytes).toBe(800_000 + (parsed.ctx.incomingBytes as number));
    expect(parsed.ctx.headroomBytes).toBe(1_000_000 - (parsed.ctx.projectedBytes as number));

    // A mensagem precisa responder, nela mesma: quanto tem, quanto cabe,
    // quanto falta, o que é grande, e o que fazer.
    expect(parsed.msg).toMatch(
      /^global-config store size warning: \d+ KB de 1\.000 KB \(8\d,\d%\)/,
    );
    expect(parsed.msg).toContain("faltam");
    expect(parsed.msg).toContain("para o limite");
    expect(parsed.msg).toContain("Maiores chaves (store completo)");
    expect(parsed.msg).toContain("projection-archive-pres-t1 (48 KB)");
    expect(parsed.msg).toContain("projection-archive-*");
    expect(parsed.msg).toContain("municipios");

    // Contexto estruturado para filtrar no painel de logs.
    expect(parsed.ctx.limitBytes).toBe(1_000_000);
    expect(parsed.ctx.warnThresholdBytes).toBe(780_000);
    expect(parsed.ctx.criticalThresholdBytes).toBe(940_000);
    expect(parsed.ctx.itemCount).toBe(56);

    // Acima do limiar, a listagem de itens É consultada — é o que revela
    // chaves que este ciclo não escreve.
    const itemGets = fetchMock.mock.calls.filter(
      (call) =>
        ((call[1] as RequestInit | undefined)?.method ?? "GET") === "GET" &&
        String(call[0]).endsWith("/items"),
    );
    expect(itemGets).toHaveLength(1);
  });

  it("projeção exata: o tamanho antigo das chaves que vamos reescrever é subtraído, não somado", async () => {
    // Todas as escritas são upsert — elas SUBSTITUEM. Um store de 800 KB
    // onde 300 KB são de chaves que este ciclo reescreve com payloads
    // pequenos ENCOLHE; somar `store + incoming` reportaria crescimento
    // onde há redução, e a guarda gritaria todo ciclo.
    mockVercelApi({
      storeSizeInBytes: 800_000,
      items: [
        { key: "projection-uf-SP-pres-t1", value: { filler: "x".repeat(300_000) } },
        { key: "projection-archive-pres-t1", value: { filler: "x".repeat(50_000) } },
      ],
    });
    const logs = captureErrorLines();

    await writeProjection(buildPayload(["SP"]));

    const line = logs.find("global-config store size warning");
    expect(line).toBeDefined();
    const parsed = JSON.parse(line as string) as { ctx: Record<string, number> };

    // 800.000 − ~300.025 (tamanho antigo de projection-uf-SP-pres-t1) + entrada.
    expect(parsed.ctx.projectedBytes).toBeLessThan(510_000);
    expect(parsed.ctx.projectedBytes).toBeGreaterThan(495_000);
    // E o store medido continua reportado cru, sem estimativa por cima.
    expect(parsed.ctx.storeBytes).toBe(800_000);
  });

  it("limiar: nomeia uma chave grande que este ciclo NÃO escreve (archive de turno encerrado)", async () => {
    mockVercelApi({
      storeSizeInBytes: 820_000,
      items: [
        { key: "projection-archive-pres-t1", value: { filler: "x".repeat(210_000) } },
        { key: "projection-uf-SP-pres-t1", value: { filler: "x".repeat(9_000) } },
      ],
    });
    const logs = captureErrorLines();

    await writeProjection(buildPayload(["SP"]));

    const line = logs.find("global-config store size warning");
    expect(line).toBeDefined();
    // A chave que dá para apagar aparece nomeada, com o tamanho dela.
    expect(line).toContain("projection-archive-pres-t1 (210 KB)");
    expect(line).toContain("store completo");

    // E as chaves irrelevantes (< 1% do limite) ficam de fora da lista: o
    // aviso é lido sob pressão, ruído ali custa atenção.
    expect(line).not.toContain("(0 KB)");
    expect(line).not.toContain("projection-uf-SP-pres-t1 (");
  });

  it("estouro iminente: acima de 940 KB escala para error e avisa que a escrita pode ser recusada", async () => {
    mockVercelApi({
      storeSizeInBytes: 980_000,
      items: [{ key: "projection-archive-pres-t1", value: { filler: "x".repeat(300_000) } }],
    });
    const logs = captureErrorLines();

    await writeProjection(buildPayload(["SP"]));

    const line = logs.find("global-config store size CRÍTICO");
    expect(line).toBeDefined();
    const parsed = JSON.parse(line as string) as { level: string; msg: string };

    expect(parsed.level).toBe("error");
    expect(parsed.msg).toContain("PRÓXIMA ESCRITA PODE SER RECUSADA");
    expect(parsed.msg).toContain("de 1.000 KB");
  });

  it("estouro: um payload local que sozinho passa de 1 MB dispara o alarme mesmo com store vazio", async () => {
    // Sem depender do que a Vercel reporta: o conjunto de escrita deste
    // ciclo já não cabe. É o cenário medido hoje — 5.572 municípios a
    // ~206 B somam ~1.148 KB só de detalhe municipal.
    mockVercelApi({ storeSizeInBytes: 2, itemCount: 0 });
    const logs = captureErrorLines();

    const payload = buildPayload(["SP"]);
    payload.insights = ["x".repeat(600_000)];

    await writeProjection(payload);

    // 2 chaves nacionais × ~600 KB = ~1,2 MB de escrita nesta rodada.
    expect(logs.find("global-config store size CRÍTICO")).toBeDefined();
  });

  it("medição falha (HTTP 500): a gravação segue, e o aviso diz que está degradado", async () => {
    const fetchMock = mockVercelApi({ metaStatus: 500 });
    const logs = captureErrorLines();

    // Não lança — o pipeline vale mais que a guarda.
    await expect(writeProjection(buildPayload(["SP", "RJ"]))).resolves.toBeUndefined();

    // Todas as 6 chaves foram gravadas mesmo assim.
    expect(patchCalls(fetchMock)).toHaveLength(6);

    const line = logs.find("global-config store guard degraded");
    expect(line).toBeDefined();
    const parsed = JSON.parse(line as string) as { ctx: Record<string, unknown> };
    expect(parsed.ctx.reason).toBe("http 500");
    expect(parsed.ctx.note).toContain("gravação segue");
    // Ainda sabemos o tamanho local, mesmo sem o total do store.
    expect(typeof parsed.ctx.incomingBytes).toBe("number");
  });

  it("medição falha (rede): a gravação segue e o limiar ainda é avaliado com o dado local", async () => {
    const fetchMock = mockVercelApi({ metaNetworkError: new Error("ECONNREFUSED") });
    const logs = captureErrorLines();

    const payload = buildPayload(["SP"]);
    payload.insights = ["x".repeat(500_000)];

    await expect(writeProjection(payload)).resolves.toBeUndefined();
    expect(patchCalls(fetchMock)).toHaveLength(4);

    expect(logs.find("global-config store guard degraded")).toBeDefined();
    // Cego para o store, mas não cego para o próprio payload: 2 × ~500 KB
    // já passa do limiar, e o aviso sai assim mesmo.
    expect(logs.find("global-config store size")).toBeDefined();
  });

  it("listagem de itens falha acima do limiar: avisa mesmo assim, com as chaves que conhece", async () => {
    mockVercelApi({ storeSizeInBytes: 850_000, itemsStatus: 503 });
    const logs = captureErrorLines();

    await writeProjection(buildPayload(["SP"]));

    const line = logs.find("global-config store size warning");
    expect(line).toBeDefined();
    // Degradou a lista, não o aviso: continua dizendo tamanho, limite e folga.
    expect(line).toContain("listagem do store falhou");
    expect(line).toContain("de 1.000 KB");
    expect(line).toContain("projection-current-pres-t1");
  });

  it("sem credencial: a guarda não tenta medir nada e a gravação continua no-op", async () => {
    delete process.env.EDGE_CONFIG_TOKEN;
    delete process.env.EDGE_CONFIG_ID;

    const fetchMock = mockVercelApi();
    const logs = captureErrorLines();

    await expect(writeProjection(buildPayload(["SP"]))).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.find("global-config store guard")).toBeUndefined();
    expect(logs.find("global-config write skipped")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ADR-0032 — a fronteira Global Config × Blob dentro de `writeProjection`
// ---------------------------------------------------------------------------

describe("writeProjection — a guarda RECUSA acima do teto duro (S09 § 4)", () => {
  beforeEach(() => {
    process.env.EDGE_CONFIG_TOKEN = "tok";
    process.env.EDGE_CONFIG_ID = "ecfg_proj";
  });

  /**
   * 🔴 As duas condições da recusa são um PAR, e testá-las juntas é o ponto.
   *
   * Até 18/09 esta guarda dizia, no próprio arquivo, que "NUNCA aborta a
   * gravação nem propaga exceção — o pipeline vale mais que a instrumentação".
   * O princípio continua de pé: a recusa exige medição **confiável** (store
   * medido E chaves listadas) **e** projeção acima do **teto duro**. Qualquer
   * outra combinação segue gravando.
   *
   * Sem o par, o conserto vira o defeito oposto: uma guarda que derruba a
   * ingestão porque a API da Vercel piscou.
   */

  it("recusa ANTES de tentar quando a projeção passa de 1 MB", async () => {
    // 1.020 KB de store + o payload deste ciclo ⇒ projeção acima de 1 MB.
    // ⚠️ A primeira versão deste teste usou 995 KB e NÃO recusava: o payload
    // de duas UFs pesa poucos KB, a projeção dava ~998 KB e ficava abaixo do
    // teto. O teste estava errado, não o código — e só a mensagem de falha
    // ("resolved undefined instead of rejecting") deixou isso visível.
    const fetchMock = mockVercelApi({
      storeSizeInBytes: 1_020_000,
      itemCount: 60,
      items: [{ key: "projection-archive-pres-t1", value: { filler: "x".repeat(900_000) } }],
    });

    await expect(writeProjection(buildPayload(["SP", "RJ"]))).rejects.toThrow(
      /RECUSADO ANTES DE TENTAR/,
    );

    // "Antes de tentar" é literal: nenhum PATCH saiu. A plataforma recusaria
    // sozinha, mas teríamos gasto o tempo do ciclo e recebido um HTTP opaco.
    const patches = fetchMock.mock.calls.filter(
      (call) => ((call[1] as RequestInit | undefined)?.method ?? "GET") === "PATCH",
    );
    expect(patches, "nenhuma escrita deveria ter sido tentada").toHaveLength(0);
  });

  it("a mensagem da recusa diagnostica: quanto ficaria, quanto cabe, o que apagar", async () => {
    // O valor da recusa não é impedir a falha — a plataforma já recusa. É
    // trocar um HTTP não-2xx opaco, às 20h de 04/10, por uma frase que diz o
    // que fazer.
    mockVercelApi({
      storeSizeInBytes: 1_020_000,
      items: [{ key: "projection-archive-pres-t1", value: { filler: "x".repeat(900_000) } }],
    });

    const erro = await writeProjection(buildPayload(["SP"])).catch((e: Error) => e);
    const msg = (erro as Error).message;

    expect(msg).toMatch(/RECUSADO ANTES DE TENTAR/);
    expect(msg, "precisa dizer qual chave está grande").toMatch(/projection-archive-pres-t1/);
    expect(msg, "precisa dizer o que fazer").toMatch(/apagar chaves projection-archive/);
  });

  it("🔴 NÃO recusa quando a medição do store falhou — instrumentação cega não derruba nada", async () => {
    // A metade que protege o pipeline. Sem `storeBytes` a projeção cai em
    // `estimatedBytes`, que ignora tudo que não estamos escrevendo agora:
    // recusar sobre esse número seria parar a apuração porque a API da Vercel
    // não respondeu.
    mockVercelApi({ metaNetworkError: new Error("ECONNRESET") });
    await expect(writeProjection(buildPayload(["SP"]))).resolves.toBeUndefined();
  });

  it("🔴 NÃO recusa quando a listagem de chaves falhou — projeção sem as chaves não é projeção", async () => {
    mockVercelApi({ storeSizeInBytes: 1_020_000, itemsStatus: 500 });
    await expect(writeProjection(buildPayload(["SP"]))).resolves.toBeUndefined();
  });

  it("NÃO recusa no limiar CRÍTICO — 940 KB avisa alto, não aborta", async () => {
    // Par com o primeiro caso: isola o teto duro como a única variável.
    // Confundir os dois transformaria os 60 KB de folga que existem para
    // alguém agir numa parada imediata.
    mockVercelApi({
      storeSizeInBytes: 950_000,
      items: [{ key: "projection-archive-pres-t1", value: { filler: "x".repeat(200) } }],
    });
    await expect(writeProjection(buildPayload(["SP"]))).resolves.toBeUndefined();
  });

  it("sem credencial não recusa — é o caso normal de CI e preview", async () => {
    delete process.env.EDGE_CONFIG_TOKEN;
    mockVercelApi({ storeSizeInBytes: 1_020_000 });
    await expect(writeProjection(buildPayload(["SP"]))).resolves.toBeUndefined();
  });
});

describe("writeProjection — split de detalhe municipal para o Blob (ADR-0032)", () => {
  /** Payload de UF como o orchestrator envia: resumo + detalhe, juntos. */
  function buildUfInput(sigla: string, municipios: number): UfPayloadInput {
    return {
      uf: sigla,
      ts: "2026-10-04T20:00:00Z",
      cargo: 1,
      turno: 1,
      pct_apurado: 42,
      candidatos: [],
      needle_position: 0.1,
      needle_band: "tossup",
      municipios: Array.from({ length: municipios }, (_, i) => ({
        cod_ibge: `35${String(i).padStart(5, "0")}`,
        nome: `Município ${i}`,
        pct_apurado: 50,
        lider: { candidato_id: 1, partido: "P1", votos: 1000, margem_pp: 5 },
        votos_reportados: { 1: 1000, 2: 800 },
      })),
      series_temporais: { margem: [], p_vitoria: [], turnout: [] },
    };
  }

  beforeEach(() => {
    process.env.EDGE_CONFIG_TOKEN = "test-token-abc";
    process.env.EDGE_CONFIG_ID = "ecfg_testid123";
    // `restoreAllMocks` do afterEach global limpa a implementação — repomos.
    putJsonMock.mockReset();
    putJsonMock.mockImplementation(async (pathname: string, value: unknown) => ({
      pathname,
      status: "written" as const,
      bytes: JSON.stringify(value).length,
      url: `https://exemplo.test/${pathname}`,
    }));
  });

  /** Corpo JSON enviado num PATCH, por chave. */
  function valueWrittenFor(
    mock: ReturnType<typeof mockVercelApi>,
    key: string,
  ): Record<string, unknown> | undefined {
    for (const call of patchCalls(mock)) {
      const init = call[1] as RequestInit;
      const body = JSON.parse(init.body as string) as {
        items: Array<{ key: string; value: Record<string, unknown> }>;
      };
      if (body.items[0]?.key === key) return body.items[0]?.value;
    }
    return undefined;
  }

  it("o payload gravado no Global Config NÃO carrega municipios nem series_temporais", async () => {
    const fetchMock = mockVercelApi();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await writeProjection(buildPayload(["SP"]), { SP: buildUfInput("SP", 40) });

    for (const key of ["projection-uf-SP-pres-t1", "projection-uf-SP"]) {
      const value = valueWrittenFor(fetchMock, key);
      expect(value, `chave ${key} deveria ter sido gravada`).toBeDefined();
      expect(value).not.toHaveProperty("municipios");
      expect(value).not.toHaveProperty("series_temporais");
      // O resumo continua íntegro.
      expect(value?.pct_apurado).toBe(42);
    }
  });

  it("grava UM objeto de Blob por UF — não um por chave (nomeada + alias)", async () => {
    mockVercelApi();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await writeProjection(buildPayload(["SP", "RJ"]), {
      SP: buildUfInput("SP", 3),
      RJ: buildUfInput("RJ", 2),
    });

    expect(putJsonMock).toHaveBeenCalledTimes(2);
    expect(putJsonMock.mock.calls.map((c) => c[0])).toEqual([
      "municipios/uf/SP/pres/t1.json",
      "municipios/uf/RJ/pres/t1.json",
    ]);
  });

  it("o objeto de Blob carrega o detalhe, os qualificadores e um `ts` próprio", async () => {
    mockVercelApi();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await writeProjection(buildPayload(["SP"]), { SP: buildUfInput("SP", 5) });

    const detail = putJsonMock.mock.calls[0]?.[1] as {
      ts: string;
      uf: string;
      cargo: string;
      turno: number;
      municipios: unknown[];
      series_temporais: unknown;
    };
    expect(detail.uf).toBe("SP");
    expect(detail.cargo).toBe("pres");
    expect(detail.turno).toBe(1);
    expect(detail.municipios).toHaveLength(5);
    expect(detail.series_temporais).toEqual({ margem: [], p_vitoria: [], turnout: [] });
    // `ts` PRÓPRIO: as duas escritas não são atômicas entre si, e a UI precisa
    // poder datar o detalhe separadamente do resumo.
    expect(detail.ts).not.toBe("2026-10-04T20:00:00Z");
  });

  it("UF sem payload explícito não gera objeto de Blob — só o esqueleto no store", async () => {
    const fetchMock = mockVercelApi();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await writeProjection(buildPayload(["SP", "RJ"]), { SP: buildUfInput("SP", 3) });

    expect(putJsonMock).toHaveBeenCalledTimes(1);
    expect(putJsonMock.mock.calls[0]?.[0]).toBe("municipios/uf/SP/pres/t1.json");
    // O esqueleto de RJ existe no store e também não tem o campo.
    const rj = valueWrittenFor(fetchMock, "projection-uf-RJ-pres-t1");
    expect(rj).toBeDefined();
    expect(rj).not.toHaveProperty("municipios");
  });

  it("falha de Blob NÃO derruba o ciclo — degrada por seção e loga como error", async () => {
    mockVercelApi();
    const logs = captureErrorLines();
    putJsonMock.mockRejectedValueOnce(new Error("blob 500"));

    await expect(
      writeProjection(buildPayload(["SP"]), { SP: buildUfInput("SP", 3) }),
    ).resolves.toBeUndefined();

    const line = logs.find("blob uf detail write failures");
    expect(line).toBeDefined();
    expect(line).toContain("municipios/uf/SP");
    expect(line).toContain("blob 500");
  });

  it("a guarda de store mede o resumo JÁ SEM municípios", async () => {
    // 800 municípios × ~206 B ≈ 165 KB se fossem inline. A contabilidade que
    // alimenta a guarda tem que enxergar o resumo, não o payload de entrada.
    mockVercelApi({ storeSizeInBytes: 800_000 });
    const logs = captureErrorLines();

    await writeProjection(buildPayload(["SP"]), { SP: buildUfInput("SP", 800) });

    const line = logs.find("global-config store size warning");
    expect(line).toBeDefined();
    const parsed = JSON.parse(line as string) as { ctx: Record<string, number> };
    // Sem o split, `incomingBytes` passaria de 150 KB. Com ele, o resumo de
    // uma UF vazia de candidatos é da ordem de centenas de bytes.
    expect(parsed.ctx.incomingBytes).toBeLessThan(10_000);
  });
});
