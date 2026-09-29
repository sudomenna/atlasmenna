import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type Page, type Request, test } from "@playwright/test";
import { esperarMapaMontado, esperarRedeOciosa, instalarProjecaoLocal } from "./_apoio-local";

/**
 * RNF-007 — orçamento de bundle JS (docs/nfr/performance.md).
 *
 *   RNF-007a — above-the-fold **de aplicação** (total − piso de framework)  < 150 KiB
 *   RNF-007b — chunk do mapa (MapLibre + PMTiles client + componente)       < 300 KiB
 *   RNF-007c — total da rota (above-the-fold + chunks lazy)                 < 500 KiB
 *
 * O escopo do RNF-007a mudou em 2026-09-08 (constituição 1.4, ADR-0030): ele deixou
 * de somar o runtime que o time não controla. Medido em 2026-09-07, o above-the-fold
 * da home eram 153.482 B em 8 requests, dos quais 71.080 são o React DOM e o resto é
 * runtime do Next e do bundler — `/sobre-o-modelo`, a rota mais simples do site,
 * baixava exatamente o mesmo tanto. O teto de 150 KiB media a escolha de framework,
 * não as decisões do time, e sobravam 118 bytes para a aplicação inteira.
 *
 * Convenção de unidade: docs/nfr/performance.md (linhas 43-53) registra ambiguidade
 * decimal-KB vs. KiB para RNF-007a. Este spec usa KiB (1024 bytes) em todos os três
 * orçamentos, mesma convenção da nota canônica ("~148,7 KiB").
 *
 * Receita de medição (docs/_meta/handoff-2026-09-07-redesign.md, Bloco 0 item 4):
 *   1. Soma de `request.sizes().responseBodySize` dos recursos `script` até o evento
 *      `load` = RNF-007a. O chunk `nomodule` do Next nunca é requisitado por um
 *      navegador moderno (só entende `<script nomodule>` quem NÃO suporta módulos),
 *      então ele sai da soma por construção — não há filtro manual para isso aqui.
 *   2. O(s) chunk(s) de script que chegam DEPOIS do `load` e cujo corpo contém a
 *      string "maplibre" (case-insensitive) são classificados como o chunk do mapa
 *      = RNF-007b. Confirmado por conteúdo, não por nome de arquivo — no build local
 *      (2026-09-07) o Turbopack nomeia esse chunk `0dkfee.t7_~tk.js` (opaco).
 *   3. Soma de todos os recursos `script` (above-the-fold + lazy) até a rede ficar
 *      ociosa = RNF-007c.
 */

const KIB = 1024;
const BUDGET_RNF_007A_BYTES = 150 * KIB;
const BUDGET_RNF_007B_BYTES = 300 * KIB;

/**
 * Piso de framework above-the-fold (RNF-007a-floor), em bytes.
 *
 * É o **maior** valor observado entre as rotas medidas em 2026-09-07 — escolha
 * conservadora: subtrair um piso maior que o real de uma rota faz o orçamento de
 * aplicação parecer MENOR do que é, nunca maior, então o gate erra para o lado de
 * reprovar, não de deixar passar.
 *
 * Recalibrar **apenas** quando Next ou React subirem de versão major, nunca por PR:
 * se um PR pudesse mexer nesta constante, o gate deixaria de medir qualquer coisa.
 * Para recalibrar: rode este spec, olhe `aboveTheFoldBytes` da rota mais simples do
 * site (`/sobre-o-modelo`, sem mapa e sem polling) e use esse número.
 */
const FRAMEWORK_FLOOR_BYTES = 153_482;
const BUDGET_RNF_007C_BYTES = 500 * KIB;

const ARTIFACT_PATH = path.join(process.cwd(), "test-results", "perf-budget.json");

