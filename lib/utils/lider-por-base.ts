/**
 * lib/utils/lider-por-base.ts
 *
 * Ponto ÚNICO da derivação de "quem é o líder desta UF, na base ATIVA" —
 * pedido do dono, 2026-09-20: "se no parcial o líder for Flávio, pinta PL; se
 * a projeção der Lula, pinta a cor do Lula". Usado por `resolveColor` e
 * `buildHoverRows` (`_NationalChoroplethMapImpl.tsx`, o coroplético nacional)
 * e por `<HexCartogramBrasil>` (o cartograma hexagonal — sem uso em
 * `/governador` desde o ADR-0048, mas mantido correto por decisão do dono).
 *
 * ===========================================================================
 * 🔴 O achado que faz este arquivo existir: `EdgeUfRow.lider` NÃO é o líder
 * apurado, apesar do nome do campo e da docstring do tipo ("líder no
 * momento", `lib/edge-config/types.ts:472`).
 * ===========================================================================
 *
 * `api/model/project.py` constrói `por_uf[]` assim (linhas 5033–5266, medido
 * 2026-09-20):
 *
 *   ordered = sorted(rows, key=lambda r: float(r.get("pct_projetado") or 0.0), reverse=True)
 *   top = ordered[0]
 *   ...
 *   "lider": int(top["candidato_id"]),          # linha 5266
 *   ...
 *   top_candidatos = [... for r in ordered[:TOP_CANDIDATOS_POR_UF] ...]  # linha 5081
 *
 * `row.lider` e `row.top_candidatos[0].id` vêm do MESMO `ordered[0]` — são
 * SEMPRE o mesmo candidato, e esse candidato é escolhido por `pct_projetado`
 * desc, nunca por `pct_atual`. `margem_atual`/`margem_projetada` sofrem do
 * mesmo desvio: as duas chaves recebem o MESMO `margem` (linhas 5267–5268),
 * calculado sobre `pct_projetado`. É documentado como "v1, heurística
 * simples" no docstring de `compute_national` (~linha 4749: "lider =
 * candidato_id com maior pct_projetado na UF") — nunca foi substituído.
 *
 * Consequência prática: `_NationalChoroplethMapImpl.tsx::resolveColor` tinha
 * `const liderId = parcial ? row.lider : (row.top_candidatos?.[0]?.id ?? row.lider)`
 * — os dois ramos do ternário avaliam para o MESMO id em 100% dos casos. Ou
 * seja, a cor do coroplético nunca de fato mudava de partido ao alternar
 * Parcial/Projeção (fora do caso `pct_apurado === 0`, que já cai num
 * `return` anterior). Nenhum teste da suíte cobria essa combinação — só
 * `NationalChoroplethMap.preEleicao.test.tsx` passa `viewMode`, e é para
 * RF-157 (fase pré), não para esta distinção.
 *
 * Este módulo substitui `row.lider` por uma derivação HONESTA da base
 * "parcial": reordena `top_candidatos` pelo MESMO comparador que
 * `rankByParcial` já usa em `<ResultPanel>` e nas 3 rotas de UF
 * (`lib/utils/rank-parcial.ts`) — ponto único, nenhum comparador novo.
 *
 * ⚠️ **Limitação herdada do payload, não desta função**: `top_candidatos` é um
 * corte TOP-N POR PROJEÇÃO (`TOP_CANDIDATOS_POR_UF`, hoje 4). Se o verdadeiro
 * líder apurado estiver FORA desse corte (um candidato que a projeção não via
 * entre os 4 primeiros, mas que lidera os boletins chegados até agora), esta
 * função não tem como enxergá-lo — ele está agregado dentro de `row.outros`,
 * sem `id` individual. Corrigir isso exigiria um campo novo no produtor
 * (Python) e está fora do escopo desta correção, que é só a ORDEM de leitura
 * de um shape já existente. Reportado para o orquestrador avaliar se merece
 * uma tarefa própria (provável candidato a `model-validator`).
 */

import type { EdgeUfRow } from "@/lib/edge-config/types";
import type { ViewMode } from "@/lib/state/view-mode";
import { anuladasAoFim, compete, queCompetem } from "@/lib/utils/destino-voto";
import { rankByParcial, rankByProjecao } from "@/lib/utils/rank-parcial";

/** Uma entrada de `EdgeUfRow.top_candidatos` — por índice, para não duplicar o shape. */
export type TopCandidatoUf = EdgeUfRow["top_candidatos"][number];

