// @vitest-environment happy-dom
/**
 * tests/unit/components/senado-dois-eleitos.test.tsx
 *
 * 2026-09-29 — correção pedida pelo dono: "em todas as telas de senador: são 2
 * senadores eleitos. Os dois primeiros colocados de cada estado são eleitos."
 * Todo selo de eleito — o de corrida chamada (✓ no balão do mapa), o projetado
 * e o da parcial — vale para os DOIS ocupantes de vaga, não só para o líder, em
 * cada superfície de Senador. Governador e Presidente não mudam.
 *
 * Superfícies travadas aqui (a página da UF, `<ResultPanel>`, já marcava as
 * duas vagas e tem teste próprio em `ResultPanelVagas.test.tsx` /
 * `senador.test.tsx`; o hemiciclo de 2027, em `senado-2027.test.ts`):
 *
 *   A. `<GovernorCard cargo="sen">` — os cartões da capa `/senador`;
 *   B. `<StateResultSheet cargo="sen">` — a folha do toque no celular;
 *   C. o balão do mapa nacional no desktop (`buildHoverRows` → `<HoverCard>`);
 *   D. a fiação real wrapper → impl: passar o mouse (desktop) e tocar
 *      (celular) no mapa de `/senador`.
 *
 * Cada caso nomeia a mutação que mata (regra da casa: teste que não
 * discrimina não vale). `VAGAS_SENADO` é literal de propósito.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeCandidate, EdgeDestinoVoto, EdgeUfRow } from "@/lib/edge-config/types";

// ---------------------------------------------------------------------------
// Mocks do mapa (hoisted) — o mesmo harness de
// `NationalChoroplethMap.cliqueDesktopNavega.test.tsx`
// ---------------------------------------------------------------------------

type Handler = (e: unknown) => void;

const espiao = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
}));

vi.mock("maplibre-gl", async () => {
  const { addZoomApi } = await import("./_fake-map-zoom");
  class FakeMap {
    cameraForBounds() {
      return { center: [-51.415, -14.24] as [number, number], zoom: 3 };
    }
    jumpTo() {}
    setPaintProperty() {}
    setFilter() {}
    getCanvas() {
      return { style: {}, setAttribute() {}, removeAttribute() {}, tabIndex: 0 };
    }
    isStyleLoaded() {
      return true;
    }
    loaded() {
      return true;
    }
    remove() {}
    on(event: string, a: unknown, b?: unknown) {
      if (typeof a === "function") {
        espiao.handlers.set(event, a as Handler);
      } else {
        espiao.handlers.set(`${event}:${String(a)}`, b as Handler);
      }
    }
  }
  addZoomApi(FakeMap.prototype);
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
/** O impl de verdade, sem o `React.lazy` do `next/dynamic` (ver o harness citado). */
vi.mock("next/dynamic", async () => {
  const mod = await import("@/components/blocks/_NationalChoroplethMapImpl");
  return { default: () => mod.NationalChoroplethMapImpl };
});

import { NationalChoroplethMapImpl } from "@/components/blocks/_NationalChoroplethMapImpl";
import { GovernorCard } from "@/components/blocks/GovernorCard";
import { NationalChoroplethMap } from "@/components/blocks/NationalChoroplethMap";
import { StateResultSheet } from "@/components/blocks/StateResultSheet";
import type { ViewMode } from "@/lib/state/view-mode";

const VAGAS_SENADO = 2;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Top = EdgeUfRow["top_candidatos"][number];

function tc(
  id: number,
  nome: string,
  partido: string,
  pct: number,
  pctAtual: number,
  destino?: EdgeDestinoVoto,
): Top {
  return {
    id,
    nome,
    partido,
    pct,
    pct_atual: pctAtual,
    votos_atuais: Math.round(pctAtual * 1000),
    ...(destino ? { destino } : {}),
  };
}

/**
 * Projeção: ANA 45 · BRUNO 30 · CARLA 15 · DAVI 10 (2ª vaga decidida por 15 pp).
 * Parcial:  CARLA 35 · ANA 30 · BRUNO 25 · DAVI 10 — as vagas da parcial são
 * CARLA + ANA, as da projeção ANA + BRUNO. As duas bases discordam de
 * propósito: é o que discrimina "segue a base" de "segue a projeção sempre".
 */