// Nota sobre `/uf/SP` neste servidor: `pnpm start` roda com NODE_ENV=production, e
// `app/uf/[sigla]/page.tsx` só sintetiza dados de dev-fallback fora de produção — sem
// EDGE_CONFIG/payload real publicado (esperado antes da eleição), a rota renderiza o
// estado "Aguardando dados" (constituição § 3) e a árvore com os mapas (UfMapsLazy)
// nunca monta. Medimos a rota do jeito que ela está: RNF-007a/007c continuam válidos
// para o shell "Aguardando dados"; RNF-007b sai como 0 bytes/0 requests nesse estado —
// não é uma medição real do chunk de mapa de UF, é reflexo de não haver dado ainda.
// Revalidar depois que houver Edge Config populado (ou um fixture local) para medir o
// chunk de mapa de UF de verdade.
// As quatro rotas que carregam o gráfico da noite (spec 020) entraram em
// 2026-09-18, 3ª sessão, por exigência do RF-172(b). Mediam-se duas.
//
// ⚠️ **E medir aqui NÃO prova o "0 B" do RF-172(b).** Este arquivo responde "a
// rota cabe em 150 KiB", e continuaria verde se o gráfico passasse a custar
// 20 KiB de JS — sobraria orçamento. O que prova o zero é estrutural, e está em
// `tests/unit/components/serie-apuracao-chart.test.tsx`, bloco "a promessa de
// 0 B": a travessia dos imports locais do gráfico, provando que nenhum módulo
// da árvore declara `"use client"`. Os dois juntos fecham (b); nenhum sozinho.
// `/deputado-federal` entrou em 2026-09-18 junto com o `<CamaraHemiciclo>`.
//
// 🔴 **E entrou porque nenhum dos três orçamentos acima o enxergava.** Os três
// somam `request.resourceType() === "script"`; o hemiciclo é zero JavaScript —
// ~513 `<circle>` renderizados no servidor. Ele poderia dobrar de tamanho com
// os três gates verdes. Daí o bloco "peso do DOCUMENTO" no fim deste arquivo.
// `/senador` e `/sobre-as-etiquetas` entraram em 2026-09-29 (spec 025): a capa
// do Senado ganhou chips, filtro e as visões por bloco — tudo zero JS menos o
// filtro (~2 KB gz), e custo em HTML que só o bloco "peso do DOCUMENTO"
// enxerga; `/sobre-as-etiquetas` é a metodologia nova.
//
// ⚠️ `/governador` NÃO entrou, e o motivo é um achado, não uma escolha: medida
// em 29/09 contra este mesmo servidor (dado fixo), com as etiquetas DESLIGADAS,
// o documento tem 325.635 B — acima dos 300 KiB do teto abaixo, antes de
// qualquer coisa da spec 025 (o consolidado por região do ADR-0057 e os 27
// cartões saem duas vezes: no HTML e no payload RSC do `<RegiaoRecolhivel>`).
// Pôr a rota aqui deixaria o portão vermelho por um peso que já existia; a
// decisão de apertar a página ou o teto é do dono (registrado no tasks.md da
// spec 025).
const ROUTES = [
  "/",
  "/uf/SP",
  "/uf/SP/governador",
  "/uf/SP/senador",
  "/deputado-federal",
  "/senador",
  "/sobre-as-etiquetas",
] as const;

/**
 * Das rotas acima, as que renderizam um mapa MapLibre — medido em 2026-09-21
 * contra o build local: `/` e `/governador` montam o coroplético nacional
 * ("Mapa interativo do Brasil — …"); as três de UF montam o municipal ("Mapa de
 * líder por município — SP"); `/deputado-federal` e `/uf/SP/deputado-federal`
 * não têm mapa nenhum (0 nós com `role="img"`), e `/sobre-o-modelo` tem três
 * `role="img"` que são diagramas, não mapa.
 *
 * Serve para o RNF-007b distinguir "0 B porque não há mapa" de "0 B porque o
 * mapa não montou" — ver a asserção que a consome.
 */
const ROTAS_COM_MAPA = new Set<string>(["/", "/uf/SP", "/uf/SP/governador", "/uf/SP/senador"]);

