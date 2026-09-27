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
  fatiasProjecaoCorrida,
  maiorResto,
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

/**
 * A mesma lista com `votos_projetados` (RF-212). Desenhada para discriminar:
 *   - a ORDEM da projeção difere da do apurado: 22 passa 13, e 50 (6ª no
 *     apurado) entra no top-4 no lugar de 12;
 *   - 15 e 30 EMPATAM na projeção — o desempate por número de urna crescente
 *     põe 15 no top-4 e manda 30 para "Outros";
 *   - 44 (sub judice) e 90 (anulado) têm as MAIORES projeções: sem o filtro
 *     `valido` elas tomariam o 1º lugar;
 *   - Σ projeções válidas (98.000.000) ≠ `projetada.validos` do payload, para
 *     "total = Σ candidatos" não passar por coincidência.
 */
const CANDIDATOS_PROJ = [
  { id: 13, nome: "Ana Tereza", votos_projetados: 38_000_000 },
  { id: 22, nome: "Bruno Lima", votos_projetados: 40_000_000 },
  { id: 15, nome: "Carla Dias", votos_projetados: 5_000_000 },
  { id: 12, nome: "Davi Souza", votos_projetados: 1_000_000 },
  { id: 30, nome: "Gil Novo", votos_projetados: 5_000_000 },
  { id: 50, nome: "Helena Psol", votos_projetados: 9_000_000 },
  { id: 44, nome: "Eduardo Sub Judice", votos_projetados: 60_000_000 },
  { id: 90, nome: "Fábio Anulado", votos_projetados: 7_000_000 },
];

/** Total de válidos projetado — o arco 3 do "Votação". ≠ Σ acima (98 mi). */
const PROJETADA = {
  validos: 50_000_001,
  brancos: 4_000_000,
  nulos: 3_000_000,
  abstencao: 20_000_000,
};

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
  // Com `votos_projetados`, o quarto arco da corrida (RF-212) também desenha
  // — e traz o seu próprio `<pattern>`.
  const doc = parse(
    <>
      <VotacaoEleitorado votacao={v} />
      <CorridaTresCirculos modo="candidatura" votacao={v} candidatos={CANDIDATOS_PROJ} />
    </>,
  );

  it("nenhum `id` se repete no documento", () => {
    const ids = [...doc.querySelectorAll("[id]")].map((e) => e.getAttribute("id"));
    expect(ids.length).toBeGreaterThan(6);
    expect(ids.length - new Set(ids).size).toBe(0);
    // três `<pattern>` do "Votação" + quatro da corrida (três círculos e o de
    // projeção) — todos desenharam
    expect(q(doc, "corrida-projecao")?.querySelector("pattern")).not.toBeNull();
    expect(doc.querySelectorAll("pattern")).toHaveLength(7);
  });

  it("e o `titleId` prefixa os `<defs>`: dois painéis da corrida também não colidem", () => {
    // Nenhuma página monta dois hoje; é o contrato da prop, e o que a quebra
    // produziria é o defeito silencioso de 2026-09-26 (o segundo painel pinta
    // com o `<pattern>` do primeiro).
    const dois = parse(
      <>
        <CorridaTresCirculos
          modo="candidatura"
          votacao={v}
          candidatos={CANDIDATOS_PROJ}
          titleId="corrida-a"
        />
        <CorridaTresCirculos
          modo="candidatura"
          votacao={v}
          candidatos={CANDIDATOS_PROJ}
          titleId="corrida-b"
        />
      </>,
    );
    const ids = [...dois.querySelectorAll("[id]")].map((e) => e.getAttribute("id"));
    expect(dois.querySelectorAll("pattern")).toHaveLength(8);
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
    // Por visão (RF-211/212): três figuras no Parcial, uma na Projeção. Contar
    // o documento inteiro misturaria as duas — cada lista é exata.
    const caps = (visao: string) =>
      [...doc.querySelectorAll(`[data-view-only="${visao}"] figcaption`)].map((f) => f.textContent);
    expect(caps("parcial")).toEqual([
      "Dos votos válidos",
      "De quem votou",
      "Do eleitorado apto, até agora",
    ]);
    expect(caps("proj")).toEqual(["Projeção para o fim da apuração"]);
    expect(doc.querySelectorAll("figcaption")).toHaveLength(4);
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
    const figs = (visao: string) =>
      [...doc.querySelectorAll(`[data-view-only="${visao}"] figure`)].map((f) =>
        f.getAttribute("data-testid"),
      );
    expect(figs("parcial")).toEqual([
      "corrida-circulo-1",
      "corrida-circulo-2",
      "corrida-circulo-3",
    ]);
    expect(figs("proj")).toEqual(["corrida-projecao"]);
    expect(doc.querySelectorAll("figure")).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// RF-211 / RF-212 — o seletor Parcial/Projeção (2026-09-27)
// ---------------------------------------------------------------------------

const visaoDe = (doc: Document, testid: string) =>
  q(doc, testid)?.closest("[data-view-only]")?.getAttribute("data-view-only") ?? null;

describe("RF-211 — os três círculos são da visão 'Parcial'", () => {
  it("🔴 apurando: cada círculo e a metodologia são 'parcial'", () => {
    // Mutações que morrem: trocar parcial↔proj num círculo; tirar o atributo.
    const doc = parse(
      <CorridaTresCirculos modo="candidatura" votacao={votacaoDe(corridaReal())} />,
    );
    for (const n of [1, 2, 3] as const) {
      expect(visaoDe(doc, `corrida-circulo-${n}`), `círculo ${n}`).toBe("parcial");
    }
    expect(q(doc, "corrida-metodologia")?.getAttribute("data-view-only")).toBe("parcial");
    // o atributo não pode estar na `<figure>` — o `display: flex` inline venceria
    expect(doc.querySelectorAll("figure[data-view-only]")).toHaveLength(0);
  });

  it("os estados de espera de cada círculo somem com ele (destino, sem votos, não fecha)", () => {
    const pendente = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacaoDe(corridaReal(), { destino_pendente: true })}
      />,
    );
    for (const n of [1, 2, 3] as const) {
      expect(visaoDe(pendente, `corrida-circulo-${n}-aguardando-destino`)).toBe("parcial");
    }
    const corrida = corridaReal();
    const c = contagensDe(corrida, EXTRA);
    const torto = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={{ contagens: { ...c, validos: c.validos + 1 }, corrida }}
      />,
    );
    expect(visaoDe(torto, "corrida-circulo-1-nao-fecha")).toBe("parcial");
  });
});

