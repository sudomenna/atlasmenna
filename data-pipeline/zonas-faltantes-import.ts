// data-pipeline/zonas-faltantes-import.ts
//
// Conserta `zonas` e `eleitorado` contra o EA12 do TSE. Todos os modos rodam na MESMA
// transação (a lógica pura — diff, plano, verificação — está em
// `zonas-faltantes-nucleo.ts`; o modo de pesos oficiais, em `zonas-pesos-oficiais.ts`).
// Aqui só há I/O e a costura. Molde: `eleitorado-df-import.ts` (27/09).
//
// 🔴 DECISÃO DO DONO (29/09): o eleitorado do SIMULADO não é o real (AP: TRE-AP 577.534 ×
// agregado do simulado 628.071), então NENHUM `te` de simulado pode virar peso. Primeiro só
// a ESTRUTURA; os pesos depois, do arquivo oficial do TSE.
//
//   1. `--so-estrutural` — INSERT dos pares que o EA12 lista e `zonas` não tem, SÓ em
//      `zonas` (sem `eleitorado`, sem ler te nem agregado).
//   2. `--remover-fantasmas` — DELETE dos pares de `FANTASMAS_AUTORIZADOS` (fora do EA12 e
//      com zero snapshots) em `zonas` e `eleitorado`.
//   3. `--pesos-oficiais <zip|csv> --uf …` — modo de DEPOIS: grava `eleitorado` a partir do
//      `perfil_eleitorado_2026` (não toca `zonas`; não combina com os outros).
//   (legado) inserção com te / `--recalcular-pesos-uf` — peso a partir de `te` de EA20:
//      RECUSADO quando o EA12 é do simulado (`f = "s"`); só valem com um EA12 real.
//
// ─── Modo padrão = SIMULAÇÃO ────────────────────────────────────────────────
//
// Sem `--escrever` o script LÊ o banco (só `SELECT`, numa transação
// `READ ONLY` que o servidor faz cumprir) e imprime o diff nacional, o `te` de
// cada par, as linhas que inseriria / atualizaria (antigo → novo) / removeria, a
// verificação dos totais e o SQL que desfaria tudo. Não grava nada (nem o
// backup). A simulação PRECISA de `DATABASE_URL` (para saber o que já está em
// `zonas`), ao contrário do script do DF, que só lia fixtures. Rode-a com
// `PGOPTIONS='-c default_transaction_read_only=on'` também: cinto e suspensório.
//
// ─── `--escrever` ───────────────────────────────────────────────────────────
//
// Uma transação só: relê tudo, refaz o plano, ABORTA se houver qualquer
// bloqueio (ver `Plano.bloqueios`), salva em `build/zonas-backup-<timestamp>.json`
// as linhas que serão atualizadas/removidas (mais o SQL de desfazer) ANTES da
// primeira escrita, e então: DELETE dos fantasmas, INSERT dos pares faltantes
// (`ON CONFLICT DO NOTHING`), UPDATE dos pesos (só onde o valor ainda é o lido).
// Confere DENTRO da transação: linhas afetadas por UPDATE/DELETE, `count(zonas)`,
// `count` e `Σ eleitorado` de cada UF tocada, a UF recalculada == agregado
// EXATO, e por fim que `zonas` e `eleitorado` INTEIROS são idênticos ao estado
// esperado (nada além do plano mudou). Só então faz COMMIT. Qualquer falha →
// ROLLBACK e nada fica no banco. Reexecutar depois do COMMIT não faz nada.
//
// ─── Rede ───────────────────────────────────────────────────────────────────
//
// Nenhuma. O EA12 e os EA20 de zona vêm de arquivos locais (`--ea12`,
// `--zonas-dir`); quem os baixa é o operador, com os endereços que o próprio
// TSE documenta (constituição § 1: zero sondagem de URL adivinhada).
//
// ─── Uso ────────────────────────────────────────────────────────────────────
//
//   ( set -a; . ./.env.local; set +a; pnpm db:zonas:faltantes --so-estrutural --remover-fantasmas )
//   ( set -a; . ./.env.local; set +a; pnpm db:zonas:faltantes --escrever --so-estrutural --remover-fantasmas )
//   ( set -a; . ./.env.local; set +a; pnpm db:zonas:faltantes --pesos-oficiais <zip> --uf AP --total-uf AP=577534 )
//
// Flags: --so-estrutural · --remover-fantasmas · --pesos-oficiais <zip|csv> --uf … ·
//        --total-uf AP=<n> · --col-uf/--col-municipio/--col-zona/--col-qt ·
//        --ea12 <caminho> · --zonas-dir <dir> · --eleicao <cod> · --uf AP,PE ·
//        (legado) --aceitar-te-derivado · --exigir-soma-exata · --recalcular-pesos-uf AP[,UF…] ·
//        --escrever (sem ele, SIMULAÇÃO)

import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ALVOS_AGREGADOS,
  ANO,
  alvosDeTe,
  CARGO_REF,
  type Cli,
  chaveDoPar,
  desviosDePeso,
  diferencasDeEstado,
  type Estado,
  estadoFinal,
  extrairTeDeArquivoZona,
  FANTASMAS_AUTORIZADOS,
  faltantesNoEscopo,
  fmt,
  type LinhaPeso,
  type LinhaZona,
  lerParesDoEa12,
  type MetaEa12,
  type Par,
  type ParEa12,
  type Peso,
  type Plano,
  parseCli,
  parseNomeArquivoZona,
  planejar,
  resumoPorUf,
  rotuloDoPar,
  sqlDesfazer,
  tabelaPorUf,
  ValidacaoError,
} from "./zonas-faltantes-nucleo.ts";
import {
  type ContagemOficial,
  estadoFinalOficial,
  lerPerfilOficial,
  type PlanoOficial,
  planejarPesosOficiais,
} from "./zonas-pesos-oficiais.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const EA12_PADRAO = resolve(ROOT, "tests/fixtures/tse/2026-sim/mun-e021270-cm.json");
export const ZONAS_DIR_PADRAO = resolve(ROOT, "tests/fixtures/tse/2026-sim/zonas-faltantes");
export const BUILD_DIR = resolve(ROOT, "build");

// ─────────────────────────────────────────────────────────────────────────────
// SQL — leituras são SELECT; as escritas são INSERT … DO NOTHING, UPDATE e DELETE
// com RETURNING (a contagem de linhas afetadas é conferida) e só rodam em --escrever
// ─────────────────────────────────────────────────────────────────────────────

/** Trava de segurança: nenhuma consulta desta transação pode passar de 90 s. */
export const SQL_TIMEOUT_STATEMENT = `SET LOCAL statement_timeout = '90s'`;
/** Escrita: em vez de esperar um lock, aborta em 10 s. */
export const SQL_TIMEOUT_LOCK = `SET LOCAL lock_timeout = '10s'`;

export const SQL_ZONAS = `SELECT uf, cod_municipio_tse, cod_zona FROM zonas ORDER BY 1, 2, 3`;

export const SQL_PESOS = `
  SELECT uf, cod_municipio_tse, cod_zona, eleitores_aptos
  FROM eleitorado WHERE ano = $1 ORDER BY 1, 2, 3`;

/** Anos presentes em `eleitorado` — a escrita só toca `ano = 2026`. */
export const SQL_ANOS_ELEITORADO = `
  SELECT ano, COUNT(*)::text AS n FROM eleitorado GROUP BY ano ORDER BY ano`;

/** `te` do EA20 de UF (agregado oficial) — o mais recente por UF, da eleição pedida. */
export const SQL_AGREGADOS = `
  SELECT DISTINCT ON (uf) uf, (payload->'e'->>'te') AS te
  FROM snapshots
  WHERE cargo = $1::int2 AND turno = 1 AND nivel = 'uf' AND payload->>'ele' = $2
  ORDER BY uf, ts DESC`;

/** `te` do EA20 de zona — o mais recente por par, buscado por índice (par a par). */
export const SQL_TE_ZONAS = `
  SELECT p.uf, p.mun AS cod_municipio_tse, p.zona AS cod_zona, (s.payload->'e'->>'te') AS te
  FROM UNNEST($1::char(2)[], $2::int4[], $3::int4[]) AS p(uf, mun, zona)
  JOIN LATERAL (
    SELECT payload FROM snapshots
    WHERE cargo = $4::int2 AND turno = 1 AND uf = p.uf
      AND cod_municipio_tse = p.mun AND cod_zona = p.zona
      AND nivel = 'zona' AND payload->>'ele' = $5
    ORDER BY ts DESC LIMIT 1
  ) s ON true`;

/**
 * Snapshots de cada par, em QUALQUER cargo, turno e nível — a prova de que um
 * fantasma nunca foi ingerido. Uma varredura só (sem `payload`); par sem linha
 * no resultado tem zero.
 */
export const SQL_SNAPSHOTS_POR_PAR = `
  SELECT s.uf, s.cod_municipio_tse, s.cod_zona, COUNT(*)::text AS n
  FROM snapshots s
  JOIN UNNEST($1::char(2)[], $2::int4[], $3::int4[]) AS p(uf, mun, zona)
    ON s.uf = p.uf AND s.cod_municipio_tse = p.mun AND s.cod_zona = p.zona
  GROUP BY 1, 2, 3`;

export const SQL_MUNICIPIOS = `
  SELECT cod_municipio_tse FROM municipios WHERE cod_municipio_tse = ANY($1::int4[])`;

