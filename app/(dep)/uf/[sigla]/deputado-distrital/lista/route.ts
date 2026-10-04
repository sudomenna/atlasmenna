/**
 * app/(dep)/uf/[sigla]/deputado-distrital/lista/route.ts
 *
 * GET /uf/DF/deputado-distrital/lista — as candidaturas a Deputado Distrital
 * que a página da Câmara Legislativa NÃO levou ao documento (spec 027,
 * decisão do dono de 03/10).
 *
 * Até 03/10 o distrital não tinha rota de lista: nenhuma agremiação do DF
 * passa de 60 candidaturas, e a página levava as 25 de cada uma ao documento
 * (446 KiB, contra o teto global de 300). Com o corte das assembleias —
 * eleitos + 7 por agremiação desde 04/10 (até 03/10, eleitos + 5, mínimo 10)
 * (`lib/deputado/lista-documento.ts`) —, o resto passa a vir por aqui, no
 * clique em "mostrar todos".
 *
 * Casca: o corpo (validação da sigla — só o DF tem Câmara Legislativa; outra
 * UF é 404 sem tocar o Blob —, leitura, respostas e cache) mora em
 * `app/(dep)/_rota-lista-deputado.ts`, comum às casas.
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
  return responderListaDeputado(8, sigla);
}
