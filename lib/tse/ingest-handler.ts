/**
 * lib/tse/ingest-handler.ts
 *
 * runIngestCycle — corpo do handler de ingestão EA20, extraído de
 * `app/api/ingest/route.ts` (2026-09-11, ADR-0035 D3 — cron por cargo).
 *
 * Por que foi extraído para cá: até esta mudança, `app/api/ingest/route.ts`
 * exportava SÓ `POST` e o handler não sabia filtrar por cargo. Duas rotas
 * precisam do mesmo corpo agora — `/api/ingest` (todos os cargos ativos,
 * preview/uso manual) e `/api/ingest/[cargo]` (um cargo por invocação, usado
 * pelo cron real) — então o corpo vira uma função importável por ambas em vez
 * de viver dentro de um único `route.ts`.
 *
 * Achado (A) do plano `perfeito-monte-um-plano-eventual-candle.md` (2026-09-11):
 * a doc oficial da Vercel (vercel.com/docs/cron-jobs, seção "Securing cron
 * jobs") confirma que o Vercel Cron dispara **HTTP GET** e manda o segredo em
 * **`Authorization: Bearer <CRON_SECRET>`**. O handler anterior só aceitava
 * `POST` + `x-cron-secret` — logo as 3 entradas de `vercel.ts` nunca invocaram
 * a ingestão de verdade (a doc também confirma que um caminho/verbo inválido
 * "ainda executa" o cron job, então isso falhava em silêncio com 405). Todo
 * ciclo real até 2026-09-11 foi disparado manualmente via
 * `curl -X POST -H "x-cron-secret"` (docs/operations/runbook.md,
 * docs/testing/tse-simulados.md). `extractProvidedSecret` abaixo aceita os
 * dois caminhos, em GET e em POST, por simetria.
 *
 * Achado (B): query string em `path` de cron NÃO é documentada pela Vercel;
 * dois crons no MESMO horário só podem ser distinguidos por **segmento de
 * rota** (exemplo literal da doc: `/api/sync-slack-team/T0CAQ10TZ` vs
 * `/T4BOE34OP`). Por isso o caminho principal passou a ser
 * `app/api/ingest/[cargo]/route.ts`, não uma query string `?cargo=`.
 *
 * Cobre: RF-001, RF-002, RF-003, RF-004, RNF-006, RNF-016, RNF-032.
 * Constituição § 1 (transparência — User-Agent identificável via client.ts).
 * Constituição § 10 (append-only — repository.ts, zero UPDATE/DELETE aqui).
 * ADR-0011 (cadência 60 s do cron). ADR-0001 (Postgres só no write path).
 * ADR-0035 D3 (cron por cargo, lock anti-overlap por cargo).
 */

import type { NextRequest } from "next/server";
import { after, NextResponse } from "next/server";
import { type CargoProporcional, type CargoTse, isCargoProporcional } from "@/lib/config/cargos";
import { readInterruptorProjecao, TRAVA_PROJECAO_DEP_PCT } from "@/lib/edge-config/reader";
import type { AcompanhamentoPrevious } from "@/lib/tse/acompanhamento";
import { detectChangedUfs } from "@/lib/tse/acompanhamento";
import { alertasDoCiclo, notifySlack } from "@/lib/tse/alerts";
import { fetchEA20, getClientStats, resetClientStats } from "@/lib/tse/client";
import { parseEA20Numeric } from "@/lib/tse/ea20-schema";
import { serialiseCause } from "@/lib/tse/errors";
import { isWithinIngestWindow, parseIngestWindow } from "@/lib/tse/ingest-window";
import { logDebug, logError, logInfo, logWarn } from "@/lib/tse/log";
import { calculateLagSeconds } from "@/lib/tse/metrics";
import { getTseRateLimiter } from "@/lib/tse/rate-limiter";
import {
  getLastEtagAndHash,
  getLastIngestRun,
  insertSnapshot,
  logIngestRun,
} from "@/lib/tse/repository";
import { withRetry } from "@/lib/tse/retry";
import { getActiveCargos, listIngestTargets } from "@/lib/tse/targets";

// ---------------------------------------------------------------------------
// Estado de gating EA14 (acompanhamento) — módulo-level, reaproveitado entre
// invocações pelo Fluid Compute (mesmo padrão dos buckets por cargo em
// lib/tse/rate-limiter.ts, ADR-0068). Guarda o ETag do último EA14 200 + o hash por UF
// do ciclo anterior, para que `detectChangedUfs` possa enviar `If-None-Match`
// e comparar hashes sem precisar de uma tabela nova no Postgres.
//
// Chaveado POR CÓDIGO DE ELEIÇÃO desde 2026-09-17: o TSE 2026 publica um EA14
// por eleição (`br-e021270-ab.json` para o pleito federal — Presidente —,
// `br-e021272-ab.json` para o estadual — Governador, Senador, Deputado).
// Um estado único misturaria os dois: o ETag de um arquivo seria enviado como
// `If-None-Match` do outro, e os hashes por UF de uma corrida decidiriam o
// gating da outra.
// ---------------------------------------------------------------------------

const acompanhamentoState = new Map<string, AcompanhamentoPrevious>();

// ---------------------------------------------------------------------------
// Helpers — turno
// ---------------------------------------------------------------------------

/**
 * parseTurnoEnv — reads TSE_TURNO from the environment.
 *
 * Default: 1 (pre-election / preview / first-round scenario).
 * Valid values: '1' or '2' only. Any other value throws a descriptive Error
 * so the route handler can return 500 with a clear misconfiguration signal
 * rather than silently persisting data in the wrong round.
 */
