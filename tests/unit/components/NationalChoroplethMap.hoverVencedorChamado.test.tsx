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

function rowSp(chamada: boolean, partido: string | undefined): EdgeUfRow {
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
  };
}

function montar(row: EdgeUfRow) {
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
        cargo="pres"
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

describe("hover do mapa nacional — fundo cheio + ✓ só quando EdgeUfRow.chamada === true", () => {
  it("chamada: false — nenhum ✓, nenhum fundo de vencedor, mesmo com partido mapeado e líder à frente", () => {
    const { host, root } = montar(rowSp(false, "PT"));
    disparaHoverEmSp();

    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).not.toContain("✓");
    expect(card?.innerHTML).not.toContain("--party-pt-chip");

    act(() => root.unmount());
    host.remove();
  });

  it("chamada: true + partido mapeado — ✓ aparece, e o fundo usa o par medido de contraste do partido (partyChipInk)", () => {
    const { host, root } = montar(rowSp(true, "PT"));
    disparaHoverEmSp();

    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card?.textContent).toContain("✓");
    expect(card?.innerHTML).toContain("--party-pt-chip");
    expect(card?.innerHTML).toContain("--party-pt-ink");

    act(() => root.unmount());
    host.remove();
  });

  it("chamada: true + partido NÃO mapeado — usa o par medido de `outros`, nunca o rank, e nunca some o ✓", () => {
    // "ZZZ" não é sigla conhecida nem federação — `normalizePartySlug` cai no
    // fallback "outros". `undefined` não serviria aqui: `buildHoverRows` cairia
    // no FALLBACK de `candidatosById` (`tc.partido ?? cand?.partido`), que na
    // fixture nacional tem partido "PT" — testaria o caminho errado.
    //
    // 🔴 Mudou em 2026-09-20. Até então este ramo caía em
    // `strongForRank(rank)` + `--text-inverse` — um par escolhido pela
    // COLOCAÇÃO, e cujo contraste ninguém mediu para este caso. Agora é o par
    // `--party-outros-chip` / `--party-outros-ink`, que o gerador mede como
    // mede os outros 30. Ver o topo de `components/blocks/_candidateColor.ts`.
    const { host, root } = montar(rowSp(true, "ZZZ"));
    disparaHoverEmSp();

    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card?.textContent).toContain("✓");
    expect(card?.innerHTML).toContain("--party-outros-chip");
    expect(card?.innerHTML).toContain("--party-outros-ink");
    expect(card?.innerHTML).not.toContain("--color-cand-");

    act(() => root.unmount());
    host.remove();
  });

  it("chamada: true + FEDERAÇÃO — mesma cor em qualquer colocação do líder", () => {
    // O caso que motivou a correção: "PSDB/CIDADANIA" não é partido único e
    // não tem token próprio. Com o desvio de rank, o mesmo estado saía de uma
    // cor no balão e de outra na lista ao lado — e trocava entre dois ciclos.
    const primeiro = montar(rowSp(true, "PSDB/CIDADANIA"));
    disparaHoverEmSp();
    const html = primeiro.host.querySelector('[data-testid="hover-card"]')?.innerHTML ?? "";

    expect(html).toContain("--party-outros-chip");
    expect(html).not.toContain("--color-cand-");

    act(() => primeiro.root.unmount());
    primeiro.host.remove();
  });

  it("chamada: true — o ✓ aparece EXATAMENTE uma vez (só a linha 0, líder — 2º e 3º não são 'vencedores')", () => {
    const { host, root } = montar(rowSp(true, "PT"));
    disparaHoverEmSp();

    const card = host.querySelector('[data-testid="hover-card"]');
    const checks = (card?.textContent?.match(/✓/g) ?? []).length;
    expect(checks).toBe(1);

    act(() => root.unmount());
    host.remove();
  });
});
