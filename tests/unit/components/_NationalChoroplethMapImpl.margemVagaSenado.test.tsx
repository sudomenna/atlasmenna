// @vitest-environment happy-dom
/**
 * tests/unit/components/_NationalChoroplethMapImpl.margemVagaSenado.test.tsx
 *
 * 2026-09-18 (3ª rodada) — RF-104, a parte que o dono mais quer ver corrigida:
 * a INTENSIDADE DA COR do mapa, não só um rótulo.
 *
 * `resolveColor` (`_NationalChoroplethMapImpl.tsx`, case "margin") alimentava
 * `intensityLevelForMargin`/`marginToRankColor` com `row.margem_atual`/
 * `row.margem_projetada` — sempre 1º−2º, qualquer que seja o cargo. Em
 * Senador (2 vagas) isso pinta uma UF como "decidida" (nível 4/5, cor
 * saturada) sempre que o LÍDER abre distância do 2º colocado — mesmo que a
 * disputa pela 2ª vaga (2º vs 3º) esteja tecnicamente empatada. A cor afirma
 * que a corrida acabou justamente onde ela está viva.
 *
 * Este teste usa os NÚMEROS LITERAIS da aceitação de RF-104 (40/30/29,
 * `docs/specs/016-senador/spec.md:131-133`): margem 1º−2º = 10pp (nível 4,
 * `PARTY_INTENSITY_THRESHOLDS_PP = [2,5,10,15]`, `10 < 15` → nível 4); margem
 * 2º−3º = 1pp (nível 1, `1 < 2`). Os dois níveis são visivelmente diferentes
 * (tokens distintos injetados abaixo) — um teste que não escolhesse números
 * nos lados opostos de um limiar não discriminaria a correção.
 *
 * Estratégia: mesmo harness de `NationalChoroplethMap.preEleicao.test.tsx` —
 * MapLibre falso, dispara `load`, lê a expression `fill-color` gravada por
 * `applyColors` via `setPaintProperty`.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";

type PaintCall = [layer: string, prop: string, valor: unknown];

const espiao = vi.hoisted(() => ({
  paint: [] as Array<[string, string, unknown]>,
  load: [] as Array<() => void>,
}));

const paintCalls = espiao.paint as PaintCall[];

vi.mock("maplibre-gl", async () => {
  const { addZoomApi } = await import("./_fake-map-zoom");
  class FakeMap {
    setPaintProperty(layer: string, prop: string, valor: unknown) {
      espiao.paint.push([layer, prop, valor]);
    }
    on(evento: string, a: unknown, b?: unknown) {
      const cb = (typeof a === "function" ? a : b) as (() => void) | undefined;
      if (evento === "load" && cb) espiao.load.push(cb);
    }
    setFilter() {}
    getCanvas() {
      return {
        style: {},
        width: 428,
        height: 467,
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
    cameraForBounds() {
      return { center: [-51.415, -14.24] as [number, number], zoom: 3 };
    }
    jumpTo() {}
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

const TOKENS: Record<string, string> = {
  "--map-uncounted": "#e1e4e8",
  "--map-stroke": "#fbfbfc",
  "--map-stroke-focus": "#14171b",
  "--color-tossup": "#d9d9d9",
  // Nível 1 ("apertado") e nível 4 ("quase decidido") do PT — bem distintos,
  // pra um teste que confunda os dois níveis não passar por acaso.
  "--party-pt-1": "#f2d7d5",
  "--party-pt-4": "#c0392b",
  // Idem para o fallback `outros`, que desde 2026-09-20 é quem atende sigla
  // ausente, desconhecida ou de FEDERAÇÃO — antes esse caso ia para a paleta
  // por colocação (`marginToRankColor`).
  "--party-outros-1": "#e6e8ea",
  "--party-outros-4": "#6b7178",
};

/** RF-104 (aceitação literal): 1º=40, 2º=30, 3º=29. */
const ROW_SP: EdgeUfRow = {
  sigla: "SP",
  pct_apurado: 100,
  lider: 1,
  margem_atual: 10, // 1º(40) − 2º(30) — o número que Presidente/Governador usam.
  margem_projetada: 10,
  margem_projetada_ci: [8, 12],
  chamada: false,
  swing_vs_2022: null,
  top_candidatos: [
    { id: 1, pct: 40 },
    { id: 2, pct: 30 },
    { id: 3, pct: 29 },
  ],
  vai_a_2t: null,
  bucket: "indefinido",
};

/** Só o 1º e o 2º — menos de 3 candidatos no top-3 (degradação honesta). */
const ROW_SP_2_CANDIDATOS: EdgeUfRow = {
  ...ROW_SP,
  top_candidatos: [
    { id: 1, pct: 60 },
    { id: 2, pct: 40 },
  ],
};

const CANDIDATOS: EdgeCandidate[] = [
  { id: 1, nome: "LÍDER", partido: "PT" },
  { id: 2, nome: "SEGUNDO", partido: "PL" },
  { id: 3, nome: "TERCEIRO", partido: "PSOL" },
].map(
  (c) =>
    ({
      ...c,
      cor: "var(--color-cand-1)",
      votos_atuais: 1,
      votos_projetados: 1,
      pct_atual: 40,
      pct_projetado: 40,
      pct_projetado_lower: 38,
      pct_projetado_upper: 42,
      p_vitoria: 0.6,
      rank: 1,
      p_passa_2t: 0.6,
      p_fecha_1t: 0,
    }) as EdgeCandidate,
);

/** Mesmos 3 candidatos, sem `partido` mapeado — força o fallback de rank
 * (`marginToRankColor`) em vez de `resolvePartyHex`/`intensityLevelForMargin`. */