export interface OrdemTopCandidatosPorBase {
  /**
   * `top_candidatos`, reordenado pela base efetivamente usada (ver
   * `usouParcial`), com as candidaturas de voto `"anulado"` no FIM
   * (ADR-0053 / RF-213). É a ordem de EXIBIÇÃO — quem precisa de "quem
   * lidera" lê {@link liderIdPorBase}, que nunca devolve uma anulada.
   */
  ordenados: readonly TopCandidatoUf[];
  /**
   * `true` quando a base pedida era "parcial" E havia leitura honesta para
   * ordenar por ela (todo candidato do corte tinha `pct_atual`). `false` em
   * QUALQUER outro caso — inclusive quando `viewMode === "parcial"` mas os
   * dados não permitem, e `ordenados` cai na ordem de PROJEÇÃO.
   *
   * **Por que não tratar `pct_atual` ausente como `0`**: um candidato sem
   * `pct_atual` não "tem zero votos apurados" — não foi medido (decisão do
   * dono, 14/09: "não começou" / "não sabemos" / "apurando" são três estados,
   * nenhum se escreve como zero). Coeri-lo para `0` daria a esse candidato a
   * ÚLTIMA posição entre os medidos, uma afirmação que os dados não sustentam.
   * A alternativa honesta, quando falta ALGUM `pct_atual` no corte, é não
   * fingir que há uma ordem parcial e usar a de projeção — a mesma que o mapa
   * já mostrava antes desta correção.
   */
  usouParcial: boolean;
}

/**
 * `top_candidatos` tem leitura parcial utilizável quando TODO candidato do
 * corte tem `pct_atual` definido. Na prática é tudo-ou-nada por UF — é
 * `impute_uf_from_national` (cargo 1, UF sem nenhuma zona apurada) que omite
 * o campo para TODOS de uma vez (`lib/edge-config/types.ts:571-577`) — mas o
 * `.every()` é a condição estruturalmente correta mesmo que isso mude, e é o
 * que discrimina a mutação de trocar por "olhar só o primeiro".
 */
function temLeituraParcialCompleta(top: readonly TopCandidatoUf[]): boolean {
  return top.length > 0 && top.every((tc) => tc.pct_atual !== undefined);
}

/**
 * Reordena `top_candidatos` pela base ativa, reaproveitando `rankByParcial` /
 * `rankByProjecao` (`lib/utils/rank-parcial.ts`) — o mesmo comparador que
 * `<ResultPanel>` e as 3 rotas de UF já usam, e que o produtor Python porta
 * (`ordenar_por_parcial`, `api/model/project.py`). Nenhum comparador novo
 * nasce aqui.
 *
 * `pct_atual: tc.pct_atual ?? 0` no objeto passado ao comparador é seguro
 * mesmo sendo "o zero proibido" à primeira vista: só é LIDO por
 * `rankByParcial`, e `rankByParcial` só é CHAMADO quando `usouParcial` já
 * confirmou que todo elemento tem `pct_atual` de verdade — o `?? 0` nunca
 * dispara nesse caminho. No caminho `rankByProjecao`, o campo existe só para
 * satisfazer o shape de `RankavelPorBase`; o comparador de projeção não o lê.
 */
export function ordenarTopCandidatosPorBase(
  top: readonly TopCandidatoUf[],
  viewMode: ViewMode,
): OrdemTopCandidatosPorBase {
  const usouParcial = viewMode === "parcial" && temLeituraParcialCompleta(top);
  const porId = new Map(top.map((tc) => [tc.id, tc] as const));
  const ranking = top.map((tc) => ({
    id: tc.id,
    pct_atual: tc.pct_atual ?? 0,
    pct_projetado: tc.pct,
    destino: tc.destino,
  }));
  // ADR-0053 / RF-213 — anulada no fim, DEPOIS do comparador (mesma razão de
  // `ordensPorBase`: os comparadores são portados critério a critério no
  // produtor Python e não ganham critério novo).
  const ordenadosIds = anuladasAoFim(
    usouParcial ? rankByParcial(ranking) : rankByProjecao(ranking),
  ).map((r) => r.id);
  return {
    ordenados: ordenadosIds.map((id) => {
      const tc = porId.get(id);
      // `id` vem do próprio `ranking`, construído a partir de `top` — sempre
      // presente em `porId`. O `as` documenta a garantia, não a contorna.
      return tc as TopCandidatoUf;
    }),
    usouParcial,
  };
}

