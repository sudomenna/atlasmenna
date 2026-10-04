// data-pipeline/exterior-import.ts
//
// Carrega o EXTERIOR (sigla TSE `ZZ`) como 28ª unidade de apuração do cargo 1
// — ADR-0045 itens 2, 3 e 4. Três tabelas, UMA transação, nessa ordem (a FK
// `zonas.cod_municipio_tse → municipios` exige):
//
//   1. `municipios` — 186 localidades com chave sintética
//      `cod_ibge = 'ZZ' || lpad(cod, 5, '0')` (7 caracteres, nunca colide com
//      IBGE, que é só dígitos); `uf='ZZ'`; `capital=false`; resto NULL.
//   2. `zonas`      — 186 pares `(ZZ, cod, 1)`, `fonte='ea12'`.
//   3. `eleitorado` — 186 linhas `ano=2026`, zona 1, aptos do cadastro 2026.
//
// ─── A fonte ─────────────────────────────────────────────────────────────────
//
// `data-pipeline/fixtures/exterior-2026.json`, montado em 04/10/2026 a partir
// de DOIS arquivos oficiais que batem localidade a localidade (186 = 186, nenhuma
// sobrando de nenhum lado):
//   - localidades: EA12 da eleição FEDERAL real (`mun-e006257-cm.json`), todas
//     na zona 0001 — o ADR previa 184 (simulado), o real tem 186;
//   - aptos: `perfil_eleitorado_2026_ZZ.csv` (dados abertos, julho/2026),
//     Σ 918.876. O ADR previa o CSV de 2022; o de 2026 é melhor e é a mesma
//     família de fonte dos pesos oficiais das outras UFs.
//
// Os cargos 3/5/6/7/8 não veem nada disto: a tabela `zonas` é filtrada por
// `cargoExisteNaUf` na enumeração de alvos, e o modelo descarta `ZZ` do
// eleitorado fora do cargo 1.
//
// ⚠️ `zonas-import.ts` (DELETE FROM zonas) e `eleitorado-import.ts` (DELETE
// ano=2026) APAGAM o que este script grava. Rodou um deles? Rode este de novo.
//
// ─── Modo padrão = SIMULAÇÃO ────────────────────────────────────────────────
//
// Sem `--escrever`: valida a fixture e imprime o resumo, sem abrir conexão.
// Com `--escrever`: exige DATABASE_URL. Idempotente — linha igual é no-op;
// linha ZZ já existente com valor DIFERENTE aborta tudo (ROLLBACK), nunca
// sobrescreve. Só toca `uf='ZZ'`.
//
//   pnpm db:exterior                     # simulação
//   set -a; . ./.env.local; set +a
//   pnpm db:exterior --escrever

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./_tse-common.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/exterior-2026.json");

export const ANO = 2026;
export const UF = "ZZ";
export const COD_ZONA = 1;
export const TOTAL_LOCALIDADES = 186;
export const TOTAL_APTOS = 918_876;

export interface Localidade {
  cod: number;
  nome: string;
  aptos: number;
}

export function codIbgeSintetico(cod: number): string {
  return `ZZ${String(cod).padStart(5, "0")}`;
}

export function validar(locs: Localidade[]): void {
  if (locs.length !== TOTAL_LOCALIDADES) {
    throw new Error(`esperado ${TOTAL_LOCALIDADES} localidades, veio ${locs.length}`);
  }
  const vistos = new Set<number>();
  let soma = 0;
  for (const l of locs) {
    if (!Number.isInteger(l.cod) || l.cod <= 0 || l.cod > 99_999) {
      throw new Error(`código inválido: ${l.cod}`);
    }
    if (vistos.has(l.cod)) throw new Error(`código duplicado: ${l.cod}`);
    vistos.add(l.cod);
    if (!l.nome?.trim()) throw new Error(`localidade ${l.cod} sem nome`);
    if (!Number.isInteger(l.aptos) || l.aptos <= 0) {
      throw new Error(`localidade ${l.cod} com aptos=${l.aptos}`);
    }
    soma += l.aptos;
  }
  if (soma !== TOTAL_APTOS) throw new Error(`Σ aptos ${soma} ≠ ${TOTAL_APTOS}`);
}

export function lerFixture(): Localidade[] {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as { localidades: Localidade[] };
  validar(raw.localidades);
  return raw.localidades;
}

