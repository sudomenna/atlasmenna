import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { cascaVaziaNoDocumento, esperarRedeOciosa, instalarProjecaoLocal } from "./_apoio-local";
import { CSS_LISTAS_DEPUTADO_VISIVEIS, SELETOR_LISTA_DEPUTADO } from "./_isencoes-axe";

/**
 * tests/e2e/deputado-listas.spec.ts — spec 026, U11 (RF-277), fechado na
 * correção da auditoria G6 (30/09).
 *
 * O portão geral (`a11y-audit.spec.ts`) abre `/uf/SP/deputado-federal` e
 * audita o TOPO da página. As listas por agremiação têm
 * `content-visibility: auto` (exceção conhecida, decisão do dono em 30/09):
 * longe da tela o navegador as pula, e dois defeitos ficavam invisíveis ali.
 *
 *   1. **Rolagem horizontal no celular** (WCAG 1.4.10). O botão "Mostrar
 *      todos os 71 candidatos de PT/PC do B/PV" media 366 px e não quebrava
 *      (`whitespace-nowrap` do `<Button>`); a página ia de 375 para 382 px de
 *      largura — e de 320 para 382. Só aparecia com a lista em tela: pulada,
 *      ela não tem largura.
 *   2. **Contraste nunca medido** das linhas longe da tela: o axe declara
 *      "não consegui decidir" (`bgOverlap` e afins) e segue.
 *
 * Por isso aqui cada lista é TRAZIDA à tela (rolagem em passos até o fim),
 * fechada e aberta (21–60 visíveis), a 375 e a 320 px. Asserções: zero
 * rolagem horizontal com a página como ela é servida; zero violação do axe
 * na página como ela é servida; e, com o `content-visibility` DESLIGADO
 * (todas as agremiações montadas), zero violação e nenhum contraste
 * indecidido além da marca do masthead — sem isenção de lista nenhuma.
 *
 * Como rodar: `pnpm build:e2e && pnpm start:e2e`, e `pnpm test:e2e` noutro
 * terminal (ver o cabeçalho de `a11y-audit.spec.ts`).
 *
 * Spec 027 (RF-289), 2026-10-03: as mesmas asserções nas duas páginas de UF
 * das assembleias — SP estadual (o pior caso: 26 agremiações de até 95
 * candidatos, nomes de 30 caracteres acentuados, lista 61+) e o DF distrital
 * (listas de até 28, sem lista 61+) —, e um percurso por TECLADO nas três:
 * chegar ao seletor da casa e à primeira lista só com Tab, abrir com Enter e,
 * onde há lista 61+, carregar o resto e receber o foco na 61ª.
 */

const ROTAS = ["/uf/SP/deputado-federal", "/uf/SP/deputado-estadual", "/uf/DF/deputado-distrital"];
const LARGURAS = [375, 320] as const;

/** Rola a página inteira em passos de 80% da altura, para cada agremiação entrar em tela. */
async function trazerTodasAsListasATela(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const quadro = () =>
      new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const passo = Math.max(200, Math.floor(window.innerHeight * 0.8));
    for (let y = 0; y <= document.documentElement.scrollHeight; y += passo) {
      window.scrollTo(0, y);
      await quadro();
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await quadro();
  });
}

/** Largura rolável do documento e quem passa da borda direita (para a mensagem). */
async function medirTransbordo(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const quem: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > de.clientWidth + 0.5) {
        const id = el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : "";
        quem.push(`${el.tagName.toLowerCase()}${id} → ${Math.round(r.right)}px`);
      }
    }
    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      quem: quem.slice(0, 10),
    };
  });
}

// Duas passadas do axe numa página de ~1.000 linhas (a segunda com todas as
// agremiações montadas) passam dos 30 s padrão no WebKit sob carga.
test.describe.configure({ mode: "parallel", timeout: 120_000 });

