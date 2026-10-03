/**
 * tests/e2e/_apoio-local.ts
 *
 * O que faz os portões e2e (`perf-budget.spec.ts`, `a11y-audit.spec.ts`)
 * rodarem contra um build de produção LOCAL — coisa que, até 2026-09-21, não
 * acontecia com nenhum dos dois.
 *
 * ===========================================================================
 * 🔴 A causa, MEDIDA em 2026-09-21 — e não é a que estava documentada
 * ===========================================================================
 *
 * O registro anterior (cabeçalho de `a11y-audit.spec.ts`, handoff de 18/09 e
 * item 9 do handoff de 21/09) dizia duas coisas, e as duas estão erradas:
 *
 *   ❌ "a página repete a consulta [a `/api/projection`], a rede nunca fica
 *      ociosa".  **Ela consulta UMA vez.** Medido: 1 requisição a +55 ms, e
 *      nenhuma outra em 25 s de observação.
 *   ❌ "o mapa fica pedindo tiles de um domínio bloqueado".  **Nenhum tile é
 *      pedido.** O chunk do MapLibre nem chega a ser baixado.
 *
 * A causa real é uma só, e produz os dois sintomas:
 *
 *   1. `checkBotId()` (`proxy.ts`) **lança** fora da Vercel —
 *      `Error: Must be deployed on Vercel to set response headers`. O matcher
 *      do proxy é `/api/:path*`, então toda rota de API morre.
 *   2. O Next responde **500 com um corpo que nunca fecha**. O Chromium mantém
 *      a requisição EM VOO para sempre: medido com `page.on("requestfinished")`
 *      — 20 s depois do `load`, `/api/projection` continua aberta, e é a ÚNICA.
 *      Daí `waitForLoadState("networkidle")` nunca resolver (testado até 60 s).
 *   3. `PersistentMapFrame.tsx:380-382` faz `if (!payload) return <MapSkeleton>`,
 *      e o `payload` vem daquela mesma rota. Sem ela, a moldura fica no
 *      esqueleto **para sempre**, o `next/dynamic` do coroplético nunca monta,
 *      e o chunk do MapLibre nunca é pedido — ou seja, o **RNF-007b não era
 *      mensurável localmente**, nem com o `networkidle` consertado.
 *
 * Provado por eliminação: com `/api/projection` devolvendo 503 (corpo que
 * fecha), o `networkidle` passou a resolver em todos os modos testados
 * (`abort`, JSON de erro, 204) — e o mapa continuou NÃO montando nos três.
 * Só um payload VÁLIDO monta o mapa.
 *
 * ===========================================================================
 * Por que o conserto fica AQUI, e não em `proxy.ts`
 * ===========================================================================
 *
 * Toda variante de guarda no código de produção tem direção de falha ruim:
 * `if (!process.env.VERCEL) pular` some com a proteção em silêncio se a
 * variável faltar num deploy real, e é exatamente a "rede de segurança de mão
 * única" que já mordeu este projeto. O `checkBotId()` **não tem como
 * funcionar** fora da Vercel — o remendo pertence a quem roda fora da Vercel,
 * que é a suíte, não o servidor.
 *
 * Consequência: `proxy.ts` fica byte a byte igual, e uma execução contra o
 * site publicado (`PLAYWRIGHT_BASE_URL=https://…`) é idêntica à de antes —
 * nada aqui é instalado quando o alvo não é localhost.
 *
 * ===========================================================================
 * ⚠️ O que este stub MUDA na medição — leia antes de citar um número
 * ===========================================================================
 *
 * ✅ **2026-09-26 — as duas pontas leem a MESMA fixture.** Este stub
 * intercepta só o `fetch` do CLIENTE; o SERVIDOR lê o Global Config. Desde
 * 26/09 o `pnpm start:e2e` aponta o `EDGE_CONFIG` para
 * `scripts/edge-config-falso.ts`, que serve `tests/fixtures/simulacao/` — o
 * mesmo diretório que este stub lê. O texto abaixo, até o fim deste bloco,
 * descreve o estado ANTERIOR (SSR lendo produção) e fica como registro; ver
 * `docs/operations/runbook.md` § "O dado dos portões é FIXO".
 *
 * (Histórico) 🔴 **A página ficava com DUAS fontes de dado, não uma.** Tudo
 * que era renderizado no SERVIDOR vinha de onde o servidor lia — em
 * `pnpm start` com o `EDGE_CONFIG` do `.env.local`, o **Global Config de
 * PRODUÇÃO**.
 *
 * Medido em 2026-09-21, na home: a lista de candidaturas (SSR) exibia
 * "CANDIDATO 7", "CANDIDATO 9977" — nomes de produção; as fixtures do simulado
 * trazem nomes reais, e a fixture de dev `edge-config/projection-current.json`
 * traz "Candidato PT". Os três são distinguíveis, e o que apareceu foi o
 * primeiro.
 *
 * Consequências, por orçamento:
 *
 *   - **RNF-007a/c (bytes de script)**: não muda. Os scripts above-the-fold são
 *     os mesmos com qualquer dado.
 *   - **RNF-007b (chunk do mapa)**: passa a EXISTIR localmente. Antes era 0 B
 *     por o mapa nunca montar — um zero que o portão registrava como medição.
 *   - **a11y (axe)**: a árvore monta inteira, então a cobertura de componente
 *     sobe. E o SSR vir de produção é uma sorte, não um desenho: é ele que
 *     mantém o caminho de "nome ausente" exercitado, que a fixture do simulado
 *     esconderia (ela preenche `candidatos[].nome` em todo cargo).
 *
 * ⚠️ **Sem `EDGE_CONFIG` no ambiente, o portão audita OUTRA página** — o SSR
 * cai no estado "Aguardando dados" (constituição § 3) e a árvore auditada
 * encolhe. Quem comparar duas execuções precisa saber qual das duas rodou.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Page, Route } from "@playwright/test";

const DIR_FIXTURES = path.join(process.cwd(), "tests", "fixtures", "simulacao");

/** `cargo=` da query → prefixo do arquivo de fixture. */
const ARQUIVO_POR_CARGO: Record<string, string> = {
  pres: "presidente",
  gov: "governador",
  sen: "senador",
};

