// tests/integration/ingest/mock-cdn.test.ts
//
// Fase 0, item 0.7 — testa scripts/tse-mock-server.ts contra lib/tse/client.ts
// (fetchEA20) e lib/tse/retry.ts (withRetry), sem Neon e sem NENHUMA
// requisição real ao host do TSE. Sobe o mock em porta efêmera por teste.
//
// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { fetchEA20 } from "@/lib/tse/client";
import { withRetry } from "@/lib/tse/retry";
import { type StartedMockServer, startMockServer } from "../../../scripts/tse-mock-server";

function ea20Url(base: string, uf: string, zona: string, cargo = "0001"): string {
  // Layout 2026 espelhado de lib/tse/targets.ts:buildEA20UrlZona — sem
  // subpasta de município, ordem -z-c-e, sufixo -u (2026-09-05, corrigido
  // contra docs/reference/tse-2026-leiautes.md). O mock casa por (uf, zona),
  // não pelo número de município real — "00001" aqui é arbitrário.
  return `${base}/oficial/ele2022/544/dados/${uf}/${uf}00001-z${zona}-c${cargo}-e000544-u.json`;
}

describe("tse-mock-server + fetchEA20", () => {
  let mock: StartedMockServer;
  let base: string;

  afterEach(async () => {
    await mock?.close();
  });

  it("(a) 200 fresh na primeira chamada, com ETag", async () => {
    mock = await startMockServer();
    base = `http://127.0.0.1:${mock.port}`;

    const result = await fetchEA20({ cargo: 1, url: ea20Url(base, "sp", "0001") });

    expect(result.kind).toBe("fresh");
    if (result.kind !== "fresh") throw new Error("unreachable");
    expect(result.etag).toBeTruthy();
    expect(result.data.tpabr).toBe("zona");
    expect(result.data.cdabr).toBe("0001");
  });

  it("(b) segunda chamada com o ETag anterior -> not_modified (304)", async () => {
    mock = await startMockServer();
    base = `http://127.0.0.1:${mock.port}`;

    const first = await fetchEA20({ cargo: 1, url: ea20Url(base, "sp", "0001") });
    expect(first.kind).toBe("fresh");
    if (first.kind !== "fresh") throw new Error("unreachable");

    const second = await fetchEA20({
      cargo: 1,
      url: ea20Url(base, "sp", "0001"),
      etag: first.etag,
    });
    expect(second.kind).toBe("not_modified");
  });

  it("(c) zona inexistente -> not_found (404)", async () => {
    mock = await startMockServer();
    base = `http://127.0.0.1:${mock.port}`;

    const result = await fetchEA20({ cargo: 1, url: ea20Url(base, "sp", "9999") });
    expect(result.kind).toBe("not_found");
  });

  it("(d) com --rate-limit-after, withRetry(fetchEA20) eventualmente resolve", async () => {
    // Task 0.4 (outro agente, em paralelo) landou em lib/tse/retry.ts
    // durante esta sessão: TSEError(status===429) agora é retryable e o
    // delay real honra `Retry-After` (parseado em client.ts), veja
    // lib/tse/retry.ts:15,27-37,118. Antes disso este teste rodava como
    // `it.todo` (ver histórico do arquivo) — promovido pra `it` real assim
    // que a task 0.4 aterrissou, conforme instrução do orquestrador.
    //
    // O mock devolve `Retry-After: 1` (1s) em cada 429 — com
    // rateLimitAfter=0, as 5 primeiras requisições (índices 1..5) caem no
    // bloco de 429; a 6ª (índice 6) já responde normalmente. `attempts: 8`
    // dá folga; o teste usa timeout maior porque o sleep entre tentativas
    // é tempo real (honra o Retry-After do header, não é encurtável com
    // fake timers sem duplicar a lógica de retry.ts aqui).
    mock = await startMockServer({ rateLimitAfter: 0 });
    base = `http://127.0.0.1:${mock.port}`;
    const url = ea20Url(base, "sp", "0001");

    const result = await withRetry(() => fetchEA20({ cargo: 1, url }), { attempts: 8, baseMs: 1 });
    expect(result.kind === "fresh" || result.kind === "not_found").toBe(true);
  }, 15_000);
});
