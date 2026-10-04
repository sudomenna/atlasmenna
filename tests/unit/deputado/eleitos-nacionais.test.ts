/**
 * tests/unit/deputado/eleitos-nacionais.test.ts — spec 026 RF-299 e RF-300
 * (ADR-0063, emenda de 04/10 (2)): o agregador puro que soma as 27 UFs do
 * Blob na lista nacional de eleitos e no cenário projetado misto.
 *
 * O que protege:
 *
 *   1. a soma da parcial e o cenário misto — só `projecaoVisivel` faz a
 *      projeção de uma UF contar; UF travada com `cadeiras_projetadas` no
 *      objeto conta a PARCIAL;
 *   2. interruptor desligado ⇒ nenhum dado de projeção sai (cenário = parcial,
 *      nenhum bit de projeção), e a trava subida pela chave também vale;
 *   3. UF que não pôde ser lida fica FORA da soma e listada — nunca zero
 *      (decisão do dono, "três estados");
 *   4. ordem fixa (constituição § 6): UF por sigla, `rank`, `sqcand` —
 *      qualquer que seja a ordem de chegada;
 *   5. objeto v1 (sem `candidatos`): `eleitos[]` como parcial;
 *   6. `votos_projetados` nunca sai (RF-297);
 *   7. totalização final: o resultado do TSE tem precedência (RF-267).
 *
 * Mutações aplicadas à mão (04/10) — todas derrubam ao menos um caso:
 *   (a) `liberada` sempre `true`;
 *   (b) ignorar o interruptor (sem `aplicarInterruptorProjecao` e
 *       `projecaoVisivel(…, true)`); (b') só sem `aplicarInterruptorProjecao`;
 *   (c) somar `cadeiras_projetadas` também em UF travada.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DeputadoUfAgremiacao, DeputadoUfDetail } from "@/lib/blob/deputado-uf";
import { agregarEleitosNacionais, type LeituraUfNacional } from "@/lib/deputado/eleitos-nacionais";
import { LN } from "@/lib/deputado/eleitos-nacionais-visao";
import type { InterruptorProjecaoLido } from "@/lib/edge-config/reader";
import type { DeputadoUfLinha } from "@/lib/edge-config/types";
import { BIT_MARCA } from "@/lib/utils/deputado-marcas";
import contratoUf from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

const LIGADO: InterruptorProjecaoLido = { ligada: true, pct_minimo: 25, origem: "chave" };
const DESLIGADO: InterruptorProjecaoLido = { ligada: false, pct_minimo: 25, origem: "ausente" };

const BASE = "https://exemplo.public.blob.vercel-storage.com";
const ORIGINAL_BASE = process.env.BLOB_PUBLIC_BASE_URL;
beforeEach(() => {
  process.env.BLOB_PUBLIC_BASE_URL = BASE;
});
afterEach(() => {
  if (ORIGINAL_BASE === undefined) delete process.env.BLOB_PUBLIC_BASE_URL;
  else process.env.BLOB_PUBLIC_BASE_URL = ORIGINAL_BASE;
});

const PROJ_BITS = BIT_MARCA.PROJECAO | BIT_MARCA.PROJECAO_SOBRA | BIT_MARCA.PROJECAO_APERTADA;

// ---------------------------------------------------------------------------
// Construtores
// ---------------------------------------------------------------------------

function cand(over: Partial<DeputadoUfLinha> & { sqcand: number; rank: number }): DeputadoUfLinha {
  return {
    nome: `CANDIDATO ${over.sqcand}`,
    partido: "PT",
    votos: 100_000 - over.rank,
    pct_validos: 1.5,
    ...over,
  };
}

function agr(
  cod: string,
  cadeiras: number,
  candidatos: DeputadoUfLinha[] | undefined,
  over: Partial<DeputadoUfAgremiacao> = {},
): DeputadoUfAgremiacao {
  return {
    cod,
    sigla: cod === "13" ? "PT/PC do B/PV" : `P${cod}`,
    nome: `Agremiação ${cod}`,
    tipo: cod === "13" ? "federacao" : "partido",
    componentes: cod === "13" ? ["PT", "PC do B", "PV"] : [],
    sigla_lider: cod === "13" ? "PT" : `P${cod}`,
    votos_nominais: 1_000_000,
    votos_legenda: 10_000,
    votos_validos: 1_010_000,
    pct_votos: 10,
    quociente_partidario: cadeiras,
    cadeiras,
    eleitos: [],
    suplentes: [],
    ...(candidatos ? { candidatos } : {}),
    ...over,
  };
}

function uf(
  sigla: string,
  agremiacoes: DeputadoUfAgremiacao[],
  over: Partial<DeputadoUfDetail> = {},
): DeputadoUfDetail {
  return {
    ts: "2026-10-04T22:00:00.000Z",
    cargo: 6,
    turno: 1,
    contrato: 2,
    uf: sigla,
    pct_apurado: 60,
    lugares_a_preencher: 10,
    quociente_eleitoral: 100_000,
    quociente_eleitoral_tse: null,
    totalizacao_final: false,
    divergencias: [],
    agremiacoes,
    vagas_nao_preenchidas: 0,
    empates_indeterminados: [],
    projecao: {
      estado: "aguardando",
      motivo: "pct_minimo",
      pct_minimo: 25,
      zonas_apuradas: 1,
      zonas_total: 9,
    },
    ...over,
  };
}

const LIBERADA = { estado: "liberada", pct_minimo: 25, zonas_apuradas: 9, zonas_total: 9 } as const;

/**
 * A do critério de aceitação do RF-300: parcial 3 na UF A (liberada, 5
 * projetadas) e 4 na UF B (travada, mas com `cadeiras_projetadas: 10` no
 * objeto — só `projecaoVisivel` pode fazer a projeção contar).
 */
