/**
 * tests/unit/shell/static-shell.test.ts
 *
 * **Este é o teste que prova a restrição dura do ADR-0029 § 2**: os dois
 * controles globais novos (turno e "Parcial / Projeção") não tornam nenhuma
 * rota dinâmica.
 *
 * ## Por que a prova é sobre o FONTE e não sobre o render
 *
 * "A rota continua estática" não é observável em `renderToStaticMarkup`: a
 * árvore renderiza igual com ou sem `cookies()`. Quem decide é o compilador
 * do Next, e o gatilho é sintático — **importar ou chamar** `cookies()`,
 * `headers()`, `connection()`, ou receber `searchParams` numa página, opta a
 * rota para render dinâmico (ADR-0025 § 2 e § 5). A única forma de gatear
 * isso sem rodar `next build` (que aqui reconstruiria o servidor de produção
 * em uso) é varrer o fonte do shell atrás desses gatilhos.
 *
 * O sinal negativo é fraco sozinho, então o teste também fixa os dois
 * mecanismos POSITIVOS que substituem as APIs dinâmicas:
 *
 *   - turno vem de `currentPresidentialTurno()`, função pura do calendário (ADR-0012);
 *   - "Parcial / Projeção" vem de `data-view` no `<html>`, escrito
 *     estaticamente pelo layout a partir de `VIEW_MODE_DEFAULT` e trocado no
 *     cliente pela store.
 *
 * Se alguém trocar qualquer um dos dois por `searchParams`, este teste falha
 * — que é exatamente o momento em que as 54 páginas de UF deixariam de ser
 * pré-renderizadas.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { VIEW_MODE_DEFAULT } from "@/lib/state/view-mode";

const ROOT = process.cwd();

/** Todo arquivo que participa do shell renderizado em TODAS as rotas. */
const SHELL_FILES = [
  "app/layout.tsx",
  "components/layout/TopBar.tsx",
  "components/layout/TabBar.tsx",
  "components/layout/CargoTabs.tsx",
  "components/layout/ShellControls.tsx",
  "components/layout/ShellLiveBadge.tsx",
  "components/layout/TurnoSwitch.tsx",
  "components/atoms/controls/ViewModeSwitch.tsx",
  "components/atoms/controls/ThemeToggle.tsx",
  "components/layout/AtualizacaoAutomatica.tsx",
  "components/layout/atualizacao-estado.ts",
] as const;

/**
 * Gatilhos de render dinâmico do App Router. Cada padrão casa a FORMA DE USO
 * (chamada ou destructuring de prop), não a palavra solta — comentários que
 * explicam por que a API não é usada não devem reprovar o teste, e há vários
 * deles nesses arquivos justamente documentando esta restrição.
 */
