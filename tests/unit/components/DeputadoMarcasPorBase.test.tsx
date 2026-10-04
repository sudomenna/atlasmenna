// @vitest-environment happy-dom
/**
 * tests/unit/components/DeputadoMarcasPorBase.test.tsx — decisão do dono de
 * 04/10: as marcas de candidato de deputado mostram UMA base por vez, conforme
 * o seletor global Parcial/Projeção (`<html data-view>`).
 *
 *   - Projeção visível (Federal, interruptor ligado e trava aberta): na
 *     "Parcial" só "eleito na parcial" (+ "sobra apertada") e a linha de
 *     corte; na "Projeção" só "eleito na projeção · não oficial" (+
 *     "apertada") e o voto projetado.
 *   - Sem projeção visível (Estadual/Distrital sempre; Federal com interruptor
 *     desligado ou trava fechada): as marcas da parcial nas DUAS bases, e a
 *     "Projeção" ganha um aviso curto.
 *   - "Eleito (TSE)" nas duas, sempre.
 *
 * O que decide "visível" aqui é o CSS de verdade: o bloco "Uma base por vez"
 * de `DeputadoListaAgremiacao.module.css` (com a classe do módulo como o
 * Vitest a nomeia) e as duas regras globais de `[data-view-only]` de
 * `app/globals.css` — lidos dos arquivos, injetados no documento do happy-dom
 * e medidos por `getComputedStyle`. Um elemento é visível se nem ele nem
 * nenhum ancestral está em `display: none`.
 *
 * Mutações aplicadas à mão (04/10), todas derrubam casos daqui:
 *   M1 — `data-proj` da `<ol>` removido (as duas marcas de volta, sem base);
 *   M2 — o bloco de CSS "Uma base por vez" removido;
 *   M3 — `data-view-only` dos itens da legenda removido;
 *   M4 — `avisoSemProjecao` devolvendo sempre `null`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LegendaMarcas } from "@/components/atoms/badges/MarcaDeputado";
import {
  _limparCacheListas,
  DeputadoListaAgremiacao,
  type DeputadoListaAgremiacaoProps,
} from "@/components/blocks/DeputadoListaAgremiacao";
import styles from "@/components/blocks/DeputadoListaAgremiacao.module.css";
import {
  DeputadoMaisVotados,
  type LinhaMaisVotados,
} from "@/components/blocks/DeputadoMaisVotados";
import type { DeputadoUfLinha, DeputadoUfLista } from "@/lib/blob/deputado-uf";
import {
  AVISO_SEM_PROJECAO,
  avisoSemProjecao,
  BIT_MARCA,
  bitsDasMarcas,
  type ContextoMarcas,
  cargoTemProjecao,
  type LinhaCompacta,
  marcasDaLinha,
  separaBases,
} from "@/lib/utils/deputado-marcas";

// ---------------------------------------------------------------------------
// O CSS de verdade no documento
// ---------------------------------------------------------------------------

const RAIZ = path.resolve(__dirname, "../../..");

function cssDoModulo(): string {
  const bruto = readFileSync(
    path.join(RAIZ, "components/blocks/DeputadoListaAgremiacao.module.css"),
    "utf8",
  );
  const inicio = bruto.indexOf("/* ── Uma base por vez");
  if (inicio < 0) return "";
  return bruto.slice(inicio).replaceAll(".lista", `.${styles.lista}`);
}

function cssGlobalViewOnly(): string {
  const g = readFileSync(path.join(RAIZ, "app/globals.css"), "utf8");
  const esconde = "[data-view-only] {\n  display: none;\n}";
  const mostra =
    ':root[data-view="proj"] [data-view-only="proj"],\n:root[data-view="parcial"] [data-view-only="parcial"] {\n  display: revert;\n}';
  // As regras que injetamos SÃO as do arquivo — se mudarem lá, este teste
  // tem de ser revisto, e não seguir medindo uma cópia velha.
  expect(g).toContain(esconde);
  expect(g).toContain(mostra);
  return `${esconde}\n${mostra}`;
}

function montarCss(): void {
  document.head.innerHTML = "";
  const st = document.createElement("style");
  st.textContent = `${cssGlobalViewOnly()}\n${cssDoModulo()}`;
  document.head.appendChild(st);
}

type Base = "parcial" | "proj";

function naBase(base: Base): void {
  document.documentElement.setAttribute("data-view", base);
}

/**
 * Mede numa CÓPIA recém-inserida do bloco: o happy-dom guarda o estilo
 * computado de cada nó e não o invalida quando muda um atributo do `<html>`
 * (medido: sem isto, a segunda base de um mesmo teste lia a primeira).
 */