for (const ROTA of ROTAS) {
  for (const largura of LARGURAS) {
    for (const abertas of [false, true]) {
      const estado = abertas ? "abertas (21–60)" : "fechadas";
      test(`listas de Deputado em ${ROTA} @ ${largura}px, ${estado}: sem rolagem horizontal, axe limpo`, async ({
        page,
        baseURL,
      }) => {
        await page.setViewportSize({ width: largura, height: 812 });
        await instalarProjecaoLocal(page, baseURL);
        const resposta = await page.goto(ROTA, { waitUntil: "load" });
        expect(resposta?.ok(), `sem resposta 2xx para ${ROTA}`).toBe(true);
        expect(
          cascaVaziaNoDocumento(await page.content(), baseURL),
          `${ROTA} veio com a casca "sem dados" — o .next não saiu do \`pnpm build:e2e\`?`,
        ).toEqual([]);

        const listas = page.locator(SELETOR_LISTA_DEPUTADO);
        // SP com o Blob servido pelo falso tem dezenas de agremiações; sem lista
        // nenhuma o teste estaria medindo "Detalhe indisponível".
        expect(await listas.count(), "nenhuma lista de agremiação na página").toBeGreaterThan(5);

        if (abertas) {
          const botoes = page.locator('[data-testid="dep-ver-mais"]');
          const n = await botoes.count();
          expect(
            n,
            "nenhum 'mais candidatos' — a fixture de SP perdeu a faixa 21–60?",
          ).toBeGreaterThan(0);
          for (let i = 0; i < n; i++) {
            const b = botoes.nth(i);
            await b.scrollIntoViewIfNeeded();
            await b.click();
            await expect(b).toHaveAttribute("aria-expanded", "true");
          }
          // Toda lista que tinha faixa 2 está aberta, e as linhas 21+ têm altura.
          const alturaDa21: number[] = await page.evaluate((sel) => {
            return [...document.querySelectorAll(`${sel} ol`)]
              .filter((ol) => ol.querySelector('li[data-rank="21"]'))
              .map((ol) => {
                ol.scrollIntoView();
                return (
                  ol.querySelector('li[data-rank="21"]') as HTMLElement
                ).getBoundingClientRect().height;
              });
          }, SELETOR_LISTA_DEPUTADO);
          expect(alturaDa21.length).toBeGreaterThan(0);
          expect(
            alturaDa21.filter((h) => h <= 0),
            "linha 21 sem altura com a lista aberta",
          ).toEqual([]);
        }

        await trazerTodasAsListasATela(page);
        const t = await medirTransbordo(page);
        expect(
          t.scrollWidth,
          `rolagem horizontal a ${largura}px (${estado}): documento com ${t.scrollWidth}px ` +
            `(body ${t.bodyScrollWidth}px) numa tela de ${t.clientWidth}px. Passam da borda: ` +
            JSON.stringify(t.quem),
        ).toBeLessThanOrEqual(t.clientWidth);

        const rede = await esperarRedeOciosa(page);
        expect(rede.ociosa, `rede não ficou ociosa: ${rede.emVoo.slice(0, 3).join(", ")}`).toBe(
          true,
        );

        // De volta ao topo antes do axe (2026-10-03). Parada no FIM da página,
        // a barra do topo (`sticky top-0`) fica por cima do que estiver atrás
        // dela, e o axe declara "não decidi" para o subtítulo da barra
        // (`elmPartiallyObscuring`) ou para o parágrafo que passa por baixo
        // (`bgOverlap`) — o que estava atrás dependia de quanto a página
        // media, e a 320 px a frente U-b da spec 027 (seletor da casa, aba
        // "Deputados") mudou a altura e trouxe o caso à tona também no
        // federal. No topo nada passa por baixo da barra. A segunda passada
        // (listas todas montadas, abaixo) não depende da rolagem.
        await page.evaluate(
          () =>
            new Promise<void>((r) => {
              window.scrollTo(0, 0);
              requestAnimationFrame(() => requestAnimationFrame(() => r()));
            }),
        );

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        await test
          .info()
          .attach(
            `axe-dep-listas${ROTA.replace(/\//g, "_")}-${largura}-${abertas ? "abertas" : "fechadas"}.json`,
            {
              body: JSON.stringify(
                { violations: results.violations, incomplete: results.incomplete },
                null,
                2,
              ),
              contentType: "application/json",
            },
          );
        expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);

        // Contraste de TODAS as linhas: com o `content-visibility` desligado, o
        // navegador monta cada agremiação e o axe decide o contraste de cada nó.
        // Nenhuma isenção de lista aqui; só a marca do masthead, que o axe
        // reporta como "parcialmente encoberta" em toda página (isenção antiga
        // de `a11y-audit.spec.ts`).
        await page.addStyleTag({ content: CSS_LISTAS_DEPUTADO_VISIVEIS });
        await page.evaluate(
          () =>
            new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );
        const montadas = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(montadas.violations, JSON.stringify(montadas.violations, null, 2)).toEqual([]);
        const indecididos = montadas.incomplete
          .filter((v) => v.id === "color-contrast")
          .flatMap((v) =>
            v.nodes.map((n) => ({
              alvo: String(n.target[0] ?? ""),
              motivos: n.any.map((c) =>
                String((c.data as { messageKey?: string })?.messageKey ?? ""),
              ),
            })),
          )
          .filter((n) => !n.alvo.includes("top-bar-brand"));
        expect(indecididos, "contraste que o axe não decidiu com as listas montadas").toEqual([]);
      });
    }
  }
}

