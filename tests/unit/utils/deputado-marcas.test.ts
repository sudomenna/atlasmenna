/**
 * tests/unit/utils/deputado-marcas.test.ts — spec 026 (RF-261, RF-262, RF-264,
 * RF-266, RF-267), design 026 § 4 e § 8.3.
 *
 * `lib/utils/deputado-marcas.ts` é o ÚNICO lugar que decide a marca de uma
 * linha de Deputado Federal. Estes testes travam:
 *
 *   - a precedência do TSE (M29): com totalização final, parcial e projeção
 *     somem da UF inteira — inclusive do candidato que a nossa conta elegia e o
 *     TSE não;
 *   - as DUAS leituras da projeção (M30): o estado publicado E o interruptor —
 *     objeto liberado com interruptor desligado não mostra marca;
 *   - "eleito" nunca sozinho (M31);
 *   - a ordem é o `rank`, nunca a marca (M28);
 *   - o ida-e-volta da tupla/bitmask que o servidor manda ao cliente.
 *
 * Parte dos casos roda sobre `tests/fixtures/contrato/deputado-uf-v2.json`
 * (escrita à mão no formato de produção, com os números passados pelo
 * algoritmo real — ver o README daquela pasta): as invariantes de contagem são
 * recalculadas a partir das marcas DERIVADAS, nunca lidas do campo que conferem.
 */

import { describe, expect, it } from "vitest";

import {
  BIT_MARCA,
  bitsDasMarcas,
  codigoDoDestino,
  destinoDoCodigo,
  destinoSemPercentual,
  fraseCorte,
  fraseCorteCabecalho,
  fraseEstadoProjecao,
  L,
  type LinhaCompacta,
  type LinhaDeputado,
  linhasCompactasDoV1,
  type Marca,
  marcasDaLinha,
  marcasDosBits,
  ordenarPorRank,
  paraLinhaCompacta,
  projecaoVisivel,
  seloEstadoProjecao,
  TEXTO_MARCA,
  textoCorridoDaMarca,
  unirPorSqcand,
} from "@/lib/utils/deputado-marcas";
import contratoUf from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

type LinhaFixture = LinhaDeputado & { indefinido?: true; projecao_apertada?: true };
interface AgrFixture {
  cod: string;
  cadeiras: number;
  cadeiras_projetadas?: number;
  candidatos: LinhaFixture[];
}
interface UfFixture {
  totalizacao_final: boolean;
  projecao: { estado: string };
  agremiacoes: AgrFixture[];
}
const UFS = contratoUf as unknown as Record<"AC" | "AP" | "RR" | "SP", UfFixture>;

function linha(over: Partial<LinhaDeputado> = {}): LinhaDeputado {
  return {
    sqcand: 100,
    nome: "Fulano",
    partido: "PL",
    votos: 1000,
    rank: 1,
    pct_validos: 1.23456,
    ...over,
  };
}

const ABERTO = { totalizacaoFinal: false, projecaoVisivel: true };
const FECHADO = { totalizacaoFinal: false, projecaoVisivel: false };
const FINAL = { totalizacaoFinal: true, projecaoVisivel: true };

describe("projecaoVisivel — as duas leituras, sempre juntas (RF-265, M30)", () => {
  it("liberada + interruptor ligado ⇒ visível", () => {
    expect(projecaoVisivel({ estado: "liberada" }, true)).toBe(true);
  });

  it("🔴 liberada + interruptor DESLIGADO ⇒ invisível (desligar age no render)", () => {
    expect(projecaoVisivel({ estado: "liberada" }, false)).toBe(false);
  });

  it("interruptor ligado + estado ≠ liberada ⇒ invisível", () => {
    expect(projecaoVisivel({ estado: "aguardando" }, true)).toBe(false);
    expect(projecaoVisivel({ estado: "indisponivel" }, true)).toBe(false);
  });

  it("sem estado (objeto v1) ⇒ invisível", () => {
    expect(projecaoVisivel(undefined, true)).toBe(false);
    expect(projecaoVisivel(null, true)).toBe(false);
  });
});

