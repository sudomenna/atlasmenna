// @vitest-environment happy-dom
/**
 * tests/unit/components/ChoroplethMapUF.hoverCard.test.tsx
 *
 * 2026-09-18 — pedido do dono: o mapa MUNICIPAL (`ChoroplethMapUF`) ganha o
 * mesmo `<HoverCard>` do mapa nacional, com uma diferença deliberada: NUNCA
 * mostra a coluna "Proj." — município não tem projeção (o modelo extrapola
 * por ZONA e agrega para a UF, ADR-0021; ADR-0007 fixa zona como
 * granularidade do modelo).
 *
 * O que estes testes travam:
 *   (a) o balão aparece no hover, com título = nome do município e SEM
 *       "Proj." em lugar nenhum (nem cabeçalho, nem `data-testid`);
 *   (b) a identidade (nome/partido) vem da lista de candidatos DESTA UF
 *       (`EdgeUfCandidate[]`, `ADR-0042 item 2`) — um `id` que colidiria com
 *       outro candidato se resolvido contra um índice nacional/de outra UF
 *       resolve para a pessoa CERTA aqui;
 *   (c) município sem `votos_reportados` não fabrica linha nenhuma — o
 *       balão ainda aparece (título + apurado), mas zero linhas de
 *       candidato;
 *   (d) nomeia os 4 mais votados e agrega o resto numa linha "Outros (N)"
 *       (2026-09-19 — era "corta em top-3", sem cauda);
 *   (e) `mouseleave` fecha o balão;
 *   (f) sem a prop `detalhe`, nenhum balão — degradação honesta;
 *   (g) exatamente 4 candidaturas ⇒ 4 linhas e nenhuma "Outros";
 *   (h) a linha "Outros" do município também não ganha "Proj.".
 *
 * Mais, no fim do arquivo, o `flipY` (2026-09-19) — com a armadilha de
 * instrumento do happy-dom documentada lá.
 *
 * Harness: MapLibre falso que grava os handlers registrados via `map.on(...)`
 * e permite disparar `mousemove`/`mouseleave` na camada `municipios-fill`
 * diretamente — mesmo padrão de
 * `NationalChoroplethMap.hoverVotosPctAtualAusente.test.tsx`, adaptado para a
 * API que `ChoroplethMapUF` realmente chama (`setFeatureState`, sem
 * `cameraForBounds`/`jumpTo` — este mapa usa `bounds`/`fitBoundsOptions` no
 * construtor, não `computeFrameCamera`).
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeUfCandidate, EdgeUfMunicipio } from "@/lib/edge-config/types";

type Handler = (e: unknown) => void;

const espiao = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
}));

vi.mock("maplibre-gl", async () => {
  const { addZoomApi } = await import("./_fake-map-zoom");
  class FakeMap {
    setFeatureState() {}
    setFilter() {}
    setPaintProperty() {}
    getCanvas() {
      return {
        style: {} as Record<string, string>,
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

import { ChoroplethMapUF } from "@/components/atoms/maps/ChoroplethMapUF";

function cand(over: Partial<EdgeUfCandidate>): EdgeUfCandidate {
  return {
    id: 0,
    nome: "",
    partido: "",
    cor: "var(--color-cand-other)",
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: 0,
    pct_projetado: 0,
    ci95: { lower: 0, upper: 0 },
    ...over,
  };
}

function municipio(over: Partial<EdgeUfMunicipio>): EdgeUfMunicipio {
  return {
    cod_ibge: "3550308",
    nome: "São Paulo",
    pct_apurado: 40,
    lider: { candidato_id: 13, partido: "PT", votos: 100, margem_pp: 10 },
    votos_reportados: {},
    ...over,
  };
}

// Candidatos DESTA UF. `id: 13` aqui é uma pessoa deliberadamente DIFERENTE
// da que um índice nacional (ou de outra UF) teria no mesmo número — é essa
// divergência que o teste (b) usa para provar que a resolução é local.
const CANDIDATOS_SP: EdgeUfCandidate[] = [
  cand({ id: 13, nome: "FERNANDA DA SILVA", partido: "PT", cor: "var(--party-pt)" }),
  cand({ id: 22, nome: "JOÃO DE SOUZA", partido: "PL", cor: "var(--party-pl)" }),
  cand({ id: 33, nome: "MARIA LIMA", partido: "PSOL", cor: "var(--party-psol)" }),
  cand({ id: 44, nome: "CARLOS ROCHA", partido: "PSD", cor: "var(--party-psd)" }),
  cand({ id: 55, nome: "ANA COSTA", partido: "MDB", cor: "var(--party-mdb)" }),
  // 66/77 entraram em 2026-09-19 para o caso (d): a cauda de "Outros"
  // precisa de mais de uma candidatura para que a soma seja uma soma.
  cand({ id: 66, nome: "PEDRO ALVES", partido: "PP", cor: "var(--party-pp)" }),
  cand({ id: 77, nome: "LUCIA RAMOS", partido: "PDT", cor: "var(--party-pdt)" }),
];

function montar(props: { detalhe?: EdgeUfMunicipio[]; candidatos?: EdgeUfCandidate[] } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <ChoroplethMapUF
        ufSigla="SP"
        municipios={[{ cod_ibge: "3550308", cor: "var(--party-pt)", pctApurado: 40 }]}
        mode="leader"
        detalhe={props.detalhe}
        candidatos={props.candidatos}
      />,
    );
  });
  return { host, root };
}

function disparaHoverEmSp(codIbge = "3550308") {
  const onMouseMove = espiao.handlers.get("mousemove:municipios-fill");
  expect(onMouseMove, "handler de mousemove não foi registrado").toBeDefined();
  act(() => {
    onMouseMove?.({
      features: [{ properties: { CD_MUN: codIbge } }],
      originalEvent: { clientX: 10, clientY: 10 },
    });
  });
}

function disparaMouseLeave() {
  const onMouseLeave = espiao.handlers.get("mouseleave:municipios-fill");
  expect(onMouseLeave, "handler de mouseleave não foi registrado").toBeDefined();
  act(() => {
    onMouseLeave?.({});
  });
}

/**
 * 2026-09-20 — `ChoroplethMapUF` passou a consultar TAMBÉM
 * `(hover: hover) and (pointer: fine)` (`useHasFinePointer`,
 * `lib/utils/use-has-fine-pointer.ts`) para decidir se o `mousemove` abre o
 * balão ("no toque só a gaveta", pedido do dono — ver
 * `ChoroplethMapUF.toqueNaoAbreBalao.test.tsx`). Este arquivo testa hover de
 * MOUSE: o estube precisa responder `matches: true` a essa query
 * especificamente, senão TODO hover destes testes seria tratado como toque e
 * nenhum balão abriria. `prefers-reduced-motion` (a outra query que o
 * componente consulta) continua caindo em `false` — irrelevante aqui.
 */
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

