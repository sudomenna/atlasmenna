// @vitest-environment happy-dom
/**
 * tests/unit/components/StrongholdsPanel.test.tsx
 *
 * `<StrongholdsPanel />` — S07/Bloco 1 (ADR-0025). Cobre RF-024 e RF-030.6 na
 * leitura "por candidato" da matriz UF × candidato.
 *
 * O que os testes protegem, em ordem de importância:
 *   1. Nenhum número inventado: um candidato fora do `top_candidatos` de uma
 *      UF simplesmente não aparece ali (b, c). Esse é o limite do payload, e
 *      o bloco tem de respeitá-lo em silêncio, não preencher com zero.
 *   2. O sinal da diferença: `+` para quem lidera a UF, `−` para quem não
 *      lidera (d). Trocar isso inverteria a leitura da tabela inteira.
 *   3. Determinismo do desempate (e) — constituição § 6.
 *   4. Cor por partido com fallback de rank (f) — ADR-0024 sobre ADR-0013.
 *   5. As pílulas de 2026-09-10 (k..o): existem, uma por candidato até 5, a
 *      primeira nasce selecionada, e a SELECIONADA usa o par medido
 *      `-chip`/`-ink` — nunca `colorForParty()`, que não garante contraste
 *      do texto por cima (constituição § 4).
 *
 * O arquivo tem duas metades. A primeira usa `renderToStaticMarkup`, como o
 * resto da suíte de componentes: cobre a regra pura (`strongholdsFor`) e o
 * markup no estado inicial. A segunda monta de verdade (`createRoot` + `act`,
 * happy-dom), porque `renderToStaticMarkup` não hidrata e o CLIQUE na pílula
 * — que é o comportamento inteiro da mudança — só existe numa árvore montada.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  chipFillFor,
  chipLabels,
  formatVotosDiferenca,
  STRONGHOLD_POSICAO_MAX,
  StrongholdsPanel,
  strongholdsFor,
} from "@/components/blocks/StrongholdsPanel";
import type { EdgeCandidate, EdgeUfRow } from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function makeCand(overrides: Partial<EdgeCandidate>): EdgeCandidate {
  return {
    id: 1,
    nome: "Cand 1",
    partido: "PT",
    cor: "var(--color-cand-1)",
    votos_atuais: 0,
    votos_projetados: 0,
    pct_atual: 0,
    pct_projetado: 0,
    pct_projetado_lower: 0,
    pct_projetado_upper: 0,
    p_vitoria: 0,
    rank: 1,
    p_passa_2t: 0,
    p_fecha_1t: 0,
    ...overrides,
  };
}

function makeRow(sigla: string, top: Array<{ id: number; pct: number }>): EdgeUfRow {
  return {
    sigla,
    pct_apurado: 60,
    lider: top[0]?.id ?? 0,
    margem_atual: 0,
    margem_projetada: (top[0]?.pct ?? 0) - (top[1]?.pct ?? 0),
    margem_projetada_ci: [0, 0],
    chamada: false,
    swing_vs_2022: null,
    top_candidatos: top,
    vai_a_2t: null,
    bucket: "indefinido",
  };
}

const pt = makeCand({ id: 13, nome: "Candidato PT", partido: "PT", rank: 1 });
const pl = makeCand({ id: 22, nome: "Candidato PL", partido: "PL", rank: 2 });
const semPartido = makeCand({ id: 99, nome: "Sem sigla", partido: "", rank: 3 });

const candidatos = [pt, pl, semPartido];
const byId = new Map(candidatos.map((c) => [c.id, c]));

const rows: EdgeUfRow[] = [
  // PT lidera com folga
  makeRow("BA", [
    { id: 13, pct: 62 },
    { id: 22, pct: 28 },
  ]),
  // PT lidera apertado
  makeRow("MG", [
    { id: 13, pct: 46 },
    { id: 22, pct: 44 },
  ]),
  // PL lidera; PT em 2º
  makeRow("SC", [
    { id: 22, pct: 58 },
    { id: 13, pct: 32 },
  ]),
  // Nenhum dos dois no top — PT não pode aparecer nesta linha
  makeRow("RR", [
    { id: 99, pct: 40 },
    { id: 22, pct: 35 },
  ]),
];

describe("strongholdsFor()", () => {
  it("(a) ordena as UFs pelo percentual projetado do candidato, desc", () => {
    const lista = strongholdsFor(13, rows, byId);
    expect(lista.map((l) => l.sigla)).toEqual(["BA", "MG", "SC"]);
  });

  it("(b) UF em que o candidato não está no top_candidatos fica de fora", () => {
    // RR tem só #99 e #22 — o PT não aparece, e o bloco não inventa um pct.
    expect(strongholdsFor(13, rows, byId).map((l) => l.sigla)).not.toContain("RR");
  });

  it("(c) top_candidatos vazio (payload pré-S05) → lista vazia, sem throw", () => {
    expect(strongholdsFor(13, [makeRow("AC", [])], byId)).toEqual([]);
  });

  it("(d) diferença é positiva para quem lidera e negativa para quem não lidera", () => {
    const lista = strongholdsFor(13, rows, byId);
    const ba = lista.find((l) => l.sigla === "BA");
    const sc = lista.find((l) => l.sigla === "SC");

    expect(ba?.posicao).toBe(1);
    expect(ba?.diff).toBeCloseTo(34, 5); // 62 − 28, contra o 2º
    expect(ba?.contraNome).toBe("Candidato PL");

    expect(sc?.posicao).toBe(2);
    expect(sc?.diff).toBeCloseTo(-26, 5); // 32 − 58, contra o 1º
    expect(sc?.contraNome).toBe("Candidato PL");
  });

  it("(e) empate de percentual desempata por sigla — determinismo (constituição § 6)", () => {
    const empate = [
      makeRow("SP", [
        { id: 13, pct: 50 },
        { id: 22, pct: 40 },
      ]),
      makeRow("AL", [
        { id: 13, pct: 50 },
        { id: 22, pct: 30 },
      ]),
    ];
    expect(strongholdsFor(13, empate, byId).map((l) => l.sigla)).toEqual(["AL", "SP"]);
    // E de novo, na ordem inversa de entrada: a saída não muda.
    expect(strongholdsFor(13, [...empate].reverse(), byId).map((l) => l.sigla)).toEqual([
      "AL",
      "SP",
    ]);
  });
});

describe("<StrongholdsPanel />", () => {
  it("(f) cor vem do partido (ADR-0024); sem sigla mapeada, o token estável de `outros`", () => {
    // A tabela visível é a do candidato selecionado — por default o primeiro
    // da lista. Então cada asserção renderiza com o candidato que interessa
    // na cabeça da lista, em vez de procurar três tabelas na mesma árvore.
    const tagStyle = (cands: EdgeCandidate[], sigla: string) => {
      const doc = parse(<StrongholdsPanel candidatos={cands} rows={rows} />);
      return (
        Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="party-tag"]'))
          .find((t) => t.getAttribute("data-sigla") === sigla)
          ?.getAttribute("style") ?? ""
      );
    };

    expect(tagStyle([pt, pl], "PT")).toContain("var(--party-pt)");
    expect(tagStyle([pl, pt], "PL")).toContain("var(--party-pl)");
    // 🔴 Mudou em 2026-09-20. `partido: ""` não tem token próprio e caía no
    // rank 3 do fallback — a última porta por onde a POSIÇÃO pintava alguém.
    // Agora é `--party-outros`, estável (constituição § 2, que proíbe a cor
    // mudar "por rank, por ordem de apuração"); ver o topo de
    // `components/blocks/_candidateColor.ts`.
    expect(tagStyle([semPartido], "")).toContain("var(--party-outros)");
    expect(tagStyle([semPartido], "")).not.toContain("var(--color-cand-");
  });

  it("(g) UMA <table> por vez — a do candidato selecionado — com <caption> e cabeçalhos (RNF-023)", () => {
    const doc = parse(<StrongholdsPanel candidatos={candidatos} rows={rows} />);
    const tabelas = doc.querySelectorAll('[data-testid="stronghold-column"]');
    // Antes de 2026-09-10 eram três colunas simultâneas; agora as pílulas
    // filtram e só a selecionada é desenhada.
    expect(tabelas).toHaveLength(1);

    const unica = tabelas[0];
    expect(unica?.querySelector("caption")?.textContent).toContain("Candidato PT");
    expect(
      Array.from(unica?.querySelectorAll("thead th") ?? []).map((th) => th.textContent),
    ).toEqual(["UF", "Posição", "Diferença", "Projetado"]);
  });

  it("(h) candidato sem nenhuma UF publicada mostra a ausência, não uma tabela vazia (ADR-0017)", () => {
    const doc = parse(<StrongholdsPanel candidatos={candidatos} rows={[makeRow("AC", [])]} />);
    expect(doc.body.textContent).toContain("Nenhuma UF publicou percentual para este candidato");
  });

  it("(i) a nota declara o corte de posição (a constante, não um número solto) e o caráter não oficial", () => {
    // 2026-10-03 — o texto antigo dizia "no máximo três candidatos por UF",
    // obsoleto desde 19/09 (o corte é `STRONGHOLD_POSICAO_MAX`, 4). A frase
    // agora sai da constante, então não pode voltar a mentir sozinha.
    const doc = parse(<StrongholdsPanel candidatos={candidatos} rows={rows} />);
    const nota = doc.querySelector('[data-testid="strongholds-nota"]')?.textContent ?? "";
    expect(nota).toContain(`entre os ${STRONGHOLD_POSICAO_MAX} primeiros colocados`);
    expect(nota).not.toContain("três");
    // RF-295 — a nota explica os dois critérios.
    expect(nota).toContain("“Percentual”");
    expect(nota).toContain("“Votos”");
    expect(nota).toContain("não oficial");
  });

  it("(j) toda barra colorida por partido leva contorno (WCAG 1.4.11 / constituição § 4)", () => {
    const doc = parse(<StrongholdsPanel candidatos={candidatos} rows={rows} />);
    const trilhos = Array.from(doc.querySelectorAll<HTMLElement>("tbody td span[aria-hidden]"));
    expect(trilhos.length).toBeGreaterThan(0);
    for (const t of trilhos) {
      expect(t.getAttribute("style")).toContain("var(--text-secondary)");
    }
  });

  it("(k) uma pílula por candidato, rotulada pelo PRIMEIRO nome, no máximo 5", () => {
    const seis = [1, 2, 3, 4, 5, 6].map((n) =>
      makeCand({ id: n, nome: `Nome${n} Sobrenome${n}`, partido: "PT", rank: n }),
    );
    const doc = parse(<StrongholdsPanel candidatos={seis} rows={rows} />);
    const chips = Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="stronghold-chip"]'));

    expect(chips).toHaveLength(5); // `race.candidates.slice(0, 5)` do kit
    // O `<span class="sr-only">` acrescenta a sigla só para leitor de tela; o
    // rótulo VISÍVEL é o primeiro nome e nada mais.
    const rotuloVisivel = (el: HTMLElement) => {
      const copia = el.cloneNode(true) as HTMLElement;
      copia.querySelector(".sr-only")?.remove();
      return copia.textContent?.trim();
    };
    expect(chips.map((c) => rotuloVisivel(c))).toEqual([
      "Nome1",
      "Nome2",
      "Nome3",
      "Nome4",
      "Nome5",
    ]);
    expect(chips.map((c) => c.getAttribute("data-candidato"))).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("(k2) primeiros nomes iguais não viram pílulas idênticas — desempata pela sigla", () => {
    // Caso real do fixture do repo: "Candidato PT", "Candidato PL", … — o
    // corte no primeiro nome produziria cinco pílulas escritas "Candidato".
    expect(
      chipLabels([
        { nome: "Candidato PT", partido: "PT" },
        { nome: "Candidato PL", partido: "PL" },
        { nome: "Ciro Gomes", partido: "PDT" },
      ]),
    ).toEqual(["Candidato PT", "Candidato PL", "Ciro"]);

    // Nomes de urna distintos (o caso do protótipo): saída idêntica à do kit.
    expect(
      chipLabels([
        { nome: "Lula da Silva", partido: "PT" },
        { nome: "Tarcísio de Freitas", partido: "REPUBLICANOS" },
      ]),
    ).toEqual(["Lula", "Tarcísio"]);

    // Colidem e não há sigla para desempatar → nome completo.
    expect(
      chipLabels([
        { nome: "Maria Silva", partido: "" },
        { nome: "Maria Souza", partido: "" },
      ]),
    ).toEqual(["Maria Silva", "Maria Souza"]);
  });

  it("(l) a primeira pílula nasce selecionada e as demais não (aria-pressed)", () => {
    const doc = parse(<StrongholdsPanel candidatos={candidatos} rows={rows} />);
    const chips = Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="stronghold-chip"]'));
    expect(chips.map((c) => c.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    // O estado NÃO é carregado só pela cor — `aria-pressed` é o portador.
    expect(chips[0]?.getAttribute("data-ativo")).toBe("true");
  });

  it("(m) a pílula selecionada pinta com o par medido -chip/-ink, não com colorForParty()", () => {
    const doc = parse(<StrongholdsPanel candidatos={candidatos} rows={rows} />);
    const chips = Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="stronghold-chip"]'));
    const estilo = chips[0]?.getAttribute("style") ?? "";

    expect(estilo).toContain("var(--party-pt-chip)");
    expect(estilo).toContain("var(--party-pt-ink)");
    // `--party-pt` cru como fundo seria o erro que este teste existe para
    // impedir: ele não vem com tinta medida.
    expect(estilo).not.toMatch(/var\(--party-pt\)/);

    // Não selecionada: sem preenchimento inline nenhum (contorno hairline do
    // módulo CSS).
    expect(chips[1]?.getAttribute("style")).toBeNull();
  });

  it("(n) sigla sem token de partido não inventa par — cai no inverso do shell", () => {
    expect(chipFillFor("PT")).toEqual({
      background: "var(--party-pt-chip)",
      ink: "var(--party-pt-ink)",
    });
    expect(chipFillFor("")).toEqual({
      background: "var(--surface-inverse)",
      ink: "var(--text-inverse)",
    });
    expect(chipFillFor(undefined)).toEqual({
      background: "var(--surface-inverse)",
      ink: "var(--text-inverse)",
    });
  });

  it("(o) as pílulas são um grupo rotulado e apontam para a tabela que trocam", () => {
    const doc = parse(<StrongholdsPanel candidatos={candidatos} rows={rows} />);
    const grupo = doc.querySelector('[data-testid="strongholds-chips"]');
    expect(grupo?.tagName).toBe("FIELDSET");
    expect(grupo?.querySelector("legend")?.textContent).toBe("Escolher candidato");

    const chip = doc.querySelector<HTMLElement>('[data-testid="stronghold-chip"]');
    const tabela = doc.querySelector<HTMLElement>('[data-testid="stronghold-column"]');
    expect(chip?.getAttribute("aria-controls")).toBe(tabela?.getAttribute("id"));
    expect(tabela?.getAttribute("id")).toBeTruthy();
  });

  it("(p) lista as 10 UFs mais fortes do selecionado, não 5", () => {
    // 12 UFs em que o PT aparece; o corte tem de ser 10.
    const muitas = Array.from({ length: 12 }, (_, i) =>
      makeRow(`U${i}`, [
        { id: 13, pct: 60 - i },
        { id: 22, pct: 20 },
      ]),
    );
    const doc = parse(<StrongholdsPanel candidatos={[pt, pl]} rows={muitas} />);
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(10);
    // O caption conta as UFs do candidato ANTES do corte: "12 de 12", não
    // "10 de 12" — este dizia que só 10 estados tinham dado.
    expect(doc.querySelector("caption")?.textContent).toContain(
      "12 de 12 UFs com percentual publicado",
    );
  });
});

/**
 * O clique. `renderToStaticMarkup` não hidrata, então esta parte monta de
 * verdade (`createRoot` + `act`, happy-dom) — é o único jeito de medir que a
 * pílula TROCA a tabela, que é o comportamento inteiro da mudança.
 */
// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("<StrongholdsPanel /> — a pílula filtra", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<StrongholdsPanel candidatos={candidatos} rows={rows} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const chips = () =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-testid="stronghold-chip"]'));
  const caption = () => container.querySelector("caption")?.textContent ?? "";
  const ufsNaTabela = () =>
    Array.from(container.querySelectorAll<HTMLElement>("tbody tr[data-uf]")).map((tr) =>
      tr.getAttribute("data-uf"),
    );

  it("(q) clicar na segunda pílula troca a tabela para aquele candidato", () => {
    expect(caption()).toContain("Candidato PT");
    expect(ufsNaTabela()).toEqual(["BA", "MG", "SC"]); // as UFs do PT

    act(() => chips()[1]?.click());

    expect(caption()).toContain("Candidato PL");
    // As UFs do PL, por percentual desc: SC 58, MG 44, RR 35, BA 28.
    expect(ufsNaTabela()).toEqual(["SC", "MG", "RR", "BA"]);
  });

  it("(r) só uma pílula fica pressionada por vez", () => {
    act(() => chips()[2]?.click());
    expect(chips().map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    // E a tabela seguiu: `semPartido` (#99) só aparece em RR.
    expect(ufsNaTabela()).toEqual(["RR"]);
  });

  it("(s) a pílula pressionada ganha o preenchimento medido; a anterior o perde", () => {
    act(() => chips()[1]?.click());

    // `style.background` volta o token literal — não resolvemos CSS aqui.
    expect(chips()[1]?.style.background).toContain("--party-pl-chip");
    expect(chips()[1]?.style.color).toContain("--party-pl-ink");
    expect(chips()[0]?.style.background).toBe("");
  });

  it("(t) o aria-controls continua apontando para a tabela depois da troca", () => {
    act(() => chips()[1]?.click());
    const alvo = chips()[1]?.getAttribute("aria-controls");
    expect(alvo).toBeTruthy();
    expect(container.querySelector(`#${alvo}`)?.getAttribute("data-testid")).toBe(
      "stronghold-column",
    );
  });
});

