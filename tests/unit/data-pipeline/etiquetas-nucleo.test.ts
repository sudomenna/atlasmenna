/**
 * tests/unit/data-pipeline/etiquetas-nucleo.test.ts
 *
 * O compilador de etiquetas (spec 024): validação que falha alto (RF-222),
 * revisão (RF-223), precedência (RF-224), turno (RF-225), derivados (RF-226,
 * RF-227), saída determinística (RF-228), lista branca (RF-229) e histórico
 * (RF-239).
 */

import { describe, expect, it } from "vitest";

import type { AlinhamentoInsumo, TrajetoriaInsumo } from "@/data-pipeline/etiquetas-insumos";
import { compilarEtiquetas, relacaoPeloAlinhamento } from "@/data-pipeline/etiquetas-nucleo";
import type { ArquivoNacional } from "@/lib/etiquetas/formato";
import { insumosMajoritario, insumosSenador2031, resolverDeputado } from "@/lib/etiquetas/montagem";
import { resolverCategoria } from "@/lib/etiquetas/resolver";

import {
  AGORA,
  compilarOk,
  csv,
  DEP_RJ_UNIAO,
  DEP_SP_PL,
  DEP_SP_PT,
  DEP_SP_PV,
  entrada,
  GOV_SP_PL,
  GOV_SP_PT,
  mensagensDeErro,
  SEN_SP_PL,
  SEN_SP_PT,
  senadoTeste,
  universoTeste,
} from "../etiquetas/_fixtures";

const FED_PT = {
  chave: "federacao:PT/PC do B/PV",
  categoria: "campo_ideologico",
  valor: "esquerda",
};

function resolverGov(
  n: ArquivoNacional,
  sq: string,
  cat: Parameters<typeof resolverCategoria>[1],
  turno: 1 | 2 = 1,
) {
  const c = n.candidatos[sq];
  if (!c) throw new Error(`sem ${sq}`);
  return resolverCategoria(insumosMajoritario(n, sq, c), cat, turno);
}

// ---------------------------------------------------------------------------
// RF-222 — validação
// ---------------------------------------------------------------------------

