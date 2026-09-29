// @vitest-environment happy-dom
/**
 * tests/unit/components/PalanquesMapa.test.tsx
 *
 * Mapa dos palanques (V3 do plano de 29/09; etiqueta = spec 024, RF-235/237/238).
 * Server Component, zero JS: o que dá para provar é o HTML.
 *
 *   - 27 ladrilhos por base, cada um com CÓDIGO DE TEXTO (nunca só padrão/cor);
 *   - casado / dividido no ladrilho (sinal + contorno) e na lista textual;
 *   - `a_classificar` nunca aparece, em lugar nenhum;
 *   - duas bases no DOM por `data-view-only`, com dados DIFERENTES;
 *   - acessibilidade: role=img + title/desc + lista paralela por aria-describedby;
 *   - a ordem da lista é fixa (RF-238);
 *   - peso: teto no pior caso de cada campo.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  type CandidatoPalanque,
  PalanquesMapa,
  type PalanquesUf,
  type PalanqueValor,
  type PresidentePalanque,
} from "@/components/blocks/PalanquesMapa";
import { UF_LIST } from "@/lib/data/uf-hex-layout";
import { categoria } from "@/lib/etiquetas/catalogo";

import { expectOrdemInvariante } from "../etiquetas/ordem-invariante";

const LER = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const LULA: PresidentePalanque = { lider: "lula" };
const FLAVIO: PresidentePalanque = { lider: "flavio_bolsonaro" };
const OUTRO: PresidentePalanque = { lider: "outro", nome: "CAIADO" };

function cand(palanque: PalanqueValor, nome = "FULANO"): CandidatoPalanque {
  return { sqcand: "250002000010", nome, partido: "PSD", palanque };
}

function uf(
  sigla: string,
  palanque: PalanqueValor | null,
  presidente: PresidentePalanque | null,
  extra: Partial<PalanquesUf> = {},
): PalanquesUf {
  return {
    uf: sigla,
    governador: palanque ? cand(palanque) : null,
    presidente,
    ...extra,
  };
}

/** As 27 UFs com o MESMO palanque/presidente, exceto onde `sobre` disser. */
function todas(
  palanque: PalanqueValor | null,
  presidente: PresidentePalanque | null,
  sobre: Record<string, PalanquesUf> = {},
): PalanquesUf[] {
  return [...UF_LIST].map((s) => sobre[s] ?? uf(s, palanque, presidente));
}

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function montar(
  parcial: PalanquesUf[],
  projecao: PalanquesUf[],
  extra: { turno?: 1 | 2; semAviso?: boolean; id?: string } = {},
) {
  const html = renderToStaticMarkup(
    <PalanquesMapa parcial={parcial} projecao={projecao} turno={extra.turno ?? 1} {...extra} />,
  );
  return { html, d: doc(html) };
}

function secao(d: Document, base: "parcial" | "proj"): Element {
  const el = d.querySelector(`[data-view-only="${base}"]`);
  if (!el) throw new Error(`seção ${base} ausente`);
  return el;
}

function ladrilho(sec: Element, sigla: string): Element {
  const el = sec.querySelector(`g[data-uf="${sigla}"]`);
  if (!el) throw new Error(`ladrilho ${sigla} ausente`);
  return el;
}

const textoDe = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const codigoDe = (sec: Element, sigla: string) =>
  textoDe(ladrilho(sec, sigla).querySelectorAll("text")[1] as Element);

