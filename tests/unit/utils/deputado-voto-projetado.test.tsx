// @vitest-environment happy-dom
/**
 * tests/unit/utils/deputado-voto-projetado.test.tsx — spec 026 RF-297 (emenda
 * do ADR-0063 D1; decisão do dono, 04/10/2026).
 *
 * O voto projetado por candidatura no Deputado Federal:
 *
 *   1. **A regra "eleitos + 7"** ({@link elegiveisAoVotoProjetado}): as
 *      linhas válidas de rank ≤ maior rank marcado (parcial ou projeção) + 7
 *      — o conjunto visível por padrão menos as linhas com destino (emenda
 *      04/10; `DeputadoListaAgremiacao.visivel.test.tsx`), por RANK (nunca
 *      pelo projetado); nada sem projeção visível ou com totalização final.
 *   2. **A tupla** — posição 9 opcional, só nas elegíveis; ausente na rota
 *      61+ (sem conjunto).
 *   3. **O interruptor e o leitor** — desligado remove o campo de toda linha;
 *      valor malformado ou em linha com destino sai.
 *   4. **A tela** — "projeção ≈ … · não oficial" num elemento só, a mais sob
 *      o voto apurado; a ordem das linhas não muda; mais votados só na UF.
 *   5. **`formatVotesCompact`** — 999.500–999.999 ⇒ "1 mi", nunca "1.000 mil".
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tse/log", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tse/log")>();
  return { ...real, logWarn: () => {} };
});

import { LegendaMarcas } from "@/components/atoms/badges/MarcaDeputado";
import {
  DeputadoListaAgremiacao,
  type DeputadoListaAgremiacaoProps,
} from "@/components/blocks/DeputadoListaAgremiacao";
import { DeputadoMaisVotados } from "@/components/blocks/DeputadoMaisVotados";
import {
  aplicarInterruptorProjecao,
  type DeputadoUfDetail,
  type DeputadoUfLinha,
  maisVotadosDaUf,
  sanearDeputadoUfDetail,
} from "@/lib/blob/deputado-uf";
import type { InterruptorProjecaoLido } from "@/lib/edge-config/reader";
import {
  type ContextoMarcas,
  elegiveisAoVotoProjetado,
  L,
  linhasCompactasDaAgremiacao,
  maisVotadosComVotoProjetado,
  NAO_ELEITOS_COM_VOTO_PROJETADO,
  paraLinhaCompacta,
  textoVotoProjetado,
} from "@/lib/utils/deputado-marcas";
import { formatVotesCompact } from "@/lib/utils/format";
import ufSim from "@/tests/fixtures/simulacao/deputado-uf.json" with { type: "json" };
import listaSim from "@/tests/fixtures/simulacao/deputado-uf-lista.json" with { type: "json" };

const VISIVEL: ContextoMarcas = { totalizacaoFinal: false, projecaoVisivel: true };
const OCULTA: ContextoMarcas = { totalizacaoFinal: false, projecaoVisivel: false };
const FINAL: ContextoMarcas = { totalizacaoFinal: true, projecaoVisivel: true };

const LIGADO: InterruptorProjecaoLido = { ligada: true, pct_minimo: 25, origem: "chave" };
const DESLIGADO: InterruptorProjecaoLido = { ligada: false, pct_minimo: 25, origem: "chave" };

const SIM = ufSim as unknown as Record<string, DeputadoUfDetail>;

function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Uma agremiação de 20 linhas, rank 1..20, voto decrescente. `marcadas` são
 * as primeiras ranks com `parcial` (e projeção). O voto projetado é INVERSO
 * ao apurado de propósito: se alguém ordenar por ele, a ordem muda.
 */
function agremiacao(
  marcadas: number,
  extra: (rank: number) => Partial<DeputadoUfLinha> = () => ({}),
): DeputadoUfLinha[] {
  return Array.from({ length: 20 }, (_, k) => {
    const rank = k + 1;
    return {
      sqcand: 250_000_000_000 + rank,
      nome: `CANDIDATO ${rank}`,
      partido: "PT",
      votos: 100_000 - rank * 1_000,
      rank,
      pct_validos: 1.5,
      votos_projetados: 10_000 + rank * 7_000,
      ...(rank <= marcadas ? { parcial: "qp" as const, projecao: "qp" as const } : {}),
      ...extra(rank),
    };
  });
}

