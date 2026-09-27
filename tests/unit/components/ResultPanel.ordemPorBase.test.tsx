// @vitest-environment happy-dom
/**
 * tests/unit/components/ResultPanel.ordemPorBase.test.tsx
 *
 * "Tudo acompanha a base ativa" (decisão do dono, 2026-09-20).
 *
 * Até aqui a home ordenava a lista por PROJEÇÃO (a ordem que o produtor
 * publica) e as três rotas de UF ordenavam por PARCIAL, e nenhuma das duas
 * reagia ao controle "Parcial / Projeção" do shell. Agora as quatro telas
 * seguem a base que está na tela — lista, numeração, destaque de margem e
 * ocupação de vaga.
 *
 * ## Como se testa uma ordem que o CSS resolve
 *
 * `data-view` é estado de cliente e as rotas são estáticas (ADR-0025 §§ 2 e
 * 5), então o servidor emite UMA lista, na ordem da projeção, e a cascata de
 * `app/globals.css` reposiciona as linhas com `order` quando a base é
 * "Parcial". O happy-dom não faz layout — `getBoundingClientRect()` devolve
 * zeros —, então **não se mede pixel aqui**. Mede-se o contrato dos dois
 * lados, e os dois estão neste arquivo:
 *
 *   1. o que o componente EMITE: `--ord-parcial` / `--ord-proj` por linha,
 *      os dois números da esquerda, os dois marcadores de vaga;
 *   2. o que a folha de estilo LÊ: a regra de `app/globals.css` que liga cada
 *      custom property à sua base. Sem (2), apagar a regra — ou trocar as duas
 *      propriedades entre si — deixaria (1) verde com a tela congelada numa
 *      base só.
 *
 * ## A fixture
 *
 * As duas ordens são invertidas de ponta a ponta, de propósito: qualquer
 * asserção que "passe pelas duas" por coincidência aqui estaria medindo a
 * fixture, não o código.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResultPanel, type ResultPanelCandidate } from "@/components/blocks/ResultPanel";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function cand(
  id: number,
  nome: string,
  partido: string,
  pctAtual: number,
  pctProjetado: number,
): ResultPanelCandidate {
  return {
    id,
    nome,
    partido,
    cor: `var(--color-cand-${id})`,
    votos_atuais: Math.round(pctAtual * 10_000),
    pct_atual: pctAtual,
    pct_projetado: pctProjetado,
  };
}

/**
 * Quatro candidaturas em que as duas bases discordam em TODAS as posições:
 *
 *   por `pct_atual`     → Célia (60) · Bruno (20) · Ana (10) · Davi (2)
 *   por `pct_projetado` → Ana (40)   · Bruno (30) · Célia (29) · Davi (1)
 */
const INVERTIDA: ResultPanelCandidate[] = [
  cand(1, "Ana Lima", "PT", 10, 40),
  cand(2, "Bruno Reis", "PL", 20, 30),
  cand(3, "Célia Mota", "MDB", 60, 29),
  cand(4, "Davi Nunes", "PSOL", 2, 1),
];

/** As linhas na ordem de uma base, lidas pela custom property que o CSS usa. */
function ordemDaBase(doc: Document, base: "parcial" | "proj"): string[] {
  const linhas = [...doc.querySelectorAll("li[data-ord]")];
  return linhas
    .map((li) => {
      const style = li.getAttribute("style") ?? "";
      const m = style.match(new RegExp(`--ord-${base}:\\s*(\\d+)`));
      return { pos: m ? Number(m[1]) : Number.NaN, nome: li.textContent ?? "" };
    })
    .sort((a, b) => a.pos - b.pos)
    .map((x) => x.nome);
}

/** O `<li>` de uma candidatura, pelo nome completo. */
function linhaDe(doc: Document, nomeCompleto: string): Element | undefined {
  return [...doc.querySelectorAll("li[data-ord]")].find((li) =>
    li.textContent?.includes(nomeCompleto),
  );
}

function renderPainel(over: Partial<React.ComponentProps<typeof ResultPanel>> = {}) {
  return parse(
    <ResultPanel candidatos={INVERTIDA} pctApurado={62} title="SP" titleId="t" {...over} />,
  );
}

