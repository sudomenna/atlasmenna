/**
 * tests/unit/utils/consolidado-regiao.test.ts — ADR-0057 itens 3 e 4.
 *
 * Os números são escolhidos para que cada regra MUDE o resultado se for
 * quebrada: anulada com muito voto (sair ou não da soma move o líder), cauda
 * `outros` grande (creditá-la a alguém muda a ordem), total projetado desigual
 * entre UFs (somar `pct` direto daria outro líder).
 */

import { describe, expect, it } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";
import { consolidarRegiao, TOP_REGIAO } from "@/lib/utils/consolidado-regiao";

type Top = EdgeUfRow["top_candidatos"][number];

function uf(
  sigla: string,
  top: Top[],
  extra: Partial<Pick<EdgeUfRow, "outros" | "votos_disputa_projetados">> = {},
): EdgeUfRow {
  return {
    sigla,
    pct_apurado: 50,
    lider: top[0]?.id ?? 0,
    margem_atual: 0,
    margem_projetada: 0,
    margem_projetada_ci: [0, 0],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: top,
    vai_a_2t: null,
    bucket: "indefinido",
    ...extra,
  };
}

// SP: grande. PT lidera em pct, mas a UF pesa 4× mais que ES na projeção.
const SP = uf(
  "SP",
  [
    { id: 13, partido: "PT", pct: 40, votos_atuais: 400 },
    { id: 22, partido: "PL", pct: 35, votos_atuais: 350 },
    { id: 45, partido: "PSDB", pct: 15, votos_atuais: 150 },
    // Anulada com MUITO voto: se entrar, PODE vira 2º na Parcial.
    { id: 20, partido: "PODE", pct: 30, votos_atuais: 900, destino: "anulado" },
  ],
  { outros: { pct: 10, votos_atuais: 100, n_candidatos: 3 }, votos_disputa_projetados: 4000 },
);

// ES: pequena. PL lidera em pct por muito.
const ES = uf(
  "ES",
  [
    { id: 22, partido: "PL", pct: 70, votos_atuais: 70 },
    { id: 13, partido: "PT", pct: 20, votos_atuais: 20 },
    { id: 40, partido: "PSB", pct: 10, votos_atuais: 10, destino: "sub_judice" },
  ],
  { votos_disputa_projetados: 1000 },
);

describe("consolidarRegiao — Parcial", () => {
  const c = consolidarRegiao([SP, ES], "parcial", "partido");

  it("soma votos_atuais por partido, anulada FORA, sub judice DENTRO", () => {
    expect(c.disponivel).toBe(true);
    // PT 420, PL 420, PSDB 150, PSB 10 ; cauda 100 ; total 1100
    expect(c.total).toBe(1100);
    expect(c.linhas.map((l) => [l.chave, l.votos])).toEqual([
      ["PL", 420],
      ["PT", 420],
      ["PSDB", 150],
      ["PSB", 10],
    ]);
    expect(c.linhas.some((l) => l.chave === "PODE")).toBe(false);
  });

  it("empate por votos → sigla em ordem pt-BR (PL antes de PT)", () => {
    expect(c.linhas[0]?.chave).toBe("PL");
    expect(c.linhas[1]?.chave).toBe("PT");
  });

  it("cauda `outros` da UF vai para Outros da região; % fecha em 100", () => {
    expect(c.outros).toEqual({ votos: 100, pct: (100 / 1100) * 100 });
    const soma = c.linhas.reduce((a, l) => a + l.pct, 0) + (c.outros?.pct ?? 0);
    expect(soma).toBeCloseTo(100, 10);
  });

  it("% apurado = Σ contado ÷ Σ votos_disputa_projetados", () => {
    expect(c.pctApurado).toBeCloseTo((1100 / 5000) * 100, 10);
  });
});

