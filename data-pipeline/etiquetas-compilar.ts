// data-pipeline/etiquetas-compilar.ts
//
// **Casca de I/O** do compilador de etiquetas editoriais (spec 024, RF-222..229,
// RF-239). A lógica mora em `etiquetas-nucleo.ts`, que é pura.
//
// Uso:
//   pnpm etiquetas:compilar              # valida, compila e grava lib/data/etiquetas/
//   pnpm etiquetas:compilar --conferir   # só confere: exit 1 se o gerado divergir
//   ... --tse-cache <dir>                # outro diretório do cadastro do TSE
//
// Lê:
//   editorial/etiquetas/*.csv                    (obrigatórios — nascem só com cabeçalho)
//   editorial/etiquetas/publicar.json            (obrigatório — chaves por visão; vão para a
//                                                 cópia do build desde 29/09, spec 025)
//   editorial/senado/mandato-2031.json           (opcional — frente 023)
//   editorial/derivados/trajetoria-camara.json   (opcional — frente 3B)
//   editorial/derivados/alinhamento-camara.json  (opcional — frente 3B)
//   build/tse-archives/consulta_cand_2026/       (obrigatório — `pnpm candidatos:import` baixa)
//   lib/data/etiquetas/*                          (o gerado anterior: meta e histórico)
//
// Grava (só com zero erro):
//   lib/data/etiquetas/nacional.generated.json
//   lib/data/etiquetas/uf/<UF>.generated.json   (27)
//   lib/data/etiquetas/historico.json
//
// 🔴 Não toca banco, não faz rede, não lê `.env.local`. Nenhuma credencial.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { ARQUIVOS_FONTE, type ArquivoFonte } from "@/lib/etiquetas/catalogo";
import {
  type ArquivoHistorico,
  type ArquivoNacional,
  type ArquivoUf,
  isArquivoHistorico,
  isArquivoNacional,
  isArquivoUf,
  lerChavesPublicacao,
  UFS,
} from "@/lib/etiquetas/formato";

import {
  type AlinhamentoInsumo,
  lerAlinhamento,
  lerSenado2031,
  lerTrajetoria,
  type Senado2031Insumo,
  type TrajetoriaInsumo,
} from "./etiquetas-insumos";
import {
  type AnteriorCompilado,
  compilarEtiquetas,
  type EntradaCompilacao,
  type ErroCompilacao,
  type ResultadoCompilacao,
  semDerivados,
} from "./etiquetas-nucleo";
import { lerUniversoTse } from "./etiquetas-universo";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface Caminhos {
  raiz: string;
  editorial: string;
  saida: string;
  tseCache: string;
}

export function caminhosPadrao(raiz: string = RAIZ, tseCache?: string): Caminhos {
  return {
    raiz,
    editorial: resolve(raiz, "editorial"),
    saida: resolve(raiz, "lib/data/etiquetas"),
    tseCache:
      tseCache ??
      process.env.ETIQUETAS_TSE_CACHE ??
      resolve(raiz, "build/tse-archives/consulta_cand_2026"),
  };
}

export function caminhoNacional(saida: string): string {
  return resolve(saida, "nacional.generated.json");
}
export function caminhoUf(saida: string, uf: string): string {
  return resolve(saida, "uf", `${uf}.generated.json`);
}
export function caminhoHistorico(saida: string): string {
  return resolve(saida, "historico.json");
}

/** Serialização estável dos gerados (o `biome format` roda por cima no script). */
export function serializar(v: unknown): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}

async function lerJsonOpcional(caminho: string): Promise<unknown | undefined> {
  if (!existsSync(caminho)) return undefined;
  return JSON.parse(await readFile(caminho, "utf8"));
}

/** Os gerados versionados — o "anterior" da próxima compilação. */
export async function lerGerados(saida: string): Promise<AnteriorCompilado> {
  const n = await lerJsonOpcional(caminhoNacional(saida));
  const h = await lerJsonOpcional(caminhoHistorico(saida));
  const ufs = new Map<string, ArquivoUf>();
  for (const uf of UFS) {
    const u = await lerJsonOpcional(caminhoUf(saida, uf));
    if (u !== undefined && isArquivoUf(u, uf)) ufs.set(uf, u);
  }
  return {
    nacional: n !== undefined && isArquivoNacional(n) ? n : null,
    ufs,
    historico: h !== undefined && isArquivoHistorico(h) ? h : null,
  };
}

