/**
 * tests/unit/components/palanques-logica.test.ts
 *
 * A lógica pura do mapa dos palanques (`components/blocks/_palanques.ts`, V3 do
 * plano de 29/09; etiqueta de palanque = RF-220/225 da spec 024):
 *
 *   - casado / dividido / não se aplica — tabela COMPLETA (palanque × líder);
 *   - identidade do líder presidencial por `sqcand` (nunca por nome/partido);
 *   - a cola payload → props: quem lidera em cada base, sem ler `row.lider`.
 */

import { describe, expect, it, vi } from "vitest";

import {
  type BasePalanques,
  type Casamento,
  casamento,
  type PalanquesUf,
  type PalanqueValor,
  type PresidentePalanque,
  palanqueDaResolucao,
  palanquesDaBase,
  palanqueValido,
  presidenteDoTop,
  quemDisputaNaBase,
  resumoCasamento,
  SQCAND_FLAVIO_BOLSONARO,
  SQCAND_LULA,
} from "@/components/blocks/_palanques";
import { UF_LIST } from "@/lib/data/uf-hex-layout";
import type { EdgeUfRow } from "@/lib/edge-config/types";
import type { Resolucao } from "@/lib/etiquetas/resolver";

const LULA: PresidentePalanque = { lider: "lula" };
const FLAVIO: PresidentePalanque = { lider: "flavio_bolsonaro" };
const OUTRO: PresidentePalanque = { lider: "outro", nome: "CAIADO" };

describe("casamento — a regra do dono (palanque duplo conta como casado com qualquer líder)", () => {
  const TABELA: Array<[string, PresidentePalanque | null, Casamento]> = [
    ["palanque_lula", LULA, "casado"],
    ["palanque_lula", FLAVIO, "dividido"],
    ["palanque_lula", OUTRO, "nao_se_aplica"],
    ["palanque_lula", null, "nao_se_aplica"],
    ["palanque_flavio_bolsonaro", FLAVIO, "casado"],
    ["palanque_flavio_bolsonaro", LULA, "dividido"],
    ["palanque_flavio_bolsonaro", OUTRO, "nao_se_aplica"],
    ["palanque_flavio_bolsonaro", null, "nao_se_aplica"],
    // 🔴 duplo: casado com Lula E com Flávio; nunca dividido.
    ["palanque_duplo", LULA, "casado"],
    ["palanque_duplo", FLAVIO, "casado"],
    ["palanque_duplo", OUTRO, "nao_se_aplica"],
    ["palanque_duplo", null, "nao_se_aplica"],
    ["sem_palanque_declarado", LULA, "nao_se_aplica"],
    ["sem_palanque_declarado", FLAVIO, "nao_se_aplica"],
    ["sem_palanque_declarado", OUTRO, "nao_se_aplica"],
    ["a_classificar", LULA, "nao_se_aplica"],
    ["a_classificar", FLAVIO, "nao_se_aplica"],
    // valor de um catálogo mais novo que o deploy: nunca "dividido"
    ["palanque_do_futuro", LULA, "nao_se_aplica"],
    ["palanque_do_futuro", FLAVIO, "nao_se_aplica"],
  ];

  for (const [palanque, presidente, esperado] of TABELA) {
    it(`${palanque} × ${presidente?.lider ?? "sem leitura"} → ${esperado}`, () => {
      expect(casamento(palanque, presidente)).toBe(esperado);
    });
  }

  it("palanque ausente ou nulo → não se aplica", () => {
    expect(casamento(undefined, LULA)).toBe("nao_se_aplica");
    expect(casamento(null, FLAVIO)).toBe("nao_se_aplica");
    expect(casamento("palanque_lula", undefined)).toBe("nao_se_aplica");
  });
});

