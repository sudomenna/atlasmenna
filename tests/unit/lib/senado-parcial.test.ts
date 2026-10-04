/**
 * tests/unit/lib/senado-parcial.test.ts — as vagas do Senado "se a apuração
 * parasse agora" (decisão do dono, 04/10/2026). `lib/utils/senado-parcial.ts`.
 *
 * Todo caso monta a corrida com a ORDEM DA PROJEÇÃO diferente da do APURADO:
 * um caso em que as duas concordam passaria com a função lendo `pct` no lugar
 * de `pct_atual`, e é essa a mutação mais provável.
 */

import { describe, expect, it } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";
import { MANDATO_2031, UFS_DO_SENADO } from "@/lib/senado/mandato-2031";
import { derivarSenado2027, PCT_UF_CONCLUIDA, textoDoPartido } from "@/lib/utils/senado-2027";
import {
  composicaoNaParcial,
  PCT_UF_CONCLUIDA_PARCIAL,
  vagasDaUfNaParcial,
  vagasNaParcial,
} from "@/lib/utils/senado-parcial";
import { cand, payloadSenado, ufRow } from "@/tests/fixtures/senado/payload-senado";

const VAGAS = 2;

/** SP 50% apurado: a projeção põe PT, PL, MDB; o apurado põe MDB, PT, PL. */
function sp(over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    ...ufRow("SP", 50, [
      cand(1, "PT", 40, { pct_atual: 33 }),
      cand(2, "PL", 30, { pct_atual: 20 }),
      cand(3, "MDB", 25, { pct_atual: 41 }),
    ]),
    ...over,
  };
}

const ids = (row: EdgeUfRow) => vagasDaUfNaParcial(row, VAGAS).ocupantes.map((c) => c.id);

describe("vagasDaUfNaParcial — UF a UF", () => {
  it("🔴 os 2 mais votados ATÉ AQUI, não os 2 da projeção", () => {
    const r = vagasDaUfNaParcial(sp(), VAGAS);
    expect(r.estado).toBe("parcial");
    expect(r.ocupantes.map((c) => c.id)).toEqual([3, 1]);
  });

  it("resgatado do RF-190 (fora do prefixo de 4 da projeção) entra se é dos 2 do apurado", () => {
    const row = ufRow("SP", 30, [
      cand(1, "PT", 40, { pct_atual: 20 }),
      cand(2, "PL", 30, { pct_atual: 15 }),
      cand(3, "MDB", 15, { pct_atual: 10 }),
      cand(4, "PSD", 10, { pct_atual: 5 }),
      cand(9, "NOVO", 3, { pct_atual: 45 }), // índice 4: resgatado pelo apurado
    ]);
    expect(ids(row)).toEqual([9, 1]);
  });

  it("empate de `pct_atual`: desempata por `pct_projetado`, depois `id` — determinístico", () => {
    const porProjecao = ufRow("SP", 50, [
      cand(7, "PT", 30, { pct_atual: 35 }),
      cand(5, "PL", 40, { pct_atual: 35 }),
      cand(6, "MDB", 20, { pct_atual: 30 }),
    ]);
    expect(ids(porProjecao)).toEqual([5, 7]);
    const porId = ufRow("SP", 50, [
      cand(7, "PT", 30, { pct_atual: 30 }),
      cand(5, "PL", 30, { pct_atual: 30 }),
      cand(6, "MDB", 30, { pct_atual: 30 }),
    ]);
    expect(ids(porId)).toEqual([5, 6]);
    // A ordem de chegada do array não muda o resultado.
    expect(ids({ ...porId, top_candidatos: [...porId.top_candidatos].reverse() })).toEqual([5, 6]);
  });

  it("🔴 sem apurado (0 ou ausente) ⇒ aguardando, nunca contado", () => {
    expect(vagasDaUfNaParcial(sp({ pct_apurado: 0 }), VAGAS)).toEqual({
      estado: "aguardando",
      ocupantes: [],
    });
    expect(vagasDaUfNaParcial(sp({ pct_apurado: Number.NaN }), VAGAS).estado).toBe("aguardando");
  });

  it("🔴 falta `pct_atual` a alguém do corte ⇒ aguardando (ausente ≠ 0)", () => {
    const row = sp();
    const semUm = {
      ...row,
      top_candidatos: row.top_candidatos.map((t) =>
        t.id === 2 ? { id: t.id, pct: t.pct, partido: t.partido } : t,
      ),
    };
    expect(vagasDaUfNaParcial(semUm, VAGAS).estado).toBe("aguardando");
  });

  it("ocupante com `pct_atual` 0 ⇒ aguardando (desempate de zeros não é voto)", () => {
    const row = ufRow("SP", 1, [
      cand(1, "PT", 40, { pct_atual: 100 }),
      cand(2, "PL", 30, { pct_atual: 0 }),
      cand(3, "MDB", 25, { pct_atual: 0 }),
    ]);
    expect(vagasDaUfNaParcial(row, VAGAS).estado).toBe("aguardando");
  });

  it("🔴 UF concluída (100%) ⇒ `decidida`, com os MESMOS ocupantes da projeção", () => {
    const row = sp({ pct_apurado: 100 });
    const r = vagasDaUfNaParcial(row, VAGAS);
    expect(r.estado).toBe("decidida");
    expect(r.ocupantes.map((c) => c.id)).toEqual([1, 2]);
    expect(PCT_UF_CONCLUIDA_PARCIAL).toBe(PCT_UF_CONCLUIDA);
  });

  it("anulada não ocupa vaga — e sem cauda (`outros` ausente) a conta é demonstrável", () => {
    const row = ufRow("MG", 40, [
      cand(1, "PT", 40, { pct_atual: 30 }),
      cand(2, "PSOL", 30, { pct_atual: 35, destino: "anulado" }),
      cand(3, "PL", 25, { pct_atual: 25 }),
    ]);
    expect(ids(row)).toEqual([1, 3]);
  });

  it("🔴 anulada no corte + cauda: só conta quem passa da SOMA da cauda", () => {
    const base = ufRow("MG", 40, [
      cand(1, "PT", 40, { pct_atual: 30 }),
      cand(2, "PSOL", 30, { pct_atual: 35, destino: "anulado" }),
      cand(3, "PL", 25, { pct_atual: 12 }),
    ]);
    // A cauda soma 12: alguém dela pode ter os 12 inteiros e empatar o PL.
    const empata = { ...base, outros: { pct: 5, pct_atual: 12, n_candidatos: 3 } };
    expect(vagasDaUfNaParcial(empata, VAGAS).estado).toBe("aguardando");
    // A cauda soma 11,9: ninguém dela chega aos 12 do PL.
    const abaixo = { ...base, outros: { pct: 5, pct_atual: 11.9, n_candidatos: 3 } };
    expect(ids(abaixo)).toEqual([1, 3]);
    // Cauda sem `pct_atual`: não dá para provar nada.
    const semMedida = { ...base, outros: { pct: 5, n_candidatos: 3 } };
    expect(vagasDaUfNaParcial(semMedida, VAGAS).estado).toBe("aguardando");
  });

  it("sem anulada no corte, a cauda não importa: os 2 do apurado estão garantidos no array", () => {
    const row = { ...sp(), outros: { pct: 5, pct_atual: 50, n_candidatos: 4 } };
    expect(ids(row)).toEqual([3, 1]);
  });

  it("menos ocupantes que vagas com cauda presente ⇒ aguardando", () => {
    const row = {
      ...ufRow("AC", 20, [cand(1, "PT", 60, { pct_atual: 55 })]),
      outros: { pct: 40, pct_atual: 45, n_candidatos: 2 },
    };
    expect(vagasDaUfNaParcial(row, VAGAS).estado).toBe("aguardando");
  });

  it("não muta a entrada (constituição § 6)", () => {
    const row = sp();
    const copia = structuredClone(row);
    vagasDaUfNaParcial(row, VAGAS);
    expect(row).toEqual(copia);
  });
});