/** Linhas COMPLETAS de `eleitorado` (backup e SQL de desfazer). */
export const SQL_LINHAS_ELEITORADO = `
  SELECT e.* FROM eleitorado e
  JOIN UNNEST($2::char(2)[], $3::int4[], $4::int4[]) AS p(uf, mun, zona)
    ON e.uf = p.uf AND e.cod_municipio_tse = p.mun AND e.cod_zona = p.zona
  WHERE e.ano = $1 ORDER BY e.uf, e.cod_municipio_tse, e.cod_zona`;

/** Linhas COMPLETAS de `zonas` (backup e SQL de desfazer). */
export const SQL_LINHAS_ZONAS = `
  SELECT z.* FROM zonas z
  JOIN UNNEST($1::char(2)[], $2::int4[], $3::int4[]) AS p(uf, mun, zona)
    ON z.uf = p.uf AND z.cod_municipio_tse = p.mun AND z.cod_zona = p.zona
  ORDER BY z.uf, z.cod_municipio_tse, z.cod_zona`;

export const SQL_INSERT_ZONAS = `
  INSERT INTO zonas (uf, cod_municipio_tse, cod_zona, nome, fonte)
  SELECT * FROM UNNEST($1::char(2)[], $2::int4[], $3::int4[], $4::text[], $5::text[])
  ON CONFLICT (uf, cod_municipio_tse, cod_zona) DO NOTHING`;

export const SQL_INSERT_PESOS = `
  INSERT INTO eleitorado
    (ano, uf, cod_municipio_tse, cod_zona, eleitores_aptos, comparecimento_pct_historico)
  SELECT * FROM UNNEST($1::int2[], $2::char(2)[], $3::int4[], $4::int4[], $5::int4[], $6::numeric[])
  ON CONFLICT (ano, uf, cod_municipio_tse, cod_zona) DO NOTHING`;

/**
 * Só atualiza a linha se o peso AINDA for o que foi lido (`antigo`): uma escrita
 * concorrente vira contagem menor que a prevista → ROLLBACK, nunca sobrescrita cega.
 */
export const SQL_UPDATE_PESOS = `
  UPDATE eleitorado e SET eleitores_aptos = v.novo
  FROM UNNEST($2::char(2)[], $3::int4[], $4::int4[], $5::int4[], $6::int4[])
    AS v(uf, mun, zona, antigo, novo)
  WHERE e.ano = $1 AND e.uf = v.uf AND e.cod_municipio_tse = v.mun AND e.cod_zona = v.zona
    AND e.eleitores_aptos = v.antigo
  RETURNING e.uf, e.cod_municipio_tse, e.cod_zona`;

export const SQL_DELETE_PESOS = `
  DELETE FROM eleitorado e
  USING UNNEST($2::char(2)[], $3::int4[], $4::int4[]) AS v(uf, mun, zona)
  WHERE e.ano = $1 AND e.uf = v.uf AND e.cod_municipio_tse = v.mun AND e.cod_zona = v.zona
  RETURNING e.uf, e.cod_municipio_tse, e.cod_zona`;

export const SQL_DELETE_ZONAS = `
  DELETE FROM zonas z
  USING UNNEST($1::char(2)[], $2::int4[], $3::int4[]) AS v(uf, mun, zona)
  WHERE z.uf = v.uf AND z.cod_municipio_tse = v.mun AND z.cod_zona = v.zona
  RETURNING z.uf, z.cod_municipio_tse, z.cod_zona`;

export const SQL_SOMA_UF = `
  SELECT COALESCE(SUM(eleitores_aptos), 0)::text AS soma, COUNT(*)::text AS n
  FROM eleitorado WHERE ano = $1 AND uf = $2`;

export const SQL_CONTA_ZONAS_UF = `SELECT COUNT(*)::text AS n FROM zonas WHERE uf = $1`;

// ─────────────────────────────────────────────────────────────────────────────
// Cliente mínimo (o `PoolClient` do Neon o satisfaz; os testes injetam um falso)
// ─────────────────────────────────────────────────────────────────────────────