describe("palanqueValido / palanqueDaResolucao — a sentinela nunca vaza", () => {
  it("valor do catálogo passa; o resto vira a_classificar", () => {
    expect(palanqueValido("palanque_lula")).toBe("palanque_lula");
    expect(palanqueValido("sem_palanque_declarado")).toBe("sem_palanque_declarado");
    for (const v of ["a_classificar", "", null, undefined, "palanque_do_futuro", "lula"]) {
      expect(palanqueValido(v), String(v)).toBe("a_classificar");
    }
  });

  const classificado = (valor: string): Resolucao => ({
    estado: "classificado",
    etiqueta: {
      categoria: "palanque_presidencial",
      valor,
      rotulo: null,
      origem: "individual",
      chave_origem: "250002549705",
      fonte_url: "https://exemplo.org",
      fonte_descricao: "d",
      data: "2026-09-20",
    },
  });

  it("só `classificado` com valor do catálogo vira valor", () => {
    expect(palanqueDaResolucao(classificado("palanque_duplo"))).toBe("palanque_duplo");
    expect(palanqueDaResolucao(classificado("valor_novo"))).toBe("a_classificar");
    expect(palanqueDaResolucao({ estado: "a_classificar" })).toBe("a_classificar");
    expect(palanqueDaResolucao({ estado: "nao_se_aplica" })).toBe("a_classificar");
    expect(palanqueDaResolucao(undefined)).toBe("a_classificar");
    expect(palanqueDaResolucao(null)).toBe("a_classificar");
  });
});

describe("presidenteDoTop — identidade por sqcand, nunca por nome ou partido", () => {
  it("Lula e Flávio Bolsonaro pelo SQ_CANDIDATO do TSE (string ou número)", () => {
    expect(SQCAND_LULA).toBe("280002542548");
    expect(SQCAND_FLAVIO_BOLSONARO).toBe("280002551544");
    expect(presidenteDoTop({ id: 13, nome: "LULA", sqcand: SQCAND_LULA })).toEqual({
      lider: "lula",
    });
    expect(presidenteDoTop({ id: 22, nome: "X", sqcand: SQCAND_FLAVIO_BOLSONARO })).toEqual({
      lider: "flavio_bolsonaro",
    });
    expect(presidenteDoTop({ id: 13, sqcand: 280002542548 as unknown as string })).toEqual({
      lider: "lula",
    });
  });

  it("outro candidato: 'outro' com o nome de exibição", () => {
    expect(presidenteDoTop({ id: 55, nome: "RONALDO CAIADO", sqcand: "280002551932" })).toEqual({
      lider: "outro",
      nome: "CAIADO",
    });
    expect(presidenteDoTop({ id: 30, nome: "ZEMA", sqcand: "280002539826" })).toEqual({
      lider: "outro",
      nome: "ZEMA",
    });
  });

  it("🔴 nome 'LULA' e partido PT sem sqcand NÃO identificam: identidade desconhecida é null, nunca 'outro'", () => {
    expect(presidenteDoTop({ id: 13, nome: "LULA" })).toBeNull();
    expect(presidenteDoTop({ id: 13, nome: "LULA", sqcand: "" })).toBeNull();
    expect(presidenteDoTop({ id: 13, nome: "LULA", sqcand: "0" })).toBeNull();
    expect(presidenteDoTop({ id: 13, nome: "LULA", sqcand: "abc" })).toBeNull();
    expect(presidenteDoTop(undefined)).toBeNull();
    expect(presidenteDoTop(null)).toBeNull();
  });

  it("um LULA com sqcand de outra pessoa é 'outro' (o nome não decide)", () => {
    expect(presidenteDoTop({ id: 13, nome: "LULA", sqcand: "1234567890" })).toMatchObject({
      lider: "outro",
    });
  });
});

// ---------------------------------------------------------------------------
// Cola payload → props
// ---------------------------------------------------------------------------

interface T {
  id: number;
  pct: number;
  pct_atual?: number;
  sqcand?: string;
  nome?: string;
  partido?: string;
  destino?: "anulado" | "sub_judice";
}

