/**
 * tests/unit/lib/senado-2027.test.ts — spec 023, RF-216 e RF-217.
 *
 * A derivação das 81 cadeiras: fases, os quatro estados, a ordem, e a
 * conferência que recusa o desenho quando a conta não fecha com o produtor.
 * A foto usada aqui é a FICTÍCIA (`tests/fixtures/senado/`): PL 9, PSD 4, PT 3,
 * PP 3, MDB 2, UNIÃO 2, PODE 1, PSB 1, PSDB 1, REPUBLICANOS 1.
 *
 * Cada bloco nomeia a mutação que o derruba; o registro está no tasks.md.
 */

import { describe, expect, it } from "vitest";

import type { EdgePayload } from "@/lib/edge-config/types";
import { validarMandato2031 } from "@/lib/senado/mandato-2031";
import {
  CHAVE_SEM_PARTIDO,
  chavePartido,
  derivarSenado2027,
  PCT_UF_CONCLUIDA,
  type ResultadoSenado2027,
  ROTULO_SEM_PARTIDO,
  type Senado2027,
  textoDoPartido,
} from "@/lib/utils/senado-2027";
import mandatoFixture from "@/tests/fixtures/senado/mandato-2031.fixture.json" with {
  type: "json",
};
import {
  cand,
  mandatoDeTeste,
  payloadSenado,
  payloadTresUfs,
  ufRow,
} from "@/tests/fixtures/senado/payload-senado";

function aceito(r: ResultadoSenado2027): Senado2027 {
  if (!r.ok) throw new Error(`recusado: ${r.motivo} — ${r.detalhe}`);
  return r.senado;
}

function somaEstados(s: Senado2027): number {
  return Object.values(s.contagem).reduce((a, b) => a + b, 0);
}

const porSigla = (s: Senado2027) => Object.fromEntries(s.partidos.map((p) => [p.sigla, p]));

describe("as fases (design 023 § D6)", () => {
  it("fase pré: 27 que continuam + 54 aguardando, mesmo com `por_uf` preenchido", () => {
    const s = aceito(derivarSenado2027(payloadTresUfs({ fase: "pre_eleicao" }), mandatoDeTeste()));
    expect(s.fase).toBe("pre");
    expect(s.contagem).toEqual({ continua_2031: 27, decidida: 0, projetada: 0, aguardando: 54 });
    expect(s.cadeiras).toHaveLength(81);
  });

  it("fase pré sem `composicao_vagas`: as 54 saem da tabela canônica (2 × 27)", () => {
    const p = payloadTresUfs({ fase: "pre_eleicao" });
    delete (p as Partial<EdgePayload>).composicao_vagas;
    const s = aceito(derivarSenado2027(p, mandatoDeTeste()));
    expect(s.vagasEmDisputa).toBe(54);
    expect(s.total).toBe(81);
  });

  it("sem payload: 27 + 54, fase 'sem_dados' (a página não usa — a função cobre)", () => {
    const s = aceito(derivarSenado2027(null, mandatoDeTeste()));
    expect(s.fase).toBe("sem_dados");
    expect(s.contagem.aguardando).toBe(54);
    expect(s.contagem.continua_2031).toBe(27);
  });
});

describe("a soma é 81, sempre (RF-216)", () => {
  // 🔴 MUTAÇÃO: pular um senador da foto no laço das que continuam — saem 80
  // cadeiras, e a recusa `total_incoerente` derruba este caso.
  it("três UFs apurando: 27 + 2 decididas + 4 projetadas + 48 aguardando = 81", () => {
    const s = aceito(derivarSenado2027(payloadTresUfs(), mandatoDeTeste()));
    expect(s.total).toBe(81);
    expect(s.cadeiras).toHaveLength(81);
    expect(s.contagem).toEqual({ continua_2031: 27, decidida: 2, projetada: 4, aguardando: 48 });
    expect(somaEstados(s)).toBe(81);
  });

  it("de 0 a 14 UFs projetadas (um terço concluídas), a soma não sai de 81", () => {
    const siglas = [
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
    ];
    const falhas: string[] = [];
    for (let n = 0; n <= siglas.length; n++) {
      const rows = siglas
        .slice(0, n)
        .map((uf, i) =>
          ufRow(uf, i % 3 === 0 ? 100 : 50, [
            cand(10 + i, "PL", 40),
            cand(20 + i, "PT", 30),
            cand(30 + i, "MDB", 20),
          ]),
        );
      const porPartido =
        n > 0
          ? [
              { partido: "PL", vagas: n },
              { partido: "PT", vagas: n },
            ]
          : [];
      const r = derivarSenado2027(payloadSenado(rows, porPartido), mandatoDeTeste());
      if (!r.ok) {
        falhas.push(`n=${n}: ${r.motivo}`);
        continue;
      }
      if (r.senado.cadeiras.length !== 81 || somaEstados(r.senado) !== 81) falhas.push(`n=${n}`);
      if (r.senado.contagem.aguardando !== 54 - 2 * n) falhas.push(`n=${n}: aguardando`);
    }
    expect(falhas).toEqual([]);
  });
});

