// @vitest-environment happy-dom
/**
 * tests/unit/pages/deputado-uf-marcas-por-base.test.tsx — decisão do dono de
 * 04/10: na página de UF de deputado, as marcas e números mostram UMA base por
 * vez, conforme o seletor Parcial/Projeção; Estadual e Distrital não têm
 * projeção (fica desativada); sem projeção, a base "Projeção" mostra as marcas
 * da parcial com um aviso.
 *
 * Aqui se mede a FIAÇÃO da página (`app/(dep)/_pagina-uf-deputado.tsx`): que
 * atributos ela põe e que aviso ela passa, por cargo × estado da projeção. O
 * efeito visual dos atributos (o CSS) é medido em
 * `tests/unit/components/DeputadoMarcasPorBase.test.tsx`.
 *
 * Mutações aplicadas à mão (04/10), derrubadas por estes casos:
 *   - `cargoTemProjecao(cargo) &&` removido de `visivel` (o estadual volta a
 *     mostrar a projeção);
 *   - `data-view-only` removido da faixa da parcial / do corte no cabeçalho.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderPaginaUfDeputado } from "@/app/(dep)/_pagina-uf-deputado";
import type { DeputadoUfDetail, DeputadoUfDetailResult } from "@/lib/blob/deputado-uf";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import { AVISO_SEM_PROJECAO } from "@/lib/utils/deputado-marcas";
import contratoNacional from "@/tests/fixtures/contrato/deputado-nacional-v2.json" with {
  type: "json",
};
import contratoUf from "@/tests/fixtures/contrato/deputado-uf-v2.json" with { type: "json" };

const lerDadosDaCasaMock = vi.fn();

vi.mock("@/app/(dep)/_dados-da-casa", () => ({
  lerDadosDaCasa: (cargo: number, sigla: string) => lerDadosDaCasaMock(cargo, sigla),
  lerCandidaturasAguardando: vi.fn(async () => null),
  lerFotosDaCasa: vi.fn(async () => new Set<string>()),
  lerListaDaCasa: vi.fn(),
}));

const LIGADO = { ligada: true, pct_minimo: 25, origem: "chave" } as const;
const DESLIGADO = { ligada: false, pct_minimo: 25, origem: "ausente" } as const;

/**
 * O SP do contrato com a projeção LIBERADA: 60% apurado, estado `liberada`,
 * as três primeiras linhas de cada agremiação eleitas na projeção e cadeiras
 * projetadas no cabeçalho. `liberada = false` mantém o estado do contrato
 * (`aguardando`, trava dos 25%).
 */
function detalheSp(liberada: boolean): DeputadoUfDetailResult {
  const d = structuredClone(
    (contratoUf as unknown as Record<string, DeputadoUfDetail>).SP,
  ) as DeputadoUfDetail & Record<string, unknown>;
  if (liberada) {
    d.pct_apurado = 60;
    d.projecao = { ...(d.projecao as object), estado: "liberada" } as DeputadoUfDetail["projecao"];
    for (const a of d.agremiacoes) {
      (a as unknown as Record<string, unknown>).cadeiras_projetadas = a.cadeiras + 1;
      for (const c of (a.candidatos ?? []).slice(0, 3)) {
        if (c.destino === undefined) (c as unknown as Record<string, unknown>).projecao = "qp";
      }
    }
  }
  return { status: "ok", detail: d, url: "https://blob.test/sp.json" };
}

async function render(
  cargo: 6 | 7,
  liberada: boolean,
  interruptor: typeof LIGADO | typeof DESLIGADO = LIGADO,
): Promise<Document> {
  lerDadosDaCasaMock.mockResolvedValue({
    nacional: structuredClone(contratoNacional) as unknown as EdgePayloadDeputado,
    detalhe: detalheSp(liberada),
    interruptor,
  });
  const html = renderToStaticMarkup(await renderPaginaUfDeputado(cargo, "SP"));
  return new DOMParser().parseFromString(html, "text/html");
}

beforeEach(() => {
  lerDadosDaCasaMock.mockReset();
});

