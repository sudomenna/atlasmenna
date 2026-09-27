// @vitest-environment happy-dom
/**
 * tests/unit/components/anulada-listas.test.tsx
 *
 * ADR-0053 / RF-213 — as listas e os derivadores menores, um a um.
 *
 * O arquivo irmão (`anulada-consistencia.test.tsx`) prova que as superfícies
 * CONCORDAM numa UF de quatro candidaturas. Lá, vários filtros são redundantes
 * com a ORDEM: a anulada já está no fim, então "o 1º" e "os dois primeiros"
 * saem certos mesmo sem o filtro. Aqui ficam os casos em que o filtro é o
 * ÚNICO que segura — corridas curtas, em que "o fim da lista" é a posição 2 —
 * mais as listas que o arquivo irmão não monta (balão municipal, folha do
 * município, cartão de governador, banner de eleito, recap do 1º turno,
 * redutos, descrição acessível, "Disputa entre N").
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EdgeCandidate,
  EdgeDestinoVoto,
  EdgeNational,
  EdgePayload,
  EdgeUfCandidate,
  EdgeUfMunicipio,
  EdgeUfRow,
} from "@/lib/edge-config/types";

type Handler = (e: unknown) => void;

const espiao = vi.hoisted(() => ({ handlers: new Map<string, (e: unknown) => void>() }));

vi.mock("maplibre-gl", () => {
  class FakeMap {
    cameraForBounds() {
      return { center: [-51.415, -14.24] as [number, number], zoom: 3 };
    }
    jumpTo() {}
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
      if (typeof a === "function") espiao.handlers.set(event, a as Handler);
      else espiao.handlers.set(`${event}:${String(a)}`, b as Handler);
    }
  }
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

import { RaceTypeIndicator } from "@/components/atoms/badges/RaceTypeIndicator";
import { ChoroplethMapUF } from "@/components/atoms/maps/ChoroplethMapUF";
import { NationalChoroplethMapImpl } from "@/components/blocks/_NationalChoroplethMapImpl";
import { GovernorCard } from "@/components/blocks/GovernorCard";
import { NationalWinnerBanner } from "@/components/blocks/NationalWinnerBanner";
import { ResultPanel, type ResultPanelCandidate } from "@/components/blocks/ResultPanel";
import { StateResultSheet } from "@/components/blocks/StateResultSheet";
import { strongholdsFor } from "@/components/blocks/StrongholdsPanel";
import { TurnoOneRecap } from "@/components/blocks/TurnoOneRecap";
import { agregarPorPartido, classificarContagem } from "@/lib/utils/desfecho-governador";
import { liderIdPorBase, margemPorBase } from "@/lib/utils/lider-por-base";
import { votosPorCandidatoMunicipio } from "@/lib/utils/municipio-votos";
import { ordensPorBase } from "@/lib/utils/rank-parcial";
import { descricaoCandidaturasUf } from "@/lib/utils/uf-descricao-candidaturas";

// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const parse = (node: React.ReactElement) =>
  new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");

function tc(
  id: number,
  nome: string,
  partido: string,
  pct: number,
  atual: number,
  destino?: EdgeDestinoVoto,
): EdgeUfRow["top_candidatos"][number] {
  return {
    id,
    nome,
    partido,
    pct,
    pct_atual: atual,
    votos_atuais: atual * 1000,
    ...(destino ? { destino } : {}),
  };
}

function row(top: EdgeUfRow["top_candidatos"], over: Partial<EdgeUfRow> = {}): EdgeUfRow {
  return {
    sigla: "SP",
    pct_apurado: 40,
    lider: 11,
    margem_atual: 0,
    margem_projetada: 0,
    margem_projetada_ci: [0, 0],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: top,
    vai_a_2t: true,
    bucket: "vai_2t",
    ...over,
  };
}

function nacional(
  id: number,
  nome: string,
  partido: string,
  pct: number,
  over: Partial<EdgeCandidate> = {},
): EdgeCandidate {
  return {
    id,
    nome,
    partido,
    votos_atuais: pct * 1000,
    votos_projetados: pct * 1000,
    pct_atual: pct,
    pct_projetado: pct,
    pct_projetado_lower: pct - 1,
    pct_projetado_upper: pct + 1,
    p_vitoria: 0,
    rank: 1,
    p_passa_2t: 0,
    p_fecha_1t: 0,
    ...over,
  };
}

/** Corrida CURTA: só a anulada e uma válida. "O fim da lista" é a posição 2. */
const CURTA = [
  tc(10, "ANULA", "NOVO", 60, 61, "anulado"),
  tc(11, "VALIDA", "PT", 40, 39, "valido"),
];

