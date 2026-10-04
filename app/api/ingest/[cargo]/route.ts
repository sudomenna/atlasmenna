/**
 * app/api/ingest/[cargo]/route.ts
 *
 * GET|POST /api/ingest/[cargo] — ciclo de ingestão EA20 restrito a UM cargo.
 *
 * Caminho principal do cron de produção (ADR-0035 D3, 2026-09-11). A doc da
 * Vercel (vercel.com/docs/cron-jobs) documenta, com exemplo literal, que dois
 * crons no MESMO horário só se distinguem por SEGMENTO DE ROTA
 * (`/api/sync-slack-team/T0CAQ10TZ` vs `/T4BOE34OP`) — query string em
 * `path` não é mencionada em lugar nenhum, e o header
 * `x-vercel-cron-schedule` só distingue crons de HORÁRIOS diferentes (os
 * cargos 1 e 3 rodam no mesmo minuto). Por isso `vercel.ts` aponta para
 * `/api/ingest/presidente` e `/api/ingest/governador`, não para
 * `/api/ingest?cargo=`.
 *
 * `[cargo]` aceita tanto o código numérico oficial (`1`, `3`) quanto o alias
 * legível usado no cron (`presidente`, `governador`) — segmento inválido
 * retorna 400 com mensagem clara em vez de cair silenciosamente em "todos os
 * cargos".
 *
 * O corpo do handler vive em `lib/tse/ingest-handler.ts` (`runIngestCycle`) —
 * compartilhado com `/api/ingest` (rota sem cargo, preview/manual).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { CARGOS, parseCargoSegment } from "@/lib/config/cargos";
import { runIngestCycle } from "@/lib/tse/ingest-handler";

export const runtime = "nodejs";

/** Ver comentário em app/api/ingest/route.ts sobre por que 300s (ADR-0035 D3). */
export const maxDuration = 600; // 🔴 04/10 18h: TSE lento, volta de Presidente passou de 300 s e foi cortada

interface RouteContext {
  params: Promise<{ cargo: string }>;
}

async function handle(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { cargo: rawCargo } = await context.params;
  const cargo = parseCargoSegment(rawCargo);

  if (cargo === null) {
    return NextResponse.json(
      {
        error: "invalid_cargo",
        detail:
          `Segmento de cargo inválido: "${rawCargo}". ` +
          `Use o código ou o slug: ${CARGOS.map((c) => `"${c.cd}"/"${c.slug}"`).join(", ")}.`,
      },
      { status: 400 },
    );
  }

  return runIngestCycle(req, { cargo });
}

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  return handle(req, context);
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  return handle(req, context);
}
