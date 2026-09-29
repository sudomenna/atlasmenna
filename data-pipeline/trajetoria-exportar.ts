// data-pipeline/trajetoria-exportar.ts
//
// **Exportação offline da trajetória na Câmara** (spec 018, RF-214, ADR-0058
// item 5): roda o cálculo puro sobre os caches locais — TSE e Câmara — e grava
// o arquivo estático versionado `editorial/derivados/trajetoria-camara.json`,
// insumo da camada de etiquetas editoriais (regra derivada "Trajetória no
// cargo", ADR-0059/ADR-0060) e ponte `camara_ids` → `deputado_id` do
// alinhamento (ADR-0062 item 4).
//
// **Sem banco, sem rede.** Não abre conexão de banco em nenhum caminho; a
// Câmara vem só do cache (`--camara-dir`), salvo `--camara-refresh` explícito.
// Existe justamente para entregar a trajetória SEM a perna estacionada
// (migration 0011 + import + backfill), que só volta depois de 25/10.
//
// ─── Formato (contrato — outra frente consome) ──────────────────────────────
//
//   {
//     "gerado_em": "<ISO>",
//     "fonte": { "tse_dt_geracao": "<DT_GERACAO HH_GERACAO>", "camara": "<…>" },
//     "universo": <nº de candidaturas de cargo 6>,
//     "por_sqcand": {
//       "<sqcand>": { "t": "em_exercicio"|"legislatura_atual"|"mandato_anterior"|"estreante",
//                     "camara_ids": [<id>, …] }
//     }
//   }
//
// - **Toda** candidatura de cargo 6 do universo está em `por_sqcand` —
//   estreante inclusive, com `camara_ids: []`. `universo` é a contagem, para
//   que o consumidor distinga "fora do arquivo" (não calculado) de "estreante".
//   Nunca se infere estreia por ausência (ADR-0058 item 4).
// - Chave `sqcand` sempre texto; ordem numérica crescente; campos em ordem fixa.
//   Mesmo cache → mesmo arquivo, a menos do `gerado_em`.
// - **Nenhum nome, nenhuma data de nascimento, nenhum dado pessoal.** O único
//   texto por candidatura é a categoria. Teste de asserção negativa sobre a
//   saída em `tests/unit/data-pipeline/trajetoria-exportar.test.ts`.
//
// Uso:
//   pnpm trajetoria:exportar [--tse-dir build/tse-archives] [--camara-dir build/camara]
//                            [--saida editorial/derivados/trajetoria-camara.json]
//                            [--camara-refresh]

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TRAJETORIAS, type Trajetoria, type TrajetoriaCamara } from "./trajetoria-camara.ts";
import { calcularTrajetoriasDoCache } from "./trajetoria-camara-calculo.ts";
import type { FonteCamara } from "./trajetoria-camara-fonte.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SAIDA_PADRAO = resolve(ROOT, "editorial/derivados/trajetoria-camara.json");
/** Relativos ao diretório de trabalho — num worktree os caches não existem. */
export const TSE_DIR_PADRAO = "./build/tse-archives";
export const CAMARA_DIR_PADRAO = "./build/camara";

export interface EntradaTrajetoria {
  t: TrajetoriaCamara;
  camara_ids: number[];
}

export interface ExportacaoTrajetoria {
  gerado_em: string;
  fonte: { tse_dt_geracao: string; camara: string };
  universo: number;
  por_sqcand: Record<string, EntradaTrajetoria>;
}

export interface ParametrosExportacao {
  /** SQs de cargo 6, sem repetição — o universo do cálculo. */
  universo: readonly string[];
  porSq: ReadonlyMap<string, Trajetoria>;
  geracaoDeclarada: string | null;
  /** Descrição textual do cache da Câmara usado (ver `descreverFonteCamara`). */
  camara: string;
  geradoEm: Date;
}

const SQ_VALIDO = /^[1-9]\d*$/;

/** Ordem numérica de strings de dígitos sem zero à esquerda. */
export function compararSq(a: string, b: string): number {
  return a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Monta o objeto exportado. **Lança** em vez de exportar um arquivo que
 * mentiria: SQ fora do universo ou sem trajetória, categoria desconhecida,
 * estreante com id ou não-estreante sem id, id não inteiro.
 */
export function montarExportacao(p: ParametrosExportacao): ExportacaoTrajetoria {
  if (!p.geracaoDeclarada) throw new Error("DT_GERACAO do TSE ausente — proveniência obrigatória");
  if (p.universo.length === 0) throw new Error("universo vazio — nada a exportar");
  const vistos = new Set<string>();
  for (const sq of p.universo) {
    if (!SQ_VALIDO.test(sq)) throw new Error(`SQ_CANDIDATO inválido no universo: ${sq}`);
    if (vistos.has(sq)) throw new Error(`SQ_CANDIDATO repetido no universo: ${sq}`);
    vistos.add(sq);
  }
  for (const sq of p.porSq.keys()) {
    if (!vistos.has(sq)) throw new Error(`trajetória para SQ fora do universo: ${sq}`);
  }

  const categorias = new Set<string>(TRAJETORIAS);
  const por_sqcand: Record<string, EntradaTrajetoria> = {};
  for (const sq of [...p.universo].sort(compararSq)) {
    const traj = p.porSq.get(sq);
    if (!traj) throw new Error(`SQ ${sq} do universo sem trajetória — "ausente" não é "estreante"`);
    if (!categorias.has(traj.trajetoria)) {
      throw new Error(`categoria desconhecida para SQ ${sq}: ${traj.trajetoria}`);
    }
    const ids = [...(traj.camaraIds ?? [])];
    for (const id of ids) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`id da Câmara inválido: ${id}`);
    }
    if ((traj.trajetoria === "estreante") !== (ids.length === 0)) {
      throw new Error(`SQ ${sq}: ${traj.trajetoria} com ${ids.length} id(s) da Câmara`);
    }
    por_sqcand[sq] = { t: traj.trajetoria, camara_ids: ids };
  }

  return {
    gerado_em: p.geradoEm.toISOString(),
    fonte: { tse_dt_geracao: p.geracaoDeclarada, camara: p.camara },
    universo: p.universo.length,
    por_sqcand,
  };
}

