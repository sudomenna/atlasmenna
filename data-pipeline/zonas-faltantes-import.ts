// data-pipeline/zonas-faltantes-import.ts
//
// Insere em `zonas` e `eleitorado` os pares (município × zona) que o EA12 do TSE
// lista e o banco NÃO tem. Molde: `eleitorado-df-import.ts` (27/09). A lógica
// pura — diff, resolução do `te`, verificação dos totais, plano — está em
// `zonas-faltantes-nucleo.ts` (leia o cabeçalho de lá: fontes do peso e o limite
// que a soma dos pesos revela). Aqui só há I/O e a costura.
//
// ─── Modo padrão = SIMULAÇÃO ────────────────────────────────────────────────
//
// Sem `--escrever` o script LÊ o banco (só `SELECT`, numa transação
// `READ ONLY` que o servidor faz cumprir) e imprime o diff nacional, o `te` de
// cada par faltante, as linhas que inseriria e a verificação dos totais. Não
// grava nada. A simulação PRECISA de `DATABASE_URL` (para saber o que já está em
// `zonas`), ao contrário do script do DF, que só lia fixtures.
//
// ─── `--escrever` ───────────────────────────────────────────────────────────
//
// Uma transação só: relê tudo, refaz o plano, ABORTA se houver qualquer
// bloqueio (ver `Plano.bloqueios`), insere SÓ os pares faltantes com
// `INSERT … ON CONFLICT DO NOTHING`, confere DENTRO da transação que
// `Σ eleitorado` e `count(zonas)` da UF ficaram como o plano previa, e só então
// faz COMMIT. Nunca faz UPDATE nem DELETE — linha existente que diverge do
// calculado é bloqueio, não correção.
//
// ─── Rede ───────────────────────────────────────────────────────────────────
//
// Nenhuma. O EA12 e os EA20 de zona vêm de arquivos locais (`--ea12`,
// `--zonas-dir`); quem os baixa é o operador, com os endereços que o próprio
// TSE documenta (constituição § 1: zero sondagem de URL adivinhada).
//
// ─── Uso ────────────────────────────────────────────────────────────────────
//
//   ( set -a; . ./.env.local; set +a; pnpm db:zonas:faltantes )
//   ( set -a; . ./.env.local; set +a; pnpm db:zonas:faltantes -- --escrever )
//
// Flags: --ea12 <caminho> · --zonas-dir <dir> · --eleicao <cod> · --uf AP,PE ·
//        --aceitar-te-derivado · --exigir-soma-exata · --escrever

import { realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ANO,
  CARGO_REF,
  type Cli,
  chaveDoPar,
  desviosDePeso,
  diffPares,
  extrairTeDeArquivoZona,
  fmt,
  lerParesDoEa12,
  type MetaEa12,
  type Par,
  type ParEa12,
  type Peso,
  type Plano,
  parseCli,
  parseNomeArquivoZona,
  planejar,
  rotuloDoPar,
  tabelaPorUf,
  ValidacaoError,
} from "./zonas-faltantes-nucleo.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const EA12_PADRAO = resolve(ROOT, "tests/fixtures/tse/2026-sim/mun-e021270-cm.json");
export const ZONAS_DIR_PADRAO = resolve(ROOT, "tests/fixtures/tse/2026-sim/zonas-faltantes");

// ─────────────────────────────────────────────────────────────────────────────
// SQL — todas as leituras são SELECT; as duas escritas são INSERT … DO NOTHING
// ─────────────────────────────────────────────────────────────────────────────

export const SQL_ZONAS = `SELECT uf, cod_municipio_tse, cod_zona FROM zonas ORDER BY 1, 2, 3`;

export const SQL_PESOS = `
  SELECT uf, cod_municipio_tse, cod_zona, eleitores_aptos
  FROM eleitorado WHERE ano = $1 ORDER BY 1, 2, 3`;

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

export const SQL_MUNICIPIOS = `
  SELECT cod_municipio_tse FROM municipios WHERE cod_municipio_tse = ANY($1::int4[])`;

export const SQL_INSERT_ZONAS = `
  INSERT INTO zonas (uf, cod_municipio_tse, cod_zona, nome, fonte)
  SELECT * FROM UNNEST($1::char(2)[], $2::int4[], $3::int4[], $4::text[], $5::text[])
  ON CONFLICT (uf, cod_municipio_tse, cod_zona) DO NOTHING`;