const TOP_SEN: Top[] = [
  tc(13, "ANA LIMA", "PT", 45, 30),
  tc(22, "BRUNO REIS", "PL", 30, 25),
  tc(40, "CARLA MOTA", "MDB", 15, 35),
  tc(50, "DAVI PRADO", "PSD", 10, 10),
];

/** Anulada em 2º na projeção: quem sobe para a 2ª vaga é BRUNO (3º do corte). */
const TOP_SEN_ANULADA: Top[] = [
  tc(13, "ANA LIMA", "PT", 45, 45),
  tc(9, "NINA ANULADA", "PP", 30, 30, "anulado"),
  tc(22, "BRUNO REIS", "PL", 15, 15),
  tc(40, "CARLA MOTA", "MDB", 10, 10),
];

function row(top: Top[], over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla: "SP",
    pct_apurado: 60,
    lider: top[0]?.id ?? 0,
    margem_atual: 15,
    margem_projetada: 15,
    margem_projetada_ci: [10, 20],
    chamada: true,
    swing_vs_2022: null,
    top_candidatos: top,
    vai_a_2t: null,
    bucket: "chamada",
    ...over,
  };
}

function nacionais(top: Top[]): EdgeCandidate[] {
  return top.map(
    (t, i) =>
      ({
        id: t.id,
        nome: `Candidato ${t.id}`,
        partido: t.partido ?? "—",
        cor: `var(--color-cand-${i + 1})`,
        votos_atuais: 1,
        votos_projetados: 1,
        pct_atual: t.pct_atual ?? 0,
        pct_projetado: t.pct,
        pct_projetado_lower: t.pct,
        pct_projetado_upper: t.pct,
        p_vitoria: 0,
        rank: i + 1,
        p_passa_2t: 0,
        p_fecha_1t: 0,
      }) as EdgeCandidate,
  );
}

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

// ===========================================================================
// A. Cartões da capa `/senador`
// ===========================================================================

describe("A. <GovernorCard cargo='sen'> — '● ELEITO' nos dois ocupantes de vaga", () => {
  /** Nome de cada linha que leva o selo de eleito (`b[data-s="e"]`). */
  function eleitosNoCartao(doc: Document): string[] {
    return [...doc.querySelectorAll("li")]
      .filter((li) => li.querySelector("b[data-s='e']") != null)
      .map((li) => li.textContent ?? "");
  }

  it("marca os DOIS primeiros da projeção, nunca o 3º (mata 'só o rank 1' e 'vagas=1')", () => {
    const doc = parse(<GovernorCard uf={row(TOP_SEN)} candidatos={[]} cargo="sen" />);
    const eleitos = eleitosNoCartao(doc);
    expect(eleitos).toHaveLength(VAGAS_SENADO);
    expect(eleitos[0]).toContain("ANA LIMA");
    expect(eleitos[1]).toContain("BRUNO REIS");
    expect(doc.body.textContent).not.toMatch(/VAI A 2T|EM APURAÇÃO/);
    const aria = doc.querySelector("article")?.getAttribute("aria-label") ?? "";
    expect(aria).toMatch(/eleitos: ANA LIMA .* e BRUNO REIS /);
  });

  it("anulada não ocupa vaga — o 3º que disputa sobe (mata 'anulada contada')", () => {
    const doc = parse(<GovernorCard uf={row(TOP_SEN_ANULADA)} candidatos={[]} cargo="sen" />);
    const eleitos = eleitosNoCartao(doc);
    expect(eleitos).toHaveLength(VAGAS_SENADO);
    expect(eleitos.join(" | ")).toContain("ANA LIMA");
    expect(eleitos.join(" | ")).toContain("BRUNO REIS");
    expect(eleitos.join(" | ")).not.toContain("NINA ANULADA");
  });

  it("uma só que disputa + anulada: a anulada NUNCA é eleita, nem sobrando vaga", () => {
    // O caso acima não alcança o filtro do ponto único: `anuladasAoFim` já põe
    // a anulada no fim do cartão. Aqui ela é a 2ª linha mesmo depois disso —
    // só o filtro de `ocupantesDasVagas` a separa da 2ª vaga.
    const top = [tc(13, "ANA LIMA", "PT", 60, 60), tc(9, "NINA ANULADA", "PP", 40, 40, "anulado")];
    const eleitos = eleitosNoCartao(
      parse(<GovernorCard uf={row(top)} candidatos={[]} cargo="sen" />),
    );
    expect(eleitos).toHaveLength(1);
    expect(eleitos[0]).toContain("ANA LIMA");
  });

  it("sem apuração começada não há projeção — nenhum selo (constituição § 1)", () => {
    const doc = parse(
      <GovernorCard uf={row(TOP_SEN, { pct_apurado: 0 })} candidatos={[]} cargo="sen" />,
    );
    expect(eleitosNoCartao(doc)).toHaveLength(0);
  });

  it("Governador NÃO muda: '● ELEITO' só no líder (mata 'governador ganha 2')", () => {
    const gov = row(TOP_SEN, { vai_a_2t: false, bucket: "decidido_1t" });
    const doc = parse(<GovernorCard uf={gov} candidatos={[]} cargo="gov" />);
    const eleitos = eleitosNoCartao(doc);
    expect(eleitos).toHaveLength(1);
    expect(eleitos[0]).toContain("ANA LIMA");
  });
});

