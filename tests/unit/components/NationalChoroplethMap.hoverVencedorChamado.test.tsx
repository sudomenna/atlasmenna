// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.hoverVencedorChamado.test.tsx
 *
 * 2026-09-18 — pedido do dono: aproximar o balão do hover do tooltip do NYT.
 * As capturas mostram a linha do vencedor com FUNDO CHEIO da cor do partido
 * + ✓ — mas a eleição das capturas está em 100% apurado. Copiar isso
 * literalmente para uma apuração em curso declararia vencedor no meio da
 * contagem (constituição § 1). O produto já tem o conceito certo:
 * `EdgeUfRow.chamada`.
 *
 * O que este arquivo trava:
 *   - `chamada: false` (o caso comum) NUNCA mostra o ✓ nem pinta a linha —
 *     mesmo que o candidato tenha um partido mapeado (`PT`) e seja o líder;
 *   - `chamada: true` mostra o ✓ na linha 0 (a líder) e SÓ nela — os 2º/3º
 *     colocados de uma UF chamada não são "vencedores" também;
 *   - o tratamento cobre partido não mapeado (sigla desconhecida e federação)
 *     tanto quanto partido com token próprio.
 *
 * 🔴 2026-09-20 — o "fallback por rank" (`strongForRank` + `--text-inverse`)
 * que este arquivo cobria no caso não mapeado **deixou de existir**: o par
 * agora é `partyChipInk(partido)` para todo mundo, porque ele já resolve sigla
 * ausente, desconhecida ou de federação no par medido de `outros`. A cor de
 * uma candidatura não pode derivar da colocação (constituição § 2) — ver o topo
 * de `components/blocks/_candidateColor.ts`.
 *
 * 🔴 2026-10-04 (dono, dia do 1º turno) — **a fonte mudou de `chamada` para
 * `eleitos_definidos`.** `chamada` é leitura da PROJEÇÃO (margem projetada >
 * 10 pp) e pôs dois senadores "eleitos" em MT a 27% apurado. Agora o fundo
 * cheio + ✓ e o cabeçalho "Matematicamente eleito(s)" só aparecem para os ids
 * que o produtor declarou matematicamente eleitos, e "Chamada" saiu do
 * cabeçalho. Os casos de cor (partyChipInk, `outros`, federação) continuam,
 * agora disparados por `eleitos_definidos`.
 *
 * Harness idêntico a `NationalChoroplethMap.hoverIdentidadePorUf.test.tsx`.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";

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
// 🔴 2026-09-19 — `_NationalChoroplethMapImpl` passou a chamar `useRouter()`:
// no desktop o clique numa UF navega para a página do estado (decisão do dono;
// ver a docstring do topo daquele arquivo). Sem App Router montado o hook
// lança "invariant expected app router to be mounted" e o componente nem
// renderiza. Este mock é HARNESS, não asserção — nenhum caso deste arquivo
// observa navegação. Quem afere o clique-navega é
// `NationalChoroplethMap.cliqueDesktopNavega.test.tsx`.
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

const CANDIDATOS_NACIONAIS: EdgeCandidate[] = [
  {
    id: 13,
    nome: "Candidato 13",
    partido: "PT",
    cor: "var(--color-cand-1)",
    votos_atuais: 1,
    votos_projetados: 1,
    pct_atual: 55,
    pct_projetado: 55,
    pct_projetado_lower: 53,
    pct_projetado_upper: 57,
    p_vitoria: 0.8,
    rank: 1,
    p_passa_2t: 0.9,
    p_fecha_1t: 0,
  },
];

function rowSp(
  chamada: boolean,
  partido: string | undefined,
  extra: Partial<EdgeUfRow> = {},
): EdgeUfRow {
  return {
    sigla: "SP",
    pct_apurado: 90,
    lider: 13,
    margem_atual: 20,
    margem_projetada: 20,
    margem_projetada_ci: [18, 22],
    chamada,
    swing_vs_2022: null,
    top_candidatos: [
      { id: 13, pct: 55, nome: "FERNANDA DA SILVA", partido, votos_atuais: 900, pct_atual: 55 },
      { id: 22, pct: 30, nome: "JOÃO DE SOUZA", partido: "PL", votos_atuais: 500, pct_atual: 30 },
      { id: 33, pct: 15, nome: "MARIA LIMA", partido: "PSOL", votos_atuais: 200, pct_atual: 15 },
    ],
    vai_a_2t: null,
    bucket: chamada ? "chamada" : "indefinido",
    ...extra,
  };
}

