// data-pipeline/etiquetas-publicar.ts
//
// **O publicador** das etiquetas editoriais (spec 024, RF-230; ADR-0060) — leva
// os gerados versionados de `lib/data/etiquetas/` para o Vercel Blob em
// `etiquetas/v1/…`, onde o leitor os acha em até 60 s, **sem deploy**.
//
// Uso (acionado só pelo dono — nunca por cron, nunca por agente):
//   pnpm etiquetas:publicar              # SÓ CONFERE (padrão): diz o que gravaria, não grava
//   pnpm etiquetas:publicar --confirmar  # publica de verdade
//
// 🔴 O padrão é NÃO gravar (desde 29/09, auditoria constitucional). Antes, o
// padrão gravava e era o `--dry-run` que protegia — um `pnpm etiquetas:publicar`
// digitado para "ver o que acontece" publicava. Agora escrever no Blob exige
// dizer `--confirmar` por extenso; `--dry-run` continua aceito (e é o padrão).
//
// 🔴 NÃO carregue `.env.local` inteiro (`set -a; . ./.env.local`). Este script
// lê do arquivo SÓ `BLOB_READ_WRITE_TOKEN` e `BLOB_PUBLIC_BASE_URL`, por lista
// branca (molde de `scripts/_vigia-env.ts`). Ele não toca banco.
//
// ─── O que ele recusa (e não grava nada) ────────────────────────────────────
//
//   1. árvore do git suja — o que vai ao ar tem de ser um commit, para o sha
//      carimbado apontar para o que foi publicado;
//   2. HEAD atrás de `origin/main` (pela referência local; rode `git fetch`
//      antes) — publicar de um branch velho reverteria correções alheias;
//   3. erro de validação, ou gerado versionado divergente da recompilação —
//      o validador roda de novo aqui, antes de subir qualquer byte;
//   4. `editorial/etiquetas/publicar.json` com chave fora de `VISOES`, ou
//      diferente das chaves que a cópia do build compilou (spec 025) — Blob e
//      build carregam o MESMO `publicar.json`;
//   5. versão do Blob ilegível (rede) — sem ela não há como garantir que a
//      nova `versao` é maior, e uma versão menor seria ignorada pelo leitor.
//
// ─── Lista branca na saída (ADR-0062) ───────────────────────────────────────
//
// Os arquivos públicos são **reconstruídos campo a campo** (`projetar*`), não
// copiados: o que não está no contrato de `lib/etiquetas/formato.ts` fica para
// trás — em especial a coluna `nota` do CSV, que é anotação interna do dono.
//
// ─── Ordem de escrita ───────────────────────────────────────────────────────
//
// 27 UFs → histórico → nacional **por último**: o nacional carrega a `versao`
// que o leitor compara, e escrevê-lo antes publicaria uma versão que promete
// UFs que ainda não subiram (mesma regra do índice de `candidatos-publish`).
//
// ─── Reversão ───────────────────────────────────────────────────────────────
//
// `git revert` do commit que mudou a classificação → `pnpm etiquetas:compilar`
// → commit → `pnpm etiquetas:publicar`. A versão republicada é MAIOR, e o
// conteúdo é o anterior.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { blobUrlFor } from "@/lib/blob/paths";
import { hasBlobWriteCredentials, putJson } from "@/lib/blob/write";
import {
  etiquetasHistoricoBlobPathname,
  etiquetasNacionalBlobPathname,
  etiquetasUfBlobPathname,
} from "@/lib/etiquetas/caminhos";
import { type ChavesPublicacao, todasDesligadas, VISOES } from "@/lib/etiquetas/catalogo";
import {
  type ArquivoHistorico,
  type ArquivoNacional,
  type ArquivoUf,
  CAMPOS_REGISTRO,
  type EntradaHistorico,
  FORMATO_ETIQUETAS,
  type FonteDerivada,
  INSUMOS_DERIVADOS,
  type InsumoDerivado,
  isArquivoNacional,
  lerChavesPublicacao,
  type MedidaAlinhamento,
  type MetaEtiquetas,
  type Registros,
  registroPublico,
  UFS,
  type ValoresDerivados,
} from "@/lib/etiquetas/formato";

import { selecionarEnvDoVigia } from "../scripts/_vigia-env";
import {
  caminhosPadrao,
  compilarDoDisco,
  divergencias,
  formatarErros,
  lerGerados,
} from "./etiquetas-compilar";

// ---------------------------------------------------------------------------
// Projeção por lista branca
// ---------------------------------------------------------------------------

