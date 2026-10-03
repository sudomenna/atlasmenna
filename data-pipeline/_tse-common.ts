// Utilidades compartilhadas dos scripts ETL do TSE.
// - Pool Neon via WebSocket (mesma config de scripts/apply-postgis.mjs).
// - Download com retry + cache local em build/tse-archives/.
// - Parser CSV para o formato TSE: separador ;, aspas duplas (com newline
//   embutido em campo entre aspas), ISO-8859-1.
// - Util de batches para COPY-like INSERT.

import { exec, execFile } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
export const CACHE_DIR = resolve(ROOT, "build/tse-archives");
export const FIXTURES_DIR = resolve(ROOT, "data-pipeline/fixtures");

export function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

export function getPool(): Pool {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL_UNPOOLED (ou DATABASE_URL) não definido. Rode `vercel env pull` ou carregue .env.local antes.",
    );
  }
  return new Pool({ connectionString: url });
}

/**
 * User-Agent das requisições ao CDN de dados abertos do TSE.
 *
 * ⚠️ Medido em 2026-09-13: o WAF (Akamai) de `cdn.tse.jus.br` e
 * `dadosabertos.tse.jus.br` devolve **403** para qualquer User-Agent que
 * carregue e-mail ou URL de contato. O valor anterior —
 * `"AtlasMenna-ETL/0.1 (+menna@outsiders.digital)"` — era bloqueado, e com ele
 * `historical-import`, `eleitorado-import` e `zonas-import` falhariam contra o
 * TSE. O defeito ficava escondido pelo cache local e pelo fallback de fixture.
 *
 * A regra do WAF é sobre a FORMA, não sobre o nome: bloqueia qualquer UA com
 * e-mail ou URL entre parênteses (`"AtlasMenna/0.1 (+https://atlasmenna.online)"`,
 * `"AtlasMenna/0.1 contato@…"`) e também `"curl/8.7.1"`. Aceita token de produto
 * simples (`"AtlasMenna-ETL/0.1"`, `"AtlasMenna/0.1"`) e ausência de header.
 *
 * Mantemos um identificador — a constituição § 1 pede que o cliente seja
 * reconhecível pelo TSE — mas o contato **não cabe aqui**. Passar-se por
 * navegador resolveria o 403 e seria desonesto; não é opção. Não há caixa de
 * contato a declarar: a que constava antes nunca existiu (sem registro MX), e
 * desde 2026-10-03 nenhum User-Agent do projeto leva e-mail (ver o docstring de
 * `USER_AGENT` em `lib/tse/client.ts`).
 *
 * `resultados.tse.jus.br` (ingestão EA20, dia D) **não** aplica esta regra —
 * é outra propriedade Akamai, e `lib/tse/client.ts` não é afetado. Não
 * generalizar de um host para o outro.
 *
 * Cross-refs: ADR-0038, docs/operations/runbook.md.
 */
export const TSE_ETL_USER_AGENT = "AtlasMenna-ETL/0.1";

/** Opções de `downloadCached`. */
export interface DownloadCachedOpts {
  /** Tamanho mínimo aceitável (sanity check pós-download). */
  minBytes?: number;
  /**
   * Re-baixa **mesmo com cache válido**. O download vai para um arquivo
   * temporário ao lado do destino e só substitui o cache por `rename` atômico
   * depois de completo e acima de `minBytes` — um download que falha no meio
   * (HTTP de erro, rede caindo, corpo truncado) deixa o cache antigo intacto.
   */
  force?: boolean;
  /** Diretório de cache. Default `CACHE_DIR`; existe para os testes. */
  cacheDir?: string;
}

/**
 * Baixa uma URL para o diretório de cache se ainda não existir.
 * Reaproveita o arquivo local se já presente e acima de `minBytes` —
 * **a menos que `force`**. Retorna o caminho local.
 *
 * ⚠️ Sem `force`, o cache não expira: um ZIP baixado em 12/09 é servido para
 * sempre, mesmo que o TSE tenha regerado o arquivo. Foi assim que, em 03/10,
 * `candidatos:import --force` quase republicou o cadastro de 12/09 — a flag
 * prometia re-baixar e esta função não tinha como. Quem precisa de dado novo
 * passa `force: true`.
 *
 * @param url - URL HTTPS pública
 * @param filename - Nome do arquivo dentro do diretório de cache
 */