function row(sigla: string, top: T[], over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla,
    pct_apurado: 40,
    lider: top[0]?.id ?? 0,
    margem_atual: 5,
    margem_projetada: 5,
    margem_projetada_ci: [3, 7],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: top,
    vai_a_2t: null,
    bucket: "indefinido",
    ...over,
  };
}

const A: T = {
  id: 10,
  pct: 45,
  pct_atual: 30,
  sqcand: "250002000010",
  nome: "ALFA UM",
  partido: "PSD",
};
const B: T = {
  id: 20,
  pct: 35,
  pct_atual: 40,
  sqcand: "250002000020",
  nome: "BETA DOIS",
  partido: "PT",
};
const C: T = {
  id: 30,
  pct: 15,
  pct_atual: 20,
  sqcand: "250002000030",
  nome: "GAMA TRES",
  partido: "PL",
};

const PALANQUES: Record<string, PalanqueValor> = {
  "250002000010": "palanque_flavio_bolsonaro",
  "250002000020": "palanque_lula",
  "250002000030": "palanque_duplo",
};
const palanqueDe = (sq: string): PalanqueValor => PALANQUES[sq] ?? "a_classificar";

const PRES_LULA: T = { id: 13, pct: 60, pct_atual: 45, sqcand: SQCAND_LULA, nome: "LULA" };
const PRES_FLA: T = {
  id: 22,
  pct: 40,
  pct_atual: 55,
  sqcand: SQCAND_FLAVIO_BOLSONARO,
  nome: "FLAVIO BOLSONARO",
};

function base(b: BasePalanques, over: Partial<Parameters<typeof palanquesDaBase>[0]> = {}) {
  return palanquesDaBase({
    base: b,
    turno: 1,
    governador: [row("SP", [A, B, C])],
    presidente: [row("SP", [PRES_LULA, PRES_FLA])],
    palanqueDe,
    ...over,
  });
}

const sp = (l: PalanquesUf[]) => l.find((u) => u.uf === "SP") as PalanquesUf;

