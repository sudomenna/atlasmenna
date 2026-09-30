/**
 * lib/tse/client.ts
 *
 * HTTP client for fetching a single EA20 result file from the TSE CDN.
 *
 * Covers: RF-001 (TSE CDN consumption), RF-003 (ETag / If-None-Match).
 * Design ref: docs/specs/001-ingestao-tse/design.md § "Padrão de polling".
 *
 * Intentionally minimal: this function performs ONE fetch attempt with no
 * retry. Retry logic (3 attempts, 1s/2s/4s backoff) lives in T05
 * (lib/tse/retry.ts) and wraps this function at the call site.
 *
 * Error contract:
 *   - Timeout / AbortError → throws IngestError('timeout', ...)
 *   - DNS / connection failure → throws IngestError('network', ...)
 *   - Non-200/304/404 HTTP status → throws TSEError(status, url, bodySample)
 *   - Unparseable JSON body → throws IngestError('parse', ...)
 *   - Zod schema validation failure → throws IngestError('parse', ...)
 *
 * Callers (T08 route handler) are responsible for logging errors; this file
 * logs only the 404 debug case (rebaixado de warn — ver comentário no
 * branch 404 abaixo) because 404 is a recoverable no-op that callers should
 * not need to handle specially. Aggregate counters (getClientStats()) give
 * ops visibility into 404/429/304 volume without per-request log noise.
 */

import type { CargoTse } from "@/lib/config/cargos";
import { type EA20, EA20Schema, KNOWN_EA20_AMBIENTES } from "./ea20-schema";
import { IngestError, TSEError } from "./errors";
import { logDebug, logWarn } from "./log";
import { getTseRateLimiter } from "./rate-limiter";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FetchEA20Result =
  | { kind: "fresh"; data: EA20; etag: string | null; hash: string }
  | { kind: "not_modified" }
  | { kind: "not_found" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * User-Agent sent on every request to the TSE CDN.
 *
 * 2026-09-05 — a pesquisa TSE do simulado corrigiu uma premissa errada da
 * documentação de maio: **não existe cadastro prévio de "interessado na
 * divulgação"** (a Res. TSE 23.751/2026, arts. 264-269, não prevê esse
 * cadastro). O User-Agent anterior ("interessado-divulgacao-cadastrado")
 * declarava um status que nunca existiu — violação de honestidade, não só
 * de precisão técnica. Identificar o cliente com um User-Agent reconhecível
 * continua sendo boa prática de transparência (constituição § 1) mesmo sem
 * exigência formal do TSE.
 *
 * 2026-09-05 — contato definido pelo usuário: `contato@salacofre.com.br`.
 * A caixa precisa estar ativa e ser lida: é por ela que o TSE avisaria de
 * bloqueio de IP ou de mudança de leiaute durante os simulados e no dia D.
 *
 * 🔴 **2026-09-19 — a URL passou a ser `salacofre.vercel.app`, por decisão do
 * dono, e isso é PROVISÓRIO.**
 *
 * `salacofre.com.br` ainda não foi apontado: medido em 19/09, o `curl` estoura
 * 25s e o DNS resolve para `189.125.92.230`, que não é endereço da Vercel. O
 * ADR-0020 exige "URL pública e contato **verificável**" — e uma URL que não
 * responde não é verificável. Declarar um endereço morto a uma autoridade
 * eleitoral é a mesma classe de problema que o `interessado-divulgacao-cadastrado`
 * de antes: uma afirmação que não se sustenta se alguém for conferir.
 *
 * Entre um endereço bonito que não abre e um feio que abre, o ADR pede o
 * segundo. Reverter é trocar esta string de volta quando o domínio estiver no
 * ar — e o teste de `client.test.ts` cai junto, de propósito.
 *
 * ⚠️ **O CONTATO CONTINUA NÃO VERIFICÁVEL, e isso NÃO foi resolvido aqui.**
 * `contato@salacofre.com.br` depende do mesmo domínio e exige registro **MX**
 * separado — que não vem junto com o apontamento do site. Pelo parágrafo acima,
 * é por esta caixa que o TSE avisaria de bloqueio de IP durante o simulado ou no
 * dia D. **Hoje esse aviso não chegaria a ninguém.** Decisão pendente do dono;
 * registrado em `docs/reference/risks.md` (2ª linha de Riscos ativos).
 */
export const USER_AGENT =
  "SalaCofre/1.0 (+https://salacofre.vercel.app; contato: contato@salacofre.com.br)";

/** Fetch timeout in milliseconds. Documented in design.md § Tratamento de falhas. */
const FETCH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Client-side stats (RNF-034 — observability for rate limiting / 404s)
// ---------------------------------------------------------------------------

export interface ClientStats {
  /** Quantas vezes o TSE respondeu 429 (rate limited). */
  rateLimited: number;
  /** Quantas vezes o TSE respondeu 404 (zona sem dados ainda). */
  notFound: number;
  /** Quantas vezes o TSE respondeu 304 (ETag hit). */
  notModified: number;
}