function parseTurnoEnv(): 1 | 2 {
  const raw = process.env.TSE_TURNO;
  if (raw === undefined || raw === "1") return 1;
  if (raw === "2") return 2;
  throw new Error(
    `TSE_TURNO inválido: "${raw}" — apenas "1" ou "2" são aceitos. Corrija a env var e redeploy.`,
  );
}

// ---------------------------------------------------------------------------
// Auth — Bearer (Vercel Cron) ou x-cron-secret (manual/runbook)
// ---------------------------------------------------------------------------

/**
 * extractProvidedSecret — RNF-016 (endpoint restrito ao cron).
 *
 * Aceita, nesta ordem:
 *   1. `Authorization: Bearer <secret>` — caminho oficial do Vercel Cron
 *      (vercel.com/docs/cron-jobs, "Securing cron jobs"; ver achado (A) no
 *      cabeçalho deste arquivo).
 *   2. `x-cron-secret: <secret>` — caminho manual do runbook
 *      (docs/operations/runbook.md) e do protocolo de simulado
 *      (docs/testing/tse-simulados.md). Mantido para não quebrar nenhum dos
 *      dois em produção.
 *
 * Não distingue, no retorno de erro, qual dos dois caminhos foi tentado —
 * evita vazar qual mecanismo de auth está configurado.
 */
function extractProvidedSecret(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const match = /^bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match?.[1]) return match[1];
  }
  return req.headers.get("x-cron-secret");
}

// ---------------------------------------------------------------------------
// Semaphore — bounded concurrency without external deps
// ---------------------------------------------------------------------------

/**
 * CONCURRENCY — maximum parallel in-flight EA20 GETs per invocation.
 *
 * Lido de `INGEST_CONCURRENCY` (default 20) para permitir calibrar durante
 * os simulados sem mexer em código — ⚠️ mas COM redeploy: na Vercel, variável
 * de ambiente só chega a um deployment novo (corrigido em 29/09, ADR-0063
 * D4). Note que concorrência e taxa são controles
 * ORTOGONAIS: este semáforo limita quantas requisições ficam simultaneamente
 * em voo; `getTseRateLimiter(cargo)` (lib/tse/rate-limiter.ts) limita quantas
 * SAEM por segundo (RF-010.3 — limite de 100 req/s/IP do TSE, agora dividido
 * em até 50 rps por invocação de cargo). Um CONCURRENCY alto com
 * TSE_MAX_RPS baixo apenas faz mais requisições esperarem na fila do rate
 * limiter — não estoura o limite do TSE.
 *
 * Valor inválido (não-numérico, <= 0) cai no default 20 com um warn.
 */