describe("marcasDaLinha — precedência (design § 4)", () => {
  it("parcial e projeção coexistem quando a projeção é visível", () => {
    const m = marcasDaLinha(linha({ parcial: "qp", projecao: "sobra" }), ABERTO);
    expect(m).toEqual([
      { tipo: "parcial", via: "qp", apertada: false },
      { tipo: "projecao", via: "sobra", apertada: false },
    ]);
  });

  it("🔴 M30 — com a projeção invisível, a marca de projeção NÃO sai (mesmo com `projecao` na linha)", () => {
    const m = marcasDaLinha(linha({ parcial: "qp", projecao: "qp" }), FECHADO);
    expect(m.map((x) => x.tipo)).toEqual(["parcial"]);
  });

  it("🔴 M29 — com totalização final, só o TSE: parcial e projeção somem", () => {
    const m = marcasDaLinha(linha({ parcial: "qp", projecao: "qp", tse: "eleito_media" }), FINAL);
    expect(m).toEqual([{ tipo: "tse", rotulo: "eleito_media" }]);
  });

  it("🔴 M29 — a nossa conta elegia e o TSE não: NENHUMA marca", () => {
    for (const tse of ["suplente", "nao_eleito"] as const) {
      expect(marcasDaLinha(linha({ parcial: "sobra", projecao: "sobra", tse }), FINAL)).toEqual([]);
    }
  });

  it("com totalização final e sem `tse` na linha, nenhuma marca (o TSE não publicou ⇒ não adivinhamos)", () => {
    expect(marcasDaLinha(linha({ parcial: "qp" }), FINAL)).toEqual([]);
  });

  it("sem totalização final, `tse` é ignorado — ele só vale com `tf`", () => {
    expect(marcasDaLinha(linha({ tse: "eleito_qp" }), ABERTO)).toEqual([]);
  });

  it("destino presente ⇒ nenhuma marca, mesmo com `parcial` e `tse` (defensivo, ADR-0064)", () => {
    for (const destino of ["valido_legenda", "anulado", "sub_judice"] as const) {
      expect(marcasDaLinha(linha({ destino, parcial: "qp" }), ABERTO)).toEqual([]);
      expect(marcasDaLinha(linha({ destino, tse: "eleito" }), FINAL)).toEqual([]);
    }
  });

  it("'apertada' só existe com via sobra — `indefinido` numa vaga de QP não vira apertada", () => {
    expect(marcasDaLinha(linha({ parcial: "qp", indefinido: true }), ABERTO)).toEqual([
      { tipo: "parcial", via: "qp", apertada: false },
    ]);
    expect(marcasDaLinha(linha({ parcial: "sobra", indefinido: true }), ABERTO)).toEqual([
      { tipo: "parcial", via: "sobra", apertada: true },
    ]);
    expect(marcasDaLinha(linha({ projecao: "sobra", projecao_apertada: true }), ABERTO)).toEqual([
      { tipo: "projecao", via: "sobra", apertada: true },
    ]);
  });
});

