// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.hoverOrdemPorBase.test.tsx
 *
 * 2026-09-20 — pedido do dono: "reordenar a posição dos candidatos [no balão]
 * conforme o seletor [Parcial/Projeção]". Até este commit, `buildHoverRows`
 * (`_NationalChoroplethMapImpl.tsx`) nem recebia `viewMode` — o balão listava
 * `top_candidatos` na ordem do payload (sempre por `pct_projetado`), inclusive
 * na visão "Parcial", contradizendo a cor do próprio estado que ele descreve.
 *
 * Fixture: projetado e apurado em ordem OPOSTA, de propósito — só assim um
 * teste que ignore `pct_atual` (ou que ignore `viewMode`) é discriminado.
 *
 *   id  nome  pct (projetado)  pct_atual (apurado)
 *   1   ALFA          50               5
 *   2   BETA          30              10
 *   3   GAMA          15              25
 *   4   DELTA          5              60
 *
 * `chamada: true` e `row.lider === top_candidatos[0].id === 1` (ALFA, o líder
 * PROJETADO) — o mesmo caso real de hoje (ver `lib/utils/lider-por-base.ts`).
 * O ✓ tem que seguir ALFA em QUALQUER base, mesmo quando ALFA deixa de estar
 * na posição 0 (caso da base Parcial, onde DELTA lidera o apurado).
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

const CANDIDATOS_NACIONAIS: EdgeCandidate[] = [1, 2, 3, 4].map(
  (id) =>
    ({
      id,
      nome: `Candidato ${id}`,
      partido: "PT",
      cor: "var(--color-cand-1)",
      votos_atuais: 1,
      votos_projetados: 1,
      pct_atual: 0,
      pct_projetado: 0,
      pct_projetado_lower: 0,
      pct_projetado_upper: 0,
      p_vitoria: 0,
      rank: 1,
      p_passa_2t: 0,
      p_fecha_1t: 0,
    }) as EdgeCandidate,
);

/** `top_candidatos` do enunciado do arquivo — ordem de CHEGADA é a projetada. */
function topCandidatosCompleto() {
  return [
    { id: 1, pct: 50, nome: "ALFA", partido: "PT", votos_atuais: 5, pct_atual: 5 },
    { id: 2, pct: 30, nome: "BETA", partido: "PL", votos_atuais: 10, pct_atual: 10 },
    { id: 3, pct: 15, nome: "GAMA", partido: "PSOL", votos_atuais: 25, pct_atual: 25 },
    { id: 4, pct: 5, nome: "DELTA", partido: "NOVO", votos_atuais: 60, pct_atual: 60 },
  ];
}

function rowSp(top_candidatos: EdgeUfRow["top_candidatos"]): EdgeUfRow {
  return {
    sigla: "SP",
    pct_apurado: 40,
    lider: 1,
    margem_atual: 20,
    margem_projetada: 20,
    margem_projetada_ci: [18, 22],
    chamada: true,
    swing_vs_2022: null,
    top_candidatos,
    vai_a_2t: null,
    bucket: "chamada",
  };
}

function montar(row: EdgeUfRow, viewMode?: "proj" | "parcial") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NationalChoroplethMapImpl
        candidatoAId={1}
        candidatos={CANDIDATOS_NACIONAIS}
        rows={[row]}
        view="winner"
        cargo="pres"
        viewMode={viewMode}
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

/**
 * Posição de cada um dos 4 nomes no texto do balão — `-1` se ausente.
 * Tupla de tamanho fixo (não `number[]`) para que a desestruturação nos
 * testes não caia em `number | undefined` sob `noUncheckedIndexedAccess`.
 */
function posicoes(
  card: Element | null,
  nomes: readonly [string, string, string, string],
): [number, number, number, number] {
  const texto = card?.textContent ?? "";
  return nomes.map((n) => texto.indexOf(n)) as [number, number, number, number];
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

describe("balão do mapa nacional — ordem das linhas segue o seletor Parcial/Projeção", () => {
  it('sem viewMode (default "proj") — ordem é a de `pct_projetado`: ALFA, BETA, GAMA, DELTA', () => {
    const { host, root } = montar(rowSp(topCandidatosCompleto()));
    disparaHoverEmSp();
    const card = host.querySelector('[data-testid="hover-card"]');
    const [alfa, beta, gama, delta] = posicoes(card, ["ALFA", "BETA", "GAMA", "DELTA"]);
    expect([alfa, beta, gama, delta].every((p) => p >= 0)).toBe(true);
    expect(alfa).toBeLessThan(beta);
    expect(beta).toBeLessThan(gama);
    expect(gama).toBeLessThan(delta);

    act(() => root.unmount());
    host.remove();
  });

  it('viewMode="parcial" — ordem INVERTE para `pct_atual`: DELTA, GAMA, BETA, ALFA', () => {
    const { host, root } = montar(rowSp(topCandidatosCompleto()), "parcial");
    disparaHoverEmSp();
    const card = host.querySelector('[data-testid="hover-card"]');
    const [alfa, beta, gama, delta] = posicoes(card, ["ALFA", "BETA", "GAMA", "DELTA"]);
    expect([alfa, beta, gama, delta].every((p) => p >= 0)).toBe(true);
    expect(delta).toBeLessThan(gama);
    expect(gama).toBeLessThan(beta);
    expect(beta).toBeLessThan(alfa);

    act(() => root.unmount());
    host.remove();
  });

  it('viewMode="parcial", mas falta `pct_atual` num candidato — degrada para a ordem de projeção (nunca trata o ausente como 0)', () => {
    const semUmPctAtual = topCandidatosCompleto().map((tc) =>
      tc.id === 4 ? { id: tc.id, pct: tc.pct, nome: tc.nome, partido: tc.partido } : tc,
    );
    const { host, root } = montar(rowSp(semUmPctAtual), "parcial");
    disparaHoverEmSp();
    const card = host.querySelector('[data-testid="hover-card"]');
    const [alfa, beta, gama, delta] = posicoes(card, ["ALFA", "BETA", "GAMA", "DELTA"]);
    // Mesma ordem do 1º teste (projeção): ALFA, BETA, GAMA, DELTA.
    expect(alfa).toBeLessThan(beta);
    expect(beta).toBeLessThan(gama);
    expect(gama).toBeLessThan(delta);

    act(() => root.unmount());
    host.remove();
  });

  it('o ✓ de "chamada" segue a IDENTIDADE do líder projetado (ALFA), não a posição 0 — mesmo depois de reordenar por Parcial', () => {
    const { host, root } = montar(rowSp(topCandidatosCompleto()), "parcial");
    disparaHoverEmSp();
    const card = host.querySelector('[data-testid="hover-card"]');
    const texto = card?.textContent ?? "";
    // Só uma marca — nunca vaza para quem lidera o apurado (DELTA).
    expect((texto.match(/✓/g) ?? []).length).toBe(1);
    // A marca aparece ANTES de "ALFA" no texto linear (mesma linha do nome) —
    // e depois de DELTA/GAMA/BETA, que vêm primeiro na ordem parcial.
    const posAlfa = texto.indexOf("ALFA");
    const posCheck = texto.indexOf("✓");
    expect(posCheck).toBeGreaterThanOrEqual(0);
    expect(posCheck).toBeLessThan(posAlfa);
    // E a marca vem DEPOIS de DELTA (a 1ª linha na base parcial não é a
    // marcada — só ALFA, na última posição, é).
    expect(texto.indexOf("DELTA")).toBeLessThan(posCheck);

    act(() => root.unmount());
    host.remove();
  });
});