beforeEach(() => {
  espiao.handlers.clear();
  window.matchMedia = ((query: string) => ({
    matches: query === "(hover: hover) and (pointer: fine)",
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

describe("corrida curta — o filtro é o único que segura", () => {
  it("todas as linhas do corte anuladas ⇒ o líder é o do modelo [mutação: `ordenados[0]?.id`]", () => {
    const soAnuladas = row([tc(10, "ANULA", "NOVO", 60, 61, "anulado")], { lider: 11 });
    expect(liderIdPorBase(soAnuladas, "proj")).toBe(11);
    expect(liderIdPorBase(soAnuladas, "parcial")).toBe(11);
  });

  it("margem parcial com um só que disputa cai na projetada — nunca 'VALIDA − ANULA' [mutação: sem `queCompetem`]", () => {
    expect(margemPorBase(row(CURTA, { margem_projetada: 7 }), "parcial")).toBe(7);
  });

  it("desfecho 2º turno pela projeção não credita a anulada [mutação: sem `queCompetem` em `candidatosQueContam`]", () => {
    expect(agregarPorPartido([row(CURTA)], "projecao")).toEqual([
      { partido: "PT", eleitos: 0, segundo_turno: 1 },
    ]);
  });

  it("desfecho pela contagem com o corte TODO anulado ⇒ 'aguardando', nunca 'eleito' [mutação: `ordem[0]` sem `queCompetem`]", () => {
    const soAnulada = row([tc(10, "ANULA", "NOVO", 60, 61, "anulado")]);
    expect(classificarContagem(soAnulada)).toBe("aguardando");
    expect(agregarPorPartido([soAnulada], "contagem")).toEqual([]);
  });

  it("desfecho pela contagem: com 61% anulado, 39% já é maioria dos que disputam", () => {
    // 39 > (100 − 61) / 2 = 19,5. Pela régua antiga, "segundo_turno".
    expect(classificarContagem(row(CURTA))).toBe("eleito_1t");
    // Sem a régua, mas com o filtro: 39 > 50 é falso.
    expect(agregarPorPartido([row(CURTA)], "contagem")).toEqual([
      { partido: "PT", eleitos: 1, segundo_turno: 0 },
    ]);
  });

  it("`<ResultPanel>` com 2: sem duelo (a margem não é medida contra a anulada) [mutação: `disputaParcial = porParcial`]", () => {
    const cands: ResultPanelCandidate[] = CURTA.map((t) => ({
      id: t.id,
      nome: t.nome ?? "",
      partido: t.partido ?? "",
      votos_atuais: t.votos_atuais ?? 0,
      pct_atual: t.pct_atual ?? 0,
      pct_projetado: t.pct,
      ...(t.destino ? { destino: t.destino } : {}),
    }));
    const doc = parse(<ResultPanel candidatos={cands} pctApurado={40} />);
    expect(doc.querySelector('[data-testid="result-margem-proj"]')).toBeNull();
    expect(doc.querySelector('[data-testid="result-margem-parcial"]')).toBeNull();
  });

  it("`<ResultPanel>` de Senado com 2 e 2 vagas: a anulada não leva a vaga [mutação: `ocupa = multiVaga && iParcial < nVagas`]", () => {
    const cands: ResultPanelCandidate[] = CURTA.map((t) => ({
      id: t.id,
      nome: t.nome ?? "",
      partido: t.partido ?? "",
      votos_atuais: 0,
      pct_atual: t.pct_atual ?? 0,
      pct_projetado: t.pct,
      ...(t.destino ? { destino: t.destino } : {}),
    }));
    const doc = parse(<ResultPanel candidatos={cands} pctApurado={40} vagas={2} />);
    const comVaga = Array.from(doc.querySelectorAll("li[data-vaga]")).map(
      (li) => li.querySelector('[data-testid="candidate-result-name"]')?.textContent,
    );
    expect(comVaga).toEqual(["VALIDA"]);
  });

  it("ficha de Senado com 2: só VALIDA leva vaga, e ANULA tem '—' no lugar do número [mutação: `ocupaVaga` sem `disputa`]", () => {
    const doc = parse(
      <StateResultSheet
        open
        onClose={() => {}}
        row={row(CURTA)}
        candidatos={[]}
        cargo="sen"
        viewMode="proj"
      />,
    );
    const itens = Array.from(doc.querySelectorAll('[data-testid="state-sheet-candidatos"] > li'));
    const comVaga = itens
      .filter((li) => li.querySelector('[data-testid="result-vaga-marker"]'))
      .map((li) => li.querySelector('[data-testid="state-sheet-cand-nome"]')?.textContent);
    expect(comVaga).toEqual(["VALIDA"]);
    expect(itens[1]?.textContent).toContain("—");
  });
});

describe("`<ResultPanel>` com colapso", () => {
  function sete(anuladaNoTopo: boolean): ResultPanelCandidate[] {
    const nomes = ["A", "B", "C", "D", "E", "F", "G"];
    return nomes.map((nome, i) => ({
      id: i + 1,
      nome,
      partido: "PT",
      votos_atuais: 0,
      pct_atual: 40 - i * 5,
      pct_projetado: 40 - i * 5,
      ...(anuladaNoTopo && i === 0 ? { destino: "anulado" as const } : {}),
    }));
  }

  it("a anulada nunca é escondida pelo colapso, e o botão conta só quem pode sobrar [mutação: `extras` sem `disputa`]", () => {
    // 7 candidaturas, `limit` 6, a mais votada anulada: sobram 6 que disputam
    // ⇒ nenhuma excedente ⇒ lista simples, sem botão, com a anulada visível.
    const doc = parse(<ResultPanel candidatos={sete(true)} pctApurado={40} limit={6} />);
    expect(doc.querySelector("[data-extra-row]")).toBeNull();
    expect(doc.body.textContent).not.toContain("Todos os 7 candidatos");
    expect(doc.querySelector('[data-testid="destino-etiqueta"]')?.textContent).toBe(", Anulado");
  });

  it("sem anulada o colapso é o de sempre (1 excedente, botão presente)", () => {
    const doc = parse(<ResultPanel candidatos={sete(false)} pctApurado={40} limit={6} />);
    expect(doc.querySelectorAll("[data-extra-row]")).toHaveLength(1);
    expect(doc.body.textContent).toContain("Todos os 7 candidatos");
  });
});

describe("ordensPorBase", () => {
  it("anulada no fim das DUAS ordens; sub judice e ausente no lugar de sempre [mutação: sem `anuladasAoFim`]", () => {
    const c = [
      { id: 1, pct_atual: 50, pct_projetado: 50, destino: "anulado" as const },
      { id: 2, pct_atual: 30, pct_projetado: 20 },
      { id: 3, pct_atual: 20, pct_projetado: 30, destino: "sub_judice" as const },
    ];
    const o = ordensPorBase(c);
    expect(o.parcial.map((x) => x.id)).toEqual([2, 3, 1]);
    expect(o.proj.map((x) => x.id)).toEqual([3, 2, 1]);
    expect(o.posParcial.get(1)).toBe(2);
  });
});

describe("mapa nacional — o ✓ do vencedor chamado", () => {
  it("com `chamada`, o ✓ vai para o 1º QUE COMPETE, nunca para a anulada do topo [mutação: `top_candidatos[0]`]", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <NationalChoroplethMapImpl
          candidatoAId={11}
          candidatos={[nacional(10, "ANULA", "NOVO", 60), nacional(11, "VALIDA", "PT", 40)]}
          rows={[row(CURTA, { chamada: true })]}
          view="winner"
          cargo="gov"
        />,
      );
    });
    act(() => {
      espiao.handlers.get("mousemove:ufs-fill")?.({
        features: [{ properties: { SIGLA_UF: "SP" } }],
        originalEvent: { clientX: 10, clientY: 10 },
      });
    });
    const linhasComCheck = Array.from(host.querySelectorAll('[data-testid="hover-card"] span'))
      .filter((s) => s.textContent?.trim() === "✓")
      .map((s) => s.parentElement?.textContent ?? "");
    expect(linhasComCheck).toHaveLength(1);
    expect(linhasComCheck[0]).toContain("VALIDA");
    act(() => root.unmount());
  });
});

describe("mapa e folha do município", () => {
  function cand(
    id: number,
    nome: string,
    partido: string,
    destino?: EdgeDestinoVoto,
  ): EdgeUfCandidate {
    return {
      id,
      nome,
      partido,
      votos_atuais: 0,
      votos_projetados: 0,
      pct_atual: 0,
      pct_projetado: 0,
      ci95: { lower: 0, upper: 0 },
      ...(destino ? { destino } : {}),
    };
  }
  const CANDS = [
    cand(10, "ANULA", "NOVO", "anulado"),
    cand(11, "UM", "PT"),
    cand(12, "DOIS", "PL", "sub_judice"),
    cand(13, "TRES", "PSOL"),
    cand(14, "QUATRO", "PSD"),
    cand(15, "CINCO", "MDB"),
    cand(16, "SEIS", "PP"),
  ];
  const MUN: EdgeUfMunicipio = {
    cod_ibge: "3550308",
    nome: "São Paulo",
    pct_apurado: 40,
    lider: { candidato_id: 11, partido: "PT", votos: 300, margem_pp: 10 },
    votos_reportados: { "10": 900, "11": 300, "12": 200, "13": 100, "14": 60, "15": 30, "16": 10 },
  };

  it("votosPorCandidatoMunicipio: anulada no fim, com o destino [mutação: sem `anuladasAoFim`]", () => {
    const v = votosPorCandidatoMunicipio(MUN, CANDS);
    expect(v.map((x) => x.id)).toEqual([11, 12, 13, 14, 15, 16, 10]);
    expect(v.at(-1)?.destino).toBe("anulado");
    expect(v[1]?.destino).toBe("sub_judice");
  });

  it("balão do município: 4 que disputam, a anulada, e 'Outros (2)' só com quem disputa [mutação: cortar a lista crua]", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <ChoroplethMapUF
          ufSigla="SP"
          municipios={[{ cod_ibge: "3550308", cor: "var(--party-pt)", pctApurado: 40 }]}
          mode="leader"
          detalhe={[MUN]}
          candidatos={CANDS}
        />,
      );
    });
    act(() => {
      espiao.handlers.get("mousemove:municipios-fill")?.({
        features: [{ properties: { CD_MUN: "3550308" } }],
        originalEvent: { clientX: 10, clientY: 10 },
      });
    });
    const nomes = Array.from(host.querySelectorAll(".overflow-hidden.text-ellipsis")).map(
      (e) => e.textContent,
    );
    expect(nomes).toEqual(["UM", "DOIS", "TRES", "QUATRO", "ANULA", "Outros (2)"]);
    const votos = Array.from(host.querySelectorAll('[data-testid="hover-card-votos"]')).map(
      (e) => e.textContent,
    );
    // "Outros" = CINCO 30 + SEIS 10 = 40, nunca os 900 da anulada.
    expect(votos.at(-1)).toBe("40");
    expect(host.querySelectorAll('[data-testid="destino-etiqueta"]')).toHaveLength(2);
    act(() => root.unmount());
  });
});

