/**
 * lib/deputado/uniao-casas.ts — spec 027 (RF-280, RF-282), design § 8.2.
 *
 * A capa `/deputado-estadual` mostra as 27 casas que elegem deputado estadual
 * ou distrital — as 26 Assembleias Legislativas (cargo 7) e a Câmara
 * Legislativa do DF (cargo 8) — a partir de DOIS payloads nacionais
 * (`projection-current-est-t1` e `projection-current-dis-t1`) e de NENHUM Blob
 * de UF. Aqui moram as uniões dos dois, puras e determinísticas
 * (constituição § 6): a mesma entrada dá sempre a mesma saída, e a ordem de
 * cada lista tem desempate explícito até a chave.
 *
 * ## Mais votados e puxadores — a conta é exata
 *
 * Cada payload traz o top 10 (mais votados) e os até 30 maiores excedentes
 * (puxadores) do SEU conjunto. O top N da união está contido na união dos dois
 * tops N — então ordenar a união e cortar em N dá exatamente o top N das 27
 * casas, sem ler UF nenhuma.
 *
 * ## A soma por partido ou federação
 *
 * Pela **chave nacional estável** da agremiação (`cod`, que o produtor já
 * publica assim: o número do partido isolado, ou `fed:<nº>` da federação —
 * `api/model/deputado.py::chave_agremiacao`, commit b28e74b). ⚠️ NUNCA por
 * `agr[].n` do EA20: é o id da inscrição por cargo × UF — medido em 29/09,
 * zero coincidências entre RR e AP para os mesmos 21 partidos.
 *
 * O total é **1.059 fixo enquanto faltar casa** (ADR-0049, a lição do 513: a
 * soma das casas presentes cresce durante a noite e faria a tela escrever
 * "118 cadeiras em disputa"). Com as duas fontes presentes, é a soma dos
 * `total_cadeiras` dos dois payloads — cada produtor já publica o total fixo
 * da casa enquanto faltar UF, e a soma das vagas do TSE quando todas as UFs
 * chegaram (RF-280 emendado). "Aguardando" é `total − atribuídas`, sem
 * `Math.max(0, …)`: negativo é defeito a mostrar, não a esconder.
 */

import { type CargoProporcional, ufsDoCargo } from "@/lib/config/cargos";
import type {
  EdgeAgremiacaoBancada,
  EdgeDeputadoDestaque,
  EdgeDeputadoPuxador,
  EdgePayloadDeputado,
} from "@/lib/edge-config/types";

/**
 * O tamanho de cada casa estadual/distrital em 2026 — fato fixo antes da urna
 * abrir, espelho de `api/model/cargos.py::TOTAL_CADEIRAS` (7: 1.035, 8: 24). O
 * teste `tests/unit/deputado/uniao-casas.test.ts` confere os dois números
 * contra o arquivo Python: se um mudar sozinho, o teste cai.
 */
export const TOTAL_CADEIRAS_DA_CASA: Readonly<Record<Exclude<CargoProporcional, 6>, number>> = {
  7: 1035,
  8: 24,
};

/** 1.035 + 24 — as cadeiras das 27 casas somadas (RF-280). */
export const TOTAL_CADEIRAS_ASSEMBLEIAS = TOTAL_CADEIRAS_DA_CASA[7] + TOTAL_CADEIRAS_DA_CASA[8];

/** Quantas casas a capa soma: 26 Assembleias + a Câmara Legislativa do DF. */
export const TOTAL_CASAS = ufsDoCargo(7).length + ufsDoCargo(8).length;

/** Os 10 mais votados do país (spec 026 RF-271). */
export const MAIS_VOTADOS_NO_PAIS = 10;
/** Os 30 maiores puxadores do país (spec 026 RF-273). */
export const PUXADORES_NO_PAIS = 30;

/** Comparação de string estável e independente de locale — desempate, não exibição. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Junta as listas de quem as TEM: `undefined` só quando nenhuma fonte trouxe a
 * lista (payload anterior à spec 026, ou nenhum payload) — e aí o bloco não
 * aparece, em vez de dizer "nenhum".
 */
function unir<T>(listas: ReadonlyArray<readonly T[] | undefined>): T[] | undefined {
  const presentes = listas.filter((l): l is readonly T[] => l !== undefined);
  if (presentes.length === 0) return undefined;
  return presentes.flat();
}

/**
 * Os 10 mais votados das 27 casas, pela ordem `(−votos, uf, sqcand)` — a mesma
 * da spec 026 § 3.3, sempre igual. Cada linha mantém a sua UF e o seu % "dos
 * válidos de {UF}": não existe denominador nacional com sentido.
 */
export function maisVotadosDasCasas(
  est: EdgePayloadDeputado | null,
  dis: EdgePayloadDeputado | null,
): EdgeDeputadoDestaque[] | undefined {
  const todos = unir([est?.mais_votados, dis?.mais_votados]);
  if (!todos) return undefined;
  return [...todos]
    .sort((a, b) => b.votos - a.votos || cmp(a.uf, b.uf) || a.sqcand - b.sqcand)
    .slice(0, MAIS_VOTADOS_NO_PAIS);
}

