/**
 * app/api/ingest/[cargo]/[fatia]/route.ts
 *
 * GET|POST /api/ingest/[cargo]/[fatia] — ciclo de ingestão EA20 restrito a
 * UM cargo E a UMA fatia do seu fan-out (ADR-0026, emenda 2026-09-13).
 *
 * Por que fatia existe: o cargo 6 (Deputado Federal) saiu de granularidade
 * "uf" (27 alvos, ~5 s) para "zona" (~6.110 alvos) em 2026-09-13 — mesmo
 * diagnóstico de bootstrap que moveu o Senador em 11/09 (um arquivo por UF só
 * dá ao estimador uma unidade de reamostragem, e o IC95 degenera). A
 * `rpsMax` do cargo permanece 5 (`lib/config/cargos.ts`) — não reabre a
 * calibragem do pior caso agregado de 80 rps — então varrer os ~6.110 alvos
 * numa invocação só levaria ~1.222 s, muito acima do `maxDuration` de 300 s.
 *
 * A solução é dividir a varredura em `TOTAL_FATIAS` invocações independentes,
 * cada uma cobrindo ~1/6 do fan-out (~1.019 alvos, ~204 s) — `vercel.ts`
 * dispara uma fatia a cada 5 min, e a volta completa (todas as 6) leva 30
 * min. `[fatia]` é o segmento que identifica QUAL sexto esta invocação cobre
 * — query string não é suportada pela Vercel para distinguir crons no mesmo
 * horário (achado (B), ADR-0026 nota 2026-09-11, ADR-0035 D3), daí o segmento
 * de rota em vez de `/api/ingest/deputado-federal?fatia=1`.
 *
 * O corte determinístico dos alvos em fatias vive em
 * `lib/tse/targets.ts::sliceTargets` — a fatia N de agora é a fatia N de
 * daqui a 30 min, independentemente da ordem em que o Postgres devolveu as
 * linhas de `zonas`. Fatiar só tem efeito quando a granularidade EFETIVA do
 * cargo é "zona" — se o interruptor de emergência `TSE_DEPUTADO_GRANULARIDADE`
 * reverter o cargo 6 a "uf", esta rota devolve o agregado completo de 27
 * alvos em toda fatia, sem erro (ver `listIngestTargets`).
 *
 * A rota SEM fatia (`app/api/ingest/[cargo]/route.ts`) continua existindo e
 * continua servindo cargos não fatiados (Presidente, Governador, Senador) —
 * e, se chamada para o cargo 6 sem segmento de fatia, continua devolvendo o
 * fan-out INTEIRO do cargo (comportamento inalterado, útil pra diagnóstico
 * manual/mock local), mesmo sabendo que uma invocação real contra o CDN do
 * TSE nesse modo estouraria o `maxDuration`.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { CARGOS, parseCargoSegment } from "@/lib/config/cargos";
import { runIngestCycle } from "@/lib/tse/ingest-handler";

export const runtime = "nodejs";

/** Ver comentário em app/api/ingest/route.ts sobre por que 300s (ADR-0035 D3). */
export const maxDuration = 600; // 🔴 04/10 18h: TSE lento, volta de Presidente passou de 300 s e foi cortada

/**
 * Total de fatias em que o fan-out fatiável é dividido. Hoje só o cargo 6
 * (Deputado Federal) usa fatia — ver docstring do módulo para o porquê de 6.
 */
const TOTAL_FATIAS = 6;

/**
 * Cargos que esta rota aceita. Deliberadamente uma ALLOWLIST, não "qualquer
 * cargo em zona": `sliceTargets` funcionaria para Presidente/Governador/
 * Senador também (todos em "zona"), mas nenhum deles tem cron apontando pra
 * cá — aceitar qualquer um deixaria uma chamada manual/mock com o cargo
 * errado (ex.: copiar a URL de Deputado e trocar só o slug) silenciosamente
 * varrer 1/6 do Presidencial em vez de 400. Se um dia outro cargo pesado
 * precisar de fatia, ele entra aqui explicitamente.
 */
const CARGOS_FATIAVEIS: ReadonlySet<number> = new Set([6]);

interface RouteContext {
  params: Promise<{ cargo: string; fatia: string }>;
}

/**
 * parseFatiaSegment — resolve o segmento `[fatia]` para um índice 1-based
 * válido (`1..TOTAL_FATIAS`), ou `null` para qualquer outra coisa.
 *
 * Devolve `null` em vez de arredondar/clampar para um valor "próximo" —
 * uma fatia fora de faixa caindo silenciosamente em, digamos, "fatia 1"
 * varreria sempre o mesmo sexto do país. É o mesmo cuidado de
 * `parseCargoSegment`: segmento inválido é 400 explícito, nunca um default
 * silencioso.
 */
function parseFatiaSegment(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > TOTAL_FATIAS) return null;
  return n;
}

async function handle(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { cargo: rawCargo, fatia: rawFatia } = await context.params;
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

  if (!CARGOS_FATIAVEIS.has(cargo)) {
    return NextResponse.json(
      {
        error: "cargo_nao_fatiavel",
        detail: `Cargo "${rawCargo}" não usa fatia — use /api/ingest/${rawCargo} (sem segmento de fatia).`,
      },
      { status: 400 },
    );
  }

  const fatia = parseFatiaSegment(rawFatia);

  if (fatia === null) {
    return NextResponse.json(
      {
        error: "invalid_fatia",
        detail:
          `Segmento de fatia inválido: "${rawFatia}". ` +
          `Use um inteiro entre 1 e ${TOTAL_FATIAS}.`,
      },
      { status: 400 },
    );
  }

  return runIngestCycle(req, { cargo, fatia: { indice: fatia, total: TOTAL_FATIAS } });
}

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  return handle(req, context);
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  return handle(req, context);
}