const DYNAMIC_APIS: ReadonlyArray<{ nome: string; padrao: RegExp }> = [
  { nome: "cookies()", padrao: /\bcookies\s*\(\s*\)/ },
  { nome: "headers()", padrao: /\bheaders\s*\(\s*\)/ },
  { nome: "draftMode()", padrao: /\bdraftMode\s*\(\s*\)/ },
  { nome: "connection()", padrao: /\bconnection\s*\(\s*\)/ },
  { nome: "searchParams (prop)", padrao: /searchParams\s*[:}]/ },
  { nome: 'import de "next/headers"', padrao: /from\s+["']next\/headers["']/ },
  // Não torna a rota dinâmica, mas num Client Component do shell faz o Next
  // desistir do pré-render até o `<Suspense>` mais próximo — no layout, a
  // página inteira vira render de cliente. `<AtualizacaoAutomatica>` lê só
  // `usePathname()` por isso.
  { nome: "useSearchParams()", padrao: /\buseSearchParams\s*\(/ },
];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

/** Remove comentários de linha e de bloco antes de varrer o código. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("shell estático (ADR-0029 § 2 — restrição dura)", () => {
  for (const rel of SHELL_FILES) {
    it(`(a) ${rel} não usa nenhuma API que torna a rota dinâmica`, () => {
      const code = stripComments(read(rel));
      for (const { nome, padrao } of DYNAMIC_APIS) {
        expect(
          padrao.test(code),
          `${rel} usa ${nome} — isso tira a home e as 54 páginas de UF do pré-render estático (ADR-0025 §§ 2 e 5).`,
        ).toBe(false);
      }
    });
  }

  it("(b) o seletor de turno sai do calendário (função pura), não de requisição", () => {
    const code = stripComments(read("components/layout/TurnoSwitch.tsx"));
    expect(code).toContain("currentPresidentialTurno");
    expect(code).toContain('from "@/lib/config/calendar"');
    // `lib/config/calendar.ts` é o contrato: nenhum I/O, só o relógio.
    const calendario = read("lib/config/calendar.ts");
    expect(calendario).not.toMatch(/\bfetch\s*\(/);
    expect(calendario).not.toMatch(/from\s+["']@vercel\/edge-config["']/);
  });

  it("(c) o layout escreve `data-view` estaticamente, a partir da constante da store", () => {
    const code = read("app/layout.tsx");
    expect(code).toContain("data-view={VIEW_MODE_DEFAULT}");
    expect(code).toContain('from "@/lib/state/view-mode"');
    // Se o default mudar sem o `<html>` acompanhar, o primeiro render do
    // cliente diverge do HTML do servidor e a hidratação é descartada.
    expect(VIEW_MODE_DEFAULT).toBe("parcial");
  });

  it("(c2) nenhum módulo alcançado pelo Server Component do layout importa React", () => {
    // Esta é a única guarda contra uma classe de erro que passa em TUDO — typecheck,
    // lint e vitest — e só quebra no `next build`:
    //
    //   "You're importing a module that depends on `useSyncExternalStore` into a
    //    React Server Component module."
    //
    // Aconteceu de verdade em 2026-09-08: `lib/state/view-mode.ts` juntava a
    // constante que `app/layout.tsx` (servidor) lê com o hook da store, e o build
    // inteiro caiu. A correção foi partir o módulo: contrato neutro em
    // `view-mode.ts`, store com a diretiva em `view-mode-client.ts`.
    //
    // A regra: todo módulo que o layout importa por caminho relativo a `@/lib`
    // precisa ser neutro — sem `from "react"` e sem `"use client"`.
    const layout = stripComments(read("app/layout.tsx"));
    const importados = [...layout.matchAll(/from\s+["']@\/(lib\/[^"']+)["']/g)].map((m) => m[1]);
    expect(importados.length, "o layout deveria importar algo de @/lib").toBeGreaterThan(0);

    for (const rel of importados) {
      const arquivo = [`${rel}.ts`, `${rel}.tsx`, `${rel}/index.ts`].find((cand) => {
        try {
          read(cand);
          return true;
        } catch {
          return false;
        }
      });
      expect(arquivo, `não encontrei o arquivo de @/${rel}`).toBeTruthy();
      const code = stripComments(read(arquivo as string));
      expect(
        /from\s+["']react["']/.test(code),
        `@/${rel} importa React e é alcançado por app/layout.tsx (Server Component) — o next build recusa. Parta o módulo: contrato neutro de um lado, hooks com "use client" do outro.`,
      ).toBe(false);
      expect(
        /^\s*["']use client["']/m.test(code),
        `@/${rel} declara "use client" e é importado pelo layout — todos os exports viram client reference.`,
      ).toBe(false);
    }
  });

  it("(d) o shell não lê Edge Config — o selo de apuração chega por custom property", () => {
    for (const rel of SHELL_FILES) {
      const code = stripComments(read(rel));
      expect(
        /from\s+["']@\/lib\/edge-config\//.test(code),
        `${rel} lê Edge Config dentro do shell; o percentual do selo deve chegar por --live-pct-label (ver ShellLiveBadge.tsx).`,
      ).toBe(false);
    }
    expect(read("components/layout/ShellLiveBadge.module.css")).toContain("--live-pct-label");
    expect(read("app/(pres)/page.tsx")).toContain("--live-pct-label");
  });

  it("(e) só TRÊS componentes do shell são Client Component — o custo em JS é eles", () => {
    // `<ViewModeSwitch>` (ADR-0029 § 2) e `<ThemeToggle>` (ADR-0025 § 5)
    // escrevem um atributo no `<html>` e deixam a cascata do `app/globals.css`
    // resolver o resto, sem obrigar nenhum componente de dado — nem o
    // `<TopBar>`, que os hospeda — a virar client.
    //
    // O terceiro, `<AtualizacaoAutomatica>` (04/10/2026, decisão do dono:
    // atualização automática para todos), não renderiza nada: agenda
    // `router.refresh()` a cada minuto nas rotas de apuração. Custa o próprio
    // código — `next/navigation` e React já estão no bundle de toda rota.
    // O contrato dele (`atualizacao-estado.ts`) é módulo neutro, SEM diretiva.
    //
    // Qualquer quarto nome aqui é um custo novo em JS acima da dobra em TODAS
    // as rotas, contra o teto de 150 KiB do RNF-007a: exige justificativa.
    const client = SHELL_FILES.filter((rel) => /^\s*["']use client["']/m.test(read(rel)));
    expect(client.slice().sort()).toEqual([
      "components/atoms/controls/ThemeToggle.tsx",
      "components/atoms/controls/ViewModeSwitch.tsx",
      "components/layout/AtualizacaoAutomatica.tsx",
    ]);
  });

  it("(e2) o contrato da atualização é neutro, e o componente é montado depois das abas do rodapé", () => {
    // Sem diretiva e sem React: se um Server Component (o `<Footer>`, por
    // exemplo) importar uma constante daqui, ela continua sendo a constante —
    // e não uma referência de cliente que lança (a armadilha de
    // `components/blocks/_lista-por-base.ts`).
    const contrato = stripComments(read("components/layout/atualizacao-estado.ts"));
    expect(/^\s*["']use client["']/m.test(contrato)).toBe(false);
    expect(/from\s+["']react["']/.test(contrato)).toBe(false);

    const layout = stripComments(read("app/layout.tsx"));
    expect(layout).toContain('from "@/components/layout/AtualizacaoAutomatica"');
    expect(layout.indexOf('<CargoTabs placement="bottom" />')).toBeLessThan(
      layout.indexOf("<AtualizacaoAutomatica />"),
    );
  });

  it("(f) o tema é aplicado antes do primeiro paint, e persiste em localStorage", () => {
    // ADR-0025 § 5, as duas metades:
    //   - localStorage e NUNCA cookie (cookie => `cookies()` no layout => as 54
    //     páginas de UF deixam de ser pré-renderizadas);
    //   - script inline e síncrono no `<body>`, senão a página pisca clara
    //     antes de escurecer.
    const contrato = read("lib/state/theme.ts");
    expect(contrato).toContain("localStorage.getItem");
    expect(contrato).toContain("prefers-color-scheme: dark");
    expect(contrato, "o script anti-flash não pode virar módulo carregado").not.toMatch(
      /\bdocument\.cookie\b/,
    );

    const store = read("lib/state/theme-client.ts");
    expect(store).toContain("localStorage.setItem");
    expect(store, "a preferência de tema não pode ir para cookie").not.toMatch(
      /\bdocument\.cookie\b/,
    );

    const layout = read("app/layout.tsx");
    // Inline: `dangerouslySetInnerHTML` com a constante, sem `src`, sem
    // `defer`/`async` — as três coisas que fariam o script rodar tarde demais.
    expect(layout).toContain("dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}");
    expect(layout).toMatch(/<script dangerouslySetInnerHTML/);
    // O `<html>` não pode renderizar `data-theme`: o servidor não conhece a
    // preferência, e um valor ali só para o script sobrescrever é divergência
    // de hidratação de verdade.
    expect(stripComments(layout)).not.toMatch(/data-theme=/);
    expect(layout).toContain("suppressHydrationWarning");
  });
});
