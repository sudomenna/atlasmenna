/**
 * Núcleo do fechamento do 1º turno (`scripts/_fechamento-1t-core.ts`).
 * Sem rede, sem env: payloads sintéticos no formato real (conferido contra o
 * Global Config de produção em 05/10/2026).
 */

import { describe, expect, it } from "vitest";
import {
  aplicarTseNacionalPresidente,
  aplicarTseUfPresidente,
  brtParaIso,
  carimbar,
  diffFolhas,
  igualarDeputado,
  igualarNacionalMajoritario,
  igualarUfMajoritario,
  parseTseAgregado,
  type TseAgregado,
  tseCompleto,
} from "../../../scripts/_fechamento-1t-core";
import { ENV_DO_FECHAMENTO } from "../../../scripts/fechamento-1t";

function tseBruto(cands: [number, number, string?][], extra: { tv?: number } = {}) {
  const vv = cands.filter(([, , d]) => !d || d === "Válido").reduce((s, [, v]) => s + v, 0);
  return {
    dg: "05/10/2026",
    hg: "02:59:31",
    s: { ts: "10", st: "10" },
    e: { te: "1000", esi: "990", c: "800", a: "190" },
    v: {
      tv: String(extra.tv ?? vv + 50),
      vv: String(vv),
      vb: "20",
      tvn: "30",
      van: "0",
      vansj: "0",
    },
    carg: [
      {
        agr: [
          {
            par: [
              {
                cand: cands.map(([n, vap, dvt]) => ({
                  n: String(n),
                  sqcand: `sq${n}`,
                  vap: String(vap),
                  dvt: dvt ?? "Válido",
                })),
              },
            ],
          },
        ],
      },
    ],
  };
}

const ufPayload = () => ({
  uf: "BA",
  ts: "2026-10-05T06:07:09+00:00",
  pct_apurado: 100,
  candidatos: [
    {
      id: 13,
      nome: "A",
      votos_atuais: 590,
      votos_projetados: 600,
      pct_atual: 59,
      pct_projetado: 60,
      ci95: { lower: 58, upper: 62 },
      comparecimento: { pct_atual: 50, pct_projetado: 51, lower: 49, upper: 53 },
    },
    {
      id: 22,
      nome: "B",
      votos_atuais: 300,
      votos_projetados: 290,
      pct_atual: 30,
      pct_projetado: 29,
      ci95: { lower: 27, upper: 31 },
      comparecimento: { pct_atual: 25, pct_projetado: 24, lower: 23, upper: 26 },
    },
    {
      id: 70,
      nome: "C",
      votos_atuais: 50,
      votos_projetados: 50,
      pct_atual: 5,
      pct_projetado: 5,
      ci95: { lower: 4, upper: 6 },
      comparecimento: { pct_atual: 4, pct_projetado: 4, lower: 3, upper: 5 },
    },
    {
      id: 55,
      nome: "D",
      votos_atuais: 40,
      votos_projetados: 40,
      pct_atual: 4,
      pct_projetado: 4,
      ci95: { lower: 3, upper: 5 },
      comparecimento: { pct_atual: 3, pct_projetado: 3, lower: 2, upper: 4 },
    },
    {
      id: 14,
      nome: "E",
      votos_atuais: 10,
      votos_projetados: 10,
      pct_atual: 1,
      pct_projetado: 1,
      ci95: { lower: 0, upper: 2 },
      comparecimento: { pct_atual: 1, pct_projetado: 1, lower: 0, upper: 2 },
    },
  ],
  participacao: {
    abstencao: {
      pct_atual: 19,
      pct_projetado: 20,
      lower: 18,
      upper: 21,
      base: "eleitores_instalados",
    },
    brancos_nulos: { pct_atual: 6, pct_projetado: 6.1, lower: 5, upper: 7, base: "comparecimento" },
    outros: {
      pct_atual: 5,
      pct_projetado: 5.1,
      lower: 4,
      upper: 6,
      base: "votaveis",
      n_candidatos: 2,
      comparecimento: { pct_atual: 4, pct_projetado: 4.1, lower: 3, upper: 5 },
    },
    metodo: { tipo: "extrapolacao_apurado", pct_apurado: 100 },
  },
  votacao: {
    contagens: {
      aptos: 1,
      instalados: 1,
      comparecimento: 1,
      abstencao: 1,
      validos: 1,
      brancos: 1,
      nulos: 1,
      anulados: 0,
      sub_judice: 0,
    },
    projetada: { validos: 2, brancos: 2, nulos: 2, abstencao: 2 },
    corrida: [{ id: 13, partido: "PT", votos: 1, destino: "valido" }],
  },
});

