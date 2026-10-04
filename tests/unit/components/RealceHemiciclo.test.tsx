// @vitest-environment happy-dom
/**
 * tests/unit/components/RealceHemiciclo.test.tsx — o realce por grupo nos
 * plenários (spec 008, RF-294), nas três ligações reais: Senado por partido
 * (`data-partido`), Câmara por agremiação (`data-cod`, montada NA PÁGINA) e as
 * visões por bloco das duas casas (`data-bloco`).
 *
 * 🔴 O invariante que importa: o conjunto de chaves do `<style>` é o MESMO dos
 * `<g>` das cadeiras e dos `<li>` da legenda. A metade estática do CSS apaga
 * TUDO enquanto qualquer elemento com chave está sob o ponteiro, e só a regra
 * por chave devolve o grupo apontado — então uma chave sem regra (partido novo
 * que a lista de chaves esqueceu, sigla da legenda diferente da das cadeiras)
 * apagaria o plenário inteiro, inclusive o próprio partido.
 *
 * happy-dom não avalia `:has(:hover)`: o efeito visual é verificado em
 * navegador real. Aqui mede-se a fiação.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DeputadoFederalPage from "@/app/(dep)/deputado-federal/page";
import { HemicicloPorBloco } from "@/components/blocks/HemicicloPorBloco";
import { RealceHemiciclo } from "@/components/blocks/RealceHemiciclo";
import { SenadoHemicicloPanel } from "@/components/blocks/SenadoHemiciclo";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import { type BlocoHemiciclo, ORDEM_BLOCOS_HEMICICLO } from "@/lib/etiquetas/catalogo";
import { type CadeiraDoBloco, ordenarPorBloco } from "@/lib/etiquetas/visoes";
import { MANDATO_2031, UFS_DO_SENADO } from "@/lib/senado/mandato-2031";
import { ARCOS_CAMARA, ARCOS_SENADO } from "@/lib/utils/hemiciclo";
import { type AtributoRealce, chavesDoCss } from "@/lib/utils/realce-hemiciclo";
import { ROTULO_SEM_PARTIDO } from "@/lib/utils/senado-2027";
import { cand, payloadSenado, ufRow } from "@/tests/fixtures/senado/payload-senado";
import depSim from "@/tests/fixtures/simulacao/deputado.json" with { type: "json" };

const readDeputadoProjectionMock = vi.fn();

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));

vi.mock("@/lib/edge-config/reader", () => ({
  readInterruptorProjecao: vi.fn(async () => ({
    ligada: false,
    pct_minimo: 25,
    origem: "ausente",
  })),
  readDeputadoProjection: () => readDeputadoProjectionMock(),
  readProjection: vi.fn(async () => null),
  readNationalProjection: vi.fn(async () => null),
  readArchivedProjection: vi.fn(async () => null),
  readUfProjection: vi.fn(async () => null),
}));

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

const ordenado = (xs: Iterable<string>) => [...new Set(xs)].sort();

/** As três listas de chaves de uma raiz: do CSS, dos `<g>` e dos `<li>`. */
function chavesDaRaiz(doc: Document, raiz: string, atributo: AtributoRealce) {
  const el = doc.querySelector(`[data-realce-raiz="${raiz}"]`);
  expect(el, `invólucro "${raiz}" ausente`).not.toBeNull();
  const style = el?.querySelector(":scope > style");
  expect(style, `"${raiz}" sem <style> — o React içou ou não emitiu`).not.toBeNull();
  const css = style?.textContent ?? "";
  const g = [...(el?.querySelectorAll(`svg g[data-estado][${atributo}]`) ?? [])].map(
    (n) => n.getAttribute(atributo) ?? "",
  );
  const li = [...(el?.querySelectorAll(`li[${atributo}]`) ?? [])].map(
    (n) => n.getAttribute(atributo) ?? "",
  );
  return { el, css, doCss: chavesDoCss(css, atributo), g: ordenado(g), li: ordenado(li) };
}

// ---------------------------------------------------------------------------
// Senado por partido
// ---------------------------------------------------------------------------

const SIGLAS = ["PL", "PT", "PSD", "MDB", "PP", "UNIÃO", "REPUBLICANOS", "PSB", "PDT", "PODE"];

