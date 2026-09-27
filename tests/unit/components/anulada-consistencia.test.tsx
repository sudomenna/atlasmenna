// @vitest-environment happy-dom
/**
 * tests/unit/components/anulada-consistencia.test.tsx
 *
 * ADR-0053 / RF-213 — **o teste de consistência** pedido pelo dono em
 * 2026-09-27: numa UF em que a candidatura ANULADA tem o MAIOR `pct_atual` e
 * o maior `pct`, toda superfície que a tela deriva por conta própria tem de
 * apontar para a MESMA candidatura válida que o modelo já publicou em
 * `por_uf[].lider`:
 *
 *   - a ficha do estado ("Líder:") e a ordem da lista dela;
 *   - a cor do mapa nacional (coroplético) nas DUAS bases;
 *   - a cor e o nome acessível do cartograma hexagonal;
 *   - a margem da 2ª vaga do Senado;
 *   - o desfecho de Governador (contagem) e o partido que ele credita;
 *   - o topo da lista do `<ResultPanel>` e do balão do mapa.
 *
 * E as duas contraprovas:
 *   - **sub judice no topo continua sendo o líder** (segue o TSE);
 *   - **sem `destino`**, a derivação é a de antes: o mais votado lidera, mesmo
 *     sendo o registro que, com `destino`, estaria anulado.
 *
 * Fixture (UF SP). Projeção e apuração na MESMA ordem de propósito — o que
 * este arquivo discrimina é a anulada, não a base (a base tem arquivo próprio,
 * `NationalChoroplethMap.corPorBase.test.tsx`).
 *
 *   id  nome     partido  destino     pct (proj)  pct_atual
 *   10  ANULA    NOVO     anulado          40         42
 *   11  VALIDA   PT       valido           35         33
 *   12  JUDICE   PL       sub_judice       15         16
 *   13  QUARTA   PSB      (ausente)         5          5
 *
 * `row.lider = 11` e `margem_projetada = 20` (35 − 15): é o que o produtor
 * grava depois do ADR-0053 (`api/model/project.py`, bloco por UF).
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeCandidate, EdgeDestinoVoto, EdgeUfRow } from "@/lib/edge-config/types";

type Handler = (e: unknown) => void;

const espiao = vi.hoisted(() => ({
  chamadas: [] as Array<[string, string, unknown]>,
  handlers: new Map<string, (e: unknown) => void>(),
}));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    cameraForBounds() {
      return { center: [-51.415, -14.24] as [number, number], zoom: 3 };
    }
    jumpTo() {}
    setPaintProperty(layer: string, prop: string, valor: unknown) {
      espiao.chamadas.push([layer, prop, valor]);
    }
    setFilter() {}
    getCanvas() {
      return { style: {} };
    }
    isStyleLoaded() {
      return true;
    }
    loaded() {
      return true;
    }
    remove() {}
    on(event: string, a: unknown, b?: unknown) {
      if (typeof a === "function") espiao.handlers.set(event, a as Handler);
      else espiao.handlers.set(`${event}:${String(a)}`, b as Handler);
    }
  }
  return { default: { Map: FakeMap } };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));
vi.mock("@/components/atoms/maps/_pmtiles-protocol", () => ({
  registerPmtilesProtocolOnce: () => {},
  resetPmtilesProtocol: () => {},
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

import { NationalChoroplethMapImpl } from "@/components/blocks/_NationalChoroplethMapImpl";
import { HexCartogramBrasil } from "@/components/blocks/HexCartogramBrasil";
import { ResultPanel, type ResultPanelCandidate } from "@/components/blocks/ResultPanel";
import { StateResultSheet } from "@/components/blocks/StateResultSheet";
import { agregarPorPartido, classificarContagem } from "@/lib/utils/desfecho-governador";
import { liderIdPorBase, margemPorBase } from "@/lib/utils/lider-por-base";
import { margemSegundaVaga } from "@/lib/utils/margem-senado";
import { partyChipInk } from "@/lib/utils/party-color";

const TOKENS: Record<string, string> = {
  "--party-pt": "#c62e49",
  "--party-pl": "#2f8f6b",
  "--party-novo": "#e07b1d",
  "--party-psb": "#d4a017",
  "--map-uncounted": "#e1e4e8",
};

interface Linha {
  id: number;
  nome: string;
  partido: string;
  destino?: EdgeDestinoVoto;
  pct: number;
  atual: number;
}

const BASE: readonly Linha[] = [
  { id: 10, nome: "ANULA", partido: "NOVO", destino: "anulado", pct: 40, atual: 42 },
  { id: 11, nome: "VALIDA", partido: "PT", destino: "valido", pct: 35, atual: 33 },
  { id: 12, nome: "JUDICE", partido: "PL", destino: "sub_judice", pct: 15, atual: 16 },
  { id: 13, nome: "QUARTA", partido: "PSB", pct: 5, atual: 5 },
];

/** A mesma UF sem nenhum `destino` — o payload antes da 1ª totalização. */
const SEM_DESTINO: readonly Linha[] = BASE.map(({ destino: _d, ...l }) => l);