describe("marcasDaLinha sobre a fixture de contrato — invariantes de contagem", () => {
  function contar(uf: UfFixture, interruptor: boolean) {
    const ctx = {
      totalizacaoFinal: uf.totalizacao_final,
      projecaoVisivel: projecaoVisivel(uf.projecao, interruptor),
    };
    return uf.agremiacoes.map((a) => {
      const marcas = a.candidatos.flatMap((c) => marcasDaLinha(c, ctx));
      return {
        a,
        parcial: marcas.filter((m) => m.tipo === "parcial").length,
        projecao: marcas.filter((m) => m.tipo === "projecao").length,
        tse: marcas.filter((m) => m.tipo === "tse").length,
      };
    });
  }

  it("RF-262 — sem `tf`, as marcas de parcial batem com `cadeiras` em cada agremiação (RR, AP, SP)", () => {
    for (const sigla of ["RR", "AP", "SP"] as const) {
      for (const x of contar(UFS[sigla], true)) {
        expect(x.parcial, `${sigla}/${x.a.cod}`).toBe(x.a.cadeiras);
        expect(x.tse, `${sigla}/${x.a.cod}`).toBe(0);
      }
    }
  });

  it("RF-263 — RR liberada + interruptor ligado: marcas de projeção == `cadeiras_projetadas`", () => {
    for (const x of contar(UFS.RR, true)) {
      expect(x.projecao, x.a.cod).toBe(x.a.cadeiras_projetadas ?? 0);
    }
  });

  it("🔴 RR liberada + interruptor DESLIGADO: zero marca de projeção", () => {
    for (const x of contar(UFS.RR, false)) expect(x.projecao, x.a.cod).toBe(0);
  });

  it("SP aguardando (18,7%): zero marca de projeção mesmo com o interruptor ligado", () => {
    for (const x of contar(UFS.SP, true)) expect(x.projecao, x.a.cod).toBe(0);
  });

  it("RF-267 — AC com `tf`: só marcas do TSE, e uma por eleito do TSE", () => {
    const eleitosTse = UFS.AC.agremiacoes
      .flatMap((a) => a.candidatos)
      .filter((c) => c.tse === "eleito_qp" || c.tse === "eleito_media" || c.tse === "eleito");
    const contagem = contar(UFS.AC, true);
    expect(contagem.reduce((s, x) => s + x.tse, 0)).toBe(eleitosTse.length);
    for (const x of contagem) {
      expect(x.parcial, x.a.cod).toBe(0);
      expect(x.projecao, x.a.cod).toBe(0);
    }
  });

  it("RF-262 — AC: o candidato que a nossa conta elegia e o TSE não (10002610019) sai sem marca", () => {
    const c = UFS.AC.agremiacoes.flatMap((a) => a.candidatos).find((x) => x.sqcand === 10002610019);
    expect(c?.parcial).toBe("sobra");
    expect(c?.tse).toBe("suplente");
    expect(
      marcasDaLinha(c as LinhaDeputado, { totalizacaoFinal: true, projecaoVisivel: true }),
    ).toEqual([]);
  });
});

describe("texto — nunca 'eleito' sozinho (RF-266, M31)", () => {
  const todas: Marca[] = [
    { tipo: "parcial", via: "qp", apertada: false },
    { tipo: "parcial", via: "sobra", apertada: true },
    { tipo: "parcial", via: null, apertada: false },
    { tipo: "projecao", via: "qp", apertada: false },
    { tipo: "projecao", via: "sobra", apertada: true },
    { tipo: "tse", rotulo: "eleito_qp" },
    { tipo: "tse", rotulo: "eleito_media" },
    { tipo: "tse", rotulo: "eleito" },
  ];

  it("os três textos principais são exatamente os do RF-266", () => {
    expect(TEXTO_MARCA).toEqual({
      parcial: "eleito na parcial",
      projecao: "eleito na projeção · não oficial",
      tse: "Eleito (TSE)",
    });
  });

  it("toda marca começa por um dos três textos, e toda ocorrência de 'eleito' é qualificada", () => {
    for (const m of todas) {
      const t = textoCorridoDaMarca(m);
      expect(
        t.startsWith(TEXTO_MARCA.parcial) ||
          t.startsWith(TEXTO_MARCA.projecao) ||
          t.startsWith(TEXTO_MARCA.tse),
        t,
      ).toBe(true);
      // Cada "eleito" é seguido de "na parcial", "na projeção", "(TSE)" ou é a
      // citação literal do TSE ("Eleito por QP"/"Eleito por média").
      const soltos = t.match(
        /\beleito\b(?!\s+(na parcial|na projeção|\(TSE\)|por QP|por média))/gi,
      );
      expect(soltos, t).toBeNull();
    }
  });

  it("a marca de projeção sempre carrega 'não oficial' (constituição § 1)", () => {
    for (const m of todas.filter((x) => x.tipo === "projecao")) {
      expect(textoCorridoDaMarca(m)).toContain("não oficial");
    }
  });

  it("a via é NOSSA ('pelo quociente'/'nas sobras') e nunca aparece na marca do TSE", () => {
    expect(textoCorridoDaMarca({ tipo: "parcial", via: "qp", apertada: false })).toBe(
      "eleito na parcial · pelo quociente",
    );
    expect(textoCorridoDaMarca({ tipo: "tse", rotulo: "eleito_qp" })).toBe(
      "Eleito (TSE) · “Eleito por QP”",
    );
    expect(textoCorridoDaMarca({ tipo: "tse", rotulo: "eleito" })).toBe("Eleito (TSE)");
    expect(textoCorridoDaMarca({ tipo: "tse", rotulo: "eleito_media" })).not.toMatch(
      /quociente|sobras/,
    );
  });
});

