// proxy.ts — Routing Middleware (Vercel) / Next.js Proxy aplicado a /api/*.
//
// Renomeado de `middleware.ts` em S04/F0.5 (Next 16 deprecation):
// arquivo `middleware.ts` → `proxy.ts`, função `middleware` → `proxy`.
// Comportamento e matcher idênticos.
//
// Propósito: bot detection via Vercel BotID (ADR-0009 + RNF-018). Rate limit
// complementar (RNF-017) por IP fica para chore futura.
//
// Pacote canônico é `botid` (sem scope @vercel — confirmado no registry).
// Cross-refs:
//   - ADR-0009: docs/architecture/adrs/0009-botid-vercel.md
//   - NFR segurança: docs/nfr/security.md (RNF-017, RNF-018)

import { checkBotId } from "botid/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Comparação de segredo em tempo constante — evita que a latência da resposta
 * revele quantos caracteres do segredo estavam certos.
 */
function segredoConfere(fornecido: string | null, esperado: string | undefined): boolean {
  if (!fornecido || !esperado || fornecido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < fornecido.length; i++) {
    diff |= fornecido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Extrai o segredo apresentado, nos três formatos que as rotas autenticadas
 * aceitam: `Authorization: Bearer <s>` (caminho do Vercel Cron),
 * `x-cron-secret` (caminho manual do runbook) e `x-model-secret` (chamada do
 * modelo Python para `/api/internal/edge-write`).
 */
function segredoApresentado(req: NextRequest): { cron: string | null; model: string | null } {
  const auth = req.headers.get("authorization");
  const bearer = auth ? (/^bearer\s+(.+)$/i.exec(auth.trim())?.[1] ?? null) : null;
  return {
    cron: bearer ?? req.headers.get("x-cron-secret"),
    model: req.headers.get("x-model-secret"),
  };
}

/**
 * Rotas de máquina: já autenticadas por segredo compartilhado, e chamadas por
 * clientes que NÃO são navegadores (Vercel Cron, o runtime Python do modelo, o
 * curl do runbook). Nenhum deles executa o script de cliente do BotID, então
 * todos são classificados como bot — e um 403 aqui derrubaria a ingestão no
 * dia da apuração, em silêncio do ponto de vista do agendador.
 */
const ROTAS_DE_MAQUINA = ["/api/ingest", "/api/internal", "/api/model"];

/**
 * Casa o prefixo como SEGMENTO de rota, não como pedaço de texto: `/api/ingest`
 * cobre `/api/ingest` e `/api/ingest/presidente`, mas **não**
 * `/api/ingestao-publica` — uma rota pública futura cujo nome começasse igual
 * herdaria o portão sem ninguém perceber.
 */
function ehRotaDeMaquina(caminho: string): boolean {
  return ROTAS_DE_MAQUINA.some((p) => caminho === p || caminho.startsWith(`${p}/`));
}

/**
 * 🔴 04/10/2026, dia do 1º turno — rotas PÚBLICAS de leitura, liberadas do
 * BotID no GET/HEAD. O site nunca ligou o script de cliente do BotID
 * (`initBotId`), então TODO navegador era classificado como bot: o mapa da
 * moldura (`PersistentMapFrame`, que busca `/api/projection*` no cliente) ficava
 * no esqueleto cinza para todo leitor — o log da Vercel registrava "Possible
 * misconfiguration of Vercel BotId" a cada pedido. O que essas rotas servem é o
 * mesmo dado público que as páginas já mostram, com cache de CDN
 * (`s-maxage=30`); o BotID segue valendo para qualquer outro método e rota.
 */
const ROTAS_PUBLICAS_DE_LEITURA = ["/api/projection"];

function ehLeituraPublica(req: NextRequest, caminho: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  return ROTAS_PUBLICAS_DE_LEITURA.some((p) => caminho === p || caminho.startsWith(`${p}/`));
}

export async function proxy(req: NextRequest) {
  // Portão de autenticação ANTES do BotID: um segredo válido É a autorização.
  // O BotID existe para proteger endpoint público sem autenticação (RNF-018);
  // aplicá-lo depois de um segredo correto não acrescenta proteção e cria um
  // modo de falha novo. Segredo errado ou ausente continua caindo no BotID e,
  // depois dele, na checagem da própria rota — nada aqui autoriza ninguém.
  const caminho = req.nextUrl.pathname;
  if (ehRotaDeMaquina(caminho)) {
    const { cron, model } = segredoApresentado(req);
    if (
      segredoConfere(cron, process.env.CRON_SECRET) ||
      segredoConfere(model, process.env.MODEL_SECRET)
    ) {
      return NextResponse.next();
    }
  }

  if (ehLeituraPublica(req, caminho)) return NextResponse.next();

  const verdict = await checkBotId();
  if (verdict.isBot && !verdict.isVerifiedBot) {
    return new NextResponse(
      JSON.stringify({
        error: "bot_detected",
        message: "Acesso automatizado bloqueado. Veja /sobre-o-modelo para uso responsável.",
      }),
      {
        status: 403,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  }

  return NextResponse.next();
}

// Matcher restrito a /api/* — páginas públicas não passam pelo BotID
// para evitar falsos positivos em crawlers legítimos (Google, social cards).
export const config = {
  matcher: ["/api/:path*"],
};