/**
 * O candidato que a base ATIVA aponta como líder desta UF.
 *
 * A cabeça de `ordenarTopCandidatosPorBase` — em QUALQUER viewMode, nunca o
 * atalho `top_candidatos[0]` cru. Em `"proj"` isto dá o MESMO resultado que o
 * atalho daria em produção (o payload já chega ordenado por `pct_projetado`
 * desc — ver o cabeçalho do arquivo), mas sem depender dessa invariante do
 * produtor se manter verdadeira: `rankByProjecao` reordena de verdade, então
 * um `top_candidatos` fora de ordem (fixture de teste, payload malformado)
 * não vaza um líder errado — a mesma razão pela qual `buildHoverRows`
 * (`_NationalChoroplethMapImpl.tsx`) também parou de confiar na ordem de
 * chegada.
 *
 * `row.lider` só entra quando `top_candidatos` está VAZIO (payload legado, ou
 * fixture de teste que não o preenche — `HexCartogramBrasil.test.tsx` é um
 * caso real) — nesse caso `ordenados` também vem vazio, nas duas bases.
 *
 * Quem chama e precisa saber SE a leitura parcial era honesta (para, por
 * exemplo, pintar "sem apuração" em vez de aplicar uma cor) já tem esse sinal
 * mais cedo: `row.pct_apurado === 0` é a mesma condição, e é dela que
 * `temLeituraParcialCompleta` deriva a ausência de `pct_atual` (ver o
 * cabeçalho do arquivo).
 */
/**
 * A margem (1º − 2º, em pontos percentuais) da UF **na base ativa**.
 *
 * ===========================================================================
 * 🔴 O segundo achado de 2026-09-20: `margem_atual` também não é "atual".
 * ===========================================================================
 *
 * `api/model/project.py` grava as DUAS chaves com a MESMA variável:
 *
 *   margem = top_pct - second_pct          # ambos são `pct_projetado`
 *   ...
 *   "margem_atual": float(margem),         # linha 5267
 *   "margem_projetada": float(margem),     # linha 5268
 *
 * Ou seja, `row.margem_atual === row.margem_projetada` em 100% dos payloads, e
 * as duas descrevem a PROJEÇÃO. É o mesmo desvio de `row.lider` (cabeçalho
 * deste arquivo), na outra metade da view "margin" do mapa: enquanto a cor
 * (matiz) nunca trocava de partido, a INTENSIDADE nunca trocava de número.
 * `resolveColor` lia `parcial ? row.margem_atual : row.margem_projetada` — um
 * ternário cujos dois braços dão o mesmo valor.
 *
 * Esta função deriva a margem parcial HONESTA dos mesmos `pct_atual` por
 * candidato que {@link ordenarTopCandidatosPorBase} usa para a ordem — o único
 * dado apurado por-candidato que o payload publica. Quando não há leitura
 * parcial completa, devolve a projetada, que é o que o mapa já mostrava.
 *
 * ⚠️ Herda a limitação do corte TOP-N documentada no cabeçalho: se o 2º
 * colocado no APURADO estiver fora de `top_candidatos`, a margem sai maior do
 * que a real. Mesma origem, mesma correção (campo novo no produtor), mesmo
 * fora de escopo.
 *
 * ⚠️ **Senado não passa por aqui.** Com 2 vagas a margem que decide é a do 2º
 * para o 3º (`margemSegundaVaga`, RF-104), e ela só existe sobre
 * `pct_projetado` — `top_candidatos[].pct` é sempre projeção. O chamador
 * mantém aquele caminho separado.
 */
export function margemPorBase(
  row: Pick<EdgeUfRow, "margem_projetada" | "top_candidatos">,
  viewMode: ViewMode,
): number {
  const { ordenados, usouParcial } = ordenarTopCandidatosPorBase(row.top_candidatos, viewMode);
  if (!usouParcial) return row.margem_projetada;
  // ADR-0053 / RF-213 — a margem é entre quem DISPUTA. Uma anulada no 1º
  // lugar do apurado não abre vantagem sobre ninguém. `margem_projetada` (o
  // outro braço) já chega assim do produtor.
  const disputam = queCompetem(ordenados);
  const primeiro = disputam[0]?.pct_atual;
  const segundo = disputam[1]?.pct_atual;
  // Um candidato só no corte: não há 2º para subtrair. `margem_projetada` é a
  // resposta conservadora — inventar "100 − 0" declararia uma vantagem que o
  // apurado não mediu.
  if (primeiro === undefined || segundo === undefined) return row.margem_projetada;
  return primeiro - segundo;
}

export function liderIdPorBase(
  row: Pick<EdgeUfRow, "lider" | "top_candidatos">,
  viewMode: ViewMode,
): number {
  const { ordenados } = ordenarTopCandidatosPorBase(row.top_candidatos, viewMode);
  // ADR-0053 / RF-213 — o 1º QUE COMPETE, nunca `ordenados[0]` cru: se todas
  // as linhas do corte estiverem anuladas (ou o corte vier vazio), o líder é
  // o do modelo, que já exclui a anulada.
  return ordenados.find(compete)?.id ?? row.lider;
}
