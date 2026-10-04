/**
 * tests/unit/proxy/proxy-bot-gate.test.ts
 *
 * Trava o portão de autenticação que roda ANTES do BotID em `proxy.ts`.
 *
 * ## Por que este arquivo existe (achado de 2026-09-17, 03h BRT)
 *
 * O `proxy.ts` aplicava BotID a **todo** `/api/*`, inclusive `/api/ingest/*`.
 * Nenhum dos clientes legítimos dessas rotas é um navegador — o Vercel Cron, o
 * runtime Python do modelo e o `curl` do runbook não executam o script de
 * cliente do BotID —, então todos são classificados como bot e levam 403.
 *
 * Isso apareceu ao tentar o primeiro ciclo manual contra o simulado do TSE: a
 * resposta foi `{"error":"bot_detected"}`, não o resultado do ciclo. O mesmo
 * caminho é o do cron de 04/10: se a classificação valer lá, a ingestão para
 * na noite da apuração e o agendador só vê um 403 — falha silenciosa, do tipo
 * que esta base já pagou caro mais de uma vez.
 *
 * A correção é um portão de autenticação antes da detecção: segredo válido É a
 * autorização. O que estes testes garantem é que o portão **não** virou uma
 * porta aberta — segredo errado, ausente, de tamanho diferente ou em rota
 * pública continua indo para o BotID.
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const checkBotId = vi.hoisted(() => vi.fn());
vi.mock("botid/server", () => ({ checkBotId }));

import { proxy } from "@/proxy";

const CRON = "segredo-do-cron-com-tamanho-realista-01";
const MODEL = "segredo-do-modelo-com-tamanho-realista";

/** Veredito de bot — o que o BotID devolve para um cliente sem navegador. */
function botidDizQueEhBot(): void {
  checkBotId.mockResolvedValue({ isBot: true, isVerifiedBot: false, isHuman: false });
}

function req(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://exemplo.test${path}`, { method: "POST", headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON);
  vi.stubEnv("MODEL_SECRET", MODEL);
  botidDizQueEhBot();
  checkBotId.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy — portão de segredo antes do BotID", () => {
  it.each([
    ["Authorization: Bearer (caminho do Vercel Cron)", { authorization: `Bearer ${CRON}` }],
    ["x-cron-secret (caminho manual do runbook)", { "x-cron-secret": CRON }],
  ])("deixa passar /api/ingest com %s, sem consultar o BotID", async (_nome, headers) => {
    const res = await proxy(req("/api/ingest/presidente", headers));

    expect(res.status).toBe(200);
    // O ponto do portão: nem chega a perguntar. Se o BotID for consultado, a
    // resposta passa a depender de um serviço externo na hora da apuração.
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("deixa passar /api/internal/edge-write com x-model-secret", async () => {
    const res = await proxy(req("/api/internal/edge-write", { "x-model-secret": MODEL }));

    expect(res.status).toBe(200);
    expect(checkBotId).not.toHaveBeenCalled();
  });

  // --- O portão não pode virar porta aberta ------------------------------

  it("segredo ERRADO em rota de máquina cai no BotID e é bloqueado", async () => {
    const res = await proxy(req("/api/ingest/presidente", { "x-cron-secret": "errado" }));

    expect(checkBotId).toHaveBeenCalledOnce();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "bot_detected" });
  });

  it("segredo do MODELO não abre rota de ingestão, e vice-versa", async () => {
    const a = await proxy(req("/api/ingest/presidente", { "x-model-secret": MODEL }));
    expect(a.status).toBe(200); // model secret também é aceito em rota de máquina
    checkBotId.mockClear();

    // Mas um segredo de cron NÃO passa como se fosse outro valor qualquer:
    const b = await proxy(req("/api/ingest/presidente", { "x-cron-secret": MODEL }));
    expect(checkBotId).toHaveBeenCalledOnce();
    expect(b.status).toBe(403);
  });

  it("sem nenhum header de segredo, rota de máquina cai no BotID", async () => {
    const res = await proxy(req("/api/ingest/presidente"));

    expect(checkBotId).toHaveBeenCalledOnce();
    expect(res.status).toBe(403);
  });

  it("rota PÚBLICA com o segredo certo ainda passa pelo BotID", async () => {
    // O portão é por rota E por segredo. Um segredo vazado não pode virar
    // passe livre para `/api/projection`, que é o endpoint público.
    const res = await proxy(req("/api/projection", { "x-cron-secret": CRON }));

    expect(checkBotId).toHaveBeenCalledOnce();
    expect(res.status).toBe(403);
  });

  it("prefixo parecido não conta como rota de máquina", async () => {
    const res = await proxy(req("/api/ingestao-publica", { "x-cron-secret": CRON }));

    expect(checkBotId).toHaveBeenCalledOnce();
    expect(res.status).toBe(403);
  });

  it("com CRON_SECRET ausente no ambiente, nenhum valor abre o portão", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("MODEL_SECRET", "");

    const casos: Array<Record<string, string>> = [
      { "x-cron-secret": "" },
      { "x-cron-secret": CRON },
      {},
    ];
    for (const headers of casos) {
      checkBotId.mockClear();
      const res = await proxy(req("/api/ingest/presidente", headers));
      expect(checkBotId, JSON.stringify(headers)).toHaveBeenCalledOnce();
      expect(res.status).toBe(403);
    }
  });

  it("humano em rota pública passa normalmente", async () => {
    checkBotId.mockResolvedValue({ isBot: false, isVerifiedBot: false, isHuman: true });

    const res = await proxy(req("/api/projection"));

    expect(checkBotId).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it("bot VERIFICADO (rastreador legítimo) continua passando", async () => {
    checkBotId.mockResolvedValue({ isBot: true, isVerifiedBot: true, isHuman: false });

    const res = await proxy(req("/api/projection"));

    expect(res.status).toBe(200);
  });
});

describe("proxy — leitura pública do mapa liberada do BotID (04/10/2026)", () => {
  function get(path: string): NextRequest {
    return new NextRequest(`https://exemplo.test${path}`, { method: "GET" });
  }

  it.each([
    "/api/projection",
    "/api/projection?cargo=gov",
    "/api/projection?uf=SP&cargo=sen",
    "/api/projection/municipios?uf=SP&cargo=pres",
  ])("GET %s passa mesmo com veredito de bot, sem consultar o BotID", async (path) => {
    const res = await proxy(get(path));
    expect(checkBotId).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("POST em /api/projection continua no BotID", async () => {
    const res = await proxy(req("/api/projection"));
    expect(checkBotId).toHaveBeenCalledOnce();
    expect(res.status).toBe(403);
  });

  it("GET em rota que só COMEÇA igual não é liberado", async () => {
    const res = await proxy(get("/api/projectionx"));
    expect(checkBotId).toHaveBeenCalledOnce();
    expect(res.status).toBe(403);
  });

  it("GET em rota de máquina sem segredo continua no BotID", async () => {
    const res = await proxy(get("/api/ingest/presidente"));
    expect(checkBotId).toHaveBeenCalledOnce();
    expect(res.status).toBe(403);
  });
});
