/**
 * tests/e2e/serie-apuracao-a11y.spec.tsx — RF-176(e), spec 020.
 *
 * ## Por que este arquivo existe, e por que ele NÃO é o `a11y-audit.spec.ts`
 *
 * O RF-176 começa com **"WHEN o gráfico renderiza com dado"**. A aceitação (e)
 * pede axe sem violação nas 4 rotas × 2 temas × 2 viewports.
 *
 * 🔴 **Em 2026-09-18 o portão das rotas não conseguia cumprir (e), e passava
 * verde assim mesmo.** Medido contra o site publicado naquele dia: as 4 rotas
 * que carregam o gráfico servem
 *
 *     <figure data-testid="serie-apuracao-chart" data-estado="indisponivel">
 *       A evolução da apuração em Brasil ainda não chegou — a série por
 *       candidatura ainda não é publicada.
 *
 * — ou seja, o estado VAZIO, que é justamente aquele em que o RF-176 **não se
 * aplica**. Rodar axe ali audita um parágrafo de aviso e devolve verde sobre um
 * gráfico que nunca foi desenhado. A série só existirá em produção quando a
 * ingestão rodar (simulado de 22–24/09).
 *
 * Este arquivo cobre a **substância** de (e) sem esperar por isso: renderiza o
 * componente — que é Server Component puro, sem estado e sem `"use client"` —
 * para HTML com uma série real, injeta o CSS COMPILADO do site publicado (é de
 * lá que vêm os tokens de cor; sem ele o axe mediria contraste contra o branco
 * padrão do navegador e o resultado não valeria nada) e roda axe sobre o
 * resultado, nos 2 temas e nos 2 viewports.
 *
 * ⚠️ **O que ele NÃO fecha:** (e) na letra pede as 4 ROTAS. O gráfico dentro da
 * página real pode herdar contexto que aqui não existe — empilhamento, um pai
 * com `background` diferente, um `aria-hidden` de avô. Quando a série chegar em
 * produção, `a11y-audit.spec.ts` passa a cobrir isso sozinho e fecha (e) na
 * letra. Até lá, os dois juntos cobrem mais do que qualquer um sozinho, e
 * nenhum dos dois cobre tudo.
 *
 * ## As duas fixtures, e por que estas
 *
 * 1. **Presidencial, `vagas=1`** — o caso comum, 4 candidaturas, com um furo
 *    (`null`) no meio de uma série, que é o que produz o texto "sem medição"
 *    do RF-176(c).
 * 2. **Senador, `vagas=2`** — o caso mais arriscado da spec inteira: é o único
 *    que liga o destaque por ESPESSURA de traço e a régua da 2ª vaga (RF-173).
 *    Destaque visual cuja única tradução textual vive na legenda da tabela
 *    `sr-only` é exatamente a forma de defeito que o axe nas rotas não pegaria
 *    e um leitor de tela sentiria.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];
const THEMES = ["light", "dark"] as const;

/**
 * As fixtures são renderizadas por `_serie-fixture-render.tsx` num processo
 * separado — o porquê está no cabeçalho daquele arquivo, e é uma limitação do
 * Playwright, não uma escolha. Uma invocação por corrida.
 */
const FIXTURES: Record<string, string> = JSON.parse(
  execFileSync(
    process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx",
    [
      // `.css` de CSS Module importado pelo gráfico (desde 34783b3) — ver
      // `_css-stub-loader.mjs`.
      "--import",
      `./${path.join("tests", "e2e", "_css-stub-register.mjs")}`,
      path.join("tests", "e2e", "_serie-fixture-render.tsx"),
    ],
    { cwd: process.cwd(), encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 },
  ),
);