const clientStats: ClientStats = { rateLimited: 0, notFound: 0, notModified: 0 };

/** getClientStats — snapshot dos contadores acumulados desde o boot do
 *  processo (ou desde o último resetClientStats()). Usado por
 *  app/api/ingest/route.ts para expor `rateLimited`/`notFound` no response
 *  e disparar alerta Slack quando `rateLimited > 0`. */
export function getClientStats(): ClientStats {
  return { ...clientStats };
}

/** resetClientStats — zera os contadores. Uso: início de cada ciclo de
 *  ingestão (para que as métricas reflitam SÓ o ciclo atual, não o processo
 *  inteiro) e testes. */
export function resetClientStats(): void {
  clientStats.rateLimited = 0;
  clientStats.notFound = 0;
  clientStats.notModified = 0;
}

// ---------------------------------------------------------------------------
// EA20 `f` (ambiente) drift warning — once per process
// ---------------------------------------------------------------------------

/** Garante um único logWarn por processo quando `f` sai de
 *  KNOWN_EA20_AMBIENTES — evita inundar os logs quando o TSE introduz um
 *  ambiente novo (ex.: um 3º valor além de "o"/"s") e um ciclo processa
 *  milhares de zonas com o mesmo `f`. */
let warnedUnknownAmbiente = false;

function warnUnknownAmbienteOnce(f: string): void {
  if (warnedUnknownAmbiente) return;
  if ((KNOWN_EA20_AMBIENTES as readonly string[]).includes(f)) return;
  warnedUnknownAmbiente = true;
  logWarn(
    "EA20 campo `f` (ambiente) fora de KNOWN_EA20_AMBIENTES — TSE pode ter introduzido um ambiente novo",
    {
      f,
      known: KNOWN_EA20_AMBIENTES,
    },
  );
}

// ---------------------------------------------------------------------------
// Retry-After parsing (429/503)
// ---------------------------------------------------------------------------

/**
 * parseRetryAfterMs — converte o header `Retry-After` (segundos inteiros OU
 * data HTTP no formato RFC 7231) para milissegundos.
 *
 * Retorna `undefined` quando o header está ausente ou não parseia — o
 * chamador trata isso como "sem hint do servidor" e cai no backoff
 * exponencial padrão de `retry.ts`.
 */
function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;

  const trimmed = headerValue.trim();

  // Forma 1: inteiro de segundos (ex.: "2", "120").
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // Forma 2: data HTTP (ex.: "Wed, 21 Oct 2026 07:28:00 GMT").
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    const diffMs = asDate - Date.now();
    return diffMs > 0 ? diffMs : 0;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// fetchEA20
// ---------------------------------------------------------------------------

/**
 * Fetch a single EA20 zone-result file from the TSE CDN.
 *
 * @param opts.url   - Canonical EA20 URL (built by lib/tse/targets.ts).
 * @param opts.cargo - Cargo do alvo (`Target.cargo`). OBRIGATÓRIO no tipo: é ele
 *                     que escolhe o bucket de taxa (`getTseRateLimiter(cargo)`,
 *                     ADR-0068). Sem ele a requisição cairia num bucket de 5 rps
 *                     fora da conta do pior caso agregado — esquecer o cargo
 *                     tem de ser erro de compilação, não um default silencioso.
 * @param opts.etag  - Last known ETag for this (url). When truthy, the request
 *                     includes `If-None-Match` and the TSE CDN may respond 304.
 *                     Falsy values (null, undefined, empty string) are treated
 *                     identically: the header is omitted entirely rather than
 *                     sent as an empty string, which some CDN implementations
 *                     reject or mishandle.
 *
 * @returns
 *   - `{ kind: 'fresh', data, etag, hash }` — new payload, ready to persist.
 *   - `{ kind: 'not_modified' }` — TSE confirmed no change; skip this cycle.
 *   - `{ kind: 'not_found' }` — zone has no data yet; skip, retry next cycle.
 *
 * @throws TSEError    on unexpected HTTP status (not 200, 304, 404).
 * @throws IngestError on timeout, network failure, or JSON/Zod parse failure.
 */
