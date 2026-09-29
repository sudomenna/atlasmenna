import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { esperarMapaMontado, esperarRedeOciosa, instalarProjecaoLocal } from "./_apoio-local";

// `/uf/SP/senador` entra por exigência do RF-176(e): é a ÚNICA rota com
// `vagas=2` e, por isso, a única que renderiza o destaque por espessura e a
// régua da 2ª vaga (RF-173) — o caso mais arriscado da spec 020, justamente
// porque o destaque é visual e sua tradução textual vive só na legenda da
// tabela `sr-only`.
//
// `/governador` e `/sobre-o-modelo` estão fora do escopo da spec 020 e ficam:
// cobrem outras specs, e tirá-las seria reduzir cobertura alheia.
// ---------------------------------------------------------------------------
// 🔴 COMO RODAR ESTE GATE
//
// ✅ **Contra um build de produção LOCAL — passou a funcionar em 2026-09-21.**
//
//     pnpm build && pnpm start:e2e     # 🔴 start:e2e, nunca start nem dev
//     pnpm test:e2e                    # noutro terminal
//
// `start:e2e` é `next start -p 3100` com as 13 variáveis de ESCRITA declaradas
// vazias — o Next carrega o `.env.local` sozinho, e o `DATABASE_URL` de lá é
// produção — e, desde 26/09, com o `EDGE_CONFIG` apontado para o Global Config
// FALSO de `scripts/edge-config-falso.ts` (dado fixo do simulado, nunca o de
// produção).
// Confirme no log do servidor: "[db] DATABASE_URL ausente". Receita completa e
// ressalvas no runbook, § "Rodar os portões e2e na máquina".
//
// Resultado da primeira execução: **64/64 verdes** em 42,6 s (8 rotas ×
// 2 tamanhos × 2 temas × 2 navegadores).
//
// Contra o site PUBLICADO, que continua sendo a medição de referência:
//
//     PLAYWRIGHT_BASE_URL=https://salacofre.vercel.app npx playwright test \
//       tests/e2e/a11y-audit.spec.ts
//
// Resultado em 2026-09-18: 48/48 verdes (eram 6 rotas então). Exige
// `npx playwright install webkit` — sem ele, os testes de `mobile-safari`
// falham com "Executable doesn't exist", o que NÃO é resultado de
// acessibilidade e já enganou uma sessão.
//
// ⚠️ O registro anterior aqui dizia que rodar local era impossível, e dava uma
// causa que a medição de 21/09 desmentiu ("a página consulta em laço" — ela
// consulta UMA vez). A causa real, e o que se faz com ela, estão em
// `_apoio-local.ts`. Quem for citar aquele diagnóstico de algum handoff antigo:
// ele está vencido.
//
// ⚠️ E contra `pnpm dev` **não rode**: servidor de desenvolvimento de pé junto
// de suíte de teste foi o que publicou resultado eleitoral inventado no site
// público em 2026-09-14. Use `pnpm start:e2e` ou o site publicado.
// ---------------------------------------------------------------------------
const ROUTES = [
  "/",
  "/uf/SP",
  "/uf/SP/governador",
  "/uf/SP/senador",
  "/governador",
  // `/senador` entrou em 2026-09-26: renderiza o painel "Votação" (spec 021)
  // e a corrida POR PARTIDO da spec 022, e estava fora do portão desde que a
  // página existe — nenhuma outra rota nacional de Senador era auditada.
  "/senador",
  "/sobre-o-modelo",
  // As duas rotas de Deputado Federal (spec 017) entraram em 2026-09-18, 3ª
  // sessão. Elas são a ÚNICA corrida PROPORCIONAL do produto: em vez de um
  // vencedor por circunscrição, distribuem cadeiras entre agremiações — e por
  // isso renderizam componentes que NENHUMA das seis rotas acima exercita
  // (tabela de bancada, quociente eleitoral, o rótulo "ainda não dá para
  // dizer"). Estavam fora do portão desde que a spec 017 foi entregue.
  "/deputado-federal",
  "/uf/SP/deputado-federal",
  // `/sobre-as-etiquetas` entrou em 2026-09-29 (spec 025, RF-252): a página de
  // metodologia das etiquetas editoriais, obrigatória pela constituição 1.6
  // § 8 — tabelas, listas longas e links de fonte que nenhuma rota acima tem.
  "/sobre-as-etiquetas",
];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];
const THEMES = ["light", "dark"] as const;