describe("estrutura — 27 ladrilhos por base, cada um com texto", () => {
  const { d } = montar(todas("palanque_lula", LULA), todas("palanque_flavio_bolsonaro", FLAVIO));

  it("duas seções (parcial, proj), cada uma com um svg de 27 polígonos", () => {
    const secoes = [...d.querySelectorAll("[data-view-only]")];
    expect(secoes.map((s) => s.getAttribute("data-view-only"))).toEqual(["parcial", "proj"]);
    for (const s of secoes) {
      expect(s.querySelectorAll("svg[role='img'] polygon")).toHaveLength(27);
      expect(
        [...s.querySelectorAll("g[data-uf]")].map((g) => g.getAttribute("data-uf")).sort(),
      ).toEqual([...UF_LIST].sort());
    }
  });

  it("todo ladrilho tem a sigla e um código de texto não vazio (nunca só padrão)", () => {
    for (const base of ["parcial", "proj"] as const) {
      const sec = secao(d, base);
      for (const g of sec.querySelectorAll("g[data-uf]")) {
        const textos = [...g.querySelectorAll("text")].map(textoDe);
        expect(textos).toHaveLength(2);
        expect(textos[0]).toBe(g.getAttribute("data-uf"));
        expect(textos[1]?.length, g.getAttribute("data-uf") ?? "").toBeGreaterThan(0);
      }
    }
  });

  it("os códigos: LU, FB, L+F, S/D, e — para o estado quieto", () => {
    const { d: dd } = montar(
      [
        uf("SP", "palanque_lula", null),
        uf("RJ", "palanque_flavio_bolsonaro", null),
        uf("MG", "palanque_duplo", null),
        uf("BA", "sem_palanque_declarado", null),
        uf("PR", "a_classificar", null),
        uf("RS", null, null),
      ],
      [],
    );
    const sec = secao(dd, "parcial");
    expect(codigoDe(sec, "SP")).toBe("LU");
    expect(codigoDe(sec, "RJ")).toBe("FB");
    expect(codigoDe(sec, "MG")).toBe("L+F");
    expect(codigoDe(sec, "BA")).toBe("S/D");
    expect(codigoDe(sec, "PR")).toBe("—");
    expect(codigoDe(sec, "RS")).toBe("—");
    // UF que nem veio na lista: também quieta, e o mapa continua com 27
    expect(codigoDe(sec, "AC")).toBe("—");
    expect(sec.querySelectorAll("g[data-uf]")).toHaveLength(27);
  });

  it("cada padrão de hachura referenciado existe no MESMO svg; quieto não tem preenchimento", () => {
    const { d: dd } = montar(
      [
        uf("SP", "palanque_lula", null),
        uf("RJ", "palanque_flavio_bolsonaro", null),
        uf("MG", "palanque_duplo", null),
        uf("BA", "sem_palanque_declarado", null),
        uf("PR", "a_classificar", null),
      ],
      [],
    );
    const sec = secao(dd, "parcial");
    const svg = sec.querySelector("svg[role='img']") as Element;
    const ids = new Set([...svg.querySelectorAll("pattern")].map((p) => p.getAttribute("id")));
    expect(ids.size).toBe(4);
    const padroes = new Set<string>();
    for (const sigla of ["SP", "RJ", "MG", "BA"]) {
      const fill = ladrilho(sec, sigla).getAttribute("fill") ?? "";
      const m = /^url\(#(.+)\)$/.exec(fill);
      expect(m, `${sigla}: ${fill}`).not.toBeNull();
      expect(ids.has(m?.[1] ?? "")).toBe(true);
      padroes.add(m?.[1] ?? "");
    }
    // quatro valores, quatro padrões distintos
    expect(padroes.size).toBe(4);
    expect(ladrilho(sec, "PR").hasAttribute("fill")).toBe(false);
    expect(ladrilho(sec, "PR").getAttribute("data-palanque")).toBe("nenhum");
  });

  it("todo valor do catálogo tem código e padrão (valor novo sem desenho acusa aqui)", () => {
    const valores = categoria("palanque_presidencial").valores.map((v) => v.id);
    const uf27 = [...UF_LIST];
    const parcial = valores.map((v, i) => uf(uf27[i] as string, v as PalanqueValor, LULA));
    const { d: dd } = montar(parcial, []);
    const sec = secao(dd, "parcial");
    for (const [i, v] of valores.entries()) {
      const g = ladrilho(sec, uf27[i] as string);
      expect(g.getAttribute("data-palanque"), v).toBe(v);
      expect(g.hasAttribute("fill"), v).toBe(true);
    }
    // e a legenda lista exatamente os valores do catálogo, na ordem do catálogo
    const rotulos = categoria("palanque_presidencial").valores.map((v) => v.rotulo);
    const legenda = [...sec.querySelectorAll("ul[aria-label='Legenda do palanque'] li")].map((li) =>
      textoDe(li.querySelectorAll("span")[1] as Element),
    );
    expect(legenda).toEqual(rotulos);
  });
});

describe("casado / dividido — no ladrilho e na lista textual", () => {
  const PARES: Array<[string, PalanqueValor, PresidentePalanque, string, string]> = [
    // sigla, palanque, presidente, marca esperada, casamento esperado
    ["SP", "palanque_lula", LULA, "=", "casado"],
    ["RJ", "palanque_lula", FLAVIO, "≠", "dividido"],
    ["MG", "palanque_flavio_bolsonaro", FLAVIO, "=", "casado"],
    ["BA", "palanque_flavio_bolsonaro", LULA, "≠", "dividido"],
    ["PR", "palanque_duplo", LULA, "=", "casado"],
    ["RS", "palanque_duplo", FLAVIO, "=", "casado"],
    ["SC", "sem_palanque_declarado", LULA, "", "nao_se_aplica"],
    ["GO", "palanque_lula", OUTRO, "", "nao_se_aplica"],
  ];
  const { d } = montar(
    PARES.map(([s, p, pres]) => uf(s, p, pres)),
    [],
  );
  const sec = secao(d, "parcial");

  for (const [sigla, palanque, presidente, marca, esperado] of PARES) {
    it(`${sigla}: ${palanque} × ${presidente.lider} → ${esperado}`, () => {
      const g = ladrilho(sec, sigla);
      expect(g.getAttribute("data-casamento")).toBe(esperado);
      const codigo = codigoDe(sec, sigla);
      expect(codigo.endsWith(marca) || marca === "").toBe(true);
      expect(codigo.includes("=")).toBe(marca === "=");
      expect(codigo.includes("≠")).toBe(marca === "≠");
      const li = sec.querySelector(`li[data-uf="${sigla}"]`) as Element;
      const texto = textoDe(li);
      const palavra =
        esperado === "casado"
          ? "Voto: casado."
          : esperado === "dividido"
            ? "Voto: dividido."
            : "Voto: não se aplica.";
      expect(texto).toContain(palavra);
    });
  }

  it("🔴 palanque duplo nunca é 'dividido', com qualquer dos dois líderes", () => {
    for (const s of ["PR", "RS"]) {
      expect(ladrilho(sec, s).getAttribute("data-casamento")).toBe("casado");
      expect(textoDe(sec.querySelector(`li[data-uf="${s}"]`) as Element)).not.toContain("dividido");
    }
  });

  it("a linha-resumo conta os três estados (e só os classificados)", () => {
    const texto = textoDe(sec.querySelector("p") as Element);
    expect(texto).toContain("Voto casado em 4 estados");
    expect(texto).toContain("dividido em 2 estados");
    expect(texto).toContain("não se aplica em 2 estados");
  });

  it("a legenda explica o palanque duplo", () => {
    expect(textoDe(sec)).toContain("o palanque duplo conta como casado");
  });
});

describe("a_classificar NUNCA aparece", () => {
  const sujo = [
    uf("SP", "a_classificar", LULA),
    uf("RJ", "palanque_do_futuro" as PalanqueValor, FLAVIO),
    uf("MG", null, LULA),
    uf("BA", "palanque_lula", LULA, {
      finalistas: [
        cand("a_classificar", "BETA"),
        cand("palanque_do_futuro" as PalanqueValor, "GAMA"),
      ],
    }),
  ];
  const { html, d } = montar(sujo, sujo, { turno: 2 });

  it("nenhuma variante do texto no documento inteiro (markup, atributos, títulos)", () => {
    expect(html).not.toMatch(/a[_\s-]?classificar/i);
    expect(html).not.toMatch(/sem classifica/i);
    expect(html).not.toContain("palanque_do_futuro");
  });

  it("o estado sem classificação é quieto: código — e — na lista", () => {
    const sec = secao(d, "proj");
    for (const s of ["SP", "RJ", "MG"]) {
      expect(codigoDe(sec, s)).toBe("—");
      const g = ladrilho(sec, s);
      expect(g.getAttribute("data-palanque")).toBe("nenhum");
      expect(g.hasAttribute("fill")).toBe(false);
      expect(g.getAttribute("data-casamento")).toBe("nao_se_aplica");
      const t = textoDe(sec.querySelector(`li[data-uf="${s}"]`) as Element);
      expect(t).toContain("Palanque: —.");
      expect(t).toContain("Voto: —.");
    }
  });

  it("estado quieto não entra na legenda nem na linha-resumo", () => {
    const sec = secao(d, "proj");
    const legendas = [...sec.querySelectorAll("ul[aria-label^='Legenda']")].map(textoDe).join(" ");
    expect(legendas).not.toMatch(/—/);
    // 1 estado classificado (BA, palanque_lula com presidente Lula = casado)
    expect(textoDe(sec.querySelector("p") as Element)).toContain("Voto casado em 1 estado ·");
  });

  it("finalista sem classificação mostra — (e nada mais)", () => {
    const sec = secao(d, "proj");
    const t = textoDe(sec.querySelector('li[data-uf="BA"]') as Element);
    expect(t).toContain("Finalistas: BETA (PSD), —; GAMA (PSD), —.");
  });

  it("nenhuma UF classificada ⇒ nenhuma linha-resumo", () => {
    const { d: dd } = montar(todas("a_classificar", LULA), todas(null, null));
    for (const b of ["parcial", "proj"] as const) {
      expect(secao(dd, b).querySelector("p")?.textContent ?? "").not.toContain("Voto casado em");
    }
  });
});

describe("as duas bases no DOM (`data-view-only`) — dados diferentes, cada um no seu lugar", () => {
  const parcial = todas("palanque_lula", LULA, {
    SP: uf("SP", "palanque_duplo", FLAVIO),
  });
  const projecao = todas("palanque_flavio_bolsonaro", FLAVIO, {
    SP: uf("SP", "sem_palanque_declarado", LULA),
  });
  const { html, d } = montar(parcial, projecao);

  it("cada seção reflete o seu conjunto de dados (não o do vizinho)", () => {
    const p = secao(d, "parcial");
    const q = secao(d, "proj");
    expect(ladrilho(p, "SP").getAttribute("data-palanque")).toBe("palanque_duplo");
    expect(ladrilho(q, "SP").getAttribute("data-palanque")).toBe("sem_palanque_declarado");
    expect(ladrilho(p, "RJ").getAttribute("data-palanque")).toBe("palanque_lula");
    expect(ladrilho(q, "RJ").getAttribute("data-palanque")).toBe("palanque_flavio_bolsonaro");
    expect(textoDe(p.querySelector('li[data-uf="RJ"]') as Element)).toContain(
      "Palanque: Palanque de Lula.",
    );
    expect(textoDe(q.querySelector('li[data-uf="RJ"]') as Element)).toContain(
      "Palanque: Palanque de Flávio Bolsonaro.",
    );
    expect(p.outerHTML).not.toBe(q.outerHTML);
  });

  it("as duas cópias descrevem a base certa (título e legenda)", () => {
    expect(textoDe(secao(d, "parcial").querySelector("title") as Element)).toContain("contagem");
    expect(textoDe(secao(d, "proj").querySelector("title") as Element)).toContain("projeção");
    expect(textoDe(secao(d, "proj").querySelector("figcaption") as Element)).toContain(
      "não é resultado oficial",
    );
  });

  it("o elemento com data-view-only não leva class nem style (o `display: revert` do globals decide)", () => {
    for (const el of d.querySelectorAll("[data-view-only]")) {
      expect(el.hasAttribute("class")).toBe(false);
      expect(el.hasAttribute("style")).toBe(false);
    }
  });

  it("o mecanismo que esconde a base inativa continua em app/globals.css", () => {
    const css = LER("app/globals.css");
    expect(css).toMatch(/\[data-view-only\]\s*\{\s*display:\s*none;/);
    expect(css).toContain(':root[data-view="proj"] [data-view-only="proj"]');
    expect(css).toContain(':root[data-view="parcial"] [data-view-only="parcial"]');
  });

  it("ids únicos no documento inteiro, prefixados pela base", () => {
    const ids = [...d.querySelectorAll("[id]")].map((e) => e.getAttribute("id") ?? "");
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of ["parcial", "proj"] as const) {
      for (const e of secao(d, b).querySelectorAll("[id]")) {
        expect(e.getAttribute("id")).toContain(`-${b}-`);
      }
    }
    expect(html).toContain('data-view-only="parcial"');
    expect(html).toContain('data-view-only="proj"');
  });

  it("`id` próprio prefixa tudo (duas instâncias na página não colidem)", () => {
    const a = montar(parcial, projecao, { id: "gov-t1" }).d;
    const ids = [...a.querySelectorAll("[id]")].map((e) => e.getAttribute("id") ?? "");
    expect(ids.length).toBeGreaterThan(0);
    for (const i of ids) expect(i.startsWith("gov-t1-")).toBe(true);
  });
});

describe("turno e finalistas", () => {
  it("o rótulo diz o turno", () => {
    const um = montar(todas(null, null), todas(null, null), { turno: 1 });
    const dois = montar(todas(null, null), todas(null, null), { turno: 2 });
    expect(textoDe(secao(um.d, "proj").querySelector("figcaption") as Element)).toMatch(
      /^1º turno\./,
    );
    expect(textoDe(secao(dois.d, "proj").querySelector("figcaption") as Element)).toMatch(
      /^2º turno\./,
    );
  });

  it("finalistas ficam na ordem em que a página os passou (o componente não ordena)", () => {
    const f1 = cand("palanque_lula", "PRIMEIRO");
    const f2 = cand("palanque_flavio_bolsonaro", "SEGUNDO");
    const ordem = (fin: CandidatoPalanque[]) => {
      const { d } = montar([uf("SP", "palanque_lula", LULA, { finalistas: fin })], [], {
        turno: 2,
      });
      return textoDe(secao(d, "parcial").querySelector('li[data-uf="SP"]') as Element);
    };
    const a = ordem([f1, f2]);
    const b = ordem([f2, f1]);
    expect(a.indexOf("PRIMEIRO")).toBeLessThan(a.indexOf("SEGUNDO"));
    expect(b.indexOf("SEGUNDO")).toBeLessThan(b.indexOf("PRIMEIRO"));
  });

  it("'eleito' e 'lidera' são palavras diferentes na lista", () => {
    const { d } = montar(
      [
        uf("SP", "palanque_lula", LULA, {
          governador: { ...cand("palanque_lula"), papel: "eleito" },
        }),
        uf("RJ", "palanque_lula", LULA),
      ],
      [],
    );
    const sec = secao(d, "parcial");
    expect(textoDe(sec.querySelector('li[data-uf="SP"]') as Element)).toContain(
      "FULANO (PSD), eleito.",
    );
    expect(textoDe(sec.querySelector('li[data-uf="RJ"]') as Element)).toContain(
      "FULANO (PSD), lidera.",
    );
  });

  it("presidente: Lula, Flávio, outro (com nome) e sem leitura", () => {
    const { d } = montar(
      [
        uf("SP", "palanque_lula", LULA),
        uf("RJ", "palanque_lula", FLAVIO),
        uf("MG", "palanque_lula", OUTRO),
        uf("BA", "palanque_lula", null),
      ],
      [],
    );
    const sec = secao(d, "parcial");
    const t = (s: string) => textoDe(sec.querySelector(`li[data-uf="${s}"]`) as Element);
    expect(t("SP")).toContain("Presidente: Lula.");
    expect(t("RJ")).toContain("Presidente: Flávio Bolsonaro.");
    expect(t("MG")).toContain("Presidente: CAIADO.");
    expect(t("BA")).toContain("Presidente: sem leitura nesta base.");
  });
});

describe("acessibilidade (RNF-025)", () => {
  const { d } = montar(
    todas("palanque_lula", LULA, { SP: uf("SP", "palanque_lula", FLAVIO) }),
    todas("palanque_duplo", FLAVIO),
  );

  for (const base of ["parcial", "proj"] as const) {
    describe(`base ${base}`, () => {
      const sec = secao(d, base);
      const svg = sec.querySelector("svg[role='img']") as Element;

      it("svg role=img, nomeado pelo <title>, descrito pelo <desc> e pelo rótulo da lista", () => {
        expect(svg.getAttribute("role")).toBe("img");
        const titulo = d.getElementById(svg.getAttribute("aria-labelledby") ?? "");
        expect(titulo?.tagName.toLowerCase()).toBe("title");
        expect(textoDe(titulo as Element).length).toBeGreaterThan(10);
        const alvos = (svg.getAttribute("aria-describedby") ?? "").split(" ");
        expect(alvos).toHaveLength(2);
        const [descId, listaTituloId] = alvos as [string, string];
        const desc = d.getElementById(descId);
        expect(desc?.tagName.toLowerCase()).toBe("desc");
        expect(textoDe(desc as Element)).toContain("hachura");
        const rotulo = d.getElementById(listaTituloId);
        expect(textoDe(rotulo as Element)).toContain("Lista dos 27 estados");
        const lista = d.getElementById(svg.getAttribute("aria-details") ?? "");
        expect(lista?.tagName.toLowerCase()).toBe("ul");
        expect(lista?.getAttribute("aria-labelledby")).toBe(listaTituloId);
        // a lista vem DEPOIS do svg e dentro da mesma figura
        expect(
          svg.compareDocumentPosition(lista as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(svg.closest("figure")?.contains(lista)).toBe(true);
      });

      it("a lista tem 27 estados, em ordem alfabética de sigla, cada um com nome, palanque e voto", () => {
        const itens = [...sec.querySelectorAll("ul[aria-labelledby] > li")];
        expect(itens).toHaveLength(27);
        const siglas = itens.map((li) => li.getAttribute("data-uf") ?? "");
        expect(siglas).toEqual([...UF_LIST].sort());
        for (const li of itens) {
          const t = textoDe(li);
          expect(t).toMatch(/\([A-Z]{2}\) — Governador: /);
          expect(t).toContain("Palanque: ");
          expect(t).toContain("Presidente: ");
          expect(t).toMatch(/Voto: (casado|dividido|não se aplica|—)\./);
        }
        expect(textoDe(sec.querySelector('li[data-uf="AC"]') as Element)).toContain("Acre (AC)");
      });

      it("a lista está num <div class=sr-only> e não há <table> em lugar nenhum", () => {
        const lista = sec.querySelector("ul[aria-labelledby]") as Element;
        expect(lista.parentElement?.tagName.toLowerCase()).toBe("div");
        expect(lista.parentElement?.className).toBe("sr-only");
        expect(sec.querySelector("table")).toBeNull();
      });

      it("nada interativo dentro do mapa nem da lista; swatches da legenda são aria-hidden", () => {
        expect(
          sec.querySelectorAll("a, button, input, select, textarea, [tabindex], [onclick]"),
        ).toHaveLength(0);
        const amostras = [...sec.querySelectorAll("svg[width='26']")];
        expect(amostras.length).toBeGreaterThan(0);
        for (const a of amostras) {
          expect(a.getAttribute("aria-hidden")).toBe("true");
          expect(a.getAttribute("focusable")).toBe("false");
        }
      });

      it("swatches da legenda referenciam padrões que existem no svg da mesma seção", () => {
        const ids = new Set([...svg.querySelectorAll("pattern")].map((p) => p.getAttribute("id")));
        const refs = [...sec.querySelectorAll("svg[width='26'] rect[fill^='url(']")].map(
          (r) => /^url\(#(.+)\)$/.exec(r.getAttribute("fill") ?? "")?.[1],
        );
        expect(refs).toHaveLength(4);
        for (const r of refs) expect(ids.has(r ?? "")).toBe(true);
      });
    });
  }

  it("o único link do componente é o do aviso, para a metodologia; `semAviso` o tira", () => {
    const links = [...d.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("/sobre-as-etiquetas");
    expect(d.querySelectorAll('[data-testid="etiquetas-aviso"]')).toHaveLength(1);
    const sem = montar(todas(null, null), todas(null, null), { semAviso: true }).d;
    expect(sem.querySelectorAll("a")).toHaveLength(0);
  });

  it("o aviso fica fora das seções de base (aparece com qualquer base ativa)", () => {
    const aviso = d.querySelector('[data-testid="etiquetas-aviso"]') as Element;
    expect(aviso.closest("[data-view-only]")).toBeNull();
  });

  it("nenhum atributo de cor no markup: sem style, sem hex, sem rgb/hsl", () => {
    const html = renderToStaticMarkup(
      <PalanquesMapa
        parcial={todas("palanque_lula", LULA)}
        projecao={todas("palanque_duplo", FLAVIO)}
        turno={1}
      />,
    );
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/=["']#[0-9a-fA-F]{3,8}["']/);
    expect(html).not.toMatch(/(rgb|hsl|oklch|lab)a?\(/i);
    expect(html).not.toMatch(/var\(--(party|color-cand)/);
  });
});

describe("RF-238 — a ordem nunca depende de etiqueta, da ordem de entrada nem de classificação", () => {
  const ORDEM = (html: string) =>
    [...doc(html).querySelectorAll("ul[aria-labelledby] > li")].map(
      (li) => li.getAttribute("data-uf") ?? "",
    );

  it("etiqueta presente, ausente, parcial ou permutada: mesma sequência de estados", () => {
    expectOrdemInvariante({
      ids: [...UF_LIST],
      ordenar: (classificado) => {
        const lista = [...UF_LIST].map((s) =>
          uf(s, classificado(s) ? "palanque_lula" : "a_classificar", classificado(s) ? LULA : null),
        );
        return ORDEM(
          renderToStaticMarkup(<PalanquesMapa parcial={lista} projecao={lista} turno={1} />),
        ).slice(0, 27);
      },
    });
  });

  it("entrada em qualquer ordem gera exatamente o mesmo HTML", () => {
    const lista = [...UF_LIST].map((s, i) =>
      uf(s, i % 2 ? "palanque_lula" : "palanque_flavio_bolsonaro", i % 3 ? LULA : FLAVIO),
    );
    const render = (l: PalanquesUf[]) =>
      renderToStaticMarkup(<PalanquesMapa parcial={l} projecao={l} turno={1} />);
    const original = render(lista);
    expect(render([...lista].reverse())).toBe(original);
    const embaralhada = [...lista].sort(
      (a, b) => (a.uf.charCodeAt(1) % 5) - (b.uf.charCodeAt(1) % 5),
    );
    expect(render(embaralhada)).toBe(original);
  });
});

describe("Server Component — zero JS, sem mapa vetorial (ADR-0010)", () => {
  // Só o código: os comentários citam MapLibre/PMTiles justamente para explicar por que não.
  const semComentarios = (f: string) =>
    f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const fonte = semComentarios(LER("components/blocks/PalanquesMapa.tsx"));
  const logica = semComentarios(LER("components/blocks/_palanques.ts"));

  it("sem 'use client', sem hooks, sem MapLibre/PMTiles, sem estado de visão em JS", () => {
    for (const f of [fonte, logica]) {
      expect(f).not.toMatch(/^\s*["']use client["']/m);
      expect(f).not.toMatch(/\buse(State|Effect|Ref|Memo|Callback|ViewMode|SyncExternalStore)\b/);
      expect(f).not.toMatch(/maplibre|pmtiles|next\/dynamic/i);
      expect(f).not.toMatch(/view-mode-client/);
    }
  });

  it("a página fornece os dados: o componente não importa o leitor nem o Edge Config em runtime", () => {
    for (const f of [fonte, logica]) {
      expect(f).not.toMatch(/from ["']@\/lib\/etiquetas\/(leitor|embutido)["']/);
      expect(f).not.toMatch(/from ["']@\/lib\/edge-config\/(?!types)/);
      expect(f).not.toMatch(/\bfetch\(/);
    }
  });
});

// Medido em 29/09 no pior caso abaixo: 49.697 B brutos / 3.704 B gzip. Teto com ~20% de folga.
const TETO_BRUTO = 60_000;
const TETO_GZIP = 4_500;

describe("peso — teto no pior caso de CADA campo, não numa amostra", () => {
  /**
   * Pior caso: 27 UFs nas duas bases; nome de urna de 30 caracteres (limite do
   * TSE); a maior sigla (REPUBLICANOS); `papel: eleito`; duas finalistas com o
   * mesmo nome comprido; presidente "outro" com nome longo; e o maior código
   * (L+F) com o sinal (≠/=). É o que o HTML pode custar, não o que o simulado mostra.
   */
  const longo = "MARIA APARECIDA DE FATIMA SOUZA";
  const pior = (sobre: PalanqueValor): PalanquesUf[] =>
    [...UF_LIST].map((s) => ({
      uf: s,
      governador: {
        sqcand: "250002012345",
        nome: longo.slice(0, 30),
        partido: "REPUBLICANOS",
        palanque: sobre,
        papel: "eleito" as const,
      },
      finalistas: [
        {
          sqcand: "250002012345",
          nome: longo.slice(0, 30),
          partido: "REPUBLICANOS",
          palanque: sobre,
        },
        {
          sqcand: "250002012346",
          nome: longo.slice(0, 30),
          partido: "REPUBLICANOS",
          palanque: sobre,
        },
      ],
      presidente: { lider: "outro" as const, nome: longo.slice(0, 30) },
    }));

  const html = renderToStaticMarkup(
    <PalanquesMapa parcial={pior("palanque_duplo")} projecao={pior("palanque_duplo")} turno={2} />,
  );
  const bytes = Buffer.byteLength(html);
  const gz = gzipSync(html).length;

  it("HTML bruto e gzip abaixo do teto (as duas bases, 2º turno, tudo no maior tamanho)", () => {
    expect(bytes, `bruto: ${bytes} B`).toBeLessThan(TETO_BRUTO);
    expect(gz, `gzip: ${gz} B`).toBeLessThan(TETO_GZIP);
  });

  it("caso comum (1º turno, sem finalistas) é bem menor que o pior caso", () => {
    const comum = renderToStaticMarkup(
      <PalanquesMapa
        parcial={todas("palanque_lula", LULA)}
        projecao={todas("palanque_lula", LULA)}
        turno={1}
      />,
    );
    expect(Buffer.byteLength(comum)).toBeLessThan(bytes);
  });
});
