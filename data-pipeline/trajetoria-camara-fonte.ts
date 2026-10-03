// data-pipeline/trajetoria-camara-fonte.ts
//
// O I/O da trajetória na Câmara (spec 018, RF-214, ADR-0058): baixa o histórico de
// deputados e a lista de quem está em exercício da API de Dados Abertos da
// Câmara, guarda em cache em disco e devolve o índice pronto para o casamento
// (`trajetoria-camara.ts`).
//
// Fontes (medidas em 26/09/2026):
//   https://dadosabertos.camara.leg.br/arquivos/deputados/csv/deputados.csv
//     → `;`, UTF-8 com BOM, 7.889 pessoas que já exerceram mandato desde 1826.
//   https://dadosabertos.camara.leg.br/api/v2/deputados?itens=1000
//     → os 513 em exercício, numa página só.
//
// ─── Cache em disco, no espírito de `downloadCached` ────────────────────────
//
// `build/camara/`. Arquivo presente e válido é reaproveitado; `refresh: true`
// baixa de novo. A escrita é atômica (`.tmp` + `rename`) e só acontece DEPOIS
// de o conteúdo passar pela validação — um download truncado nunca vira cache.
//
// ─── A API da Câmara trava ──────────────────────────────────────────────────
//
// Medido em 26/09: requisições que ficam mais de 25 s sem resposta. Por isso
// timeout curto por tentativa (o `AbortSignal` cobre também a leitura do
// corpo) e novas tentativas com espera crescente.
//
// ─── Sanidade ───────────────────────────────────────────────────────────────
//
// A lista em exercício tem de ter entre 500 e 513 ids. Menos que isso é quase
// certamente resposta cortada, e cortada ela rebaixaria deputado em exercício
// para `legislatura_atual` sem aviso. O histórico tem de ter ≥ 7.000 pessoas
// (medido: 7.889) — abaixo disso, ex-deputados virariam "estreantes".

import { existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  construirIndiceCamara,
  type DeputadoCamara,
  type IndiceCamara,
  parseDeputadosCsv,
  parseEmExercicioJson,
} from "./trajetoria-camara.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CAMARA_CACHE_DIR = resolve(ROOT, "build/camara");

export const URL_DEPUTADOS_CSV =
  "https://dadosabertos.camara.leg.br/arquivos/deputados/csv/deputados.csv";
export const URL_EM_EXERCICIO = "https://dadosabertos.camara.leg.br/api/v2/deputados?itens=1000";

export const ARQ_DEPUTADOS = "deputados.csv";
export const ARQ_EM_EXERCICIO = "deputados_em_exercicio.json";

export const MIN_EM_EXERCICIO = 500;
export const MAX_EM_EXERCICIO = 513;
export const MIN_DEPUTADOS_HISTORICO = 7000;

/** Mesmo identificador sem contato do ETL do TSE (ver `_tse-common.ts`). */
const USER_AGENT = "AtlasMenna-ETL/0.1";