/**
 * Teto do corpo do documento HTML, em bytes.
 *
 * ⚠️ **PROVISÓRIO — calibrar na primeira execução real deste spec.** O número
 * abaixo NÃO é uma medição de rede: ele foi derivado do markup de SSR medido em
 * 2026-09-18 com `renderToStaticMarkup` (`<main>` de `/deputado-federal` =
 * 91.124 B, dos quais 28.333 B são o hemiciclo com 513 cadeiras), dobrado para
 * cobrir o *payload* RSC que o Next embute no mesmo documento, mais folga.
 *
 * ✅ **MEDIDO em 2026-09-21**, na primeira execução deste spec contra um build
 * local que funcionou (ver `_apoio-local.ts`). Corpo do documento, por rota:
 *
 *   `/` ....................... 217.310 B  (212,2 KiB)  ← o maior
 *   `/deputado-federal` ........  81.638 B  ( 79,7 KiB)
 *   `/uf/SP/governador` ........  44.787 B  ( 43,7 KiB)
 *   `/uf/SP/senador` ...........  44.357 B  ( 43,3 KiB)
 *   `/uf/SP` ...................  44.296 B  ( 43,3 KiB)
 *
 * 🔴 **E o teto NÃO foi apertado, de propósito** — contra a instrução que estava
 * escrita aqui ("troque pelo valor real + ~25%", o que daria 265,3 KiB).
 *
 * O motivo é a DIREÇÃO da falha. Este documento cresce com o DADO: `/` mede
 * 212,2 KiB com o payload de hoje, e a noite de 04/10 tem mais candidatura
 * nomeada, mais município com número e a série da apuração acumulando pontos.
 * Um teto calibrado em uma máquina, num dia de pouca apuração, reprova no pior
 * momento possível por um crescimento que era esperado. Apertar exige medir o
 * documento com payload de noite de eleição — o replay tem esse dado, este spec
 * não. Fica como tarefa com insumo conhecido, não como palpite.
 *
 * ⚠️ A derivação antiga (`<main>` de `/deputado-federal` = 91.124 B por
 * `renderToStaticMarkup`, dobrado) não reproduz: o documento INTEIRO daquela
 * rota mede 81.638 B, **menos que o `<main>` sozinho** da medição de 18/09. As
 * duas medem coisas diferentes e não são comparáveis — quem for recalibrar
 * use a medição de rede, que é a que o portão faz.
 */
const BUDGET_DOCUMENT_BYTES = 300 * KIB;

interface ScriptSample {
  url: string;
  bytes: number;
  isMapLibreChunk: boolean;
}

interface RouteMeasurement {
  route: string;
  aboveTheFoldBytes: number;
  aboveTheFoldRequests: number;
  mapChunkBytes: number;
  mapChunkRequests: number;
  totalBytes: number;
  totalRequests: number;
  /**
   * `false` em rota sem mapa (`/deputado-federal`). Quando é `false` numa rota
   * COM mapa, `mapChunkBytes` sai 0 por o chunk nunca ter sido pedido — um zero
   * que não é medição, e por isso vai ao artefato em vez de passar por número.
   */
  mapaMontado: boolean;
  /**
   * `true` quando o chunk do MapLibre chegou ANTES do evento `load`. Não é
   * defeito — é a corrida entre a hidratação e o `load`, que depende da latência
   * da resposta de `/api/projection`. Fica registrado porque foi ela que, até
   * 2026-09-21, decidia em qual dos dois orçamentos o chunk era contado.
   */
  mapaAntesDoLoad: boolean;
  /**
   * `false` quando a rede não ficou ociosa dentro do teto. A soma de
   * `totalBytes` (RNF-007c) pode então estar INCOMPLETA — ver `emVoo`.
   */
  redeOciosa: boolean;
  /** Quem continuava em voo quando o teto estourou. Vazio no caminho normal. */
  emVoo: string[];
}

function isSameOrigin(request: Request, baseURL: string): boolean {
  // Requisito 5: sem rede externa esperada — mas ignoramos cross-origin defensivamente
  // (ex.: se algum dia entrar um analytics de terceiro) em vez de contá-lo no orçamento
  // de bundle do próprio app.
  try {
    return new URL(request.url()).origin === new URL(baseURL).origin;
  } catch {
    return false;
  }
}

