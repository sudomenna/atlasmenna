// @vitest-environment happy-dom
/**
 * tests/unit/components/UfPicker.test.tsx
 *
 * `<UfPicker />` — o seletor de UF sobreposto ao mapa (protótipo
 * `ui_kits/atlas-menna/App.jsx:316` + `:362-369`), entregue em 2026-09-10.
 *
 * O que estes testes protegem:
 *   1. **As 27 são links reais.** A maquete deixa 26 `disabled` porque só
 *      carregou São Paulo; aqui a rota existe para todas, e um seletor que
 *      desabilitasse 26 seria um porte errado do protótipo, não fidelidade.
 *   2. **Ordem por NOME**, não por sigla — é a ordem do kit, e é a que o
 *      leitor varre. O par que separa as duas ordens é Amapá/Amazonas: por
 *      nome AP vem antes de AM, por sigla seria o contrário.
 *   3. **Destino por cargo**: `/uf/<SIGLA>` no presidencial,
 *      `/uf/<SIGLA>/governador` no de governador. Trocar isso levaria o leitor
 *      para a corrida errada em silêncio.
 *   4. **Alvo de toque de 44px** em cada item (`--tap-min`, RNF-022): a folha
 *      abre por um botão sobre o mapa, que é a superfície mais tocada no
 *      mobile.
 *
 * O arquivo tem duas metades. A primeira usa `renderToStaticMarkup`, como o
 * resto da suíte de componentes, e cobre o markup da grade e do botão
 * fechado. A segunda monta de verdade (`createRoot` + `act`, happy-dom)
 * porque o `<Sheet>` só existe DEPOIS do clique — abrir, Esc e escolher uma
 * UF não são observáveis num render estático.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ufsPorNome } from "@/components/atoms/maps/_shared";
import { UfPicker, UfPickerGrid, ufHref } from "@/components/layout/UfPicker";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function itens(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="uf-picker-item"]'));
}

describe("ufsPorNome()", () => {
  it("(a) devolve as 27 unidades federativas", () => {
    expect(ufsPorNome()).toHaveLength(27);
  });

  it("(b) ordena por NOME em pt-BR, não por sigla", () => {
    const nomes = ufsPorNome().map((u) => u.nome);
    expect(nomes[0]).toBe("Acre");
    expect(nomes.at(-1)).toBe("Tocantins");

    // O par que distingue as duas ordens: por NOME, "Amapá" < "Amazonas"
    // (AP antes de AM); por SIGLA seria o contrário (AM antes de AP). Se
    // alguém trocar o critério de ordenação, é aqui que quebra.
    const siglas = ufsPorNome().map((u) => u.sigla);
    expect(siglas.indexOf("AP")).toBeLessThan(siglas.indexOf("AM"));
  });

  it("(c) é determinístico — mesma saída em toda chamada (constituição § 6)", () => {
    expect(ufsPorNome()).toEqual(ufsPorNome());
  });
});

describe("ufHref()", () => {
  it("(d) o destino muda com o cargo", () => {
    expect(ufHref("pres", "SP")).toBe("/uf/SP");
    expect(ufHref("gov", "SP")).toBe("/uf/SP/governador");
  });

  it("(d2) 2026-09-18 — cargo=sen leva a /uf/<SIGLA>/senador, não à rota de presidente", () => {
    // Mutação: trocar `UF_HREF_SUFFIX.sen` de volta para "" (ou remover a
    // chave do Record) faz este teste falhar — o `Record<UfPickerCargo,
    // string>` também deixaria de compilar sem a chave, mas a asserção de
    // VALOR é o que prova que a rota de destino está certa, não só presente.
    expect(ufHref("sen", "SP")).toBe("/uf/SP/senador");
  });
});

describe("<UfPickerGrid /> — bandeira", () => {
  // 🔴 MUTAÇÃO (2026-10-03): tirar o `<UfFlag>` do item — morre na contagem.
  it("cada uma das 27 opções tem a bandeira da PRÓPRIA UF, decorativa, antes do nome", () => {
    const doc = parse(<UfPickerGrid cargo="gov" />);
    const lista = itens(doc);
    expect(lista).toHaveLength(27);
    for (const item of lista) {
      const sigla = item.getAttribute("data-sigla");
      const img = item.querySelector("img");
      expect(img?.getAttribute("src"), sigla ?? "").toBe(`/bandeiras/${sigla}.webp`);
      expect(img?.getAttribute("alt")).toBe("");
    }
    // A sigla continua sendo o último filho (o `space-between` a empurra à
    // direita), e o nome segue em texto.
    const ap = lista.find((i) => i.getAttribute("data-sigla") === "AP");
    expect(ap?.lastElementChild?.textContent).toBe("AP");
    expect(ap?.textContent).toBe("AmapáAP");
  });
});

describe("<UfPickerGrid />", () => {
  it("(e) as 27 UFs (e o Exterior, no presidente) são links de verdade — nenhuma desabilitada", () => {
    const doc = parse(<UfPickerGrid cargo="pres" />);
    const links = itens(doc);

    expect(links).toHaveLength(28);
    for (const a of links) {
      expect(a.tagName).toBe("A");
      expect(a.getAttribute("href")).toMatch(/^\/uf\/[A-Z]{2}$/);
      expect(a.hasAttribute("disabled")).toBe(false);
      expect(a.getAttribute("aria-disabled")).toBeNull();
    }
  });

  it("(f) no cargo de governador todo href leva à rota de governador", () => {
    const doc = parse(<UfPickerGrid cargo="gov" />);
    for (const a of itens(doc)) {
      expect(a.getAttribute("href")).toMatch(/^\/uf\/[A-Z]{2}\/governador$/);
    }
  });

  it("(f2) 2026-09-18 — no cargo de senador todo href leva à rota de senador", () => {
    const doc = parse(<UfPickerGrid cargo="sen" />);
    const links = itens(doc);
    expect(links).toHaveLength(27);
    for (const a of links) {
      expect(a.getAttribute("href")).toMatch(/^\/uf\/[A-Z]{2}\/senador$/);
    }
  });

  it("(g) a ordem no DOM é a ordem por nome", () => {
    const doc = parse(<UfPickerGrid cargo="pres" />);
    expect(itens(doc).map((a) => a.getAttribute("data-sigla"))).toEqual([
      ...ufsPorNome().map((u) => u.sigla),
      "ZZ",
    ]);
  });

  it("(h) a UF corrente ganha aria-current=page e só ela", () => {
    const doc = parse(<UfPickerGrid cargo="pres" atual="mg" />);
    const atuais = itens(doc).filter((a) => a.getAttribute("aria-current") === "page");
    expect(atuais.map((a) => a.getAttribute("data-sigla"))).toEqual(["MG"]);
  });

  it("(i) cada item tem alvo de toque de --tap-min (RNF-022)", () => {
    const doc = parse(<UfPickerGrid cargo="pres" />);
    for (const a of itens(doc)) {
      expect(a.getAttribute("style")).toContain("min-height:var(--tap-min)");
    }
  });
});

describe("<UfPicker />", () => {
  it("(j) fechado, é só o botão — a folha não nasce montada", () => {
    const doc = parse(<UfPicker cargo="pres" />);
    expect(doc.querySelector('[data-testid="sheet"]')).toBeNull();
    expect(itens(doc)).toHaveLength(0);

    const botao = doc.querySelector<HTMLElement>('[data-testid="button"]');
    expect(botao?.textContent).toContain("Escolher UF");
    // `size="md"` = 44px. `sm` (32px) fica abaixo de `--tap-min` e não serve
    // para um alvo sobre o mapa.
    expect(botao?.getAttribute("data-size")).toBe("md");
    expect(botao?.getAttribute("aria-expanded")).toBe("false");
  });

  it("(k) numa rota de UF o botão mostra a sigla corrente", () => {
    const doc = parse(<UfPicker cargo="gov" atual="ba" />);
    expect(doc.querySelector('[data-testid="button"]')?.textContent).toContain("BA");
  });

  it("(k2) 2026-09-18 — numa rota de senador o botão também mostra a sigla corrente", () => {
    const doc = parse(<UfPicker cargo="sen" atual="ba" />);
    expect(doc.querySelector('[data-testid="button"]')?.textContent).toContain("BA");
  });
});

/** A abertura da folha — precisa de árvore montada de verdade. */
// biome-ignore lint/suspicious/noExplicitAny: flag global do ambiente de `act`
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("<UfPicker /> — abrir e fechar", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<UfPicker cargo="pres" atual="SP" />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const botao = () => container.querySelector<HTMLElement>('[data-testid="button"]');
  const folha = () => container.querySelector('[data-testid="sheet"]');

  it("(l) o botão abre a folha com as 27 UFs + Exterior e o kicker do protótipo", () => {
    expect(folha()).toBeNull();
    act(() => botao()?.click());

    expect(folha()).not.toBeNull();
    expect(folha()?.textContent).toContain("Escolher UF");
    expect(container.querySelectorAll('[data-testid="uf-picker-item"]')).toHaveLength(28);
    expect(botao()?.getAttribute("aria-expanded")).toBe("true");
  });

  it("(m) é modal — tem scrim, aria-modal e não a variante `side`", () => {
    act(() => botao()?.click());
    expect(folha()?.getAttribute("aria-modal")).toBe("true");
    expect(folha()?.getAttribute("data-side")).toBe("false");
    expect(container.querySelector('[data-testid="sheet-scrim"]')).not.toBeNull();
  });

  it("(n) Esc fecha (WCAG 2.1.2)", () => {
    act(() => botao()?.click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(folha()).toBeNull();
    expect(botao()?.getAttribute("aria-expanded")).toBe("false");
  });

  it('(o2) 2026-09-18 — cargo="sen" abre a folha com o título "Senador"', () => {
    // Mutação: remover a chave `sen` de `UF_PICKER_TITLE` quebra a compilação
    // (Record total); trocar o VALOR para "Presidente" (o antigo `else` do
    // ternário) faz este teste falhar sem quebrar o build — é essa segunda
    // mutação que a asserção de conteúdo prova.
    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    act(() => {
      root2.render(<UfPicker cargo="sen" atual="SP" />);
    });
    act(() => {
      container2.querySelector<HTMLElement>('[data-testid="button"]')?.click();
    });
    expect(container2.querySelector('[data-testid="sheet"]')?.textContent).toContain("Senador");
    act(() => root2.unmount());
    container2.remove();
  });

  it("(o) escolher uma UF fecha a folha (a navegação é do <Link>)", () => {
    act(() => botao()?.click());
    const mg = container.querySelector<HTMLElement>(
      '[data-testid="uf-picker-item"][data-sigla="MG"]',
    );
    expect(mg?.getAttribute("href")).toBe("/uf/MG");
    act(() => mg?.click());
    expect(folha()).toBeNull();
  });
});

