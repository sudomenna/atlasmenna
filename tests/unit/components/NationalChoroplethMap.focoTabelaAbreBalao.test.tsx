// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.focoTabelaAbreBalao.test.tsx
 *
 * **WCAG SC 1.4.13 (Content on Hover or Focus)** — 2026-09-20.
 *
 * ## O defeito
 *
 * O balão do mapa nacional (`<HoverCard>`) nomeia 4 candidaturas + "Outros
 * (N)" por estado desde 19/09, e só o PONTEIRO o abria: o `role="img"` do mapa
 * não tem `tabIndex`, não havia handler de teclado nenhum naquele arquivo, e o
 * `<HoverCard>` é `aria-hidden` por construção. Conteúdo disparado por hover
 * tem de estar disponível também no foco.
 *
 * O remédio não cria ponto de foco novo: as 27 células da
 * `<StateGroupedTable>` já são `<Link>` e já estão na ordem de tabulação.
 * Elas passam a emitir para o `useHoverStore` com `source: "table"` — o valor
 * que o tipo sempre teve e que nunca teve emissor — e o mapa obedece.
 *
 * ## 🔴 ARMADILHAS DE INSTRUMENTO — leia antes de mexer
 *
 * **(1) `getBoundingClientRect()` devolve TUDO ZERO no happy-dom.** O rect do
 * CONTÊINER é estubado em **800×400, NÃO-QUADRADO de propósito**.
 *
 * 🔴 **2026-09-20 — atualizado.** `flip`/`flipY` não vêm mais de "o ponteiro
 * passou da metade do contêiner?" — vêm de "o CARTÃO, do tamanho que ele TEM,
 * cabe daqui até a borda?" (`lib/utils/hover-card-placement.ts`). Por isso o
 * cartão TAMBÉM é estubado (globalmente, `beforeEach` — só existe depois do
 * 1º foco/hover, tarde demais para um estube de instância): **300×150**,
 * mesmos números de `NationalChoroplethMap.hoverFlipVertical.test.tsx`,
 * escolhidos para reproduzir exatamente a mesma tabela de `flip`/`flipY` que
 * esta suíte já travava com o proxy antigo.
 *
 * **(2) O `project()` do mapa é um ESTUBE LINEAR, não o Mercator real.**
 * `x = (lng + 74) × 16`, `y = (5 − lat) × 16` — escolhido para que três UFs
 * reais caiam em três quadrantes DIFERENTES do rect 800×400:
 *
 *   | UF | centro do bbox   | ponto projetado  | flip  | flipY |
 *   |----|------------------|------------------|-------|-------|
 *   | RS | −53,67 / −30,415 | 325,3 / 566,6    | false | true  |
 *   | PB | −36,78 /  −7,165 | 595,5 / 194,6    | true  | false |
 *   | RR | −61,855 /  1,845 | 194,3 /  50,5    | false | false |
 *
 * Três combinações distintas: um `flip` cravado, um `flipY` cravado, ou os
 * dois eixos trocados entre si reprovam em pelo menos um dos casos.
 *
 * **(3) A store é módulo-global.** `clear()` em cada `beforeEach`, senão o
 * estado de um caso vaza para o seguinte.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UF_BBOX } from "@/components/atoms/maps/_shared";
import { UfHoverLink } from "@/components/atoms/tables/UfHoverLink";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";
import { useHoverStore } from "@/lib/state/hover-store";

type Handler = (e: unknown) => void;

/** `x = (lng + 74) × 16`, `y = (5 − lat) × 16` — ver a armadilha (2). */
const FATOR = 16;
function projetar(lng: number, lat: number) {
  return { x: (lng + 74) * FATOR, y: (5 - lat) * FATOR };
}

/** Centro do bbox de uma UF — a MESMA conta que o componente faz. */
function centroBbox(sigla: string): [number, number] {
  const b = UF_BBOX[sigla];
  // Sigla fora de `UF_BBOX` é erro do TESTE, não do componente — melhor
  // estourar aqui, com o nome, do que projetar `NaN` e ver um `expect`
  // reprovar por um motivo que não é o do caso.
  if (!b) throw new Error(`UF_BBOX não tem ${sigla}`);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

const espiao = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown) => void>(),
  projectArgs: [] as Array<[number, number]>,
  filtros: [] as unknown[][],
}));