function misto(): LeituraUfNacional[] {
  const a = uf(
    "SP",
    [
      agr(
        "13",
        3,
        [
          cand({
            sqcand: 1,
            rank: 1,
            partido: "PT",
            parcial: "qp",
            projecao: "qp",
            votos_projetados: 777_777,
          }),
          cand({ sqcand: 2, rank: 2, partido: "PV", parcial: "qp", projecao: "qp" }),
          cand({ sqcand: 3, rank: 3, partido: "PT", parcial: "sobra", projecao: "qp" }),
          cand({
            sqcand: 4,
            rank: 4,
            partido: "PC do B",
            projecao: "qp",
            votos_projetados: 555_555,
          }),
          cand({ sqcand: 5, rank: 5, partido: "PT", projecao: "sobra" }),
          cand({ sqcand: 6, rank: 6, partido: "PT" }),
        ],
        { cadeiras_projetadas: 5, votos_projetados: 9_999_999 },
      ),
      agr("22", 2, [cand({ sqcand: 7, rank: 1, partido: "PL", parcial: "qp", projecao: "qp" })], {
        cadeiras_projetadas: 0,
      }),
    ],
    { projecao: LIBERADA },
  );
  const b = uf(
    "BA",
    [
      agr(
        "13",
        4,
        [1, 2, 3, 4].map((r) => cand({ sqcand: 100 + r, rank: r, partido: "PT", parcial: "qp" })),
        { cadeiras_projetadas: 10 },
      ),
    ],
    { pct_apurado: 18 },
  );
  return [
    { uf: "SP", detail: a },
    { uf: "BA", detail: b },
  ];
}

function doCod(saida: ReturnType<typeof agregarEleitosNacionais>, cod: string) {
  const a = saida.agremiacoes.find((x) => x.cod === cod);
  if (!a) throw new Error(`cod ${cod} ausente`);
  return a;
}

// ---------------------------------------------------------------------------

