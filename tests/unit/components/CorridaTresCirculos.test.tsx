// @vitest-environment happy-dom
/**
 * tests/unit/components/CorridaTresCirculos.test.tsx
 *
 * Unit tests do painel `<CorridaTresCirculos />` — spec 022, a corrida em três
 * círculos (RF-200 a RF-210, lado da tela).
 *
 * ## As fixtures são montadas à mão, e o que elas precisam discriminar
 *
 * Os JSON de `tests/fixtures/simulacao/` ainda não têm `votacao.corrida`. As
 * contagens aqui saem de {@link contagensDe}, que DERIVA `validos`,
 * `anulados` e `sub_judice` da própria corrida — a identidade do TSE que o
 * painel confere. Cada teste de "não fecha" quebra UMA base de cada vez, e as
 * outras duas continuam fechando: senão o teste passaria com a checagem do
 * círculo errado.
 *
 * 🔴 A fixture principal espelha a captura real do simulado
 * (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`), onde o MAIS votado
 * do arquivo era `"Anulado sub judice"`: aqui a candidatura 44 (sub judice)
 * tem 11 mi, mais que qualquer válida (a maior tem 10 mi). Um filtro de
 * destinação ausente a poria em 1º lugar.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { candidateColor } from "@/components/blocks/_candidateColor";
import {
  CorridaTresCirculos,
  circuloAptos,
  circuloComparecimento,
  circuloValidos,
  destinacaoPendente,
  fatiasDaCorrida,
  ordenarCandidaturas,
  ordenarPartidos,
} from "@/components/blocks/CorridaTresCirculos";
import { VotacaoEleitorado } from "@/components/blocks/VotacaoEleitorado";
import type {
  EdgeCorridaEntrada,
  EdgeCorridaPartido,
  EdgeVotacao,
  EdgeVotacaoContagens,
} from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

const q = (doc: Document, testid: string) => doc.querySelector(`[data-testid="${testid}"]`);
const legendaKeys = (doc: Document, circulo: 1 | 2 | 3) =>
  [...doc.querySelectorAll(`[data-testid="corrida-circulo-${circulo}-legenda"] li`)].map((li) =>
    (li.getAttribute("data-testid") ?? "").replace(`corrida-circulo-${circulo}-legenda-`, ""),
  );

/**
 * Contagens COERENTES com a corrida, pela identidade do TSE:
 *   validos = Σ válidos · anulados = Σ anulado · sub_judice = Σ sub_judice
 *   comparecimento = validos + brancos + nulos + anulados + sub_judice
 *   instalados = comparecimento + abstencao · aptos = instalados + naoApurado
 */
function contagensDe(
  corrida: readonly EdgeCorridaEntrada[],
  extra: { brancos: number; nulos: number; abstencao: number; naoApurado: number },
): EdgeVotacaoContagens {
  const soma = (d: string) =>
    corrida.filter((e) => e.destino === d).reduce((s, e) => s + e.votos, 0);
  const validos = soma("valido");
  const anulados = soma("anulado");
  const sub_judice = soma("sub_judice");
  const comparecimento = validos + extra.brancos + extra.nulos + anulados + sub_judice;
  const instalados = comparecimento + extra.abstencao;
  return {
    aptos: instalados + extra.naoApurado,
    instalados,
    comparecimento,
    abstencao: extra.abstencao,
    validos,
    brancos: extra.brancos,
    nulos: extra.nulos,
    anulados,
    sub_judice,
  };
}

const EXTRA = {
  brancos: 3_000_000,
  nulos: 2_000_000,
  abstencao: 12_000_000,
  naoApurado: 40_000_000,
};

/**
 * Seis válidas + uma sub judice (a MAIS votada) + uma anulada. Chegam fora de
 * ordem de propósito — a ordem de chegada não pode decidir nada.
 */
function corridaReal(): EdgeCorridaEntrada[] {
  return [
    { id: 30, partido: "NOVO", votos: 2_000_000, destino: "valido" },
    { id: 44, partido: "UNIAO", votos: 11_000_000, destino: "sub_judice" },
    { id: 22, partido: "PL", votos: 9_000_000, destino: "valido" },
    { id: 90, partido: "PCO", votos: 2_000_000, destino: "anulado" },
    { id: 13, partido: "PT", votos: 10_000_000, destino: "valido" },
    { id: 12, partido: "PDT", votos: 3_000_000, destino: "valido" },
    { id: 50, partido: "PSOL", votos: 1_500_000, destino: "valido" },
    { id: 15, partido: "MDB", votos: 4_000_000, destino: "valido" },
  ];
}

