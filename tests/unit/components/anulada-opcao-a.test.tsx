// @vitest-environment happy-dom
/**
 * tests/unit/components/anulada-opcao-a.test.tsx
 *
 * Emenda "opção A" ao ADR-0053 (decisão do dono, 2026-09-27): com candidatura
 * ANULADA na abrangência, o produtor publica o percentual de quem compete
 * sobre os VOTOS EM DISPUTA (`vvc − anuladas`). A anulada segue no dado com o
 * percentual sobre `vvc` — outra base —, e a TELA:
 *
 *   - nunca mostra esse percentual: a linha da anulada tem só os votos (ou só
 *     nome e etiqueta quando o dado não traz voto);
 *   - nunca o soma com o das demais;
 *   - explica a regra com a frase do dono, só quando há anulada.
 *
 * ## O cenário, como o produtor o PUBLICA
 *
 *   Na urna (sobre `vvc` = 100.000): Ana 45 · Bruno 30 · Carla 10 (sub judice)
 *   · Davi 15 (anulado). Votos em disputa = 85.000.
 *
 *   id  nome   partido  destino      votos   pct publicado
 *    1  Ana    PT       (ausente)   45.000   52,94  (45/85)
 *    2  Bruno  PL       (ausente)   30.000   35,29  (30/85)
 *    3  Carla  PSB      sub_judice  10.000   11,76  (10/85)
 *    4  Davi   NOVO     anulado     15.000   15     (sobre vvc — não se exibe)
 *
 * Davi (15) tem MAIS votos que Carla (10): qualquer ordenação ou soma que o
 * inclua aparece no resultado.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MinorCandidatesList } from "@/components/atoms/lists/MinorCandidatesList";
import { HoverCard, type HoverCardRow } from "@/components/atoms/overlays/HoverCard";
import { CorridaTresCirculos } from "@/components/blocks/CorridaTresCirculos";
import { GovernorCard } from "@/components/blocks/GovernorCard";
import { MunicipioExplorer } from "@/components/blocks/MunicipioExplorer";
import { ResultPanel, type ResultPanelCandidate } from "@/components/blocks/ResultPanel";
import { StateResultSheet } from "@/components/blocks/StateResultSheet";
import { TurnoOneRecap } from "@/components/blocks/TurnoOneRecap";
import { useMunicipioSheetStore } from "@/components/shared/municipio-sheet-store";
import type {
  EdgeCandidate,
  EdgeDestinoVoto,
  EdgePayload,
  EdgeUfCandidate,
  EdgeUfMunicipio,
  EdgeUfRow,
  EdgeVotacao,
} from "@/lib/edge-config/types";
import { classificarContagem } from "@/lib/utils/desfecho-governador";
import { NOTA_ANULADAS, NOTA_ANULADAS_SEM_REGRA_1T } from "@/lib/utils/destino-voto";
import { votosPorCandidatoMunicipio } from "@/lib/utils/municipio-votos";
import { descricaoCandidaturasUf } from "@/lib/utils/uf-descricao-candidaturas";

const parse = (node: React.ReactElement) =>
  new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
const q = (doc: Document | Element, testid: string) =>
  doc.querySelector(`[data-testid="${testid}"]`);

interface Linha {
  id: number;
  nome: string;
  partido: string;
  destino?: EdgeDestinoVoto;
  votos: number;
  pct: number;
}

/** O payload JÁ PUBLICADO pelo produtor (ver o cabeçalho). */
const PUBLICADO: readonly Linha[] = [
  { id: 1, nome: "Ana", partido: "PT", votos: 45_000, pct: 52.94 },
  { id: 2, nome: "Bruno", partido: "PL", votos: 30_000, pct: 35.29 },
  { id: 3, nome: "Carla", partido: "PSB", destino: "sub_judice", votos: 10_000, pct: 11.76 },
  { id: 4, nome: "Davi", partido: "NOVO", destino: "anulado", votos: 15_000, pct: 15 },
];

