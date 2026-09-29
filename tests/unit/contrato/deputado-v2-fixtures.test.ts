/**
 * tests/unit/contrato/deputado-v2-fixtures.test.ts
 *
 * Spec 026 (design § 2) — as fixtures de CONTRATO v2 do Deputado Federal
 * fecham por construção. Elas são o alvo das frentes T, P, S e U até o
 * simulado passar a emitir v2 (design § 9), então um número que não fecha
 * aqui vira um teste de tela verde sobre dado impossível.
 *
 * Os tipos saem dos tipos REAIS (`lib/blob/deputado-uf.ts`,
 * `lib/edge-config/types.ts` — tasks T1.9), e o bloco "forma" prova em runtime
 * que o leitor tolerante aceita cada campo da fixture: o teste prova a forma,
 * não só a aritmética.
 *
 * Cada invariante é recalculada aqui a partir dos votos, sem reaproveitar o
 * campo que ela confere: conferir `quociente_eleitoral` contra `regras`
 * passaria com os dois errados do mesmo jeito.
 */

import { describe, expect, it } from "vitest";

import {
  type DeputadoComparacao,
  type DeputadoDivergencia,
  type DeputadoUfAgremiacao,
  type DeputadoUfDetail,
  type DeputadoUfLinha,
  type DeputadoUfLista,
  projecaoValida,
  sanearDeputadoUfDetail,
  sanearDeputadoUfLista,
} from "@/lib/blob/deputado-uf";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import v1Fixture from "@/tests/fixtures/blob/dep-uf.json" with { type: "json" };
import nacionalFixture from "@/tests/fixtures/contrato/deputado-nacional-v2.json" with {
  type: "json",
};
import listaFixture from "@/tests/fixtures/contrato/deputado-uf-lista.json" with { type: "json" };
import ufFixture from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Tipos — DERIVADOS dos tipos reais (tasks T1.9)
// ---------------------------------------------------------------------------
//
// Até 29/09 este arquivo tinha um espelho local do design § 2. Agora os tipos
// saem de `lib/blob/deputado-uf.ts` / `lib/edge-config/types.ts`: um campo
// renomeado lá quebra a compilação aqui. O `as unknown as` nas três fixtures
// continua — o TypeScript alarga os literais de um JSON importado (`"cargo": 6`
// vira `number`), e `satisfies` sobre o JSON cru não compila por isso. A prova
// de FORMA em runtime é o bloco "forma" logo abaixo: o leitor tolerante, que
// codifica as tabelas fechadas do design, não pode descartar nada.
//
// Os aliases apertam o que a fixture v2 garante e o tipo deixa opcional (um
// objeto v2 SEMPRE traz `regras`, `projecao`, `conferencia`...).

type Linha = DeputadoUfLinha;
type Divergencia = DeputadoDivergencia;
type Comparacao = DeputadoComparacao;

type Agremiacao = DeputadoUfAgremiacao &
  Required<Pick<DeputadoUfAgremiacao, "candidatos" | "total_candidatos">>;

type Detalhe = Omit<
  DeputadoUfDetail,
  "agremiacoes" | "lugares_a_preencher" | "quociente_eleitoral" | "divergencias"
> &
  Required<
    Pick<DeputadoUfDetail, "contrato" | "regras" | "projecao" | "conferencia" | "mais_votados">
  > & {
    dado_ts: string | null;
    pares_atrasados: number | null;
    lugares_a_preencher: number;
    quociente_eleitoral: number;
    divergencias: Divergencia[];
    agremiacoes: Agremiacao[];
  };

type Lista = DeputadoUfLista;
type Nacional = EdgePayloadDeputado &
  Required<Pick<EdgePayloadDeputado, "mais_votados" | "puxadores">>;

/** Design 026 § 2.8 — cada chave de divergência pertence a UMA comparação. */
const COMPARACAO_DA_CHAVE: Record<string, Comparacao> = {
  quociente_eleitoral: "algoritmo",
  cadeiras: "algoritmo",
  eleitos: "eleitos",
  eleitorado: "eleitorado",
  votos_validos: "votos_validos",
};

/** Design 026 § 2.7 — conjunto FECHADO de motivos da trava, por estado. */
const MOTIVOS: Record<string, readonly string[]> = {
  aguardando: ["pct_minimo", "zonas_minimas", "sem_vagas"],
  indisponivel: ["interruptor", "coligacao", "cobertura", "erro"],
};

const UFS = ufFixture as unknown as Record<string, Detalhe>;
const LISTAS = listaFixture as unknown as Record<string, Lista>;
const NACIONAL = nacionalFixture as unknown as Nacional;