describe("STRONGHOLD_POSICAO_MAX — o 4º colocado conta como reduto (2026-09-19)", () => {
  /**
   * 🔴 **Este bloco existe porque a suíte inteira era CEGA ao número.**
   *
   * Em 19/09 `STRONGHOLD_POSICAO_MAX` passou de 3 para 4 (pedido do dono, depois
   * de o produtor subir `TOP_CANDIDATOS_POR_UF` para 4). Aplicando a mutação de
   * volta para 3, os **21 testes existentes continuavam verdes** — nenhuma
   * fixture daqui tinha mais de 3 candidatos por UF, então o corte nunca era
   * exercido. Um teste que passa com o defeito aplicado não protege nada, e a
   * regra da casa é aplicar a mutação em vez de confiar no verde.
   *
   * As fixtures abaixo têm **5** candidatos por UF de propósito: é o mínimo para
   * distinguir três comportamentos ao mesmo tempo — o 4º entra, o 5º não entra,
   * e a posição é contada do topo.
   */
  const quarto = makeCand({ id: 40, nome: "Candidato 4º", partido: "PSD", rank: 4 });
  const quinto = makeCand({ id: 50, nome: "Candidato 5º", partido: "PP", rank: 5 });
  const byId5 = new Map([...candidatos, quarto, quinto].map((c) => [c.id, c]));

  /** Uma UF com 5 candidaturas — o alvo (40) em 4º, e um 5º logo atrás. */
  const rowsCinco: EdgeUfRow[] = [
    makeRow("SP", [
      { id: 13, pct: 40 },
      { id: 22, pct: 30 },
      { id: 99, pct: 18 },
      { id: 40, pct: 8 },
      { id: 50, pct: 4 },
    ]),
  ];

  it("o 4º colocado de uma UF ENTRA na lista de redutos dele", () => {
    // Mutação que morre: `STRONGHOLD_POSICAO_MAX = 3`. Com 3, o candidato 40 é
    // cortado antes do `findIndex` e a lista sai vazia — que era exatamente o
    // defeito que a docstring deste arquivo lamentava ("a pílula do 4º colocado
    // nacional pode abrir uma tabela vazia").
    const lista = strongholdsFor(40, rowsCinco, byId5);
    expect(lista.map((l) => l.sigla)).toEqual(["SP"]);
    expect(lista[0]?.pct).toBe(8);
  });

  it("a posição do 4º é 4, contada do TOPO", () => {
    // Mutação que morre: contar a posição a partir do fim (`top.length - i`),
    // que daria 2 aqui e passaria despercebido numa fixture de 4 linhas.
    expect(strongholdsFor(40, rowsCinco, byId5)[0]?.posicao).toBe(4);
  });

  it("🔴 o 5º colocado continua FORA — o corte subiu, não sumiu", () => {
    // Mutação que morre: trocar o `.slice()` por nada, ou pôr um número grande.
    // Sem este caso, `STRONGHOLD_POSICAO_MAX = 99` passaria nos dois testes
    // acima, e o painel deixaria de ter corte nenhum sem ninguém notar.
    expect(strongholdsFor(50, rowsCinco, byId5)).toEqual([]);
  });

  it("a diferença do 4º é medida contra o LÍDER, não contra o 3º", () => {
    // O 4º não lidera, então a régua é o 1º colocado (40 − 8 = 32pp negativos).
    // Mutação que morre: comparar com o vizinho de cima (18 − 8 = 10pp).
    expect(strongholdsFor(40, rowsCinco, byId5)[0]?.diff).toBe(-32);
  });
});

