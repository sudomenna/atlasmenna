// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.preEleicao.test.tsx — RF-157.
 *
 * Dois testes, e eles medem coisas diferentes de propósito:
 *
 * **M8 — comportamento.** A matriz completa `{proj, parcial} × {winner,
 * margin, swing}`: em fase pré, as **27 UFs** saem `--map-uncounted` nas seis
 * combinações. A guarda que existia antes desta spec cobria UMA delas
 * (`parcial` + zero apurado) e sumia nas outras cinco — é exatamente esse o
 * defeito, e um teste que só exercitasse o default (`proj` + `winner`) o
 * repetiria deslocado.
 *
 * **M9 — posição.** A guarda está **antes** da linha que lê
 * `top_candidatos[0]` e antes do `switch`. Este é um teste sobre o **fonte**,
 * e é deliberado: o comportamento de hoje passa com a guarda em qualquer lugar
 * que dê o mesmo resultado; o que o RF-157 protege é contra o refactor de
 * amanhã, que reordena os ramos e reintroduz a cor sem tocar na guarda.
 *
 * ## Como a cor é medida
 *
 * `applyColors` grava uma expression `["match", ["get","SIGLA_UF"], "SP", cor,
 * …, fallback]` via `setPaintProperty`. O teste monta o componente com o
 * MapLibre falso, dispara o `load`, e lê a expression — o efeito observável, e
 * não a intenção do código.
 *
 * Os tokens de cor são injetados em `:root` no teste: sem eles, `resolveCandHex`
 * devolve `""` e `--map-uncounted` cai no literal `#e1e4e8`, e as seis
 * combinações ficariam indistinguíveis umas das outras — o teste passaria sem
 * discriminar nada.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";
import { porUfApurado, SIGLAS_27 } from "@/tests/fixtures/spec-019/payloads";

// ---------------------------------------------------------------------------
// MapLibre falso
// ---------------------------------------------------------------------------

type PaintCall = [layer: string, prop: string, valor: unknown];

/**
 * `vi.mock` é içado para o topo do arquivo, então o estado compartilhado com a
 * fábrica precisa de `vi.hoisted` — senão a classe falsa ainda não existe
 * quando o módulo mockado é construído.
 */
const espiao = vi.hoisted(() => ({
  paint: [] as Array<[string, string, unknown]>,
  load: [] as Array<() => void>,
}));

const paintCalls = espiao.paint as PaintCall[];

