/**
 * lib/edge-config/writer.ts
 *
 * Escrita no Vercel Global Config via REST API.
 *
 * Nomenclatura: o produto foi renomeado de **Edge Config** para **Global
 * Config** (changelog Vercel; docs em `/docs/global-config/*`). O pacote npm
 * segue sendo `@vercel/edge-config`, e os endpoints REST, variáveis de
 * ambiente (`EDGE_CONFIG`, `EDGE_CONFIG_ID`, `EDGE_CONFIG_TOKEN`), símbolos e
 * chaves deste módulo mantêm o nome antigo de propósito — renomear a 26 dias
 * do 1º turno é risco sem retorno. O texto novo usa "Global Config"; os
 * identificadores, não.
 *
 * Por quê uma camada própria?
 *   - O SDK `@vercel/edge-config` (já em deps) cobre só LEITURA. Para gravar
 *     itens é preciso bater diretamente em
 *     `PATCH https://api.vercel.com/v1/edge-config/<id>/items` com bearer
 *     token. Manter essa chamada num módulo dedicado isola o segredo, dá
 *     um ponto único pra instrumentação (logs, métricas, tamanho), e
 *     centraliza o no-op em ambientes sem credencial.
 *
 * Covers
 *   - RF-020 (persistência da projeção para leitura via Global Config) —
 *     write side. A leitura vive em código de UI usando o SDK.
 *   - ADR-0001 (Global Config como caminho de leitura no read path) — este
 *     writer é o ponto onde Postgres → Global Config se materializa.
 *
 * Exporta
 *   - `writeEdgePayload(key, value)` — primitivo de baixo nível (T03).
 *   - `writeProjection(payload)` — wrapper de alto nível (T14) que materializa
 *     UM `EdgePayload` em `projection-current` + N chaves `projection-uf-<SIGLA>`.
 *
 * Nomes de chave
 *   - Nenhuma chave é montada neste arquivo. Todas vêm de
 *     `lib/edge-config/keys.ts`, que é o ponto único de construção E de
 *     validação contra o padrão documentado `^[A-Za-z0-9_-]+$`.
 *   - `writeEdgePayload` valida a chave ANTES de bater na API da Vercel
 *     (`assertValidGlobalConfigKey`). É a trava que impede uma chave fora do
 *     padrão de chegar ao store, inclusive vinda de um caller ad hoc que
 *     tenha construído a string à mão.
 *
 * Behaviour
 *   - Chave fora do padrão documentado → throw ANTES do fetch, com mensagem
 *     que nomeia o caractere ofensor.
 *   - Sem `EDGE_CONFIG_TOKEN` ou `EDGE_CONFIG_ID` → no-op + warn estruturado.
 *     Isso é o esperado em preview deploys, CI e dev local quando ainda não
 *     há config Vercel — segue o mesmo padrão do `lib/tse/alerts.ts` quando
 *     `SLACK_WEBHOOK_URL` está ausente.
 *   - HTTP não-2xx → throw com mensagem clara incluindo status e snippet do
 *     corpo. Engolir erros aqui esconderia falhas de gravação que quebram
 *     `RF-019` em produção.
 *   - Erro de rede / DNS → throw com a cause original encadeada.
 *   - **Guarda de tamanho do store** (ver `guardStoreSize` abaixo): o limite
 *     da Vercel é por STORE INTEIRO, não por requisição. Antes de gravar,
 *     medimos o store e comparamos com o limite real; passando do limiar,
 *     emitimos aviso acionável.
 *
 * Quando a guarda recusa
 * ----------------------
 * Até 2026-09-18 esta seção dizia *"a guarda NUNCA aborta a gravação nem
 * propaga exceção — o pipeline vale mais que a instrumentação"*. Continua
 * verdade **como princípio**, e é por isso que a recusa tem duas condições,
 * não uma:
 *
 *   1. a medição foi **confiável** — o store foi medido E as chaves listadas,
 *      de modo que `projectedBytes` é projeção de verdade e não o
 *      `estimatedBytes` cego, que ignora tudo que não estamos escrevendo; e
 *   2. a projeção passa do **teto duro** (1 MB), não dos limiares de aviso.
 *
 * Fora disso — sem credencial, medição falhada, listagem falhada, bug na
 * própria guarda — ela segue devolvendo "pode gravar". Um defeito na
 * instrumentação nunca derruba a ingestão.
 *
 * 🔴 **A recusa não previne a falha, e é importante não vendê-la assim.** A
 * plataforma recusa sozinha acima de 1 MB: *"Updates to items in your Global
 * Config will be rejected if the resulting size would exceed your account
 * plan's limits"*. O que a recusa local acrescenta são três coisas:
 *
 *   - **diagnóstico** — em vez de um HTTP não-2xx opaco no meio da noite, a
 *     exceção já nomeia quanto ficaria, quanto cabe, e quais chaves apagar;
 *   - **consistência** — `writeProjection` grava várias chaves best-effort.
 *     Com o store cheio, algumas passariam e outras não, deixando um retrato
 *     meio gravado. Recusar o lote inteiro antes preserva o último payload
 *     coerente;
 *   - **alarme** — a recusa dispara `notifySlack` (mudo enquanto
 *     `SLACK_WEBHOOK_URL` não existir, como todo alarme deste repositório).
 *
 * E o leitor do site não fica no escuro por outro caminho: sem gravação,
 * `dado_ts` para de andar e a tela cai no aviso de dado parado
 * (ADR-0038 D3) — que é a máquina de frescor que já existe, não uma tela
 * nova.
 *   - `writeProjection`: best-effort por chave. Falha em UMA chave NÃO aborta
 *     as demais (cron é melhor parcialmente consistente do que totalmente
 *     ausente). Exceção final agrega o que falhou.
 */

import {
  agremiacoesDaListaRestante,
  type DeputadoUfDetail,
  type DeputadoUfDetailComTransporte,
  type DeputadoUfLista,
} from "@/lib/blob/deputado-uf";
import {
  deputadoUfBlobPathname,
  deputadoUfListaBlobPathname,
  prefixoBlobDeputado,
  ufDetailBlobPathname,
} from "@/lib/blob/paths";
import { splitUfPayload, type UfDetailBlob } from "@/lib/blob/uf-detail";
import { putJson } from "@/lib/blob/write";
import type { Cargo, Turno } from "@/lib/config/calendar";
import {
  type CargoProporcional,
  type CargoTse,
  cargoInfo,
  cargoToken,
  isCargoProporcional,
} from "@/lib/config/cargos";
import {
  assertValidGlobalConfigKey,
  currentProjectionKey,
  LEGACY_CURRENT_ALIAS_KEY,
  legacyUfAliasKey,
  ufProjectionKey,
} from "@/lib/edge-config/keys";
import type {
  EdgePayload,
  EdgePayloadDeputado,
  EdgePayloadUf,
  UfPayloadInput,
} from "@/lib/edge-config/types";
import { notifySlack } from "@/lib/tse/alerts";
import { logError, logInfo, logWarn } from "@/lib/tse/log";

// ---------------------------------------------------------------------------
// Config / constants
// ---------------------------------------------------------------------------

/** Base URL da API REST da Vercel. Exportado para os testes substituírem se necessário. */
const VERCEL_API_BASE = "https://api.vercel.com";

/**
 * Estado de processo do aviso de `VERCEL_TEAM_ID` ausente.
 *
 * O aviso vale UMA vez por processo: a ausência é uma propriedade do
 * ambiente, não do request. Sem esta trava, um ciclo do cron (que grava
 * 2 + 2N chaves e ainda mede o store) emitiria ~60 linhas idênticas e
 * afogaria os avisos que de fato mudam de ciclo pra ciclo.
 */
let teamIdWarningEmitted = false;

/**
 * Monta uma URL da API REST da Vercel anexando `?teamId=` quando
 * `VERCEL_TEAM_ID` está no ambiente.
 *
 * **Por que isto existe.** O token que grava no Global Config do AtlasMenna é
 * um token de escopo de TIME (`team_AqxGDYz4Zxs5wUBUDzIpcwBm`), porque o
 * store `ecfg_*` pertence ao time e não à conta pessoal. A API da Vercel
 * resolve o recurso no escopo PESSOAL do dono do token quando `teamId` não
 * vem na query — e o store simplesmente não existe lá. O resultado é
 * **403/404 em toda gravação**, não um erro de autenticação legível: o
 * token está válido, só está olhando para o lugar errado.
 *
 * As três chamadas deste módulo (`PATCH .../items`, `GET /v1/edge-config/<id>`
 * e `GET .../items`) passam por aqui. Nenhuma delas jamais rodou contra a
 * API real — a `EDGE_CONFIG_TOKEN` não existia no ambiente até 11/09 e a
 * suíte inteira roda com `fetch` mockado —, então este é exatamente o tipo
 * de detalhe que só apareceria na noite da apuração. `scripts/edge-config-smoke.ts`
 * é o contra-teste manual.
 *
 * Ausência de `VERCEL_TEAM_ID` **não** é erro: um token de escopo pessoal
 * apontando para um store pessoal funciona sem a query. Por isso apenas
 * avisamos (uma vez por processo, no formato estruturado do aviso de
 * credencial acima) e devolvemos a URL nua.
 *
 * @param path Caminho absoluto na API, começando com `/` (ex.
 *             `/v1/edge-config/ecfg_x/items`). Pode já carregar query
 *             string — o separador correto (`?` ou `&`) é escolhido.
 */