/**
 * RF-295 (2026-10-03) — a chave "Ordenar por": Percentual | Votos.
 *
 * O número em votos é `(me.pct − contra.pct) / 100 × votos_disputa_projetados`,
 * com o MESMO `contra` da diferença em pp. As fixtures abaixo são escolhidas
 * para que cada mutação plausível mude a saída:
 *   - os totais das UFs são muito diferentes entre si, então a ordem por votos
 *     DIVERGE da ordem por percentual (senão "ordenar por votos" passaria
 *     ordenando por pct);
 *   - há sinais mistos (o PT lidera em umas, perde em outras);
 *   - há uma UF SEM `votos_disputa_projetados` — que tem de sumir, não virar 0;
 *   - há um empate exato em votos para medir o desempate pela sigla.
 */
describe("RF-295 — strongholdsFor(..., 'votos')", () => {
  function rowV(
    sigla: string,
    top: Array<{ id: number; pct: number; votos_atuais?: number }>,
    total: number | undefined,
  ): EdgeUfRow {
    const r = makeRow(sigla, top as Array<{ id: number; pct: number }>);
    return total === undefined ? r : { ...r, votos_disputa_projetados: total };
  }

  // PT (#13) × PL (#22), mais o #99 como 3º em uma delas.
  const rowsV: EdgeUfRow[] = [
    // PT lidera por 34pp num estado pequeno: 0,34 × 400.000 = +136.000
    rowV(
      "AC",
      [
        { id: 13, pct: 62, votos_atuais: 1 },
        { id: 22, pct: 28, votos_atuais: 1 },
      ],
      400_000,
    ),
    // PT lidera por 4pp num estado enorme: 0,04 × 25.000.000 = +1.000.000
    rowV(
      "SP",
      [
        { id: 13, pct: 46, votos_atuais: 1 },
        { id: 22, pct: 42, votos_atuais: 1 },
        { id: 99, pct: 12, votos_atuais: 1 },
      ],
      25_000_000,
    ),
    // PT em 2º, perde por 10pp: −0,10 × 3.000.000 = −300.000
    rowV(
      "SC",
      [
        { id: 22, pct: 55 },
        { id: 13, pct: 45 },
      ],
      3_000_000,
    ),
    // PT em 2º, perde por 30pp num estado pequeno: −0,30 × 500.000 = −150.000
    rowV(
      "RR",
      [
        { id: 22, pct: 60 },
        { id: 13, pct: 30 },
      ],
      500_000,
    ),
    // PT lidera por 20pp, mas a UF NÃO publica o total → fora do modo Votos.
    rowV(
      "BA",
      [
        { id: 13, pct: 60 },
        { id: 22, pct: 40 },
      ],
      undefined,
    ),
  ];

  it("a fórmula: diff em pp / 100 × votos_disputa_projetados, arredondada", () => {
    const porSigla = new Map(strongholdsFor(13, rowsV, byId, "votos").map((l) => [l.sigla, l]));
    expect(porSigla.get("AC")?.diffVotos).toBe(136_000);
    expect(porSigla.get("SP")?.diffVotos).toBe(1_000_000);
    expect(porSigla.get("SC")?.diffVotos).toBe(-300_000);
    expect(porSigla.get("RR")?.diffVotos).toBe(-150_000);
  });

  it("arredonda para inteiro (o produto raramente fecha)", () => {
    const r = rowV(
      "PI",
      [
        { id: 13, pct: 50.123 },
        { id: 22, pct: 49.877 },
      ],
      1_234_567,
    );
    // 0,246 / 100 × 1.234.567 = 3.037,03 → 3.037
    expect(strongholdsFor(13, [r], byId, "votos")[0]?.diffVotos).toBe(3037);
  });

  it("o `contra` é o mesmo da diferença em pp: em 1º, o 2º; abaixo, o 1º — nunca o vizinho", () => {
    // O #99 está em 3º em SP; contra ele a diferença é contra o 1º (PT, 46).
    // 12 − 46 = −34pp × 25.000.000 = −8.500.000. Contra o 2º (PL, 42) seriam
    // −7.500.000 — a mutação "comparar com o vizinho de cima" morre aqui.
    expect(strongholdsFor(99, rowsV, byId, "votos")[0]?.diffVotos).toBe(-8_500_000);
    // E o líder mede contra o 2º, não contra o 3º: (46 − 42) e não (46 − 12).
    expect(strongholdsFor(13, rowsV, byId, "votos").find((l) => l.sigla === "SP")?.diffVotos).toBe(
      1_000_000,
    );
  });

  it("ordena por diffVotos desc: maiores vantagens, depois menores desvantagens", () => {
    expect(strongholdsFor(13, rowsV, byId, "votos").map((l) => l.sigla)).toEqual([
      "SP", // +1.000.000
      "AC", // +136.000
      "RR", // −150.000
      "SC", // −300.000
    ]);
    // Pré-condição de discriminação: por percentual a ordem é OUTRA.
    expect(strongholdsFor(13, rowsV, byId).map((l) => l.sigla)).toEqual([
      "AC",
      "BA",
      "SP",
      "SC",
      "RR",
    ]);
  });

  it("🔴 UF sem votos_disputa_projetados fica FORA do modo Votos — nunca entra como 0", () => {
    const lista = strongholdsFor(13, rowsV, byId, "votos");
    expect(lista.map((l) => l.sigla)).not.toContain("BA");
    // No modo Percentual ela continua lá, com `diffVotos` nulo (não 0).
    const ba = strongholdsFor(13, rowsV, byId).find((l) => l.sigla === "BA");
    expect(ba).toBeDefined();
    expect(ba?.diffVotos).toBeNull();
  });

  it("total de votos projetado = 0 é tratado como ausente, não como diferença de 0 votos", () => {
    const zero = rowV(
      "AP",
      [
        { id: 13, pct: 70 },
        { id: 22, pct: 30 },
      ],
      0,
    );
    const lista = strongholdsFor(13, [...rowsV, zero], byId, "votos");
    expect(lista.map((l) => l.sigla)).not.toContain("AP");
    expect(strongholdsFor(13, [zero], byId)[0]?.diffVotos).toBeNull();
  });

  it("empate exato em votos desempata pela sigla, independente da ordem de entrada", () => {
    const empate = [
      rowV(
        "TO",
        [
          { id: 13, pct: 60 },
          { id: 22, pct: 40 },
        ],
        1_000_000,
      ),
      rowV(
        "AP",
        [
          { id: 13, pct: 70 },
          { id: 22, pct: 30 },
        ],
        500_000,
      ),
    ];
    // Os dois dão +200.000.
    expect(strongholdsFor(13, empate, byId, "votos").map((l) => l.sigla)).toEqual(["AP", "TO"]);
    expect(strongholdsFor(13, [...empate].reverse(), byId, "votos").map((l) => l.sigla)).toEqual([
      "AP",
      "TO",
    ]);
  });

  it("formatVotosDiferenca: compacto, com o mesmo sinal negativo de formatPp (U+2212)", () => {
    expect(formatVotosDiferenca(1_234_567)).toBe("+1,2 mi");
    expect(formatVotosDiferenca(-340_000)).toBe("−340 mil");
    expect(formatVotosDiferenca(-340_000).charCodeAt(0)).toBe(0x2212);
    expect(formatVotosDiferenca(0)).toBe("0");
    expect(formatVotosDiferenca(850)).toBe("+850");
  });
});