// ===========================================================================
// B. A folha do toque (celular)
// ===========================================================================

describe("B. <StateResultSheet cargo='sen'> — as duas vagas, com o rótulo da base", () => {
  function sheet(top: Top[], viewMode: ViewMode, cargo: "sen" | "gov" = "sen"): Document {
    return parse(
      <StateResultSheet
        open
        onClose={() => {}}
        row={row(top)}
        candidatos={nacionais(top)}
        cargo={cargo}
        viewMode={viewMode}
      />,
    );
  }

  /** `[nome da linha, texto do marcador]` de cada linha com marcador de vaga. */
  function marcadas(doc: Document): Array<[string, string]> {
    return [...doc.querySelectorAll("[data-testid='state-sheet-candidatos'] li")]
      .map((li) => {
        const m = li.querySelector("[data-testid='result-vaga-marker']");
        const nome =
          li.querySelector("[data-testid='state-sheet-cand-identidade']")?.textContent ?? "";
        return m ? ([nome, m.textContent ?? ""] as [string, string]) : null;
      })
      .filter((x): x is [string, string] => x !== null);
  }

  it("Projeção: ANA + BRUNO, 'Vaga projetada'", () => {
    const m = marcadas(sheet(TOP_SEN, "proj"));
    expect(m).toHaveLength(VAGAS_SENADO);
    expect(m[0]?.[0]).toContain("ANA LIMA");
    expect(m[1]?.[0]).toContain("BRUNO REIS");
    expect(m.every(([, t]) => t === "Vaga projetada")).toBe(true);
  });

  it("Parcial: CARLA + ANA, 'Vaga na parcial' — nunca 'projetada' sob a ordem do apurado", () => {
    // Mutação: voltar a `<VagaBadge />` sem base — as duas diriam "projetada".
    const m = marcadas(sheet(TOP_SEN, "parcial"));
    expect(m).toHaveLength(VAGAS_SENADO);
    expect(m[0]?.[0]).toContain("CARLA MOTA");
    expect(m[1]?.[0]).toContain("ANA LIMA");
    expect(m.every(([, t]) => t === "Vaga na parcial")).toBe(true);
  });

  it("anulada não ocupa vaga — BRUNO sobe", () => {
    const m = marcadas(sheet(TOP_SEN_ANULADA, "proj"));
    expect(m.map(([n]) => n).join(" | ")).toMatch(/ANA LIMA.*BRUNO REIS/);
    expect(m.map(([n]) => n).join(" | ")).not.toContain("NINA ANULADA");
  });

  it("uma só que disputa + anulada: a anulada nunca leva o marcador", () => {
    const top = [tc(13, "ANA LIMA", "PT", 60, 60), tc(9, "NINA ANULADA", "PP", 40, 40, "anulado")];
    const m = marcadas(sheet(top, "proj"));
    expect(m).toHaveLength(1);
    expect(m[0]?.[0]).toContain("ANA LIMA");
  });

  it("Governador: nenhum marcador de vaga (1 vaga não tem 'ocupantes')", () => {
    expect(marcadas(sheet(TOP_SEN, "proj", "gov"))).toHaveLength(0);
  });
});