describe("parse do agregado do TSE", () => {
  it("lê candidaturas, totais e a hora BRT como UTC", () => {
    const t = parseTseAgregado(
      tseBruto([
        [13, 600],
        [22, 300],
      ]),
    );
    expect(t.candidatos.map((c) => [c.id, c.vap])).toEqual([
      [13, 600],
      [22, 300],
    ]);
    expect(t.validos).toBe(900);
    expect(t.dataHoraIso).toBe("2026-10-05T05:59:31+00:00");
    expect(tseCompleto(t)).toBe(true);
    expect(brtParaIso("04/10/2026", "21:00:00")).toBe("2026-10-05T00:00:00+00:00");
  });

  it("arquivo parcial não é completo", () => {
    const b = tseBruto([[13, 1]]);
    b.s.st = "9";
    expect(tseCompleto(parseTseAgregado(b))).toBe(false);
  });
});

describe("Presidente UF ← agregado do TSE", () => {
  const t: TseAgregado = parseTseAgregado(
    tseBruto(
      [
        [13, 603],
        [22, 301],
        [70, 50],
        [55, 40],
        [14, 6],
      ],
      { tv: 1050 },
    ),
  );

  it("votos e percentuais oficiais, base em disputa, 5 casas, projeção == apuração", () => {
    const p = igualarUfMajoritario(aplicarTseUfPresidente(ufPayload(), t));
    const a = p.candidatos[0] as Record<string, unknown>;
    expect(a.votos_atuais).toBe(603);
    expect(a.pct_atual).toBe(Math.round((603 / 1000) * 100 * 1e5) / 1e5);
    expect(a.pct_projetado).toBe(a.pct_atual);
    expect(a.ci95).toEqual({ lower: a.pct_atual, upper: a.pct_atual });
    expect(a.votos_projetados).toBe(603);
    expect((a.comparecimento as Record<string, unknown>).pct_atual).toBe(
      Math.round((603 / 1050) * 100 * 1e5) / 1e5,
    );
    expect(p.votacao.contagens.validos).toBe(1000);
    expect(p.votacao.projetada).toEqual({ validos: 1000, brancos: 20, nulos: 30, abstencao: 190 });
    expect(p.votacao.corrida[0]?.votos).toBe(603);
    expect(p.participacao.abstencao.pct_atual).toBe(Math.round((190 / 990) * 100 * 1e5) / 1e5);
    expect(p.participacao.abstencao.pct_projetado).toBe(p.participacao.abstencao.pct_atual);
    // "Outros" = do 4º colocado em diante (55 + 14), soma dos % arredondados.
    expect(p.participacao.outros.pct_atual).toBe(4.6);
    expect(p.participacao.outros.n_candidatos).toBe(2);
  });

  it("anulada sai da base em disputa e mantém % sobre o total", () => {
    const comAnulada = parseTseAgregado(
      tseBruto([
        [13, 600],
        [22, 300],
        [70, 100, "Anulado"],
      ]),
    );
    const base = ufPayload();
    base.candidatos = base.candidatos.slice(0, 3);
    const p = aplicarTseUfPresidente(base, comAnulada);
    const porId = new Map(p.candidatos.map((c) => [c.id, c.pct_atual]));
    expect(porId.get(13)).toBeCloseTo(66.66667, 5);
    expect(porId.get(70)).toBe(10);
  });

  it("candidatura do TSE ausente no payload é erro, não chute", () => {
    const outro = parseTseAgregado(tseBruto([[99, 1]]));
    expect(() => aplicarTseUfPresidente(ufPayload(), outro)).toThrow(/99/);
  });
});

