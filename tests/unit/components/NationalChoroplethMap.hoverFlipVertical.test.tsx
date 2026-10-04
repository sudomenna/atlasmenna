// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.hoverFlipVertical.test.tsx
 *
 * 2026-09-19 (queixa do dono) — passando o mouse em **RS e SC**, o pé do
 * mapa, o balão abria para BAIXO e era cortado.
 *
 * Causa medida: não existia lógica vertical nenhuma. O deslocamento era
 * `+12px` fixo nos DOIS ramos do ternário de `transform`
 * (`HoverCard.tsx`), e só o eixo horizontal virava, por um proxy grosseiro —
 * `flip: x > rect.width / 2`. O corte vinha do `overflow: hidden` da moldura
 * (`PersistentMapFrame`), que não pode sair: sem ele o mapa vaza por cima do
 * painel irmão.
 *
 * O remédio é o simétrico do horizontal, `flipY: y > rect.height / 2`,
 * calculado NO MAPA (que conhece o contêiner) e obedecido pelo átomo — nunca
 * medindo a altura real do cartão. Ver o comentário no `setTooltip` de
 * `_NationalChoroplethMapImpl.tsx` para as três razões (bundle do chunk mais
 * apertado do projeto, `mousemove` throttled a 16ms, e
 * `renderToStaticMarkup` nos testes do átomo, onde `useLayoutEffect` nunca
 * roda).
 *
 * 🔴 **ARMADILHA DE INSTRUMENTO — leia antes de mexer neste arquivo.**
 * No happy-dom `getBoundingClientRect()` devolve **tudo zero**. Logo
 * `rect.height / 2 === 0`, e QUALQUER `clientY` positivo satisfaz
 * `y > 0`: todo hover de todo teste desta suíte já flipa para cima sem que
 * ninguém tenha pedido. Um teste que não estube o rect passaria com `flipY`
 * cravado em `true` e não provaria absolutamente nada.
 *
 * Por isso o rect do CONTÊINER é estubado — e **NÃO-QUADRADO, 800×400**, de
 * propósito: com um rect quadrado, `y > rect.width / 2` (copiar o predicado
 * horizontal, o erro mais provável) daria exatamente a mesma resposta que
 * `y > rect.height / 2` em todos os casos, e o teste do divisor não
 * discriminaria nada.
 *
 * 🔴 **2026-09-20 — atualizado.** `flip`/`flipY` não vêm mais de
 * `x/y > metade do contêiner` (ver `lib/utils/hover-card-placement.ts` para
 * o defeito que esse proxy causava — RS a 1024px de janela). Agora vêm de
 * "o CARTÃO, do tamanho que ele TEM, cabe daqui até a borda?" — e por isso
 * o rect do CARTÃO também precisa de estube: sem ele, `getBoundingClientRect`
 * do nó do `<HoverCard>` também devolve zero, um cartão de 0×0 cabe em
 * qualquer lugar, e nenhum caso deste arquivo discriminaria nada (o oposto
 * do defeito de 19/09, mas o mesmo instrumento por trás). O cartão é
 * estubado em **300×150** (também não-quadrado, e escolhido para reproduzir
 * exatamente os mesmos cinco resultados que a suíte já travava com o proxy
 * antigo — a intenção pedagógica de cada caso não mudou, só o mecanismo por
 * baixo).
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

const ROW_RS: EdgeUfRow = {
  sigla: "RS",
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

/** Largura e altura DIFERENTES — ver a armadilha no cabeçalho. */
const RECT_W = 800;
const RECT_H = 400;

/** Tamanho estubado do CARTÃO — também não-quadrado. Ver a nota de
 * 2026-09-20 no cabeçalho do arquivo para os números que cada caso exige. */
const CARD_W = 300;
const CARD_H = 150;

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

/**
 * Monta o mapa e substitui o `getBoundingClientRect` do contêiner real E,
 * globalmente, o de QUALQUER elemento (o cartão incluído — ver a nota de
 * 2026-09-20 no cabeçalho). O estube do contêiner é uma propriedade de
 * INSTÂNCIA (só naquele nó) e por isso vence o global (propriedade de
 * protótipo) para o contêiner especificamente; o cartão, criado DEPOIS desta
 * função (só no primeiro `hover`), nunca ganha estube de instância — fica
 * com o global, 300×150.
 *
 * Substituir DEPOIS da montagem funciona porque o handler de `mousemove`
 * (nascido dentro de `mount()`) guarda o NÓ por closure e só chama
 * `.getBoundingClientRect()` no momento do evento — não guarda o retângulo.
 */
function montarComRect() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NationalChoroplethMapImpl
        candidatoAId={13}
        candidatos={CANDIDATOS}
        rows={[ROW_RS]}
        view="winner"
        cargo="gov"
      />,
    );
  });

  const container = host.querySelector('[role="img"]') as HTMLElement;
  expect(container, "contêiner do mapa não encontrado").not.toBeNull();
  container.getBoundingClientRect = () => domRect(RECT_W, RECT_H);

  // 🔴 Controle do instrumento: se o estube não pegar, o rect volta a ser
  // todo-zero e TODOS os casos abaixo passariam com `flipY` cravado em
  // `true`. Melhor falhar aqui, com esta mensagem.
  expect(container.getBoundingClientRect().height).toBe(RECT_H);

  return { host, root };
}

