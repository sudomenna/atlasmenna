// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.hoverNaoCortaJanelaEstreita.test.tsx
 *
 * 2026-09-20 (medição do dono, no Chrome, `/` com `pnpm dev:sim`) — a
 * **1024px de largura de janela**, o balão do mapa (`<HoverCard>`) era
 * cortado pela borda direita: RS media contêiner 624px, cartão 363px, x do
 * ponteiro relativo ao contêiner ≈294 — abaixo da metade do contêiner (312),
 * o proxy antigo (`flip: x > rect.width / 2`) respondia "não vira" e o
 * cartão transbordava ~45-53px.
 *
 * Este arquivo prova que o remédio (`computeHoverCardPlacement`,
 * `lib/utils/hover-card-placement.ts`) resolve os DOIS caminhos de abertura
 * do balão (mouse E teclado — item de aceitação do dono) e não regride numa
 * janela larga (1280px), onde o cartão sempre coube.
 *
 * 🔴 Mesma armadilha de instrumento das outras suítes deste diretório:
 * `getBoundingClientRect()` devolve tudo zero no happy-dom, e por isso TANTO
 * o contêiner QUANTO o cartão precisam de estube — ver
 * `NationalChoroplethMap.hoverFlipVertical.test.tsx` para a explicação longa.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UfHoverLink } from "@/components/atoms/tables/UfHoverLink";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";
import { useHoverStore } from "@/lib/state/hover-store";

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
    // 🔴 Estube LINEAR — não precisa ser o Mercator real, só devolver um
    // ponto determinístico para o caminho de TECLADO (`focoTabelaAbreBalao`
    // usa a mesma técnica, com outra fórmula). Aqui a fórmula devolve
    // exatamente `x=294` para o centro do bbox de RS, reproduzindo o número
    // medido pelo dono no navegador real.
    project(_lngLat: [number, number]) {
      return { x: 294, y: 100 };
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
// Harness, não asserção — ver a mesma nota nas suítes-irmãs deste diretório.
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
    top_candidatos: [{ id: 13, pct: 55, nome: "FERNANDA DA SILVA", partido: "PT" }],
    vai_a_2t: null,
    bucket: "indefinido",
  };
}

const ROWS = [mkRow("RS")];

/** Número REAL medido pelo dono a 1024px de janela: o contêiner do mapa
 * mede 624px de largura (o mapa não ocupa a janela inteira — divide espaço
 * com o resto do layout). */
const CONTAINER_W_1024 = 624;
const CONTAINER_H = 500;

/** Cartão REAL medido pelo dono para RS, na mesma janela. */
const CARD_W = 363;
const CARD_H = 90;

/** `x` do ponteiro sobre RS, relativo ao CONTÊINER (não à janela) — também
 * medido pelo dono. Está ENTRE a metade do proxy antigo (312) e o ponto real
 * de transbordo (`624 − 363 − 12 = 249`): é exatamente essa faixa que o
 * proxy antigo errava. */
const X_PONTEIRO_RS = 294;

function domRect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  } as DOMRect;
}

const getBoundingClientRectOriginal = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  espiao.handlers.clear();
  useHoverStore.getState().clear();
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
  // Estube GLOBAL — cobre o nó do `<HoverCard>` (só existe depois do 1º
  // hover/foco).
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return domRect(CARD_W, CARD_H);
  };
});

afterEach(() => {
  useHoverStore.getState().clear();
  document.body.innerHTML = "";
  HTMLElement.prototype.getBoundingClientRect = getBoundingClientRectOriginal;
});

function montar(containerWidth: number) {
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
        <UfHoverLink sigla="RS" href="/uf/RS">
          RS
        </UfHoverLink>
      </>,
    );
  });

  const container = host.querySelector('[role="img"]') as HTMLElement;
  expect(container, "contêiner do mapa não encontrado").not.toBeNull();
  container.getBoundingClientRect = () => domRect(containerWidth, CONTAINER_H);
  expect(container.getBoundingClientRect().width).toBe(containerWidth);

  return { host, root };
}

function card(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[data-testid="hover-card"]');
}

/** Reconstrói as duas bordas do cartão a partir do `x` que o componente
 * escreveu no `style.left` — mesma fórmula do `transform` de `HoverCard.tsx`
 * (`translate(12px, …)` sem flip, `translate(calc(-100% - 12px), …)` com
 * flip). É essa reconstrução, não um número mágico, que prova "dentro da
 * janela". */