vi.mock("maplibre-gl", async () => {
  const { addZoomApi } = await import("./_fake-map-zoom");
  class FakeMap {
    cameraForBounds() {
      return { center: [-51.415, -14.24] as [number, number], zoom: 3 };
    }
    jumpTo() {}
    setPaintProperty() {}
    setFilter(_layer: string, filtro: unknown[]) {
      espiao.filtros.push(filtro);
    }
    project(lngLat: [number, number]) {
      espiao.projectArgs.push(lngLat);
      return projetar(lngLat[0], lngLat[1]);
    }
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
      if (typeof a === "function") espiao.handlers.set(event, a as Handler);
      else espiao.handlers.set(`${event}:${String(a)}`, b as Handler);
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
// Harness, não asserção — sem App Router montado `useRouter()` lança e o
// componente nem renderiza. Quem afere navegação é
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

const CANDIDATOS: EdgeCandidate[] = [
  {
    id: 13,
    nome: "FERNANDA DA SILVA",
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

function mkRow(sigla: string): EdgeUfRow {
  return {
    sigla,
    pct_apurado: 40,
    lider: 13,
    margem_atual: 10,
    margem_projetada: 10,
    margem_projetada_ci: [8, 12],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: [
      { id: 13, pct: 55, nome: "FERNANDA DA SILVA", partido: "PT" },
      { id: 22, pct: 25, nome: "ROBERTO ALMEIDA", partido: "PL" },
    ],
    vai_a_2t: null,
    bucket: "indefinido",
  };
}

const ROWS = [mkRow("RS"), mkRow("PB"), mkRow("RR")];

const RECT_W = 800;
const RECT_H = 400;

/**
 * Monta o mapa E três células de tabela na MESMA árvore — é o par real: a
 * `<StateGroupedTable>` e o mapa convivem na home (`app/(pres)/page.tsx`).
 * Os links aqui são `<UfHoverLink>` de verdade, não um `setHovered` escrito à
 * mão no teste: é o acoplamento entre os dois componentes que está em prova.
 */
function montar() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <>
        <NationalChoroplethMapImpl
          candidatoAId={13}
          candidatos={CANDIDATOS}
          rows={ROWS}
          view="winner"
          cargo="pres"
        />
        {ROWS.map((r) => (
          <UfHoverLink key={r.sigla} sigla={r.sigla} href={`/uf/${r.sigla}`}>
            {r.sigla}
          </UfHoverLink>
        ))}
      </>,
    );
  });

  const container = host.querySelector('[role="img"]') as HTMLElement;
  expect(container, "contêiner do mapa não encontrado").not.toBeNull();
  container.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: RECT_W,
      height: RECT_H,
      right: RECT_W,
      bottom: RECT_H,
      toJSON: () => ({}),
    }) as DOMRect;
  // Controle do instrumento — ver armadilha (1).
  expect(container.getBoundingClientRect().height).toBe(RECT_H);

  return { host, root };
}

function link(host: HTMLElement, sigla: string): HTMLElement {
  const el = host.querySelector(`a[href="/uf/${sigla}"]`) as HTMLElement;
  expect(el, `link de ${sigla} não encontrado`).not.toBeNull();
  return el;
}

