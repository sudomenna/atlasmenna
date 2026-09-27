// data-pipeline/eleitorado-df-import.ts
//
// Popula `eleitorado` para o DF — a UF que `eleitorado-import.ts` NÃO cobre.
//
// ─── O problema ─────────────────────────────────────────────────────────────
//
// `eleitorado-import.ts` deriva `eleitorado` do CSV de eleitorado por local de
// votação da eleição MUNICIPAL de 2024 (`eleitorado_local_votacao_2024`). O DF
// não elege prefeito/vereador, então não tem eleição municipal — e por isso
// não aparece nesse CSV. `zonas-import.ts` já recupera os 19 PARES (município
// × zona) do DF via `historical_results` (fonte='historico' — ver
// PARES_SUPLEMENTARES_SQL), então a tabela `zonas` já tem o DF. Mas
// `eleitorado.eleitores_aptos` — o PESO da zona no modelo — nunca é
// preenchido para o DF, e `_resolve_zone_weight` (api/model/project.py:2510-
// 2528) devolve 0 para toda zona sem linha em `eleitorado`. Efeito medido em
// 2026-09-27: Governador/Senado do DF ficam "aguardando projeção" a noite
// inteira; Presidente-DF fica com `pct_apurado` 0 e os votos reais são
// descartados (api/model/project.py:2699-2716, 2779); o DF sai da projeção
// nacional. Nenhum alarme dispara — silêncio, não erro.
//
// ─── A fonte ─────────────────────────────────────────────────────────────────
//
// O simulado oficial do TSE (2ª janela, 22–24/09) publica o EA20 dos 19 pares
// do DF com `e.te` (eleitorado apto) real do cadastro 2026 — não uma
// estimativa de 2024. Fixtures baixadas em 2026-09-27, guardadas em
// `tests/fixtures/tse/2026-sim/df/` (ver README da pasta). Este script LÊ
// SÓ ESSAS FIXTURES — nenhum fetch em runtime, nenhuma URL do TSE tocada
// aqui (constituição § 1: zero sondagem, e este script não é ingestão).
//
// ─── `ano` ──────────────────────────────────────────────────────────────────
//
// O modelo lê `eleitorado` com `ano=2026` por default
// (`fetch_eleitorado`/`fetch_municipio_eleitorado`, api/model/project.py:518,
// 547 — parâmetro `ano: int = 2026`), e `eleitorado-import.ts` grava as
// demais 26 UFs com `TARGET_YEAR = 2026` (linha 60) mesmo a fonte sendo o CSV
// de 2024 — o `ano` da tabela é o ano em que a linha VALE, não o ano da
// fonte. As linhas do DF seguem a mesma convenção: `ano=2026`.
//
// `comparecimento_pct_historico` fica NULL — é o que TODAS as outras 6.085
// linhas de `eleitorado` têm hoje (`eleitorado-import.ts:101`,
// `rows.map(() => null)`); `pnpm sim:full` já avisa que está NULL em todas.
// Não há dado de comparecimento histórico do DF para preencher diferente.
//
// ─── Modo padrão = SIMULAÇÃO ────────────────────────────────────────────────
//
// Sem `--escrever`, o script só lê as fixtures, valida e IMPRIME as 19 linhas
// — nenhuma conexão é aberta. Escrever exige `--escrever` E `DATABASE_URL`
// (ou `DATABASE_URL_UNPOOLED`) definida. A escrita é restrita a `uf='DF'`:
// nunca insere, atualiza nem lê outra UF. Se já houver linhas do DF em
// `ano=2026` com valores DIFERENTES dos calculados, a escrita ABORTA e lista
// a diferença — nunca sobrescreve silenciosamente.
//
// ─── Uso ────────────────────────────────────────────────────────────────────
//
//   node --experimental-strip-types data-pipeline/eleitorado-df-import.ts
//   # ou: pnpm db:eleitorado:df
//
//   set -a; . ./.env.local; set +a
//   node --experimental-strip-types data-pipeline/eleitorado-df-import.ts --escrever
//   # ou: pnpm db:eleitorado:df -- --escrever

import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { derivarPares, parseCodigoTse, parseEA12 } from "../lib/tse/ea12-schema.ts";
import { EA20Schema, parseEA20Numeric } from "../lib/tse/ea20-schema.ts";
import { getPool } from "./_tse-common.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

export const ANO = 2026;
export const UF = "DF";
export const COD_MUNICIPIO_TSE = 97012;

