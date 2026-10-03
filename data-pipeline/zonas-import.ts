// data-pipeline/zonas-import.ts
//
// Popula a tabela `zonas` — que desde a migration 0006 é uma tabela de
// **pares (município × zona)**, PK `(uf, cod_municipio_tse, cod_zona)`.
//
// ─── Duas fontes ────────────────────────────────────────────────────────────
//
//   A. EA12 (`--ea12 <caminho|url>`) — "Arquivo de configuração de municípios"
//      do TSE, `comum/config/mun-e<eleição>-cm.json`, arquivo único por
//      eleição. É a fonte oficial do mapa município → zonas: exatamente os
//      pares para os quais o TSE publicará um EA20 em 2026. Grava `fonte='ea12'`
//      e, de quebra, atualiza `municipios.capital` a partir de `mu[].c`.
//
//   B. Fallback (default) — `SELECT DISTINCT uf, cod_municipio_tse, cod_zona
//      FROM eleitorado WHERE ano = 2026 AND uf <> 'ZZ'`, ou seja, os pares
//      derivados do CSV de eleitorado 2024 que `eleitorado-import.ts`
//      carregou. Grava `fonte='csv'`. Enquanto o EA12 2026 não existir (antes
//      do simulado de 15–17/09 só há `ele2024`), é o que temos.
//
// ─── O que mudou e por quê (ADR-0035 D1) ────────────────────────────────────
//
// A versão anterior fazia `SELECT uf, cod_zona, MIN(cod_municipio_tse)
// GROUP BY uf, cod_zona` sobre `historical_results UNION eleitorado` — uma
// linha por zona, com um município escolhido arbitrariamente. Consequência
// medida: 31,2% dos votos caíam no município errado no mapa e 3.392 dos 5.572
// municípios eram estruturalmente invisíveis
// (`docs/_meta/diagnostico-colapso-zona-municipio-2026-09-10.md`).
//
// `historical_results` **saiu do UNION**: o índice único `uq_historical_results`
// não inclui o município, e 1.640 zonas aparecem lá com municípios diferentes
// conforme o candidato. Ele não é fonte confiável de pares — os 6.138 "pares"
// que se contam nele são artefato desse índice, não estrutura geográfica.
//
// ─── Escrita ────────────────────────────────────────────────────────────────
//
// Transação única: `BEGIN; DELETE FROM zonas; INSERT …; COMMIT`. A tabela é
// derivada (nada nasce nela), então reconstruir é mais honesto que fazer
// upsert por cima e conviver com resíduo de uma chave antiga.
//
// A FK `zonas.cod_municipio_tse → municipios.cod_municipio_tse` é verificada
// **antes** do COMMIT: um par apontando para município inexistente aborta a
// importação inteira. `--skip-orphans` rebaixa isso a aviso e exclui os pares
// órfãos — necessário hoje porque o CSV 2024 traz Boa Esperança do Norte (MT,
// cod 73709), município novo que a base IBGE 2022 de `municipios` não tem.
//
// ─── Uso ────────────────────────────────────────────────────────────────────
//
//   set -a; . ./.env.local; set +a
//   node --experimental-strip-types data-pipeline/zonas-import.ts
//   node --experimental-strip-types data-pipeline/zonas-import.ts --ea12 build/ea12.json
//   node --experimental-strip-types data-pipeline/zonas-import.ts --skip-orphans
//
// Pré-requisitos: migration 0006 aplicada e `eleitorado-import.ts` rodado
// (fonte B lê `eleitorado`). Ver `pnpm db:migrate:0006`.

import { readFile } from "node:fs/promises";
import { derivarPares, type EA12Par, parseEA12 } from "../lib/tse/ea12-schema.ts";
import { getPool, TSE_ETL_USER_AGENT } from "./_tse-common.ts";

const BATCH_SIZE = 500;
const ANO_ELEITORADO = 2026;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

interface Par {
  uf: string;
  cod_municipio_tse: number;
  cod_zona: number;
  /** Quando ausente, herda a fonte do run (ver `fonte` em `main`). */
  fonte?: Fonte;
}

