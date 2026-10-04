// @vitest-environment happy-dom
/**
 * tests/unit/components/DeputadoListaAgremiacao.visivel.test.tsx — o conjunto
 * VISÍVEL POR PADRÃO de uma agremiação (emenda 04/10, decisão do dono: "para
 * todas as telas de deputados federais e estaduais o padrão do sistema será
 * sempre exibir os eleitos e + 7 abaixo do corte").
 *
 *     visível ⇔ rank ≤ (maior rank eleito NA TELA, ou 0) + 7
 *
 * "Eleito na tela" = alguma marca de `marcasDaLinha`: parcial; projeção só
 * com a projeção visível; "Eleito (TSE)" com a totalização final.
 *
 * Três consumidores da MESMA regra, todos conferidos aqui:
 *   1. o recorte do federal (`li[data-f]` + "Mais N candidatos");
 *   2. o voto projetado por candidatura (RF-297): as válidas do conjunto;
 *   3. o documento das assembleias (`lista-documento.test.ts`).
 *
 * Mutações aplicadas à mão em 04/10, ambas derrubadas por este arquivo:
 *   - `VISIVEIS_ABAIXO_DO_CORTE` 7 → 6: caem "0 eleito ⇒ 7", "1 ⇒ 8",
 *     "15 ⇒ 22" e o texto do botão;
 *   - `ultimoRankVisivelDasTuplas` ignorando o bit de projeção: cai
 *     "projeção visível acrescenta o eleito na projeção".
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DeputadoListaAgremiacao,
  type DeputadoListaAgremiacaoProps,
} from "@/components/blocks/DeputadoListaAgremiacao";
import type { DeputadoUfLinha } from "@/lib/blob/deputado-uf";
import {
  type ContextoMarcas,
  elegiveisAoVotoProjetado,
  L,
  linhasCompactasDaAgremiacao,
  ultimoRankVisivel,
  ultimoRankVisivelDasLinhas,
  ultimoRankVisivelDasTuplas,
  VISIVEIS_ABAIXO_DO_CORTE,
} from "@/lib/utils/deputado-marcas";

const PARCIAL: ContextoMarcas = { totalizacaoFinal: false, projecaoVisivel: false };
const PROJ: ContextoMarcas = { totalizacaoFinal: false, projecaoVisivel: true };
const FINAL: ContextoMarcas = { totalizacaoFinal: true, projecaoVisivel: true };

interface Opcoes {
  parcial?: readonly number[];
  projecao?: readonly number[];
  tse?: readonly number[];
  destino?: Readonly<Record<number, DeputadoUfLinha["destino"]>>;
}

/** `n` linhas de rank 1..n, voto decrescente, com voto projetado em todas. */
function linhas(n: number, o: Opcoes = {}): DeputadoUfLinha[] {
  return Array.from({ length: n }, (_, i) => {
    const rank = i + 1;
    const destino = o.destino?.[rank];
    return {
      sqcand: 900_000 + rank,
      nome: `CANDIDATA ${rank}`,
      partido: "PX",
      votos: 200_000 - rank * 1_000,
      rank,
      pct_validos: destino === "anulado" || destino === "sub_judice" ? null : 1.2,
      votos_projetados: 210_000 - rank * 1_000,
      ...(o.parcial?.includes(rank) ? { parcial: "qp" as const } : {}),
      ...(o.projecao?.includes(rank) ? { projecao: "qp" as const } : {}),
      ...(o.tse?.includes(rank) ? { tse: "eleito_qp" as const } : {}),
      ...(destino ? { destino } : {}),
    };
  });
}

const ate = (k: number) => Array.from({ length: k }, (_, i) => i + 1);

function props(
  brutas: readonly DeputadoUfLinha[],
  ctx: ContextoMarcas,
  over: Partial<DeputadoListaAgremiacaoProps> = {},
): DeputadoListaAgremiacaoProps {
  return {
    uf: "SP",
    cod: "99",
    sigla: "PX",
    linhas: linhasCompactasDaAgremiacao(brutas, ctx),
    totalCandidatos: brutas.length,
    haListaRestante: false,
    rotaLista: null,
    corte: null,
    totalizacaoFinal: ctx.totalizacaoFinal,
    projecaoVisivel: ctx.projecaoVisivel,
    mostrarPartido: false,
    tsDetalhe: "2026-10-04T22:00:00Z",
    ...over,
  };
}

function render(p: DeputadoListaAgremiacaoProps): Document {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(<DeputadoListaAgremiacao {...p} />),
    "text/html",
  );
}

function linhasDoc(doc: ParentNode): HTMLLIElement[] {
  return [...doc.querySelectorAll<HTMLLIElement>("li[data-rank]")];
}