/**
 * Percurso por teclado (RF-289): só `Tab`, `Shift+Tab` e `Enter`, a 375 px.
 * Devolve o rótulo do elemento focado a cada `Tab` até `alvo` casar — ou
 * `null` se o teto de passos acabar (o elemento não é alcançável).
 */
async function tabAte(page: Page, alvo: string, teto = 400): Promise<string[] | null> {
  const passos: string[] = [];
  for (let i = 0; i < teto; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate((sel) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { casou: false, rotulo: "body" };
      return {
        casou: el.matches(sel),
        rotulo: `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ""}`,
      };
    }, alvo);
    passos.push(r.rotulo);
    if (r.casou) return passos;
  }
  return null;
}

for (const ROTA of ROTAS) {
  test(`teclado em ${ROTA} @ 375px: seletor da casa e lista alcançáveis, Enter abre, foco visível`, async ({
    page,
    baseURL,
    browserName,
  }) => {
    // No WebKit o Tab NÃO passa por links (preferência "acesso total pelo
    // teclado" do macOS; só Option+Tab passa) — medido em 03/10: o seletor da
    // casa, que é `<a>`, fica fora do percurso e o teste mediria o navegador,
    // não a página. O percurso é medido no Chromium.
    test.skip(browserName === "webkit", "WebKit não leva o Tab a links por padrão");
    await page.setViewportSize({ width: 375, height: 812 });
    await instalarProjecaoLocal(page, baseURL);
    const resposta = await page.goto(ROTA, { waitUntil: "load" });
    expect(resposta?.ok(), `sem resposta 2xx para ${ROTA}`).toBe(true);
    expect(cascaVaziaNoDocumento(await page.content(), baseURL)).toEqual([]);

    // O seletor federal × estadual/distrital vem ANTES das listas na ordem de Tab.
    const ateSeletor = await tabAte(page, '[data-testid="seletor-deputado"] a');
    expect(ateSeletor, "o seletor da casa não é alcançável por Tab").not.toBeNull();

    const ateLista = await tabAte(page, '[data-testid="dep-ver-mais"]');
    expect(ateLista, "nenhum 'mais candidatos' alcançável por Tab").not.toBeNull();
    const botao = page.locator(":focus");
    // Foco VISÍVEL (WCAG 2.4.7): o navegador o declara `:focus-visible` e há
    // contorno desenhado.
    const visivel = await botao.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        focusVisible: el.matches(":focus-visible"),
        contorno: cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) > 0,
        sombra: cs.boxShadow !== "none",
      };
    });
    expect(visivel.focusVisible).toBe(true);
    expect(visivel.contorno || visivel.sombra, JSON.stringify(visivel)).toBe(true);

    await expect(botao).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(botao).toHaveAttribute("aria-expanded", "true");
    // O foco continua no botão (nada o joga no `<body>`).
    expect(await botao.evaluate((el) => el === document.activeElement)).toBe(true);

    // Lista 61+ (só onde há — SP): o próximo Tab é "mostrar todos" da MESMA
    // agremiação; Enter carrega e o foco vai para a 61ª linha.
    const temTodos = await page
      .locator('[data-testid="dep-lista-agremiacao"]')
      .filter({ has: botao })
      .locator('[data-testid="dep-mostrar-todos"]')
      .count();
    if (temTodos > 0) {
      await page.keyboard.press("Tab");
      const todos = page.locator(":focus");
      await expect(todos).toHaveAttribute("data-testid", "dep-mostrar-todos");
      await page.keyboard.press("Enter");
      await expect
        .poll(() =>
          page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.rank ?? ""),
        )
        .toBe("61");
    }
  });
}
