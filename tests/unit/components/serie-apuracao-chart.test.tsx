// @vitest-environment happy-dom
/**
 * tests/unit/components/serie-apuracao-chart.test.tsx
 *
 * Spec 020 — RF-170 a RF-176.
 *
 * ## Como estes testes foram escritos
 *
 * Este repositório tem histórico de teste que passa sem provar nada
 * (`docs/reference/risks.md`; a memória do projeto registra três formas
 * distintas). Cada bloco abaixo nomeia, no título, a **mutação** que ele mata,
 * e as fixtures foram construídas para que essa mutação mude o resultado —
 * não para parecerem realistas.
 *
 * O exemplo canônico: uma fixture em que apurado e projetado têm valores
 * parecidos passa com os dois trocados. Por isso a fixture de T1 tem as duas
 * bases andando em **direções opostas**.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  SerieApuracaoChart,
  type SerieApuracaoChartProps,
  type SerieCandidatoView,
} from "@/components/atoms/charts/SerieApuracaoChart";
import { SERIE_BASE_INICIAL } from "@/components/atoms/charts/SerieBaseAlternavel";

const ALTURA = 220;

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

/** Instantes a cada 5 min, como o produtor emite. */
function eixoDe(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(2026, 9, 4, 20, i * 5)).toISOString(),
  );
}

function tracos(doc: Document, cand: number, base: "parcial" | "proj"): Element[] {
  return [...doc.querySelectorAll(`path[data-traco][data-cand="${cand}"][data-base="${base}"]`)];
}

