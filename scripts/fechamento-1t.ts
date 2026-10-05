/**
 * scripts/fechamento-1t.ts — `pnpm fechamento:1t`
 *
 * Fecha o resultado do 1º turno de 2026 no que o site lê (Global Config +
 * espelho no Blob). Regras e convenções em `scripts/_fechamento-1t-core.ts`;
 * roteiro de operação em `docs/operations/runbook.md` § "Fechamento do 1º
 * turno".
 *
 *   pnpm fechamento:1t                 # ENSAIO: lê tudo, arquiva local, mostra o diff
 *   pnpm fechamento:1t --escrever      # arquiva no Blob, grava Global Config + espelho
 *   pnpm fechamento:1t --env-file <caminho/.env.local>   # ex.: rodando de um worktree
 *
 * 🔴 NÃO carregue o `.env.local` com `set -a`: este script não toca banco e lê
 * o arquivo por LISTA BRANCA (o molde de `scripts/_vigia-env.ts`). O
 * `DATABASE_URL` nunca entra — e, por garantia, é apagado do ambiente.
 *
 * Ordem na escrita:
 *   1. arquivo intocado de cada chave em `arquivo/1t-2026/<chave>.json` no
 *      Blob (só se ainda não existir — rodar duas vezes não sobrescreve o
 *      original com a versão já fechada) e em `build/fechamento-1t/<carimbo>/`;
 *   2. UM lote de `upsert` no Global Config (`writeEdgeItemsBatch` — o
 *      primitivo divide em requisições de até ~400 KB; o lote inteiro cabe em
 *      2, longe do limite de 100 gravações/hora);
 *   3. espelho em `edge-espelho/<chave>.json` (`espelharNoBlob`).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aplicarTseNacionalPresidente,
  aplicarTseUfPresidente,
  carimbar,
  diffFolhas,
  faltaIdentidade,
  igualarDeputado,
  igualarNacionalMajoritario,
  igualarUfMajoritario,
  parseTseAgregado,
  type TseAgregado,
  tseCompleto,
} from "./_fechamento-1t-core";
import { selecionarEnvDoVigia } from "./_vigia-env";

/** As ÚNICAS variáveis lidas do `.env.local`. Nenhuma toca banco. */
export const ENV_DO_FECHAMENTO = [
  "EDGE_CONFIG",
  "EDGE_CONFIG_ID",
  "EDGE_CONFIG_TOKEN",
  "VERCEL_TEAM_ID",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_PUBLIC_BASE_URL",
] as const;

const TSE = "https://resultados.tse.jus.br/oficial/ele2026";
/** Presidente: eleição federal 6257. Governador e Senador: 6259. */
const ELEICAO = { 1: "6257", 3: "6259", 5: "6259" } as const;
const UFS = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
] as const;
const ARQUIVO_BLOB = "arquivo/1t-2026";

type Obj = Record<string, unknown>;

function carregarEnv(argv: string[]): void {
  const i = argv.indexOf("--env-file");
  const caminho = i >= 0 && argv[i + 1] ? argv[i + 1] : resolve(process.cwd(), ".env.local");
  let bruto = "";
  try {
    bruto = readFileSync(caminho as string, "utf8");
  } catch {
    console.warn(`(sem ${caminho} — usando só o ambiente)`);
  }
  const sel = selecionarEnvDoVigia(bruto, {}, ENV_DO_FECHAMENTO);
  for (const k of ENV_DO_FECHAMENTO) {
    const v = sel[k];
    if (v && !process.env[k]) process.env[k] = v;
  }
  // Ceinture et bretelles: este script não tem o que fazer com banco.
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_UNPOOLED;
  delete process.env.POSTGRES_URL;
}