describe("RF-212 — maiorResto: a soma fecha no total EXATO", () => {
  const soma = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const arredondado = (pesos: number[], total: number) => {
    const S = soma(pesos);
    return pesos.map((p) => Math.round((total * p) / S));
  };

  // Cada caso é um em que arredondar cada cota sozinha ERRA o total — o erro
  // do arredondamento simples está na última coluna, e o teste confere que ele
  // de fato erraria (senão o caso não discrimina nada).
  const casos: [string, number[], number, number[], number][] = [
    ["−1", [1, 1, 1], 100, [34, 33, 33], -1],
    ["+1", [1, 1, 1], 200, [67, 67, 66], +1],
    ["−2", [1, 1, 1, 1, 1, 1], 8, [2, 2, 1, 1, 1, 1], -2],
    ["+2", [1, 1, 1, 1, 1, 1], 10, [2, 2, 2, 2, 1, 1], +2],
  ];
  for (const [nome, pesos, total, esperado, erroSimples] of casos) {
    it(`🔴 caso em que o arredondamento simples erra por ${nome}`, () => {
      expect(soma(arredondado(pesos, total)) - total).toBe(erroSimples);
      const r = maiorResto(pesos, total);
      expect(r).toEqual(esperado);
      expect(soma(r)).toBe(total);
    });
  }

  it("a unidade vai ao MAIOR resto, não ao maior peso", () => {
    // 7 × {5, 3, 2} / 10 = 3,5 · 2,1 · 1,4 → pisos 3·2·1 (6), falta 1; o maior
    // resto é o do 1º (0,5) — e no caso abaixo é o do 3º (0,8), não o do 1º.
    expect(maiorResto([5, 3, 2], 7)).toEqual([4, 2, 1]);
    // 9 × {5, 3, 2} / 10 = 4,5 · 2,7 · 1,8 → pisos 4·2·1 (7), falta 2: restos
    // 0,5 · 0,7 · 0,8 ⇒ 3º e 2º recebem, o 1º (maior peso) não.
    expect(maiorResto([5, 3, 2], 9)).toEqual([4, 3, 2]);
  });

  it("empate de resto ⇒ a de menor índice (a de maior projeção, na ordem de entrada)", () => {
    // 2 × {3, 1} / 4 = 1,5 · 0,5 — restos iguais, falta 1.
    expect(maiorResto([3, 1], 2)).toEqual([2, 0]);
    expect(maiorResto([1, 1], 1)).toEqual([1, 0]);
  });

  it("🔴 números de eleição nacional não perdem a unidade (produto > 2^53)", () => {
    const r = maiorResto([99_999_999, 1], 158_000_000);
    expect(r).toEqual([157_999_998, 2]);
    expect(soma(r)).toBe(158_000_000);
  });

  it("peso zero nunca recebe unidade", () => {
    expect(maiorResto([1, 1, 1, 0], 100)).toEqual([34, 33, 33, 0]);
  });
});

