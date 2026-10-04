// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.cliqueDesktopNavega.test.tsx
 *
 * 2026-09-19 (decisão do dono): clicar numa UF do mapa nacional volta a
 * NAVEGAR para a página daquele estado — **com ponteiro fino (mouse)**. Sem
 * ele (toque) continua abrindo a `<StateResultSheet>`, como decidido em
 * 08/09. Vale nos três mapas nacionais: Presidente (`/`), Governador
 * (`/governador`) e Senador (`/senador`).
 *
 * 🔴 **2026-09-20 — o predicado mudou, o comportamento não.** Até aqui este
 * arquivo controlava um `matchMedia` de LARGURA (`min-width: 960px`,
 * "desktop"). O dono pediu (pedido separado, "no toque só a gaveta") que um
 * aparelho de TOQUE nunca navegue sozinho, mesmo largo — um iPad Pro a
 * 1024px casava com `min-width: 960px` e por isso NAVEGAVA ao toque, o
 * oposto do pedido. O predicado agora é `(hover: hover) and (pointer:
 * fine)` (`useHasFinePointer`, `lib/utils/use-has-fine-pointer.ts`) — "este
 * aparelho tem mouse?", não "a tela é larga?". O mock abaixo passou a
 * controlar ESSA query (`FINE_POINTER_QUERY`); a de largura
 * (`WIDTH_QUERY`) continua existindo só porque `Sheet.side` (forma da
 * folha: cartão lateral vs. modal) ainda depende dela — e é justamente por
 * ISSO que o caso do iPad Pro (largo + toque) abaixo prova o ponto: as duas
 * queries podem discordar.
 *
 * Este arquivo cobre o comportamento inteiro, fim a fim dentro do componente:
 * monta o WRAPPER público (`<NationalChoroplethMap>`, que é quem resolve a
 * media query) e dispara o handler de clique que o IMPL registra no MapLibre
 * (que é quem navega). Testar só o impl não provaria nada: o defeito que mais
 * assusta nesta mudança é de FIAÇÃO entre os dois níveis.
 *
 * ## O que cada caso mata
 *
 *   1. `it.each` sobre os três cargos — mata `ufHref("pres", …)` cravado e
 *      qualquer template escrito à mão sem o sufixo de rota. 🔴 **Um cargo só
 *      não bastaria**: com `cargo` ignorado, o caso de Presidente passa (o
 *      sufixo dele é ""), e só gov/sen denunciam.
 *   2. Mobile (sem ponteiro fino, estreito) — mata "navegar sempre".
 *   3. 🔴 A media query virando TOQUE **depois da montagem** — mata capturar
 *      `navegarNoClique` numa closure do `mount()`. É o defeito mais provável
 *      desta mudança, porque o valor NASCE `false` (o `matchMedia` do wrapper
 *      só resolve no `useEffect`) e vira `true` um tick depois: uma closure
 *      congelaria o `false` e o ponteiro fino nunca navegaria. O caso abaixo
 *      testa a direção inversa (fino → toque) porque ela é a que discrimina:
 *      com closure, o mapa montado com ponteiro fino continuaria navegando
 *      depois de virar toque.
 *   4. Ponteiro fino usa `router.push`, não navegação dura — mata `<a href>`
 *      / `location.assign` / `location.href =`, que remontariam a instância
 *      MapLibre da moldura persistente (o defeito que o ADR-0033 § 1 existe
 *      para evitar).
 *   5. Ponteiro fino não abre a folha — mata "navega E abre", que deixaria a
 *      ficha piscando por cima da transição de rota.
 *   6. 🔴 **NOVO 2026-09-20** — aparelho de TOQUE largo (≥960px, tipo iPad
 *      Pro): mata voltar a decidir por LARGURA. Sem esta correção, este caso
 *      navegaria (a largura sozinha diz "desktop") quando o pedido do dono é
 *      que o toque nunca navegue sozinho.
 *
 * ## Harness
 *
 *   - MapLibre falso, no mesmo molde de
 *     `NationalChoroplethMap.hoverIdentidadePorUf.test.tsx`: grava os handlers
 *     por evento/camada para que o teste dispare o clique REAL do produto, e
 *     não uma função interna não-exportada.
 *   - `next/dynamic` substituído por um carregador SÍNCRONO do impl. O wrapper
 *     usa `next/dynamic({ ssr: false })`, cujo `React.lazy` não resolve dentro
 *     de um `act()` síncrono em happy-dom; o que se afere aqui é a fiação de
 *     props entre wrapper e impl, não o carregamento preguiçoso (esse é do
 *     `ANALYZE`/e2e). O mock recebe as MESMAS props que o `dynamic` real
 *     receberia, então um wrapper que esqueça de passar `navegarNoClique`
 *     continua sendo pego.
 *   - `next/navigation` mockado: `useRouter().push` é um espião. É a única
 *     forma de observar a navegação sem App Router montado.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeUfRow } from "@/lib/edge-config/types";

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