describe("forma — os tipos reais e o leitor tolerante aceitam a fixture inteira (T1.9)", () => {
  it("cada UF v2 passa por `sanearDeputadoUfDetail` sem perder um campo", () => {
    for (const [uf, d] of Object.entries(UFS)) {
      expect(sanearDeputadoUfDetail(d as unknown as DeputadoUfDetail), uf).toEqual(d);
    }
  });

  it("a lista 61+ passa por `sanearDeputadoUfLista` sem perder uma linha", () => {
    for (const [uf, l] of Object.entries(LISTAS)) {
      expect(sanearDeputadoUfLista(l), uf).toEqual(l);
    }
  });

  it("todo `por_uf[].projecao` do nacional tem a forma do design § 2.7", () => {
    for (const row of NACIONAL.por_uf) {
      if (row.projecao !== undefined) expect(projecaoValida(row.projecao), row.sigla).toBe(true);
    }
  });
});

/** O objeto de uma UF da fixture — lança se a sigla não existir (erro de teste, não de dado). */
function ufDe(sigla: string): Detalhe {
  const d = UFS[sigla];
  if (!d) throw new Error(`UF ${sigla} ausente de deputado-uf-v2.json`);
  return d;
}

// ---------------------------------------------------------------------------
// Aritmética da lei, reescrita aqui — nunca lida do campo que confere
// ---------------------------------------------------------------------------

/** Código Eleitoral art. 106: fração ≤ 0,5 é desprezada, > 0,5 vira 1 (em inteiros). */
function qeArt106(votosValidos: number, lugares: number): number {
  const inteiro = Math.floor(votosValidos / lugares);
  const resto = votosValidos - inteiro * lugares;
  return 2 * resto > lugares ? inteiro + 1 : inteiro;
}

/** ⌈num/den⌉ em inteiros positivos — os pisos em votos do design § 2.6. */
function ceilDiv(num: number, den: number): number {
  return Math.floor((num + den - 1) / den);
}

/** Percentual 0–100 com 5 casas — a mesma convenção de `_pct` do produtor. */
function esperaPct(valor: number | null, parte: number, total: number, rotulo: string): void {
  expect(valor, rotulo).not.toBeNull();
  expect(valor as number, rotulo).toBeCloseTo((100 * parte) / total, 5);
  // "5 casas" é propriedade do número publicado, não só proximidade.
  const escalado = (valor as number) * 1e5;
  expect(Math.abs(escalado - Math.round(escalado)), `${rotulo} — mais de 5 casas`).toBeLessThan(
    1e-6,
  );
}

const ANULADOS: ReadonlySet<string> = new Set(["anulado", "sub_judice"]);
const valido = (l: Linha): boolean => l.destino === undefined;
const eleitoTse = (l: Linha): boolean => l.tse?.startsWith("eleito") ?? false;

/** Todas as linhas de uma agremiação: as do Blob e as da lista 61+. */
function linhasDe(uf: string, agr: Agremiacao): Linha[] {
  const resto = LISTAS[uf]?.agremiacoes.find((a) => a.cod === agr.cod)?.candidatos ?? [];
  return [...agr.candidatos, ...resto].sort((a, b) => a.rank - b.rank);
}

function todasAsLinhas(uf: string): Array<{ agr: Agremiacao; l: Linha }> {
  return ufDe(uf).agremiacoes.flatMap((agr) => linhasDe(uf, agr).map((l) => ({ agr, l })));
}

// ---------------------------------------------------------------------------
// Por UF — deputado/uf/<UF>.json
// ---------------------------------------------------------------------------