// ---------------------------------------------------------------------------
// 1. A regra
// ---------------------------------------------------------------------------

describe("elegiveisAoVotoProjetado — eleitos + 7, por rank", () => {
  it("a constante é a decisão do dono", () => {
    expect(NAO_ELEITOS_COM_VOTO_PROJETADO).toBe(7);
  });

  it("3 marcadas ⇒ ranks 1–10; o 11º (8º sem marca) fica de fora", () => {
    const s = elegiveisAoVotoProjetado(agremiacao(3), VISIVEL);
    expect([...s].map((sq) => sq - 250_000_000_000).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("marcada só na projeção conta como eleita", () => {
    const linhas = agremiacao(0, (r) => (r === 1 ? { projecao: "sobra" } : {}));
    expect(elegiveisAoVotoProjetado(linhas, VISIVEL).size).toBe(1 + 7);
  });

  it("a ordem vem do rank, não da ordem de chegada nem do voto projetado", () => {
    const embaralhadas = [...agremiacao(0)].reverse();
    const s = elegiveisAoVotoProjetado(embaralhadas, VISIVEL);
    expect([...s].map((sq) => sq - 250_000_000_000).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("linha com destino não leva o número, mas ocupa uma das 7 posições (emenda 04/10)", () => {
    const linhas = agremiacao(0, (r) => (r === 2 ? { destino: "sub_judice" } : {}));
    const s = [...elegiveisAoVotoProjetado(linhas, VISIVEL)].map((sq) => sq - 250_000_000_000);
    expect(s).not.toContain(2);
    expect(s.sort((a, b) => a - b)).toEqual([1, 3, 4, 5, 6, 7]);
  });

  it("🔴 sem marca ENTRE eleitos (projeção elege o 12º, não o 11º): o 11º leva, e as 7 contam do 12º", () => {
    // O caso de MG/PT na fixture do simulado: parcial 1..10, projeção também
    // no 12º. Até 03/10 o 11º contava entre as 7 e a lista parava no 18º.
    const linhas = agremiacao(10, (r) => (r === 12 ? { projecao: "sobra" } : {}));
    const s = [...elegiveisAoVotoProjetado(linhas, VISIVEL)].map((sq) => sq - 250_000_000_000);
    expect(s.sort((a, b) => a - b)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });

  it("projeção oculta ou totalização final ⇒ nenhuma", () => {
    expect(elegiveisAoVotoProjetado(agremiacao(3), OCULTA).size).toBe(0);
    expect(elegiveisAoVotoProjetado(agremiacao(3), FINAL).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. A tupla
// ---------------------------------------------------------------------------

describe("paraLinhaCompacta — posição 9 opcional (RF-297)", () => {
  it("presente só nas elegíveis; ausente (nem `undefined` explícito) nas demais", () => {
    const tuplas = linhasCompactasDaAgremiacao(agremiacao(3), VISIVEL);
    const com = tuplas.filter((t) => t[L.VOTOS_PROJ] !== undefined);
    expect(com.map((t) => t[L.RANK])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(com[0]?.[L.VOTOS_PROJ]).toBe(17_000);
    for (const t of tuplas.filter((x) => x[L.VOTOS_PROJ] === undefined)) {
      expect(t).toHaveLength(9);
    }
    expect(com[0]).toHaveLength(10);
  });

  it("a ordem de saída é a de entrada — nada reordena pelo projetado", () => {
    const tuplas = linhasCompactasDaAgremiacao(agremiacao(3), VISIVEL);
    expect(tuplas.map((t) => t[L.RANK])).toEqual(Array.from({ length: 20 }, (_, k) => k + 1));
  });

  it("sem o conjunto (a rota 61+) nunca; com projeção oculta nunca", () => {
    const linha = agremiacao(3)[0] as DeputadoUfLinha;
    expect(paraLinhaCompacta(linha, VISIVEL)).toHaveLength(9);
    expect(linhasCompactasDaAgremiacao(agremiacao(3), OCULTA).some((t) => t.length > 9)).toBe(
      false,
    );
    expect(linhasCompactasDaAgremiacao(agremiacao(3), FINAL).some((t) => t.length > 9)).toBe(false);
  });

  it("linha com destino nunca leva o número, mesmo com o campo no dado", () => {
    const linhas = agremiacao(3, (r) => (r === 1 ? { destino: "anulado" } : {}));
    const t = linhasCompactasDaAgremiacao(linhas, VISIVEL)[0];
    expect(t?.[L.VOTOS_PROJ]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Leitor e interruptor
// ---------------------------------------------------------------------------

describe("leitor e interruptor (RF-265)", () => {
  it("a fixture do simulado traz o campo em SP e nunca na lista 61+", () => {
    const sp = SIM.SP as DeputadoUfDetail;
    const linhas = sp.agremiacoes.flatMap((a) => a.candidatos ?? []);
    expect(linhas.filter((l) => l.votos_projetados !== undefined).length).toBeGreaterThan(100);
    expect(JSON.stringify(listaSim)).not.toContain('"votos_projetados"');
  });

  it("a fixture segue a regra eleitos + 7 em toda agremiação liberada", () => {
    for (const [uf, d] of Object.entries(SIM)) {
      const liberada = d.projecao?.estado === "liberada";
      for (const a of d.agremiacoes) {
        const linhas = a.candidatos ?? [];
        const esperadas = liberada
          ? elegiveisAoVotoProjetado(linhas, { totalizacaoFinal: false, projecaoVisivel: true })
          : new Set<number>();
        const com = new Set(
          linhas.filter((l) => l.votos_projetados !== undefined).map((l) => l.sqcand),
        );
        expect([...com].sort(), `${uf}/${a.sigla}`).toEqual([...esperadas].sort());
      }
    }
  });

  it("interruptor desligado remove o campo de toda linha", () => {
    const sp = sanearDeputadoUfDetail(copia(SIM.SP as DeputadoUfDetail));
    expect(JSON.stringify(sp)).toContain('"votos_projetados"');
    expect(aplicarInterruptorProjecao(sp, LIGADO)).toBe(sp);
    const desligado = aplicarInterruptorProjecao(sp, DESLIGADO);
    expect(JSON.stringify(desligado)).not.toContain('"votos_projetados"');
  });

  it("valor malformado ou em linha com destino sai; inteiro válido fica", () => {
    const sp = copia(SIM.SP as DeputadoUfDetail);
    const linhas = (sp.agremiacoes[0] as { candidatos: DeputadoUfLinha[] }).candidatos;
    const [a, b, c, d] = linhas as [
      DeputadoUfLinha,
      DeputadoUfLinha,
      DeputadoUfLinha,
      DeputadoUfLinha,
    ];
    (a as unknown as Record<string, unknown>).votos_projetados = "652000";
    b.votos_projetados = -1;
    c.votos_projetados = 1.5;
    d.votos_projetados = 652_000;
    const saneado = sanearDeputadoUfDetail(sp);
    const s = (saneado.agremiacoes[0] as { candidatos: DeputadoUfLinha[] }).candidatos;
    expect(s[0]?.votos_projetados).toBeUndefined();
    expect(s[1]?.votos_projetados).toBeUndefined();
    expect(s[2]?.votos_projetados).toBeUndefined();
    expect(s[3]?.votos_projetados).toBe(652_000);

    const comDestino = copia(SIM.SP as DeputadoUfDetail);
    const l0 = (comDestino.agremiacoes[0] as { candidatos: DeputadoUfLinha[] })
      .candidatos[0] as DeputadoUfLinha;
    l0.destino = "anulado";
    l0.pct_validos = null;
    l0.votos_projetados = 1_000;
    const s2 = sanearDeputadoUfDetail(comDestino);
    expect(
      (s2.agremiacoes[0] as { candidatos: DeputadoUfLinha[] }).candidatos[0]?.votos_projetados,
    ).toBeUndefined();
  });

  it("mais votados da UF: repassa o campo e tira dos fora da regra", () => {
    const sp = SIM.SP as DeputadoUfDetail;
    const mv = maisVotadosDaUf(sp);
    expect(mv.some((d) => d.votos_projetados !== undefined)).toBe(true);
    const oculta = maisVotadosComVotoProjetado(mv, sp.agremiacoes, OCULTA);
    expect(oculta.every((d) => !("votos_projetados" in d))).toBe(true);
    expect(oculta.map((d) => d.sqcand)).toEqual(mv.map((d) => d.sqcand));
  });
});

// ---------------------------------------------------------------------------
// 4. A tela
// ---------------------------------------------------------------------------

function props(linhas: DeputadoUfLinha[], ctx: ContextoMarcas): DeputadoListaAgremiacaoProps {
  return {
    uf: "SP",
    cod: "13",
    sigla: "PT",
    linhas: linhasCompactasDaAgremiacao(linhas, ctx),
    totalCandidatos: linhas.length,
    haListaRestante: false,
    rotaLista: null,
    corte: null,
    totalizacaoFinal: ctx.totalizacaoFinal,
    projecaoVisivel: ctx.projecaoVisivel,
    mostrarPartido: false,
    tsDetalhe: "2026-10-04T23:00:00.000Z",
  };
}

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("a tela — DeputadoListaAgremiacao e DeputadoMaisVotados", () => {
  it("'projeção ≈ … · não oficial' num elemento só, sob o voto apurado, nas eleitas + 7", () => {
    const d = doc(
      renderToStaticMarkup(<DeputadoListaAgremiacao {...props(agremiacao(3), VISIVEL)} />),
    );
    const li = [...d.querySelectorAll("li[data-rank]")];
    expect(li.map((x) => x.getAttribute("data-rank"))).toEqual(
      Array.from({ length: 20 }, (_, k) => String(k + 1)),
    );
    const comProj = li.filter((x) => x.textContent?.includes("projeção ≈"));
    expect(comProj.map((x) => x.getAttribute("data-rank"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    const small = comProj[0]?.querySelector(":scope > span:nth-child(3) > small + small");
    expect(small?.textContent).toBe("projeção ≈ 17 mil · não oficial");
    expect(small?.textContent).toContain("não oficial");
    // O voto apurado continua lá, antes.
    expect(comProj[0]?.querySelector(":scope > span:nth-child(3)")?.firstChild?.textContent).toBe(
      "99.000",
    );
  });

  it("sem projeção visível, nenhum número projetado", () => {
    const html = renderToStaticMarkup(
      <DeputadoListaAgremiacao {...props(agremiacao(3), OCULTA)} />,
    );
    expect(html).not.toContain("projeção ≈");
  });

  it("mais votados: na UF aparece; no país, nunca", () => {
    const sp = SIM.SP as DeputadoUfDetail;
    const mv = maisVotadosComVotoProjetado(maisVotadosDaUf(sp), sp.agremiacoes, VISIVEL);
    const naUf = renderToStaticMarkup(
      <DeputadoMaisVotados cargo={6} escopo="uf" uf="SP" linhas={mv} titleId="t" />,
    );
    expect(naUf).toContain("projeção ≈");
    expect(naUf).toContain("· não oficial");
    const noPais = renderToStaticMarkup(
      <DeputadoMaisVotados cargo={6} escopo="pais" linhas={mv} titleId="t" />,
    );
    expect(noPais).not.toContain("projeção ≈");
  });

  it("a legenda explica o número só com a projeção visível", () => {
    const com = renderToStaticMarkup(
      <LegendaMarcas projecaoVisivel totalizacaoFinal={false} uf="SP" />,
    );
    expect(com).toContain("dep-legenda-voto-projetado");
    expect(com).toContain("não oficial");
    const sem = renderToStaticMarkup(
      <LegendaMarcas projecaoVisivel={false} totalizacaoFinal={false} uf="SP" />,
    );
    expect(sem).not.toContain("dep-legenda-voto-projetado");
  });

  it("textoVotoProjetado", () => {
    expect(textoVotoProjetado(652_000)).toBe("projeção ≈ 652 mil · não oficial");
    expect(textoVotoProjetado(1_271_862)).toBe("projeção ≈ 1,3 mi · não oficial");
  });
});

// ---------------------------------------------------------------------------
// 5. formatVotesCompact — o defeito de 999.500–999.999
// ---------------------------------------------------------------------------

describe("formatVotesCompact — fronteira do milhão", () => {
  it.each([
    [999_499, "999 mil"],
    [999_500, "1 mi"],
    [999_999, "1 mi"],
    [1_000_000, "1 mi"],
    [652_000, "652 mil"],
    [-999_999, "-1 mi"],
  ])("%d ⇒ %s", (v, esperado) => {
    expect(formatVotesCompact(v)).toBe(esperado);
  });
});