export async function fetchEA20(opts: {
  url: string;
  cargo: CargoTse;
  etag?: string | null;
}): Promise<FetchEA20Result> {
  // RF-001 hardening (2026-09-05): respeita o limite de 100 req/s/IP do TSE
  // ANTES de cada tentativa — inclusive retries (withRetry chama fetchEA20
  // de novo a cada tentativa, então colocar o acquire() aqui cobre "antes de
  // cada tentativa" sem precisar duplicar a lógica em retry.ts). O bucket é o
  // do CARGO do alvo (ADR-0068): o teto de um cargo nunca é decidido por outro.
  await getTseRateLimiter(opts.cargo).acquire();

  // Build request headers
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
    "User-Agent": USER_AGENT,
  };

  // Only send If-None-Match when we have a non-empty ETag. An empty or absent
  // header would cause some CDN nodes to ignore the conditional request
  // entirely and always return 200, defeating the purpose.
  if (opts.etag) {
    headers["If-None-Match"] = opts.etag;
  }

  // Perform the fetch with a hard timeout
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    // AbortSignal.timeout() throws a DOMException. The `name` may be
    // 'TimeoutError' (the spec-compliant value) or 'AbortError' (older
    // Chromium / Node builds). We treat both as a timeout because any abort
    // coming from our own signal is intentional.
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new IngestError("timeout", `Timeout ${FETCH_TIMEOUT_MS}ms em ${opts.url}`, err);
    }

    // Any other fetch-level failure (DNS resolution, TCP refused, etc.)
    // is a network error.
    const msg = err instanceof Error ? err.message : String(err);
    throw new IngestError("network", msg, err);
  }

  // -------------------------------------------------------------------------
  // Status routing
  // -------------------------------------------------------------------------

  if (res.status === 304) {
    // ETag hit — no payload to process; caller re-uses the last snapshot.
    clientStats.notModified += 1;
    return { kind: "not_modified" };
  }

  if (res.status === 404) {
    // Zone exists in our target list but the TSE CDN has not published data
    // for it yet. This is expected at the start of counting and in the first
    // several minutes after polls close.
    //
    // 2026-09-05: rebaixado de warn para debug — a FAQ técnica do simulado
    // confirma que 404 em URL malformada pode disparar bloqueio de IP, o que
    // torna 404 um sinal mais sensível (não apenas "zona pendente" benigno)
    // e um candidato a inundar os logs em warn durante o início da apuração,
    // quando milhares de zonas ainda não têm dados. O contador em
    // getClientStats().notFound preserva a observabilidade sem o volume de
    // log em nível warn.
    logDebug("TSE 404 — zona sem dados", { url: opts.url });
    clientStats.notFound += 1;
    return { kind: "not_found" };
  }

  if (!res.ok) {
    // 5xx, 429, unexpected 4xx — throw so the retry wrapper (T05) can decide
    // whether to retry. We read the body for forensic context but do NOT
    // log here; the caller owns the error handling narrative.
    const bodySample = await res.text().catch(() => undefined);
    const retryAfterMs =
      res.status === 429 || res.status === 503
        ? parseRetryAfterMs(res.headers.get("retry-after"))
        : undefined;
    if (res.status === 429) {
      clientStats.rateLimited += 1;
    }
    throw new TSEError(res.status, opts.url, bodySample, retryAfterMs);
  }

  // -------------------------------------------------------------------------
  // 200 OK — parse and hash
  // -------------------------------------------------------------------------

  // Read the raw text. We hash the text (not the parsed object) so the hash
  // is deterministic against the bytes received from the TSE CDN, regardless
  // of how JSON.parse / JSON.stringify might reorder keys or normalise
  // whitespace. The dedup logic in T06 (insertSnapshot) uses this same hash.
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new IngestError("network", `Falha lendo body de ${opts.url}: ${msg}`, err);
  }

  // SHA-256 via Web Crypto — available globally in Node 24 + Vercel Fluid
  // Compute. Using crypto.subtle keeps this runtime-agnostic (works in Edge
  // Runtime too if we ever need it) without any extra deps.
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Parse JSON. Any exception here (malformed body, truncated response) is
  // a parse-category ingest error.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new IngestError("parse", `JSON.parse falhou em ${opts.url}`, err);
  }

  // Validate against the EA20 Zod schema (dg/hg/cdabr/abr obrigatórios,
  // .passthrough() no resto — ver lib/tse/ea20-schema.ts).
  // ZodError thrown here means a REQUIRED field is missing/wrong-shaped —
  // treated as a parse failure so the retry wrapper does NOT retry (parse
  // errors are non-retryable by design).
  let data: EA20;
  try {
    data = EA20Schema.parse(parsed);
  } catch (err) {
    throw new IngestError("parse", `EA20Schema validação falhou em ${opts.url}`, err);
  }

  // `f` (ambiente) fora de KNOWN_EA20_AMBIENTES — alerta uma vez por
  // processo (não falha o parse; ver comentário em ea20-schema.ts).
  warnUnknownAmbienteOnce(data.f);

  // Capture ETag from the response. HTTP header names are case-insensitive;
  // fetch() normalises them to lowercase, so 'etag' is always the right key.
  // We preserve the raw value including any surrounding quotes (TSE uses
  // strong ETags like `"abc123"` — stripping quotes would invalidate the
  // If-None-Match round-trip).
  const etag = res.headers.get("etag");

  return { kind: "fresh", data, etag, hash };
}
