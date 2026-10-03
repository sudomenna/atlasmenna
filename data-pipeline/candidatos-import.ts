// data-pipeline/candidatos-import.ts
//
// Popula `candidatos` e `partidos` (migration 0008) a partir do **Portal de
// Dados Abertos do TSE** — a fonte de identidade de candidatura 2026, licença
// cc-by (ADR-0039, spec 018 RF-140/141/143/152).
//
// Fontes, medidas em 2026-09-13 contra o arquivo gerado pelo TSE em 12/09:
//   consulta_cand/consulta_cand_2026.zip                        3,0 MB
//     → consulta_cand_2026_BRASIL.csv — 11,4 MB, 20.939 linhas, 50 colunas,
//       ISO-8859-1, separador `;`. É a união exata dos 28 arquivos por UF;
//       usamos só o BRASIL.
//   consulta_cand_complementar/consulta_cand_complementar_2026.zip  1,2 MB
//     → mesmas 20.939 linhas, join 1:1 por SQ_CANDIDATO, ZERO linha faltando.
//
// ─── Roda FORA do request path ──────────────────────────────────────────────
//
// Como `eleitorado-import` e `zonas-import`, e não como rota de cron: o
// download combinado é de 4,2 MB, a cadência é humana (diária → 2–3 dias →
// obrigatória em 02–03/10, ADR-0040) e a guarda de encolhimento precisa de uma
// decisão de operador para o `--allow-shrink`.
//
// ─── Três armadilhas da fonte, todas medidas ────────────────────────────────
//
//  1. **`HEAD` devolve 403.** Para saber o frescor sem baixar os 4,2 MB, o
//     caminho que funciona é `GET` com `Range: bytes=0-1023`, que devolve 206
//     com o `Last-Modified` correto.
//  2. **O `last_modified` do catálogo CKAN é metadado morto** — registra 22/07
//     para arquivo regerado em 12/09, data anterior ao próprio prazo de
//     registro de candidatura. `fonte_ts` vem do header HTTP do ARQUIVO, nunca
//     do catálogo. `DT_GERACAO`/`HH_GERACAO` dentro do CSV servem de
//     conferência cruzada (12/09 19:31:30 BRT ↔ Last-Modified 22:35 GMT).
//  3. **O WAF da Akamai bloqueia User-Agent com e-mail ou URL.** Usamos
//     `TSE_ETL_USER_AGENT` de `_tse-common.ts` — hoje `"AtlasMenna-ETL/0.1"`.
//     Não "melhorar" acrescentando contato: volta a dar 403, e o módulo é
//     compartilhado com três outros importadores.
//
// ─── Uso ────────────────────────────────────────────────────────────────────
//
//   set -a; . ./.env.local; set +a
//   node --experimental-strip-types data-pipeline/candidatos-import.ts
//   node --experimental-strip-types data-pipeline/candidatos-import.ts --cargo 1
//   node --experimental-strip-types data-pipeline/candidatos-import.ts --uf BA --dry-run
//   node --experimental-strip-types data-pipeline/candidatos-import.ts --allow-shrink
//
// Pré-requisito: migration 0008 aplicada.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  downloadCached,
  FIXTURES_DIR,
  getPool,
  iterCsv,
  readCsvHeader,
  TSE_ETL_USER_AGENT,
  unzipTo,
} from "./_tse-common.ts";
import {
  ANO_PLEITO,
  type AvaliacaoEncolhimento,
  avaliarEncolhimento,
  CARGOS_PRODUTO,
  type CandidatoRow,
  type ContagemCargoUf,
  contarPublicaveis,
  unirCandidaturas,
} from "./candidatos-parse.ts";
import { colisoes } from "./candidatos-resolve.ts";

const BASE = "https://cdn.tse.jus.br/estatistica/sead/odsele";
const URL_PRINCIPAL = `${BASE}/consulta_cand/consulta_cand_2026.zip`;
const URL_COMPLEMENTAR = `${BASE}/consulta_cand_complementar/consulta_cand_complementar_2026.zip`;
const BATCH_SIZE = 2000;

type Client = import("@neondatabase/serverless").PoolClient;

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

