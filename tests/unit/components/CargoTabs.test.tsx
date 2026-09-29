// @vitest-environment happy-dom
/**
 * tests/unit/components/CargoTabs.test.tsx
 *
 * `<CargoTabs />` + o shell global de `app/layout.tsx` (ADR-0025 § 2,
 * S07/Bloco 1).
 *
 * O que estes testes travam:
 *   - as quatro abas de cargo (decisão D5, 2026-09-07), **todas navegáveis**
 *     desde 2026-09-12. Senador saiu do modo desabilitado em 2026-09-11
 *     (spec 016) e Deputado Federal em 2026-09-12 (spec 017), quando as rotas
 *     `/deputado-federal` e `/uf/[sigla]/deputado-federal` passaram a existir.
 *     O modo desabilitado (`aria-disabled` + razão legível, nunca um `<a>` que
 *     leva a 404) continua no `<TabBar>` e coberto lá — aqui o que se trava é
 *     que nenhuma aba voltou para ele em silêncio;
 *   - o rótulo de Deputado: "Deputados" desde a spec 027 (29/09), com o
 *     nome acessível começando pelo visível (WCAG 2.5.3, Label in Name). Até
 *     ali era visível "Deputado" e acessível "Deputado Federal";
 *   - o shell inteiro é RSC: nenhum arquivo da cadeia
 *     `layout → TopBar → CargoTabs → TabBar` declara `"use client"` nem usa
 *     hook. Isso é orçamento, não estilo: o shell renderiza acima da dobra em
 *     TODAS as rotas e RNF-007a está em 148,7 KiB de um teto de 150;
 *   - o layout não lê nada por requisição (`cookies`, `headers`,
 *     `searchParams`, `usePathname`) — qualquer um tornaria dinâmicas as 54
 *     páginas de UF hoje pré-renderizadas estáticas (ADR-0025 § 2 e § 5);
 *   - `Footer` e `main[data-trilha]` continuam FORA do layout, de posse de
 *     cada página (ADR-0025 § 1) — é o que os testes de integração assumem.
 *
 * Por que asserção sobre o código-fonte do layout e não sobre seu render:
 * `app/layout.tsx` importa `next/font/google`, que só existe sob o transform
 * do Next; importá-lo aqui quebraria por um motivo que nada tem a ver com o
 * que se quer medir.
 */

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CargoTabs } from "@/components/layout/CargoTabs";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