describe("RF-212 — fatiasProjecaoCorrida", () => {
  const v = votacaoDe(corridaReal(), { projetada: PROJETADA });
  const keys = (f: { key: string }[] | null) => (f ?? []).map((x) => x.key);

  it("🔴 ordem pela PROJEÇÃO, só `valido`, desempate por número de urna crescente", () => {
    // apurado: 13, 22, 15, 12, 30, 50 · projeção: 22, 13, 50, 15≡30 (empate).
    // Sub judice (44) e anulado (90) têm as maiores projeções e ficam fora.
    const f = fatiasProjecaoCorrida(v, CANDIDATOS_PROJ, PROJETADA.validos);
    expect(keys(f)).toEqual(["cand-22", "cand-13", "cand-50", "cand-15", "outros"]);
  });

  it("🔴 o desempate não depende da ordem de chegada (nem da corrida, nem da lista)", () => {
    const corridaInv = [...corridaReal()].reverse();
    const vInv = votacaoDe(corridaInv, { projetada: PROJETADA });
    for (const [vv, lista] of [
      [v, CANDIDATOS_PROJ],
      [vInv, CANDIDATOS_PROJ],
      [v, [...CANDIDATOS_PROJ].reverse()],
      [vInv, [...CANDIDATOS_PROJ].reverse()],
    ] as const) {
      expect(keys(fatiasProjecaoCorrida(vv, lista, PROJETADA.validos))).toEqual([
        "cand-22",
        "cand-13",
        "cand-50",
        "cand-15",
        "outros",
      ]);
    }
  });

  it("🔴 Σ fatias === `projetada.validos` na unidade — e NÃO Σ das projeções", () => {
    const f = fatiasProjecaoCorrida(v, CANDIDATOS_PROJ, PROJETADA.validos) ?? [];
    const soma = f.reduce((s, x) => s + x.abs, 0);
    expect(soma).toBe(50_000_001);
    // Σ projeções válidas = 98.000.000; o total NÃO é esse.
    expect(soma).not.toBe(98_000_000);
    // cada fatia na proporção: 22 = 50.000.001 × 40/98 = 20.408.163,67…
    const por = Object.fromEntries(f.map((x) => [x.key, x.abs]));
    expect(por).toEqual({
      "cand-22": 20_408_164,
      "cand-13": 19_387_755,
      "cand-50": 4_591_837,
      "cand-15": 2_551_020,
      // 30 (5 mi) + 12 (1 mi) = 6 mi → 3.061.224,5… (piso 3.061.224)
      outros: 3_061_225,
    });
    // percentual sobre o total projetado
    expect(f[0]?.pct).toBeCloseTo((20_408_164 / 50_000_001) * 100, 10);
  });

  it("🔴 caso de ponta em que o arredondamento simples erraria por +2 e −2", () => {
    const cinco: EdgeCorridaEntrada[] = [11, 12, 13, 14, 15].map((id) => ({
      id,
      partido: "PT",
      votos: 100,
      destino: "valido",
    }));
    const lista = cinco.map((e) => ({ id: e.id, votos_projetados: 1 }));
    // 8 ÷ 5 = 1,6 → arredondado 2 × 5 = 10 (+2); maior resto → 2,2,2,1,1
    expect(fatiasProjecaoCorrida({ corrida: cinco }, lista, 8)?.map((f) => f.abs)).toEqual([
      2, 2, 2, 1, 1,
    ]);
    // 7 ÷ 5 = 1,4 → arredondado 1 × 5 = 5 (−2); maior resto → 2,2,1,1,1
    expect(fatiasProjecaoCorrida({ corrida: cinco }, lista, 7)?.map((f) => f.abs)).toEqual([
      2, 2, 1, 1, 1,
    ]);
  });

  it("candidatura ausente da lista NÃO entra — as outras seguem", () => {
    const sem22 = CANDIDATOS_PROJ.filter((c) => c.id !== 22);
    const f = fatiasProjecaoCorrida(v, sem22, PROJETADA.validos);
    expect(keys(f)).toEqual(["cand-13", "cand-50", "cand-15", "cand-30", "outros"]);
    expect(f?.reduce((s, x) => s + x.abs, 0)).toBe(PROJETADA.validos);
  });

  it("🔴 só entra quem tem projeção > 0 — nem zero, nem ausente, ocupa lugar", () => {
    // Três válidas: 13 com projeção, 22 com projeção ZERO, 15 fora da lista.
    // Com poucas candidaturas, um zero ou um ausente que entrasse ocuparia uma
    // das quatro fatias próprias (invisível no arco, mas presente no dado).
    const corrida: EdgeCorridaEntrada[] = [
      { id: 13, partido: "PT", votos: 10, destino: "valido" },
      { id: 22, partido: "PL", votos: 9, destino: "valido" },
      { id: 15, partido: "MDB", votos: 8, destino: "valido" },
    ];
    const lista = [
      { id: 13, votos_projetados: 100 },
      { id: 22, votos_projetados: 0 },
    ];
    const f = fatiasProjecaoCorrida({ corrida }, lista, 1_000);
    expect(keys(f)).toEqual(["cand-13", "outros"]);
    expect(f?.map((x) => x.abs)).toEqual([1_000, 0]);
  });

  it("o rótulo vem da lista, como no Parcial", () => {
    const f = fatiasProjecaoCorrida(v, CANDIDATOS_PROJ, PROJETADA.validos);
    expect(f?.[0]?.label).toBe("Bruno Lima · PL");
    expect(f?.[4]?.label).toBe("Outros");
  });

  describe("🔴 cada ramo de 'aguardando' devolve null", () => {
    it("sem `projetada`, ou total zero, negativo ou não inteiro", () => {
      for (const t of [undefined, null, 0, -1, 1.5, Number.NaN]) {
        expect(fatiasProjecaoCorrida(v, CANDIDATOS_PROJ, t), String(t)).toBeNull();
      }
    });

    it("destinação pendente — pela flag", () => {
      const p = votacaoDe(corridaReal(), { projetada: PROJETADA, destino_pendente: true });
      expect(fatiasProjecaoCorrida(p, CANDIDATOS_PROJ, PROJETADA.validos)).toBeNull();
    });

    it("destinação pendente — por entrada com votos e sem destino", () => {
      const corrida = corridaReal().map((e) => (e.id === 12 ? { ...e, destino: undefined } : e));
      expect(fatiasProjecaoCorrida({ corrida }, CANDIDATOS_PROJ, PROJETADA.validos)).toBeNull();
    });

    it("`corrida` ausente", () => {
      expect(fatiasProjecaoCorrida({}, CANDIDATOS_PROJ, PROJETADA.validos)).toBeNull();
    });

    it("Σ projeções válidas = 0 (todas zeradas)", () => {
      const zeradas = CANDIDATOS_PROJ.map((c) =>
        c.id === 44 || c.id === 90 ? c : { ...c, votos_projetados: 0 },
      );
      // 44 e 90 seguem com projeção — e não podem salvar a divisão
      expect(fatiasProjecaoCorrida(v, zeradas, PROJETADA.validos)).toBeNull();
    });

    it("nenhuma válida está na lista (só nomes, sem `votos_projetados`)", () => {
      expect(fatiasProjecaoCorrida(v, CANDIDATOS, PROJETADA.validos)).toBeNull();
      expect(fatiasProjecaoCorrida(v, [], PROJETADA.validos)).toBeNull();
    });

    it("projeção torta (negativa ou não inteira) não vira fatia", () => {
      for (const torta of [-5, 1.5]) {
        const lista = CANDIDATOS_PROJ.map((c) =>
          c.id === 12 ? { ...c, votos_projetados: torta } : c,
        );
        expect(fatiasProjecaoCorrida(v, lista, PROJETADA.validos), String(torta)).toBeNull();
      }
    });
  });
});