describe("as 54 saem da mesma conta do produtor (RF-217)", () => {
  it("os totais por partido: foto + disputa", () => {
    const s = aceito(derivarSenado2027(payloadTresUfs(), mandatoDeTeste()));
    const p = porSigla(s);
    expect(p.PL).toMatchObject({ cadeiras: 11, continua: 9, decidida: 0, projetada: 2 });
    expect(p.PSD).toMatchObject({ cadeiras: 5, continua: 4, decidida: 1, projetada: 0 });
    expect(p.PP).toMatchObject({ cadeiras: 4, continua: 3, decidida: 1 });
    expect(p.PT).toMatchObject({ cadeiras: 4, continua: 3, projetada: 1 });
    expect(p.MDB).toMatchObject({ cadeiras: 3, continua: 2, projetada: 1 });
  });

  // 🔴 MUTAÇÃO: esquecer `queCompetem` — a anulada (PSOL, 2ª em MG) ocuparia a
  // vaga, e a conferência com o produtor (que a exclui) recusaria o payload.
  it("anulada em 2º lugar: a vaga vai à 3ª que compete (ADR-0053)", () => {
    const s = aceito(derivarSenado2027(payloadTresUfs(), mandatoDeTeste()));
    expect(s.partidos.map((p) => p.sigla)).not.toContain("PSOL");
    expect(porSigla(s).PL?.projetada).toBe(2);
  });

  // 🔴 MUTAÇÃO: reordenar `top_candidatos` por `pct` antes de cortar — MDB
  // (29,5) passaria à frente de PL (29) e a conferência recusaria.
  it("a ordem é a do ARRAY (a do produtor), não a do `pct` arredondado", () => {
    const p = payloadSenado(
      [ufRow("SP", 50, [cand(1, "PT", 30), cand(2, "PL", 29), cand(3, "MDB", 29.5)])],
      [
        { partido: "PL", vagas: 1 },
        { partido: "PT", vagas: 1 },
      ],
    );
    expect(derivarSenado2027(p, mandatoDeTeste()).ok).toBe(true);
  });

  it(`"decidida" ⇔ pct_apurado >= ${PCT_UF_CONCLUIDA}; 99,9 ainda é projeção`, () => {
    const com = (pct: number) =>
      aceito(
        derivarSenado2027(
          payloadSenado(
            [ufRow("RJ", pct, [cand(1, "PSD", 45), cand(2, "PP", 28)])],
            [
              { partido: "PP", vagas: 1 },
              { partido: "PSD", vagas: 1 },
            ],
          ),
          mandatoDeTeste(),
        ),
      );
    expect(com(100).contagem).toMatchObject({ decidida: 2, projetada: 0 });
    expect(com(99.9).contagem).toMatchObject({ decidida: 0, projetada: 2 });
  });

  it("a sigla casa sem acento e sem caixa: 'União' no payload ≡ 'UNIÃO' na foto", () => {
    expect(chavePartido("UNIÃO")).toBe(chavePartido("União"));
    expect(chavePartido("UNIAO")).toBe("uniao");
    expect(chavePartido("PC do B")).toBe("pcdob");
    expect(chavePartido("—")).toBe("—");
    const s = aceito(
      derivarSenado2027(
        payloadSenado(
          [ufRow("AP", 50, [cand(1, "União", 40), cand(2, "PL", 30)])],
          [
            { partido: "PL", vagas: 1 },
            { partido: "UNIÃO", vagas: 1 },
          ],
        ),
        mandatoDeTeste(),
      ),
    );
    const uniao = s.partidos.filter((p) => p.chave === "uniao");
    expect(uniao).toHaveLength(1);
    expect(uniao[0]).toMatchObject({ cadeiras: 3, continua: 2, projetada: 1 });
  });
});