/** Fonte sem comentários — os cabeçalhos citam `"use client"`, `usePathname`
 *  etc. justamente para explicar por que eles não estão lá. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SHELL_FILES = [
  "app/layout.tsx",
  "components/layout/TopBar.tsx",
  "components/layout/TabBar.tsx",
  "components/layout/CargoTabs.tsx",
];

describe("<CargoTabs /> — abas de cargo do shell global", () => {
  it("(a) é um <nav> nomeado com as quatro abas, na ordem da decisão D5", () => {
    const doc = parse(<CargoTabs />);
    const nav = doc.querySelector("[data-testid='tab-bar']");

    expect(nav?.tagName).toBe("NAV");
    expect(nav?.getAttribute("aria-label")).toBe("Cargos");
    expect(
      [...(nav?.querySelectorAll("[data-value]") ?? [])].map((el) => el.getAttribute("data-value")),
    ).toEqual(["pres", "gov", "sen", "dep"]);
  });

  it("(b) os quatro cargos são links reais (zero JS)", () => {
    const doc = parse(<CargoTabs />);
    const links = [...doc.querySelectorAll("a")];

    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/",
      "/governador",
      "/senador",
      "/deputado-federal",
    ]);
    expect(links.map((a) => a.getAttribute("data-value"))).toEqual(["pres", "gov", "sen", "dep"]);
  });

  it("(c) nenhuma aba está desabilitada — e nenhuma promete um cargo que não existe", () => {
    // Asserção negativa: o defeito que este teste caça é uma aba voltar ao
    // modo `<span aria-disabled>` (ou nascer nele) sem ninguém notar — ela
    // continuaria no lugar, com o rótulo certo, e simplesmente não navegaria.
    const doc = parse(<CargoTabs />);

    expect(doc.querySelectorAll("[aria-disabled]").length).toBe(0);
    expect(doc.querySelectorAll("[data-disabled='true']").length).toBe(0);
    expect(doc.body.textContent).not.toMatch(/ainda não coberto/i);
    expect(doc.querySelector("[data-value='dep']")?.tagName).toBe("A");
  });

  it('(d) RF-283 — a aba de deputado é "Deputados", e o nome acessível começa pelo visível (WCAG 2.5.3)', () => {
    // Spec 027 (decisão do dono de 29/09): a aba cobre a Câmara dos Deputados
    // E as assembleias — a escolha é o seletor dentro da página. O nome
    // acessível antigo ("Deputado Federal", com " Federal" em `sr-only`)
    // passaria a anunciar um cargo só. A regra Label in Name exige que o
    // nome acessível COMECE pelo texto visível: o comando de voz "clicar
    // Deputados" tem de achar a aba.
    const doc = parse(<CargoTabs />);
    const dep = doc.querySelector("[data-value='dep'] > span");
    const nomeAcessivel = (dep?.textContent ?? "").replace(/\s*\(página atual\)\s*/, "").trim();

    // O visível é o texto SEM nenhum `sr-only` (o " (página atual)" e
    // qualquer sufixo escondido).
    const clone = dep?.cloneNode(true) as Element | undefined;
    for (const el of clone?.querySelectorAll(".sr-only") ?? []) el.remove();
    const visivel = (clone?.textContent ?? "").trim();

    expect(visivel).toBe("Deputados");
    expect(nomeAcessivel.startsWith(visivel)).toBe(true);
    // Nada de um cargo só no nome acessível — era o " Federal" escondido.
    expect(nomeAcessivel).not.toMatch(/Federal/);
  });

  it("(e) o rótulo visível continua sendo o nome do cargo", () => {
    const doc = parse(<CargoTabs />);
    const label = (value: string) =>
      doc.querySelector(`[data-value='${value}'] > span`)?.textContent ?? "";

    expect(label("pres")).toContain("Presidente");
    expect(label("gov")).toContain("Governador");
    expect(label("sen")).toContain("Senador");
    expect(label("dep")).toContain("Deputados");
  });

  it("(f) o ativo NÃO é decidido no servidor — é o CSS que lê main[data-trilha]", () => {
    const doc = parse(<CargoTabs />);

    // Nenhum item nasce ativo: o layout raiz não conhece a rota, e as três
    // formas de descobri-la (usePathname / headers-cookies-searchParams /
    // slot de parallel route) custariam JS acima da dobra ou render dinâmico.
    expect(doc.querySelector("[aria-current]")).toBeNull();
    expect(doc.querySelectorAll("[data-active='true']").length).toBe(0);

    // O portador do estado é um texto por aba navegável, que o
    // `CargoTabs.module.css` revela só sob `body:has(main[data-trilha=…])`.
    // Um por aba navegável. O filtro pelo texto fica: qualquer outro `sr-only`
    // dentro de uma aba (a de Deputado teve um " Federal" até 29/09) também
    // casaria com o seletor.
    const flags = [...doc.querySelectorAll("a .sr-only")].filter((el) =>
      /página atual/.test(el.textContent ?? ""),
    );
    expect(flags.length).toBe(4);
    for (const flag of flags) {
      expect(flag.textContent).toContain("página atual");
      // `sr-only` (geometria) + a classe local do módulo (display: none até a
      // trilha casar). Duas classes, não uma.
      expect(flag.getAttribute("class")?.split(/\s+/).length).toBeGreaterThan(1);
    }
  });

  it("(g) toda aba navegável tem a regra de CSS que a marca — nenhuma fica órfã", () => {
    // Guarda de acoplamento: o TSX diz quais abas navegam, o CSS diz quais
    // trilhas as marcam. Uma quinta aba navegável sem regra correspondente
    // ficaria eternamente "inativa" e ninguém perceberia — este teste falha
    // antes disso.
    const doc = parse(<CargoTabs />);
    const navegaveis = [...doc.querySelectorAll("a[data-value]")].map(
      (a) => a.getAttribute("data-value") ?? "",
    );

    const css = readFileSync("components/layout/CargoTabs.module.css", "utf8");
    const trilhasNoCss = new Set(
      [...css.matchAll(/body:has\(main\[data-trilha="([a-z]+)"\]\)/g)].map((m) => m[1]),
    );
    const abasNoCss = new Set([...css.matchAll(/\[data-value="([a-z]+)"\]/g)].map((m) => m[1]));

    expect([...abasNoCss].sort()).toEqual([...navegaveis].sort());
    expect([...trilhasNoCss].sort()).toEqual([...navegaveis].sort());
  });

  it("(g2) nenhum hex literal no markup (constituição § 2)", () => {
    expect(renderToStaticMarkup(<CargoTabs />)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("shell global — app/layout.tsx (ADR-0025 § 2)", () => {
  it("(h) monta TopBar + as duas posições de CargoTabs em torno de {children}", () => {
    const src = codeOf("app/layout.tsx");

    expect(src).toContain("<TopBar");
    expect(src).toContain("{children}");
    // ADR-0029 § 3: a navegação de cargo passou a ter duas posições — dentro
    // do `<TopBar>` (visível só no desktop) e fixa no rodapé (só no mobile).
    // Ordem no documento: a do topo antes de `{children}`, a do rodapé depois.
    expect(src).toContain('<CargoTabs placement="top" />');
    expect(src).toContain('<CargoTabs placement="bottom" />');
    expect(src.indexOf('placement="top"')).toBeLessThan(src.indexOf("{children}"));
    expect(src.indexOf("{children}")).toBeLessThan(src.indexOf('placement="bottom"'));
  });

  it("(h2) as duas posições existem no HTML; o CSS escolhe uma por breakpoint", () => {
    // Renderizar as duas é deliberado: escolher no servidor exigiria saber a
    // largura da viewport. O que impede dois landmarks "Cargos" simultâneos é
    // `display: none` no escondido — que também o tira da árvore de
    // acessibilidade e da ordem de tabulação.
    const top = parse(<CargoTabs placement="top" />);
    const bottom = parse(<CargoTabs placement="bottom" />);

    for (const doc of [top, bottom]) {
      expect(doc.querySelector("[data-testid='tab-bar']")?.getAttribute("aria-label")).toBe(
        "Cargos",
      );
    }

    const css = readFileSync("components/layout/CargoTabs.module.css", "utf8");
    expect(css).toMatch(/\.cargoTabs\.top\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/@media\s*\(min-width:\s*960px\)/);
    expect(css).toMatch(/\.cargoTabs\.bottom\s*\{[^}]*display:\s*none/);
  });

  it("(i) o layout não lê nada por requisição — as 54 páginas de UF seguem estáticas", () => {
    const src = codeOf("app/layout.tsx");

    for (const leitura of ["cookies(", "headers(", "draftMode(", "searchParams", "usePathname"]) {
      expect(src).not.toContain(leitura);
    }
    expect(src).not.toContain("force-dynamic");
  });

  it("(j) nenhum arquivo do shell é Client Component (RNF-007a: 148,7 de 150 KiB)", () => {
    for (const file of SHELL_FILES) {
      const src = codeOf(file);
      expect(src, file).not.toContain('"use client"');
      expect(src, file).not.toContain("'use client'");
      expect(src, file).not.toMatch(/\buse(State|Effect|Ref|Memo|Context|Pathname|Router)\s*\(/);
    }
  });

  it("(k) Footer e main[data-trilha] NÃO migraram para o layout (ADR-0025 § 1)", () => {
    const src = codeOf("app/layout.tsx");

    expect(src).not.toContain("Footer");
    expect(src).not.toContain("data-trilha");
    expect(src).not.toContain("<main");
  });
});
