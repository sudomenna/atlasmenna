import { expect, test } from "@playwright/test";

/**
 * tests/e2e/municipio-sheet.spec.ts
 *
 * S07/Bloco 2 — a folha do município (`<Sheet>`), aberta ao tocar num
 * município da tabela em `/uf/[sigla]`.
 *
 * Por que e2e e não vitest: a suíte unitária renderiza por
 * `renderToStaticMarkup`, que não hidrata nem dispara eventos. Os testes de
 * integração fixam o CONTRATO (o botão existe, tem 44px, carrega o
 * `cod_ibge`); a ABERTURA — foco que entra no diálogo, Esc que fecha, foco que
 * volta para quem abriu — só é observável num browser de verdade, e é
 * exatamente a parte de acessibilidade que o `<Sheet>` promete (WCAG 2.1.2).
 *
 * Roda contra o servidor de produção em `PLAYWRIGHT_BASE_URL` (default
 * `http://localhost:3100`, o `pnpm start:e2e`). **Precisa de um build que inclua o Bloco 2** — num
 * build anterior a ele a página de UF não tem botões de município e o primeiro
 * `expect` falha por ausência, não por regressão.
 *
 * A rota `/uf/SP` é pré-renderizada estática; se o Edge Config não estiver
 * populado, o payload não traz municípios e a tabela não existe. O spec pula
 * nesse caso em vez de reprovar — não há folha a abrir quando não há município.
 */

const UF = "SP";

test.describe("folha do município", () => {
  test("tocar num município abre o Sheet, Esc fecha e devolve o foco", async ({ page }) => {
    await page.goto(`/uf/${UF}`);

    const botoes = page.getByTestId("municipio-open");
    const total = await botoes.count();
    test.skip(total === 0, "payload sem municípios nesta UF — não há folha a abrir");

    const primeiro = botoes.first();
    // 🔴 Só o NOME, sem o kicker. Desde 2026-09-20 a lista ordena por
    // eleitorado em todas as rotas de estado, então o primeiro botão de SP é
    // a capital — e o rótulo do botão passou a ser "São Paulo · capital", que
    // é uma string que a folha não contém em nenhum lugar (ela imprime
    // "Município · SP · capital" no kicker e "São Paulo" no título).
    const nome = (await primeiro.textContent())?.split("·")[0]?.trim();
    await primeiro.click();

    // Abriu, é um diálogo nomeado pelo município, e o foco entrou nele.
    const sheet = page.getByTestId("sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("role", "dialog");
    if (nome) await expect(sheet).toContainText(nome);
    await expect(sheet).toBeFocused();

    // Os números do município: apurado, votos e ao menos uma linha de candidato.
    await expect(sheet).toContainText("Apurado");
    await expect(sheet).toContainText("Votos apurados");
    expect(await page.getByTestId("municipio-sheet-row").count()).toBeGreaterThan(0);

    // Esc fecha (WCAG 2.1.2 — sem armadilha de teclado) e o foco volta ao botão.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(primeiro).toBeFocused();
  });

  test("o botão do município tem alvo de toque de 44px", async ({ page }) => {
    await page.goto(`/uf/${UF}`);

    const botoes = page.getByTestId("municipio-open");
    test.skip((await botoes.count()) === 0, "payload sem municípios nesta UF");

    const caixa = await botoes.first().boundingBox();
    expect(caixa).not.toBeNull();
    expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