describe("Presidente nacional ← BR + UFs", () => {
  it("rank por voto oficial, por_uf refeito, margem colapsada", () => {
    const br = parseTseAgregado(
      tseBruto([
        [13, 900],
        [22, 1000],
      ]),
    );
    const ba = parseTseAgregado(
      tseBruto([
        [13, 603],
        [22, 301],
        [70, 50],
        [55, 40],
        [14, 6],
      ]),
    );
    const payload = {
      pct_apurado_total: 100,
      national: {
        candidatos: [
          {
            id: 13,
            votos_atuais: 899,
            pct_atual: 50,
            pct_projetado: 51,
            pct_projetado_lower: 49,
            pct_projetado_upper: 53,
            votos_projetados: 1,
            rank: 1,
            comparecimento: { pct_atual: null, pct_projetado: 40, lower: 39, upper: 41 },
          },
          {
            id: 22,
            votos_atuais: 990,
            pct_atual: 50,
            pct_projetado: 49,
            pct_projetado_lower: 47,
            pct_projetado_upper: 51,
            votos_projetados: 1,
            rank: 2,
            comparecimento: { pct_atual: null, pct_projetado: 40, lower: 39, upper: 41 },
          },
        ],
      },
      por_uf: [
        {
          sigla: "BA",
          pct_apurado: 100,
          lider: 13,
          margem_atual: 1,
          margem_projetada: 2,
          margem_projetada_ci: [1, 3],
          top_candidatos: [13, 22, 70, 55].map((id) => ({
            id,
            nome: `n${id}`,
            pct: 0,
            votos_atuais: 0,
            pct_atual: 0,
          })),
          outros: { pct: 0, pct_atual: 0, votos_atuais: 0, n_candidatos: 1 },
          votos_disputa_projetados: 1,
        },
      ],
      votacao: { contagens: {}, projetada: { validos: 0, brancos: 0, nulos: 0, abstencao: 0 } },
    };
    const p = igualarNacionalMajoritario(
      aplicarTseNacionalPresidente(payload, br, new Map([["BA", ba]])),
      { candidatosNacionais: true },
    );
    const [c1, c2] = p.national.candidatos;
    expect([c1?.id, c1?.rank, c1?.votos_atuais]).toEqual([22, 1, 1000]);
    expect([c2?.id, c2?.rank]).toEqual([13, 2]);
    expect(c1?.pct_projetado).toBe(c1?.pct_atual);
    expect(c1?.comparecimento.pct_atual).not.toBeNull();
    expect(c1?.comparecimento.lower).toBe(c1?.comparecimento.pct_atual);
    const l = p.por_uf[0];
    expect(l?.top_candidatos.map((c) => c.votos_atuais)).toEqual([603, 301, 50, 40]);
    expect(l?.top_candidatos[0]?.pct).toBe(60.3);
    expect(l?.outros).toEqual({ pct: 0.6, pct_atual: 0.6, votos_atuais: 6, n_candidatos: 1 });
    expect(l?.margem_atual).toBe(30.2);
    expect(l?.margem_projetada).toBe(30.2);
    expect(l?.margem_projetada_ci).toEqual([30.2, 30.2]);
    expect(l?.votos_disputa_projetados).toBe(1000);
  });
});

describe("igualar — demais cargos", () => {
  it("Gov/Sen nacional NÃO toca national.candidatos (união de 27 corridas)", () => {
    const p = {
      pct_apurado_total: 100,
      national: { candidatos: [{ pct_atual: 3.5, pct_projetado: 51.9 }] },
      por_uf: [],
    };
    const q = igualarNacionalMajoritario(p, { candidatosNacionais: false });
    expect(q.national.candidatos[0]?.pct_projetado).toBe(51.9);
  });

  it("abaixo de 100% nada muda", () => {
    const p = { ...ufPayload(), pct_apurado: 99.9 };
    expect(diffFolhas(p, igualarUfMajoritario(p))).toEqual([]);
  });

  it("Deputado: IC de cadeiras colapsa só onde não há cadeira indefinida", () => {
    const p = {
      pct_apurado_total: 100,
      bancada: {
        ufs_aguardando: 0,
        por_agremiacao: [
          { cadeiras: 121, cadeiras_indefinidas: 0, cadeiras_ci95: [116, 124] },
          { cadeiras: 3, cadeiras_indefinidas: 1, cadeiras_ci95: [2, 4] },
        ],
      },
    };
    const q = igualarDeputado(p);
    expect(q.bancada.por_agremiacao.map((a) => a.cadeiras_ci95)).toEqual([
      [121, 121],
      [2, 4],
    ]);
  });

  it("carimbo: ts novo, dado_ts do TSE, encerrado", () => {
    const q = carimbar(
      { ts: "a", dado_ts: "b" },
      "2026-10-05T12:00:00Z",
      "2026-10-05T05:59:31+00:00",
    );
    expect(q).toEqual({
      ts: "2026-10-05T12:00:00Z",
      dado_ts: "2026-10-05T05:59:31+00:00",
      encerrado: true,
    });
  });
});

describe("env por lista branca", () => {
  it("nunca inclui variável de banco", () => {
    for (const k of ENV_DO_FECHAMENTO) expect(k).not.toMatch(/DATABASE|POSTGRES|PG/);
  });
});