function fresco<T>(el: Element, medir: (copia: Element) => T): T {
  let topo: Element = el;
  const caminho: number[] = [];
  while (topo.parentElement && topo.parentElement !== document.body) {
    caminho.unshift([...topo.parentElement.children].indexOf(topo));
    topo = topo.parentElement;
  }
  const copia = topo.cloneNode(true) as Element;
  document.body.appendChild(copia);
  let alvo: Element = copia;
  for (const i of caminho) alvo = alvo.children[i] as Element;
  try {
    return medir(alvo);
  } finally {
    copia.remove();
  }
}

function visivelDireto(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (getComputedStyle(e).display === "none") return false;
  }
  return true;
}

function visivel(el: Element | null): boolean {
  return el ? fresco(el, visivelDireto) : false;
}

/** O `data-marca` das pílulas visíveis, na ordem do documento. */
function marcasVisiveis(raiz: Element): string[] {
  return fresco(raiz, (c) =>
    [...c.querySelectorAll("[data-marca]")]
      .filter(visivelDireto)
      .map((m) => m.getAttribute("data-marca") ?? ""),
  );
}

function votoProjetadoVisivel(raiz: Element): number {
  return fresco(
    raiz,
    (c) =>
      [...c.querySelectorAll("li > span:nth-child(3) > small")]
        .filter((s) => (s.textContent ?? "").startsWith("projeção ≈"))
        .filter(visivelDireto).length,
  );
}

function montarHtml(markup: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = markup;
  document.body.innerHTML = "";
  document.body.appendChild(div);
  return div;
}

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

const AMBAS =
  BIT_MARCA.PARCIAL |
  BIT_MARCA.PARCIAL_SOBRA |
  BIT_MARCA.PARCIAL_APERTADA |
  BIT_MARCA.PROJECAO |
  BIT_MARCA.PROJECAO_SOBRA |
  BIT_MARCA.PROJECAO_APERTADA;

/** Rank 1: parcial + projeção; 2: só parcial; 3: só projeção; 4..10: nenhuma. */
function linhas(comProjecao: boolean, tf = false): LinhaCompacta[] {
  return Array.from({ length: 10 }, (_, k): LinhaCompacta => {
    const rank = k + 1;
    let marcas = 0;
    if (tf) marcas = rank <= 2 ? BIT_MARCA.TSE | BIT_MARCA.TSE_QP : 0;
    else if (rank === 1) marcas = comProjecao ? AMBAS : BIT_MARCA.PARCIAL;
    else if (rank === 2) marcas = BIT_MARCA.PARCIAL;
    else if (rank === 3 && comProjecao) marcas = BIT_MARCA.PROJECAO;
    const base = [
      rank,
      100 + rank,
      `NOME ${rank}`,
      "",
      12345,
      9000 - rank,
      1.5,
      marcas,
      0,
    ] as const;
    return comProjecao && !tf && rank <= 4 ? [...base, 20_000] : base;
  });
}

