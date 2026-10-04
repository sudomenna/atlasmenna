/**
 * lib/leitura/ciclo-producao.ts
 *
 * A ligação REAL das dependências do ciclo da leitura da noite (ADR-0072) —
 * Edge Config, Blob, feeds e AI Gateway. Vive fora de `route.ts` porque um
 * `route.ts` do App Router só pode exportar os métodos HTTP e a configuração
 * de segmento (o `next build` reprova qualquer outro nome).
 *
 * Só o cron `/api/internal/leitura-noite` importa este arquivo; ele puxa
 * `lib/leitura/ia.ts`, o único que importa `ai`. Nenhuma página pode
 * importá-lo.
 *
 * Ensaio (`?ensaio=1`): o payload é a fixture
 * `tests/fixtures/edge-config/projection-current.json`, IA e notícias são
 * forçadas e NADA é gravado (`executarCicloLeitura` garante o "nunca grava";
 * aqui o `gravar` do ensaio ainda lança, como segunda trava).
 */

import { get } from "@vercel/edge-config";

import { blobUrlFor, leituraNoiteBlobPathname } from "@/lib/blob/paths";
import { putJson } from "@/lib/blob/write";
import { currentPresidentialTurno } from "@/lib/config/calendar";
import { interruptorLeituraNoiteKey } from "@/lib/edge-config/keys";
import { readNationalProjection } from "@/lib/edge-config/reader";
import type { EdgePayload } from "@/lib/edge-config/types";
import payloadDeEnsaio from "@/tests/fixtures/edge-config/projection-current.json" with {
  type: "json",
};

import type { DepsCiclo } from "./ciclo";
import { buscarFeeds } from "./feeds";
import { gerarAnaliseIA } from "./ia";
import { interpretarInterruptorLeitura } from "./interruptor";
import {
  INTERRUPTOR_DESLIGADO,
  type InterruptorLeitura,
  type LeituraNoite,
  LeituraNoiteSchema,
} from "./types";

/** Teto da leitura do interruptor (mesmo do `interruptor-projecao-dep`). */
export const TIMEOUT_INTERRUPTOR_LEITURA_MS = 2_000;
/** Teto da leitura do objeto anterior no Blob. */
export const TIMEOUT_ANTERIOR_MS = 5_000;
/** Teto de cada feed. */
export const TIMEOUT_FEED_MS = 6_000;

/** `get` com teto de tempo — molde de `getComTeto` (`lib/edge-config/reader.ts`). */
async function getComTeto(chave: string, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const esgotado = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(
      () => rejeitar(new Error(`leitura de ${chave} sem resposta em ${ms} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([get<unknown>(chave), esgotado]);
  } finally {
    clearTimeout(timer);
  }
}

/** Interruptor lido do Edge Config. Qualquer erro ⇒ tudo desligado. */
export async function lerInterruptorLeitura(): Promise<InterruptorLeitura> {
  try {
    return interpretarInterruptorLeitura(
      await getComTeto(interruptorLeituraNoiteKey(), TIMEOUT_INTERRUPTOR_LEITURA_MS),
    );
  } catch (e) {
    console.warn(
      "[leitura-noite] interruptor ilegível ⇒ desligado:",
      e instanceof Error ? e.message : String(e),
    );
    return { ...INTERRUPTOR_DESLIGADO };
  }
}

/**
 * Leitura anterior do Blob.
 *
 *   - 404, ambiente sem Blob, ou JSON fora do schema ⇒ `null` (recomeça);
 *   - rede, prazo ou outro status ⇒ LANÇA. O ciclo trata a falha como
 *     "não sei o que havia" e não grava — gravar por cima de um histórico
 *     que só não foi lido apagaria a noite inteira.
 */
export async function lerLeituraAnterior(turno: 1 | 2): Promise<LeituraNoite | null> {
  const url = blobUrlFor(leituraNoiteBlobPathname(turno));
  if (!url) return null;
  const res = await fetch(`${url}?v=${Date.now()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_ANTERIOR_MS),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Blob respondeu HTTP ${res.status}`);
  let corpo: unknown;
  try {
    corpo = await res.json();
  } catch {
    console.warn("[leitura-noite] leitura anterior não é JSON ⇒ recomeça");
    return null;
  }
  const r = LeituraNoiteSchema.safeParse(corpo);
  if (!r.success) {
    console.warn("[leitura-noite] leitura anterior fora do schema ⇒ recomeça");
    return null;
  }
  return r.data as LeituraNoite;
}

/** Grava no Blob. Sem credencial, LANÇA (o ciclo reporta `gravou:false`). */
export async function gravarLeitura(leitura: LeituraNoite): Promise<void> {
  const r = await putJson(leituraNoiteBlobPathname(leitura.turno), leitura);
  if (r.status !== "written") {
    throw new Error("Blob sem credencial de escrita (BLOB_READ_WRITE_TOKEN)");
  }
}

/** As dependências reais do ciclo. `ensaio`: fixture, força IA/notícias, não grava. */
export function criarDepsProducao(opts: { ensaio: boolean }): DepsCiclo {
  const turno = currentPresidentialTurno();
  return {
    agora: () => new Date(),
    lerInterruptor: lerInterruptorLeitura,
    lerPayload: opts.ensaio
      ? async () => payloadDeEnsaio as unknown as EdgePayload
      : () => readNationalProjection(),
    lerAnterior: () => lerLeituraAnterior(turno),
    buscarFeeds: () => buscarFeeds(globalThis.fetch, { timeoutMs: TIMEOUT_FEED_MS }),
    gerarAnalise: (args) => gerarAnaliseIA(args),
    gravar: opts.ensaio
      ? async () => {
          throw new Error("ensaio não grava");
        }
      : gravarLeitura,
    ensaio: opts.ensaio,
  };
}