// Guarda do instrumento, antes de qualquer teste rodar: se o renderizador
// devolver o estado VAZIO, o axe auditaria um parágrafo de aviso e o verde não
// valeria nada — que é exatamente o furo que este arquivo existe para tapar.
for (const [nome, html] of Object.entries(FIXTURES)) {
  if (!html.includes('data-estado="ok"') || !html.includes("data-traco")) {
    throw new Error(
      `fixture "${nome}" não desenhou o gráfico (esperava data-estado="ok" e traçados). ` +
        "Auditar isto seria auditar o estado vazio.",
    );
  }
}

/**
 * O CSS compilado do site publicado, buscado UMA vez por corrida.
 *
 * Sem ele o axe mede contraste contra o branco padrão do navegador, e toda cor
 * `var(--party-*)` resolve para vazio — o teste ficaria verde por não haver cor
 * nenhuma para reprovar. É o modo de falha "teste que não discrimina" do
 * `docs/reference/risks.md`, e por isso a ausência de CSS aborta o teste.
 */
let cssCache: string | null = null;

async function cssDoSitePublicado(
  request: import("@playwright/test").APIRequestContext,
  baseURL: string,
): Promise<string> {
  if (cssCache !== null) return cssCache;
  const home = await request.get(baseURL);
  expect(home.ok(), `não consegui buscar ${baseURL} para descobrir o CSS compilado`).toBe(true);
  const html = await home.text();
  const hrefs = [...new Set([...html.matchAll(/\/_next\/static\/[^"']*?\.css/g)].map((m) => m[0]))];
  expect(hrefs.length, `nenhum <link rel=stylesheet> encontrado em ${baseURL}`).toBeGreaterThan(0);

  const partes: string[] = [];
  for (const href of hrefs) {
    const r = await request.get(`${baseURL}${href}`);
    expect(r.ok(), `CSS ${href} não veio`).toBe(true);
    partes.push(await r.text());
  }
  const css = partes.join("\n");
  // Guarda do instrumento: se os tokens de partido não estiverem aqui, o
  // contraste medido abaixo é ficção.
  expect(
    css,
    "o CSS baixado não contém os tokens de partido — o axe mediria cor nenhuma",
  ).toContain("--party-pt");
  cssCache = css;
  return css;
}

test.describe.configure({ mode: "parallel" });

for (const [nomeFixture, htmlFixture] of Object.entries(FIXTURES)) {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`axe série ${nomeFixture} @ ${viewport.name} (${theme})`, async ({
        page,
        request,
        baseURL,
      }) => {
        const base = baseURL ?? "http://localhost:3100";
        const css = await cssDoSitePublicado(request, base);

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.setContent(
          `<!doctype html><html lang="pt-BR" data-theme="${theme}"><head>
             <meta charset="utf-8"><title>Série da apuração — ${nomeFixture}</title>
             <style>${css}</style>
           </head><body><main>${htmlFixture}</main></body></html>`,
          { waitUntil: "load" },
        );

        // A guarda do instrumento outra vez, agora no DOM: se o gráfico não
        // desenhou, não há o que auditar e o verde seria vazio.
        const tracos = await page.locator("path[data-traco]").count();
        expect(tracos, "o gráfico não desenhou nenhum traçado — nada a auditar").toBeGreaterThan(0);

        // Terceira guarda do instrumento: **o CSS aplicou?** Baixar o arquivo e
        // injetá-lo não prova que o navegador o usou. Se um `<style>` gigante
        // falhasse em silêncio, o fundo cairia no branco padrão, toda
        // `var(--party-*)` resolveria para vazio, e o axe daria verde por não
        // haver cor nenhuma para reprovar — verde vazio, o modo de falha que
        // `docs/reference/risks.md` chama de "teste que não discrimina".
        //
        // Os valores vêm dos tokens: claro `rgb(243, 244, 246)`, escuro
        // `rgb(20, 23, 27)`. Medidos em 18/09. São diferentes ENTRE SI, então
        // esta asserção também prova que `data-theme` está trocando o tema — um
        // teste que rodasse os dois temas sobre a mesma paleta seria dois testes
        // idênticos disfarçados.
        const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(fundo, `o CSS do site publicado não aplicou no tema ${theme}`).toBe(
          theme === "dark" ? "rgb(20, 23, 27)" : "rgb(243, 244, 246)",
        );

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();

        const graves = results.violations.filter(
          (v) => v.impact === "critical" || v.impact === "serious",
        );

        await test.info().attach(`axe-serie-${viewport.name}-${theme}.json`, {
          body: JSON.stringify(
            { violations: results.violations, incomplete: results.incomplete },
            null,
            2,
          ),
          contentType: "application/json",
        });

        expect(graves, JSON.stringify(results.violations, null, 2)).toEqual([]);

        // ---------------------------------------------------------------
        // O que o axe NÃO mede, e por isso é medido aqui
        // ---------------------------------------------------------------
        // O axe joga o contraste de todo `<text>` de SVG no balde `incomplete`
        // — "could not be determined because element contains an image node" —
        // e `incomplete` não reprova nada. Medido em 18/09: 4 nós no caso
        // presidencial, 6 no de senador, TODOS eles rótulo de eixo ou a régua
        // da 2ª vaga. Ou seja: o texto que orienta a leitura do gráfico inteiro
        // era o texto que ninguém conferia.
        //
        // Aqui a razão é calculada na mão, pela fórmula de luminância relativa
        // da WCAG, contra o fundo efetivo da página. É TEXTO, então o piso é o
        // 4,5:1 do RNF-022 — não o 3:1 de não-texto do RNF-035.
        //
        // Medido em 18/09, nas duas fixtures: 5,52:1 no claro
        // (`rgb(91, 99, 110)`) e 6,9:1 no escuro (`rgb(154, 161, 171)`). Passa
        // com folga; a guarda existe para que continue passando.
        const textosSvg = await page.evaluate(() => {
          const lum = (c: string) => {
            const canais = c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0, 0, 0];
            const [r = 0, g = 0, b = 0] = canais.map((v) => {
              const x = v / 255;
              return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const lFundo = lum(getComputedStyle(document.body).backgroundColor);
          return [...document.querySelectorAll("svg text")].map((t) => {
            const lTexto = lum(getComputedStyle(t).fill);
            return {
              alvo: t.getAttribute("data-testid") ?? t.textContent?.slice(0, 24) ?? "?",
              razao:
                Math.round(
                  ((Math.max(lTexto, lFundo) + 0.05) / (Math.min(lTexto, lFundo) + 0.05)) * 100,
                ) / 100,
            };
          });
        });

        expect(
          textosSvg.length,
          "nenhum <text> de SVG encontrado — a medição seria vazia",
        ).toBeGreaterThan(3);
        const svgAbaixoDoPiso = textosSvg.filter((t) => t.razao < 4.5);
        expect(
          svgAbaixoDoPiso,
          `texto de SVG abaixo do piso de 4,5:1 do RNF-022 — o axe NÃO reprova isto, ` +
            `ele cai em "incomplete":\n${JSON.stringify(textosSvg, null, 2)}`,
        ).toEqual([]);

        // E a guarda de natureza, igual à de `a11y-audit.spec.ts`: enquanto todo
        // indecidido for `<text>` de SVG — que é o caso medido acima na mão —
        // segue verde. Um parágrafo ou botão indecidido fica vermelho, porque aí
        // o "0 violações" acima estaria mentindo.
        const indecididosNaoSvg = results.incomplete
          .filter((v) => v.id === "color-contrast")
          .flatMap((v) => v.nodes.map((n) => String(n.target[0] ?? "")))
          .filter((alvo) => !/^text[[.:]/.test(alvo));
        expect(
          indecididosNaoSvg,
          `axe não decidiu o contraste destes elementos NÃO-SVG:\n${JSON.stringify(indecididosNaoSvg, null, 2)}`,
        ).toEqual([]);
      });
    }
  }
}