describe("bitmask — o ida e volta que o servidor manda ao cliente", () => {
  it("toda combinação válida volta idêntica", () => {
    const vias = ["qp", "sobra"] as const;
    const combos: Marca[][] = [[]];
    for (const via of [...vias, null]) {
      for (const apertada of [false, true]) {
        combos.push([{ tipo: "parcial", via, apertada }]);
        for (const pv of vias) {
          for (const pa of [false, true]) {
            combos.push([
              { tipo: "parcial", via, apertada },
              { tipo: "projecao", via: pv, apertada: pa },
            ]);
          }
        }
      }
    }
    for (const rotulo of ["eleito_qp", "eleito_media", "eleito"] as const) {
      combos.push([{ tipo: "tse", rotulo }]);
    }
    for (const c of combos) expect(marcasDosBits(bitsDasMarcas(c))).toEqual(c);
  });

  it("bits distintos entre si (nenhum colide)", () => {
    const vals = Object.values(BIT_MARCA);
    expect(new Set(vals).size).toBe(vals.length);
    for (const v of vals) expect(Math.log2(v) % 1).toBe(0);
  });

  it("destino: tabela fechada, ida e volta; valor desconhecido ⇒ ausente", () => {
    for (const d of ["valido_legenda", "anulado", "sub_judice"] as const) {
      expect(destinoDoCodigo(codigoDoDestino(d))).toBe(d);
    }
    expect(codigoDoDestino(undefined)).toBe(0);
    expect(codigoDoDestino("inventado" as never)).toBe(0);
    expect(destinoDoCodigo(0)).toBeNull();
    expect(destinoDoCodigo(9)).toBeNull();
  });
});