/**
 * Mede os bytes de script transferidos (gzip/br "on the wire", via `sizes()`) para uma
 * rota, separando o que chegou até o evento `load` (above-the-fold) do que chegou depois
 * (lazy — inclui o chunk do mapa via `next/dynamic({ ssr: false })`, ADR-0010).
 *
 * A ordenação relativa ao `load` é capturada de forma síncrona no handler de
 * `requestfinished` (via a flag `loadFired`, setada por um listener de `load`) — a
 * resolução assíncrona de `sizes()`/corpo da resposta acontece depois, em paralelo,
 * sem afetar o bucket em que cada requisição foi classificada.
 */
async function measureRoute(page: Page, baseURL: string, route: string): Promise<RouteMeasurement> {
  let loadFired = false;
  const order: { request: Request; afterLoad: boolean }[] = [];

  page.once("load", () => {
    loadFired = true;
  });

  page.on("requestfinished", (request) => {
    if (request.resourceType() !== "script") return;
    if (!isSameOrigin(request, baseURL)) return;
    order.push({ request, afterLoad: loadFired });
  });

  await page.goto(route, { waitUntil: "load" });
  // O mapa carrega via `next/dynamic({ ssr: false })` (ADR-0010) — o import() só é
  // disparado no efeito de montagem do componente cliente, depois da hidratação.
  // Esperar o container montado é o sinal determinístico de "o chunk do MapLibre já
  // baixou e executou", e é ele que faz o RNF-007b abaixo medir alguma coisa.
  //
  // 🔴 2026-09-21 — até esta data a espera era `getByRole("img", { name: /mapa/i })`,
  // e o comentário aqui afirmava que "o placeholder de loading não tem essa role".
  // Tem: `MapSkeleton.tsx:34-36` declara `role="img"` +
  // `aria-label="Mapa do Brasil carregando"`. O `.first()` casava no ESQUELETO e
  // retornava em **12 ms** — quem de fato segurava a medição do chunk era o
  // `networkidle` logo abaixo, justamente o que o comentário dizia ser pouco
  // confiável. `esperarMapaMontado` discrimina pelo `aria-busy`.
  const mapaMontado = await esperarMapaMontado(page);
  // Rede ociosa: captura qualquer requisição residual (ex.: tiles PMTiles) disparada
  // logo após o mapa montar.
  //
  // 🔴 Com TETO, e com o estouro reportado em vez de engolido: uma única requisição
  // que nunca fecha o corpo trava o `networkidle` para sempre (foi o que matou este
  // portão contra build local — ver `_apoio-local.ts`). Engolir o estouro em silêncio
  // seria pior que travar: a soma sairia menor que a rota real e o portão ficaria
  // VERDE. Quem ficou em voo vai para o artefato e para a anotação.
  const rede = await esperarRedeOciosa(page);

  const samples: (ScriptSample & { afterLoad: boolean })[] = await Promise.all(
    order.map(async ({ request, afterLoad }) => {
      try {
        const sizes = await request.sizes();
        const response = await request.response();
        const body = response ? await response.text().catch(() => "") : "";
        return {
          url: request.url(),
          bytes: sizes.responseBodySize,
          isMapLibreChunk: /maplibre/i.test(body),
          afterLoad,
        };
      } catch {
        // Requisição abortada/sem resposta correspondente — não deveria acontecer em
        // produção local, mas não deixamos isso derrubar a medição inteira.
        return { url: request.url(), bytes: 0, isMapLibreChunk: false, afterLoad };
      }
    }),
  );

  const sum = (list: ScriptSample[]) => list.reduce((acc, s) => acc + s.bytes, 0);

  const mapChunk = samples.filter((s) => s.isMapLibreChunk);
  // 🔴 2026-09-21 — o chunk do mapa sai do RNF-007a por CONTEÚDO, não por corrida
  // com o evento `load`.
  //
  // A receita no cabeçalho deste arquivo define 007a como "scripts até o `load`" e
  // 007b como "scripts DEPOIS do `load` que contêm 'maplibre'". As duas definições
  // colidem quando o `import()` do `next/dynamic` ganha a corrida do `load` — e aí o
  // mesmo chunk era somado NAS DUAS, inflando o 007a com o peso que o ADR-0010 existe
  // para tirar dele. Medido na primeira execução local em que o mapa de fato montou:
  // `/` deu above-the-fold de 467.310 B com os 291.823 B do MapLibre dentro, contra
  // 175.487 B sem ele.
  //
  // Até esta data a colisão nunca aparecia porque o mapa NUNCA montava localmente e,
  // no site publicado, a latência de `/api/projection` empurrava o `import()` para
  // depois do `load`. Ou seja: a classificação sempre dependeu de latência de rede,
  // e foi por sorte que deu certo. `isMapLibreChunk` não depende.
  const aboveTheFold = samples.filter((s) => !s.afterLoad && !s.isMapLibreChunk);
  const mapaAntesDoLoad = mapChunk.some((s) => !s.afterLoad);

  return {
    route,
    aboveTheFoldBytes: sum(aboveTheFold),
    aboveTheFoldRequests: aboveTheFold.length,
    mapChunkBytes: sum(mapChunk),
    mapChunkRequests: mapChunk.length,
    totalBytes: sum(samples),
    totalRequests: samples.length,
    mapaMontado,
    mapaAntesDoLoad,
    redeOciosa: rede.ociosa,
    emVoo: rede.emVoo,
  };
}

