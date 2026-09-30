/**
 * app/(dep)/uf/[sigla]/deputado-estadual/lista/route.ts
 *
 * GET /uf/<SIGLA>/deputado-estadual/lista — as candidaturas a Deputado
 * Estadual de rank **61 em diante** de cada agremiação da UF (spec 026
 * RF-260, ADR-0065 D3; spec 027 RF-281, design § 7.2). A lista de SP pode
 * chegar a 35 linhas por agremiação (94 lugares, até 95 candidaturas).
 *
 * Casca: o corpo (validação da sigla nas 26 UFs com Assembleia, leitura do
 * Blob `deputado-estadual/uf-lista/<UF>.json`, respostas e cabeçalhos de
 * cache — erro nunca cacheável) mora em `app/(dep)/_rota-lista-deputado.ts`,
 * comum às casas. O DF responde 404: não tem Assembleia, e a Câmara
 * Legislativa não tem rota de lista.
 *
 * Por que FORA de `/api` (BotID) e por que `force-dynamic` e não
 * `revalidate`: ver o cabeçalho de `uf/[sigla]/deputado-federal/lista/route.ts`.
 */

import { responderListaDeputado } from "../../../../_rota-lista-deputado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Contexto {
  params: Promise<{ sigla: string }>;
}

export async function GET(_req: Request, { params }: Contexto): Promise<Response> {
  const { sigla } = await params;
  return responderListaDeputado(7, sigla);
}