describe("paraLinhaCompacta — a tupla (design § 8.3)", () => {
  it("posição fixa, marcas derivadas e funções de exibição aplicadas", () => {
    const t = paraLinhaCompacta(
      linha({ numero: 2201, parcial: "sobra", indefinido: true, projecao: "qp" }),
      ABERTO,
      { nome: (n) => n.toUpperCase(), partido: (p) => `[${p}]`, mostrarPartido: true },
    );
    expect(t[L.RANK]).toBe(1);
    expect(t[L.SQCAND]).toBe(100);
    expect(t[L.NOME]).toBe("FULANO");
    expect(t[L.PARTIDO]).toBe("[PL]");
    expect(t[L.NUMERO]).toBe(2201);
    expect(t[L.PCT]).toBe(1.23456);
    expect(marcasDosBits(t[L.MARCAS])).toEqual([
      { tipo: "parcial", via: "sobra", apertada: true },
      { tipo: "projecao", via: "qp", apertada: false },
    ]);
    expect(t[L.DESTINO]).toBe(0);
  });

  it("RF-261 — anulado e sub judice: o % sai `null` mesmo que o dado traga número; e nunca marca", () => {
    const t = paraLinhaCompacta(
      linha({ destino: "sub_judice", pct_validos: 3.5, parcial: "qp" }),
      ABERTO,
    );
    expect(t[L.PCT]).toBeNull();
    expect(t[L.MARCAS]).toBe(0);
    expect(t[L.DESTINO]).toBe(3);
    const a = paraLinhaCompacta(linha({ destino: "anulado", pct_validos: 3.5 }), ABERTO);
    expect(a[L.PCT]).toBeNull();
    expect(a[L.DESTINO]).toBe(2);
  });

  it('🔴 ADR-0064 (emenda 29/09) — "Válido (legenda)": o % sai NUMÉRICO, como o contrato publica; nunca marca', () => {
    const t = paraLinhaCompacta(
      linha({ destino: "valido_legenda", pct_validos: 2.25125, parcial: "qp" }),
      ABERTO,
    );
    expect(t[L.PCT]).toBe(2.25125);
    expect(t[L.MARCAS]).toBe(0);
    expect(t[L.DESTINO]).toBe(1);
    // Só anulado e sub judice ficam sem %.
    expect(destinoSemPercentual(codigoDoDestino("valido_legenda"))).toBe(false);
    expect(destinoSemPercentual(codigoDoDestino("anulado"))).toBe(true);
    expect(destinoSemPercentual(codigoDoDestino("sub_judice"))).toBe(true);
    expect(destinoSemPercentual(0)).toBe(false);
  });

  it("RF-261 — sem `numero` a tupla leva `null`, nunca `undefined`", () => {
    const t = paraLinhaCompacta(linha(), ABERTO);
    expect(t[L.NUMERO]).toBeNull();
    expect(JSON.stringify(t)).not.toContain("undefined");
  });

  it("partido isolado: a coluna não existe e a string não viaja", () => {
    expect(paraLinhaCompacta(linha(), ABERTO, { mostrarPartido: false })[L.PARTIDO]).toBe("");
  });
});

describe("ordem — o rank do produtor, nunca a marca (constituição § 2, M28)", () => {
  function t(rank: number, sq: number, marcas = 0): LinhaCompacta {
    return [rank, sq, `C${rank}`, "", null, 1000 - rank, 1, marcas, 0];
  }

  it("ordenarPorRank segue o rank e desempata por sqcand", () => {
    const entrada = [t(3, 30), t(1, 10, BIT_MARCA.PROJECAO), t(2, 21), t(2, 20)];
    expect(ordenarPorRank(entrada).map((x) => x[L.SQCAND])).toEqual([10, 20, 21, 30]);
  });

  it("🔴 marca de projeção NÃO sobe a linha — só o rank decide", () => {
    const entrada = [t(1, 10), t(2, 20, BIT_MARCA.PROJECAO | BIT_MARCA.PARCIAL)];
    expect(ordenarPorRank(entrada).map((x) => x[L.RANK])).toEqual([1, 2]);
  });

  it("unirPorSqcand nunca duplica, e a linha que já estava vence", () => {
    const atuais = [t(1, 10), t(61, 610, BIT_MARCA.PARCIAL)];
    const novas = [t(61, 610), t(62, 620)];
    const { linhas, acrescentadas } = unirPorSqcand(atuais, novas);
    expect(linhas.map((x) => x[L.SQCAND])).toEqual([10, 610, 620]);
    expect(acrescentadas.map((x) => x[L.SQCAND])).toEqual([620]);
    expect(linhas[1]?.[L.MARCAS]).toBe(BIT_MARCA.PARCIAL);
  });
});