describe("<ResultPanel /> — a ordem da lista acompanha a base ativa", () => {
  it("(a) na base `parcial` a ordem é a de `pct_atual` desc", () => {
    const nomes = ordemDaBase(renderPainel(), "parcial");

    expect(nomes[0]).toContain("Célia Mota");
    expect(nomes[1]).toContain("Bruno Reis");
    expect(nomes[2]).toContain("Ana Lima");
    expect(nomes[3]).toContain("Davi Nunes");
  });

  it("(b) na base `proj` a ordem é a de `pct_projetado` desc", () => {
    const nomes = ordemDaBase(renderPainel(), "proj");

    expect(nomes[0]).toContain("Ana Lima");
    expect(nomes[1]).toContain("Bruno Reis");
    expect(nomes[2]).toContain("Célia Mota");
    expect(nomes[3]).toContain("Davi Nunes");
  });

  it("(c) a ordem do DOM é a da PROJEÇÃO, e a linha declara isso", () => {
    // Não é detalhe: é a ordem em que a página abre (o servidor escreve
    // `data-view="proj"` no `<html>`) e a que leitor de tela e `Ctrl+F` veem.
    const doc = renderPainel();
    const linhas = [...doc.querySelectorAll("li[data-ord]")];

    expect(linhas.map((li) => li.getAttribute("data-ord"))).toEqual([
      "proj",
      "proj",
      "proj",
      "proj",
    ]);
    expect(linhas[0]?.textContent).toContain("Ana Lima");
    expect(linhas[2]?.textContent).toContain("Célia Mota");
  });

  // 🔴 **INVERTIDO em 2026-09-20.** Este caso exigia que a cascata de `order`
  // existisse. Ela foi REMOVIDA: `order` movia pixel e deixava o documento na
  // ordem da Projeção, e leitor de tela, teclado, `Ctrl+F` e copiar-colar
  // recebiam a lista fora de ordem (WCAG SC 1.3.2, nível A — dívida 17).
  // Quem reordena agora é `<ReordenaListaPorBase>`, no DOM.
  //
  // O caso vira guarda contra a REINTRODUÇÃO: com a reordenação no DOM, uma
  // regra de `order` COMPÕE com ela e produz uma terceira ordem, que não é
  // nenhuma das duas bases.
  //
  // ⚠️ Armadilha que me pegou ao escrever isto: o `replace(/\s+/g, " ")` faz o
  // teste casar com o texto de COMENTÁRIO também. A primeira versão da
  // remoção deixou a regra antiga reproduzida no comentário de `globals.css`,
  // e o caso continuou passando pelo motivo errado.
  it("(d) a cascata de `order` NÃO existe — quem reordena é o DOM", () => {
    const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf-8").replace(
      /\s+/g,
      " ",
    );

    expect(css).not.toContain("[data-ord] { order: var(--ord-parcial); }");
    expect(css).not.toContain("[data-ord] { order: var(--ord-proj); }");

    // As custom properties CONTINUAM sendo emitidas — o que mudou é quem as
    // lê: JavaScript, não a cascata. Sem elas não há o que reordenar.
    const doc = renderPainel();
    const li = doc.querySelector("li[data-ord]");
    expect(li?.getAttribute("style")).toContain("--ord-parcial");
    expect(li?.getAttribute("style")).toContain("--ord-proj");
  });
});

/*
 * 🔴 2026-09-27 — "o número da esquerda acompanha a base" SAIU com a versão D.
 *
 * Os casos (e)/(f)/(g) daqui mediam o número de colocação à esquerda de cada
 * linha ("1", "2", "3", um por base quando divergiam). A versão D do protótipo,
 * escolhida pelo dono em 2026-09-27
 * (`docs/design-system/prototipos/apuracao-2026-09-27/README.md`), NÃO tem esse
 * número: a posição é dita pela ordem física da lista (que já acompanha a base,
 * casos (a)–(d)) e pelos dois cartões. A versão com linhas numeradas era a E, e
 * não foi a escolhida. O que acompanha a base no lugar dele é o SELO dos dois
 * cartões — é isso que os casos abaixo medem.
 */