const FIXTURES_DIR = resolve(ROOT, "tests/fixtures/tse/2026-sim/df");
const EA12_PATH = resolve(ROOT, "tests/fixtures/tse/2026-sim/mun-e021270-cm.json");
const AGREGADO_FILENAME = "df-c0001-e021270-u.json";

// Nome oficial: df97012-z<zona4>-c0001-e021270-u.json
const ZONA_FILENAME_RE = /^df97012-z(\d{4})-c0001-e021270-u\.json$/;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/** Uma zona lida da fixture, já validada quanto a `uf`/município no nome. */
export interface ZonaLida {
  arquivo: string;
  codZona: number;
  te: number;
}

/** Linha pronta para `eleitorado`. */
export interface LinhaEleitoradoDf {
  ano: number;
  uf: string;
  codMunicipioTse: number;
  codZona: number;
  eleitoresAptos: number;
  comparecimentoPctHistorico: null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura e parse das fixtures (puro — sem I/O de rede, sem banco)
// ─────────────────────────────────────────────────────────────────────────────

/** Extrai o número da zona (int, sem zero-padding) do nome oficial do arquivo. */
export function zonaFromFilename(filename: string): number | null {
  const m = ZONA_FILENAME_RE.exec(filename);
  if (!m) return null;
  const n = parseCodigoTse(m[1]!);
  return n;
}

/**
 * Parseia um EA20 de zona já lido do disco (JSON.parse'd) e extrai o par
 * (codZona, te), validando que `uf`/município do NOME batem com o envelope
 * (`tpabr==='zona'` e `cdabr` = zona zero-padded a 4 dígitos).
 */
export function extrairZona(filename: string, raw: unknown): ZonaLida {
  const zonaDoNome = zonaFromFilename(filename);
  if (zonaDoNome == null) {
    throw new Error(`Nome de arquivo fora do padrão oficial df97012-z<zona>-...: ${filename}`);
  }
  const envelope = EA20Schema.parse(raw);
  if (envelope.tpabr !== "zona") {
    throw new Error(`${filename}: tpabr esperado "zona", veio "${envelope.tpabr}"`);
  }
  const cdabrNum = parseCodigoTse(envelope.cdabr);
  if (cdabrNum !== zonaDoNome) {
    throw new Error(
      `${filename}: zona do nome (${zonaDoNome}) não bate com cdabr do envelope ("${envelope.cdabr}")`,
    );
  }
  const te = parseEA20Numeric(envelope.e.te);
  return { arquivo: filename, codZona: zonaDoNome, te };
}

/** Parseia o EA20 agregado de UF (`df-c0001-e021270-u.json`) e devolve `e.te`. */
export function extrairAgregado(raw: unknown): { te: number } {
  const envelope = EA20Schema.parse(raw);
  if (envelope.tpabr !== "uf") {
    throw new Error(`Agregado DF: tpabr esperado "uf", veio "${envelope.tpabr}"`);
  }
  if (envelope.cdabr.trim().toLowerCase() !== "df") {
    throw new Error(`Agregado DF: cdabr esperado "df", veio "${envelope.cdabr}"`);
  }
  return { te: parseEA20Numeric(envelope.e.te) };
}

/** Lista de zonas oficiais do EA12 para o município 97012 (Brasília/DF). */
export function zonasOficiaisDoEa12(ea12: unknown): number[] {
  const parsed = parseEA12(ea12);
  const { pares } = derivarPares(parsed);
  const zonas = pares
    .filter((p) => p.uf === "DF" && p.codMunicipioTse === COD_MUNICIPIO_TSE)
    .map((p) => p.codZona);
  return [...new Set(zonas)].sort((a, b) => a - b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Validações (puras — recebem dados já parseados, nunca tocam disco/rede/banco)
// ─────────────────────────────────────────────────────────────────────────────

export class ValidacaoDfError extends Error {}

/**
 * Valida o conjunto de zonas lidas contra a lista oficial do EA12:
 * mesmo conjunto (sem faltar, sem sobrar, sem duplicata), e toda zona com
 * `te > 0`.
 */
export function validarZonas(zonas: ZonaLida[], zonasOficiais: number[]): void {
  const vistos = new Map<number, string>();
  for (const z of zonas) {
    const anterior = vistos.get(z.codZona);
    if (anterior) {
      throw new ValidacaoDfError(`Zona ${z.codZona} duplicada: ${anterior} e ${z.arquivo}`);
    }
    vistos.set(z.codZona, z.arquivo);
    if (!(z.te > 0)) {
      throw new ValidacaoDfError(`Zona ${z.codZona} (${z.arquivo}): te=${z.te}, esperado > 0`);
    }
  }

  const lidas = [...vistos.keys()].sort((a, b) => a - b);
  const oficiais = [...zonasOficiais].sort((a, b) => a - b);
  const faltando = oficiais.filter((z) => !vistos.has(z));
  const sobrando = lidas.filter((z) => !oficiais.includes(z));
  if (faltando.length > 0 || sobrando.length > 0) {
    throw new ValidacaoDfError(
      `Zonas lidas (${lidas.join(",")}) não batem com o EA12 (${oficiais.join(",")}). ` +
        `Faltando: [${faltando.join(",")}]. Sobrando: [${sobrando.join(",")}].`,
    );
  }
}

/** Valida que a soma dos `te` de zona bate exatamente com o `te` do agregado. */
export function validarAgregado(zonas: ZonaLida[], teAgregado: number): void {
  const soma = zonas.reduce((acc, z) => acc + z.te, 0);
  if (soma !== teAgregado) {
    throw new ValidacaoDfError(
      `Σ te das zonas (${soma}) ≠ te do agregado (${teAgregado}) — diferença de ${soma - teAgregado}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Construção das linhas
// ─────────────────────────────────────────────────────────────────────────────

export function buildRows(zonas: ZonaLida[]): LinhaEleitoradoDf[] {
  return zonas
    .slice()
    .sort((a, b) => a.codZona - b.codZona)
    .map((z) => ({
      ano: ANO,
      uf: UF,
      codMunicipioTse: COD_MUNICIPIO_TSE,
      codZona: z.codZona,
      eleitoresAptos: z.te,
      comparecimentoPctHistorico: null,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura de disco (I/O — não testado por unidade; as funções puras acima são)
// ─────────────────────────────────────────────────────────────────────────────

async function lerFixtures(): Promise<{
  zonas: ZonaLida[];
  teAgregado: number;
  ea12Zonas: number[];
}> {
  const arquivos = (await readdir(FIXTURES_DIR)).filter((f) => ZONA_FILENAME_RE.test(f));
  if (arquivos.length === 0) {
    throw new Error(`Nenhum arquivo de zona do DF encontrado em ${FIXTURES_DIR}`);
  }
  const zonas: ZonaLida[] = [];
  for (const f of arquivos.sort()) {
    const raw = JSON.parse(await readFile(resolve(FIXTURES_DIR, f), "utf8"));
    zonas.push(extrairZona(f, raw));
  }

  const agregadoRaw = JSON.parse(await readFile(resolve(FIXTURES_DIR, AGREGADO_FILENAME), "utf8"));
  const { te: teAgregado } = extrairAgregado(agregadoRaw);

  const ea12Raw = JSON.parse(await readFile(EA12_PATH, "utf8"));
  const ea12Zonas = zonasOficiaisDoEa12(ea12Raw);

  return { zonas, teAgregado, ea12Zonas };
}

// ─────────────────────────────────────────────────────────────────────────────
// Escrita (só com --escrever + DATABASE_URL)
// ─────────────────────────────────────────────────────────────────────────────

const INSERT_SQL = `
INSERT INTO eleitorado
  (ano, uf, cod_municipio_tse, cod_zona, eleitores_aptos, comparecimento_pct_historico)
SELECT * FROM UNNEST(
  $1::int2[],
  $2::char(2)[],
  $3::int4[],
  $4::int4[],
  $5::int4[],
  $6::numeric[]
)
ON CONFLICT (ano, uf, cod_municipio_tse, cod_zona) DO NOTHING;
`;

interface ExistenteDb {
  codZona: number;
  eleitoresAptos: number;
}

/**
 * Compara linhas já existentes no banco (`uf='DF'`) contra as calculadas.
 * Devolve a lista de diferenças (vazia = idêntico). Nunca decide sozinha se
 * deve sobrescrever — quem chama aborta se a lista não for vazia.
 */
export function compararComExistentes(
  existentes: ExistenteDb[],
  calculadas: LinhaEleitoradoDf[],
): string[] {
  const porZonaCalc = new Map(calculadas.map((r) => [r.codZona, r.eleitoresAptos]));
  const diffs: string[] = [];
  for (const e of existentes) {
    const calc = porZonaCalc.get(e.codZona);
    if (calc === undefined) {
      diffs.push(
        `zona ${e.codZona}: existe no banco (${e.eleitoresAptos}) mas não nas fixtures calculadas`,
      );
      continue;
    }
    if (calc !== e.eleitoresAptos) {
      diffs.push(`zona ${e.codZona}: banco=${e.eleitoresAptos}, calculado=${calc}`);
    }
  }
  return diffs;
}

async function escrever(rows: LinhaEleitoradoDf[]): Promise<void> {
  const pool = getPool();
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: existentes } = await client.query<{
        cod_zona: number;
        eleitores_aptos: number;
      }>(`SELECT cod_zona, eleitores_aptos FROM eleitorado WHERE ano = $1 AND uf = $2`, [ANO, UF]);

      if (existentes.length > 0) {
        const diffs = compararComExistentes(
          existentes.map((r) => ({ codZona: r.cod_zona, eleitoresAptos: r.eleitores_aptos })),
          rows,
        );
        if (diffs.length > 0) {
          await client.query("ROLLBACK");
          throw new Error(
            `Já existem ${existentes.length} linhas de DF em eleitorado (ano=${ANO}) com ` +
              `valores DIFERENTES dos calculados — nada foi escrito:\n  ${diffs.join("\n  ")}`,
          );
        }
        console.log(
          `  [escrever] ${existentes.length} linhas de DF já existem com os MESMOS valores — nada a fazer.`,
        );
        await client.query("ROLLBACK");
        return;
      }

      await client.query(INSERT_SQL, [
        rows.map((r) => r.ano),
        rows.map((r) => r.uf),
        rows.map((r) => r.codMunicipioTse),
        rows.map((r) => r.codZona),
        rows.map((r) => r.eleitoresAptos),
        rows.map(() => null),
      ]);
      await client.query("COMMIT");
      console.log(`  [escrever] ${rows.length} linhas de DF inseridas em eleitorado.`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function parseCli(argv: string[]): { escrever: boolean } {
  const escrever = argv.includes("--escrever");
  // `pnpm <script> -- --flag` repassa o `--` separador literalmente (medido em
  // 27/09: a escrita abortava com "Flag desconhecida: --"). Ele não é flag.
  const desconhecida = argv.find((a) => a.startsWith("--") && a !== "--" && a !== "--escrever");
  if (desconhecida) {
    throw new Error(`Flag desconhecida: ${desconhecida}`);
  }
  return { escrever };
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));

  console.log(`[eleitorado-df-import] lendo fixtures de ${FIXTURES_DIR}`);
  const { zonas, teAgregado, ea12Zonas } = await lerFixtures();

  console.log(`  ${zonas.length} zonas lidas, EA12 lista ${ea12Zonas.length} zonas para 97012`);
  validarZonas(zonas, ea12Zonas);
  validarAgregado(zonas, teAgregado);
  console.log("  validação OK: zonas == EA12, Σte == agregado, toda zona te > 0");

  const rows = buildRows(zonas);
  const total = rows.reduce((acc, r) => acc + r.eleitoresAptos, 0);

  console.log("\n=== Linhas calculadas (ano=2026, uf=DF) ===");
  for (const r of rows) {
    console.log(
      `  zona ${String(r.codZona).padStart(4, "0")}: eleitores_aptos=${r.eleitoresAptos}`,
    );
  }
  console.log(`  total (19 zonas): ${total.toLocaleString("pt-BR")}`);

  if (!cli.escrever) {
    console.log(
      "\n[modo simulação — nada foi escrito no banco. Rode com --escrever e DATABASE_URL definida para gravar.]",
    );
  } else {
    if (!process.env.DATABASE_URL_UNPOOLED && !process.env.DATABASE_URL) {
      throw new Error(
        "--escrever exige DATABASE_URL (ou DATABASE_URL_UNPOOLED) definida. " +
          "Rode `set -a; . ./.env.local; set +a` antes.",
      );
    }
    await escrever(rows);
  }

  console.log("\n=== Conferência (rode manualmente após escrever) ===");
  console.log(
    "  SELECT uf, count(*), sum(eleitores_aptos) FROM eleitorado WHERE uf='DF' GROUP BY uf;",
  );
  console.log(`  esperado: DF | 19 | ${total.toLocaleString("pt-BR")}`);
}

main().catch((err) => {
  console.error("Falha em eleitorado-df-import:", err instanceof Error ? err.message : err);
  process.exit(1);
});
