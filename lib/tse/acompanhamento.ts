/**
 * lib/tse/acompanhamento.ts
 *
 * Cliente + schema para os arquivos de acompanhamento do TSE:
 *   - EA14 — acompanhamento BRASIL (`br-e<eleição>-ab.json`).
 *   - EA15 — acompanhamento por UF (`<uf>-e<eleição>-ab.json`).
 *
 * Fonte: docs/reference/tse-2026-leiautes.md (deriva dos PDFs oficiais
 * TSE-EA14-Arquivo-de-acompanhamento-Brasil.md e
 * TSE-EA15-Arquivo-de-acompanhamento-UF.md, ambos 2026-06-10).
 *
 * Por que isto existe (Fase 1b do plano de prontidão pré-simulado): o EA14
 * traz, em UM ÚNICO arquivo, um item `abr[]` com `tpabr: "uf"` para CADA UF
 * que tem eleição — ou seja, dá pra saber quais UFs mudaram desde o último
 * ciclo com 1 GET, em vez de buscar EA20 de todas as 27 UFs (ou pior, todas
 * as ~2.600 zonas) a cada ciclo de 60s. Isso é o gating mencionado em RF-002/
 * design.md.
 *
 * `detectChangedUfs` é fail-open por design: qualquer erro (rede, timeout,
 * parse) faz TODAS as UFs solicitadas voltarem como `changed: true` — o
 * objetivo do gating é ECONOMIZAR requisições em ciclos parados, nunca
 * PERDER uma atualização real. Um falso positivo custa GETs extras; um falso
 * negativo custa dados desatualizados no ar.
 */

import { z } from "zod";
import type { CargoTse } from "@/lib/config/cargos";
import { USER_AGENT } from "./client";
import { logDebug, logWarn } from "./log";
import { getTseRateLimiter } from "./rate-limiter";
import { buildEA14Url, getTseBaseUrl } from "./targets";

// ---------------------------------------------------------------------------
// Zod schemas — EA14 (Brasil) / EA15 (UF)
// ---------------------------------------------------------------------------

/** Elemento `s` (seções) — idêntico em EA14/EA15/EA20. */
const AcompanhamentoSecoesSchema = z
  .object({
    ts: z.string(),
    st: z.string(),
    pst: z.string(),
  })
  .passthrough();

/** Elemento `e` (eleitores) — idêntico em EA14/EA15/EA20. */
const AcompanhamentoEleitoresSchema = z
  .object({
    te: z.string(),
    c: z.string().optional(),
  })
  .passthrough();

/**
 * Item de `abr[]` do EA14 — um por UF (`tpabr: "uf"`) mais um resumo
 * nacional (`tpabr: "br"`).
 */
const EA14AbrItemSchema = z
  .object({
    and: z.string(), // andamento: 'n' | 'p' | 'f'
    tpabr: z.string(), // 'br' | 'uf'
    cdabr: z.string(), // 'br' | sigla da UF
    dt: z.string().optional(),
    ht: z.string().optional(),
    s: AcompanhamentoSecoesSchema.optional(),
    e: AcompanhamentoEleitoresSchema.optional(),
  })
  .passthrough();

export const EA14Schema = z
  .object({
    ele: z.string(),
    t: z.string(),
    f: z.string().min(1),
    dg: z.string(),
    hg: z.string(),
    idg: z.string().optional(),
    abr: z.array(EA14AbrItemSchema),
  })
  .passthrough();

export type EA14 = z.infer<typeof EA14Schema>;

/**
 * Item de `abr[]` do EA15 — um por UF (`tpabr: "uf"`) mais um por município
 * (`tpabr: "mun"`) dentro dela.
 */
const EA15AbrItemSchema = z
  .object({
    and: z.string(),
    tpabr: z.string(), // 'uf' | 'mun'
    cdabr: z.string(), // sigla da UF | código do município
    dt: z.string().optional(),
    ht: z.string().optional(),
    s: AcompanhamentoSecoesSchema.optional(),
    e: AcompanhamentoEleitoresSchema.optional(),
  })
  .passthrough();

export const EA15Schema = z
  .object({
    ele: z.string(),
    t: z.string(),
    f: z.string().min(1),
    dg: z.string(),
    hg: z.string(),
    idg: z.string().optional(),
    abr: z.array(EA15AbrItemSchema),
  })
  .passthrough();

export type EA15 = z.infer<typeof EA15Schema>;

// ---------------------------------------------------------------------------
// detectChangedUfs
// ---------------------------------------------------------------------------

export interface UfChangeSignal {
  uf: string;
  changed: boolean;
  /** Hash SHA-256 do item `abr[]` desta UF no EA14 — usado como `previous`
   *  no próximo ciclo. `null` quando o gating falhou (fail-open). */
  hash: string | null;
  /** ETag da resposta EA14 deste ciclo (igual em todos os sinais desta
   *  chamada — o ETag é do arquivo inteiro, não por UF). `null` em 304
   *  (usar o ETag anterior, que não mudou) ou quando o gating falhou. */
  etag: string | null;
}

