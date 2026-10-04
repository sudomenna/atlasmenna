/**
 * tests/unit/utils/senado-nomes-das-vagas.test.ts — spec 016, RF-301.
 *
 * Quem ocupa as vagas de cada partido em "As 54 vagas em disputa", nas duas
 * bases. Os casos que discriminam as três mutações pedidas no RF-301:
 *
 *   (a) a Parcial lendo a lista da PROJEÇÃO — SP tem ordem do apurado ≠ da
 *       projeção, e RJ não tem `pct_atual`;
 *   (b) UF aguardando virando nome — RJ, sem `pct_atual`, NÃO pode dar nome;
 *   (c) ordem por NOME em vez de UF — os nomes do PL foram escolhidos para que
 *       ordem de UF, ordem de nome e ordem de `por_uf` sejam as três
 *       diferentes.
 */

import { describe, expect, it } from "vitest";

import type { EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import { UFS_DO_SENADO } from "@/lib/senado/mandato-2031";
import {
  nomeComoNoCartao,
  nomesDoPartido,
  nomesNaParcial,
  nomesNaProjecao,
} from "@/lib/utils/senado-nomes-das-vagas";

/** Duas vagas por UF — a regra da eleição, literal de propósito (ver senador.test.tsx). */
const VAGAS = 2;

type Top = EdgeUfRow["top_candidatos"][number];

function uf(
  sigla: string,
  pctApurado: number,
  top: Top[],
  over: Partial<EdgeUfRow> = {},
): EdgeUfRow {
  return {
    sigla,
    pct_apurado: pctApurado,
    lider: top[0]?.id ?? 0,
    margem_atual: 0,
    margem_projetada: 0,
    margem_projetada_ci: [0, 0],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: top,
    vai_a_2t: null,
    bucket: "indefinido",
    ...over,
  };
}

/**
 * `por_uf` em ordem SP, RJ, AC (nem alfabética de UF, nem de nome). Projeção:
 *   SP — ANA (PL), CARLA (PT), DIEGO (MDB)
 *   RJ — ZECA (PL), BETO (PL), EDU (PSD)      ← duas vagas do MESMO partido
 *   AC — MARIA (PL), JOÃO (PT), LUIZ (PP)
 * PL: por UF = AC MARIA, RJ ZECA, RJ BETO, SP ANA; por nome = ANA, BETO,
 * MARIA, ZECA; por `por_uf` = ANA, ZECA, BETO, MARIA.
 *
 * Apurado (Parcial): SP inverte — CARLA 40, DIEGO 35, ANA 20; RJ sem
 * `pct_atual` (aguardando); AC com `pct_atual` na ordem da projeção.
 */
function payload(): EdgePayload {
  return {
    ts: "2026-10-04T21:00:00Z",
    cargo: 5,
    turno: 1,
    pct_apurado_total: 40,
    ufs_apuradas: 3,
    national: {
      candidatos: [],
      needle_position: 0,
      needle_band: "tossup",
      candidato_a_id: null,
      candidato_b_id: null,
      p_segundo_turno_overall: null,
      cenarios_2t: [],
    },
    por_uf: [
      uf("SP", 50, [
        { id: 1, pct: 40, nome: "ANA", partido: "PL", pct_atual: 20 },
        { id: 2, pct: 30, nome: "CARLA", partido: "PT", pct_atual: 40 },
        { id: 3, pct: 29, nome: "DIEGO", partido: "MDB", pct_atual: 35 },
      ]),
      uf("RJ", 30, [
        { id: 1, pct: 40, nome: "ZECA", partido: "PL" },
        { id: 2, pct: 35, nome: "BETO", partido: "PL" },
        { id: 3, pct: 20, nome: "EDU", partido: "PSD" },
      ]),
      uf("AC", 20, [
        { id: 7, pct: 45, nome: "MARIA", partido: "PL", pct_atual: 44 },
        { id: 8, pct: 30, nome: "JOÃO", partido: "PT", pct_atual: 31 },
        { id: 9, pct: 20, nome: "LUIZ", partido: "PP", pct_atual: 20 },
      ]),
    ],
    insights: [],
    composition: { pre_election: 0, model: 1, actual_results: 0 },
    composicao_vagas: {
      vagas_em_disputa: 54,
      total_cadeiras: 81,
      vagas_por_uf: 2,
      ufs_projetadas: 3,
      ufs_aguardando: 24,
      vagas_projetadas: 6,
      por_partido: [
        { partido: "PL", vagas: 4 },
        { partido: "PT", vagas: 2 },
      ],
    },
  };
}

const nomes = (lista: readonly { uf: string; nome: string }[] | null | undefined) =>
  lista?.map((v) => `${v.uf} ${v.nome}`) ?? null;

describe("nomesNaProjecao (RF-301)", () => {
  it("agrupa por partido, por SIGLA DE UF — e duas vagas da mesma UF ficam na ordem da vaga", () => {
    const n = nomesNaProjecao(payload(), VAGAS);
    // Nem por nome (ANA, BETO, MARIA, ZECA), nem na ordem de `por_uf`
    // (ANA, ZECA, BETO, MARIA): AC, RJ, RJ, SP — e em RJ, ZECA (1ª vaga)
    // antes de BETO (2ª), mesmo com B < Z.
    expect(nomes(nomesDoPartido(n, "PL", 4))).toEqual(["AC MARIA", "RJ ZECA", "RJ BETO", "SP ANA"]);
    expect(nomes(nomesDoPartido(n, "PT", 2))).toEqual(["AC JOÃO", "SP CARLA"]);
  });

  it("Σ dos nomes = vagas projetadas; as UFs sem dono somam o 'aguardando' da tela", () => {
    const n = nomesNaProjecao(payload(), VAGAS);
    const total = [...(n?.porPartido.values() ?? [])].reduce((a, l) => a + l.length, 0);
    expect(total).toBe(6);
    // 54 − 6 = 48 aguardando = 24 UFs × 2. São as 27 menos AC, RJ e SP.
    expect(n?.ufsAguardando).toEqual(UFS_DO_SENADO.filter((s) => !["AC", "RJ", "SP"].includes(s)));
    expect((n?.ufsAguardando?.length ?? 0) * VAGAS).toBe(48);
  });

  it("🔴 derivação que não fecha com `composicao_vagas` ⇒ nenhum nome (falha fechada)", () => {
    const p = payload();
    // O produtor diria PL 3 / PT 3 — os `top_candidatos` dizem PL 4 / PT 2.
    p.composicao_vagas = {
      ...(p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>),
      por_partido: [
        { partido: "PL", vagas: 3 },
        { partido: "PT", vagas: 3 },
      ],
    };
    expect(nomesNaProjecao(p, VAGAS)).toBeNull();
  });

  it("🔴 total que não fecha (`vagas_projetadas`) ⇒ nenhum nome", () => {
    const p = payload();
    (p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>).vagas_projetadas = 7;
    expect(nomesNaProjecao(p, VAGAS)).toBeNull();
  });

  it("payload sem `partido` em `top_candidatos` (o `sen-current.json`) ⇒ nenhum nome", () => {
    const p = payload();
    for (const row of p.por_uf) {
      row.top_candidatos = row.top_candidatos.map(({ partido: _p, ...t }) => t);
    }
    expect(nomesNaProjecao(p, VAGAS)).toBeNull();
  });

  it("sem `composicao_vagas` ⇒ `null`", () => {
    const p = payload();
    delete p.composicao_vagas;
    expect(nomesNaProjecao(p, VAGAS)).toBeNull();
  });

  it("UF 100% apurada ⇒ ressalva 'concluida'; UF sem voto apurado ⇒ 'sem_apuracao'", () => {
    const p = payload();
    (p.por_uf[2] as EdgeUfRow).pct_apurado = 100; // AC
    (p.por_uf[0] as EdgeUfRow).pct_apurado = 0; // SP
    const pl = nomesDoPartido(nomesNaProjecao(p, VAGAS), "PL", 4);
    expect(pl?.map((v) => [v.uf, v.ressalva ?? null])).toEqual([
      ["AC", "concluida"],
      ["RJ", null],
      ["RJ", null],
      ["SP", "sem_apuracao"],
    ]);
  });

  it("anulada não ocupa vaga: a 3ª que disputa sobe (ADR-0053)", () => {
    const p = payload();
    const sp = p.por_uf[0] as EdgeUfRow;
    sp.top_candidatos = sp.top_candidatos.map((t) =>
      t.id === 2 ? { ...t, destino: "anulado" as const } : t,
    );
    // PT perde a vaga de SP para o MDB (DIEGO).
    p.composicao_vagas = {
      ...(p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>),
      por_partido: [
        { partido: "PL", vagas: 4 },
        { partido: "MDB", vagas: 1 },
        { partido: "PT", vagas: 1 },
      ],
    };
    const n = nomesNaProjecao(p, VAGAS);
    expect(nomes(nomesDoPartido(n, "MDB", 1))).toEqual(["SP DIEGO"]);
    expect(nomes(nomesDoPartido(n, "PT", 1))).toEqual(["AC JOÃO"]);
  });

  it("casa a sigla por chave: 'UNIÃO' publicado ≡ 'UNIAO' derivado", () => {
    const p = payload();
    const ac = p.por_uf[2] as EdgeUfRow;
    ac.top_candidatos = ac.top_candidatos.map((t) => (t.id === 8 ? { ...t, partido: "UNIAO" } : t));
    p.composicao_vagas = {
      ...(p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>),
      por_partido: [
        { partido: "PL", vagas: 4 },
        { partido: "PT", vagas: 1 },
        { partido: "UNIÃO", vagas: 1 },
      ],
    };
    expect(nomes(nomesDoPartido(nomesNaProjecao(p, VAGAS), "UNIÃO", 1))).toEqual(["AC JOÃO"]);
  });
});

describe("nomesNaParcial (RF-301)", () => {
  it("🔴 (a) os nomes são os da PARCIAL — SP pelo apurado, resolvidos pelo `id` da UF", () => {
    const n = nomesNaParcial(payload().por_uf, VAGAS, 54);
    // SP pelo apurado: CARLA (PT) e DIEGO (MDB) — ANA (PL, 1ª na projeção) fora.
    expect(nomes(nomesDoPartido(n, "PT", 2))).toEqual(["AC JOÃO", "SP CARLA"]);
    expect(nomes(nomesDoPartido(n, "MDB", 1))).toEqual(["SP DIEGO"]);
    expect(nomes(nomesDoPartido(n, "PL", 1))).toEqual(["AC MARIA"]);
  });

  it("🔴 (b) UF aguardando NÃO vira nome — vai para a linha 'aguardando'", () => {
    const n = nomesNaParcial(payload().por_uf, VAGAS, 54);
    const todos = [...(n.porPartido.values() ?? [])].flat();
    // RJ não tem `pct_atual`: nem ZECA, nem BETO, nem EDU — nem "Cand N".
    expect(todos.some((v) => v.uf === "RJ")).toBe(false);
    expect(todos).toHaveLength(4);
    expect(n.ufsAguardando).toContain("RJ");
    // Nunca zero fabricado: 54 − 4 = 50 aguardando = 25 UFs × 2.
    expect(n.ufsAguardando).toEqual(UFS_DO_SENADO.filter((s) => !["AC", "SP"].includes(s)));
  });

  it("UF 100% apurada é 'decidida': os mesmos nomes da projeção, com a ressalva", () => {
    const rows = payload().por_uf;
    const rj = rows[1] as EdgeUfRow;
    rj.pct_apurado = 100; // sem `pct_atual`, mas concluída ⇒ ordem do array
    const n = nomesNaParcial(rows, VAGAS, 54);
    const pl = nomesDoPartido(n, "PL", 3);
    expect(pl?.map((v) => `${v.uf} ${v.nome} ${v.ressalva ?? "-"}`)).toEqual([
      "AC MARIA -",
      "RJ ZECA concluida",
      "RJ BETO concluida",
    ]);
  });

  it("UF aguardando que a soma não fecha ⇒ a lista de UFs não sai (`null`), só o número", () => {
    // A tela diria 50 aguardando com `vagasEmDisputa` 54; com 60, a soma das
    // UFs sem dono (50) não bate com 60 − 4 = 56.
    expect(nomesNaParcial(payload().por_uf, VAGAS, 60).ufsAguardando).toBeNull();
  });
});

describe("nomesDoPartido / nomeComoNoCartao (RF-301)", () => {
  it("nomes que não somam a contagem da linha ⇒ a linha não abre", () => {
    const n = nomesNaProjecao(payload(), VAGAS);
    expect(nomesDoPartido(n, "PL", 3)).toBeNull();
    expect(nomesDoPartido(n, "PSOL", 1)).toBeNull();
    expect(nomesDoPartido(null, "PL", 4)).toBeNull();
  });

  it("o nome é o do cartão: `nomeExibicao`, e `Cand <id>` sem nome", () => {
    expect(nomeComoNoCartao({ id: 13, nome: "PROFESSOR JOSÉ CARLOS" })).toBe("JOSÉ CARLOS");
    expect(nomeComoNoCartao({ id: 13 })).toBe("Cand 13");
    expect(nomeComoNoCartao({ id: 13, nome: "" })).toBe("Cand 13");
  });

  it("determinismo: mesmo payload ⇒ mesma saída (§ 6)", () => {
    const a = nomesNaProjecao(payload(), VAGAS);
    const b = nomesNaProjecao(payload(), VAGAS);
    expect([...(a?.porPartido ?? [])]).toEqual([...(b?.porPartido ?? [])]);
  });
});