function projetarRegistros(regs: Registros | undefined): Registros | undefined {
  if (!regs) return undefined;
  const out: Registros = {};
  for (const [k, r] of Object.entries(regs)) out[k] = registroPublico(r);
  return out;
}

function projetarDerivados(d: ValoresDerivados | undefined): ValoresDerivados | undefined {
  if (!d) return undefined;
  const out: ValoresDerivados = {};
  if (typeof d.relacao_governo === "string") out.relacao_governo = d.relacao_governo;
  if (typeof d.trajetoria_cargo === "string") out.trajetoria_cargo = d.trajetoria_cargo;
  return Object.keys(out).length > 0 ? out : undefined;
}

function projetarFonte(f: FonteDerivada | null): FonteDerivada | null {
  if (!f) return null;
  return comOpcionais(
    { fonte_url: f.fonte_url, fonte_descricao: f.fonte_descricao, data: f.data },
    { revisado_em: typeof f.revisado_em === "string" ? f.revisado_em : undefined },
  );
}

function projetarMedida(m: MedidaAlinhamento | undefined): MedidaAlinhamento | undefined {
  if (!m || typeof m.votos !== "number" || typeof m.taxa !== "number") return undefined;
  return { votos: m.votos, taxa: m.taxa };
}

function projetarMeta(m: MetaEtiquetas): MetaEtiquetas {
  return {
    versao: m.versao,
    gerado_em: m.gerado_em,
    conteudo_sha256: m.conteudo_sha256,
    git_sha: m.git_sha,
  };
}

function comOpcionais<T extends object>(base: T, opcionais: Record<string, unknown>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(opcionais)) if (v !== undefined) out[k] = v;
  return out as T;
}

export function projetarNacional(
  n: ArquivoNacional,
  meta: MetaEtiquetas,
  publicar: ChavesPublicacao,
): ArquivoNacional {
  const derivados = {} as Record<InsumoDerivado, FonteDerivada | null>;
  for (const k of Object.keys(INSUMOS_DERIVADOS) as InsumoDerivado[]) {
    derivados[k] = projetarFonte(n.derivados[k] ?? null);
  }
  const padroes: Record<string, Registros> = {};
  for (const [k, regs] of Object.entries(n.padroes)) padroes[k] = projetarRegistros(regs) ?? {};
  const candidatos: ArquivoNacional["candidatos"] = {};
  for (const [sq, c] of Object.entries(n.candidatos)) {
    candidatos[sq] = comOpcionais(
      { uf: c.uf, cargo: c.cargo, partido: c.partido },
      { x: projetarRegistros(c.x), d: projetarDerivados(c.d), m: projetarMedida(c.m) },
    );
  }
  const senadores: ArquivoNacional["senado2031"]["senadores"] = {};
  for (const [cod, s] of Object.entries(n.senado2031.senadores)) {
    senadores[cod] = comOpcionais(
      { uf: s.uf, partido: s.partido },
      { x: projetarRegistros(s.x), d: projetarDerivados(s.d), m: projetarMedida(s.m) },
    );
  }
  const partidos: Record<string, string | null> = {};
  for (const [p, f] of Object.entries(n.partidos)) partidos[p] = typeof f === "string" ? f : null;
  return {
    formato: FORMATO_ETIQUETAS,
    meta: projetarMeta(meta),
    publicar: { ...todasDesligadas(), ...publicar },
    derivados,
    partidos,
    padroes,
    candidatos,
    senado2031: {
      disponivel: n.senado2031.disponivel === true,
      foto: typeof n.senado2031.foto === "string" ? n.senado2031.foto : null,
      senadores,
    },
  };
}

export function projetarUf(u: ArquivoUf, meta: MetaEtiquetas): ArquivoUf {
  const lista = (l: unknown) => (Array.isArray(l) ? l.filter((x) => typeof x === "string") : []);
  const grupos = <K extends string>(o: Partial<Record<K, string[]>>) => {
    const out: Partial<Record<K, string[]>> = {};
    for (const [k, l] of Object.entries(o) as [K, string[] | undefined][]) out[k] = lista(l);
    return out;
  };
  const por_partido: Record<string, string[]> = {};
  for (const [p, l] of Object.entries(u.por_partido)) por_partido[p] = lista(l);
  const excecoes: Record<string, Registros> = {};
  for (const [sq, regs] of Object.entries(u.excecoes)) excecoes[sq] = projetarRegistros(regs) ?? {};
  const medidas: Record<string, MedidaAlinhamento> = {};
  for (const [sq, m] of Object.entries(u.medidas ?? {})) {
    const p = projetarMedida(m);
    if (p) medidas[sq] = p;
  }
  return {
    formato: FORMATO_ETIQUETAS,
    meta: projetarMeta(meta),
    uf: u.uf,
    por_partido,
    trajetoria: grupos(u.trajetoria),
    alinhamento: grupos(u.alinhamento),
    medidas,
    excecoes,
  };
}

