/**
 * lib/tse/log.ts
 *
 * Structured JSON-line logger for the TSE ingestion pipeline.
 *
 * Covers: RNF-032 (structured logs of ingest, model, errors).
 *
 * Design notes:
 *   - Writes ONE JSON object per line to stdout via `console.log`. Vercel
 *     Functions ingests stdout and, when each line parses as JSON, exposes
 *     the fields as filterable columns in the Logs UI without any extra
 *     transport.
 *   - No external dependency (pino, winston, etc.). The structured-log
 *     contract is just `JSON.stringify({ level, ts, msg, ctx })` — adding
 *     a logging library would only buy features we don't need (transports,
 *     redaction config, child loggers) at the cost of bundle size in the
 *     Fluid Compute runtime and another supply-chain surface.
 *   - `ts` is the runtime's UTC ISO 8601 string. Vercel adds its own
 *     ingestion timestamp on top; ours is useful when replaying logs
 *     locally or correlating across functions.
 *   - `debug` is gated by `process.env.LOG_LEVEL === 'debug'`. All other
 *     levels emit unconditionally.
 *   - The serialiser is defensive: if a context value is circular, a
 *     function, a bigint, or otherwise blows up `JSON.stringify`, we fall
 *     back to a minimal `{ level, ts, msg, ctxError }` line so the log
 *     channel never silently drops events.
 *
 * Not in scope here:
 *   - Slack alerting (T20 — `lib/tse/alerts.ts` will consume this logger
 *     as its emission backbone).
 *   - Sampling / rate limiting (Vercel does this server-side).
 *   - PII redaction — and that puts the rule on the CALLERS. ⚠️ Until
 *     2026-09-29 this line said "TSE EA20 contains no PII". False: the EA20
 *     `cand` element carries `dt`, the candidate's date of birth (EA20
 *     dictionary, `tse_docs/txt/tse-ea20-arquivo-de-resultado-unificado.txt:797`;
 *     `lib/tse/ea20-schema.ts`, `CandidatoSchema.dt`). The raw envelope is
 *     kept as received in `snapshots.payload` (constitution § 1 — the official
 *     data is never altered); `dt` is read in memory only, for the age
 *     tie-break of the proportional seat count (`api/model/deputado.py::
 *     _nascimento`), and nothing derived from it publishes it (payload, Blob,
 *     pages). This logger redacts nothing, so never pass a raw EA20 envelope,
 *     a `par`/`cand` object or a snapshot row in `ctx` — log counts, codes,
 *     URLs and hashes. Broader rule: constitution § 5 and `docs/nfr/security.md`.
 */

import { serialiseCause } from "./errors";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Free-form structured context. Values are best-effort JSON-serialised;
 * see `safeSerialiseCtx` below for the fallback rules applied to Errors,
 * circular refs, bigints, functions and undefined.
 */
export type LogContext = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Emit a structured log line. Prefer the level-specific helpers
 * ({@link logInfo}, {@link logWarn}, etc.) at call sites — they document
 * intent and let `grep`-style searches pick out severity quickly.
 */
export function log(level: LogLevel, msg: string, ctx?: LogContext): void {
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") {
    return;
  }

  const ts = new Date().toISOString();

  // Build the line in a try/catch so any pathological ctx value (circular,
  // bigint, function, etc.) degrades to a still-structured fallback line
  // rather than throwing inside the logger and losing the event.
  let line: string;
  try {
    const payload: Record<string, unknown> = { level, ts, msg };
    if (ctx !== undefined) {
      payload.ctx = ctx;
    }
    line = JSON.stringify(payload, jsonReplacer);
    // `JSON.stringify` returns `undefined` if the root value resolves to
    // undefined via the replacer — guard so we never call `console.log`
    // with `undefined` and produce the literal string "undefined".
    if (typeof line !== "string") {
      throw new Error("payload serialised to non-string");
    }
  } catch (err) {
    const ctxError = err instanceof Error ? err.message : String(err);
    line = JSON.stringify({ level, ts, msg, ctxError });
  }

  // Route warn/error to console.error so Vercel marks the line with
  // the appropriate severity icon; info/debug go to stdout.
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// Level helpers
// ---------------------------------------------------------------------------

export function logDebug(msg: string, ctx?: LogContext): void {
  log("debug", msg, ctx);
}

export function logInfo(msg: string, ctx?: LogContext): void {
  log("info", msg, ctx);
}

export function logWarn(msg: string, ctx?: LogContext): void {
  log("warn", msg, ctx);
}

export function logError(msg: string, ctx?: LogContext): void {
  log("error", msg, ctx);
}

// ---------------------------------------------------------------------------
// Internal: JSON replacer
// ---------------------------------------------------------------------------

/**
 * JSON.stringify replacer that normalises common non-serialisable values:
 *   - Error / TSEError / IngestError → routed through `serialiseCause`
 *     (uses .toJSON() when present, falls back to `{ name, message }`).
 *   - bigint → string with trailing 'n' (lossless, distinguishes from number).
 *   - function / undefined as object values → omitted from output (default
 *     JSON behaviour for functions; we also drop undefined explicitly so
 *     consumers don't see `"key":null`-style noise).
 *   - Circular references → caught by the outer try/catch in `log()`.
 *
 * Note: a WeakSet-based circular guard was considered but rejected; the
 * outer try/catch already handles the rare circular case with a clear
 * fallback line, and adding a guard here would walk every nested object
 * on every log call (hot path during ingestion).
 */
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "function") return undefined;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value instanceof Error) return serialiseCause(value);
  return value;
}