export const SQL_INSERT_PESOS = `
  INSERT INTO eleitorado
    (ano, uf, cod_municipio_tse, cod_zona, eleitores_aptos, comparecimento_pct_historico)
  SELECT * FROM UNNEST($1::int2[], $2::char(2)[], $3::int4[], $4::int4[], $5::int4[], $6::numeric[])
  ON CONFLICT (ano, uf, cod_municipio_tse, cod_zona) DO NOTHING`;

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

// ─────────────────────────────────────────────────────────────────────────────
// Leitura do banco (dentro da transação aberta por `executar`)
// ─────────────────────────────────────────────────────────────────────────────

interface EstadoDoBanco {
  zonas: Par[];
  pesos: Peso[];
  agregadoPorUf: Map<string, number>;
}

async function lerBase(c: Consulta, eleicao: string): Promise<EstadoDoBanco> {
  const zonas = (await selecionar(c, SQL_ZONAS)).map((r) => ({
    uf: String(r.uf),
    codMunicipioTse: num(r.cod_municipio_tse),
    codZona: num(r.cod_zona),
  }));
  const pesos = (await selecionar(c, SQL_PESOS, [ANO])).map((r) => ({
    uf: String(r.uf),
    codMunicipioTse: num(r.cod_municipio_tse),
    codZona: num(r.cod_zona),
    eleitoresAptos: num(r.eleitores_aptos),
  }));
  const agregadoPorUf = new Map<string, number>();
  for (const r of await selecionar(c, SQL_AGREGADOS, [CARGO_REF, eleicao])) {
    agregadoPorUf.set(String(r.uf), teDoTexto(r.te, `agregado ${String(r.uf)}`));
  }
  return { zonas, pesos, agregadoPorUf };
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
    const par = {
      uf: String(r.uf),
      codMunicipioTse: num(r.cod_municipio_tse),
      codZona: num(r.cod_zona),
    };
    out.set(chaveDoPar(par), teDoTexto(r.te, `zona ${rotuloDoPar(par)}`));
  }
  return out;
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
// Relatório
// ─────────────────────────────────────────────────────────────────────────────

const pct = (n: number | null): string =>
  n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2).replace(".", ",")}%`;

function imprimirRelatorio(
  log: (s: string) => void,
  ctx: {
    cli: Cli;
    meta: MetaEa12;
    ea12: ParEa12[];
    base: EstadoDoBanco;
    plano: Plano;
    teZonaSnapshots: Map<string, number>;
    arquivos: Map<string, ArquivoZona>;
  },
): void {
  const { cli, meta, ea12, base, plano } = ctx;
  log(
    `[zonas-faltantes] EA12 gerado em ${meta.dg} ${meta.hg} (idg=${meta.idg}, fase="${meta.f}") — ` +
      `${fmt(ea12.length)} pares (sem exterior)`,
  );
  log(
    `[zonas-faltantes] banco: ${fmt(base.zonas.length)} pares em zonas · ${fmt(base.pesos.length)} ` +
      `pesos em eleitorado (ano=${ANO}) · agregado de UF (eleição ${cli.eleicao}, cargo ${CARGO_REF}) ` +
      `em ${base.agregadoPorUf.size} UFs`,
  );

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
  log("  Σ pesos de eleitorado × te do agregado, TODAS as UFs (peso vem do CSV de 2024):");
  for (let i = 0; i < tabela.length; i += 7) {
    log(
      `    ${tabela
        .slice(i, i + 7)
        .map((l) => `${l.uf} ${pct(l.gapPct)}`)
        .join(" · ")}`,
    );
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
  log(`  zonas tem e o EA12 NÃO lista (${d.sobrandoEmZonas.length}) — só relatório:`);
  log(lista(d.sobrandoEmZonas));
  log(`  zonas sem peso em eleitorado (${d.zonasSemPeso.length}) — só relatório:`);
  log(lista(d.zonasSemPeso));
  log(
    `  peso em eleitorado de par que o EA12 não lista (${d.pesosForaDoEa12.length}) — só relatório:`,
  );
  log(
    d.pesosForaDoEa12.length === 0
      ? "    (nenhum)"
      : d.pesosForaDoEa12.map((p) => `    ${rotuloDoPar(p)}: ${fmt(p.eleitoresAptos)}`).join("\n"),
  );

  // 2 — te dos faltantes
  log("\n=== 2. te dos pares faltantes (peso a gravar) ===");
  if (plano.resolvidos.length === 0) log("  (nenhum resolvido)");
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

  // 3 — linhas
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

  // 4 — totais
  log("\n=== 4. Σ pesos de eleitorado × te do agregado do TSE, por UF afetada ===");
  if (plano.verificacoes.length === 0) log("  (nada a verificar)");
  for (const v of plano.verificacoes) {
    log(
      `  ${v.uf}: agregado=${fmt(v.agregadoTe)} · Σ antes=${fmt(v.somaPesosAntes)} ` +
        `(${v.gapAntes > 0 ? "+" : ""}${fmt(v.gapAntes)}) · Σ depois=${fmt(v.somaPesosDepois)} ` +
        `(${v.gapDepois > 0 ? "+" : ""}${fmt(v.gapDepois)}) → ${v.situacao}`,
    );
  }

  // 5 — pesos existentes × te 2026, só UFs afetadas
  const ufsAfetadas = new Set(plano.resolvidos.map((r) => r.uf));
  const desvios = desviosDePeso(
    base.pesos.filter((p) => ufsAfetadas.has(p.uf)),
    ctx.teZonaSnapshots,
  );
  log("\n=== 5. Pesos JÁ existentes que divergem do te 2026 (>10% e >1.000; UFs afetadas) ===");
  if (desvios.length === 0) log("  (nenhum)");
  for (const dv of desvios.slice(0, 20)) {
    log(
      `  ${rotuloDoPar(dv.par)}: peso=${fmt(dv.pesoAtual)} · te 2026=${fmt(dv.te2026)} · ` +
        `diferença=${dv.diferenca > 0 ? "+" : ""}${fmt(dv.diferenca)}`,
    );
  }
  if (desvios.length > 20) log(`  … e mais ${desvios.length - 20}`);
  log("  (este script NÃO altera essas linhas — ver cabeçalho de zonas-faltantes-nucleo.ts)");

  // 6 — bloqueios / avisos
  log("\n=== 6. Bloqueios e avisos ===");
  if (plano.bloqueios.length === 0) log("  bloqueios: nenhum — `--escrever` poderia gravar.");
  for (const b of plano.bloqueios) log(`  ⛔ BLOQUEIO: ${b}`);
  for (const a of plano.avisos) log(`  ⚠️  AVISO: ${a}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução (uma transação; leitura sempre, escrita só com --escrever)