async function escrever(locs: Localidade[]): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Colisão de código TSE com município brasileiro (unique em municipios).
    const { rows: colisao } = await client.query<{ cod_municipio_tse: number; uf: string }>(
      `SELECT cod_municipio_tse, uf FROM municipios
        WHERE cod_municipio_tse = ANY($1::int4[]) AND uf <> 'ZZ'`,
      [locs.map((l) => l.cod)],
    );
    if (colisao.length > 0) {
      throw new Error(
        `código TSE do exterior já usado por município brasileiro: ${JSON.stringify(colisao)}`,
      );
    }

    // Divergência com o que já existe → aborta, nunca sobrescreve.
    const { rows: eleit } = await client.query<{
      cod_municipio_tse: number;
      eleitores_aptos: number;
    }>(`SELECT cod_municipio_tse, eleitores_aptos FROM eleitorado WHERE ano = $1 AND uf = $2`, [
      ANO,
      UF,
    ]);
    const porCod = new Map(locs.map((l) => [l.cod, l]));
    const diffs = eleit
      .filter((e) => porCod.get(e.cod_municipio_tse)?.aptos !== e.eleitores_aptos)
      .map(
        (e) =>
          `${e.cod_municipio_tse}: banco=${e.eleitores_aptos} fixture=${porCod.get(e.cod_municipio_tse)?.aptos}`,
      );
    if (diffs.length > 0) {
      throw new Error(`eleitorado ZZ já existe com valores diferentes:\n  ${diffs.join("\n  ")}`);
    }

    const cods = locs.map((l) => l.cod);
    const m = await client.query(
      `INSERT INTO municipios (cod_ibge, cod_municipio_tse, uf, nome, capital)
       SELECT * FROM UNNEST($1::char(7)[], $2::int4[], $3::char(2)[], $4::text[], $5::bool[])
       ON CONFLICT (cod_ibge) DO NOTHING`,
      [
        locs.map((l) => codIbgeSintetico(l.cod)),
        cods,
        locs.map(() => UF),
        locs.map((l) => l.nome),
        locs.map(() => false),
      ],
    );
    const z = await client.query(
      `INSERT INTO zonas (uf, cod_municipio_tse, cod_zona, nome, fonte)
       SELECT * FROM UNNEST($1::char(2)[], $2::int4[], $3::int4[], $4::text[], $5::text[])
       ON CONFLICT (uf, cod_municipio_tse, cod_zona) DO NOTHING`,
      [
        locs.map(() => UF),
        cods,
        locs.map(() => COD_ZONA),
        locs.map(() => null),
        locs.map(() => "ea12"),
      ],
    );
    const e = await client.query(
      `INSERT INTO eleitorado (ano, uf, cod_municipio_tse, cod_zona, eleitores_aptos, comparecimento_pct_historico)
       SELECT * FROM UNNEST($1::int2[], $2::char(2)[], $3::int4[], $4::int4[], $5::int4[], $6::numeric[])
       ON CONFLICT (ano, uf, cod_municipio_tse, cod_zona) DO NOTHING`,
      [
        locs.map(() => ANO),
        locs.map(() => UF),
        cods,
        locs.map(() => COD_ZONA),
        locs.map((l) => l.aptos),
        locs.map(() => null),
      ],
    );

    // Conferência dentro da transação.
    const { rows: conf } = await client.query<{ m: string; z: string; e: string; aptos: string }>(
      `SELECT (SELECT count(*) FROM municipios WHERE uf='ZZ') AS m,
              (SELECT count(*) FROM zonas WHERE uf='ZZ') AS z,
              (SELECT count(*) FROM eleitorado WHERE ano=$1 AND uf='ZZ') AS e,
              (SELECT coalesce(sum(eleitores_aptos),0) FROM eleitorado WHERE ano=$1 AND uf='ZZ') AS aptos`,
      [ANO],
    );
    const c = conf[0]!;
    if (
      Number(c.m) !== TOTAL_LOCALIDADES ||
      Number(c.z) !== TOTAL_LOCALIDADES ||
      Number(c.e) !== TOTAL_LOCALIDADES ||
      Number(c.aptos) !== TOTAL_APTOS
    ) {
      throw new Error(`conferência falhou: ${JSON.stringify(c)}`);
    }
    await client.query("COMMIT");
    console.log(
      `[exterior] COMMIT — inseridas agora: municipios ${m.rowCount}, zonas ${z.rowCount}, eleitorado ${e.rowCount}. ` +
        `No banco: ${c.m}/${c.z}/${c.e} linhas ZZ, ${c.aptos} aptos.`,
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const locs = lerFixture();
  console.log(
    `[exterior] fixture ok: ${locs.length} localidades, zona ${COD_ZONA}, ${TOTAL_APTOS} aptos.`,
  );
  if (!process.argv.includes("--escrever")) {
    console.log("[exterior] SIMULAÇÃO — nada escrito. Use --escrever para gravar.");
    return;
  }
  await escrever(locs);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[exterior] ERRO:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