describe("RF-222 — validação que falha alto", () => {
  it("fontes vazias compilam, tudo a classificar", () => {
    const r = compilarOk(entrada());
    expect(r.relatorio.linhas).toBe(0);
    expect(Object.keys(r.nacional.candidatos)).toHaveLength(5);
    expect(resolverGov(r.nacional, GOV_SP_PT, "campo_ideologico").estado).toBe("a_classificar");
  });

  it("arquivo ausente é erro", () => {
    expect(mensagensDeErro(entrada({ "governador.csv": null }))).toContain("arquivo ausente");
  });

  it.each([
    ["fonte_url", { fonte_url: "" }, "fonte_url vazia"],
    ["fonte_url sem http", { fonte_url: "exemplo.org" }, "fonte_url vazia"],
    ["fonte_descricao", { fonte_descricao: "" }, "fonte_descricao vazia"],
    ["data vazia", { data: "" }, "inválida"],
    ["data impossível", { data: "2026-02-30" }, "inválida"],
    ["data no futuro", { data: "2026-09-30" }, "no futuro"],
    ["revisado vazio", { revisado: "" }, 'revisado deve ser "sim" ou "nao"'],
    ["revisado sem revisado_em", { revisado_em: "" }, "revisado=sim exige revisado_em"],
  ])("🔴 exige %s", (_n, campos, trecho) => {
    const erros = mensagensDeErro(
      entrada({
        "governador.csv": csv({
          chave: GOV_SP_PT,
          categoria: "campo_ideologico",
          valor: "esquerda",
          ...campos,
        }),
      }),
    );
    expect(erros.some((m) => m.includes(trecho))).toBe(true);
  });

  it("data de hoje (BRT) passa; amanhã não", () => {
    // AGORA = 29/09 12h BRT.
    const hoje = entrada({
      "governador.csv": csv({
        chave: GOV_SP_PT,
        categoria: "campo_ideologico",
        valor: "esquerda",
        data: "2026-09-29",
        revisado_em: "2026-09-29",
      }),
    });
    expect(compilarEtiquetas(hoje).ok).toBe(true);
  });

  it("chave fora do universo, cargo errado e sqcand malformado", () => {
    const erros = mensagensDeErro(
      entrada({
        "governador.csv": csv(
          { chave: "999999999999", categoria: "campo_ideologico", valor: "esquerda" },
          { chave: SEN_SP_PT, categoria: "campo_ideologico", valor: "esquerda" },
          { chave: "PT", categoria: "campo_ideologico", valor: "esquerda" },
        ),
      }),
    );
    expect(erros.filter((m) => m.includes("não é candidatura a cargo 3"))).toHaveLength(2);
    expect(erros.some((m) => m.includes('"PT" não é um sqcand'))).toBe(true);
  });

  it("categoria/valor fora do catálogo, sentinela como valor e categoria que não se aplica", () => {
    const erros = mensagensDeErro(
      entrada({
        "governador.csv": csv(
          { chave: GOV_SP_PT, categoria: "genero", valor: "x" },
          { chave: GOV_SP_PT, categoria: "campo_ideologico", valor: "extrema" },
          { chave: GOV_SP_PL, categoria: "campo_ideologico", valor: "a_classificar" },
          { chave: GOV_SP_PL, categoria: "impeachment_stf", valor: "contra" },
        ),
      }),
    );
    expect(erros.some((m) => m.includes('categoria "genero"'))).toBe(true);
    expect(erros.some((m) => m.includes('valor "extrema"'))).toBe(true);
    expect(erros.some((m) => m.includes('"a_classificar" não é valor de linha'))).toBe(true);
    expect(erros.some((m) => m.includes("impeachment_stf não se aplica a cargo 3"))).toBe(true);
  });

  it("partido: trajetória e impeachment não herdam do partido", () => {
    const erros = mensagensDeErro(
      entrada({
        "partidos.csv": csv(
          { chave: "partido:PL", categoria: "trajetoria_cargo", valor: "estreante" },
          { chave: "partido:PL", categoria: "impeachment_stf", valor: "a_favor" },
        ),
      }),
    );
    expect(erros.filter((m) => m.includes("não aceita padrão por partido"))).toHaveLength(2);
  });

  it("partido e federação inexistentes; arquivo errado para o tipo de chave", () => {
    const erros = mensagensDeErro(
      entrada({
        "partidos.csv": csv(
          { chave: "partido:XYZ", categoria: "campo_ideologico", valor: "centro" },
          { chave: "federacao:ABC/DEF", categoria: "campo_ideologico", valor: "centro" },
          { chave: GOV_SP_PL, categoria: "campo_ideologico", valor: "centro" },
        ),
      }),
    );
    expect(erros.some((m) => m.includes('partido "XYZ"'))).toBe(true);
    expect(erros.some((m) => m.includes('federação "ABC/DEF"'))).toBe(true);
    expect(erros.some((m) => m.includes("deveria ser partido:SIGLA"))).toBe(true);
  });

  it("turno: palanque exige 1/2; as demais recusam turno", () => {
    const erros = mensagensDeErro(
      entrada({
        "governador.csv": csv(
          { chave: GOV_SP_PT, categoria: "palanque_presidencial", valor: "palanque_lula" },
          { chave: GOV_SP_PL, categoria: "campo_ideologico", valor: "direita", turno: "1" },
        ),
      }),
    );
    expect(erros.some((m) => m.includes("exige turno 1 ou 2"))).toBe(true);
    expect(erros.some((m) => m.includes("turno só se usa em palanque_presidencial"))).toBe(true);
  });

  it("duplicata de (chave, categoria, turno) — mesmo com revisado diferente", () => {
    const erros = mensagensDeErro(
      entrada({
        "governador.csv": csv(
          { chave: GOV_SP_PT, categoria: "campo_ideologico", valor: "esquerda" },
          { chave: GOV_SP_PT, categoria: "campo_ideologico", valor: "centro", revisado: "nao" },
        ),
      }),
    );
    expect(erros.some((m) => m.includes("duplicata"))).toBe(true);
  });

  it("palanque em turnos diferentes NÃO é duplicata", () => {
    const r = compilarEtiquetas(
      entrada({
        "governador.csv": csv(
          {
            chave: GOV_SP_PT,
            categoria: "palanque_presidencial",
            valor: "palanque_lula",
            turno: "1",
          },
          {
            chave: GOV_SP_PT,
            categoria: "palanque_presidencial",
            valor: "palanque_duplo",
            turno: "2",
          },
        ),
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("federação precisa de linha própria quando um membro tem linha — sigla com espaço e barra", () => {
    const sem = mensagensDeErro(
      entrada({
        "partidos.csv": csv({
          chave: "partido:PT",
          categoria: "campo_ideologico",
          valor: "esquerda",
        }),
      }),
    );
    expect(sem.some((m) => m.includes('federação "PT/PC DO B/PV" precisa de linha própria'))).toBe(
      true,
    );

    const com = compilarEtiquetas(
      entrada({
        "partidos.csv": csv(
          { chave: "partido:PT", categoria: "campo_ideologico", valor: "esquerda" },
          FED_PT,
        ),
      }),
    );
    expect(com.ok).toBe(true);
  });

  it("senado:X sem foto do Senado é erro; com foto, código desconhecido é erro", () => {
    const semFoto = mensagensDeErro(
      entrada({
        "senado-2031.csv": csv({
          chave: "senado:5000",
          categoria: "impeachment_stf",
          valor: "contra",
        }),
      }),
    );
    expect(semFoto.some((m) => m.includes("foto do Senado"))).toBe(true);
    const desconhecido = mensagensDeErro(
      entrada(
        {
          "senado-2031.csv": csv({
            chave: "senado:1",
            categoria: "impeachment_stf",
            valor: "contra",
          }),
        },
        { senado2031: senadoTeste() },
      ),
    );
    expect(desconhecido.some((m) => m.includes("não está na foto do Senado"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RF-223 / RF-224 / RF-225
// ---------------------------------------------------------------------------

describe("RF-223 — linha não revisada não vai ao ar", () => {
  it("🔴 revisado=nao compila como se não existisse (mas é validada)", () => {
    const r = compilarOk(
      entrada({
        "governador.csv": csv({
          chave: GOV_SP_PT,
          categoria: "campo_ideologico",
          valor: "esquerda",
          revisado: "nao",
          revisado_em: "",
        }),
      }),
    );
    expect(r.nacional.candidatos[GOV_SP_PT]?.x).toBeUndefined();
    expect(resolverGov(r.nacional, GOV_SP_PT, "campo_ideologico").estado).toBe("a_classificar");
    expect(r.relatorio.naoRevisadas).toBe(1);
    expect(JSON.stringify(r.nacional)).not.toContain("Entrevista ao jornal X");
  });

  it("revisado=nao com padrão do partido revisado ⇒ vale o partido", () => {
    const r = compilarOk(
      entrada({
        "governador.csv": csv({
          chave: GOV_SP_PL,
          categoria: "campo_ideologico",
          valor: "centro",
          revisado: "nao",
          revisado_em: "",
        }),
        "partidos.csv": csv({
          chave: "partido:PL",
          categoria: "campo_ideologico",
          valor: "direita",
        }),
      }),
    );
    const res = resolverGov(r.nacional, GOV_SP_PL, "campo_ideologico");
    expect(res.estado === "classificado" && res.etiqueta.valor).toBe("direita");
  });
});

describe("RF-224 — precedência", () => {
  const fontes = {
    "governador.csv": csv({
      chave: GOV_SP_PT,
      categoria: "relacao_governo",
      valor: "independente",
    }),
    "partidos.csv": csv(
      { chave: "partido:PT", categoria: "relacao_governo", valor: "base_governo" },
      { chave: "federacao:PT/PC do B/PV", categoria: "relacao_governo", valor: "oposicao" },
    ),
  };

  it("🔴 individual > partido", () => {
    const r = compilarOk(entrada(fontes));
    const res = resolverGov(r.nacional, GOV_SP_PT, "relacao_governo");
    expect(res.estado).toBe("classificado");
    if (res.estado === "classificado") {
      expect(res.etiqueta.valor).toBe("independente");
      expect(res.etiqueta.origem).toBe("individual");
      expect(res.etiqueta.chave_origem).toBe(GOV_SP_PT);
    }
  });

  it("🔴 partido > federação (o partido é mais específico)", () => {
    const r = compilarOk(entrada(fontes));
    const res = resolveDeputadoCompilado(r, "SP", DEP_SP_PT, "relacao_governo");
    expect(
      res.estado === "classificado" && [res.etiqueta.valor, res.etiqueta.chave_origem],
    ).toEqual(["base_governo", "partido:PT"]);
  });

  it("federação quando o partido-membro não tem linha", () => {
    const r = compilarOk(entrada(fontes));
    const res = resolveDeputadoCompilado(r, "SP", DEP_SP_PV, "relacao_governo");
    expect(res.estado === "classificado" && [res.etiqueta.valor, res.etiqueta.origem]).toEqual([
      "oposicao",
      "partido",
    ]);
  });

  it("governador e senador herdam do partido (decisão do dono de 29/09)", () => {
    const r = compilarOk(entrada(fontes));
    const res = resolverCategoria(
      insumosMajoritario(r.nacional, SEN_SP_PT, r.nacional.candidatos[SEN_SP_PT]!),
      "relacao_governo",
      1,
    );
    expect(res.estado === "classificado" && res.etiqueta.valor).toBe("base_governo");
  });
});

function resolveDeputadoCompilado(
  r: ReturnType<typeof compilarOk>,
  uf: string,
  sq: string,
  cat: Parameters<typeof resolverCategoria>[1],
) {
  return resolverDeputado(r.ufs[uf]!, r.nacional, sq, cat, 1);
}

describe("RF-225 — palanque por turno, sem vazamento", () => {
  it("🔴 valor do 2º turno não vaza para o 1º (nem vice-versa)", () => {
    const r = compilarOk(
      entrada({
        "governador.csv": csv({
          chave: GOV_SP_PL,
          categoria: "palanque_presidencial",
          valor: "palanque_flavio_bolsonaro",
          turno: "2",
        }),
        "partidos.csv": csv(),
      }),
    );
    expect(resolverGov(r.nacional, GOV_SP_PL, "palanque_presidencial", 1).estado).toBe(
      "a_classificar",
    );
    const t2 = resolverGov(r.nacional, GOV_SP_PL, "palanque_presidencial", 2);
    expect(t2.estado === "classificado" && t2.etiqueta.valor).toBe("palanque_flavio_bolsonaro");
  });

  it("padrão do partido também é por turno", () => {
    const r = compilarOk(
      entrada({
        "partidos.csv": csv({
          chave: "partido:PL",
          categoria: "palanque_presidencial",
          valor: "palanque_flavio_bolsonaro",
          turno: "1",
        }),
      }),
    );
    expect(resolverGov(r.nacional, GOV_SP_PL, "palanque_presidencial", 1).estado).toBe(
      "classificado",
    );
    expect(resolverGov(r.nacional, GOV_SP_PL, "palanque_presidencial", 2).estado).toBe(
      "a_classificar",
    );
  });
});

// ---------------------------------------------------------------------------
// RF-226 / RF-227 — derivados
// ---------------------------------------------------------------------------

function trajetoria(
  casa: "camara" | "senado",
  por: Record<
    string,
    {
      t: TrajetoriaInsumo["por_sqcand"] extends ReadonlyMap<string, infer V>
        ? V extends { t: infer T }
          ? T
          : never
        : never;
      ids?: string[];
    }
  >,
  universo: number,
): TrajetoriaInsumo {
  return {
    casa,
    gerado_em: "2026-09-26T10:00:00Z",
    universo,
    por_sqcand: new Map(Object.entries(por).map(([k, v]) => [k, { t: v.t, ids: v.ids ?? [] }])),
    fonte: {
      fonte_url: "https://dadosabertos.camara.leg.br/",
      fonte_descricao: "Câmara",
      data: "2026-09-26",
    },
  };
}

function alinhamento(
  casa: "camara" | "senado",
  por: Record<string, [number, number]>,
): AlinhamentoInsumo {
  return {
    casa,
    corte: "2026-09-03",
    por_id: new Map(
      Object.entries(por).map(([k, [votos, taxa]]) => [
        k,
        { votos_disputadas: votos, taxa_disputadas: taxa },
      ]),
    ),
    fonte: {
      fonte_url: "https://dadosabertos.camara.leg.br/",
      fonte_descricao: "Governismo",
      data: "2026-09-03",
    },
  };
}

describe("RF-227 — relação pelo alinhamento (limiares 65/35/30)", () => {
  const cases: Array<[string, [number, number], string | null]> = [
    ["🔴 taxa exatamente 65 ⇒ base (≥, não >)", [30, 65], "base_governo"],
    ["64,99 ⇒ independente", [30, 64.99], "independente"],
    ["🔴 taxa exatamente 35 ⇒ oposição (≤, não <)", [30, 35], "oposicao"],
    ["35,01 ⇒ independente", [30, 35.01], "independente"],
    ["🔴 29 votos ⇒ amostra pequena ⇒ null (partido)", [29, 90], null],
    ["30 votos ⇒ vale a regra", [30, 90], "base_governo"],
  ];
  it.each(cases)("%s", (_n, [votos, taxa], esperado) => {
    expect(relacaoPeloAlinhamento([7], alinhamento("camara", { "7": [votos, taxa] }))).toBe(
      esperado,
    );
  });

  it("vários ids: soma votos e pondera a taxa pelos votos; ordem dos ids não importa", () => {
    const a = alinhamento("camara", { "1": [20, 90], "2": [20, 40] }); // (1800+800)/40 = 65
    expect(relacaoPeloAlinhamento([1, 2], a)).toBe("base_governo");
    expect(relacaoPeloAlinhamento([2, 1], a)).toBe("base_governo");
    expect(relacaoPeloAlinhamento([1], a)).toBeNull(); // só 20 votos
    expect(relacaoPeloAlinhamento([1, 1], a)).toBeNull(); // id repetido não conta duas vezes
  });

  it("sem id com dado ⇒ null", () => {
    expect(relacaoPeloAlinhamento([], alinhamento("camara", {}))).toBeNull();
    expect(relacaoPeloAlinhamento([9], alinhamento("camara", { "1": [100, 80] }))).toBeNull();
  });

  it("no arquivo de UF: derivado vence o partido; amostra pequena cai no partido", () => {
    const r = compilarOk(
      entrada(
        {
          "partidos.csv": csv({
            chave: "partido:PL",
            categoria: "relacao_governo",
            valor: "oposicao",
          }),
        },
        {
          universo: universoTeste([
            { sqcand: "250002000199", cargo: 6, uf: "SP", partido: "PL", federacao: null },
          ]),
          derivados: {
            trajetoria_camara: trajetoria(
              "camara",
              {
                [DEP_SP_PL]: { t: "em_exercicio", ids: ["11"] },
                "250002000199": { t: "em_exercicio", ids: ["12"] },
              },
              6,
            ),
            alinhamento_camara: alinhamento("camara", { "11": [100, 80], "12": [10, 90] }),
          },
        },
      ),
    );
    const derivado = resolveDeputadoCompilado(r, "SP", DEP_SP_PL, "relacao_governo");
    expect(
      derivado.estado === "classificado" && [derivado.etiqueta.valor, derivado.etiqueta.origem],
    ).toEqual(["base_governo", "derivado"]);
    const pequena = resolveDeputadoCompilado(r, "SP", "250002000199", "relacao_governo");
    expect(
      pequena.estado === "classificado" && [pequena.etiqueta.valor, pequena.etiqueta.origem],
    ).toEqual(["oposicao", "partido"]);
  });

  it("individual vence o derivado", () => {
    const r = compilarOk(
      entrada(
        {
          "deputados-excecoes.csv": csv({
            chave: DEP_SP_PL,
            categoria: "relacao_governo",
            valor: "independente",
          }),
        },
        {
          derivados: {
            trajetoria_camara: trajetoria(
              "camara",
              { [DEP_SP_PL]: { t: "em_exercicio", ids: ["11"] } },
              5,
            ),
            alinhamento_camara: alinhamento("camara", { "11": [100, 80] }),
          },
        },
      ),
    );
    const res = resolveDeputadoCompilado(r, "SP", DEP_SP_PL, "relacao_governo");
    expect(res.estado === "classificado" && res.etiqueta.origem).toBe("individual");
  });

  it("Senado: senador que segue até 2031 pelo próprio código; candidato a Senador pelos senado_codigos", () => {
    const senado = senadoTeste();
    const r = compilarOk(
      entrada(
        {},
        {
          senado2031: senado,
          derivados: {
            trajetoria_senado: trajetoria(
              "senado",
              { [SEN_SP_PL]: { t: "em_exercicio", ids: ["777"] } },
              2,
            ),
            alinhamento_senado: alinhamento("senado", { "5000": [40, 20], "777": [50, 70] }),
          },
        },
      ),
    );
    const s = r.nacional.senado2031.senadores["5000"]!;
    const rs = resolverCategoria(insumosSenador2031(r.nacional, "5000", s), "relacao_governo", 1);
    expect(rs.estado === "classificado" && rs.etiqueta.valor).toBe("oposicao");
    const rc = resolverGov(r.nacional, SEN_SP_PL, "relacao_governo");
    expect(rc.estado === "classificado" && [rc.etiqueta.valor, rc.etiqueta.chave_origem]).toEqual([
      "base_governo",
      "derivado:alinhamento_senado",
    ]);
    const tr = resolverGov(r.nacional, SEN_SP_PL, "trajetoria_cargo");
    expect(tr.estado === "classificado" && tr.etiqueta.valor).toBe("tenta_reeleicao");
  });

  it("senador sem partido (S/Partido) cai em a_classificar sem quebrar", () => {
    const r = compilarOk(
      entrada(
        {
          "partidos.csv": csv(
            { chave: "partido:PT", categoria: "campo_ideologico", valor: "esquerda" },
            FED_PT,
          ),
        },
        { senado2031: senadoTeste() },
      ),
    );
    const semPartido = Object.entries(r.nacional.senado2031.senadores).find(
      ([, s]) => s.partido === null,
    );
    expect(semPartido).toBeDefined();
    const [cod, s] = semPartido!;
    expect(
      resolverCategoria(insumosSenador2031(r.nacional, cod, s), "campo_ideologico", 1).estado,
    ).toBe("a_classificar");
  });
});

describe("RF-226 — trajetória derivada", () => {
  it("mapeamento do dono e ausência ≠ estreante", () => {
    const r = compilarOk(
      entrada(
        {},
        {
          derivados: {
            trajetoria_camara: trajetoria(
              "camara",
              {
                [DEP_SP_PT]: { t: "legislatura_atual" },
                [DEP_SP_PV]: { t: "mandato_anterior" },
                [DEP_RJ_UNIAO]: { t: "estreante" },
              },
              5,
            ),
          },
        },
      ),
    );
    const v = (uf: string, sq: string) => {
      const x = resolveDeputadoCompilado(r, uf, sq, "trajetoria_cargo");
      return x.estado === "classificado" ? x.etiqueta.valor : x.estado;
    };
    expect(v("SP", DEP_SP_PT)).toBe("tenta_reeleicao");
    expect(v("SP", DEP_SP_PV)).toBe("volta_ao_cargo");
    expect(v("RJ", DEP_RJ_UNIAO)).toBe("estreante");
    expect(v("SP", DEP_SP_PL)).toBe("a_classificar"); // ausente do insumo
  });

  it("🔴 universo divergente derruba a compilação", () => {
    const erros = mensagensDeErro(
      entrada({}, { derivados: { trajetoria_camara: trajetoria("camara", {}, 4) } }),
    );
    expect(erros.some((m) => m.includes("universo 4 ≠ 5 candidaturas a Deputado Federal"))).toBe(
      true,
    );
    const errosSen = mensagensDeErro(
      entrada({}, { derivados: { trajetoria_senado: trajetoria("senado", {}, 3) } }),
    );
    expect(errosSen.some((m) => m.includes("universo 3 ≠ 2 candidaturas a Senador"))).toBe(true);
  });

  it("sqcand do insumo fora do cargo derruba a compilação", () => {
    const erros = mensagensDeErro(
      entrada(
        {},
        {
          derivados: {
            trajetoria_camara: trajetoria("camara", { [GOV_SP_PT]: { t: "estreante" } }, 5),
          },
        },
      ),
    );
    expect(erros.some((m) => m.includes("não é candidatura a Deputado Federal"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RF-228 / RF-229 / RF-239
// ---------------------------------------------------------------------------

describe("RF-228 — saída determinística", () => {
  const fontes = {
    "governador.csv": csv({ chave: GOV_SP_PT, categoria: "campo_ideologico", valor: "esquerda" }),
  };

  it("recompilar com o anterior dá o MESMO resultado (versão e data preservadas)", () => {
    const a = compilarOk(entrada(fontes));
    const anterior = {
      nacional: a.nacional,
      ufs: new Map(Object.entries(a.ufs)),
      historico: a.historico,
    };
    const b = compilarOk(entrada(fontes, { anterior, agora: new Date("2026-09-29T20:00:00Z") }));
    expect(b.relatorio.conteudoMudou).toBe(false);
    expect(JSON.stringify(b.nacional)).toBe(JSON.stringify(a.nacional));
    expect(JSON.stringify(b.ufs)).toBe(JSON.stringify(a.ufs));
    expect(JSON.stringify(b.historico)).toBe(JSON.stringify(a.historico));
  });

  it("conteúdo novo ⇒ versão maior que a anterior e que o relógio", () => {
    const a = compilarOk(entrada(fontes));
    const anterior = {
      nacional: a.nacional,
      ufs: new Map(Object.entries(a.ufs)),
      historico: a.historico,
    };
    const depois = new Date("2026-09-29T20:00:00Z");
    const b = compilarOk(
      entrada(
        {
          ...fontes,
          "partidos.csv": csv({ chave: "partido:PL", categoria: "centrao", valor: "nao" }),
        },
        { anterior, agora: depois },
      ),
    );
    expect(b.nacional.meta.versao).toBeGreaterThan(a.nacional.meta.versao);
    expect(b.nacional.meta.versao).toBe(Math.floor(depois.getTime() / 1000));
    expect(b.nacional.meta.gerado_em).toBe(depois.toISOString());
  });

  it("chaves por visão SEMPRE desligadas no compilado", () => {
    const r = compilarOk(entrada(fontes));
    expect(Object.values(r.nacional.publicar).every((v) => v === false)).toBe(true);
  });

  it("27 UFs, sqcand em ordem numérica (11 dígitos antes de 12)", () => {
    const r = compilarOk(
      entrada(
        {},
        {
          universo: universoTeste([
            { sqcand: "99999999999", cargo: 6, uf: "SP", partido: "PL", federacao: null },
          ]),
        },
      ),
    );
    expect(Object.keys(r.ufs)).toHaveLength(27);
    expect(r.ufs.SP?.por_partido.PL).toEqual(["99999999999", DEP_SP_PL]);
  });
});

describe("RF-229 — lista branca na saída", () => {
  it("🔴 a coluna `nota` nunca chega ao gerado", () => {
    const r = compilarOk(
      entrada({
        "governador.csv": csv({
          chave: GOV_SP_PT,
          categoria: "campo_ideologico",
          valor: "esquerda",
          nota: "NOTA-INTERNA-SECRETA",
        }),
      }),
    );
    const tudo = JSON.stringify([r.nacional, r.ufs, r.historico]);
    expect(tudo).not.toContain("NOTA-INTERNA-SECRETA");
    expect(tudo).not.toContain('"nota"');
    expect(Object.keys(r.nacional.candidatos[GOV_SP_PT]!.x!.campo_ideologico!).sort()).toEqual([
      "data",
      "fonte_descricao",
      "fonte_url",
      "revisado_em",
      "valor",
    ]);
  });
});

describe("RF-239 — histórico", () => {
  it("entrada nova, alterada e removida; recompilação sem mudança não acrescenta nada", () => {
    const v1 = compilarOk(
      entrada({
        "governador.csv": csv(
          { chave: GOV_SP_PT, categoria: "campo_ideologico", valor: "esquerda" },
          { chave: GOV_SP_PL, categoria: "campo_ideologico", valor: "direita" },
        ),
      }),
    );
    expect(v1.historico.entradas.map((e) => [e.chave, e.de, e.para])).toEqual(
      [
        [GOV_SP_PT, null, "esquerda"],
        [GOV_SP_PL, null, "direita"],
      ].sort((a, b) => `${a[0]}`.localeCompare(`${b[0]}`)),
    );

    const ant = {
      nacional: v1.nacional,
      ufs: new Map(Object.entries(v1.ufs)),
      historico: v1.historico,
    };
    const v2 = compilarOk(
      entrada(
        {
          "governador.csv": csv({
            chave: GOV_SP_PT,
            categoria: "campo_ideologico",
            valor: "centro_esquerda",
          }),
        },
        { anterior: ant, agora: new Date("2026-09-30T12:00:00Z") },
      ),
    );
    const novas = v2.historico.entradas.slice(v1.historico.entradas.length);
    expect(novas.map((e) => [e.chave, e.de, e.para])).toEqual(
      [
        [GOV_SP_PT, "esquerda", "centro_esquerda"],
        [GOV_SP_PL, "direita", null],
      ].sort((a, b) => `${a[0]}`.localeCompare(`${b[0]}`)),
    );
    // Anteriores intactas (append-only).
    expect(v2.historico.entradas.slice(0, v1.historico.entradas.length)).toEqual(
      v1.historico.entradas,
    );

    const ant2 = {
      nacional: v2.nacional,
      ufs: new Map(Object.entries(v2.ufs)),
      historico: v2.historico,
    };
    const v3 = compilarOk(
      entrada(
        {
          "governador.csv": csv({
            chave: GOV_SP_PT,
            categoria: "campo_ideologico",
            valor: "centro_esquerda",
          }),
        },
        { anterior: ant2, agora: new Date("2026-10-01T12:00:00Z") },
      ),
    );
    expect(v3.historico.entradas).toHaveLength(v2.historico.entradas.length);
  });

  it("mudança de insumo derivado vira UMA entrada-resumo", () => {
    const v1 = compilarOk(entrada());
    const ant = {
      nacional: v1.nacional,
      ufs: new Map(Object.entries(v1.ufs)),
      historico: v1.historico,
    };
    const v2 = compilarOk(
      entrada(
        {},
        {
          anterior: ant,
          agora: new Date("2026-09-30T12:00:00Z"),
          derivados: {
            trajetoria_camara: trajetoria("camara", { [DEP_SP_PT]: { t: "estreante" } }, 5),
          },
        },
      ),
    );
    const e = v2.historico.entradas.at(-1);
    expect(e?.chave).toBe("derivado:trajetoria_camara");
    expect(e?.resumo).toContain("1 classificadas");
  });

  void AGORA;
});
