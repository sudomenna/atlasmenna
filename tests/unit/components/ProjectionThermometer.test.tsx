// @vitest-environment happy-dom
/**
 * tests/unit/components/ProjectionThermometer.test.tsx
 *
 * Unit tests do `<ProjectionThermometer />` — átomo do hero de 1º turno
 * (S07/Fase 2). Cobre a11y do meter, geometria da faixa de IC, marcador do
 * apurado, rótulo do denominador e fallback de cor por rank (ADR-0013).
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectionThermometer } from "@/components/atoms/bars/ProjectionThermometer";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

/** Props mínimas válidas — cada teste sobrescreve o que interessa. */
function render(over: Partial<React.ComponentProps<typeof ProjectionThermometer>> = {}) {
  return parse(
    <ProjectionThermometer
      id="t-abstencao"
      titulo="Abstenção"
      base="eleitores_instalados"
      cor="var(--color-part-abstencao)"
      corBand="var(--color-part-abstencao-band)"
      pctProjetado={21.4}
      pctLower={19.8}
      pctUpper={23.0}
      pctAtual={20.1}
      {...over}
    />,
  );
}

/** Segmento do `<VoteBar>` que desenha a faixa de IC95. */
function band(doc: Document): Element | null {
  return doc.querySelector('[data-label="intervalo de confiança 95%"]');
}

/** Segmento transparente que desloca a faixa até o limite inferior do IC. */
function offset(doc: Document): Element | null {
  return doc.querySelector('[data-label="antes do intervalo"]');
}