/** As 27 UFs com vaga, metade concluída e metade projetada; foto REAL (com "sem partido"). */
function payloadSenadoCheio() {
  const contagem = new Map<string, number>();
  const rows = UFS_DO_SENADO.map((uf, i) => {
    const a = SIGLAS[i % SIGLAS.length] as string;
    const b = SIGLAS[(i + 3) % SIGLAS.length] as string;
    for (const s of [a, b]) contagem.set(s, (contagem.get(s) ?? 0) + 1);
    return ufRow(uf, i % 2 === 0 ? 100 : 55, [cand(i * 10 + 1, a, 40), cand(i * 10 + 2, b, 30)]);
  });
  return payloadSenado(
    rows,
    [...contagem.entries()].map(([partido, vagas]) => ({ partido, vagas })),
  );
}

describe("RF-294 — Senado por partido (`data-partido`)", () => {
  const doc = parse(
    renderToStaticMarkup(
      <SenadoHemicicloPanel payload={payloadSenadoCheio()} mandato={MANDATO_2031} />,
    ),
  );

  it("o invólucro envolve o desenho E a lista textual (a legenda ligada)", () => {
    const { el } = chavesDaRaiz(doc, "senado", "data-partido");
    expect(el?.querySelector('[data-testid="senado-hemiciclo-figura"] svg')).not.toBeNull();
    expect(el?.querySelector("#senado-hemiciclo-lista")).not.toBeNull();
  });

  it("🔴 chaves do CSS == partidos das cadeiras == partidos da lista", () => {
    const { doCss, g, li } = chavesDaRaiz(doc, "senado", "data-partido");
    expect(g.length).toBeGreaterThan(5);
    expect(ordenado(doCss)).toEqual(g);
    expect(li).toEqual(g);
  });

  it("a cadeira de senador hoje sem partido tem a MESMA chave na figura e na lista", () => {
    const { g, li, doCss } = chavesDaRaiz(doc, "senado", "data-partido");
    // A foto real tem um senador sem partido; se deixar de ter, o caso não mede nada.
    expect(g).toContain(ROTULO_SEM_PARTIDO);
    expect(li).toContain(ROTULO_SEM_PARTIDO);
    expect(doCss).toContain(ROTULO_SEM_PARTIDO);
  });

  it("só as cadeiras aguardando ficam sem chave (apagam junto, como no exemplo)", () => {
    const { el } = chavesDaRaiz(doc, "senado", "data-partido");
    const semChave = [...(el?.querySelectorAll("svg g[data-estado]:not([data-partido])") ?? [])];
    for (const g of semChave) expect(g.getAttribute("data-estado")).toBe("aguardando");
  });
});

// ---------------------------------------------------------------------------
// Visão por bloco — as duas casas
// ---------------------------------------------------------------------------

function cadeiras(n: Partial<Record<BlocoHemiciclo, number>>): CadeiraDoBloco[] {
  const out: CadeiraDoBloco[] = [];
  for (const b of ORDEM_BLOCOS_HEMICICLO) {
    for (let i = 0; i < (n[b] ?? 0); i++) out.push({ bloco: b, origem: "projetada" });
  }
  return out;
}

function renderBloco(casa: "senado" | "camara", n: Partial<Record<BlocoHemiciclo, number>>) {
  return parse(
    renderToStaticMarkup(
      <HemicicloPorBloco
        visao={ordenarPorBloco(cadeiras(n))}
        arcos={casa === "senado" ? ARCOS_SENADO : ARCOS_CAMARA}
        casa={casa}
        idPrefixo={`${casa}-2027-blocos`}
        titulo="Teste"
        rotuloAguardando="Aguardando apuração"
      />,
    ),
  );
}

