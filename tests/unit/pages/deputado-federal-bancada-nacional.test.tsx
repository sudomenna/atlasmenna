// @vitest-environment happy-dom
/**
 * tests/unit/pages/deputado-federal-bancada-nacional.test.tsx — spec 026
 * RF-299 e RF-300 (ADR-0063, emenda de 04/10 (2)) na CAPA, renderizada por SSR
 * com os leitores mockados (o molde de `deputado-federal.test.tsx`).
 *
 *   1. a bancada é a última seção de conteúdo: depois de "Estado a estado",
 *      antes da metodologia, sem dividir linha com o `Camara2027Panel`;
 *   2. RF-271 segue: a capa não lê Blob de UF e não chama a rota no servidor;
 *   3. decisão do dono (04/10): só agremiação com cadeira na parcial vai à
 *      lista da capa FEDERAL — a capa das assembleias não muda;
 *   4. a metodologia explica o cenário misto (§ 8) e deixou de afirmar que
 *      "não somamos projeções numa bancada nacional".
 *
 * Mutação aplicada à mão (04/10): desligar o filtro (`naLista = agremiacoes`)
 * derruba o caso 3 da capa federal.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DeputadoEstadualPage from "@/app/(dep)/deputado-estadual/page";
import DeputadoFederalPage from "@/app/(dep)/deputado-federal/page";
import type { EdgeAgremiacaoBancada, EdgePayloadDeputado } from "@/lib/edge-config/types";
import contratoNacional from "@/tests/fixtures/contrato/deputado-nacional-v2.json" with {
  type: "json",
};

import { agremiacao, linhaUf, payloadCasa } from "../deputado/_payload-casa";

const readDeputadoProjectionMock = vi.fn();
const readInterruptorProjecaoMock = vi.fn();
const readDeputadoUfDetailMock = vi.fn();
const fetchSpy = vi.fn();

const DESLIGADO = { ligada: false, pct_minimo: 25, origem: "ausente" } as const;
const LIGADO = { ligada: true, pct_minimo: 25, origem: "chave" } as const;

vi.mock("@/lib/blob/candidatos", () => ({
  readCandidatosUf: () =>
    Promise.resolve({ status: "unavailable", reason: "not_configured", url: null }) as never,
}));

vi.mock("@/lib/edge-config/reader", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/edge-config/reader")>();
  return {
    ...real,
    readDeputadoProjection: (cargo: number) => readDeputadoProjectionMock(cargo),
    readInterruptorProjecao: (cargo: number) => readInterruptorProjecaoMock(cargo),
  };
});

vi.mock("@/lib/blob/deputado-uf", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/blob/deputado-uf")>();
  return {
    ...real,
    readDeputadoUfDetail: (...a: unknown[]) => readDeputadoUfDetailMock(...a),
  };
});

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

/** O payload de contrato com uma agremiação de ZERO cadeiras acrescentada. */
function nacionalComZero(): EdgePayloadDeputado {
  const p = structuredClone(contratoNacional) as unknown as EdgePayloadDeputado;
  const zero: EdgeAgremiacaoBancada = {
    cod: "99",
    sigla: "PZERO",
    nome: "Partido do Zero",
    tipo: "partido",
    componentes: [],
    sigla_lider: "PZERO",
    cadeiras: 0,
    votos_nominais: 1_000,
    votos_legenda: 10,
    votos_validos: 1_010,
    pct_votos: 0.01,
  };
  p.bancada.por_agremiacao = [...p.bancada.por_agremiacao, zero];
  return p;
}