describe("RF-295 — a chave 'Ordenar por' no painel montado", () => {
  let container: HTMLElement;
  let root: Root;

  // Três UFs em que a ordem por votos é o INVERSO da ordem por percentual.
  const rowsChave: EdgeUfRow[] = [
    {
      ...makeRow("AC", [
        { id: 13, pct: 70 },
        { id: 22, pct: 30 },
      ]),
      votos_disputa_projetados: 300_000,
    }, // +120.000
    {
      ...makeRow("RJ", [
        { id: 13, pct: 55 },
        { id: 22, pct: 45 },
      ]),
      votos_disputa_projetados: 9_000_000,
    }, // +900.000
    {
      ...makeRow("SP", [
        { id: 13, pct: 51 },
        { id: 22, pct: 49 },
      ]),
      votos_disputa_projetados: 25_000_000,
    }, // +500.000
    // PL lidera; sem total → some do modo Votos.
    makeRow("SC", [
      { id: 22, pct: 58 },
      { id: 13, pct: 42 },
    ]),
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<StrongholdsPanel candidatos={candidatos} rows={rowsChave} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const botoes = () =>
    Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="stronghold-criterio-botao"]'),
    );
  const botao = (c: string) => botoes().find((b) => b.getAttribute("data-criterio") === c);
  const chips = () =>
    Array.from(container.querySelectorAll<HTMLElement>('[data-testid="stronghold-chip"]'));
  const caption = () => container.querySelector("caption")?.textContent ?? "";
  const ufs = () =>
    Array.from(container.querySelectorAll<HTMLElement>("tbody tr[data-uf]")).map((tr) =>
      tr.getAttribute("data-uf"),
    );
  const diferencas = () =>
    Array.from(container.querySelectorAll<HTMLElement>("tbody tr[data-uf]")).map(
      (tr) => tr.querySelectorAll("td")[1]?.textContent,
    );
  const cabecalhoDiferenca = () => container.querySelectorAll("thead th")[2]?.textContent;

  it("nasce em Percentual: ordem, régua em pp e aria-pressed", () => {
    expect(botoes().map((b) => b.textContent)).toEqual(["Percentual", "Votos"]);
    expect(botoes().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(ufs()).toEqual(["AC", "RJ", "SP", "SC"]);
    expect(diferencas()).toEqual(["+40,0 pp", "+10,0 pp", "+2,0 pp", "−16,0 pp"]);
    expect(cabecalhoDiferenca()).toBe("Diferença");
    expect(caption()).toContain("Ordenado pelo percentual projetado");
  });

  it("o grupo é um fieldset com legend 'Ordenar por' e aponta para a tabela", () => {
    const grupo = container.querySelector('[data-testid="strongholds-criterio"]');
    expect(grupo?.tagName).toBe("FIELDSET");
    expect(grupo?.querySelector("legend")?.textContent).toBe("Ordenar por");
    // O rótulo visível é um irmão `aria-hidden` dos botões, não a legend:
    // legend flutuada não entra na fileira no WebKit.
    const visivel = grupo?.querySelector('span[aria-hidden="true"]');
    expect(visivel?.textContent).toBe("Ordenar por");
    const tabelaId = container.querySelector('[data-testid="stronghold-column"]')?.id;
    expect(tabelaId).toBeTruthy();
    for (const b of botoes()) {
      expect(b.getAttribute("type")).toBe("button");
      expect(b.getAttribute("aria-controls")).toBe(tabelaId);
    }
  });

  it("clicar em Votos reordena, troca a régua, o cabeçalho, o aria-pressed e o caption", () => {
    act(() => botao("votos")?.click());

    expect(botoes().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    expect(ufs()).toEqual(["RJ", "SP", "AC"]); // 900 mil, 500 mil, 120 mil; SC fora
    expect(diferencas()).toEqual(["+900 mil", "+500 mil", "+120 mil"]);
    expect(cabecalhoDiferenca()).toBe("Diferença em votos");
    expect(caption()).toContain("Ordenado pela diferença em votos projetados");
    expect(caption()).not.toContain("percentual projetado");
    // O denominador real: 3 de 4 UFs, e a UF descartada é declarada.
    expect(caption()).toContain("3 de 4 UFs com votos projetados para este candidato");
    expect(caption()).toContain("1 UF sem total de votos projetado fora da lista");
    // A coluna "Projetado" não muda de régua.
    const projetado = Array.from(container.querySelectorAll("tbody tr[data-uf]")).map(
      (tr) => tr.querySelectorAll("td")[2]?.textContent,
    );
    expect(projetado).toEqual(["55,0%", "51,0%", "70,0%"]);
  });

  it("trocar de candidato PRESERVA o critério escolhido", () => {
    act(() => botao("votos")?.click());
    act(() => chips()[1]?.click()); // PL

    expect(caption()).toContain("Candidato PL");
    expect(botao("votos")?.getAttribute("aria-pressed")).toBe("true");
    // PL: RJ −900 mil, SP −500 mil, AC −120 mil (a ordem desc põe a menor
    // desvantagem primeiro); SC (onde o PL lidera) fica fora por não ter total.
    expect(ufs()).toEqual(["AC", "SP", "RJ"]);
    expect(diferencas()).toEqual(["−120 mil", "−500 mil", "−900 mil"]);
  });

  it("voltar para Percentual restaura exatamente a tabela original", () => {
    act(() => botao("votos")?.click());
    act(() => botao("percentual")?.click());
    expect(ufs()).toEqual(["AC", "RJ", "SP", "SC"]);
    expect(diferencas()).toEqual(["+40,0 pp", "+10,0 pp", "+2,0 pp", "−16,0 pp"]);
    expect(caption()).toContain("Ordenado pelo percentual projetado");
  });
});
