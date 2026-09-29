/**
 * app/(dep)/uf/[sigla]/deputado-federal/lista/route.ts
 *
 * GET /uf/<SIGLA>/deputado-federal/lista — as candidaturas de Deputado Federal
 * de rank **61 em diante** de cada agremiação da UF (spec 026 RF-260,
 * ADR-0065 D3, design § 8.5).
 *
 * A página da UF já traz, no primeiro render, os 60 primeiros de cada
 * agremiação (20 visíveis, 21–60 recortados por CSS). O resto só é buscado
 * quando o leitor pede "mostrar todos" — e é esta rota que responde. O cliente
 * busca UMA vez por aba e guarda em memória.
 *
 * ## Por que FORA de `/api`
 *
 * `proxy.ts` aplica o BotID a `/api/*` (matcher `/api/:path*`). Um `fetch` de
 * clique a partir da página é o tipo de requisição que o BotID pode barrar com
 * 403 `bot_detected` sem o leitor ter feito nada de errado — e o portão RF-277
 * precisa exercitar o clique com Playwright. Aqui, sob a árvore da própria
 * página, a rota não passa pelo BotID. O dado já é público (o Blob tem URL
 * pública determinística). `tests/unit/api/deputado-lista-route.test.ts` falha
 * se a rota for movida para baixo de `/api`.
 *
 * ## Respostas (design § 8.5)
 *
 *   - 200 — o `DeputadoUfLista` (`deputado/uf-lista/<UF>.json`, saneado);
 *   - 404 — sigla fora das 27, ou objeto de lista inexistente (a UF não tem
 *     rank > 60, ou o ciclo ainda não o gravou, ou o ambiente não tem Blob);
 *   - 502 — o Blob não respondeu, ou respondeu algo que não é a lista da UF.
 *
 * ## Cache
 *
 *   - leitura do Blob com `fetch(..., { next: { revalidate: 60 } })` (Data
 *     Cache do Next, `readDeputadoUfLista`) — o mesmo piso de 60 s do objeto
 *     no CDN;
 *   - sucesso: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`;
 *   - 🔴 **erro nunca é cacheável** (ADR-0065 D3): 404 e 502 saem `no-store`,
 *     para que um soluço não fique 60 s + 300 s no CDN.
 *
 * ⚠️ **`force-dynamic`, e não `export const revalidate = 60`** (que o design
 * § 8.5 escreve). Com `revalidate`, a rota vira ISR, e o Next guarda no cache
 * ISR a resposta de QUALQUER status — o `app-route` monta a entrada com
 * `status: response.status` sem olhar se é erro
 * (`node_modules/next/dist/build/templates/app-route.js`, ~l. 307–331, Next
 * 16.2). Um 502 de um soluço do Blob seria então servido por 60 s a todo
 * leitor — exatamente o que o ADR-0065 D3 proíbe. Dinâmica, a rota deixa o
 * cache para o CDN, que respeita o `no-store` do erro, e os 60 s de frescor
 * continuam garantidos pelo `revalidate` do `fetch` e pelo `s-maxage`.
 *
 * ## Interruptor
 *
 * Não passa por aqui: pelo ADR-0065 D1 a faixa 3 nunca carrega marca nem dado
 * de projeção (candidatura com marca fica no objeto da UF).
 *
 * ## Spec 027 — a casca
 *
 * O corpo (validação da sigla, leitura, respostas e cabeçalhos de cache) mora
 * em `app/(dep)/_rota-lista-deputado.ts`, comum aos três cargos
 * proporcionais. Aqui ficam só `runtime` e `dynamic` — o Next os lê do arquivo
 * de rota — e o cargo, escrito uma vez.
 */

import { responderListaDeputado } from "../../../../_rota-lista-deputado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Contexto {
  params: Promise<{ sigla: string }>;
}

export async function GET(_req: Request, { params }: Contexto): Promise<Response> {
  const { sigla } = await params;
  return responderListaDeputado(6, sigla);
}