vi.mock("maplibre-gl", async () => {
  const { addZoomApi } = await import("./_fake-map-zoom");
  class FakeMap {
    setPaintProperty(layer: string, prop: string, valor: unknown) {
      espiao.paint.push([layer, prop, valor]);
    }
    on(evento: string, a: unknown, b?: unknown) {
      const cb = (typeof a === "function" ? a : b) as (() => void) | undefined;
      if (evento === "load" && cb) espiao.load.push(cb);
    }
    setFilter() {}
    getCanvas() {
      return {
        style: {},
        width: 428,
        height: 467,
        setAttribute() {},
        removeAttribute() {},
        tabIndex: 0,
      };
    }
    isStyleLoaded() {
      return true;
    }
    loaded() {
      return true;
    }
    remove() {}
    // `computeFrameCamera` (2026-09-14, ver `_NationalChoroplethMapImpl.tsx`)
    // chama os dois logo após o construtor — sem eles aqui o `mount()` inteiro
    // lança `TypeError` antes de chegar no `load`, e os 4 testes abaixo falham
    // por um motivo que não tem nada a ver com o que eles medem (RF-157).
    cameraForBounds() {
      return { center: [-51.415, -14.24] as [number, number], zoom: 3 };
    }
    jumpTo() {}
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

// ---------------------------------------------------------------------------
// Tokens — sem eles nada discrimina
// ---------------------------------------------------------------------------

const NEUTRA = "#e1e4e8";

const TOKENS: Record<string, string> = {
  "--map-uncounted": NEUTRA,
  "--map-stroke": "#fbfbfc",
  "--map-stroke-focus": "#14171b",
  "--color-tossup": "#d9d9d9",
  "--color-band-likely": "#c8b98a",
  "--color-band-very_likely": "#b3a066",
  "--color-band-lean": "#9fb0c8",
  "--party-pt": "#c0392b",
  "--party-pt-1": "#f2d7d5",
  "--party-pt-2": "#e6b0aa",
  "--party-pt-3": "#d98880",
  "--party-pt-4": "#c0392b",
  "--party-pt-5": "#922b21",
  "--party-pl": "#2471a3",
  "--party-pl-1": "#d4e6f1",
  "--party-pl-2": "#a9cce3",
  "--party-pl-3": "#7fb3d5",
  "--party-pl-4": "#2471a3",
  "--party-pl-5": "#1a5276",
  "--color-cand-1": "#111111",
  "--color-cand-2": "#222222",
  "--color-cand-other": "#333333",
  "--color-cand-band-1": "#444444",
  "--color-cand-band-2": "#555555",
  "--color-cand-band-other": "#666666",
};

const CANDIDATOS: EdgeCandidate[] = [
  { id: 13, nome: "CANDIDATA TREZE", partido: "PT" },
  { id: 22, nome: "CANDIDATO VINTE E DOIS", partido: "PL" },
].map(
  (c) =>
    ({
      ...c,
      cor: "var(--color-cand-1)",
      votos_atuais: 1,
      votos_projetados: 1,
      pct_atual: 50,
      pct_projetado: 50,
      pct_projetado_lower: 49,
      pct_projetado_upper: 51,
      p_vitoria: 0.5,
      rank: 1,
      p_passa_2t: 0.5,
      p_fecha_1t: 0.5,
    }) as EdgeCandidate,
);

const RANK_BY_LIDER = { 13: 1, 22: 2 };

const VIEWS = ["winner", "margin", "swing"] as const;
const VIEW_MODES = ["proj", "parcial"] as const;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Montagem {
  rows: EdgeUfRow[];
  view: (typeof VIEWS)[number];
  viewMode: (typeof VIEW_MODES)[number];
  preEleicao: boolean;
}

/** Cores atribuídas por UF na última chamada de `setPaintProperty`. */
function pintar({ rows, view, viewMode, preEleicao }: Montagem): Map<string, string> {
  paintCalls.length = 0;
  espiao.load.length = 0;

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <NationalChoroplethMapImpl
        candidatoAId={13}
        candidatos={CANDIDATOS}
        preEleicao={preEleicao}
        rankByLider={RANK_BY_LIDER}
        rows={rows}
        view={view}
        viewMode={viewMode}
      />,
    );
  });

  // O `load` do MapLibre é o único caminho pelo qual a PRIMEIRA pintura
  // acontece — e é o caminho que o `preEleicaoRef` atravessa.
  act(() => {
    for (const cb of espiao.load) cb();
  });

  const ultima = paintCalls.filter(([l, p]) => l === "ufs-fill" && p === "fill-color").at(-1);
  expect(ultima, "o mapa não chegou a pintar").toBeDefined();

  const expression = ultima?.[2] as unknown[];
  expect(Array.isArray(expression)).toBe(true);
  // ["match", ["get","SIGLA_UF"], sigla, cor, …, fallback]
  const cores = new Map<string, string>();
  for (let i = 2; i < expression.length - 1; i += 2) {
    cores.set(String(expression[i]), String(expression[i + 1]));
  }

  act(() => root.unmount());
  host.remove();
  return cores;
}

