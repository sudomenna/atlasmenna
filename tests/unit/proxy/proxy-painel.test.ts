/**
 * tests/unit/proxy/proxy-painel.test.ts
 *
 * O portão de senha do painel privado (`/painel`, ADR-0077) em `proxy.ts`.
 *
 * O que fica travado:
 *   - fail-closed: sem `PAINEL_SENHA` no ambiente, TODO pedido leva 401 —
 *     inclusive um que traga uma senha qualquer;
 *   - senha errada → 401; senha certa (qualquer usuário) → passa;
 *   - a mesma regra vale para o HTML e para as requisições RSC (navegação do
 *     App Router por `?_rsc=` + cabeçalho `RSC`, e o transporte `.rsc`);
 *   - o BotID NUNCA é consultado em `/painel` (o site não chama `initBotId`;
 *     todo navegador seria "bot" e o dono levaria 403);
 *   - `/api/*` segue exatamente como antes.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkBotId = vi.hoisted(() => vi.fn());
vi.mock("botid/server", () => ({ checkBotId }));

import { config, proxy } from "@/proxy";

const SENHA = "senha-do-painel-de-teste";

function basic(usuario: string, senha: string): string {
  const bytes = new TextEncoder().encode(`${usuario}:${senha}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

function req(path: string, headers: Record<string, string> = {}, method = "GET"): NextRequest {
  return new NextRequest(`https://exemplo.test${path}`, { method, headers });
}

beforeEach(() => {
  vi.stubEnv("PAINEL_SENHA", SENHA);
  vi.stubEnv("CRON_SECRET", "segredo-do-cron-com-tamanho-realista-01");
  checkBotId.mockReset();
  checkBotId.mockResolvedValue({ isBot: true, isVerifiedBot: false, isHuman: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function esperar401(res: Response): void {
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe(
    'Basic realm="Painel AtlasMenna", charset="UTF-8"',
  );
  expect(res.headers.get("x-robots-tag")).toContain("noindex");
}

describe("proxy — portão de senha do /painel", () => {
  it("sem PAINEL_SENHA no ambiente: 401 sempre, até com senha (fail-closed)", async () => {
    vi.stubEnv("PAINEL_SENHA", "");
    esperar401(await proxy(req("/painel")));
    esperar401(await proxy(req("/painel", { authorization: basic("x", "") })));
    esperar401(await proxy(req("/painel", { authorization: basic("x", "qualquer") })));
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("sem cabeçalho de senha: 401 com o desafio Basic", async () => {
    esperar401(await proxy(req("/painel")));
  });

  it("senha errada: 401 (inclusive mesma senha com uma letra a menos ou a mais)", async () => {
    esperar401(await proxy(req("/painel", { authorization: basic("dono", "errada") })));
    esperar401(await proxy(req("/painel", { authorization: basic("dono", SENHA.slice(0, -1)) })));
    esperar401(await proxy(req("/painel", { authorization: basic("dono", `${SENHA}x`) })));
    // a senha no lugar do USUÁRIO não vale
    esperar401(await proxy(req("/painel", { authorization: basic(SENHA, "") })));
    // esquema diferente de Basic não vale
    esperar401(await proxy(req("/painel", { authorization: `Bearer ${SENHA}` })));
  });

  it("senha certa, com qualquer usuário: passa, com X-Robots-Tag, sem consultar o BotID", async () => {
    for (const usuario of ["dono", "", "qualquer-coisa"]) {
      const res = await proxy(req("/painel", { authorization: basic(usuario, SENHA) }));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.get("x-robots-tag")).toContain("noindex");
    }
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("requisições RSC seguem a mesma regra (?_rsc=, cabeçalho RSC, .rsc, segmentos)", async () => {
    const rsc = { rsc: "1", "next-router-state-tree": "%5B%5D" };
    esperar401(await proxy(req("/painel?_rsc=abc123", rsc)));
    esperar401(await proxy(req("/painel.rsc")));
    esperar401(await proxy(req("/painel.segments/painel/__PAGE__.segment.rsc")));
    esperar401(await proxy(req("/painel/qualquer-subrota")));
    esperar401(await proxy(req("/painel/")));
    const ok = await proxy(
      req("/painel?_rsc=abc123", { ...rsc, authorization: basic("x", SENHA) }),
    );
    expect(ok.status).toBe(200);
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("vale para qualquer método (HEAD, POST)", async () => {
    esperar401(await proxy(req("/painel", {}, "HEAD")));
    esperar401(await proxy(req("/painel", {}, "POST")));
  });

  it("senha com acento funciona (o desafio declara UTF-8)", async () => {
    vi.stubEnv("PAINEL_SENHA", "apuração-2026");
    const res = await proxy(req("/painel", { authorization: basic("x", "apuração-2026") }));
    expect(res.status).toBe(200);
  });
});

describe("proxy — /api/* continua como antes", () => {
  it("rota pública de leitura passa sem BotID; outra rota cai no BotID e leva 403", async () => {
    const leitura = await proxy(req("/api/projection"));
    expect(leitura.status).toBe(200);
    expect(checkBotId).not.toHaveBeenCalled();

    const outra = await proxy(req("/api/qualquer", {}, "POST"));
    expect(checkBotId).toHaveBeenCalledOnce();
    expect(outra.status).toBe(403);
  });

  it("a senha do painel NÃO abre rota de API", async () => {
    const res = await proxy(
      req("/api/ingest/presidente", { authorization: basic("x", SENHA) }, "POST"),
    );
    expect(checkBotId).toHaveBeenCalledOnce();
    expect(res.status).toBe(403);
  });

  it("segredo do cron segue abrindo a rota de máquina", async () => {
    const res = await proxy(
      req(
        "/api/ingest/presidente",
        { authorization: "Bearer segredo-do-cron-com-tamanho-realista-01" },
        "POST",
      ),
    );
    expect(res.status).toBe(200);
    expect(checkBotId).not.toHaveBeenCalled();
  });
});

describe("proxy — matcher", () => {
  it("cobre /api/*, /painel e /painel/*", () => {
    expect(config.matcher).toEqual(["/api/:path*", "/painel", "/painel/:path*"]);
  });
});