describe("RF-300 — o cenário misto", () => {
  it("parcial 3 (A liberada, 5 projetadas) + 4 (B travada) ⇒ cenário 9, parcial 7", () => {
    const saida = agregarEleitosNacionais(misto(), LIGADO);
    const pt = doCod(saida, "13");
    expect(pt.parcial).toBe(7);
    expect(pt.cenario).toBe(9);
    expect(saida.ufs_liberadas).toEqual(["SP"]);
    expect(saida.ufs_parcial).toEqual(["BA"]);
    expect(saida.ufs_tse).toEqual([]);
    expect(saida.ufs_sem_dado).toEqual([]);
    expect(saida.projecao_desligada).toBe(false);
  });

  it("🔴 UF travada com `cadeiras_projetadas` no objeto conta a PARCIAL", () => {
    // B traz 10 projetadas; somá-las daria 15 (mutação (c)) e marcá-la
    // liberada daria 15 também (mutação (a)).
    const pt = doCod(agregarEleitosNacionais(misto(), LIGADO), "13");
    expect(pt.cenario).not.toBe(15);
    expect(pt.cenario).toBe(5 + 4);
  });

  it("agremiação com zero na parcial e cadeiras no cenário aparece com os dois números", () => {
    const leituras = misto();
    const sp = leituras[0]?.detail as DeputadoUfDetail;
    sp.agremiacoes.push(agr("55", 0, [], { cadeiras_projetadas: 1 }));
    const psd = doCod(agregarEleitosNacionais(leituras, LIGADO), "55");
    expect(psd).toMatchObject({ parcial: 0, cenario: 1 });
  });

  it("a trava SUBIDA pela chave tira a UF da projeção (pct da UF abaixo dela)", () => {
    const saida = agregarEleitosNacionais(misto(), {
      ligada: true,
      pct_minimo: 80,
      origem: "chave",
    });
    expect(saida.ufs_liberadas).toEqual([]);
    expect(saida.ufs_parcial).toEqual(["BA", "SP"]);
    expect(doCod(saida, "13").cenario).toBe(7);
    for (const a of saida.agremiacoes) {
      for (const l of a.linhas) expect(l[LN.MARCAS] & PROJ_BITS).toBe(0);
    }
  });

  it("UF liberada em que o leitor descartou `cadeiras_projetadas` de alguma agremiação conta a parcial inteira", () => {
    const leituras = misto();
    const sp = leituras[0]?.detail as DeputadoUfDetail;
    delete (sp.agremiacoes[1] as Partial<DeputadoUfAgremiacao>).cadeiras_projetadas;
    const saida = agregarEleitosNacionais(leituras, LIGADO);
    expect(saida.ufs_liberadas).toEqual([]);
    expect(doCod(saida, "13").cenario).toBe(7);
  });
});

describe("RF-265 — interruptor desligado", () => {
  it("🔴 nenhum dado de projeção sai: cenário = parcial, nenhuma UF liberada, nenhum bit de projeção", () => {
    const saida = agregarEleitosNacionais(misto(), DESLIGADO);
    expect(saida.projecao_desligada).toBe(true);
    expect(saida.ufs_liberadas).toEqual([]);
    expect(saida.ufs_parcial).toEqual(["BA", "SP"]);
    for (const a of saida.agremiacoes) {
      expect(a.cenario).toBe(a.parcial);
      for (const l of a.linhas) expect(l[LN.MARCAS] & PROJ_BITS).toBe(0);
    }
    // Quem era só "eleito na projeção" (sqcand 4 e 5) nem entra na lista.
    const sqs = doCod(saida, "13").linhas.map((l) => l[LN.SQCAND]);
    expect(sqs).not.toContain(4);
    expect(sqs).not.toContain(5);
  });

  it("controle positivo: ligado, a projeção aparece nas linhas da UF liberada", () => {
    const linhas = doCod(agregarEleitosNacionais(misto(), LIGADO), "13").linhas;
    const so = linhas.filter((l) => l[LN.UF] === "SP" && l[LN.MARCAS] & BIT_MARCA.PROJECAO);
    expect(so.map((l) => l[LN.SQCAND])).toEqual([1, 2, 3, 4, 5]);
    // Na UF travada, nenhuma.
    expect(
      linhas.filter((l) => l[LN.UF] === "BA").every((l) => (l[LN.MARCAS] & PROJ_BITS) === 0),
    ).toBe(true);
  });
});

describe("três estados — UF sem dado nunca vira zero", () => {
  it("UF que falhou fica fora da soma e listada; agremiação só dela não aparece", () => {
    const leituras: LeituraUfNacional[] = [
      ...misto(),
      { uf: "AC", detail: null },
      { uf: "RR", detail: null },
    ];
    const saida = agregarEleitosNacionais(leituras, LIGADO);
    expect(saida.ufs_sem_dado).toEqual(["AC", "RR"]);
    expect(saida.ufs_total).toBe(4);
    expect(doCod(saida, "13")).toMatchObject({ parcial: 7, cenario: 9 });
    expect(saida.agremiacoes.map((a) => a.cod)).toEqual(["13", "22"]);
  });

  it("nenhuma UF com dado: tudo em `ufs_sem_dado`, nenhuma agremiação, `ts` nulo", () => {
    const saida = agregarEleitosNacionais(
      ["SP", "BA"].map((s) => ({ uf: s, detail: null })),
      LIGADO,
    );
    expect(saida).toMatchObject({
      ts: null,
      ufs_sem_dado: ["BA", "SP"],
      agremiacoes: [],
      ufs_liberadas: [],
      ufs_parcial: [],
    });
  });
});