describe.each(Object.keys(UFS))("deputado-uf-v2.json — %s", (uf) => {
  const d = ufDe(uf);
  const vvUf = d.agremiacoes.reduce((s, a) => s + a.votos_validos, 0);
  const qe = d.quociente_eleitoral;

  it("é v2, autodescritivo e com `sqcand` NÚMERO em todo lugar", () => {
    expect(d.contrato).toBe(2);
    expect(d.cargo).toBe(6);
    expect(d.turno).toBe(1);
    expect(d.uf).toBe(uf);
    // O produtor Python emite `int`; um `"1000…"` string quebraria a busca por
    // igualdade estrita no leitor (`===`) sem erro nenhum.
    const serial = JSON.stringify(d);
    expect(serial).not.toMatch(/"sqcand":"/);
    expect(serial).not.toMatch(/"(ultimo_eleito|primeiro_fora)":"/);
    // D2 do design 017 continua valendo no v2.
    expect(serial).not.toContain("vagas_obtidas");
  });

  it("QE com o arredondamento do art. 106 e pisos em votos (design § 2.6)", () => {
    expect(qe).toBe(qeArt106(vvUf, d.lugares_a_preencher));
    expect(d.regras.quociente_eleitoral).toBe(qe);
    expect(d.regras.votos_validos).toBe(vvUf);
    expect(d.regras.lugares_a_preencher).toBe(d.lugares_a_preencher);
    expect(d.regras.piso_candidato).toBe(ceilDiv(qe, 10));
    expect(d.regras.piso_agremiacao_sobras).toBe(ceilDiv(4 * qe, 5));
    expect(d.regras.piso_candidato_sobras).toBe(ceilDiv(qe, 5));
  });

  it("Σ cadeiras + vagas não preenchidas == lugares; eleitos == cadeiras == marcas de parcial", () => {
    const soma = d.agremiacoes.reduce((s, a) => s + a.cadeiras, 0);
    expect(soma + d.vagas_nao_preenchidas).toBe(d.lugares_a_preencher);
    for (const agr of d.agremiacoes) {
      const parcial = linhasDe(uf, agr).filter((l) => l.parcial !== undefined);
      expect(agr.eleitos.length, agr.sigla).toBe(agr.cadeiras);
      expect(parcial.length, agr.sigla).toBe(agr.cadeiras);
      expect(new Set(parcial.map((l) => l.sqcand)), agr.sigla).toEqual(
        new Set(agr.eleitos.map((e) => e.sqcand)),
      );
      // `indefinido` do v1 e do v2 dizem a mesma coisa sobre o mesmo candidato.
      for (const e of agr.eleitos) {
        const l = parcial.find((x) => x.sqcand === e.sqcand);
        expect(Boolean(e.indefinido), `${agr.sigla}/${e.sqcand}`).toBe(Boolean(l?.indefinido));
      }
    }
  });

  it("votos da agremiação fecham com as linhas (regra do `dvt`, ADR-B)", () => {
    for (const agr of d.agremiacoes) {
      const linhas = linhasDe(uf, agr);
      expect(agr.votos_validos, agr.sigla).toBe(agr.votos_nominais + agr.votos_legenda);
      // Nominal elegível = só linha sem destino (válido ou `dvt` ausente).
      // "Válido (legenda)" está DENTRO de `votos_legenda`; anulado e sub judice
      // estão fora de tudo.
      const nominaisValidos = linhas.filter(valido).reduce((s, l) => s + l.votos, 0);
      expect(nominaisValidos, agr.sigla).toBe(agr.votos_nominais);
      esperaPct(agr.pct_votos, agr.votos_validos, vvUf, `${agr.sigla} pct_votos`);
      expect(agr.quociente_partidario, agr.sigla).toBe(Math.floor(agr.votos_validos / qe));
    }
  });

  it("rank 1..N contíguo por voto apurado, dividido em ≤ 60 no Blob e > 60 na lista", () => {
    for (const agr of d.agremiacoes) {
      const linhas = linhasDe(uf, agr);
      expect(agr.total_candidatos, agr.sigla).toBe(linhas.length);
      expect(
        linhas.map((l) => l.rank),
        agr.sigla,
      ).toEqual(linhas.map((_, i) => i + 1));
      // Ordem é SEMPRE por voto apurado, nunca pela projeção (§ 2).
      linhas.slice(1).forEach((l, i) => {
        expect(l.votos, `${agr.sigla} rank ${l.rank}`).toBeLessThanOrEqual(
          linhas[i]?.votos ?? Number.POSITIVE_INFINITY,
        );
      });
      const noBlob = new Set(agr.candidatos.map((l) => l.rank));
      for (let r = 1; r <= Math.min(60, linhas.length); r++) {
        expect(noBlob.has(r), `${agr.sigla} rank ${r} fora do Blob`).toBe(true);
      }
      for (const l of agr.candidatos.filter((x) => x.rank > 60)) {
        // Acima de 60 só entra no Blob quem tem marca.
        expect(
          l.parcial !== undefined || l.projecao !== undefined || eleitoTse(l),
          `${agr.sigla} rank ${l.rank} sem marca no Blob`,
        ).toBe(true);
      }
    }
    const restantes = (LISTAS[uf]?.agremiacoes ?? []).reduce((s, a) => s + a.candidatos.length, 0);
    expect(d.lista?.restantes ?? 0).toBe(restantes);
  });

  it("% dos válidos da UF: 5 casas, `null` exatamente para anulado e sub judice", () => {
    for (const { agr, l } of todasAsLinhas(uf)) {
      const rotulo = `${agr.sigla}/${l.sqcand}`;
      if (l.destino && ANULADOS.has(l.destino)) {
        expect(l.pct_validos, rotulo).toBeNull();
      } else {
        esperaPct(l.pct_validos, l.votos, vvUf, rotulo);
      }
    }
  });

  it("destino fora do voto nominal nunca carrega marca de eleito", () => {
    for (const { agr, l } of todasAsLinhas(uf)) {
      if (valido(l)) continue;
      const rotulo = `${agr.sigla}/${l.sqcand} (${l.destino})`;
      expect(l.parcial, rotulo).toBeUndefined();
      expect(l.projecao, rotulo).toBeUndefined();
      expect(eleitoTse(l), rotulo).toBe(false);
    }
  });

  it("via QP/sobra: QP primeiro, e QP = min(quociente partidário, elegíveis ≥ 10% do QE)", () => {
    for (const agr of d.agremiacoes) {
      const linhas = linhasDe(uf, agr);
      const elegiveis10 = linhas.filter((l) => valido(l) && 10 * l.votos >= qe).length;
      const parcial = linhas.filter((l) => l.parcial !== undefined);
      const qp = parcial.filter((l) => l.parcial === "qp");
      expect(qp.length, agr.sigla).toBe(Math.min(agr.quociente_partidario, elegiveis10));
      expect(
        parcial.map((l) => l.parcial),
        `${agr.sigla}: QP antes de sobra`,
      ).toEqual([...qp.map(() => "qp"), ...parcial.slice(qp.length).map(() => "sobra")]);
      for (const l of linhas) {
        if (l.indefinido) expect(l.parcial, `${agr.sigla}/${l.sqcand}`).toBe("sobra");
        if (l.projecao_apertada) expect(l.projecao, `${agr.sigla}/${l.sqcand}`).toBe("sobra");
      }
    }
  });

  it("linha de corte: último eleito na parcial × primeiro válido de fora", () => {
    for (const agr of d.agremiacoes) {
      const linhas = linhasDe(uf, agr);
      const eleitos = linhas.filter((l) => l.parcial !== undefined);
      const fora = linhas.find((l) => valido(l) && l.parcial === undefined);
      if (eleitos.length === 0 || fora === undefined) {
        expect(agr.corte, agr.sigla).toBeUndefined();
        continue;
      }
      const ultimo = eleitos.at(-1) as Linha;
      expect(agr.corte, agr.sigla).toBeDefined();
      expect(agr.corte?.ultimo_eleito, agr.sigla).toBe(ultimo.sqcand);
      expect(agr.corte?.primeiro_fora, agr.sigla).toBe(fora.sqcand);
      expect(agr.corte?.diferenca, agr.sigla).toBe(ultimo.votos - fora.votos);
      expect(agr.corte?.diferenca, agr.sigla).toBeGreaterThanOrEqual(0);
      // Presente só quando verdadeiro: 10·votos < QE ⟺ votos < QE/10, em inteiros.
      expect(agr.corte?.primeiro_fora_abaixo_piso_10 === true, agr.sigla).toBe(
        10 * fora.votos < qe,
      );
    }
  });

  it("puxadores: excedente = ⌊votos/QE⌋ − 1 ≥ 1, só voto válido", () => {
    for (const agr of d.agremiacoes) {
      const esperados = linhasDe(uf, agr)
        .filter((l) => valido(l) && Math.floor(l.votos / qe) - 1 >= 1)
        .map((l) => ({
          sqcand: l.sqcand,
          quocientes: Math.floor(l.votos / qe),
          excedente: Math.floor(l.votos / qe) - 1,
        }));
      expect(agr.puxadores ?? [], agr.sigla).toEqual(esperados);
    }
  });

  it("trava da projeção: marcas e cadeiras projetadas só com `liberada`", () => {
    const p = d.projecao;
    expect(["liberada", "aguardando", "indisponivel"]).toContain(p.estado);
    expect(p.pct_minimo).toBe(25);
    expect(p.zonas_apuradas).toBeLessThanOrEqual(p.zonas_total);
    expect(p.motivo === undefined).toBe(p.estado === "liberada");
    if (p.motivo !== undefined) expect(MOTIVOS[p.estado], p.motivo).toContain(p.motivo);
    if (p.motivo === "cobertura") {
      // A trava não fecha por cobertura sem um número que a sustente na Conferência.
      expect(d.conferencia.divergencias.some((x) => x.o_que === "eleitorado")).toBe(true);
    }

    for (const agr of d.agremiacoes) {
      const linhas = linhasDe(uf, agr);
      const proj = linhas.filter((l) => l.projecao !== undefined);
      if (p.estado !== "liberada") {
        expect(agr.cadeiras_projetadas, agr.sigla).toBeUndefined();
        expect(agr.votos_projetados, agr.sigla).toBeUndefined();
        expect(proj, agr.sigla).toEqual([]);
        expect(linhas.some((l) => l.projecao_apertada)).toBe(false);
        continue;
      }
      expect(proj.length, agr.sigla).toBe(agr.cadeiras_projetadas);
      const faixa = agr.cadeiras_projetadas_ci95;
      if (faixa) {
        expect(faixa[0], agr.sigla).toBeLessThanOrEqual(agr.cadeiras_projetadas as number);
        expect(faixa[1], agr.sigla).toBeGreaterThanOrEqual(agr.cadeiras_projetadas as number);
      }
    }
    if (p.estado === "liberada") {
      const soma = d.agremiacoes.reduce((s, a) => s + (a.cadeiras_projetadas ?? 0), 0);
      expect(soma).toBe(d.lugares_a_preencher);
    }
  });

  it("marca do TSE só com totalização final — e com ela, em toda linha", () => {
    const linhas = todasAsLinhas(uf).map(({ l }) => l);
    if (!d.totalizacao_final) {
      expect(linhas.filter((l) => l.tse !== undefined)).toEqual([]);
      return;
    }
    expect(linhas.every((l) => l.tse !== undefined)).toBe(true);
    const eleitos = linhas.filter(eleitoTse).length;
    expect(eleitos + d.vagas_nao_preenchidas).toBe(d.lugares_a_preencher);
  });

  it("Conferência coerente com o estado — e o TSE confere com as próprias marcas", () => {
    const c = d.conferencia;
    expect(c.totalizacao_final).toBe(d.totalizacao_final);
    // O campo v1 continua existindo para leitor antigo e diz a mesma coisa.
    expect(d.divergencias).toEqual(c.divergencias);
    // Toda divergência pertence a uma comparação que de fato foi feita, e as de
    // tamanho (eleitorado, votos) carregam a magnitude com o sinal.
    for (const div of c.divergencias) {
      const comp = COMPARACAO_DA_CHAVE[div.o_que];
      expect(comp, `chave desconhecida: ${div.o_que}`).toBeDefined();
      expect(c.comparou, div.o_que).toContain(comp);
      if (div.o_que === "eleitorado" || div.o_que === "votos_validos") {
        expect(div.diferenca_pct, div.o_que).toBeCloseTo(
          (100 * (div.nosso - div.tse)) / div.tse,
          5,
        );
      }
    }
    // `eleitos` e `votos_validos` só se comparam com o TSE fechado (`st` só vem com tf).
    if (!d.totalizacao_final) {
      expect(c.comparou).not.toContain("eleitos");
      expect(c.comparou).not.toContain("votos_validos");
    }
    if (c.estado === "confere") {
      expect(c.divergencias).toEqual([]);
      // "Confere" sem ter comparado a conta é a frase falsa de antes (defeito 1).
      expect(c.comparou).toContain("algoritmo");
      expect(c.boletim_dado_ts).not.toBeNull();
      expect(d.quociente_eleitoral_tse).toBe(qe);
    }
    if (c.estado === "sem_dado_tse") {
      expect(c.divergencias).toEqual([]);
      expect(c.comparou).not.toContain("algoritmo");
      expect(d.quociente_eleitoral_tse).toBeNull();
    }
    if (c.estado === "diverge") {
      expect(c.divergencias.length).toBeGreaterThan(0);
      expect(c.boletim_dado_ts).not.toBeNull();
      for (const div of c.divergencias.filter((x) => x.o_que === "cadeiras")) {
        const cod = /agremiação (\S+)/.exec(div.detalhe)?.[1];
        const agr = d.agremiacoes.find((a) => a.cod === cod);
        expect(agr, div.detalhe).toBeDefined();
        expect(div.nosso, div.detalhe).toBe(agr?.cadeiras);
        if (d.totalizacao_final && agr) {
          expect(div.tse, div.detalhe).toBe(linhasDe(uf, agr).filter(eleitoTse).length);
        }
      }
      // O conjunto de eleitos se compara por PESSOA, nunca pelo rótulo: o
      // "Eleito por QP" do TSE não é a nossa via "qp" (simulado de 28/09).
      const linhas = todasAsLinhas(uf).map(({ l }) => l);
      for (const div of c.divergencias.filter((x) => x.o_que === "eleitos")) {
        expect(div.nosso).toBe(linhas.filter((l) => l.parcial && !eleitoTse(l)).length);
        expect(div.tse).toBe(linhas.filter((l) => eleitoTse(l) && !l.parcial).length);
      }
    }
    if (c.estado !== "diverge" && d.totalizacao_final) {
      const linhas = todasAsLinhas(uf).map(({ l }) => l);
      expect(linhas.filter((l) => Boolean(l.parcial) !== eleitoTse(l))).toEqual([]);
    }
  });

  it("mais votados da UF: referências que resolvem, top 10 por voto apurado", () => {
    const esperado = todasAsLinhas(uf)
      .sort((a, b) => b.l.votos - a.l.votos || a.l.sqcand - b.l.sqcand)
      .slice(0, 10)
      .map(({ agr, l }) => ({ cod: agr.cod, sqcand: l.sqcand }));
    expect(d.mais_votados).toEqual(esperado);
    for (const ref of d.mais_votados) {
      const agr = d.agremiacoes.find((a) => a.cod === ref.cod);
      // Resolve no BLOB — a tela não busca a lista 61+ para montar o top 10.
      expect(
        agr?.candidatos.some((l) => l.sqcand === ref.sqcand),
        `${ref.cod}/${ref.sqcand}`,
      ).toBe(true);
    }
  });

  it("agremiações na ordem canônica: cadeiras desc, votos desc, sigla asc", () => {
    const ordenadas = [...d.agremiacoes].sort(
      (a, b) =>
        b.cadeiras - a.cadeiras ||
        b.votos_validos - a.votos_validos ||
        a.sigla.localeCompare(b.sigla, "pt-BR"),
    );
    expect(d.agremiacoes.map((a) => a.cod)).toEqual(ordenadas.map((a) => a.cod));
  });
});

// ---------------------------------------------------------------------------
// deputado/uf-lista/<UF>.json
// ---------------------------------------------------------------------------

describe("deputado-uf-lista.json — só ranks > 60, na mesma forma de linha", () => {
  it("toda UF da lista existe no v2 e toda linha tem rank > 60", () => {
    expect(Object.keys(LISTAS).length).toBeGreaterThan(0);
    for (const [uf, lista] of Object.entries(LISTAS)) {
      expect(lista.contrato).toBe(2);
      expect(lista.uf).toBe(uf);
      expect(ufDe(uf), uf).toBeDefined();
      for (const a of lista.agremiacoes) {
        expect(
          ufDe(uf).agremiacoes.some((x) => x.cod === a.cod),
          `${uf}/${a.cod}`,
        ).toBe(true);
        expect(a.candidatos.length).toBeGreaterThan(0);
        for (const l of a.candidatos) {
          expect(l.rank, `${uf}/${a.cod}/${l.sqcand}`).toBeGreaterThan(60);
          expect(typeof l.sqcand).toBe("number");
        }
      }
    }
  });

  it("nenhum `sqcand` aparece no Blob e na lista ao mesmo tempo", () => {
    for (const [uf, lista] of Object.entries(LISTAS)) {
      const noBlob = new Set(
        ufDe(uf).agremiacoes.flatMap((a) => a.candidatos.map((l) => l.sqcand)),
      );
      for (const l of lista.agremiacoes.flatMap((a) => a.candidatos)) {
        expect(noBlob.has(l.sqcand), `${uf}/${l.sqcand}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Payload nacional — projection-current-dep-t1
// ---------------------------------------------------------------------------

describe("deputado-nacional-v2.json — derivado das UFs, sem ler Blob na capa", () => {
  const ufs = Object.keys(UFS).sort();

  it("bancada = soma das UFs; total fixo em 513; 27 UFs contadas", () => {
    const b = NACIONAL.bancada;
    expect(b.total_cadeiras).toBe(513);
    expect(b.ufs_calculadas + b.ufs_aguardando).toBe(27);
    const somaAgr = b.por_agremiacao.reduce((s, a) => s + a.cadeiras, 0);
    const somaUfs = ufs.reduce(
      (s, uf) => s + ufDe(uf).agremiacoes.reduce((t, a) => t + a.cadeiras, 0),
      0,
    );
    expect(b.cadeiras_atribuidas).toBe(somaAgr);
    expect(b.cadeiras_atribuidas).toBe(somaUfs);
    for (const agr of b.por_agremiacao) {
      const daUf = ufs.flatMap((uf) => ufDe(uf).agremiacoes.filter((a) => a.cod === agr.cod));
      expect(agr.cadeiras, agr.cod).toBe(daUf.reduce((s, a) => s + a.cadeiras, 0));
      expect(agr.votos_nominais, agr.cod).toBe(daUf.reduce((s, a) => s + a.votos_nominais, 0));
      expect(agr.votos_legenda, agr.cod).toBe(daUf.reduce((s, a) => s + a.votos_legenda, 0));
      expect(agr.votos_validos, agr.cod).toBe(agr.votos_nominais + agr.votos_legenda);
    }
  });

  it("`por_uf[]` bate com o Blob de cada UF, inclusive `projecao`", () => {
    expect(NACIONAL.por_uf.map((r) => r.sigla)).toEqual(ufs);
    for (const row of NACIONAL.por_uf) {
      const d = ufDe(row.sigla);
      expect(row.pct_apurado, row.sigla).toBe(d.pct_apurado);
      expect(row.lugares_a_preencher, row.sigla).toBe(d.lugares_a_preencher);
      expect(row.quociente_eleitoral, row.sigla).toBe(d.quociente_eleitoral);
      expect(row.cadeiras_definidas, row.sigla).toBe(
        d.agremiacoes.reduce((s, a) => s + a.cadeiras, 0),
      );
      expect(row.projecao, row.sigla).toEqual(d.projecao);
    }
  });

  it("mais votados do país: top 10 de todas as linhas (Blob ∪ lista), autossuficiente", () => {
    const todas = ufs.flatMap((uf) => todasAsLinhas(uf).map((x) => ({ uf, ...x })));
    const esperado = todas
      .sort((a, b) => b.l.votos - a.l.votos || a.uf.localeCompare(b.uf) || a.l.sqcand - b.l.sqcand)
      .slice(0, 10);
    expect(NACIONAL.mais_votados.length).toBeLessThanOrEqual(10);
    expect(NACIONAL.mais_votados.map((m) => [m.uf, m.sqcand])).toEqual(
      esperado.map((e) => [e.uf, e.l.sqcand]),
    );
    for (const [i, m] of NACIONAL.mais_votados.entries()) {
      const e = esperado[i];
      if (!e) throw new Error(`mais_votados[${i}] sem par esperado`);
      const { agr, l } = e;
      // A capa não lê Blob: a linha nacional carrega tudo que a tela escreve.
      expect(m, `${m.uf}/${m.sqcand}`).toMatchObject({
        nome: l.nome,
        partido: l.partido,
        cod: agr.cod,
        sigla: agr.sigla,
        votos: l.votos,
        pct_validos: l.pct_validos,
      });
    }
  });

  it("puxadores do país: união das UFs, excedente desc, até 30", () => {
    const esperado = ufs
      .flatMap((uf) =>
        ufDe(uf).agremiacoes.flatMap((agr) =>
          (agr.puxadores ?? []).map((p) => ({
            uf,
            sqcand: p.sqcand,
            excedente: p.excedente,
            votos: linhasDe(uf, agr).find((l) => l.sqcand === p.sqcand)?.votos ?? -1,
          })),
        ),
      )
      .sort(
        (a, b) =>
          b.excedente - a.excedente ||
          b.votos - a.votos ||
          a.uf.localeCompare(b.uf) ||
          a.sqcand - b.sqcand,
      )
      .slice(0, 30);
    expect(NACIONAL.puxadores.map((p) => [p.uf, p.sqcand])).toEqual(
      esperado.map((e) => [e.uf, e.sqcand]),
    );
    for (const p of NACIONAL.puxadores) {
      expect(p.quociente_eleitoral, p.uf).toBe(ufDe(p.uf).quociente_eleitoral);
      expect(p.quocientes, `${p.uf}/${p.sqcand}`).toBe(Math.floor(p.votos / p.quociente_eleitoral));
      expect(p.excedente, `${p.uf}/${p.sqcand}`).toBe(p.quocientes - 1);
    }
  });

  it("composição e insights inalterados pelo v2 (m6 continua valendo)", () => {
    expect(NACIONAL.insights).toEqual([]);
    expect(NACIONAL.composition).toEqual({ pre_election: 0, model: 0, actual_results: 1 });
  });
});

// ---------------------------------------------------------------------------
// O que a fixture exercita de propósito — e o caso v1, intocado
// ---------------------------------------------------------------------------

describe("cobertura deliberada da fixture v2", () => {
  const linhas = Object.keys(UFS).flatMap((uf) => todasAsLinhas(uf).map(({ l }) => l));
  const agrs = Object.values(UFS).flatMap((d) => d.agremiacoes);

  it("os três estados da trava, incluindo o fechamento por cobertura de zonas", () => {
    expect(new Set(Object.values(UFS).map((d) => d.projecao.estado))).toEqual(
      new Set(["liberada", "aguardando", "indisponivel"]),
    );
    // O caso do AP no simulado de 28/09: acima de 25%, todas as zonas lidas, e
    // ainda assim fechada — falta um par na nossa tabela de zonas.
    expect(
      Object.values(UFS).some(
        (d) => d.projecao.motivo === "cobertura" && d.pct_apurado >= d.projecao.pct_minimo,
      ),
    ).toBe(true);
  });

  it("os três estados da Conferência, e divergência com magnitude", () => {
    expect(new Set(Object.values(UFS).map((d) => d.conferencia.estado))).toEqual(
      new Set(["confere", "diverge", "sem_dado_tse"]),
    );
    const divs = Object.values(UFS).flatMap((d) => d.conferencia.divergencias);
    expect(divs.some((x) => x.diferenca_pct !== undefined)).toBe(true);
    expect(divs.some((x) => x.o_que === "eleitos")).toBe(true);
  });

  it("rótulo do TSE ≠ nossa via em alguém — a tela não pode tratá-los como a mesma coisa", () => {
    expect(linhas.some((l) => l.parcial === "qp" && l.tse === "eleito_media")).toBe(true);
  });

  it("chapa inteira sub judice: votos à vista, fora de toda conta", () => {
    const chapa = Object.keys(UFS).flatMap((uf) =>
      ufDe(uf).agremiacoes.filter((a) => linhasDe(uf, a).every((l) => l.destino === "sub_judice")),
    );
    expect(chapa.length).toBeGreaterThan(0);
    for (const a of chapa) {
      expect(a.votos_validos, a.sigla).toBe(0);
      expect(a.pct_votos, a.sigla).toBe(0);
      expect(a.cadeiras, a.sigla).toBe(0);
      expect(a.candidatos.length, a.sigla).toBeGreaterThan(0);
      expect(
        a.candidatos.every((l) => l.pct_validos === null && l.votos >= 0),
        a.sigla,
      ).toBe(true);
      // Os votos continuam publicados — esconder a chapa seria esconder o fato.
      expect(
        a.candidatos.some((l) => l.votos > 0),
        a.sigla,
      ).toBe(true);
    }
  });

  it("parcial ≠ projeção em alguém, e as três marcas coexistem nos dados", () => {
    expect(linhas.some((l) => l.parcial && !l.projecao)).toBe(true);
    expect(linhas.some((l) => l.projecao && !l.parcial)).toBe(true);
    expect(linhas.some((l) => l.parcial && l.projecao && l.tse)).toBe(true);
    // Precedência: alguém eleito na parcial que o TSE NÃO elegeu, e o inverso.
    expect(linhas.some((l) => l.parcial && l.tse === "suplente")).toBe(true);
    expect(linhas.some((l) => !l.parcial && l.tse === "eleito_media")).toBe(true);
    expect(linhas.some((l) => l.indefinido)).toBe(true);
    expect(linhas.some((l) => l.projecao_apertada)).toBe(true);
  });

  it("os três destinos fora do nominal e o caso `dvt` ausente", () => {
    const destinos = new Set(linhas.map((l) => l.destino).filter(Boolean));
    expect(destinos).toEqual(new Set(["valido_legenda", "anulado", "sub_judice"]));
    // SP sem destino em linha nenhuma = `dvt` ainda não publicado.
    expect(todasAsLinhas("SP").every(({ l }) => l.destino === undefined)).toBe(true);
  });

  it("chaves opcionais ausentes em algum lugar — o leitor não pode exigi-las", () => {
    expect(Object.values(UFS).some((d) => d.lista === undefined)).toBe(true);
    expect(agrs.some((a) => a.corte === undefined)).toBe(true);
    expect(agrs.some((a) => a.puxadores === undefined)).toBe(true);
    expect(agrs.some((a) => a.cadeiras_ci95 === undefined)).toBe(true);
    expect(linhas.some((l) => l.numero === undefined)).toBe(true);
    expect(agrs.some((a) => a.corte?.primeiro_fora_abaixo_piso_10 === true)).toBe(true);
    expect(NACIONAL.votacao).toBeUndefined();
  });

  it("a fixture v1 (`tests/fixtures/blob/dep-uf.json`) continua sendo o caso v1", () => {
    // O leitor tolerante (RF-276) é testado contra ELA. Se alguém a migrar para
    // v2, o caso "objeto gravado antes do deploy" deixa de ter teste.
    const v1 = v1Fixture as unknown as Record<string, Record<string, unknown>>;
    for (const [uf, d] of Object.entries(v1)) {
      expect(d.contrato, uf).toBeUndefined();
      const agremiacoes = d.agremiacoes as Array<Record<string, unknown>>;
      expect(
        agremiacoes.some((a) => "candidatos" in a),
        uf,
      ).toBe(false);
    }
  });
});