const CANDIDATOS_SEM_PARTIDO: EdgeCandidate[] = CANDIDATOS.map((c) => ({
  ...c,
  partido: "",
}));
const RANK_BY_LIDER = { 1: 1, 2: 2, 3: 3 };

function pintar(
  row: EdgeUfRow,
  cargo: "pres" | "gov" | "sen",
  opts: { candidatos?: EdgeCandidate[]; rankByLider?: Record<number, number> } = {},
): string {
  paintCalls.length = 0;
  espiao.load.length = 0;

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      <NationalChoroplethMapImpl
        candidatoAId={1}
        candidatos={opts.candidatos ?? CANDIDATOS}
        rankByLider={opts.rankByLider}
        rows={[row]}
        view="margin"
        cargo={cargo}
      />,
    );
  });

  act(() => {
    for (const cb of espiao.load) cb();
  });

  const ultima = paintCalls.filter(([l, p]) => l === "ufs-fill" && p === "fill-color").at(-1);
  expect(ultima, "o mapa não chegou a pintar").toBeDefined();
  const expression = ultima?.[2] as unknown[];
  // ["match", ["get","SIGLA_UF"], "SP", cor, fallback]
  const idx = expression.indexOf("SP");
  const cor = String(expression[idx + 1]);

  act(() => root.unmount());
  host.remove();
  return cor;
}

beforeEach(() => {
  for (const [k, v] of Object.entries(TOKENS)) {
    document.documentElement.style.setProperty(k, v);
  }
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  for (const k of Object.keys(TOKENS)) document.documentElement.style.removeProperty(k);
  document.body.innerHTML = "";
});

describe("RF-104 — intensidade da cor do mapa por margem de 2ª vaga (Senado)", () => {
  it('cargo="pres" — a intensidade usa a margem 1º−2º (10pp → nível 4, cor saturada) — CONTROLE, não muda', () => {
    expect(pintar(ROW_SP, "pres")).toBe(TOKENS["--party-pt-4"]);
  });

  it('cargo="sen" — a MESMA UF pinta com a margem 2º−3º (1pp → nível 1, "apertado"), NÃO nível 4', () => {
    // Mutação: trocar `cargo === "sen" ? margemSegundaVaga(row) : ...` de
    // volta para sempre usar `margem_atual`/`margem_projetada` faz este
    // teste falhar — a cor viraria a mesma do teste de controle acima
    // (nível 4), afirmando "decidido" numa disputa de 2ª vaga apertada.
    expect(pintar(ROW_SP, "sen")).toBe(TOKENS["--party-pt-1"]);
    expect(pintar(ROW_SP, "sen")).not.toBe(TOKENS["--party-pt-4"]);
  });

  it('cargo="sen" com menos de 3 candidatos no top-3 — nível 1 (conservador), NUNCA a cor de "decidido"', () => {
    // `margemSegundaVaga` devolve `NaN` aqui (só 2 candidatos).
    // `intensityLevelForMargin(NaN)` → nível 1 por contrato (nunca "decidido").
    // Mutação: `margemSegundaVaga` devolvendo `0` em vez de `NaN` também
    // resultaria em nível 1 aqui (abs(0) < 2) — o que discrimina esta
    // mutação é o teste de rótulo "—" em
    // `StateResultSheet.identidadePorUf.test.tsx`, não este; este teste
    // prova que a COR nunca chega a "decidido" quando o dado não existe.
    expect(pintar(ROW_SP_2_CANDIDATOS, "sen")).toBe(TOKENS["--party-pt-1"]);
  });

  it('cargo="sen", partido SEM token próprio — NaN fica no nível 1, não na banda de "quase decidido"', () => {
    // 🔴 Reescrito em 2026-09-20. Este caminho usava `marginToRankColor`, que
    // pintava a UF pela COLOCAÇÃO do líder — e caiu junto com o resto do
    // fallback de rank (constituição § 2: a cor "não muda por rank, por ordem
    // de apuração"). Sem partido mapeado a UF agora entra na rampa de
    // `outros`, e a guarda de `NaN` que este caso protege mudou de casa: está
    // em `intensityLevelForMargin` (`lib/utils/party-color.ts`), que devolve 1
    // para margem não finita.
    //
    // A propriedade medida é a MESMA de antes, e é a que importa: uma UF SEM
    // margem medida nunca pode sair com a cor de uma UF decidida.
    //
    // Mutação: trocar `if (!Number.isFinite(margemPp)) return 1;` por
    // `return 5` (ou remover a guarda, deixando `Math.abs(NaN) < 2 === false`
    // cair até o último `return 5`) faz este teste falhar.
    expect(
      pintar(ROW_SP_2_CANDIDATOS, "sen", {
        candidatos: CANDIDATOS_SEM_PARTIDO,
        rankByLider: RANK_BY_LIDER,
      }),
    ).toBe(TOKENS["--party-outros-1"]);
  });

  it('cargo="sen", partido SEM token próprio — a cor NÃO depende da colocação do líder', () => {
    // O defeito de 2026-09-20 visto pelo mapa: com `marginToRankColor`, mudar
    // `rankByLider` mudava o hex do estado sem que um voto mudasse. Duas
    // colocações, o mesmo dado, o mesmo pixel.
    const comum = { candidatos: CANDIDATOS_SEM_PARTIDO } as const;
    const lider1 = pintar(ROW_SP, "sen", { ...comum, rankByLider: { 1: 1 } });
    const lider5 = pintar(ROW_SP, "sen", { ...comum, rankByLider: { 1: 5 } });

    expect(lider1).toBe(lider5);
    expect(lider1).toBe(TOKENS["--party-outros-1"]); // margem 2º−3º = 1pp
  });
});