describe("🔴 falha fechada — o hemiciclo não é desenhado quando a conta não fecha", () => {
  // 🔴 MUTAÇÃO: apagar a comparação com `composicao_vagas.por_partido` — os
  // três casos abaixo passam a devolver `ok: true` com números que contradizem
  // a barra das 54 na mesma página.
  it("produtor diz PL 1 + MDB 2, a derivação dá PL 2 + MDB 1 ⇒ divergencia_composicao", () => {
    const p = payloadTresUfs();
    (p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>).por_partido = [
      { partido: "MDB", vagas: 2 },
      { partido: "PL", vagas: 1 },
      { partido: "PP", vagas: 1 },
      { partido: "PSD", vagas: 1 },
      { partido: "PT", vagas: 1 },
    ];
    const r = derivarSenado2027(p, mandatoDeTeste());
    expect(r).toMatchObject({ ok: false, motivo: "divergencia_composicao" });
    if (!r.ok) expect(r.detalhe).toMatch(/mdb 1.*pl 2/);
  });

  it("`top_candidatos` sem partido numa UF (o produtor resolveu por outro caminho) ⇒ recusa", () => {
    const p = payloadTresUfs();
    const sp = p.por_uf[0] as EdgePayload["por_uf"][number];
    sp.top_candidatos = [cand(131, undefined, 40), ...sp.top_candidatos.slice(1)];
    expect(derivarSenado2027(p, mandatoDeTeste())).toMatchObject({
      ok: false,
      motivo: "divergencia_composicao",
    });
  });

  it("`vagas_projetadas` diferente da soma derivada ⇒ recusa", () => {
    const p = payloadTresUfs();
    (p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>).vagas_projetadas = 7;
    expect(derivarSenado2027(p, mandatoDeTeste())).toMatchObject({ ok: false });
  });

  it("payload normal sem `composicao_vagas` ⇒ sem_composicao", () => {
    const p = payloadTresUfs();
    delete (p as Partial<EdgePayload>).composicao_vagas;
    expect(derivarSenado2027(p, mandatoDeTeste())).toMatchObject({
      ok: false,
      motivo: "sem_composicao",
    });
  });

  it("`total_cadeiras` que não é foto + em disputa ⇒ total_incoerente", () => {
    const p = payloadTresUfs();
    (p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>).total_cadeiras = 80;
    expect(derivarSenado2027(p, mandatoDeTeste())).toMatchObject({
      ok: false,
      motivo: "total_incoerente",
    });
  });

  it("vagas por UF diferente da tabela canônica ⇒ total_incoerente", () => {
    const p = payloadTresUfs();
    (p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>).vagas_por_uf = 1;
    expect(derivarSenado2027(p, mandatoDeTeste())).toMatchObject({
      ok: false,
      motivo: "total_incoerente",
    });
  });

  it("mais vagas derivadas que em disputa ⇒ vagas_excedentes", () => {
    const rows = Array.from({ length: 28 }, (_, i) =>
      ufRow(`X${i}`, 50, [cand(i * 2, "PL", 40), cand(i * 2 + 1, "PT", 30)]),
    );
    const p = payloadSenado(rows, [
      { partido: "PL", vagas: 28 },
      { partido: "PT", vagas: 28 },
    ]);
    expect(derivarSenado2027(p, mandatoDeTeste())).toMatchObject({
      ok: false,
      motivo: "vagas_excedentes",
    });
  });

  it("foto inválida ⇒ mandato_invalido, com os erros da foto no detalhe", () => {
    const foto = structuredClone(mandatoFixture) as { senadores: unknown[] };
    foto.senadores.pop();
    const r = derivarSenado2027(payloadTresUfs(), validarMandato2031(foto));
    expect(r).toMatchObject({ ok: false, motivo: "mandato_invalido" });
    if (!r.ok) expect(r.detalhe).toContain("26 entradas");
  });
});