describe("cartão de governador", () => {
  it("anulada no fim das 4 linhas, com etiqueta; o líder do cartão é o 1º que disputa [mutação: `top[0]`]", () => {
    const uf = row([...CURTA, tc(12, "TERCEIRA", "PL", 10, 10)], { bucket: "vai_2t" });
    const doc = parse(<GovernorCard uf={uf} candidatos={[]} />);
    const artigo = doc.querySelector("article");
    expect(artigo?.getAttribute("aria-label")).toContain("líder: VALIDA (PT)");
    const itens = Array.from(doc.querySelectorAll("ul li")).map((li) => li.textContent ?? "");
    expect(itens[0]).toContain("VALIDA");
    expect(itens.at(-1)).toContain("ANULA");
    expect(itens.at(-1)).toContain("Anulado");
    expect(itens.at(-1)?.startsWith("—")).toBe(true);
  });
});

describe("banner de eleito", () => {
  it("🔴 nunca diz 'Presidente eleito: <anulada>' quando ela tem `rank` 1 [mutação: `rank === 1` sem `compete`]", () => {
    const anula = nacional(10, "ANULA", "NOVO", 55, { rank: 1, destino: "anulado" });
    const valida = nacional(11, "VALIDA", "PT", 35, { rank: 2, p_vitoria: 0.2 });
    const national: EdgeNational = {
      candidatos: [anula, valida],
      needle_position: 1,
      needle_band: "very_likely_a",
      candidato_a_id: 11,
      candidato_b_id: null,
      p_segundo_turno_overall: 0,
      cenarios_2t: [],
    };
    const doc = parse(
      <NationalWinnerBanner
        national={national}
        candidatos={[anula, valida]}
        pctApuradoTotal={99.5}
        turno={2}
      />,
    );
    const texto = doc.body.textContent ?? "";
    expect(texto).toContain("VALIDA");
    expect(texto).not.toContain("ANULA");
  });
});