function writeArtifact(measurement: RouteMeasurement): void {
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf-8"));
  } catch {
    existing = {};
  }

  existing[measurement.route] = {
    ...measurement,
    measuredAt: new Date().toISOString(),
    frameworkFloorBytes: FRAMEWORK_FLOOR_BYTES,
    applicationBytes: measurement.aboveTheFoldBytes - FRAMEWORK_FLOOR_BYTES,
    budgets: {
      rnf007aBytes: BUDGET_RNF_007A_BYTES,
      rnf007bBytes: BUDGET_RNF_007B_BYTES,
      rnf007cBytes: BUDGET_RNF_007C_BYTES,
    },
  };

  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(existing, null, 2));
}

// Requisito 4: bytes de rede só fazem sentido medir uma vez — mobile-safari (WebKit)
// não precisa rodar esta suíte. O `test.skip` fica num `beforeEach` que não declara a
// fixture `page` (só `testInfo`) — assim o worker do projeto `mobile-safari` nunca
// chega a lançar o browser para este spec, em vez de lançar e só então descartar.
test.describe("perf budget (RNF-007a/b/c)", () => {
  test.describe.configure({ mode: "serial" });

  // Playwright exige desestruturação literal `{}` no 1º argumento do hook mesmo sem
  // fixtures — é assim que ele sabe não precisar criar `page` para pular o teste.
  // biome-ignore lint/correctness/noEmptyPattern: exigido pela assinatura do Playwright
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Medição de bytes só roda no projeto chromium");
  });

  for (const route of ROUTES) {
    test(`bundle JS de script — ${route}`, async ({ page, baseURL }) => {
      await instalarProjecaoLocal(page, baseURL);
      const result = await measureRoute(page, baseURL ?? "http://localhost:3100", route);
      writeArtifact(result);

      // RNF-007a mede o que o time controla: total above-the-fold menos o piso de
      // framework (ADR-0030). Um valor negativo significa que a rota baixou MENOS que
      // o piso registrado — acontece em rota mais enxuta que a que definiu o piso, e é
      // informação legítima, não erro; o clamp a zero evita "orçamento negativo" no
      // relatório sem esconder o número real, que vai no artefato.
      const aplicacaoBytes = result.aboveTheFoldBytes - FRAMEWORK_FLOOR_BYTES;

      test.info().annotations.push({
        type: "perf-budget",
        description:
          `${route}: aplicação=${(aplicacaoBytes / KIB).toFixed(1)}KiB ` +
          `(above-the-fold ${(result.aboveTheFoldBytes / KIB).toFixed(1)}KiB − piso ${(FRAMEWORK_FLOOR_BYTES / KIB).toFixed(1)}KiB) ` +
          `map=${(result.mapChunkBytes / KIB).toFixed(1)}KiB total=${(result.totalBytes / KIB).toFixed(1)}KiB`,
      });

      expect
        .soft(
          aplicacaoBytes,
          `RNF-007a (${route}): orçamento de APLICAÇÃO = ${result.aboveTheFoldBytes} B medidos − ${FRAMEWORK_FLOOR_BYTES} B de piso de framework. ` +
            "Se estourou, o peso veio de código nosso — não do React nem do Next.",
        )
        .toBeLessThan(BUDGET_RNF_007A_BYTES);

      expect
        .soft(result.totalBytes, `RNF-007c total de script (${route}) deve ficar abaixo de 500 KiB`)
        .toBeLessThan(BUDGET_RNF_007C_BYTES);

      // 🔴 A qualidade da MEDIÇÃO é asserção, não nota de rodapé (2026-09-21).
      //
      // Rede não ociosa ⇒ `totalBytes` pode estar incompleto, e o RNF-007c acima
      // teria passado por medir MENOS do que a rota carrega. Um portão que fica
      // verde medindo menos é pior que um portão vermelho.
      expect
        .soft(
          result.redeOciosa,
          `A rede não ficou ociosa em ${route} dentro do teto — o RNF-007c acima pode ` +
            `estar somando MENOS script do que a rota carrega. Continuavam em voo: ` +
            `${result.emVoo.slice(0, 3).join(", ") || "(nada registrado)"}`,
        )
        .toBe(true);

      // RNF-007b passou de 250 para 300 KiB em 2026-09-08 (ADR-0030), formalizando o
      // carry-over da S04 em vez de mantê-lo como teto operacional escondido no teste.
      //
      // 🔴 `ROTAS_COM_MAPA` existe porque `mapChunkBytes = 0` tem DUAS origens
      // opostas e o `toBeLessThan` abaixo aprova as duas: "a rota não tem mapa"
      // (correto) e "o mapa não montou, então o chunk nunca foi pedido" (medição
      // que não aconteceu). Foi exatamente o segundo caso contra build local até
      // 2026-09-21 — o portão registrava 0 B e passava. Numa rota que TEM mapa, o
      // zero agora reprova.
      if (ROTAS_COM_MAPA.has(route)) {
        expect
          .soft(
            result.mapaMontado,
            `O mapa de ${route} não montou — \`mapChunkBytes\` sai 0 B por ausência de ` +
              "medição, não por leveza, e o teto do RNF-007b passaria sem medir nada.",
          )
          .toBe(true);
        expect
          .soft(result.mapChunkBytes, `RNF-007b (${route}): chunk do MapLibre medido em 0 B`)
          .toBeGreaterThan(0);
      }

      expect
        .soft(
          result.mapChunkBytes,
          `RNF-007b chunk do MapLibre (${route}) deve ficar abaixo de ${BUDGET_RNF_007B_BYTES / KIB} KiB`,
        )
        .toBeLessThan(BUDGET_RNF_007B_BYTES);
    });
  }

  // Zero JS não é zero custo. Ver a nota em `BUDGET_DOCUMENT_BYTES`.
  for (const route of ROUTES) {
    test(`peso do DOCUMENTO HTML — ${route}`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: "load" });
      expect(response, `sem resposta para ${route}`).not.toBeNull();

      const corpo = await (response as NonNullable<typeof response>).body();
      const bytes = corpo.length;

      test.info().annotations.push({
        type: "document-size",
        description: `${route}: documento=${(bytes / KIB).toFixed(1)}KiB (${bytes} B)`,
      });

      expect
        .soft(
          bytes,
          `Documento de ${route} = ${bytes} B. Este é o único gate que enxerga ` +
            "conteúdo renderizado no servidor — hemiciclo, grade de bandeiras, sprites " +
            "SVG embutidos. Se estourou, o peso veio de markup, não de script.",
        )
        .toBeLessThan(BUDGET_DOCUMENT_BYTES);
    });
  }
});