export function projetarHistorico(h: ArquivoHistorico, meta: MetaEtiquetas): ArquivoHistorico {
  const entradas: EntradaHistorico[] = h.entradas.map((e) =>
    comOpcionais(
      {
        em: e.em,
        versao: e.versao,
        chave: e.chave,
        categoria: e.categoria,
        turno: e.turno,
        de: e.de,
        para: e.para,
        fonte_url: e.fonte_url,
        fonte_descricao: e.fonte_descricao,
        data: e.data,
      },
      { resumo: typeof e.resumo === "string" ? e.resumo : undefined },
    ),
  );
  return { formato: FORMATO_ETIQUETAS, meta: projetarMeta(meta), entradas };
}

/**
 * `publicar.json` → chaves. Mora em `lib/etiquetas/formato.ts` desde
 * 2026-09-29 — o COMPILADOR também o lê (a cópia do build carrega as chaves
 * versionadas; spec 025, emenda ao RF-231). Reexportado aqui para quem já
 * importava deste módulo.
 */
export { lerChavesPublicacao };

/** A nova versão: estritamente maior que a do Blob e a do build, e nunca menor que o relógio. */
export function proximaVersao(agora: Date, versaoBlob: number | null, versaoBuild: number): number {
  return Math.max(Math.floor(agora.getTime() / 1000), (versaoBlob ?? 0) + 1, versaoBuild + 1);
}

// ---------------------------------------------------------------------------
// Orquestração — dependências injetadas para teste
// ---------------------------------------------------------------------------

export interface DependenciasPublicacao {
  /** Saída de `git status --porcelain` (vazia = limpa). */
  statusGit(): Promise<string>;
  shaGit(): Promise<string>;
  /** Quantos commits HEAD está atrás de `origin/main`; `null` = sem a referência. */
  atrasoDeOrigin(): Promise<number | null>;
  /** Roda o validador/compilador e devolve o resultado + o versionado. */
  compilar(): Promise<
    | {
        ok: true;
        divergentes: string[];
        nacional: ArquivoNacional;
        ufs: Record<string, ArquivoUf>;
        historico: ArquivoHistorico;
      }
    | { ok: false; motivo: string }
  >;
  lerPublicarJson(): Promise<unknown>;
  /** `versao` do nacional hoje no Blob; `null` = nunca publicado; lança = não deu para ler. */
  versaoNoBlob(): Promise<number | null>;
  escrever(pathname: string, valor: unknown): Promise<"written" | "skipped">;
  agora(): Date;
  log(msg: string): void;
}

export type ResultadoPublicacao =
  | { ok: true; versao: number; git_sha: string; escritos: string[]; dryRun: boolean }
  | { ok: false; motivo: string };

