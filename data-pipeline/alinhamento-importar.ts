// data-pipeline/alinhamento-importar.ts
//
// **Importador do alinhamento ao governo na Câmara** (ADR-0062 item 2): lê o
// `alinhamento.csv` do projeto externo `alinhamento-governo-camara` e grava o
// arquivo derivado versionado `editorial/derivados/alinhamento-camara.json`,
// insumo da regra de "Relação com o governo" do deputado com mandato
// (≥ 65% Base · ≤ 35% Oposição · entre → Independente · < 30 votos disputados
// → critério do partido; limiares em `lib/etiquetas/catalogo.ts`, ADR-0059).
//
// ─── Lista branca — é aqui a conformidade de dado pessoal ───────────────────
//
// O CSV de origem tem 25 colunas (nome, partido, UF, presença, …). Este
// importador lê **só três**, por posição resolvida no cabeçalho:
// `deputado_id`, `votos_disputadas`, `taxa_alinhamento_disputadas`. Nenhuma
// outra coluna é lida para estrutura alguma — o `nome` da linha nunca sai do
// array cru do parser. E ele **recusa o arquivo inteiro** (exit ≠ 0) se o
// cabeçalho trouxer qualquer coluna de dado pessoal — `dataNascimento`,
// `data_nascimento`, `cpf`, `nomeCivil` e variações (comparação sem caixa e
// sem separador, por CONTEÚDO: `cpf`, `nascimento`, `nomecivil`). É o caminho
// por onde a `raw/deputados.csv` da Câmara, que tem `dataNascimento`, entraria
// por engano. Pelo mesmo motivo recusa qualquer caminho com um segmento
// `raw/` e o `votos.csv` (354.597 votos individuais) — nunca abre os dois.
//
// ─── Corte e proveniência ───────────────────────────────────────────────────
//
// A data de corte é **informada na chamada** (`--corte AAAA-MM-DD`) e gravada
// no resultado — não é inferida do arquivo (ADR-0062 item 2). O projeto de
// origem vive fora do repositório; o sha256 do CSV de entrada, gravado em
// `fonte.sha256`, é o único elo de proveniência aqui dentro.
//
// ─── Escala ─────────────────────────────────────────────────────────────────
//
// `taxa_alinhamento_disputadas` está em **percentual 0–100** no CSV (medido em
// 29/09: mínimo 0,0, máximo 100,0, uma casa decimal) e é gravada **como está**
// em `taxa_disputadas` — os limiares 65/35 são percentuais. Valor fora de
// 0–100 é recusado; um arquivo inteiro em 0–1 (fração) também, porque passaria
// pela faixa e poria todo deputado em "Oposição".
//
// Uso:
//   pnpm alinhamento:importar [--entrada <alinhamento.csv>] [--saida <json>]
//   (o script do package.json já passa `--corte 2026-09-03`)

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { registrosCsv } from "./trajetoria-camara.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const ENTRADA_PADRAO =
  "/Users/tiagomenna/Projetos/alinhamento-governo-camara/alinhamento.csv";
export const SAIDA_PADRAO = resolve(ROOT, "editorial/derivados/alinhamento-camara.json");

export const FONTE_DESCRICAO =
  "Câmara dos Deputados — Dados Abertos (votações nominais do plenário com orientação do governo)";
export const FONTE_URL = "https://dadosabertos.camara.leg.br";

/** As ÚNICAS colunas lidas do CSV de origem. */
export const COLUNAS_LIDAS = [
  "deputado_id",
  "votos_disputadas",
  "taxa_alinhamento_disputadas",
] as const;

/**
 * Trechos que reprovam o cabeçalho, comparados sobre o nome da coluna em
 * minúsculas e sem separadores: pega `dataNascimento`, `data_nascimento`,
 * `DT_NASCIMENTO`, `ufNascimento`, `cpf`, `nr_cpf`, `nomeCivil`, `nome_civil`.
 */
export const TRECHOS_PROIBIDOS = ["cpf", "nascimento", "nomecivil"] as const;

/** Abaixo disto não se julga a escala pelo máximo (amostra pequena demais). */
export const MIN_LINHAS_CHECAGEM_ESCALA = 20;

export interface AlinhamentoDeputado {
  votos_disputadas: number;
  taxa_disputadas: number;
}

export interface AlinhamentoExportado {
  corte: string;
  fonte: { descricao: string; url: string; sha256: string };
  por_deputado: Record<string, AlinhamentoDeputado>;
}