describe("vagasNaParcial / composicaoNaParcial — as 54", () => {
  /** As 27 UFs, cada uma com o PT 1º na projeção e o PL 1º no apurado. */
  function vinteSete(): EdgeUfRow[] {
    return UFS_DO_SENADO.map((uf, i) =>
      ufRow(uf, 50, [
        cand(i * 10 + 1, "PT", 40, { pct_atual: 30 }),
        cand(i * 10 + 2, "MDB", 35, { pct_atual: 10 }),
        cand(i * 10 + 3, "PL", 20, { pct_atual: 45 }),
      ]),
    );
  }

  it("🔴 27 UFs apuradas ⇒ 54 vagas, somadas por partido pelo apurado", () => {
    const c = composicaoNaParcial(vinteSete(), VAGAS, 54);
    expect(c.porPartido).toEqual([
      { partido: "PL", vagas: 27 },
      { partido: "PT", vagas: 27 },
    ]);
    expect(c.atribuidas).toBe(54);
    expect(c.aguardando).toBe(0);
  });

  it("🔴 a soma nunca passa de 54: UF repetida conta UMA vez (a 1ª), sigla fora das 27 é ignorada", () => {
    const rows = vinteSete();
    // A repetição do AC traz OUTROS partidos: se ela substituísse a 1ª
    // ocorrência, NOVO/PSOL apareceriam na soma.
    const acDeNovo = ufRow("AC", 50, [
      cand(901, "NOVO", 40, { pct_atual: 40 }),
      cand(902, "PSOL", 30, { pct_atual: 30 }),
    ]);
    const dup = [...rows, acDeNovo, { ...(rows[1] as EdgeUfRow), sigla: "XX" }];
    const c = composicaoNaParcial(dup, VAGAS, 54);
    expect(c.atribuidas).toBe(54);
    expect(c.porPartido).toEqual([
      { partido: "PL", vagas: 27 },
      { partido: "PT", vagas: 27 },
    ]);
    expect(new Set(vagasNaParcial(dup, VAGAS).map((v) => v.uf)).size).toBe(27);
  });

  it("UF sem apurado e UF ausente ⇒ aguardando; concluída ⇒ igual à projeção", () => {
    const c = composicaoNaParcial(
      [sp(), sp({ sigla: "RJ", pct_apurado: 0 }), sp({ sigla: "MG", pct_apurado: 100 })],
      VAGAS,
      54,
    );
    // SP pelo apurado (MDB, PT); MG concluída pela projeção (PT, PL); RJ e as
    // 24 ausentes aguardando.
    expect(c.porPartido).toEqual([
      { partido: "PT", vagas: 2 },
      { partido: "MDB", vagas: 1 },
      { partido: "PL", vagas: 1 },
    ]);
    expect(c.atribuidas).toBe(4);
    expect(c.aguardando).toBe(50);
    expect(vagasNaParcial([sp({ sigla: "MG", pct_apurado: 100 })], VAGAS)[0]?.estado).toBe(
      "decidida",
    );
  });

  it("nada apurado em lugar nenhum ⇒ zero atribuídas, 54 aguardando — sem partido inventado", () => {
    const c = composicaoNaParcial(
      vinteSete().map((r) => ({ ...r, pct_apurado: 0 })),
      VAGAS,
      54,
    );
    expect(c).toEqual({ porPartido: [], atribuidas: 0, aguardando: 54, vagasEmDisputa: 54 });
  });

  it("ordem: vagas desc, depois sigla em code units (sem locale)", () => {
    const rows = [
      ufRow("AC", 50, [
        cand(1, "UNIÃO", 40, { pct_atual: 40 }),
        cand(2, "PT", 30, { pct_atual: 30 }),
      ]),
      ufRow("AL", 50, [
        cand(3, "PL", 40, { pct_atual: 40 }),
        cand(4, "MDB", 30, { pct_atual: 30 }),
      ]),
    ];
    expect(composicaoNaParcial(rows, VAGAS, 54).porPartido.map((p) => p.partido)).toEqual([
      "MDB",
      "PL",
      "PT",
      "UNIÃO",
    ]);
  });

  it("mesmo payload ⇒ mesma saída (determinismo)", () => {
    expect(composicaoNaParcial(vinteSete(), VAGAS, 54)).toEqual(
      composicaoNaParcial(vinteSete(), VAGAS, 54),
    );
  });
});