describe("constituição § 6 — ordem fixa", () => {
  it("UF por sigla, depois rank — qualquer que seja a ordem de chegada", () => {
    const a = agregarEleitosNacionais(misto(), LIGADO);
    const invertida = misto().reverse();
    for (const l of invertida) {
      for (const g of l.detail?.agremiacoes ?? []) g.candidatos?.reverse();
    }
    const b = agregarEleitosNacionais(invertida, LIGADO);
    expect(b).toEqual(a);
    const linhas = doCod(a, "13").linhas.map((l) => `${l[LN.UF]}:${l[LN.SQCAND]}`);
    expect(linhas).toEqual([
      "BA:101",
      "BA:102",
      "BA:103",
      "BA:104",
      "SP:1",
      "SP:2",
      "SP:3",
      "SP:4",
      "SP:5",
    ]);
  });

  it("agremiações por `cod`, e o `ts` é o mais recente das UFs", () => {
    const leituras = misto();
    (leituras[1]?.detail as DeputadoUfDetail).ts = "2026-10-04T22:30:00.000Z";
    const saida = agregarEleitosNacionais(leituras, LIGADO);
    expect(saida.agremiacoes.map((a) => a.cod)).toEqual(["13", "22"]);
    expect(saida.ts).toBe("2026-10-04T22:30:00.000Z");
  });
});

describe("RF-276 — objeto v1 (sem `candidatos`)", () => {
  it("`eleitos[]` vira a parcial, sem via, sem número nem %, na ordem de `ordem`", () => {
    const v1 = uf(
      "RJ",
      [
        agr("22", 2, undefined, {
          eleitos: [
            {
              sqcand: 30,
              nome: "SEGUNDO",
              partido: "PL",
              votos: 50_000,
              ordem: 2,
              indefinido: true,
            },
            { sqcand: 20, nome: "PRIMEIRO", partido: "PL", votos: 90_000, ordem: 1 },
          ],
          suplentes: [{ sqcand: 40, nome: "SUPLENTE", partido: "PL", votos: 10_000, ordem: 3 }],
        }),
      ],
      { contrato: undefined, projecao: undefined },
    );
    const saida = agregarEleitosNacionais([{ uf: "RJ", detail: v1 }], LIGADO);
    const pl = doCod(saida, "22");
    expect(pl).toMatchObject({ parcial: 2, cenario: 2 });
    expect(saida.ufs_parcial).toEqual(["RJ"]);
    expect(pl.linhas.map((l) => l[LN.SQCAND])).toEqual([20, 30]);
    const [primeiro, segundo] = pl.linhas;
    expect(primeiro?.[LN.MARCAS]).toBe(BIT_MARCA.PARCIAL | BIT_MARCA.PARCIAL_SEM_VIA);
    expect(segundo?.[LN.MARCAS]).toBe(
      BIT_MARCA.PARCIAL | BIT_MARCA.PARCIAL_SEM_VIA | BIT_MARCA.PARCIAL_APERTADA,
    );
    expect(primeiro?.[LN.NUMERO]).toBeNull();
    expect(primeiro?.[LN.PCT]).toBeNull();
    // Partido isolado: a coluna do partido não existe.
    expect(primeiro?.[LN.PARTIDO]).toBe("");
  });
});

describe("RF-297 — voto projetado por candidato nunca sai", () => {
  it("nem a chave, nem o valor, em linha ou agremiação", () => {
    const json = JSON.stringify(agregarEleitosNacionais(misto(), LIGADO));
    expect(json).not.toContain("votos_projetados");
    expect(json).not.toContain("777777");
    expect(json).not.toContain("555555");
    expect(json).not.toContain("9999999");
  });
});

describe("RF-267 — totalização final", () => {
  it("UF liberada E totalizada: entra com o resultado do TSE, nunca com a projeção", () => {
    const contrato = contratoUf as unknown as Record<string, DeputadoUfDetail>;
    const ac = structuredClone(contrato.AC) as DeputadoUfDetail;
    // Torna a projeção DIFERENTE da parcial: se ela contasse, apareceria.
    for (const a of ac.agremiacoes) if (a.cod === "22") a.cadeiras_projetadas = 7;
    const saida = agregarEleitosNacionais([{ uf: "AC", detail: ac }], LIGADO);
    expect(saida.ufs_tse).toEqual(["AC"]);
    expect(saida.ufs_liberadas).toEqual([]);
    const pl = doCod(saida, "22");
    expect(pl.cenario).toBe(3);
    for (const l of pl.linhas) {
      expect(l[LN.MARCAS] & BIT_MARCA.TSE).not.toBe(0);
      expect(l[LN.MARCAS] & (BIT_MARCA.PARCIAL | PROJ_BITS)).toBe(0);
    }
  });
});

