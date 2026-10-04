/**
 * app/api/ingest/route.ts
 *
 * GET|POST /api/ingest — TSE EA20 ingestion handler (todos os cargos ativos).
 *
 * Rota "sem cargo" — preserva o comportamento anterior a 2026-09-11: um ciclo
 * cobre todos os cargos ativos (`getActiveCargos()`/`TSE_CARGOS`). Usada em
 * preview e para disparo manual (docs/operations/runbook.md,
 * docs/testing/tse-simulados.md). O cron real de produção usa
 * `/api/ingest/[cargo]` (ver `app/api/ingest/[cargo]/route.ts`) — um cargo
 * por invocação, porque a Vercel só documenta distinguir dois crons no MESMO
 * horário por SEGMENTO DE ROTA, não por query string (achado (B),
 * lib/tse/ingest-handler.ts).
 *
 * O corpo do handler vive em `lib/tse/ingest-handler.ts` (`runIngestCycle`) —
 * compartilhado entre esta rota e `/api/ingest/[cargo]`.
 *
 * Covers: RF-001, RF-002, RF-003, RF-004, RNF-006, RNF-016, RNF-032.
 * Constituição § 1 (transparência — User-Agent identificável via client.ts).
 * Constituição § 10 (append-only — repository.ts, zero UPDATE/DELETE aqui).
 * ADR-0011 (cadência 60 s do cron; maxDuration 300 s — ver ADR-0035 D3).
 * ADR-0001 (Postgres somente no write path — read path usa Edge Config).
 */

import type { NextRequest, NextResponse } from "next/server";
import { runIngestCycle } from "@/lib/tse/ingest-handler";

export const runtime = "nodejs";

/**
 * maxDuration = 300 s (2026-09-11, ADR-0035 D3).
 *
 * Subiu de 180s: o fan-out de ingestão passou a ser por PAR (município ×
 * zona) — ~6.100 arquivos por cargo, contra ~2.600 quando a unidade era
 * "1 município por zona" (ver lib/tse/targets.ts). O lock anti-overlap
 * (`getLastIngestRun` + marcador `running`, em lib/tse/ingest-handler.ts)
 * usa uma janela de 6 min — deliberadamente ≥ este `maxDuration`, para que
 * o próximo ciclo do MESMO cargo nunca rode em paralelo mesmo que um ciclo
 * estoure o intervalo do cron.
 */
export const maxDuration = 600; // 🔴 04/10 18h: TSE lento, volta de Presidente passou de 300 s e foi cortada

export async function GET(req: NextRequest): Promise<NextResponse> {
  return runIngestCycle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return runIngestCycle(req);
}