describe("RF-212 — o círculo de projeção no painel", () => {
  const v = votacaoDe(corridaReal(), { projetada: PROJETADA });
  const doc = parse(
    <>
      <VotacaoEleitorado votacao={v} />
      <CorridaTresCirculos modo="candidatura" votacao={v} candidatos={CANDIDATOS_PROJ} />
    </>,
  );

  it("🔴 uma figura, só na visão 'proj', com a legenda na ordem da projeção", () => {
    expect(visaoDe(doc, "corrida-projecao")).toBe("proj");
    expect(q(doc, "corrida-projecao")?.tagName).toBe("FIGURE");
    const lis = [...doc.querySelectorAll('[data-testid="corrida-projecao-legenda"] li')].map((li) =>
      (li.getAttribute("data-testid") ?? "").replace("corrida-projecao-legenda-", ""),
    );
    expect(lis).toEqual(["cand-22", "cand-13", "cand-50", "cand-15", "outros"]);
    expect(q(doc, "corrida-projecao-legenda-cand-22")?.getAttribute("data-base")).toBe(
      "votos válidos (projetado)",
    );
  });

  it("🔴 o total é o MESMO da fatia de válidos do arco 3 do 'Votação'", () => {
    const fig = q(doc, "corrida-projecao");
    const validosVotacao = q(doc, "votacao-circulo-3-fatia-validos")?.getAttribute("data-abs");
    expect(validosVotacao).toBe(String(PROJETADA.validos));
    expect(fig?.getAttribute("data-total")).toBe(validosVotacao);
    expect(fig?.getAttribute("data-soma-abs")).toBe(validosVotacao);
    expect(q(doc, "corrida-projecao-total")?.textContent).toBe("50.000.001");
    expect(q(doc, "corrida-projecao-base")?.textContent).toBe("votos válidos (projetado)");
  });

  it("a fatia pinta pela sigla, 'Outros' neutro", () => {
    expect(q(doc, "corrida-projecao-fatia-cand-22")?.getAttribute("stroke")).toBe(
      candidateColor("PL"),
    );
    expect(q(doc, "corrida-projecao-padrao-outros")?.getAttribute("data-padrao")).toBe("trilho");
  });

  it("🔴 a metodologia da Projeção existe, é 'proj', e diz o que muda", () => {
    const m = q(doc, "corrida-metodologia-proj");
    expect(m?.getAttribute("data-view-only")).toBe("proj");
    const t = m?.textContent ?? "";
    expect(t).toContain("é o mesmo da projeção do painel “Votação”");
    expect(t).toContain("segue a projeção de cada uma");
    expect(t).toContain("podem diferir nos últimos dígitos");
    expect(t).toContain("50.000.001");
    expect(t).toContain("as demais somam “Outros”");
    // não cita os três círculos do Parcial …
    expect(t).not.toMatch(/três gráficos|terceiro|primeiro gráfico|até agora/i);
    // … e o parágrafo do Parcial não cita este
    const parcial = q(doc, "corrida-metodologia")?.textContent ?? "";
    expect(parcial).not.toMatch(/proje/i);
    expect(t).not.toMatch(/RF-|payload|bootstrap|replay/i);
  });

  it("sem 'Outros' no arco, a metodologia não o cita", () => {
    const corrida: EdgeCorridaEntrada[] = [
      { id: 13, partido: "PT", votos: 10, destino: "valido" },
      { id: 22, partido: "PL", votos: 9, destino: "valido" },
    ];
    const d = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={{ contagens: contagensDe(corrida, EXTRA), corrida, projetada: PROJETADA }}
        candidatos={[
          { id: 13, votos_projetados: 60 },
          { id: 22, votos_projetados: 40 },
        ]}
      />,
    );
    const t = q(d, "corrida-metodologia-proj")?.textContent ?? "";
    expect(t).toContain("segue a projeção de cada uma. Só o voto válido entra");
    expect(t).not.toContain("Outros");
  });

  it("os dois `proj` do painel são a figura e a metodologia — nada do Parcial vaza", () => {
    const corrida = q(doc, "corrida-tres-circulos")?.closest('[data-testid="panel"]');
    const proj = [...(corrida?.querySelectorAll('[data-view-only="proj"]') ?? [])].map((e) =>
      e.getAttribute("data-testid"),
    );
    expect(proj).toEqual(["corrida-projecao-visao", "corrida-metodologia-proj"]);
  });
});