describe("objeto v1 (RF-276)", () => {
  it("eleitos (marcados na parcial, sem via) e depois suplentes; rank é a posição montada", () => {
    const linhas = linhasCompactasDoV1({
      eleitos: [
        { sqcand: 2, nome: "B", partido: "PL", votos: 50, ordem: 2, indefinido: true },
        { sqcand: 1, nome: "A", partido: "PL", votos: 90, ordem: 1 },
      ],
      // `ordem` recomeçando em 1 — acontece em objeto real.
      suplentes: [{ sqcand: 3, nome: "C", partido: "PL", votos: 10, ordem: 1 }],
    });
    expect(linhas.map((l) => [l[L.RANK], l[L.SQCAND]])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(marcasDosBits(linhas[0]?.[L.MARCAS] ?? 0)).toEqual([
      { tipo: "parcial", via: null, apertada: false },
    ]);
    expect(marcasDosBits(linhas[1]?.[L.MARCAS] ?? 0)).toEqual([
      { tipo: "parcial", via: null, apertada: true },
    ]);
    expect(linhas[2]?.[L.MARCAS]).toBe(0);
    // v1: sem % nem número.
    for (const l of linhas) {
      expect(l[L.PCT]).toBeNull();
      expect(l[L.NUMERO]).toBeNull();
    }
  });
});

describe("frases do estado da projeção (RF-264, RF-266)", () => {
  const base = { pct_minimo: 25, zonas_apuradas: 3, zonas_total: 16 };

  it("toda variante diz 'projeção' e 'não oficial' na mesma frase", () => {
    const casos = [
      { estado: "liberada" },
      { estado: "aguardando", motivo: "pct_minimo" },
      { estado: "aguardando", motivo: "zonas_minimas" },
      { estado: "aguardando", motivo: "sem_vagas" },
      { estado: "indisponivel", motivo: "interruptor" },
      { estado: "indisponivel", motivo: "coligacao" },
      { estado: "indisponivel", motivo: "cobertura" },
      { estado: "indisponivel", motivo: "erro" },
      { estado: "indisponivel", motivo: "desconhecido" },
    ];
    for (const c of casos) {
      const f = fraseEstadoProjecao({ ...base, ...c }, 18.7) ?? "";
      expect(f, JSON.stringify(c)).toMatch(/projeção/i);
      expect(f, JSON.stringify(c)).toContain("não oficial");
      const s = seloEstadoProjecao({ ...base, ...c }) ?? "";
      expect(s, JSON.stringify(c)).toMatch(/projeção/i);
      expect(s, JSON.stringify(c)).toContain("não oficial");
    }
  });

  it("o piso e o % atual saem do dado — 25% e 18,7% não são literais", () => {
    const f = fraseEstadoProjecao(
      { ...base, estado: "aguardando", motivo: "pct_minimo" },
      18.71204,
    );
    expect(f).toContain("25%");
    expect(f).toContain("18,7%");
    const g = fraseEstadoProjecao(
      { ...base, pct_minimo: 40, estado: "aguardando", motivo: "pct_minimo" },
      3,
    );
    expect(g).toContain("40%");
    expect(g).not.toContain("25%");
  });

  it("sem estado publicado (v1) ⇒ nada a dizer", () => {
    expect(fraseEstadoProjecao(undefined, 50)).toBeNull();
    expect(seloEstadoProjecao(null)).toBeNull();
  });
});

describe("linha de corte (RF-272)", () => {
  it("diz a diferença, que é da PARCIAL, e os nomes", () => {
    const f = fraseCorte({ diferenca: 599 }, { ultimo: "A", primeiro: "B" });
    expect(f).toBe(
      "Linha de corte: 599 votos separam o último eleito na parcial (A) do primeiro de fora (B).",
    );
  });

  it("avisa o piso de 10% quando o primeiro de fora está abaixo dele", () => {
    const f = fraseCorteCabecalho({ diferenca: 9550, primeiro_fora_abaixo_piso_10: true });
    expect(f).toContain("9.550 votos");
    expect(f).toContain("abaixo do piso de 10% do quociente eleitoral");
  });
});