function votacaoDe(corrida: EdgeCorridaEntrada[], over: Partial<EdgeVotacao> = {}): EdgeVotacao {
  return { contagens: contagensDe(corrida, EXTRA), corrida, ...over };
}

const CANDIDATOS = [
  { id: 13, nome: "Ana Tereza" },
  { id: 22, nome: "Bruno Lima" },
  { id: 15, nome: "Carla Dias" },
  { id: 12, nome: "Davi Souza" },
  { id: 44, nome: "Eduardo Sub Judice" },
  { id: 90, nome: "Fábio Anulado" },
];

// ---------------------------------------------------------------------------
// RF-203 — o filtro de destinação
// ---------------------------------------------------------------------------

describe("RF-203 — só voto válido entra em fatia com nome", () => {
  it("🔴 a candidatura sub judice MAIS votada fica fora — o 1º é o maior VÁLIDO", () => {
    const ord = ordenarCandidaturas(corridaReal());
    expect(ord.map((c) => c.key)).toEqual([
      "cand-13",
      "cand-22",
      "cand-15",
      "cand-12",
      "cand-30",
      "cand-50",
    ]);
  });

  it("🔴 nem anulado, nem sub judice, nem sem destino entram", () => {
    const ord = ordenarCandidaturas([
      { id: 1, partido: "PT", votos: 9, destino: "anulado" },
      { id: 2, partido: "PL", votos: 8, destino: "sub_judice" },
      { id: 3, partido: "MDB", votos: 7 },
      { id: 4, partido: "PDT", votos: 6, destino: "valido" },
    ]);
    expect(ord.map((c) => c.key)).toEqual(["cand-4"]);
  });

  it("no render, a sub judice não aparece em legenda nenhuma, nem pelo nome", () => {
    const doc = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacaoDe(corridaReal())}
        candidatos={CANDIDATOS}
      />,
    );
    for (const n of [1, 2, 3] as const) {
      expect(legendaKeys(doc, n)).not.toContain("cand-44");
      expect(legendaKeys(doc, n)).not.toContain("cand-90");
    }
    expect(doc.body.textContent).not.toContain("Eduardo Sub Judice");
    expect(doc.body.textContent).not.toContain("Fábio Anulado");
    expect(legendaKeys(doc, 1)[0]).toBe("cand-13");
  });

  it("os votos sub judice e anulados vão para 'Anulados e sub judice' nos círculos 2 e 3", () => {
    const doc = parse(
      <CorridaTresCirculos modo="candidatura" votacao={votacaoDe(corridaReal())} />,
    );
    for (const n of [2, 3] as const) {
      const li = q(doc, `corrida-circulo-${n}-legenda-anulados`);
      expect(li?.getAttribute("data-abs")).toBe(String(13_000_000));
      expect(li?.textContent).toContain("Anulados e sub judice");
    }
    expect(q(doc, "corrida-circulo-1-legenda-anulados")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RF-202 — quatro mais "Outros", e o desempate
// ---------------------------------------------------------------------------

describe("RF-202 — as fatias da corrida", () => {
  it("quatro com fatia própria e 'Outros' com a soma das demais válidas", () => {
    const f = fatiasDaCorrida(ordenarCandidaturas(corridaReal()));
    expect(f.map((x) => x.key)).toEqual(["cand-13", "cand-22", "cand-15", "cand-12", "outros"]);
    expect(f.at(-1)?.abs).toBe(3_500_000); // 30 (2 mi) + 50 (1,5 mi)
  });

  it("🔴 desempate pelo NÚMERO de urna crescente, nas duas ordens de chegada", () => {
    // O 4º lugar é disputado por 40 e 12, empatados. Ganha o 12.
    const base: EdgeCorridaEntrada[] = [
      { id: 13, partido: "PT", votos: 10, destino: "valido" },
      { id: 22, partido: "PL", votos: 9, destino: "valido" },
      { id: 15, partido: "MDB", votos: 8, destino: "valido" },
      { id: 40, partido: "PSB", votos: 3, destino: "valido" },
      { id: 12, partido: "PDT", votos: 3, destino: "valido" },
    ];
    for (const corrida of [base, [...base].reverse()]) {
      const f = fatiasDaCorrida(ordenarCandidaturas(corrida));
      expect(f.map((x) => x.key)).toEqual(["cand-13", "cand-22", "cand-15", "cand-12", "outros"]);
      expect(f.at(-1)?.abs).toBe(3);
    }
  });

  it("🔴 partido: desempate pela SIGLA crescente, nas duas ordens de chegada", () => {
    const base: EdgeCorridaPartido[] = [
      { partido: "PT", votos_validos: 10 },
      { partido: "PSB", votos_validos: 5 },
      { partido: "MDB", votos_validos: 7 },
      { partido: "PDT", votos_validos: 5 },
      { partido: "PL", votos_validos: 9 },
      { partido: "NOVO", votos_validos: 1 },
    ];
    for (const p of [base, [...base].reverse()]) {
      expect(fatiasDaCorrida(ordenarPartidos(p)).map((x) => x.key)).toEqual([
        "partido-PT",
        "partido-PL",
        "partido-MDB",
        "partido-PDT",
        "outros",
      ]);
    }
  });

  it("🔴 'Outros' some do arco E da legenda quando não há demais", () => {
    const corrida: EdgeCorridaEntrada[] = [
      { id: 13, partido: "PT", votos: 5_000_000, destino: "valido" },
      { id: 22, partido: "PL", votos: 4_000_000, destino: "valido" },
      { id: 15, partido: "MDB", votos: 1_000_000, destino: "valido" },
    ];
    const doc = parse(<CorridaTresCirculos modo="candidatura" votacao={votacaoDe(corrida)} />);
    for (const n of [1, 2, 3] as const) {
      expect(legendaKeys(doc, n)).not.toContain("outros");
      expect(q(doc, `corrida-circulo-${n}-fatia-outros`)).toBeNull();
    }
    expect(legendaKeys(doc, 1)).toEqual(["cand-13", "cand-22", "cand-15"]);
  });

  it("com exatamente cinco válidas, 'Outros' é a quinta", () => {
    const corrida = corridaReal().filter((e) => e.id !== 50);
    const doc = parse(<CorridaTresCirculos modo="candidatura" votacao={votacaoDe(corrida)} />);
    expect(q(doc, "corrida-circulo-1-legenda-outros")?.getAttribute("data-abs")).toBe("2000000");
  });
});

// ---------------------------------------------------------------------------
// RF-204..206 — os três círculos fecham, ou dizem que não fecham
// ---------------------------------------------------------------------------

describe("RF-204..206 — cada círculo fecha na sua base", () => {
  const corrida = corridaReal();
  const c = contagensDe(corrida, EXTRA);
  const fatias = fatiasDaCorrida(ordenarCandidaturas(corrida));

  it("🔴 as três identidades fecham na unidade", () => {
    const soma = (f: { abs: number }[] | null) => (f ?? []).reduce((s, x) => s + x.abs, 0);
    expect(soma(circuloValidos(fatias, c))).toBe(c.validos);
    expect(soma(circuloComparecimento(fatias, c))).toBe(c.comparecimento);
    expect(soma(circuloAptos(fatias, c))).toBe(c.aptos);
  });

  it("círculo 2 = corrida + brancos + nulos + anulados; círculo 3 + abstenção + não apurado", () => {
    expect(circuloComparecimento(fatias, c)?.map((f) => f.key)).toEqual([
      "cand-13",
      "cand-22",
      "cand-15",
      "cand-12",
      "outros",
      "brancos",
      "nulos",
      "anulados",
    ]);
    const c3 = circuloAptos(fatias, c);
    expect(c3?.map((f) => f.key).slice(-2)).toEqual(["abstencao", "nao_apurado"]);
    expect(c3?.find((f) => f.key === "nao_apurado")?.abs).toBe(c.aptos - c.instalados);
  });

  it("os percentuais são sobre a base de CADA círculo", () => {
    expect(circuloValidos(fatias, c)?.[0]?.pct).toBeCloseTo((10_000_000 / c.validos) * 100, 8);
    expect(circuloComparecimento(fatias, c)?.[0]?.pct).toBeCloseTo(
      (10_000_000 / c.comparecimento) * 100,
      8,
    );
    expect(circuloAptos(fatias, c)?.[0]?.pct).toBeCloseTo((10_000_000 / c.aptos) * 100, 8);
  });

  it("🔴 círculo 1 não fecha por UM voto ⇒ null, e só ele", () => {
    const torto = { ...c, validos: c.validos + 1 };
    expect(circuloValidos(fatias, torto)).toBeNull();
    expect(circuloComparecimento(fatias, torto)).not.toBeNull();
    expect(circuloAptos(fatias, torto)).not.toBeNull();
  });

  it("🔴 círculo 2 não fecha por UM voto ⇒ null, e só ele", () => {
    const torto = { ...c, comparecimento: c.comparecimento - 1 };
    expect(circuloValidos(fatias, torto)).not.toBeNull();
    expect(circuloComparecimento(fatias, torto)).toBeNull();
    expect(circuloAptos(fatias, torto)).not.toBeNull();
  });

  it("🔴 círculo 3 não fecha por UM eleitor ⇒ null, e só ele", () => {
    const torto = { ...c, instalados: c.instalados - 1 };
    expect(circuloValidos(fatias, torto)).not.toBeNull();
    expect(circuloComparecimento(fatias, torto)).not.toBeNull();
    expect(circuloAptos(fatias, torto)).toBeNull();
  });

  it("🔴 fatia negativa com a soma batendo ⇒ null (a guarda de soma sozinha não pega)", () => {
    // `aptos < instalados` dá "não apurado" negativo; `aptos` baixado junto
    // mantém a soma batendo.
    const torto = {
      ...c,
      instalados: c.aptos + 5,
      abstencao: c.abstencao + 5 + (c.aptos - c.instalados),
    };
    // soma das fatias do c3 = corrida+brancos+nulos+anulados+abstencao+(aptos−instalados)
    //                       = comparecimento + (abstencao+5+naoAp) + (−5) = aptos
    expect(circuloAptos(fatias, torto)).toBeNull();
    const negCorrida = [{ key: "x", label: "x", abs: -1, pintura: { fill: "x" } }, ...fatias];
    expect(circuloValidos(negCorrida, { ...c, validos: c.validos - 1 })).toBeNull();
  });

  it("no DOM, cada círculo que não fecha diz 'não fecha' e NÃO desenha", () => {
    const casos: [1 | 2 | 3, Partial<EdgeVotacaoContagens>][] = [
      [1, { validos: c.validos + 1 }],
      [2, { comparecimento: c.comparecimento + 1 }],
      // `aptos` sozinho NÃO serve: "não apurado" é `aptos − instalados` e
      // cresce junto, e o círculo 3 fecha por construção. Quem o quebra é
      // uma abstenção que não bate com `instalados − comparecimento`.
      [3, { abstencao: c.abstencao + 1 }],
    ];
    for (const [n, over] of casos) {
      const doc = parse(
        <CorridaTresCirculos
          modo="candidatura"
          votacao={{ contagens: { ...c, ...over }, corrida }}
        />,
      );
      const aviso = q(doc, `corrida-circulo-${n}-nao-fecha`);
      expect(aviso?.textContent).toMatch(/não fecha/i);
      expect(q(doc, `corrida-circulo-${n}`)?.querySelector("svg")).toBeNull();
      expect(q(doc, `corrida-circulo-${n}-legenda`)).toBeNull();
      // os outros dois continuam desenhados
      for (const m of ([1, 2, 3] as const).filter((x) => x !== n)) {
        expect(q(doc, `corrida-circulo-${m}`)?.querySelector("svg"), `círculo ${m}`).not.toBeNull();
      }
    }
  });

  it("apurando: 5, 8 e 10 fatias, e o arco fecha em 100% (soma == total)", () => {
    const doc = parse(<CorridaTresCirculos modo="candidatura" votacao={votacaoDe(corrida)} />);
    expect(legendaKeys(doc, 1)).toHaveLength(5);
    expect(legendaKeys(doc, 2)).toHaveLength(8);
    expect(legendaKeys(doc, 3)).toHaveLength(10);
    for (const n of [1, 2, 3] as const) {
      const fig = q(doc, `corrida-circulo-${n}`);
      expect(fig?.getAttribute("data-soma-abs")).toBe(fig?.getAttribute("data-total"));
    }
    expect(q(doc, "corrida-circulo-1")?.getAttribute("data-total")).toBe(String(c.validos));
    expect(q(doc, "corrida-circulo-2")?.getAttribute("data-total")).toBe(String(c.comparecimento));
    expect(q(doc, "corrida-circulo-3")?.getAttribute("data-total")).toBe(String(c.aptos));
  });
});

// ---------------------------------------------------------------------------
// RF-207 / RF-210 — os estados
// ---------------------------------------------------------------------------

describe("RF-207 — os estados, e nenhum fabrica zero", () => {
  const TRES = [1, 2, 3] as const;

  it("`votacao` ausente ⇒ <DetailUnavailable>, e nenhum círculo", () => {
    for (const v of [undefined, null]) {
      const doc = parse(<CorridaTresCirculos modo="candidatura" votacao={v} />);
      expect(q(doc, "detail-unavailable")).not.toBeNull();
      expect(doc.querySelectorAll("figure")).toHaveLength(0);
      expect(q(doc, "panel")).not.toBeNull();
    }
  });

  it("🔴 `corrida` ausente ⇒ <DetailUnavailable> (não sabemos), mesmo com contagens", () => {
    const v = votacaoDe(corridaReal());
    delete v.corrida;
    const doc = parse(<CorridaTresCirculos modo="candidatura" votacao={v} />);
    expect(q(doc, "detail-unavailable")).not.toBeNull();
    expect(doc.querySelectorAll("figure")).toHaveLength(0);
  });

  it("🔴 `destino_pendente` ⇒ os TRÊS em 'aguardando a separação dos votos válidos'", () => {
    const doc = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacaoDe(corridaReal(), { destino_pendente: true })}
      />,
    );
    for (const n of TRES) {
      const el = q(doc, `corrida-circulo-${n}-aguardando-destino`);
      expect(el?.textContent).toMatch(/aguardando a separação dos votos válidos/i);
    }
    expect(doc.querySelectorAll("svg")).toHaveLength(0);
    expect(q(doc, "detail-unavailable")).toBeNull();
  });

  it("🔴 entrada com votos e SEM destino ⇒ aguardando, mesmo sem a flag", () => {
    const corrida = corridaReal();
    const semDestino = corrida.map((e) => (e.id === 22 ? { ...e, destino: undefined } : e));
    const doc = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={{ contagens: contagensDe(corrida, EXTRA), corrida: semDestino }}
      />,
    );
    for (const n of TRES) expect(q(doc, `corrida-circulo-${n}-aguardando-destino`)).not.toBeNull();
  });

  it("entrada SEM votos e sem destino não trava o painel", () => {
    const corrida = [...corridaReal(), { id: 77, partido: "PMB", votos: 0 }];
    expect(destinacaoPendente({ corrida })).toBe(false);
    expect(destinacaoPendente({ corrida: [{ id: 77, partido: "PMB", votos: 1 }] })).toBe(true);
  });

  it("🔴 destino DESCONHECIDO não vira válido — é pendente", () => {
    const estranho = {
      id: 5,
      partido: "PT",
      votos: 3,
      destino: "Válido",
    } as unknown as EdgeCorridaEntrada;
    expect(destinacaoPendente({ corrida: [estranho] })).toBe(true);
    expect(ordenarCandidaturas([estranho])).toEqual([]);
  });

  it("🔴 validos == 0 ⇒ círculos 1 e 2 'sem votos apurados' — nunca '0,0%'", () => {
    const corrida: EdgeCorridaEntrada[] = [
      { id: 13, partido: "PT", votos: 0, destino: "valido" },
      { id: 22, partido: "PL", votos: 0, destino: "valido" },
    ];
    const zerado = contagensDe(corrida, {
      brancos: 0,
      nulos: 0,
      abstencao: 0,
      naoApurado: 100_000_000,
    });
    const doc = parse(
      <CorridaTresCirculos modo="candidatura" votacao={{ contagens: zerado, corrida }} />,
    );
    for (const n of [1, 2] as const) {
      const fig = q(doc, `corrida-circulo-${n}`);
      expect(q(doc, `corrida-circulo-${n}-sem-votos`)?.textContent).toMatch(/sem votos apurados/i);
      expect(fig?.textContent).not.toMatch(/0,0\s?%/);
      expect(fig?.querySelector("svg")).toBeNull();
    }
    // Círculo 3 segue o RF-206: quase todo (aqui, todo) "Ainda não apurado".
    expect(legendaKeys(doc, 3)).toEqual(["nao_apurado"]);
    expect(q(doc, "corrida-tres-circulos")?.getAttribute("data-estado")).toBe("sem-votos");
  });
});

