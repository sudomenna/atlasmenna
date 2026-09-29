// @vitest-environment happy-dom
/**
 * tests/unit/components/SenadoHemiciclo.test.tsx — spec 023, RF-216 e RF-218.
 *
 * O hemiciclo de 81 cadeiras: contagem, pintura dos quatro estados, texto
 * (legenda, lista, data da foto, nota do suplente), acessibilidade, as fases e
 * a recusa com log. Foto FICTÍCIA (`tests/fixtures/senado/`), exceto onde o
 * caso diz "sem partido".
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CINZA_SEM_PARTIDO,
  LOG_TAG_SENADO_2027,
  SenadoHemiciclo,
  SenadoHemicicloPanel,
} from "@/components/blocks/SenadoHemiciclo";
import type { EdgePayload } from "@/lib/edge-config/types";
import { validarMandato2031 } from "@/lib/senado/mandato-2031";
import { textForParty } from "@/lib/utils/party-color";
import { derivarSenado2027, type Senado2027 } from "@/lib/utils/senado-2027";
import mandatoFixture from "@/tests/fixtures/senado/mandato-2031.fixture.json" with {
  type: "json",
};
import { mandatoDeTeste, payloadTresUfs } from "@/tests/fixtures/senado/payload-senado";

function parse(markup: string): Document {
  return new DOMParser().parseFromString(markup, "text/html");
}

function senado(payload: EdgePayload | null, mandato = mandatoDeTeste()): Senado2027 {
  const r = derivarSenado2027(payload, mandato);
  if (!r.ok) throw new Error(`recusado: ${r.motivo}`);
  return r.senado;
}

function render(s: Senado2027): { markup: string; doc: Document } {
  const markup = renderToStaticMarkup(<SenadoHemiciclo senado={s} />);
  return { markup, doc: parse(markup) };
}

const circulos = (doc: Document, seletor = "svg") =>
  doc.querySelectorAll(`${seletor} circle`).length;

function comSemPartido() {
  const foto = structuredClone(mandatoFixture) as { senadores: Array<Record<string, unknown>> };
  (foto.senadores.find((s) => s.uf === "RJ") as Record<string, unknown>).partido = "S/Partido";
  return validarMandato2031(foto);
}

afterEach(() => vi.restoreAllMocks());

describe("SenadoHemiciclo — 81 bolinhas, quatro estados (RF-216)", () => {
  it("desenha exatamente 81 cadeiras no SVG do plenário, em 5 arcos", () => {
    const { doc } = render(senado(payloadTresUfs()));
    const svg = doc.querySelector("[data-testid='senado-hemiciclo-figura'] svg");
    expect(svg?.getAttribute("data-total")).toBe("81");
    expect(svg?.getAttribute("data-arcos")).toBe("5");
    expect(circulos(doc, "[data-testid='senado-hemiciclo-figura'] > svg")).toBe(81);
  });

  it("cada estado tem as cadeiras que a derivação deu", () => {
    const { doc } = render(senado(payloadTresUfs()));
    const n = (estado: string) => circulos(doc, `svg g[data-estado="${estado}"]`);
    expect(n("continua_2031")).toBe(27);
    expect(n("decidida")).toBe(2);
    expect(n("projetada")).toBe(4);
    expect(n("aguardando")).toBe(48);
  });

  it("pintura: cheia na cor `-text` do partido; anel na projetada; cinza com anel neutro na aguardando", () => {
    const { doc } = render(senado(payloadTresUfs()));
    const g = (estado: string, partido?: string) =>
      doc.querySelector(
        `svg g[data-estado="${estado}"]${partido ? `[data-partido="${partido}"]` : ""}`,
      );
    expect(g("continua_2031", "PL")?.getAttribute("fill")).toBe(textForParty("PL"));
    expect(g("decidida", "PSD")?.getAttribute("fill")).toBe(textForParty("PSD"));
    expect(g("projetada", "PL")?.getAttribute("fill")).toBe("var(--surface-sunken)");
    expect(g("projetada", "PL")?.getAttribute("stroke")).toBe(textForParty("PL"));
    expect(g("aguardando")?.getAttribute("fill")).toBe("var(--surface-sunken)");
    expect(g("aguardando")?.getAttribute("stroke")).toBe("var(--text-secondary)");
  });

  it("nenhum token de cor-BASE de partido (RNF-035: bolinha é identidade ⇒ `-text`)", () => {
    const { doc } = render(senado(payloadTresUfs()));
    const svg = doc.querySelector("[data-testid='senado-hemiciclo-figura'] svg")?.outerHTML ?? "";
    expect(svg).not.toMatch(/var\(--party-[a-z0-9]+\)/);
    expect(svg).not.toContain("--color-cand-");
  });

  it("sem partido: cinza CHEIO, rótulo 'Sem partido' — nunca a cor do PL nem a de 'outros'", () => {
    const { doc, markup } = render(senado(payloadTresUfs(), comSemPartido()));
    const g = doc.querySelector('svg g[data-partido="Sem partido"]');
    expect(g?.getAttribute("fill")).toBe(CINZA_SEM_PARTIDO);
    expect(g?.getAttribute("stroke")).toBe(CINZA_SEM_PARTIDO);
    expect(g?.querySelectorAll("circle")).toHaveLength(1);
    expect(markup).not.toContain("--party-outros");
    const lista = doc.querySelector("[data-testid='senado-hemiciclo-lista']")?.textContent ?? "";
    expect(lista).toContain("Sem partido 1 — 1 até 2031");
    expect(lista).toContain("PL 10 — 8 até 2031 + 2 em 2026 (projeção)");
    const legenda = doc.querySelector(
      '[data-testid="senado-hemiciclo-estado"][data-estado="sem_partido"]',
    );
    expect(legenda?.textContent).toMatch(/^1 .*sem partido/);
  });

  it("o `<desc>` diz que a ordem é por tamanho e não é posição ideológica", () => {
    const { doc } = render(senado(payloadTresUfs()));
    const desc = doc.querySelector("svg desc")?.textContent ?? "";
    expect(desc).toContain("27 cadeiras com mandato até 2031, que não estão em disputa");
    expect(desc).toContain("não representa posição ideológica");
  });

  it("sem marcador de limiar nem rótulo no desenho da visão por partido (ADR-0061 item 4)", () => {
    const { doc } = render(senado(payloadTresUfs()));
    const svg = doc.querySelector("[data-testid='senado-hemiciclo-figura'] > svg");
    expect(svg?.querySelectorAll("text, line, rect, path")).toHaveLength(0);
  });
});

describe("texto e acessibilidade (RF-218)", () => {
  it("role=img, <title> ligado, e aria-describedby com o <desc> E a lista textual — que existe", () => {
    const { doc } = render(senado(payloadTresUfs()));
    const svg = doc.querySelector("[data-testid='senado-hemiciclo-figura'] svg");
    expect(svg?.getAttribute("role")).toBe("img");
    const titulo = doc.getElementById(svg?.getAttribute("aria-labelledby") ?? "");
    expect(titulo?.tagName.toLowerCase()).toBe("title");
    expect(titulo?.textContent).toContain("81 cadeiras");
    const ids = (svg?.getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids).toHaveLength(2);
    expect(doc.getElementById(ids[0] as string)?.tagName.toLowerCase()).toBe("desc");
    const lista = doc.getElementById(ids[1] as string);
    expect(lista?.getAttribute("data-testid")).toBe("senado-hemiciclo-lista");
  });

  it("a lista tem um item por partido, na ordem das cunhas, no formato combinado", () => {
    const s = senado(payloadTresUfs());
    const { doc } = render(s);
    const itens = [
      ...doc.querySelectorAll("[data-testid='senado-hemiciclo-lista'] li[data-partido]"),
    ];
    expect(itens.map((li) => li.getAttribute("data-partido"))).toEqual(
      s.partidos.map((p) => p.sigla),
    );
    expect(itens[0]?.textContent).toBe("PL 11 — 9 até 2031 + 2 em 2026 (projeção)");
    // A ordem das cunhas no desenho é a mesma da lista.
    const cunhas: string[] = [];
    for (const g of doc.querySelectorAll("svg g[data-partido]")) {
      const p = g.getAttribute("data-partido") as string;
      if (cunhas[cunhas.length - 1] !== p) cunhas.push(p);
    }
    expect(cunhas).toEqual(s.partidos.map((p) => p.sigla));
    expect(
      doc.querySelector("[data-testid='senado-hemiciclo-lista-aguardando']")?.textContent,
    ).toBe("Aguardando apuração: 48 vagas em disputa");
  });

  it("a legenda nomeia os quatro estados, com as contagens", () => {
    const { doc } = render(senado(payloadTresUfs()));
    const itens = [...doc.querySelectorAll("[data-testid='senado-hemiciclo-estado']")];
    expect(itens.map((li) => li.getAttribute("data-estado"))).toEqual([
      "continua_2031",
      "decidida",
      "projetada",
      "aguardando",
    ]);
    expect(itens.map((li) => li.querySelector("strong")?.textContent)).toEqual([
      "27",
      "2",
      "4",
      "48",
    ]);
    expect(itens[0]?.textContent).toContain("mandato até 2031 — não estão em disputa");
  });

  it("a data da foto do Senado e a nota do suplente estão visíveis", () => {
    const { doc } = render(senado(payloadTresUfs()));
    const foto = doc.querySelector("[data-testid='senado-hemiciclo-foto']")?.textContent ?? "";
    expect(foto).toContain("Composição dos 27 mandatos até 2031 conforme o Senado em 29/09/2026");
    expect(foto).toMatch(/partido atual de quem a ocupa hoje, suplente em exercício incluído/);
    expect(foto).toContain("Senado Federal — Dados Abertos");
  });

  // 🔴 MUTAÇÃO: rotular a cadeira que continua como "eleitos em 2022" (a frase
  // que a composição das 54 usa) — a varredura pega em qualquer fase.
  it("🔴 nenhuma palavra da raiz 'eleit' no bloco, em fase nenhuma", () => {
    for (const s of [
      senado(payloadTresUfs()),
      senado(payloadTresUfs({ fase: "pre_eleicao" })),
      senado(null),
      senado(payloadTresUfs(), comSemPartido()),
    ]) {
      expect(render(s).markup, s.fase).not.toMatch(/eleit/i);
    }
  });

  it("375 px: nada de largura fixa — SVG fluido e listas que quebram linha", () => {
    const { doc, markup } = render(senado(payloadTresUfs()));
    const svg = doc.querySelector("[data-testid='senado-hemiciclo-figura'] > svg");
    expect(svg?.getAttribute("class")).toBe("w-full h-auto");
    expect(svg?.getAttribute("width")).toBeNull();
    expect(svg?.getAttribute("viewBox")).toMatch(/^0 0 [\d.]+ [\d.]+$/);
    expect(
      doc.querySelector("[data-testid='senado-hemiciclo-lista']")?.getAttribute("class"),
    ).toContain("flex-wrap");
    // Nenhuma largura em px no bloco (as amostras da legenda têm 10 px, em atributo SVG).
    expect(markup).not.toMatch(/(?:^|[;"\s])(?:min-)?width:\s*\d+px/);
  });
});

describe("fase pré-eleição (spec 019, RF-161)", () => {
  const s = () => senado(payloadTresUfs({ fase: "pre_eleicao" }));

  it("27 cheias + 54 cinzas; a legenda só nomeia os dois estados presentes", () => {
    const { doc } = render(s());
    expect(circulos(doc, 'svg g[data-estado="continua_2031"]')).toBe(27);
    expect(circulos(doc, 'svg g[data-estado="aguardando"]')).toBe(54);
    const estados = [...doc.querySelectorAll("[data-testid='senado-hemiciclo-estado']")].map((li) =>
      li.getAttribute("data-estado"),
    );
    expect(estados).toEqual(["continua_2031", "aguardando"]);
  });

  it("nenhuma palavra da lista negra do RF-161 no bloco", () => {
    const texto = render(s()).markup.toLowerCase();
    for (const palavra of [
      "projec",
      "projeç",
      "apurado",
      "apuradas",
      "boletim",
      "chance de",
      "intervalo de confiança",
      "/27",
    ]) {
      expect(texto, palavra).not.toContain(palavra);
    }
  });
});

describe("SenadoHemicicloPanel — o painel da página, com a recusa (RF-217)", () => {
  it("aceito: painel com h2 'As 81 cadeiras' e o hemiciclo dentro", () => {
    const doc = parse(
      renderToStaticMarkup(
        <SenadoHemicicloPanel payload={payloadTresUfs()} mandato={mandatoDeTeste()} />,
      ),
    );
    expect(doc.querySelector("h2")?.textContent).toBe("As 81 cadeiras");
    expect(doc.querySelector("[data-testid='panel-kicker']")?.textContent).toContain("não oficial");
    expect(doc.querySelector("[data-testid='senado-hemiciclo']")).not.toBeNull();
  });

  // 🔴 MUTAÇÃO: desenhar mesmo com `ok: false` (ou sem o `console.warn`) — o
  // painel apareceria com números que contradizem a barra das 54.
  it("recusado: não renderiza NADA e loga uma linha com a etiqueta e o motivo", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = payloadTresUfs();
    (p.composicao_vagas as NonNullable<EdgePayload["composicao_vagas"]>).por_partido = [
      { partido: "PL", vagas: 6 },
    ];
    const markup = renderToStaticMarkup(
      <SenadoHemicicloPanel payload={p} mandato={mandatoDeTeste()} />,
    );
    expect(markup).toBe("");
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso.mock.calls[0]?.[0]).toMatch(
      new RegExp(`^\\${LOG_TAG_SENADO_2027} hemiciclo não desenhado: divergencia_composicao — `),
    );
  });

  it("fase pré: kicker sem 'não oficial' e texto sem vocabulário de medição", () => {
    const markup = renderToStaticMarkup(
      <SenadoHemicicloPanel
        payload={payloadTresUfs({ fase: "pre_eleicao" })}
        mandato={mandatoDeTeste()}
      />,
    );
    expect(markup.toLowerCase()).not.toContain("projeç");
    expect(parse(markup).querySelector("[data-testid='panel-kicker']")?.textContent).toBe(
      "Senado de 2027",
    );
  });
});