type Insumo<T> = { ok: true; valor: T | null; avisos: string[] } | { ok: false; erros: string[] };

async function insumo<T>(
  caminho: string,
  ler: (json: unknown) => { ok: true; valor: T; avisos: string[] } | { ok: false; erros: string[] },
): Promise<Insumo<T>> {
  const json = await lerJsonOpcional(caminho);
  if (json === undefined) return { ok: true, valor: null, avisos: [] };
  return ler(json);
}

/**
 * Monta a entrada do núcleo a partir do disco. Lança só quando o cadastro do
 * TSE não existe — o chamador decide se isso é erro ou "pular".
 */
export async function entradaDoDisco(
  c: Caminhos,
  agora: Date,
): Promise<{ entrada: EntradaCompilacao; erros: ErroCompilacao[]; avisos: string[] }> {
  const erros: ErroCompilacao[] = [];
  const avisos: string[] = [];

  const fontes = {} as Record<ArquivoFonte, string | null>;
  for (const arq of Object.keys(ARQUIVOS_FONTE) as ArquivoFonte[]) {
    const p = resolve(c.editorial, "etiquetas", arq);
    fontes[arq] = existsSync(p) ? await readFile(p, "utf8") : null;
  }

  const { universo } = await lerUniversoTse(c.tseCache);

  // Chaves por visão (spec 025, emenda ao RF-228/231): o arquivo versionado
  // vai para a cópia do build. Ausente ou inválido ⇒ erro — sem ele a cópia do
  // build não sabe o que o dono ligou, e "tudo desligado por omissão" é
  // exatamente a armadilha que a emenda fechou.
  const caminhoPublicar = resolve(c.editorial, "etiquetas", "publicar.json");
  let publicar: ReturnType<typeof lerChavesPublicacao> | null = null;
  if (!existsSync(caminhoPublicar)) {
    erros.push({
      arquivo: "editorial/etiquetas/publicar.json",
      linha: null,
      mensagem: "arquivo ausente — ele diz quais visões estão ligadas",
    });
  } else {
    try {
      publicar = lerChavesPublicacao(JSON.parse(await readFile(caminhoPublicar, "utf8")));
    } catch (err) {
      publicar = { erro: `JSON inválido (${err instanceof Error ? err.message : String(err)})` };
    }
    if ("erro" in publicar) {
      erros.push({
        arquivo: "editorial/etiquetas/publicar.json",
        linha: null,
        mensagem: publicar.erro,
      });
      publicar = null;
    }
  }

  const coletar = <T>(nome: string, r: Insumo<T>): T | null => {
    if (!r.ok) {
      for (const m of r.erros) erros.push({ arquivo: nome, linha: null, mensagem: m });
      return null;
    }
    avisos.push(...r.avisos);
    return r.valor;
  };
  const senado2031 = coletar<Senado2031Insumo>(
    "editorial/senado/mandato-2031.json",
    await insumo(resolve(c.editorial, "senado", "mandato-2031.json"), lerSenado2031),
  );
  const derivados = semDerivados();
  for (const [chave, casa, tipo] of [
    ["trajetoria_camara", "camara", "trajetoria"],
    ["alinhamento_camara", "camara", "alinhamento"],
    ["trajetoria_senado", "senado", "trajetoria"],
    ["alinhamento_senado", "senado", "alinhamento"],
  ] as const) {
    const nome = `${chave.replace("_", "-")}.json`;
    const caminho = resolve(c.editorial, "derivados", nome);
    if (tipo === "trajetoria") {
      derivados[chave as "trajetoria_camara" | "trajetoria_senado"] = coletar<TrajetoriaInsumo>(
        `editorial/derivados/${nome}`,
        await insumo(caminho, (j) => lerTrajetoria(j, casa)),
      );
    } else {
      derivados[chave as "alinhamento_camara" | "alinhamento_senado"] = coletar<AlinhamentoInsumo>(
        `editorial/derivados/${nome}`,
        await insumo(caminho, (j) => lerAlinhamento(j, casa)),
      );
    }
  }

  return {
    entrada: {
      fontes,
      universo,
      senado2031,
      derivados,
      anterior: await lerGerados(c.saida),
      agora,
      ...(publicar && !("erro" in publicar) ? { publicar } : {}),
    },
    erros,
    avisos,
  };
}

