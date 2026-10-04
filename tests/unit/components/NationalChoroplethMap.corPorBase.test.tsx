// @vitest-environment happy-dom
/**
 * tests/unit/components/NationalChoroplethMap.corPorBase.test.tsx
 *
 * **O gate do pedido do dono de 2026-09-20**: *"se no parcial o líder for
 * Flávio, pinta o estado de PL; se a projeção der Lula, pinta da cor do
 * Lula"*.
 *
 * ## Por que este arquivo existe, e o que ele revelou
 *
 * `resolveColor` PARECIA respeitar o seletor desde sempre:
 *
 *   const liderId = parcial ? row.lider : (row.top_candidatos?.[0]?.id ?? row.lider);
 *
 * O ternário é uma mentira de dois braços. `api/model/project.py:5033-5266`
 * constrói as duas pontas a partir do MESMO `ordered[0]` — a lista ordenada
 * por `pct_projetado` desc:
 *
 *   ordered = sorted(rows, key=lambda r: pct_projetado, reverse=True)
 *   "lider": int(ordered[0]["candidato_id"])
 *   top_candidatos = [... for r in ordered[:TOP_CANDIDATOS_POR_UF]]
 *
 * `row.lider === row.top_candidatos[0].id` em 100% dos payloads. **A cor do
 * mapa nunca mudou de partido ao trocar Parcial/Projeção**, em nenhum cargo,
 * desde que o seletor existe. O mesmo vale para a INTENSIDADE: `margem_atual`
 * e `margem_projetada` recebem a mesma variável (linhas 5267-5268).
 *
 * E a suíte inteira não sabia: nenhum teste montava o mapa nas DUAS bases com
 * um apurado que discordasse da projeção. `NationalChoroplethMap.preEleicao`
 * passava `viewMode`, mas para RF-157 (fase pré), onde a guarda de `preEleicao`
 * retorna antes de olhar líder nenhum.
 *
 * ## O que este arquivo mede
 *
 * A expressão `fill-color` que chega ao MapLibre (`setPaintProperty`) — o
 * último ponto antes do pixel. Não a função, não a intenção: a cor.
 *
 * 🔴 **Os tokens `--party-*` são declarados no `<html>` do teste de
 * propósito.** Sem isso `resolvePartyHex` cai em `PARTY_FALLBACK_HEX` para
 * TODA sigla (happy-dom não carrega `app/tokens-party.css`), as duas bases
 * devolvem o mesmo cinza e o teste passaria com o defeito inteiro no lugar —
 * a família "teste que não discrimina" já registrada neste repositório.
 *
 * Fixture: projeção e apuração em ordem OPOSTA, que é a única forma de
 * discriminar.
 *
 *   id  nome   partido  pct (projetado)  pct_atual (apurado)
 *   1   ALFA   PT               50                5
 *   4   DELTA  NOVO              5               60
 *
 * Projeção ⇒ líder ALFA (PT). Parcial ⇒ líder DELTA (NOVO). Cores diferentes.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";

const pintura = vi.hoisted(() => ({ chamadas: [] as Array<[string, string, unknown]> }));

vi.mock("maplibre-gl", async () => {
  const { addZoomApi } = await import("./_fake-map-zoom");
  class FakeMap {
    cameraForBounds() {
      return { center: [-51.415, -14.24] as [number, number], zoom: 3 };
    }
    jumpTo() {}
    setPaintProperty(layer: string, prop: string, valor: unknown) {
      pintura.chamadas.push([layer, prop, valor]);
    }
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
    on() {}
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
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  }),
}));

import { NationalChoroplethMapImpl } from "@/components/blocks/_NationalChoroplethMapImpl";

/**
 * Hexes de `app/tokens-party.css` (tema claro). Os cinco níveis de CADA
 * partido precisam existir: a view `margin` resolve `--party-<slug>-<nivel>`,
 * e um nível ausente cai em `PARTY_FALLBACK_HEX` — que é o mesmo cinza para
 * todo mundo e faria o caso da intensidade comparar nada com nada.
 *
 * Os valores intermediários são ilustrativos; o que os casos verificam é que
 * os DOIS níveis resolvidos são diferentes entre si, nunca o hex exato de uma
 * rampa que `tokens.test.ts` já cobre.
 */