/** Sub judice no TOPO: 12 passa a ser a mais votada, a anulada fica em 2º. */
const JUDICE_NO_TOPO: readonly Linha[] = [
  { id: 12, nome: "JUDICE", partido: "PL", destino: "sub_judice", pct: 45, atual: 46 },
  { id: 10, nome: "ANULA", partido: "NOVO", destino: "anulado", pct: 30, atual: 31 },
  { id: 11, nome: "VALIDA", partido: "PT", destino: "valido", pct: 20, atual: 18 },
  { id: 13, nome: "QUARTA", partido: "PSB", pct: 5, atual: 5 },
];

function mkRow(linhas: readonly Linha[], lider: number, margem: number): EdgeUfRow {
  return {
    sigla: "SP",
    pct_apurado: 40,
    lider,
    margem_atual: margem,
    margem_projetada: margem,
    margem_projetada_ci: [margem - 2, margem + 2],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: linhas.map((l) => ({
      id: l.id,
      pct: l.pct,
      pct_atual: l.atual,
      votos_atuais: l.atual * 1000,
      nome: l.nome,
      partido: l.partido,
      ...(l.destino ? { destino: l.destino } : {}),
    })),
    vai_a_2t: false,
    bucket: "vai_2t",
  };
}

function mkNacionais(linhas: readonly Linha[]): EdgeCandidate[] {
  return linhas.map(
    (l, i) =>
      ({
        id: l.id,
        nome: l.nome,
        partido: l.partido,
        votos_atuais: l.atual * 1000,
        votos_projetados: l.pct * 1000,
        pct_atual: l.atual,
        pct_projetado: l.pct,
        pct_projetado_lower: l.pct - 1,
        pct_projetado_upper: l.pct + 1,
        p_vitoria: 0,
        rank: i + 1,
        p_passa_2t: 0,
        p_fecha_1t: 0,
        ...(l.destino ? { destino: l.destino } : {}),
      }) as EdgeCandidate,
  );
}

function mkPainel(linhas: readonly Linha[]): ResultPanelCandidate[] {
  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    partido: l.partido,
    votos_atuais: l.atual * 1000,
    pct_atual: l.atual,
    pct_projetado: l.pct,
    ...(l.destino ? { destino: l.destino } : {}),
  }));
}

/**
 * Emenda "opção A" ao ADR-0053 (dono, 2026-09-27): com anulada na UF, o
 * produtor publica o percentual de quem COMPETE sobre os votos em disputa
 * (`vvc − anuladas`); o da anulada segue sobre `vvc`. Esta função leva uma
 * fixture "tudo sobre `vvc`" ao formato que o produtor passa a gravar — é o
 * que os testes de régua (desfecho pela contagem) precisam, porque a régua
 * voltou a ser `> 50` sobre esse número.
 */
function opcaoA(linhas: readonly Linha[]): Linha[] {
  const disputa = linhas.filter((l) => l.destino !== "anulado");
  const sPct = disputa.reduce((s, l) => s + l.pct, 0);
  const sAtual = disputa.reduce((s, l) => s + l.atual, 0);
  return linhas.map((l) =>
    l.destino === "anulado"
      ? l
      : { ...l, pct: (l.pct / sPct) * 100, atual: (l.atual / sAtual) * 100 },
  );
}

const ROW = mkRow(BASE, 11, 20);
const ROW_SEM = mkRow(SEM_DESTINO, 10, 5);
const ROW_JUDICE = mkRow(JUDICE_NO_TOPO, 12, 25);

// ---------------------------------------------------------------------------
// Harness do mapa nacional (mesmo de `NationalChoroplethMap.corPorBase`)
// ---------------------------------------------------------------------------

let root: Root | null = null;
let host: HTMLDivElement | null = null;

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  espiao.chamadas = [];
  espiao.handlers.clear();
  for (const [nome, valor] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(nome, valor);
  }
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  for (const nome of Object.keys(TOKENS)) {
    document.documentElement.style.removeProperty(nome);
  }
  document.body.innerHTML = "";
});