describe("palanquesDaBase — quem lidera em cada base", () => {
  it("sempre as 27 UFs, na ordem do layout; UF ausente do payload = sem leitura, não some", () => {
    const l = base("proj");
    expect(l.map((u) => u.uf)).toEqual([...UF_LIST]);
    const ac = l.find((u) => u.uf === "AC") as PalanquesUf;
    expect(ac.governador).toBeNull();
    expect(ac.presidente).toBeNull();
  });

  it("Projeção: o líder é o de maior `pct`; o palanque vem do leitor pelo sqcand", () => {
    expect(sp(base("proj")).governador).toEqual({
      sqcand: "250002000010",
      nome: "ALFA UM",
      partido: "PSD",
      palanque: "palanque_flavio_bolsonaro",
    });
  });

  it("Parcial: o líder é o de maior `pct_atual` — outro candidato, outro palanque", () => {
    const u = sp(base("parcial"));
    expect(u.governador?.sqcand).toBe("250002000020");
    expect(u.governador?.palanque).toBe("palanque_lula");
  });

  it("o líder presidencial também segue a base (Projeção: Lula; Parcial: Flávio)", () => {
    expect(sp(base("proj")).presidente).toEqual({ lider: "lula" });
    expect(sp(base("parcial")).presidente).toEqual({ lider: "flavio_bolsonaro" });
  });

  it("🔴 nunca lê `row.lider`: com `lider` apontando para outro id, a ordem de top_candidatos decide", () => {
    const l = base("proj", { governador: [row("SP", [A, B, C], { lider: B.id })] });
    expect(sp(l).governador?.sqcand).toBe("250002000010");
  });

  it("Parcial sem leitura honesta é null — nunca o líder do modelo sob o rótulo 'contagem'", () => {
    const semApuracao = base("parcial", { governador: [row("SP", [A, B, C], { pct_apurado: 0 })] });
    expect(sp(semApuracao).governador).toBeNull();
    // falta pct_atual a alguém do corte: `ordenarTopCandidatosPorBase` cairia na ordem de projeção
    const incompleto = base("parcial", {
      governador: [row("SP", [A, { ...B, pct_atual: undefined }, C])],
    });
    expect(sp(incompleto).governador).toBeNull();
    // e na Projeção o mesmo dado tem líder
    expect(
      sp(
        base("proj", {
          governador: [row("SP", [A, { ...B, pct_atual: undefined }, C])],
        }),
      ).governador?.sqcand,
    ).toBe("250002000010");
  });

  it("candidatura anulada nunca lidera (ADR-0053)", () => {
    const l = base("proj", { governador: [row("SP", [{ ...A, destino: "anulado" }, B, C])] });
    expect(sp(l).governador?.sqcand).toBe("250002000020");
  });

  it("linha sem top_candidatos não tem identidade: sem leitura", () => {
    expect(sp(base("proj", { governador: [row("SP", [])] })).governador).toBeNull();
    expect(quemDisputaNaBase(undefined, "proj")).toBeNull();
    expect(quemDisputaNaBase(row("SP", []), "parcial")).toBeNull();
  });

  it("sqcand ausente conta como não classificado — e o leitor nem é consultado", () => {
    const espiao = vi.fn(palanqueDe);
    const { sqcand: _omitido, ...semSqcand } = A;
    const l = base("proj", { governador: [row("SP", [semSqcand, B])], palanqueDe: espiao });
    expect(sp(l).governador).toMatchObject({ sqcand: null, palanque: "a_classificar" });
    expect(espiao).not.toHaveBeenCalled();
  });

  it("valor inválido devolvido pelo leitor vira a_classificar", () => {
    const l = base("proj", { palanqueDe: () => "palanque_do_futuro" as PalanqueValor });
    expect(sp(l).governador?.palanque).toBe("a_classificar");
  });

  it("nome sem `nome` no payload cai em 'Cand {id}' (contrato do RF-144)", () => {
    const { nome: _n, ...semNome } = A;
    expect(sp(base("proj", { governador: [row("SP", [semNome, B])] })).governador?.nome).toBe(
      "Cand 10",
    );
  });

  it("finalistas só no 2º turno: os dois primeiros que competem, na ordem da base", () => {
    expect(sp(base("proj")).finalistas).toBeUndefined();
    const dois = sp(base("proj", { turno: 2 }));
    expect(dois.finalistas?.map((f) => f.sqcand)).toEqual(["250002000010", "250002000020"]);
    const parcial = sp(base("parcial", { turno: 2 }));
    expect(parcial.finalistas?.map((f) => f.sqcand)).toEqual(["250002000020", "250002000010"]);
  });
});

describe("resumoCasamento", () => {
  const u = (
    uf: string,
    palanque: PalanqueValor | null,
    presidente: PresidentePalanque | null,
  ): PalanquesUf => ({
    uf,
    governador: palanque ? { sqcand: "1", nome: "N", partido: null, palanque } : null,
    presidente,
  });

  it("conta casado, dividido e não se aplica — só entre estados COM palanque classificado", () => {
    const r = resumoCasamento([
      u("SP", "palanque_lula", LULA), // casado
      u("RJ", "palanque_duplo", FLAVIO), // casado
      u("MG", "palanque_lula", FLAVIO), // dividido
      u("BA", "sem_palanque_declarado", LULA), // n/a
      u("PR", "palanque_lula", OUTRO), // n/a
      u("AC", "a_classificar", LULA), // fora de conta
      u("AL", null, LULA), // fora de conta (sem leitura)
    ]);
    expect(r).toEqual({ casado: 2, dividido: 1, naoSeAplica: 2 });
  });

  it("sigla repetida conta uma vez (a primeira); sigla desconhecida é ignorada", () => {
    const r = resumoCasamento([
      u("SP", "palanque_lula", LULA),
      u("sp", "palanque_lula", FLAVIO),
      u("XX", "palanque_lula", LULA),
    ]);
    expect(r).toEqual({ casado: 1, dividido: 0, naoSeAplica: 0 });
  });
});