describe("<ResultPanel /> — versão D: sem número de colocação; o selo acompanha a base", () => {
  it("(e) nenhuma linha imprime número de colocação — só o número na urna, ao lado da sigla", () => {
    const doc = renderPainel();
    const ana = linhaDe(doc, "Ana Lima");

    // "PT – 1": sigla e número na urna (o `id`, ADR-0042).
    expect(ana?.textContent).toContain("PT – 1");
    // Nenhum filho da linha é um algarismo solto — o que o número de
    // colocação era.
    const soltos = [...(ana?.querySelectorAll("*") ?? [])].filter(
      (el) => el.children.length === 0 && /^\d+$/.test((el.textContent ?? "").trim()),
    );
    expect(soltos).toHaveLength(0);
  });

  it("(f) selo de turno: só quem é top-2 DAQUELA base, sob a base dela", () => {
    const doc = renderPainel({ selo: "turno", turno: 1 });
    const selos = (nome: string, base: string) =>
      [
        ...(linhaDe(doc, nome)?.querySelectorAll(
          `[data-view-only="${base}"] [data-testid="result-selo"]`,
        ) ?? []),
      ].map((el) => el.textContent);

    // Projeção: Ana (40) e Bruno (30). Parcial: Célia (60 — > 50%, vence) só.
    expect(selos("Ana Lima", "proj")).toEqual(["2º turno · projeção"]);
    expect(selos("Bruno Reis", "proj")).toEqual(["2º turno · projeção"]);
    expect(selos("Célia Mota", "proj")).toEqual([]);
    expect(selos("Célia Mota", "parcial")).toEqual(["Venceria no 1º turno · na parcial"]);
    // Célia passa de 50% na parcial ⇒ o 2º DA PARCIAL (Bruno) fica sem selo.
    expect(selos("Bruno Reis", "parcial")).toEqual([]);
    expect(selos("Ana Lima", "parcial")).toEqual([]);
    expect(selos("Davi Nunes", "proj")).toEqual([]);
    expect(selos("Davi Nunes", "parcial")).toEqual([]);
  });

  it("(g) no máximo UM selo por base em cada linha, e nenhum fora de `data-view-only`", () => {
    const doc = renderPainel({ selo: "turno", turno: 1 });
    for (const li of doc.querySelectorAll("li[data-ord]")) {
      for (const base of ["parcial", "proj"]) {
        expect(
          li.querySelectorAll(`[data-view-only="${base}"] [data-testid="result-selo"]`).length,
        ).toBeLessThanOrEqual(1);
      }
      for (const selo of li.querySelectorAll('[data-testid="result-selo"]')) {
        expect(selo.closest("[data-view-only]")).not.toBeNull();
      }
    }
  });
});

describe("<ResultPanel /> — o destaque de margem acompanha a base", () => {
  it("(h) cada figura mede o par DAQUELA base, e o rótulo nomeia o líder dela", () => {
    const doc = renderPainel();
    const parcial = doc.querySelector("[data-testid='result-margem-parcial']")?.textContent ?? "";
    const proj = doc.querySelector("[data-testid='result-margem-proj']")?.textContent ?? "";

    // Parcial: Célia 60 − Bruno 20 = 40 pp.
    expect(parcial).toContain("40,0");
    expect(parcial.toLowerCase()).toContain("margem célia");
    // Projeção: Ana 40 − Bruno 30 = 10 pp.
    expect(proj).toContain("10,0");
    expect(proj.toLowerCase()).toContain("margem ana");

    // 🔴 O defeito que isto mata: a figura de projeção mostrando o número
    // projetado sob o nome de quem lidera a PARCIAL.
    expect(proj.toLowerCase()).not.toContain("margem célia");
  });

  it("(i) cada barra de maioria desenha o líder e o 2º da sua base", () => {
    const doc = renderPainel();
    const rotulos = (base: string) =>
      [
        ...(doc
          .querySelector(`[data-view-only="${base}"] [data-testid="vote-bar"]`)
          ?.querySelectorAll("[data-testid='vote-bar-segment']") ?? []),
      ].map((s) => s.getAttribute("data-label"));

    expect(rotulos("parcial")).toEqual(["Célia", "Outros", "Bruno"]);
    expect(rotulos("proj")).toEqual(["Ana", "Outros", "Bruno"]);
  });
});

