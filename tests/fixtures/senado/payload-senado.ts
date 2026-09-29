/**
 * tests/fixtures/senado/payload-senado.ts — payloads de Senador (cargo 5) para
 * os testes da spec 023.
 *
 * `composicao_vagas` é escrita À MÃO a partir da lista de cada caso, não
 * calculada pela função sob teste — um fixture que chamasse
 * `derivarSenado2027` para montar a própria conferência provaria só que a
 * função concorda consigo mesma.
 */

import type { EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import { validarMandato2031 } from "@/lib/senado/mandato-2031";
import mandatoFixture from "@/tests/fixtures/senado/mandato-2031.fixture.json" with {
  type: "json",
};

/** A foto FICTÍCIA dos 27, já validada. */
export function mandatoDeTeste() {
  return validarMandato2031(structuredClone(mandatoFixture));
}

/** Um candidato do `top_candidatos`. */
export type Cand = EdgeUfRow["top_candidatos"][number];

export function cand(
  id: number,
  partido: string | undefined,
  pct: number,
  over: Partial<Cand> = {},
): Cand {
  return {
    id,
    pct,
    nome: `Candidatura ${id}`,
    ...(partido === undefined ? {} : { partido }),
    sqcand: `2500025${String(id).padStart(5, "0")}`,
    ...over,
  };
}

export function ufRow(sigla: string, pctApurado: number, top: Cand[]): EdgeUfRow {
  return {
    sigla,
    pct_apurado: pctApurado,
    lider: top[0]?.id ?? 0,
    margem_atual: 1,
    margem_projetada: 1,
    margem_projetada_ci: [0, 2],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: top,
    vai_a_2t: null,
    bucket: "indefinido",
  };
}

/**
 * Payload nacional de Senador com as UFs dadas e a composição escrita à mão.
 * `porPartido` na ordem do produtor (vagas desc, sigla asc).
 */
export function payloadSenado(
  porUf: EdgeUfRow[],
  porPartido: Array<{ partido: string; vagas: number }>,
  over: Partial<EdgePayload> = {},
): EdgePayload {
  const vagasProjetadas = porPartido.reduce((a, p) => a + p.vagas, 0);
  return {
    ts: "2026-10-04T21:00:00Z",
    cargo: 5,
    turno: 1,
    pct_apurado_total: 40,
    ufs_apuradas: porUf.length,
    national: {
      candidatos: [],
      needle_position: 0,
      needle_band: "tossup",
      candidato_a_id: null,
      candidato_b_id: null,
      p_segundo_turno_overall: null,
      cenarios_2t: [],
    },
    por_uf: porUf,
    insights: [],
    composition: { pre_election: 0, model: 1, actual_results: 0 },
    composicao_vagas: {
      vagas_em_disputa: 54,
      total_cadeiras: 81,
      vagas_por_uf: 2,
      ufs_projetadas: porUf.length,
      ufs_aguardando: 27 - porUf.length,
      vagas_projetadas: vagasProjetadas,
      por_partido: porPartido,
    },
    ...over,
  } as EdgePayload;
}

/**
 * Três UFs: SP (62%, PT e PL), RJ (100% — concluída, PSD e PP) e MG (40%, com
 * uma candidatura ANULADA em 2º: a vaga vai à 3ª que compete, PL).
 *
 * Composição, contada à mão: PL 2 (SP, MG), PT 1, PSD 1, PP 1, MDB 1 (MG).
 */
export function payloadTresUfs(over: Partial<EdgePayload> = {}): EdgePayload {
  return payloadSenado(
    [
      ufRow("SP", 62, [cand(131, "PT", 40), cand(222, "PL", 30), cand(155, "MDB", 29)]),
      ufRow("RJ", 100, [cand(555, "PSD", 45), cand(111, "PP", 28), cand(123, "PDT", 20)]),
      ufRow("MG", 40, [
        cand(151, "MDB", 35),
        cand(777, "PSOL", 30, { destino: "anulado" }),
        cand(221, "PL", 25),
        cand(400, "NOVO", 5),
      ]),
    ],
    [
      { partido: "PL", vagas: 2 },
      { partido: "MDB", vagas: 1 },
      { partido: "PP", vagas: 1 },
      { partido: "PSD", vagas: 1 },
      { partido: "PT", vagas: 1 },
    ],
    over,
  );
}
