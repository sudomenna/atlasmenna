/**
 * tests/unit/deputado/_payload-casa.ts — payloads nacionais sintéticos dos
 * cargos 7 e 8 (spec 027) para os testes da capa das assembleias.
 *
 * Escritos à mão, pequenos e legíveis: cada teste diz o número que importa
 * (cadeiras, total, votos) em vez de herdar um valor de fixture que coincide.
 * A forma é a do contrato v2 (`EdgePayloadDeputado`); o produtor real é
 * `api/model/deputado_payload.py`.
 */

import type {
  EdgeAgremiacaoBancada,
  EdgeDeputadoDestaque,
  EdgeDeputadoPuxador,
  EdgeDeputadoUfRow,
  EdgePayloadDeputado,
} from "@/lib/edge-config/types";

export function agremiacao(
  cod: string,
  sigla: string,
  cadeiras: number,
  over: Partial<EdgeAgremiacaoBancada> = {},
): EdgeAgremiacaoBancada {
  return {
    cod,
    sigla,
    nome: `Partido ${sigla}`,
    tipo: "partido",
    componentes: [],
    sigla_lider: sigla,
    cadeiras,
    votos_nominais: cadeiras * 1000,
    votos_legenda: cadeiras * 100,
    votos_validos: cadeiras * 1100,
    pct_votos: 0,
    ...over,
  };
}

export function destaque(
  uf: string,
  sqcand: number,
  votos: number,
  over: Partial<EdgeDeputadoDestaque> = {},
): EdgeDeputadoDestaque {
  return {
    uf,
    sqcand,
    nome: `Candidato ${uf} ${sqcand}`,
    partido: "PL",
    cod: "22",
    sigla: "PL",
    numero: 22123,
    votos,
    pct_validos: 1.5,
    ...over,
  };
}

export function puxador(
  uf: string,
  sqcand: number,
  votos: number,
  excedente: number,
): EdgeDeputadoPuxador {
  return {
    ...destaque(uf, sqcand, votos),
    quociente_eleitoral: 1000,
    quocientes: excedente + 1,
    excedente,
  };
}

export function linhaUf(sigla: string, over: Partial<EdgeDeputadoUfRow> = {}): EdgeDeputadoUfRow {
  return {
    sigla,
    pct_apurado: 40,
    lugares_a_preencher: 24,
    quociente_eleitoral: 5000,
    cadeiras_definidas: 24,
    vagas_nao_preenchidas: 0,
    empates_indeterminados: 0,
    lider: { cod: "22", sigla: "PL", cadeiras: 6 },
    ...over,
  };
}

export interface OpcoesPayload {
  agremiacoes: EdgeAgremiacaoBancada[];
  total?: number;
  ufsCalculadas?: number;
  porUf?: EdgeDeputadoUfRow[];
  maisVotados?: EdgeDeputadoDestaque[];
  puxadores?: EdgeDeputadoPuxador[];
  atualizacaoMin?: number;
  dadoTs?: string;
  ts?: string;
}

/** Um payload nacional de uma casa (7 ou 8), com o total fixo da casa por padrão. */
export function payloadCasa(cargo: 7 | 8, o: OpcoesPayload): EdgePayloadDeputado {
  const nUfs = cargo === 7 ? 26 : 1;
  const ufsCalculadas = o.ufsCalculadas ?? o.porUf?.length ?? 0;
  return {
    ts: o.ts ?? "2026-10-04T23:40:00.000Z",
    dado_ts: o.dadoTs ?? "2026-10-04T23:38:00Z",
    cargo,
    turno: 1,
    pct_apurado_total: 40,
    ufs_apuradas: ufsCalculadas,
    atualizacao_min: o.atualizacaoMin ?? 5,
    bancada: {
      total_cadeiras: o.total ?? (cargo === 7 ? 1035 : 24),
      cadeiras_atribuidas: o.agremiacoes.reduce((s, a) => s + a.cadeiras, 0),
      ufs_calculadas: ufsCalculadas,
      ufs_aguardando: nUfs - ufsCalculadas,
      por_agremiacao: o.agremiacoes,
    },
    por_uf: o.porUf ?? [],
    ...(o.maisVotados ? { mais_votados: o.maisVotados } : {}),
    ...(o.puxadores ? { puxadores: o.puxadores } : {}),
    insights: [],
    composition: {} as EdgePayloadDeputado["composition"],
  };
}