describe("<ProjectionThermometer />", () => {
  it("(a) expõe role=meter com aria-valuemax = scaleMax e aria-valuenow arredondado", () => {
    const doc = render({ scaleMax: 60, pctProjetado: 43.2 });
    const meter = doc.querySelector('[role="meter"]');
    expect(meter).not.toBeNull();
    expect(meter?.getAttribute("aria-valuemin")).toBe("0");
    expect(meter?.getAttribute("aria-valuemax")).toBe("60");
    expect(meter?.getAttribute("aria-valuenow")).toBe("43");
    // aria-label completo: valor + base + IC + apurado
    const label = meter?.getAttribute("aria-label") ?? "";
    expect(label).toContain("Abstenção");
    expect(label).toContain("dos eleitores das seções instaladas");
    expect(label).toContain("intervalo de");
    expect(label).toContain("apurado");
  });

  it("(b) posiciona a faixa lower→upper em % de scaleMax", () => {
    // O trilho passou a ser um `<VoteBar>` (ADR-0029 § 6): a faixa de IC é um
    // segmento, precedido por um segmento transparente que faz o deslocamento.
    // A geometria é a mesma de antes — o que muda é como ela é expressa.
    //
    // scaleMax 60: lower 12 → offset 20%; upper 24 → largura (24-12)/60 = 20%
    const doc = render({ scaleMax: 60, pctProjetado: 18, pctLower: 12, pctUpper: 24 });
    expect(offset(doc)?.getAttribute("style") ?? "").toContain("width:20%");
    expect(band(doc)?.getAttribute("style") ?? "").toContain("width:20%");
    // tick do projetado: 18/60 = 30%
    const tick = doc.querySelector('[data-testid="thermometer-tick"]');
    expect(tick?.getAttribute("style") ?? "").toContain("left:30%");
  });

  it("(b2) o trilho é o `<VoteBar>` do kit, e o `meter` é quem fala (ADR-0029 § 6)", () => {
    // Este teste existe para travar o restyle: se alguém reintroduzir um
    // trilho próprio com `rounded-sm border`, o rail chapado do kit
    // (`--surface-sunken`, sem borda) some junto — e ninguém percebe, porque
    // a geometria continua correta.
    const doc = render();
    const meter = doc.querySelector('[role="meter"]');
    const vb = doc.querySelector('[data-testid="vote-bar"]');

    expect(vb).not.toBeNull();
    // O `<VoteBar>` se anuncia como role="img". Dois nomes acessíveis para o
    // mesmo trilho seriam anúncio duplicado, então ele entra sob aria-hidden
    // e quem carrega valor/escala/IC/apurado é o `meter`.
    expect(vb?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(meter?.contains(vb ?? null)).toBe(true);
    // Rail chapado: nenhuma borda declarada no contêiner do meter.
    expect(meter?.getAttribute("style") ?? "").not.toContain("border");
  });

  it("(b3) renderiza o par Parcial/Projeção sob `data-view-only`, sem JS (ADR-0029 § 2)", () => {
    const doc = render({ pctProjetado: 21.4, pctAtual: 20.1 });

    const proj = doc.querySelector('[data-testid="thermometer-numero"]');
    const parcial = doc.querySelector('[data-testid="thermometer-numero-parcial"]');

    // Os DOIS existem no HTML do servidor: quem escolhe é a cascata a partir
    // de `data-view` no <html>, escrita pelo <ViewModeSwitch> do shell.
    expect(proj?.getAttribute("data-view-only")).toBe("proj");
    expect(parcial?.getAttribute("data-view-only")).toBe("parcial");
    expect(proj?.textContent).toContain("21,4%");
    expect(parcial?.textContent).toContain("20,1%");

    // `data-view-only` NUNCA pode cair no <Figure>: ele escreve `display:grid`
    // inline, e inline vence folha de autor — a regra `display: none` de
    // globals.css seria ignorada e os dois números apareceriam juntos.
    for (const el of [proj, parcial]) {
      expect(el?.querySelector("[data-testid='figure']")?.hasAttribute("data-view-only")).toBe(
        false,
      );
    }

    // O algarismo é mono, do kit — não mais serifa (ADR-0029 § 6).
    const valor = proj?.querySelector("[data-testid='figure-value']");
    expect(valor?.getAttribute("style") ?? "").toContain("var(--type-figure");

    // Sem apuração ainda, o lado "Parcial" mostra travessão em vez de 0,0%:
    // zero apurado e ausência de apuração não são a mesma afirmação.
    const semApuracao = render({ pctAtual: null });
    expect(
      semApuracao.querySelector('[data-testid="thermometer-numero-parcial"]')?.textContent,
    ).toContain("—");
  });

  it("(c) pctAtual null → sem marcador de apurado e rodapé 'sem apuração'", () => {
    const doc = render({ pctAtual: null });
    expect(doc.querySelector('[data-testid="thermometer-apurado"]')).toBeNull();
    expect(doc.body.textContent ?? "").toContain("sem apuração");

    const comApurado = render({ pctAtual: 20.1 });
    expect(comApurado.querySelector('[data-testid="thermometer-apurado"]')).not.toBeNull();
    expect(comApurado.body.textContent ?? "").toContain("apurado 20,1%");
  });

  it("(d) rotula o denominador conforme a base", () => {
    const votaveis = render({ base: "votaveis" });
    expect(votaveis.body.textContent ?? "").toContain("% dos votos a votáveis");
    // Nunca "% dos válidos": pvap do TSE é sobre votos a votáveis concorrentes.
    expect(votaveis.body.textContent ?? "").not.toContain("% dos válidos");

    const comparecimento = render({ base: "comparecimento" });
    expect(comparecimento.body.textContent ?? "").toContain("% do comparecimento");

    const instalados = render({ base: "eleitores_instalados" });
    expect(instalados.body.textContent ?? "").toContain("% dos eleitores das seções instaladas");
  });

  // 🔴 2026-09-20 — este caso testava o CONTRÁRIO até hoje. Chamava-se "sem
  // `cor`, deriva a cor do rank (ADR-0013)" e exigia `--color-cand-3` no tick
  // e `--color-cand-band-3` na faixa. Invertido.
  it("(e) sem `cor`, tick e faixa saem da SIGLA — nunca da colocação", () => {
    const doc = render({ cor: undefined, corBand: undefined, rank: 3, partido: "MDB" });
    const tick = doc.querySelector('[data-testid="thermometer-tick"]');
    expect(tick?.getAttribute("style") ?? "").toContain("var(--party-mdb)");
    // A faixa é o degrau 1 da rampa do PRÓPRIO partido — mesma matiz.
    expect(band(doc)?.getAttribute("style") ?? "").toContain("var(--party-mdb-1)");
    expect(`${tick?.getAttribute("style")}${band(doc)?.getAttribute("style")}`).not.toContain(
      "--color-cand-",
    );

    // Sem cor e sem sigla → token de `outros`, nunca hex partidário
    // (constituição § 2) e nunca a cor de uma posição.
    const semSigla = render({ cor: undefined, corBand: undefined });
    const tickNeutro = semSigla.querySelector('[data-testid="thermometer-tick"]');
    expect(tickNeutro?.getAttribute("style") ?? "").toContain("var(--party-outros)");
  });

  // O caso que DISCRIMINA: um termômetro tem TRÊS superfícies coloridas — o
  // tick (projeção), a faixa (IC95) e o número grande —, e até 2026-09-20 elas
  // vinham de três cadeias diferentes quando o caller passava `rank` e não
  // passava `partido`: tick pela sigla, faixa por `bandForRank`, número por
  // `strongForRank`. Mesma pessoa, três tintas, no mesmo widget.
  it("(e1) as três superfícies do mesmo termômetro concordam na sigla", () => {
    const doc = render({ cor: undefined, corBand: undefined, rank: 3, partido: "PSOL" });
    const estilo = (sel: string) => doc.querySelector(sel)?.getAttribute("style") ?? "";
    expect(estilo('[data-testid="thermometer-tick"]')).toContain("var(--party-psol)");
    expect(band(doc)?.getAttribute("style") ?? "").toContain("var(--party-psol-1)");
    // O número é TEXTO e, desde 2026-10-03 (decisão do dono), não leva cor de
    // partido nenhuma. Desde 2026-10-04 o da Projeção sai na cor da projeção
    // (`--color-pct-proj`) e o da Parcial na cor única `--color-pct-votos`. A
    // identidade fica no tick e na faixa; o número não traz uma terceira tinta.
    expect(estilo('[data-testid="thermometer-numero"]')).toContain("var(--color-pct-proj)");
    expect(estilo('[data-testid="thermometer-numero-parcial"]')).toContain(
      "var(--color-pct-votos)",
    );
    expect(estilo('[data-testid="thermometer-numero-parcial"]')).not.toContain("--party-");
    expect(estilo('[data-testid="thermometer-numero"]')).not.toContain("--party-");
  });

  it("(e1b) a MESMA sigla em colocações diferentes recebe as MESMAS três cores", () => {
    const retrato = (rank: number | undefined) => {
      const doc = render({ cor: undefined, corBand: undefined, rank, partido: "PSD" });
      return [
        doc.querySelector('[data-testid="thermometer-tick"]')?.getAttribute("style"),
        band(doc)?.getAttribute("style"),
        doc.querySelector('[data-testid="thermometer-numero"]')?.getAttribute("style"),
      ].join("|");
    };
    expect(new Set([1, 2, 3, 7, undefined].map(retrato)).size).toBe(1);
  });

  it("(e2) o número NUNCA usa a cor de preenchimento, nem quando só `cor` vem", () => {
    // Este é o defeito que o axe-core pegou na home em 2026-09-07 (violação
    // `serious`, desktop e mobile): o número grande saía pintado com `cor`, a
    // cor de PREENCHIMENTO do candidato. Em rank 3 isso é `--color-cand-3`
    // (#c97c1f) sobre `--surface-page` (#f3f4f6) = 2,99:1 — abaixo até do piso
    // de 3:1 de texto grande, e muito abaixo dos 4,5:1 do § 4.
    //
    // As três formas de um caller chegar aqui, todas cobertas:
    //   1. `cor` + `rank` (o caminho de <ProjectionThermometers />);
    //   2. só `cor`, no formato do payload (`EdgeCandidate.cor`);
    //   3. nem `cor` nem `rank`.
    const numero = (doc: Document) =>
      doc.querySelector('[data-testid="thermometer-numero"]')?.getAttribute("style") ?? "";

    // 🔴 2026-09-20 — as três formas continuam cobertas, mas o destino mudou:
    // era `strongForRank(rank)` (a paleta por COLOCAÇÃO na variante escura),
    // passou a `textForParty(sigla)` e, desde 2026-10-03 (decisão do dono), é a
    // cor ÚNICA `--color-pct-votos` para todo percentual de votos.
    // Emenda de 2026-10-04: o da Projeção (este) sai em `--color-pct-proj`.
    const comSigla = render({ cor: "var(--party-mdb)", corBand: undefined, partido: "MDB" });
    expect(numero(comSigla)).toContain("var(--color-pct-proj)");
    expect(numero(comSigla)).not.toContain("--party-mdb");

    // Passar `rank` não muda mais nada — nem aqui, nem em lugar nenhum.
    const comRank = render({
      cor: "var(--party-mdb)",
      corBand: undefined,
      partido: "MDB",
      rank: 3,
    });
    expect(numero(comRank)).toBe(numero(comSigla));

    // Sem nada: a mesma cor única — sigla nenhuma não muda a tinta.
    const semNada = render({ cor: undefined, corBand: undefined });
    expect(numero(semNada)).toContain("var(--color-pct-proj)");

    // O preenchimento continua sendo `cor` — a correção é no texto, não na
    // identidade visual da faixa/tick.
    expect(
      comSigla.querySelector('[data-testid="thermometer-tick"]')?.getAttribute("style"),
    ).toContain("var(--party-mdb)");
  });

  it("(e3) o caso do axe, hoje: sem `cor` no payload, o número sai na cor única, não na base", () => {
    // `--color-cand-3` (#c97c1f) media 2,99:1 sobre `--surface-page` e era o
    // caso concreto que o axe reprovou. O sucessor pela sigla tem o mesmo
    // risco se alguém usar a base como tinta. Desde 2026-10-03 o número sai em
    // `--color-pct-votos` (= `--text-primary`, ≥ 15:1), igual para toda sigla.
    const doc = render({
      cor: undefined,
      corBand: undefined,
      partido: "PSOL",
      pctProjetado: 4.5,
    });
    const style =
      doc.querySelector('[data-testid="thermometer-numero"]')?.getAttribute("style") ?? "";
    // Desde 2026-10-04 o número da Projeção sai em `--color-pct-proj` (ocre).
    expect(style).toContain("var(--color-pct-proj)");
    // E NÃO a base: `--party-psol` (#d6a400) mede 2,08:1 como tinta.
    expect(style).not.toContain("color:var(--party-psol)");
    expect(doc.body.textContent ?? "").toContain("4,5%");
  });

  it("(e4) corTexto explícito vence NA PARCIAL; sem ele, a cor única — igual para partidos diferentes", () => {
    const explicito = render({
      cor: "var(--party-pl)",
      rank: 2,
      corTexto: "var(--color-text)",
    });
    // 🔴 2026-10-04 (dono): `corTexto` só pinta o número da Parcial (o
    // apurado); o da Projeção é SEMPRE a cor da projeção.
    expect(
      explicito
        .querySelector('[data-testid="thermometer-numero-parcial"]')
        ?.getAttribute("style") ?? "",
    ).toContain("var(--color-text)");
    expect(
      explicito.querySelector('[data-testid="thermometer-numero"]')?.getAttribute("style") ?? "",
    ).toContain("var(--color-pct-proj)");

    // Sem corTexto, o número sai na cor ÚNICA de percentual de votos (decisão
    // do dono, 2026-10-03) — e dois partidos diferentes saem IGUAIS.
    const numeroDe = (partido: string) =>
      render({ cor: undefined, corBand: undefined, partido })
        .querySelector('[data-testid="thermometer-numero"]')
        ?.getAttribute("style") ?? "";
    expect(numeroDe("PSOL")).toContain("var(--color-pct-proj)");
    expect(numeroDe("PT")).toBe(numeroDe("PL"));
    expect(numeroDe("PT")).toBe(numeroDe("PSOL"));
  });

  it("(e5) 2026-10-04: projeção (número + IC95) na cor da projeção; apurado e aguardando não", () => {
    const doc = render({ partido: "PT", corTexto: "var(--color-part-abstencao)" });
    const estilo = (sel: string) => doc.querySelector(sel)?.getAttribute("style") ?? "";
    // Mesmo com `corTexto` (participação), o número projetado é ocre.
    expect(estilo('[data-testid="thermometer-numero"]')).toContain("var(--color-pct-proj)");
    expect(estilo('[data-testid="thermometer-numero-parcial"]')).toContain(
      "var(--color-part-abstencao)",
    );
    const ic = doc.querySelector('[data-testid="thermometer-ic"]');
    expect(ic?.textContent ?? "").toMatch(/^IC95 \[/);
    expect(ic?.getAttribute("style") ?? "").toContain("var(--color-pct-proj)");
    // O rodapé continua legível como uma frase só.
    expect(doc.body.textContent ?? "").toMatch(/IC95 \[[^\]]+\] · apurado/);

    // Aguardando: sem número, tinta apagada — nada de cor de projeção.
    const ag = render({ aguardando: true, pctAtual: null });
    expect(
      ag.querySelector('[data-testid="thermometer-numero"]')?.getAttribute("style") ?? "",
    ).toContain("var(--text-faint)");
    expect(ag.querySelector('[data-testid="thermometer-ic"]')).toBeNull();
  });

  it("(f) faz clamp de valores fora de [0, scaleMax]", () => {
    const doc = render({ scaleMax: 50, pctProjetado: 130, pctLower: -20, pctUpper: 400 });
    const meter = doc.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-valuenow")).toBe("50");
    expect(offset(doc)?.getAttribute("style") ?? "").toContain("width:0%");
    expect(band(doc)?.getAttribute("style") ?? "").toContain("width:100%");
    expect(
      doc.querySelector('[data-testid="thermometer-tick"]')?.getAttribute("style") ?? "",
    ).toContain("left:100%");
  });

  it("(g) lower === upper → sem faixa e nota 'IC indisponível'", () => {
    const doc = render({ pctProjetado: 14.3, pctLower: 14.3, pctUpper: 14.3, pctAtual: null });
    expect(band(doc)).toBeNull();
    expect(doc.body.textContent ?? "").toContain("IC indisponível");
    expect(doc.querySelector('[role="meter"]')?.getAttribute("aria-label") ?? "").toContain(
      "intervalo de confiança indisponível",
    );
  });

  it("(h) estado aguardando mantém o meter no DOM zerado (ADR-0017)", () => {
    const doc = render({ aguardando: true, pctAtual: null });
    const meter = doc.querySelector('[role="meter"]');
    expect(meter).not.toBeNull();
    expect(meter?.getAttribute("aria-valuenow")).toBe("0");
    expect(meter?.getAttribute("aria-label") ?? "").toContain("aguardando projeção");
    expect(band(doc)).toBeNull();
    expect(doc.querySelector("#t-abstencao")?.getAttribute("data-estado")).toBe("aguardando");
    expect(doc.body.textContent ?? "").toContain("aguardando projeção");
  });
});

describe("🔴 a projeção pequena sob o número da Parcial (decisão do dono, 2026-10-03)", () => {
  const ind = (doc: Document) => doc.querySelector('[data-testid="projecao-indicador"]');

  it('dentro do `<Numero view="parcial">`, nunca no da Projeção, com o MESMO projetado', () => {
    const doc = render({ pctProjetado: 21.4, pctAtual: 20.1 });
    const parcial = doc.querySelector('[data-testid="thermometer-numero-parcial"]');
    const proj = doc.querySelector('[data-testid="thermometer-numero"]');
    expect(parcial?.contains(ind(doc))).toBe(true);
    expect(proj?.querySelector('[data-testid="projecao-indicador"]')).toBeNull();
    expect(ind(doc)?.querySelector('[aria-hidden="true"]')?.textContent).toBe("↑ 21,4% proj");
    // Abaixo: a seta inverte.
    const abaixo = render({ pctProjetado: 18.2, pctAtual: 20.1 });
    expect(ind(abaixo)?.querySelector('[aria-hidden="true"]')?.textContent).toBe("↓ 18,2% proj");
  });

  it("aguardando ⇒ nenhum indicador (não há projeção para mostrar)", () => {
    expect(ind(render({ aguardando: true }))).toBeNull();
  });

  it("`indicadorProjecao={false}` (participação) ⇒ nenhum indicador", () => {
    expect(ind(render({ indicadorProjecao: false }))).toBeNull();
  });

  it("sem apuração ⇒ a projeção sai sem seta (o apurado é '—')", () => {
    const doc = render({ pctAtual: null });
    expect(ind(doc)?.querySelector('[aria-hidden="true"]')?.textContent).toBe("21,4% proj");
  });
});