/**
 * O MESMO cenário sem nenhuma anulada — Davi competindo, e os percentuais de
 * volta sobre `vvc`, como o produtor publica quando não há anulada.
 */
const SEM_ANULADA: readonly Linha[] = [
  { id: 1, nome: "Ana", partido: "PT", votos: 45_000, pct: 45 },
  { id: 2, nome: "Bruno", partido: "PL", votos: 30_000, pct: 30 },
  { id: 4, nome: "Davi", partido: "NOVO", votos: 15_000, pct: 15 },
  { id: 3, nome: "Carla", partido: "PSB", destino: "sub_judice", votos: 10_000, pct: 10 },
];

const dest = (l: Linha) => (l.destino ? { destino: l.destino } : {});

function painelCands(linhas: readonly Linha[]): ResultPanelCandidate[] {
  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    partido: l.partido,
    votos_atuais: l.votos,
    pct_atual: l.pct,
    pct_projetado: l.pct,
    ...dest(l),
  }));
}

function nacionais(linhas: readonly Linha[]): EdgeCandidate[] {
  return linhas.map(
    (l, i) =>
      ({
        id: l.id,
        nome: l.nome,
        partido: l.partido,
        votos_atuais: l.votos,
        votos_projetados: l.votos,
        pct_atual: l.pct,
        pct_projetado: l.pct,
        pct_projetado_lower: l.pct - 1,
        pct_projetado_upper: l.pct + 1,
        p_vitoria: 0,
        rank: i + 1,
        p_passa_2t: 0,
        p_fecha_1t: 0,
        ...dest(l),
      }) as EdgeCandidate,
  );
}

function ufRow(linhas: readonly Linha[]): EdgeUfRow {
  return {
    sigla: "SP",
    pct_apurado: 40,
    lider: 1,
    margem_atual: 17.65,
    margem_projetada: 17.65,
    margem_projetada_ci: [15, 20],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: linhas.map((l) => ({
      id: l.id,
      pct: l.pct,
      pct_atual: l.pct,
      votos_atuais: l.votos,
      nome: l.nome,
      partido: l.partido,
      ...dest(l),
    })),
    vai_a_2t: false,
    bucket: "vai_2t",
  };
}

const painel = (linhas: readonly Linha[], vagas?: number) =>
  parse(
    <ResultPanel candidatos={painelCands(linhas)} pctApurado={40} {...(vagas ? { vagas } : {})} />,
  );
const linhaDe = (doc: Document, nome: string) =>
  Array.from(doc.querySelectorAll("li")).find(
    (li) => li.querySelector('[data-testid="candidate-result-name"]')?.textContent === nome,
  );

// ---------------------------------------------------------------------------
// A lista do `<ResultPanel>` (e da `<CandidateResultRow>`)
// ---------------------------------------------------------------------------