/** Linha de uma candidatura, inline — é como o `biome` mantém objeto curto. */
function entradaInline(sq: string, e: EntradaTrajetoria): string {
  return `    ${JSON.stringify(sq)}: { "t": ${JSON.stringify(e.t)}, "camara_ids": [${e.camara_ids.join(", ")}] }`;
}

/** Largura de linha do `biome.json` — acima dela o formatador quebraria a linha. */
const LARGURA = 100;

/**
 * Texto do arquivo, **já no formato do `biome`** (o pre-commit roda `biome
 * check` na árvore inteira): cabeçalho expandido, uma candidatura por linha.
 * Uma linha que estourasse a largura sai expandida, como o formatador faria.
 */
export function serializarExportacao(e: ExportacaoTrajetoria): string {
  const linhas = Object.entries(e.por_sqcand).map(([sq, x]) => {
    const inline = entradaInline(sq, x);
    if (inline.length <= LARGURA) return inline;
    return [
      `    ${JSON.stringify(sq)}: {`,
      `      "t": ${JSON.stringify(x.t)},`,
      `      "camara_ids": [${x.camara_ids.join(", ")}]`,
      "    }",
    ].join("\n");
  });
  return [
    "{",
    `  "gerado_em": ${JSON.stringify(e.gerado_em)},`,
    '  "fonte": {',
    `    "tse_dt_geracao": ${JSON.stringify(e.fonte.tse_dt_geracao)},`,
    `    "camara": ${JSON.stringify(e.fonte.camara)}`,
    "  },",
    `  "universo": ${e.universo},`,
    '  "por_sqcand": {',
    linhas.join(",\n"),
    "  }",
    "}",
    "",
  ].join("\n");
}

/** A proveniência da Câmara em texto: o portal e a idade de cada arquivo do cache. */
export function descreverFonteCamara(f: FonteCamara): string {
  return (
    "Câmara dos Deputados — Dados Abertos (dadosabertos.camara.leg.br): " +
    `deputados.csv de ${f.deputadosTs.toISOString()}, ` +
    `deputados em exercício de ${f.emExercicioTs.toISOString()}`
  );
}

export function contarPorCategoria(e: ExportacaoTrajetoria): Record<TrajetoriaCamara, number> {
  const c = Object.fromEntries(TRAJETORIAS.map((t) => [t, 0])) as Record<TrajetoriaCamara, number>;
  for (const x of Object.values(e.por_sqcand)) c[x.t]++;
  return c;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Cli {
  tseDir: string;
  camaraDir: string;
  saida: string;
  camaraRefresh: boolean;
}

export function parseCli(argv: readonly string[]): Cli {
  const cli: Cli = {
    tseDir: resolve(TSE_DIR_PADRAO),
    camaraDir: resolve(CAMARA_DIR_PADRAO),
    saida: SAIDA_PADRAO,
    camaraRefresh: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--camara-refresh") {
      cli.camaraRefresh = true;
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`argumento sem valor: ${a}`);
    if (a === "--tse-dir") cli.tseDir = resolve(v);
    else if (a === "--camara-dir") cli.camaraDir = resolve(v);
    else if (a === "--saida") cli.saida = resolve(v);
    else throw new Error(`argumento desconhecido: ${a}`);
    i++;
  }
  return cli;
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  console.log(`[trajetoria:exportar] TSE ${cli.tseDir} · Câmara ${cli.camaraDir}`);
  const calc = await calcularTrajetoriasDoCache({
    tseDir: cli.tseDir,
    camaraDir: cli.camaraDir,
    camaraRefresh: cli.camaraRefresh,
  });
  const exp = montarExportacao({
    universo: calc.universo,
    porSq: calc.porSq,
    geracaoDeclarada: calc.geracaoDeclarada,
    camara: descreverFonteCamara(calc.camara),
    geradoEm: new Date(),
  });
  const texto = serializarExportacao(exp);
  mkdirSync(dirname(cli.saida), { recursive: true });
  const tmp = `${cli.saida}.tmp`;
  writeFileSync(tmp, texto, "utf8");
  renameSync(tmp, cli.saida);

  const c = contarPorCategoria(exp);
  console.log(
    `[trajetoria:exportar] universo ${exp.universo} · ` +
      TRAJETORIAS.map((t) => `${t} ${c[t]}`).join(" · ") +
      ` · duplicadas no CSV ${calc.duplicadas}`,
  );
  console.log(
    `[trajetoria:exportar] gravado ${cli.saida} (${Buffer.byteLength(texto, "utf8")} bytes)`,
  );
}

const execucaoDireta =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (execucaoDireta) {
  main().catch((err) => {
    console.error("[trajetoria:exportar] falha:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