export async function publicarEtiquetas(
  dep: DependenciasPublicacao,
  opts: { dryRun: boolean },
): Promise<ResultadoPublicacao> {
  const sujo = (await dep.statusGit()).trim();
  if (sujo !== "") {
    return { ok: false, motivo: `árvore do git suja — faça commit antes de publicar:\n${sujo}` };
  }
  const atraso = await dep.atrasoDeOrigin();
  if (atraso === null) {
    dep.log("⚠️  sem referência origin/main — não deu para conferir se o branch está atrasado");
  } else if (atraso > 0) {
    return {
      ok: false,
      motivo: `HEAD está ${atraso} commit(s) atrás de origin/main — atualize (git pull) e recompile antes de publicar`,
    };
  }

  const c = await dep.compilar();
  if (!c.ok) return { ok: false, motivo: c.motivo };
  if (c.divergentes.length > 0) {
    return {
      ok: false,
      motivo:
        `os gerados versionados divergem das fontes (${c.divergentes.join(", ")}) — ` +
        "rode `pnpm etiquetas:compilar`, faça commit e publique de novo",
    };
  }

  const chaves = lerChavesPublicacao(await dep.lerPublicarJson());
  if ("erro" in chaves) return { ok: false, motivo: chaves.erro };
  // Spec 025 (emenda ao RF-231): a cópia do build carrega as chaves do
  // `publicar.json` versionado. Blob e build têm de dizer a MESMA coisa — senão
  // um deploy (build) e uma publicação (Blob) discordariam sobre o que está
  // ligado, e quem vence seria decidido pela versão, não pelo dono.
  const doBuild = { ...todasDesligadas(), ...c.nacional.publicar };
  const diferentes = VISOES.filter((v) => doBuild[v] !== chaves[v]);
  if (diferentes.length > 0) {
    return {
      ok: false,
      motivo:
        `publicar.json diverge da cópia do build nas visões ${diferentes.join(", ")} — ` +
        "rode `pnpm etiquetas:compilar`, faça commit e publique de novo",
    };
  }

  let versaoBlob: number | null;
  try {
    versaoBlob = await dep.versaoNoBlob();
  } catch (err) {
    return {
      ok: false,
      motivo: `não consegui ler a versão publicada no Blob (${String(err)}) — sem ela a nova versão pode sair menor e ser ignorada`,
    };
  }

  const versao = proximaVersao(dep.agora(), versaoBlob, c.nacional.meta.versao);
  const git_sha = await dep.shaGit();
  const meta: MetaEtiquetas = { ...c.nacional.meta, versao, git_sha };

  const arquivos: Array<[string, unknown]> = [];
  for (const uf of UFS) {
    const u = c.ufs[uf];
    if (!u) return { ok: false, motivo: `gerado da UF ${uf} ausente` };
    arquivos.push([etiquetasUfBlobPathname(uf), projetarUf(u, meta)]);
  }
  arquivos.push([etiquetasHistoricoBlobPathname(), projetarHistorico(c.historico, meta)]);
  arquivos.push([etiquetasNacionalBlobPathname(), projetarNacional(c.nacional, meta, chaves)]);

  const ligadas = VISOES.filter((v) => chaves[v]);
  dep.log(
    `  versão     : ${versao} (Blob hoje: ${versaoBlob ?? "nunca publicado"}; build: ${c.nacional.meta.versao})`,
  );
  dep.log(`  commit     : ${git_sha}`);
  dep.log(`  visões     : ${ligadas.length > 0 ? ligadas.join(", ") : "todas desligadas"}`);
  const pendentes = (Object.keys(INSUMOS_DERIVADOS) as InsumoDerivado[]).filter(
    (k) => c.nacional.derivados[k] === null,
  );
  dep.log(
    `  derivados  : ${pendentes.length === 0 ? "os quatro aprovados" : `fora (sem aprovação ou ausentes): ${pendentes.join(", ")}`}`,
  );
  dep.log(`  arquivos   : ${arquivos.length}${opts.dryRun ? " — gravaria, nesta ordem:" : ""}`);
  if (opts.dryRun) {
    for (const [pathname] of arquivos) dep.log(`    ${pathname}`);
    return { ok: true, versao, git_sha, escritos: [], dryRun: true };
  }

  const escritos: string[] = [];
  for (const [pathname, valor] of arquivos) {
    const r = await dep.escrever(pathname, valor);
    if (r !== "written") {
      return {
        ok: false,
        motivo:
          `escrita pulada em ${pathname} (sem BLOB_READ_WRITE_TOKEN?) — ` +
          `${escritos.length} arquivo(s) subiram antes; o nacional NÃO subiu, então a versão nova não está visível`,
      };
    }
    escritos.push(pathname);
  }
  return { ok: true, versao, git_sha, escritos, dryRun: false };
}

// ---------------------------------------------------------------------------
// Dependências reais
// ---------------------------------------------------------------------------

const exec = promisify(execFile);

/** As ÚNICAS variáveis que o publicador lê do `.env.local`. */
export const ENV_DO_PUBLICADOR = ["BLOB_READ_WRITE_TOKEN", "BLOB_PUBLIC_BASE_URL"] as const;

async function carregarEnvDoPublicador(raiz: string): Promise<void> {
  let bruto = "";
  try {
    bruto = await readFile(resolve(raiz, ".env.local"), "utf8");
  } catch {
    return;
  }
  const sel = selecionarEnvDoVigia(bruto, process.env, ENV_DO_PUBLICADOR);
  for (const k of ENV_DO_PUBLICADOR) {
    const v = sel[k];
    if (v && !process.env[k]) process.env[k] = v;
  }
}