export interface AcompanhamentoPrevious {
  /** ETag do último fetch bem-sucedido do EA14 (200, não 304). */
  etag: string | null;
  /** Hash por UF calculado no ciclo anterior — chave é a sigla em maiúsculas. */
  hashes: Record<string, string>;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * detectChangedUfs — fetch de 1 EA14 (acompanhamento Brasil) e diff, por UF,
 * contra o estado do ciclo anterior.
 *
 * Fail-open: qualquer exceção (rede, timeout, parse Zod) resulta em TODAS as
 * `ufs` solicitadas retornando `changed: true` — nunca falha o chamador.
 *
 * @param args.cargo       - Obrigatório: cargo do ciclo que faz a leitura. O EA14 é
 *                          um arquivo por ELEIÇÃO, não por cargo, mas a requisição
 *                          é paga no bucket de taxa de um cargo (ADR-0068) — o do
 *                          ciclo que a pede (num ciclo por cargo, o dele; no
 *                          genérico, o de um cargo da eleição lida). Sem cargo a
 *                          leitura cairia num bucket de 5 rps fora do pior caso
 *                          agregado; por isso é erro de compilação esquecê-lo.
 * @param args.codEleicao - Obrigatório: o EA14 é UM POR ELEIÇÃO (federal vs
 *                          estadual). Use `getCodEleicaoDoCargo(cargo)` do ciclo.
 * @param args.ufs         - Siglas de UF (maiúsculas ou minúsculas) para as quais
 *                          o chamador quer saber se algo mudou.
 * @param args.previous    - Estado do ciclo anterior (ETag + hashes por UF).
 *                          `null` no primeiro ciclo — tudo volta `changed: true`.
 * @param args.baseUrl     - Override de host (testes / mock local).
 */
export async function detectChangedUfs(args: {
  cargo: CargoTse;
  codEleicao: string;
  ufs: string[];
  previous: AcompanhamentoPrevious | null;
  baseUrl?: string;
}): Promise<UfChangeSignal[]> {
  const ufsUpper = args.ufs.map((uf) => uf.toUpperCase());
  const failOpen = (): UfChangeSignal[] =>
    ufsUpper.map((uf) => ({ uf, changed: true, hash: null, etag: null }));

  // `codEleicao` é obrigatório desde 2026-09-17: o TSE 2026 publica UM EA14
  // POR ELEIÇÃO (`br-e021270-ab.json` para o pleito federal, `br-e021272-ab`
  // para o estadual). Resolver aqui um código "do ciclo" faria o gating de
  // Governador/Senador/Deputado ler o acompanhamento de Presidente — as UFs
  // "sem mudança" de uma corrida calariam a outra, em silêncio. Quem chama
  // já sabe de qual cargo é o ciclo, e passa o código daquele cargo.
  const codEleicao = args.codEleicao;

  const baseUrl = args.baseUrl ?? getTseBaseUrl();
  const url = buildEA14Url({ codEleicao, baseUrl });

  let res: Response;
  try {
    await getTseRateLimiter(args.cargo).acquire();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      // Reusa a constante de client.ts — nunca duplicar o literal: quando o
      // contato pendente for preenchido (decisão humana antes de 15/09), este
      // caminho tem de acompanhar automaticamente (ADR-0020).
      "User-Agent": USER_AGENT,
    };
    if (args.previous?.etag) {
      headers["If-None-Match"] = args.previous.etag;
    }
    res = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    logWarn("detectChangedUfs: fetch EA14 falhou — fail-open (tudo changed)", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return failOpen();
  }

  // 304: nada mudou nacionalmente — todas as UFs solicitadas ficam "not changed",
  // preservando os hashes do ciclo anterior (se existirem).
  if (res.status === 304) {
    logDebug("detectChangedUfs: EA14 304 — nenhuma UF mudou", { url });
    return ufsUpper.map((uf) => ({
      uf,
      changed: false,
      hash: args.previous?.hashes[uf] ?? null,
      etag: args.previous?.etag ?? null,
    }));
  }

  if (!res.ok) {
    logWarn("detectChangedUfs: EA14 respondeu status inesperado — fail-open (tudo changed)", {
      url,
      status: res.status,
    });
    return failOpen();
  }

  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    logWarn("detectChangedUfs: falha lendo body do EA14 — fail-open (tudo changed)", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return failOpen();
  }

  let parsed: EA14;
  try {
    parsed = EA14Schema.parse(JSON.parse(text));
  } catch (err) {
    logWarn("detectChangedUfs: EA14 malformado (JSON ou Zod) — fail-open (tudo changed)", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return failOpen();
  }

  const byUf = new Map(
    parsed.abr
      .filter((item) => item.tpabr === "uf")
      .map((item) => [item.cdabr.toUpperCase(), item]),
  );

  const responseEtag = res.headers.get("etag");

  const signals: UfChangeSignal[] = [];
  for (const uf of ufsUpper) {
    const item = byUf.get(uf);
    if (!item) {
      // UF solicitada não apareceu no EA14 (eleição não cobre a UF, ou drift
      // de schema) — fail-open individual: melhor buscar de mais do que
      // perder uma atualização real.
      logWarn("detectChangedUfs: UF não encontrada no EA14 — fail-open para esta UF", {
        url,
        uf,
      });
      signals.push({ uf, changed: true, hash: null, etag: responseEtag });
      continue;
    }

    let hash: string;
    try {
      hash = await sha256Hex(JSON.stringify(item));
    } catch (err) {
      logWarn("detectChangedUfs: hash falhou para UF — fail-open para esta UF", {
        uf,
        error: err instanceof Error ? err.message : String(err),
      });
      signals.push({ uf, changed: true, hash: null, etag: responseEtag });
      continue;
    }

    const previousHash = args.previous?.hashes[uf] ?? null;
    signals.push({ uf, changed: previousHash !== hash, hash, etag: responseEtag });
  }

  return signals;
}