export function vercelApiUrl(path: string): string {
  const url = `${VERCEL_API_BASE}${path}`;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!teamId || teamId.length === 0) {
    if (!teamIdWarningEmitted) {
      teamIdWarningEmitted = true;
      logWarn("global-config: VERCEL_TEAM_ID ausente — chamadas à API da Vercel sem teamId", {
        note:
          "Token de escopo de TIME recebe 403/404 sem ?teamId=. Se o token for pessoal e o " +
          "store também, isto é esperado e inofensivo.",
      });
    }
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}teamId=${encodeURIComponent(teamId)}`;
}

/**
 * Lê o ID do Global Config diretamente da connection string que a Vercel
 * injeta como `EDGE_CONFIG`, OU de uma var explícita `EDGE_CONFIG_ID`.
 *
 * Formato `EDGE_CONFIG`:
 *   https://edge-config.vercel.com/ecfg_xxx?token=yyy
 *                                  ^^^^^^^^
 *
 * O SDK de leitura usa essa connection string direto; para o WRITE precisamos
 * só do `ecfg_*`, então parseamos.
 *
 * Exportado para `scripts/edge-config-smoke.ts` — o smoke precisa resolver o
 * mesmo ID por onde o writer grava; reimplementar a regex no script criaria
 * duas verdades e o smoke poderia passar contra um store que a produção não
 * usa.
 */
export function resolveEdgeConfigId(): string | null {
  const explicit = process.env.EDGE_CONFIG_ID;
  if (explicit && explicit.length > 0) return explicit;

  const connection = process.env.EDGE_CONFIG;
  if (!connection) return null;

  // Aceita tanto a URL completa quanto só o ID por defensividade.
  const match = connection.match(/ecfg_[A-Za-z0-9]+/);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Faz upsert de UM item no Global Config.
 *
 * @param key   Nome da chave (ex. `projection-current`). **Validado contra o
 *              padrão documentado `^[A-Za-z0-9_-]+$` antes de qualquer coisa
 *              — inclusive antes do curto-circuito de "sem credencial".** A
 *              ordem importa: se a validação viesse depois, uma chave
 *              inválida passaria silenciosamente em CI e dev local (onde não
 *              há credencial) e só quebraria em produção, que é exatamente o
 *              modo de falha que esta trava existe para eliminar.
 * @param value Valor — JSON-serializável. Sem validação de shape aqui;
 *              o caller (orchestrator, T12/T14) deve passar um `EdgePayload`.
 * @returns     `void` em sucesso ou no-op (sem credencial). Throws em falha
 *              HTTP / rede.
 *
 * @throws Error se a chave violar o padrão documentado do Global Config, se
 *               a Vercel API responder non-2xx, ou se o `fetch` falhar por
 *               motivo de rede.
 */
export async function writeEdgePayload(key: string, value: unknown): Promise<void> {
  // Trava de esquema de chave — ver `lib/edge-config/keys.ts`. Roda antes do
  // no-op sem credencial de propósito (ver @param key acima).
  assertValidGlobalConfigKey(key, "writeEdgePayload");

  const token = process.env.EDGE_CONFIG_TOKEN;
  const edgeConfigId = resolveEdgeConfigId();

  // No-op friendly: preview / CI / dev local sem creds não devem quebrar.
  // Logamos uma única linha estruturada pra ficar evidente nos logs por que
  // a gravação foi pulada.
  if (!token || !edgeConfigId) {
    logWarn("global-config write skipped: missing credentials", {
      key,
      hasToken: Boolean(token),
      hasEdgeConfigId: Boolean(edgeConfigId),
    });
    return;
  }

  const url = vercelApiUrl(`/v1/edge-config/${edgeConfigId}/items`);
  const body = JSON.stringify({
    items: [{ operation: "upsert", key, value }],
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (cause) {
    // Encadeia a causa para preservar stack trace original do fetch (DNS,
    // TLS, abort, etc.). Não logamos aqui — o caller decide se loga ou
    // re-throw silencioso.
    throw new Error(
      `global-config write failed (network) for key=${key}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }

  if (!response.ok) {
    // Snippet do corpo para diagnosticar 401 (token expirado), 403 (escopo),
    // 404 (id errado), e a recusa por tamanho quando o store resultante
    // passaria de 1 MB (ver `guardStoreSize` — a guarda avisa antes; este é
    // o erro que chega quando ninguém agiu). Trunca para não vazar payloads
    // gigantes em logs.
    const textSnippet = await response.text().catch(() => "<unreadable body>");
    const truncated = textSnippet.length > 500 ? `${textSnippet.slice(0, 500)}...` : textSnippet;
    throw new Error(
      `global-config write failed (http ${response.status}) for key=${key}: ${truncated}`,
    );
  }

  logInfo("global-config write ok", {
    key,
    status: response.status,
    bytes: body.length,
  });
}

/** 🔴 04/10/2026 — cópia de cada chave em `edge-espelho/<chave>.json` no Blob. */
export async function espelharNoBlob(
  entries: readonly { key: string; value: unknown }[],
): Promise<void> {
  const r = await Promise.allSettled(
    entries.map((e) => putJson(`edge-espelho/${e.key}.json`, e.value)),
  );
  const falhas = r.filter((x) => x.status === "rejected").length;
  if (falhas > 0) logWarn("espelho blob: falhas", { falhas, total: entries.length });
}

/** Lote de `upsert`s num PATCH só (dividido em blocos de até ~400 KB). */
export async function writeEdgeItemsBatch(
  entries: readonly { key: string; value: unknown }[],
): Promise<void> {
  const token = process.env.EDGE_CONFIG_TOKEN;
  const edgeConfigId = resolveEdgeConfigId();
  if (!token || !edgeConfigId) {
    logWarn("global-config batch write skipped: missing credentials", {
      n: entries.length,
    });
    return;
  }
  const url = vercelApiUrl(`/v1/edge-config/${edgeConfigId}/items`);
  const LIMITE = 400_000;
  const lotes: { operation: "upsert"; key: string; value: unknown }[][] = [];
  let atual: { operation: "upsert"; key: string; value: unknown }[] = [];
  let bytes = 0;
  for (const e of entries) {
    const n = JSON.stringify(e.value).length + e.key.length + 40;
    if (atual.length > 0 && bytes + n > LIMITE) {
      lotes.push(atual);
      atual = [];
      bytes = 0;
    }
    atual.push({ operation: "upsert", key: e.key, value: e.value });
    bytes += n;
  }
  if (atual.length > 0) lotes.push(atual);
  for (const items of lotes) {
    const body = JSON.stringify({ items });
    const response = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    });
    if (!response.ok) {
      const t = await response.text().catch(() => "<unreadable body>");
      throw new Error(
        `global-config batch write failed (http ${response.status}): ${t.slice(0, 500)}`,
      );
    }
    logInfo("global-config batch write ok", { keys: items.length, bytes: body.length });
  }
}

// ---------------------------------------------------------------------------
// Orçamento de tamanho — STORE inteiro (o limite que a Vercel de fato aplica)
// ---------------------------------------------------------------------------

/**
 * Limite duro de tamanho do Global Config, em bytes.
 *
 * Fonte: Vercel, `/docs/global-config/global-config-limits` (atualizada em
 * 2026-07-29). "Maximum store size" é **1 MB em Hobby, Pro e Enterprise** —
 * o mesmo número nos três planos, então não há upgrade que compre folga.
 * A doc é explícita quanto ao escopo: é *"the total size limit of each
 * store, including all keys and values"* — o limite é do STORE INTEIRO,
 * somando todas as chaves, não de cada requisição isoladamente.
 *
 * O valor anterior registrado neste arquivo (512 KB) estava errado, e a
 * validação era por requisição — somava só o payload sendo escrito e nunca
 * o que já estava no store. As duas coisas juntas significavam que a guarda
 * não guardava nada: podíamos passar de 1 MB de store com todos os avisos
 * em silêncio.
 *
 * **1 MB lido como 1.000.000 e não 1.048.576.** A doc escreve "1 MB" sem
 * dizer qual das duas convenções usa. Assumimos a decimal (a menor) porque
 * o erro é assimétrico: se a Vercel na verdade contar em MiB, sobra folga
 * de 48 KB e não perdemos nada; se assumíssemos MiB e eles contarem em MB,
 * estaríamos operando 48 KB ACIMA do teto real achando que estamos abaixo —
 * e o modo de falha é a escrita ser recusada na noite da apuração.
 *
 * Modo de falha documentado, para calibrar a severidade dos avisos abaixo:
 * *"Updates to items in your Global Config will be rejected if the resulting
 * size of your Global Config would exceed your account plan's limits."* Não
 * é truncamento nem degradação — é **recusa da escrita**. Em 04/10 isso
 * significa a projeção congelar no último payload que coube.
 */
export const GLOBAL_CONFIG_STORE_LIMIT_BYTES = 1_000_000;