beforeEach(() => {
  for (const m of [
    readDeputadoProjectionMock,
    readInterruptorProjecaoMock,
    readDeputadoUfDetailMock,
    fetchSpy,
  ]) {
    m.mockReset();
  }
  readInterruptorProjecaoMock.mockResolvedValue(DESLIGADO);
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function capaFederal(): Promise<Document> {
  return parse(renderToStaticMarkup(await DeputadoFederalPage()));
}

describe("RF-299 — a bancada é a última seção de conteúdo da capa", () => {
  it("'Estado a estado' → bancada → metodologia, nessa ordem; a bancada não divide linha", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacionalComZero());
    const doc = await capaFederal();
    const posicao = (id: string) => {
      const el = doc.getElementById(id);
      if (!el) throw new Error(`sem #${id}`);
      return [...doc.querySelectorAll("[id]")].indexOf(el);
    };
    expect(posicao("corridas-heading")).toBeLessThan(posicao("bancada-heading"));
    expect(posicao("bancada-heading")).toBeLessThan(posicao("metodologia-heading"));
    // Os mais votados e os puxadores vêm antes também.
    expect(posicao("mais-votados-pais-heading")).toBeLessThan(posicao("bancada-heading"));
    // O painel é filho direto do <main> — fora de qualquer par (ADR-0073).
    const painel = doc.querySelector("[aria-labelledby='bancada-heading']");
    expect(painel?.parentElement?.tagName).toBe("MAIN");
    // O hemiciclo do topo continua apontando para a lista, que existe.
    const descrito = doc.querySelector("[aria-describedby~='bancada-agremiacoes']");
    expect(descrito).not.toBeNull();
    expect(doc.getElementById("bancada-agremiacoes")).not.toBeNull();
  });

  it("🔴 RF-271: a capa NÃO lê Blob de UF nem chama a rota dos eleitos no servidor", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacionalComZero());
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    await capaFederal();
    expect(readDeputadoUfDetailMock).not.toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.filter(([u]) => String(u).includes("/deputado-federal/eleitos")),
    ).toEqual([]);
  });

  it("o HTML leva a reserva do botão em cada linha — e nenhum botão nem número de projeção", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacionalComZero());
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const doc = await capaFederal();
    const linhas = [...doc.querySelectorAll("[data-testid='bancada-linha']")];
    expect(linhas.length).toBeGreaterThan(0);
    for (const li of linhas) expect(li.querySelector("[data-acoes]")?.innerHTML).toBe("");
    expect(doc.querySelector("[data-testid='bancada-ver-eleitos']")).toBeNull();
    expect(doc.querySelector("[data-testid='bancada-cadeiras-cenario']")).toBeNull();
    expect(doc.documentElement.innerHTML).not.toContain("votos_projetados");
  });
});

describe("decisão do dono (04/10) — agremiação com zero cadeiras fora da lista", () => {
  it("🔴 capa FEDERAL: a de zero não tem linha; as outras e a barra seguem iguais", async () => {
    const payload = nacionalComZero();
    readDeputadoProjectionMock.mockResolvedValue(payload);
    const doc = await capaFederal();
    const cods = [...doc.querySelectorAll("[data-testid='bancada-linha']")].map((li) =>
      li.getAttribute("data-cod"),
    );
    expect(cods).not.toContain("99");
    const comCadeira = payload.bancada.por_agremiacao.filter((a) => a.cadeiras > 0);
    expect(cods).toHaveLength(comCadeira.length);
    expect(cods.length).toBeGreaterThan(0);
    // Toda agremiação de zero do payload sumiu — não só a acrescentada.
    for (const a of payload.bancada.por_agremiacao.filter((x) => x.cadeiras === 0)) {
      expect(cods).not.toContain(a.cod);
    }
    // A barra não muda: quem tem zero nunca teve segmento.
    const segmentos = [...doc.querySelectorAll("[data-testid='vote-bar-segment']")].map((s) =>
      s.getAttribute("data-label"),
    );
    expect(segmentos).not.toContain("PZERO");
  });

  it("capa ESTADUAL (sem decisão própria): a de zero continua na lista", async () => {
    readDeputadoProjectionMock.mockImplementation(async (cargo: number) =>
      cargo === 7
        ? payloadCasa(7, {
            agremiacoes: [agremiacao("22", "PL", 60), agremiacao("99", "PZERO", 0)],
            porUf: [linhaUf("SP", { lugares_a_preencher: 94, cadeiras_definidas: 60 })],
          })
        : null,
    );
    const doc = parse(renderToStaticMarkup(await DeputadoEstadualPage()));
    const cods = [...doc.querySelectorAll("[data-testid='bancada-linha']")].map((li) =>
      li.getAttribute("data-cod"),
    );
    expect(cods).toContain("99");
    // E sem ilha: nem reserva de botão, nem rota.
    expect(doc.querySelector("[data-acoes]")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("constituição § 8 — a metodologia da capa explica o cenário misto", () => {
  it("diz que soma projeção nas liberadas e parcial nas demais, pontual, sem substituir a parcial", async () => {
    readDeputadoProjectionMock.mockResolvedValue(nacionalComZero());
    readInterruptorProjecaoMock.mockResolvedValue(LIGADO);
    const doc = await capaFederal();
    const texto = (
      doc.querySelector("[data-testid='dep-metodologia-projecao']")?.textContent ?? ""
    ).replace(/\s+/g, " ");
    expect(texto).toContain("cenário nacional misto");
    expect(texto).toContain(
      "a projeção nos estados em que ela está liberada e a parcial nos demais",
    );
    expect(texto).toContain("pontual, sem faixa");
    expect(texto).toContain("não substitui a parcial");
    expect(texto).not.toContain("não somamos projeções numa bancada nacional");
  });
});
