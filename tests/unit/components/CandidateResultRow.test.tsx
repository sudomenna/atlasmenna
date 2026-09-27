// @vitest-environment happy-dom
/**
 * tests/unit/components/CandidateResultRow.test.tsx
 *
 * Linha de candidato com parcial e projeção lado a lado (ADR-0029 § 7).
 *
 * ⚠️ **O invariante central deste arquivo MUDOU em 2026-09-20 (2ª rodada).**
 * Ele dizia: "os dois números ficam no DOM, sempre; o controle Parcial /
 * Projeção muda ênfase, não presença". Isso deixou de ser verdade e o caso
 * `(b)` abaixo agora exige o contrário — o cabeçalho ficou para trás por uma
 * rodada e foi pego pelo `a11y-perf-auditor`, não por teste nenhum. Cabeçalho
 * que contradiz o corpo é pior que cabeçalho ausente: quem lê só ele opera
 * com premissa falsa.
 *
 * O invariante atual, por decisão do dono:
 *
 *   - o número **parcial** fica no DOM sempre (`data-view-cell`), e o controle
 *     muda só a ênfase tipográfica — aqui a regra antiga continua valendo;
 *   - o número **projetado** é exclusivo da visão Projeção (`data-view-only`)
 *     e sai do DOM, e da árvore de acessibilidade, na visão Parcial;
 *   - a barra desenha sempre o apurado, e o traço — sempre a projeção — só
 *     existe na visão Projeção.
 *
 * Nada disso é collapsible no sentido do ADR-0017: nenhuma CANDIDATURA sai da
 * lista em estado nenhum. O que é exclusivo por base é uma coluna de número,
 * pelo mesmo mecanismo que o `<h1>` do painel e a barra de maioria já usavam.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CandidateResultRow,
  candidateResultRowProps,
} from "@/components/atoms/tables/CandidateResultRow";
import type { EdgeCandidate } from "@/lib/edge-config/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

/**
 * O PREENCHIMENTO da barra. Singular desde 2026-09-20 (2ª rodada).
 *
 * 🔴 Endereçado por `data-testid` próprio, e não por `[data-view-only]` dentro
 * do recorte. Eram DOIS preenchimentos, um por base, e o seletor antigo lia o
 * atributo de exclusividade — que o traço também usa. Com um preenchimento só
 * e sem `data-view-only` nele, aquele seletor devolve zero elementos, e um
 * teste que sobrevivesse a isso estaria medindo o nada.
 */
function preenchimentos(doc: Document): Element[] {
  return [...doc.querySelectorAll('[data-testid="result-bar-fill"]')];
}

/** Os traços. Hoje há no máximo UM; a lista é o que trava "no máximo um". */
function marcadores(doc: Document): Element[] {
  return [...doc.querySelectorAll('[data-testid="result-bar-marker"]')];
}

/**
 * O traço que a base `base` mostra.
 *
 * ⚠️ Desde 2026-09-20 (2ª rodada) `marcadorDaBase(doc, "parcial")` devolve
 * `null` SEMPRE — a visão Parcial não tem traço nenhum, por decisão do dono. A
 * função continua parametrizada de propósito: é assim que os casos abaixo
 * afirmam a ausência em vez de deixá-la implícita.
 */
function marcadorDaBase(doc: Document, base: "parcial" | "proj"): Element | null {
  return doc.querySelector(`[data-testid="result-bar-marker"][data-view-only="${base}"]`);
}