function props(
  comProjecao: boolean,
  over: Partial<DeputadoListaAgremiacaoProps> = {},
): DeputadoListaAgremiacaoProps {
  const tf = over.totalizacaoFinal === true;
  return {
    uf: "SP",
    cod: "22",
    sigla: "PL",
    linhas: linhas(comProjecao, tf),
    totalCandidatos: 12,
    haListaRestante: true,
    rotaLista: "/uf/SP/deputado-federal/lista",
    corte: tf ? null : { ultimoEleito: 102, primeiroFora: 103, diferenca: 77, abaixoPiso10: false },
    totalizacaoFinal: false,
    projecaoVisivel: comProjecao,
    mostrarPartido: false,
    tsDetalhe: "2026-10-04T22:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  montarCss();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-view");
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// A regra, pura
// ---------------------------------------------------------------------------

describe("a regra pura (lib/utils/deputado-marcas)", () => {
  const vis: ContextoMarcas = { totalizacaoFinal: false, projecaoVisivel: true };
  const sem: ContextoMarcas = { totalizacaoFinal: false, projecaoVisivel: false };
  const tf: ContextoMarcas = { totalizacaoFinal: true, projecaoVisivel: false };

  it("só o Deputado Federal tem projeção", () => {
    expect(cargoTemProjecao(6)).toBe(true);
    expect(cargoTemProjecao(7)).toBe(false);
    expect(cargoTemProjecao(8)).toBe(false);
  });

  it("separa as bases só com projeção visível e sem totalização final", () => {
    expect(separaBases(vis)).toBe(true);
    expect(separaBases(sem)).toBe(false);
    expect(separaBases(tf)).toBe(false);
    expect(separaBases({ totalizacaoFinal: true, projecaoVisivel: true })).toBe(false);
  });

  it("o aviso: cargo sem projeção, projeção travada, ou nenhum", () => {
    expect(avisoSemProjecao(false, sem)).toBe(
      "Este cargo não tem projeção — as marcas são da parcial.",
    );
    expect(avisoSemProjecao(true, sem)).toBe(
      "Projeção ainda não liberada — as marcas são da parcial.",
    );
    expect(avisoSemProjecao(true, vis)).toBeNull();
    expect(avisoSemProjecao(true, tf)).toBeNull();
    expect(avisoSemProjecao(false, tf)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A lista por agremiação
// ---------------------------------------------------------------------------

describe("lista por agremiação — Federal com projeção visível", () => {
  it("Parcial: só as marcas da parcial e a linha de corte; nada da projeção", () => {
    const raiz = montarHtml(renderToStaticMarkup(<DeputadoListaAgremiacao {...props(true)} />));
    naBase("parcial");
    expect(marcasVisiveis(raiz)).toEqual(["parcial", "parcial"]);
    expect(visivel(raiz.querySelector("[data-testid='dep-corte']"))).toBe(true);
    expect(votoProjetadoVisivel(raiz)).toBe(0);
    // A pílula da parcial mantém o "sobra apertada".
    const p = [...raiz.querySelectorAll("[data-marca='parcial']")].find(visivel);
    expect(p?.textContent).toContain("sobra apertada");
  });

  it("Projeção: só as marcas da projeção e o voto projetado; nada da parcial", () => {
    const raiz = montarHtml(renderToStaticMarkup(<DeputadoListaAgremiacao {...props(true)} />));
    naBase("proj");
    expect(marcasVisiveis(raiz)).toEqual(["projecao", "projecao"]);
    expect(visivel(raiz.querySelector("[data-testid='dep-corte']"))).toBe(false);
    expect(votoProjetadoVisivel(raiz)).toBe(4);
    const p = [...raiz.querySelectorAll("[data-marca='projecao']")].find(visivel);
    expect(p?.textContent).toContain("eleito na projeção · não oficial");
    expect(p?.textContent).toContain("apertada");
  });

  it("a ordem é a do rank nas duas bases (o DOM não muda com o seletor)", () => {
    const raiz = montarHtml(renderToStaticMarkup(<DeputadoListaAgremiacao {...props(true)} />));
    const ordem = () =>
      [...raiz.querySelectorAll("li[data-rank]")].map((l) => l.getAttribute("data-rank"));
    naBase("parcial");
    const a = ordem();
    naBase("proj");
    expect(ordem()).toEqual(a);
    expect(a).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  });
});

describe("lista por agremiação — sem projeção visível (Federal travado, Estadual, Distrital)", () => {
  for (const [rotulo, over] of [
    ["Federal travado", {}],
    ["Estadual/Distrital (duas faixas)", { duasFaixas: true, comArtigo: true }],
  ] as const) {
    it(`${rotulo}: as marcas da parcial e a linha de corte nas DUAS bases`, () => {
      const raiz = montarHtml(
        renderToStaticMarkup(<DeputadoListaAgremiacao {...props(false, over)} />),
      );
      expect(raiz.querySelector("ol")?.hasAttribute("data-proj")).toBe(false);
      for (const base of ["parcial", "proj"] as const) {
        naBase(base);
        expect(marcasVisiveis(raiz), base).toEqual(["parcial", "parcial"]);
        expect(visivel(raiz.querySelector("[data-testid='dep-corte']")), base).toBe(true);
        expect(votoProjetadoVisivel(raiz), base).toBe(0);
      }
    });
  }
});

describe("lista por agremiação — totalização final", () => {
  it("'Eleito (TSE)' nas duas bases", () => {
    const raiz = montarHtml(
      renderToStaticMarkup(
        <DeputadoListaAgremiacao {...props(true, { totalizacaoFinal: true })} />,
      ),
    );
    expect(raiz.querySelector("ol")?.hasAttribute("data-proj")).toBe(false);
    for (const base of ["parcial", "proj"] as const) {
      naBase(base);
      expect(marcasVisiveis(raiz), base).toEqual(["tse", "tse"]);
    }
  });

  it("'Eleito (TSE)' nunca some, mesmo numa lista que separa as bases", () => {
    // Defesa do seletor: a regra de CSS nunca mira `data-marca="tse"`.
    const p = props(true);
    const l = [...p.linhas];
    l[4] = [5, 105, "NOME 5", "", 1, 1, 1, BIT_MARCA.TSE, 0];
    const raiz = montarHtml(renderToStaticMarkup(<DeputadoListaAgremiacao {...p} linhas={l} />));
    for (const base of ["parcial", "proj"] as const) {
      naBase(base);
      expect(marcasVisiveis(raiz), base).toContain("tse");
    }
  });
});

describe("lista por agremiação — linhas que chegam pela rota da lista (61+)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    _limparCacheListas();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  function linhaRota(rank: number, extra: Partial<DeputadoUfLinha>): DeputadoUfLinha {
    return {
      sqcand: 900 + rank,
      nome: `ROTA ${rank}`,
      partido: "PL",
      numero: 22000 + rank,
      votos: 10,
      rank,
      pct_validos: 0.01,
      ...extra,
    } as DeputadoUfLinha;
  }

  it("as linhas novas seguem a mesma base (mesma paraLinhaCompacta, mesmo CSS)", async () => {
    const lista: DeputadoUfLista = {
      ts: "2026-10-04T22:00:00.000Z",
      uf: "SP",
      agremiacoes: [
        {
          cod: "22",
          candidatos: [
            linhaRota(11, { parcial: "sobra", projecao: "sobra" }),
            linhaRota(12, { projecao: "qp" }),
          ],
        },
      ],
    } as unknown as DeputadoUfLista;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(lista), { status: 200 })),
    );
    await act(async () => root.render(<DeputadoListaAgremiacao {...props(true)} />));
    await act(async () =>
      container.querySelector<HTMLButtonElement>("[data-testid='dep-mostrar-todos']")?.click(),
    );
    const novas = [...container.querySelectorAll("li[data-rank='11'], li[data-rank='12']")];
    expect(novas).toHaveLength(2);
    naBase("parcial");
    expect(novas.flatMap((n) => marcasVisiveis(n))).toEqual(["parcial"]);
    naBase("proj");
    expect(novas.flatMap((n) => marcasVisiveis(n))).toEqual(["projecao", "projecao"]);
  });
});

// ---------------------------------------------------------------------------
// A legenda
// ---------------------------------------------------------------------------

describe("legenda das marcas", () => {
  const legenda = (projecaoVisivel: boolean, aviso: string | null, tf = false) =>
    montarHtml(
      renderToStaticMarkup(
        <LegendaMarcas
          uf="SP"
          projecaoVisivel={projecaoVisivel}
          totalizacaoFinal={tf}
          aviso={aviso}
        />,
      ),
    );
  const itens = (raiz: HTMLElement) =>
    [...raiz.querySelectorAll("li")].filter(visivel).map((li) => li.textContent ?? "");

  it("com projeção: cada base explica só as suas marcas", () => {
    const raiz = legenda(true, null);
    naBase("parcial");
    const p = itens(raiz);
    expect(p.some((t) => t.includes("eleito na parcial"))).toBe(true);
    expect(p.some((t) => t.includes("eleito na projeção"))).toBe(false);
    expect(p.some((t) => t.includes("projeção ≈"))).toBe(false);
    naBase("proj");
    const j = itens(raiz);
    expect(j.some((t) => t.includes("eleito na parcial"))).toBe(false);
    expect(j.some((t) => t.includes("eleito na projeção"))).toBe(true);
    expect(j.some((t) => t.includes("projeção ≈"))).toBe(true);
    expect(raiz.querySelector("[data-testid='dep-aviso-sem-projecao']")).toBeNull();
  });

  for (const aviso of [AVISO_SEM_PROJECAO.cargo, AVISO_SEM_PROJECAO.travada]) {
    it(`sem projeção: a parcial nas duas bases e o aviso só na Projeção — "${aviso}"`, () => {
      const raiz = legenda(false, aviso);
      const el = raiz.querySelector("[data-testid='dep-aviso-sem-projecao']");
      expect(el?.textContent).toBe(aviso);
      naBase("parcial");
      expect(visivel(el)).toBe(false);
      expect(itens(raiz).some((t) => t.includes("eleito na parcial"))).toBe(true);
      naBase("proj");
      expect(visivel(el)).toBe(true);
      expect(itens(raiz).some((t) => t.includes("eleito na parcial"))).toBe(true);
    });
  }

  it("totalização final: 'Eleito (TSE)' nas duas bases, sem aviso", () => {
    const raiz = legenda(false, null, true);
    for (const base of ["parcial", "proj"] as const) {
      naBase(base);
      expect(
        itens(raiz).some((t) => t.includes("Eleito (TSE)")),
        base,
      ).toBe(true);
    }
    expect(raiz.querySelector("[data-testid='dep-aviso-sem-projecao']")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Os mais votados da UF
// ---------------------------------------------------------------------------

describe("mais votados da UF", () => {
  function destaques(ctx: ContextoMarcas): LinhaMaisVotados[] {
    return [
      { parcial: "qp" as const, projecao: "qp" as const },
      { parcial: "sobra" as const },
      { projecao: "sobra" as const },
    ].map((m, i) => ({
      sqcand: 500 + i,
      nome: `DESTAQUE ${i}`,
      partido: "PL",
      sigla: "PL",
      uf: "SP",
      votos: 1000 - i,
      pct_validos: 2,
      ...(ctx.projecaoVisivel ? { votos_projetados: 3000 } : {}),
      marcas: bitsDasMarcas(marcasDaLinha(m, ctx)),
    })) as unknown as LinhaMaisVotados[];
  }

  it("com projeção: uma base por vez, incluindo o voto projetado", () => {
    const ctx = { totalizacaoFinal: false, projecaoVisivel: true };
    const raiz = montarHtml(
      renderToStaticMarkup(
        <DeputadoMaisVotados
          cargo={6}
          escopo="uf"
          uf="SP"
          linhas={destaques(ctx)}
          titleId="t"
          separaBases={separaBases(ctx)}
          aviso={avisoSemProjecao(true, ctx)}
        />,
      ),
    );
    naBase("parcial");
    expect(marcasVisiveis(raiz)).toEqual(["parcial", "parcial"]);
    expect(votoProjetadoVisivel(raiz)).toBe(0);
    naBase("proj");
    expect(marcasVisiveis(raiz)).toEqual(["projecao", "projecao"]);
    expect(votoProjetadoVisivel(raiz)).toBe(3);
    expect(raiz.querySelector("[data-testid='dep-mais-votados-aviso-sem-projecao']")).toBeNull();
  });

  it("Estadual: a parcial nas duas bases, aviso só na Projeção", () => {
    const ctx = { totalizacaoFinal: false, projecaoVisivel: false };
    const raiz = montarHtml(
      renderToStaticMarkup(
        <DeputadoMaisVotados
          cargo={7}
          escopo="uf"
          uf="SP"
          linhas={destaques(ctx)}
          titleId="t"
          separaBases={separaBases(ctx)}
          aviso={avisoSemProjecao(cargoTemProjecao(7), ctx)}
        />,
      ),
    );
    const aviso = raiz.querySelector("[data-testid='dep-mais-votados-aviso-sem-projecao']");
    expect(aviso?.textContent).toBe(AVISO_SEM_PROJECAO.cargo);
    naBase("parcial");
    expect(marcasVisiveis(raiz)).toEqual(["parcial", "parcial"]);
    expect(visivel(aviso)).toBe(false);
    naBase("proj");
    expect(marcasVisiveis(raiz)).toEqual(["parcial", "parcial"]);
    expect(visivel(aviso)).toBe(true);
  });
});