describe("recap do 1º turno", () => {
  it("finalistas são os dois que disputam; a anulada aparece no fim com etiqueta [mutação: `rank ≤ 2` cru]", () => {
    const recap: EdgePayload = {
      ts: "2026-10-04T22:30:00-03:00",
      cargo: 1,
      turno: 1,
      pct_apurado_total: 100,
      ufs_apuradas: 27,
      national: {
        candidatos: [
          nacional(10, "ANULA", "NOVO", 40, { rank: 1, destino: "anulado" }),
          nacional(11, "VALIDA", "PT", 30, { rank: 2 }),
          nacional(12, "JUDICE", "PL", 20, { rank: 3, destino: "sub_judice" }),
        ],
        needle_position: 0,
        needle_band: "lean_a",
        candidato_a_id: 11,
        candidato_b_id: 12,
        p_segundo_turno_overall: 1,
        cenarios_2t: [],
      },
      por_uf: [],
      insights: [],
      composition: { pre_election: 0, model: 0, actual_results: 1 },
    };
    const doc = parse(<TurnoOneRecap recap={recap} />);
    expect(doc.body.textContent).toContain("VALIDA e JUDICE avançaram ao 2º turno");
    const itens = Array.from(doc.querySelectorAll("ul li"));
    expect(itens.at(-1)?.getAttribute("aria-label")).toContain("ANULA, Anulado");
  });
});