describe("RF-212 — sem dado, a figura da Projeção diz por quê (sempre no DOM)", () => {
  const semSvg = (d: Document) => q(d, "corrida-projecao")?.querySelector("svg") ?? null;

  it("🔴 sem `projetada` ⇒ 'aguardando projeção', na visão 'proj'", () => {
    const d = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacaoDe(corridaReal())}
        candidatos={CANDIDATOS_PROJ}
      />,
    );
    expect(visaoDe(d, "corrida-projecao-aguardando")).toBe("proj");
    expect(q(d, "corrida-projecao-aguardando")?.textContent).toMatch(/^Aguardando projeção/);
    expect(semSvg(d)).toBeNull();
    expect(q(d, "corrida-metodologia-proj")).toBeNull();
    // o único `proj` é o invólucro da figura
    expect(d.querySelectorAll('[data-view-only="proj"]')).toHaveLength(1);
  });

  it("o texto ao leitor não tem jargão e não promete data", () => {
    const d = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacaoDe(corridaReal())}
        candidatos={CANDIDATOS_PROJ}
      />,
    );
    const t = q(d, "corrida-projecao-aguardando")?.textContent ?? "";
    expect(t).not.toMatch(/RF-|payload|modelo|medi[çc]|replay|\d{1,2}\/\d{1,2}|hora|amanhã/i);
  });

  it("🔴 destinação pendente ⇒ 'aguardando a separação dos votos válidos'", () => {
    const d = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacaoDe(corridaReal(), { projetada: PROJETADA, destino_pendente: true })}
        candidatos={CANDIDATOS_PROJ}
      />,
    );
    expect(q(d, "corrida-projecao-aguardando-destino")?.textContent).toMatch(
      /aguardando a separação dos votos válidos/i,
    );
    expect(visaoDe(d, "corrida-projecao-aguardando-destino")).toBe("proj");
    expect(q(d, "corrida-projecao-aguardando")).toBeNull();
    expect(semSvg(d)).toBeNull();
  });

  it("🔴 lista sem `votos_projetados` ⇒ 'aguardando projeção', mesmo com `projetada`", () => {
    const d = parse(
      <CorridaTresCirculos
        modo="candidatura"
        votacao={votacaoDe(corridaReal(), { projetada: PROJETADA })}
        candidatos={CANDIDATOS}
      />,
    );
    expect(q(d, "corrida-projecao-aguardando")).not.toBeNull();
    expect(semSvg(d)).toBeNull();
  });

  it("no modo partido, fala de partidos — não há projeção por partido", () => {
    // Mesmo com `corrida` e projeções por candidatura à mão: o gráfico é por
    // partido, e dividir por candidatura aqui seria outro gráfico.
    const d = parse(
      <CorridaTresCirculos
        modo="partido"
        votacao={{
          contagens: contagensDe(corridaReal(), EXTRA),
          corrida: corridaReal(),
          corrida_por_partido: [{ partido: "PT", votos_validos: 1 }],
          projetada: PROJETADA,
        }}
        candidatos={CANDIDATOS_PROJ}
      />,
    );
    expect(q(d, "corrida-projecao-aguardando")?.textContent).toContain("entre os partidos");
    expect(semSvg(d)).toBeNull();
  });
});

