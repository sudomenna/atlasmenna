// @vitest-environment happy-dom
/**
 * ADR-0076 — a moldura do mapa no placar zerado: com o marcador que
 * `/api/projection` acrescenta, o mapa é DESENHADO (nada de frase de espera)
 * e todo cinza (`preEleicao` no `<NationalMapBlock>`). Sem o marcador, o
 * payload real segue como sempre.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgePayload } from "@/lib/edge-config/types";
import { payloadNacionalZerado } from "@/lib/zerado/majoritario";
import { comMarcaZerado } from "@/lib/zerado/marca";

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
  usePathname: () => "/governador",
}));

const espiao = vi.hoisted(() => ({
  chamadas: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/components/blocks/NationalMapBlock", () => ({
  CHIP_STYLE: {},
  // biome-ignore lint/suspicious/noExplicitAny: espião de teste, props variam
  NationalMapBlock: (props: any) => {
    espiao.chamadas.push(props);
    return <div data-testid="national-map-block-falso" data-cargo={props.cargo} />;
  },
}));

import { PersistentMapFrame } from "@/components/layout/PersistentMapFrame";

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function payloadGov(
  porUf: EdgePayload["por_uf"],
  fase: "pre_eleicao" | "normal" = "normal",
): EdgePayload {
  return {
    ts: "2026-10-04T23:00:00.000Z",
    cargo: 3,
    turno: 1,
    fase,
    national: { candidatos: [{ id: 3011, rank: 1 }], candidato_a_id: 3011 },
    por_uf: porUf,
    // biome-ignore lint/suspicious/noExplicitAny: payload parcial de teste
  } as any;
}

const UF_ROW = {
  sigla: "AC",
  pct_apurado: 20,
  lider: 3011,
  margem_atual: 5,
  margem_projetada: 5,
  margem_projetada_ci: [3, 7],
  chamada: false,
  swing_vs_2022: null,
  top_candidatos: [{ id: 3011, pct: 40 }],
  vai_a_2t: null,
  bucket: "indefinido",
  // biome-ignore lint/suspicious/noExplicitAny: EdgeUfRow parcial de teste
} as any;

const VAZIO = new Map();

describe("PersistentMapFrame — placar zerado (ADR-0076)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    espiao.chamadas = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function responderCom(payload: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => payload })),
    );
  }

  async function montar(cargo: "gov" | "sen" | "pres") {
    await act(async () => {
      root.render(<PersistentMapFrame cargo={cargo} />);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it.each([
    "gov",
    "sen",
    "pres",
  ] as const)("%s: payload zerado marcado ⇒ mapa desenhado, cinza, sem frase de espera", async (cargo) => {
    responderCom(
      comMarcaZerado(payloadNacionalZerado({ cargo, turno: 1, nacionais: [], porUf: VAZIO })),
    );
    await montar(cargo);
    expect(container.querySelector('[data-testid="national-map-block-falso"]')).not.toBeNull();
    expect(espiao.chamadas[0]?.preEleicao).toBe(true);
    expect(espiao.chamadas[0]?.rows).toHaveLength(27);
    expect(container.textContent).not.toContain("A eleição ainda não começou");
    expect(container.textContent).not.toContain("Aguardando primeiros boletins");
  });

  it("payload real (sem marcador) ⇒ preEleicao falso no gov, como sempre", async () => {
    responderCom(payloadGov([UF_ROW], "normal"));
    await montar("gov");
    expect(espiao.chamadas[0]?.preEleicao).toBeFalsy();
  });
});
