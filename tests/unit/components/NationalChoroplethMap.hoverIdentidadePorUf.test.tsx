// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.hoverIdentidadePorUf.test.tsx
 *
 * 2026-09-18 — o defeito mais grave da rodada "mapa coroplético em
 * Governador": `buildHoverRows` (`_NationalChoroplethMapImpl.tsx`) resolvia o
 * NOME do candidato por `candidatosById.get(tc.id)` — ou seja, por
 * `national.candidatos`. Em cargo 3 (Governador) e 5 (Senador) isso é
 * proibido por contrato (RF-145): `api/model/project.py` escreve um
 * PLACEHOLDER (`"Candidato {id}"`) em `national.candidatos[].nome` fora do
 * cargo 1, porque ali `id` não identifica uma pessoa — identifica "o número
 * 13 nalguma UF" (o bloco nacional é a união de 27 corridas estaduais sob o
 * mesmo espaço de `id`).
 *
 * `EdgeUfRow.top_candidatos[]`, ao contrário, SABE de que UF é (ADR-0042 item
 * 3 / RF-144) e carrega `nome`/`partido`/`sqcand` já resolvidos por ela em
 * TODO cargo. `buildHoverRows` tem de preferir esses campos.
 *
 * 🔴 **Por que a fixture de simulação NÃO revela este defeito.** O gerador de
 * `tests/fixtures/simulacao/governador.json` preenche `national.candidatos[].nome`
 * com um nome de verdade em TODO cargo (180/180 medido) — não é assim que o
 * modelo real se comporta (RF-145), então um teste construído sobre aquela
 * fixture passaria com o código velho e não provaria nada. Este teste
 * constrói o payload à mão, com o placeholder EXATO que `api/model/project.py`
 * escreve em produção (`"Candidato {id}"`) em `national.candidatos`, e o nome
 * real só em `top_candidatos` — a única forma de discriminar o defeito.
 *
 * Estratégia de montagem: mesmo MapLibre falso (padrão de
 * `NationalChoroplethMap.fitBounds.test.tsx`), estendido para registrar os
 * handlers de `mousemove`/`mouseleave` por camada — o hover real do produto,
 * não uma chamada direta a uma função interna não-exportada (este arquivo,
 * como os demais desta suíte, não exporta `buildHoverRows` de propósito;
 * mesmo padrão de `resolveColor`/`applyColors`/`computeFrameCamera`).
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";

// ---------------------------------------------------------------------------
// MapLibre falso — grava handlers de evento por camada
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixture — o placeholder REAL de cargo 3/5, à mão (RF-145)
// ---------------------------------------------------------------------------

/** O EXATO placeholder que `api/model/project.py` escreve fora do cargo 1
 * (`"nome": ident_nat.get("nome") or f"Candidato {r['candidato_id']}"`). */
const PLACEHOLDER_NACIONAL = "Candidato 13";
const NOME_REAL_SP = "FERNANDA DA SILVA";

const CANDIDATOS_NACIONAIS: EdgeCandidate[] = [
  {
    id: 13,
    // 🔴 O ponto central do teste: o bloco nacional NÃO tem o nome real.
    nome: PLACEHOLDER_NACIONAL,
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
    // `top_candidatos` sabe de que UF é — nome real aqui (RF-144).
    { id: 13, pct: 55, nome: NOME_REAL_SP, partido: "PT", sqcand: "250002553928" },
    { id: 22, pct: 45 },
  ],
  vai_a_2t: null,
  bucket: "indefinido",
};

function montar(cargo: "gov" | "sen" = "gov") {
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
        cargo={cargo}
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

describe("hover do mapa nacional — identidade vem da própria UF (RF-144/RF-145)", () => {
  it("mostra o nome REAL de `top_candidatos`, não o placeholder de `national.candidatos`", () => {
    const { host, root } = montar("gov");
    disparaHoverEmSp();

    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card, "HoverCard não renderizou após o hover").not.toBeNull();
    expect(card?.textContent).toContain(NOME_REAL_SP);
    // O ponto do teste: o placeholder do bloco nacional NÃO pode vazar para a
    // tela ao lado de um nome real disponível na própria linha da UF.
    expect(card?.textContent).not.toContain(PLACEHOLDER_NACIONAL);

    act(() => root.unmount());
    host.remove();
  });

  it('cargo="sen" (2026-09-18) — MESMA regra: nome real de `top_candidatos`, não o placeholder', () => {
    // Cargo 5 sofre do MESMO defeito de cargo 3 (RF-145 cobre os dois
    // explicitamente) — `resolveColor`/`buildHoverRows` não têm ramo por
    // cargo, então provar cargo="gov" já provaria "sen" pelo mesmo código;
    // este teste discrimina uma REGRESSÃO que reintroduza um gate por cargo
    // (ex.: `if (cargo === "gov") ... else candidatosById-primeiro`).
    const { host, root } = montar("sen");
    disparaHoverEmSp();

    const card = host.querySelector('[data-testid="hover-card"]');
    expect(card, "HoverCard não renderizou após o hover").not.toBeNull();
    expect(card?.textContent).toContain(NOME_REAL_SP);
    expect(card?.textContent).not.toContain(PLACEHOLDER_NACIONAL);

    act(() => root.unmount());
    host.remove();
  });

  it("sem `nome` em `top_candidatos` (payload pré-ADR-0042), cai no fallback de `national.candidatos`", () => {
    // Garante que o fallback continua existindo — só não pode ser a PRIMEIRA
    // fonte. `tests/fixtures/edge-config/gov-current.json` está exatamente
    // nesta forma hoje (medido: 81/81 `top_candidatos` sem `nome`/`partido`).
    const rowSemNome: EdgeUfRow = {
      ...ROW_SP,
      top_candidatos: [{ id: 13, pct: 55 }],
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <NationalChoroplethMapImpl
          candidatoAId={13}
          candidatos={CANDIDATOS_NACIONAIS}
          rows={[rowSemNome]}
          view="winner"
          cargo="gov"
        />,
      );
    });
    disparaHoverEmSp();

    const card = host.querySelector('[data-testid="hover-card"]');
    // Sem nome nem na linha nem candidato "melhor" — o único nome disponível
    // é o placeholder do fallback, e é honesto mostrá-lo (degradação, não
    // regressão): o defeito era vazar o placeholder QUANDO havia nome real
    // disponível, não a existência do fallback em si.
    expect(card?.textContent).toContain(PLACEHOLDER_NACIONAL);

    act(() => root.unmount());
    host.remove();
  });
});