/**
 * Limiar operacional de aviso: 780 KB = 78% do limite, 220 KB de folga.
 *
 * Por que abaixo do limite oficial, e por que 78%. O repositório já opera
 * com piso operacional distinto do mínimo formal quando o custo de errar é
 * alto: o ADR-0031 fixa `PARTY_SEPARATION_FLOOR = 12` contra o mínimo 10 da
 * constituição justamente porque *"10 cortaria rente ao mínimo
 * constitucional sem folga nenhuma"*; o ADR-0030 formaliza o orçamento de
 * aplicação com folga real medida em vez de um teto colado no limite. Mesma
 * lógica aqui — só que o "rente ao limite" custa a apuração inteira.
 *
 * A folga é dimensionada pela **taxa de crescimento medida**, não por gosto:
 *   - Volume medido hoje: 5.572 municípios em 27 UFs a ~206 B/município
 *     (medição sobre o payload real de MG) = **1.147.832 B só de arrays de
 *     municípios para UM cargo**, e ~2,19 MB com Presidente + Governador.
 *     Ou seja: com o detalhe municipal no Global Config, o store JÁ NÃO
 *     CABE — o aviso não é hipotético, é o estado atual. A migração do
 *     drill-down municipal para o Vercel Blob (ADR-0026) é o que resolve;
 *     esta guarda é o que mede se resolveu.
 *   - Esses ~1,15 MB não aparecem de uma vez: os arrays municipais enchem
 *     conforme as urnas chegam, ao longo de ~2h de apuração = ~120 ciclos
 *     de 60s (ADR-0011). Média ~9,6 KB/ciclo; como o TSE publica
 *     fortemente carregado no início, o pico fica em ~30 KB/ciclo.
 *   - 220 KB de folga ÷ 30 KB/ciclo ≈ **7 ciclos ≈ 7 minutos** de aviso
 *     antes da primeira recusa, no pior caso de crescimento. É o mínimo
 *     que dá para alguém ler o log, entender e apagar uma chave.
 */
const GLOBAL_CONFIG_STORE_WARN_BYTES = 780_000;

/**
 * Limiar crítico: 940 KB = 94% do limite, 60 KB de folga ≈ **2 ciclos** no
 * pico de crescimento. A partir daqui o aviso sobe para `error` e passa a
 * afirmar que a próxima escrita pode ser recusada — porque, na taxa medida,
 * pode mesmo. Dois níveis (warn/error) em vez de um só existem para que a
 * linha que exige ação humana imediata não se confunda, no meio da noite,
 * com a linha que só pede atenção.
 */
const GLOBAL_CONFIG_STORE_CRITICAL_BYTES = 940_000;

/**
 * Timeout da medição do store. A guarda é instrumentação: se a Vercel API
 * estiver lenta, desistimos rápido e gravamos assim mesmo. 5s cabe com
 * sobra no ciclo de 60s e nunca vira o gargalo do pipeline.
 */
const STORE_MEASURE_TIMEOUT_MS = 5_000;

/** Quantas chaves listar no aviso. 5 cabe numa linha de log legível. */
const LARGEST_KEYS_REPORTED = 5;

/**
 * Piso para uma chave entrar na lista de "maiores chaves": 1% do limite.
 * Apagar uma chave de 300 B não resolve nada, e listá-la só gasta a atenção
 * de quem está lendo o aviso sob pressão.
 */
const LARGEST_KEY_FLOOR_BYTES = GLOBAL_CONFIG_STORE_LIMIT_BYTES / 100;

// ---------------------------------------------------------------------------
// Orçamento de tamanho — por payload (aplicação, não plataforma)
// ---------------------------------------------------------------------------

/**
 * Limiar de aviso por payload individual. 450 KB é 45% do store inteiro numa
 * única chave — muito antes de a plataforma reclamar, isso já é sintoma de
 * bug de aplicação:
 *   - candidatos repetidos sem dedup
 *   - `insights` virou log de execução (deveria ser 1-3 frases curtas)
 *   - `por_uf` ganhou municípios (que pertencem ao drill-down, não ao nacional)
 *
 * Independente da guarda de store: esta olha UMA chave, aquela olha o total.
 * Uma chave de 450 KB é problema mesmo num store de 500 KB.
 */
const EDGE_CONFIG_SIZE_WARN_BYTES = 450 * 1024;

/**
 * Limites dedicados S05/F4c multi-candidato (ADR-0014, ADR-0017):
 *   - Nacional com 11 candidatos + `cenarios_2t` + `p_passa_2t`/`p_fecha_1t`
 *     em cada cand: tipicamente 30–55 KB. Warn em 75 KB = sinal de blow-up
 *     (e.g. `cenarios_2t` virou top-50 em vez de top-3).
 *   - UF com 11 candidatos + `top_candidatos` + `bucket` + mesorregiões:
 *     poucos KB. O número 20 KB foi calibrado em S05, quando `municipios` e
 *     `series_temporais` ainda estavam INLINE nesta chave; desde o ADR-0032 os
 *     dois vivem no Blob (`lib/blob/uf-detail.ts`) e o que sobra aqui é
 *     resumo. Mantido em 20 KB de propósito: passar disso agora significa que
 *     algo voltou a inflar o resumo — que é exatamente o que o aviso deve
 *     pegar.
 */
const EDGE_CONFIG_NATIONAL_WARN_BASE_BYTES = 75 * 1024;

/**
 * Elenco para o qual o piso de 75 KB foi calibrado (ADR-0014, S05): o
 * presidencial cheio. Abaixo disso o limiar não encolhe — o piso é piso.
 */
const EDGE_CONFIG_WARN_ELENCO_BASE = 12;

/**
 * Folga por candidatura ACIMA do elenco base.
 *
 * Medido em 2026-09-19 sobre os payloads reais, e a medição é o ponto:
 *
 * | cargo | candidaturas | payload | por candidatura |
 * |---|---|---|---|
 * | Presidente | 12 | 26,7 KiB | — |
 * | Governador | 180 | 70,0 KiB | **281 B** |
 * | Senador | 285 | 98,8 KiB | **281 B** |
 *
 * O custo marginal é **constante** nos dois cargos de 27 corridas — o que
 * varia é quanta gente concorre. 512 B é ~1,8× o medido: uma candidatura
 * ficar duas vezes mais cara continua sendo blow-up e continua acendendo a
 * luz; um cargo legitimamente disputado, não.
 */
const EDGE_CONFIG_WARN_BYTES_POR_CANDIDATURA = 512;

/**
 * Limiar de aviso do payload nacional, **em função do elenco**.
 *
 * 🔴 **Correção de 2026-09-19 — o limiar fixo media a coisa errada.** Os 75 KB
 * foram calibrados para "11 candidatos + `cenarios_2t`", e o comentário acima
 * diz isso por escrito. Aplicá-los ao Senado — que junta 27 corridas de 2
 * vagas num payload só, **285 candidaturas** — é comparar coisas diferentes: o
 * alarme tocava em 98,8 KiB por motivo nenhum, e tocava **desde antes** desta
 * rodada (94,3 KiB medidos no payload anterior). Um alarme que toca sempre é
 * um alarme que ninguém escuta, e este estava marcado como "nunca medido" no
 * planejamento da sprint — ou seja, ninguém nunca tinha olhado.
 *
 * O que o aviso existe para pegar continua igual: **blow-up estrutural**
 * (`cenarios_2t` virando top-50, candidatos duplicados sem dedup, `por_uf`
 * ganhando municípios). Nenhuma dessas coisas escala com o elenco — todas
 * escalam com o BYTE POR CANDIDATURA, que é justamente o que este limiar
 * agora mede.
 *
 * Resultado contra os payloads reais (folga de ~2,2× a 2,8× em todos):
 *
 * | cargo | limiar | payload real |
 * |---|---|---|
 * | Presidente (12) | 75 KiB | 26,7 KiB |
 * | Governador (180) | 159 KiB | 70,0 KiB |
 * | Senador (285) | 215 KiB | 98,8 KiB |
 *
 * ⚠️ Isto NÃO afrouxa o teto de verdade. A parede é o store inteiro — 1 MB de
 * plataforma, com aviso em {@link GLOBAL_CONFIG_STORE_WARN_BYTES} e erro em
 * {@link GLOBAL_CONFIG_STORE_CRITICAL_BYTES} —, e ela não mudou. Continua de pé
 * também {@link EDGE_CONFIG_SIZE_WARN_BYTES} (450 KiB), que pega "uma chave só
 * ocupando 45% do store" independentemente de quantas candidaturas ela tenha.
 */
export function limiarNacionalBytes(nCandidaturas: number): number {
  const excedente = Math.max(0, nCandidaturas - EDGE_CONFIG_WARN_ELENCO_BASE);
  return EDGE_CONFIG_NATIONAL_WARN_BASE_BYTES + excedente * EDGE_CONFIG_WARN_BYTES_POR_CANDIDATURA;
}

const EDGE_CONFIG_UF_WARN_BYTES = 20 * 1024;

// ---------------------------------------------------------------------------
// Guarda de tamanho do store
// ---------------------------------------------------------------------------

/** Tamanho contabilizado de UMA chave do store. */
interface KeySize {
  key: string;
  bytes: number;
}

/**
 * Custo de um item no documento do store, em bytes, comparável ao
 * `sizeInBytes` que a Vercel reporta.
 *
 * A Vercel conta o documento serializado inteiro ("including all keys and
 * values" — um store vazio reporta `sizeInBytes: 2`, que é o `{}`). Então a
 * conta local precisa incluir a sintaxe JSON do par, não só o valor:
 * `"chave":valor,` = nome da chave + 2 aspas + 1 dois-pontos + 1 vírgula.
 * Sem esses 4 bytes por chave, o número local ficaria ~224 B abaixo do
 * número da Vercel num store de 56 chaves — pouco, mas os dois números são
 * comparados lado a lado no aviso e precisam estar na mesma unidade.
 */
function itemBytes(key: string, serialisedValue: string): number {
  return key.length + 4 + serialisedValue.length;
}