// ─────────────────────────────────────────────────────────────────────────────

export class BloqueadoError extends Error {}

export interface Resultado {
  plano: Plano;
  escreveu: boolean;
}

export async function executar(
  client: Consulta,
  cli: Cli,
  entradas: { ea12Raw: unknown; arquivosZona: Map<string, ArquivoZona> },
  log: (s: string) => void = console.log,
): Promise<Resultado> {
  const { pares: ea12, meta } = lerParesDoEa12(entradas.ea12Raw);

  // Simulação: transação READ ONLY que o servidor faz cumprir. Escrita: transação comum.
  await client.query(cli.escrever ? "BEGIN" : "BEGIN TRANSACTION READ ONLY");
  try {
    const base = await lerBase(client, cli.eleicao);
    const preDiff = planejarLeve(ea12, base, cli);

    // te dos demais pares oficiais das UFs afetadas + FK de municípios
    const kFalt = new Set(preDiff.map(chaveDoPar));
    const ufsAfetadas = new Set(preDiff.map((p) => p.uf));
    const demais = ea12.filter((p) => ufsAfetadas.has(p.uf) && !kFalt.has(chaveDoPar(p)));
    const teZonaSnapshots = await lerTeDasZonas(client, demais, cli.eleicao);
    const munRows =
      preDiff.length === 0
        ? []
        : await selecionar(client, SQL_MUNICIPIOS, [
            [...new Set(preDiff.map((p) => p.codMunicipioTse))],
          ]);
    const municipiosExistentes = new Set(munRows.map((r) => num(r.cod_municipio_tse)));

    // arquivos de zona: só valem para pares faltantes (o resto é aviso)
    const teArquivos = new Map<string, number>();
    const avisosArquivos: string[] = [];
    for (const [k, a] of entradas.arquivosZona) {
      if (kFalt.has(k)) teArquivos.set(k, a.te);
      else avisosArquivos.push(`arquivo ${a.arquivo} ignorado: o par não está entre os faltantes.`);
    }

    const plano = planejar({
      ea12,
      zonas: base.zonas,
      pesos: base.pesos,
      agregadoPorUf: base.agregadoPorUf,
      teZonaSnapshots,
      teArquivos,
      municipiosExistentes,
      opcoes: cli,
    });
    plano.avisos.push(...avisosArquivos);

    imprimirRelatorio(log, {
      cli,
      meta,
      ea12,
      base,
      plano,
      teZonaSnapshots,
      arquivos: entradas.arquivosZona,
    });

    if (!cli.escrever) {
      await client.query("ROLLBACK");
      log(
        "\n[modo simulação — nada foi escrito. Rode com --escrever (e DATABASE_URL) para gravar; " +
          "bloqueios acima, se houver, impedem a escrita.]",
      );
      return { plano, escreveu: false };
    }

    if (plano.bloqueios.length > 0) {
      throw new BloqueadoError(
        `${plano.bloqueios.length} bloqueio(s) — nada foi escrito:\n  - ${plano.bloqueios.join("\n  - ")}`,
      );
    }
    if (plano.insercoesZonas.length === 0 && plano.insercoesPesos.length === 0) {
      await client.query("ROLLBACK");
      log("\n[escrever] nada a inserir — banco já tem todos os pares do EA12.");
      return { plano, escreveu: false };
    }

    const zonasAntesPorUf = new Map<string, number>();
    for (const uf of new Set(plano.insercoesZonas.map((z) => z.uf))) {
      zonasAntesPorUf.set(uf, base.zonas.filter((z) => z.uf === uf).length);
    }

    await client.query(SQL_INSERT_ZONAS, [
      plano.insercoesZonas.map((z) => z.uf),
      plano.insercoesZonas.map((z) => z.codMunicipioTse),
      plano.insercoesZonas.map((z) => z.codZona),
      plano.insercoesZonas.map(() => null),
      plano.insercoesZonas.map((z) => z.fonte),
    ]);
    if (plano.insercoesPesos.length > 0) {
      await client.query(SQL_INSERT_PESOS, [
        plano.insercoesPesos.map(() => ANO),
        plano.insercoesPesos.map((p) => p.uf),
        plano.insercoesPesos.map((p) => p.codMunicipioTse),
        plano.insercoesPesos.map((p) => p.codZona),
        plano.insercoesPesos.map((p) => p.te),
        plano.insercoesPesos.map(() => null),
      ]);
    }

    // Conferência DENTRO da transação: o que o plano previu é o que está no banco.
    for (const uf of zonasAntesPorUf.keys()) {
      const previstoZonas =
        zonasAntesPorUf.get(uf)! + plano.insercoesZonas.filter((z) => z.uf === uf).length;
      const nZonas = num((await selecionar(client, SQL_CONTA_ZONAS_UF, [uf]))[0]?.n);
      if (nZonas !== previstoZonas) {
        throw new ValidacaoError(
          `${uf}: count(zonas) após a inserção = ${nZonas}, previsto ${previstoZonas} — revertendo.`,
        );
      }
      const v = plano.verificacoes.find((x) => x.uf === uf);
      if (v) {
        const soma = num((await selecionar(client, SQL_SOMA_UF, [ANO, uf]))[0]?.soma);
        if (soma !== v.somaPesosDepois) {
          throw new ValidacaoError(
            `${uf}: Σ eleitorado após a inserção = ${fmt(soma)}, previsto ${fmt(v.somaPesosDepois)} — revertendo.`,
          );
        }
      }
    }

    await client.query("COMMIT");
    log(
      `\n[escrever] COMMIT — ${plano.insercoesZonas.length} linha(s) em zonas, ` +
        `${plano.insercoesPesos.length} em eleitorado.`,
    );
    return { plano, escreveu: true };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

/** EA12 ∖ zonas, respeitando --uf — só para saber quais UFs precisam de te/FK. */
function planejarLeve(ea12: ParEa12[], base: EstadoDoBanco, cli: Cli): ParEa12[] {
  const escopo = new Set(cli.ufs);
  return diffPares(ea12, base.zonas, base.pesos).faltandoEmZonas.filter(
    (p) => escopo.size === 0 || escopo.has(p.uf),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main (só quando executado como script — importar este arquivo não faz nada)
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (!process.env.DATABASE_URL_UNPOOLED && !process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL (ou DATABASE_URL_UNPOOLED) ausente — mesmo a simulação lê o banco (SELECT, " +
        "READ ONLY). Rode dentro de `( set -a; . ./.env.local; set +a; pnpm db:zonas:faltantes )`.",
    );
  }
  const ea12Path = cli.ea12 ? resolve(cli.ea12) : EA12_PADRAO;
  const zonasDir = cli.zonasDir ? resolve(cli.zonasDir) : ZONAS_DIR_PADRAO;
  console.log(`[zonas-faltantes] EA12: ${ea12Path}`);
  console.log(`[zonas-faltantes] arquivos de zona: ${zonasDir}`);
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