type Fonte = "ea12" | "csv" | "historico";

interface Cli {
  ea12: string | null;
  skipOrphans: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL
// ─────────────────────────────────────────────────────────────────────────────

const INSERT_SQL = `
INSERT INTO zonas (uf, cod_municipio_tse, cod_zona, nome, fonte)
SELECT * FROM UNNEST(
  $1::char(2)[],  -- uf
  $2::int4[],     -- cod_municipio_tse
  $3::int4[],     -- cod_zona
  $4::text[],     -- nome (NULL — nome da ZONA, que o TSE não publica aqui)
  $5::text[]      -- fonte
)
ON CONFLICT (uf, cod_municipio_tse, cod_zona) DO UPDATE SET
  fonte = EXCLUDED.fonte
`;

/** Fonte B — pares derivados do CSV de eleitorado já carregado. */
const PARES_DO_ELEITORADO_SQL = `
  SELECT DISTINCT uf, cod_municipio_tse, cod_zona
  FROM eleitorado
  WHERE ano = $1
    AND uf <> 'ZZ'
  ORDER BY uf, cod_municipio_tse, cod_zona
`;

/**
 * Fonte B′ (suplementar à B) — pares que só o histórico conhece.
 *
 * O CSV de eleitorado 2024 é de pleito **municipal**: o DF não elege prefeito,
 * logo não aparece nele, e algumas zonas de PI/SP também ficaram de fora. Sem
 * este complemento, `zonas` perde 26 UFs → o DF inteiro (~2,2 M de eleitores,
 * 19 zonas) sumiria da lista de alvos da ingestão. Medido em 2026-09-11: 32
 * pares `(uf, zona)` do histórico não existem na fonte B.
 *
 * `historical_results` **não** é fonte confiável de pares no caso geral — sua
 * unique key não inclui município, então a mesma zona aparece com municípios
 * diferentes conforme o candidato (1.640 zonas assim). Por isso o filtro é
 * duplo e estreito: só entra o par cuja zona tem **um único** município no
 * histórico (`n_mun = 1`) e cujo município **existe** em `municipios`. Dos 32
 * faltantes, isso recupera 25 (19 DF + 5 PI + 1 SP) e deixa de fora os 7
 * genuinamente ambíguos (6 PI, 1 BA) — que o EA12 2026 resolve.
 */
const PARES_SUPLEMENTARES_SQL = `
  WITH h AS (
    SELECT uf,
           cod_zona,
           COUNT(DISTINCT cod_municipio_tse) AS n_mun,
           MIN(cod_municipio_tse)            AS cod_municipio_tse
    FROM historical_results
    WHERE cod_municipio_tse IS NOT NULL
      AND uf <> 'ZZ'
    GROUP BY uf, cod_zona
  )
  SELECT h.uf, h.cod_municipio_tse, h.cod_zona
  FROM h
  JOIN municipios m ON m.cod_municipio_tse = h.cod_municipio_tse
  WHERE h.n_mun = 1
    AND NOT EXISTS (
      SELECT 1 FROM eleitorado e
      WHERE e.ano = $1 AND e.uf = h.uf AND e.cod_zona = h.cod_zona
    )
  ORDER BY h.uf, h.cod_municipio_tse, h.cod_zona
`;

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function parseCli(argv: string[]): Cli {
  let ea12: string | null = null;
  let skipOrphans = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ea12") {
      const v = argv[i + 1];
      if (!v) throw new Error("--ea12 exige um caminho de arquivo ou URL");
      ea12 = v;
      i++;
    } else if (a === "--skip-orphans") {
      skipOrphans = true;
    } else if (a?.startsWith("--")) {
      throw new Error(`Flag desconhecida: ${a}`);
    }
  }
  return { ea12, skipOrphans };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonte A — EA12
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lê o EA12 de um caminho local ou de uma URL. Se for URL, faz **um único
 * GET** com o User-Agent do projeto. A URL vem do operador — este script não
 * deriva nem adivinha endereço do TSE (constituição § 1).
 */