describe("a ordem das cadeiras (design 023 § D4)", () => {
  // 🔴 MUTAÇÃO: ordenar por sigla sem olhar o total, ou pelo total só da
  // disputa — a primeira cunha deixa de ser a maior bancada.
  it("partidos por total desc, empate por sigla (PP antes de PT, os dois com 4)", () => {
    const s = aceito(derivarSenado2027(payloadTresUfs(), mandatoDeTeste()));
    expect(s.partidos.map((p) => `${p.sigla} ${p.cadeiras}`)).toEqual([
      "PL 11",
      "PSD 5",
      "PP 4",
      "PT 4",
      "MDB 3",
      "UNIÃO 2",
      "PODE 1",
      "PSB 1",
      "PSDB 1",
      "REPUBLICANOS 1",
    ]);
  });

  it("dentro da cunha: as que continuam, depois as decididas, depois as projetadas; aguardando no fim", () => {
    const s = aceito(derivarSenado2027(payloadTresUfs(), mandatoDeTeste()));
    const psd = s.cadeiras.filter((c) => c.sigla === "PSD").map((c) => c.estado);
    expect(psd).toEqual([
      "continua_2031",
      "continua_2031",
      "continua_2031",
      "continua_2031",
      "decidida",
    ]);
    const pl = s.cadeiras.filter((c) => c.sigla === "PL").map((c) => c.estado);
    expect(pl.slice(-2)).toEqual(["projetada", "projetada"]);
    const primeiroAguardando = s.cadeiras.findIndex((c) => c.estado === "aguardando");
    expect(s.cadeiras.slice(primeiroAguardando).every((c) => c.estado === "aguardando")).toBe(true);
    expect(s.cadeiras.length - primeiroAguardando).toBe(48);
  });

  it("cada partido é contíguo — uma cunha só", () => {
    const s = aceito(derivarSenado2027(payloadTresUfs(), mandatoDeTeste()));
    const vistos: string[] = [];
    for (const c of s.cadeiras) {
      if (c.chave === null) continue;
      if (vistos[vistos.length - 1] !== c.chave) vistos.push(c.chave);
    }
    expect(new Set(vistos).size).toBe(vistos.length);
  });
});

describe("senador hoje sem partido ('S/Partido')", () => {
  function comSemPartido() {
    const foto = structuredClone(mandatoFixture) as { senadores: Array<Record<string, unknown>> };
    const rj = foto.senadores.find((s) => s.uf === "RJ") as Record<string, unknown>;
    rj.partido = "S/Partido"; // era PL na fixture
    return validarMandato2031(foto);
  }

  it("vira a linha 'Sem partido', a última, e NÃO conta para o PL nem vira 'outros'", () => {
    const s = aceito(derivarSenado2027(payloadTresUfs(), comSemPartido()));
    const ultima = s.partidos[s.partidos.length - 1];
    expect(ultima).toMatchObject({
      chave: CHAVE_SEM_PARTIDO,
      sigla: ROTULO_SEM_PARTIDO,
      cadeiras: 1,
      continua: 1,
      semPartido: true,
    });
    expect(porSigla(s).PL?.continua).toBe(8);
    expect(s.partidos.some((p) => p.chave === "outros")).toBe(false);
    expect(s.continuaSemPartido).toBe(1);
    expect(s.contagem.continua_2031).toBe(27);
    expect(s.cadeiras).toHaveLength(81);
  });
});

describe("textoDoPartido — o equivalente textual da cunha (RF-218)", () => {
  it("'PL 11 — 9 até 2031 + 2 em 2026 (projeção)'", () => {
    const s = aceito(derivarSenado2027(payloadTresUfs(), mandatoDeTeste()));
    expect(textoDoPartido(porSigla(s).PL as never)).toBe(
      "PL 11 — 9 até 2031 + 2 em 2026 (projeção)",
    );
    expect(textoDoPartido(porSigla(s).PSD as never)).toBe(
      "PSD 5 — 4 até 2031 + 1 em 2026 (apuração concluída no estado)",
    );
    expect(textoDoPartido(porSigla(s).PODE as never)).toBe("PODE 1 — 1 até 2031");
  });

  it("nunca diz 'eleito'", () => {
    const s = aceito(derivarSenado2027(payloadTresUfs(), mandatoDeTeste()));
    for (const p of s.partidos) expect(textoDoPartido(p)).not.toMatch(/eleit/i);
  });
});