interface Cli {
  uf: string | null;
  cargo: number | null;
  dryRun: boolean;
  /** Pula o download e usa a fixture — útil offline e quando o CDN cai. */
  fixture: boolean;
  /** Publica mesmo com queda além do limiar (RF-152). Fica registrado no log. */
  allowShrink: boolean;
  /** Ignora o cache local (re-baixa) **e** implica `--allow-shrink`. */
  force: boolean;
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    uf: null,
    cargo: null,
    dryRun: false,
    fixture: false,
    allowShrink: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--uf") {
      const v = argv[i + 1];
      if (!v || v.length !== 2) throw new Error("--uf exige uma sigla de 2 letras (ex.: BA, BR)");
      cli.uf = v.toUpperCase();
      i++;
    } else if (a === "--cargo") {
      const v = Number(argv[i + 1]);
      if (!CARGOS_PRODUTO.includes(v as (typeof CARGOS_PRODUTO)[number])) {
        throw new Error(`--cargo exige um dos cargos do produto: ${CARGOS_PRODUTO.join(", ")}`);
      }
      cli.cargo = v;
      i++;
    } else if (a === "--dry-run") {
      cli.dryRun = true;
    } else if (a === "--fixture") {
      cli.fixture = true;
    } else if (a === "--allow-shrink") {
      cli.allowShrink = true;
    } else if (a === "--force") {
      cli.force = true;
      cli.allowShrink = true;
    } else if (a?.startsWith("--")) {
      throw new Error(`Flag desconhecida: ${a}`);
    }
  }
  return cli;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frescor da fonte — RF-140 / ADR-0039
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lê o `Last-Modified` do arquivo no CDN **sem baixá-lo**: `GET` com
 * `Range: bytes=0-1023` (`HEAD` devolve 403). Devolve `null` se o CDN não
 * responder — o ciclo então cai no `DT_GERACAO` do próprio CSV.
 */
async function lerFonteTs(url: string): Promise<Date | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": TSE_ETL_USER_AGENT, Range: "bytes=0-1023" },
    });
    const lm = res.headers.get("last-modified");
    if (!lm) {
      console.warn(`  [frescor] sem Last-Modified em ${url} (HTTP ${res.status})`);
      return null;
    }
    const d = new Date(lm);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch (err) {
    console.warn(`  [frescor] falhou: ${(err as Error).message}`);
    return null;
  }
}

/**
 * `DT_GERACAO HH_GERACAO` do CSV ("12/09/2026 19:31:30") como instante.
 * O TSE gera em horário de Brasília (UTC−03:00), fixo — o Brasil não tem
 * horário de verão desde 2019.
 */