/** `cargo=` da query → sufixo do arquivo municipal. */
const MUNICIPIO_POR_CARGO: Record<string, string> = {
  pres: "municipios-pres-t1",
  gov: "municipios-gov-t1",
  sen: "municipios-sen-t1",
};

const cache = new Map<string, unknown>();

function lerFixture(nome: string): unknown | null {
  if (cache.has(nome)) return cache.get(nome) ?? null;
  const p = path.join(DIR_FIXTURES, `${nome}.json`);
  if (!fs.existsSync(p)) {
    cache.set(nome, null);
    return null;
  }
  const v = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
  cache.set(nome, v);
  return v;
}

/**
 * `true` quando o alvo é um servidor desta máquina. Só aí o stub é instalado —
 * contra o site publicado a suíte tem de exercitar a API de verdade.
 */
export function alvoEhLocal(baseURL: string | undefined): boolean {
  if (!baseURL) return false;
  try {
    const h = new URL(baseURL).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    return false;
  }
}

/**
 * Textos que só saem quando o SSR NÃO leu payload nenhum — a casca de espera.
 *
 * 🔴 **Existe por causa de 29/09.** Até essa data o `.next` dos portões saía de
 * um `pnpm build`, que numa worktree, no CI ou num clone novo (sem
 * `.env.local`) não tem `EDGE_CONFIG`: o Next pré-montava `/`, `/senador`,
 * `/deputado-federal` e `/uf/SP/*` com esta casca, e o `next start` a servia
 * mesmo com o Global Config falso de pé. Os portões de peso e de
 * acessibilidade mediram a casca, verdes, sem que nada acusasse. O conserto é o
 * `pnpm build:e2e`; esta lista é o alarme para quando alguém voltar a medir
 * sem ele.
 */
export const MARCAS_DE_CASCA_VAZIA = [
  "Esta página ainda não recebeu dados",
  "— Aguardando dados",
  "Aguardando dados…",
  // Spec 027 (RF-289): a capa das assembleias (`/deputado-estadual`) sem
  // nenhum dos dois payloads (`est`, `dis`) — `AguardandoAssembleias`. A
  // frase dela ("Aguardando os dados.") não casa com nenhuma das de cima;
  // o atributo é o identificador estável, e nunca sai com dado.
  'data-testid="casas-aguardando"',
] as const;

/**
 * Contra o servidor LOCAL (dado fixo do simulado, sempre com payload), devolve
 * as marcas de casca vazia encontradas no documento — lista vazia é o normal.
 * Contra o site publicado devolve `[]` sempre: lá a espera é um estado
 * legítimo (antes da apuração), não um defeito do portão.
 */
