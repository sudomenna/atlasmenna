// @vitest-environment happy-dom
/**
 * tests/unit/components/ResultPanelVagas.test.tsx
 *
 * O modo de MAIS DE UMA VAGA do `<ResultPanel>` — spec 016 (Senador),
 * RF-104 e RF-105.
 *
 * O arquivo existe separado de `ResultPanel.test.tsx` porque o que ele mede é
 * outra coisa: lá, o invariante é que nenhum candidato sai do DOM; aqui, é
 * que a tela responde à pergunta certa. Numa corrida de duas vagas, quase
 * todo número que o painel já sabia calcular continua CORRETO e passa a ser
 * IRRELEVANTE — a margem do 1º sobre o 2º é aritmeticamente exata e não
 * decide nada, porque os dois se elegem. O corte que decide a eleição é o do
 * 2º para o 3º.
 *
 * Por isso os testes abaixo são, em boa parte, testes de contraprova: eles
 * falham se alguém trocar o corte de volta para 1º↔2º.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResultPanel, type ResultPanelCandidate } from "@/components/blocks/ResultPanel";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function cand(id: number, nome: string, partido: string, pct: number): ResultPanelCandidate {
  return {
    id,
    nome,
    partido,
    cor: `var(--color-cand-${id})`,
    votos_atuais: Math.round(pct * 10_000),
    pct_atual: pct,
    pct_projetado: pct,
  };
}

/**
 * O cenário literal da aceitação do RF-104: 1º com 40%, 2º com 30%, 3º com
 * 29%. A margem que a tela deve mostrar é **1 pp**, não 10 pp.
 */
const CORRIDA_SP: ResultPanelCandidate[] = [
  cand(1, "Ana Lima", "PT", 40),
  cand(2, "Bruno Reis", "PL", 30),
  cand(3, "Célia Mota", "MDB", 29),
  cand(4, "Davi Nunes", "PSOL", 1),
];

function renderSenado(candidatos = CORRIDA_SP) {
  return parse(
    <ResultPanel candidatos={candidatos} pctApurado={62} title="Senado SP" titleId="t" vagas={2} />,
  );
}

describe("<ResultPanel vagas={2} /> — RF-104, a margem que decide", () => {
  it("(a) mostra a margem do 2º para o 3º, e NÃO a do 1º para o 2º", () => {
    const doc = renderSenado();

    // As duas bases (parcial e projeção) carregam o mesmo número aqui porque
    // a fixture tem `pct_atual === pct_projetado` — o ponto é o VALOR.
    const parcial = doc.querySelector("[data-testid='result-margem-parcial']");
    expect(parcial?.textContent).toContain("1,0");
    // 40 − 30 = 10 pp é a margem do líder. Se ela aparecer, o corte está
    // errado: essa distância não decide vaga nenhuma.
    expect(parcial?.textContent).not.toContain("10,0");
  });

  it("(b) o rótulo nomeia a 2ª vaga — não o líder", () => {
    const doc = renderSenado();
    const parcial = doc.querySelector("[data-testid='result-margem-parcial']");

    expect(parcial?.textContent).toMatch(/margem para a 2ª vaga/i);
    // "Margem Ana" faria o leitor entender a distância do 1º para o 2º.
    expect(parcial?.textContent).not.toMatch(/margem ana/i);
  });

  it("(c) em vaga única o comportamento anterior é intocado", () => {
    // Contraprova: o modo novo não pode ter mudado Presidente/Governador.
    const doc = parse(
      <ResultPanel candidatos={CORRIDA_SP} pctApurado={62} title="Presidente" titleId="t" />,
    );
    const parcial = doc.querySelector("[data-testid='result-margem-parcial']");

    expect(parcial?.textContent).toContain("10,0");
    expect(parcial?.textContent).toMatch(/margem ana/i);
  });

  it("(d) a margem acompanha o número de vagas, não um '2' hardcodado", () => {
    // Três vagas ⇒ corte entre 3º (29) e 4º (1) = 28 pp.
    const doc = parse(
      <ResultPanel
        candidatos={CORRIDA_SP}
        pctApurado={62}
        title="Hipotético"
        titleId="t"
        vagas={3}
      />,
    );
    const parcial = doc.querySelector("[data-testid='result-margem-parcial']");

    expect(parcial?.textContent).toContain("28,0");
    expect(parcial?.textContent).toMatch(/margem para a 3ª vaga/i);
  });
});

