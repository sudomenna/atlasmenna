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
 */

const ROTA = "/uf/SP/deputado-federal";
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
              return (ol.querySelector('li[data-rank="21"]') as HTMLElement).getBoundingClientRect()
                .height;
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
      expect(rede.ociosa, `rede não ficou ociosa: ${rede.emVoo.slice(0, 3).join(", ")}`).toBe(true);

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      await test
        .info()
        .attach(`axe-dep-listas-${largura}-${abertas ? "abertas" : "fechadas"}.json`, {
          body: JSON.stringify(
            { violations: results.violations, incomplete: results.incomplete },
            null,
            2,
          ),
          contentType: "application/json",
        });
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
