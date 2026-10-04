// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.hoverOutros.test.tsx
 *
 * 2026-09-19 (pedido do dono) — o balão do mapa NACIONAL mostra 4
 * candidaturas mais uma linha com o agregado de todo o resto.
 *
 * O dado já vem pronto do produtor: `EdgeUfRow.top_candidatos` passou de 3
 * para 4 entradas e ganhou um campo IRMÃO, `EdgeUfRow.outros`
 * (`api/model/project.py`, `TOP_CANDIDATOS_POR_UF`). O que estes testes
 * travam é o lado da TELA — `buildHoverRows` em
 * `components/blocks/_NationalChoroplethMapImpl.tsx`:
 *
 *   (a) `outros` presente ⇒ 5 linhas, a última "Outros (N)";
 *   (b) 🔴 **o cruzamento `pct` ↔ `proj`** — no payload `pct` é a PROJEÇÃO e
 *       `pct_atual` é a PARCIAL; no `HoverCardRow` é o CONTRÁRIO. Trocar os
 *       dois mostra um número plausível na coluna errada, sem nenhum
 *       sintoma visual;
 *   (c) `pct_atual` ausente ⇒ a Parcial de "Outros" é "—", **e as quatro
 *       linhas de cima seguem com número** (a ausência é da cauda, não da
 *       UF — "não sabemos" e "medimos zero" são estados diferentes, decisão
 *       do dono de 14/09);
 *   (d) `outros` ausente ⇒ 4 linhas e nenhuma menção a "Outros" (cauda vazia
 *       não é "os demais somam 0%");
 *   (e) `chamada: true` não marca a linha "Outros" como vencedora.
 *
 * 🔴 **Por que o payload é construído à mão e não vem de
 * `tests/fixtures/simulacao/`.** A fixture do simulado preenche `nome` em
 * TODO cargo; produção escreve `"Candidato {id}"` em cargo 3/5. Uma linha
 * "Outros" que caísse por engano no caminho de resolução de identidade (em
 * vez de receber o rótulo pronto) passaria despercebida no `pnpm dev:sim` e
 * em qualquer teste montado sobre aquela fixture. Aqui o rótulo esperado é
 * literal, e o teste (a) checa que nem "Candidato" nem "#" aparecem.
 *
 * Harness: MapLibre falso de
 * `NationalChoroplethMap.hoverIdentidadePorUf.test.tsx` — o hover real do
 * produto, não uma chamada direta a `buildHoverRows` (que não é exportada, de
 * propósito, como as demais funções internas deste arquivo).
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
    nome: "FERNANDA DA SILVA",
    partido: "PT",
    cor: "var(--color-cand-1)",
    votos_atuais: 1,
    votos_projetados: 1,
    pct_atual: 40,
    pct_projetado: 40,
    pct_projetado_lower: 38,
    pct_projetado_upper: 42,
    p_vitoria: 0.8,
    rank: 1,
    p_passa_2t: 0.9,
    p_fecha_1t: 0,
  },
];

/** As QUATRO candidaturas nomeadas — `pct` (projeção) e `pct_atual`
 * (parcial) deliberadamente DISTANTES em cada linha, para que uma troca de
 * colunas não sobreviva por semelhança de valores. */
const TOP_4: EdgeUfRow["top_candidatos"] = [
  {
    id: 13,
    pct: 40.0,
    pct_atual: 30.0,
    nome: "FERNANDA DA SILVA",
    partido: "PT",
    votos_atuais: 30,
  },
  { id: 22, pct: 30.0, pct_atual: 40.0, nome: "JOÃO DE SOUZA", partido: "PL", votos_atuais: 40 },
  { id: 33, pct: 15.0, pct_atual: 20.0, nome: "MARIA LIMA", partido: "PSOL", votos_atuais: 20 },
  { id: 44, pct: 5.1, pct_atual: 6.7, nome: "CARLOS ROCHA", partido: "PSD", votos_atuais: 7 },
];

function row(over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla: "SP",
    pct_apurado: 40,
    lider: 13,
    margem_atual: 10,
    margem_projetada: 10,
    margem_projetada_ci: [8, 12],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: TOP_4,
    vai_a_2t: null,
    bucket: "indefinido",
    ...over,
  };
}

function montar(r: EdgeUfRow) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NationalChoroplethMapImpl
        candidatoAId={13}
        candidatos={CANDIDATOS_NACIONAIS}
        rows={[r]}
        view="winner"
        cargo="gov"
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

function nomes(host: HTMLElement): (string | null)[] {
  return Array.from(host.querySelectorAll(".overflow-hidden.text-ellipsis")).map(
    (e) => e.textContent,
  );
}