describe("<ResultPanel vagas={2} /> — a ocupação de vaga acompanha a base", () => {
  const renderSenado = () => renderPainel({ vagas: 2 });

  it("(j) quem ocupa vaga em uma base só é marcado só naquela base", () => {
    const doc = renderSenado();
    const li = (nome: string) =>
      [...doc.querySelectorAll("li[data-ord]")].find((x) => x.textContent?.includes(nome));

    // Projeção elege Ana e Bruno; parcial elege Célia e Bruno.
    expect(li("Ana Lima")?.getAttribute("data-vaga")).toBe("proj");
    expect(li("Bruno Reis")?.getAttribute("data-vaga")).toBe("true");
    expect(li("Célia Mota")?.getAttribute("data-vaga")).toBe("parcial");
    expect(li("Davi Nunes")?.getAttribute("data-vaga")).toBeNull();
  });

  it("(k) o marcador exclusivo de uma base só aparece naquela base", () => {
    const doc = renderSenado();
    const ana = [...doc.querySelectorAll("li[data-ord]")].find((x) =>
      x.textContent?.includes("Ana Lima"),
    );
    const marcador = ana?.querySelector("[data-testid='result-vaga-marker']");

    expect(marcador?.parentElement?.getAttribute("data-view-only")).toBe("proj");
  });

  it("(l) o RÓTULO do marcador concorda com a base que está na tela", () => {
    // Uma tela dizendo "vaga projetada" embaixo de números parciais seria pior
    // que o defeito que esta mudança corrige.
    const doc = renderSenado();
    const texto = (nome: string) =>
      (
        [...doc.querySelectorAll("li[data-ord]")]
          .find((x) => x.textContent?.includes(nome))
          ?.querySelector("[data-testid='result-vaga-marker']")?.textContent ?? ""
      ).toLowerCase();

    expect(texto("Célia Mota")).toContain("parcial");
    expect(texto("Célia Mota")).not.toContain("projetada");
    expect(texto("Ana Lima")).toContain("projetada");

    // Bruno ocupa nas duas: os dois rótulos ficam no DOM, cada um sob a sua
    // base — nunca os dois visíveis ao mesmo tempo. (Versão D: dois selos, um
    // por base, cada um dentro do seu `data-view-only`.)
    const bruno = linhaDe(doc, "Bruno Reis");
    expect(
      bruno?.querySelector("[data-view-only='parcial'] [data-testid='result-vaga-marker']")
        ?.textContent,
    ).toMatch(/parcial/i);
    expect(
      bruno?.querySelector("[data-view-only='proj'] [data-testid='result-vaga-marker']")
        ?.textContent,
    ).toMatch(/projetada/i);
  });
});