function montarMapa(row: EdgeUfRow, linhas: readonly Linha[], viewMode: "proj" | "parcial") {
  espiao.chamadas = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <NationalChoroplethMapImpl
        candidatoAId={row.lider}
        candidatos={mkNacionais(linhas)}
        rows={[row]}
        view="winner"
        cargo="gov"
        viewMode={viewMode}
      />,
    );
  });
}

function corDoMapa(row: EdgeUfRow, linhas: readonly Linha[], viewMode: "proj" | "parcial") {
  montarMapa(row, linhas, viewMode);
  const fill = espiao.chamadas.filter(([l, p]) => l === "ufs-fill" && p === "fill-color").at(-1);
  const expr = fill?.[2] as unknown[];
  const cor = String(expr[expr.indexOf("SP") + 1]);
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  return cor;
}

function balao(row: EdgeUfRow, linhas: readonly Linha[]) {
  montarMapa(row, linhas, "proj");
  act(() => {
    espiao.handlers.get("mousemove:ufs-fill")?.({
      features: [{ properties: { SIGLA_UF: "SP" } }],
      originalEvent: { clientX: 10, clientY: 10 },
    });
  });
  const card = host?.querySelector('[data-testid="hover-card"]');
  if (!card) throw new Error("balão não abriu");
  return {
    nomes: Array.from(card.querySelectorAll(".overflow-hidden.text-ellipsis")).map(
      (e) => e.textContent,
    ),
    etiquetas: Array.from(card.querySelectorAll('[data-testid="destino-etiqueta"]')).map((e) =>
      e.getAttribute("data-destino"),
    ),
  };
}

function hex(row: EdgeUfRow, linhas: readonly Linha[]) {
  const doc = new DOMParser().parseFromString(
    renderToStaticMarkup(<HexCartogramBrasil rows={[row]} candidatos={mkNacionais(linhas)} />),
    "text/html",
  );
  const a = doc.querySelector('svg a[aria-label^="SP"]');
  return {
    rotulo: a?.getAttribute("aria-label") ?? "",
    fill: a?.querySelector("polygon")?.getAttribute("fill"),
  };
}

function ficha(row: EdgeUfRow, linhas: readonly Linha[], cargo: "gov" | "sen" = "gov") {
  const doc = new DOMParser().parseFromString(
    renderToStaticMarkup(
      <StateResultSheet
        open
        onClose={() => {}}
        row={row}
        candidatos={mkNacionais(linhas)}
        cargo={cargo}
        viewMode="parcial"
      />,
    ),
    "text/html",
  );
  return {
    lider: doc.querySelector('[data-testid="state-sheet-lider"]')?.textContent ?? "",
    nomes: Array.from(doc.querySelectorAll('[data-testid="state-sheet-cand-nome"]')).map(
      (e) => e.textContent,
    ),
    doc,
  };
}

function painel(linhas: readonly Linha[]) {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(<ResultPanel candidatos={mkPainel(linhas)} pctApurado={40} />),
    "text/html",
  );
}

// ---------------------------------------------------------------------------