function geracaoParaData(declarada: string | null): Date | null {
  if (!declarada) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(declarada.trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Obtenção dos CSVs
// ─────────────────────────────────────────────────────────────────────────────

async function csvDoZip(url: string, nomeZip: string, subdir: string, sufixo: string) {
  const zip = await downloadCached(url, nomeZip, { minBytes: 500 * 1024 });
  const dir = await unzipTo(zip, subdir);
  const arquivos = await readdir(dir);
  // Só o BRASIL: é a união exata dos 28 arquivos por UF (medido). Ler os 28
  // duplicaria cada linha.
  const brasil = arquivos.find((f) => f.endsWith(`${sufixo}_BRASIL.csv`));
  if (!brasil) {
    throw new Error(
      `Sem ${sufixo}_BRASIL.csv em ${dir} (achei: ${arquivos.slice(0, 5).join(", ")})`,
    );
  }
  return resolve(dir, brasil);
}

interface Fonte {
  principal: string;
  complementar: string;
  origem: "tse" | "fixture";
}

const FIXTURE_PRINCIPAL = "candidatos-sample.csv";
const FIXTURE_COMPLEMENTAR = "candidatos-complementar-sample.csv";

function fixtures(): Fonte {
  const principal = resolve(FIXTURES_DIR, FIXTURE_PRINCIPAL);
  const complementar = resolve(FIXTURES_DIR, FIXTURE_COMPLEMENTAR);
  for (const f of [principal, complementar]) {
    if (!existsSync(f)) throw new Error(`Fixture ausente: ${f}`);
  }
  return { principal, complementar, origem: "fixture" };
}

async function obterFontes(cli: Cli): Promise<Fonte> {
  if (cli.fixture) return fixtures();
  try {
    return {
      principal: await csvDoZip(
        URL_PRINCIPAL,
        "consulta_cand_2026.zip",
        "consulta_cand_2026",
        "consulta_cand_2026",
      ),
      complementar: await csvDoZip(
        URL_COMPLEMENTAR,
        "consulta_cand_complementar_2026.zip",
        "consulta_cand_complementar_2026",
        "consulta_cand_complementar_2026",
      ),
      origem: "tse",
    };
  } catch (err) {
    console.warn(`  [warn] fonte TSE indisponível: ${(err as Error).message}`);
    console.warn("  [warn] caindo na fixture — a importação NÃO cobre o país.");
    return fixtures();
  }
}

async function lerTodas(path: string): Promise<string[][]> {
  const out: string[][] = [];
  for await (const campos of iterCsv(path)) out.push(campos);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL
// ─────────────────────────────────────────────────────────────────────────────

const INSERT_SQL = `
INSERT INTO candidatos (
  sq_candidato, ano, cd_eleicao, turno, cargo, uf, numero, nome, nome_urna,
  partido_sigla, partido_numero, partido_nome, federacao_sigla, coligacao_nome,
  situacao_julgamento, inserido_urna, substituido, sq_substituido, publicavel, fonte_ts
)
SELECT * FROM UNNEST(
  $1::int8[],        -- sq_candidato
  $2::int2[],        -- ano
  $3::int4[],        -- cd_eleicao
  $4::int2[],        -- turno
  $5::int2[],        -- cargo
  $6::char(2)[],     -- uf
  $7::int4[],        -- numero
  $8::text[],        -- nome
  $9::text[],        -- nome_urna
  $10::varchar(20)[],-- partido_sigla
  $11::int2[],       -- partido_numero
  $12::text[],       -- partido_nome
  $13::varchar(40)[],-- federacao_sigla
  $14::text[],       -- coligacao_nome
  $15::text[],       -- situacao_julgamento
  $16::bool[],       -- inserido_urna
  $17::bool[],       -- substituido
  $18::int8[],       -- sq_substituido
  $19::bool[],       -- publicavel
  $20::timestamptz[] -- fonte_ts
)
-- O DELETE anterior já esvaziou o escopo; o ON CONFLICT é rede contra
-- SQ_CANDIDATO duplicado dentro do próprio CSV.
ON CONFLICT (sq_candidato) DO UPDATE SET
  situacao_julgamento = EXCLUDED.situacao_julgamento,
  publicavel          = EXCLUDED.publicavel,
  fonte_ts            = EXCLUDED.fonte_ts
`;

const UPSERT_PARTIDOS_SQL = `
INSERT INTO partidos (numero, sigla, nome)
SELECT * FROM UNNEST($1::int2[], $2::varchar(20)[], $3::text[])
ON CONFLICT (numero) DO UPDATE SET sigla = EXCLUDED.sigla, nome = EXCLUDED.nome
`;

/**
 * Reconciliação com `projections` — a verificação que substitui a FK que este
 * schema **não** tem (ver migration 0008): conta quantos `(cargo, uf, número)`
 * já apurados não acham candidatura publicável.
 *
 * Duas assimetrias entre as duas tabelas, e ignorar qualquer uma produz falso
 * positivo em massa (medido: 100 linhas fantasma na primeira versão desta
 * query):
 *
 *  - **Presidente mora sob `uf = 'BR'` no cadastro** — é o que o CSV traz em
 *    `SG_UF` —, mas `projections` guarda uma linha **por UF** da corrida
 *    presidencial. Casar `c.uf = p.uf` procuraria um presidenciável do Acre.
 *  - `projections.uf IS NULL` é o agregado **nacional**. Para cargo 1 ele casa
 *    com `BR`; para 3/5/6 o nacional é a união de 27 corridas sob o mesmo
 *    espaço de número (o `GovernorCard` documenta isso), e resolver por número
 *    ali seria ambíguo por construção — essas linhas ficam fora da checagem.
 *
 * Cargos fora do produto (91/92/93, fixtures de replay) também ficam fora.
 */
const RECONCILIACAO_SQL = `
SELECT p.cargo,
       CASE WHEN p.cargo = 1 THEN 'BR' ELSE p.uf END AS uf,
       p.candidato_id,
       COUNT(*)::text AS n
  FROM projections p
 WHERE p.cargo = ANY($2::int2[])
   AND (p.cargo = 1 OR p.uf IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM candidatos c
      WHERE c.ano = $1 AND c.cargo = p.cargo
        AND c.uf = CASE WHEN p.cargo = 1 THEN 'BR' ELSE p.uf END
        AND c.numero = p.candidato_id
        AND c.publicavel
   )
 GROUP BY 1, 2, 3
 ORDER BY 1, 2, 3
`;

async function contagensDoBanco(
  client: Client,
  cargos: readonly number[],
  uf: string | null,
): Promise<ContagemCargoUf[]> {
  const { rows } = await client.query<{ cargo: number; uf: string; total: string }>(
    `SELECT cargo, uf, COUNT(*)::text AS total
       FROM candidatos
      WHERE ano = $1 AND publicavel AND cargo = ANY($2::int2[])
        AND ($3::char(2) IS NULL OR uf = $3)
      GROUP BY cargo, uf`,
    [ANO_PLEITO, cargos, uf],
  );
  return rows.map((r) => ({ cargo: Number(r.cargo), uf: r.uf, total: Number(r.total) }));
}

async function inserirLote(client: Client, lote: CandidatoRow[], fonteTs: string): Promise<void> {
  if (lote.length === 0) return;
  await client.query(INSERT_SQL, [
    lote.map((r) => r.sq_candidato),
    lote.map((r) => r.ano),
    lote.map((r) => r.cd_eleicao),
    lote.map((r) => r.turno),
    lote.map((r) => r.cargo),
    lote.map((r) => r.uf),
    lote.map((r) => r.numero),
    lote.map((r) => r.nome),
    lote.map((r) => r.nome_urna),
    lote.map((r) => r.partido_sigla),
    lote.map((r) => r.partido_numero),
    lote.map((r) => r.partido_nome),
    lote.map((r) => r.federacao_sigla),
    lote.map((r) => r.coligacao_nome),
    lote.map((r) => r.situacao_julgamento),
    lote.map((r) => r.inserido_urna),
    lote.map((r) => r.substituido),
    lote.map((r) => r.sq_substituido),
    lote.map((r) => r.publicavel),
    lote.map(() => fonteTs),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  const cli = parseCli(process.argv.slice(2));
  const cargos = cli.cargo != null ? [cli.cargo] : [...CARGOS_PRODUTO];
  console.log(
    `[candidatos-import] cargos=${cargos.join(",")} uf=${cli.uf ?? "(todas)"} ` +
      `${cli.dryRun ? "DRY-RUN " : ""}${cli.allowShrink ? "ALLOW-SHRINK " : ""}`.trimEnd(),
  );

  // ── frescor da fonte, antes de baixar 4,2 MB ────────────────────────────
  const lastModified = cli.fixture ? null : await lerFonteTs(URL_PRINCIPAL);
  if (lastModified) console.log(`  [frescor] Last-Modified: ${lastModified.toISOString()}`);

  const fonte = await obterFontes(cli);
  console.log(`  [fonte] ${fonte.origem}: ${fonte.principal.split("/").pop()}`);

  const [hPrincipal, hComplementar] = await Promise.all([
    readCsvHeader(fonte.principal),
    readCsvHeader(fonte.complementar),
  ]);
  const [principais, complementares] = await Promise.all([
    lerTodas(fonte.principal),
    lerTodas(fonte.complementar),
  ]);
  console.log(
    `  [csv] principal ${principais.length.toLocaleString("pt-BR")} linhas · ` +
      `complementar ${complementares.length.toLocaleString("pt-BR")} linhas`,
  );

  const uniao = unirCandidaturas(principais, hPrincipal, complementares, hComplementar, {
    uf: cli.uf,
    cargo: cli.cargo,
  });

  const geracao = geracaoParaData(uniao.geracaoDeclarada);
  const fonteTs = lastModified ?? geracao;
  if (!fonteTs) {
    throw new Error(
      "Sem `fonte_ts`: nem Last-Modified do CDN nem DT_GERACAO do CSV. " +
        "`fonte_ts` é NOT NULL e é o que a tela mostra ao leitor (RF-150).",
    );
  }
  const fonteTsIso = fonteTs.toISOString();

  const publicaveis = uniao.linhas.filter((l) => l.publicavel);
  const depois = contarPublicaveis(uniao.linhas);
  const porSituacao = new Map<string, number>();
  for (const l of publicaveis) {
    porSituacao.set(l.situacao_julgamento, (porSituacao.get(l.situacao_julgamento) ?? 0) + 1);
  }
  const colisoesBrutas = colisoes(uniao.linhas, false);
  const colisoesPublicaveis = colisoes(uniao.linhas, true);

  const pool = getPool();
  const client = await pool.connect();
  let inseridas = 0;
  let removidas = 0;
  let avaliacao: AvaliacaoEncolhimento | null = null;
  let antes: ContagemCargoUf[] = [];
  let sumiramNaoPublicaveis = 0;
  let sumiramAusentes = 0;
  let reconciliacao: Array<{ cargo: number; uf: string; candidato_id: number }> = [];
  let commitado = false;

  try {
    await client.query("BEGIN");

    antes = await contagensDoBanco(client, cargos, cli.uf);

    // Quem era publicável antes — base do diagnóstico de quem sumiu.
    const { rows: antesSq } = await client.query<{ sq_candidato: string }>(
      `SELECT sq_candidato::text FROM candidatos
        WHERE ano = $1 AND publicavel AND cargo = ANY($2::int2[])
          AND ($3::char(2) IS NULL OR uf = $3)`,
      [ANO_PLEITO, cargos, cli.uf],
    );

    const del = await client.query(
      `DELETE FROM candidatos
        WHERE ano = $1 AND cargo = ANY($2::int2[])
          AND ($3::char(2) IS NULL OR uf = $3)`,
      [ANO_PLEITO, cargos, cli.uf],
    );
    removidas = del.rowCount ?? 0;

    for (let i = 0; i < uniao.linhas.length; i += BATCH_SIZE) {
      const lote = uniao.linhas.slice(i, i + BATCH_SIZE);
      await inserirLote(client, lote, fonteTsIso);
      inseridas += lote.length;
    }

    if (uniao.partidos.size > 0) {
      const ps = [...uniao.partidos.values()];
      await client.query(UPSERT_PARTIDOS_SQL, [
        ps.map((p) => p.numero),
        ps.map((p) => p.sigla),
        ps.map((p) => p.nome),
      ]);
    }

    // ── guarda de encolhimento: contada do BANCO, depois do INSERT, ANTES do
    //    COMMIT. Contar do array em memória testaria o parser contra si mesmo.
    const depoisBanco = await contagensDoBanco(client, cargos, cli.uf);
    avaliacao = avaliarEncolhimento(antes, depoisBanco);
    if (!avaliacao.ok && !cli.allowShrink) {
      throw new Error(
        `Guarda de encolhimento (RF-152) abortou o ciclo — NADA foi publicado:\n` +
          avaliacao.motivos.map((m) => `    · ${m}`).join("\n") +
          `\n  Se a queda é legítima (indeferimento em massa), rode de novo com --allow-shrink.`,
      );
    }
    if (!avaliacao.ok && cli.allowShrink) {
      console.warn("  [ALLOW-SHRINK] guarda ignorada por decisão do operador (RF-152):");
      for (const m of avaliacao.motivos) console.warn(`    · ${m}`);
    }

    // Diagnóstico de quem sumiu — depois do INSERT, olhando o banco novo.
    if (antesSq.length > 0) {
      const { rows } = await client.query<{ situacao: string; n: string }>(
        `SELECT CASE WHEN c.sq_candidato IS NULL THEN 'ausente' ELSE 'nao_publicavel' END AS situacao,
                COUNT(*)::text AS n
           FROM UNNEST($1::int8[]) AS s(sq)
           LEFT JOIN candidatos c ON c.sq_candidato = s.sq AND c.ano = $2
          WHERE c.sq_candidato IS NULL OR c.publicavel = false
          GROUP BY 1`,
        [antesSq.map((r) => r.sq_candidato), ANO_PLEITO],
      );
      for (const r of rows) {
        if (r.situacao === "ausente") sumiramAusentes = Number(r.n);
        else sumiramNaoPublicaveis = Number(r.n);
      }
    }

    const rec = await client.query<{ cargo: number; uf: string; candidato_id: number }>(
      RECONCILIACAO_SQL,
      [ANO_PLEITO, cargos],
    );
    reconciliacao = rec.rows;

    if (cli.dryRun) {
      await client.query("ROLLBACK");
      console.log("  [dry-run] ROLLBACK — nada foi gravado.");
    } else {
      await client.query("COMMIT");
      commitado = true;
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // ── resumo ────────────────────────────────────────────────────────────────
  const { rows: noBanco } = await pool.query<{ n: string; p: string; parts: string }>(
    `SELECT (SELECT COUNT(*)::text FROM candidatos WHERE ano = $1) AS n,
            (SELECT COUNT(*)::text FROM candidatos WHERE ano = $1 AND publicavel) AS p,
            (SELECT COUNT(*)::text FROM partidos) AS parts`,
    [ANO_PLEITO],
  );
  await pool.end();

  const pct = (n: number, total: number) =>
    total === 0 ? "0,0" : ((n / total) * 100).toFixed(1).replace(".", ",");
  const n = (v: number) => v.toLocaleString("pt-BR");

  console.log(`\n=== Resumo ===`);
  console.log(
    `  fonte                 : ${fonte.origem}${fonte.origem === "fixture" ? " ⚠️ GAP — a importação NÃO cobre o país" : ""}`,
  );
  console.log(
    `  fonte_ts              : ${fonteTsIso}${lastModified ? " (Last-Modified do ZIP)" : " (DT_GERACAO do CSV)"}`,
  );
  console.log(`  DT_GERACAO declarada  : ${uniao.geracaoDeclarada ?? "—"}`);
  console.log(`  linhas lidas          : ${n(uniao.lidas)}`);
  const descartes = [...uniao.descartadosPorCargo.entries()].sort((a, b) => a[0] - b[0]);
  console.log(
    `  descartadas por cargo : ${n(descartes.reduce((a, [, v]) => a + v, 0))} ` +
      `(${descartes.map(([c, v]) => `cargo ${c}: ${n(v)}`).join(" · ")})`,
  );
  if (uniao.descartadosPorFiltro > 0) {
    console.log(`  descartadas por filtro: ${n(uniao.descartadosPorFiltro)} (--uf/--cargo)`);
  }
  console.log(`  removidas (DELETE)    : ${n(removidas)}`);
  console.log(`  inseridas             : ${n(inseridas)}`);
  console.log(
    `  publicáveis           : ${n(publicaveis.length)} (${pct(publicaveis.length, inseridas)}% das inseridas)`,
  );
  console.log("  publicáveis por cargo :");
  for (const c of cargos) {
    const total = depois.filter((d) => d.cargo === c).reduce((a, d) => a + d.total, 0);
    console.log(`    cargo ${c}: ${n(total)}`);
  }
  console.log("  situação de julgamento (publicáveis):");
  for (const [s, v] of [...porSituacao.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s}: ${n(v)}`);
  }
  console.log(
    `  colisões (cargo,uf,nº) : ${n(colisoesBrutas.size)} brutas · ${n(colisoesPublicaveis.size)} publicáveis ` +
      `(${[...colisoesPublicaveis.keys()].join(", ") || "—"})`,
  );
  if (avaliacao) {
    console.log(
      `  guarda de encolhimento: ${avaliacao.ok ? "OK" : `VIOLADA (${cli.allowShrink ? "ignorada por --allow-shrink" : "abortou"})`}`,
    );
    for (const c of avaliacao.porCargo) {
      console.log(
        `    cargo ${c.cargo}: ${n(c.antes)} → ${n(c.depois)} (${(c.queda * 100).toFixed(2)}%)`,
      );
    }
    if (antes.length === 0) console.log("    (primeira importação — não há base de comparação)");
  }
  console.log(
    `  sumiram desde a anterior: ${n(sumiramNaoPublicaveis + sumiramAusentes)} ` +
      `(${n(sumiramNaoPublicaveis)} viraram não-publicáveis · ${n(sumiramAusentes)} ausentes do CSV)`,
  );
  console.log(
    `  reconciliação projections: ${n(reconciliacao.length)} (cargo,uf,candidato_id) apurados sem candidatura publicável`,
  );
  for (const r of reconciliacao.slice(0, 10)) {
    console.log(`    cargo ${r.cargo} ${r.uf} nº ${r.candidato_id}`);
  }
  console.log(`  partidos (upsert)     : ${n(uniao.partidos.size)}`);
  console.log(
    `  no banco              : ${noBanco[0]?.n} candidatos (${noBanco[0]?.p} publicáveis), ` +
      `${noBanco[0]?.parts} partidos${commitado ? "" : " — SEM COMMIT"}`,
  );
  console.log(`  tempo                 : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("Falha em candidatos-import:", err instanceof Error ? err.message : err);
  process.exit(1);
});