const TOKENS: Record<string, string> = {
  "--party-pt": "#c62e49",
  "--party-pt-1": "#f4d5da",
  "--party-pt-2": "#e79caa",
  "--party-pt-3": "#d96a80",
  "--party-pt-4": "#c62e49",
  "--party-pt-5": "#8f1f34",
  "--party-pl": "#2f8f6b",
  "--party-pl-1": "#d5e9e1",
  "--party-pl-2": "#9ccfbc",
  "--party-pl-3": "#63b596",
  "--party-pl-4": "#2f8f6b",
  "--party-pl-5": "#1f6249",
  "--party-novo": "#e07b1d",
  "--party-novo-1": "#f9e5d2",
  "--party-novo-2": "#f2c396",
  "--party-novo-3": "#ea9f57",
  "--party-novo-4": "#e07b1d",
  "--party-novo-5": "#9b5514",
  "--map-uncounted": "#e1e4e8",
};

const CANDIDATOS: EdgeCandidate[] = [
  { id: 1, partido: "PT" },
  { id: 2, partido: "PL" },
  { id: 4, partido: "NOVO" },
].map(
  (c) =>
    ({
      ...c,
      nome: `Candidato ${c.id}`,
      cor: "var(--color-cand-1)",
      votos_atuais: 1,
      votos_projetados: 1,
      pct_atual: 0,
      pct_projetado: 0,
      pct_projetado_lower: 0,
      pct_projetado_upper: 0,
      p_vitoria: 0,
      rank: 1,
      p_passa_2t: 0,
      p_fecha_1t: 0,
    }) as EdgeCandidate,
);

/** Projeção e apuração em ordem OPOSTA — ver o enunciado do arquivo. */
function rowSp(): EdgeUfRow {
  return {
    sigla: "SP",
    pct_apurado: 40,
    // Como o produtor grava hoje: o líder PROJETADO, nas duas chaves.
    lider: 1,
    margem_atual: 45,
    margem_projetada: 45,
    margem_projetada_ci: [43, 47],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: [
      { id: 1, pct: 50, nome: "ALFA", partido: "PT", votos_atuais: 5, pct_atual: 5 },
      { id: 4, pct: 5, nome: "DELTA", partido: "NOVO", votos_atuais: 60, pct_atual: 60 },
    ] as EdgeUfRow["top_candidatos"],
    vai_a_2t: null,
    bucket: "indefinido",
  };
}

/**
 * Fixture do caso da INTENSIDADE — deliberadamente diferente da de cima.
 *
 * Aqui ALFA (PT) lidera nas DUAS bases, então a matiz é constante e o único
 * jeito de a cor mudar é pelo NÍVEL. Se usássemos a fixture de líder trocado,
 * as cores sairiam diferentes só por serem de partidos diferentes, e o caso
 * passaria mesmo com a margem ainda cega ao seletor — "teste que não
 * discrimina" de manual.
 *
 * Limiares de `PARTY_INTENSITY_THRESHOLDS_PP` = [2, 5, 10, 15]:
 *   - projeção: ALFA 50 − BETA 30 = **20pp** ⇒ nível 5
 *   - apurado:  ALFA 30 − BETA 27 =  **3pp** ⇒ nível 2
 */
function rowSpMesmoLider(): EdgeUfRow {
  return {
    ...rowSp(),
    margem_projetada: 20,
    margem_atual: 20, // como o produtor grava: a projetada nas duas chaves
    top_candidatos: [
      { id: 1, pct: 50, nome: "ALFA", partido: "PT", votos_atuais: 30, pct_atual: 30 },
      { id: 2, pct: 30, nome: "BETA", partido: "PL", votos_atuais: 27, pct_atual: 27 },
    ] as EdgeUfRow["top_candidatos"],
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  pintura.chamadas = [];
  for (const [nome, valor] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(nome, valor);
  }
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  for (const nome of Object.keys(TOKENS)) {
    document.documentElement.style.removeProperty(nome);
  }
});

