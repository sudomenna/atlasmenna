/**
 * lib/leitura/interruptor.ts
 *
 * Interpreta o valor cru da chave `interruptor-leitura-noite` do Edge Config.
 *
 * Falha FECHADA, campo a campo (mesma regra do `interruptor-projecao-dep`,
 * ADR-0063 D4): só `=== true` liga. Chave ausente, `null`, string, número,
 * `"true"` — tudo desliga. O interruptor existe para ser o freio da noite,
 * quando nenhum código pode ser publicado; um freio que liga por engano não
 * serve.
 */

import { INTERRUPTOR_DESLIGADO, type InterruptorLeitura } from "./types";

/** Slug aceito para trocar o modelo sem deploy: "provedor/modelo". */
export const MODELO_SLUG_PATTERN = /^[a-z0-9-]+\/[a-z0-9.-]+$/;

export function interpretarInterruptorLeitura(raw: unknown): InterruptorLeitura {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...INTERRUPTOR_DESLIGADO };
  }
  const r = raw as Record<string, unknown>;
  const out: InterruptorLeitura = {
    ia: r.ia === true,
    noticias: r.noticias === true,
    historico: r.historico === true,
  };
  if (typeof r.modelo === "string" && MODELO_SLUG_PATTERN.test(r.modelo)) {
    out.modelo = r.modelo;
  }
  if (typeof r.em === "string") out.em = r.em;
  if (typeof r.por === "string") out.por = r.por;
  return out;
}