/** Fetch ao TSE SEM User-Agent próprio (o Akamai recusa o nosso, 403). */
async function tse(cargo: 1 | 3 | 5, abr: string): Promise<TseAgregado> {
  const ele = ELEICAO[cargo];
  const a = abr.toLowerCase();
  const url = `${TSE}/${ele}/dados/${a}/${a}-c${String(cargo).padStart(4, "0")}-e${ele.padStart(6, "0")}-u.json`;
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parseTseAgregado(await r.json());
    } catch (e) {
      if (tentativa >= 3) throw new Error(`TSE ${url}: ${String(e)}`);
      await new Promise((ok) => setTimeout(ok, 1000 * tentativa));
    }
  }
}

async function lerTodosEdge(): Promise<Obj> {
  const conn = process.env.EDGE_CONFIG;
  if (!conn) throw new Error("EDGE_CONFIG ausente — passe --env-file <.env.local>");
  const u = new URL(conn);
  const id = u.pathname.replace(/^\//, "");
  const token = u.searchParams.get("token");
  const r = await fetch(`https://edge-config.vercel.com/${id}/items?token=${token}`, {
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`leitura do Global Config: HTTP ${r.status}`);
  return (await r.json()) as Obj;
}

function blobBase(): string {
  const b = process.env.BLOB_PUBLIC_BASE_URL;
  if (!b) throw new Error("BLOB_PUBLIC_BASE_URL ausente");
  return b.replace(/\/+$/, "");
}

async function lerBlob(pathname: string): Promise<Obj | null> {
  try {
    const r = await fetch(`${blobBase()}/${pathname}?nc=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Obj;
  } catch {
    return null;
  }
}

const tsDe = (v: unknown): number => {
  const t = Date.parse(String((v as Obj | null)?.ts ?? ""));
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/** As chaves do 1º turno que o site lê (`lib/edge-config/keys.ts`). */
function chavesDo1t(todas: Obj): string[] {
  return Object.keys(todas)
    .filter(
      (k) =>
        /^projection-current-(pres|gov|sen|dep|est|dis)-t1$/.test(k) ||
        /^projection-uf-[A-Z]{2}-(pres|gov|sen)-t1$/.test(k) ||
        // Aliases legados do Presidente (S04) — só lidos se a chave nova faltar,
        // mas seguem no store; fecham junto para não ficar versão divergente.
        k === "projection-current" ||
        /^projection-uf-[A-Z]{2}$/.test(k),
    )
    .sort();
}

/** Presidente sob o alias legado → chave canônica. */
function canonica(k: string): string {
  if (k === "projection-current") return "projection-current-pres-t1";
  const m = /^projection-uf-([A-Z]{2})$/.exec(k);
  return m ? `projection-uf-${m[1]}-pres-t1` : k;
}

function fmt(n: number): string {
  return n.toLocaleString("pt-BR");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  carregarEnv(argv);
  const escrever = argv.includes("--escrever");
  const agora = new Date().toISOString();
  const carimbo = agora.replace(/[:.]/g, "-");
  const dirLocal = resolve(process.cwd(), "build/fechamento-1t", carimbo);

  console.log(
    `\n== Fechamento do 1º turno — ${escrever ? "ESCRITA" : "ENSAIO (nada é gravado)"} ==\n`,
  );

  // ---- 1. Leitura: Global Config + espelho, fica o `ts` mais novo ----------
  const edge = await lerTodosEdge();
  const chaves = chavesDo1t(edge);
  const atual = new Map<string, Obj>();
  const origem = new Map<string, string>();
  const espelhos = new Map<string, Obj | null>();
  await Promise.all(
    chaves.map(async (k) => {
      const esp = await lerBlob(`edge-espelho/${k}.json`);
      espelhos.set(k, esp);
      const ed = edge[k] as Obj;
      const ganha = esp && tsDe(esp) > tsDe(ed) ? esp : ed;
      atual.set(k, ganha);
      origem.set(k, ganha === ed ? "edge" : "espelho");
    }),
  );
  console.log(`chaves do 1º turno: ${chaves.length}`);
  const doEspelho = chaves.filter((k) => origem.get(k) === "espelho");
  console.log(
    `  versão mais nova veio do espelho do Blob em ${doEspelho.length}: ${doEspelho.join(", ") || "—"}`,
  );

  // ---- 2. Arquivo local (sempre — só lê, não grava fora da máquina) --------
  mkdirSync(`${dirLocal}/edge`, { recursive: true });
  mkdirSync(`${dirLocal}/espelho`, { recursive: true });
  for (const k of chaves) {
    writeFileSync(`${dirLocal}/edge/${k}.json`, JSON.stringify(edge[k]));
    const esp = espelhos.get(k);
    if (esp) writeFileSync(`${dirLocal}/espelho/${k}.json`, JSON.stringify(esp));
  }
  console.log(`arquivo local: ${dirLocal}`);

  // ---- 3. TSE ---------------------------------------------------------------
  const presUf = new Map<string, TseAgregado>();
  const gov = new Map<string, TseAgregado>();
  const sen = new Map<string, TseAgregado>();
  const br = await tse(1, "br");
  await Promise.all([
    ...[...UFS, "ZZ"].map(async (u) => presUf.set(u, await tse(1, u))),
    ...UFS.map(async (u) => gov.set(u, await tse(3, u))),
    ...UFS.map(async (u) => sen.set(u, await tse(5, u))),
  ]);
  const incompletos = [
    ...(tseCompleto(br) ? [] : ["pres:BR"]),
    ...[...presUf].filter(([, t]) => !tseCompleto(t)).map(([u]) => `pres:${u}`),
    ...[...gov].filter(([, t]) => !tseCompleto(t)).map(([u]) => `gov:${u}`),
    ...[...sen].filter(([, t]) => !tseCompleto(t)).map(([u]) => `sen:${u}`),
  ];
  if (incompletos.length > 0) throw new Error(`TSE ainda não totalizou: ${incompletos.join(", ")}`);
  const maxIso = (ts: Iterable<TseAgregado>) =>
    [...ts]
      .map((t) => t.dataHoraIso)
      .sort()
      .at(-1) ?? null;
  const dadoTs: Record<string, string | null> = {
    pres: [br.dataHoraIso, maxIso(presUf.values())].sort().at(-1) ?? null,
    gov: maxIso(gov.values()),
    sen: maxIso(sen.values()),
  };
  console.log(
    `TSE: 100% totalizado em todos os arquivos (pres BR ${br.dataHoraIso}; gov ${dadoTs.gov}; sen ${dadoTs.sen})`,
  );

  // ---- 4. Transformação -----------------------------------------------------
  const novo = new Map<string, Obj>();
  const cache = new Map<string, Obj>(); // por chave canônica
  const transformar = (k: string, v: Obj): Obj => {
    const nacMaj = /^projection-current-(gov|sen)-t1$/.exec(k);
    const ufPres = /^projection-uf-([A-Z]{2})-pres-t1$/.exec(k);
    const ufMaj = /^projection-uf-([A-Z]{2})-(gov|sen)-t1$/.exec(k);
    if (k === "projection-current-pres-t1") {
      const fixo = aplicarTseNacionalPresidente(v, br, presUf);
      const falta = faltaIdentidade(fixo);
      if (falta.length > 0) throw new Error(`por_uf sem identidade: ${falta.join(", ")}`);
      return carimbar(
        igualarNacionalMajoritario(fixo, { candidatosNacionais: true }),
        agora,
        dadoTs.pres ?? null,
      );
    }
    if (nacMaj) {
      return carimbar(
        igualarNacionalMajoritario(v, { candidatosNacionais: false }),
        agora,
        dadoTs[nacMaj[1] as string] ?? null,
      );
    }
    if (/^projection-current-(dep|est|dis)-t1$/.test(k)) {
      return carimbar(igualarDeputado(v), agora, null);
    }
    if (ufPres) {
      const t = presUf.get(ufPres[1] as string);
      if (!t) throw new Error(`sem agregado do TSE para ${k}`);
      return carimbar(igualarUfMajoritario(aplicarTseUfPresidente(v, t)), agora, t.dataHoraIso);
    }
    if (ufMaj) {
      const t = (ufMaj[2] === "gov" ? gov : sen).get(ufMaj[1] as string);
      return carimbar(igualarUfMajoritario(v), agora, t?.dataHoraIso ?? null);
    }
    throw new Error(`chave sem regra: ${k}`);
  };
  for (const k of chaves) {
    const c = canonica(k);
    if (!cache.has(c)) cache.set(c, transformar(c, atual.get(c) ?? atual.get(k) ?? {}));
    novo.set(k, cache.get(c) as Obj);
  }

  // ---- 5. Diff ---------------------------------------------------------------
  console.log("\n-- o que muda, por chave (folhas alteradas, sem ts/dado_ts/encerrado) --");
  let totalFolhas = 0;
  for (const k of chaves) {
    const d = diffFolhas(atual.get(k), novo.get(k)).filter(
      (p) => p !== "dado_ts" && p !== "encerrado",
    );
    totalFolhas += d.length;
    if (k === canonica(k) && d.length > 0) {
      const grupos = new Map<string, number>();
      for (const p of d) {
        const g = p
          .replace(/\.\d+(\.|$)/g, "[]$1")
          .split(".")
          .slice(0, 3)
          .join(".");
        grupos.set(g, (grupos.get(g) ?? 0) + 1);
      }
      console.log(`${k}: ${d.length} — ${[...grupos].map(([g, n]) => `${g}×${n}`).join(", ")}`);
    }
  }
  console.log(`total de folhas alteradas: ${totalFolhas}`);

  // ---- 6. Verificação contra o TSE -------------------------------------------
  console.log("\n-- verificação: nosso voto final × TSE (diferença = nosso − TSE) --");
  const votosDe = (cands: unknown) =>
    new Map(((cands as Obj[]) ?? []).map((c) => [Number(c.id), Number(c.votos_atuais)]));
  const antesNat = votosDe((atual.get("projection-current-pres-t1")?.national as Obj).candidatos);
  const depoisNat = votosDe((novo.get("projection-current-pres-t1")?.national as Obj).candidatos);
  const linhaPres = (
    rot: string,
    antes: Map<number, number>,
    depois: Map<number, number>,
    t: TseAgregado,
  ) => {
    const top = [...t.candidatos].sort((a, b) => b.vap - a.vap).slice(0, 2);
    return `${rot.padEnd(3)} ${top
      .map(
        (c) =>
          `${c.id}: ${fmt(antes.get(c.id) ?? 0)} → ${fmt(depois.get(c.id) ?? 0)} (antes ${fmt((antes.get(c.id) ?? 0) - c.vap)}, depois ${fmt((depois.get(c.id) ?? 0) - c.vap)})`,
      )
      .join(" | ")}`;
  };
  console.log(linhaPres("BR", antesNat, depoisNat, br));
  let maxDifPres = 0;
  for (const [u, t] of presUf) {
    const k = `projection-uf-${u}-pres-t1`;
    const a = votosDe(atual.get(k)?.candidatos);
    const d = votosDe(novo.get(k)?.candidatos);
    for (const c of t.candidatos)
      maxDifPres = Math.max(maxDifPres, Math.abs((d.get(c.id) ?? 0) - c.vap));
    const difAntes = t.candidatos.some((c) => (a.get(c.id) ?? 0) !== c.vap);
    if (difAntes) console.log(linhaPres(u, a, d, t));
  }
  for (const c of br.candidatos)
    maxDifPres = Math.max(maxDifPres, Math.abs((depoisNat.get(c.id) ?? 0) - c.vap));
  console.log(
    `Presidente — maior diferença restante (BR + 28 UFs, todas as candidaturas): ${fmt(maxDifPres)}`,
  );

  for (const [rot, mapa, cargo] of [
    ["Governador", gov, "gov"],
    ["Senador", sen, "sen"],
  ] as const) {
    let maxDif = 0;
    const ruins: string[] = [];
    for (const [u, t] of mapa) {
      const d = votosDe(novo.get(`projection-uf-${u}-${cargo}-t1`)?.candidatos);
      for (const c of [...t.candidatos].sort((a, b) => b.vap - a.vap).slice(0, 4)) {
        const dif = (d.get(c.id) ?? 0) - c.vap;
        maxDif = Math.max(maxDif, Math.abs(dif));
        if (dif !== 0) ruins.push(`${u}:${c.id} ${fmt(dif)}`);
      }
    }
    console.log(
      `${rot} — top 4 de cada UF, maior diferença: ${fmt(maxDif)}${ruins.length ? ` (${ruins.slice(0, 10).join("; ")})` : ""}`,
    );
  }
  console.log(
    "Deputados (6/7/8) — sem agregado leve no TSE para conferir aqui; os votos não são alterados.",
  );

  // ---- 7. Blob lido pelas telas (só relatório) ------------------------------
  console.log("\n-- Blob lido pelas telas (não alterado por este script) --");
  const amostras = [
    "municipios/uf/BA/pres/t1.json",
    "municipios/uf/SP/gov/t1.json",
    "deputado/uf/SP.json",
    "deputado-estadual/uf/SP.json",
  ];
  for (const p of amostras) {
    const b = await lerBlob(p);
    console.log(`${p}: ${b ? `ts ${String(b.ts)}` : "ausente"}`);
  }

  if (maxDifPres !== 0) throw new Error("Presidente ainda difere do TSE — abortando");

  if (!escrever) {
    writeFileSync(`${dirLocal}/novo.json`, JSON.stringify(Object.fromEntries(novo)));
    console.log(`\nENSAIO: nada gravado. Payloads novos em ${dirLocal}/novo.json.`);
    console.log(
      "Para gravar: pnpm fechamento:1t --escrever  (de um checkout com .env.local, ou --env-file)",
    );
    return;
  }

  // ---- 8. Escrita -------------------------------------------------------------
  if (!process.env.EDGE_CONFIG_TOKEN || !process.env.BLOB_READ_WRITE_TOKEN)
    throw new Error("EDGE_CONFIG_TOKEN e BLOB_READ_WRITE_TOKEN são obrigatórios para --escrever");
  const { putJson } = await import("@/lib/blob/write");
  const { espelharNoBlob, writeEdgeItemsBatch } = await import("@/lib/edge-config/writer");

  let arquivadas = 0;
  for (const k of chaves) {
    const ja = await lerBlob(`${ARQUIVO_BLOB}/${k}.json`);
    if (ja) continue; // o original já está lá — não sobrescrever com versão fechada
    await putJson(`${ARQUIVO_BLOB}/${k}.json`, atual.get(k));
    arquivadas++;
  }
  await putJson(`${ARQUIVO_BLOB}/_manifesto-${carimbo}.json`, {
    em: agora,
    chaves: chaves.map((k) => ({ k, origem: origem.get(k), ts: (atual.get(k) as Obj)?.ts })),
  });
  console.log(
    `arquivo no Blob: ${arquivadas} chaves novas em ${ARQUIVO_BLOB}/ (as demais já estavam)`,
  );

  const entries = chaves.map((k) => ({ key: k, value: novo.get(k) }));
  await writeEdgeItemsBatch(entries);
  console.log(`Global Config: ${entries.length} chaves gravadas`);
  await espelharNoBlob(entries);
  console.log("espelho no Blob: gravado");
  console.log(
    "\nFEITO. Confira no site (o espelho tem cache de ~20 s; o Global Config, segundos).",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\nERRO: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