describe("RF-210 — Senado em 'aguardando'", () => {
  const TEXTO = "Este gráfico ainda não está disponível para o Senado.";

  it("🔴 os três em 'aguardando', no DOM, mesmo com dado íntegro", () => {
    const doc = parse(
      <CorridaTresCirculos modo="partido" senado votacao={votacaoDe(corridaReal())} />,
    );
    for (const n of [1, 2, 3] as const) {
      expect(q(doc, `corrida-circulo-${n}-aguardando-senado`)?.textContent).toContain(TEXTO);
    }
    expect(doc.querySelectorAll("svg")).toHaveLength(0);
  });

  it("🔴 e mesmo SEM `votacao` — é bloqueio da tela, não do dado", () => {
    const doc = parse(<CorridaTresCirculos modo="candidatura" senado votacao={undefined} />);
    expect(q(doc, "detail-unavailable")).toBeNull();
    expect(q(doc, "corrida-circulo-1-aguardando-senado")).not.toBeNull();
  });

  it("o texto ao leitor não tem jargão", () => {
    const doc = parse(<CorridaTresCirculos modo="partido" senado votacao={undefined} />);
    const t = q(doc, "corrida-circulo-1-aguardando-senado")?.textContent ?? "";
    expect(t).not.toMatch(/RF-|payload|vv|tv\b|captura|medi[çc]/i);
  });
});