export function cascaVaziaNoDocumento(html: string, baseURL: string | undefined): string[] {
  if (!alvoEhLocal(baseURL)) return [];
  return MARCAS_DE_CASCA_VAZIA.filter((m) => html.includes(m));
}

/**
 * Frases de "detalhe do Blob indisponível" da página de UF de Deputado
 * (`MOTIVO_INDISPONIVEL`, `app/(dep)/_pagina-uf-deputado.tsx`). Com o Blob
 * servido pelo falso, nenhuma pode aparecer: se aparecer, o teto de peso
 * passaria medindo a página SEM a parte que ele existe para medir, e o axe
 * auditaria uma página sem as listas. Movido de `perf-budget.spec.ts` em
 * 03/10 (spec 027, RF-289) para os dois portões usarem o mesmo alarme.
 */
export const DETALHE_DEPUTADO_INDISPONIVEL = [
  "O armazenamento do detalhe não está configurado",
  // Sem o território: desde a spec 027 a frase diz "este estado" ou "o
  // Distrito Federal" conforme a casa.
  "Ainda não há um detalhe publicado para",
  "Não conseguimos buscar o detalhe agora",
] as const;

/** As páginas de UF de Deputado — federal, estadual e distrital (spec 027). */
export const ROTA_UF_DEPUTADO = /^\/uf\/[A-Z]{2}\/deputado-(federal|estadual|distrital)$/;

/** As frases de "detalhe indisponível" achadas no documento — lista vazia é o normal. */
export function detalheDeputadoIndisponivel(html: string): string[] {
  return DETALHE_DEPUTADO_INDISPONIVEL.filter((f) => html.includes(f));
}

/**
 * Responde `/api/projection*` a partir das fixtures do simulado.
 *
 * O contrato foi levantado observando o que as 8 rotas do portão de a11y
 * pedem de fato (2026-09-21), não lendo a rota:
 *
 *   `/api/projection`                          → nacional de Presidente
 *   `/api/projection?cargo=gov|sen`            → nacional daquele cargo
 *   `/api/projection?uf=SP&cargo=pres|gov|sen` → payload daquela UF
 *   `/api/projection/municipios?uf=..&cargo=..`→ detalhe municipal
 *
 * `/deputado-federal`, `/uf/SP/deputado-federal` e `/sobre-o-modelo` não pedem
 * nenhuma delas — são renderizadas inteiras no servidor.
 *
 * Devolve `false` (e não instala nada) quando o alvo não é local.
 */
export async function instalarProjecaoLocal(page: Page, baseURL: string | undefined) {
  if (!alvoEhLocal(baseURL)) return false;

  await page.route("**/api/projection**", async (route: Route) => {
    const url = new URL(route.request().url());
    const cargo = url.searchParams.get("cargo") ?? "pres";
    const uf = url.searchParams.get("uf")?.toUpperCase();

    const municipal = url.pathname.endsWith("/municipios");
    const nome = municipal ? MUNICIPIO_POR_CARGO[cargo] : ARQUIVO_POR_CARGO[cargo];
    if (!nome) {
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_cargo", cargo }),
      });
    }

    // Por UF: o arquivo `<cargo>-uf.json` é um mapa sigla → payload; o
    // municipal segue o mesmo formato num arquivo próprio.
    const arquivo = municipal ? nome : uf ? `${nome}-uf` : nome;
    const dados = lerFixture(arquivo);
    const corpo =
      uf && dados && typeof dados === "object"
        ? ((dados as Record<string, unknown>)[uf] ?? null)
        : dados;

    if (corpo == null) {
      // 503 com corpo que FECHA — o oposto do 500 pendurado que o BotID
      // produz. O portão continua vendo "sem payload", mas sem travar a rede.
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "no_payload", uf, cargo, fixture: arquivo }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(corpo),
    });
  });

  return true;
}

/**
 * Os dois rótulos de mapa que o produto publica hoje, medidos em 2026-09-21
 * com o stub acima instalado:
 *
 *   `/`, `/governador`  → "Mapa interativo do Brasil — UFs coloridas por projeção"
 *   `/uf/SP[/...]`      → "Mapa de líder por município — SP"
 *   esqueleto           → "Mapa do Brasil carregando" **+ `aria-busy="true"`**
 *
 * O seletor casa por "Mapa" no rótulo e **exclui pelo `aria-busy`**, não por
 * lista de rótulos: um mapa novo com rótulo novo passa a ser esperado sozinho,
 * em vez de sair da conta em silêncio. ⚠️ O preço é que um esqueleto futuro que
 * esqueça o `aria-busy` seria confundido com mapa montado — é o que
 * `MapSkeleton.tsx` garante hoje, e o que quebraria isto se mudar.
 */