function getIngestConcurrency(): number {
  const DEFAULT_CONCURRENCY = 20;
  const raw = process.env.INGEST_CONCURRENCY;
  if (raw === undefined || raw.trim() === "") return DEFAULT_CONCURRENCY;

  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[ingest] INGEST_CONCURRENCY inválida: "${raw}" — usando default ${DEFAULT_CONCURRENCY}.`,
    );
    return DEFAULT_CONCURRENCY;
  }
  return Math.floor(parsed);
}

const CONCURRENCY = getIngestConcurrency();

// ---------------------------------------------------------------------------
// Model trigger (T16 — Fase 5)
// ---------------------------------------------------------------------------

/**
 * resolveInternalBaseUrl — base URL pra `/api/model/project` no mesmo deploy.
 *
 * Resolução em ordem:
 *   1. `INTERNAL_BASE_URL` explícita (override de teste / staging custom).
 *   2. `VERCEL_URL` injetada pelo runtime Vercel em preview/prod (sem scheme).
 *   3. `http://localhost:${PORT ?? 3000}` em dev local.
 *
 * Por que NÃO usar `req.headers.get('host')`? Em Vercel o host externo pode
 * ser um domínio customizado que não roteia interno-pra-interno; `VERCEL_URL`
 * é sempre o `*.vercel.app` que aceita auto-chamadas.
 */
function resolveInternalBaseUrl(): string {
  const explicit = process.env.INTERNAL_BASE_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/$/, "");

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl && vercelUrl.length > 0) return `https://${vercelUrl}`;

  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}`;
}

/**
 * triggerModel — fire-and-forget POST para `/api/model/project` por cargo.
 *
 * Best-effort: erros são logados como warn e nunca propagam. O modelo
 * recomputa a cada ciclo (RF-019), então uma falha aqui se auto-corrige em
 * <60s. A persistência canônica (`projections`) é responsabilidade do próprio
 * endpoint Python — não bloqueamos o cron à espera.
 *
 * Usa `after()` do Next 16 (ex-`waitUntil`) quando disponível para garantir
 * que a serverless function não seja "freed" antes do fetch sair (Vercel
 * cancela connections de funções já encerradas). Em runtime non-Vercel
 * (testes/dev local) `after()` ainda funciona mas degrada para um Promise
 * sem hold — o `void fetch` então é suficiente.
 */
/**
 * Header de contorno da proteção de deployment da Vercel.
 *
 * Deployments de **preview** ficam atrás de SSO (`ssoProtection`), e isso vale
 * também para a chamada que o próprio deployment faz para si mesmo: o
 * `triggerModel` recebia **401 da plataforma**, antes de chegar ao Python, e o
 * ciclo terminava com `model_triggered` no log e nenhuma projeção publicada —
 * uma falha que só aparece lendo o log da função, porque o trigger é
 * best-effort e não derruba o ciclo. Medido em 2026-09-17, no primeiro ciclo
 * contra o simulado.
 *
 * `VERCEL_AUTOMATION_BYPASS_SECRET` é injetada pela plataforma quando o
 * projeto tem "Protection Bypass for Automation" ligado. Em produção o domínio
 * é público e o header é inócuo; ausente a variável, nada é enviado.
 */
function protectionBypassHeader(): Record<string, string> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}

/**
 * `projecao_dep` do corpo do POST do modelo (design 026 § 2.11, ADR-0063 D4):
 * o estado do interruptor da projeção de um cargo PROPORCIONAL, lido UMA vez
 * por ciclo.
 *
 * Desde 2026-09-29 (spec 027 RF-287) vale para os três proporcionais, e o
 * cargo decide QUAL chave: 6 → `interruptor-projecao-dep`; 7 e 8 →
 * `interruptor-projecao-est` (`interruptorProjecaoKey`). O nome do campo no
 * POST continua `projecao_dep` — é contrato com o Python, e "dep" ali quer
 * dizer "deputado", não o token do cargo 6.
 *
 * O Python não lê o Edge Config — recebe o estado aqui e o registra no log do
 * ciclo (`dep_projecao`), o que torna a projeção reproduzível. Falha fechada
 * dos dois lados: a leitura já desliga em ausência/falha
 * (`readInterruptorProjecao`), e o modelo desliga se o campo não vier.
 *
 * `pct_minimo` sai INTEIRO, arredondado para CIMA: o campo Python é `int`
 * (`ge=25, le=100`), e um 40,5 da chave faria o POST inteiro voltar 422 — o
 * ciclo de Deputado sem modelo por causa do interruptor. `ceil` erra para o
 * lado de travar mais, nunca menos.
 */
export interface ProjecaoDepNoPost {
  ligada: boolean;
  pct_minimo: number;
}

export async function lerProjecaoDepParaOModelo(
  cargo: CargoProporcional,
): Promise<ProjecaoDepNoPost> {
  // `readInterruptorProjecao` já não lança e tem teto de tempo
  // (`TIMEOUT_INTERRUPTOR_MS`, 2 s): o `await` do ciclo espera no máximo isso,
  // e tempo esgotado chega aqui como desligado. O `try` é a segunda cinta — o
  // ciclo de ingestão nunca pode parar por causa do interruptor da projeção.
  try {
    const lido = await readInterruptorProjecao(cargo);
    return { ligada: lido.ligada, pct_minimo: Math.ceil(lido.pct_minimo) };
  } catch {
    return { ligada: false, pct_minimo: TRAVA_PROJECAO_DEP_PCT };
  }
}

/**
 * O corpo do POST ao modelo. `projecao_dep` só nos cargos proporcionais (6, 7,
 * 8 — `isCargoProporcional`, lido da tabela) — nos majoritários não há
 * projeção com trava, e o campo não tem referente.
 */
export function corpoDoTriggerModel(
  cargo: number,
  turno: 1 | 2,
  triggerTs: string,
  projecaoDep: ProjecaoDepNoPost | undefined,
): Record<string, unknown> {
  return {
    cargo,
    turno,
    trigger_ts: triggerTs,
    ...(isCargoProporcional(cargo) && projecaoDep ? { projecao_dep: projecaoDep } : {}),
  };
}

function triggerModel(opts: {
  baseUrl: string;
  cargo: number;
  turno: 1 | 2;
  triggerTs: string;
  modelSecret: string;
  projecaoDep?: ProjecaoDepNoPost;
}): void {
  const { baseUrl, cargo, turno, triggerTs, modelSecret, projecaoDep } = opts;
  const url = `${baseUrl}/api/model/project`;

  // Encapsulada como Promise pra entregar pra `after()` E para que erros
  // sejam capturados num catch único (sem unhandled rejection).
  const run = async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "x-model-secret": modelSecret,
          "content-type": "application/json",
          ...protectionBypassHeader(),
        },
        body: JSON.stringify(corpoDoTriggerModel(cargo, turno, triggerTs, projecaoDep)),
      });
      // Não bloqueia o ciclo — apenas registra resultado pra observabilidade.
      // Status 5xx do modelo = recompute do próximo ciclo se ressincroniza.
      if (!res.ok) {
        logWarn("model-trigger non-2xx", {
          cargo,
          turno,
          status: res.status,
          url,
        });
      }
    } catch (err) {
      logWarn("model-trigger-failed", {
        cargo,
        turno,
        url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // `after()` é exportado por `next/server` em Next 16. Em ambientes que não
  // garantem o ciclo (test env sem Next runtime), `after()` pode `throw` —
  // o try/catch garante fallback para `void run()` puro.
  //
  // CRÍTICO: passamos um *thunk* (`() => Promise`) para `after()`, NÃO o
  // Promise já em execução. Isso (a) deixa `after()` decidir quando rodar
  // e (b) evita rodar duas vezes se o `after()` throw após o Promise já
  // ter começado.
  try {
    after(run);
  } catch {
    void run();
  }
}

function buildSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for a free slot
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next !== undefined) {
        next();
      }
    }
  };
}

// ---------------------------------------------------------------------------
// runIngestCycle
// ---------------------------------------------------------------------------

export interface RunIngestCycleOptions {
  /**
   * Cargo do ciclo — `undefined` significa "todos os cargos ativos"
   * (`getActiveCargos()`/`TSE_CARGOS`), usado por `/api/ingest` (preview e
   * uso manual). `1`, `3`, `5` ou `6` restringe alvos, lock anti-overlap e
   * model-trigger a um único cargo — usado por `/api/ingest/[cargo]`
   * (caminho do cron real, ADR-0035 D3).
   */
  cargo?: CargoTse;
  /**
   * Fatia deste ciclo, quando o cargo é servido por rota fatiada
   * (`/api/ingest/deputado-federal/<indice>`, ADR-0026 emenda 2026-09-13).
   * `undefined` = ciclo não fatiado — o comportamento anterior, inalterado,
   * inclusive para os outros cargos em granularidade "zona" (Presidente,
   * Governador e Senador seguem cada um em UMA invocação só, sem fatia).
   * Restringe `listIngestTargets` a essa fatia e estende a chave do lock
   * anti-overlap para `(cargo, fatia)` — ver `lib/tse/repository.ts`.
   */
  fatia?: { indice: number; total: number };
}

/**
 * Fecha o marcador de lock anti-overlap num caminho de saída antecipada.
 *
 * O passo 3 grava `running:true` em `ingest_log`; o passo 6 grava
 * `running:false` com as métricas. Todo `return` entre os dois precisa passar
 * por aqui, senão o lock (`OVERLAP_LOCK_WINDOW_MS`, 6 min) fica preso e
 * silencia os ciclos seguintes do mesmo cargo — sem erro nenhum, só ausência
 * de ingestão.
 *
 * Best-effort por desenho: falhar ao gravar o marcador de liberação não deve
 * transformar um abort em exceção não capturada (constituição § 7).
 */
async function releaseOverlapLock(opts: {
  turno: number;
  env: string;
  cargo?: number;
  fatia?: number;
  reason: string;
}): Promise<void> {
  try {
    await logIngestRun({
      durationMs: 0,
      filesFetched: 0,
      filesChanged: 0,
      errors: 1,
      notes: JSON.stringify({
        running: false,
        turno: opts.turno,
        env: opts.env,
        ...(opts.cargo !== undefined ? { cargo: opts.cargo } : {}),
        ...(opts.fatia !== undefined ? { fatia: opts.fatia } : {}),
        aborted: opts.reason,
      }),
    });
  } catch (err) {
    logWarn("releaseOverlapLock falhou — lock pode ficar preso até expirar", {
      error: serialiseCause(err),
      reason: opts.reason,
    });
  }
}

export async function runIngestCycle(
  req: NextRequest,
  opts: RunIngestCycleOptions = {},
): Promise<NextResponse> {
  const t0 = Date.now();
  const cargoDoCiclo = opts.cargo;

  // --------------------------------------------------------------------------
  // 1. Auth — RNF-016 (cron-only endpoint)
  // --------------------------------------------------------------------------

  const provided = extractProvidedSecret(req);
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    logError("CRON_SECRET não configurada — abortando invocação", {});
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }

  if (provided !== expected) {
    // No extra log here — avoid leaking whether the secret is set or not,
    // nem qual dos dois caminhos de auth (Bearer/x-cron-secret) foi tentado.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // --------------------------------------------------------------------------
  // 2. Feature flags + window check — RF-002
  // --------------------------------------------------------------------------

  const enabled = process.env.CRON_ENABLED !== "false";
  if (!enabled) {
    logInfo("ingest skipped — CRON_ENABLED=false", {});
    return NextResponse.json({ skipped: "cron_disabled" });
  }

  // RF-002 hardening: janela configurável via INGEST_WINDOW ("17-04"
  // apuração real; "9-17" simulados TSE, 9h-17h BRT).
  let ingestWindow: ReturnType<typeof parseIngestWindow>;
  try {
    ingestWindow = parseIngestWindow();
  } catch (err) {
    logError("INGEST_WINDOW inválida — abortando", { error: serialiseCause(err) });
    return NextResponse.json({ error: "misconfigured", detail: String(err) }, { status: 500 });
  }

  const override = process.env.INGEST_WINDOW_OVERRIDE === "true";
  if (!override && !isWithinIngestWindow(new Date(), ingestWindow)) {
    logDebug("ingest skipped — fora da janela de ingestão configurada", {
      utcHour: new Date().getUTCHours(),
      ingestWindow,
    });
    return NextResponse.json({ skipped: "out_of_window" });
  }

  // --------------------------------------------------------------------------
  // 3. Parse turno — inline validation (fail-fast)
  // --------------------------------------------------------------------------

  let turno: 1 | 2;
  try {
    turno = parseTurnoEnv();
  } catch (err) {
    logError("TSE_TURNO inválido — abortando", {
      error: serialiseCause(err),
    });
    return NextResponse.json({ error: "misconfigured", detail: String(err) }, { status: 500 });
  }

  const env = process.env.VERCEL_ENV === "production" ? "production" : "preview";

  // --------------------------------------------------------------------------
  // 3b. Lock anti-overlap simples (RF-002 hardening), por **cargo** (ADR-0035
  //     D3) e, desde 2026-09-13, por **cargo+fatia** (ADR-0026 emenda).
  //
  // `maxDuration` é 300s (2026-09-11 — fan-out por par pode chegar a ~6.100
  // GETs por cargo por ciclo) porque o rate limiter/429 podem alongar um
  // ciclo além do intervalo do cron. Em vez de um lock de banco "de verdade"
  // (SELECT ... FOR UPDATE, advisory lock), usamos a última linha de
  // `ingest_log` **cuja `(notes.cargo, notes.fatia)` bate com a chave deste
  // ciclo**: se ela marca `running: true` e é recente (<6min), um ciclo
  // anterior da MESMA CHAVE ainda está em voo (ou travou) — pula este ciclo
  // em vez de rodar em paralelo. Chaves diferentes têm locks independentes —
  // um ciclo do cargo 1 nunca bloqueia um ciclo do cargo 3 (ADR-0035 D3), e a
  // fatia 1 do cargo 6 nunca bloqueia a fatia 2 (emenda 2026-09-13: sem essa
  // segunda dimensão, as 6 fatias disparando a cada 5 min se bloqueariam
  // umas às outras dentro da janela de 6 min, e a varredura nunca fecharia —
  // ver o comentário de RF-010.3 em lib/tse/rate-limiter.ts para o desenho
  // geral de concorrência entre invocações). Falha ao ler o lock é
  // fail-open: um lock ilegível não deve travar o pipeline inteiro.
  // --------------------------------------------------------------------------

  const OVERLAP_LOCK_WINDOW_MS = 11 * 60 * 1000; // ≥ maxDuration 600 s (04/10 18h)
  const fatiaDoCiclo = opts.fatia?.indice;

  try {
    const lastRun = await getLastIngestRun(cargoDoCiclo, fatiaDoCiclo);
    if (lastRun?.notes?.running === true) {
      const ageMs = Date.now() - lastRun.ts.getTime();
      if (ageMs < OVERLAP_LOCK_WINDOW_MS) {
        logInfo("ingest skipped — ciclo anterior ainda em voo (overlap lock)", {
          ageMs,
          env,
          turno,
          cargo: cargoDoCiclo ?? "all",
          fatia: fatiaDoCiclo ?? "none",
        });
        return NextResponse.json({ skipped: "overlap" });
      }
    }
  } catch (err) {
    logWarn("getLastIngestRun falhou — seguindo sem lock anti-overlap (fail-open)", {
      error: serialiseCause(err),
    });
  }

  // Marca o início do ciclo (append-only — a linha final com `running:false`
  // + métricas vem no passo 6). Falha ao gravar o marcador não aborta o
  // ciclo — só reduz a eficácia do lock no próximo invocation.
  try {
    await logIngestRun({
      durationMs: 0,
      filesFetched: 0,
      filesChanged: 0,
      errors: 0,
      notes: JSON.stringify({
        running: true,
        turno,
        env,
        ...(cargoDoCiclo !== undefined ? { cargo: cargoDoCiclo } : {}),
        ...(fatiaDoCiclo !== undefined ? { fatia: fatiaDoCiclo } : {}),
      }),
    });
  } catch (err) {
    logWarn("logIngestRun (marcador de início) falhou — seguindo sem lock gravado", {
      error: serialiseCause(err),
    });
  }

  // Zera os contadores de client stats (429/404/304) e captura o
  // `waitedMs` acumulado do rate limiter ANTES do ciclo — os buckets vivem no
  // processo (o Fluid Compute reaproveita instâncias e multiplexa invocações
  // nelas), então reportamos o DELTA deste ciclo, não o total acumulado desde
  // o boot.
  resetClientStats();
  // Cada alvo paga no bucket do SEU cargo (ADR-0068): `fetchEA20` e
  // `detectChangedUfs` recebem o cargo e escolhem o bucket, então nada aqui
  // "fixa a taxa" do ciclo — quem chega primeiro à instância não decide a taxa
  // de ninguém. Num ciclo por cargo o bucket é o daquele cargo; no ciclo
  // genérico (`/api/ingest`, vários cargos em sequência) há um bucket por cargo
  // coberto, cada um no teto dele (`lib/config/cargos.ts`, `rpsMax`) — antes,
  // um bucket só na MAIOR taxa levava os alvos do cargo 6 a 25 rps.
  //
  // `waitedMs` do ciclo = soma dos deltas dos buckets dos cargos que ele toca
  // (um só, no ciclo por cargo).
  const cargosDoBucket = [
    ...new Set<CargoTse>(cargoDoCiclo !== undefined ? [cargoDoCiclo] : getActiveCargos()),
  ];
  const esperaDosBuckets = (): number =>
    cargosDoBucket.reduce((acc, c) => acc + getTseRateLimiter(c).stats.waitedMs, 0);
  const waitedMsBefore = esperaDosBuckets();

  // --------------------------------------------------------------------------
  // 4. Resolve targets — filtrados por cargo quando `opts.cargo` está setado.
  // --------------------------------------------------------------------------

  let targets: Awaited<ReturnType<typeof listIngestTargets>>;
  try {
    targets = await listIngestTargets(env, { cargo: cargoDoCiclo, fatia: opts.fatia });
  } catch (err) {
    logError("listIngestTargets falhou — abortando ciclo", {
      error: serialiseCause(err),
      env,
      cargo: cargoDoCiclo ?? "all",
      fatia: fatiaDoCiclo ?? "none",
    });
    // Libera o lock anti-overlap ANTES de sair. Sem isto, o marcador
    // `running:true` gravado no passo 3 fica de pé pelos 6 minutos inteiros
    // de `OVERLAP_LOCK_WINDOW_MS` e bloqueia os próximos ciclos DESTA CHAVE
    // (cargo+fatia): uma falha transitória de `listIngestTargets` (que lê
    // `zonas` no Postgres) custaria 6 ciclos em vez de 1, no dia D. Mesmo
    // motivo pelo qual `getActiveCargos()` é isolado com try/catch mais
    // abaixo. Descoberto em 2026-09-11 exercitando o ciclo contra o mock com
    // `TSE_COD_ELEICAO` ausente.
    await releaseOverlapLock({
      turno,
      env,
      cargo: cargoDoCiclo,
      fatia: fatiaDoCiclo,
      reason: "targets_unavailable",
    });
    return NextResponse.json({ error: "targets_unavailable" }, { status: 500 });
  }

  logInfo("ingest ciclo iniciado", {
    targets: targets.length,
    turno,
    env,
    override,
    cargo: cargoDoCiclo ?? "all",
    fatia: fatiaDoCiclo ?? "none",
  });

  // --------------------------------------------------------------------------
  // 4b. EA14 gating (acompanhamento) — opt-in via TSE_ACOMPANHAMENTO=on
  // --------------------------------------------------------------------------
  //
  // Quando ligado, filtra `targets` para só as UFs que o EA14 (1 GET)
  // sinalizou como mudadas desde o último ciclo — reduz drasticamente o
  // número de GETs de EA20 em ciclos "parados" (madrugada, entre
  // totalizações). Alvos de nível "br" nunca são filtrados por esta etapa —
  // o próprio EA14 já É o resumo nacional, não há um segundo arquivo pra
  // comparar contra.
  if (process.env.TSE_ACOMPANHAMENTO === "on") {
    // Um EA14 por código de eleição presente no ciclo. Um ciclo genérico
    // (`/api/ingest` com `TSE_CARGOS=1,3`) toca dois arquivos; um ciclo por
    // cargo toca um só. A chave do "mudou?" passa a ser (eleição, UF): a
    // mesma UF pode ter mudado no pleito estadual e não no federal.
    //
    // Cada eleição leva junto o cargo que paga a requisição do EA14 dela
    // (ADR-0068): o do primeiro alvo. Num ciclo por cargo é o cargo do ciclo; no
    // genérico, um cargo da eleição lida — sempre um dos que o ciclo já cobre.
    // Mora no mesmo registro das UFs para que não exista eleição sem cargo.
    const ufsPorEleicao = new Map<string, { cargo: CargoTse; ufs: Set<string> }>();
    for (const t of targets) {
      if (t.nivel === "br") continue;
      const entrada = ufsPorEleicao.get(t.codEleicao) ?? { cargo: t.cargo, ufs: new Set<string>() };
      entrada.ufs.add(t.uf);
      ufsPorEleicao.set(t.codEleicao, entrada);
    }

    if (ufsPorEleicao.size > 0) {
      try {
        const changedPorEleicao = new Set<string>();
        let ufsAnalisadas = 0;

        for (const [codEleicao, { cargo: cargoDaLeitura, ufs: ufsSet }] of ufsPorEleicao) {
          const ufsNoCiclo = [...ufsSet];
          ufsAnalisadas += ufsNoCiclo.length;

          const anterior = acompanhamentoState.get(codEleicao) ?? null;
          const signals = await detectChangedUfs({
            cargo: cargoDaLeitura,
            codEleicao,
            ufs: ufsNoCiclo,
            previous: anterior,
          });

          for (const s of signals) {
            if (s.changed) changedPorEleicao.add(`${codEleicao}|${s.uf}`);
          }

          const etagDoCiclo = signals.find((s) => s.etag !== null)?.etag ?? anterior?.etag ?? null;
          const hashes: Record<string, string> = { ...anterior?.hashes };
          for (const s of signals) {
            if (s.hash !== null) hashes[s.uf] = s.hash;
          }
          acompanhamentoState.set(codEleicao, { etag: etagDoCiclo, hashes });
        }

        const targetsAntes = targets.length;
        targets = targets.filter(
          (t) => t.nivel === "br" || changedPorEleicao.has(`${t.codEleicao}|${t.uf}`),
        );

        logInfo("EA14 gating aplicado", {
          eleicoes: ufsPorEleicao.size,
          ufsAnalisadas,
          ufsMudadas: changedPorEleicao.size,
          targetsAntes,
          targetsDepois: targets.length,
        });
      } catch (err) {
        // detectChangedUfs já é fail-open internamente (nunca deveria
        // rejeitar), mas mantemos um fail-open de segunda camada aqui: se
        // por algum motivo a chamada lançar, seguimos com `targets`
        // inalterado (equivalente a "tudo mudou").
        logWarn("EA14 gating falhou — seguindo sem filtro (fail-open)", {
          error: serialiseCause(err),
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // 5. Per-target loop with bounded concurrency
  // --------------------------------------------------------------------------

  let changed = 0;
  let unchanged = 0;
  let notFoundCount = 0;
  let errorsCount = 0;
  let maxLagSeconds: number | null = null;

  const withSlot = buildSemaphore(CONCURRENCY);

  const promises = targets.map((target) =>
    withSlot(async () => {
      // -----------------------------------------------------------------------
      // 5a. Fetch last ETag + hash for this target
      // -----------------------------------------------------------------------
      let lastEtag: string | null;
      let lastHash: string | null;

      try {
        const last = await getLastEtagAndHash({ target, turno });
        lastEtag = last.etag;
        lastHash = last.hash;
      } catch (err) {
        logError("getLastEtagAndHash falhou — target pulado", {
          url: target.url,
          uf: target.uf,
          cargo: target.cargo,
          codMunicipioTse: target.codMunicipioTse,
          codZona: target.codZona,
          error: serialiseCause(err),
        });
        errorsCount++;
        return;
      }

      // -----------------------------------------------------------------------
      // 5b. Fetch EA20 (with ETag, with retry)
      // -----------------------------------------------------------------------
      let result: Awaited<ReturnType<typeof fetchEA20>>;
      try {
        result = await withRetry(() =>
          fetchEA20({ url: target.url, cargo: target.cargo, etag: lastEtag }),
        );
      } catch (err) {
        logError("fetchEA20 falhou após retries — target pulado", {
          url: target.url,
          uf: target.uf,
          cargo: target.cargo,
          codMunicipioTse: target.codMunicipioTse,
          codZona: target.codZona,
          error: serialiseCause(err),
        });
        errorsCount++;
        return;
      }

      // -----------------------------------------------------------------------
      // 5c. Route on result kind
      // -----------------------------------------------------------------------

      if (result.kind === "not_modified") {
        unchanged++;
        return;
      }

      if (result.kind === "not_found") {
        notFoundCount++;
        logDebug("zona sem dados (404) — pulando", { url: target.url });
        return;
      }

      // result.kind === 'fresh'

      // Secondary dedup: if the fetched hash matches what we already stored,
      // the TSE CDN returned different bytes but semantically identical content
      // (e.g. whitespace normalisation). Skip to avoid a duplicate snapshot.
      if (result.hash === lastHash) {
        unchanged++;
        return;
      }

      // -----------------------------------------------------------------------
      // 5d. Extract pctApurado + votosTotal from the root `s`/`e` elements
      // -----------------------------------------------------------------------
      //
      // O EA20 real NÃO tem um array `abr[]` de abrangências dentro do
      // arquivo — cada arquivo já É uma única abrangência (codificada em
      // `tpabr`/`cdabr` e no nome do arquivo). Os totais vivem em objetos de
      // raiz `s` (seções) e `e` (eleitores), exigidos pelo Zod schema
      // (EA20Schema.s / .e são required).

      // pctApurado: `s.psa` (% seções apuradas — sinaliza quanto da
      // abrangência já foi contado, independente do tipo de voto).
      //
      // votosTotal: `e.c` (comparecimento = total de eleitores que
      // compareceram). Captura todos os votos dados, incluindo brancos e
      // nulos — melhor sinal de "total de votos processados" para as
      // métricas de ingest do que `v.vnom` (só nominais) ou `v.vv` (válidos,
      // exclui brancos+nulos). Se o modelo precisar de contagens mais
      // estreitas, ele lê do `payload` bruto.
      let pctApurado: number;
      let votosTotal: number;

      try {
        pctApurado = parseEA20Numeric(result.data.s.psa);
      } catch {
        // Non-fatal: persist the snapshot with pctApurado=0 and log for
        // investigation. TSE has occasionally emitted malformed percent
        // strings (e.g. empty "psa" early in counting).
        logWarn("parseEA20Numeric falhou em s.psa — usando 0", {
          url: target.url,
          raw: result.data.s.psa,
        });
        pctApurado = 0;
      }

      try {
        votosTotal = parseEA20Numeric(result.data.e.c);
      } catch {
        logWarn("parseEA20Numeric falhou em e.c — usando 0", {
          url: target.url,
          raw: result.data.e.c,
        });
        votosTotal = 0;
      }

      // -----------------------------------------------------------------------
      // 5e. Calculate TSE lag (RNF-033) — best-effort, never aborts ingest
      // -----------------------------------------------------------------------

      try {
        const lagSeconds = calculateLagSeconds(result.data.dg, result.data.hg);
        if (maxLagSeconds === null || lagSeconds > maxLagSeconds) {
          maxLagSeconds = lagSeconds;
        }
      } catch (err) {
        // Malformed dg/hg is unusual but non-fatal. Log and continue.
        logWarn("calculateLagSeconds falhou — lag não medido para este snapshot", {
          url: target.url,
          dg: result.data.dg,
          hg: result.data.hg,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // -----------------------------------------------------------------------
      // 5f. Persist snapshot (append-only — constituição § 10)
      // -----------------------------------------------------------------------

      try {
        await insertSnapshot({
          target,
          turno,
          etag: result.etag,
          hash: result.hash,
          payload: result.data,
          pctApurado,
          votosTotal,
        });
        changed++;
      } catch (err) {
        logError("insertSnapshot falhou — target pulado", {
          url: target.url,
          uf: target.uf,
          cargo: target.cargo,
          codMunicipioTse: target.codMunicipioTse,
          codZona: target.codZona,
          error: serialiseCause(err),
        });
        errorsCount++;
      }
    }),
  );

  await Promise.all(promises);

  // --------------------------------------------------------------------------
  // 6. Log ingest run + return summary
  // --------------------------------------------------------------------------

  const durationMs = Date.now() - t0;

  // --------------------------------------------------------------------------
  // 6a. Trigger modelo (RF-019) — fire-and-forget.
  //
  // Só dispara quando o ciclo produziu mudança (`changed > 0`); ciclos
  // 100% dedup (ETag/hash) não recomputam o modelo.
  //
  // Quando `opts.cargo` está setado (caminho do cron real,
  // `/api/ingest/[cargo]`), dispara só para ESSE cargo — o ciclo já é
  // restrito a um cargo, então não há razão pra também recomputar o outro
  // (ele tem seu próprio ciclo/cron independente). Quando `opts.cargo` é
  // `undefined` (ciclo de todos — `/api/ingest`), mantém o comportamento
  // anterior: um trigger fire-and-forget por cargo ativo
  // (`getActiveCargos()`).
  // --------------------------------------------------------------------------

  let modelTriggered: number[] = [];
  if (changed > 0) {
    const modelSecret = process.env.MODEL_SECRET;
    if (!modelSecret) {
      logWarn("model-trigger skipped — MODEL_SECRET não configurada", {
        changed,
        env,
      });
    } else {
      const baseUrl = resolveInternalBaseUrl();
      const triggerTs = new Date().toISOString();

      let activeCargos: Array<CargoTse>;
      if (cargoDoCiclo !== undefined) {
        activeCargos = [cargoDoCiclo];
      } else {
        // getActiveCargos() nunca deveria lançar (pior caso, cai no default
        // [1,3] — ver lib/tse/targets.ts), mas isolamos com try/catch mesmo
        // assim: um throw não capturado aqui pularia o marcador final
        // `running:false` (passo 6 abaixo) e deixaria o lock anti-overlap
        // preso por até 6min, bloqueando o próximo ciclo sem necessidade.
        try {
          activeCargos = getActiveCargos();
        } catch (err) {
          logWarn("getActiveCargos falhou — model-trigger pulado neste ciclo", {
            error: serialiseCause(err),
          });
          activeCargos = [];
        }
      }

      // Spec 026/027 — o interruptor da projeção vai no corpo do POST de cada
      // cargo PROPORCIONAL (6, 7, 8), lido uma vez por ciclo e pela chave DO
      // cargo (6 → dep; 7/8 → est). Nunca lança (falha ⇒ desligado).
      const projecaoPorCargo = new Map<CargoTse, ProjecaoDepNoPost>();
      for (const cargo of activeCargos) {
        if (isCargoProporcional(cargo)) {
          projecaoPorCargo.set(cargo, await lerProjecaoDepParaOModelo(cargo));
        }
      }

      for (const cargo of activeCargos) {
        triggerModel({
          baseUrl,
          cargo,
          turno,
          triggerTs,
          modelSecret,
          projecaoDep: projecaoPorCargo.get(cargo),
        });
      }
      modelTriggered = [...activeCargos];
      logInfo("model-trigger dispatched", {
        cargos: modelTriggered,
        turno,
        baseUrl,
      });
    }
  }

  // Snapshot dos contadores de client stats (429/404/304) e do delta de
  // waitedMs do rate limiter — ver comentário no passo 3b sobre por que é
  // um delta e não o total acumulado do processo.
  const clientStatsSnapshot = getClientStats();
  const waitedMs = esperaDosBuckets() - waitedMsBefore;

  try {
    await logIngestRun({
      durationMs,
      filesFetched: targets.length,
      filesChanged: changed,
      errors: errorsCount,
      notes: JSON.stringify({
        running: false,
        turno,
        env,
        ...(cargoDoCiclo !== undefined ? { cargo: cargoDoCiclo } : {}),
        ...(fatiaDoCiclo !== undefined ? { fatia: fatiaDoCiclo } : {}),
        unchanged,
        not_found: notFoundCount,
        rateLimited: clientStatsSnapshot.rateLimited,
        waitedMs,
        ...(modelTriggered.length > 0 ? { model_triggered: modelTriggered } : {}),
      }),
    });
  } catch (err) {
    // logIngestRun failing must not suppress the primary metrics response.
    // The error is already logged inside logIngestRun itself.
    logError("logIngestRun falhou — métricas do ciclo não persistidas", {
      error: serialiseCause(err),
    });
  }

  logInfo("ingest ciclo concluído", {
    durationMs,
    filesFetched: targets.length,
    filesChanged: changed,
    unchanged,
    notFound: notFoundCount,
    errors: errorsCount,
    maxLagSeconds,
    turno,
    env,
    cargo: cargoDoCiclo ?? "all",
    fatia: fatiaDoCiclo ?? "none",
    rateLimited: clientStatsSnapshot.rateLimited,
    waitedMs,
  });

  // ----------------------------------------------------------------------------
  // 7. Slack alerts (RNF-034) — fire-and-forget, nunca bloqueia o response.
  // ----------------------------------------------------------------------------

  // TS narrowing perde o reassign dentro do async closure de `Promise.all`,
  // então fazemos o cast explícito aqui.
  // A REGRA de quando alarmar vive em `alertasDoCiclo` (lib/tse/alerts.ts),
  // separada do transporte. Antes de 18/09 as três condições eram `if`s soltos
  // aqui, depois de tudo que exige banco e rede — e por isso o RF-057 tinha
  // **zero teste**: chegar a estas linhas pedia Postgres, lock e CDN. A regra é
  // aritmética pura e agora é exercitada sem nada disso.
  const lagFinal = maxLagSeconds as number | null;
  for (const alerta of alertasDoCiclo({
    lagSegundos: lagFinal,
    errosConsecutivos: errorsCount,
    rateLimited: clientStatsSnapshot.rateLimited,
    ctx: { filesChanged: changed, filesFetched: targets.length, waitedMs, env, turno },
  })) {
    void notifySlack(alerta);
  }

  return NextResponse.json({
    ok: true,
    durationMs,
    filesFetched: targets.length,
    filesChanged: changed,
    unchanged,
    notFound: notFoundCount,
    errors: errorsCount,
    rateLimited: clientStatsSnapshot.rateLimited,
    waitedMs,
    ...(fatiaDoCiclo !== undefined ? { fatia: fatiaDoCiclo } : {}),
  });
}