/** Os 30 maiores puxadores das 27 casas, `(−excedente, −votos, uf, sqcand)` (026 § 3.5). */
export function puxadoresDasCasas(
  est: EdgePayloadDeputado | null,
  dis: EdgePayloadDeputado | null,
): EdgeDeputadoPuxador[] | undefined {
  const todos = unir([est?.puxadores, dis?.puxadores]);
  if (!todos) return undefined;
  return [...todos]
    .sort(
      (a, b) =>
        b.excedente - a.excedente || b.votos - a.votos || cmp(a.uf, b.uf) || a.sqcand - b.sqcand,
    )
    .slice(0, PUXADORES_NO_PAIS);
}

/** A soma das 27 casas, pronta para o `<DeputadoBancadaPanel>`. */
export interface SomaDasCasas {
  /** Uma linha por chave nacional, na ordem `(−cadeiras, sigla, cod)`. Sem faixa (`cadeiras_ci95`). */
  por_agremiacao: EdgeAgremiacaoBancada[];
  /** 1.059 enquanto faltar casa; Σ `total_cadeiras` com as duas fontes presentes. */
  total: number;
  /** Σ `cadeiras` das agremiações somadas. */
  atribuidas: number;
  /** `total − atribuidas`, sem piso em zero. */
  aguardando: number;
  /** Casas com a distribuição calculada (Σ `ufs_calculadas` dos presentes). */
  casasCalculadas: number;
  /** `TOTAL_CASAS − casasCalculadas`. */
  casasAguardando: number;
}

/**
 * A soma das cadeiras por partido ou federação nas 27 casas (design § 8.2).
 *
 *   - soma `cadeiras`, `cadeiras_indefinidas`, `votos_validos`,
 *     `votos_nominais`, `votos_legenda` por `cod`;
 *   - `sigla`, `nome`, `tipo` e `componentes` do primeiro que tiver o `cod`
 *     (`est` antes de `dis`); `sigla_lider` (a COR) do `est` quando o `cod`
 *     existe lá — cor estável a noite toda (open question 4 da spec);
 *   - `pct_votos` = Σ válidos da agremiação ÷ Σ válidos de todas as
 *     agremiações das casas presentes (0 sem voto nenhum — nunca `NaN`);
 *   - NUNCA `cadeiras_ci95`: faixa não se soma entre casas (design § 8.3).
 */
export function somaDasCasas(
  est: EdgePayloadDeputado | null,
  dis: EdgePayloadDeputado | null,
): SomaDasCasas {
  const porCod = new Map<string, EdgeAgremiacaoBancada>();
  for (const payload of [est, dis]) {
    if (!payload) continue;
    for (const a of payload.bancada.por_agremiacao) {
      const atual = porCod.get(a.cod);
      if (!atual) {
        porCod.set(a.cod, {
          cod: a.cod,
          sigla: a.sigla,
          nome: a.nome,
          tipo: a.tipo,
          componentes: [...a.componentes],
          sigla_lider: a.sigla_lider,
          cadeiras: a.cadeiras,
          ...(a.cadeiras_indefinidas !== undefined
            ? { cadeiras_indefinidas: a.cadeiras_indefinidas }
            : {}),
          votos_nominais: a.votos_nominais,
          votos_legenda: a.votos_legenda,
          votos_validos: a.votos_validos,
          pct_votos: 0,
        });
        continue;
      }
      atual.cadeiras += a.cadeiras;
      if (a.cadeiras_indefinidas !== undefined) {
        atual.cadeiras_indefinidas = (atual.cadeiras_indefinidas ?? 0) + a.cadeiras_indefinidas;
      }
      atual.votos_nominais += a.votos_nominais;
      atual.votos_legenda += a.votos_legenda;
      atual.votos_validos += a.votos_validos;
      // `est` vem primeiro no laço: identidade e cor já são as dele.
    }
  }

  const linhas = [...porCod.values()];
  const validosTotais = linhas.reduce((s, a) => s + a.votos_validos, 0);
  for (const a of linhas) {
    a.pct_votos = validosTotais > 0 ? (a.votos_validos * 100) / validosTotais : 0;
  }
  linhas.sort((a, b) => b.cadeiras - a.cadeiras || cmp(a.sigla, b.sigla) || cmp(a.cod, b.cod));

  const total =
    est && dis
      ? est.bancada.total_cadeiras + dis.bancada.total_cadeiras
      : TOTAL_CADEIRAS_ASSEMBLEIAS;
  const atribuidas = linhas.reduce((s, a) => s + a.cadeiras, 0);
  const casasCalculadas = (est?.bancada.ufs_calculadas ?? 0) + (dis?.bancada.ufs_calculadas ?? 0);

  return {
    por_agremiacao: linhas,
    total,
    atribuidas,
    aguardando: total - atribuidas,
    casasCalculadas,
    casasAguardando: TOTAL_CASAS - casasCalculadas,
  };
}
