/**
 * scripts/edge-config-smoke.ts
 *
 * Smoke test de **gravação real** no Vercel Global Config (ex-Edge Config).
 *
 * Uso:
 *   set -a; . ./.env.local; set +a
 *   pnpm edge-config:smoke
 *
 * ---------------------------------------------------------------------------
 * Por que este script existe
 * ---------------------------------------------------------------------------
 * Três decisões de caminho crítico do AtlasMenna foram tomadas **sem nenhuma
 * confirmação empírica**, porque até 11/09 não havia token de escrita no
 * ambiente e a suíte inteira roda com `fetch` mockado:
 *
 *   1. **O padrão de chaves com `-` em vez de `:`.** `lib/edge-config/keys.ts`
 *      trocou o separador do ADR-0012 por leitura da doc
 *      (`^[A-Za-z0-9_-]+$`), registrando no próprio arquivo que não foi
 *      possível verificar se a API tolera `:`. Se a API aceitasse `:`, a
 *      troca teria sido desnecessária; se recusa, o esquema antigo nunca
 *      teria funcionado. O passo (f) mede isso — de forma **informativa**,
 *      sem alterar nada.
 *   2. **A guarda de tamanho do store** (`measureStore`,
 *      `GLOBAL_CONFIG_STORE_LIMIT_BYTES = 1 MB`) nunca leu um `sizeInBytes`
 *      de verdade. O passo (c) imprime o número real e a distância do limite.
 *   3. **O `teamId` na URL.** O token do AtlasMenna é de escopo de TIME e o
 *      store pertence ao time; sem `?teamId=` a API resolve no escopo pessoal
 *      e devolve 403/404. `vercelApiUrl` (em `lib/edge-config/writer.ts`)
 *      passou a anexá-lo, e este smoke é o único lugar onde isso é provado.
 *
 * O script grava numa chave **descartável** (`smoke-<ts>-SP-pres-t1`) e a
 * apaga no fim. Nunca toca `projection-*`.
 *
 * ---------------------------------------------------------------------------
 * A chave de teste não é arbitrária
 * ---------------------------------------------------------------------------
 * `smoke-<timestamp>-SP-pres-t1` carrega, de propósito, as duas coisas que o
 * esquema real depende e que a doc só afirma: **hífens como separador** e
 * **sigla de UF em MAIÚSCULA**. É a mesma forma de `projection-uf-SP-pres-t1`.
 * Ela passa por `assertValidGlobalConfigKey` antes de sair daqui — se o
 * esquema local recusasse a própria chave, o smoke falharia antes da rede.
 *
 * ---------------------------------------------------------------------------
 * Saída e exit codes
 * ---------------------------------------------------------------------------
 * Tabela `passo | status HTTP | latência ms | detalhe`, uma linha por passo.
 *
 *   0 — (a) upsert, (b) GET item com valor idêntico, (c) medição do store e
 *       (e) delete deram certo. (d) e (f) são informativos e não reprovam:
 *       (d) depende da `EDGE_CONFIG` (connection string de leitura) estar
 *       setada, e (f) mede o comportamento da API, não o nosso.
 *   1 — algum passo obrigatório falhou.
 *   2 — falta credencial (`EDGE_CONFIG_TOKEN` e/ou ID do store). Código
 *       distinto de 1 porque "não rodou" e "rodou e reprovou" exigem ações
 *       diferentes de quem chamou.
 *
 * O token **nunca** é impresso — nem truncado, nem em mensagem de erro. O
 * corpo de resposta da Vercel é truncado a 300 caracteres pelo mesmo motivo.
 */

import { fileURLToPath } from "node:url";
import { get as edgeConfigGet } from "@vercel/edge-config";
import { assertValidGlobalConfigKey } from "@/lib/edge-config/keys";
import {
  GLOBAL_CONFIG_STORE_LIMIT_BYTES,
  measureStore,
  resolveEdgeConfigId,
  vercelApiUrl,
  writeEdgePayload,
} from "@/lib/edge-config/writer";

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

/** Uma linha da tabela de saída. */
interface StepRow {
  /** Rótulo do passo, prefixado pela letra da sequência (a..f). */
  step: string;
  /** Status HTTP observado, ou `"—"` quando o passo não faz request. */
  status: string;
  /** Latência em ms, arredondada. */
  ms: number;
  /** Uma linha de diagnóstico legível. */
  detail: string;
  /** `false` reprova o smoke. Passos informativos usam `null`. */
  ok: boolean | null;
}