beforeEach(() => {
  espiao.handlers.clear();
  window.matchMedia = ((query: string) => ({
    matches: query === FINE_POINTER_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<ChoroplethMapUF /> — balão do hover (mesmo átomo do mapa nacional, sem Proj.)", () => {
  it("(a) hover mostra o balão com título = nome do município, e NUNCA a coluna 'Proj.' [mutação: remover a guarda `proj &&` do header em HoverCard.tsx faria 'Proj.' reaparecer sozinho]", () => {
    const { host, root } = montar({
      detalhe: [municipio({ votos_reportados: { 13: 900, 22: 500 } })],
      candidatos: CANDIDATOS_SP,
    });
    disparaHoverEmSp();

    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card).not.toBeNull();
    expect(host.querySelector('[data-testid="hover-card-title"]')?.textContent).toBe("São Paulo");
    expect(card?.textContent).not.toContain("Proj.");
    expect(host.querySelectorAll('[data-testid="hover-card-proj"]').length).toBe(0);

    act(() => root.unmount());
    host.remove();
  });

  it("(b) identidade vem da lista de candidatos DESTA UF, não de um índice genérico [mutação: trocar `candidatosAtuais`/`candidatos` por um array vazio faria cair no fallback 'Candidato {id}' — este teste apanharia]", () => {
    const { host, root } = montar({
      detalhe: [municipio({ votos_reportados: { 13: 900, 22: 500 } })],
      candidatos: CANDIDATOS_SP,
    });
    disparaHoverEmSp();

    const nomes = Array.from(host.querySelectorAll(".overflow-hidden.text-ellipsis")).map(
      (e) => e.textContent,
    );
    // Nomes resolvidos contra CANDIDATOS_SP — nunca "Candidato 13"/"Candidato 22".
    expect(nomes.some((n) => n?.includes("SILVA"))).toBe(true);
    expect(nomes).not.toContain("Candidato 13");
    expect(host.querySelectorAll('[data-testid="hover-card-partido"]')[0]?.textContent).toBe("PT");

    act(() => root.unmount());
    host.remove();
  });

  it("(c) município sem votos_reportados não fabrica linha nenhuma — o balão aparece (título + apurado), zero candidatos [mutação: trocar `Object.entries(municipio.votos_reportados ?? {})` por um array fixo de 1 item faria este teste apanhar uma linha fantasma]", () => {
    const { host, root } = montar({
      detalhe: [municipio({ votos_reportados: {} })],
      candidatos: CANDIDATOS_SP,
    });
    disparaHoverEmSp();

    expect(host.querySelector('[data-testid="hover-card"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hover-card-apurado"]')?.textContent).toBe(
      "40% apurado",
    );
    expect(host.querySelectorAll('[data-testid="hover-card-votos"]').length).toBe(0);
    expect(host.querySelectorAll('[data-testid="hover-card-parcial"]').length).toBe(0);
    // Nenhuma linha de candidato fabricada (nem nome, nem ponto de cor).
    expect(host.querySelectorAll(".overflow-hidden.text-ellipsis").length).toBe(0);

    act(() => root.unmount());
    host.remove();
  });

  it("(d) 🔴 nomeia os 4 mais votados e agrega o RESTO numa linha 'Outros (N)' [mutação: `.slice(0, MUNICIPIO_TOP_N)` → `.slice(0, 3)`, ou a cauda começando em 3 em vez de 4]", () => {
    // Reescrito em 2026-09-19: até aqui este caso travava o corte em top-3 e
    // nenhuma cauda. O dono pediu 4 + "Outros".
    //
    // 🔴 A fixture tem **7 candidaturas com votos todos DISTINTOS e o 4º
    // não-nulo**, e isso é o que faz o teste discriminar. Com o 4º valendo 0,
    // uma cauda que começasse em 3 (a mutação mais provável) somaria o MESMO
    // que uma que começa em 4 — o teste passaria com o corte errado.
    const { host, root } = montar({
      detalhe: [
        municipio({
          votos_reportados: { 13: 900, 22: 800, 33: 700, 44: 600, 55: 200, 66: 150, 77: 100 },
        }),
      ],
      candidatos: CANDIDATOS_SP,
    });
    disparaHoverEmSp();

    const nomes = Array.from(host.querySelectorAll(".overflow-hidden.text-ellipsis")).map(
      (e) => e.textContent,
    );
    expect(nomes).toHaveLength(5);
    expect(nomes[4]).toBe("Outros (3)");

    const votos = Array.from(host.querySelectorAll('[data-testid="hover-card-votos"]')).map(
      (e) => e.textContent,
    );
    // Os QUATRO mais votados nomeados, e a cauda somada: 200 + 150 + 100.
    expect(votos).toEqual(["900", "800", "700", "600", "450"]);

    // O percentual da cauda é a SOMA dos `pct` das três linhas que sobraram,
    // sobre o mesmo denominador (Σ votos_reportados = 3.450) que as quatro de
    // cima usam: 450/3450 = 13,0%. Com a cauda começando em 3, seriam
    // 1.050/3.450 = 30,4% — é essa diferença que a fixture existe para criar.
    //
    // ⚠️ O que este caso NÃO discrimina, e é honesto dizer: aqui
    // `100 − Σ(top 4)` daria o mesmo número, porque no município os `pct`
    // dividem todos pelo MESMO total e fecham em 100 por construção. A
    // diferença entre somar e subtrair só aparece no balão NACIONAL, onde
    // cada ponto é média de um bootstrap próprio — ver
    // `tests/unit/model/test_uf_outros.py`, cuja fixture soma 99,1 de
    // propósito.
    const parcial = Array.from(host.querySelectorAll('[data-testid="hover-card-parcial"]')).map(
      (e) => e.textContent,
    );
    expect(parcial).toEqual(["26,1%", "23,2%", "20,3%", "17,4%", "13,0%"]);

    act(() => root.unmount());
    host.remove();
  });

  it("(g) exatamente 4 candidaturas ⇒ 4 linhas e NENHUMA 'Outros' — cauda vazia não é 'os demais somam 0%' [mutação: agregar incondicionalmente, ou `if (cauda.length >= 0)`]", () => {
    const { host, root } = montar({
      detalhe: [municipio({ votos_reportados: { 13: 900, 22: 800, 33: 700, 44: 600 } })],
      candidatos: CANDIDATOS_SP,
    });
    disparaHoverEmSp();

    const nomes = Array.from(host.querySelectorAll(".overflow-hidden.text-ellipsis")).map(
      (e) => e.textContent,
    );
    expect(nomes).toHaveLength(4);
    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card?.textContent).not.toContain("Outros");
    // E a coluna "Proj." continua ausente: o agregado municipal não ganhou
    // projeção nenhuma de contrabando (não existe projeção por município —
    // ADR-0021).
    expect(card?.textContent).not.toContain("Proj.");
    expect(host.querySelectorAll('[data-testid="hover-card-proj"]').length).toBe(0);

    act(() => root.unmount());
    host.remove();
  });

  it("(h) a linha 'Outros' do município também não traz Proj. [mutação: copiar `proj` do balão nacional para `buildMunicipioHoverRows`]", () => {
    const { host, root } = montar({
      detalhe: [
        municipio({
          votos_reportados: { 13: 900, 22: 800, 33: 700, 44: 600, 55: 200, 66: 150, 77: 100 },
        }),
      ],
      candidatos: CANDIDATOS_SP,
    });
    disparaHoverEmSp();

    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card?.textContent).toContain("Outros (3)");
    expect(card?.textContent).not.toContain("Proj.");
    expect(host.querySelectorAll('[data-testid="hover-card-proj"]').length).toBe(0);

    act(() => root.unmount());
    host.remove();
  });

  it("(e) mouseleave fecha o balão [mutação: apagar `setTooltip(null)` do handler de mouseleave faria este teste apanhar o cartão ainda visível]", () => {
    const { host, root } = montar({
      detalhe: [municipio({ votos_reportados: { 13: 900 } })],
      candidatos: CANDIDATOS_SP,
    });
    disparaHoverEmSp();
    expect(host.querySelector('[data-testid="hover-card"]')).not.toBeNull();

    disparaMouseLeave();
    expect(host.querySelector('[data-testid="hover-card"]')).toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it("(f) sem a prop `detalhe`, hover não quebra e não mostra balão nenhum — degradação honesta em vez de cartão pela metade [mutação: remover a guarda `if (!municipio) { setTooltip(null); return; }` faria este teste explodir ou vazar um cartão sem dado]", () => {
    const { host, root } = montar({ candidatos: CANDIDATOS_SP });
    expect(() => disparaHoverEmSp()).not.toThrow();
    expect(host.querySelector('[data-testid="hover-card"]')).toBeNull();

    act(() => root.unmount());
    host.remove();
  });
});

/**
 * 2026-09-19 — o balão do mapa MUNICIPAL também vira para cima perto da borda
 * de baixo (`flipY`), mesma regra e mesmo predicado do mapa nacional. A
 * versão longa do argumento (por que o cálculo é do mapa e não do átomo, e
 * qual é o limite conhecido do proxy) está em
 * `tests/unit/components/NationalChoroplethMap.hoverFlipVertical.test.tsx`.
 *
 * 🔴 **A mesma armadilha de instrumento vale aqui**: no happy-dom
 * `getBoundingClientRect()` devolve tudo zero. O estube do contêiner é
 * **não-quadrado (800×400)**.
 *
 * 🔴 **2026-09-20 — atualizado.** `flip`/`flipY` não vêm mais do proxy
 * `x/y > metade do contêiner` — vêm de "o CARTÃO, do tamanho que ele TEM,
 * cabe daqui até a borda?" (`lib/utils/hover-card-placement.ts`). Por isso o
 * cartão TAMBÉM precisa de um estube de tamanho — sem ele, um cartão 0×0
 * cabe em qualquer lugar e os dois casos abaixo não discriminariam nada. O
 * cartão é estubado em 300×150 (mesmos números de
 * `NationalChoroplethMap.hoverFlipVertical.test.tsx`, escolhidos para
 * reproduzir os mesmos resultados que esta suíte já travava).
 */
describe("<ChoroplethMapUF /> — o balão vira para cima perto da borda de baixo", () => {
  const RECT_W = 800;
  const RECT_H = 400;
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

  const getBoundingClientRectOriginal = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    // Estube GLOBAL — cobre o nó do `<HoverCard>`, criado só depois do 1º
    // `hover()` (não dá pra estubar por instância como o contêiner, abaixo).
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return domRect(CARD_W, CARD_H);
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = getBoundingClientRectOriginal;
  });

  function montarComRect() {
    const { host, root } = montar({
      detalhe: [municipio({ votos_reportados: { 13: 900, 22: 500 } })],
      candidatos: CANDIDATOS_SP,
    });
    const container = host.querySelector('[role="img"]') as HTMLElement;
    expect(container, "contêiner do mapa não encontrado").not.toBeNull();
    container.getBoundingClientRect = () => domRect(RECT_W, RECT_H);
    // Controle do instrumento — sem ele, todo caso abaixo passa de graça.
    expect(container.getBoundingClientRect().height).toBe(RECT_H);
    return { host, root };
  }

  /** Um hover por teste: `onMouseMove` é throttled a 16ms e um segundo
   *  disparo no mesmo teste seria descartado em silêncio. */
  function hover(clientX: number, clientY: number) {
    const onMouseMove = espiao.handlers.get("mousemove:municipios-fill");
    expect(onMouseMove, "handler de mousemove não foi registrado").toBeDefined();
    act(() => {
      onMouseMove?.({
        features: [{ properties: { CD_MUN: "3550308" } }],
        originalEvent: { clientX, clientY },
      });
    });
  }

  it("metade de cima (y=100 de 400) ⇒ o balão desce [mutação: `flipY` cravado em true]", () => {
    const { host, root } = montarComRect();
    hover(400, 100);

    const el = host.querySelector('[data-testid="hover-card"]');
    expect(el, "HoverCard não renderizou após o hover").not.toBeNull();
    expect(el?.getAttribute("data-flip-y")).toBe("false");

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 metade de baixo e metade esquerda (x=100, y=300) ⇒ flip=false, flipY=true [mutação: `flipY: x > rect.width / 2`, ou `y > rect.width / 2` — 300 > 400 daria false]", () => {
    const { host, root } = montarComRect();
    hover(100, 300);

    const el = host.querySelector('[data-testid="hover-card"]');
    expect(el?.getAttribute("data-flip")).toBe("false");
    expect(el?.getAttribute("data-flip-y")).toBe("true");
    expect(el?.getAttribute("style")).toContain("translate(12px, calc(-100% - 12px))");

    act(() => root.unmount());
    host.remove();
  });
});