function bordas(el: HTMLElement, cardWidth: number) {
  const x = Number.parseFloat(el.style.left);
  const flip = el.getAttribute("data-flip") === "true";
  const esquerda = flip ? x - 12 - cardWidth : x + 12;
  const direita = esquerda + cardWidth;
  return { esquerda, direita };
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

function focarRS(host: HTMLElement) {
  const link = host.querySelector('a[href="/uf/RS"]') as HTMLElement;
  expect(link, "link de RS não encontrado").not.toBeNull();
  act(() => {
    link.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
}

describe("o balão de RS não é cortado a 1024px de janela — mouse e teclado [RNF-023/RF-030.3]", () => {
  it("🔴 MOUSE — RS a 1024px: o cartão inteiro fica dentro do contêiner [mutação: reintroduzir `x > containerWidth / 2`]", () => {
    const { host, root } = montar(CONTAINER_W_1024);
    hoverMouse("RS", X_PONTEIRO_RS, 100);

    const el = card(host) as HTMLElement;
    expect(el, "o balão não abriu no hover de RS").not.toBeNull();
    const { esquerda, direita } = bordas(el, CARD_W);
    expect(esquerda).toBeGreaterThanOrEqual(0);
    expect(direita).toBeLessThanOrEqual(CONTAINER_W_1024);

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 TECLADO — Tab até a célula de RS: o mesmo cartão, dentro do contêiner [SC 1.4.13 + o defeito de 1024px]", () => {
    const { host, root } = montar(CONTAINER_W_1024);
    focarRS(host);

    const el = card(host) as HTMLElement;
    expect(el, "o balão não abriu no foco de RS").not.toBeNull();
    const { esquerda, direita } = bordas(el, CARD_W);
    expect(esquerda).toBeGreaterThanOrEqual(0);
    expect(direita).toBeLessThanOrEqual(CONTAINER_W_1024);

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 SEGUNDO hover na MESMA UF (cartão já medido): a decisão do PRÓPRIO `mousemove` usa o cartão real, não o proxy [mutação: reverter o cálculo do `onMouseMove` para `x > rect.width / 2`]", () => {
    // O `useLayoutEffect` de correção só reexecuta quando o CONTEÚDO do
    // balão muda (`tooltip?.row`) — dentro da MESMA UF ele não roda de novo
    // (ver a docstring dele em `_NationalChoroplethMapImpl.tsx`). Então, a
    // partir do 2º `mousemove` sobre RS, quem decide `flip`/`x` é SÓ a
    // aritmética do próprio handler (`cardSizeRef.current`, já atualizado
    // pela 1ª correção) — nunca mais o `useLayoutEffect`. Este teste isola
    // exatamente essa aritmética: se ela regredisse para o proxy antigo,
    // a 1ª correção já teria deixado `cardSizeRef` com o valor real (363),
    // e MESMO ASSIM o 2º hover erraria, porque o proxy não usa
    // `cardSizeRef` nenhum.
    vi.useFakeTimers();
    try {
      const { host, root } = montar(CONTAINER_W_1024);
      hoverMouse("RS", X_PONTEIRO_RS, 100); // 1ª: guess + correção síncrona
      vi.advanceTimersByTime(20); // > 16ms — o throttle libera o 2º disparo
      hoverMouse("RS", X_PONTEIRO_RS, 100); // 2ª: SÓ o handler decide

      const el = card(host) as HTMLElement;
      const { esquerda, direita } = bordas(el, CARD_W);
      expect(esquerda).toBeGreaterThanOrEqual(0);
      expect(direita).toBeLessThanOrEqual(CONTAINER_W_1024);

      act(() => root.unmount());
      host.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("regressão — o MESMO x, numa janela LARGA (1280px): não vira à toa [mutação: cair sempre no ramo 'nem virando cabe']", () => {
    // Contêiner mais largo (janela 1280px) — o cartão cabe folgado sem virar
    // e sem clamp: 294+12+363=669 <= 900.
    const { host, root } = montar(900);
    hoverMouse("RS", X_PONTEIRO_RS, 100);

    const el = card(host) as HTMLElement;
    expect(el?.getAttribute("data-flip")).toBe("false");
    // `x` sai EXATAMENTE como o ponteiro — sem clamp, porque cabe sem ele.
    expect(Number.parseFloat(el.style.left)).toBe(X_PONTEIRO_RS);

    act(() => root.unmount());
    host.remove();
  });
});

describe("cartão mais largo que o contêiner inteiro — o caso patológico documentado", () => {
  it("🔴 nem virando cabe — a borda ESQUERDA fica em 0, a direita sangra (decisão documentada em `hover-card-placement.ts`) [mutação: deixar a borda esquerda sair de 0]", () => {
    // Contêiner de 200px, cartão de 363px (o mesmo cartão real de RS) — mais
    // largo que o PRÓPRIO contêiner. Não há posição que caiba os dois lados.
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <NationalChoroplethMapImpl
          candidatoAId={13}
          candidatos={CANDIDATOS}
          rows={ROWS}
          view="winner"
          cargo="pres"
        />,
      );
    });
    const container = host.querySelector('[role="img"]') as HTMLElement;
    container.getBoundingClientRect = () => domRect(200, CONTAINER_H);

    hoverMouse("RS", 100, 50);

    const el = card(host) as HTMLElement;
    expect(el, "o balão não abriu").not.toBeNull();
    expect(el.getAttribute("data-flip")).toBe("false");
    const { esquerda, direita } = bordas(el, CARD_W);
    // A borda esquerda NUNCA sai do contêiner — é o início da leitura.
    expect(esquerda).toBe(0);
    // A direita sangra (363 > 200) — documentado como o mal menor.
    expect(direita).toBeGreaterThan(200);

    act(() => root.unmount());
    host.remove();
  });
});
