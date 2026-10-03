import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  cascaVaziaNoDocumento,
  detalheDeputadoIndisponivel,
  esperarMapaMontado,
  esperarRedeOciosa,
  instalarProjecaoLocal,
  ROTA_UF_DEPUTADO,
} from "./_apoio-local";
import {
  CSS_LISTAS_DEPUTADO_VISIVEIS,
  isencaoAgremiacaoDeputadoPulada,
  isencaoPorSimbolo,
  SELETOR_AGREMIACAO_DEPUTADO,
  TEXTO_DO_LADRILHO_DOS_PALANQUES,
} from "./_isencoes-axe";

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
//     pnpm build:e2e && pnpm start:e2e   # 🔴 os dois :e2e, nunca build/start/dev
//     pnpm test:e2e                      # noutro terminal
//
// 🔴 29/09: com `pnpm build` (sem `:e2e`) numa worktree, no CI ou num clone
// novo (sem `.env.local`), o `.next` saía sem Global Config nenhum e `/`,
// `/senador`, `/deputado-federal` e `/uf/SP/*` eram servidas como
// a casca "Esta página ainda não recebeu dados" — este portão auditou essa
// casca, verde. Agora o `start:e2e` recusa esse `.next`, e cada teste abaixo
// reprova se achar a casca (`cascaVaziaNoDocumento`).
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
/** O resultado do axe — tipo tirado do próprio `AxeBuilder` (o `axe-core` não é dependência direta). */
type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

/**
 * Os nós de `color-contrast` que o axe deixou em `incomplete` e que NENHUMA
 * isenção deste arquivo cobre (ver as notas das isenções no corpo do teste).
 * `comIsencaoContentVisibility` liga a quinta isenção — desligada na prova.
 */