/** React 17+ ouve `focusin`/`focusout`, não `focus`/`blur` (que não borbulham). */
function focar(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
}
function desfocar(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}
function teclar(el: HTMLElement, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function card(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[data-testid="hover-card"]');
}

function hoverMouse(sigla: string, clientX: number, clientY: number) {
  const onMouseMove = espiao.handlers.get("mousemove:ufs-fill");
  expect(onMouseMove, "handler de mousemove não foi registrado").toBeDefined();
  act(() => {
    onMouseMove?.({
      features: [{ properties: { SIGLA_UF: sigla } }],
      originalEvent: { clientX, clientY },
    });
  });
}

/** Tamanho estubado do CARTÃO — ver a nota de 2026-09-20 no cabeçalho. */
const CARD_W = 300;
const CARD_H = 150;

const getBoundingClientRectOriginal = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  espiao.handlers.clear();
  espiao.projectArgs.length = 0;
  espiao.filtros.length = 0;
  useHoverStore.getState().clear();
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: CARD_W,
      height: CARD_H,
      right: CARD_W,
      bottom: CARD_H,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

afterEach(() => {
  useHoverStore.getState().clear();
  document.body.innerHTML = "";
  HTMLElement.prototype.getBoundingClientRect = getBoundingClientRectOriginal;
});

describe("foco de teclado na tabela abre o balão do mapa (SC 1.4.13)", () => {
  it("🔴 FOCO abre o balão, no estado certo [mutação: remover o `onFocus` de <UfHoverLink>]", () => {
    const { host, root } = montar();
    expect(card(host), "o balão já estava aberto antes do foco").toBeNull();

    focar(link(host, "RS"));

    const el = card(host);
    expect(el, "o foco não abriu o balão").not.toBeNull();
    expect(el?.textContent).toContain("Rio Grande do Sul (RS)");
    // As candidaturas que só o mouse alcançava.
    expect(el?.textContent).toContain("FERNANDA DA SILVA");
    expect(el?.textContent).toContain("ROBERTO ALMEIDA");

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 o estado ACENDE no mapa junto com o balão", () => {
    const { host, root } = montar();
    focar(link(host, "PB"));

    expect(espiao.filtros).toContainEqual(["==", "SIGLA_UF", "PB"]);

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 a âncora é a GEOMETRIA DA UF, não o ponteiro nem o canto [mutação: x/y cravados]", () => {
    const { host, root } = montar();
    focar(link(host, "RS"));

    // (a) o mapa foi consultado com o centro do bbox de RS — se alguém
    //     ancorar na última posição do cursor, ou no canto, não há chamada
    //     nenhuma a `project` e este expect cai primeiro.
    const [lng, lat] = centroBbox("RS");
    expect(
      espiao.projectArgs,
      "`project` não foi chamado — o balão não foi ancorado na UF",
    ).toEqual([[lng, lat]]);

    // (b) e o cartão saiu EXATAMENTE onde `project` disse.
    const esperado = projetar(lng, lat);
    const el = card(host) as HTMLElement;
    expect(parseFloat(el.style.left)).toBeCloseTo(esperado.x, 6);
    expect(parseFloat(el.style.top)).toBeCloseTo(esperado.y, 6);

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 três UFs, três quadrantes — `flip` e `flipY` são independentes [mutação: copiar o predicado horizontal]", () => {
    // RS: metade esquerda + metade de baixo  ⇒ false / true
    // PB: metade DIREITA + metade de cima    ⇒ true  / false
    // RR: metade esquerda + metade de cima   ⇒ false / false
    for (const [sigla, flip, flipY] of [
      ["RS", "false", "true"],
      ["PB", "true", "false"],
      ["RR", "false", "false"],
    ] as const) {
      const { host, root } = montar();
      focar(link(host, sigla));
      const el = card(host);
      expect(el, `${sigla}: balão não abriu`).not.toBeNull();
      expect(el?.getAttribute("data-flip"), `${sigla}: flip`).toBe(flip);
      expect(el?.getAttribute("data-flip-y"), `${sigla}: flipY`).toBe(flipY);
      act(() => root.unmount());
      host.remove();
      espiao.handlers.clear();
      useHoverStore.getState().clear();
    }
  });

  it("🔴 BLUR fecha o balão e apaga o destaque", () => {
    const { host, root } = montar();
    const el = link(host, "RS");
    focar(el);
    expect(card(host)).not.toBeNull();

    desfocar(el);
    expect(card(host), "o balão sobreviveu à saída do foco").toBeNull();
    expect(espiao.filtros.at(-1)).toEqual(["==", "SIGLA_UF", ""]);

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 ESCAPE fecha o balão sem tirar o foco do link (SC 1.4.13 — dispensável)", () => {
    const { host, root } = montar();
    const el = link(host, "RS");
    focar(el);
    expect(card(host)).not.toBeNull();

    teclar(el, "Escape");
    expect(card(host), "Escape não fechou o balão").toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it("outra tecla NÃO fecha [mutação: fechar em qualquer keydown]", () => {
    const { host, root } = montar();
    const el = link(host, "RS");
    focar(el);
    teclar(el, "ArrowDown");
    expect(card(host), "uma tecla qualquer fechou o balão").not.toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it("tabular de uma UF para a próxima TROCA o balão, não o apaga", () => {
    const { host, root } = montar();
    // A ordem real do React: blur(A) → focus(B).
    const a = link(host, "RS");
    focar(a);
    desfocar(a);
    focar(link(host, "PB"));

    const el = card(host);
    expect(el, "o balão sumiu ao tabular para a próxima UF").not.toBeNull();
    expect(el?.textContent).toContain("Paraíba (PB)");

    act(() => root.unmount());
    host.remove();
  });
});

describe("o caminho do MOUSE não regride", () => {
  it("hover de ponteiro continua abrindo o balão pelo ponteiro (não pela geometria)", () => {
    const { host, root } = montar();
    hoverMouse("RS", 100, 300);

    const el = card(host) as HTMLElement;
    expect(el, "o hover de mouse parou de abrir o balão").not.toBeNull();
    // Ancorado no CURSOR: 100/300, e não no ponto projetado de RS (325/567).
    expect(parseFloat(el.style.left)).toBe(100);
    expect(parseFloat(el.style.top)).toBe(300);
    expect(espiao.projectArgs, "o caminho do mouse não deve consultar `project`").toEqual([]);

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 sair do foco da tabela com o PONTEIRO já sobre o mapa não apaga o balão do mouse", () => {
    // A corrida que `origemTooltipRef` existe para tratar: o `mousemove`
    // escreve `source: "map"` na store, o selector do mapa resolve para
    // `null`, e um efeito ingênuo leria isso como "a tabela pediu para
    // fechar" — apagando o balão que o ponteiro acabou de abrir.
    const { host, root } = montar();
    const a = link(host, "RS");
    focar(a);
    hoverMouse("PB", 700, 100);
    desfocar(a);

    const el = card(host);
    expect(el, "o balão do ponteiro foi apagado pela saída de foco da tabela").not.toBeNull();
    expect(el?.textContent).toContain("Paraíba (PB)");

    act(() => root.unmount());
    host.remove();
  });
});