/** Lê `prop: <n>px` do atributo `style`, sem regex — escape em heredoc mente. */
function px(el: Element | null, prop: string): number | null {
  for (const decl of (el?.getAttribute("style") ?? "").split(";")) {
    const [chave, valor] = decl.split(":");
    if (chave?.trim() !== prop) continue;
    const n = Number.parseFloat((valor ?? "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `style` sem espaço em branco — comparação estável contra o que o React emite. */
function estilo(el: Element | null): string {
  return (el?.getAttribute("style") ?? "").replace(/\s+/g, "");
}

const BASE = {
  rank: 3,
  nome: "Candidato MDB",
  partido: "MDB",
  cor: "var(--color-cand-3)",
  pctAtual: 8.4,
  pctProjetado: 9.1,
  votos: 1_234_567,
};

describe("<CandidateResultRow />", () => {
  it("(a) mostra as duas bases, rotuladas, na mesma linha", () => {
    const doc = parse(<CandidateResultRow {...BASE} />);
    const texto = doc.body.textContent ?? "";

    expect(texto).toContain("8,4%");
    expect(texto).toContain("9,1%");
    expect(texto).toContain("parcial");
    expect(texto).toContain("proj.");
    expect(texto).toContain("Candidato MDB");
    expect(texto).toContain("MDB");
  });

  it("(b) 🔴 o parcial fica SEMPRE; a projeção é exclusiva da visão de Projeção", () => {
    // Mudou em 2026-09-20 (2ª rodada). Antes as DUAS colunas eram
    // `data-view-cell` — as duas sempre no DOM, só a ênfase mudando. Agora a
    // coluna de projeção é `data-view-only`, e o CSS do shell lhe aplica
    // `display: none` na base parcial, tirando-a também da árvore de
    // acessibilidade.
    //
    // Mutação que morre: devolver a coluna de projeção para `data-view-cell` —
    // é o estado anterior, e nele a visão Parcial anunciaria por leitor de tela
    // um número que a tela não mostra.
    const doc = parse(<CandidateResultRow {...BASE} />);

    const celulas = [...doc.querySelectorAll("[data-view-cell]")];
    expect(celulas.map((c) => c.getAttribute("data-view-cell"))).toEqual(["parcial"]);

    const colunaProj = doc.querySelector('[data-view-only="proj"].text-right');
    expect(colunaProj).not.toBeNull();
    expect(colunaProj?.textContent).toContain("9,1%");
    expect(colunaProj?.getAttribute("data-view-cell")).toBeNull();

    // Quem esconde é a cascata, nunca um `display` inline: um inline venceria
    // a cascata e congelaria a coluna numa base só.
    for (const el of [...celulas, colunaProj].filter(Boolean) as Element[]) {
      expect(el.getAttribute("hidden")).toBeNull();
      expect(el.getAttribute("style") ?? "").not.toMatch(/display\s*:\s*none/);
    }
  });

  it("(c) 🔴 UM preenchimento, e ele é o APURADO — nas duas bases", () => {
    // Mudou em 2026-09-20 (2ª rodada): eram dois, um por base. Mutação que
    // morre: desenhar `pctProjetado` (9,1) no lugar de `pctAtual` (8,4), ou
    // devolver o segundo preenchimento.
    const doc = parse(<CandidateResultRow {...BASE} />);
    const fills = preenchimentos(doc);

    expect(fills).toHaveLength(1);
    expect(fills[0]?.getAttribute("style")).toContain("width:8.4%");
    expect(fills[0]?.getAttribute("style")).not.toContain("width:9.1%");
    // Sem `data-view-only`: o preenchimento não é exclusivo de base nenhuma.
    expect(fills[0]?.getAttribute("data-view-only")).toBeNull();

    // A distância entre "onde está" e "onde o modelo diz que termina"
    // (constituição § 8) continua na tela — pelo traço, na visão de Projeção.
    expect(renderToStaticMarkup(<CandidateResultRow {...BASE} />)).toContain(
      "var(--accent-strong)",
    );
  });

  it("(d) delta ▲/▼ só a partir de 0,1pp — abaixo disso os dois números são iguais na tela", () => {
    expect(parse(<CandidateResultRow {...BASE} />).body.textContent).toContain("proj. ▲");

    const caindo = parse(<CandidateResultRow {...BASE} pctAtual={9.1} pctProjetado={8.4} />);
    expect(caindo.body.textContent).toContain("proj. ▼");

    const parado = parse(<CandidateResultRow {...BASE} pctAtual={9.1} pctProjetado={9.14} />);
    expect(parado.body.textContent).not.toContain("▲");
    expect(parado.body.textContent).not.toContain("▼");
  });

  it("(e) a cor do candidato pinta a barra, nunca o texto (contraste — RNF-022)", () => {
    const html = renderToStaticMarkup(<CandidateResultRow {...BASE} />);
    expect(html).toContain("background:var(--color-cand-3)");
    expect(html).not.toMatch(/color\s*:\s*var\(--color-cand-/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("(f) `compact` esconde os votos e reduz a densidade — sem tirar percentual algum", () => {
    const doc = parse(<CandidateResultRow {...BASE} compact />);
    const texto = doc.body.textContent ?? "";

    expect(texto).not.toContain("votos");
    expect(texto).toContain("8,4%");
    expect(texto).toContain("9,1%");
  });

  it("(g) valores fora de 0–100 ou não-finitos não vazam para a largura da barra", () => {
    const doc = parse(
      <CandidateResultRow {...BASE} pctAtual={Number.NaN} pctProjetado={140} votos={null} />,
    );
    const fills = preenchimentos(doc);
    expect(fills).toHaveLength(1);
    // `NaN` vira 0 no preenchimento...
    expect(fills[0]?.getAttribute("style")).toContain("width:0%");
    // ...e 140 vira 100 na posição do traço, que é onde `pctProjetado` chega.
    expect(estilo(marcadorDaBase(doc, "proj"))).toContain("left:min(100%,");
  });

  it("(h) `candidateResultRowProps` mapeia o payload e cai para o rank de fallback", () => {
    const cand = {
      id: 9,
      nome: "Candidato PDT",
      partido: "PDT",
      cor: "var(--color-cand-4)",
      votos_atuais: 500,
      pct_atual: 2.2,
      pct_projetado: 2.5,
    } as unknown as EdgeCandidate;

    expect(candidateResultRowProps(cand, 7)).toMatchObject({
      rank: 7,
      nome: "Candidato PDT",
      partido: "PDT",
      pctAtual: 2.2,
      pctProjetado: 2.5,
      votos: 500,
      compact: false,
    });

    expect(candidateResultRowProps({ ...cand, rank: 4 }, 7, true)).toMatchObject({
      rank: 4,
      compact: true,
    });
  });

  // ---------------------------------------------------------------------------
  // 2026-09-09 — `variant="kit"` entrou para a lista do `<ResultPanel>`.
  // O que estes dois testes protegem é o DEFAULT: quatro telas fora do escopo
  // daquela mudança (Camadas 2 e 3 do ADR-0017 e as duas rotas de UF) usam
  // esta linha, e um default trocado por descuido as mudaria em silêncio.
  // ---------------------------------------------------------------------------

  it("(i) o default `variant='densa'` não mudou: texto puro, votos abreviados, 13px", () => {
    const doc = parse(<CandidateResultRow {...BASE} />);

    expect(doc.querySelector('[data-testid="party-tag"]')).toBeNull();
    expect(doc.body.textContent).toContain("1,2 mi votos");
    const numero = doc.querySelector("[data-view-cell='parcial']")?.firstElementChild;
    expect(numero?.getAttribute("style")).not.toContain("font-size");
    expect(numero?.getAttribute("style")).toContain("var(--type-figure-sm)");
  });

  it("(j) `variant='kit'` é a versão D: sigla em texto com o número na urna, votos por extenso", () => {
    // 🔴 2026-09-27 — a variante `kit` virou a versão D do protótipo (decisão
    // do dono). Saíram a `<PartyTag>`, o número de colocação à esquerda e a
    // densidade `compact` (todas as linhas iguais); o que este caso protegia
    // — "o kit é a lista do painel, a densa é o default" — segue em (i).
    const doc = parse(<CandidateResultRow {...BASE} numero={15} variant="kit" />);

    expect(doc.querySelector('[data-testid="party-tag"]')).toBeNull();
    expect(doc.body.textContent).toContain("MDB – 15");
    expect(doc.body.textContent).toContain("1.234.567 votos");
    // Sem `numero`, só a sigla — nunca "MDB – undefined".
    const semNumero = parse(<CandidateResultRow {...BASE} variant="kit" />);
    expect(semNumero.body.textContent).toContain("MDB");
    expect(semNumero.body.textContent).not.toContain("–");
    expect(semNumero.body.textContent).not.toContain("undefined");
  });
});

describe("variant='kit' (versão D) — números, barra e selo por base", () => {
  const kit = (over: Partial<React.ComponentProps<typeof CandidateResultRow>> = {}) =>
    parse(<CandidateResultRow {...BASE} numero={15} variant="kit" {...over} />);

  it("🔴 Parcial: só o apurado; Projeção: projetado grande + 'apurado X%' pequeno", () => {
    const doc = kit();
    const texto = (sel: string) =>
      [...doc.querySelectorAll(sel)].map((el) => el.textContent ?? "").join("|");

    expect(texto('[data-view-only="parcial"]')).toContain("8,4%");
    expect(texto('[data-view-only="parcial"]')).not.toContain("9,1%");
    expect(texto('[data-view-only="proj"]')).toContain("9,1%");
    expect(texto('[data-view-only="proj"]')).toContain("apurado 8,4%");
    // Todo nó de texto com o projetado está sob `data-view-only="proj"` —
    // `display: none` tira da tela E da árvore de acessibilidade na Parcial.
    const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
    let n = walker.nextNode();
    let vistos = 0;
    while (n) {
      if (n.textContent?.includes("9,1%")) {
        vistos++;
        expect(n.parentElement?.closest("[data-view-only]")?.getAttribute("data-view-only")).toBe(
          "proj",
        );
      }
      n = walker.nextNode();
    }
    expect(vistos).toBe(1);
  });

  it("a cor: base no preenchimento, `-text` do partido no percentual — nunca a do payload", () => {
    const linha = kit().querySelector('[data-testid="candidate-result-row"]');
    const style = linha?.getAttribute("style") ?? "";
    expect(style).toContain("--cor-base:var(--color-cand-3)"); // a `cor` recebida
    expect(style).toContain("--cor-texto:var(--party-mdb-text)"); // da SIGLA
  });

  it("🔴 a barra: preenchimento = apurado; marca = projeção, só na Projeção, IRMÃ do recorte", () => {
    const doc = kit();
    const fill = doc.querySelector('[data-testid="result-bar-fill"]');
    const marca = doc.querySelector('[data-testid="result-bar-marker"]');
    const clip = doc.querySelector('[data-testid="result-bar-clip"]');

    expect(fill?.getAttribute("style")).toContain("width:8.4%");
    expect(fill?.getAttribute("data-marca")).toBe("parcial");
    expect(marca?.getAttribute("data-view-only")).toBe("proj");
    expect(marca?.getAttribute("style")).toContain("min(9.1%, calc(100% - 3px))");
    // O conserto de `8d92e95`: a marca fora do `overflow: hidden`.
    expect(clip?.contains(marca as Node)).toBe(false);
    expect(marca?.parentElement).toBe(clip?.parentElement);
    // Projeção zerada ⇒ sem marca (três estados: não se afirma "0%").
    expect(kit({ pctProjetado: 0 }).querySelector('[data-testid="result-bar-marker"]')).toBeNull();
  });

  it("selo: cada base sob o seu `data-view-only`; sem selo, nenhum nó", () => {
    const doc = kit({ selos: { parcial: <b>P</b>, proj: <b>J</b> } });
    expect(doc.querySelector('[data-view-only="parcial"] > b')?.textContent).toBe("P");
    expect(doc.querySelector('[data-view-only="proj"] > b')?.textContent).toBe("J");
    const sem = kit();
    expect(sem.querySelectorAll("b")).toHaveLength(0);
  });

  it("anulada: '—' no lugar do %, só os votos, trilho vazio", () => {
    const doc = kit({ destino: "anulado" });
    expect(doc.querySelector('[data-testid="result-pct-anulada"]')?.textContent).toBe("—");
    expect(doc.body.textContent).not.toMatch(/%/);
    expect(doc.querySelector('[data-testid="result-bar"]')).not.toBeNull();
    expect(doc.querySelector('[data-testid="result-bar-fill"]')).toBeNull();
    expect(doc.querySelector('[data-testid="result-bar-marker"]')).toBeNull();
    expect(doc.querySelector('[data-testid="candidate-result-votos-anulada"]')?.textContent).toBe(
      "1.234.567 votos apurados",
    );
  });
});

describe("altura da barra — dobrada em 2026-09-19", () => {
  /**
   * O dono pediu "exatamente o dobro do que são hoje", e "hoje" eram 4px.
   *
   * 🔴 Este bloco existe porque a suíte era CEGA ao número: aplicando a
   * mutação (voltar `BARRA_ALTURA_PX` para 4), os 15 casos existentes
   * continuavam verdes. Altura de barra é exatamente o tipo de valor que
   * ninguém percebe regredir — some 4px por linha e a tela só fica "um pouco
   * diferente".
   */
  function barra(doc: Document): HTMLElement | null {
    // 🔴 Por testid, e não por farejar `style`. A busca anterior exigia
    // `grid-column:2 / -1` **e** `--surface-sunken` no MESMO elemento, o que
    // amarrava o teste a barra ser uma caixa só — exatamente a forma que o
    // conserto de 2026-09-20 teve de desfazer (posicionamento fora, recorte
    // dentro). Um seletor que quebra quando a estrutura é corrigida mede a
    // estrutura, não o número que ele diz medir.
    return doc.querySelector<HTMLElement>('[data-testid="result-bar"]');
  }

  it("🔴 a barra tem 8px — o dobro dos 4px que tinha", () => {
    // Mutação que morre: qualquer valor que não seja 8. O número é literal de
    // propósito: importar `BARRA_ALTURA_PX` e comparar com ele mesmo seria a
    // tautologia que este repositório já registrou como "teste que não
    // discrimina" — passaria com 4, com 8 e com 40.
    expect(px(barra(parse(<CandidateResultRow {...BASE} />)), "height")).toBe(8);
  });

  it("o traço NÃO dobrou junto — segue sobrando 2px de cada lado", () => {
    // Decisão registrada no componente: o traço precisa ser visível acima e
    // abaixo do preenchimento, e 2px cumprem isso numa barra de 4 ou de 8.
    // Dobrá-lo faria dele um segundo elemento competindo com a barra.
    //
    // Mutação que morre: escalar a sobra junto com a altura (-4/-4), ou zerá-la.
    //
    // ⚠️ Este caso mede a INTENÇÃO declarada, e sozinho ele não prova nada
    // sobre a tela: passou verde entre 08/09 e 20/09 com a sobra recortada e
    // invisível. Quem prova que ela chega ao vidro é o bloco logo abaixo.
    //
    // 🔴 A sobra continua obrigatória depois que os dois traços viraram um só
    // (20/09, 2ª rodada): a barra desenha o apurado e o traço marca a projeção,
    // então quando a projeção RECUA o traço cai dentro do preenchimento — 6 das
    // 7 candidaturas da tela medida em 19/09. Ali a sobra é a única parte
    // legível (1,16:1 a 1,70:1 dentro; 4,21:1 na sobra).
    const doc = parse(<CandidateResultRow {...BASE} />);
    expect(marcadores(doc)).toHaveLength(1);
    for (const marcador of marcadores(doc)) {
      expect(marcador.getAttribute("style")).toContain("--accent-strong");
      expect(px(marcador, "top")).toBe(-2);
      expect(px(marcador, "bottom")).toBe(-2);
    }
  });
});

/**
 * 🔴 2026-09-20 — a sobra do traço era recortada, e a suíte não sabia.
 *
 * Defeito medido no Chrome: o contêiner da barra tinha `overflow: hidden` desde
 * o nascimento do arquivo (`1ac871b`, 08/09) e o traço morava dentro dele. A
 * caixa de layout do traço media os 12px previstos, mas `elementFromPoint` 1px
 * acima da barra devolvia o contêiner da LINHA — `overflow: hidden` recorta
 * pintura e hit-testing. Nas 6 de 7 candidaturas em que a projeção recua, o
 * traço inteiro caía dentro do preenchimento, entre 1,16:1 e 1,70:1 contra o
 * piso de 3:1 do SC 1.4.11.
 *
 * ⚠️ **Nenhum teste aqui mede pixel pintado, e nenhum poderia**:
 * `getBoundingClientRect()` devolve zero no happy-dom, armadilha já registrada
 * neste repositório. O que estes casos travam é a ESTRUTURA que torna o
 * recorte impossível — a única coisa verificável sem navegador, e a que falha
 * no instante em que alguém devolver o traço para dentro da caixa recortada.
 */
describe("o traço da projeção não pode ser recortado", () => {
  /** Ancestrais do elemento dentro do fragmento renderizado, do pai para cima. */
  function ancestrais(el: Element | null): Element[] {
    const cadeia: Element[] = [];
    for (let p = el?.parentElement ?? null; p && p.tagName !== "BODY"; p = p.parentElement) {
      cadeia.push(p);
    }
    return cadeia;
  }

  /**
   * Recorta? Olha `style` inline E `class`: neste arquivo o recorte é inline,
   * mas `truncate`/`overflow-hidden` do Tailwind produzem o mesmo efeito e um
   * teste cego a eles aceitaria a regressão vinda pelo outro caminho.
   */
  function recorta(el: Element): boolean {
    const style = (el.getAttribute("style") ?? "").replace(/\s+/g, "");
    const classe = el.getAttribute("class") ?? "";
    return (
      /overflow(-x|-y)?:(hidden|clip|auto|scroll)/.test(style) ||
      /(^|\s)(truncate|overflow-(x-|y-)?(hidden|clip|auto|scroll))(\s|$)/.test(classe)
    );
  }

  it("🔴 nenhum ancestral do traço recorta — a sobra chega ao vidro", () => {
    // Mutação que morre: mover o traço para dentro de
    // `[data-testid="result-bar-clip"]`, que é onde ele ficou de 08/09 a 20/09.
    const doc = parse(<CandidateResultRow {...BASE} />);
    expect(marcadores(doc)).toHaveLength(1);

    for (const marcador of marcadores(doc)) {
      const culpados = ancestrais(marcador)
        .filter(recorta)
        .map((el) => el.getAttribute("data-testid") ?? el.getAttribute("style") ?? el.tagName);

      expect({ base: marcador.getAttribute("data-view-only"), culpados }).toEqual({
        base: marcador.getAttribute("data-view-only"),
        culpados: [],
      });
    }
  });

  it("🔴 o traço é IRMÃO do recorte, não descendente dele", () => {
    // O caso acima já pegaria a regressão, mas só pelo efeito. Este nomeia a
    // estrutura: se um dia o recorte sair do `clip` e for parar em outro lugar,
    // a resposta certa continua sendo manter o traço fora dele.
    const doc = parse(<CandidateResultRow {...BASE} />);
    const clip = doc.querySelector('[data-testid="result-bar-clip"]');

    expect(marcadores(doc)).toHaveLength(1);
    for (const marcador of marcadores(doc)) {
      expect(clip?.contains(marcador)).toBe(false);
      expect(marcador.parentElement?.getAttribute("data-testid")).toBe("result-bar");
    }
  });

  it("🔴 o recorte CONTINUA sobre o preenchimento — é o canto arredondado", () => {
    // A tentação óbvia (e errada) é apagar o `overflow: hidden`. Ele existe
    // para que o preenchimento `inset: 0` de largura percentual respeite o
    // `border-radius` da barra; sem ele a ponta dele vaza o canto.
    //
    // Mutação que morre: remover o `overflow`/`border-radius` da caixa interna.
    const doc = parse(<CandidateResultRow {...BASE} />);
    const clip = doc.querySelector('[data-testid="result-bar-clip"]');
    const css = estilo(clip);

    expect(css).toContain("overflow:hidden");
    expect(css).toContain("border-radius:var(--radius-xs)");

    const fills = preenchimentos(doc);
    expect(fills).toHaveLength(1);
    for (const fill of fills) {
      expect(clip?.contains(fill)).toBe(true);
    }
  });

  it("horizontalmente o traço continua contido — 100% não vira rolagem lateral", () => {
    // Sem recorte, `left: 100%` pintaria 2px FORA da barra, e a barra termina
    // na borda direita da linha. O teto no `left` mantém o traço dentro e, de
    // quebra, torna visível o caso que ANTES sumia aparado.
    //
    // `projetado` chega a 100% no fim da noite, e um traço sem teto empurraria
    // a página igual. Mutação que morre: tirar o `min(...)`.
    const doc = parse(<CandidateResultRow {...BASE} pctAtual={100} pctProjetado={100} />);

    expect(marcadores(doc)).toHaveLength(1);
    for (const marcador of marcadores(doc)) {
      expect(estilo(marcador)).toContain("left:min(100%,calc(100%-2px))");
    }
  });
});

/**
 * 🔴 2026-09-20, 2ª rodada — a barra é o APURADO; o traço é a PROJEÇÃO.
 *
 * ## A regra, e as duas que ela substitui
 *
 * | rodada | barra | traço |
 * |---|---|---|
 * | até 20/09 de manhã | a base ativa | fixo em `projetado` |
 * | 20/09, 1ª rodada | a base ativa | a base OPOSTA |
 * | **20/09, 2ª rodada** | **sempre `atual`** | **sempre `projetado`, só na visão Projeção** |
 *
 * A 1ª rodada consertou um defeito medido: na base `proj` a barra desenhava
 * `projetado` e o traço caía no mesmo pixel do fim dela (Chrome, rota `/`,
 * linha do LULA: preenchimento 113,125px, traço `left` 113,1px). Consertava
 * por simetria — e a simetria trouxe o próprio custo: em CADA linha havia uma
 * base em que o traço caía dentro do preenchimento, onde ele mede entre 1,16:1
 * e 1,70:1 contra o piso de 3:1 do SC 1.4.11.
 *
 * A 2ª rodada é decisão do dono e ataca a causa: **nenhuma base desenha a
 * projeção na barra**. O defeito original fica inalcançável — não por uma regra
 * que alguém precise lembrar, mas porque a combinação que o produzia deixou de
 * existir. E a visão "Parcial" volta a ser só o que o TSE contou.
 *
 * ## Por que a suíte de 08/09 não pegou nada disso
 *
 * Nenhum caso perguntava *qual* valor o traço marca em *qual* base: um checava
 * que `--accent-strong` estava no HTML, outro checava `top`/`bottom`. Ambos
 * passariam com o traço em qualquer posição, inclusive empilhado sobre a ponta
 * do preenchimento. Família "teste que não discrimina", já registrada aqui:
 * mede a presença do elemento, não a informação que ele carrega.
 */
describe("a barra é o apurado; o traço é a projeção", () => {
  it("🔴 na visão PARCIAL não há traço nenhum", () => {
    // Mutação que morre: devolver um traço com `data-view-only="parcial"`.
    const doc = parse(<CandidateResultRow {...BASE} />);

    expect(marcadorDaBase(doc, "parcial")).toBeNull();
    expect(marcadores(doc)).toHaveLength(1);
  });

  it("🔴 o único traço é o da visão PROJEÇÃO, e ele marca a projeção", () => {
    // Mutação que morre: apontar o traço para `pctAtual` (8,4) — que é o que a
    // 1ª rodada fazia nesta base. O `left` deixaria de ser 9,1%.
    const doc = parse(<CandidateResultRow {...BASE} />);
    const marcador = marcadorDaBase(doc, "proj");

    expect(marcador).not.toBeNull();
    expect(marcador?.getAttribute("data-marca")).toBe("proj");
    expect(estilo(marcador)).toContain("left:min(9.1%,calc(100%-2px))");
    expect(estilo(marcador)).not.toContain("left:min(8.4%");
  });

  it("🔴 traço e preenchimento NÃO caem no mesmo ponto quando as bases diferem", () => {
    // O caso que nomeia o defeito em vez do conserto. Mutação que morre:
    // desenhar `pctProjetado` no preenchimento — traço e barra voltariam a
    // coincidir, que é exatamente o estado de 20/09 pela manhã na base `proj`.
    const doc = parse(<CandidateResultRow {...BASE} />);

    const larguraDoFill = estilo(preenchimentos(doc)[0] ?? null).match(/width:([\d.]+)%/)?.[1];
    const posicaoDoTraco = estilo(marcadorDaBase(doc, "proj")).match(/left:min\(([\d.]+)%/)?.[1];

    expect(larguraDoFill).toBe("8.4");
    expect(posicaoDoTraco).toBe("9.1");
    expect(larguraDoFill).not.toBe(posicaoDoTraco);
  });

  it("o traço nasce sem `display` inline — quem o esconde é a cascata", () => {
    // Mutação que morre: trocar `data-view-only="proj"` por `"parcial"`, ou
    // cravar `display` no `style`. A cascata do shell (`app/globals.css`,
    // `[data-view-only] { display: none }` + `:root[data-view=X]
    // [data-view-only=X] { display: revert }`) é o ÚNICO mecanismo que decide
    // quando o traço aparece; um `display` inline venceria a cascata e
    // congelaria a linha numa base só.
    const doc = parse(<CandidateResultRow {...BASE} />);

    expect(marcadores(doc).map((m) => m.getAttribute("data-view-only"))).toEqual(["proj"]);
    expect(estilo(marcadores(doc)[0] ?? null)).not.toContain("display:none");
  });
});

/**
 * 🔴 2026-09-20 — o traço some quando a PROJEÇÃO vale zero.
 *
 * A regra dos TRÊS ESTADOS (não começou / não sabemos / apurando), escrita
 * pelo dono, proíbe fabricar zeros de resgate. Um traço colado na borda
 * esquerda **afirma "0%"**, e o componente não sabe em qual dos três estados
 * está: `pctProjetado` é um `number` obrigatório, sem `null`. Então a
 * afirmação geométrica sai, e só ela — o `0,0%` continua na coluna de texto,
 * porque ali é um número exibido e não uma posição na barra.
 *
 * ⚠️ **A guarda mudou de alvo na 2ª rodada de 20/09.** Ela olhava a base
 * OPOSTA à ativa — duas condições, uma por traço. Agora há um traço só e ele
 * marca sempre a projeção, então a condição é uma: `projetado > 0`, depois do
 * clamp (o que cobre `NaN`, que clampa para 0 e é literalmente "não sabemos").
 *
 * A consequência mais visível está no primeiro caso abaixo, e ela INVERTEU:
 * no começo da noite `atual` é 0 e `projetado` não é — antes isso apagava o
 * traço da base `proj`; agora o traço continua, porque o número que ele marca
 * é real.
 */
/**
 * 🔴 2026-09-20 (2ª rodada) — o vão fantasma da faixa colapsada.
 *
 * Quando a coluna da projeção passou a sair do DOM na visão Parcial, a 4ª
 * faixa da grade da linha ficou sem item. `display: none` tira o item da
 * grade e a faixa `auto` colapsa para 0px — **mas o `column-gap` antes dela
 * continua ocupando espaço**. A barra é `grid-column: 2 / -1` e vai até a
 * borda direita; o número parcial parava um vão antes dela.
 *
 * Medido no Chrome em 2026-09-20, numa reprodução isolada da grade com 600px
 * de largura:
 *
 * | visão | faixas computadas | direita do nº | direita da barra | vão |
 * |---|---|---|---|---|
 * | Projeção (4 colunas) | `24px 458.46px 39.76px 41.78px` | 600 | 600 | **0** |
 * | Parcial, sem conserto | `24px 500.24px 39.76px 0px` | 588 | 600 | **12** |
 * | Parcial, com conserto | `24px 512.24px 39.76px` | 600 | 600 | **0** |
 *
 * ⚠️ **Nenhum caso aqui mede pixel**, pela mesma razão do bloco do recorte:
 * `getBoundingClientRect()` devolve zero no happy-dom. O que estes casos
 * travam é o MECANISMO que torna o conserto possível — a custom property no
 * componente e a regra que a sobrescreve no CSS. Se qualquer um dos dois
 * sumir, o vão volta e nada mais reprova.
 */
describe("a grade da linha perde a 4ª faixa na visão Parcial", () => {
  const GLOBALS = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

  it("🔴 o template vem de `--linha-faixas`, com as QUATRO faixas como fallback", () => {
    // Mutação que morre: cravar o template direto no `style` de novo. Regra de
    // folha de estilo perde para `style` inline, então a cascata deixaria de
    // conseguir trocar as faixas e o conserto viraria letra morta — sem que
    // nenhum outro teste percebesse.
    const doc = parse(<CandidateResultRow {...BASE} />);
    const linha = doc.querySelector('[data-testid="candidate-result-row"]');

    // Atributo CRU, não `estilo()`: aquele helper remove todo espaço em branco
    // e transformaria o template em "1.5remminmax(0,1fr)autoauto", ilegível e
    // fácil de escrever errado sem perceber.
    expect(linha?.getAttribute("style")).toContain(
      "grid-template-columns:var(--linha-faixas, 1.5rem minmax(0, 1fr) auto auto)",
    );
    // O gancho que a regra do CSS usa para mirar a linha.
    expect(linha?.hasAttribute("data-result-row")).toBe(true);
  });

  it("🔴 `app/globals.css` troca as faixas na visão Parcial — e só nela", () => {
    // Mutação que morre: apagar a regra, ou trocar o seletor para
    // `[data-view="proj"]`, que inverteria o conserto e criaria o vão
    // justamente na visão que tem as duas colunas.
    const regra = GLOBALS.match(/:root\[data-view="parcial"\]\s*\[data-result-row\]\s*\{([^}]*)\}/);
    expect(regra, "a regra do vão fantasma sumiu de app/globals.css").not.toBeNull();

    const corpo = (regra?.[1] ?? "").replace(/\s+/g, " ").trim();
    expect(corpo).toContain("--linha-faixas");
    // TRÊS faixas, não quatro: é a 4ª que precisa sair.
    expect(corpo).toContain("1.5rem minmax(0, 1fr) auto");
    expect(corpo).not.toContain("auto auto");

    // E não existe regra equivalente para a visão de projeção — lá as quatro
    // faixas são o certo, e o fallback já as entrega.
    expect(GLOBALS).not.toMatch(/:root\[data-view="proj"\]\s*\[data-result-row\]/);
  });
});

describe("traço com projeção zerada", () => {
  it("🔴 início da noite: `atual = 0` mas `projetado = 35,8` — o traço CONTINUA", () => {
    // 🔴 Este caso afirma o OPOSTO do que afirmava até a 2ª rodada de 20/09,
    // e a inversão é o ponto: o traço marca a projeção, e 35,8 é informação
    // real. Mutação que morre: manter a guarda em `atual`.
    const doc = parse(<CandidateResultRow {...BASE} pctAtual={0} pctProjetado={35.8} votos={0} />);

    expect(marcadorDaBase(doc, "proj")).not.toBeNull();
    expect(estilo(marcadorDaBase(doc, "proj"))).toContain("left:min(35.8%,");
    // O preenchimento é o apurado, e ele é zero — trilho vazio, estado "ainda
    // não". O número zero não some da tela; o que não existe é largura.
    expect(preenchimentos(doc)[0]?.getAttribute("style")).toContain("width:0%");
    expect(doc.body.textContent).toContain("0,0%");
  });

  it("🔴 `projetado = 0` apaga o traço — a guarda é essa", () => {
    // Mutação que morre: trocar o `> 0` por `>= 0`, ou remover a guarda.
    const doc = parse(<CandidateResultRow {...BASE} pctAtual={12.3} pctProjetado={0} />);

    expect(marcadores(doc)).toHaveLength(0);
    // E o preenchimento do apurado continua lá, com os 12,3 que são reais.
    expect(preenchimentos(doc)[0]?.getAttribute("style")).toContain("width:12.3%");
  });

  it("`NaN` — 'não sabemos' — também não vira traço na borda esquerda", () => {
    // `clampPct` manda `NaN` para 0, e desenhar o traço ali seria o componente
    // afirmando um valor medido a partir de um valor ausente.
    const doc = parse(<CandidateResultRow {...BASE} pctProjetado={Number.NaN} />);
    expect(marcadores(doc)).toHaveLength(0);
  });

  it("ambas zeradas: nenhum traço, e a barra continua inteira", () => {
    const doc = parse(<CandidateResultRow {...BASE} pctAtual={0} pctProjetado={0} />);

    expect(marcadores(doc)).toHaveLength(0);
    // A barra e o recorte não dependem do traço para existir — a linha continua
    // desenhando o trilho vazio, que é o estado "ainda não".
    expect(doc.querySelector('[data-testid="result-bar"]')).not.toBeNull();
    expect(preenchimentos(doc)).toHaveLength(1);
  });

  it("uma projeção pequena mas real CONTINUA ganhando traço — a guarda é só o zero", () => {
    // Guarda contra a correção exagerada: um limiar (`> 0.5`, digamos) apagaria
    // o traço de candidaturas pequenas de verdade, que é informação legítima.
    const doc = parse(<CandidateResultRow {...BASE} pctAtual={0.04} pctProjetado={0.2} />);

    expect(marcadorDaBase(doc, "proj")).not.toBeNull();
    expect(estilo(marcadorDaBase(doc, "proj"))).toContain("left:min(0.2%,");
  });
});
