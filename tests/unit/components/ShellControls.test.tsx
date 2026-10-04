// @vitest-environment happy-dom
/**
 * tests/unit/components/ShellControls.test.tsx
 *
 * A segunda linha do `<TopBar>` (ADR-0029 §§ 2–3): navegação de cargo do
 * desktop + os dois controles globais.
 *
 * Além da composição, este arquivo fixa as duas exigências de acessibilidade
 * do § 4 da constituição para controles do shell: **nome acessível** e
 * **estado exposto**. Um `role="tablist"` anônimo é uma lista sem sentido no
 * leitor de tela, e um segmentado sem `aria-selected` não diz onde o leitor
 * está.
 */

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ShellControls } from "@/components/layout/ShellControls";

function parse(node: React.ReactElement): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html");
}

describe("<ShellControls />", () => {
  it("(a) traz o controle parcial/projeção e NÃO traz o seletor de turno (retirado em 2026-10-04)", () => {
    const doc = parse(<ShellControls />);
    expect(doc.querySelector("[data-testid='shell-controls']")).not.toBeNull();
    expect(doc.querySelector("[data-testid='view-mode-switch']")).not.toBeNull();
    // Decisão do dono no 1º turno: sem dado de 2º turno, o seletor sai da
    // barra. Voltar com ele é decisão explícita — este teste tem que mudar junto.
    expect(doc.querySelector("[data-testid='turno-switch']")).toBeNull();
  });

  it("(b) o controle tem nome acessível e estado exposto", () => {
    const doc = parse(<ShellControls />);

    const view = doc.querySelector("[role='tablist']");
    expect(view?.getAttribute("aria-label")).toBe(
      "Números em destaque: parcial apurado ou projeção",
    );
    const tabs = [...(view?.querySelectorAll("[role='tab']") ?? [])];
    expect(tabs.map((t) => t.getAttribute("data-value"))).toEqual(["parcial", "proj"]);
    // Estado exposto: exatamente um selecionado, e é o default da store.
    expect(tabs.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(view?.getAttribute("data-value")).toBe("proj");
  });

  it("(c) o slot de cargo é do caller — o layout continua sendo quem compõe o shell", () => {
    const doc = parse(<ShellControls cargoNav={<nav aria-label="Cargos" />} />);
    expect(doc.querySelector("nav[aria-label='Cargos']")).not.toBeNull();
  });

  it("(d) alvo de toque >= --tap-min no controle (constituição § 4)", () => {
    const html = renderToStaticMarkup(<ShellControls />);
    // 2 do SegmentedControl size="md" (height). Eram 4 com o TurnoSwitch.
    expect([...html.matchAll(/var\(--tap-min\)/g)]).toHaveLength(2);
  });

  it("(e) os controles somem em rota sem corrida — via CSS, não via JS", () => {
    // A regra vive no `.module.css` e depende de `main[data-trilha]`, que só
    // as páginas de corrida emitem (ADR-0019). Verificar aqui é o que impede
    // alguém de "resolver" isso com `usePathname()` no shell, que somaria JS
    // acima da dobra em todas as rotas.
    const css = readFileSync("components/layout/ShellControls.module.css", "utf8");
    expect(css).toMatch(
      /body:not\(:has\(main\[data-trilha\]\)\)\s*\.controls\s*\{[^}]*display:\s*none/,
    );
  });

  it("(f) `.control` e o `<SegmentedControl>` dentro dele abandonam `width: 100%` a partir de 960px — causa real do defeito medido em 1024px", () => {
    // `getBoundingClientRect()` devolve zero no happy-dom — não dá para medir
    // aqui que o controle ficou dentro da janela. O que dá para travar é a
    // causa raiz: `<TurnoSwitch>` (este `.control`) e o `<SegmentedControl>`
    // do `<ViewModeSwitch>` (o `[role="tablist"]` dentro do OUTRO `.control`)
    // carregam `style={{ width: "100%" }}` inline. Isso é correto em mobile
    // (`.controls` tem largura definida ali) e quebra a partir de 960px,
    // quando `.controls` passa a se medir pelo próprio conteúdo: um filho
    // pedindo "100% de um pai sem largura ainda" é a circularidade clássica
    // do flexbox. Medido em 2026-09-20 (Chrome, 1024px): por causa dela,
    // `.controls` computava 351px em vez dos 533px reais, e o
    // `<SegmentedControl>` — que não encolhe (`white-space: nowrap`, sem
    // `min-width: 0` no próprio `[role="tablist"]`) — pintava ~182px para
    // fora da caixa do pai. Isto NÃO é o teste (g) de `flex-wrap`: aquele é
    // rede de segurança e passava (e continuaria passando) com o defeito
    // intacto — os dois filhos da `.row` sempre couberam lado a lado em
    // 1024px; o transbordo nasce um nível abaixo, dentro de `.controls`.
    const css = readFileSync("components/layout/ShellControls.module.css", "utf8");
    const desktop = css.slice(css.indexOf("@media (min-width: 960px)"));
    expect(desktop.length, "media query de 960px não encontrada no CSS").toBeGreaterThan(0);
    expect(desktop).toMatch(/\.control\s*\{[^}]*width:\s*auto\s*!important/);
    expect(desktop).toMatch(/\.control\s*\[role="tablist"\]\s*\{[^}]*width:\s*auto\s*!important/);
  });

  it("(g) a fileira também quebra em duas linhas como margem extra — NÃO é o conserto do defeito de 1024px", () => {
    // `flex-wrap: wrap` na `.row` cobre uma faixa genuína entre 960px e
    // ~974px (onde `cargoNav` + `.controls`, já com a largura REAL de
    // conteúdo do teste (f), não cabem lado a lado) e dá margem para conteúdo
    // futuro. Mas em 1024px — a largura onde o defeito foi medido — os dois
    // filhos da `.row` sempre couberam; travar só isto, sem o teste (f),
    // seria a família "teste que não discrimina" (passa com o controle fora
    // da tela).
    const css = readFileSync("components/layout/ShellControls.module.css", "utf8");
    expect(css).toMatch(/\.row\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
