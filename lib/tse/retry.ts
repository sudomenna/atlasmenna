/**
 * lib/tse/retry.ts
 *
 * Generic exponential-backoff retry wrapper for the TSE ingestion pipeline.
 *
 * Covers: RF-001 (resiliência do pipeline), RNF-011 (recuperação automática).
 * Design ref: docs/specs/001-ingestao-tse/design.md § "Tratamento de falhas".
 *
 * Retry policy (defaults):
 *   - 3 attempts maximum.
 *   - Exponential backoff: baseMs * 2^(attempt-1).
 *     attempt 1 fails → wait 1s
 *     attempt 2 fails → wait 2s
 *     attempt 3 fails → wait 4s (then re-throw)
 *   - Retryable: TSEError(status >= 500), TSEError(status === 429),
 *     IngestError(reason='network'|'timeout').
 *   - NOT retryable: IngestError(reason='parse') — a broken schema is
 *     deterministic; retrying wastes 7s+ before surfacing the same failure.
 *     IngestError(reason='persist') — a DB constraint violation won't fix
 *     itself in 1s either; fail-fast and let the next cron cycle handle it.
 *     TSEError(4xx, exceto 429) — auth/permission errors won't resolve
 *     without operator action. Note: 304 and 404 never throw from
 *     fetchEA20 — they are returned as { kind: 'not_modified' | 'not_found' }
 *     and never reach here.
 *   - Unknown errors: NOT retried (fail-fast to surface unexpected issues).
 *
 * 429 handling (2026-09-05 — hardening pré-simulado): a FAQ técnica do
 * simulado TSE confirma rate limit de 100 req/s/IP → bloqueio de 10min. Um
 * 429 é quase sempre acompanhado de um header `Retry-After` — honramos esse
 * valor via `TSEError.retryAfterMs` (parseado em client.ts), usando
 * `max(backoffPadrão, retryAfterMs)` como delay real, sempre limitado por
 * `RETRY_MAX_DELAY_MS` (15s) para não travar um único target por tempo
 * demais dentro do orçamento de `maxDuration`. `getTseRateLimiter(cargo)` em
 * client.ts já limita a TAXA de saída — este retry trata o caso em que,
 * mesmo respeitando a taxa configurada, o TSE ainda respondeu 429 (ex.:
 * outro processo no mesmo IP, ou o limite real sendo mais apertado que
 * `TSE_MAX_RPS`).
 *
 * Wallclock budget (default 3 attempts, 5s fetch timeout each):
 *   Max sleep total : 1s + 2s + 4s = 7s (sem 429/Retry-After)
 *   Max fetch total : 3 × 5s = 15s
 *   Worst-case total: ~22s por target sem 429; até 3×15s=45s de sleep se
 *   todas as tentativas honrarem um Retry-After no teto (bem dentro do
 *   `maxDuration=180` — ver app/api/ingest/route.ts).
 *
 * No jitter is applied. The TSE CDN serves a large number of independent
 * files; each target follows its own backoff clock so natural desynchronisation
 * avoids the thundering-herd problem. Jitter may be added in a future chore
 * if correlated retries become observable.
 */

import { IngestError, TSEError } from "./errors";
import { logDebug } from "./log";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /**
   * Maximum number of attempts (including the first try).
   * Must be >= 1. Default: 3.
   */
  attempts?: number;

  /**
   * Base delay in milliseconds for exponential backoff.
   * Delay before attempt n+1 = baseMs * 2^(n-1).
   * Default: 1000.
   */
  baseMs?: number;

  /**
   * Predicate that decides whether a thrown error warrants another attempt.
   * Receives the error and the 1-based attempt number that just failed.
   * Default: retry iff TSEError(status >= 500) or IngestError(reason
   * 'network' | 'timeout').
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean;

  /**
   * Called between attempts (after the sleep delay has been calculated, but
   * before sleeping). Useful for custom logging or metrics.
   * Default: logDebug with { attempt, delayMs, error }.
   */
  onRetry?: (err: unknown, attempt: number, nextDelayMs: number) => void;
}

// ---------------------------------------------------------------------------
// Default shouldRetry
// ---------------------------------------------------------------------------

/** Teto de delay (ms) entre tentativas, mesmo quando Retry-After pede mais.
 *  Ver nota "429 handling" no cabeçalho do arquivo. */
export const RETRY_MAX_DELAY_MS = 15_000;