describe("<UfPickerGrid /> — Exterior (ADR-0045)", () => {
  it("no presidente o Exterior é o último item, leva a /uf/ZZ, sem bandeira e sem a sigla ZZ", () => {
    const lista = itens(parse(<UfPickerGrid cargo="pres" />));
    const ultimo = lista[lista.length - 1];
    expect(ultimo?.getAttribute("data-sigla")).toBe("ZZ");
    expect(ultimo?.getAttribute("href")).toBe("/uf/ZZ");
    expect(ultimo?.textContent).toBe("Exterior");
    expect(ultimo?.querySelector("img")).toBeNull();
  });

  it("governador e senador NÃO listam o Exterior", () => {
    for (const cargo of ["gov", "sen"] as const) {
      const siglas = itens(parse(<UfPickerGrid cargo={cargo} />)).map((a) =>
        a.getAttribute("data-sigla"),
      );
      expect(siglas, cargo).toHaveLength(27);
      expect(siglas, cargo).not.toContain("ZZ");
    }
  });

  it("na página do Exterior o item fica marcado e o botão diz Exterior, nunca ZZ", () => {
    const lista = itens(parse(<UfPickerGrid cargo="pres" atual="zz" />));
    expect(
      lista.find((a) => a.getAttribute("data-sigla") === "ZZ")?.getAttribute("aria-current"),
    ).toBe("page");
    const html = renderToStaticMarkup(<UfPicker cargo="pres" atual="ZZ" />);
    expect(html).toContain("Exterior");
    expect(html).not.toContain(">ZZ<");
  });
});
