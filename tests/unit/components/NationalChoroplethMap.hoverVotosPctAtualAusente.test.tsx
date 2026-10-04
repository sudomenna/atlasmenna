// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.hoverVotosPctAtualAusente.test.tsx
 *
 * 2026-09-18 — pedido do dono: o balão do mapa nacional ganha "Votos" e
 * "Parcial" (% de votos válidos apurados) por candidato, vindos de
 * `EdgeUfRow.top_candidatos[].votos_atuais`/`.pct_atual` (novos,
 * `api/model/project.py`).
 *
 * O que este arquivo trava: **ausência nunca vira "0" nem "NaN" visível** —
 * vira "—", exatamente como o resto do produto trata dado não medido
 * (decisão do dono, 14/09: "não começou / não sabemos / apurando" são três
 * estados, e nenhum deles é fabricar zero). Um candidato com os campos
 * presentes mostra os NÚMEROS reais ao lado de outro, na MESMA UF, sem eles
 * mostrando "—" — a prova de que a ausência é por CANDIDATO, não um
 * apagão da linha inteira.
 *
 * Harness idêntico a `NationalChoroplethMap.hoverIdentidadePorUf.test.tsx`
 * (MapLibre falso que grava handlers por camada, dispara o hover real).
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
    nome: "Candidato 13",
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

// UF SP, 3 candidatos — o CASO MISTO real da apuração (item c do dono,
// 2026-09-18): 13 (1º) e 44 (2º) com os dois campos novos; 22 (3º) sem
// NENHUM dos dois (payload pré-migração / UF imputada do nacional, `pct_atual`
// ausente — ver docstring de `EdgeUfRow.top_candidatos` em `lib/edge-config/types.ts`).
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
    {
      id: 13,
      pct: 55,
      nome: "FERNANDA DA SILVA",
      partido: "PT",
      votos_atuais: 123456,
      pct_atual: 54.2,
    },
    // 2026-09-18 (achado do dono) — o CASO MISTO real da noite da apuração:
    // o 1º e o 2º já têm votos/parcial resolvidos, o 3º ainda não (payload
    // pré-migração, ou `model_fallback_tier` só naquela candidatura). As três
    // linhas COEXISTEM na MESMA UF — é isso que os testes abaixo travam.
    {
      id: 44,
      pct: 32,
      nome: "SÉRGIO PONTES",
      partido: "PSD",
      votos_atuais: 55000,
      pct_atual: 30.1,
    },
    { id: 22, pct: 13, nome: "JOÃO DE SOUZA", partido: "PL" },
  ],
  vai_a_2t: null,
  bucket: "indefinido",
};

function montar() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NationalChoroplethMapImpl
        candidatoAId={13}
        candidatos={CANDIDATOS_NACIONAIS}
        rows={[ROW_SP]}
        view="winner"
        cargo="pres"
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

beforeEach(() => {
  espiao.handlers.clear();
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("hover do mapa nacional — votos/pct_atual por candidato: ausência é '—', nunca 0 ou NaN", () => {
  it("candidato COM os campos mostra os números reais formatados em pt-BR", () => {
    const { host, root } = montar();
    disparaHoverEmSp();

    const votos = Array.from(host.querySelectorAll('[data-testid="hover-card-votos"]')).map(
      (e) => e.textContent,
    );
    const parcial = Array.from(host.querySelectorAll('[data-testid="hover-card-parcial"]')).map(
      (e) => e.textContent,
    );

    // candidato 13 (índice 0, líder) — números reais.
    expect(votos[0]).toBe("123.456");
    expect(parcial[0]).toBe("54,2%");

    act(() => root.unmount());
    host.remove();
  });

  it("candidato SEM os campos mostra '—' nas duas colunas — nunca '0', nunca 'NaN'", () => {
    const { host, root } = montar();
    disparaHoverEmSp();

    const votos = Array.from(host.querySelectorAll('[data-testid="hover-card-votos"]')).map(
      (e) => e.textContent,
    );
    const parcial = Array.from(host.querySelectorAll('[data-testid="hover-card-parcial"]')).map(
      (e) => e.textContent,
    );

    // candidato 22 (índice 2, sem votos_atuais/pct_atual na fixture).
    expect(votos[2]).toBe("—");
    expect(parcial[2]).toBe("—");
    expect(votos[2]).not.toBe("0");
    expect(votos[2]).not.toBe("NaN");
    expect(parcial[2]).not.toBe("0%");
    expect(parcial[2]).not.toBe("NaN%");

    act(() => root.unmount());
    host.remove();
  });

  it("as colunas 'Votos'/'Parcial' aparecem — ao menos UM candidato da UF tem o dado", () => {
    // Guarda contra regressão de `hasColumn`/`hasColumn`: se a coluna
    // inteira sumisse mesmo com dado real em `votos_atuais`/`pct_atual`, o
    // teste acima passaria "por acidente" (querySelectorAll devolveria []
    // e os índices [0]/[2] seriam `undefined`, não teria pego o defeito).
    const { host, root } = montar();
    disparaHoverEmSp();

    expect(host.querySelectorAll('[data-testid="hover-card-votos"]').length).toBe(3);
    expect(host.querySelectorAll('[data-testid="hover-card-parcial"]').length).toBe(3);
    expect(host.textContent).toContain("Votos");
    expect(host.textContent).toContain("Parcial");

    act(() => root.unmount());
    host.remove();
  });

  it("🔴 CASO MISTO (item c do dono): 1º e 2º têm o dado, 3º não — a coluna aparece INTEIRA e mostra '—' só na linha que falta, nunca esconde a coluna por causa de UMA linha incompleta", () => {
    // Este é o cenário real da noite da apuração: candidaturas do mesmo
    // estado resolvem em momentos diferentes (nome/identidade/série chegam
    // por fontes distintas — EA20 `nmu` vs `nm` vs cadastro, model_fallback_tier
    // por candidatura). Um gate que escondesse a coluna assim que UMA linha
    // faltasse o dado apagaria "Votos"/"Parcial" para TODA a UF sempre que
    // qualquer candidatura estivesse atrasada — que é o comportamento ERRADO:
    // a regra certa (`hasColumn`, `HoverCard.tsx`) é "aparece se ALGUMA linha
    // tem", não "só se TODAS tiverem".
    const { host, root } = montar();
    disparaHoverEmSp();

    const votos = Array.from(host.querySelectorAll('[data-testid="hover-card-votos"]')).map(
      (e) => e.textContent,
    );
    const parcial = Array.from(host.querySelectorAll('[data-testid="hover-card-parcial"]')).map(
      (e) => e.textContent,
    );

    // A coluna existe inteira — 3 células, uma por linha, nenhuma engolida.
    expect(votos).toHaveLength(3);
    expect(parcial).toHaveLength(3);
    // 1º (id 13) e 2º (id 44) têm o dado — números reais, na posição certa.
    expect(votos[0]).toBe("123.456");
    expect(parcial[0]).toBe("54,2%");
    expect(votos[1]).toBe("55.000");
    expect(parcial[1]).toBe("30,1%");
    // 3º (id 22) não tem — "—", sem deslocar as duas linhas acima.
    expect(votos[2]).toBe("—");
    expect(parcial[2]).toBe("—");

    act(() => root.unmount());
    host.remove();
  });
});