function dependenciasReais(raiz: string): DependenciasPublicacao {
  const git = async (...args: string[]) => (await exec("git", args, { cwd: raiz })).stdout;
  const caminhos = caminhosPadrao(raiz);
  return {
    statusGit: () => git("status", "--porcelain"),
    shaGit: async () => (await git("rev-parse", "HEAD")).trim(),
    atrasoDeOrigin: async () => {
      try {
        return Number((await git("rev-list", "--count", "HEAD..origin/main")).trim());
      } catch {
        return null;
      }
    },
    compilar: async () => {
      const { resultado } = await compilarDoDisco(caminhos);
      if (!resultado.ok) {
        return { ok: false, motivo: `validação falhou:\n${formatarErros(resultado.erros)}` };
      }
      const versionado = await lerGerados(caminhos.saida);
      const divergentes = divergencias(resultado, versionado);
      // Publica o VERSIONADO (é o que o sha aponta), não a recompilação — as
      // duas são iguais quando `divergentes` está vazio.
      const ufs: Record<string, ArquivoUf> = {};
      for (const [uf, u] of versionado.ufs) ufs[uf] = u;
      if (!versionado.nacional || !versionado.historico) {
        return {
          ok: false,
          motivo: "gerados versionados ausentes — rode `pnpm etiquetas:compilar`",
        };
      }
      return {
        ok: true,
        divergentes,
        nacional: versionado.nacional,
        ufs,
        historico: versionado.historico,
      };
    },
    lerPublicarJson: async () =>
      JSON.parse(await readFile(resolve(raiz, "editorial/etiquetas/publicar.json"), "utf8")),
    versaoNoBlob: async () => {
      const url = blobUrlFor(etiquetasNacionalBlobPathname());
      if (!url)
        throw new Error("Blob não configurado (BLOB_READ_WRITE_TOKEN ou BLOB_PUBLIC_BASE_URL)");
      const res = await fetch(url, { cache: "no-store" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const corpo: unknown = await res.json();
      if (!isArquivoNacional(corpo)) throw new Error("nacional publicado fora do contrato");
      return corpo.meta.versao;
    },
    escrever: async (pathname, valor) => (await putJson(pathname, valor)).status,
    agora: () => new Date(),
    log: (m) => console.log(m),
  };
}

/**
 * Modo pela linha de comando. **Sem `--confirmar`, não grava** — o padrão é
 * conferir. `--dry-run` junto de `--confirmar` é contradição e é recusado
 * (melhor parar que adivinhar qual das duas o dono quis).
 */
export function modoDaLinhaDeComando(
  argv: readonly string[],
): { dryRun: boolean } | { erro: string } {
  const confirmar = argv.includes("--confirmar");
  const dryRun = argv.includes("--dry-run");
  const desconhecidos = argv.filter((a) => a !== "--confirmar" && a !== "--dry-run");
  if (desconhecidos.length > 0) {
    return {
      erro: `argumento desconhecido: ${desconhecidos.join(" ")} (aceitos: --confirmar, --dry-run)`,
    };
  }
  if (confirmar && dryRun) return { erro: "--confirmar e --dry-run juntos — escolha um" };
  return { dryRun: !confirmar };
}

async function main(): Promise<void> {
  const modo = modoDaLinhaDeComando(process.argv.slice(2));
  if ("erro" in modo) {
    console.error(`✗ ${modo.erro}`);
    process.exit(1);
  }
  const { dryRun } = modo;
  const raiz = caminhosPadrao().raiz;
  await carregarEnvDoPublicador(raiz);
  console.log(
    `[etiquetas-publicar] ${dryRun ? "SÓ CONFERE — nada é gravado (para publicar: --confirmar)" : "PUBLICANDO (--confirmar)"}`,
  );
  if (!dryRun && !hasBlobWriteCredentials()) {
    console.error("✗ BLOB_READ_WRITE_TOKEN ausente (nem no ambiente, nem no .env.local).");
    process.exit(1);
  }
  const r = await publicarEtiquetas(dependenciasReais(raiz), { dryRun });
  if (!r.ok) {
    console.error(`✗ não publiquei: ${r.motivo}`);
    process.exit(1);
  }
  if (r.dryRun) {
    console.log(
      "✓ tudo conferido, NADA foi gravado. Para publicar: pnpm etiquetas:publicar --confirmar",
    );
    return;
  }
  console.log(
    `✓ publicado: versão ${r.versao}, commit ${r.git_sha}, ${r.escritos.length} arquivos.`,
  );
  const url = blobUrlFor(etiquetasNacionalBlobPathname());
  if (url) console.log(`  conferir: curl -s ${url} | head -c 300`);
  console.log("  a tela vê a versão nova em até 60 s.");
}

const invocadoComoScript =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === fileURLToPath(`file://${resolve(process.argv[1])}`);

if (invocadoComoScript) {
  main().catch((err) => {
    console.error("Falha em etiquetas-publicar:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

/** Exportado para o teste de lista branca: os campos que um registro público pode ter. */
export const CAMPOS_PUBLICOS_REGISTRO = CAMPOS_REGISTRO;