type Handler = (e: unknown) => void;

const espiao = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  push: vi.fn(),
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
    push: espiao.push,
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

/** Carrega o impl de verdade, sem o `React.lazy` do `next/dynamic`. */
vi.mock("next/dynamic", async () => {
  const mod = await import("@/components/blocks/_NationalChoroplethMapImpl");
  return { default: () => mod.NationalChoroplethMapImpl };
});

import { NationalChoroplethMap } from "@/components/blocks/NationalChoroplethMap";
import { type UfPickerCargo, ufHref } from "@/lib/utils/uf-href";

// ---------------------------------------------------------------------------
// `window.matchMedia` controlável — DUAS queries independentes
// ---------------------------------------------------------------------------

/**
 * `useHasFinePointer()` (`lib/utils/use-has-fine-pointer.ts`) — decide se o
 * clique NAVEGA. É a query que este arquivo testa de verdade.
 */
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

/**
 * `useIsDesktop()` (`NationalChoroplethMap.tsx`) — decide só a FORMA da
 * folha (`Sheet.side`), não mais a navegação. Controlável em separado do
 * ponteiro justamente para provar que as duas podem discordar (caso do iPad
 * Pro, abaixo): largo (esta query casa) e sem mouse (`FINE_POINTER_QUERY`
 * não casa).
 */
const WIDTH_QUERY = "(min-width: 960px)";

type MqlListener = (e: MediaQueryListEvent) => void;

let temPonteiroFino = false;
let larguraDesktop = false;
const ouvintesPonteiro = new Set<MqlListener>();