describe("as linhas — marca, partido e foto", () => {
  it("só candidaturas com marca; partido só em federação; foto em toda linha listada com foto publicada (emenda 04/10 do RF-291)", () => {
    const comFoto = new Set(["1", "4", "7"]);
    const leituras = misto().map((l) => ({ ...l, comFoto }));
    const saida = agregarEleitosNacionais(leituras, LIGADO);
    const pt = doCod(saida, "13");
    // sqcand 6 não tem marca nenhuma.
    expect(pt.linhas.map((l) => l[LN.SQCAND])).not.toContain(6);
    const por = new Map(pt.linhas.map((l) => [l[LN.SQCAND], l]));
    // Eleito na parcial com foto ⇒ URL do construtor único.
    expect(por.get(1)?.[LN.FOTO]).toBe(`${BASE}/candidatos/foto/SP/1.jpg`);
    // Só na projeção, com foto publicada ⇒ COM foto: na lista nacional todo
    // nome listado está sendo eleito na base exibida (emenda 04/10 do RF-291).
    expect(por.get(4)?.[LN.FOTO]).toBe(`${BASE}/candidatos/foto/SP/4.jpg`);
    // Eleito sem foto publicada ⇒ sem foto (o cliente cai nas iniciais).
    expect(por.get(2)?.[LN.FOTO]).toBeUndefined();
    // Federação: o partido de cada nome.
    expect(por.get(2)?.[LN.PARTIDO]).toBe("PV");
    // Partido isolado: coluna vazia.
    const pl = doCod(saida, "22");
    expect(pl.linhas[0]?.[LN.PARTIDO]).toBe("");
    expect(pl.linhas[0]?.[LN.FOTO]).toBe(`${BASE}/candidatos/foto/SP/7.jpg`);
  });

  it("a fixture de contrato (AC, AP, RR, SP + 23 sem dado): RR liberada, AC pelo TSE, as outras na parcial", () => {
    const contrato = contratoUf as unknown as Record<string, DeputadoUfDetail>;
    const UFS = [
      "AC",
      "AL",
      "AM",
      "AP",
      "BA",
      "CE",
      "DF",
      "ES",
      "GO",
      "MA",
      "MG",
      "MS",
      "MT",
      "PA",
      "PB",
      "PE",
      "PI",
      "PR",
      "RJ",
      "RN",
      "RO",
      "RR",
      "RS",
      "SC",
      "SE",
      "SP",
      "TO",
    ];
    const saida = agregarEleitosNacionais(
      UFS.map((s) => ({ uf: s, detail: contrato[s] ? structuredClone(contrato[s]) : null })),
      LIGADO,
    );
    expect(saida.ufs_total).toBe(27);
    expect(saida.ufs_liberadas).toEqual(["RR"]);
    expect(saida.ufs_tse).toEqual(["AC"]);
    expect(saida.ufs_parcial).toEqual(["AP", "SP"]);
    expect(saida.ufs_sem_dado).toHaveLength(23);
    // UNIÃO (44): RR 2 → 1 na projeção; AP 1 e SP 4 na parcial.
    expect(doCod(saida, "44")).toMatchObject({ parcial: 2 + 1 + 4, cenario: 1 + 1 + 4 });
    // MDB (15): RR 1 → 2; AC 2 (TSE); AP 1; SP?
    const mdb = doCod(saida, "15");
    expect(mdb.cenario - mdb.parcial).toBe(1);
    // RR: Brandão (44) é eleito só na parcial; Magalhães (15) só na projeção.
    const brandao = doCod(saida, "44").linhas.find((l) => l[LN.SQCAND] === 10002620029);
    // (Brandão é sobra apertada: o bit de "apertada" vem junto.)
    expect((brandao?.[LN.MARCAS] ?? 0) & BIT_MARCA.PARCIAL).not.toBe(0);
    expect((brandao?.[LN.MARCAS] ?? 0) & PROJ_BITS).toBe(0);
    const magalhaes = mdb.linhas.find((l) => l[LN.SQCAND] === 10002620020);
    // (apertada também: o bit vem junto.)
    expect((magalhaes?.[LN.MARCAS] ?? 0) & BIT_MARCA.PROJECAO).not.toBe(0);
    expect((magalhaes?.[LN.MARCAS] ?? 0) & (BIT_MARCA.PARCIAL | BIT_MARCA.TSE)).toBe(0);
  });
});
