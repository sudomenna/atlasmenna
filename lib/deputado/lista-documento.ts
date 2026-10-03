/**
 * lib/deputado/lista-documento.ts — spec 027, decisão do dono de 03/10: o que
 * a lista de candidatos de uma agremiação leva ao DOCUMENTO nas assembleias
 * (cargos 7 e 8), e o que fica para a rota `GET /uf/<UF>/<slug>/lista`.
 *
 * ## A regra
 *
 * Por agremiação, o documento traz **os eleitos na parcial e os 5 seguintes
 * por rank, com mínimo de 10** — agremiação sem eleito: 10; com menos
 * candidaturas que isso: todas. Nada oculto no DOM: o resto (do primeiro fora
 * do documento até o fim) só chega quando o leitor aciona "mostrar todos".
 *
 * O motivo é peso, medido pela frente S em 03/10 com o servidor falso: as três
 * faixas da spec 026 (20 visíveis + 21–60 recortadas no DOM, ADR-0065) levavam
 * `/uf/SP/deputado-estadual` a 724 KiB de documento (1.570 linhas, ~470 B cada)
 * e `/uf/DF/deputado-distrital` a 446 KiB, contra o teto global de 300 KiB.
 *
 * O federal (cargo 6) NÃO usa este módulo: continua nas três faixas.
 *
 * ## "Os 5 seguintes" contam a partir do MAIOR rank eleito
 *
 * Os eleitos de uma agremiação não são sempre os ranks 1..k: uma candidatura
 * anulada ou sub judice tem rank (é ordenada pelo voto apurado) e nunca se
 * elege. Contar k + 5 abriria um buraco; contar a partir do último eleito
 * mantém o documento CONTÍGUO (ranks 1..R), que é o que permite à rota
 * devolver exatamente "rank > R" sem repetir nem pular ninguém.
 *
 * ## Quem conta como eleito
 *
 *   - parcial (`totalizacao_final` falso): `parcial` presente;
 *   - "Eleito (TSE)" (`tf = "s"`): um dos três rótulos de eleito do TSE —
 *     a mesma regra de {@link ehTseEleito} que desenha a marca.
 *
 * ## Duas extensões, ambas para que NENHUMA marca fique atrás do clique
 *
 * ADR-0065 D1: o que vem pela rota nunca carrega marca. Por isso R também
 * cobre, fora da totalização final:
 *
 *   - o `corte.primeiro_fora` (RF-272) — a linha de corte precisa dos dois
 *     nomes, e o primeiro de fora pode estar além de "último eleito + 5"
 *     quando os seguintes são anulados;
 *   - toda linha com `projecao` no objeto CRU (antes do interruptor). Lida do
 *     objeto cru de propósito: a rota não lê o interruptor, e as duas pontas
 *     (página e rota) precisam chegar ao MESMO R.
 *
 * Nos dois casos, na prática, R não muda (a fixture das assembleias não tem
 * nenhum que mude); são redes para o caso raro, não a regra.
 */

import type { DeputadoUfDetail, DeputadoUfLinha, DeputadoUfLista } from "@/lib/blob/deputado-uf";
import type { CargoProporcional } from "@/lib/config/cargos";
import { ehTseEleito } from "@/lib/utils/deputado-marcas";

/** Mínimo de linhas no documento por agremiação (decisão do dono, 03/10). */
export const MINIMO_NO_DOCUMENTO = 10;

/** Quantas linhas depois do último eleito entram no documento. */
export const SEGUINTES_AO_ULTIMO_ELEITO = 5;

/**
 * As casas cuja lista vai ao documento em DUAS faixas (documento + rota). O
 * federal fica nas três faixas da spec 026, sem mudança de um byte.
 */
export function listaEmDuasFaixas(cargo: CargoProporcional): boolean {
  return cargo === 7 || cargo === 8;
}

/** O que {@link ultimoRankNoDocumento} lê de uma linha. */
type LinhaParaCorte = Pick<DeputadoUfLinha, "sqcand" | "rank" | "parcial" | "projecao" | "tse">;

/** O que {@link ultimoRankNoDocumento} lê de uma agremiação. */
export interface AgremiacaoParaCorte {
  candidatos?: readonly LinhaParaCorte[];
  corte?: { primeiro_fora: number };
}

/**
 * O maior rank que vai ao documento nesta agremiação (R). O documento leva as
 * linhas de rank ≤ R do objeto da UF; a rota devolve as de rank > R.
 *
 * Pode passar do total de candidaturas (agremiação de 7 com mínimo de 10):
 * cortar por "rank ≤ R" leva todas, que é a regra.
 */
export function ultimoRankNoDocumento(agr: AgremiacaoParaCorte, totalizacaoFinal: boolean): number {
  const linhas = agr.candidatos ?? [];
  let r = MINIMO_NO_DOCUMENTO;
  let ultimoEleito = 0;
  for (const l of linhas) {
    const eleito = totalizacaoFinal ? ehTseEleito(l.tse) : l.parcial !== undefined;
    if (eleito && l.rank > ultimoEleito) ultimoEleito = l.rank;
    // Extensão: marca de projeção nunca atrás do clique (ver o cabeçalho).
    if (!totalizacaoFinal && l.projecao !== undefined && l.rank > r) r = l.rank;
  }
  if (ultimoEleito > 0) r = Math.max(r, ultimoEleito + SEGUINTES_AO_ULTIMO_ELEITO);
  // Extensão: o primeiro de fora da linha de corte (RF-272) sempre no documento.
  if (!totalizacaoFinal && agr.corte) {
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
    const r = ultimoRankNoDocumento(agr, detalhe.totalizacao_final);
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