describe("consolidarRegiao — Projeção", () => {
  it("Σ pct/100 × votos_disputa_projetados da UF (peso da UF, não média de %)", () => {
    const c = consolidarRegiao([SP, ES], "proj", "partido");
    // PT 0.4*4000 + 0.2*1000 = 1800 ; PL 0.35*4000 + 0.7*1000 = 2100
    // PSDB 600 ; PSB 100 ; cauda 0.1*4000 = 400 ; total 5000
    expect(c.disponivel).toBe(true);
    expect(c.linhas.map((l) => [l.chave, Math.round(l.votos)])).toEqual([
      ["PL", 2100],
      ["PT", 1800],
      ["PSDB", 600],
      ["PSB", 100],
    ]);
    expect(c.total).toBeCloseTo(5000, 6);
    expect(c.linhas[0]?.pct).toBeCloseTo(42, 6);
    expect(c.outros?.pct).toBeCloseTo(8, 6);
  });

  it("ALGUMA UF sem votos_disputa_projetados ⇒ indisponível, nunca estimativa", () => {
    const semCampo = { ...ES, votos_disputa_projetados: undefined };
    const c = consolidarRegiao([SP, semCampo], "proj", "partido");
    expect(c.disponivel).toBe(false);
    expect(c.motivo).toBe("sem_total_projetado");
    expect(c.linhas).toEqual([]);
    expect(c.outros).toBeNull();
    // e o % apurado da região também não é calculável
    expect(c.pctApurado).toBeNull();
    // A Parcial da mesma região continua disponível.
    expect(consolidarRegiao([SP, semCampo], "parcial", "partido").disponivel).toBe(true);
  });
});

describe("consolidarRegiao — indisponível ≠ zero", () => {
  it("Parcial com candidatura que compete sem votos_atuais ⇒ sem_contagem", () => {
    const legado = uf("RJ", [{ id: 13, partido: "PT", pct: 60 }], {
      votos_disputa_projetados: 10,
    });
    const c = consolidarRegiao([SP, legado], "parcial", "partido");
    expect(c.disponivel).toBe(false);
    expect(c.motivo).toBe("sem_contagem");
  });

  it("cauda `outros` sem votos_atuais ⇒ sem_contagem (tudo-ou-nada)", () => {
    const rj = uf("RJ", [{ id: 13, partido: "PT", pct: 60, votos_atuais: 6 }], {
      outros: { pct: 40, n_candidatos: 2 },
      votos_disputa_projetados: 10,
    });
    expect(consolidarRegiao([rj], "parcial", "partido").motivo).toBe("sem_contagem");
  });

  it("anulada sem votos_atuais NÃO torna a região indisponível (não compete)", () => {
    const rj = uf(
      "RJ",
      [
        { id: 13, partido: "PT", pct: 60, votos_atuais: 6 },
        { id: 20, partido: "PODE", pct: 40, destino: "anulado" },
      ],
      { votos_disputa_projetados: 10 },
    );
    expect(consolidarRegiao([rj], "parcial", "partido").disponivel).toBe(true);
  });

  it("nenhum voto contado ⇒ sem_votos (a tela diz —, nunca 0%)", () => {
    const zero = uf("RJ", [{ id: 13, partido: "PT", pct: 60, votos_atuais: 0 }], {
      votos_disputa_projetados: 1000,
    });
    const c = consolidarRegiao([zero], "parcial", "partido");
    expect(c.disponivel).toBe(false);
    expect(c.motivo).toBe("sem_votos");
    // Zero contado sobre total conhecido é um FATO: 0% apurado.
    expect(c.pctApurado).toBe(0);
  });

  it("UF sem apuração (votos 0) ao lado de UF apurada: contribui 0, região disponível", () => {
    const zero = uf("RJ", [{ id: 13, partido: "PT", pct: 60, votos_atuais: 0 }], {
      votos_disputa_projetados: 1000,
    });
    const c = consolidarRegiao([ES, zero], "parcial", "partido");
    expect(c.disponivel).toBe(true);
    expect(c.total).toBe(100);
  });

  it("lista vazia ⇒ indisponível", () => {
    expect(consolidarRegiao([], "parcial", "partido").disponivel).toBe(false);
  });
});