describe("redutos", () => {
  it("posição e diferença entre quem disputa: VALIDA é 1º, à frente da TERCEIRA [mutação: sem `queCompetem`]", () => {
    const r = row([...CURTA, tc(12, "TERCEIRA", "PL", 10, 10)]);
    const byId = new Map([
      [10, nacional(10, "ANULA", "NOVO", 60)],
      [11, nacional(11, "VALIDA", "PT", 40)],
      [12, nacional(12, "TERCEIRA", "PL", 10)],
    ]);
    const [sp] = strongholdsFor(11, [r], byId);
    expect(sp?.posicao).toBe(1);
    expect(sp?.diff).toBe(30);
    expect(sp?.contraNome).toBe("TERCEIRA");
    expect(strongholdsFor(10, [r], byId)).toEqual([]);
  });
});

describe("textos acessíveis e contagem", () => {
  it("descrição da UF: anulada no fim e dita em voz alta [mutação: sem `anuladasAoFim`/sufixo]", () => {
    const d = descricaoCandidaturasUf(row(CURTA));
    expect(d.indexOf("VALIDA")).toBeLessThan(d.indexOf("ANULA"));
    expect(d).toContain(", Anulado");
  });

  it("'Disputa entre N' não conta a anulada [mutação: sem `compete`]", () => {
    const html = renderToStaticMarkup(
      <RaceTypeIndicator
        candidatos={[
          nacional(10, "ANULA", "NOVO", 40, { destino: "anulado" }),
          nacional(11, "VALIDA", "PT", 30),
          nacional(12, "JUDICE", "PL", 20, { destino: "sub_judice" }),
        ]}
        turno={1}
      />,
    );
    expect(html).toContain("Disputa entre 2 candidatos");
  });
});