/** Os ranks SEM `data-f` — o que o leitor vê sem clique. */
function visiveis(doc: ParentNode): number[] {
  return linhasDoc(doc)
    .filter((l) => !l.hasAttribute("data-f"))
    .map((l) => Number(l.dataset.rank));
}

// ---------------------------------------------------------------------------
// A regra, pura
// ---------------------------------------------------------------------------

describe("ultimoRankVisivel — maior rank eleito + 7", () => {
  it("a constante é a decisão do dono", () => {
    expect(VISIVEIS_ABAIXO_DO_CORTE).toBe(7);
  });

  it("🔴 0, 1 e k eleitos", () => {
    expect(ultimoRankVisivelDasLinhas(linhas(60), PARCIAL)).toBe(7);
    expect(ultimoRankVisivelDasLinhas(linhas(60, { parcial: [1] }), PARCIAL)).toBe(8);
    expect(ultimoRankVisivelDasLinhas(linhas(60, { parcial: ate(15) }), PARCIAL)).toBe(22);
  });

  it("conta do MAIOR rank eleito, não da quantidade (sub judice no meio)", () => {
    const l = linhas(60, { parcial: [1, 3, 4], destino: { 2: "sub_judice" } });
    expect(ultimoRankVisivelDasLinhas(l, PARCIAL)).toBe(11);
  });

  it("totalização final: só o TSE elege — a parcial e a projeção não contam", () => {
    const l = linhas(60, { parcial: ate(3), projecao: ate(9), tse: ate(12) });
    expect(ultimoRankVisivelDasLinhas(l, FINAL)).toBe(19);
  });

  it("linha com destino nunca é eleita, mesmo com marca no dado", () => {
    const l = linhas(60, { parcial: [1, 30], destino: { 30: "anulado" } });
    expect(ultimoRankVisivelDasLinhas(l, PARCIAL)).toBe(8);
  });

  it("tuplas e linhas do contrato chegam ao MESMO R", () => {
    for (const ctx of [PARCIAL, PROJ, FINAL]) {
      const l = linhas(60, {
        parcial: ate(4),
        projecao: [9],
        tse: ate(6),
        destino: { 2: "anulado" },
      });
      expect(ultimoRankVisivelDasTuplas(linhasCompactasDaAgremiacao(l, ctx))).toBe(
        ultimoRankVisivelDasLinhas(l, ctx),
      );
    }
  });

  it("monótona: acrescentar eleita nunca diminui R (o piso da rota das assembleias)", () => {
    const base = [
      { rank: 1, eleita: true },
      { rank: 2, eleita: false },
      { rank: 3, eleita: false },
    ];
    const r0 = ultimoRankVisivel(base);
    for (let k = 0; k < base.length; k++) {
      const mais = base.map((l, i) => (i === k ? { ...l, eleita: true } : l));
      expect(ultimoRankVisivel(mais)).toBeGreaterThanOrEqual(r0);
    }
  });
});

// ---------------------------------------------------------------------------
// O recorte do federal
// ---------------------------------------------------------------------------