async function lerEa12(ref: string): Promise<unknown> {
  if (/^https?:\/\//i.test(ref)) {
    console.log(`  [ea12] GET ${ref}`);
    const res = await fetch(ref, { headers: { "User-Agent": TSE_ETL_USER_AGENT } });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} ao buscar EA12 em ${ref}`);
    }
    return await res.json();
  }
  console.log(`  [ea12] lendo arquivo local ${ref}`);
  return JSON.parse(await readFile(ref, "utf8"));
}

async function paresDoEa12(ref: string): Promise<{ pares: Par[]; capitais: EA12Par[] }> {
  const raw = await lerEa12(ref);
  const ea12 = parseEA12(raw);
  console.log(
    `  [ea12] gerado em ${ea12.dg} ${ea12.hg} (idg=${ea12.idg}, fase="${ea12.f}") — ` +
      `${ea12.abr.length} abrangências`,
  );
  const { pares, descartados } = derivarPares(ea12);
  if (descartados > 0) {
    console.warn(`  [ea12] WARN: ${descartados} códigos malformados descartados`);
  }
  // Dedup defensivo — o EA12 não deveria repetir par, mas a PK exige.
  const seen = new Set<string>();
  const out: Par[] = [];
  const capitais: EA12Par[] = [];
  const municipiosVistos = new Set<number>();
  for (const p of pares) {
    const k = `${p.uf}|${p.codMunicipioTse}|${p.codZona}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ uf: p.uf, cod_municipio_tse: p.codMunicipioTse, cod_zona: p.codZona });
    if (!municipiosVistos.has(p.codMunicipioTse)) {
      municipiosVistos.add(p.codMunicipioTse);
      capitais.push(p);
    }
  }
  return { pares: out, capitais };
}

// ─────────────────────────────────────────────────────────────────────────────
// Relatório
// ─────────────────────────────────────────────────────────────────────────────