beforeEach(() => {
  for (const [k, v] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(k, v);
  }
  // Sem este stub, `window.matchMedia` não existe em happy-dom e a montagem
  // do mapa lança antes de qualquer asserção.
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  for (const k of Object.keys(TOKENS)) document.documentElement.style.removeProperty(k);
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// M8 — a matriz completa
// ---------------------------------------------------------------------------

describe("RF-157 — mapa em fase pré", () => {
  it("🔴 (controle) em modo NORMAL as seis combinações pintam com cor de identidade", () => {
    // Este é o controle que torna o teste seguinte capaz de discriminar: se as
    // seis combinações já saíssem neutras sem a guarda, o M8 passaria com a
    // guarda removida.
    const rows = porUfApurado();
    for (const viewMode of VIEW_MODES) {
      for (const view of VIEWS) {
        const cores = pintar({ rows, view, viewMode, preEleicao: false });
        const naoNeutras = [...cores.values()].filter((c) => c !== NEUTRA);
        expect(naoNeutras.length, `${viewMode}/${view}`).toBe(27);
      }
    }
  });

  it("🔴 (M8) em fase pré as 27 UFs saem `--map-uncounted` nas SEIS combinações", () => {
    const rows = porUfApurado();
    for (const viewMode of VIEW_MODES) {
      for (const view of VIEWS) {
        const cores = pintar({ rows, view, viewMode, preEleicao: true });
        expect([...cores.keys()].sort(), `${viewMode}/${view}`).toEqual([...SIGLAS_27].sort());
        for (const [sigla, cor] of cores) {
          expect(cor, `${viewMode}/${view} — ${sigla}`).toBe(NEUTRA);
        }
      }
    }
  });

  it("a guarda antiga (`parcial` + 0% apurado) continua valendo em fase normal", () => {
    // Esta spec ACRESCENTA uma guarda; não substitui a que existe.
    const rows = porUfApurado().map((r) => ({ ...r, pct_apurado: 0 }));
    const cores = pintar({ rows, view: "winner", viewMode: "parcial", preEleicao: false });
    for (const [sigla, cor] of cores) expect(cor, sigla).toBe(NEUTRA);

    // E em `proj` ela NÃO vale — é o defeito #8 da tabela de mentiras, que
    // continua existindo em modo normal e que só a fase pré neutraliza.
    const emProj = pintar({ rows, view: "winner", viewMode: "proj", preEleicao: false });
    expect([...emProj.values()].every((c) => c === NEUTRA)).toBe(false);
  });

  it("o `aria-label` do mapa não contém a palavra proibida em fase pré (RF-161)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <NationalChoroplethMapImpl
          candidatoAId={13}
          candidatos={CANDIDATOS}
          preEleicao
          rankByLider={RANK_BY_LIDER}
          rows={porUfApurado()}
          view="winner"
        />,
      );
    });
    const rotulo = host.querySelector('[role="img"]')?.getAttribute("aria-label") ?? "";
    expect(rotulo.toLowerCase()).not.toContain("projeç");
    expect(rotulo).toContain("27 unidades federativas");
    act(() => root.unmount());
  });
});

// ---------------------------------------------------------------------------
// M9 — a posição da guarda no fonte
// ---------------------------------------------------------------------------

describe("RF-157 — (M9) a guarda está na PRIMEIRA linha de `resolveColor`", () => {
  const RAIZ = new URL("../../..", import.meta.url).pathname.replace(/^\/@fs/, "");
  const FONTE = readFileSync(
    join(RAIZ, "components/blocks/_NationalChoroplethMapImpl.tsx"),
    "utf8",
  );

  const linhas = FONTE.split("\n");
  const iAssinatura = linhas.findIndex((l) => l.includes("function resolveColor("));
  const corpo = linhas.slice(iAssinatura);

  const indiceDe = (predicado: (l: string) => boolean, rotulo: string) => {
    const i = corpo.findIndex(predicado);
    expect(i, `não achei ${rotulo} dentro de resolveColor`).toBeGreaterThan(-1);
    return i;
  };

  it("vem antes da linha que resolve `liderId` a partir de `top_candidatos[0]`", () => {
    const guarda = indiceDe((l) => /if\s*\(preEleicao\)\s*return/.test(l), "a guarda");
    const lider = indiceDe((l) => l.includes("const liderId ="), "`const liderId =`");
    expect(guarda).toBeLessThan(lider);
  });

  it("vem antes do `switch (view)` e antes de qualquer leitura de `viewMode`", () => {
    const guarda = indiceDe((l) => /if\s*\(preEleicao\)\s*return/.test(l), "a guarda");
    expect(guarda).toBeLessThan(indiceDe((l) => l.includes("switch (view)"), "o switch"));
    expect(guarda).toBeLessThan(
      indiceDe((l) => l.includes('const parcial = viewMode === "parcial"'), "`const parcial =`"),
    );
  });

  it("é a primeira instrução do corpo — nada executa antes dela", () => {
    // Abre o corpo na linha `): string {`; a primeira linha seguinte que não é
    // branca nem comentário tem de ser a guarda.
    const iAbre = indiceDe(
      (l) => l.trim().startsWith(")") && l.includes("{"),
      "a abertura do corpo",
    );
    const primeira = corpo
      .slice(iAbre + 1)
      .find((l) => l.trim() !== "" && !/^\s*(\/\/|\/\*|\*)/.test(l));
    expect(primeira ?? "").toMatch(/if\s*\(preEleicao\)\s*return/);
  });
});