describe("opção A — a lista de resultado", () => {
  const doc = painel(PUBLICADO);

  it("Ana aparece com 52,9% (o percentual publicado sobre os votos em disputa)", () => {
    expect(linhaDe(doc, "Ana")?.textContent).toContain("52,9%");
    expect(linhaDe(doc, "Carla")?.textContent).toContain("11,8%");
  });

  it("🔴 Davi vem no fim, com '—', etiqueta e SÓ os votos — sem % e sem barra [mutação: anulada volta a mostrar %]", () => {
    const nomes = Array.from(doc.querySelectorAll('[data-testid="candidate-result-name"]')).map(
      (n) => n.textContent,
    );
    expect(nomes.at(-1)).toBe("Davi");
    const davi = linhaDe(doc, "Davi");
    expect(davi?.querySelector("[aria-hidden='true']")?.textContent).toBe("—");
    expect(davi?.querySelector('[data-testid="destino-etiqueta"]')?.textContent).toBe(", Anulado");
    expect(davi?.querySelector('[data-testid="candidate-result-votos-anulada"]')?.textContent).toBe(
      "15.000votos",
    );
    expect(davi?.textContent).not.toMatch(/%/);
    expect(davi?.querySelector('[data-testid="result-bar"]')).toBeNull();
  });

  it("a frase da metodologia é a do dono, e só existe com anulada", () => {
    expect(q(doc, "result-nota-anuladas")?.textContent).toBe(NOTA_ANULADAS);
    expect(q(painel(SEM_ANULADA), "result-nota-anuladas")).toBeNull();
  });

  it("🔴 o total de votos da nota soma só quem compete: 85 mil em disputa, nunca 100 mil [mutação: soma inclui a anulada]", () => {
    const figs = doc.body.textContent ?? "";
    expect(figs).toContain("85 mil de");
    expect(figs).toContain("votos em disputa");
    expect(figs).not.toContain("100 mil de");
  });

  it("🔴 a barra de maioria: 'Outros' = 100 − Ana − Bruno = Carla (11,8%), nunca somando Davi", () => {
    const rotulo = doc.querySelector('[data-testid="vote-bar-track"]')?.getAttribute("aria-label");
    expect(rotulo).toContain("Outros 11,8%");
  });

  it("Senado (duas vagas): a nota sem a regra dos 50% — ela seria falsa lá", () => {
    expect(q(painel(PUBLICADO, 2), "result-nota-anuladas")?.textContent).toBe(
      NOTA_ANULADAS_SEM_REGRA_1T,
    );
  });

  it("sem voto absoluto no dado, a linha da anulada fica só com nome e etiqueta — nunca '0 votos' nem '—'", () => {
    const semVotos = painelCands(PUBLICADO).map((c) => {
      if (c.id !== 4) return c;
      // Payload legado/fallback: o campo pode faltar em runtime mesmo sendo
      // obrigatório no tipo — é o caso que `?? null` da linha cobre.
      const { votos_atuais: _v, ...resto } = c;
      return resto as ResultPanelCandidate;
    });
    const d = parse(<ResultPanel candidatos={semVotos} pctApurado={40} />);
    const davi = linhaDe(d, "Davi");
    expect(davi?.querySelector('[data-testid="candidate-result-votos-anulada"]')?.textContent).toBe(
      "",
    );
    expect(davi?.textContent).not.toMatch(/%|votos/);
  });
});