function celulas(host: HTMLElement, testid: string): (string | null)[] {
  return Array.from(host.querySelectorAll(`[data-testid='${testid}']`)).map((e) => e.textContent);
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

describe("hover do mapa nacional — a linha Outros (2026-09-19)", () => {
  it("(a) com `outros`, o balão tem 5 linhas e a última é 'Outros (3)' [mutação: apagar o `linhas.push(...)` de `buildHoverRows`]", () => {
    const { host, root } = montar(row({ outros: { pct: 9.9, pct_atual: 3.3, n_candidatos: 3 } }));
    disparaHoverEmSp();

    const lista = nomes(host);
    expect(lista).toHaveLength(5);
    expect(lista[4]).toBe("Outros (3)");
    // O rótulo é montado do `n_candidatos`, não resolvido contra lista de
    // candidatos nenhuma — o agregado não tem `id` de urna nem `sqcand`.
    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card?.textContent).not.toContain("Candidato");
    expect(card?.textContent).not.toContain("#");

    act(() => root.unmount());
    host.remove();
  });

  it("(b) 🔴 Proj. lê `outros.pct` e Parcial lê `outros.pct_atual` — os nomes são TROCADOS entre payload e componente [mutação: `pct: outros.pct` / `proj: outros.pct_atual`]", () => {
    // 9,9 e 3,3 são distantes de propósito: com valores próximos a troca
    // sobreviveria ao teste, que é como este tipo de defeito costuma passar.
    const { host, root } = montar(row({ outros: { pct: 9.9, pct_atual: 3.3, n_candidatos: 3 } }));
    disparaHoverEmSp();

    expect(celulas(host, "hover-card-proj")[4]).toBe("9,9%");
    expect(celulas(host, "hover-card-parcial")[4]).toBe("3,3%");
    // Controle: as quatro de cima também cruzam na mesma direção (a linha de
    // "Outros" copia o cruzamento delas, não inventa um próprio).
    expect(celulas(host, "hover-card-proj").slice(0, 4)).toEqual([
      "40,0%",
      "30,0%",
      "15,0%",
      "5,1%",
    ]);
    expect(celulas(host, "hover-card-parcial").slice(0, 4)).toEqual([
      "30,0%",
      "40,0%",
      "20,0%",
      "6,7%",
    ]);

    act(() => root.unmount());
    host.remove();
  });

  it("(c) `pct_atual` ausente ⇒ Parcial de Outros é '—', e as quatro acima seguem com número [mutação: `pct: outros.pct_atual ?? 0` — o zero de resgate que a decisão de 14/09 proíbe]", () => {
    const { host, root } = montar(row({ outros: { pct: 9.9, n_candidatos: 3 } }));
    disparaHoverEmSp();

    const parcial = celulas(host, "hover-card-parcial");
    expect(parcial[4]).toBe("—");
    // 🔴 A metade que discrimina: a ausência é da CAUDA, não da UF. Uma
    // implementação que derrubasse a coluna inteira (ou que zerasse as
    // quatro) passaria no `expect` de cima e estaria errada.
    expect(parcial.slice(0, 4)).toEqual(["30,0%", "40,0%", "20,0%", "6,7%"]);
    // E a projeção da cauda continua lá — os dois campos são independentes.
    expect(celulas(host, "hover-card-proj")[4]).toBe("9,9%");

    act(() => root.unmount());
    host.remove();
  });

  it("(d) sem `outros`, são 4 linhas e a palavra 'Outros' não aparece [mutação: `if (outros)` → `if (true)`, ou um objeto zerado de resgate]", () => {
    const { host, root } = montar(row());
    disparaHoverEmSp();

    expect(nomes(host)).toHaveLength(4);
    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card).not.toBeNull();
    // "Outros 0,0%" numa corrida de quatro seria uma linha falsa: campo
    // ausente significa "a cauda é vazia", não "os demais somam zero".
    expect(card?.textContent).not.toContain("Outros");

    act(() => root.unmount());
    host.remove();
  });

  // 🔴 2026-10-04 — a marca vem de `eleitos_definidos` (matematicamente
  // eleito), não mais de `chamada`; a garantia sobre "Outros" é a mesma.
  it("(e) eleito definido marca só a linha 0 — nunca a de Outros [mutação: apagar `!isOutros` da guarda `isCalledWinner` em HoverCard.tsx]", () => {
    const { host, root } = montar(
      row({
        chamada: true,
        eleitos_definidos: [13],
        outros: { pct: 9.9, pct_atual: 3.3, n_candidatos: 3 },
      }),
    );
    disparaHoverEmSp();

    const linhas = Array.from(host.querySelectorAll(".flex.min-w-0.items-center"));
    expect(linhas).toHaveLength(5);
    // ✓ na líder…
    expect(linhas[0]?.textContent).toContain("✓");
    // …e em mais nenhuma, a de "Outros" inclusive (um agregado de
    // candidaturas não vence eleição — constituição § 1).
    expect(linhas.slice(1).some((l) => l.textContent?.includes("✓"))).toBe(false);
    expect(linhas[4]?.getAttribute("style")).not.toContain("font-weight:600");

    act(() => root.unmount());
    host.remove();
  });
});