test.describe.configure({ mode: "parallel" });

for (const route of ROUTES) {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`axe ${route} @ ${viewport.name} (${theme})`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript((t) => {
          try {
            window.localStorage.setItem("am-theme", t);
          } catch {
            /* noop */
          }
        }, theme);
        // Só instala contra localhost; contra o site publicado é no-op e a rota
        // real é exercitada como sempre. Ver `_apoio-local.ts`.
        await instalarProjecaoLocal(page, baseURL);

        // 🔴 2026-09-21 — o `goto` era `{ waitUntil: "networkidle" }`, e era ELE
        // que impedia este portão de rodar contra build local: fora da Vercel,
        // `checkBotId()` lança, o Next devolve 500 com um corpo que NUNCA fecha, e
        // a requisição fica em voo para sempre. O `networkidle` então nunca
        // chegava, os 40 testes morriam por timeout de NAVEGAÇÃO, e o sintoma não
        // se parecia com a causa. Agora: `load` (determinístico), depois o mapa
        // montado, depois rede ociosa COM TETO.
        await page.goto(route, { waitUntil: "load" });
        // O mapa MapLibre monta por `next/dynamic` depois da hidratação; o axe
        // precisa vê-lo montado, senão audita o esqueleto. Devolve `false` em rota
        // sem mapa, e sai rápido nesse caso.
        await esperarMapaMontado(page);
        const rede = await esperarRedeOciosa(page);
        // dá tempo do detalhe municipal chegar e pintar
        await page.waitForTimeout(1500);

        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();

        const critical = results.violations.filter((v) => v.impact === "critical");
        const serious = results.violations.filter((v) => v.impact === "serious");

        // 🔴 O PONTO CEGO — medido em 2026-09-18, 3ª sessão, contra o site
        // publicado.
        //
        // `results.violations` era a única coisa que este portão olhava, e por
        // isso ele dizia "0 violações" enquanto o próprio axe dizia "não
        // consegui decidir". A regra que cai em `incomplete` é justamente
        // `color-contrast` — a classe de falha de acessibilidade mais comum do
        // produto e a que o RNF-035 persegue.
        //
        // Contagem do dia, `desktop`/`light`, por rota:
        //   /sobre-o-modelo ............ 18 nós indecididos
        //   /deputado-federal .......... 1
        //   /uf/SP/deputado-federal .... 1
        //   /uf/SP/senador ............. 1
        //   /, /uf/SP, /governador, /uf/SP/governador ... 0
        //
        // Dos 18, **17 são `<text>` dentro de SVG** (o diagrama da metodologia):
        // o axe não resolve fundo de texto em SVG e declara isso, com a
        // mensagem "contains an image node" / "overlapped by another element".
        // É limitação da ferramenta, não defeito da página — reprovar por isso
        // deixaria o portão permanentemente vermelho por um motivo falso.
        //
        // Por isso a guarda abaixo NÃO conta nós: ela confere a NATUREZA deles.
        // Enquanto todo indecidido for SVG (ou o link da marca no masthead, que
        // o axe reporta como "parcialmente encoberto"), o portão segue verde.
        // No instante em que um parágrafo, um botão ou um rótulo comum virar
        // indecidido, ele fica vermelho — que é exatamente o caso em que o
        // "0 violações" estaria mentindo.
        //
        // Ela é robusta a dado: quando a série chegar em produção, o gráfico da
        // noite acrescenta `<text>` SVG e a CONTAGEM muda; a natureza, não.
        //
        // 🔴 A TERCEIRA isenção — `candidate-avatar-fallback`, medida em
        // 2026-09-21, na primeira execução deste portão contra build local.
        //
        // Ela reprovou nos 8 casos da home (2 navegadores × 2 tamanhos × 2
        // temas), sempre nos mesmos 4 nós, sempre com
        // `messageKey: "elmPartiallyObscured"` — "não deu para determinar a cor
        // de fundo porque está parcialmente encoberto por outro elemento".
        //
        // **Não há elemento por cima.** O mecanismo foi medido, não deduzido: o
        // avatar é um CÍRCULO (`border-radius: 999px` computado, caixa de
        // 26×26 ⇒ raio 13 px), e o axe amostra os cantos da caixa RETANGULAR —
        // que ficam a 18,38 px do centro, **5,38 px fora do círculo**. Um
        // `document.elementFromPoint` no canto inferior direito devolve o
        // contêiner-pai (`div.flex.min-w-0.items-center`), e o axe lê isso como
        // oclusão. Centro e canto superior esquerdo devolvem o próprio avatar.
        //
        // E o contraste está FOLGADO, medido à mão nos dois temas:
        //   claro  `#5b636e` sobre `#e9ebee` = **5,089:1**
        //   escuro `#9aa1ab` sobre `#262a31` = **5,528:1**
        // contra o piso de 4,5:1 do RNF-022. Não é "passa raspando" como as 15
        // siglas da dívida 16 — é margem de meio ponto.
        //
        // ⚠️ Isto AFROUXA o portão, e é reversível: apagar
        // `candidate-avatar-fallback` da linha abaixo o deixa vermelho de novo.
        // A justificativa é que o motivo do axe é geométrico e vale para
        // qualquer avatar redondo — provavelmente é o mesmo motivo do
        // `top-bar-brand` já isento. O que NÃO está isento é o avatar mudar de
        // cor: aí o número acima muda, e nenhum teste deste arquivo veria. Quem
        // guarda isso é `party-text-contrast.test.ts`, no vitest.
        const contrasteIndeciso = results.incomplete.filter((v) => v.id === "color-contrast");
        const indecididosInesperados = contrasteIndeciso.flatMap((v) =>
          v.nodes
            .map((n) => String(n.target[0] ?? ""))
            .filter(
              (alvo) =>
                !/^text[[.]/.test(alvo) &&
                !alvo.includes("top-bar-brand") &&
                !alvo.includes("candidate-avatar-fallback"),
            ),
        );

        await test
          .info()
          .attach(`axe-${route.replace(/\//g, "_")}-${viewport.name}-${theme}.json`, {
            body: JSON.stringify(
              { violations: results.violations, incomplete: results.incomplete },
              null,
              2,
            ),
            contentType: "application/json",
          });

        console.log(
          `\n=== ${route} | ${viewport.name} | ${theme} ===`,
          JSON.stringify(
            results.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.map((n) => n.target),
            })),
            null,
            2,
          ),
        );

        // A rede não ter ficado ociosa significa que o axe pode ter auditado a
        // página a meio caminho — um "0 violações" tirado de uma árvore que ainda
        // ia mudar. Vale asserção, não nota de rodapé: foi uma requisição
        // pendurada que deixou este portão inalcançável por três dias.
        expect(
          rede.ociosa,
          `A rede não ficou ociosa em ${route} — o axe pode ter auditado a página ` +
            `antes de ela terminar de montar. Em voo: ${rede.emVoo.slice(0, 3).join(", ") || "(nada)"}`,
        ).toBe(true);

        expect(critical.length + serious.length, JSON.stringify(results.violations, null, 2)).toBe(
          0,
        );

        expect(
          indecididosInesperados,
          `axe não conseguiu decidir o contraste destes elementos NÃO-SVG — ` +
            `"0 violações" acima não cobre nenhum deles:\n` +
            JSON.stringify(indecididosInesperados, null, 2),
        ).toEqual([]);
      });
    }
  }
}