/**
 * Um hover por teste, e uma montagem por teste: `onMouseMove` é throttled a
 * 16ms (`throttle` em `_NationalChoroplethMapImpl.tsx`), então dois disparos
 * seguidos dentro do mesmo teste descartariam o segundo em silêncio e o
 * segundo `expect` leria o estado do PRIMEIRO. Montagem nova ⇒ handler novo
 * ⇒ relógio do throttle zerado.
 */
function hover(clientX: number, clientY: number) {
  const onMouseMove = espiao.handlers.get("mousemove:ufs-fill");
  expect(onMouseMove, "handler de mousemove não foi registrado").toBeDefined();
  act(() => {
    onMouseMove?.({
      features: [{ properties: { SIGLA_UF: "RS" } }],
      originalEvent: { clientX, clientY },
    });
  });
}

function card(host: HTMLElement): Element | null {
  return host.querySelector('[data-testid="hover-card"]');
}

/** Original de `HTMLElement.prototype.getBoundingClientRect` — restaurado em
 * `afterEach` pra não vazar o estube global para outros arquivos de teste. */
const getBoundingClientRectOriginal = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  espiao.handlers.clear();
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
  // Estube GLOBAL — cobre o nó do `<HoverCard>`, que só existe depois do 1º
  // `hover()` e por isso não pode ganhar um estube de instância como o
  // contêiner ganha em `montarComRect`. Ver a nota de 2026-09-20 no
  // cabeçalho do arquivo.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return domRect(CARD_W, CARD_H);
  };
});

afterEach(() => {
  document.body.innerHTML = "";
  HTMLElement.prototype.getBoundingClientRect = getBoundingClientRectOriginal;
});

describe("hover do mapa nacional — o balão vira para cima perto da borda de baixo", () => {
  it("metade de CIMA (y=100 de 400): o balão desce, como sempre [mutação: `flipY` cravado em `true`]", () => {
    const { host, root } = montarComRect();
    hover(400, 100);

    const el = card(host);
    expect(el, "HoverCard não renderizou após o hover").not.toBeNull();
    expect(el?.getAttribute("data-flip-y")).toBe("false");
    expect(el?.getAttribute("style")).toContain("translate(12px, 12px)");

    act(() => root.unmount());
    host.remove();
  });

  it("metade de BAIXO (y=300 de 400): o balão sobe — é o caso de RS/SC [mutação: apagar o campo `flipY` do `setTooltip`, ou cravá-lo em `false`]", () => {
    const { host, root } = montarComRect();
    hover(400, 300);

    const el = card(host);
    expect(el?.getAttribute("data-flip-y")).toBe("true");
    expect(el?.getAttribute("style")).toContain("calc(-100% - 12px))");

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 os dois eixos são INDEPENDENTES: metade esquerda + metade de baixo ⇒ flip=false, flipY=true [mutação: `flipY: x > rect.width / 2` — copiar o predicado horizontal]", () => {
    const { host, root } = montarComRect();
    // x=100 está na metade ESQUERDA (divisor 400) ⇒ não vira de lado.
    // y=300 está na metade de BAIXO (divisor 200) ⇒ vira para cima.
    hover(100, 300);

    const el = card(host);
    expect(el?.getAttribute("data-flip")).toBe("false");
    expect(el?.getAttribute("data-flip-y")).toBe("true");
    // O `transform` prova que os dois eixos saíram diferentes um do outro.
    expect(el?.getAttribute("style")).toContain("translate(12px, calc(-100% - 12px))");

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 o divisor vertical é a ALTURA, não a largura [mutação: `flipY: y > rect.width / 2`]", () => {
    const { host, root } = montarComRect();
    // É por ISTO que o rect estubado é 800×400 e não quadrado:
    //   divisor certo  → 300 > 400/2 = 200 ⇒ true  (o balão sobe)
    //   divisor errado → 300 > 800/2 = 400 ⇒ false (o balão desce e é cortado)
    // Num rect quadrado as duas contas dariam o mesmo e este teste passaria
    // com a mutação aplicada.
    hover(100, 300);

    expect(card(host)?.getAttribute("data-flip-y")).toBe("true");

    act(() => root.unmount());
    host.remove();
  });

  it("canto inferior direito ⇒ os dois eixos viram ao mesmo tempo [mutação: um eixo anular o outro]", () => {
    const { host, root } = montarComRect();
    hover(500, 300);

    const el = card(host);
    expect(el?.getAttribute("data-flip")).toBe("true");
    expect(el?.getAttribute("data-flip-y")).toBe("true");
    expect(el?.getAttribute("style")).toContain(
      "translate(calc(-100% - 12px), calc(-100% - 12px))",
    );

    act(() => root.unmount());
    host.remove();
  });
});