describe("ADR-0053 — anulada no topo: todas as superfícies apontam para o líder do modelo", () => {
  it("🔴 pré-condição: a anulada É a mais votada nas duas bases (senão o teste não discrimina)", () => {
    const [anula, ...resto] = ROW.top_candidatos;
    expect(anula?.destino).toBe("anulado");
    for (const tc of resto) {
      expect(anula?.pct).toBeGreaterThan(tc.pct);
      expect(anula?.pct_atual ?? 0).toBeGreaterThan(tc.pct_atual ?? 0);
    }
    expect(ROW.lider).toBe(11);
  });

  it("liderIdPorBase = `por_uf[].lider` do modelo, nas DUAS bases [mutação: `ordenados[0]?.id` cru]", () => {
    expect(liderIdPorBase(ROW, "proj")).toBe(ROW.lider);
    expect(liderIdPorBase(ROW, "parcial")).toBe(ROW.lider);
  });

  it("margem parcial é entre quem disputa: VALIDA 33 − JUDICE 16 = 17 [mutação: sem `queCompetem`]", () => {
    expect(margemPorBase(ROW, "parcial")).toBe(17);
    expect(margemPorBase(ROW, "proj")).toBe(ROW.margem_projetada);
  });

  it("cor do mapa nacional é a do PT (VALIDA), nas duas bases — nunca a do NOVO (ANULA)", () => {
    const proj = corDoMapa(ROW, BASE, "proj");
    const parcial = corDoMapa(ROW, BASE, "parcial");
    expect(proj).toBe(TOKENS["--party-pt"]);
    expect(parcial).toBe(TOKENS["--party-pt"]);
  });

  it("cartograma hexagonal: fundo e nome acessível do líder são os de VALIDA (PT)", () => {
    const h = hex(ROW, BASE);
    expect(h.rotulo).toContain("líder VALIDA (PT)");
    expect(h.rotulo).not.toContain("ANULA");
    expect(h.fill).toBe(partyChipInk("PT").background);
  });

  it("ficha do estado: 'Líder: VALIDA', ANULA no FIM da lista com a etiqueta, JUDICE com a dela", () => {
    const f = ficha(ROW, BASE);
    expect(f.lider).toContain("Líder: VALIDA");
    expect(f.nomes).toEqual(["VALIDA", "JUDICE", "QUARTA", "ANULA"]);
    const etiquetas = Array.from(f.doc.querySelectorAll('[data-testid="destino-etiqueta"]')).map(
      (e) => [e.getAttribute("data-destino"), e.textContent],
    );
    expect(etiquetas).toEqual([
      ["sub_judice", ", Sub judice"],
      ["anulado", ", Anulado"],
    ]);
    expect(f.doc.querySelector('[data-testid="state-sheet-nota-anuladas"]')).not.toBeNull();
  });

  it("ficha de Senador: a anulada não leva vaga — as duas vão para VALIDA e JUDICE", () => {
    const f = ficha(ROW, BASE, "sen");
    const itens = Array.from(f.doc.querySelectorAll('[data-testid="state-sheet-candidatos"] > li'));
    const comVaga = itens
      .filter((li) => li.querySelector('[data-testid="result-vaga-marker"]'))
      .map((li) => li.querySelector('[data-testid="state-sheet-cand-nome"]')?.textContent);
    expect(comVaga).toEqual(["VALIDA", "JUDICE"]);
  });

  it("margem da 2ª vaga do Senado: JUDICE 15 − QUARTA 5 = 10 [mutação: sem filtro ⇒ 35 − 15 = 20]", () => {
    expect(margemSegundaVaga(ROW)).toBe(10);
  });

  // 🔴 ALTERADO na opção A: a fixture passa pelo formato que o produtor grava
  // (percentuais de quem compete sobre os votos em disputa). VALIDA tem 33 de
  // 54 em disputa = 61,1% > 50 ⇒ eleito. Antes a régua descontava a anulada
  // aqui (`> (100 − 42) / 2`), o que hoje dupla-desconta — ver o caso 45 × 42,5
  // em `anulada-listas.test.tsx`.
  it("desfecho de Governador (contagem): eleito no 1º turno, e o partido creditado é o PT", () => {
    const row = mkRow(opcaoA(BASE), 11, 20);
    expect(classificarContagem(row)).toBe("eleito_1t");
    // Sem o filtro de líder, a ANULA (42, sobre `vvc`) seria "o 1º" e o
    // partido creditado, NOVO.
    const porPartido = agregarPorPartido([row], "contagem");
    expect(porPartido).toEqual([{ partido: "PT", eleitos: 1, segundo_turno: 0 }]);
  });

  it("desfecho de Governador (projeção, 2º turno): os dois que vão são VALIDA e JUDICE, nunca ANULA", () => {
    const vai2t: EdgeUfRow = { ...ROW, vai_a_2t: true };
    const porPartido = agregarPorPartido([vai2t], "projecao");
    expect(porPartido.map((l) => l.partido).sort()).toEqual(["PL", "PT"]);
    expect(porPartido.every((l) => l.segundo_turno === 1)).toBe(true);
  });

  it("topo do `<ResultPanel>` é VALIDA; ANULA é a última linha, com '—' no lugar da colocação, etiqueta e a nota", () => {
    const doc = painel(BASE);
    const linhas = Array.from(doc.querySelectorAll("li"));
    const nomes = linhas.map(
      (li) => li.querySelector('[data-testid="candidate-result-name"]')?.textContent,
    );
    // DOM na ordem de projeção (a cascata reordena por `--ord-parcial`).
    expect(nomes).toEqual(["VALIDA", "JUDICE", "QUARTA", "ANULA"]);
    const anula = linhas[3];
    expect(anula?.getAttribute("style")).toContain("--ord-parcial:3");
    expect(anula?.querySelector('[data-testid="destino-etiqueta"]')?.textContent).toBe(", Anulado");
    expect(anula?.querySelector("[aria-hidden='true']")?.textContent).toBe("—");
    // Margem da figura do topo: VALIDA − JUDICE, nunca contra a anulada.
    const margem = doc.querySelector('[data-testid="result-margem-proj"]')?.textContent ?? "";
    expect(margem).toContain("Margem VALIDA");
    expect(margem).toContain("20,0");
    // Opção A: a nota é a do dono, e a linha da anulada não tem percentual
    // nenhum — só os votos (42.000).
    expect(doc.querySelector('[data-testid="result-nota-anuladas"]')?.textContent).toContain(
      "os percentuais são calculados sobre os votos em disputa",
    );
    expect(anula?.querySelector('[data-testid="result-bar"]')).toBeNull();
    expect(anula?.textContent).not.toMatch(/%/);
    expect(
      anula?.querySelector('[data-testid="candidate-result-votos-anulada"]')?.textContent,
    ).toBe("42.000votos");
  });

  it("balão do mapa: VALIDA primeiro, ANULA depois das que competem, com etiqueta", () => {
    const b = balao(ROW, BASE);
    expect(b.nomes).toEqual(["VALIDA", "JUDICE", "QUARTA", "ANULA"]);
    expect(b.etiquetas).toEqual(["sub_judice", "anulado"]);
  });
});