function relatorioPares(pares: Par[]): {
  zonas: number;
  municipios: number;
  multi: number;
  max: number;
  porUf: Map<string, number>;
} {
  const porZona = new Map<string, Set<number>>();
  const municipios = new Set<number>();
  const porUf = new Map<string, number>();
  for (const p of pares) {
    municipios.add(p.cod_municipio_tse);
    porUf.set(p.uf, (porUf.get(p.uf) ?? 0) + 1);
    const zk = `${p.uf}|${p.cod_zona}`;
    const s = porZona.get(zk);
    if (s) s.add(p.cod_municipio_tse);
    else porZona.set(zk, new Set([p.cod_municipio_tse]));
  }
  let multi = 0;
  let max = 0;
  for (const s of porZona.values()) {
    if (s.size > 1) multi++;
    if (s.size > max) max = s.size;
  }
  return { zonas: porZona.size, municipios: municipios.size, multi, max, porUf };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  const cli = parseCli(process.argv.slice(2));
  const fonte: Fonte = cli.ea12 ? "ea12" : "csv";
  console.log(`[zonas-import] iniciando — fonte=${fonte}`);

  const pool = getPool();

  try {
    // ── antes ─────────────────────────────────────────────────────────────
    const { rows: antes } = await pool.query<{ n: string; m: string }>(
      `SELECT COUNT(*)::text AS n, COUNT(DISTINCT cod_municipio_tse)::text AS m FROM zonas`,
    );
    console.log(`  antes: ${antes[0]?.n} linhas, ${antes[0]?.m} municípios distintos`);

    // ── coleta dos pares ──────────────────────────────────────────────────
    let pares: Par[];
    let capitaisEa12: EA12Par[] = [];
    if (cli.ea12) {
      const r = await paresDoEa12(cli.ea12);
      pares = r.pares;
      capitaisEa12 = r.capitais;
    } else {
      console.log(`  coletando pares de eleitorado (ano=${ANO_ELEITORADO}, exceto ZZ)...`);
      const { rows } = await pool.query<Par>(PARES_DO_ELEITORADO_SQL, [ANO_ELEITORADO]);
      pares = rows;
      if (pares.length === 0) {
        throw new Error(
          `Nenhum par em eleitorado para ano=${ANO_ELEITORADO}. ` +
            `Rode data-pipeline/eleitorado-import.ts antes (ou passe --ea12).`,
        );
      }

      // Fonte B′ — ver PARES_SUPLEMENTARES_SQL. Sem isto o DF inteiro fica
      // fora da lista de alvos da ingestão.
      console.log("  complementando com pares inequívocos do histórico...");
      const supl = await pool.query<Par>(PARES_SUPLEMENTARES_SQL, [ANO_ELEITORADO]);
      if (supl.rows.length > 0) {
        const porUf = new Map<string, number>();
        for (const r of supl.rows) porUf.set(r.uf, (porUf.get(r.uf) ?? 0) + 1);
        const resumo = [...porUf.entries()]
          .sort()
          .map(([uf, n]) => `${uf}:${n}`)
          .join(" ");
        console.log(`  [suplementar] ${supl.rows.length} pares (${resumo})`);
        pares = pares.concat(supl.rows.map((r) => ({ ...r, fonte: "historico" as const })));
      } else {
        console.log("  [suplementar] nenhum par adicional.");
      }
    }
    const rep = relatorioPares(pares);
    console.log(
      `  ${pares.length.toLocaleString("pt-BR")} pares — ${rep.zonas.toLocaleString("pt-BR")} zonas, ` +
        `${rep.municipios.toLocaleString("pt-BR")} municípios`,
    );

    // ── integridade referencial: pares órfãos contra `municipios` ─────────
    const codsMun = [...new Set(pares.map((p) => p.cod_municipio_tse))];
    const { rows: orfaos } = await pool.query<{ cod: number }>(
      `SELECT c AS cod FROM UNNEST($1::int4[]) c
       WHERE NOT EXISTS (SELECT 1 FROM municipios m WHERE m.cod_municipio_tse = c)
       ORDER BY c`,
      [codsMun],
    );
    const codsOrfaos = new Set(orfaos.map((r) => r.cod));
    if (codsOrfaos.size > 0) {
      const amostra = [...codsOrfaos].slice(0, 20).join(", ");
      const msg =
        `${codsOrfaos.size} cod_municipio_tse sem correspondência em municipios ` +
        `(a FK zonas→municipios rejeitaria): ${amostra}`;
      if (!cli.skipOrphans) {
        throw new Error(
          `${msg}\n` +
            `Nada foi escrito. Corrija municipios (o município pode ser novo) ` +
            `ou rode de novo com --skip-orphans para excluir esses pares.`,
        );
      }
      const antesFiltro = pares.length;
      pares = pares.filter((p) => !codsOrfaos.has(p.cod_municipio_tse));
      console.warn(`  WARN (--skip-orphans): ${msg}`);
      console.warn(`  WARN: ${antesFiltro - pares.length} pares órfãos excluídos`);
    }

    // ── municípios conhecidos que ficaram sem nenhum par ──────────────────
    const { rows: semPar } = await pool.query<{ uf: string; n: string; amostra: string }>(
      `SELECT m.uf,
              COUNT(*)::text AS n,
              string_agg(m.nome, ', ' ORDER BY m.nome) FILTER (WHERE m.rn <= 3) AS amostra
         FROM (
           SELECT uf, nome, cod_municipio_tse,
                  ROW_NUMBER() OVER (PARTITION BY uf ORDER BY nome) AS rn
             FROM municipios
            WHERE NOT (cod_municipio_tse = ANY($1::int4[]))
         ) m
        GROUP BY m.uf
        ORDER BY COUNT(*) DESC, m.uf`,
      [[...new Set(pares.map((p) => p.cod_municipio_tse))]],
    );

    // ── escrita: DELETE + INSERT numa transação ───────────────────────────
    const client = await pool.connect();
    let inserted = 0;
    try {
      await client.query("BEGIN");
      const del = await client.query("DELETE FROM zonas");
      console.log(`  [delete] linhas removidas: ${del.rowCount ?? 0}`);
      for (let i = 0; i < pares.length; i += BATCH_SIZE) {
        const batch = pares.slice(i, i + BATCH_SIZE);
        if (batch.length === 0) break;
        await client.query(INSERT_SQL, [
          batch.map((r) => r.uf),
          batch.map((r) => r.cod_municipio_tse),
          batch.map((r) => r.cod_zona),
          batch.map(() => null),
          batch.map((r) => r.fonte ?? fonte),
        ]);
        inserted += batch.length;
      }

      // EA12 é a fonte oficial de "é capital?" — aproveita a mesma transação.
      if (fonte === "ea12" && capitaisEa12.length > 0) {
        const upd = await client.query(
          `UPDATE municipios m
              SET capital = upd.capital
             FROM (SELECT * FROM UNNEST($1::int4[], $2::bool[]) AS t(cod, capital)) upd
            WHERE m.cod_municipio_tse = upd.cod
              AND m.capital IS DISTINCT FROM upd.capital`,
          [capitaisEa12.map((c) => c.codMunicipioTse), capitaisEa12.map((c) => c.capital)],
        );
        console.log(`  [ea12] municipios.capital atualizados: ${upd.rowCount ?? 0}`);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // ── resultado ─────────────────────────────────────────────────────────
    const { rows: depois } = await pool.query<{ n: string; m: string; z: string }>(
      `SELECT COUNT(*)::text AS n,
              COUNT(DISTINCT cod_municipio_tse)::text AS m,
              COUNT(DISTINCT (uf, cod_zona))::text AS z
         FROM zonas`,
    );
    const { rows: multiDb } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM (
         SELECT uf, cod_zona
           FROM zonas
          GROUP BY uf, cod_zona
         HAVING COUNT(DISTINCT cod_municipio_tse) > 1
       ) s`,
    );
    const repFinal = relatorioPares(pares);

    console.log("\n─────────────────────────────────────────────────");
    console.log("[zonas-import] RESULTADO FINAL");
    console.log(`  fonte                 : ${fonte}${cli.ea12 ? ` (${cli.ea12})` : ""}`);
    console.log(`  linhas antes          : ${antes[0]?.n}`);
    console.log(`  pares inseridos       : ${inserted.toLocaleString("pt-BR")}`);
    console.log(`  linhas depois         : ${depois[0]?.n}`);
    console.log(`  zonas distintas       : ${depois[0]?.z}`);
    console.log(`  municípios distintos  : ${depois[0]?.m}`);
    console.log(
      `  zonas multi-município : ${multiDb[0]?.n} (máx. ${repFinal.max} municípios numa zona)`,
    );
    console.log(`  tempo                 : ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    if (semPar.length > 0) {
      const totalSemPar = semPar.reduce((a, r) => a + Number(r.n), 0);
      console.log(`\n  municípios em \`municipios\` sem nenhum par (${totalSemPar}) — por UF:`);
      for (const r of semPar) {
        console.log(`    ${r.uf}: ${r.n}${r.amostra ? ` (ex.: ${r.amostra})` : ""}`);
      }
      console.log(
        `  O CSV de eleitorado 2024 é de pleito municipal, então o DF (que não\n` +
          `  elege prefeito) e algumas zonas de PI/SP não aparecem nele. A fonte\n` +
          `  suplementar B′ recupera os pares inequívocos do histórico; sobram só\n` +
          `  os ambíguos (zona com mais de um município no histórico).\n` +
          `  O EA12 2026 fecha a lacuna por completo — reimportar com --ea12.`,
      );
    } else {
      console.log("\n  todos os municípios de `municipios` têm ao menos um par.");
    }

    console.log("\n  pares por UF:");
    for (const uf of [...repFinal.porUf.keys()].sort()) {
      console.log(`    ${uf}: ${repFinal.porUf.get(uf)}`);
    }
    console.log("─────────────────────────────────────────────────");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Falha em zonas-import:", err instanceof Error ? err.message : err);
  process.exit(1);
});