describe("RF-210 / RF-207 — Senado e <DetailUnavailable> valem nas DUAS visões", () => {
  it("🔴 Senado: nada marcado por visão, e nenhum bloco de projeção", () => {
    // Esconder o "aguardando Senado" na Projeção deixaria o painel sem dizer
    // por que está vazio. Mutação que morre: aplicar `parcial` também no Senado.
    const doc = parse(
      <CorridaTresCirculos modo="candidatura" senado votacao={votacaoDe(corridaReal())} />,
    );
    expect(doc.querySelectorAll("[data-view-only]")).toHaveLength(0);
    expect(q(doc, "corrida-projecao")).toBeNull();
    for (const n of [1, 2, 3] as const) {
      expect(q(doc, `corrida-circulo-${n}-aguardando-senado`)).not.toBeNull();
    }
  });

  it("🔴 <DetailUnavailable>: nada marcado por visão", () => {
    const casos = [
      <CorridaTresCirculos key="a" modo="candidatura" votacao={undefined} />,
      <CorridaTresCirculos
        key="b"
        modo="partido"
        votacao={{ contagens: contagensDe(corridaReal(), EXTRA) }}
      />,
    ];
    for (const node of casos) {
      const doc = parse(node);
      expect(q(doc, "detail-unavailable")).not.toBeNull();
      expect(doc.querySelectorAll("[data-view-only]")).toHaveLength(0);
      expect(q(doc, "corrida-projecao")).toBeNull();
    }
  });
});