describe("federal — o recorte é o conjunto visível (li[data-f])", () => {
  it("🔴 agremiação sem eleito: as 7 primeiras; o botão conta as 53 recolhidas", () => {
    const doc = render(props(linhas(60), PARCIAL));
    expect(visiveis(doc)).toEqual(ate(7));
    expect(doc.querySelector("[data-testid='dep-ver-mais']")?.textContent).toBe(
      "Mais 53 candidatos de PX",
    );
  });

  it("🔴 1 eleito ⇒ 8 visíveis; 15 eleitos ⇒ 22", () => {
    expect(visiveis(render(props(linhas(60, { parcial: [1] }), PARCIAL)))).toEqual(ate(8));
    const doc = render(props(linhas(60, { parcial: ate(15) }), PARCIAL));
    expect(visiveis(doc)).toEqual(ate(22));
    expect(doc.querySelector("[data-testid='dep-ver-mais']")?.textContent).toBe(
      "Mais 38 candidatos de PX",
    );
  });

  it("singular no botão", () => {
    const doc = render(props(linhas(8), PARCIAL));
    expect(doc.querySelector("[data-testid='dep-ver-mais']")?.textContent).toBe(
      "Mais 1 candidato de PX",
    );
  });

  it("🔴 eleitos + 7 passa de 60: tudo o que está no documento fica visível, sem 'Mais N'", () => {
    // 56 eleitos ⇒ R = 63; o documento só tem 1..60 (o resto é a rota 61+).
    const brutas = linhas(60, { parcial: ate(56) });
    const doc = render(
      props(brutas, PARCIAL, {
        totalCandidatos: 90,
        haListaRestante: true,
        rotaLista: "/uf/SP/deputado-federal/lista",
      }),
    );
    expect(linhasDoc(doc)).toHaveLength(60);
    expect(doc.querySelector("[data-f]")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-ver-mais']")).toBeNull();
    // A rota 61+ continua no "Mostrar todos".
    expect(doc.querySelector("[data-testid='dep-mostrar-todos']")?.textContent).toBe(
      "Mostrar todos os 90 candidatos de PX",
    );
  });

  it("🔴 projeção visível acrescenta o eleito na projeção ao conjunto; oculta, não", () => {
    // Parcial elege 1..3; a projeção elege também o 10º.
    const brutas = linhas(60, { parcial: ate(3), projecao: [...ate(3), 10] });
    expect(visiveis(render(props(brutas, PROJ)))).toEqual(ate(17));
    expect(visiveis(render(props(brutas, PARCIAL)))).toEqual(ate(10));
  });

  it("totalização final: o conjunto é o dos eleitos pelo TSE", () => {
    const brutas = linhas(60, { parcial: ate(3), tse: ate(12) });
    expect(visiveis(render(props(brutas, FINAL)))).toEqual(ate(19));
  });

  it("linha com destino dentro do intervalo fica visível e ocupa uma das 7 posições", () => {
    const brutas = linhas(60, { parcial: ate(3), destino: { 5: "anulado" } });
    const doc = render(props(brutas, PARCIAL));
    expect(visiveis(doc)).toEqual(ate(10));
    expect(linhasDoc(doc)[4]?.textContent).toContain("votos anulados");
  });

  it("🔴 linha de corte (RF-272): logo depois do último eleito, sempre visível", () => {
    const brutas = linhas(60, { parcial: ate(15) });
    const doc = render(
      props(brutas, PARCIAL, {
        corte: {
          ultimoEleito: 900_015,
          primeiroFora: 900_016,
          diferenca: 1_000,
          abaixoPiso10: false,
        },
      }),
    );
    const corte = doc.querySelector("[data-testid='dep-corte']");
    expect(corte?.previousElementSibling?.getAttribute("data-rank")).toBe("15");
    expect(corte?.hasAttribute("data-f")).toBe(false);
    // As 7 abaixo do corte, visíveis; a 8ª, recolhida.
    expect(doc.querySelector("li[data-rank='22']")?.hasAttribute("data-f")).toBe(false);
    expect(doc.querySelector("li[data-rank='23']")?.hasAttribute("data-f")).toBe(true);
  });

  it("assembleias (duas faixas): nada recortado, qualquer que seja o conjunto", () => {
    const doc = render(props(linhas(9), PARCIAL, { duasFaixas: true }));
    expect(doc.querySelector("[data-f]")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-ver-mais']")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RF-297 — o voto projetado é o conjunto visível, menos as linhas com destino
// ---------------------------------------------------------------------------

describe("RF-297 — voto projetado ⊆ visível por padrão", () => {
  const casos: Array<[string, DeputadoUfLinha[]]> = [
    ["sem eleito", linhas(60)],
    ["1 eleito", linhas(60, { parcial: [1] })],
    ["15 eleitos", linhas(60, { parcial: ate(15) })],
    ["projeção além da parcial", linhas(60, { parcial: ate(3), projecao: [...ate(3), 10] })],
    [
      "destinos no meio",
      linhas(60, { parcial: ate(4), destino: { 2: "anulado", 6: "sub_judice" } }),
    ],
    ["eleitos + 7 > 60", linhas(60, { parcial: ate(56) })],
  ];

  for (const [nome, brutas] of casos) {
    it(`🔴 ${nome}: o número sai EXATAMENTE nas válidas visíveis`, () => {
      const tuplas = linhasCompactasDaAgremiacao(brutas, PROJ);
      const r = ultimoRankVisivelDasTuplas(tuplas);
      const comNumero = tuplas.filter((t) => t[L.VOTOS_PROJ] !== undefined).map((t) => t[L.RANK]);
      const validasVisiveis = tuplas
        .filter((t) => t[L.RANK] <= r && t[L.DESTINO] === 0)
        .map((t) => t[L.RANK]);
      expect(comNumero).toEqual(validasVisiveis);
      // E na tela: nenhuma linha recolhida mostra o número.
      const doc = render(props(brutas, PROJ));
      for (const li of linhasDoc(doc)) {
        if (li.hasAttribute("data-f")) expect(li.textContent).not.toContain("projeção ≈");
      }
    });
  }

  it("o conjunto do voto projetado é o mesmo de `elegiveisAoVotoProjetado`", () => {
    const brutas = linhas(60, { parcial: ate(3), projecao: [...ate(3), 10] });
    const sq = [...elegiveisAoVotoProjetado(brutas, PROJ)].map((s) => s - 900_000);
    expect(sq.sort((a, b) => a - b)).toEqual(ate(17));
  });
});