describe("<ResultPanel /> — a COR não acompanha a base (constituição § 2)", () => {
  /**
   * Siglas fora da paleta editorial do ADR-0024 — o caminho em que
   * `candidateColor` não encontra token próprio. Até 2026-09-20 ele desviava
   * para `colorForRank`, e era o único lugar do produto em que a POSIÇÃO
   * pintava alguém: trocar de base (ou o 3º ultrapassar o 2º ao vivo) trocava
   * a tinta no meio da noite. Hoje as três caem no mesmo token estável.
   *
   * Quem cai aqui na vida real é **federação** — "PSDB/CIDADANIA",
   * "PSOL/REDE" —, por isso uma das três usa a forma de barra.
   */
  const SEM_PARTIDO_MAPEADO: ResultPanelCandidate[] = [
    cand(1, "Ana Lima", "PSDB/CIDADANIA", 10, 40),
    cand(2, "Bruno Reis", "YYY", 20, 30),
    cand(3, "Célia Mota", "WWW", 60, 29),
  ];

  /** Trio com token próprio — o caso em que as tintas SÃO distintas. */
  const COM_PARTIDO_MAPEADO: ResultPanelCandidate[] = [
    cand(1, "Ana Lima", "PT", 10, 40),
    cand(2, "Bruno Reis", "PSD", 20, 30),
    cand(3, "Célia Mota", "MDB", 60, 29),
  ];

  /**
   * Toda cor de identidade que o painel atribuiu a esta candidatura — nas DUAS
   * famílias de token. O recorte em `--color-cand-` sozinho deixaria este
   * arquivo passar vazio depois da correção de 2026-09-20 (nenhum daqueles
   * tokens chega mais à tela), e um teste que não encontra nada não prova
   * nada.
   */
  function coresDe(doc: Document, primeiroNome: string, nomeCompleto: string): Set<string> {
    const TOKEN = /var\(--(?:color-cand|party)-[\w-]+\)/g;
    const achadas = new Set<string>();
    const linha = [...doc.querySelectorAll("li[data-ord]")].find((li) =>
      li.textContent?.includes(nomeCompleto),
    );
    // Versão D (2026-09-27): a linha carrega a cor do partido DUAS vezes — a
    // base (`--party-x`, preenchimento) e a de texto (`--party-x-text`, o
    // percentual grande). São a MESMA identidade em dois papéis; o `-text` é
    // normalizado para a base aqui, e o caso (m2) afirma o par explicitamente.
    for (const m of (linha?.innerHTML ?? "").matchAll(TOKEN)) {
      achadas.add(m[0].replace(/-text\)$/, ")"));
    }
    for (const seg of doc.querySelectorAll(
      `[data-testid="vote-bar-segment"][data-label="${primeiroNome}"]`,
    )) {
      for (const m of (seg.getAttribute("style") ?? "").matchAll(TOKEN)) {
        achadas.add(m[0]);
      }
    }
    return achadas;
  }

  it("(m) cada candidatura sem partido mapeado tem UMA cor, igual nas duas bases", () => {
    const doc = parse(
      <ResultPanel candidatos={SEM_PARTIDO_MAPEADO} pctApurado={62} title="SP" titleId="t" />,
    );

    // Ana lidera a PROJEÇÃO e Célia lidera a PARCIAL. Se a cor viesse da
    // posição corrente, a barra de projeção pintaria Ana com a cor do 1º e a
    // de parcial pintaria Célia com a MESMA cor — e a linha de pelo menos uma
    // das duas discordaria da barra dela.
    const ana = coresDe(doc, "Ana", "Ana Lima");
    const celia = coresDe(doc, "Célia", "Célia Mota");
    const bruno = coresDe(doc, "Bruno", "Bruno Reis");

    expect(ana.size).toBe(1);
    expect(celia.size).toBe(1);
    expect(bruno.size).toBe(1);

    // 🔴 E a tinta das três é o token ESTÁVEL do fallback, nunca um token de
    // colocação. É esta asserção — e não a contagem acima — que morre se
    // alguém devolver `colorForRank` ao caminho de federação: com o rank de
    // volta, cada uma recebe um `--color-cand-N` diferente e as três contagens
    // continuariam valendo 1.
    for (const cor of [...ana, ...celia, ...bruno]) {
      expect(cor).toBe("var(--party-outros)");
    }

    // ⚠️ Consequência assumida: as três ficam com a MESMA cor. Duas federações
    // na mesma corrida são indistinguíveis por tinta — limitação registrada em
    // `components/blocks/_candidateColor.ts`, onde também está por que a
    // alternativa (cor própria por federação) é decisão de constituição, não
    // de código. A distinção fica por conta do nome e da sigla na linha.
    expect(new Set([...ana, ...celia, ...bruno]).size).toBe(1);
  });

  it("(m2) com token próprio, as três tintas são distintas — e continuam do partido", () => {
    // O contrapeso de (m): a perda de distinção é EXCLUSIVA de quem não tem
    // token. Sem este caso, uma regressão que pintasse o produto inteiro de
    // `--party-outros` passaria em (m) sem um arranhão.
    const doc = parse(
      <ResultPanel candidatos={COM_PARTIDO_MAPEADO} pctApurado={62} title="SP" titleId="t" />,
    );
    const ana = coresDe(doc, "Ana", "Ana Lima");
    const celia = coresDe(doc, "Célia", "Célia Mota");
    const bruno = coresDe(doc, "Bruno", "Bruno Reis");

    expect([...ana]).toEqual(["var(--party-pt)"]);
    expect([...bruno]).toEqual(["var(--party-psd)"]);
    expect([...celia]).toEqual(["var(--party-mdb)"]);

    // E o percentual pinta com o token de TEXTO do mesmo partido, nunca com a
    // base (que reprova contraste como texto em PSOL, PSB, NOVO e Outros).
    const estiloDe = (nome: string) =>
      linhaDe(doc, nome)
        ?.querySelector('[data-testid="candidate-result-row"]')
        ?.getAttribute("style") ?? "";
    expect(estiloDe("Ana Lima")).toContain("--cor-texto:var(--party-pt-text)");
    expect(estiloDe("Ana Lima")).toContain("--cor-base:var(--party-pt)");
  });

  it.each([
    ["sem token próprio", SEM_PARTIDO_MAPEADO],
    ["com token próprio", COM_PARTIDO_MAPEADO],
  ])("(n) a cor da candidatura NÃO muda quando a corrida vira do avesso — %s", (_rotulo, base) => {
    // Mesmíssimas pessoas, mesmo apurado, projeção invertida. Desde
    // 2026-09-20 a cor é função só da SIGLA, que não se mexe — então inverter
    // a projeção (e com ela toda a ordem da lista) não pode trocar tinta
    // nenhuma. As DUAS bases entram: o caso "com token" é o que denuncia uma
    // regressão que uniformizasse tudo em `--party-outros`, porque ali as três
    // cores precisam ser diferentes entre si E iguais a si mesmas.
    const projInvertida = base.map((c) => ({ ...c, pct_projetado: 100 - c.pct_projetado }));
    const antes = parse(<ResultPanel candidatos={base} pctApurado={62} title="SP" titleId="t" />);
    const depois = parse(
      <ResultPanel candidatos={projInvertida} pctApurado={62} title="SP" titleId="t" />,
    );

    for (const [curto, completo] of [
      ["Ana", "Ana Lima"],
      ["Bruno", "Bruno Reis"],
      ["Célia", "Célia Mota"],
    ] as const) {
      const cores = coresDe(antes, curto, completo);
      expect(cores.size).toBe(1);
      expect([...coresDe(depois, curto, completo)]).toEqual([...cores]);
      // Nenhum token de colocação, em base nenhuma.
      for (const cor of cores) expect(cor).not.toMatch(/--color-cand-/);
    }
  });
});