/** Os `y` de um `d` de path, na ordem em que aparecem. */
function ysDoPath(el: Element): number[] {
  const d = el.getAttribute("d") ?? "";
  return [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
}

function ysDe(doc: Document, cand: number, base: "parcial" | "proj"): number[] {
  return tracos(doc, cand, base).flatMap(ysDoPath);
}

function cand(over: Partial<SerieCandidatoView> & { id: number }): SerieCandidatoView {
  return {
    nome: `Candidata ${over.id}`,
    partido: "PT",
    apurado: [],
    projetado: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Leitores de geometria
//
// 🔴 Nada aqui importa `SERIE_PAD_*` nem `ALTURA`. Comparar o SVG contra a
// constante que o produziu é a tautologia que este repositório já registrou
// como "teste que não discrimina": ela passa igual com 32/20 e com 32/8/10/18.
// Tudo abaixo lê do MARKUP e afirma **proporção** ou **relação entre dois
// elementos** — o que muda quando a geometria regride.
// ---------------------------------------------------------------------------

/** A caixa declarada pelo próprio SVG, pelo `viewBox`. */
function caixa(doc: Document): { largura: number; altura: number } {
  const vb = (doc.querySelector("svg")?.getAttribute("viewBox") ?? "").trim().split(/\s+/);
  return { largura: Number(vb[2]), altura: Number(vb[3]) };
}

/** As quatro bordas da área útil, lidas das duas linhas de eixo. */
function areaUtil(doc: Document): { x1: number; x2: number; yBase: number; yTopo: number } {
  const linhas = [...doc.querySelectorAll('[data-testid="serie-eixos"] line')];
  const n = (el: Element | undefined, attr: string) => Number(el?.getAttribute(attr));
  const horizontal = linhas.find((l) => n(l, "y1") === n(l, "y2"));
  const vertical = linhas.find((l) => n(l, "x1") === n(l, "x2"));
  return {
    x1: n(horizontal, "x1"),
    x2: n(horizontal, "x2"),
    yBase: n(horizontal, "y1"),
    yTopo: Math.min(n(vertical, "y1"), n(vertical, "y2")),
  };
}

interface Marca {
  valor: number;
  yLinha: number;
  yTexto: number;
  xTexto: number;
  texto: string;
  stroke: string;
  testid: string | null;
}

/** As marcas da régua vertical, na ordem do documento. */
function regua(doc: Document): Marca[] {
  return [...doc.querySelectorAll('[data-testid="serie-regua-y"] > g')].map((g) => {
    const linha = g.querySelector("line");
    const texto = g.querySelector("text");
    return {
      valor: Number(g.getAttribute("data-grade-pct")),
      yLinha: Number(linha?.getAttribute("y1")),
      yTexto: Number(texto?.getAttribute("y")),
      xTexto: Number(texto?.getAttribute("x")),
      texto: texto?.textContent ?? "",
      stroke: linha?.getAttribute("stroke") ?? "",
      testid: texto?.getAttribute("data-testid") ?? null,
    };
  });
}

function rotulo(doc: Document, testid: string): string {
  return doc.querySelector(`[data-testid="${testid}"]`)?.textContent ?? "";
}

/** Uma série sem furo, de duas medições — o mínimo que cai no estado "ok". */
function okDe(candidatos: SerieCandidatoView[], extra: Partial<SerieApuracaoChartProps> = {}) {
  return parse(
    <SerieApuracaoChart
      eixo={eixoDe(candidatos[0]?.apurado.length ?? 2)}
      cadenciaMin={5}
      candidatos={candidatos}
      escopo="Brasil"
      titleId="geo"
      {...extra}
    />,
  );
}

// ---------------------------------------------------------------------------

describe("<SerieApuracaoChart /> — T1: mata a troca de apurado por projetado", () => {
  // As duas bases sobem/descem em direções OPOSTAS de propósito. Com séries
  // parecidas, trocar `apurado` por `projetado` no render não muda nada
  // observável e o teste passaria com o defeito no lugar.
  const doc = parse(
    <SerieApuracaoChart
      eixo={eixoDe(3)}
      cadenciaMin={5}
      candidatos={[cand({ id: 13, apurado: [10, 20, 30], projetado: [40, 35, 31] })]}
      escopo="Brasil"
      titleId="t1"
      height={ALTURA}
    />,
  );

  it("a base apurada sobe (y decresce) e a projetada desce (y cresce)", () => {
    const yParcial = ysDe(doc, 13, "parcial");
    const yProj = ysDe(doc, 13, "proj");

    expect(yParcial.length).toBeGreaterThanOrEqual(2);
    expect(yProj.length).toBeGreaterThanOrEqual(2);

    // Em SVG o eixo y cresce para baixo: valor maior ⇒ y menor.
    const sentidoParcial = Math.sign((yParcial.at(-1) as number) - (yParcial[0] as number));
    const sentidoProj = Math.sign((yProj.at(-1) as number) - (yProj[0] as number));

    expect(sentidoParcial).toBe(-1); // 10 → 30 sobe
    expect(sentidoProj).toBe(1); // 40 → 31 desce
    expect(sentidoParcial).not.toBe(sentidoProj);
  });

  it("as duas bases são renderizadas no servidor, cada uma no seu grupo de visão", () => {
    // RF-172 (emenda de 04/10): a alternância é da chave própria do gráfico,
    // pelo atributo `data-serie-only` — e NÃO pelo `data-view-only` do shell,
    // que faria o seletor do topo continuar escondendo uma das bases.
    expect(doc.querySelector('g[data-serie-only="parcial"]')).not.toBeNull();
    expect(doc.querySelector('g[data-serie-only="proj"]')).not.toBeNull();
    expect(doc.querySelector("svg [data-view-only]")).toBeNull();
  });
});

describe("<SerieApuracaoChart /> — T3: mata o deslocamento do limiar de 2 pontos", () => {
  // Três casos, e o do MEIO é o que discrimina. Um teste só com 0 e 3 pontos
  // passa tanto com `< 2` → `<= 2` quanto com `< 2` → `< 1`.
  function estadoCom(medicoes: (number | null)[]): string | null {
    const doc = parse(
      <SerieApuracaoChart
        eixo={eixoDe(medicoes.length)}
        cadenciaMin={5}
        candidatos={[cand({ id: 13, apurado: medicoes, projetado: medicoes })]}
        escopo="SP"
        titleId="t3"
        height={ALTURA}
      />,
    );
    return doc.querySelector("[data-estado]")?.getAttribute("data-estado") ?? null;
  }

  it("sem eixo → indisponível", () => {
    expect(estadoCom([])).toBe("indisponivel");
  });

  it("uma medição → apurando, sem traço", () => {
    expect(estadoCom([30])).toBe("apurando");
  });

  it("exatamente DUAS medições → desenha (é o caso NO limiar)", () => {
    expect(estadoCom([30, 31])).toBe("ok");
  });
});

describe("<SerieApuracaoChart /> — T5: mata o `?? 0` (ausência virando zero)", () => {
  // Furo no meio. Se qualquer ponto da cadeia trocar `null` por 0, o traço
  // vira UM só, mergulhando até o chão e voltando — e some a evidência de que
  // houve falha de sinal. É a regra dos três estados aplicada ao desenho.
  const doc = parse(
    <SerieApuracaoChart
      eixo={eixoDe(5)}
      cadenciaMin={5}
      candidatos={[
        cand({ id: 13, apurado: [30, 31, null, 33, 34], projetado: [30, 31, 32, 33, 34] }),
      ]}
      escopo="SP"
      titleId="t5"
      height={ALTURA}
    />,
  );

  it("o traço INTERROMPE: dois segmentos, não um", () => {
    expect(tracos(doc, 13, "parcial")).toHaveLength(2);
  });

  it("a base sem furo continua com um segmento só (controle)", () => {
    expect(tracos(doc, 13, "proj")).toHaveLength(1);
  });

  it("nenhuma coordenada desce até a linha de zero", () => {
    // Com valores entre 30 e 34 a régua começa acima de zero; um 0 fabricado
    // cairia MUITO abaixo da área útil do SVG.
    for (const y of ysDe(doc, 13, "parcial")) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(ALTURA);
    }
  });

  it('a célula sem boletim diz "sem medição", e não um número', () => {
    const celulas = [...doc.querySelectorAll('td[data-cand="13"][data-base="parcial"]')];
    expect(celulas).toHaveLength(5);
    expect(celulas[2]?.textContent).toContain("sem medição");
    expect(celulas[2]?.textContent).not.toMatch(/\d/);
  });
});

describe("<SerieApuracaoChart /> — T7: mata a cor por rank", () => {
  // O payload ainda publica `var(--color-cand-{rank})`. Se o componente ler a
  // cor dali em vez do partido, a linha troca de cor numa ultrapassagem — ao
  // vivo, no meio da noite.
  const a = cand({ id: 13, partido: "PT", apurado: [30, 31], projetado: [30, 31] });
  const b = cand({ id: 22, partido: "PL", apurado: [28, 29], projetado: [28, 29] });

  function strokePorId(candidatos: SerieCandidatoView[]): Record<number, string | null> {
    const doc = parse(
      <SerieApuracaoChart
        eixo={eixoDe(2)}
        cadenciaMin={5}
        candidatos={candidatos}
        escopo="Brasil"
        titleId="t7"
        height={ALTURA}
      />,
    );
    return {
      13: tracos(doc, 13, "parcial")[0]?.getAttribute("stroke") ?? null,
      22: tracos(doc, 22, "parcial")[0]?.getAttribute("stroke") ?? null,
    };
  }

  it("a cor de cada candidatura não muda quando a ordem muda", () => {
    const naOrdem = strokePorId([a, b]);
    const invertida = strokePorId([b, a]);

    expect(naOrdem[13]).not.toBeNull();
    expect(naOrdem[22]).not.toBeNull();
    expect(invertida[13]).toBe(naOrdem[13]);
    expect(invertida[22]).toBe(naOrdem[22]);
  });

  it("partidos diferentes recebem cores diferentes", () => {
    const cores = strokePorId([a, b]);
    expect(cores[13]).not.toBe(cores[22]);
  });

  it("o token de cor por rank não aparece no HTML", () => {
    // Asserção NEGATIVA: é a que pega o defeito, porque a positiva
    // ("tem uma cor") passa com a cor errada.
    const saida = html(
      <SerieApuracaoChart
        eixo={eixoDe(2)}
        cadenciaMin={5}
        candidatos={[a, b]}
        escopo="Brasil"
        titleId="t7b"
        height={ALTURA}
      />,
    );
    expect(saida).not.toContain("--color-cand-");
  });
});

describe("<SerieApuracaoChart /> — T8: mata a volta para a cor de PREENCHIMENTO", () => {
  // O que este bloco mede é o que o COMPONENTE emite, não o token isolado
  // (`tests/unit/design-system/party-text-contrast.test.ts` já mede o CSS).
  // A pergunta aqui é outra: a linha que vai ao ar tem contraste suficiente
  // contra o papel? Um traço de 1,5–2,5 px é objeto gráfico — WCAG 2.1 SC
  // 1.4.11 (Non-text Contrast), piso **3:1**, não o 4,5:1 de texto.
  //
  // A mutação que ele mata: trocar `textForParty` de volta por `colorForParty`
  // em `SerieApuracaoChart.tsx`. A base é cor de ÁREA, e sobre `--surface-page`
  // (#f3f4f6) quatro delas reprovam 3:1 — PSOL 2,08, PSB 2,19, o fallback
  // `outros` 2,39 e NOVO 2,72. Por isso a fixture é feita exatamente desses
  // quatro: com PT/PL (7:1 e 4,9:1 na própria base) a mutação passaria.
  //
  // A colorimetria é reimplementada aqui de propósito, como no gate de token:
  // um teste que importa a função do gerador verifica a si mesmo.

  /** Piso do SC 1.4.11 para objeto gráfico — é o traço, não o rótulo. */
  const PISO_GRAFICO = 3;

  const RAIZ = path.resolve(import.meta.dirname, "../../..");
  const TOKENS_CSS = readFileSync(path.join(RAIZ, "app/tokens-party.css"), "utf8");

  /** O CSS tem dois blocos com os MESMOS nomes (ADR-0025 § 5); isole cada um. */
  function bloco(css: string, abertura: string): string {
    const inicio = css.indexOf(abertura);
    if (inicio === -1) throw new Error(`bloco ausente em tokens-party.css: ${abertura}`);
    let nivel = 0;
    for (let i = css.indexOf("{", inicio); i < css.length; i++) {
      if (css[i] === "{") nivel++;
      if (css[i] === "}") {
        nivel--;
        if (nivel === 0) return css.slice(inicio, i + 1);
      }
    }
    throw new Error(`bloco não fechado em tokens-party.css: ${abertura}`);
  }

  function tokens(css: string): Map<string, string> {
    const mapa = new Map<string, string>();
    const re = /(--party-[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/g;
    let m = re.exec(css);
    while (m !== null) {
      if (m[1] && m[2]) mapa.set(m[1], m[2]);
      m = re.exec(css);
    }
    return mapa;
  }

  /** Luminância relativa WCAG 2.1 de um hex sRGB. */
  function luminancia(hex: string): number {
    const canal = (i: number) => {
      const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
  }

  function contraste(a: string, b: string): number {
    const la = luminancia(a);
    const lb = luminancia(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /**
   * Os dois temas e os dois papéis de cada um (`--surface-page` /
   * `--surface-card`, em `app/globals.css`). O gráfico sai dentro de um
   * `<Panel>`, que é card, mas a moldura é transparente e a página aparece por
   * baixo em rota de UF — medir os dois é o que garante que nenhuma das duas
   * combinações escapa.
   */
  const TEMAS = [
    {
      id: "claro",
      tokens: tokens(bloco(TOKENS_CSS, "@theme static {")),
      papeis: ["#f3f4f6", "#fbfbfc"],
    },
    {
      id: "escuro",
      tokens: tokens(bloco(TOKENS_CSS, ':root[data-theme="dark"] {')),
      papeis: ["#14171b", "#1c1f24"],
    },
  ] as const;

  /** `var(--party-psol-text)` → `--party-psol-text`. Nada mais é aceito. */
  function nomeDoToken(valor: string): string {
    const m = /^var\((--party-[a-z0-9-]+)\)$/.exec(valor);
    if (m?.[1] == null) {
      throw new Error(
        `o componente emitiu "${valor}", que não é um token de partido — ` +
          "cor literal no SVG não passa pelo gate de contraste do CSS",
      );
    }
    return m[1];
  }

  // Os quatro partidos cuja BASE reprova 3:1 sobre o papel claro. "XYZ" não
  // existe e cai no fallback `outros`, que é o quarto caso — e é o mais comum
  // na noite: federação e sigla sem token passam por ele.
  const REPROVADOS: Array<[number, string, string]> = [
    [50, "PSOL", "psol"],
    [40, "PSB", "psb"],
    [30, "NOVO", "novo"],
    [99, "XYZ", "outros"],
  ];

  const doc = parse(
    <SerieApuracaoChart
      eixo={eixoDe(2)}
      cadenciaMin={5}
      candidatos={REPROVADOS.map(([id, sigla]) =>
        cand({ id, partido: sigla, apurado: [30, 31], projetado: [30, 31] }),
      )}
      escopo="Brasil"
      titleId="t8"
      height={ALTURA}
    />,
  );

  function corEmitida(id: number): string {
    const traco = tracos(doc, id, "parcial")[0]?.getAttribute("stroke") ?? null;
    const ponto =
      doc
        .querySelector(`circle[data-ponto-final][data-cand="${id}"][data-base="parcial"]`)
        ?.getAttribute("fill") ?? null;
    expect(traco, `candidatura ${id} sem stroke`).not.toBeNull();
    // Traço e ponto têm de sair na MESMA cor: medir um e deixar o outro para
    // trás é como metade do defeito sobreviveria a este teste.
    expect(ponto, `o ponto final de ${id} divergiu do traço`).toBe(traco);
    return traco as string;
  }

  it.each(
    REPROVADOS,
  )("a linha de %i (%s) passa o piso de 3:1 do SC 1.4.11 nos dois temas", (id, sigla, slug) => {
    const token = nomeDoToken(corEmitida(id));

    for (const tema of TEMAS) {
      const hex = tema.tokens.get(token);
      expect(hex, `${token} não existe no bloco do tema ${tema.id}`).toMatch(/^#[0-9a-f]{6}$/);
      const base = tema.tokens.get(`--party-${slug}`) as string;

      for (const papel of tema.papeis) {
        const razao = contraste(hex as string, papel);
        expect(
          razao,
          [
            `Tema ${tema.id}. ${sigla}: o componente emitiu ${token} (${hex}) e sobre o papel ` +
              `${papel} isso dá ${razao.toFixed(2)}:1.`,
            "",
            "WCAG 2.1 SC 1.4.11 (Non-text Contrast) exige 3:1 para o traço de um gráfico.",
            `A base do partido (--party-${slug}, ${base}) dá ` +
              `${contraste(base, papel).toFixed(2)}:1 aqui — é por isso que este componente`,
            "resolve a cor por `textForParty`, e não por `colorForParty`. Se a linha acima",
            "voltou a ser a base, esta é a regressão (decisão do dono, 2026-09-18).",
          ].join("\n"),
        ).toBeGreaterThanOrEqual(PISO_GRAFICO);
      }
    }
  });

  it("a cor emitida NÃO é a base de preenchimento desses quatro partidos", () => {
    // Asserção negativa, no espírito do T7: a positiva ("tem contraste") pode
    // um dia passar por acidente se a base for reajustada; esta nomeia o
    // defeito. Onde a base já lê, `-text` É a base — por isso a lista é só a
    // dos quatro que reprovam.
    for (const [id, sigla, slug] of REPROVADOS) {
      expect(corEmitida(id), `${sigla} voltou a sair na cor de área`).not.toBe(
        `var(--party-${slug})`,
      );
    }
  });

  it("nos 17 partidos em que a base já lê, nenhum pixel muda", () => {
    // O outro lado da moeda: a correção não pode virar desculpa para mover a
    // identidade de quem já estava legível. PT, PSD e UNIÃO saem com o hex da
    // base no tema claro — se um dia deixarem de sair, é aqui que se vê.
    const claro = TEMAS[0].tokens;
    const docPT = parse(
      <SerieApuracaoChart
        eixo={eixoDe(2)}
        cadenciaMin={5}
        candidatos={[
          cand({ id: 13, partido: "PT", apurado: [30, 31], projetado: [30, 31] }),
          cand({ id: 22, partido: "PSD", apurado: [28, 29], projetado: [28, 29] }),
          cand({ id: 44, partido: "UNIÃO", apurado: [12, 13], projetado: [12, 13] }),
        ]}
        escopo="Brasil"
        titleId="t8b"
        height={ALTURA}
      />,
    );
    // ⚠️ 2026-09-19: a amostra era `pt`, **`pl`**, `uniao`. As bases de PL e PSD
    // foram trocadas entre si a pedido do dono, e isso inverteu a pertinência
    // dos dois a este grupo — sem mudar o TAMANHO dele, que segue em 17:
    //
    //   - PL virou verde (`#2f8f6b`): a base para em 3,63:1 sobre o papel, então
    //     a variante `-text` escurece para `#1a7f5c` (4,51:1). **Saiu** daqui.
    //   - PSD virou azul (`#2247b8`): a base já dá 7,17:1, e a variante **é** a
    //     base. **Entrou** no lugar.
    //
    // Um por um, o que é coincidência e não garantia — se um dia não fosse, o
    // recálculo de `--party-*-text` acusaria, não este caso.
    for (const [id, slug] of [
      [13, "pt"],
      [22, "psd"],
      [44, "uniao"],
    ] as const) {
      const token = nomeDoToken(tracos(docPT, id, "parcial")[0]?.getAttribute("stroke") ?? "");
      expect(claro.get(token), `${slug}: a cor da linha se afastou da identidade`).toBe(
        claro.get(`--party-${slug}`),
      );
    }
  });
});

describe("<SerieApuracaoChart /> — RF-174: antes do dia da eleição", () => {
  const props = {
    eixo: eixoDe(0),
    cadenciaMin: 5,
    candidatos: [] as SerieCandidatoView[],
    escopo: "Brasil",
    titleId: "pre",
    preEleicao: true,
    height: ALTURA,
  };

  it("desenha os eixos e a frase, sem nenhuma linha", () => {
    const doc = parse(<SerieApuracaoChart {...props} />);
    expect(doc.querySelector("[data-estado]")?.getAttribute("data-estado")).toBe("antes-do-dia");
    expect(doc.querySelectorAll("path[data-traco]")).toHaveLength(0);
    expect(doc.body.textContent).toContain("disponível apenas no dia das eleições");
  });

  it("a palavra “projeção” não aparece em NENHUMA superfície", () => {
    // Inclui rótulo de acessibilidade, título e legenda de tabela — os três
    // lugares que o RF-161 aponta como "os que ninguém revisa".
    const saida = html(<SerieApuracaoChart {...props} />).toLowerCase();
    expect(saida).not.toContain("projeç");
    expect(saida).not.toContain("projec");
  });

  it("os únicos percentuais são os da régua — nenhuma medição vaza", () => {
    // Asserção de IGUALDADE, não de ausência, e a diferença é o teste inteiro.
    // "não contém %" proibiria a própria régua (foi o que aconteceu antes da
    // decisão do dono de 2026-09-17); "contém exatamente a régua" deixa a
    // escala passar e reprova qualquer número FORA dela — que é como um valor
    // fabricado apareceria.
    const doc = parse(<SerieApuracaoChart {...props} />);
    const pcts = [...(doc.body.textContent ?? "").matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map(
      (m) => m[1],
    );
    expect(pcts).toEqual(["0", "10", "20", "30", "40", "50"]);
  });

  it("desenha a régua de horários do protótipo", () => {
    const doc = parse(<SerieApuracaoChart {...props} />);
    const texto = doc.body.textContent ?? "";
    for (const hora of ["17h", "18h", "19h", "20h", "20h30"]) {
      expect(texto).toContain(hora);
    }
  });
});

describe("<SerieApuracaoChart /> — RF-173: Senador elege duas", () => {
  const quatro = [
    cand({ id: 1, partido: "PT", apurado: [30, 32], projetado: [30, 32] }),
    cand({ id: 2, partido: "PL", apurado: [25, 26], projetado: [25, 26] }),
    cand({ id: 3, partido: "MDB", apurado: [20, 19], projetado: [20, 19] }),
    cand({ id: 4, partido: "PSD", apurado: [10, 11], projetado: [10, 11] }),
  ];
  const doc = parse(
    <SerieApuracaoChart
      eixo={eixoDe(2)}
      cadenciaMin={5}
      candidatos={quatro}
      escopo="SP"
      vagas={2}
      titleId="sen"
      height={ALTURA}
    />,
  );

  function espessura(id: number): number {
    return Number(tracos(doc, id, "parcial")[0]?.getAttribute("stroke-width"));
  }

  it("as duas primeiras têm traço mais grosso que as de fora", () => {
    expect(espessura(1)).toBeGreaterThan(espessura(3));
    expect(espessura(2)).toBeGreaterThan(espessura(4));
    expect(espessura(1)).toBe(espessura(2));
    expect(espessura(3)).toBe(espessura(4));
  });

  it("as de fora NÃO são apagadas por opacidade", () => {
    // Opacidade compõe com a cor e derrubou 16 nós para 2,27:1 no axe em
    // 2026-09-08 (`app/globals.css`). Finas, não apagadas.
    const saida = html(
      <SerieApuracaoChart
        eixo={eixoDe(2)}
        cadenciaMin={5}
        candidatos={quatro}
        escopo="SP"
        vagas={2}
        titleId="sen2"
        height={ALTURA}
      />,
    );
    expect(saida).not.toContain("opacity");
  });

  it("desenha a régua da 2ª vaga", () => {
    expect(doc.querySelector('[data-testid="serie-regua-vaga"]')).not.toBeNull();
  });

  it("a legenda da tabela nomeia as duas que ocupam vaga", () => {
    // O destaque por espessura não tem tradução textual automática: sem esta
    // frase, a informação existe só para quem enxerga.
    const legenda = doc.querySelector("caption")?.textContent ?? "";
    expect(legenda).toContain("2 vagas");
    expect(legenda).toContain("Candidata 1");
    expect(legenda).toContain("Candidata 2");
    expect(legenda).not.toContain("Candidata 3");
  });
});

describe("<SerieApuracaoChart /> — RF-176: a tabela acessível", () => {
  const doc = parse(
    <SerieApuracaoChart
      eixo={eixoDe(3)}
      cadenciaMin={5}
      candidatos={[cand({ id: 13, apurado: [30, 31, 32], projetado: [33, 34, 35] })]}
      escopo="SP"
      titleId="a11y"
      height={ALTURA}
    />,
  );

  it("uma linha por instante do eixo", () => {
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("a hora é legível, nunca ISO cru", () => {
    const primeira = doc.querySelector("tbody tr th, tbody tr td")?.textContent ?? "";
    expect(primeira).not.toContain("T20:");
    expect(primeira).not.toContain("Z");
  });

  it("a legenda diz que a projeção não é oficial", () => {
    const legenda = doc.querySelector("caption")?.textContent ?? "";
    expect(legenda.toLowerCase()).toContain("projeção");
    expect(legenda.toLowerCase()).toContain("não");
  });

  it('o CABEÇALHO de cada coluna projetada diz "projeção", não só a legenda', () => {
    // Mutação que este teste mata: tirar a palavra do `<th>` e deixá-la só no
    // `<caption>`. O teste acima continuaria verde — foi essa a lacuna.
    //
    // Por que o `<th>` e não só a legenda (design § 7, regra 3): quem navega a
    // tabela com leitor de tela ouve o cabeçalho da coluna a cada célula, e
    // pode entrar na tabela por uma célula qualquer sem nunca ouvir a legenda.
    // Sem a palavra no cabeçalho, um número projetado é anunciado como se
    // fosse resultado apurado — que é a única coisa que esta spec não pode
    // deixar acontecer.
    const doisCandidatos = parse(
      <SerieApuracaoChart
        eixo={eixoDe(3)}
        cadenciaMin={5}
        candidatos={[
          cand({ id: 13, partido: "PT", apurado: [30, 31, 32], projetado: [33, 34, 35] }),
          cand({ id: 22, partido: "PL", apurado: [20, 21, 22], projetado: [23, 24, 25] }),
        ]}
        escopo="SP"
        titleId="a11y-th"
        height={ALTURA}
      />,
    );
    const cabecalhos = [...doisCandidatos.querySelectorAll('thead th[scope="col"]')].map(
      (th) => th.textContent ?? "",
    );

    // hora + (apurado, projeção) × 2 candidaturas
    expect(cabecalhos).toHaveLength(5);

    const deProjecao = cabecalhos.filter((t) => t.toLowerCase().includes("projeç"));
    const deApurado = cabecalhos.filter((t) => t.toLowerCase().includes("apurado"));

    // UMA coluna de projeção por candidatura — e ela nomeia de quem é, porque
    // um "projeção" solto não diz qual das quatro linhas está sendo lida.
    expect(deProjecao).toHaveLength(2);
    expect(deProjecao.some((t) => t.includes("Candidata 13"))).toBe(true);
    expect(deProjecao.some((t) => t.includes("Candidata 22"))).toBe(true);

    // 🔴 A asserção de contraste, e é ela que impede a mutação preguiçosa de
    // carimbar a palavra nos dois cabeçalhos do par: a coluna irmã é a apurada
    // e NÃO pode se dizer projeção. Sem esta linha, `th → "…— projeção"` em
    // todas as colunas passaria, e a tabela mentiria na direção contrária.
    expect(deApurado).toHaveLength(2);
    for (const t of deApurado) {
      expect(t.toLowerCase()).not.toContain("projeç");
    }
  });

  it("os traços ficam fora da árvore de acessibilidade", () => {
    const svg = doc.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
  });
});

/**
 * RF-172 (b) e (c) — a promessa de **0 B**.
 *
 * 🔴 Estes dois itens de aceitação não tinham teste até 2026-09-18, 3ª sessão.
 * O que existia cobria só o (a) — os dois grupos `data-view-only` no HTML.
 *
 * E o (b) não é demonstrável por orçamento. `tests/e2e/perf-budget.spec.ts`
 * responde "a rota cabe em 150 KiB", que continuaria verde se o gráfico
 * passasse a custar 20 KiB de JS — sobraria orçamento. A única prova de que a
 * contribuição é **zero** é estrutural: um Server Component sem fronteira de
 * cliente não pode chegar ao pacote do navegador, porque nada dele é enviado.
 *
 * Por isso a travessia abaixo segue os imports LOCAIS a partir do módulo do
 * gráfico, recursivamente. Um `"use client"` em qualquer ponto dessa árvore
 * arrasta o gráfico inteiro para o pacote, e é o modo de falha real: ninguém
 * escreveria `"use client"` no gráfico: escreveriam num utilitário que ele
 * importa, três arquivos abaixo, sem relacionar uma coisa à outra.
 */
describe("<SerieApuracaoChart /> — RF-172(b)(c): a fronteira de cliente é só a chave", () => {
  const RAIZ = path.join(process.cwd(), "components/atoms/charts/SerieApuracaoChart.tsx");

  /** Resolve `@/x/y` para o arquivo em disco, testando as extensões usadas aqui. */
  function resolver(espec: string): string | null {
    const base = path.join(process.cwd(), espec.replace(/^@\//, ""));
    for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const alvo = `${base}${ext}`;
      try {
        readFileSync(alvo);
        return alvo;
      } catch {
        /* tenta a próxima */
      }
    }
    return null;
  }

  /** Todos os módulos locais alcançáveis a partir do gráfico, incluindo ele. */
  function arvore(): string[] {
    const vistos = new Set<string>();
    const fila = [RAIZ];
    while (fila.length > 0) {
      const atual = fila.pop();
      if (atual === undefined || vistos.has(atual)) continue;
      vistos.add(atual);
      const src = readFileSync(atual, "utf-8");
      for (const m of src.matchAll(/from\s+"(@\/[^"]+)"/g)) {
        const alvo = resolver(m[1] ?? "");
        if (alvo !== null && !vistos.has(alvo)) fila.push(alvo);
      }
    }
    return [...vistos];
  }

  /**
   * Emenda de 2026-10-04: o dono pediu uma chave "Apuração | Projeção" dentro
   * do gráfico, independente da do topo. A promessa deixou de ser "0 B" e
   * passou a ser "só a chave": a ÚNICA fronteira de cliente da árvore é
   * `SerieBaseAlternavel.tsx`, e o desenho continua todo no servidor.
   */
  const CHAVE = path.join(process.cwd(), "components/atoms/charts/SerieBaseAlternavel.tsx");

  it('(b) o único módulo da árvore do gráfico com "use client" é a chave', () => {
    const modulos = arvore();

    // Guarda do instrumento: se a travessia devolvesse só a raiz, ela passaria
    // sem ter olhado nada — e é exatamente o caso que importa, porque o risco
    // mora nos importados, não no gráfico.
    expect(
      modulos.length,
      `a travessia achou ${modulos.length} módulo(s); esperava a raiz mais os importados`,
    ).toBeGreaterThan(3);
    expect(modulos).toContain(RAIZ);

    const comUseClient = modulos.filter((f) =>
      /^\s*["']use client["']/m.test(readFileSync(f, "utf-8")),
    );
    expect(
      comUseClient.map((f) => path.relative(process.cwd(), f)),
      'um "use client" fora da chave arrasta o desenho do gráfico para o pacote do navegador',
    ).toEqual([path.relative(process.cwd(), CHAVE)]);
  });

  /**
   * 🔴 Os QUATRO estados, e não só o desenhado.
   *
   * A primeira versão deste caso olhava só o estado `ok`. Uma mutação que
   * enfiou um `<button>` no `<figure>` do estado `antes-do-dia` **sobreviveu** —
   * o componente tem quatro ramos de retorno (`antes-do-dia`, `indisponivel`,
   * `apurando`, `ok`), cada um com o seu próprio `<figure>`, e a fixture única
   * exercitava um. Três quartos do módulo não eram olhados.
   *
   * A mesma mutação repetida no `<figure>` do `ok` ficou vermelha na hora — o
   * teste não era fraco, o alvo é que estava errado. Mas a investigação achou
   * a lacuna de verdade, que é esta tabela.
   */
  const ESTADOS: { estado: string; props: Partial<SerieApuracaoChartProps> }[] = [
    { estado: "antes-do-dia", props: { preEleicao: true } },
    { estado: "indisponivel", props: { eixo: [], candidatos: [] } },
    { estado: "apurando", props: { eixo: eixoDe(1) } },
    { estado: "ok", props: {} },
  ];

  it.each(ESTADOS)("(c) estado $estado: botões só os dois da chave, e só no estado ok", ({
    estado,
    props,
  }) => {
    const marcado = html(
      <SerieApuracaoChart
        eixo={eixoDe(4)}
        cadenciaMin={5}
        candidatos={[
          cand({ id: 13, apurado: [10, 20, 30, 40], projetado: [40, 33, 31, 30] }),
          cand({ id: 22, apurado: [40, 33, 31, 30], projetado: [10, 20, 30, 40] }),
        ]}
        escopo="Brasil"
        titleId="rf172c"
        height={ALTURA}
        {...props}
      />,
    );

    // Guarda do instrumento, duas vezes: o ramo é o que eu penso que é, e ele
    // renderizou alguma coisa. Sem as duas, um `props` que caísse no ramo
    // errado passaria nas asserções abaixo por vacuidade — que é exatamente
    // como a mutação do `<button>` sobreviveu na primeira tentativa.
    expect(marcado, `esperava cair no ramo ${estado}`).toContain(`data-estado="${estado}"`);
    expect(marcado.length).toBeGreaterThan(200);

    expect(marcado).not.toContain("<input");
    expect(marcado).not.toContain("<select");

    const doc = new DOMParser().parseFromString(marcado, "text/html");
    const botoes = [...doc.querySelectorAll("button")];
    if (estado === "ok") {
      expect(botoes.map((b) => b.textContent)).toEqual(["Apuração", "Projeção"]);
      for (const b of botoes) expect(b.closest('[data-testid="serie-base-chave"]')).not.toBeNull();
    } else {
      // Sem série não há o que alternar; no "antes do dia" a palavra
      // "projeção" é proibida (RF-174).
      expect(botoes).toHaveLength(0);
      expect(doc.querySelector('[data-testid="serie-base-chave"]')).toBeNull();
    }
  });

  it("(c) o módulo não tem handler de evento em lugar nenhum", () => {
    // `renderToStaticMarkup` descarta handlers em silêncio, então procurar
    // `onclick` no HTML não provaria nada — nem no ramo certo. A prova é no
    // FONTE, e vale para os quatro ramos de uma vez.
    const fonte = readFileSync(RAIZ, "utf-8");
    expect(
      fonte,
      "handler de evento no módulo do gráfico exigiria fronteira de cliente, e com ela o RF-172(b) cai",
    ).not.toMatch(/\son[A-Z]\w+=\{/);
  });
});

/**
 * G — a geometria (ajuste de 2026-09-19).
 *
 * O widget desperdiçava 29% da caixa: `padX = 32` dos dois lados e `padY = 20`
 * dos dois davam 416×180 dentro de 480×220 — **70,9%**. Pior, o gutter
 * esquerdo de 32 unidades ficava VAZIO no estado "ok", porque os rótulos de Y
 * tinham ido para a direita (`width - padX + 4`), enquanto o estado
 * "antes do dia" os desenhava à esquerda. Os dois estados discordavam de lado,
 * e o estado COM dado desenhava menos linhas que o estado SEM dado.
 *
 * Cada bloco abaixo nomeia a mutação que ele mata. Nenhum deles importa as
 * constantes de padding — ver o comentário dos leitores de geometria.
 */
describe("<SerieApuracaoChart /> — G1: mata a volta do padding simétrico 32/20", () => {
  const doc = okDe([cand({ id: 13, apurado: [30, 34], projetado: [31, 33] })]);

  it("a área útil ocupa a caixa quase inteira, nos dois eixos", () => {
    const { largura, altura } = caixa(doc);
    const { x1, x2, yBase, yTopo } = areaUtil(doc);

    // Com 32/8 na horizontal e 10/18 na vertical: 0,9167 e 0,8923.
    // Com o 32/32 e 20/20 de antes: 0,8667 e 0,8182 — os dois reprovam aqui.
    expect((x2 - x1) / largura).toBeGreaterThanOrEqual(0.88);
    expect((yBase - yTopo) / altura).toBeGreaterThanOrEqual(0.85);
  });

  it("a área útil é mais de 80% da caixa", () => {
    // A leitura que interessa ao leitor: quanto do bloco é gráfico. Era 70,9%.
    const { largura, altura } = caixa(doc);
    const { x1, x2, yBase, yTopo } = areaUtil(doc);
    const fracao = ((x2 - x1) / largura) * ((yBase - yTopo) / altura);
    expect(fracao).toBeGreaterThan(0.8);
  });
});

describe("<SerieApuracaoChart /> — G2: mata o padding direito voltar a 32", () => {
  // O ponto final é o ÚLTIMO BOLETIM — o que o leitor procura primeiro na noite
  // de 04/10. Com 32 unidades de folga à direita ele ficava empurrado 6,7% da
  // largura para dentro, com papel em branco do lado de fora. Só precisam caber
  // ali o raio do ponto (3,5) e o rótulo da hora final, que cresce para dentro.
  const doc = okDe([cand({ id: 13, apurado: [30, 32, 34], projetado: [31, 32, 33] })]);

  it("o ponto do último boletim encosta na borda direita", () => {
    const { largura } = caixa(doc);
    const cx = Number(
      doc
        .querySelector('circle[data-ponto-final][data-cand="13"][data-base="parcial"]')
        ?.getAttribute("cx"),
    );
    expect(Number.isFinite(cx)).toBe(true);
    // 8/480 = 0,0167. Com padRight = 32 seriam 0,0667 — reprova.
    expect((largura - cx) / largura).toBeLessThan(0.03);
  });
});

describe("<SerieApuracaoChart /> — G3: mata o passo de folga cobrado SEMPRE", () => {
  // 🔴 A fixture nacional (min 5,64 / max 43,32) NÃO SERVE para este caso.
  // Com ela, a regra velha (`floor(min/5)*5 - 5`) e a nova dão o MESMO 0, e o
  // teste passaria com os dois códigos — seria o terceiro exemplar da família
  // "teste que não discrimina" registrada na memória do projeto.
  //
  // Serve um Senado típico: min 8,2. O degrau abaixo dele é 5, e 8,2 está a
  // 3,2pp dele — longe o bastante para que o degrau JÁ seja a folga. A régua
  // tem de começar em 5, não em 0: começar em 0 regala um quinto da altura do
  // gráfico a uma faixa onde nenhuma linha passa.
  const doc = okDe([
    cand({ id: 1, partido: "PT", apurado: [31.7, 30.1], projetado: [30.9, 31.0] }),
    cand({ id: 2, partido: "PL", apurado: [8.2, 9.4], projetado: [8.9, 9.1] }),
  ]);

  it("a base da régua é o degrau abaixo do mínimo, não um passo abaixo dele", () => {
    expect(rotulo(doc, "serie-rotulo-ymin")).toBe("5%");
  });

  it("o topo continua sendo o degrau acima do máximo (controle do instrumento)", () => {
    expect(rotulo(doc, "serie-rotulo-ymax")).toBe("35%");
  });
});

describe("<SerieApuracaoChart /> — G4: mata apagar a folga de segurança", () => {
  // O outro lado da G3, e é ele que impede a "correção" preguiçosa de remover
  // o `- passo` de vez. Min 5,64 (a linha do ZEMA) está a 0,64pp do degrau
  // abaixo: parar a régua em 5 deixaria a linha mais baixa a 1,6% do eixo, e um
  // traço sobre o eixo some. Aqui a régua TEM de descer mais um passo.
  const doc = okDe([
    cand({ id: 1, partido: "PT", apurado: [43.32, 42.1], projetado: [41.0, 41.5] }),
    cand({ id: 2, partido: "PL", apurado: [5.64, 6.2], projetado: [6.0, 6.1] }),
  ]);

  it("com o mínimo colado no degrau, a régua desce mais um passo", () => {
    expect(rotulo(doc, "serie-rotulo-ymin")).toBe("0%");
  });

  it("o domínio da fixture nacional não mudou em relação ao de antes", () => {
    // 0–45 é exatamente o que a régua velha produzia para esta fixture. É a
    // prova de que o ajuste não mexeu no caso mais visto do produto.
    expect(rotulo(doc, "serie-rotulo-ymax")).toBe("45%");
  });
});

describe("<SerieApuracaoChart /> — G5: mata a gridline sem rótulo", () => {
  // Uma régua com linhas a mais (ou rótulos a menos) vira grade decorativa: o
  // leitor vê traços que não sabe ler. As asserções são de RELAÇÃO — cada
  // rótulo tem de pousar na SUA linha, e as linhas têm de cair onde a escala
  // manda —, nunca contra um número fixo.
  const doc = okDe([
    cand({ id: 1, partido: "PT", apurado: [31.7, 30.1], projetado: [30.9, 31.0] }),
    cand({ id: 2, partido: "PL", apurado: [8.2, 9.4], projetado: [8.9, 9.1] }),
  ]);
  const marcas = regua(doc);

  it("há uma linha e um rótulo por marca, e nada sobra", () => {
    const linhas = doc.querySelectorAll('[data-testid="serie-regua-y"] line');
    const textos = doc.querySelectorAll('[data-testid="serie-regua-y"] text');
    expect(marcas.length).toBeGreaterThanOrEqual(3);
    expect(linhas).toHaveLength(marcas.length);
    expect(textos).toHaveLength(marcas.length);
  });

  it("cada rótulo anuncia o valor da SUA linha, e os valores sobem em passo fixo", () => {
    const valores = marcas.map((m) => m.valor);
    for (const m of marcas) {
      expect(m.texto).toBe(`${m.valor}%`);
    }
    const vaos = valores.slice(1).map((v, i) => v - (valores[i] as number));
    expect(new Set(vaos).size).toBe(1);
    expect(vaos[0]).toBeGreaterThan(0);
  });

  it("cada linha cai onde a escala manda — o `y` é linear no valor", () => {
    // Âncoras: a marca da base e a do topo. As do meio têm de cair na reta que
    // liga as duas. Uma régua que espaça as linhas por igual mas rotula valores
    // desiguais (ou o contrário) reprova aqui.
    const base = marcas[0] as Marca;
    const topo = marcas.at(-1) as Marca;
    for (const m of marcas) {
      const fracao = (m.valor - base.valor) / (topo.valor - base.valor);
      const esperado = base.yLinha + fracao * (topo.yLinha - base.yLinha);
      expect(m.yLinha).toBeCloseTo(esperado, 6);
    }
    expect(topo.yLinha).toBeLessThan(base.yLinha); // em SVG o y cresce para baixo
  });

  it("nenhum rótulo pousa mais perto da linha de outra marca que da sua", () => {
    for (const m of marcas) {
      const distanciaPropria = Math.abs(m.yTexto - m.yLinha);
      for (const outra of marcas) {
        if (outra === m) continue;
        expect(distanciaPropria).toBeLessThan(Math.abs(m.yTexto - outra.yLinha));
      }
    }
  });

  it.each([
    ["nacional", 5.64, 43.32],
    ["Senado típico", 8.2, 31.7],
    ["UF típica", 12.4, 48.9],
    ["alcance sem divisor (7 passos)", 7.0, 38.0],
    ["alcance sem divisor (11 passos)", 3.0, 52.0],
    ["série quase plana", 30.2, 31.1],
  ])("o domínio %s rende uma régua legível — nem 2 marcas, nem quadriculado", (_nome, minimo, maximo) => {
    // 🔴 A régua só rotula em vãos que DIVIDEM o alcance, para que a marca do
    // topo não caia num vão menor que as outras. O preço: um alcance de 7 passos
    // (35pp — uma noite plausível, mínimo 7% e máximo 38%) só admite o vão de
    // 5pp, e sai com NOVE linhas rotuladas. Papel quadriculado, e o teto de 5
    // vãos deixando de valer exatamente onde ninguém olha.
    //
    // A mutação que este caso mata é remover o degrau de `limitesVerticais` que
    // sobe o teto nesses alcances: sem ele, os dois casos "sem divisor" saem com
    // 9 e 12 marcas. ⚠️ O limite de BAIXO sozinho não mataria nada — foi a
    // primeira versão deste caso, e ela passou com a mutação aplicada.
    const doc = okDe([
      cand({
        id: 1,
        partido: "PT",
        apurado: [maximo, maximo - 1],
        projetado: [maximo - 2, maximo],
      }),
      cand({
        id: 2,
        partido: "PL",
        apurado: [minimo, minimo + 1],
        projetado: [minimo + 1, minimo],
      }),
    ]);
    const marcas = regua(doc);
    expect(marcas.length).toBeGreaterThanOrEqual(3);
    expect(marcas.length).toBeLessThanOrEqual(6);

    // E o domínio continua contendo o dado: subir o teto não pode virar desculpa
    // para a régua deixar de cobrir a linha mais alta.
    expect(marcas.at(-1)?.valor).toBeGreaterThanOrEqual(maximo);
    expect(marcas[0]?.valor).toBeLessThanOrEqual(minimo);
  });

  it("as duas pontas continuam sendo `serie-rotulo-ymin` e `serie-rotulo-ymax`", () => {
    // Eles existiam como dois `<text>` soltos e foram absorvidos pela régua.
    // Sumir daqui quebraria os consumidores sem quebrar o desenho.
    expect(marcas[0]?.testid).toBe("serie-rotulo-ymin");
    expect(marcas.at(-1)?.testid).toBe("serie-rotulo-ymax");
    expect(marcas.filter((m) => m.testid !== null)).toHaveLength(2);
  });
});

describe("<SerieApuracaoChart /> — G6: mata os dois estados discordarem de lado", () => {
  // 🔴 É o único bloco que mata o defeito de origem. Antes de 2026-09-19 o
  // estado "ok" desenhava os rótulos de Y em `width - padX + 4` (à direita) e
  // o estado "antes do dia" em `padX - 6` (à esquerda): quem abrisse a página
  // de manhã e voltasse à noite via a régua trocar de lado.
  const ok = okDe([cand({ id: 13, apurado: [30, 34], projetado: [31, 33] })]);
  const pre = parse(
    <SerieApuracaoChart
      eixo={[]}
      cadenciaMin={5}
      candidatos={[]}
      escopo="Brasil"
      titleId="pre-lado"
      preEleicao
    />,
  );

  it.each([
    ["ok", ok],
    ["antes-do-dia", pre],
  ])("no estado %s, todo rótulo de Y fica na metade esquerda da caixa", (_estado, doc) => {
    const { largura } = caixa(doc);
    const marcas = regua(doc);
    expect(marcas.length).toBeGreaterThanOrEqual(3);
    for (const m of marcas) {
      expect(m.xTexto).toBeLessThan(largura / 2);
    }
  });

  it("os dois estados desenham a régua com o mesmo componente — mesma forma", () => {
    // Não é o mesmo NÚMERO de marcas (o domínio difere), é a mesma estrutura:
    // `textAnchor="end"` e a mesma abscissa de ancoragem nos dois.
    const xOk = new Set(regua(ok).map((m) => m.xTexto));
    const xPre = new Set(regua(pre).map((m) => m.xTexto));
    expect(xOk.size).toBe(1);
    expect(xPre).toEqual(xOk);

    for (const doc of [ok, pre]) {
      for (const t of doc.querySelectorAll('[data-testid="serie-regua-y"] text')) {
        expect(t.getAttribute("text-anchor")).toBe("end");
      }
    }
  });

  it("o estado COM dado não desenha menos régua que o estado SEM dado", () => {
    // A inversão que existia: 2 linhas no "ok" contra 6 no "antes do dia" — a
    // caixa cheia parecia mais vazia que a caixa vazia.
    expect(regua(ok).length).toBeGreaterThanOrEqual(3);
  });
});

describe("<SerieApuracaoChart /> — G7: mata o terceiro cinza de moldura", () => {
  const doc = okDe([cand({ id: 13, apurado: [30, 34], projetado: [31, 33] })]);

  it("a gridline usa literalmente o mesmo traço do eixo", () => {
    const strokeEixo = doc
      .querySelector('[data-testid="serie-eixos"] line')
      ?.getAttribute("stroke");
    expect(strokeEixo).toBeTruthy();
    for (const m of regua(doc)) {
      expect(m.stroke).toBe(strokeEixo);
    }
  });
});

describe("<SerieApuracaoChart /> — G8: mata a regressão silenciosa do `height` default", () => {
  // ⚠️ Necessário porque TODOS os outros casos deste arquivo passam
  // `height={ALTURA}` explicitamente: sem este bloco, o default poderia voltar
  // a 220 sem nenhum teste ficar vermelho, e as quatro rotas que renderizam o
  // widget não passam `height`.
  const doc = okDe([cand({ id: 13, apurado: [30, 34], projetado: [31, 33] })]);

  it("sem prop de altura, a caixa é a de 2026-09-19", () => {
    expect(doc.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 480 260");
  });

  it("a caixa deixa de ser uma faixa — menos de 2:1", () => {
    const { largura, altura } = caixa(doc);
    // 480/260 = 1,85. O default antigo dava 480/220 = 2,18 — reprova.
    expect(largura / altura).toBeLessThan(2.0);
  });
});

/**
 * RF-172, emenda de 2026-10-04 — a chave "Apuração | Projeção" do gráfico.
 *
 * Montada de verdade (`createRoot` + `act`, happy-dom), como a chave do RF-295
 * em `StrongholdsPanel.test.tsx`: `renderToStaticMarkup` descarta o handler e
 * não provaria o clique.
 *
 * Mutações que matam: (M1) abrir em Projeção; (M2) o clique não trocar o
 * atributo; (M3) o grupo voltar a `data-view-only` — o seletor do topo
 * continuaria mandando e a chave não esconderia nada; (M4) a regra de CSS
 * esconder a base errada.
 */
// biome-ignore lint/suspicious/noExplicitAny: flag global do React para `act` fora de um runner de testes de React
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("<SerieApuracaoChart /> — RF-172: a chave própria do gráfico", () => {
  function montar(): { container: HTMLDivElement; root: Root } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <SerieApuracaoChart
          eixo={eixoDe(4)}
          cadenciaMin={5}
          candidatos={[
            cand({ id: 13, apurado: [10, 20, 30, 40], projetado: [40, 33, 31, 30] }),
            cand({ id: 22, apurado: [40, 33, 31, 30], projetado: [10, 20, 30, 40] }),
          ]}
          escopo="Brasil"
          titleId="chave"
          height={ALTURA}
        />,
      );
    });
    return { container, root };
  }

  function botao(container: HTMLElement, base: "parcial" | "proj"): HTMLButtonElement {
    const b = container.querySelector<HTMLButtonElement>(
      `[data-testid="serie-base-botao"][data-base="${base}"]`,
    );
    if (!b) throw new Error(`botão ${base} ausente`);
    return b;
  }

  it("(M1) abre em Apuração", () => {
    const { container, root } = montar();
    const alvo = container.querySelector("[data-serie-base]");
    expect(alvo?.getAttribute("data-serie-base")).toBe("parcial");
    expect(SERIE_BASE_INICIAL).toBe("parcial");
    expect(botao(container, "parcial").getAttribute("aria-pressed")).toBe("true");
    expect(botao(container, "proj").getAttribute("aria-pressed")).toBe("false");
    act(() => root.unmount());
  });

  it("(M2) clicar em Projeção troca a base, e voltar desfaz", () => {
    const { container, root } = montar();
    const alvo = () => container.querySelector("[data-serie-base]");

    act(() => botao(container, "proj").click());
    expect(alvo()?.getAttribute("data-serie-base")).toBe("proj");
    expect(botao(container, "proj").getAttribute("aria-pressed")).toBe("true");
    expect(botao(container, "parcial").getAttribute("aria-pressed")).toBe("false");

    act(() => botao(container, "parcial").click());
    expect(alvo()?.getAttribute("data-serie-base")).toBe("parcial");
    act(() => root.unmount());
  });

  it("(M3) o svg fica DENTRO do alvo, os dois grupos seguem no DOM, e aria-controls aponta para ele", () => {
    const { container, root } = montar();
    const alvo = container.querySelector("[data-serie-base]");
    expect(alvo?.querySelector('svg g[data-serie-only="parcial"]')).not.toBeNull();
    expect(alvo?.querySelector('svg g[data-serie-only="proj"]')).not.toBeNull();
    expect(botao(container, "proj").getAttribute("aria-controls")).toBe(alvo?.id);
    // A tabela acessível (RF-176) fica FORA do alvo: as duas bases continuam
    // legíveis por leitor de tela em qualquer posição da chave.
    expect(alvo?.querySelector('[data-testid="serie-apuracao-tabela"]')).toBeNull();
    act(() => root.unmount());
  });

  it("(M4) o CSS esconde a base OPOSTA à escolhida, e só pelo atributo próprio", () => {
    const css = readFileSync(
      path.join(process.cwd(), "components/atoms/charts/SerieBaseAlternavel.module.css"),
      "utf-8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const regra = css.match(/([^{}]+)\{\s*display:\s*none;?\s*\}/);
    const seletores = (regra?.[1] ?? "").split(",").map((x) => x.replace(/\s+/g, " ").trim());
    expect(seletores).toEqual([
      '.raiz[data-serie-base="parcial"] [data-serie-only="proj"]',
      '.raiz[data-serie-base="proj"] [data-serie-only="parcial"]',
    ]);
  });
});