export interface OpcoesFonteCamara {
  dir?: string;
  /** Ignora o cache e baixa de novo. */
  refresh?: boolean;
  /**
   * **Só cache**: nunca toca a rede e nunca cria nem escreve no diretório —
   * cache ausente lança. É o modo da exportação offline
   * (`trajetoria-exportar.ts`), que pode ser apontada para o cache de OUTRA
   * árvore (`--camara-dir`) e não pode alterá-lo. Incompatível com `refresh`.
   */
  somenteCache?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  tentativas?: number;
  /** Espera entre tentativas — injetável para o teste não dormir. */
  esperar?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export interface FonteCamara {
  indice: IndiceCamara;
  /** `mtime` de cada arquivo usado — a idade do dado vai para o log. */
  deputadosTs: Date;
  emExercicioTs: Date;
  origemDeputados: "cache" | "download";
  origemEmExercicio: "cache" | "download";
}

function validarDeputados(texto: string): DeputadoCamara[] {
  const deps = parseDeputadosCsv(texto);
  if (deps.length < MIN_DEPUTADOS_HISTORICO) {
    throw new Error(
      `deputados.csv com ${deps.length} pessoas (mínimo ${MIN_DEPUTADOS_HISTORICO}) — download truncado?`,
    );
  }
  return deps;
}

function validarEmExercicio(texto: string): number[] {
  const ids = parseEmExercicioJson(texto);
  const n = new Set(ids).size;
  if (n < MIN_EM_EXERCICIO || n > MAX_EM_EXERCICIO) {
    throw new Error(
      `lista em exercício com ${n} ids distintos (esperado ${MIN_EM_EXERCICIO}–${MAX_EM_EXERCICIO})`,
    );
  }
  return ids;
}

/** GET com timeout por tentativa e novas tentativas com espera crescente. */
export async function baixarTexto(
  url: string,
  opts: Pick<OpcoesFonteCamara, "fetchImpl" | "timeoutMs" | "tentativas" | "esperar" | "log">,
): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const tentativas = opts.tentativas ?? 4;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const esperar = opts.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log ?? console.log;
  let ultimo: unknown = null;
  for (let k = 1; k <= tentativas; k++) {
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await f(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/csv" },
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      ultimo = err;
      log(`  [camara] tentativa ${k}/${tentativas} falhou em ${url}: ${(err as Error).message}`);
      if (k < tentativas) await esperar(2000 * k);
    }
  }
  throw new Error(
    `Câmara indisponível após ${tentativas} tentativas (${url}): ${(ultimo as Error)?.message}`,
  );
}

async function obterArquivo<T>(
  url: string,
  destino: string,
  validar: (texto: string) => T,
  opts: OpcoesFonteCamara,
): Promise<{ valor: T; ts: Date; origem: "cache" | "download" }> {
  const log = opts.log ?? console.log;
  if (!opts.refresh && existsSync(destino)) {
    const valor = validar(await readFile(destino, "utf8"));
    const ts = statSync(destino).mtime;
    log(`  [camara] cache ${destino} (${ts.toISOString()})`);
    return { valor, ts, origem: "cache" };
  }
  if (opts.somenteCache) {
    throw new Error(
      `cache da Câmara ausente: ${destino} — o modo só-cache não baixa. ` +
        `Aponte --camara-dir para um cache existente ou rode com --camara-refresh.`,
    );
  }
  const texto = await baixarTexto(url, opts);
  const valor = validar(texto);
  const tmp = `${destino}.tmp`;
  await writeFile(tmp, texto, "utf8");
  await rename(tmp, destino);
  log(`  [camara] baixado ${url} → ${destino}`);
  return { valor, ts: statSync(destino).mtime, origem: "download" };
}

/**
 * Carrega (do cache ou da rede) o histórico e a lista em exercício e devolve o
 * índice. **Lança** se qualquer um dos dois faltar ou não passar na sanidade —
 * quem chama decide se isso aborta (a exportação e a paridade abortam: ausência
 * de histórico é "não calculado", nunca "estreante" — ADR-0058 item 4).
 */
export async function carregarFonteCamara(opts: OpcoesFonteCamara = {}): Promise<FonteCamara> {
  const dir = opts.dir ?? CAMARA_CACHE_DIR;
  if (opts.somenteCache && opts.refresh) {
    throw new Error("somenteCache e refresh são incompatíveis — refresh baixa da rede");
  }
  if (!existsSync(dir)) {
    if (opts.somenteCache) throw new Error(`cache da Câmara ausente: diretório ${dir}`);
    mkdirSync(dir, { recursive: true });
  }
  const deps = await obterArquivo(
    URL_DEPUTADOS_CSV,
    resolve(dir, ARQ_DEPUTADOS),
    validarDeputados,
    opts,
  );
  const exerc = await obterArquivo(
    URL_EM_EXERCICIO,
    resolve(dir, ARQ_EM_EXERCICIO),
    validarEmExercicio,
    opts,
  );
  return {
    indice: construirIndiceCamara(deps.valor, exerc.valor),
    deputadosTs: deps.ts,
    emExercicioTs: exerc.ts,
    origemDeputados: deps.origem,
    origemEmExercicio: exerc.origem,
  };
}
