// @vitest-environment happy-dom
/**
 * tests/unit/shell/persistent-map-frame.celularCromo.test.tsx
 *
 * Redesenho do mapa no CELULAR (2026-09-27, versão B do protótipo —
 * docs/design-system/prototipos/mapa-celular-2026-09-27/), aplicado ao NÍVEL
 * UF (Governador, Senador, Presidente): "← Brasil", hoje flutuando sobre o
 * mapa, muda de lugar — some do overlay do desktop e passa a viver na barra
 * do celular, ao lado do "Escolher UF" (pedido do dono, README do protótipo).
 *
 * O que este arquivo trava:
 *   - `<Link>` "← Brasil" existe DENTRO de `.mobileChrome .bar` (a barra do
 *     celular), com a classe `.btn` (botão de 44px), nos TRÊS cargos;
 *   - o título (h2 em Gov/Sen, texto simples em Presidente) tem uma cópia
 *     dentro de `.mobileChrome .footer` — o MESMO texto que a cópia de
 *     desktop mostra, incluindo o sufixo "· 2 vagas" em Senador (RF-106/D1 —
 *     não é decoração, ver `PersistentMapFrame.tsx`);
 *   - as duas cópias (desktop/celular) NÃO compartilham `id` — a marcação
 *     shared por `aria-labelledby` foi trocada por `aria-label` direto na
 *     `<section>` exatamente para não duplicar um `id` no documento.
 *
 * Harness: mesmo padrão de `persistent-map-frame.municipioHoverProps.test.tsx`
 * — `useParams` fixo em `{ sigla: "sp" }`, `fetch` global stub por URL,
 * `<UfLeaderMapLazy>` mockado (o MapLibre real não sobe em happy-dom e não é
 * o que este arquivo mede), `act(async () => …)` para assentar os três
 * `useEffect` de busca.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useParams: () => ({ sigla: "sp" }),
  usePathname: () => "/uf/sp",
}));

vi.mock("@/components/blocks/NationalMapBlock", () => ({
  CHIP_STYLE: {},
  NationalMapBlock: () => <div data-testid="mapa-nacional-falso" />,
}));

vi.mock("@/components/blocks/UfMapsLazy", () => ({
  UfLeaderMapLazy: () => <div data-testid="uf-leader-map-fake" />,
}));

import mapFrameStyles from "@/components/blocks/MapFrameMobile.module.css";
import { PersistentMapFrame } from "@/components/layout/PersistentMapFrame";
import type { UfPickerCargo } from "@/components/layout/UfPicker";
import { useDadoFrescorStore } from "@/lib/state/dado-freshness-store";

const PAYLOAD_NACIONAL = {
  ts: "2026-09-27T20:00:00.000Z",
  cargo: 1,
  turno: 1,
  national: { candidatos: [], candidato_a_id: null },
  por_uf: [],
};

const UF_RESUMO = {
  uf: "SP",
  ts: "2026-09-27T20:00:00.000Z",
  cargo: 1,
  turno: 1,
  pct_apurado: 40,
  candidatos: [],
  needle_position: 0,
  needle_band: "tossup",
};

function respostaPara(url: string) {
  if (url.startsWith("/api/projection/municipios")) return { status: "ok", municipios: [] };
  if (url.startsWith("/api/projection?uf=")) return UF_RESUMO;
  if (url.startsWith("/api/projection")) return PAYLOAD_NACIONAL;
  throw new Error(`URL inesperada no fetch falso: ${url}`);
}

describe("PersistentMapFrame — cromo do celular no nível UF (2026-09-27)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    useDadoFrescorStore.setState({ pollers: {}, relogios: {} });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({ ok: true, json: async () => respostaPara(url) })),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function montar(cargo: UfPickerCargo) {
    await act(async () => {
      root.render(<PersistentMapFrame cargo={cargo} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it.each([
    ["gov" as const, "SP · quem lidera cada município"],
    ["sen" as const, "SP · quem lidera cada município · 2 vagas"],
    ["pres" as const, "SP"],
  ])('cargo=%s — "← Brasil" mora na barra do celular (não só sobreposto ao mapa), e o título "%s" tem cópia no rodapé', async (cargo, tituloEsperado) => {
    await montar(cargo);

    const mobileChrome = container.querySelector(`.${mapFrameStyles.mobileChrome}`);
    expect(mobileChrome, "`.mobileChrome` não foi encontrado no DOM").not.toBeNull();

    const bar = mobileChrome?.querySelector(`.${mapFrameStyles.bar}`);
    expect(bar, "`.bar` não foi encontrado dentro de `.mobileChrome`").not.toBeNull();

    const backLink = bar?.querySelector("a");
    expect(backLink?.textContent).toContain("← Brasil");
    expect(backLink?.getAttribute("href")).toBe(
      cargo === "pres" ? "/" : `/${cargo === "gov" ? "governador" : "senador"}`,
    );
    expect(backLink?.className).toContain(mapFrameStyles.btn);

    const footer = mobileChrome?.querySelector(`.${mapFrameStyles.footer}`);
    expect(footer?.textContent).toContain(tituloEsperado);
  });

  it('🔴 Senador — o "· 2 vagas" viaja com AS DUAS cópias do título (decisão D1, não decoração) [mutação: apagar o sufixo só da cópia do celular faz este teste falhar]', async () => {
    await montar("sen");

    const desktopHeading = container.querySelector(`.${mapFrameStyles.desktopOverlay} h2`);
    const mobileHeading = container.querySelector(`.${mapFrameStyles.footer} h2`);
    expect(desktopHeading?.textContent).toContain("· 2 vagas");
    expect(mobileHeading?.textContent).toContain("· 2 vagas");
    expect(desktopHeading?.textContent).toBe(mobileHeading?.textContent);
  });

  it('as duas cópias do cabeçalho (Gov/Sen) NUNCA compartilham `id` — nenhum `id="persistent-map-heading"` duplicado no documento', async () => {
    await montar("gov");
    const comId = container.querySelectorAll("#persistent-map-heading");
    expect(comId).toHaveLength(0);
    // A `<section>` carrega o rótulo acessível diretamente.
    const section = container.querySelector("section[aria-label]");
    expect(section?.getAttribute("aria-label")).toContain("SP · quem lidera cada município");
  });
});