export interface Consulta {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

type Linha = Record<string, unknown>;

async function selecionar(c: Consulta, sql: string, params?: unknown[]): Promise<Linha[]> {
  return (await c.query(sql, params)).rows as Linha[];
}

const num = (v: unknown): number => Number(v);

function teDoTexto(v: unknown, contexto: string): number {
  const te = Number(String(v).replace(/\./g, "").replace(",", "."));
  if (!Number.isInteger(te) || te <= 0) {
    throw new ValidacaoError(`${contexto}: te="${String(v)}" — esperado inteiro > 0`);
  }
  return te;
}

const parDe = (r: Linha): Par => ({
  uf: String(r.uf),
  codMunicipioTse: num(r.cod_municipio_tse),
  codZona: num(r.cod_zona),
});

// ─────────────────────────────────────────────────────────────────────────────
// Leitura do banco (dentro da transação aberta por `executar`)
// ─────────────────────────────────────────────────────────────────────────────

interface EstadoDoBanco extends Estado {
  agregadoPorUf: Map<string, number>;
  anosEleitorado: { ano: number; n: number }[];
}

async function lerEstado(c: Consulta): Promise<Estado> {
  const zonas = (await selecionar(c, SQL_ZONAS)).map(parDe);
  const pesos = (await selecionar(c, SQL_PESOS, [ANO])).map((r) => ({
    ...parDe(r),
    eleitoresAptos: num(r.eleitores_aptos),
  }));
  return { zonas, pesos };
}

async function lerBase(
  c: Consulta,
  eleicao: string,
  lerAgregados: boolean,
): Promise<EstadoDoBanco> {
  const { zonas, pesos } = await lerEstado(c);
  const agregadoPorUf = new Map<string, number>();
  // Modo estrutural: o agregado do simulado NÃO é critério (o eleitorado do simulado não é o
  // real) e não é lido — nenhuma conta do relatório se apoia nele.
  if (lerAgregados) {
    for (const r of await selecionar(c, SQL_AGREGADOS, [CARGO_REF, eleicao])) {
      agregadoPorUf.set(String(r.uf), teDoTexto(r.te, `agregado ${String(r.uf)}`));
    }
  }
  const anosEleitorado = (await selecionar(c, SQL_ANOS_ELEITORADO)).map((r) => ({
    ano: num(r.ano),
    n: num(r.n),
  }));
  return { zonas, pesos, agregadoPorUf, anosEleitorado };
}

async function lerTeDasZonas(
  c: Consulta,
  pares: Par[],
  eleicao: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (pares.length === 0) return out;
  const rows = await selecionar(c, SQL_TE_ZONAS, [
    pares.map((p) => p.uf),
    pares.map((p) => p.codMunicipioTse),
    pares.map((p) => p.codZona),
    CARGO_REF,
    eleicao,
  ]);
  for (const r of rows) {
    const par = parDe(r);
    out.set(chaveDoPar(par), teDoTexto(r.te, `zona ${rotuloDoPar(par)}`));
  }
  return out;
}

/** Snapshots por par (qualquer cargo) dos fantasmas que ainda estão no banco e fora do EA12. */
async function lerSnapshotsDosFantasmas(
  c: Consulta,
  ea12: ParEa12[],
  base: EstadoDoBanco,
  ufsEscopo: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const kEa12 = new Set(ea12.map(chaveDoPar));
  const kZonas = new Set(base.zonas.map(chaveDoPar));
  const kPesos = new Set(base.pesos.map(chaveDoPar));
  const alvo = FANTASMAS_AUTORIZADOS.filter((g) => {
    const k = chaveDoPar(g);
    return (
      (ufsEscopo.length === 0 || ufsEscopo.includes(g.uf)) &&
      !kEa12.has(k) &&
      (kZonas.has(k) || kPesos.has(k))
    );
  });
  if (alvo.length === 0) return out;
  for (const g of alvo) out.set(chaveDoPar(g), 0);
  const rows = await selecionar(c, SQL_SNAPSHOTS_POR_PAR, [
    alvo.map((g) => g.uf),
    alvo.map((g) => g.codMunicipioTse),
    alvo.map((g) => g.codZona),
  ]);
  for (const r of rows) out.set(chaveDoPar(parDe(r)), num(r.n));
  return out;
}

interface LinhasCompletas {
  /** Estado ANTES das linhas de `eleitorado` que o UPDATE altera. */
  pesosAtualizados: LinhaPeso[];
  pesosRemovidos: LinhaPeso[];
  zonasRemovidas: LinhaZona[];
}

const comoLinhaPeso = (r: Linha): LinhaPeso => ({
  ano: num(r.ano),
  uf: String(r.uf),
  cod_municipio_tse: num(r.cod_municipio_tse),
  cod_zona: num(r.cod_zona),
  eleitores_aptos: num(r.eleitores_aptos),
  comparecimento_pct_historico:
    r.comparecimento_pct_historico === null || r.comparecimento_pct_historico === undefined
      ? null
      : String(r.comparecimento_pct_historico),
});

const comoLinhaZona = (r: Linha): LinhaZona => ({
  uf: String(r.uf),
  cod_municipio_tse: num(r.cod_municipio_tse),
  cod_zona: num(r.cod_zona),
  nome: r.nome === null || r.nome === undefined ? null : String(r.nome),
  fonte: r.fonte === null || r.fonte === undefined ? null : String(r.fonte),
});

/** Linhas COMPLETAS de `eleitorado` (ano=2026) dos pares dados; o banco tem de devolver todas. */
async function lerLinhasPesos(c: Consulta, pares: Par[], nome: string): Promise<LinhaPeso[]> {
  if (pares.length === 0) return [];
  const rows = (
    await selecionar(c, SQL_LINHAS_ELEITORADO, [
      ANO,
      pares.map((p) => p.uf),
      pares.map((p) => p.codMunicipioTse),
      pares.map((p) => p.codZona),
    ])
  ).map(comoLinhaPeso);
  if (rows.length !== pares.length) {
    throw new ValidacaoError(
      `${nome}: ${pares.length} linha(s) planejada(s), o banco devolveu ${rows.length}.`,
    );
  }
  return rows;
}

/** Lê as linhas completas que o plano vai atualizar/remover (backup + SQL de desfazer). */
async function lerLinhasCompletas(c: Consulta, plano: Plano): Promise<LinhasCompletas> {
  const lerPesos = (pares: Par[], nome: string): Promise<LinhaPeso[]> =>
    lerLinhasPesos(c, pares, nome);
  const zonasRemovidas =
    plano.fantasmas.remocoesZonas.length === 0
      ? []
      : (
          await selecionar(c, SQL_LINHAS_ZONAS, [
            plano.fantasmas.remocoesZonas.map((p) => p.uf),
            plano.fantasmas.remocoesZonas.map((p) => p.codMunicipioTse),
            plano.fantasmas.remocoesZonas.map((p) => p.codZona),
          ])
        ).map(comoLinhaZona);
  if (zonasRemovidas.length !== plano.fantasmas.remocoesZonas.length) {
    throw new ValidacaoError(
      `zonas a remover: ${plano.fantasmas.remocoesZonas.length} planejada(s), o banco devolveu ${zonasRemovidas.length}.`,
    );
  }
  return {
    pesosAtualizados: await lerPesos(
      plano.atualizacoesPesos.map((a) => a.par),
      "eleitorado a atualizar",
    ),
    pesosRemovidos: await lerPesos(plano.fantasmas.remocoesPesos, "eleitorado a remover"),
    zonasRemovidas,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Arquivos locais
// ─────────────────────────────────────────────────────────────────────────────

export interface ArquivoZona {
  te: number;
  arquivo: string;
}

/**
 * Lê os EA20 de zona de `dir` (nome oficial `<uf><mun5>-z<zona4>-c0001-e<ele6>-u.json`).
 * Pasta inexistente só é tolerada quando é a padrão (o operador ainda não baixou nada).
 */
export async function lerArquivosDeZona(
  dir: string,
  eleicao: string,
  opcional: boolean,
): Promise<Map<string, ArquivoZona>> {
  let nomes: string[];
  try {
    nomes = await readdir(dir);
  } catch (err) {
    if (opcional && (err as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw err;
  }
  const out = new Map<string, ArquivoZona>();
  for (const nome of nomes.filter((n) => parseNomeArquivoZona(n) !== null).sort()) {
    const raw = JSON.parse(await readFile(resolve(dir, nome), "utf8"));
    const { par, te, eleicao: ele } = extrairTeDeArquivoZona(nome, raw);
    if (ele !== Number(eleicao)) {
      throw new ValidacaoError(`${nome}: eleição ${ele} ≠ --eleicao ${eleicao}`);
    }
    const k = chaveDoPar(par);
    const anterior = out.get(k);
    if (anterior) {
      throw new ValidacaoError(`Par ${rotuloDoPar(par)} duplicado: ${anterior.arquivo} e ${nome}`);
    }
    out.set(k, { te, arquivo: nome });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Backup (escrito ANTES da primeira escrita no banco)
// ─────────────────────────────────────────────────────────────────────────────

export interface Backup {
  _aviso: string;
  geradoEm: string;
  eleicao: string;
  opcoes: {
    ufs: string[];
    recalcularPesosUf: string[];
    removerFantasmas: boolean;
    aceitarTeDerivado: boolean;
    soEstrutural: boolean;
    pesosOficiais: string | null;
  };
  resumo: {
    eleitorado_atualizadas: number;
    eleitorado_removidas: number;
    zonas_removidas: number;
    zonas_inseridas: number;
    eleitorado_inseridas: number;
  };
  /** Estado ANTES das linhas de `eleitorado` que o UPDATE altera. */
  eleitorado_atualizadas: LinhaPeso[];
  eleitorado_removidas: LinhaPeso[];
  zonas_removidas: LinhaZona[];
  /** Chaves dos pares inseridos (o desfazer os apaga). */
  zonas_inseridas: Par[];
  eleitorado_inseridas: Par[];
  /** Cole no `psql`: uma transação que devolve o banco ao estado anterior. */
  desfazerSql: string[];
}

export type SalvarBackup = (backup: Backup) => Promise<string>;

export function nomeDoBackup(agora: Date): string {
  const ts = agora.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  return `zonas-backup-${ts}.json`;
}

/** Grava em `build/` (ignorado pelo git); `wx` = nunca sobrescreve um backup existente. */
export async function salvarBackupEmDisco(
  backup: Backup,
  dir: string = BUILD_DIR,
  agora: Date = new Date(),
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const caminho = resolve(dir, nomeDoBackup(agora));
  await writeFile(caminho, `${JSON.stringify(backup, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return caminho;
}

/** O que o backup e o desfazer precisam de um plano: só as chaves dos pares que ENTRAM. */
interface InsercoesDoPlano {
  insercoesZonas: Par[];
  insercoesPesos: Par[];
}

function montarBackup(
  cli: Cli,
  plano: InsercoesDoPlano,
  linhas: LinhasCompletas,
  desfazerSql: string[],
): Backup {
  return {
    _aviso:
      "Gravado ANTES da escrita: só houve mudança no banco se a execução imprimiu COMMIT. " +
      "`desfazerSql` devolve o banco ao estado deste arquivo (uma transação).",
    geradoEm: new Date().toISOString(),
    eleicao: cli.eleicao,
    opcoes: {
      ufs: cli.ufs,
      recalcularPesosUf: cli.recalcularPesosUf,
      removerFantasmas: cli.removerFantasmas,
      aceitarTeDerivado: cli.aceitarTeDerivado,
      soEstrutural: cli.soEstrutural,
      pesosOficiais: cli.pesosOficiais,
    },
    resumo: {
      eleitorado_atualizadas: linhas.pesosAtualizados.length,
      eleitorado_removidas: linhas.pesosRemovidos.length,
      zonas_removidas: linhas.zonasRemovidas.length,
      zonas_inseridas: plano.insercoesZonas.length,
      eleitorado_inseridas: plano.insercoesPesos.length,
    },
    eleitorado_atualizadas: linhas.pesosAtualizados,
    eleitorado_removidas: linhas.pesosRemovidos,
    zonas_removidas: linhas.zonasRemovidas,
    zonas_inseridas: plano.insercoesZonas.map(({ uf, codMunicipioTse, codZona }) => ({
      uf,
      codMunicipioTse,
      codZona,
    })),
    eleitorado_inseridas: plano.insercoesPesos.map(({ uf, codMunicipioTse, codZona }) => ({
      uf,
      codMunicipioTse,
      codZona,
    })),
    desfazerSql,
  };
}

function desfazerDoPlano(plano: InsercoesDoPlano, linhas: LinhasCompletas): string[] {
  const chave = ({ uf, codMunicipioTse, codZona }: Par): Par => ({ uf, codMunicipioTse, codZona });
  return sqlDesfazer({
    zonasRemovidas: linhas.zonasRemovidas,
    pesosRemovidos: linhas.pesosRemovidos,
    pesosAtualizados: linhas.pesosAtualizados,
    zonasInseridas: plano.insercoesZonas.map(chave),
    pesosInseridos: plano.insercoesPesos.map(chave),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Relatório
// ─────────────────────────────────────────────────────────────────────────────

const pct = (n: number | null): string =>
  n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2).replace(".", ",")}%`;

const mais = (n: number): string => `${n > 0 ? "+" : ""}${fmt(n)}`;

interface ContextoRelatorio {
  cli: Cli;
  meta: MetaEa12;
  ea12: ParEa12[];
  base: EstadoDoBanco;
  plano: Plano;
  teZonaSnapshots: Map<string, number>;
  arquivos: Map<string, ArquivoZona>;
  snapshotsPorPar: Map<string, number>;
  linhas: LinhasCompletas;
  desfazerSql: string[];
}

function imprimirRelatorio(log: (s: string) => void, ctx: ContextoRelatorio): void {
  const { cli, meta, ea12, base, plano } = ctx;
  const nomeMun = new Map(ea12.map((p) => [`${p.uf}|${p.codMunicipioTse}`, p.nomeMunicipio]));
  const rotuloComNome = (p: Par): string => {
    const n = nomeMun.get(`${p.uf}|${p.codMunicipioTse}`);
    return `${rotuloDoPar(p)}${n ? ` ${n}` : ""}`;
  };
  log(
    `[zonas-faltantes] EA12 gerado em ${meta.dg} ${meta.hg} (idg=${meta.idg}, fase="${meta.f}") — ` +
      `${fmt(ea12.length)} pares (sem exterior)`,
  );
  log(
    `[zonas-faltantes] banco: ${fmt(base.zonas.length)} pares em zonas · ${fmt(base.pesos.length)} ` +
      `pesos em eleitorado (ano=${ANO}) · ${
        cli.soEstrutural
          ? "agregado do simulado NÃO lido (não é critério: o eleitorado do simulado não é o real)"
          : `agregado de UF (eleição ${cli.eleicao}, cargo ${CARGO_REF}) em ${base.agregadoPorUf.size} UFs`
      }`,
  );
  if (meta.f === "s" && !cli.soEstrutural) {
    log(
      "[zonas-faltantes] ⚠ EA12 do SIMULADO (f='s'): peso vindo de te de EA20 é recusado — " +
        "o eleitorado do simulado não é o real (AP: TRE-AP 577.534 × simulado 628.071).",
    );
  }
  log(
    `[zonas-faltantes] eleitorado por ano: ${base.anosEleitorado
      .map((a) => `${a.ano}=${fmt(a.n)}`)
      .join(" · ")} (a escrita só toca ano=${ANO})`,
  );
  const modos = [
    cli.soEstrutural
      ? "SÓ ESTRUTURA (insere em zonas; nenhum peso é gravado)"
      : "inserção de pares faltantes",
    cli.recalcularPesosUf.length > 0
      ? `recalcular pesos de ${cli.recalcularPesosUf.join(",")}`
      : "",
    cli.removerFantasmas ? "remover fantasmas" : "",
  ].filter(Boolean);
  log(`[zonas-faltantes] modos: ${modos.join(" + ")}`);

  // 1 — diff nacional
  const tabela = tabelaPorUf(ea12, base.zonas, base.pesos, base.agregadoPorUf);
  const comDiferenca = tabela.filter(
    (l) => l.faltam > 0 || l.sobram > 0 || l.ea12SemPeso > 0 || l.pesosForaDoEa12 > 0,
  );
  log("\n=== 1. Diff nacional: EA12 × zonas × eleitorado ===");
  log(
    "  UF   EA12  zonas faltam sobram EA12s/peso peso≠EA12(Σ)    te agregado    Σ pesos      Δ pesos×agr",
  );
  for (const l of comDiferenca) {
    log(
      `  ${l.uf}  ${String(l.ea12).padStart(5)} ${String(l.zonas).padStart(6)} ` +
        `${String(l.faltam).padStart(6)} ${String(l.sobram).padStart(6)} ` +
        `${String(l.ea12SemPeso).padStart(10)} ` +
        `${`${l.pesosForaDoEa12} (${fmt(l.somaPesosForaDoEa12)})`.padStart(15)} ` +
        `${(l.agregadoTe === null ? "—" : fmt(l.agregadoTe)).padStart(14)} ` +
        `${fmt(l.somaPesos).padStart(11)} ${pct(l.gapPct).padStart(12)}`,
    );
  }
  log(`  (${tabela.length - comDiferenca.length} UFs sem diferença de pares)`);
  if (!cli.soEstrutural) {
    log("  Σ pesos de eleitorado × te do agregado, TODAS as UFs (peso vem do CSV de 2024):");
    for (let i = 0; i < tabela.length; i += 7) {
      log(
        `    ${tabela
          .slice(i, i + 7)
          .map((l) => `${l.uf} ${pct(l.gapPct)}`)
          .join(" · ")}`,
      );
    }
  }
  const d = plano.diff;
  const lista = (xs: (Par & { nomeMunicipio?: string })[]): string =>
    xs.length === 0
      ? "    (nenhum)"
      : xs
          .map((p) => `    ${rotuloDoPar(p)}${p.nomeMunicipio ? ` ${p.nomeMunicipio}` : ""}`)
          .join("\n");
  log(`\n  EA12 lista e zonas NÃO tem (${d.faltandoEmZonas.length}) — os que este script insere:`);
  log(lista(d.faltandoEmZonas));
  log(
    `  zonas tem e o EA12 NÃO lista (${d.sobrandoEmZonas.length}) — ${
      cli.removerFantasmas ? "seção 3c" : "só relatório"
    }:`,
  );
  log(lista(d.sobrandoEmZonas));
  log(`  zonas sem peso em eleitorado (${d.zonasSemPeso.length}) — só relatório:`);
  log(lista(d.zonasSemPeso));
  log(
    `  peso em eleitorado de par que o EA12 não lista (${d.pesosForaDoEa12.length}) — ${
      cli.removerFantasmas ? "seção 3c" : "só relatório"
    }:`,
  );
  log(
    d.pesosForaDoEa12.length === 0
      ? "    (nenhum)"
      : d.pesosForaDoEa12.map((p) => `    ${rotuloDoPar(p)}: ${fmt(p.eleitoresAptos)}`).join("\n"),
  );

  // 2 — te dos pares resolvidos
  log("\n=== 2. te dos pares faltantes / sem te em snapshot (peso a gravar) ===");
  if (cli.soEstrutural) {
    log("  (modo estrutural: nenhum te é lido nem gravado — o peso virá de --pesos-oficiais)");
  } else if (plano.resolvidos.length === 0) log("  (nenhum resolvido)");
  for (const r of plano.resolvidos) {
    const agg = base.agregadoPorUf.get(r.uf);
    const conta =
      r.fonte === "derivado" && r.residuoUf !== null && agg !== undefined
        ? `  [agregado ${fmt(agg)} − Σ demais pares ${fmt(agg - r.residuoUf)} = ${fmt(r.residuoUf)}]`
        : "";
    const arq = ctx.arquivos.get(chaveDoPar(r));
    log(
      `  ${rotuloDoPar(r)} ${r.nomeMunicipio}: te=${fmt(r.te)}  fonte=${r.fonte}` +
        `${arq ? ` (${arq.arquivo})` : ""}${conta}` +
        (agg
          ? `  = ${((r.te / agg) * 100).toFixed(2).replace(".", ",")}% do eleitorado da UF`
          : ""),
    );
  }

  // 3 — linhas inseridas
  log("\n=== 3. Linhas que seriam inseridas ===");
  log(`  zonas (${plano.insercoesZonas.length}): (uf, cod_municipio_tse, cod_zona, nome, fonte)`);
  for (const z of plano.insercoesZonas) {
    log(`    ('${z.uf}', ${z.codMunicipioTse}, ${z.codZona}, NULL, '${z.fonte}')`);
  }
  log(
    `  eleitorado (${plano.insercoesPesos.length}): (ano, uf, cod_municipio_tse, cod_zona, eleitores_aptos, comparecimento_pct_historico)`,
  );
  for (const p of plano.insercoesPesos) {
    log(`    (${ANO}, '${p.uf}', ${p.codMunicipioTse}, ${p.codZona}, ${p.te}, NULL)`);
  }
  for (const j of plano.pesosJaExistentes) {
    log(
      `  [já existe] eleitorado ${rotuloDoPar(j.par)}: banco=${fmt(j.pesoBanco)} · calculado=${fmt(j.te)}`,
    );
  }

  // 3b — linhas atualizadas
  log("\n=== 3b. Linhas que seriam ATUALIZADAS (eleitorado.eleitores_aptos: antigo → novo) ===");
  if (plano.atualizacoesPesos.length === 0) log("  (nenhuma)");
  for (const a of plano.atualizacoesPesos) {
    log(
      `  ${rotuloComNome(a.par)}: ${fmt(a.de)} → ${fmt(a.para)} (${mais(a.para - a.de)})  fonte=${a.fonte}`,
    );
  }
  if (cli.recalcularPesosUf.length > 0) {
    log(
      `  (${plano.atualizacoesPesos.length} alterada(s); ${plano.inalteradosNoRecalculo} par(es) de ` +
        `${cli.recalcularPesosUf.join(",")} já estavam com o te 2026)`,
    );
  }

  // 3c — linhas removidas
  log("\n=== 3c. Linhas que seriam REMOVIDAS (pares-fantasma) ===");
  if (!cli.removerFantasmas) log("  (--remover-fantasmas não passado)");
  else {
    const f = plano.fantasmas;
    const pesoDe = new Map(f.remocoesPesos.map((p) => [chaveDoPar(p), p.eleitoresAptos]));
    if (f.remocoesZonas.length === 0 && f.remocoesPesos.length === 0) log("  (nenhuma)");
    for (const z of ctx.linhas.zonasRemovidas) {
      const k = chaveDoPar({ uf: z.uf, codMunicipioTse: z.cod_municipio_tse, codZona: z.cod_zona });
      const peso = pesoDe.get(k);
      log(
        `  zonas ('${z.uf}', ${z.cod_municipio_tse}, ${z.cod_zona}) nome=${z.nome === null ? "NULL" : `'${z.nome}'`} ` +
          `fonte=${z.fonte === null ? "NULL" : `'${z.fonte}'`}` +
          ` · eleitorado: ${peso === undefined ? "sem peso" : `${fmt(peso)} eleitores`}` +
          ` · snapshots (qualquer cargo): ${ctx.snapshotsPorPar.get(k) ?? "?"}`,
      );
    }
    for (const p of f.remocoesPesos) {
      if (!f.remocoesZonas.some((z) => chaveDoPar(z) === chaveDoPar(p))) {
        log(
          `  eleitorado sem linha em zonas: ${rotuloDoPar(p)}: ${fmt(p.eleitoresAptos)} eleitores`,
        );
      }
    }
    if (f.jaRemovidos.length > 0) {
      log(`  já removidos (reexecução): ${f.jaRemovidos.map(rotuloDoPar).join(", ")}`);
    }
    log(
      `  total: ${f.remocoesZonas.length} linha(s) de zonas · ${f.remocoesPesos.length} de eleitorado ` +
        `(${fmt(f.remocoesPesos.reduce((a, p) => a + p.eleitoresAptos, 0))} eleitores)`,
    );
  }

  // 4 — totais
  const depois = estadoFinal(base, plano);
  const ufsTocadas = [
    ...new Set([
      ...plano.verificacoes.map((v) => v.uf),
      ...plano.insercoesZonas.map((z) => z.uf),
      ...plano.fantasmas.remocoesZonas.map((z) => z.uf),
    ]),
  ];
  log(
    cli.soEstrutural
      ? "\n=== 4. Contagens e Σ de pesos por UF afetada (modo estrutural: o agregado do simulado NÃO é critério) ==="
      : "\n=== 4. Σ pesos de eleitorado × te do agregado do TSE, por UF afetada ===",
  );
  if (plano.verificacoes.length === 0 && !cli.soEstrutural) log("  (nada a verificar)");
  for (const v of plano.verificacoes) {
    log(
      `  ${v.uf}: agregado=${fmt(v.agregadoTe)} · Σ antes=${fmt(v.somaPesosAntes)} ` +
        `(${v.gapAntes > 0 ? "+" : ""}${fmt(v.gapAntes)}) · Σ depois=${fmt(v.somaPesosDepois)} ` +
        `(${v.gapDepois > 0 ? "+" : ""}${fmt(v.gapDepois)}) → ${v.situacao}`,
    );
  }
  log("  contagens antes → depois (linhas):");
  for (const r of resumoPorUf(base, depois, base.agregadoPorUf, ufsTocadas)) {
    log(
      `    ${r.uf}: zonas ${r.zonasAntes} → ${r.zonasDepois} · eleitorado ${r.pesosAntes} → ${r.pesosDepois}` +
        ` · Σ ${fmt(r.somaAntes)} → ${fmt(r.somaDepois)}` +
        (r.agregadoTe === null
          ? ""
          : `  (agregado ${fmt(r.agregadoTe)}; ${
              r.somaDepois === r.agregadoTe
                ? "FECHA exato"
                : `Δ ${mais(r.somaDepois - r.agregadoTe)}`
            })`),
    );
  }

  // 4b — controle por município nas UFs recalculadas
  if (cli.recalcularPesosUf.length > 0) {
    log("\n=== 4b. Controle por município nas UFs recalculadas (Σ 2024 → Σ 2026) ===");
    log("  (um município não muda de tamanho de um ano para outro: salto grande = olhar de perto)");
    for (const uf of cli.recalcularPesosUf) {
      const somaMun = (ps: Peso[]): Map<number, { soma: number; n: number }> => {
        const m = new Map<number, { soma: number; n: number }>();
        for (const p of ps.filter((x) => x.uf === uf)) {
          const a = m.get(p.codMunicipioTse) ?? { soma: 0, n: 0 };
          m.set(p.codMunicipioTse, { soma: a.soma + p.eleitoresAptos, n: a.n + 1 });
        }
        return m;
      };
      const antesM = somaMun(base.pesos);
      const depoisM = somaMun(depois.pesos);
      for (const mun of [...new Set([...antesM.keys(), ...depoisM.keys()])].sort((a, b) => a - b)) {
        const a = antesM.get(mun);
        const dp = depoisM.get(mun);
        if (!a && !dp) continue;
        const va = a?.soma ?? 0;
        const vd = dp?.soma ?? 0;
        log(
          `  ${uf} ${String(mun).padStart(5, "0")} ${(nomeMun.get(`${uf}|${mun}`) ?? "?").padEnd(22)} ` +
            `${fmt(va).padStart(9)} → ${fmt(vd).padStart(9)} (${pct(va > 0 ? ((vd - va) / va) * 100 : null)}) ` +
            `[${a?.n ?? 0} → ${dp?.n ?? 0} par(es)]`,
        );
      }
    }
  }

  // 5 — pesos existentes × te 2026, só UFs afetadas e NÃO recalculadas
  const ufsAfetadas = new Set(plano.resolvidos.map((r) => r.uf));
  const recalc = new Set(cli.recalcularPesosUf);
  const desvios = desviosDePeso(
    base.pesos.filter((p) => ufsAfetadas.has(p.uf) && !recalc.has(p.uf)),
    ctx.teZonaSnapshots,
  );
  log(
    "\n=== 5. Pesos JÁ existentes que divergem do te 2026 (>10% e >1.000; UFs afetadas, fora do recálculo) ===",
  );
  if (cli.soEstrutural)
    log("  (não se aplica ao modo estrutural: o te do simulado não é critério)");
  else if (desvios.length === 0) log("  (nenhum)");
  for (const dv of desvios.slice(0, 20)) {
    log(
      `  ${rotuloDoPar(dv.par)}: peso=${fmt(dv.pesoAtual)} · te 2026=${fmt(dv.te2026)} · ` +
        `diferença=${dv.diferenca > 0 ? "+" : ""}${fmt(dv.diferenca)}`,
    );
  }
  if (desvios.length > 20) log(`  … e mais ${desvios.length - 20}`);
  if (!cli.soEstrutural) {
    log(
      "  (fora das UFs de --recalcular-pesos-uf este script NÃO altera essas linhas — ver cabeçalho de zonas-faltantes-nucleo.ts)",
    );
  }

  // 6 — bloqueios / avisos
  log("\n=== 6. Bloqueios e avisos ===");
  if (plano.bloqueios.length === 0) log("  bloqueios: nenhum — `--escrever` poderia gravar.");
  for (const b of plano.bloqueios) log(`  ⛔ BLOQUEIO: ${b}`);
  for (const a of plano.avisos) log(`  ⚠️  AVISO: ${a}`);

  // 7 — resumo nacional
  const somaN = (ps: Peso[]) => ps.reduce((a, p) => a + p.eleitoresAptos, 0);
  log("\n=== 7. Resumo nacional antes → depois ===");
  log(`  zonas (pares): ${fmt(base.zonas.length)} → ${fmt(depois.zonas.length)}`);
  log(`  eleitorado (linhas ano=${ANO}): ${fmt(base.pesos.length)} → ${fmt(depois.pesos.length)}`);
  log(`  Σ eleitores_aptos nacional: ${fmt(somaN(base.pesos))} → ${fmt(somaN(depois.pesos))}`);
  log(
    `  list-targets (cargo 1) esperado: Total de alvos = ${fmt(depois.zonas.length)} zonas + ${ALVOS_AGREGADOS} ` +
      `(27 UFs + 1 nacional) = ${fmt(depois.zonas.length + ALVOS_AGREGADOS)}  ` +
      `(antes: ${fmt(base.zonas.length)} + ${ALVOS_AGREGADOS} = ${fmt(base.zonas.length + ALVOS_AGREGADOS)})`,
  );

  // 8 — backup e desfazer
  const nBackup =
    ctx.linhas.pesosAtualizados.length +
    ctx.linhas.pesosRemovidos.length +
    ctx.linhas.zonasRemovidas.length;
  log("\n=== 8. Backup e SQL para desfazer ===");
  log(
    `  backup (só com --escrever, em build/${nomeDoBackup(new Date()).replace(/\d{8}T\d{6}Z/, "<timestamp>")}): ` +
      `${nBackup} linha(s) — eleitorado atualizadas ${ctx.linhas.pesosAtualizados.length}, ` +
      `eleitorado removidas ${ctx.linhas.pesosRemovidos.length}, zonas removidas ${ctx.linhas.zonasRemovidas.length}`,
  );
  if (ctx.desfazerSql.length === 0) log("  (nada a desfazer)");
  else {
    log("  SQL que devolve o banco ao estado de antes (gerado das linhas lidas agora):");
    for (const s of ctx.desfazerSql) log(s.replace(/^/gm, "    "));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução (uma transação; leitura sempre, escrita só com --escrever)
// ─────────────────────────────────────────────────────────────────────────────

/** Uma instrução de escrita do plano, com os parâmetros exatos que vão ao banco. */
export interface Escrita {
  nome: string;
  sql: string;
  params: unknown[];
  /** Quantas linhas a instrução mira (tamanho dos arrays de parâmetros). */
  linhas: number;
  /** Linhas que o `RETURNING` deve devolver (DELETE/UPDATE); `null` = INSERT, conferido pelo estado final. */
  previstoLinhas: number | null;
}

/** INSERT de linhas novas em `eleitorado` (ano=2026, comparecimento NULL). */
function escritaInsertPesos(pesos: Peso[]): Escrita {
  return {
    nome: "INSERT em eleitorado",
    sql: SQL_INSERT_PESOS,
    params: [
      pesos.map(() => ANO),
      pesos.map((p) => p.uf),
      pesos.map((p) => p.codMunicipioTse),
      pesos.map((p) => p.codZona),
      pesos.map((p) => p.eleitoresAptos),
      pesos.map(() => null),
    ],
    linhas: pesos.length,
    previstoLinhas: null,
  };
}

/** UPDATE de `eleitores_aptos`, guardado pelo valor lido (`antigo`). */
function escritaUpdatePesos(atualizacoes: { par: Par; de: number; para: number }[]): Escrita {
  return {
    nome: "UPDATE em eleitorado",
    sql: SQL_UPDATE_PESOS,
    params: [
      ANO,
      atualizacoes.map((a) => a.par.uf),
      atualizacoes.map((a) => a.par.codMunicipioTse),
      atualizacoes.map((a) => a.par.codZona),
      atualizacoes.map((a) => a.de),
      atualizacoes.map((a) => a.para),
    ],
    linhas: atualizacoes.length,
    previstoLinhas: atualizacoes.length,
  };
}

/** As escritas do modo `--pesos-oficiais`: INSERT dos pares sem peso → UPDATE dos diferentes. */
export function escritasPesosOficiais(plano: PlanoOficial): Escrita[] {
  const out: Escrita[] = [];
  if (plano.insercoes.length > 0) out.push(escritaInsertPesos(plano.insercoes));
  if (plano.atualizacoes.length > 0) out.push(escritaUpdatePesos(plano.atualizacoes));
  return out;
}

/**
 * As escritas do plano, NA ORDEM em que rodam: DELETE de pesos → DELETE de zonas →
 * INSERT em zonas → INSERT em eleitorado → UPDATE de pesos. A escrita real e o
 * pré-voo da simulação usam esta MESMA lista — o que se planeja é o que se grava.
 */
export function escritasDoPlano(plano: Plano): Escrita[] {
  const f = plano.fantasmas;
  const out: Escrita[] = [];
  if (f.remocoesPesos.length > 0) {
    out.push({
      nome: "DELETE em eleitorado",
      sql: SQL_DELETE_PESOS,
      params: [
        ANO,
        f.remocoesPesos.map((p) => p.uf),
        f.remocoesPesos.map((p) => p.codMunicipioTse),
        f.remocoesPesos.map((p) => p.codZona),
      ],
      linhas: f.remocoesPesos.length,
      previstoLinhas: f.remocoesPesos.length,
    });
  }
  if (f.remocoesZonas.length > 0) {
    out.push({
      nome: "DELETE em zonas",
      sql: SQL_DELETE_ZONAS,
      params: [
        f.remocoesZonas.map((p) => p.uf),
        f.remocoesZonas.map((p) => p.codMunicipioTse),
        f.remocoesZonas.map((p) => p.codZona),
      ],
      linhas: f.remocoesZonas.length,
      previstoLinhas: f.remocoesZonas.length,
    });
  }
  if (plano.insercoesZonas.length > 0) {
    out.push({
      nome: "INSERT em zonas",
      sql: SQL_INSERT_ZONAS,
      params: [
        plano.insercoesZonas.map((z) => z.uf),
        plano.insercoesZonas.map((z) => z.codMunicipioTse),
        plano.insercoesZonas.map((z) => z.codZona),
        plano.insercoesZonas.map(() => null),
        plano.insercoesZonas.map((z) => z.fonte),
      ],
      linhas: plano.insercoesZonas.length,
      previstoLinhas: null,
    });
  }
  if (plano.insercoesPesos.length > 0) {
    out.push(escritaInsertPesos(plano.insercoesPesos.map((p) => ({ ...p, eleitoresAptos: p.te }))));
  }
  if (plano.atualizacoesPesos.length > 0) out.push(escritaUpdatePesos(plano.atualizacoesPesos));
  return out;
}

/**
 * Só na SIMULAÇÃO: pede ao servidor que PLANEJE cada SQL de escrita (`EXPLAIN` sem
 * `ANALYZE` — não executa nada e é permitido na transação READ ONLY). Prova que os
 * comandos compilam contra o esquema REAL (colunas, tipos, casts) antes do
 * `--escrever`. Não prova FK nem conflito de chave (isso só a execução mostra, e o
 * ROLLBACK cobre). Devolve o nome da instrução que falhou, ou `null`.
 */
async function preVoo(
  c: Consulta,
  escritas: Escrita[],
  log: (s: string) => void,
): Promise<string | null> {
  log("\n=== 9. Pré-voo do SQL de escrita (EXPLAIN: o servidor planeja, não executa) ===");
  if (escritas.length === 0) {
    log("  (o plano não tem nenhuma escrita)");
    return null;
  }
  for (const [i, w] of escritas.entries()) {
    try {
      await c.query(`EXPLAIN ${w.sql}`, w.params);
      log(`  ✓ ${w.nome} — planejado pelo servidor (${w.linhas} linha(s))`);
    } catch (err) {
      log(`  ⛔ ${w.nome} — ${err instanceof Error ? err.message : String(err)}`);
      // a transação aborta no primeiro erro: as demais não podem ser testadas
      if (i < escritas.length - 1) log("  (as instruções seguintes não foram testadas)");
      return w.nome;
    }
  }
  return null;
}

export class BloqueadoError extends Error {}

export interface Resultado {
  plano: Plano;
  escreveu: boolean;
  /** Caminho do backup gravado (só quando houve UPDATE/DELETE e `--escrever`). */
  backup: string | null;
}

export interface Entradas {
  ea12Raw: unknown;
  arquivosZona: Map<string, ArquivoZona>;
  /** Testes injetam um gravador falso; o padrão escreve em `build/`. */
  salvarBackup?: SalvarBackup;
}

export async function executar(
  client: Consulta,
  cli: Cli,
  entradas: Entradas,
  log: (s: string) => void = console.log,
): Promise<Resultado> {
  const { pares: ea12, meta } = lerParesDoEa12(entradas.ea12Raw);

  // Simulação: transação READ ONLY que o servidor faz cumprir. Escrita: transação comum.
  await client.query(cli.escrever ? "BEGIN" : "BEGIN TRANSACTION READ ONLY");
  try {
    await client.query(SQL_TIMEOUT_STATEMENT);
    if (cli.escrever) await client.query(SQL_TIMEOUT_LOCK);
    const base = await lerBase(client, cli.eleicao, !cli.soEstrutural);

    // te dos demais pares oficiais das UFs afetadas/recalculadas + FK de municípios
    const faltantes = faltantesNoEscopo(ea12, base.zonas, cli);
    const kFalt = new Set(faltantes.map(chaveDoPar));
    // modo estrutural: nenhum te é lido (o peso não é assunto dele)
    const ufsParaTe = new Set(
      cli.soEstrutural ? [] : [...faltantes.map((p) => p.uf), ...cli.recalcularPesosUf],
    );
    const demais = ea12.filter((p) => ufsParaTe.has(p.uf) && !kFalt.has(chaveDoPar(p)));
    const teZonaSnapshots = await lerTeDasZonas(client, demais, cli.eleicao);
    const munRows =
      faltantes.length === 0
        ? []
        : await selecionar(client, SQL_MUNICIPIOS, [
            [...new Set(faltantes.map((p) => p.codMunicipioTse))],
          ]);
    const municipiosExistentes = new Set(munRows.map((r) => num(r.cod_municipio_tse)));

    // arquivos de zona: só valem para pares sem te em snapshot (o resto é aviso)
    const kAlvos = new Set(alvosDeTe(ea12, base.zonas, cli, teZonaSnapshots).map(chaveDoPar));
    const teArquivos = new Map<string, number>();
    const avisosArquivos: string[] = [];
    for (const [k, a] of entradas.arquivosZona) {
      if (kAlvos.has(k)) teArquivos.set(k, a.te);
      else avisosArquivos.push(`arquivo ${a.arquivo} ignorado: o par não está entre os faltantes.`);
    }

    // fantasmas: zero snapshots em qualquer cargo é condição da remoção
    const snapshotsPorPar = cli.removerFantasmas
      ? await lerSnapshotsDosFantasmas(client, ea12, base, cli.ufs)
      : new Map<string, number>();

    const plano = planejar({
      ea12,
      zonas: base.zonas,
      pesos: base.pesos,
      agregadoPorUf: base.agregadoPorUf,
      teZonaSnapshots,
      teArquivos,
      municipiosExistentes,
      snapshotsPorPar,
      ea12Simulado: meta.f === "s",
      opcoes: cli,
    });
    plano.avisos.push(...avisosArquivos);

    // linhas completas do que vai ser atualizado/removido: backup + SQL de desfazer
    const linhas = await lerLinhasCompletas(client, plano);
    const desfazerSql = desfazerDoPlano(plano, linhas);

    imprimirRelatorio(log, {
      cli,
      meta,
      ea12,
      base,
      plano,
      teZonaSnapshots,
      arquivos: entradas.arquivosZona,
      snapshotsPorPar,
      linhas,
      desfazerSql,
    });

    if (!cli.escrever) {
      // Pré-voo: o servidor PLANEJA (EXPLAIN, sem executar) cada SQL de escrita do plano.
      const falhou = await preVoo(client, escritasDoPlano(plano), log);
      await client.query("ROLLBACK");
      if (falhou) {
        throw new ValidacaoError(
          `pré-voo do SQL de escrita FALHOU (${falhou}) — o --escrever também falharia; nada foi escrito.`,
        );
      }
      log(
        "\n[modo simulação — nada foi escrito. Rode com --escrever (e DATABASE_URL) para gravar; " +
          "bloqueios acima, se houver, impedem a escrita.]",
      );
      return { plano, escreveu: false, backup: null };
    }

    if (plano.bloqueios.length > 0) {
      throw new BloqueadoError(
        `${plano.bloqueios.length} bloqueio(s) — nada foi escrito:\n  - ${plano.bloqueios.join("\n  - ")}`,
      );
    }
    const f = plano.fantasmas;
    if (
      plano.insercoesZonas.length === 0 &&
      plano.insercoesPesos.length === 0 &&
      plano.atualizacoesPesos.length === 0 &&
      f.remocoesZonas.length === 0 &&
      f.remocoesPesos.length === 0
    ) {
      await client.query("ROLLBACK");
      log(
        "\n[escrever] nada a inserir, atualizar nem remover — o banco já está como o plano quer.",
      );
      return { plano, escreveu: false, backup: null };
    }

    // Backup ANTES da primeira escrita (só quando há linha que UPDATE/DELETE vai perder)
    let backup: string | null = null;
    if (
      linhas.pesosAtualizados.length + linhas.pesosRemovidos.length + linhas.zonasRemovidas.length >
      0
    ) {
      backup = await (entradas.salvarBackup ?? salvarBackupEmDisco)(
        montarBackup(cli, plano, linhas, desfazerSql),
      );
      log(`\n[escrever] backup gravado ANTES da escrita: ${backup}`);
    }

    // ── escrita ─────────────────────────────────────────────────────────────
    const antes: Estado = { zonas: base.zonas, pesos: base.pesos };
    for (const w of escritasDoPlano(plano)) {
      if (w.previstoLinhas === null) {
        await client.query(w.sql, w.params);
        continue;
      }
      const rows = await selecionar(client, w.sql, w.params);
      if (rows.length !== w.previstoLinhas) {
        throw new ValidacaoError(
          `${w.nome} afetou ${rows.length} linha(s); previsto ${w.previstoLinhas} — revertendo.`,
        );
      }
    }

    // ── conferência DENTRO da transação: o que o plano previu é o que está no banco ──
    const esperado = estadoFinal(antes, plano);
    const ufsTocadas = new Set([
      ...plano.insercoesZonas.map((z) => z.uf),
      ...plano.insercoesPesos.map((p) => p.uf),
      ...plano.atualizacoesPesos.map((a) => a.par.uf),
      ...f.remocoesZonas.map((z) => z.uf),
      ...f.remocoesPesos.map((p) => p.uf),
    ]);
    const recalc = new Set(cli.recalcularPesosUf);
    for (const uf of [...ufsTocadas].sort()) {
      const pesosUf = esperado.pesos.filter((p) => p.uf === uf);
      const previstoZonas = esperado.zonas.filter((z) => z.uf === uf).length;
      const previstoSoma = pesosUf.reduce((a, p) => a + p.eleitoresAptos, 0);
      const nZonas = num((await selecionar(client, SQL_CONTA_ZONAS_UF, [uf]))[0]?.n);
      if (nZonas !== previstoZonas) {
        throw new ValidacaoError(
          `${uf}: count(zonas) após a escrita = ${nZonas}, previsto ${previstoZonas} — revertendo.`,
        );
      }
      const linhaSoma = (await selecionar(client, SQL_SOMA_UF, [ANO, uf]))[0];
      const soma = num(linhaSoma?.soma);
      if (soma !== previstoSoma) {
        throw new ValidacaoError(
          `${uf}: Σ eleitorado após a escrita = ${fmt(soma)}, previsto ${fmt(previstoSoma)} — revertendo.`,
        );
      }
      const nPesos = num(linhaSoma?.n);
      if (nPesos !== pesosUf.length) {
        throw new ValidacaoError(
          `${uf}: count(eleitorado) após a escrita = ${nPesos}, previsto ${pesosUf.length} — revertendo.`,
        );
      }
      const agregado = base.agregadoPorUf.get(uf);
      if (recalc.has(uf) && agregado !== undefined && soma !== agregado) {
        throw new ValidacaoError(
          `${uf}: Σ eleitorado após o recálculo = ${fmt(soma)} ≠ agregado ${fmt(agregado)} — revertendo.`,
        );
      }
    }
    const dif = diferencasDeEstado(esperado, await lerEstado(client));
    if (dif.length > 0) {
      throw new ValidacaoError(
        `zonas/eleitorado depois da escrita ≠ estado esperado — revertendo:\n  - ${dif.join("\n  - ")}`,
      );
    }

    await client.query("COMMIT");
    log(
      `\n[escrever] COMMIT — zonas: +${plano.insercoesZonas.length} −${f.remocoesZonas.length}; ` +
        `eleitorado: +${plano.insercoesPesos.length} ~${plano.atualizacoesPesos.length} −${f.remocoesPesos.length}.`,
    );
    log(
      `[escrever] conferido dentro da transação: contagens e Σ por UF tocada` +
        `${recalc.size > 0 ? `, ${[...recalc].join(",")} == agregado exato` : ""}, e zonas/eleitorado inteiros == estado esperado.`,
    );
    if (backup) log(`[escrever] para desfazer: "desfazerSql" em ${backup}`);
    return { plano, escreveu: true, backup };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Modo --pesos-oficiais (pesos de `eleitorado` a partir do arquivo oficial do TSE)
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradasOficiais {
  oficial: ContagemOficial;
  /** Caminho do arquivo lido — só para o relatório. */
  arquivo?: string;
  /** Testes injetam um gravador falso; o padrão escreve em `build/`. */
  salvarBackup?: SalvarBackup;
}

export interface ResultadoOficial {
  plano: PlanoOficial;
  escreveu: boolean;
  backup: string | null;
}

function imprimirRelatorioOficial(
  log: (s: string) => void,
  ctx: {
    cli: Cli;
    entradas: EntradasOficiais;
    antes: Estado;
    depois: Estado;
    anos: { ano: number; n: number }[];
    plano: PlanoOficial;
    linhas: LinhaPeso[];
    desfazerSql: string[];
  },
): void {
  const { cli, entradas, antes, depois, plano } = ctx;
  const o = entradas.oficial;
  log(`[pesos-oficiais] arquivo: ${entradas.arquivo ?? "(injetado)"}`);
  log(
    `[pesos-oficiais] ${fmt(o.linhasLidas)} linhas lidas · ${fmt(o.linhasDasUfs)} das UFs ` +
      `${plano.ufs.join(",")} · ${fmt(o.linhasExterior)} do exterior (ZZ) ignoradas · ` +
      `${fmt(o.porPar.size)} pares (UF, município, zona) somados`,
  );
  log(
    `[pesos-oficiais] colunas: UF=${cli.colunas.uf} · município=${cli.colunas.municipio} · ` +
      `zona=${cli.colunas.zona} · quantidade=${cli.colunas.qt}`,
  );
  log(
    `[pesos-oficiais] banco: ${fmt(antes.zonas.length)} pares em zonas · ${fmt(antes.pesos.length)} pesos ` +
      `em eleitorado (ano=${ANO}) · por ano: ${ctx.anos.map((a) => `${a.ano}=${fmt(a.n)}`).join(" · ")}`,
  );

  log("\n=== 1. Totais por UF: arquivo oficial × pesos no banco ===");
  for (const v of plano.verificacoes) {
    const contraArquivo =
      v.somaDepois === v.totalArquivo
        ? "FECHA com o arquivo"
        : `Δ ${mais(v.somaDepois - v.totalArquivo)}`;
    const contraPublicado =
      v.publicado === null
        ? ""
        : ` · arquivo × publicado: ${v.totalArquivo === v.publicado ? "IGUAL" : `Δ ${mais(v.totalArquivo - v.publicado)}`}`;
    log(
      `  ${v.uf}: ${v.pares} pares em zonas · total do arquivo=${fmt(v.totalArquivo)} · ` +
        `publicado=${v.publicado === null ? "(não informado)" : fmt(v.publicado)} · ` +
        `Σ pesos antes=${fmt(v.somaAntes)} (${pct(v.totalArquivo > 0 ? ((v.somaAntes - v.totalArquivo) / v.totalArquivo) * 100 : null)} do arquivo) · ` +
        `Σ depois=${fmt(v.somaDepois)} → ${contraArquivo}${contraPublicado}`,
    );
  }

  log("\n=== 2. Linhas que seriam INSERIDAS em eleitorado (par em zonas sem peso) ===");
  if (plano.insercoes.length === 0) log("  (nenhuma)");
  for (const p of plano.insercoes) {
    log(`    (${ANO}, '${p.uf}', ${p.codMunicipioTse}, ${p.codZona}, ${p.eleitoresAptos}, NULL)`);
  }

  log("\n=== 3. Linhas que seriam ATUALIZADAS (eleitorado.eleitores_aptos: antigo → novo) ===");
  if (plano.atualizacoes.length === 0) log("  (nenhuma)");
  for (const a of plano.atualizacoes) {
    log(`  ${rotuloDoPar(a.par)}: ${fmt(a.de)} → ${fmt(a.para)} (${mais(a.para - a.de)})`);
  }
  log(
    `  (${plano.atualizacoes.length} alterada(s); ${plano.inalterados} par(es) já estavam com a contagem oficial)`,
  );

  // controle por município: só o que mexe de verdade (≥ 5 % ou ≥ 2.000 eleitores)
  log("\n=== 4. Controle por município (Σ antes → Σ oficial), só variações ≥ 5% ou ≥ 2.000 ===");
  for (const uf of plano.ufs) {
    const porMun = (ps: Peso[]): Map<number, number> => {
      const m = new Map<number, number>();
      for (const p of ps.filter((x) => x.uf === uf)) {
        m.set(p.codMunicipioTse, (m.get(p.codMunicipioTse) ?? 0) + p.eleitoresAptos);
      }
      return m;
    };
    const a = porMun(antes.pesos);
    const d = porMun(depois.pesos);
    let omitidos = 0;
    for (const mun of [...new Set([...a.keys(), ...d.keys()])].sort((x, y) => x - y)) {
      const va = a.get(mun) ?? 0;
      const vd = d.get(mun) ?? 0;
      const varPct = va > 0 ? ((vd - va) / va) * 100 : null;
      if (va > 0 && Math.abs(vd - va) < 2000 && varPct !== null && Math.abs(varPct) < 5) {
        omitidos++;
        continue;
      }
      log(
        `  ${uf} ${String(mun).padStart(5, "0")} ${fmt(va).padStart(10)} → ${fmt(vd).padStart(10)} (${pct(varPct)})`,
      );
    }
    log(`  ${uf}: ${omitidos} município(s) com variação pequena omitidos`);
  }

  log("\n=== 5. Conferências do arquivo contra `zonas` ===");
  log(
    `  pares em zonas SEM contagem oficial: ${plano.semOficial.length}${
      plano.semOficial.length ? ` → ${plano.semOficial.map(rotuloDoPar).join(", ")}` : ""
    }`,
  );
  log(
    `  pares do arquivo FORA de zonas: ${plano.foraDeZonas.length}${
      plano.foraDeZonas.length
        ? ` → ${plano.foraDeZonas.map((p) => `${rotuloDoPar(p)} (${fmt(p.qt)})`).join(", ")}`
        : ""
    }`,
  );
  log(
    `  linhas de peso de par fora de zonas: ${plano.orfaos.length}${
      plano.orfaos.length ? ` → ${plano.orfaos.map(rotuloDoPar).join(", ")}` : ""
    }`,
  );

  log("\n=== 6. Bloqueios e avisos ===");
  if (plano.bloqueios.length === 0) log("  bloqueios: nenhum — `--escrever` poderia gravar.");
  for (const b of plano.bloqueios) log(`  ⛔ BLOQUEIO: ${b}`);
  for (const a of plano.avisos) log(`  ⚠️  AVISO: ${a}`);

  log("\n=== 7. Resumo antes → depois ===");
  log(`  eleitorado (linhas ano=${ANO}): ${fmt(antes.pesos.length)} → ${fmt(depois.pesos.length)}`);
  log(
    `  zonas (pares): ${fmt(antes.zonas.length)} → ${fmt(depois.zonas.length)} (este modo não toca zonas)`,
  );

  log("\n=== 8. Backup e SQL para desfazer ===");
  log(
    `  backup (só com --escrever, em build/${nomeDoBackup(new Date()).replace(/\d{8}T\d{6}Z/, "<timestamp>")}): ` +
      `${ctx.linhas.length} linha(s) de eleitorado atualizadas (estado de antes)`,
  );
  if (ctx.desfazerSql.length === 0) log("  (nada a desfazer)");
  else {
    log("  SQL que devolve o banco ao estado de antes (gerado das linhas lidas agora):");
    for (const s of ctx.desfazerSql) log(s.replace(/^/gm, "    "));
  }
}

export async function executarPesosOficiais(
  client: Consulta,
  cli: Cli,
  entradas: EntradasOficiais,
  log: (s: string) => void = console.log,
): Promise<ResultadoOficial> {
  await client.query(cli.escrever ? "BEGIN" : "BEGIN TRANSACTION READ ONLY");
  try {
    await client.query(SQL_TIMEOUT_STATEMENT);
    if (cli.escrever) await client.query(SQL_TIMEOUT_LOCK);
    const antes = await lerEstado(client);
    const anos = (await selecionar(client, SQL_ANOS_ELEITORADO)).map((r) => ({
      ano: num(r.ano),
      n: num(r.n),
    }));
    const plano = planejarPesosOficiais({
      ufs: cli.ufs,
      zonas: antes.zonas,
      pesos: antes.pesos,
      oficial: entradas.oficial,
      totaisPublicados: cli.totalUf,
    });
    const linhas = await lerLinhasPesos(
      client,
      plano.atualizacoes.map((a) => a.par),
      "eleitorado a atualizar",
    );
    const chave = ({ uf, codMunicipioTse, codZona }: Par): Par => ({
      uf,
      codMunicipioTse,
      codZona,
    });
    const insercoesDoPlano: InsercoesDoPlano = {
      insercoesZonas: [],
      insercoesPesos: plano.insercoes.map(chave),
    };
    const linhasDoBackup: LinhasCompletas = {
      pesosAtualizados: linhas,
      pesosRemovidos: [],
      zonasRemovidas: [],
    };
    const desfazerSql = desfazerDoPlano(insercoesDoPlano, linhasDoBackup);
    const depois = estadoFinalOficial(antes, plano);

    imprimirRelatorioOficial(log, {
      cli,
      entradas,
      antes,
      depois,
      anos,
      plano,
      linhas,
      desfazerSql,
    });

    const escritas = escritasPesosOficiais(plano);
    if (!cli.escrever) {
      const falhou = await preVoo(client, escritas, log);
      await client.query("ROLLBACK");
      if (falhou) {
        throw new ValidacaoError(
          `pré-voo do SQL de escrita FALHOU (${falhou}) — o --escrever também falharia; nada foi escrito.`,
        );
      }
      log(
        "\n[modo simulação — nada foi escrito. Rode com --escrever (e DATABASE_URL) para gravar; " +
          "bloqueios acima, se houver, impedem a escrita.]",
      );
      return { plano, escreveu: false, backup: null };
    }

    if (plano.bloqueios.length > 0) {
      throw new BloqueadoError(
        `${plano.bloqueios.length} bloqueio(s) — nada foi escrito:\n  - ${plano.bloqueios.join("\n  - ")}`,
      );
    }
    if (escritas.length === 0) {
      await client.query("ROLLBACK");
      log("\n[escrever] nada a inserir nem atualizar — os pesos já são os do arquivo oficial.");
      return { plano, escreveu: false, backup: null };
    }

    // Backup ANTES da primeira escrita (só quando há linha que o UPDATE vai perder)
    let backup: string | null = null;
    if (linhas.length > 0) {
      backup = await (entradas.salvarBackup ?? salvarBackupEmDisco)(
        montarBackup(cli, insercoesDoPlano, linhasDoBackup, desfazerSql),
      );
      log(`\n[escrever] backup gravado ANTES da escrita: ${backup}`);
    }

    for (const w of escritas) {
      if (w.previstoLinhas === null) {
        await client.query(w.sql, w.params);
        continue;
      }
      const rows = await selecionar(client, w.sql, w.params);
      if (rows.length !== w.previstoLinhas) {
        throw new ValidacaoError(
          `${w.nome} afetou ${rows.length} linha(s); previsto ${w.previstoLinhas} — revertendo.`,
        );
      }
    }

    // conferência DENTRO da transação: o que o plano previu é o que está no banco
    for (const v of plano.verificacoes) {
      const pesosUf = depois.pesos.filter((p) => p.uf === v.uf);
      const previstoZonas = depois.zonas.filter((z) => z.uf === v.uf).length;
      const nZonas = num((await selecionar(client, SQL_CONTA_ZONAS_UF, [v.uf]))[0]?.n);
      if (nZonas !== previstoZonas) {
        throw new ValidacaoError(
          `${v.uf}: count(zonas) após a escrita = ${nZonas}, previsto ${previstoZonas} — revertendo.`,
        );
      }
      const linhaSoma = (await selecionar(client, SQL_SOMA_UF, [ANO, v.uf]))[0];
      const soma = num(linhaSoma?.soma);
      if (soma !== v.totalArquivo) {
        throw new ValidacaoError(
          `${v.uf}: Σ eleitorado após a escrita = ${fmt(soma)}, esperado ${fmt(v.totalArquivo)} (o total do arquivo oficial) — revertendo.`,
        );
      }
      const nPesos = num(linhaSoma?.n);
      if (nPesos !== pesosUf.length) {
        throw new ValidacaoError(
          `${v.uf}: count(eleitorado) após a escrita = ${nPesos}, previsto ${pesosUf.length} — revertendo.`,
        );
      }
    }
    const dif = diferencasDeEstado(depois, await lerEstado(client));
    if (dif.length > 0) {
      throw new ValidacaoError(
        `zonas/eleitorado depois da escrita ≠ estado esperado — revertendo:\n  - ${dif.join("\n  - ")}`,
      );
    }

    await client.query("COMMIT");
    log(
      `\n[escrever] COMMIT — eleitorado: +${plano.insercoes.length} ~${plano.atualizacoes.length}; zonas intocada.`,
    );
    log(
      `[escrever] conferido dentro da transação: contagens e Σ de ${plano.ufs.join(",")} == total do arquivo oficial, e zonas/eleitorado inteiros == estado esperado.`,
    );
    if (backup) log(`[escrever] para desfazer: "desfazerSql" em ${backup}`);
    return { plano, escreveu: true, backup };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main (só quando executado como script — importar este arquivo não faz nada)
// ─────────────────────────────────────────────────────────────────────────────

async function mainPesosOficiais(cli: Cli): Promise<void> {
  const arquivo = resolve(cli.pesosOficiais as string);
  console.log(`[pesos-oficiais] lendo ${arquivo} (UFs: ${cli.ufs.join(",")}) — sem rede`);
  console.log(
    `[pesos-oficiais] modo: ${cli.escrever ? "ESCRITA (--escrever)" : "SIMULAÇÃO (só leitura)"}`,
  );
  const oficial = await lerPerfilOficial(arquivo, cli.ufs, cli.colunas);
  const { getPool } = await import("./_tse-common.ts");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await executarPesosOficiais(client, cli, { oficial, arquivo });
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (!process.env.DATABASE_URL_UNPOOLED && !process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL (ou DATABASE_URL_UNPOOLED) ausente — mesmo a simulação lê o banco (SELECT, " +
        "READ ONLY). Rode dentro de `( set -a; . ./.env.local; set +a; pnpm db:zonas:faltantes )`.",
    );
  }
  if (cli.pesosOficiais !== null) return mainPesosOficiais(cli);
  const ea12Path = cli.ea12 ? resolve(cli.ea12) : EA12_PADRAO;
  const zonasDir = cli.zonasDir ? resolve(cli.zonasDir) : ZONAS_DIR_PADRAO;
  console.log(`[zonas-faltantes] EA12: ${ea12Path}`);
  console.log(`[zonas-faltantes] arquivos de zona: ${zonasDir}`);
  console.log(
    `[zonas-faltantes] modo: ${cli.escrever ? "ESCRITA (--escrever)" : "SIMULAÇÃO (só leitura)"}`,
  );
  const ea12Raw = JSON.parse(await readFile(ea12Path, "utf8"));
  const arquivosZona = await lerArquivosDeZona(zonasDir, cli.eleicao, cli.zonasDir === null);

  const { getPool } = await import("./_tse-common.ts");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await executar(client, cli, { ea12Raw, arquivosZona });
  } finally {
    client.release();
    await pool.end();
  }
}

function executadoComoScript(): boolean {
  const entrada = process.argv[1];
  if (!entrada) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entrada)).href;
  } catch {
    return false;
  }
}

if (executadoComoScript()) {
  main().catch((err) => {
    console.error("Falha em zonas-faltantes-import:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