// ===========================================================================
// C e D. O balão do mapa (desktop) e o toque (celular)
// ===========================================================================

const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";
let temPonteiroFino = true;

function instalaMatchMedia() {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: query === FINE_POINTER_QUERY ? temPonteiroFino : false,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  espiao.handlers.clear();
  temPonteiroFino = true;
  instalaMatchMedia();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function monta(node: React.ReactElement): { host: HTMLElement; root: Root } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

function desmonta({ host, root }: { host: HTMLElement; root: Root }) {
  act(() => root.unmount());
  host.remove();
}

function passaOMouseEmSp() {
  const onMouseMove = espiao.handlers.get("mousemove:ufs-fill");
  expect(onMouseMove, "handler de mousemove não foi registrado").toBeDefined();
  act(() => {
    onMouseMove?.({
      features: [{ properties: { SIGLA_UF: "SP" } }],
      originalEvent: { clientX: 10, clientY: 10 },
    });
  });
}

/** Por nome: a linha tem ✓ (chamada)? e qual selo de vaga ela leva? */
function linhasDoBalao(host: HTMLElement): Map<string, { check: boolean; vaga: string | null }> {
  const card = host.querySelector("[data-testid='hover-card']");
  expect(card, "o balão não abriu").not.toBeNull();
  const out = new Map<string, { check: boolean; vaga: string | null }>();
  // A célula do nome é o `<span>` flex que contém o nome e, quando há, o ✓ e a
  // pílula de vaga (`HoverCard.tsx`).
  for (const cel of card?.querySelectorAll("span.flex.min-w-0") ?? []) {
    const nome = cel.querySelector("span.overflow-hidden")?.textContent ?? "";
    if (!nome) continue;
    out.set(nome, {
      check: (cel.textContent ?? "").includes("✓"),
      vaga: cel.querySelector("[data-testid='hover-card-vaga']")?.textContent ?? null,
    });
  }
  return out;
}

describe("C. balão do mapa nacional (desktop) — cargo='sen'", () => {
  function balao(r: EdgeUfRow, viewMode: ViewMode, cargo: "sen" | "gov" = "sen") {
    const m = monta(
      <NationalChoroplethMapImpl
        candidatoAId={13}
        candidatos={nacionais(r.top_candidatos)}
        rows={[r]}
        view="winner"
        viewMode={viewMode}
        cargo={cargo}
      />,
    );
    passaOMouseEmSp();
    const linhas = linhasDoBalao(m.host);
    desmonta(m);
    return linhas;
  }

  // 🔴 2026-10-04 (dono) — o ✓ é SÓ de quem está MATEMATICAMENTE eleito
  // (`eleitos_definidos`), não mais de `chamada` (leitura da projeção que pôs
  // dois senadores "eleitos" em MT a 27% apurado).
  it("🔴 UF chamada SEM eleitos_definidos (o caso MT 27%): nenhum ✓, mas as vagas seguem marcadas", () => {
    const l = balao(row(TOP_SEN, { pct_apurado: 27 }), "proj");
    expect([...l.values()].some((x) => x.check)).toBe(false);
    expect(l.get("ANA LIMA")?.vaga).toBe("Vaga projetada");
    expect(l.get("BRUNO REIS")?.vaga).toBe("Vaga projetada");
  });

  it("dois eleitos definidos: ✓ nos DOIS, não no 3º (mata 'badge só no rank 1')", () => {
    const l = balao(row(TOP_SEN, { eleitos_definidos: [13, 22] }), "proj");
    expect(l.get("ANA LIMA")?.check).toBe(true);
    expect(l.get("BRUNO REIS")?.check).toBe(true);
    expect(l.get("CARLA MOTA")?.check).toBe(false);
    expect(l.get("DAVI PRADO")?.check).toBe(false);
  });

  it("Projeção: pílula 'Vaga projetada' em ANA e BRUNO, e só neles", () => {
    const l = balao(row(TOP_SEN, { chamada: false, bucket: "indefinido" }), "proj");
    expect(l.get("ANA LIMA")?.vaga).toBe("Vaga projetada");
    expect(l.get("BRUNO REIS")?.vaga).toBe("Vaga projetada");
    expect(l.get("CARLA MOTA")?.vaga).toBeNull();
    // Não chamada ⇒ nenhum ✓, mas as vagas continuam marcadas.
    expect([...l.values()].some((x) => x.check)).toBe(false);
  });

  it("Parcial: pílula 'Vaga na parcial' em CARLA e ANA; o ✓ segue os ids eleitos, não a posição", () => {
    const l = balao(row(TOP_SEN, { eleitos_definidos: [13, 22] }), "parcial");
    expect(l.get("CARLA MOTA")?.vaga).toBe("Vaga na parcial");
    expect(l.get("ANA LIMA")?.vaga).toBe("Vaga na parcial");
    expect(l.get("BRUNO REIS")?.vaga).toBeNull();
    expect(l.get("BRUNO REIS")?.check).toBe(true);
    expect(l.get("CARLA MOTA")?.check).toBe(false);
  });

  it("anulada não recebe ✓ nem vaga — BRUNO sobe (mata 'anulada contada')", () => {
    const l = balao(row(TOP_SEN_ANULADA, { eleitos_definidos: [13, 9, 22] }), "proj");
    expect(l.get("NINA ANULADA")).toEqual({ check: false, vaga: null });
    expect(l.get("ANA LIMA")).toEqual({ check: true, vaga: "Vaga projetada" });
    expect(l.get("BRUNO REIS")).toEqual({ check: true, vaga: "Vaga projetada" });
  });

  it("Governador: ✓ só no eleito declarado, nenhuma pílula de VAGA — o selo é o de turno (2026-10-04)", () => {
    const l = balao(row(TOP_SEN, { eleitos_definidos: [13] }), "proj", "gov");
    expect([...l.entries()].filter(([, x]) => x.check).map(([n]) => n)).toEqual(["ANA LIMA"]);
    expect([...l.values()].some((x) => x.vaga?.startsWith("Vaga"))).toBe(false);
    // ANA 45% na projeção: ninguém passa de 50 ⇒ os dois primeiros, "2º turno".
    expect(l.get("ANA LIMA")?.vaga).toBe("2º turno · projeção");
    expect(l.get("BRUNO REIS")?.vaga).toBe("2º turno · projeção");
    expect(l.get("CARLA MOTA")?.vaga).toBeNull();
  });
});

describe("D. /senador de ponta a ponta — o mesmo mapa, pelo wrapper", () => {
  function mapa(r: EdgeUfRow) {
    return (
      <NationalChoroplethMap
        candidatoAId={13}
        candidatos={nacionais(r.top_candidatos)}
        rows={[r]}
        view="winner"
        cargo="sen"
      />
    );
  }

  it("desktop (mouse): o balão marca os DOIS eleitos definidos", () => {
    temPonteiroFino = true;
    const m = monta(mapa(row(TOP_SEN, { eleitos_definidos: [13, 22] })));
    passaOMouseEmSp();
    const l = linhasDoBalao(m.host);
    const comCheck = [...l.entries()].filter(([, x]) => x.check).map(([n]) => n);
    expect(comCheck).toEqual(["ANA LIMA", "BRUNO REIS"]);
    desmonta(m);
  });

  it("celular (toque): a gaveta abre com as DUAS vagas marcadas", () => {
    temPonteiroFino = false;
    const m = monta(mapa(row(TOP_SEN)));
    const onClick = espiao.handlers.get("click:ufs-fill");
    expect(onClick, "handler de click não foi registrado").toBeDefined();
    act(() => {
      onClick?.({
        features: [{ properties: { SIGLA_UF: "SP" } }],
        originalEvent: { clientX: 10, clientY: 10 },
      });
    });
    const itens = [...m.host.querySelectorAll("[data-testid='state-sheet-candidatos'] li")];
    const comVaga = itens
      .filter((li) => li.querySelector("[data-testid='result-vaga-marker']") != null)
      .map((li) => li.textContent ?? "");
    expect(comVaga).toHaveLength(VAGAS_SENADO);
    expect(comVaga[0]).toContain("ANA LIMA");
    expect(comVaga[1]).toContain("BRUNO REIS");
    desmonta(m);
  });
});