/**
 * Default retry predicate.
 *
 * Retryable:
 *   - TSEError with status >= 500 (transient server-side errors).
 *   - TSEError with status === 429 (rate limited — honra Retry-After via
 *     computeDelayMs abaixo).
 *   - IngestError with reason 'network' or 'timeout' (transient transport
 *     failures — DNS flap, TCP reset, CDN timeout).
 *
 * NOT retryable (fail-fast):
 *   - IngestError reason='parse': broken EA20 schema is deterministic; retry
 *     won't fix it, and it should trigger an alert, not silent backoff.
 *   - IngestError reason='persist': DB failures need operator investigation.
 *   - TSEError with 4xx status other than 429: permission/auth issues won't
 *     self-heal.
 *   - Any unknown error type: surface immediately so unexpected failures
 *     aren't silently swallowed.
 */
function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof TSEError) {
    return err.status >= 500 || err.status === 429;
  }
  if (err instanceof IngestError) {
    return err.reason === "network" || err.reason === "timeout";
  }
  return false;
}

/**
 * computeDelayMs — delay antes da próxima tentativa.
 *
 * Regra: `max(backoffExponencial, retryAfterMs)`, sempre limitado por
 * `RETRY_MAX_DELAY_MS`. Quando o erro não carrega `retryAfterMs` (a maioria
 * dos casos — 5xx genérico, network, timeout), o comportamento é idêntico ao
 * backoff exponencial puro de antes desta mudança.
 */
function computeDelayMs(err: unknown, backoffMs: number): number {
  const retryAfterMs = err instanceof TSEError ? err.retryAfterMs : undefined;
  const delay = retryAfterMs !== undefined ? Math.max(backoffMs, retryAfterMs) : backoffMs;
  return Math.min(delay, RETRY_MAX_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Default onRetry
// ---------------------------------------------------------------------------

/**
 * Default retry hook: emits a debug-level structured log entry.
 *
 * Deliberately uses logDebug (not logInfo/logWarn). During peak ingestion
 * with ~73k targets, even 1% retry rate generates ~730 log lines per cycle
 * at info level. Debug only activates when LOG_LEVEL=debug.
 */
function defaultOnRetry(err: unknown, attempt: number, nextDelayMs: number): void {
  logDebug("tse:retry", {
    attempt,
    delayMs: nextDelayMs,
    error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
  });
}

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

/**
 * Execute `fn` with exponential-backoff retry.
 *
 * @param fn   - Async (or sync-returning) factory called on each attempt.
 *               If `fn` throws synchronously the `try` block catches it the
 *               same as an async rejection, so callers need not worry about
 *               this distinction.
 * @param opts - Optional tuning (see {@link RetryOptions}).
 * @returns    - The resolved value of `fn()` on the first successful attempt.
 * @throws     - The last error thrown by `fn` once all attempts are exhausted,
 *               OR the first error when `shouldRetry` returns false (cancelled
 *               immediately without sleeping — avoids latency for fail-fast
 *               errors like parse failures).
 *               Errors are re-thrown as-is (never wrapped) so callers can
 *               `instanceof`-check TSEError / IngestError directly.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  const maxAttempts = opts?.attempts ?? 3;
  const baseMs = opts?.baseMs ?? 1_000;
  const shouldRetry = opts?.shouldRetry ?? defaultShouldRetry;
  const onRetry = opts?.onRetry ?? defaultOnRetry;

  // Validate attempts upfront so callers get a clear error rather than an
  // infinite loop or silent zero-attempt execution.
  if (maxAttempts < 1) {
    throw new Error("attempts deve ser >= 1");
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // `await` captures both async rejections AND synchronous throws from
      // `fn` (if `fn` throws before returning a Promise, the expression
      // evaluates to a rejected Promise, which the try/catch handles).
      return await fn();
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === maxAttempts;

      // If this error is not retryable, re-throw immediately without sleeping.
      // Fail-fast is important for parse errors — sleeping 1s+ before
      // propagating a deterministic failure adds latency with no benefit.
      if (!shouldRetry(err, attempt)) {
        throw err;
      }

      // If we've exhausted all attempts, fall through to the re-throw below.
      if (isLastAttempt) {
        break;
      }

      // Compute backoff: baseMs * 2^(attempt-1)
      // attempt=1 → baseMs * 1 = 1s
      // attempt=2 → baseMs * 2 = 2s
      // attempt=3 → baseMs * 4 = 4s (only reached if maxAttempts > 3)
      const backoffMs = baseMs * 2 ** (attempt - 1);

      // Se o erro carrega um Retry-After (429/503 — ver client.ts), honra o
      // maior entre o backoff padrão e o hint do servidor, limitado a
      // RETRY_MAX_DELAY_MS.
      const delayMs = computeDelayMs(err, backoffMs);

      onRetry(err, attempt, delayMs);

      await sleep(delayMs);
    }
  }

  // Re-throw the last error as-is (no wrapping) so the caller's instanceof
  // checks against TSEError / IngestError remain valid.
  throw lastError;
}