describe("consolidarRegiao — top 6 + Outros", () => {
  it("7º em diante vai para Outros junto com as caudas", () => {
    const siglas = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const top = siglas.map((s, i) => ({ id: i, partido: s, pct: 10, votos_atuais: 80 - i * 10 }));
    const c = consolidarRegiao(
      [uf("SP", top, { outros: { pct: 1, votos_atuais: 5, n_candidatos: 1 } })],
      "parcial",
      "partido",
    );
    expect(c.linhas).toHaveLength(TOP_REGIAO);
    expect(c.linhas.map((l) => l.chave)).toEqual(["A", "B", "C", "D", "E", "F"]);
    // G 20 + H 10 + cauda 5
    expect(c.outros?.votos).toBe(35);
  });

  it("sem excedente e sem cauda ⇒ outros null (não 'Outros 0%')", () => {
    const c = consolidarRegiao([ES], "parcial", "partido");
    expect(c.outros).toBeNull();
  });

  it("candidatura sem partido vai para Outros na agregação por partido", () => {
    const c = consolidarRegiao(
      [
        uf("SP", [
          { id: 1, pct: 50, votos_atuais: 50 },
          { id: 2, partido: "PT", pct: 50, votos_atuais: 50 },
        ]),
      ],
      "parcial",
      "partido",
    );
    expect(c.linhas.map((l) => l.chave)).toEqual(["PT"]);
    expect(c.outros?.votos).toBe(50);
  });
});

describe("consolidarRegiao — por candidato (Presidente)", () => {
  it("agrupa pelo número de urna, igual em todas as UFs; guarda nome e partido", () => {
    const a = uf("SP", [
      { id: 13, nome: "LULA", partido: "PT", pct: 50, votos_atuais: 50, sqcand: "1" },
      { id: 22, nome: "FLAVIO", partido: "PL", pct: 50, votos_atuais: 40 },
    ]);
    const b = uf("ES", [
      { id: 22, nome: "FLAVIO", partido: "PL", pct: 50, votos_atuais: 30 },
      { id: 13, nome: "LULA", partido: "PT", pct: 50, votos_atuais: 10 },
    ]);
    const c = consolidarRegiao([a, b], "parcial", "candidato");
    expect(c.linhas.map((l) => [l.chave, l.nome, l.partido, l.votos])).toEqual([
      ["22", "FLAVIO", "PL", 70],
      ["13", "LULA", "PT", 60],
    ]);
    expect(c.linhas[1]?.sqcand).toBe("1");
  });

  it("dois candidatos do MESMO partido não se fundem por candidato, fundem por partido", () => {
    const rows = [
      uf("SP", [
        { id: 13, nome: "X", partido: "PT", pct: 50, votos_atuais: 50 },
        { id: 131, nome: "Y", partido: "PT", pct: 50, votos_atuais: 40 },
      ]),
    ];
    expect(consolidarRegiao(rows, "parcial", "candidato").linhas).toHaveLength(2);
    expect(consolidarRegiao(rows, "parcial", "partido").linhas).toHaveLength(1);
  });

  it("empate por votos → nome pt-BR", () => {
    const c = consolidarRegiao(
      [
        uf("SP", [
          { id: 2, nome: "ÉRICA", partido: "PL", pct: 50, votos_atuais: 10 },
          { id: 1, nome: "BRUNO", partido: "PT", pct: 50, votos_atuais: 10 },
        ]),
      ],
      "parcial",
      "candidato",
    );
    expect(c.linhas.map((l) => l.nome)).toEqual(["BRUNO", "ÉRICA"]);
  });
});

it("sigla repetida entra uma vez", () => {
  const c = consolidarRegiao([ES, ES], "parcial", "partido");
  expect(c.total).toBe(100);
  expect(c.nUfs).toBe(1);
});

describe("consolidarRegiao — votosContados (o andamento da Parcial, sem modelo)", () => {
  it("Σ contado das que competem + caudas, igual nas duas bases e sem depender do total projetado", () => {
    const semTotal = { ...ES, votos_disputa_projetados: undefined };
    for (const base of ["parcial", "proj"] as const) {
      expect(consolidarRegiao([SP, ES], base, "partido").votosContados).toBe(1100);
      expect(consolidarRegiao([SP, semTotal], base, "partido").votosContados).toBe(1100);
    }
  });

  it("contagem indisponível ⇒ null (nunca 0); nada contado ⇒ 0 (fato)", () => {
    const legado = uf("RJ", [{ id: 13, partido: "PT", pct: 60 }]);
    expect(consolidarRegiao([legado], "parcial", "partido").votosContados).toBeNull();
    const zero = uf("RJ", [{ id: 13, partido: "PT", pct: 60, votos_atuais: 0 }]);
    expect(consolidarRegiao([zero], "parcial", "partido").votosContados).toBe(0);
  });
});
