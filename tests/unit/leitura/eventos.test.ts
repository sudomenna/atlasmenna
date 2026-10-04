import { describe, expect, it } from "vitest";
import type { EdgeCandidate, EdgePayload, EdgeUfRow } from "@/lib/edge-config/types";
import { derivarEventos, MARCOS, mesclarHistorico, resumirEstado } from "@/lib/leitura/eventos";
import type { EstadoResumo, EventoBoletim } from "@/lib/leitura/types";
import { EstadoResumoSchema, HISTORICO_MAX } from "@/lib/leitura/types";

const AGORA = "2026-10-04T21:00:00.000Z";
const SIGLAS = [
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

function cand(
  id: number,
  nome: string,
  partido: string,
  rank: number,
  pct_projetado: number,
  votos_atuais: number,
): EdgeCandidate {
  return {
    id,
    nome,
    partido,
    rank,
    pct_projetado,
    pct_projetado_lower: pct_projetado - 1.5,
    pct_projetado_upper: pct_projetado + 1.5,
    votos_atuais,
    votos_projetados: votos_atuais,
    pct_atual: pct_projetado,
    p_vitoria: 0,
    p_passa_2t: 0,
    p_fecha_1t: 0,
  } as EdgeCandidate;
}

const A = (votos = 1000, proj = 45) => cand(13, "LUIZ INÁCIO LULA DA SILVA", "PT", 1, proj, votos);
const B = (votos = 800, proj = 40) => cand(22, "FLÁVIO BOLSONARO", "PL", 2, proj, votos);

interface Opts {
  pct?: number;
  ufs?: number;
  ts?: string;
  turno?: 1 | 2;
  p2t?: number | null;
  chamadas?: Record<string, number>; // sigla → id do líder
  /** ids em `eleitos_definidos` de TODAS as UFs (Brasil definido, ADR do dono 04/10). */
  eleitos?: number[];
  cands?: EdgeCandidate[];
  pre?: boolean;
}

function payload(o: Opts = {}): EdgePayload {
  const cands = o.cands ?? [A(), B()];
  const por_uf = SIGLAS.map(
    (sigla) =>
      ({
        sigla,
        pct_apurado: o.pct ?? 0,
        lider: o.chamadas?.[sigla] ?? cands[0]?.id ?? 0,
        chamada: o.chamadas ? sigla in o.chamadas : false,
        ...(o.eleitos ? { eleitos_definidos: o.eleitos } : {}),
        top_candidatos: cands.map((c) => ({
          id: c.id,
          pct: c.pct_projetado,
          nome: c.nome,
          partido: c.partido,
        })),
      }) as unknown as EdgeUfRow,
  );
  return {
    ts: o.ts ?? "2026-10-04T20:59:00-03:00",
    cargo: 1,
    turno: o.turno ?? 1,
    pct_apurado_total: o.pct ?? 0,
    ufs_apuradas: o.ufs ?? 0,
    national: {
      candidatos: cands,
      p_segundo_turno_overall: o.p2t === undefined ? 0.6 : o.p2t,
    },
    por_uf,
    insights: [],
    composition: { pre_election: 0, model: 1, actual_results: 0 },
    ...(o.pre ? { fase: "pre_eleicao" as const } : {}),
  } as unknown as EdgePayload;
}

function estado(parcial: Partial<EstadoResumo> = {}): EstadoResumo {
  return {
    ts: "2026-10-04T20:50:00-03:00",
    pct: 30,
    ufs_apuradas: 20,
    lider_apurado_id: 13,
    lider_projecao_id: 13,
    p2t: 0.6,
    chamadas: [],
    marcos: [1, 5, 10, 25],
    ...parcial,
  };
}

const ids = (es: EventoBoletim[]) => es.map((e) => e.id);

describe("derivarEventos — sem apuração", () => {
  it("pré-eleição não gera evento, mesmo com % positivo, e preserva marcos/chamadas", () => {
    const ant = estado({ marcos: [1, 5], chamadas: ["SP"] });
    const r = derivarEventos(ant, payload({ pre: true, pct: 40, chamadas: { RJ: 13 } }), AGORA);
    expect(r.eventos).toEqual([]);
    expect(r.estado.marcos).toEqual([1, 5]);
    expect(r.estado.chamadas).toEqual(["SP"]);
    const r2 = derivarEventos(
      estado({ definidos: [22] }),
      payload({ pre: true, pct: 40, eleitos: [13] }),
      AGORA,
    );
    expect(r2.estado.definidos).toEqual([22]);
  });

  it("0% não gera evento (anterior null ou não)", () => {
    expect(derivarEventos(null, payload({ pct: 0 }), AGORA).eventos).toEqual([]);
    const r = derivarEventos(estado({ pct: 0, marcos: [] }), payload({ pct: 0 }), AGORA);
    expect(r.eventos).toEqual([]);
    expect(r.estado.marcos).toEqual([]);
  });
});

describe("derivarEventos — início e marcos", () => {
  it("de 0 para 30% gera só `inicio` e `marco-25`", () => {
    const ant = estado({
      pct: 0,
      marcos: [],
      lider_apurado_id: null,
      lider_projecao_id: null,
      ufs_apuradas: 0,
    });
    const r = derivarEventos(ant, payload({ pct: 30, ufs: 18 }), AGORA);
    expect(ids(r.eventos)).toEqual(["inicio", "marco-25"]);
    expect(r.eventos.every((e) => e.ts === AGORA)).toBe(true);
    expect(r.estado.marcos).toEqual([1, 5, 10, 25]);
    const marco = r.eventos[1] as EventoBoletim;
    expect(marco.head).toBe("Apuração");
    expect(marco.text).toBe(
      "30,0% das seções apuradas, com boletim em 18 de 27 unidades federativas.",
    );
  });

  it("rodar de novo com o mesmo estado não gera nada", () => {
    const ant = estado({
      pct: 0,
      marcos: [],
      lider_apurado_id: null,
      lider_projecao_id: null,
      ufs_apuradas: 0,
    });
    const p = payload({ pct: 30, ufs: 18, chamadas: { SP: 13 } });
    const r1 = derivarEventos(ant, p, AGORA);
    const r2 = derivarEventos(r1.estado, p, "2026-10-04T21:01:00.000Z");
    expect(r2.eventos).toEqual([]);
    expect(r2.estado).toEqual(r1.estado);
  });

  it("marco exatamente no limiar entra; um abaixo não", () => {
    expect(
      ids(derivarEventos(estado({ marcos: [1, 5, 10, 25] }), payload({ pct: 50 }), AGORA).eventos),
    ).toEqual(["marco-50"]);
    expect(
      derivarEventos(estado({ marcos: [1, 5, 10, 25] }), payload({ pct: 49.9 }), AGORA).eventos,
    ).toEqual([]);
  });

  it("MARCOS é a lista combinada", () => {
    expect([...MARCOS]).toEqual([1, 5, 10, 25, 50, 75, 90, 95, 99, 100]);
  });

  it("anterior null com % > 0 (Blob perdido): só `inicio` e o maior marco, chamadas vão para o estado", () => {
    const r = derivarEventos(
      null,
      payload({ pct: 60, ufs: 27, chamadas: { SP: 13, RJ: 22 }, p2t: 0.95 }),
      AGORA,
    );
    expect(ids(r.eventos)).toEqual(["inicio", "marco-50"]);
    expect(r.estado.chamadas).toEqual(["RJ", "SP"]);
    // Definido com o Blob perdido também vai só para o estado, sem linha.
    const r2 = derivarEventos(null, payload({ pct: 99, ufs: 27, eleitos: [13] }), AGORA);
    expect(ids(r2.eventos)).toEqual(["inicio", "marco-99"]);
    expect(r2.estado.definidos).toEqual([13]);
    expect(r.estado.marcos).toEqual([1, 5, 10, 25, 50]);
  });
});

describe("derivarEventos — lideranças", () => {
  it("troca de líder na contagem", () => {
    const r = derivarEventos(
      estado(),
      payload({ pct: 30, ufs: 20, cands: [A(800), B(1000)] }),
      AGORA,
    );
    expect(ids(r.eventos)).toEqual(["lideranca_apurado-22-2026-10-04T20:59:00-03:00"]);
    expect(r.eventos[0]?.head).toBe("Liderança");
    expect(r.eventos[0]?.text).toContain("FLÁVIO BOLSONARO (PL) passa à frente na contagem");
    expect(r.estado.lider_apurado_id).toBe(22);
  });

  it("troca de líder na projeção", () => {
    const a = cand(13, "LULA", "PT", 2, 44, 1000);
    const b = cand(22, "FLÁVIO BOLSONARO", "PL", 1, 46, 800);
    const r = derivarEventos(estado(), payload({ pct: 30, ufs: 20, cands: [a, b] }), AGORA);
    expect(ids(r.eventos)).toEqual(["lideranca_projecao-22-2026-10-04T20:59:00-03:00"]);
    expect(r.eventos[0]?.head).toBe("Projeção");
  });

  it("anterior com líder null não gera troca", () => {
    const r = derivarEventos(
      estado({ lider_apurado_id: null }),
      payload({ pct: 30, ufs: 20, cands: [A(800), B(1000)] }),
      AGORA,
    );
    expect(r.eventos).toEqual([]);
  });
});

describe("derivarEventos — chamadas, 2º turno, 27 UFs", () => {
  it("🔴 2026-10-04 — UF com `chamada` (projeção) e sem eleito definido: NENHUMA linha", () => {
    const r = derivarEventos(
      estado({ chamadas: ["RJ"] }),
      payload({ pct: 30, ufs: 20, chamadas: { RJ: 13, SP: 22, MG: 22, BA: 13 } }),
      AGORA,
    );
    expect(r.eventos).toEqual([]);
    for (const e of r.eventos) expect(e.text).not.toMatch(/chama/i);
    // O legado `chamadas` segue gravado (formato do estado), sem virar texto.
    expect(r.estado.chamadas).toEqual(["BA", "MG", "RJ", "SP"]);
    expect(r.estado.definidos).toEqual([]);
  });

  it("Brasil definido: UMA linha nacional, com o nome pelo id definido (não pelo líder projetado)", () => {
    // A (13) lidera a projeção e é o `lider` de toda UF; o definido é B (22).
    const r = derivarEventos(
      estado(),
      payload({ pct: 97, ufs: 27, eleitos: [22], chamadas: { SP: 13, RJ: 13 } }),
      AGORA,
    );
    const definidos = r.eventos.filter((e) => e.tipo === "eleito_definido");
    expect(definidos).toHaveLength(1);
    expect(definidos[0]).toMatchObject({
      id: "eleito_definido-22",
      head: "Definido",
      text: "FLÁVIO BOLSONARO (PL) matematicamente eleito pela contagem oficial do TSE.",
      ts: AGORA,
    });
    expect(r.eventos.some((e) => e.tipo === "chamada_uf")).toBe(false);
    expect(r.estado.definidos).toEqual([22]);
    // Ciclo seguinte, mesmo estado: nada de novo.
    const r2 = derivarEventos(
      r.estado,
      payload({ pct: 98, ufs: 27, eleitos: [22] }),
      "2026-10-04T21:01:00.000Z",
    );
    expect(r2.eventos.filter((e) => e.tipo === "eleito_definido")).toEqual([]);
  });

  it("estado gravado no formato ANTIGO (com `chamadas`, sem `definidos`) não gera rajada", () => {
    // 27 UFs chamadas pela projeção e nenhuma no estado antigo: o código antigo
    // soltaria 27 linhas "A projeção chama …". O novo não solta nenhuma.
    const todas = Object.fromEntries(SIGLAS.map((s) => [s, 13]));
    const antigo = estado({ chamadas: [] });
    expect("definidos" in antigo).toBe(false);
    const r = derivarEventos(antigo, payload({ pct: 30, ufs: 20, chamadas: todas }), AGORA);
    expect(r.eventos).toEqual([]);
    // Com o Brasil já definido no primeiro ciclo: UMA linha (fato), não 27.
    const r2 = derivarEventos(
      antigo,
      payload({ pct: 30, ufs: 20, chamadas: todas, eleitos: [13] }),
      AGORA,
    );
    expect(ids(r2.eventos)).toEqual(["eleito_definido-13"]);
  });

  it("estado antigo passa no schema (sem `definidos`) e o novo também", () => {
    const antigo = estado();
    expect(EstadoResumoSchema.safeParse(antigo).success).toBe(true);
    const novo = resumirEstado(payload({ pct: 30, ufs: 20, eleitos: [13] }), antigo);
    expect(EstadoResumoSchema.safeParse(novo).success).toBe(true);
    expect(novo.definidos).toEqual([13]);
  });

  it("P(2T) exatamente no limiar conta como cruzado; vários limiares no mesmo ciclo = só o maior", () => {
    const noLimiar = derivarEventos(
      estado({ p2t: 0.85 }),
      payload({ pct: 30, ufs: 20, p2t: 0.9 }),
      AGORA,
    );
    expect(ids(noLimiar.eventos)).toEqual(["segundo_turno-0.9-sobe"]);
    const salto = derivarEventos(
      estado({ p2t: 0.4 }),
      payload({ pct: 30, ufs: 20, p2t: 0.995 }),
      AGORA,
    );
    expect(ids(salto.eventos)).toEqual(["segundo_turno-0.99-sobe"]);
  });

  it("P(2T) cruzando 0,9 para cima", () => {
    const r = derivarEventos(
      estado({ p2t: 0.85 }),
      payload({ pct: 30, ufs: 20, p2t: 0.92 }),
      AGORA,
    );
    expect(ids(r.eventos)).toEqual(["segundo_turno-0.9-sobe"]);
    expect(r.eventos[0]?.text).toBe(
      "A projeção passa a indicar 92,0% de chance de segundo turno (acima de 90%).",
    );
  });

  it("P(2T) cruzando 0,5 para baixo; nada no turno 2", () => {
    expect(
      ids(
        derivarEventos(estado({ p2t: 0.55 }), payload({ pct: 30, ufs: 20, p2t: 0.45 }), AGORA)
          .eventos,
      ),
    ).toEqual(["segundo_turno-0.5-desce"]);
    expect(
      derivarEventos(
        estado({ p2t: 0.85 }),
        payload({ pct: 30, ufs: 20, p2t: 0.92, turno: 2 }),
        AGORA,
      ).eventos,
    ).toEqual([]);
  });

  it("27 UFs gera `todas_ufs` uma vez", () => {
    const r = derivarEventos(estado({ ufs_apuradas: 26 }), payload({ pct: 30, ufs: 27 }), AGORA);
    expect(ids(r.eventos)).toEqual(["todas_ufs"]);
    expect(derivarEventos(r.estado, payload({ pct: 30, ufs: 27 }), AGORA).eventos).toEqual([]);
  });

  it("nenhum texto usa adjetivo de julgamento", () => {
    const r = derivarEventos(
      estado({ pct: 0, marcos: [], ufs_apuradas: 0 }),
      payload({ pct: 100, ufs: 27, chamadas: { SP: 13 }, cands: [A(800), B(1000)], p2t: 0.995 }),
      AGORA,
    );
    for (const e of r.eventos) expect(e.text).not.toMatch(/expressiv|esmagador|consolid/i);
  });
});

describe("resumirEstado", () => {
  it("marcos e chamadas são cumulativos", () => {
    const s = resumirEstado(
      payload({ pct: 12, ufs: 5, chamadas: { BA: 13 } }),
      estado({ marcos: [1], chamadas: ["SP"] }),
    );
    expect(s.marcos).toEqual([1, 5, 10]);
    expect(s.chamadas).toEqual(["BA", "SP"]);
    expect(s.lider_apurado_id).toBe(13);
    expect(s.lider_projecao_id).toBe(13);
    expect(s.p2t).toBe(0.6);
  });
});

describe("mesclarHistorico", () => {
  const ev = (id: string, ts: string): EventoBoletim => ({
    id,
    ts,
    head: "H",
    text: id,
    tipo: "marco",
  });

  it("id repetido mantém o ts mais antigo", () => {
    const r = mesclarHistorico(
      [ev("marco-50", "2026-10-04T21:00:00Z")],
      [ev("marco-50", "2026-10-04T21:05:00Z"), ev("todas_ufs", "2026-10-04T21:05:00Z")],
    );
    expect(r.map((e) => [e.id, e.ts])).toEqual([
      ["todas_ufs", "2026-10-04T21:05:00Z"],
      ["marco-50", "2026-10-04T21:00:00Z"],
    ]);
    // o mais antigo vence também quando chega depois na lista
    const r2 = mesclarHistorico(
      [ev("x", "2026-10-04T22:00:00Z")],
      [ev("x", "2026-10-04T20:00:00Z")],
    );
    expect(r2[0]?.ts).toBe("2026-10-04T20:00:00Z");
  });

  it("ordena do mais novo para o mais antigo, empate por id, e limita a 40", () => {
    const existentes = Array.from({ length: 30 }, (_, i) =>
      ev(`e${String(i).padStart(2, "0")}`, new Date(Date.UTC(2026, 9, 4, 20, i)).toISOString()),
    );
    const novos = Array.from({ length: 15 }, (_, i) =>
      ev(`n${String(i).padStart(2, "0")}`, "2026-10-05T01:00:00.000Z"),
    );
    const r = mesclarHistorico(existentes, novos);
    expect(r).toHaveLength(HISTORICO_MAX);
    expect(r.slice(0, 15).map((e) => e.id)).toEqual(novos.map((e) => e.id)); // empate → id crescente
    expect(r[15]?.id).toBe("e29");
    for (let i = 1; i < r.length; i++) {
      expect(Date.parse(r[i - 1]?.ts as string)).toBeGreaterThanOrEqual(
        Date.parse(r[i]?.ts as string),
      );
    }
    expect(r.at(-1)?.id).toBe("e05");
  });
});