function instalaMatchMedia() {
  window.matchMedia = ((query: string) => {
    const eFino = query === FINE_POINTER_QUERY;
    const eLargo = query === WIDTH_QUERY;
    // 🔴 `matches: true` SÓ para as duas queries que este harness conhece. O
    // impl também consulta `(prefers-reduced-motion: reduce)` na montagem;
    // um `matches: true` indiscriminado responderia "sim" a ela também e o
    // teste passaria a afirmar algo sobre a query errada.
    return {
      media: query,
      matches: eFino ? temPonteiroFino : eLargo ? larguraDesktop : false,
      onchange: null,
      addEventListener: (_tipo: string, cb: MqlListener) => {
        if (eFino) ouvintesPonteiro.add(cb);
      },
      removeEventListener: (_tipo: string, cb: MqlListener) => {
        ouvintesPonteiro.delete(cb);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

/** Dispara o evento `change` real do `matchMedia` de ponteiro, como o browser faria. */
function viraViewport(paraFino: boolean) {
  temPonteiroFino = paraFino;
  act(() => {
    for (const cb of ouvintesPonteiro) cb({ matches: paraFino } as MediaQueryListEvent);
  });
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const ROW_SP: EdgeUfRow = {
  sigla: "SP",
  pct_apurado: 40,
  lider: 13,
  margem_atual: 10,
  margem_projetada: 10,
  margem_projetada_ci: [8, 12],
  chamada: false,
  swing_vs_2022: null,
  top_candidatos: [
    { id: 13, pct: 55, nome: "FERNANDA DA SILVA", partido: "PT" },
    { id: 22, pct: 45, nome: "ROBERTO ALVES", partido: "PL" },
  ],
  vai_a_2t: null,
  bucket: "indefinido",
};

function montar(cargo: UfPickerCargo) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NationalChoroplethMap candidatoAId={13} rows={[ROW_SP]} view="winner" cargo={cargo} />,
    );
  });
  return { host, root };
}

function clicaEmSp() {
  const onClick = espiao.handlers.get("click:ufs-fill");
  expect(onClick, "handler de click não foi registrado pelo impl").toBeDefined();
  act(() => {
    onClick?.({
      features: [{ properties: { SIGLA_UF: "SP" } }],
      originalEvent: { clientX: 10, clientY: 10 },
    });
  });
}

function desmonta(host: HTMLElement, root: Root) {
  act(() => root.unmount());
  host.remove();
}

beforeEach(() => {
  espiao.handlers.clear();
  espiao.push.mockClear();
  ouvintesPonteiro.clear();
  temPonteiroFino = false;
  larguraDesktop = false;
  instalaMatchMedia();
});

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------

describe("clique numa UF do mapa nacional (RF-030.3, decisão 2026-09-19/20)", () => {
  it.each([
    ["pres" as const, "/uf/SP"],
    ["gov" as const, "/uf/SP/governador"],
    ["sen" as const, "/uf/SP/senador"],
  ])("ponteiro fino, cargo=%s → navega para %s", (cargo, destino) => {
    temPonteiroFino = true;
    larguraDesktop = true;
    const { host, root } = montar(cargo);
    clicaEmSp();

    expect(espiao.push).toHaveBeenCalledTimes(1);
    expect(espiao.push).toHaveBeenCalledWith(destino);
    // Redundante de propósito: amarra o destino esperado ao módulo que é a
    // fonte única dele, para que renomear uma rota quebre este teste junto.
    expect(destino).toBe(ufHref(cargo, "SP"));

    desmonta(host, root);
  });

  it("mobile (sem ponteiro fino, estreito) → NÃO navega; abre a folha do estado", () => {
    temPonteiroFino = false;
    larguraDesktop = false;
    const { host, root } = montar("gov");
    clicaEmSp();

    expect(espiao.push).not.toHaveBeenCalled();
    // A folha só existe no DOM quando aberta (`Sheet.tsx`: `if (!open) return null`).
    expect(host.querySelector('[data-testid="sheet"]'), "folha não abriu no mobile").not.toBeNull();
    expect(host.querySelector('[data-testid="state-sheet-cta"]')).not.toBeNull();

    desmonta(host, root);
  });

  it("🔴 aparelho de TOQUE largo (≥960px, tipo iPad Pro) → NÃO navega, abre a gaveta [mutação: voltar o predicado a `useIsDesktop`/largura]", () => {
    // O caso que este teste existe para provar: largura sozinha diria
    // "desktop" (`larguraDesktop = true`), mas SEM ponteiro fino o clique
    // não pode navegar — é exatamente o defeito relatado pelo dono (um iPad
    // Pro a 1024px navegava antes desta correção).
    temPonteiroFino = false;
    larguraDesktop = true;
    const { host, root } = montar("pres");
    clicaEmSp();

    expect(
      espiao.push,
      "navegou usando LARGURA em vez de capacidade de ponteiro",
    ).not.toHaveBeenCalled();
    expect(
      host.querySelector('[data-testid="sheet"]'),
      "a gaveta não abriu no toque largo",
    ).not.toBeNull();
    expect(host.querySelector('[data-testid="state-sheet-cta"]')).not.toBeNull();

    desmonta(host, root);
  });

  it("🔴 media query vira TOQUE depois da montagem → o clique volta a abrir a folha", () => {
    // Com `navegarNoClique` capturado numa closure do `mount()` (o efeito que
    // registra o handler roda UMA vez), este caso continuaria navegando — o
    // handler ainda enxergaria o `true` da montagem.
    temPonteiroFino = true;
    larguraDesktop = true;
    const { host, root } = montar("sen");

    viraViewport(false);
    clicaEmSp();

    expect(espiao.push).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="sheet"]')).not.toBeNull();

    desmonta(host, root);
  });

  it("ponteiro fino → navegação SOFT (`router.push`), nunca dura", () => {
    // Um `<a href>` cru ou `location.assign` remontaria a instância MapLibre
    // da moldura persistente — ADR-0033 § 1. `/` e `/uf/[sigla]` são irmãos
    // sob o MESMO `layout.tsx` de grupo; só `router.push` preserva o mapa.
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    const hrefAntes = window.location.href;

    temPonteiroFino = true;
    larguraDesktop = true;
    const { host, root } = montar("pres");
    clicaEmSp();

    expect(espiao.push).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
    expect(window.location.href).toBe(hrefAntes);

    assign.mockRestore();
    desmonta(host, root);
  });

  it("ponteiro fino → a folha NÃO abre junto com a navegação", () => {
    temPonteiroFino = true;
    larguraDesktop = true;
    const { host, root } = montar("gov");
    clicaEmSp();

    expect(host.querySelector('[data-testid="state-sheet-cta"]')).toBeNull();
    expect(host.querySelector('[data-testid="sheet"]')).toBeNull();

    desmonta(host, root);
  });
});