export async function downloadCached(
  url: string,
  filename: string,
  opts: DownloadCachedOpts = {},
): Promise<string> {
  const cacheDir = opts.cacheDir ?? CACHE_DIR;
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const dest = resolve(cacheDir, filename);
  if (existsSync(dest)) {
    const size = statSync(dest).size;
    if (size > (opts.minBytes ?? 1024)) {
      if (!opts.force) {
        console.log(`  [cache hit] ${filename} (${(size / 1024 / 1024).toFixed(1)} MB)`);
        return dest;
      }
      console.log(
        `  [force] ${filename} em cache (${(size / 1024 / 1024).toFixed(1)} MB) — re-baixando`,
      );
    } else {
      console.log(`  [cache stale] ${filename} (${size}B) — re-baixando`);
    }
  }
  console.log(`  [download] ${url}`);
  const t0 = Date.now();
  // Temporário no MESMO diretório: `rename` só é atômico dentro do mesmo
  // sistema de arquivos.
  const tmp = `${dest}.part-${process.pid}-${Date.now()}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": TSE_ETL_USER_AGENT },
      // signal: AbortSignal.timeout não suportado consistentemente em Node 22 fetch;
      // fica a critério do orquestrador setar timeout via Bash.
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} baixando ${url}`);
    }
    if (!res.body) {
      throw new Error(`Resposta sem body para ${url}`);
    }
    await pipeline(
      Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream),
      createWriteStream(tmp),
    );
    const size = statSync(tmp).size;
    console.log(
      `  [done] ${filename} ${(size / 1024 / 1024).toFixed(1)} MB em ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    if (opts.minBytes && size < opts.minBytes) {
      throw new Error(
        `Arquivo baixado (${size}B) abaixo do mínimo esperado (${opts.minBytes}B) — fonte TSE pode ter mudado.`,
      );
    }
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return dest;
}

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Opções de `unzipTo`. */
export interface UnzipToOpts {
  /**
   * Re-extrai mesmo que a pasta já tenha arquivos. Extrai numa pasta
   * temporária e só então troca pela antiga — um ZIP corrompido deixa a
   * extração anterior intacta. Arquivos que existiam na pasta antiga e não
   * existem no ZIP novo **somem** (é o ponto: nada de CSV velho ao lado do novo).
   */
  force?: boolean;
  /** Diretório de cache. Default `CACHE_DIR`; existe para os testes. */
  cacheDir?: string;
}

/**
 * Descompacta um ZIP em <cacheDir>/<subdir> usando `unzip` do sistema.
 * Idempotente: se o subdir já existe e tem arquivos, pula — **a menos que
 * `force`**. Sem `force`, um ZIP novo baixado por cima de um antigo NÃO é
 * re-extraído: quem lê a pasta continua lendo o CSV antigo (`[unzip cache hit]`).
 */
export async function unzipTo(
  zipPath: string,
  subdir: string,
  opts: UnzipToOpts = {},
): Promise<string> {
  const cacheDir = resolve(opts.cacheDir ?? CACHE_DIR);
  const targetDir = resolve(cacheDir, subdir);
  if (opts.force) {
    // `force` apaga a pasta-alvo: ela tem de ser uma subpasta própria do cache,
    // nunca o cache inteiro (que guarda backups ao lado) nem algo fora dele.
    if (dirname(targetDir) !== cacheDir) {
      throw new Error(
        `unzipTo: subdir inválido "${subdir}" — com force precisa ser uma pasta direta do cache`,
      );
    }
    const tmpDir = `${targetDir}.part-${process.pid}-${Date.now()}`;
    console.log(`  [unzip force] ${zipPath} → ${subdir}/`);
    try {
      await mkdir(tmpDir, { recursive: true });
      await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", tmpDir]);
      await rm(targetDir, { recursive: true, force: true });
      await rename(tmpDir, targetDir);
    } catch (err) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    return targetDir;
  }
  await mkdir(targetDir, { recursive: true });
  // Sanity: já existe e tem CSV dentro?
  if (existsSync(targetDir)) {
    const { stdout } = await execAsync(`ls "${targetDir}" 2>/dev/null | wc -l`);
    if (Number(stdout.trim()) > 0) {
      console.log(`  [unzip cache hit] ${subdir}/`);
      return targetDir;
    }
  }
  console.log(`  [unzip] ${zipPath} → ${subdir}/`);
  await execAsync(`unzip -o -q "${zipPath}" -d "${targetDir}"`);
  return targetDir;
}

/**
 * Limite de linhas físicas que um único registro lógico pode ocupar.
 * Serve de circuit breaker: se um CSV tiver uma aspa solta (não fechada),
 * a acumulação engoliria o arquivo inteiro num registro só, silenciosamente.
 * O maior registro multi-linha observado no acervo TSE ocupa 3 linhas.
 */
const MAX_LINES_PER_RECORD = 64;

/**
 * Itera registros de um CSV TSE (ISO-8859-1, separador `;`, aspas duplas).
 * Yieldea `string[]` com os campos sem aspas. Pula a linha de header (primeira).
 *
 * Um registro pode ocupar mais de uma linha física: o TSE emite newlines
 * dentro de campos entre aspas (medido em 11/09 no `eleitorado_local_votacao_2024`:
 * 6 registros com `DS_ENDERECO`/`DS_ENDERECO_LOCVT_ORIGINAL` quebrado em 3 linhas,
 * 12 linhas físicas excedentes em 599.217). Por isso acumulamos linhas enquanto
 * as aspas estiverem desbalanceadas (número ímpar de `"` no buffer) antes de
 * entregar ao parser — sem isso o registro é partido em fragmentos e ambos saem
 * errados: o primeiro perde as colunas finais (`QT_ELEITOR_SECAO` some e vira 0)
 * e os seguintes têm todos os offsets deslocados.
 *
 * O newline embutido é normalizado para `\n` (readline com `crlfDelay: Infinity`
 * não distingue `\r\n` de `\n`); irrelevante para os campos que consumimos.
 */
export async function* iterCsv(path: string): AsyncGenerator<string[], void, void> {
  const stream = createReadStream(path, { encoding: "latin1" });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  let isFirst = true;
  let pending: string | null = null;
  let pendingLines = 0;
  let lineNo = 0;
  for await (const raw of rl) {
    lineNo++;
    if (pending === null) {
      if (isFirst) {
        // Header pode, em tese, ser multi-linha também — mas nunca é; e mesmo
        // que fosse, o `pending` abaixo trataria antes de chegarmos ao `continue`.
        isFirst = false;
        if (countQuotes(raw) % 2 === 0) continue;
        pending = raw;
        pendingLines = 1;
        continue;
      }
      if (!raw) continue;
      if (countQuotes(raw) % 2 === 0) {
        yield parseTseCsvLine(raw);
        continue;
      }
      pending = raw;
      pendingLines = 1;
      continue;
    }
    // Registro em aberto: concatena preservando a quebra dentro do campo.
    pending += `\n${raw}`;
    pendingLines++;
    if (countQuotes(pending) % 2 === 0) {
      const record = pending;
      pending = null;
      pendingLines = 0;
      if (isFirst) {
        isFirst = false;
        continue;
      }
      yield parseTseCsvLine(record);
      continue;
    }
    if (pendingLines > MAX_LINES_PER_RECORD) {
      throw new Error(
        `CSV malformado em ${path}: registro iniciado antes da linha ${lineNo} passou de ` +
          `${MAX_LINES_PER_RECORD} linhas físicas com aspas abertas. Provável aspa solta na origem.`,
      );
    }
  }
  // EOF com registro em aberto: entrega o que temos em vez de descartar.
  if (pending !== null && !isFirst) {
    console.warn(
      `  [warn] ${path}: EOF com aspas abertas no último registro (${pendingLines} linhas) — entregue como está.`,
    );
    yield parseTseCsvLine(pending);
  }
}

function countQuotes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') n++;
  }
  return n;
}