export async function compilarDoDisco(
  c: Caminhos,
  agora: Date = new Date(),
): Promise<{ resultado: ResultadoCompilacao; avisos: string[] }> {
  const { entrada, erros, avisos } = await entradaDoDisco(c, agora);
  if (erros.length > 0) return { resultado: { ok: false, erros }, avisos };
  const resultado = compilarEtiquetas(entrada);
  if (resultado.ok) avisos.push(...resultado.relatorio.avisos);
  return { resultado, avisos };
}

/**
 * Diferenças entre o que o compilador produz e o que está versionado.
 * Comparação **semântica** (JSON parseado), não de bytes: o `biome format`
 * reformata os gerados depois da gravação.
 */
export function divergencias(
  r: Extract<ResultadoCompilacao, { ok: true }>,
  versionado: AnteriorCompilado,
): string[] {
  const out: string[] = [];
  const norm = (v: unknown) => JSON.parse(JSON.stringify(v));
  if (!isDeepStrictEqual(norm(r.nacional), norm(versionado.nacional)))
    out.push("nacional.generated.json");
  for (const uf of UFS) {
    if (!isDeepStrictEqual(norm(r.ufs[uf]), norm(versionado.ufs.get(uf) ?? null))) {
      out.push(`uf/${uf}.generated.json`);
    }
  }
  if (!isDeepStrictEqual(norm(r.historico), norm(versionado.historico))) out.push("historico.json");
  return out;
}

export async function gravarGerados(
  saida: string,
  r: { nacional: ArquivoNacional; ufs: Record<string, ArquivoUf>; historico: ArquivoHistorico },
): Promise<void> {
  await mkdir(resolve(saida, "uf"), { recursive: true });
  for (const uf of UFS) await writeFile(caminhoUf(saida, uf), serializar(r.ufs[uf]));
  await writeFile(caminhoHistorico(saida), serializar(r.historico));
  // Nacional por último, como no Blob: ele carrega a `meta` que dá nome à versão.
  await writeFile(caminhoNacional(saida), serializar(r.nacional));
}

export function formatarErros(erros: readonly ErroCompilacao[]): string {
  return erros
    .map((e) => `  ✗ ${e.arquivo}${e.linha !== null ? `:${e.linha}` : ""} — ${e.mensagem}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const conferir = args.includes("--conferir");
  const i = args.indexOf("--tse-cache");
  const tseCache = i >= 0 ? args[i + 1] : undefined;
  const c = caminhosPadrao(RAIZ, tseCache ? resolve(tseCache) : undefined);

  if (!existsSync(c.tseCache)) {
    console.error(
      `✗ cadastro do TSE não encontrado em ${c.tseCache}.\n` +
        "  Rode `pnpm candidatos:import` (baixa o ZIP para build/tse-archives/) ou passe --tse-cache <dir>.",
    );
    process.exit(1);
  }

  const { resultado, avisos } = await compilarDoDisco(c);
  for (const a of avisos) console.warn(`  ⚠️  ${a}`);
  if (!resultado.ok) {
    console.error(
      `✗ ${resultado.erros.length} erro(s) — nada foi gravado:\n${formatarErros(resultado.erros)}`,
    );
    process.exit(1);
  }

  const rel = resultado.relatorio;
  if (conferir) {
    const d = divergencias(resultado, await lerGerados(c.saida));
    if (d.length > 0) {
      console.error(
        `✗ os gerados versionados divergem da recompilação: ${d.join(", ")}\n` +
          "  Rode `pnpm etiquetas:compilar` e versione o resultado.",
      );
      process.exit(1);
    }
    console.log("✓ gerados em dia com as fontes.");
    return;
  }

  await gravarGerados(c.saida, resultado);
  console.log(`✓ etiquetas compiladas — versão ${resultado.nacional.meta.versao}`);
  console.log(
    `  linhas: ${rel.linhas} · revisadas: ${rel.efetivas} · não revisadas (ficam fora): ${rel.naoRevisadas}`,
  );
  console.log(
    `  mudanças no histórico: ${rel.mudancas}${rel.conteudoMudou ? "" : " (conteúdo idêntico — versão mantida)"}`,
  );
  console.log("  cobertura (turno 1):");
  for (const x of rel.cobertura) {
    console.log(`    ${x.alvo.padEnd(10)} ${x.categoria.padEnd(22)} ${x.classificados}/${x.total}`);
  }
}

const invocadoComoScript =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === fileURLToPath(`file://${resolve(process.argv[1])}`);

if (invocadoComoScript) {
  main().catch((err) => {
    console.error("Falha em etiquetas-compilar:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