function montar(
  row: EdgeUfRow,
  viewMode: "proj" | "parcial" = "proj",
  cargo: "pres" | "gov" | "sen" = "pres",
  turno?: number,
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NationalChoroplethMapImpl
        candidatoAId={13}
        candidatos={CANDIDATOS_NACIONAIS}
        rows={[row]}
        view="winner"
        viewMode={viewMode}
        cargo={cargo}
        turno={turno}
      />,
    );
  });
  return { host, root };
}

function disparaHoverEmSp() {
  const onMouseMove = espiao.handlers.get("mousemove:ufs-fill");
  expect(onMouseMove, "handler de mousemove não foi registrado").toBeDefined();
  act(() => {
    onMouseMove?.({
      features: [{ properties: { SIGLA_UF: "SP" } }],
      originalEvent: { clientX: 10, clientY: 10 },
    });
  });
}

beforeEach(() => {
  espiao.handlers.clear();
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("hover do mapa nacional — fundo cheio + ✓ só para MATEMATICAMENTE eleito (eleitos_definidos)", () => {
  it("chamada: false e sem eleitos_definidos — nenhum ✓, nenhum fundo, nenhum cabeçalho", () => {
    const { host, root } = montar(rowSp(false, "PT"));
    disparaHoverEmSp();

    const c = card(host);
    expect(c).not.toBeNull();
    expect(c?.textContent).not.toContain("✓");
    expect(c?.innerHTML).not.toContain("--party-pt-chip");
    expect(c?.textContent).not.toContain("Matematicamente");

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 o caso do dono (MT a 27%): chamada: true SEM eleitos_definidos — sem ✓, sem fundo, sem 'Chamada' [mutação: voltar a ler `chamada`]", () => {
    const { host, root } = montar(rowSp(true, "PT", { pct_apurado: 27 }));
    disparaHoverEmSp();

    const c = card(host);
    expect(c?.textContent).not.toContain("✓");
    expect(c?.innerHTML).not.toContain("--party-pt-chip");
    expect(c?.textContent).not.toContain("Chamada");
    expect(c?.textContent).not.toContain("Matematicamente");

    act(() => root.unmount());
    host.remove();
  });

  it("eleitos_definidos [13] + partido mapeado — ✓, par medido do partido (partyChipInk) e cabeçalho 'Matematicamente eleito'", () => {
    const { host, root } = montar(rowSp(true, "PT", { eleitos_definidos: [13] }));
    disparaHoverEmSp();

    const c = card(host);
    expect(c?.textContent).toContain("✓");
    expect(c?.innerHTML).toContain("--party-pt-chip");
    expect(c?.innerHTML).toContain("--party-pt-ink");
    // Presidente (cargo padrão do `montar`): o escopo é o PAÍS (auditoria
    // P1, 2026-10-04) — e sem a atribuição, que é só do Senado.
    expect(c?.textContent).toContain("No país: matematicamente eleito");
    expect(c?.textContent).not.toContain("matematicamente eleitos");
    expect(c?.textContent).not.toContain("Chamada");
    expect(host.querySelector("[data-testid='hover-card-nota']")).toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it("eleitos_definidos independe de `chamada` — chamada: false com eleito declarado mostra o ✓", () => {
    const { host, root } = montar(rowSp(false, "PT", { eleitos_definidos: [13] }));
    disparaHoverEmSp();

    expect(card(host)?.textContent).toContain("✓");
    expect(card(host)?.textContent).toContain("No país: matematicamente eleito");

    act(() => root.unmount());
    host.remove();
  });

  it("eleitos_definidos + partido NÃO mapeado — usa o par medido de `outros`, nunca o rank, e nunca some o ✓", () => {
    // "ZZZ" não é sigla conhecida nem federação — `normalizePartySlug` cai no
    // fallback "outros". `undefined` não serviria aqui: `buildHoverRows` cairia
    // no FALLBACK de `candidatosById` (`tc.partido ?? cand?.partido`), que na
    // fixture nacional tem partido "PT" — testaria o caminho errado.
    const { host, root } = montar(rowSp(true, "ZZZ", { eleitos_definidos: [13] }));
    disparaHoverEmSp();

    const c = card(host);
    expect(c?.textContent).toContain("✓");
    expect(c?.innerHTML).toContain("--party-outros-chip");
    expect(c?.innerHTML).toContain("--party-outros-ink");
    expect(c?.innerHTML).not.toContain("--color-cand-");

    act(() => root.unmount());
    host.remove();
  });

  it("eleitos_definidos + FEDERAÇÃO — par de `outros`, nunca cor de colocação", () => {
    const primeiro = montar(rowSp(true, "PSDB/CIDADANIA", { eleitos_definidos: [13] }));
    disparaHoverEmSp();
    const html = card(primeiro.host)?.innerHTML ?? "";

    expect(html).toContain("--party-outros-chip");
    expect(html).not.toContain("--color-cand-");

    act(() => primeiro.root.unmount());
    primeiro.host.remove();
  });

  it("eleitos_definidos [13] — o ✓ aparece EXATAMENTE uma vez", () => {
    const { host, root } = montar(rowSp(true, "PT", { eleitos_definidos: [13] }));
    disparaHoverEmSp();

    const checks = (card(host)?.textContent?.match(/✓/g) ?? []).length;
    expect(checks).toBe(1);

    act(() => root.unmount());
    host.remove();
  });

  it("dois ids (Senado) — dois ✓, cabeçalho no plural 'Matematicamente eleitos', sem prefixo, com a atribuição", () => {
    const { host, root } = montar(
      rowSp(true, "PT", { eleitos_definidos: [13, 22] }),
      "proj",
      "sen",
    );
    disparaHoverEmSp();

    const c = card(host);
    expect((c?.textContent?.match(/✓/g) ?? []).length).toBe(2);
    expect(c?.textContent).toContain("Matematicamente eleitos");
    expect(c?.textContent).not.toContain("No país");
    expect(host.querySelector("[data-testid='hover-card-nota']")?.textContent).toBe(
      "Cálculo do AtlasMenna sobre a contagem do TSE",
    );
    expect(c?.innerHTML).toContain("--party-pl-chip");

    act(() => root.unmount());
    host.remove();
  });

  // 04/10 (para o 2º turno) — depois da totalização final a marca do Senado é
  // a do TSE (`definicao_oficial`); o balão diz de quem é a definição.
  it("🔴 Senado com definicao_oficial ⇒ nota 'Definição oficial do TSE' [mutação: ignorar `definicao_oficial`]", () => {
    const { host, root } = montar(
      rowSp(true, "PT", { eleitos_definidos: [13, 22], definicao_oficial: true }),
      "proj",
      "sen",
    );
    disparaHoverEmSp();

    expect(host.querySelector("[data-testid='hover-card-nota']")?.textContent).toBe(
      "Definição oficial do TSE",
    );
    expect(card(host)?.textContent).not.toContain("Cálculo do AtlasMenna");

    act(() => root.unmount());
    host.remove();
  });

  it("id que não está nas linhas é ignorado — nenhum ✓ e nenhum cabeçalho", () => {
    const { host, root } = montar(rowSp(true, "PT", { eleitos_definidos: [999] }));
    disparaHoverEmSp();

    const c = card(host);
    expect(c?.textContent).not.toContain("✓");
    expect(c?.textContent).not.toContain("Matematicamente");

    act(() => root.unmount());
    host.remove();
  });

  it("Parcial com ordem diferente — o ✓ segue o id (JOÃO, 2º na projeção e 1º na parcial), não a posição", () => {
    // Na parcial JOÃO (22) passa à frente; o eleito declarado é FERNANDA (13).
    const row = rowSp(true, "PT", { eleitos_definidos: [13] });
    row.top_candidatos = [
      {
        id: 13,
        pct: 55,
        nome: "FERNANDA DA SILVA",
        partido: "PT",
        votos_atuais: 400,
        pct_atual: 35,
      },
      { id: 22, pct: 30, nome: "JOÃO DE SOUZA", partido: "PL", votos_atuais: 600, pct_atual: 50 },
      { id: 33, pct: 15, nome: "MARIA LIMA", partido: "PSOL", votos_atuais: 200, pct_atual: 15 },
    ];
    const { host, root } = montar(row, "parcial");
    disparaHoverEmSp();

    const c = card(host);
    const texto = c?.textContent ?? "";
    // A lista está em ordem de parcial: JOÃO antes de FERNANDA.
    expect(texto.indexOf("JOÃO")).toBeLessThan(texto.indexOf("FERNANDA"));
    // O ✓ está imediatamente antes de FERNANDA, e o fundo é o do PT, não o do PL.
    expect(texto).toMatch(/✓\s*FERNANDA/);
    expect(c?.innerHTML).toContain("--party-pt-chip");
    expect(c?.innerHTML).not.toContain("--party-pl-chip");

    act(() => root.unmount());
    host.remove();
  });

  it("segundo_turno_definido — cabeçalho '2º turno definido' e NENHUM fundo/✓", () => {
    const { host, root } = montar(rowSp(true, "PT", { segundo_turno_definido: true }));
    disparaHoverEmSp();

    const c = card(host);
    expect(c?.textContent).toContain("2º turno definido");
    expect(c?.textContent).not.toContain("✓");
    expect(c?.innerHTML).not.toContain("-chip)");

    act(() => root.unmount());
    host.remove();
  });
});

// 2026-10-04 (dono) — o balão traz o selo de BASE dos cartões das páginas
// (`selosDaBase`), na ordem que a lista de fato usou. Independe do ✓.
describe("hover do mapa nacional — selo de base por cargo (selosDaBase)", () => {
  function selos(host: HTMLElement): Record<string, string> {
    const out: Record<string, string> = {};
    for (const cel of host.querySelectorAll("[data-testid='hover-card'] span.flex.min-w-0")) {
      const nome = cel.querySelector("span.overflow-hidden")?.textContent ?? "";
      const selo = cel.querySelector("[data-testid='hover-card-vaga']")?.textContent;
      if (nome && selo) out[nome] = selo;
    }
    return out;
  }

  it("Governador em Projeção: FERNANDA 55% ⇒ só ela, 'Vence no 1º turno · projeção'", () => {
    const { host, root } = montar(rowSp(true, "PT"), "proj", "gov");
    disparaHoverEmSp();
    expect(selos(host)).toEqual({ "FERNANDA DA SILVA": "Vence no 1º turno · projeção" });
    act(() => root.unmount());
    host.remove();
  });

  it("Governador em Parcial com outra ordem: JOÃO 50% (não > 50) ⇒ JOÃO e FERNANDA, '2º turno · na parcial'", () => {
    const row = rowSp(true, "PT");
    row.top_candidatos = [
      {
        id: 13,
        pct: 55,
        nome: "FERNANDA DA SILVA",
        partido: "PT",
        votos_atuais: 400,
        pct_atual: 35,
      },
      { id: 22, pct: 30, nome: "JOÃO DE SOUZA", partido: "PL", votos_atuais: 600, pct_atual: 50 },
      { id: 33, pct: 15, nome: "MARIA LIMA", partido: "PSOL", votos_atuais: 200, pct_atual: 15 },
    ];
    const { host, root } = montar(row, "parcial", "gov");
    disparaHoverEmSp();
    expect(selos(host)).toEqual({
      "JOÃO DE SOUZA": "2º turno · na parcial",
      "FERNANDA DA SILVA": "2º turno · na parcial",
    });
    act(() => root.unmount());
    host.remove();
  });

  it("Governador: o eleito definido mantém o selo junto do ✓", () => {
    const { host, root } = montar(rowSp(true, "PT", { eleitos_definidos: [13] }), "proj", "gov");
    disparaHoverEmSp();
    expect(selos(host)).toEqual({ "FERNANDA DA SILVA": "Vence no 1º turno · projeção" });
    expect(card(host)?.textContent).toContain("✓");
    // Governador: sem prefixo (o balão já é do estado) e sem a atribuição do
    // Senado — a fonte é o aviso do TSE.
    expect(card(host)?.textContent).toMatch(/^Matematicamente eleito/);
    expect(host.querySelector("[data-testid='hover-card-nota']")).toBeNull();
    act(() => root.unmount());
    host.remove();
  });

  it("Governador no 2º turno ⇒ nenhum selo", () => {
    const { host, root } = montar(rowSp(true, "PT"), "proj", "gov", 2);
    disparaHoverEmSp();
    expect(selos(host)).toEqual({});
    act(() => root.unmount());
    host.remove();
  });

  it("Presidente na UF ⇒ nenhum selo (decisão de 27/09)", () => {
    const { host, root } = montar(rowSp(true, "PT"), "proj", "pres");
    disparaHoverEmSp();
    expect(selos(host)).toEqual({});
    act(() => root.unmount());
    host.remove();
  });
});

function card(host: HTMLElement) {
  return host.querySelector('[data-testid="hover-card"]');
}