describe("<ResultPanel vagas={2} /> — RF-105, as duas vagas", () => {
  it("(e) exatamente 2 linhas carregam o marcador de vaga", () => {
    const doc = renderSenado();

    // Versão D (2026-09-27): um selo POR BASE em cada linha, cada um sob o
    // seu `data-view-only` — em cada base, exatamente 2.
    for (const base of ["parcial", "proj"]) {
      expect(
        doc.querySelectorAll(`[data-view-only='${base}'] > [data-testid='result-vaga-marker']`)
          .length,
      ).toBe(2);
    }
    const comMarcador = [...doc.querySelectorAll("li")].filter(
      (li) => li.querySelector("[data-testid='result-vaga-marker']") != null,
    );
    expect(comMarcador.length).toBe(2);
    expect(doc.querySelectorAll("li[data-vaga='true']").length).toBe(2);
  });

  it("(f) o marcador está nas DUAS primeiras linhas, nessa ordem", () => {
    const doc = renderSenado();
    const lis = [...doc.querySelectorAll("ol > li")];

    expect(lis.slice(0, 2).every((li) => li.getAttribute("data-vaga") === "true")).toBe(true);
    expect(lis.slice(2).every((li) => li.getAttribute("data-vaga") === null)).toBe(true);
  });

  it("(g) 1º e 2º recebem o MESMO marcador — nenhuma hierarquia entre eles", () => {
    const doc = renderSenado();
    const [primeiro, segundo] = [
      ...doc.querySelectorAll("[data-view-only='proj'] > [data-testid='result-vaga-marker']"),
    ];

    // Mesmo texto e mesmo estilo. Um "1ª vaga"/"2ª vaga" reintroduziria a
    // hierarquia que o resultado não tem: os dois são senadores.
    expect(primeiro?.textContent).toBe(segundo?.textContent);
    expect(primeiro?.getAttribute("class")).toBe(segundo?.getAttribute("class"));
    expect(primeiro?.getAttribute("style")).toBe(segundo?.getAttribute("style"));
    expect(primeiro?.textContent).not.toMatch(/1ª|2ª/);
  });

  it("(h) o marcador diz que é PROJEÇÃO — não proclama eleito", () => {
    const doc = renderSenado();
    const marker = doc.querySelector("[data-testid='result-vaga-marker']");

    expect(marker?.textContent?.toLowerCase()).toContain("projetada");
    // E TODO marcador diz de que base vem — nenhum "Eleito" solto.
    for (const m of doc.querySelectorAll("[data-testid='result-vaga-marker']")) {
      expect(m.textContent ?? "").toMatch(/^Vaga (projetada|na parcial)$/);
      expect(m.textContent?.toLowerCase()).not.toMatch(/eleit/);
    }
  });

  it("(i) em vaga única não existe marcador nenhum", () => {
    const doc = parse(
      <ResultPanel candidatos={CORRIDA_SP} pctApurado={62} title="Presidente" titleId="t" />,
    );
    expect(doc.querySelectorAll("[data-testid='result-vaga-marker']").length).toBe(0);
  });

  it("(j) `vagas` maior que a lista não marca todo mundo nem quebra", () => {
    const doc = parse(
      <ResultPanel
        candidatos={[cand(1, "Só uma", "PT", 100)]}
        pctApurado={10}
        title="Degenerado"
        titleId="t"
        vagas={9}
      />,
    );
    // Uma linha, e nenhuma margem (não há "primeiro de fora" para comparar).
    expect(doc.querySelectorAll("ol > li").length).toBe(1);
    expect(doc.querySelector("[data-testid='result-margem-parcial']")).toBeNull();
  });

  it("(k) nenhum candidato sai do DOM — o invariante do ADR-0017 continua", () => {
    const doc = renderSenado();
    expect(doc.querySelectorAll("[data-testid='candidate-result-row']").length).toBe(4);
  });
});

describe("<ResultPanel vagas={2} /> — a barra de maioria", () => {
  it("(l) a barra com marcador de 50% não é desenhada em corrida de 2 vagas", () => {
    // Metade dos votos não elege ninguém para o Senado, e não é o corte de
    // nada: a barra afirmaria um limiar inexistente.
    const doc = renderSenado();
    expect(doc.querySelector("[role='img']")).toBeNull();
  });

  it("(m) em vaga única a barra continua lá", () => {
    const doc = parse(
      <ResultPanel candidatos={CORRIDA_SP} pctApurado={62} title="Presidente" titleId="t" />,
    );
    expect(doc.querySelector("[role='img']")).not.toBeNull();
  });

  it("(n) `poles` explícito ainda vence o default", () => {
    const doc = parse(
      <ResultPanel
        candidatos={CORRIDA_SP}
        pctApurado={62}
        poles
        title="Forçado"
        titleId="t"
        vagas={2}
      />,
    );
    expect(doc.querySelector("[role='img']")).not.toBeNull();
  });
});