describe("derivarSenado2027(…, 'parcial') — o hemiciclo da Parcial", () => {
  const payload = () =>
    payloadSenado(
      [sp(), sp({ sigla: "RJ", pct_apurado: 100 }), sp({ sigla: "MG", pct_apurado: 0 })],
      // A composição publicada é a da PROJEÇÃO: SP, RJ e MG, PT + PL cada
      // (o produtor atribui vaga a toda UF presente em `por_uf`).
      [
        { partido: "PL", vagas: 3 },
        { partido: "PT", vagas: 3 },
      ],
    );

  it("🔴 as 54 pela contagem; as 27 que continuam e a UF concluída, iguais à projeção", () => {
    const proj = derivarSenado2027(payload(), MANDATO_2031);
    const parcial = derivarSenado2027(payload(), MANDATO_2031, "parcial");
    if (!proj.ok || !parcial.ok) throw new Error("derivação recusada");
    expect(proj.senado.base).toBe("proj");
    expect(parcial.senado.base).toBe("parcial");
    expect(parcial.senado.total).toBe(81);
    expect(parcial.senado.contagem).toEqual({
      continua_2031: proj.senado.contagem.continua_2031,
      decidida: 2, // RJ
      projetada: 2, // SP, pela contagem
      aguardando: 50,
    });
    const sp2026 = parcial.senado.vagas.filter((v) => v.uf === "SP").map((v) => v.sigla);
    expect(sp2026).toEqual(["MDB", "PT"]);
    const rj = (r: typeof proj) => (r.ok ? r.senado.vagas.filter((v) => v.uf === "RJ") : []);
    expect(rj(parcial).map((v) => [v.estado, v.sigla])).toEqual(
      rj(proj).map((v) => [v.estado, v.sigla]),
    );
  });

  it("a lista textual diz a base: '(parcial)', nunca '(projeção)' — e nunca 'eleito'", () => {
    const r = derivarSenado2027(payload(), MANDATO_2031, "parcial");
    if (!r.ok) throw new Error("derivação recusada");
    const textos = r.senado.partidos.map((p) => textoDoPartido(p, r.senado.base));
    expect(textos.join(" ")).toContain("(parcial)");
    expect(textos.join(" ")).not.toContain("(projeção)");
    expect(textos.join(" ")).not.toMatch(/eleit/i);
  });
});
