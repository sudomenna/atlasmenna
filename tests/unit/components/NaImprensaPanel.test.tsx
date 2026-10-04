// @vitest-environment happy-dom
/**
 * tests/unit/components/NaImprensaPanel.test.tsx
 *
 * `<NaImprensaPanel />` — manchetes dos feeds públicos (ADR-0072).
 *
 * O que importa aqui é segurança e honestidade, não layout:
 *   - só link `http(s)` vira `<a>` (segunda barreira depois do schema);
 *   - `target="_blank"` sempre com `rel="noopener noreferrer nofollow"`;
 *   - sem manchete, o bloco não existe (`null`) — nada de painel vazio;
 *   - a nota diz que é coleta automática e que o AtlasMenna não endossa.
 *
 * Os vizinhos de `tests/unit/components/` não rodam axe em unit (o axe roda
 * nos portões e2e, `pnpm test:e2e`); aqui ficam as conferências estruturais
 * equivalentes: região nomeada, lista, `<time dateTime>`, aviso de nova aba.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { linkSeguro, NaImprensaPanel } from "@/components/blocks/NaImprensaPanel";
import type { Manchete } from "@/lib/leitura/types";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

function manchete(over: Partial<Manchete> = {}): Manchete {
  return {
    titulo: "Apuração passa de 50% das seções",
    link: "https://exemplo.com.br/materia",
    veiculo: "Veículo A",
    publicado_em: "2026-10-04T23:47:11Z",
    feed: "veiculo-a",
    ...over,
  };
}

describe("<NaImprensaPanel />", () => {
  it("(a) sem itens → null", () => {
    expect(renderToStaticMarkup(<NaImprensaPanel itens={[]} />)).toBe("");
  });

  it("(b) uma <ul> com um <li> por manchete; título no <a>, veículo e <time> HH:MM abaixo", () => {
    const doc = parse(
      <NaImprensaPanel
        itens={[manchete(), manchete({ titulo: "Outra", link: "http://b.com/x", veiculo: "B" })]}
      />,
    );
    const lis = doc.querySelectorAll('[data-testid="na-imprensa-lista"] > li');
    expect(lis).toHaveLength(2);
    const a = lis[0]?.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://exemplo.com.br/materia");
    expect(a?.textContent).toContain("Apuração passa de 50% das seções");
    expect(lis[0]?.textContent).toContain("Veículo A");
    const time = lis[0]?.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-10-04T23:47:11Z");
    expect(time?.textContent).toBe("20:47");
  });

  it("(c) todo link abre em nova aba com rel='noopener noreferrer nofollow' e avisa o leitor de tela", () => {
    const doc = parse(<NaImprensaPanel itens={[manchete(), manchete({ link: "http://b.com" })]} />);
    for (const a of doc.querySelectorAll("a")) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
      expect(a.querySelector(".sr-only")?.textContent).toContain("abre em nova aba");
    }
  });

  it("(d) link que não é http(s) é descartado no render", () => {
    const doc = parse(
      <NaImprensaPanel
        itens={[
          manchete({ titulo: "Boa", link: "https://ok.com/1" }),
          manchete({ titulo: "JS", link: "javascript:alert(1)" }),
          manchete({ titulo: "Data", link: "data:text/html,<script>x</script>" }),
          manchete({ titulo: "Relativo", link: "/materia" }),
          manchete({ titulo: "Protocolo relativo", link: "//mal.com/x" }),
          manchete({ titulo: "Arquivo", link: "file:///etc/passwd" }),
        ]}
      />,
    );
    const hrefs = [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://ok.com/1"]);
    expect(doc.body.textContent).not.toContain("JS");
  });

  it("(e) só links inválidos → null (nada de painel vazio)", () => {
    expect(
      renderToStaticMarkup(<NaImprensaPanel itens={[manchete({ link: "javascript:void 0" })]} />),
    ).toBe("");
  });

  it("(f) linkSeguro: só http: e https: absolutos", () => {
    expect(linkSeguro("https://a.com")).toBe(true);
    expect(linkSeguro("HTTP://A.COM/x")).toBe(true);
    expect(linkSeguro("javascript:alert(1)")).toBe(false);
    expect(linkSeguro(" https://a.com")).toBe(false);
    expect(linkSeguro("https://")).toBe(false);
    expect(linkSeguro("mailto:x@y.com")).toBe(false);
  });

  it("(g) publicado_em null ou ilegível → sem <time>, veículo segue", () => {
    const doc = parse(
      <NaImprensaPanel
        itens={[manchete({ publicado_em: null }), manchete({ publicado_em: "ontem" })]}
      />,
    );
    expect(doc.querySelector("time")).toBeNull();
    expect(doc.querySelectorAll("li")[0]?.textContent).toContain("Veículo A");
  });

  it("(h) Panel com kicker, título e região nomeada pelo heading", () => {
    const doc = parse(<NaImprensaPanel itens={[manchete()]} />);
    const section = doc.querySelector('[data-testid="panel"]');
    expect(section?.getAttribute("aria-labelledby")).toBe("na-imprensa-heading");
    expect(doc.querySelector("#na-imprensa-heading")?.textContent).toBe(
      "O que os veículos estão publicando",
    );
    expect(doc.querySelector('[data-testid="panel-kicker"]')?.textContent).toBe("Na imprensa");
  });

  it("(i) nota de origem: coleta automática, sem edição nem endosso", () => {
    const doc = parse(<NaImprensaPanel itens={[manchete()]} />);
    expect(doc.querySelector('[data-testid="na-imprensa-nota"]')?.textContent).toBe(
      "Manchetes coletadas automaticamente de feeds públicos dos veículos. O AtlasMenna não edita nem endossa; leia a matéria no site do veículo.",
    );
  });

  it("(j) sem cor de partido nem cor cravada no markup", () => {
    const html = renderToStaticMarkup(<NaImprensaPanel itens={[manchete()]} />);
    expect(html).not.toMatch(/--color-cand|--color-partido|--party|#[0-9a-f]{3,6}\b/i);
  });
});