describe('<ResultPanel variant="identidade" /> — a fase pré NÃO reordena', () => {
  it("(o) a ordem é a que quem chama passou: o número na urna (RF-161)", () => {
    // Em fase pré todo `pct` é zero e a ordem é a do número na urna, crescente
    // — quem a fixa é a página (`app/(pres)/page.tsx`). Se o painel ordenasse
    // aqui, ordenaria pelo desempate e produziria o falso favoritismo estável
    // que o RF-161 existe para não haver.
    const zerados: ResultPanelCandidate[] = [
      cand(12, "Ana Lima", "PT", 0, 0),
      cand(13, "Bruno Reis", "PL", 0, 0),
      cand(15, "Célia Mota", "MDB", 0, 0),
    ];
    const doc = parse(
      <ResultPanel
        candidatos={zerados}
        pctApurado={0}
        title="BR"
        titleId="t"
        variant="identidade"
      />,
    );
    const linhas = [...doc.querySelectorAll("[data-testid='result-identidade-lista'] li")];

    expect(linhas.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Ana Lima"),
      expect.stringContaining("Bruno Reis"),
      expect.stringContaining("Célia Mota"),
    ]);
    // E nenhuma linha carrega posição nem `order`: não há ranking a exibir.
    expect(doc.querySelectorAll("li[data-ord]")).toHaveLength(0);
  });
});

describe("<ResultPanel /> — o colapso clipa 6 linhas EM CADA base", () => {
  it("(p) as excedentes de cada base são marcadas separadamente", () => {
    // Nove candidaturas em que as duas ordens discordam no corte do `limit`:
    // quem é 7º no apurado é 2º na projeção.
    const nove: ResultPanelCandidate[] = [
      cand(1, "Um", "PT", 30, 5),
      cand(2, "Dois", "PL", 28, 4),
      cand(3, "Tres", "MDB", 26, 3),
      cand(4, "Quatro", "PSD", 24, 2),
      cand(5, "Cinco", "PDT", 22, 1),
      cand(6, "Seis", "PSB", 20, 0.5),
      cand(7, "Sete", "NOVO", 2, 90),
      cand(8, "Oito", "PP", 1, 80),
      cand(9, "Nove", "PV", 0.5, 70),
    ];
    const doc = parse(<ResultPanel candidatos={nove} pctApurado={62} title="SP" titleId="t" />);

    expect(doc.querySelectorAll('[data-extra-row~="parcial"]')).toHaveLength(3);
    expect(doc.querySelectorAll('[data-extra-row~="proj"]')).toHaveLength(3);

    // E são conjuntos DIFERENTES — é isso que o clip por base resolve.
    const nomes = (base: string) =>
      [...doc.querySelectorAll(`[data-extra-row~="${base}"]`)].map((li) =>
        (li.textContent ?? "").slice(0, 12),
      );
    expect(nomes("parcial")).not.toEqual(nomes("proj"));

    // A regra que clipa mora em `app/globals.css` e é por base.
    const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf-8").replace(
      /\s+/g,
      " ",
    );
    expect(css).toContain(
      ':root[data-view="parcial"] [data-collapsed="true"] > [data-extra-row~="parcial"]',
    );
    expect(css).toContain(
      ':root[data-view="proj"] [data-collapsed="true"] > [data-extra-row~="proj"]',
    );
  });
});