describe("página de UF — uma base por vez (04/10)", () => {
  it("Federal com projeção liberada: listas separam as bases, cabeçalho marcado por base, sem aviso", async () => {
    const doc = await render(6, true);
    const listas = [...doc.querySelectorAll("[data-testid='dep-lista-agremiacao'] ol")];
    expect(listas.length).toBeGreaterThan(0);
    for (const ol of listas) expect(ol.hasAttribute("data-proj")).toBe(true);
    expect(
      doc.querySelector("[data-testid='dep-mais-votados-uf']")?.hasAttribute("data-proj"),
    ).toBe(true);
    // As marcas da projeção EXISTEM no documento (o CSS escolhe a base).
    expect(doc.querySelectorAll("[data-marca='projecao']").length).toBeGreaterThan(0);
    expect(doc.querySelectorAll("[data-marca='parcial']").length).toBeGreaterThan(0);

    const projetadas = [...doc.querySelectorAll("[data-testid='uf-cadeiras-projetadas']")];
    expect(projetadas.length).toBeGreaterThan(0);
    for (const p of projetadas) expect(p.getAttribute("data-view-only")).toBe("proj");
    const cortes = [...doc.querySelectorAll("[data-testid='uf-corte-cabecalho']")];
    expect(cortes.length).toBeGreaterThan(0);
    for (const c of cortes) expect(c.getAttribute("data-view-only")).toBe("parcial");
    const faixas = [...doc.querySelectorAll("[data-testid='uf-intervalo']")];
    expect(faixas.length).toBeGreaterThan(0);
    for (const f of faixas) expect(f.parentElement?.getAttribute("data-view-only")).toBe("parcial");

    expect(doc.querySelector("[data-testid='dep-aviso-sem-projecao']")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-mais-votados-aviso-sem-projecao']")).toBeNull();
  });

  it("Federal com a trava fechada (aguardando 25%): parcial nas duas bases + aviso 'ainda não liberada'", async () => {
    const doc = await render(6, false);
    for (const ol of doc.querySelectorAll("[data-testid='dep-lista-agremiacao'] ol")) {
      expect(ol.hasAttribute("data-proj")).toBe(false);
    }
    expect(doc.querySelectorAll("[data-marca='projecao']")).toHaveLength(0);
    for (const c of doc.querySelectorAll("[data-testid='uf-corte-cabecalho']")) {
      expect(c.hasAttribute("data-view-only")).toBe(false);
    }
    const aviso = doc.querySelector("[data-testid='dep-aviso-sem-projecao']");
    expect(aviso?.textContent).toBe(AVISO_SEM_PROJECAO.travada);
    expect(aviso?.getAttribute("data-view-only")).toBe("proj");
  });

  it("Federal com o interruptor DESLIGADO e o estado liberado: mesmo comportamento da trava", async () => {
    const doc = await render(6, true, DESLIGADO);
    expect(doc.querySelectorAll("[data-marca='projecao']")).toHaveLength(0);
    expect(doc.querySelector("[data-testid='uf-cadeiras-projetadas']")).toBeNull();
    expect(doc.querySelector("[data-testid='dep-aviso-sem-projecao']")?.textContent).toBe(
      AVISO_SEM_PROJECAO.travada,
    );
  });

  it("🔴 Estadual com projeção liberada E interruptor ligado: projeção desativada, aviso 'este cargo não tem projeção'", async () => {
    const doc = await render(7, true);
    for (const ol of doc.querySelectorAll("[data-testid='dep-lista-agremiacao'] ol")) {
      expect(ol.hasAttribute("data-proj")).toBe(false);
    }
    expect(doc.querySelectorAll("[data-marca='projecao']")).toHaveLength(0);
    expect(doc.querySelectorAll("[data-marca='parcial']").length).toBeGreaterThan(0);
    expect(doc.querySelector("[data-testid='uf-cadeiras-projetadas']")).toBeNull();
    expect(doc.body.textContent).not.toContain("Projeção liberada · não oficial");
    const aviso = doc.querySelector("[data-testid='dep-aviso-sem-projecao']");
    expect(aviso?.textContent).toBe(AVISO_SEM_PROJECAO.cargo);
    expect(aviso?.getAttribute("data-view-only")).toBe("proj");
    const avisoMv = doc.querySelector("[data-testid='dep-mais-votados-aviso-sem-projecao']");
    expect(avisoMv?.textContent).toBe(AVISO_SEM_PROJECAO.cargo);
  });
});