/** A cor que a expressão `fill-color` atribui a SP na última pintura. */
function corDeSp(
  view: "winner" | "margin",
  viewMode: "proj" | "parcial",
  row: EdgeUfRow = rowSp(),
): string {
  pintura.chamadas = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <NationalChoroplethMapImpl
        candidatoAId={1}
        candidatos={CANDIDATOS}
        rows={[row]}
        view={view}
        cargo="pres"
        viewMode={viewMode}
      />,
    );
  });

  const fill = pintura.chamadas.filter(([l, p]) => l === "ufs-fill" && p === "fill-color").at(-1);
  if (!fill) throw new Error(`nenhuma pintura de fill-color em ${view}/${viewMode}`);
  // `["match", ["get","SIGLA_UF"], "SP", <cor>, <fallback>]`
  const expr = fill[2] as unknown[];
  const i = expr.indexOf("SP");
  if (i === -1) throw new Error("SP não aparece na expressão de cor");
  return String(expr[i + 1]);
}

describe("a cor do mapa segue o seletor Parcial/Projeção", () => {
  // 🔴 Guarda do próprio teste. Se os tokens não chegarem ao `getComputedStyle`
  // (troca de ambiente, happy-dom mudando de comportamento), TODA sigla cai em
  // `PARTY_FALLBACK_HEX` e os casos abaixo comparariam cinza com cinza — verdes
  // e vazios. Este caso morre primeiro e diz por quê.
  it("🔴 pré-condição: os tokens de partido chegam ao `getComputedStyle`", () => {
    const lido = getComputedStyle(document.documentElement).getPropertyValue("--party-pt").trim();
    expect(lido, "o ambiente não entrega os tokens — os casos abaixo seriam vazios").toBe(
      "#c62e49",
    );
    expect(lido).not.toBe("#9aa0a8"); // PARTY_FALLBACK_HEX
  });

  it("🔴 view `winner`: Projeção pinta de PT (ALFA), Parcial pinta de NOVO (DELTA)", () => {
    // Mutação que morre: voltar `liderIdPorBase(row, viewMode)` para
    // `parcial ? row.lider : top_candidatos[0].id` — o ternário de dois braços
    // idênticos. As duas bases voltariam a devolver `#c62e49`.
    const proj = corDeSp("winner", "proj");
    const parcial = corDeSp("winner", "parcial");

    expect(proj).toBe("#c62e49"); // PT — líder PROJETADO
    expect(parcial).toBe("#e07b1d"); // NOVO — líder APURADO
    expect(proj).not.toBe(parcial);
  });

  it("🔴 view `margin`: a INTENSIDADE muda com a base, com o líder CONSTANTE", () => {
    // O segundo braço do achado: `margem_atual === margem_projetada` no
    // payload (`project.py:5267-5268`), os dois calculados sobre
    // `pct_projetado`. Enquanto a matiz nunca trocava de partido, o nível
    // nunca trocava de número.
    //
    // 🔴 Fixture de líder CONSTANTE (ver `rowSpMesmoLider`): as duas cores são
    // da mesma família PT, então qualquer diferença entre elas só pode vir do
    // NÍVEL. Com a fixture de líder trocado este caso passaria mesmo com a
    // margem cega, porque as cores já diferem por partido.
    //
    // Mutação que morre: voltar para `parcial ? row.margem_atual : row.margem_projetada`.
    const linha = rowSpMesmoLider();
    const proj = corDeSp("margin", "proj", linha);
    const parcial = corDeSp("margin", "parcial", linha);

    expect(proj).not.toBe(parcial);
    expect(proj.toLowerCase()).toBe("#8f1f34"); // --party-pt-5 (20pp)
    expect(parcial.toLowerCase()).toBe("#e79caa"); // --party-pt-2 (3pp)
  });

  it("UF sem nenhum boletim continua cinza na Parcial — a correção não atropelou RF-157", () => {
    // `pct_apurado === 0` tem `return` ANTES da escolha de líder. Sem esta
    // guarda, a reordenação por `pct_atual` (todos zero) devolveria um líder
    // qualquer e pintaria a UF sob o rótulo "parcial".
    pintura.chamadas = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const zerada: EdgeUfRow = { ...rowSp(), pct_apurado: 0 };
    act(() => {
      root?.render(
        <NationalChoroplethMapImpl
          candidatoAId={1}
          candidatos={CANDIDATOS}
          rows={[zerada]}
          view="winner"
          cargo="pres"
          viewMode="parcial"
        />,
      );
    });
    const fill = pintura.chamadas.filter(([l, p]) => l === "ufs-fill" && p === "fill-color").at(-1);
    const expr = fill?.[2] as unknown[];
    expect(String(expr[expr.indexOf("SP") + 1])).toBe("#e1e4e8"); // --map-uncounted
  });
});