const rows: StepRow[] = [];

/** Marca de tempo de alta resolução, em ms. */
function now(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

/** Trunca corpo de resposta — nunca queremos despejar payload inteiro no terminal. */
function snippet(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Imprime a tabela final. Larguras calculadas do conteúdo — a saída é lida
 * no terminal por uma pessoa conferindo um gate, não parseada por máquina.
 */
function printTable(): void {
  const HEAD_STEP = "passo";
  const HEAD_STATUS = "status";
  const HEAD_MS = "latência ms";

  const wStep = Math.max(HEAD_STEP.length, ...rows.map((r) => r.step.length));
  const wStatus = Math.max(HEAD_STATUS.length, ...rows.map((r) => r.status.length));
  const wMs = Math.max(HEAD_MS.length, ...rows.map((r) => String(r.ms).length));

  console.log("");
  console.log(
    `  ${HEAD_STEP.padEnd(wStep)} | ${HEAD_STATUS.padEnd(wStatus)} | ${HEAD_MS.padStart(wMs)} | detalhe`,
  );
  console.log(
    `  ${"-".repeat(wStep)}-+-${"-".repeat(wStatus)}-+-${"-".repeat(wMs)}-+-${"-".repeat(40)}`,
  );
  for (const r of rows) {
    // `·` marca passo informativo, que não entra no veredito.
    const mark = r.ok === null ? "·" : r.ok ? "✓" : "✗";
    console.log(
      `${mark} ${r.step.padEnd(wStep)} | ${r.status.padEnd(wStatus)} | ${String(r.ms).padStart(wMs)} | ${r.detail}`,
    );
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Passos
// ---------------------------------------------------------------------------

/**
 * Chave descartável do ciclo. Timestamp compacto (`20260911T143005Z`) para
 * ser ordenável e legível caso um smoke interrompido deixe resíduo no store
 * — quem for limpar sabe de quando é.
 */
function smokeKey(): string {
  const compact = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return assertValidGlobalConfigKey(`smoke-${compact}-SP-pres-t1`, "edge-config-smoke");
}

/**
 * `PATCH .../items` com uma operação arbitrária. Usado pelo delete (e) e pelo
 * caso informativo (f), que precisam do status HTTP cru — `writeEdgePayload`
 * lança em non-2xx e não devolve o status.
 *
 * O caso (f) **não** passa por `assertValidGlobalConfigKey` de propósito: o
 * objetivo é medir a API, e a trava local impediria a chamada de sair.
 */
async function rawPatch(
  token: string,
  edgeConfigId: string,
  item: { operation: string; key: string; value?: unknown },
): Promise<{ status: number; body: string }> {
  const response = await fetch(vercelApiUrl(`/v1/edge-config/${edgeConfigId}/items`), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items: [item] }),
  });
  const body = await response.text().catch(() => "<corpo ilegível>");
  return { status: response.status, body };
}

async function main(): Promise<number> {
  const token = process.env.EDGE_CONFIG_TOKEN;
  const edgeConfigId = resolveEdgeConfigId();

  if (!token || !edgeConfigId) {
    console.error(
      [
        "[edge-config-smoke] credenciais ausentes — nada foi executado.",
        `  EDGE_CONFIG_TOKEN: ${token ? "presente" : "AUSENTE"}`,
        `  ID do store:       ${edgeConfigId ?? "AUSENTE (nem EDGE_CONFIG_ID nem EDGE_CONFIG)"}`,
        "",
        "  Gere um token de escopo de TIME em https://vercel.com/account/tokens e",
        "  defina em .env.local:",
        "    EDGE_CONFIG_TOKEN=<token>",
        "    EDGE_CONFIG_ID=ecfg_…",
        "    VERCEL_TEAM_ID=team_…",
        "",
        "  Depois: set -a; . ./.env.local; set +a; pnpm edge-config:smoke",
      ].join("\n"),
    );
    return 2;
  }

  const teamId = process.env.VERCEL_TEAM_ID;
  const key = smokeKey();
  const value = { ok: true, ts: new Date().toISOString() };

  console.log("[edge-config-smoke] alvo:");
  console.log(`  store   : ${edgeConfigId}`);
  console.log(`  teamId  : ${teamId ?? "(ausente — chamadas irão sem ?teamId=)"}`);
  console.log(`  chave   : ${key}`);

  // --- (a) upsert --------------------------------------------------------
  // Passa pelo `writeEdgePayload` real, e não por um fetch ad hoc: o que
  // queremos provar é que **o caminho de produção** grava, incluindo a trava
  // de chave e o `teamId`.
  let t = now();
  try {
    await writeEdgePayload(key, value);
    rows.push({
      step: "(a) upsert da chave",
      status: "2xx",
      ms: now() - t,
      detail: `writeEdgePayload OK · key=${key}`,
      ok: true,
    });
  } catch (err) {
    rows.push({
      step: "(a) upsert da chave",
      status: "erro",
      ms: now() - t,
      detail: snippet(err instanceof Error ? err.message : String(err)),
      ok: false,
    });
    printTable();
    console.error("[edge-config-smoke] upsert falhou — nada a limpar, nada a medir.");
    return 1;
  }

  // --- (b) GET do item ---------------------------------------------------
  // `GET /v1/edge-config/<id>/item/<key>` devolve o valor por si só; comparar
  // com o que mandamos fecha o laço write→read pela API de administração.
  t = now();
  let readBack: unknown = null;
  let readOk = false;
  let readStatus = "erro";
  let readDetail = "";
  try {
    const response = await fetch(
      vercelApiUrl(`/v1/edge-config/${edgeConfigId}/item/${encodeURIComponent(key)}`),
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    );
    readStatus = String(response.status);
    const text = await response.text();
    if (response.ok) {
      // A API pode devolver o valor cru ou um envelope `{ key, value, … }`.
      // Aceitamos os dois — o que importa é o valor.
      const parsed: unknown = text.length > 0 ? JSON.parse(text) : null;
      readBack =
        parsed && typeof parsed === "object" && "value" in (parsed as Record<string, unknown>)
          ? (parsed as { value: unknown }).value
          : parsed;
      readOk = JSON.stringify(readBack) === JSON.stringify(value);
      readDetail = readOk
        ? "valor idêntico ao gravado"
        : `valor DIFERENTE: ${snippet(JSON.stringify(readBack))}`;
    } else {
      readDetail = snippet(text);
    }
  } catch (err) {
    readDetail = snippet(err instanceof Error ? err.message : String(err));
  }
  rows.push({
    step: "(b) GET do item",
    status: readStatus,
    ms: now() - t,
    detail: readDetail,
    ok: readOk,
  });

  // --- (c) medição do store ----------------------------------------------
  // O número que a guarda de `writer.ts` compara com o limite, lido de
  // verdade pela primeira vez.
  t = now();
  let measureOk = false;
  let measureDetail = "";
  let measureStatus = "erro";
  try {
    const meta = await measureStore(token, edgeConfigId);
    measureStatus = "200";
    measureOk = true;
    const pct = ((meta.sizeInBytes / GLOBAL_CONFIG_STORE_LIMIT_BYTES) * 100).toFixed(2);
    measureDetail =
      `sizeInBytes=${meta.sizeInBytes.toLocaleString("pt-BR")} · ` +
      `${pct}% de ${GLOBAL_CONFIG_STORE_LIMIT_BYTES.toLocaleString("pt-BR")} B · ` +
      `itemCount=${Number.isFinite(meta.itemCount) ? meta.itemCount : "?"}`;
  } catch (err) {
    measureDetail = snippet(err instanceof Error ? err.message : String(err));
  }
  rows.push({
    step: "(c) measureStore",
    status: measureStatus,
    ms: now() - t,
    detail: measureDetail,
    ok: measureOk,
  });

  // --- (d) leitura pelo SDK (informativo) --------------------------------
  // Este é o caminho que o site de fato usa (`@vercel/edge-config`), e ele
  // depende de uma connection string de LEITURA — outra credencial, outro
  // endpoint. Informativo porque a `EDGE_CONFIG` pode legitimamente não
  // estar setada na máquina de quem roda o smoke. Vale lembrar que o Global
  // Config tem propagação eventual: uma divergência aqui logo após o upsert
  // pode ser só latência de replicação, não erro.
  t = now();
  if (process.env.EDGE_CONFIG) {
    let sdkDetail: string;
    try {
      const sdkValue = await edgeConfigGet(key);
      sdkDetail =
        sdkValue === undefined
          ? "chave ainda não visível pelo SDK (propagação é eventual)"
          : JSON.stringify(sdkValue) === JSON.stringify(value)
            ? "valor idêntico ao gravado"
            : `valor DIFERENTE: ${snippet(JSON.stringify(sdkValue))}`;
    } catch (err) {
      sdkDetail = snippet(err instanceof Error ? err.message : String(err));
    }
    rows.push({
      step: "(d) leitura via @vercel/edge-config",
      status: "—",
      ms: now() - t,
      detail: `${sdkDetail} (informativo)`,
      ok: null,
    });
  } else {
    rows.push({
      step: "(d) leitura via @vercel/edge-config",
      status: "—",
      ms: 0,
      detail: "pulado: EDGE_CONFIG (connection string) não está no ambiente",
      ok: null,
    });
  }

  // --- (e) delete --------------------------------------------------------
  // Obrigatório: um smoke que deixa lixo no store corrói exatamente o
  // orçamento de 1 MB que o passo (c) mede.
  t = now();
  let deleteOk = false;
  let deleteStatus = "erro";
  let deleteDetail = "";
  try {
    const res = await rawPatch(token, edgeConfigId, { operation: "delete", key });
    deleteStatus = String(res.status);
    deleteOk = res.status >= 200 && res.status < 300;
    deleteDetail = deleteOk ? "chave removida" : snippet(res.body);
  } catch (err) {
    deleteDetail = snippet(err instanceof Error ? err.message : String(err));
  }
  rows.push({
    step: "(e) delete da chave",
    status: deleteStatus,
    ms: now() - t,
    detail: deleteDetail,
    ok: deleteOk,
  });

  // --- (f) caso informativo: chave com `:` -------------------------------
  // A pergunta que `lib/edge-config/keys.ts` deixou aberta por escrito. Não
  // reprova o smoke em nenhum dos dois resultados: 4xx confirma a leitura da
  // doc que motivou a troca de separador; 2xx diz que a API tolera `:` — o
  // que NÃO reabre o esquema (o padrão documentado continua sendo a aposta
  // segura), mas é um fato que merece ir para o ADR.
  const colonKey = `smoke:${Date.now()}:colon:probe`;
  t = now();
  let colonStatus = "erro";
  let colonDetail = "";
  let colonAccepted = false;
  try {
    const res = await rawPatch(token, edgeConfigId, {
      operation: "upsert",
      key: colonKey,
      value: { probe: true },
    });
    colonStatus = String(res.status);
    colonAccepted = res.status >= 200 && res.status < 300;
    colonDetail = colonAccepted
      ? "API ACEITOU dois-pontos — inesperado; registrar no ADR-0012"
      : `API recusou dois-pontos, como esperado · ${snippet(res.body, 160)}`;
  } catch (err) {
    colonDetail = snippet(err instanceof Error ? err.message : String(err));
  }
  if (colonAccepted) {
    // Aceitou? Então virou lixo no store — apagar imediatamente.
    try {
      const cleanup = await rawPatch(token, edgeConfigId, { operation: "delete", key: colonKey });
      colonDetail += ` · limpeza: http ${cleanup.status}`;
    } catch (err) {
      colonDetail += ` · LIMPEZA FALHOU (apague ${colonKey} à mão): ${snippet(
        err instanceof Error ? err.message : String(err),
        80,
      )}`;
    }
  }
  rows.push({
    step: "(f) chave com `:` (informativo)",
    status: colonStatus,
    ms: now() - t,
    detail: colonDetail,
    ok: null,
  });

  // --- Veredito ----------------------------------------------------------
  printTable();

  const required = rows.filter((r) => r.ok !== null);
  const failed = required.filter((r) => r.ok === false);
  if (failed.length > 0) {
    console.error(
      `[edge-config-smoke] REPROVADO — ${failed.length} de ${required.length} passos obrigatórios falharam: ` +
        failed.map((r) => r.step).join(", "),
    );
    if (!teamId) {
      console.error(
        "  Dica: VERCEL_TEAM_ID não está setado. Se o store pertence a um time, a API " +
          "responde 403/404 sem ?teamId=.",
      );
    }
    return 1;
  }

  console.log(
    `[edge-config-smoke] OK — ${required.length} passos obrigatórios passaram (upsert, GET, medição, delete).`,
  );
  return 0;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("[edge-config-smoke] falha fatal:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