/** `812345` → `"812 KB"`. KB decimal, coerente com o limite lido como 1 MB = 10^6. */
function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1000).toLocaleString("pt-BR")} KB`;
}

/** `0.7823` → `"78,2"`. */
function formatPct(part: number, whole: number): string {
  return ((part / whole) * 100).toFixed(1).replace(".", ",");
}

/**
 * Metadados do store, lidos SEM baixar o conteúdo.
 *
 * `GET /v1/edge-config/<id>` devolve `{ id, slug, digest, sizeInBytes,
 * itemCount, ownerId, createdAt, updatedAt }` — algumas centenas de bytes,
 * e nenhum par chave-valor. É a contabilidade da própria Vercel, isto é,
 * exatamente o número contra o qual o limite é aplicado; qualquer soma que
 * a gente fizesse localmente seria uma reconstrução aproximada dele.
 *
 * Custo por ciclo: 1 request, resposta ~200 B, contabilizada como 1 read
 * (a doc de limites é explícita: *"Vercel counts it as one read, regardless
 * of whether you retrieve one or all items"*). A 60s por ciclo são ~1.440
 * reads/dia — ruído contra o volume do read path. É por isso que esta é a
 * medição do caminho saudável, e a listagem de itens (cara) só entra
 * quando já estamos em apuros.
 *
 * @throws Error se a credencial faltar, o HTTP falhar, ou a resposta não
 *   trouxer `sizeInBytes` numérico. Caller trata — a guarda degrada.
 *
 * Exportado para `scripts/edge-config-smoke.ts`: a guarda de tamanho nunca
 * rodou contra a API real, e o smoke existe justamente para confrontar o
 * `sizeInBytes` que a Vercel reporta com o limite de 1 MB assumido aqui.
 */
export async function measureStore(
  token: string,
  edgeConfigId: string,
): Promise<{ sizeInBytes: number; itemCount: number }> {
  const response = await fetch(vercelApiUrl(`/v1/edge-config/${edgeConfigId}`), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(STORE_MEASURE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`http ${response.status}`);
  }

  const meta = (await response.json()) as { sizeInBytes?: unknown; itemCount?: unknown };
  if (typeof meta.sizeInBytes !== "number" || !Number.isFinite(meta.sizeInBytes)) {
    throw new Error("resposta sem sizeInBytes numérico");
  }

  return {
    sizeInBytes: meta.sizeInBytes,
    itemCount: typeof meta.itemCount === "number" ? meta.itemCount : Number.NaN,
  };
}

/**
 * Tamanho de CADA chave já presente no store.
 *
 * Isto baixa o store inteiro (até 1 MB) e por isso **só roda quando o
 * limiar já foi ultrapassado** — no caminho saudável não é chamado nenhuma
 * vez. A informação que ele acrescenta é a que a medição local não tem: o
 * tamanho das chaves que este ciclo **não** escreve. O caso concreto é
 * `projection-archive-*` — o congelamento do 1º turno que o `reader.ts` lê
 * e que ninguém apaga; em 25/10 o store carrega o arquivo inteiro do 1T
 * junto com o 2T ao vivo. Sem isto, o aviso listaria só as chaves que
 * estamos gravando e ficaria mudo justamente sobre o que dá para apagar.
 *
 * @throws Error em falha de HTTP / rede / parse. Caller degrada para a
 *   contabilidade local.
 */
async function fetchStoreKeySizes(token: string, edgeConfigId: string): Promise<KeySize[]> {
  const response = await fetch(vercelApiUrl(`/v1/edge-config/${edgeConfigId}/items`), {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(STORE_MEASURE_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`http ${response.status}`);
  }

  // O endpoint REST devolve uma lista de items `{ key, value, ... }`; o
  // endpoint de leitura otimizado devolve um objeto `{ chave: valor }`.
  // Aceitamos os dois — custa 6 linhas e evita que a guarda emudeça por
  // uma diferença de shape.
  const parsed: unknown = await response.json();
  const entries: Array<[string, unknown]> = Array.isArray(parsed)
    ? parsed
        .filter((item): item is { key: string; value: unknown } => {
          return typeof (item as { key?: unknown })?.key === "string";
        })
        .map((item) => [item.key, item.value])
    : Object.entries((parsed ?? {}) as Record<string, unknown>);

  return entries.map(([key, value]) => ({
    key,
    bytes: itemBytes(key, JSON.stringify(value) ?? "null"),
  }));
}

/**
 * Compara o tamanho do store com o limite real e, passando do limiar, emite
 * UM aviso acionável.
 *
 * **Nunca lança e nunca aborta a gravação.** Se a medição falhar, a
 * ingestão segue: o pipeline vale mais que a guarda. Toda a função vive
 * dentro de um try/catch, e o modo degradado ainda avalia o limiar contra a
 * contabilidade local (que não depende da rede) em vez de ficar cego.
 *
 * Como o total é estimado, e por que não é uma soma simples.
 *   Todas as nossas escritas são `upsert` — elas SUBSTITUEM a chave, não
 *   acrescentam. Somar `store + incoming` contaria nossas próprias chaves
 *   duas vezes e faria a guarda gritar todo ciclo (o writer grava
 *   praticamente o store inteiro). Então:
 *     - `storeBytes`    = o que está lá agora (nossas chaves no tamanho do
 *                         ciclo anterior + o que não tocamos).
 *     - `incomingBytes` = o que nosso conjunto de escrita vai ocupar depois.
 *     - estimativa      = `max(storeBytes, incomingBytes)` no caminho
 *                         normal. Como o conjunto de escrita cobre quase
 *                         todo o store, o tamanho pós-escrita fica entre os
 *                         dois e perto do segundo; o `max` é a leitura
 *                         conservadora, e os dois números vão no `ctx`
 *                         separados para ninguém depender da estimativa.
 *     - Quando a listagem por chave está disponível (só acima do limiar), a
 *       projeção vira exata: `store − Σ(tamanho antigo das chaves que vamos
 *       reescrever) + incoming`.
 *
 * @param incoming Chaves que ESTE ciclo vai gravar, já com tamanho medido.
 */
/**
 * O veredicto da guarda. `recusar` só vem `true` sob as DUAS condições do
 * § "Quando a guarda recusa" no cabeçalho deste arquivo.
 */
interface VeredictoDaGuarda {
  recusar: boolean;
  /** Mensagem já diagnosticada — quem recusa não precisa reescrevê-la. */
  motivo: string;
  projectedBytes: number;
}

const GUARDA_SEGUE = { recusar: false, motivo: "", projectedBytes: 0 } as const;

async function guardStoreSize(incoming: KeySize[]): Promise<VeredictoDaGuarda> {
  const incomingBytes = incoming.reduce((sum, k) => sum + k.bytes, 0) + 2; // +2 = `{}`

  try {
    const token = process.env.EDGE_CONFIG_TOKEN;
    const edgeConfigId = resolveEdgeConfigId();

    // Sem credencial não há store para medir. `writeEdgePayload` já loga o
    // no-op por chave; não duplicamos o aviso aqui.
    if (!token || !edgeConfigId) return GUARDA_SEGUE;

    let storeBytes: number | null = null;
    let itemCount = Number.NaN;
    let measureError: string | null = null;

    try {
      const meta = await measureStore(token, edgeConfigId);
      storeBytes = meta.sizeInBytes;
      itemCount = meta.itemCount;
    } catch (err) {
      measureError = err instanceof Error ? err.message : String(err);
    }

    // Modo degradado: sem o total do store, avaliamos o limiar contra o que
    // sabemos localmente. Subestima (ignora chaves que não escrevemos), mas
    // é muito melhor que ficar cego — e o aviso diz que está subestimando.
    const estimatedBytes =
      storeBytes === null ? incomingBytes : Math.max(storeBytes, incomingBytes);

    if (measureError !== null) {
      logWarn("global-config store guard degraded: não foi possível medir o store", {
        reason: measureError,
        incomingBytes,
        limitBytes: GLOBAL_CONFIG_STORE_LIMIT_BYTES,
        note: "gravação segue normalmente; limiar avaliado só contra as chaves deste ciclo",
      });
    }

    if (estimatedBytes <= GLOBAL_CONFIG_STORE_WARN_BYTES) {
      // Caminho saudável: uma linha info com o número, sem alarme. É o que
      // permite ver a curva de crescimento no gráfico depois.
      logInfo("global-config store size ok", {
        storeBytes,
        incomingBytes,
        itemCount,
        limitBytes: GLOBAL_CONFIG_STORE_LIMIT_BYTES,
        pctOfLimit: Number(
          formatPct(estimatedBytes, GLOBAL_CONFIG_STORE_LIMIT_BYTES).replace(",", "."),
        ),
      });
      return GUARDA_SEGUE;
    }

    // --- Acima do limiar: vale pagar pela lista de chaves. -----------------
    let storeKeys: KeySize[] = [];
    let breakdownSource = "local (só as chaves deste ciclo)";
    if (storeBytes !== null) {
      try {
        storeKeys = await fetchStoreKeySizes(token, edgeConfigId);
        breakdownSource = "store completo";
      } catch (err) {
        breakdownSource = `local (listagem do store falhou: ${
          err instanceof Error ? err.message : String(err)
        })`;
      }
    }

    // Chaves que vamos escrever entram com o tamanho NOVO; as demais, com o
    // tamanho atual no store.
    const sizes = new Map<string, number>();
    for (const { key, bytes } of storeKeys) sizes.set(key, bytes);
    const overwritten = storeKeys.reduce(
      (sum, k) => sum + (incoming.some((i) => i.key === k.key) ? k.bytes : 0),
      0,
    );
    for (const { key, bytes } of incoming) sizes.set(key, bytes);

    const projectedBytes =
      storeBytes !== null && storeKeys.length > 0
        ? Math.max(storeBytes - overwritten + incomingBytes, incomingBytes)
        : estimatedBytes;

    // Só chaves grandes o bastante para valer a pena apagar. Sem o filtro a
    // lista enche de `projection-uf-AC (0 KB)` e quem lê às 20h gasta a
    // atenção no ruído em vez de no arquivo de 196 KB logo acima. Se nada
    // passar do piso, mostramos as maiores mesmo assim — lista vazia seria
    // pior que lista pequena.
    const ranked = [...sizes.entries()]
      .map(([key, bytes]) => ({ key, bytes }))
      .sort((a, b) => b.bytes - a.bytes);
    const notable = ranked.filter((k) => k.bytes >= LARGEST_KEY_FLOOR_BYTES);
    const largest = (notable.length > 0 ? notable : ranked).slice(0, LARGEST_KEYS_REPORTED);

    const headroomBytes = GLOBAL_CONFIG_STORE_LIMIT_BYTES - projectedBytes;
    const critical = projectedBytes > GLOBAL_CONFIG_STORE_CRITICAL_BYTES;

    // A mensagem é escrita para ser lida às 20h de 04/10 por alguém sob
    // pressão: quanto tem, quanto cabe, quanto falta, o que é grande, e o
    // que fazer. Nessa ordem, numa linha só.
    const head = critical
      ? `global-config store size CRÍTICO: ${formatKb(projectedBytes)} de ${formatKb(
          GLOBAL_CONFIG_STORE_LIMIT_BYTES,
        )} (${formatPct(projectedBytes, GLOBAL_CONFIG_STORE_LIMIT_BYTES)}%) — faltam ${formatKb(
          headroomBytes,
        )} para o limite. A PRÓXIMA ESCRITA PODE SER RECUSADA pela Vercel.`
      : `global-config store size warning: ${formatKb(projectedBytes)} de ${formatKb(
          GLOBAL_CONFIG_STORE_LIMIT_BYTES,
        )} (${formatPct(projectedBytes, GLOBAL_CONFIG_STORE_LIMIT_BYTES)}%) — faltam ${formatKb(
          headroomBytes,
        )} para o limite.`;

    const keyList = largest.map((k) => `${k.key} (${formatKb(k.bytes)})`).join(", ");

    const remedy =
      "Para liberar espaço, na ordem: apagar chaves projection-archive-* de turno já encerrado; " +
      "conferir se algum payload de UF voltou a carregar `municipios`/`series_temporais` — " +
      "desde o ADR-0032 os dois vivem no Vercel Blob, e só o detalhe municipal mede ~1.148 KB, " +
      "que sozinho não cabe no store.";

    const message = `${head} Maiores chaves (${breakdownSource}): ${keyList}. ${remedy}`;

    const ctx = {
      storeBytes,
      incomingBytes,
      projectedBytes,
      limitBytes: GLOBAL_CONFIG_STORE_LIMIT_BYTES,
      warnThresholdBytes: GLOBAL_CONFIG_STORE_WARN_BYTES,
      criticalThresholdBytes: GLOBAL_CONFIG_STORE_CRITICAL_BYTES,
      headroomBytes,
      itemCount,
      breakdownSource,
      largestKeys: largest,
    };

    if (critical) {
      logError(message, ctx);
    } else {
      logWarn(message, ctx);
    }

    // --- A recusa. Ver § "Quando a guarda recusa" no cabeçalho. -----------
    //
    // `medicaoConfiavel` é a metade que mais importa: `projectedBytes` só é
    // uma projeção de verdade quando medimos o store E listamos as chaves.
    // Sem isso ele cai em `estimatedBytes`, que ignora tudo que não estamos
    // escrevendo agora — recusar sobre esse número seria derrubar a ingestão
    // por causa de instrumentação cega, que é exatamente o que o desenho
    // original desta guarda existe para não fazer.
    const medicaoConfiavel = storeBytes !== null && storeKeys.length > 0;
    if (medicaoConfiavel && projectedBytes > GLOBAL_CONFIG_STORE_LIMIT_BYTES) {
      const motivo =
        `RECUSADO ANTES DE TENTAR: o store ficaria com ${formatKb(projectedBytes)}, ` +
        `acima do teto de ${formatKb(GLOBAL_CONFIG_STORE_LIMIT_BYTES)}. ${message}`;
      logError(motivo, { ...ctx, recusado: true });
      // Fire-and-forget, como todo alarme daqui: mudo enquanto
      // `SLACK_WEBHOOK_URL` não existir, e nunca derruba o ciclo.
      void notifySlack({
        severity: "critical",
        msg: "gravação no Global Config recusada — store acima do teto",
        ctx: {
          projectedBytes,
          limitBytes: GLOBAL_CONFIG_STORE_LIMIT_BYTES,
          largestKeys: largest,
        },
      });
      return { recusar: true, motivo, projectedBytes };
    }

    return { recusar: false, motivo: "", projectedBytes };
  } catch (err) {
    // Rede de segurança final. Nada nesta função pode derrubar a ingestão —
    // nem um bug nela mesma.
    logWarn("global-config store guard failed: guarda de tamanho abortada", {
      reason: err instanceof Error ? err.message : String(err),
      incomingBytes,
      note: "gravação segue normalmente",
    });
    // 🔴 Um bug NESTA função nunca recusa nada. A guarda é instrumentação; o
    // pipeline vale mais que ela. Só uma medição bem-sucedida recusa.
    return GUARDA_SEGUE;
  }
}

// ---------------------------------------------------------------------------
// High-level — writeProjection (T14)
// ---------------------------------------------------------------------------

/**
 * Sumário de uma chave que falhou dentro do `writeProjection`. Mantemos o
 * shape pequeno para caber numa mensagem de erro legível (cron logs).
 */
interface WriteFailure {
  key: string;
  message: string;
}

/**
 * Mapeia o cargo numérico do TSE para o token de chave (ADR-0012) — `1` →
 * `"pres"`, `3` → `"gov"`, `5` → `"sen"`, `6` → `"dep"`.
 *
 * ⚠️ **Corrigido em 2026-09-12.** Até aqui o corpo era
 * `return cargoTse === 3 ? "gov" : "pres";`, com o comentário dizendo que
 * "cargos fora dos 2 cobertos caem em 'pres' por defensividade" e que "o
 * orchestrator nunca emite outros valores". As duas premissas caducaram em
 * 2026-09-11, quando Senador (5) e Deputado Federal (6) entraram na ingestão
 * e na tabela canônica: um payload de cargo 5 era gravado em
 * `projection-current-pres-t1` e **sobrescrevia a projeção presidencial** com
 * a corrida do Senado. Nenhum erro em lugar nenhum — a chave é válida e o
 * JSON é válido; só o conteúdo é de outra eleição.
 *
 * O default silencioso era o defeito. Agora o mapeamento vem da tabela única
 * (`lib/config/cargos.ts`) e um código não coberto **lança**: falhar um ciclo
 * é recuperável no ciclo seguinte; publicar a corrida errada sob a chave certa
 * não é.
 */
function cargoFromTseNumeric(cargoTse: CargoTse): Cargo {
  return cargoToken(cargoTse);
}

/**
 * Materializa UMA projeção completa no Global Config:
 *
 *   - 1 chave nacional NOMEADA `projection-current-<cargo>-t<turno>`
 *     (ADR-0012 — S05/F4c, com a emenda de separador de 2026-09-08).
 *   - 1 alias `projection-current` apontando para o MESMO valor — preserva
 *     o read path S04 dos consumidores que ainda não migraram.
 *   - N chaves de drill-down NOMEADAS `projection-uf-<SIGLA>-<cargo>-t<turno>`.
 *   - N aliases legacy `projection-uf-<SIGLA>` (mesmo valor).
 *
 * Total de chaves gravadas: `2 + 2N` (N = número de UFs em `por_uf`).
 *
 * **E, desde o ADR-0032, N objetos no Vercel Blob** — um por UF com payload
 * explícito, em `municipios/uf/<SIGLA>/<cargo>/t<turno>.json`, carregando os
 * dois campos que saíram do envelope de Global Config (`municipios`,
 * `series_temporais`). A fronteira é aplicada aqui, do lado TypeScript
 * (`splitUfPayload`): o orchestrator Python segue enviando tudo junto.
 *
 * Os dois mecanismos falham de forma INDEPENDENTE, de propósito (ADR-0032
 * item 3): uma falha de Blob **não** entra na exceção agregada desta função.
 * Ela é logada como `error` ("blob uf detail write failures") e o ciclo segue
 * — o resumo publicado vale mais que um ciclo marcado vermelho, e o read path
 * já degrada por seção com estado "detalhe indisponível" explícito no DOM. É
 * essa linha de log que o runbook precisa vigiar.
 *
 * Estratégia de granularidade do erro — **best-effort por chave**:
 *   Cada `writeEdgePayload` é tentado de forma INDEPENDENTE. Se a chave
 *   nacional falhar mas 26/27 UFs gravarem, o read path ainda serve o
 *   drill-down enquanto o nacional fica stale por <60 s (próximo ciclo do
 *   cron repete). O inverso também vale.
 *
 *   Alternativas consideradas e descartadas:
 *     a) Fail-fast: aborta na 1ª falha. Pior para resiliência do cron — uma
 *        UF com problema transitório (DNS hiccup) cancelaria toda a gravação.
 *     b) Transactional via tags: o Vercel Global Config não tem MVCC para
 *        múltiplas chaves; um PATCH com vários items é atômico, mas
 *        somando todas as chaves estouramos o limite por payload. Manter
 *        chaves separadas é o que o data-model.md determina (~30 KB +
 *        5–10 KB × 27 = ~270 KB de drill-down, longe de caber num único PATCH).
 *
 * @param payload     `EdgePayload` nacional canônico. `payload.cargo` e
 *                    `payload.turno` definem a chave nomeada.
 * @param payloadsUf  Opcional (S04/F2): mapa `sigla → UfPayloadInput` rico
 *                    com candidatos completos, municípios e séries temporais.
 *                    Quando presente, sobrescreve o esqueleto sintetizado
 *                    de `payload.por_uf`. Falta de uma UF cai no fallback
 *                    sintético — garante chave existe. O tipo é
 *                    `UfPayloadInput` (entrada) e não `EdgePayloadUf`
 *                    (armazenado): ver ADR-0032 e `lib/edge-config/types.ts`.
 * @throws Error agregando as chaves de GLOBAL CONFIG que falharam, com
 *               mensagem por chave. Falhas de Blob não entram aqui — são
 *               logadas como `error` (ver acima).
 */
export async function writeProjection(
  payload: EdgePayload,
  payloadsUf?: Record<string, UfPayloadInput>,
): Promise<void> {
  // Cargo PROPORCIONAL não passa por aqui (design 017 § D1). O tipo já
  // impediria — `EdgePayloadDeputado` não é atribuível a `EdgePayload` —, mas
  // esta função recebe `any` na prática: a ponte `/api/internal/edge-write`
  // faz `parsed.data.payload as any`, e ali um payload de cargo 6 entraria
  // sem `national` e gravaria um objeto sem agulha e sem candidatos sob a
  // chave `projection-current-dep-t1`. A guarda é de runtime porque o furo é
  // de runtime.
  if (cargoInfo(payload.cargo).proporcional) {
    throw new Error(
      `writeProjection: cargo ${payload.cargo} é proporcional e não usa o envelope ` +
        `EdgePayload (design 017 § D1 — EdgeNational é inteiramente majoritário). ` +
        `Use writeDeputadoProjection().`,
    );
  }

  // Resolve a chave nomeada via cargo/turno do payload. ADR-0012:
  // orchestrator é a fonte de verdade — payload.cargo/turno reflete a
  // corrida sendo gravada, NÃO a corrida ativa pelo calendário.
  const cargoLit: Cargo = cargoFromTseNumeric(payload.cargo);
  const turnoLit: Turno = payload.turno as Turno;
  const namedNationalKey = currentProjectionKey(cargoLit, turnoLit);

  // Tamanho do payload nacional (apenas — o por-UF é gravado em chaves
  // separadas e cada uma tem seu próprio orçamento). Stringify uma vez
  // para reusar tanto no warn quanto na chamada `writeEdgePayload` que
  // vai re-stringify; o custo é negligível (<1 ms p/ ~30 KB típico).
  const nationalJson = JSON.stringify(payload);

  // Warn dedicado multi-candidato (ADR-0014), com o limiar em função do
  // ELENCO desde 2026-09-19 — ver `limiarNacionalBytes`. O número fixo de
  // 75 KB fazia o Senado (285 candidaturas) acender a luz por existir.
  const limiarNacional = limiarNacionalBytes(payload.national?.candidatos?.length ?? 0);
  if (nationalJson.length > limiarNacional) {
    logWarn("global-config national payload oversize (S05 budget)", {
      key: namedNationalKey,
      bytes: nationalJson.length,
      threshold: limiarNacional,
      candidaturas: payload.national?.candidatos?.length ?? 0,
      storeLimit: GLOBAL_CONFIG_STORE_LIMIT_BYTES,
    });
  }
  // Warn agregado (S04): uma única chave ocupando ~45% do store inteiro.
  if (nationalJson.length > EDGE_CONFIG_SIZE_WARN_BYTES) {
    logWarn("global-config projection oversize", {
      key: namedNationalKey,
      bytes: nationalJson.length,
      threshold: EDGE_CONFIG_SIZE_WARN_BYTES,
      storeLimit: GLOBAL_CONFIG_STORE_LIMIT_BYTES,
    });
  }

  // Build per-UF payloads. Prioridade:
  //   1. `payloadsUf[sigla]` se fornecido (S04/F2 — payload rico do orchestrator).
  //   2. Esqueleto sintetizado de `payload.por_uf` (backward-compat — quando
  //      o orchestrator é antigo OU a UF caiu fora do mapa explícito).
  // Em ambos casos a chave EXISTE no Global Config — o read path nunca 404.
  //
  // S05/F4c — para cada UF gravamos DUAS chaves:
  //   - Nomeada: `projection-uf-<SIGLA>-<cargo>-t<turno>` (ADR-0012)
  //   - Alias legacy: `projection-uf-<SIGLA>` (backward-compat S04)
  // Mesmo valor nas duas chaves — escrita best-effort em paralelo.
  type UfKey = { key: string; payload: EdgePayloadUf };
  const ufKeys: UfKey[] = [];

  // Contabilidade de tamanho por chave, alimentando a guarda de store. Cada
  // payload de UF é serializado UMA vez e o tamanho reusado nas duas chaves
  // (nomeada + alias) que carregam o mesmo valor.
  const incomingSizes: KeySize[] = [
    { key: namedNationalKey, bytes: itemBytes(namedNationalKey, nationalJson) },
    {
      key: LEGACY_CURRENT_ALIAS_KEY,
      bytes: itemBytes(LEGACY_CURRENT_ALIAS_KEY, nationalJson),
    },
  ];

  // Detalhe municipal + séries de cada UF com payload explícito, destinado ao
  // Blob (ADR-0032). Uma entrada por UF — nunca por chave: o alias legacy
  // aponta para o mesmo resumo, e duplicar o objeto de detalhe no Blob custaria
  // o dobro de escrita por nada.
  const blobDetails: UfDetailBlob[] = [];

  for (const row of payload.por_uf) {
    const explicit = payloadsUf?.[row.sigla];

    // A fronteira campo a campo do ADR-0032 acontece aqui, num ponto só:
    // `stored` vai para o Global Config, `detail` vai para o Blob.
    let ufPayload: EdgePayloadUf;
    if (explicit) {
      const split = splitUfPayload(explicit, cargoLit, turnoLit);
      ufPayload = split.stored;
      blobDetails.push(split.detail);
    } else {
      // Esqueleto: orchestrator antigo sem payloads_uf. Página de UF
      // renderiza com placeholders gentis (constituição § 3). Sem entrada de
      // Blob — não há detalhe a publicar, e o read path degrada com
      // "detalhe indisponível" explícito (ADR-0032 item 3).
      ufPayload = {
        uf: row.sigla,
        ts: payload.ts,
        cargo: payload.cargo,
        turno: payload.turno,
        pct_apurado: row.pct_apurado,
        candidatos: [],
        needle_position: 0,
        needle_band: "tossup",
      };
    }

    const namedUfKey = ufProjectionKey(row.sigla, cargoLit, turnoLit);
    const aliasUfKey = legacyUfAliasKey(row.sigla);
    const ufJson = JSON.stringify(ufPayload);

    // Validação dedicada de tamanho UF (S05): 20KB é o orçamento pra UF
    // típica com 11 cands + top_candidatos + bucket + 645 municípios (SP).
    // Só vale para o payload rico do orchestrator — o esqueleto sintetizado
    // é pequeno por construção.
    if (explicit) {
      if (ufJson.length > EDGE_CONFIG_UF_WARN_BYTES) {
        logWarn("global-config uf payload oversize (S05 budget)", {
          key: namedUfKey,
          bytes: ufJson.length,
          threshold: EDGE_CONFIG_UF_WARN_BYTES,
          storeLimit: GLOBAL_CONFIG_STORE_LIMIT_BYTES,
        });
      }
      if (ufJson.length > EDGE_CONFIG_SIZE_WARN_BYTES) {
        logWarn("global-config uf payload oversize", {
          key: namedUfKey,
          bytes: ufJson.length,
          threshold: EDGE_CONFIG_SIZE_WARN_BYTES,
          storeLimit: GLOBAL_CONFIG_STORE_LIMIT_BYTES,
        });
      }
    }

    // Nomeada (S05+, primária).
    ufKeys.push({ key: namedUfKey, payload: ufPayload });
    // Alias legacy (S04 read path).
    ufKeys.push({ key: aliasUfKey, payload: ufPayload });

    incomingSizes.push({ key: namedUfKey, bytes: itemBytes(namedUfKey, ufJson) });
    incomingSizes.push({ key: aliasUfKey, bytes: itemBytes(aliasUfKey, ufJson) });
  }

  // Guarda de tamanho do STORE (não da requisição) — roda ANTES de gravar.
  // Desde o ADR-0032 ela mede o resumo JÁ SEM municípios/séries, que é o que
  // de fato vai para o store.
  //
  // ⚠️ Desde 18/09 ela PODE recusar — mas só sob medição confiável e só acima
  // do teto duro. Ver § "Quando a guarda recusa" no cabeçalho deste arquivo.
  const veredicto = await guardStoreSize(incomingSizes);
  if (veredicto.recusar) throw new Error(veredicto.motivo);

  // Blob em paralelo com o Global Config: os dois read paths são independentes
  // (ADR-0032 item 3) e serializá-los só somaria latência ao ciclo de 60 s.
  // Disparado aqui, colhido no fim — sem `await` no meio.
  const blobWrites = writeUfDetails(blobDetails);

  const failures: WriteFailure[] = [];

  // 🔴 04/10/2026 17h40 — UM PATCH com todas as chaves (em lotes por tamanho),
  // não um por chave. A API limita a 100 atualizações/hora: com ~58 PATCHes
  // por ciclo de Presidente o limite estourou às 17h30 e o site congelou.
  const todos: { key: string; value: unknown }[] = [
    { key: namedNationalKey, value: payload },
    { key: LEGACY_CURRENT_ALIAS_KEY, value: payload },
    ...ufKeys.map(({ key, payload: ufPayload }) => ({ key, value: ufPayload })),
  ];
  // Espelho no Blob ANTES do Global Config (que pode recusar por limite de
  // gravações/hora) — o reader fica com o `ts` mais novo dos dois.
  await espelharNoBlob(todos);
  try {
    await writeEdgeItemsBatch(todos);
  } catch (err) {
    failures.push({
      key: todos.map((t) => t.key).join(","),
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Colhe o Blob ANTES de decidir sobre a exceção: mesmo num ciclo que falhou
  // no Global Config, o detalhe municipal pode ter publicado, e o log precisa
  // dizer isso.
  const blob = await blobWrites;

  if (failures.length > 0) {
    const summary = failures.map((f) => `${f.key}: ${f.message}`).join("; ");
    throw new Error(
      `writeProjection: ${failures.length}/${ufKeys.length + 2} chave(s) falharam — ${summary}`,
    );
  }

  logInfo("global-config projection written", {
    namedKey: namedNationalKey,
    nationalBytes: nationalJson.length,
    ufKeysWritten: ufKeys.length,
    totalKeys: ufKeys.length + 2,
    blobWritten: blob.written,
    blobSkipped: blob.skipped,
    blobFailed: blob.failures.length,
    blobBytes: blob.bytes,
  });
}

// ---------------------------------------------------------------------------
// Escrita do detalhe por UF no Blob (ADR-0032)
// ---------------------------------------------------------------------------

/** Contabilidade de uma rodada de escrita de detalhe no Blob. */
interface BlobWriteSummary {
  written: number;
  skipped: number;
  bytes: number;
  failures: WriteFailure[];
}

/**
 * Publica o detalhe de cada UF no Blob, best-effort e em paralelo — a mesma
 * política por chave que o Global Config usa: uma UF com problema transitório
 * não cancela as outras 26.
 *
 * **Nunca lança.** Falhas voltam no sumário e são logadas como `error` pelo
 * caller. Ver o docblock de `writeProjection` para o porquê de o Blob não
 * derrubar o ciclo.
 *
 * Volume por ciclo: até 27 UFs × 1 objeto para o cargo sendo gravado. Com
 * Presidente e Governador rodando no mesmo cron de 60 s, até 54 `put()` por
 * ciclo — o número que o ADR-0032 registrou como pendência operacional a
 * validar antes do simulado 1.
 */
async function writeUfDetails(details: readonly UfDetailBlob[]): Promise<BlobWriteSummary> {
  const summary: BlobWriteSummary = { written: 0, skipped: 0, bytes: 0, failures: [] };
  if (details.length === 0) return summary;

  const results = await Promise.allSettled(
    details.map(async (detail) => {
      const pathname = ufDetailBlobPathname(detail.uf, detail.cargo, detail.turno);
      return putJson(pathname, detail);
    }),
  );

  results.forEach((result, i) => {
    const detail = details[i];
    if (result.status === "fulfilled") {
      if (result.value.status === "written") summary.written += 1;
      else summary.skipped += 1;
      summary.bytes += result.value.bytes;
      return;
    }
    summary.failures.push({
      key: detail ? `municipios/uf/${detail.uf}` : `municipios/uf/<index-${i}>`,
      message: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });

  if (summary.failures.length > 0) {
    logError("blob uf detail write failures", {
      failed: summary.failures.length,
      total: details.length,
      detail: summary.failures
        .map((f) => `${f.key}: ${f.message}`)
        .join("; ")
        .slice(0, 800),
    });
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Cargos proporcionais — spec 017 / design 017 § D1, D5, D6; spec 027
// ---------------------------------------------------------------------------

/**
 * Materializa a projeção de um cargo **proporcional** — Deputado Federal (6),
 * Estadual (7) ou Distrital (8):
 *
 *   - 1 chave nacional `projection-current-<dep|est|dis>-t1` no Global Config (D5);
 *   - N objetos `<deputado|deputado-estadual|deputado-distrital>/uf/<SIGLA>.json`
 *     no Vercel Blob (D6, RF-129), mais as listas 61+ em `…/uf-lista/`.
 *
 * ## O cargo sai do PAYLOAD, e decide tudo (spec 027 RF-279)
 *
 * Chave e prefixo do Blob derivam de `payload.cargo`, validado como
 * proporcional (senão lança — nenhum default escolhe o federal). Até
 * 2026-09-29 a chave era `currentProjectionKey(cargoToken(6), 1)` e o caminho
 * `deputado/uf/<SIGLA>`, fixos: um payload de SP estadual teria gravado por
 * cima de SP federal, nas duas pontas, com sucesso. E cada objeto de UF que
 * declare um `cargo` DIFERENTE do payload é recusado (falha daquela UF, com
 * `error`), para que um produtor que misture casas não publique uma UF no
 * endereço da outra.
 *
 * ## Por que é uma função separada e não um ramo de `writeProjection`
 *
 * Porque o envelope é outro. `writeProjection` recebe `EdgePayload`, cujo
 * `national` é `EdgeNational` — inteiramente majoritário. Enfiar a corrida
 * proporcional ali obrigaria a inventar oito campos, e é exatamente isso que a
 * decisão D1 do design 017 recusa. A simetria com `writeProjection` é de
 * **política**, não de tipo: mesma guarda de tamanho de store, mesmo
 * best-effort por chave, mesma independência entre Global Config e Blob.
 *
 * ## Nenhum alias
 *
 * `writeProjection` grava também `projection-current` e
 * `projection-uf-<SIGLA>` — aliases legados de S04, que existiram só para a
 * corrida presidencial. Este cargo nasce depois deles; replicá-los aqui
 * criaria chaves que ninguém lê e que competiriam pelo 1 MB do store.
 *
 * ## Blob e Global Config falham de forma independente (ADR-0032 item 3)
 *
 * Uma falha de Blob **não** entra na exceção agregada: ela é logada como
 * `error` ("blob deputado uf write failures") e o ciclo segue. O resumo
 * publicado vale mais que um ciclo marcado vermelho, e a página degrada por
 * seção com "detalhe indisponível" explícito no DOM (RF-129, constituição § 7).
 * É essa linha de log que o runbook precisa vigiar.
 *
 * @param payload   Payload nacional (`EdgePayloadDeputado`).
 * @param detalhes  Mapa `sigla → DeputadoUfDetail`. Ausente ⇒ nada vai para o
 *                  Blob e cada página de UF degrada com "detalhe
 *                  indisponível" — nunca com um resumo mentiroso.
 * @throws Error quando a chave de Global Config falha. Falhas de Blob não
 *         entram aqui (ver acima).
 */
export async function writeDeputadoProjection(
  payload: EdgePayloadDeputado,
  detalhes?: Record<string, DeputadoUfDetailComTransporte>,
): Promise<void> {
  // O cargo vem do payload e é validado aqui, na fronteira: a rota de escrita
  // chama com `any`, e o tipo não protege ali. Sem default.
  const cargo: unknown = payload.cargo;
  if (typeof cargo !== "number" || !isCargoProporcional(cargo)) {
    throw new Error(
      `writeDeputadoProjection: cargo ${String(cargo)} não é proporcional — ` +
        `use writeProjection() para os majoritários.`,
    );
  }
  // Turno único (`temSegundoTurno: false`): a chave é sempre `-t1`. Não sai
  // de `payload.turno` para que um payload malformado com `turno: 2` não
  // inaugure uma chave que nenhum leitor consulta.
  const nationalKey = currentProjectionKey(cargoToken(cargo), 1);
  const nationalJson = JSON.stringify(payload);

  // Deputado usa o PISO de `limiarNacionalBytes`, sem excedente, e o zero é
  // deliberado: este payload não tem elenco nacional para escalar por. Ele
  // carrega `bancada`/`composition`/`por_uf` (agregados por PARTIDO), não uma
  // lista de candidaturas — medido em 19/09: 11,1 KiB contra 75 KiB de piso.
  // Escrever `0` aqui em vez de reaproveitar uma contagem de outro cargo é o
  // que impede o limiar deste payload de flutuar por um número que não é dele.
  const limiarDeputado = limiarNacionalBytes(0);
  if (nationalJson.length > limiarDeputado) {
    logWarn("global-config national payload oversize (S05 budget)", {
      key: nationalKey,
      bytes: nationalJson.length,
      threshold: limiarDeputado,
      storeLimit: GLOBAL_CONFIG_STORE_LIMIT_BYTES,
    });
  }
  if (nationalJson.length > EDGE_CONFIG_SIZE_WARN_BYTES) {
    logWarn("global-config projection oversize", {
      key: nationalKey,
      bytes: nationalJson.length,
      threshold: EDGE_CONFIG_SIZE_WARN_BYTES,
      storeLimit: GLOBAL_CONFIG_STORE_LIMIT_BYTES,
    });
  }

  // Guarda de tamanho do STORE (não da requisição) — roda ANTES de gravar.
  // Uma chave só: o detalhe por UF deste cargo não toca o Global Config.
  // Desde 18/09 pode recusar; ver § "Quando a guarda recusa" no cabeçalho.
  const veredictoDep = await guardStoreSize([
    { key: nationalKey, bytes: itemBytes(nationalKey, nationalJson) },
  ]);
  if (veredictoDep.recusar) throw new Error(veredictoDep.motivo);

  // Blob em paralelo com o Global Config — os dois read paths são
  // independentes e serializá-los só somaria latência ao ciclo.
  const blobWrites = writeDeputadoUfDetails(cargo, Object.values(detalhes ?? {}));

  let failure: WriteFailure | null = null;
  try {
    await espelharNoBlob([{ key: nationalKey, value: payload }]);
    await writeEdgePayload(nationalKey, payload);
  } catch (err) {
    failure = { key: nationalKey, message: err instanceof Error ? err.message : String(err) };
  }

  // Colhe o Blob ANTES de decidir sobre a exceção: mesmo num ciclo que falhou
  // no Global Config, o detalhe por UF pode ter publicado, e o log precisa
  // dizer isso.
  const blob = await blobWrites;

  if (failure) {
    throw new Error(`writeDeputadoProjection: ${failure.key}: ${failure.message}`);
  }

  logInfo("global-config deputado projection written", {
    cargo,
    namedKey: nationalKey,
    nationalBytes: nationalJson.length,
    ufs: payload.por_uf.length,
    cadeirasAtribuidas: payload.bancada.cadeiras_atribuidas,
    totalCadeiras: payload.bancada.total_cadeiras,
    blobWritten: blob.written,
    blobSkipped: blob.skipped,
    blobFailed: blob.failures.length,
    blobBytes: blob.bytes,
    listasWritten: blob.listas.written,
    listasBytes: blob.listas.bytes,
  });
}

/** Sumário da escrita de Deputado: o dos objetos de UF + o das listas 61+. */
interface DeputadoBlobWriteSummary extends BlobWriteSummary {
  listas: { written: number; skipped: number; bytes: number };
}

/**
 * Separa o campo de TRANSPORTE `lista_restante` do objeto da UF (spec 026,
 * ADR-0065 D4, design § 2.5).
 *
 * O Python manda as linhas 61+ dentro de `payloads_uf[UF]` porque o corpo da
 * rota de escrita descarta chave nova no topo; elas não pertencem ao objeto da
 * UF — que a página baixa inteiro no primeiro render —, e sim ao objeto de
 * lista, que só é pedido no clique. `detalhe` sai SEM a chave, e a separação é
 * feita aqui, num lugar só, antes de qualquer gravação.
 *
 * `lista: null` — nada a gravar — em três casos: produtor v1 (sem o campo),
 * campo malformado (com `warn`), e lista sem NENHUMA linha (design § 2.5:
 * "grava só se houver ao menos uma linha"; o objeto da UF então não traz
 * `lista`, e a tela não oferece o botão).
 */
export function separarListaRestante(
  bruto: DeputadoUfDetailComTransporte,
  carimbo: string,
  cargo: CargoProporcional,
): { detalhe: DeputadoUfDetail; lista: DeputadoUfLista | null } {
  const { lista_restante, ...detalhe } = bruto;
  const uf = bruto.uf.toUpperCase();
  const agremiacoes = agremiacoesDaListaRestante(lista_restante);
  if (lista_restante !== undefined && agremiacoes === null) {
    logWarn("blob deputado uf-lista: lista_restante malformada — lista NÃO gravada neste ciclo", {
      uf,
    });
  }
  const temLinha = agremiacoes?.some((a) => a.candidatos.length > 0) ?? false;
  return {
    // `cargo` carimbado como `ts`/`uf`: o objeto sai autodescritivo mesmo se o
    // produtor não mandou o campo, e o leitor confere (spec 027 RF-279).
    detalhe: { ...detalhe, ts: carimbo, uf, cargo },
    lista:
      agremiacoes !== null && temLinha
        ? { ts: carimbo, cargo, turno: 1, contrato: 2, uf, agremiacoes }
        : null,
  };
}

/** Resultado da gravação de UM objeto — para o sumário. */
type GravacaoBlob =
  | { key: string; lista: boolean; ok: true; status: "written" | "skipped"; bytes: number }
  | { key: string; lista: boolean; ok: false; message: string };

async function gravarObjeto(key: string, lista: boolean, gravar: () => ReturnType<typeof putJson>) {
  try {
    const r = await gravar();
    return {
      key,
      lista,
      ok: true,
      status: r.status,
      bytes: r.bytes,
    } as const satisfies GravacaoBlob;
  } catch (err) {
    return {
      key,
      lista,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    } as const satisfies GravacaoBlob;
  }
}

/**
 * Publica o detalhe de cada UF de UM cargo proporcional no Blob — best-effort,
 * UFs em paralelo, a mesma política por chave do Global Config: uma UF com
 * problema transitório não cancela as outras.
 *
 * `cargo` é o do payload (validado em `writeDeputadoProjection`) e decide o
 * prefixo dos caminhos (`deputadoUfBlobPathname(cargo, uf)`). Um objeto de UF
 * cujo `cargo` declarado difere dele é recusado como falha daquela UF — nunca
 * gravado no endereço de outra casa (spec 027 RF-279). E uma UF sem a corrida
 * do cargo (o 8 fora do DF) também falha: o construtor de caminho lança.
 *
 * **Nunca lança.** Falhas voltam no sumário e são logadas como `error`.
 *
 * O `ts` de cada objeto é carimbado **aqui**, no instante da gravação, e não
 * herdado do payload nacional — mesma decisão (e mesma razão) de
 * `splitUfPayload`: as duas escritas não são atômicas entre si, um ciclo pode
 * publicar o resumo e falhar o detalhe, e a UI precisa poder datar os dois
 * separadamente. O objeto de lista leva o MESMO carimbo do objeto da UF.
 *
 * **Dentro de uma UF, a lista vai ANTES** (design 026 § 2.5): quem lê
 * `lista.restantes > 0` no objeto da UF nunca encontra uma lista mais velha
 * que ele. Se a lista falhar, o objeto da UF é gravado mesmo assim — o resumo
 * vale mais —, e a falha vira `error` no log; as duas peças então divergem por
 * um ciclo, e a tela mostra a hora de cada uma (ADR-0065 D4).
 *
 * Volume por ciclo: até 27 `put()` de UF, a cada **30 minutos** — a volta
 * completa das 6 fatias do cron do cargo (ADR-0036) —, mais um por UF que
 * tenha linha 61+ (na prática, só SP).
 */
async function writeDeputadoUfDetails(
  cargo: CargoProporcional,
  details: readonly DeputadoUfDetailComTransporte[],
): Promise<DeputadoBlobWriteSummary> {
  const summary: DeputadoBlobWriteSummary = {
    written: 0,
    skipped: 0,
    bytes: 0,
    failures: [],
    listas: { written: 0, skipped: 0, bytes: 0 },
  };
  if (details.length === 0) return summary;

  const carimbo = new Date().toISOString();
  // O mesmo prefixo do caminho (`deputado`, `deputado-estadual`,
  // `deputado-distrital`) nomeia as falhas no log — o federal fica idêntico ao
  // de antes da spec 027, que é o que o runbook manda vigiar.
  const rotulo = prefixoBlobDeputado(cargo);

  const porUf = await Promise.all(
    details.map(async (bruto): Promise<GravacaoBlob[]> => {
      const ufBruta = String((bruto as { uf?: unknown }).uf);
      const cargoDeclarado = (bruto as { cargo?: unknown }).cargo;
      if (cargoDeclarado !== undefined && cargoDeclarado !== cargo) {
        return [
          {
            key: `${rotulo}/uf/${ufBruta}`,
            lista: false,
            ok: false,
            message:
              `objeto da UF declara cargo ${String(cargoDeclarado)}, payload é do cargo ` +
              `${cargo} — NÃO gravado (seria o endereço de outra casa)`,
          },
        ];
      }
      let separado: ReturnType<typeof separarListaRestante>;
      try {
        separado = separarListaRestante(bruto, carimbo, cargo);
      } catch (err) {
        return [
          {
            key: `${rotulo}/uf/${ufBruta}`,
            lista: false,
            ok: false,
            message: err instanceof Error ? err.message : String(err),
          },
        ];
      }
      const { detalhe, lista } = separado;
      const feitas: GravacaoBlob[] = [];
      if (lista) {
        feitas.push(
          await gravarObjeto(`${rotulo}/uf-lista/${lista.uf}`, true, () =>
            putJson(deputadoUfListaBlobPathname(cargo, lista.uf), lista),
          ),
        );
      }
      feitas.push(
        await gravarObjeto(`${rotulo}/uf/${detalhe.uf}`, false, () =>
          putJson(deputadoUfBlobPathname(cargo, detalhe.uf), detalhe),
        ),
      );
      return feitas;
    }),
  );

  const gravacoes = porUf.flat();
  for (const g of gravacoes) {
    if (!g.ok) {
      summary.failures.push({ key: g.key, message: g.message });
      continue;
    }
    const alvo = g.lista ? summary.listas : summary;
    if (g.status === "written") alvo.written += 1;
    else alvo.skipped += 1;
    alvo.bytes += g.bytes;
  }

  if (summary.failures.length > 0) {
    logError("blob deputado uf write failures", {
      cargo,
      failed: summary.failures.length,
      total: gravacoes.length,
      ufs: details.length,
      detail: summary.failures
        .map((f) => `${f.key}: ${f.message}`)
        .join("; ")
        .slice(0, 800),
    });
  }

  return summary;
}
