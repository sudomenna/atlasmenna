/**
 * app/(dep)/_rota-lista-deputado.ts — o corpo comum de
 * `GET /uf/<SIGLA>/<slug do cargo>/lista` (spec 026 RF-260, ADR-0065 D3,
 * design 026 § 8.5; generalizado na spec 027).
 *
 * Federal (cargo 6): as candidaturas de rank **61 em diante** de cada
 * agremiação da UF. A página da UF já traz, no primeiro render, os 60
 * primeiros; o resto só é buscado quando o leitor pede "mostrar todos".
 *
 * Estadual e distrital (7 e 8, decisão do dono de 03/10): TUDO o que a página
 * não levou ao documento — ela leva eleitos + 7 por agremiação (emenda 04/10)
 * (`lib/deputado/lista-documento.ts`). Ver {@link responderRestante}.
 *
 * Cada arquivo `lista/route.ts` é uma casca: o Next lê `runtime` e `dynamic`
 * do próprio arquivo de rota, então eles ficam lá; aqui mora o que responde.
 * A leitura passa pelo adaptador `_dados-da-casa.ts`, com o cargo na mão.
 *
 * ## Respostas (design 026 § 8.5)
 *
 *   - 200 — o `DeputadoUfLista` (saneado);
 *   - 404 — sigla fora das UFs da casa, ou objeto de lista inexistente (a UF
 *     não tem rank > 60, ou o ciclo ainda não o gravou, ou o ambiente não tem
 *     Blob);
 *   - 502 — o Blob não respondeu, ou respondeu algo que não é a lista da UF.
 *
 * ## Cache
 *
 *   - sucesso: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`;
 *   - 🔴 **erro nunca é cacheável** (ADR-0065 D3): 404 e 502 saem `no-store`,
 *     para que um soluço não fique 60 s + 300 s no CDN.
 *
 * Por que a rota fica FORA de `/api` (o BotID de `proxy.ts`) e por que é
 * `force-dynamic` e não `revalidate`: ver o cabeçalho de
 * `uf/[sigla]/deputado-federal/lista/route.ts`.
 */

import { NextResponse } from "next/server";

import type { DeputadoUfLista } from "@/lib/blob/deputado-uf";
import type { CargoProporcional } from "@/lib/config/cargos";
import { listaEmDuasFaixas, restanteForaDoDocumento } from "@/lib/deputado/lista-documento";
import { ufTemCasa } from "@/lib/utils/casa-legislativa";

import { lerDetalheDaCasa, lerListaDaCasa } from "./_dados-da-casa";

const CACHE_OK = "public, s-maxage=60, stale-while-revalidate=300";
const CACHE_ERRO = "no-store";

function erro(status: 404 | 502, corpo: Record<string, unknown>): Response {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": CACHE_ERRO } });
}

/** A resposta de `GET /uf/<SIGLA>/<slug do cargo>/lista`, a partir da sigla CRUA dos `params`. */
export async function responderListaDeputado(
  cargo: CargoProporcional,
  siglaBruta: string,
): Promise<Response> {
  const sigla = siglaBruta.toUpperCase();
  // Sigla fora das UFs desta casa ⇒ 404 sem montar caminho de Blob com
  // entrada livre.
  if (!ufTemCasa(cargo, sigla)) return erro(404, { error: "uf_desconhecida", sigla: siglaBruta });

  if (listaEmDuasFaixas(cargo)) return responderRestante(cargo, sigla);

  const lista = await lerListaDaCasa(cargo, sigla);

  if (lista.status === "ok") {
    return NextResponse.json(lista.lista, { headers: { "Cache-Control": CACHE_OK } });
  }
  if (lista.reason === "not_found" || lista.reason === "not_configured") {
    return erro(404, { error: "lista_inexistente", uf: sigla, motivo: lista.reason });
  }
  return erro(502, { error: "blob_indisponivel", uf: sigla, motivo: lista.reason });
}

/**
 * Casas de DUAS faixas (estadual e distrital — decisão do dono de 03/10,
 * `lib/deputado/lista-documento.ts`): a resposta é TUDO o que a página não
 * levou ao documento — as linhas do objeto da UF depois do corte (eleitos + 7,
 * contado SEM a projeção: o piso do corte da página, ver `lista-documento.ts`)
 * e as 61+ do objeto de lista —, por agremiação, por rank. Sem
 * isso, "mostrar todos" pularia do 10º ao 61º.
 *
 *   - 200 — o resto, no envelope `DeputadoUfLista` (o `ts` é o do objeto da UF);
 *   - 404 — objeto da UF inexistente; ou a UF declara lista 61+
 *     (`lista.restantes > 0`) e o objeto de lista não existe — devolver só o
 *     objeto da UF pularia os ranks 61+ em silêncio;
 *   - 502 — qualquer um dos dois não respondeu, ou respondeu algo fora do
 *     contrato.
 *
 * O objeto de lista só é lido quando a UF o declara. Cache como o do federal: sucesso 60 s no CDN, erro `no-store`.
 */
async function responderRestante(cargo: CargoProporcional, sigla: string): Promise<Response> {
  const detalhe = await lerDetalheDaCasa(cargo, sigla);
  if (detalhe.status !== "ok") {
    if (detalhe.reason === "not_found" || detalhe.reason === "not_configured") {
      return erro(404, { error: "lista_inexistente", uf: sigla, motivo: detalhe.reason });
    }
    return erro(502, { error: "blob_indisponivel", uf: sigla, motivo: detalhe.reason });
  }

  // O objeto de lista só é lido quando a UF o declara: o DF (nenhuma
  // agremiação passa de 60) nunca o tem, e um 404 a cada clique seria ruído.
  let lista: DeputadoUfLista | null = null;
  if ((detalhe.detail.lista?.restantes ?? 0) > 0) {
    const lida = await lerListaDaCasa(cargo, sigla);
    if (lida.status !== "ok") {
      if (lida.reason === "not_found" || lida.reason === "not_configured") {
        return erro(404, { error: "lista_inexistente", uf: sigla, motivo: lida.reason });
      }
      return erro(502, { error: "blob_indisponivel", uf: sigla, motivo: lida.reason });
    }
    lista = lida.lista;
  }

  const corpo = restanteForaDoDocumento(detalhe.detail, lista);
  return NextResponse.json(corpo, { headers: { "Cache-Control": CACHE_OK } });
}