function normalizarColuna(c: string): string {
  return c.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Confere o cabeçalho e devolve a posição de cada coluna lida. **Lança** se
 * houver coluna de dado pessoal (listando TODAS, não só a primeira), se faltar
 * coluna obrigatória ou se uma delas vier repetida.
 */
export function verificarCabecalho(
  cabecalho: readonly string[],
): Record<(typeof COLUNAS_LIDAS)[number], number> {
  const proibidas = cabecalho.filter((c) => {
    const n = normalizarColuna(c);
    return TRECHOS_PROIBIDOS.some((t) => n.includes(t));
  });
  if (proibidas.length > 0) {
    throw new Error(
      `entrada RECUSADA: o cabeçalho traz coluna de dado pessoal (${proibidas.join(", ")}). ` +
        "O alinhamento entra só por lista branca (ADR-0062) — use o alinhamento.csv, nunca a raw/.",
    );
  }
  const pos = {} as Record<(typeof COLUNAS_LIDAS)[number], number>;
  for (const c of COLUNAS_LIDAS) {
    const i = cabecalho.findIndex((h) => h.trim() === c);
    if (i < 0) throw new Error(`coluna obrigatória ausente: ${c}`);
    if (cabecalho.findIndex((h, j) => j > i && h.trim() === c) >= 0) {
      throw new Error(`coluna repetida no cabeçalho: ${c}`);
    }
    pos[c] = i;
  }
  return pos;
}

/**
 * Recusa caminho que passe por `raw/` ou aponte para `votos.csv` — os dois
 * lugares do projeto de origem que este importador nunca abre.
 */
export function verificarCaminhoEntrada(caminho: string): void {
  const abs = resolve(caminho);
  if (abs.split(sep).includes("raw")) {
    throw new Error(`entrada RECUSADA: ${abs} está sob raw/ — a raw/ nunca é lida (ADR-0062)`);
  }
  if (basename(abs) === "votos.csv") {
    throw new Error(`entrada RECUSADA: votos.csv (votos individuais) nunca é lido (ADR-0062)`);
  }
}

const INTEIRO_POSITIVO = /^[1-9]\d*$/;
const INTEIRO_NAO_NEGATIVO = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Texto do CSV → alinhamento por `deputado_id`. Lê só as três colunas da lista
 * branca. **Lança** em linha malformada, id repetido, taxa fora de 0–100 e
 * arquivo inteiro com cara de fração (0–1).
 */
export function parseAlinhamentoCsv(texto: string): Map<number, AlinhamentoDeputado> {
  const [cab, ...linhas] = registrosCsv(texto, ",");
  if (!cab) throw new Error("alinhamento.csv vazio");
  const pos = verificarCabecalho(cab);

  const out = new Map<number, AlinhamentoDeputado>();
  linhas.forEach((l, i) => {
    const n = i + 2;
    if (l.length !== cab.length) {
      throw new Error(`linha ${n}: ${l.length} campos, cabeçalho tem ${cab.length}`);
    }
    const id = (l[pos.deputado_id] ?? "").trim();
    const votos = (l[pos.votos_disputadas] ?? "").trim();
    const taxa = (l[pos.taxa_alinhamento_disputadas] ?? "").trim();
    if (!INTEIRO_POSITIVO.test(id) || !Number.isSafeInteger(Number(id))) {
      throw new Error(`linha ${n}: deputado_id inválido (${JSON.stringify(id)})`);
    }
    if (!INTEIRO_NAO_NEGATIVO.test(votos)) {
      throw new Error(`linha ${n}: votos_disputadas inválido (${JSON.stringify(votos)})`);
    }
    if (!DECIMAL.test(taxa) || Number(taxa) > 100) {
      throw new Error(
        `linha ${n}: taxa_alinhamento_disputadas fora de 0–100 (${JSON.stringify(taxa)})`,
      );
    }
    const chave = Number(id);
    if (out.has(chave)) throw new Error(`linha ${n}: deputado_id repetido (${id})`);
    out.set(chave, { votos_disputadas: Number(votos), taxa_disputadas: Number(taxa) });
  });

  if (out.size === 0) throw new Error("alinhamento.csv sem nenhum deputado");
  if (out.size >= MIN_LINHAS_CHECAGEM_ESCALA) {
    const max = Math.max(...[...out.values()].map((x) => x.taxa_disputadas));
    if (max <= 1) {
      throw new Error(
        `todas as ${out.size} taxas ≤ 1 — o arquivo parece estar em fração (0–1), não em percentual`,
      );
    }
  }
  return out;
}

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `AAAA-MM-DD` de uma data que existe no calendário. */
export function validarCorte(corte: string): string {
  const m = DATA_ISO.exec(corte);
  const d = m ? new Date(`${corte}T00:00:00Z`) : null;
  if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== corte) {
    throw new Error(`--corte inválido: ${JSON.stringify(corte)} (esperado AAAA-MM-DD)`);
  }
  return corte;
}

