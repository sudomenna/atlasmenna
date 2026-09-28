// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalMapBlock.celularCromo.test.tsx
 *
 * Redesenho do mapa no CELULAR (2026-09-27, versão B do protótipo + "Ver
 * legenda" — docs/design-system/prototipos/mapa-celular-2026-09-27/),
 * aplicado ao NÍVEL BRASIL (`<NationalMapBlock variant="frame">`).
 *
 * O que este arquivo trava:
 *   (a) o `<select>` nativo "Vista" do celular e o `<MapViewToggle>` do
 *       desktop compartilham o MESMO estado — trocar um troca o outro (não
 *       são dois controles "por conta própria" desincronizados);
 *   (b) "Ver legenda" só existe quando HÁ o que legendar (winner/margin, fora
 *       de Gov/Sen) — e abre uma `<Sheet>` com a MESMA legenda completa
 *       (`<CandidateLegendGroup>`) que hoje só existe sobreposta ao mapa;
 *   (c) o título (`scopeLabel`) tem DUAS cópias no DOM (overlay do desktop +
 *       rodapé do celular), cada uma dentro de um "container de visibilidade"
 *       CSS diferente — nunca a mesma cópia reaproveitada nos dois lugares,
 *       e as duas sempre com o MESMO texto (nenhuma pode divergir da outra).
 *
 * Harness: `next/dynamic` não sobe em happy-dom (mesmo obstáculo documentado
 * em `persistent-map-frame.test.tsx`) — em vez de mockar o módulo inteiro
 * `@/components/blocks/NationalChoroplethMap` (que perderia
 * `buildCandidateLegendEntries`/`GeografiaLegend`/`viewLabelForCargo`, as
 * MESMAS funções que `NationalMapBlock.tsx` usa para montar o cromo do
 * celular — mockar tudo duplicaria a decisão "quem entra na legenda" no
 * próprio teste), o mock preserva o módulo real via `importActual` e troca
 * SÓ o componente `NationalChoroplethMap` por um esqueleto — o mapa MapLibre
 * não é o que este arquivo mede.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/blocks/NationalChoroplethMap", async (importActual) => {
  const actual = await importActual<typeof import("@/components/blocks/NationalChoroplethMap")>();
  return {
    ...actual,
    NationalChoroplethMap: () => <div data-testid="mapa-real-falso" />,
  };
});

import mapFrameStyles from "@/components/blocks/MapFrameMobile.module.css";
import { NationalMapBlock } from "@/components/blocks/NationalMapBlock";
import type { EdgeCandidate } from "@/lib/edge-config/types";
import { porUfApurado } from "@/tests/fixtures/spec-019/payloads";

function candidato(id: number, nome: string, partido: string, rank: number): EdgeCandidate {
  return {
    id,
    nome,
    partido,
    cor: `var(--color-cand-${rank})`,
    votos_atuais: 1,
    votos_projetados: 1,
    pct_atual: 50,
    pct_projetado: 50,
    pct_projetado_lower: 49,
    pct_projetado_upper: 51,
    p_vitoria: 0.5,
    rank,
    p_passa_2t: 0.5,
    p_fecha_1t: 0.5,
  } as EdgeCandidate;
}

const CANDIDATOS: EdgeCandidate[] = [
  candidato(13, "LUIZ INACIO LULA DA SILVA", "PT", 1),
  candidato(22, "FLAVIO BOLSONARO", "PL", 2),
];

describe("NationalMapBlock (variant=frame) — cromo do celular (2026-09-27)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function montar(cargo: "pres" | "gov" | "sen" = "pres") {
    act(() => {
      root.render(
        <NationalMapBlock
          action={<a href="/uf/SP">Escolher estado</a>}
          candidatoAId={13}
          candidatos={CANDIDATOS}
          cargo={cargo}
          rankByLider={{ 13: 1, 22: 2 }}
          rows={porUfApurado()}
          scopeLabel="Presidente · Brasil"
          variant="frame"
        />,
      );
    });
  }

  function selectVista(): HTMLSelectElement {
    const select = container.querySelector('select[aria-label="Vista do mapa"]');
    expect(select, "select da vista não encontrado").not.toBeNull();
    return select as HTMLSelectElement;
  }

  function abaAtivaDesktop(): string | null | undefined {
    return container.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
  }

  it('(a) trocar o `<select>` "Vista" do celular move o `<MapViewToggle>` do desktop junto — MESMO estado [mutação: um `useState` próprio no `<select>` (não `setView` do pai) faria este teste falhar]', () => {
    montar("pres");
    expect(abaAtivaDesktop()).toBe("Por vencedor");

    const select = selectVista();
    act(() => {
      select.value = "margin";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(select.value).toBe("margin");
    expect(abaAtivaDesktop()).toBe("Margem");
  });

  it('(b) "Ver legenda" abre a folha com a legenda completa (mesmos candidatos da legenda overlay do desktop)', () => {
    montar("pres");
    const botoes = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent === "Ver legenda",
    );
    expect(botoes).toHaveLength(1);

    expect(container.querySelector('[data-testid="sheet"]')).toBeNull();
    act(() => {
      botoes[0]?.click();
    });

    const sheet = container.querySelector('[data-testid="sheet"]');
    expect(sheet).not.toBeNull();
    const legendaNaFolha = sheet?.querySelector('[data-testid="map-legend-group"]');
    expect(legendaNaFolha?.textContent).toContain("LULA");
    expect(legendaNaFolha?.textContent).toContain("FLAVIO");
  });

  it('(c) 🔴 "Ver legenda" NÃO existe em cargo="gov" — a legenda de candidatos não existe ali (RF-144/145) [mutação: remover o gate `cargo === "gov" || cargo === "sen"` de `porRankCandidates` faz este teste falhar]', () => {
    montar("gov");
    const botoes = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent === "Ver legenda",
    );
    expect(botoes).toHaveLength(0);
  });

  it('(d) trocar para a vista "Swing vs 2022" pelo `<select>` FAZ "Ver legenda" desaparecer — o celular mostra exatamente o que o desktop já mostra (nada)', () => {
    montar("pres");
    expect(
      Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Ver legenda"),
    ).toBe(true);

    const select = selectVista();
    act(() => {
      select.value = "swing";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(
      Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Ver legenda"),
    ).toBe(false);
  });

  it("(e) o título (`scopeLabel`) tem DUAS cópias no DOM — uma no overlay do desktop, outra no rodapé do celular, nunca fundidas num único elemento", () => {
    montar("pres");
    const h2s = Array.from(container.querySelectorAll("h2")).filter(
      (h) => h.textContent === "Presidente · Brasil",
    );
    expect(h2s).toHaveLength(2);

    const [primeiro, segundo] = h2s;
    // Containers de visibilidade DIFERENTES (classes distintas do CSS
    // module) — é o que garante que só uma das duas aparece por vez
    // (`display: none` via media query, `MapFrameMobile.module.css`).
    expect(primeiro?.closest(`.${mapFrameStyles.desktopOverlay}`)).not.toBeNull();
    expect(primeiro?.closest(`.${mapFrameStyles.mobileChrome}`)).toBeNull();
    expect(segundo?.closest(`.${mapFrameStyles.mobileChrome}`)).not.toBeNull();
    expect(segundo?.closest(`.${mapFrameStyles.desktopOverlay}`)).toBeNull();
    // Nenhum `id` compartilhado entre as duas cópias.
    expect(mapFrameStyles.desktopOverlay).not.toBe(mapFrameStyles.mobileChrome);
  });
});
