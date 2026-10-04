/**
 * lib/deputado/lista-documento.ts — spec 027: o que a lista de candidatos de
 * uma agremiação leva ao DOCUMENTO nas assembleias (cargos 7 e 8), e o que
 * fica para a rota `GET /uf/<UF>/<slug>/lista`.
 *
 * ## A regra — "eleitos + 7" (emenda 04/10, decisão do dono)
 *
 * Por agremiação, o documento traz o conjunto VISÍVEL POR PADRÃO, o mesmo do
 * federal e do voto projetado: rank ≤ maior rank eleito + 7
 * (`ultimoRankVisivel` em `lib/utils/deputado-marcas.ts`, onde mora a regra e
 * o porquê de contar a partir do MAIOR rank eleito, e posições em vez de
 * linhas válidas). Agremiação sem eleito: as 7 primeiras; com menos
 * candidaturas que isso: todas. Nada oculto no DOM: o resto
 * só chega quando o leitor aciona "mostrar todos".
 *
 * Até 03/10 eram "eleitos + 5, mínimo 10". O mínimo de 10 caiu: com a regra
 * única, agremiação sem eleito mostra 7 em toda tela de deputado, e o 10
 * existia só para que as menores não parecessem vazias ao lado das 20 do
 * federal — que também deixaram de existir.
 *
 * O motivo de cortar no documento (e não recolher por CSS como o federal) é
 * peso, medido pela frente S em 03/10 com o servidor falso: as três faixas da
 * spec 026 levavam `/uf/SP/deputado-estadual` a 724 KiB de documento.
 *
 * O federal (cargo 6) NÃO usa este módulo: leva 1–60 ao documento e recolhe
 * por CSS o que está fora do conjunto visível (`DeputadoListaAgremiacao`).
 *
 * ## Quem conta como eleito
 *
 * Quem tem marca de eleito NA TELA (`marcasDaLinha`): na parcial; na projeção,
 * só com a projeção visível; com a totalização final, só "Eleito (TSE)".
 *
 * ## Página e rota: a rota usa o R SEM projeção
 *
 * A página sabe se a projeção está visível (estado + interruptor); a rota não
 * lê o interruptor. Por isso a rota corta no R calculado SEM projeção — que
 * nunca é maior que o da página (`ultimoRankVisivel` é monótona). Com a
 * projeção visível, a rota devolve algumas linhas que a página já tem; o
 * cliente une por `sqcand` e a linha da página vence (`unirPorSqcand`). Nunca
 * há buraco — o oposto (rota com R maior) pularia candidatos em silêncio.
 *
 * ## Uma extensão, para que a linha de corte tenha os dois nomes
 *
 * Fora da totalização final, R cobre também o `corte.primeiro_fora` (RF-272).
 * Na prática ele vem logo depois do último eleito na parcial e já está no
 * conjunto; só fica de fora com 7+ linhas com `destino` no meio. Rede para o
 * caso raro, não a regra. Vale igual na página e na
 * rota (não depende da projeção).
 */

import type { DeputadoUfDetail, DeputadoUfLinha, DeputadoUfLista } from "@/lib/blob/deputado-uf";
import type { CargoProporcional } from "@/lib/config/cargos";
import { type ContextoMarcas, ultimoRankVisivelDasLinhas } from "@/lib/utils/deputado-marcas";

/**
 * As casas cuja lista vai ao documento em DUAS faixas (documento + rota). O
 * federal fica no documento 1–60, recolhido por CSS fora do conjunto visível.
 */
export function listaEmDuasFaixas(cargo: CargoProporcional): boolean {
  return cargo === 7 || cargo === 8;
}

/** O que {@link ultimoRankNoDocumento} lê de uma linha. */
type LinhaParaCorte = Pick<
  DeputadoUfLinha,
  | "sqcand"
  | "rank"
  | "parcial"
  | "indefinido"
  | "projecao"
  | "projecao_apertada"
  | "tse"
  | "destino"
>;

/** O que {@link ultimoRankNoDocumento} lê de uma agremiação. */
export interface AgremiacaoParaCorte {
  candidatos?: readonly LinhaParaCorte[];
  corte?: { primeiro_fora: number };
}

