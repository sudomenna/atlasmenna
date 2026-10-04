/**
 * app/api/internal/leitura-noite/route.ts
 *
 * GET|POST /api/internal/leitura-noite — o cron da "leitura da noite" da home
 * presidencial (ADR-0072): histórico do Boletim, manchetes de feeds e análise
 * por IA, gravados no Blob em `leitura/pres/t<turno>.json`.
 *
 * Disparado pelo Vercel Cron a cada minuto na janela da apuração (`vercel.ts`).
 * Tudo nasce DESLIGADO: o que liga cada parte é a chave
 * `interruptor-leitura-noite` do Edge Config (`pnpm leitura:interruptor`), sem
 * deploy. O histórico é calculado e gravado mesmo desligado.
 *
 * Autenticação — mesmo contrato de `lib/tse/ingest-handler.ts`:
 * `Authorization: Bearer <CRON_SECRET>` (Vercel Cron) ou `x-cron-secret`
 * (manual). Sem `CRON_SECRET` no ambiente ⇒ 500; segredo errado ⇒ 401. A
 * comparação é em tempo constante (hash SHA-256 dos dois lados +
 * `timingSafeEqual`, que exige buffers do mesmo tamanho).
 *
 * `?ensaio=1` — payload da fixture, IA e notícias forçadas, NADA gravado;
 * devolve o `ResultadoCiclo` com a `leitura` montada.
 *
 * ⚠️ Só os métodos HTTP e a configuração de segmento podem ser exportados
 * daqui — o `next build` reprova qualquer outro nome. A ligação das
 * dependências vive em `lib/leitura/ciclo-producao.ts`.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { executarCicloLeitura } from "@/lib/leitura/ciclo";
import { criarDepsProducao } from "@/lib/leitura/ciclo-producao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** IA tem teto de 20 s e só é chamada antes dos 25 s do ciclo; sobra folga. */
export const maxDuration = 60;

function segredoInformado(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const match = /^bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match?.[1]) return match[1];
  }
  return req.headers.get("x-cron-secret");
}

function iguaisEmTempoConstante(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

async function tratar(req: NextRequest): Promise<NextResponse> {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) {
    console.error("[leitura-noite] CRON_SECRET não configurada — abortando");
    return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  }
  const informado = segredoInformado(req);
  if (informado === null || !iguaisEmTempoConstante(informado, esperado)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ensaio = req.nextUrl.searchParams.get("ensaio") === "1";
  const t0 = Date.now();
  const resultado = await executarCicloLeitura(criarDepsProducao({ ensaio }));

  // Uma linha por ciclo, sem o texto das manchetes.
  const resumo = {
    ensaio,
    ms: Date.now() - t0,
    gravou: resultado.gravou,
    eventosNovos: resultado.eventosNovos,
    noticias: resultado.noticias,
    ia: {
      tentou: resultado.ia.tentou,
      ok: resultado.ia.ok,
      erro: resultado.ia.erro,
      frases: resultado.ia.frases?.length,
    },
    motivo: resultado.motivo,
  };
  console.log("[leitura-noite]", JSON.stringify(resumo));

  return NextResponse.json(resultado, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return tratar(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return tratar(req);
}