export function sha256Hex(conteudo: Buffer | string): string {
  return createHash("sha256").update(conteudo).digest("hex");
}

export function montarAlinhamento(
  porDeputado: ReadonlyMap<number, AlinhamentoDeputado>,
  corte: string,
  sha256: string,
): AlinhamentoExportado {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("sha256 inválido");
  const por_deputado: Record<string, AlinhamentoDeputado> = {};
  for (const id of [...porDeputado.keys()].sort((a, b) => a - b)) {
    const x = porDeputado.get(id) as AlinhamentoDeputado;
    por_deputado[String(id)] = {
      votos_disputadas: x.votos_disputadas,
      taxa_disputadas: x.taxa_disputadas,
    };
  }
  return {
    corte: validarCorte(corte),
    fonte: { descricao: FONTE_DESCRICAO, url: FONTE_URL, sha256 },
    por_deputado,
  };
}

/** Texto do arquivo já no formato do `biome` (um deputado por linha). */
export function serializarAlinhamento(e: AlinhamentoExportado): string {
  const linhas = Object.entries(e.por_deputado).map(
    ([id, x]) =>
      `    ${JSON.stringify(id)}: { "votos_disputadas": ${x.votos_disputadas}, "taxa_disputadas": ${x.taxa_disputadas} }`,
  );
  return [
    "{",
    `  "corte": ${JSON.stringify(e.corte)},`,
    '  "fonte": {',
    `    "descricao": ${JSON.stringify(e.fonte.descricao)},`,
    `    "url": ${JSON.stringify(e.fonte.url)},`,
    `    "sha256": ${JSON.stringify(e.fonte.sha256)}`,
    "  },",
    '  "por_deputado": {',
    linhas.join(",\n"),
    "  }",
    "}",
    "",
  ].join("\n");
}

/** Importação completa a partir do conteúdo já lido — o que o CLI e o teste usam. */
export function importarAlinhamento(conteudo: Buffer, corte: string): AlinhamentoExportado {
  return montarAlinhamento(
    parseAlinhamentoCsv(conteudo.toString("utf8")),
    corte,
    sha256Hex(conteudo),
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Cli {
  entrada: string;
  saida: string;
  corte: string;
}

export function parseCli(argv: readonly string[]): Cli {
  const vistos = new Set<string>();
  const cli: Partial<Cli> = { entrada: ENTRADA_PADRAO, saida: SAIDA_PADRAO };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const v = argv[i + 1];
    if (vistos.has(a)) throw new Error(`argumento repetido: ${a}`);
    vistos.add(a);
    if (v === undefined || v.startsWith("--")) throw new Error(`argumento sem valor: ${a}`);
    if (a === "--entrada") cli.entrada = resolve(v);
    else if (a === "--saida") cli.saida = resolve(v);
    else if (a === "--corte") cli.corte = validarCorte(v);
    else throw new Error(`argumento desconhecido: ${a}`);
    i++;
  }
  if (!cli.corte) {
    throw new Error("--corte AAAA-MM-DD é obrigatório (ADR-0062: informado, nunca inferido)");
  }
  return cli as Cli;
}

function main(): void {
  const cli = parseCli(process.argv.slice(2));
  verificarCaminhoEntrada(cli.entrada);
  const conteudo = readFileSync(cli.entrada);
  const exp = importarAlinhamento(conteudo, cli.corte);
  const texto = serializarAlinhamento(exp);
  mkdirSync(dirname(cli.saida), { recursive: true });
  const tmp = `${cli.saida}.tmp`;
  writeFileSync(tmp, texto, "utf8");
  renameSync(tmp, cli.saida);
  const n = Object.keys(exp.por_deputado).length;
  const ge30 = Object.values(exp.por_deputado).filter((x) => x.votos_disputadas >= 30).length;
  console.log(
    `[alinhamento:importar] ${n} deputados (${ge30} com ≥ 30 votos disputados) · corte ${exp.corte} · ` +
      `sha256 ${exp.fonte.sha256}`,
  );
  console.log(
    `[alinhamento:importar] gravado ${cli.saida} (${Buffer.byteLength(texto, "utf8")} bytes)`,
  );
}

const execucaoDireta =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (execucaoDireta) {
  try {
    main();
  } catch (err) {
    console.error("[alinhamento:importar] falha:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