/**
 * O maior rank que vai ao documento nesta agremiação (R). O documento leva as
 * linhas de rank ≤ R do objeto da UF; a rota devolve as de rank > R.
 *
 * Pode passar do total de candidaturas (agremiação de 5 sem eleito): cortar
 * por "rank ≤ R" leva todas, que é a regra.
 *
 * `ctx.projecaoVisivel` é o da PÁGINA; a rota passa `false` (ver o cabeçalho).
 */
export function ultimoRankNoDocumento(agr: AgremiacaoParaCorte, ctx: ContextoMarcas): number {
  const linhas = agr.candidatos ?? [];
  let r = ultimoRankVisivelDasLinhas(linhas, ctx);
  // Extensão: o primeiro de fora da linha de corte (RF-272) sempre no documento.
  if (!ctx.totalizacaoFinal && agr.corte) {
    const primeiroFora = linhas.find((l) => l.sqcand === agr.corte?.primeiro_fora);
    if (primeiroFora && primeiroFora.rank > r) r = primeiroFora.rank;
  }
  return r;
}

/** As linhas que vão ao documento: rank ≤ R, na ordem em que vieram. Não muta. */
export function linhasNoDocumento<T extends { rank: number }>(
  linhas: readonly T[],
  ultimoRank: number,
): T[] {
  return linhas.filter((l) => l.rank <= ultimoRank);
}

/**
 * O que a rota da lista devolve numa casa de duas faixas: por agremiação, as
 * linhas de rank > R — as do objeto da UF depois do corte e as 61+ do objeto
 * de lista —, sem repetir `sqcand`, por rank asc (desempate por `sqcand`).
 *
 * Mesmo envelope do `DeputadoUfLista` (o cliente já o valida), com o `ts` do
 * objeto da UF: é dele que sai o corte. Agremiação sem resto não entra.
 *
 * `lista` é `null` quando a UF não tem objeto de lista (nenhuma agremiação
 * passa de 60 — o DF inteiro); quem chama garante que isso é ausência
 * legítima, e não um objeto que o ciclo deixou de gravar.
 */
export function restanteForaDoDocumento(
  detalhe: DeputadoUfDetail,
  lista: DeputadoUfLista | null,
): DeputadoUfLista {
  const agremiacoes: DeputadoUfLista["agremiacoes"] = [];
  for (const agr of detalhe.agremiacoes) {
    // Objeto v1 (sem `candidatos`): a página não corta nada, nada a devolver.
    if (!agr.candidatos) continue;
    // R SEM projeção — o piso do R de qualquer página (ver o cabeçalho).
    const r = ultimoRankNoDocumento(agr, {
      totalizacaoFinal: detalhe.totalizacao_final,
      projecaoVisivel: false,
    });
    // "Fora do documento" é "fora do que a página levou", e não "rank > R":
    // as linhas do objeto de lista nunca estão no documento, mesmo que R
    // passe de 60 (agremiação que elegesse 56+ — o objeto da UF só tem
    // 1..60 sem marca, e as 61..R viriam pela lista).
    const vistos = new Set(linhasNoDocumento(agr.candidatos, r).map((l) => l.sqcand));
    const doObjeto = agr.candidatos.filter((l) => l.rank > r);
    const daLista = lista?.agremiacoes.find((a) => a.cod === agr.cod)?.candidatos ?? [];
    const juntas: DeputadoUfLinha[] = [];
    for (const l of [...doObjeto, ...daLista]) {
      if (vistos.has(l.sqcand)) continue;
      vistos.add(l.sqcand);
      juntas.push(l);
    }
    if (juntas.length === 0) continue;
    juntas.sort((a, b) => a.rank - b.rank || a.sqcand - b.sqcand);
    agremiacoes.push({ cod: agr.cod, candidatos: juntas });
  }
  return {
    ts: detalhe.ts,
    cargo: detalhe.cargo,
    turno: 1,
    contrato: 2,
    uf: detalhe.uf,
    agremiacoes,
  };
}