async function indecididosInesperadosDe(
  page: Page,
  results: AxeResults,
  comIsencaoContentVisibility: boolean,
): Promise<{ inesperados: string[]; isentosPorContentVisibility: number }> {
  const nos = results.incomplete.filter((v) => v.id === "color-contrast").flatMap((v) => v.nodes);
  const dentroDeAgremiacao: boolean[] = await page.evaluate(
    ({ alvos, seletor }) =>
      alvos.map((alvo) => {
        try {
          return document.querySelector(alvo)?.closest(seletor) != null;
        } catch {
          return false;
        }
      }),
    { alvos: nos.map((n) => String(n.target[0] ?? "")), seletor: SELETOR_AGREMIACAO_DEPUTADO },
  );
  let isentosPorContentVisibility = 0;
  const inesperados = nos
    .filter((n, i) => {
      const alvo = String(n.target[0] ?? "");
      const motivos = n.any.map((c) =>
        String((c.data as { messageKey?: string })?.messageKey ?? ""),
      );
      if (isencaoPorSimbolo(alvo, motivos)) return false;
      if (
        comIsencaoContentVisibility &&
        isencaoAgremiacaoDeputadoPulada(dentroDeAgremiacao[i] === true, motivos)
      ) {
        isentosPorContentVisibility++;
        return false;
      }
      return true;
    })
    .map((n) => String(n.target[0] ?? ""))
    .filter(
      (alvo) =>
        !/^text[[.]/.test(alvo) &&
        !TEXTO_DO_LADRILHO_DOS_PALANQUES.test(alvo) &&
        !alvo.includes("top-bar-brand") &&
        !alvo.includes("candidate-avatar-fallback"),
    );
  return { inesperados, isentosPorContentVisibility };
}

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
  // ⚠️ 2026-09-29 (spec 026 RF-277): a partir daqui esta rota é auditada COM o
  // detalhe do Blob servido (`BLOB_PUBLIC_BASE_URL` → servidor falso), e não
  // mais sobre "Detalhe indisponível". O conteúdo VAI MUDAR enquanto a frente
  // de telas da spec 026 preenche a página (listas em três faixas, marcas,
  // regras, Conferência) — uma violação nova aqui é do componente novo, não
  // do portão.
  "/uf/SP/deputado-federal",
  // `/sobre-as-etiquetas` entrou em 2026-09-29 (spec 025, RF-252): a página de
  // metodologia das etiquetas editoriais, obrigatória pela constituição 1.6
  // § 8 — tabelas, listas longas e links de fonte que nenhuma rota acima tem.
  "/sobre-as-etiquetas",
  // Spec 027 (RF-289), 2026-10-03: as três telas das assembleias — a capa das
  // 27 casas, a Assembleia de SP (o pior caso: 94 lugares, listas de 95) e a
  // Câmara Legislativa do DF, com o simulado delas servido pelo falso. As
  // listas abertas e fechadas, a 375 e 320 px e por teclado, estão em
  // `deputado-listas.spec.ts`.
  "/deputado-estadual",
  "/uf/SP/deputado-estadual",
  "/uf/DF/deputado-distrital",
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

        // Auditar a casca de espera não é auditar a página (ver o cabeçalho).
        const conteudo = await page.content();
        expect(
          cascaVaziaNoDocumento(conteudo, baseURL),
          `${route} veio com a casca "sem dados" — o .next não saiu do \`pnpm build:e2e\`?`,
        ).toEqual([]);
        // Nem a página de UF de Deputado sem o detalhe do Blob (as listas são
        // o que mais há para auditar nela) — spec 027, RF-289.
        if (ROTA_UF_DEPUTADO.test(route)) {
          expect(
            detalheDeputadoIndisponivel(conteudo),
            `${route} renderizou sem o detalhe do Blob — o falso serve o Blob desta casa?`,
          ).toEqual([]);
        }

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
        //
        // 🔴 A QUARTA isenção — o texto do mapa dos palanques (V3, spec 025),
        // medida em 29/09 com as visões LIGADAS numa cópia de teste: 54 `<text>`
        // de `/governador` no celular caíram em `incomplete`. São `<text>` SVG
        // como os da primeira isenção, mas o seletor que o axe gera para eles
        // começa pelo ladrilho — `g[data-uf="SP"]… > .PalanquesMapa-module__…__sigla`
        // —, e o `^text` acima não os pegava. O fundo deles é a hachura do
        // ladrilho, que o axe não resolve.
        //
        // A isenção é EXATA (só as duas classes de texto do ladrilho) e só
        // existe porque o contraste delas é medido no vitest: a tinta sobre o
        // halo de papel (`paint-order: stroke`) e o texto do ladrilho quieto
        // sobre o cartão, nos dois temas, E que o CSS aplica mesmo esse halo —
        // `tests/unit/design-system/palanques-mapa-contraste.test.tsx`.
        //
        // E, na mesma medição, o sinal "≠" da legenda do mesmo mapa: o axe
        // declara `nonBmp` ("o conteúdo é só símbolo, não texto") e não mede.
        // Isento SÓ com esse motivo e SÓ nessa classe (`isencaoPorSimbolo`); a
        // cor dele é a da lista da legenda (`--text-primary` sobre o cartão),
        // presa no mesmo teste do vitest.
        //
        // 🔴 A QUINTA isenção — `content-visibility: auto` nas listas de
        // Deputado Federal (`/uf/SP/deputado-federal`), EXCEÇÃO CONHECIDA por
        // decisão do dono em 30/09 (auditoria G6 da spec 026: velocidade acima
        // da árvore de acessibilidade fora da tela). A agremiação longe da tela
        // é pulada pelo navegador, e o axe não decide o contraste dos nós dela
        // nem do cabeçalho colado nela (quatro motivos, medidos:
        // `MOTIVOS_CONTENT_VISIBILITY`). Isenta SÓ esses motivos e SÓ dentro do
        // bloco de uma agremiação — conferido no navegador por `closest()`, não
        // pelo texto do seletor (`isencaoAgremiacaoDeputadoPulada`, com teste
        // no vitest) — e SÓ COM PROVA: logo abaixo, o axe roda de novo com o
        // `content-visibility` desligado, e aí nenhum desses nós pode ficar
        // indecidido nem virar violação.
        const { inesperados: indecididosInesperados, isentosPorContentVisibility } =
          await indecididosInesperadosDe(page, results, true);
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

        // A PROVA da quinta isenção: com as agremiações todas montadas, o
        // contraste que o axe não decidiu acima passa a ser medido — e tem de
        // passar, sem isenção de `content-visibility` nenhuma.
        if (isentosPorContentVisibility > 0) {
          // Segunda passada do axe com ~1.000 linhas montadas: no WebKit ela
          // sozinha passa dos 30 s padrão (medido em 30/09).
          test.info().setTimeout(test.info().timeout + 90_000);
          await page.addStyleTag({ content: CSS_LISTAS_DEPUTADO_VISIVEIS });
          await page.evaluate(
            () =>
              new Promise<void>((r) =>
                requestAnimationFrame(() => requestAnimationFrame(() => r())),
              ),
          );
          const prova = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
          expect(
            prova.violations,
            `com o content-visibility DESLIGADO (prova da isenção de ${isentosPorContentVisibility} nós):\n` +
              JSON.stringify(prova.violations, null, 2),
          ).toEqual([]);
          const { inesperados } = await indecididosInesperadosDe(page, prova, false);
          expect(
            inesperados,
            "com o content-visibility DESLIGADO, o axe ainda não decide o contraste destes nós:\n" +
              JSON.stringify(inesperados, null, 2),
          ).toEqual([]);
        }
      });
    }
  }
}