const QUALQUER_MAPA = '[role="img"][aria-label*="Mapa"]';
const MAPA_MONTADO = '[role="img"][aria-label*="Mapa"]:not([aria-busy="true"])';

/**
 * Espera o mapa REAL montar — não o esqueleto.
 *
 * 🔴 Defeito corrigido em 2026-09-21, e ele NÃO era só local. `perf-budget`
 * esperava por `getByRole("img", { name: /mapa/i })`, com o comentário "o
 * placeholder de loading não tem essa role". **Tem.** `MapSkeleton.tsx:34-36`
 * declara `role="img"` + `aria-label="Mapa do Brasil carregando"` — casa com
 * `/mapa/i` e vem ANTES no DOM, então o `.first()` resolvia nele. Medido: a
 * espera "determinística de mapa montado" retornava em **12 ms**, com o
 * esqueleto ainda na tela. Quem de fato segurava a medição do RNF-007b era o
 * `networkidle` — justamente o que aquele comentário dizia ser pouco confiável.
 *
 * Devolve `false` quando a rota não tem mapa (`/deputado-federal`,
 * `/uf/SP/deputado-federal`, `/sobre-o-modelo`) — o chamador segue sem falhar.
 *
 * 🔴 Por que isto é um LAÇO e não dois `waitFor` em sequência. Um esqueleto
 * presente NÃO prova que a rota tem mapa: `app/loading.tsx:41` renderiza um
 * `<MapSkeleton>` como UI de carregamento de ROTA, e ele aparece por alguns
 * quadros até em `/deputado-federal`, que não tem mapa nenhum. Esperar o mapa
 * montado depois de vê-lo custava o timeout inteiro — **20 s medidos em cada
 * uma das duas rotas de Deputado**. O laço sai assim que o esqueleto some sem
 * mapa no lugar, que é a assinatura exata desse caso.
 *
 * A confirmação em DUAS leituras separadas por {@link INTERVALO_MS} existe
 * porque "sumiu" tem um falso positivo: entre o HTML do servidor e a
 * hidratação há quadros em que o nó está trocando de dono. Uma leitura só
 * devolveria `false` para uma rota que tem mapa sim.
 */
const INTERVALO_MS = 150;

export async function esperarMapaMontado(page: Page, timeout = 20_000): Promise<boolean> {
  const limite = Date.now() + timeout;
  let ausencias = 0;

  while (Date.now() < limite) {
    if (
      await page
        .locator(MAPA_MONTADO)
        .first()
        .isVisible()
        .catch(() => false)
    )
      return true;

    ausencias = (await page.locator(QUALQUER_MAPA).count()) === 0 ? ausencias + 1 : 0;
    if (ausencias >= 2) return false;

    await page.waitForTimeout(INTERVALO_MS);
  }
  return false;
}

/** O que sobrou em voo quando a rede não ficou ociosa. Ver {@link esperarRedeOciosa}. */
export interface RedeOciosa {
  ociosa: boolean;
  emVoo: string[];
}

/**
 * `networkidle` com teto, e com a degradação VISÍVEL.
 *
 * 🔴 Por que não um `waitForLoadState("networkidle")` seco: uma única
 * requisição que nunca fecha o trava para sempre — foi exatamente isso que
 * matou os dois portões (ver o cabeçalho deste arquivo). E por que não um
 * `.catch(() => {})` mudo: engolir o estouro faria o portão medir menos
 * script do que a rota carrega e continuar VERDE — um chunk tardio sumiria da
 * conta sem ninguém saber. Aqui o estouro devolve QUEM ficou em voo, para o
 * chamador anotar no relatório.
 */
export async function esperarRedeOciosa(page: Page, timeout = 10_000): Promise<RedeOciosa> {
  const emVoo = new Map<string, true>();
  const abre = (r: { url(): string }) => emVoo.set(r.url(), true);
  const fecha = (r: { url(): string }) => emVoo.delete(r.url());
  page.on("request", abre);
  page.on("requestfinished", fecha);
  page.on("requestfailed", fecha);

  const ociosa = await page
    .waitForLoadState("networkidle", { timeout })
    .then(() => true)
    .catch(() => false);

  page.off("request", abre);
  page.off("requestfinished", fecha);
  page.off("requestfailed", fecha);

  return { ociosa, emVoo: [...emVoo.keys()] };
}