describe("opção A — sem anulada, nada muda", () => {
  it("🔴 Davi competindo: 15,0% com barra, sem nota, total 'votos válidos' de 100 mil", () => {
    const doc = painel(SEM_ANULADA);
    const davi = linhaDe(doc, "Davi");
    expect(davi?.textContent).toContain("15,0%");
    expect(davi?.querySelector('[data-testid="result-bar"]')).not.toBeNull();
    expect(davi?.querySelector('[data-testid="candidate-result-votos-anulada"]')).toBeNull();
    expect(doc.body.textContent).toContain("100 mil de");
    expect(doc.body.textContent).toContain("votos válidos");
    expect(doc.body.textContent).not.toContain("em disputa");
  });

  it("sub judice sem anulada: a linha é a de sempre (percentual, barra), só com a etiqueta", () => {
    const carla = linhaDe(painel(SEM_ANULADA), "Carla");
    expect(carla?.textContent).toContain("10,0%");
    expect(carla?.querySelector('[data-testid="result-bar"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// As outras listas
// ---------------------------------------------------------------------------

describe("opção A — as outras superfícies", () => {
  it("ficha do estado: Ana 52,9%, Davi só com votos, e a nota do dono", () => {
    const doc = parse(
      <StateResultSheet
        open
        onClose={() => {}}
        row={ufRow(PUBLICADO)}
        candidatos={nacionais(PUBLICADO)}
        cargo="gov"
        viewMode="parcial"
      />,
    );
    const itens = Array.from(doc.querySelectorAll('[data-testid="state-sheet-candidatos"] > li'));
    expect(itens[0]?.textContent).toContain("52,9%");
    const davi = itens.at(-1);
    expect(davi?.textContent).toContain("Davi");
    expect(davi?.textContent).not.toMatch(/%/);
    expect(q(davi as Element, "state-sheet-cand-votos-anulada")?.textContent).toBe("15.000 votos");
    expect(q(doc, "state-sheet-nota-anuladas")?.textContent).toBe(NOTA_ANULADAS);
  });

  it("ficha de Senado: a nota sem a regra dos 50%", () => {
    const doc = parse(
      <StateResultSheet
        open
        onClose={() => {}}
        row={ufRow(PUBLICADO)}
        candidatos={nacionais(PUBLICADO)}
        cargo="sen"
        viewMode="parcial"
      />,
    );
    expect(q(doc, "state-sheet-nota-anuladas")?.textContent).toBe(NOTA_ANULADAS_SEM_REGRA_1T);
  });

  it("cartão de governador: Davi sem barra e sem %, com os votos; o líder é Ana a 52,9%", () => {
    const doc = parse(<GovernorCard uf={ufRow(PUBLICADO)} candidatos={nacionais(PUBLICADO)} />);
    const itens = Array.from(doc.querySelectorAll("ul > li"));
    const davi = itens.find((li) => li.textContent?.includes("Davi"));
    expect(davi?.textContent).not.toMatch(/%/);
    expect(q(davi as Element, "governor-card-votos-anulada")?.textContent).toBe("15 mil votos");
    expect(davi?.querySelector(".relative.h-2")).toBeNull();
    expect(doc.querySelector("article")?.getAttribute("aria-label")).toContain(
      "líder: Ana (PT) com 52,9%",
    );
  });

  it("listas acessíveis (ranking menor): a anulada é dita com os votos, nunca com o %", () => {
    const doc = parse(<MinorCandidatesList candidatos={nacionais(PUBLICADO)} />);
    const rotulos = Array.from(doc.querySelectorAll("li")).map((li) =>
      li.getAttribute("aria-label"),
    );
    expect(rotulos.at(-1)).toBe("Davi, Anulado (NOVO): 15.000 votos");
    expect(rotulos[0]).toContain("52,9% apurado");
  });

  it("descrição acessível da UF: Davi com os votos e a etiqueta, sem '15,0%'", () => {
    const d = descricaoCandidaturasUf(ufRow(PUBLICADO));
    expect(d).toContain("Davi (NOVO) 15.000 votos, Anulado");
    expect(d).toContain("Ana (PT) 52,9%");
    expect(d).not.toContain("15,0%");
  });

  it("resumo do 1º turno: Davi com os votos, Ana com o percentual", () => {
    // Na ordem de `rank` do payload (sobre `vvc`): Davi (15) é o 3º, à frente
    // de Carla (10) — é assim que ele entra no top-3 do resumo.
    const porRank = [PUBLICADO[0], PUBLICADO[1], PUBLICADO[3], PUBLICADO[2]] as Linha[];
    const recap = { national: { candidatos: nacionais(porRank) } } as unknown as EdgePayload;
    const doc = parse(<TurnoOneRecap recap={recap} />);
    const rotulos = Array.from(doc.querySelectorAll("ul li")).map((li) =>
      li.getAttribute("aria-label"),
    );
    expect(rotulos).toContain("Davi, Anulado (NOVO): 15.000 votos");
    expect(rotulos.find((r) => r?.startsWith("Ana"))).toContain("52,9%");
  });

  it("🔴 balão (todos os mapas passam pelo mesmo átomo): a linha da anulada não tem Parcial nem Proj. [mutação: sem o portão no átomo]", () => {
    const rows: HoverCardRow[] = PUBLICADO.map((l) => ({
      name: l.nome,
      color: "var(--party-outros-text)",
      partido: l.partido,
      votos: l.votos,
      pct: l.pct,
      proj: l.pct,
      ...dest(l),
    }));
    const doc = parse(<HoverCard x={0} y={0} title="São Paulo" rows={rows} />);
    expect(doc.querySelectorAll('[data-testid="hover-card-parcial"]')).toHaveLength(3);
    expect(doc.querySelectorAll('[data-testid="hover-card-proj"]')).toHaveLength(3);
    const textos = Array.from(doc.querySelectorAll('[data-testid="hover-card-parcial"]')).map(
      (e) => e.textContent,
    );
    expect(textos).not.toContain("15,0%");
    expect(doc.querySelectorAll('[data-testid="hover-card-votos"]')).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Município — a conta é da tela, e o denominador é o dos votos em disputa
// ---------------------------------------------------------------------------

describe("opção A — município (a tela calcula o %)", () => {
  const cand = (l: Linha): EdgeUfCandidate => ({
    id: l.id,
    nome: l.nome,
    partido: l.partido,
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: 0,
    pct_projetado: 0,
    ci95: { lower: 0, upper: 0 },
    ...dest(l),
  });
  const mun = (linhas: readonly Linha[]): EdgeUfMunicipio => ({
    cod_ibge: "3550308",
    nome: "São Paulo",
    pct_apurado: 40,
    lider: { candidato_id: 1, partido: "PT", votos: 450, margem_pp: 17.65 },
    votos_reportados: Object.fromEntries(linhas.map((l) => [String(l.id), l.votos / 100])),
  });

  it("🔴 o denominador tira os votos da anulada: Ana 450/850 = 52,94%, Davi null [mutação: total com a anulada]", () => {
    const v = votosPorCandidatoMunicipio(mun(PUBLICADO), PUBLICADO.map(cand));
    const ana = v.find((x) => x.id === 1);
    expect(ana?.pct).toBeCloseTo((450 / 850) * 100, 10);
    expect(v.find((x) => x.id === 3)?.pct).toBeCloseTo((100 / 850) * 100, 10);
    const davi = v.at(-1);
    expect(davi?.id).toBe(4);
    expect(davi?.pct).toBeNull();
    expect(davi?.votos).toBe(150);
    // Σ dos % de quem compete fecha em 100 — sem a anulada.
    const soma = v.reduce((s, x) => s + (x.pct ?? 0), 0);
    expect(soma).toBeCloseTo(100, 10);
  });

  it("folha do município: Davi só com votos e sem barra; Ana 52,9%; a nota sem a regra dos 50%", () => {
    // biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    useMunicipioSheetStore.getState().clear();
    act(() => {
      root.render(
        <MunicipioExplorer
          ufSigla="SP"
          municipios={[mun(PUBLICADO)]}
          rows={[]}
          candidatos={PUBLICADO.map(cand)}
        />,
      );
    });
    act(() => {
      useMunicipioSheetStore.getState().select("3550308");
    });
    const linhas = Array.from(host.querySelectorAll('[data-testid="municipio-sheet-row"]'));
    expect(linhas[0]?.textContent).toContain("52,9%");
    const davi = linhas.at(-1);
    expect(davi?.textContent).toContain("Davi");
    expect(davi?.textContent).not.toMatch(/%/);
    expect(q(davi as Element, "municipio-sheet-votos-anulada")?.textContent).toBe("150 votos");
    expect(davi?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1); // só o "—"
    expect(q(host, "municipio-sheet-nota-anuladas")?.textContent).toBe(NOTA_ANULADAS_SEM_REGRA_1T);
    act(() => root.unmount());
    host.remove();
    useMunicipioSheetStore.getState().clear();
  });

  it("sem anulada, o denominador é o total de sempre (Davi 150/1.000 = 15%)", () => {
    const v = votosPorCandidatoMunicipio(mun(SEM_ANULADA), SEM_ANULADA.map(cand));
    expect(v.find((x) => x.id === 4)?.pct).toBeCloseTo(15, 10);
    expect(v.find((x) => x.id === 1)?.pct).toBeCloseTo(45, 10);
  });
});

// ---------------------------------------------------------------------------
// A régua do desfecho — o % publicado já está na base certa
// ---------------------------------------------------------------------------

describe("opção A — desfecho pela contagem", () => {
  it("🔴 Ana 52,94% dos votos em disputa ⇒ eleita no 1º turno; a anulada não entra na conta", () => {
    expect(classificarContagem(ufRow(PUBLICADO))).toBe("eleito_1t");
  });
});

// ---------------------------------------------------------------------------
// "A corrida" (spec 022)
// ---------------------------------------------------------------------------

describe("opção A — 'A corrida'", () => {
  const corrida = PUBLICADO.map((l) => ({
    id: l.id,
    partido: l.partido,
    votos: l.votos,
    destino: l.destino ?? ("valido" as const),
  }));
  const votacao: EdgeVotacao = {
    contagens: {
      validos: 75_000,
      sub_judice: 10_000,
      anulados: 15_000,
      brancos: 3_000,
      nulos: 2_000,
      comparecimento: 105_000,
      abstencao: 20_000,
      instalados: 125_000,
      aptos: 150_000,
    },
    corrida,
    projetada: { validos: 180_000, brancos: 6_000, nulos: 4_000, abstencao: 40_000 },
  };
  const candidatos = PUBLICADO.map((l) => ({
    id: l.id,
    nome: l.nome,
    votos_projetados: l.votos * 2,
  }));
  const doc = parse(
    <CorridaTresCirculos modo="candidatura" votacao={votacao} candidatos={candidatos} />,
  );

  it("🔴 círculo 1: base 85.000 (votos em disputa) e Carla é fatia [mutação: círculo 1 sem sub judice]", () => {
    const c1 = q(doc, "corrida-circulo-1");
    expect(c1?.getAttribute("data-total")).toBe("85000");
    expect(c1?.getAttribute("data-soma-abs")).toBe("85000");
    expect(q(doc, "corrida-circulo-1-base")?.textContent).toBe("votos em disputa");
    const carla = q(doc, "corrida-circulo-1-legenda-cand-3");
    expect(carla?.getAttribute("data-abs")).toBe("10000");
    expect(carla?.textContent).toContain("Carla · PSB (Sub judice)");
    expect(q(doc, "corrida-circulo-1-legenda-cand-4")).toBeNull();
    expect(q(doc, "corrida-circulo-1-legenda-cand-1")?.textContent).toContain("52,9%");
  });

  it("🔴 círculos 2 e 3: 'Anulados' = van (15.000), sem o sub judice [mutação: fatia com sub judice]", () => {
    for (const n of [2, 3] as const) {
      const li = q(doc, `corrida-circulo-${n}-legenda-anulados`);
      expect(li?.getAttribute("data-abs")).toBe("15000");
      expect(li?.textContent).toContain("Anulados");
      const fig = q(doc, `corrida-circulo-${n}`);
      expect(fig?.getAttribute("data-soma-abs")).toBe(fig?.getAttribute("data-total"));
    }
  });

  it("modo PARTIDO fica como era: círculo 1 sobre os válidos, 'Anulados e sub judice' = van + vansj", () => {
    // `corrida_por_partido` só traz voto válido: o sub judice não tem partido
    // a que ser atribuído, e segue na fatia neutra de sempre.
    const d = parse(
      <CorridaTresCirculos
        modo="partido"
        votacao={{
          contagens: votacao.contagens,
          corrida_por_partido: [
            { partido: "PT", votos_validos: 45_000 },
            { partido: "PL", votos_validos: 30_000 },
          ],
        }}
      />,
    );
    expect(q(d, "corrida-circulo-1")?.getAttribute("data-total")).toBe("75000");
    expect(q(d, "corrida-circulo-1-base")?.textContent).toBe("votos válidos");
    const li = q(d, "corrida-circulo-2-legenda-anulados");
    expect(li?.getAttribute("data-abs")).toBe("25000");
    expect(li?.textContent).toContain("Anulados e sub judice");
  });

  it("projeção: total = válidos projetados + projeção da sub judice (180.000 + 20.000)", () => {
    const fig = q(doc, "corrida-projecao");
    expect(fig?.getAttribute("data-total")).toBe("200000");
    expect(fig?.getAttribute("data-soma-abs")).toBe("200000");
    expect(q(doc, "corrida-projecao-legenda-cand-4")).toBeNull();
    expect(q(doc, "corrida-projecao-legenda-cand-3")).not.toBeNull();
  });
});