// ---------------------------------------------------------------------------
// RF-201 — nome, sigla, partido
// ---------------------------------------------------------------------------

describe("RF-201 — candidatura e partido", () => {
  it("o nome vem da lista `candidatos`, cruzado por `id`", () => {
    const doc = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacaoDe(corridaReal())}
        candidatos={CANDIDATOS}
      />,
    );
    expect(q(doc, "corrida-circulo-1-legenda-cand-13")?.textContent).toContain("Ana Tereza · PT");
    expect(q(doc, "corrida-circulo-1-legenda-cand-22")?.textContent).toContain("Bruno Lima · PL");
  });

  it("🔴 sem nome, número e sigla — NUNCA um nome inventado", () => {
    const semBruno = CANDIDATOS.filter((c) => c.id !== 22).concat({ id: 15, nome: "  " });
    const doc = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacaoDe(corridaReal())}
        candidatos={semBruno.filter((c) => !(c.id === 15 && c.nome === "Carla Dias"))}
      />,
    );
    expect(q(doc, "corrida-circulo-1-legenda-cand-22")?.textContent).toContain(
      "Candidatura 22 · PL",
    );
    expect(q(doc, "corrida-circulo-1-legenda-cand-15")?.textContent).toContain(
      "Candidatura 15 · MDB",
    );
  });

  it("modo partido lê `corrida_por_partido` e rotula pela sigla", () => {
    const v: EdgeVotacao = {
      contagens: contagensDe([{ id: 0, partido: "x", votos: 30, destino: "valido" }], {
        brancos: 1,
        nulos: 1,
        abstencao: 1,
        naoApurado: 1,
      }),
      corrida_por_partido: [
        { partido: "PL", votos_validos: 9 },
        { partido: "PT", votos_validos: 12 },
        { partido: "MDB", votos_validos: 5 },
        { partido: "PSD", votos_validos: 3 },
        { partido: "NOVO", votos_validos: 1 },
      ],
    };
    const doc = parse(<CorridaTresCirculos modo="partido" votacao={v} />);
    expect(legendaKeys(doc, 1)).toEqual([
      "partido-PT",
      "partido-PL",
      "partido-MDB",
      "partido-PSD",
      "outros",
    ]);
    expect(q(doc, "corrida-circulo-1-legenda-partido-PT")?.textContent).toMatch(/^PT/);
    expect(q(doc, "corrida-tres-circulos")?.getAttribute("data-modo")).toBe("partido");
  });

  it("🔴 partido: pendente com `corrida_por_partido` OMITIDO ⇒ 'aguardando', não 'não sabemos'", () => {
    const doc = parse(
      <CorridaTresCirculos
        modo="partido"
        votacao={{ contagens: contagensDe(corridaReal(), EXTRA), destino_pendente: true }}
      />,
    );
    expect(q(doc, "detail-unavailable")).toBeNull();
    expect(q(doc, "corrida-circulo-1-aguardando-destino")).not.toBeNull();
  });

  it("partido sem `corrida_por_partido` e sem pendência ⇒ <DetailUnavailable>", () => {
    const doc = parse(
      <CorridaTresCirculos
        modo="partido"
        votacao={{ contagens: contagensDe(corridaReal(), EXTRA) }}
      />,
    );
    expect(q(doc, "detail-unavailable")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cor, SVG, acessibilidade
// ---------------------------------------------------------------------------

describe("Cor e SVG", () => {
  const doc = parse(<CorridaTresCirculos modo="candidatura" votacao={votacaoDe(corridaReal())} />);

  it("🔴 a fatia pinta pela SIGLA (`candidateColor`), com a borda do DATA_FILL_STROKE", () => {
    const p = q(doc, "corrida-circulo-1-fatia-cand-13");
    expect(p?.getAttribute("stroke")).toBe(candidateColor("PT"));
    expect(q(doc, "corrida-circulo-1-fatia-cand-22")?.getAttribute("stroke")).toBe(
      candidateColor("PL"),
    );
    expect(q(doc, "corrida-circulo-1-borda-cand-13")?.getAttribute("stroke")).toBe(
      "var(--text-secondary)",
    );
  });

  it("🔴 'Outros' é neutro e tem textura PRÓPRIA — distinta de brancos, nulos e anulados", () => {
    expect(q(doc, "corrida-circulo-2-fatia-outros")?.getAttribute("stroke")).toBe(
      "var(--color-cand-other)",
    );
    const padrao = (k: string) =>
      q(doc, `corrida-circulo-2-padrao-${k}`)?.getAttribute("data-padrao") ?? null;
    expect(padrao("outros")).toBe("trilho");
    expect(padrao("brancos")).toBe("listras");
    expect(padrao("anulados")).toBe("pontos");
    expect(padrao("nulos")).toBeNull();
    const marcador = (k: string) =>
      q(doc, `corrida-circulo-2-legenda-${k}`)
        ?.querySelector("span[aria-hidden='true']")
        ?.getAttribute("style") ?? "";
    expect(marcador("outros")).toContain("linear-gradient(to bottom");
    expect(marcador("outros")).not.toBe(marcador("nulos"));
  });

  it("brancos, nulos, anulados, abstenção e não apurado reusam FATIA_COR", () => {
    expect(q(doc, "corrida-circulo-3-fatia-nulos")?.getAttribute("stroke")).toBe(
      "var(--color-part-brancos-nulos)",
    );
    expect(q(doc, "corrida-circulo-3-fatia-anulados")?.getAttribute("stroke")).toBe("var(--ink-2)");
    expect(q(doc, "corrida-circulo-3-fatia-abstencao")?.getAttribute("stroke")).toBe(
      "var(--color-part-abstencao)",
    );
    expect(q(doc, "corrida-circulo-3-legenda-nao_apurado")?.textContent).toContain(
      "Ainda não apurado",
    );
  });

  it("🔴 nenhum `<text>` dentro do SVG, e nenhuma `<table>`", () => {
    expect(doc.querySelectorAll("svg text, svg tspan")).toHaveLength(0);
    expect(doc.body.innerHTML).not.toContain("<table");
  });

  it("🔴 o componente nunca lê `.cor` e não é client component", () => {
    const fonte = readFileSync(
      resolve(process.cwd(), "components/blocks/CorridaTresCirculos.tsx"),
      "utf8",
    );
    expect(fonte).not.toMatch(/\.cor\b/);
    expect(fonte.split("\n").filter((l) => /^\s*["']use client["']\s*;?\s*$/.test(l))).toEqual([]);
  });
});

describe("🔴 os dois painéis na MESMA página — id de SVG é global", () => {
  const v = votacaoDe(corridaReal(), {
    projetada: { validos: 50_000_000, brancos: 4_000_000, nulos: 3_000_000, abstencao: 20_000_000 },
  });
  const doc = parse(
    <>
      <VotacaoEleitorado votacao={v} />
      <CorridaTresCirculos modo="candidatura" votacao={v} candidatos={CANDIDATOS} />
    </>,
  );

  it("nenhum `id` se repete no documento", () => {
    const ids = [...doc.querySelectorAll("[id]")].map((e) => e.getAttribute("id"));
    expect(ids.length).toBeGreaterThan(6);
    expect(ids.length - new Set(ids).size).toBe(0);
    // três `<pattern>` de cada painel — os dois desenharam
    expect(doc.querySelectorAll("pattern")).toHaveLength(6);
  });

  it("e o `titleId` prefixa os `<defs>`: dois painéis da corrida também não colidem", () => {
    // Nenhuma página monta dois hoje; é o contrato da prop, e o que a quebra
    // produziria é o defeito silencioso de 2026-09-26 (o segundo painel pinta
    // com o `<pattern>` do primeiro).
    const dois = parse(
      <>
        <CorridaTresCirculos modo="candidatura" votacao={v} titleId="corrida-a" />
        <CorridaTresCirculos modo="candidatura" votacao={v} titleId="corrida-b" />
      </>,
    );
    const ids = [...dois.querySelectorAll("[id]")].map((e) => e.getAttribute("id"));
    expect(dois.querySelectorAll("pattern")).toHaveLength(6);
    expect(ids.length - new Set(ids).size).toBe(0);
  });

  it("todo `url(#…)` aponta para um id que existe", () => {
    const refs = [...doc.querySelectorAll("*")].flatMap((e) =>
      [...e.attributes]
        .map((a) => /url\(#([^)]+)\)/.exec(a.value)?.[1])
        .filter((x): x is string => Boolean(x)),
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const alvo of refs) expect(doc.getElementById(alvo), alvo).not.toBeNull();
  });

  it("os dois `aria-labelledby` são diferentes e cada um acha o seu heading", () => {
    const panels = [...doc.querySelectorAll('[data-testid="panel"]')];
    const ids = panels.map((p) => p.getAttribute("aria-labelledby"));
    expect(new Set(ids).size).toBe(2);
    expect(doc.getElementById(ids[1] ?? "")?.textContent).toBe("A corrida");
  });
});

describe("RF-208 — base e fonte declaradas", () => {
  it("cada figura nomeia a base no figcaption e nas linhas", () => {
    const doc = parse(
      <CorridaTresCirculos modo="candidatura" votacao={votacaoDe(corridaReal())} />,
    );
    const caps = [...doc.querySelectorAll("figcaption")].map((f) => f.textContent);
    expect(caps).toEqual(["Dos votos válidos", "De quem votou", "Do eleitorado apto, até agora"]);
    expect(q(doc, "corrida-circulo-1-legenda-cand-13")?.getAttribute("data-base")).toBe(
      "votos válidos",
    );
    expect(q(doc, "corrida-circulo-3-legenda-cand-13")?.getAttribute("data-base")).toBe(
      "eleitores aptos",
    );
    const t = q(doc, "corrida-circulo-1-legenda-cand-13")?.textContent ?? "";
    expect(t).toMatch(/\d+,\d%/);
    expect(t).toContain("10.000.000");
  });

  it("a metodologia declara a fonte, o ciclo de diferença e que anulado ≠ nulo", () => {
    const doc = parse(
      <CorridaTresCirculos modo="candidatura" votacao={votacaoDe(corridaReal())} />,
    );
    const m = q(doc, "corrida-metodologia")?.textContent ?? "";
    expect(m).toContain("total que o TSE publica");
    expect(m).toMatch(/diferir por um ciclo/);
    expect(m).toContain("no voto nulo o eleitor não escolheu ninguém");
  });

  it("em Governador, a metodologia diz por que as fatias são por partido", () => {
    const doc = parse(
      <CorridaTresCirculos
        modo="partido"
        votacao={{ contagens: contagensDe(corridaReal(), EXTRA), corrida_por_partido: [] }}
      />,
    );
    const m = q(doc, "corrida-metodologia")?.textContent ?? "";
    expect(m).toMatch(/27 estados/);
    // A fonte do nacional de Governador é o agregado de CADA estado — não há
    // arquivo nacional para esse cargo (`targets.ts:59`).
    expect(m).toContain("total que o TSE publica para cada estado");
  });

  it("o painel se chama 'A corrida', num <Panel> próprio", () => {
    const doc = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacaoDe(corridaReal())}
        kicker="Presidente · Brasil"
      />,
    );
    const id = q(doc, "panel")?.getAttribute("aria-labelledby");
    expect(doc.getElementById(id ?? "")?.textContent).toBe("A corrida");
    const figs = [...doc.querySelectorAll("figure")].map((f) => f.getAttribute("data-testid"));
    expect(figs).toEqual(["corrida-circulo-1", "corrida-circulo-2", "corrida-circulo-3"]);
  });
});