describe("ADR-0053 — contraprovas", () => {
  it("🔴 sub judice no TOPO continua sendo o líder, em toda superfície [mutação: filtrar 'sub_judice']", () => {
    expect(liderIdPorBase(ROW_JUDICE, "proj")).toBe(12);
    expect(liderIdPorBase(ROW_JUDICE, "parcial")).toBe(12);
    expect(corDoMapa(ROW_JUDICE, JUDICE_NO_TOPO, "parcial")).toBe(TOKENS["--party-pl"]);
    expect(hex(ROW_JUDICE, JUDICE_NO_TOPO).rotulo).toContain("líder JUDICE (PL)");
    expect(ficha(ROW_JUDICE, JUDICE_NO_TOPO).lider).toContain("Líder: JUDICE");
    // Opção A: JUDICE tem 46 de 69 em disputa = 66,7% > 50 ⇒ eleito; o
    // crédito é do PL.
    expect(agregarPorPartido([mkRow(opcaoA(JUDICE_NO_TOPO), 12, 25)], "contagem")).toEqual([
      { partido: "PL", eleitos: 1, segundo_turno: 0 },
    ]);
    // 2ª vaga: VALIDA 20 − QUARTA 5 (a anulada sai do par 2º/3º).
    expect(margemSegundaVaga(ROW_JUDICE)).toBe(15);
    const nomes = Array.from(painel(JUDICE_NO_TOPO).querySelectorAll("li")).map(
      (li) => li.querySelector('[data-testid="candidate-result-name"]')?.textContent,
    );
    expect(nomes[0]).toBe("JUDICE");
  });

  it("🔴 SEM `destino`: nada muda — o mais votado lidera, sem etiqueta e sem nota [mutação: default 'anulado']", () => {
    expect(liderIdPorBase(ROW_SEM, "proj")).toBe(10);
    expect(liderIdPorBase(ROW_SEM, "parcial")).toBe(10);
    expect(corDoMapa(ROW_SEM, SEM_DESTINO, "proj")).toBe(TOKENS["--party-novo"]);
    expect(hex(ROW_SEM, SEM_DESTINO).rotulo).toContain("líder ANULA (NOVO)");
    const f = ficha(ROW_SEM, SEM_DESTINO);
    expect(f.lider).toContain("Líder: ANULA");
    expect(f.nomes).toEqual(["ANULA", "VALIDA", "JUDICE", "QUARTA"]);
    expect(f.doc.querySelector('[data-testid="destino-etiqueta"]')).toBeNull();
    expect(f.doc.querySelector('[data-testid="state-sheet-nota-anuladas"]')).toBeNull();
    // 2ª vaga como sempre foi: 2º − 3º do corte cru.
    expect(margemSegundaVaga(ROW_SEM)).toBe(35 - 15);
    // Régua de 50 de sempre: 42 não passa.
    expect(classificarContagem(ROW_SEM)).toBe("segundo_turno");
    const doc = painel(SEM_DESTINO);
    expect(
      Array.from(doc.querySelectorAll("li")).map(
        (li) => li.querySelector('[data-testid="candidate-result-name"]')?.textContent,
      ),
    ).toEqual(["ANULA", "VALIDA", "JUDICE", "QUARTA"]);
    expect(doc.querySelector('[data-testid="result-nota-anuladas"]')).toBeNull();
    expect(balao(ROW_SEM, SEM_DESTINO).nomes).toEqual(["ANULA", "VALIDA", "JUDICE", "QUARTA"]);
  });
});