/**
 * Parse de um registro CSV TSE. Tolerante a aspas opcionais e a campos vazios.
 * `""` dentro de campo entre aspas é escape de `"` literal (RFC 4180).
 * Aceita newlines embutidos — quem monta o registro é `iterCsv`.
 */
export function parseTseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ";" && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Lê o header de um CSV TSE e retorna um índice nome→posição.
 */
export async function readCsvHeader(path: string): Promise<Map<string, number>> {
  const stream = createReadStream(path, { encoding: "latin1" });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const raw of rl) {
    rl.close();
    stream.destroy();
    const cols = parseTseCsvLine(raw);
    const map = new Map<string, number>();
    cols.forEach((c, i) => {
      map.set(c.trim(), i);
    });
    return map;
  }
  throw new Error(`CSV vazio: ${path}`);
}

/**
 * Converte um valor TSE para inteiro. Trata "", "-1" (sentinel TSE), "NULL".
 */
export function toIntOrNull(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.trim();
  if (!s || s === "NULL" || s === "#NULO#" || s === "#NULO" || s === "-1") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function toIntOrZero(v: string | undefined): number {
  const n = toIntOrNull(v);
  return n ?? 0;
}

/**
 * Executa um INSERT em batch via UNNEST. Aceita um array de tuplas e a lista
 * de "tipos PG" + a SQL "INSERT ... SELECT * FROM UNNEST($1::t1[], $2::t2[], ...)
 * ON CONFLICT ...".
 *
 * Mantém o INSERT como template fornecido pelo chamador para flexibilidade
 * de schemas (ON CONFLICT keys variam).
 */
export async function bulkInsert(
  pool: Pool,
  sql: string,
  columnsAsArrays: unknown[][],
): Promise<void> {
  await pool.query(sql, columnsAsArrays);
}