describe("RF-294 — visão por bloco (`data-bloco`)", () => {
  const casos = [
    ["senado", { base_governo: 34, independente: 9, aguardando: 8, oposicao: 30 }],
    ["camara", { base_governo: 200, independente: 80, aguardando: 33, oposicao: 200 }],
  ] as const;

  for (const [casa, n] of casos) {
    it(`${casa}: 🔴 chaves do CSS == blocos das cadeiras == blocos da legenda e do placar`, () => {
      const doc = renderBloco(casa, n);
      const { el, doCss, g, li } = chavesDaRaiz(doc, `${casa}-2027-blocos`, "data-bloco");
      expect(ordenado(doCss)).toEqual(ordenado(ORDEM_BLOCOS_HEMICICLO));
      expect(g).toEqual(ordenado(doCss));
      expect(li).toEqual(ordenado(doCss));
      // A legenda e o placar estão os dois dentro da raiz — os dois reagem.
      expect(el?.querySelectorAll('[data-testid="hemiciclo-bloco-legenda-item"]')).toHaveLength(4);
      expect(el?.querySelectorAll('[data-testid="hemiciclo-bloco-placar"] li')).toHaveLength(4);
      // O próprio contêiner é a raiz: nenhum <div> a mais na árvore.
      expect(el?.getAttribute("data-testid")).toBe("hemiciclo-por-bloco");
    });
  }

  it("bloco sem cadeira: tem regra (a linha dele na legenda não apaga tudo), e nenhum <g>", () => {
    const doc = renderBloco("senado", { base_governo: 40, aguardando: 1, oposicao: 40 });
    const { doCss, g, li } = chavesDaRaiz(doc, "senado-2027-blocos", "data-bloco");
    expect(g).not.toContain("independente");
    expect(li).toContain("independente");
    expect(ordenado(doCss)).toEqual(li);
    for (const k of g) expect(doCss).toContain(k);
  });

  it("as marcas de limiar não têm `data-estado` — ficam fora do esmaecimento", () => {
    const doc = renderBloco("camara", casos[1][1]);
    const marcas = doc.querySelector('[data-testid="hemiciclo-bloco-marcas"]');
    expect(marcas).not.toBeNull();
    expect(marcas?.hasAttribute("data-estado")).toBe(false);
    expect(marcas?.querySelector("[data-estado]")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Câmara por agremiação — a fiação NA PÁGINA
// ---------------------------------------------------------------------------

function payloadCamara(): EdgePayloadDeputado {
  const bancada = (depSim as unknown as { bancada: EdgePayloadDeputado["bancada"] }).bancada;
  return {
    ts: "2026-10-04T22:15:00-03:00",
    cargo: 6,
    turno: 1,
    pct_apurado_total: 62.5,
    ufs_apuradas: 20,
    atualizacao_min: 7,
    bancada,
    por_uf: [],
    insights: [],
    composition: { pre_election: 0, model: 0, actual_results: 1 },
  };
}

describe("RF-294 — Câmara por agremiação (`data-cod`), montada em /deputado-federal", () => {
  it("🔴 chaves do CSS == agremiações das cadeiras == linhas da legenda compacta", async () => {
    readDeputadoProjectionMock.mockResolvedValue(payloadCamara());
    const doc = parse(renderToStaticMarkup(await DeputadoFederalPage()));
    const { el, doCss, g, li } = chavesDaRaiz(doc, "camara", "data-cod");

    expect(el?.querySelector('[data-testid="camara-hemiciclo"] svg')).not.toBeNull();
    expect(
      el?.querySelector('[data-testid="camara-hemiciclo-legenda-agremiacoes"]'),
    ).not.toBeNull();
    expect(g.length).toBe(11);
    expect(ordenado(doCss)).toEqual(g);
    expect(li).toEqual(g);
    // A lista longa (`#bancada-agremiacoes`, alvo do aria-describedby) fica FORA.
    expect(el?.querySelector("#bancada-agremiacoes")).toBeNull();
    expect(doc.querySelector("#bancada-agremiacoes")).not.toBeNull();
  });
});

describe("RF-294 — <RealceHemiciclo> em si", () => {
  it("sem chave, não emite <style>", () => {
    const html = renderToStaticMarkup(
      <RealceHemiciclo raiz="x" atributo="data-cod" chaves={[]}>
        <p>a</p>
      </RealceHemiciclo>,
    );
    expect(html).not.toContain("<style");
    expect(html).toContain('data-realce-raiz="x"');
  });

  it("🔴 o <style> sai NO LUGAR (não içado), sem escape HTML, e nenhum `<` do payload vaza", () => {
    const html = renderToStaticMarkup(
      <RealceHemiciclo raiz="x" atributo="data-cod" chaves={["</style><b>", "a&b"]}>
        <p>a</p>
      </RealceHemiciclo>,
    );
    expect(html.startsWith('<div data-realce-raiz="x"')).toBe(true);
    const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
    expect(css).not.toContain("<");
    expect(css).toContain('[data-cod="a&b"]'); // sem `&amp;` — o conteúdo não é escapado
    expect(html.indexOf("</style>")).toBeLessThan(html.indexOf("<p>"));
  });

  it("repassa os data-* ao contêiner", () => {
    const html = renderToStaticMarkup(
      <RealceHemiciclo raiz="x" atributo="data-bloco" chaves={["a"]} data-testid="t" data-total={3}>
        <p>a</p>
      </RealceHemiciclo>,
    );
    const el = parse(html).querySelector('[data-realce-raiz="x"]');
    expect(el?.getAttribute("data-testid")).toBe("t");
    expect(el?.getAttribute("data-total")).toBe("3");
  });
});
