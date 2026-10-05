/**
 * scripts/painel-retrato.ts — `pnpm painel:retrato`
 *
 * Gera o **retrato** do painel privado (`/painel`, ADR-0077): um JSON com tudo
 * o que o sistema fez numa noite de apuração — pedidos ao TSE, novidades,
 * erros, bloqueios, rodadas da projeção, buracos, arquivos parados, % apurado
 * do Presidente e as correções publicadas. A página lê só este arquivo.
 *
 *   pnpm painel:retrato --env-file <caminho/.env.local>              # grava build/painel/…
 *   pnpm painel:retrato --env-file <caminho/.env.local> --escrever   # + Blob PRIVADO
 *
 * Opções (todas opcionais):
 *   --de  2026-10-04T16:30:00-03:00     início da janela (BRT por padrão)
 *   --ate 2026-10-05T04:30:00-03:00     fim da janela
 *   --turno 1                           turno gravado nas linhas
 *   --git-ref origin/main               de onde ler as correções publicadas
 *   --correcoes-de / --correcoes-ate    janela das correções (padrão 04/10 16h → 05/10 12h)
 *   --parados-cargos 1,3,5,6,7,8        cargos verificados em "arquivos parados"
 *   --saida build/painel/retrato-1t-2026.json
 *   --guardar-insumos <arquivo.json>    guarda as linhas lidas do banco (sob build/)
 *   --de-insumos <arquivo.json>         remonta o retrato SEM tocar no banco
 *
 * `--guardar-insumos` / `--de-insumos` existem para não consultar produção a
 * cada ajuste de apresentação: lê-se o banco uma vez e remonta-se à vontade.
 * Os insumos não têm credencial nem dado pessoal — são contagens e metadados
 * de ciclo —, mas também ficam sob `build/`, fora do repositório.
 *
 * ## 🔴 Banco de PRODUÇÃO — só leitura, e por lista branca
 *
 * NÃO carregue o `.env.local` com `set -a`: este script lê o arquivo por
 * LISTA BRANCA (o molde de `scripts/_vigia-env.ts`) e guarda o valor numa
 * variável local — nada vai para `process.env`. A lista é só `DATABASE_URL`;
 * `BLOB_READ_WRITE_TOKEN` entra apenas com `--escrever`. Variável já definida
 * no ambiente vence o arquivo (CI, agendador).
 *
 * Toda consulta roda numa transação `READ ONLY` (`neon(url, { readOnly: true })`):
 * um `INSERT`/`UPDATE` aqui seria recusado pelo próprio Postgres. As consultas
 * nunca selecionam `snapshots.payload` inteiro — só `payload->'s'` de linhas já
 * escolhidas por id (a mesma lição do `8a977b8`: ranquear o id, buscar o
 * payload depois). E nunca usam `snapshots.pct_apurado` (é o `s.psa`).
 *
 * ## Saída
 *
 * Sem `--escrever`: só o arquivo local (sob `build/`, que o git ignora — o
 * repositório é PÚBLICO e o retrato não pode ser commitado).
 * Com `--escrever`: também `painel/retrato-1t-2026.json` no Vercel Blob com
 * `access: "private"`, sem sufixo aleatório, sobrescrevendo.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { put } from "@vercel/blob";

import { CARGOS } from "@/lib/config/cargos";
import {
  type AgregadoApurado,
  type CommitBruto,
  type LinhaIngestLog,
  montarRetrato,
  type NovidadesNoMinuto,
  type RodadaBruta,
  type UltimaVersao,
} from "@/lib/painel/agregar";
import {
  CARGOS_DO_PAINEL,
  type CargoDoPainel,
  PAINEL_ARQUIVO_LOCAL,
  PAINEL_BLOB_PATHNAME,
} from "@/lib/painel/tipos";
import { selecionarEnvDoVigia } from "./_vigia-env";

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

export interface ArgsRetrato {
  envFile: string;
  escrever: boolean;
  deMs: number;
  ateMs: number;
  turno: number;
  gitRef: string;
  correcoesDeMs: number;
  correcoesAteMs: number;
  paradosCargos: CargoDoPainel[];
  saida: string;
  guardarInsumos: string | null;
  deInsumos: string | null;
}

export const PADRAO = {
  de: "2026-10-04T16:30:00-03:00",
  ate: "2026-10-05T04:30:00-03:00",
  correcoesDe: "2026-10-04T16:00:00-03:00",
  correcoesAte: "2026-10-05T12:00:00-03:00",
  gitRef: "origin/main",
} as const;

/**
 * Data da linha de comando → epoch ms. Sem deslocamento explícito, lê como BRT
 * (`2026-10-04T16:30` = 16h30 de Brasília) — o painel inteiro fala BRT, e
 * ler como UTC deslocaria a janela em 3 horas sem erro nenhum.
 */
export function lerData(raw: string): number {
  const temFuso = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw);
  const ms = Date.parse(temFuso ? raw : `${raw.length === 16 ? `${raw}:00` : raw}-03:00`);
  if (!Number.isFinite(ms)) throw new Error(`data inválida: ${raw}`);
  return ms;
}

export function lerArgs(argv: readonly string[], cwd = process.cwd()): ArgsRetrato {
  const valor = (nome: string): string | undefined => {
    const i = argv.indexOf(`--${nome}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const turno = Number(valor("turno") ?? "1");
  if (turno !== 1 && turno !== 2) throw new Error(`--turno deve ser 1 ou 2 (veio ${turno})`);
  const paradosCargos = (valor("parados-cargos") ?? CARGOS_DO_PAINEL.join(","))
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n): n is CargoDoPainel => (CARGOS_DO_PAINEL as readonly number[]).includes(n));
  const deMs = lerData(valor("de") ?? PADRAO.de);
  const ateMs = lerData(valor("ate") ?? PADRAO.ate);
  if (!(ateMs > deMs)) throw new Error("--ate precisa ser depois de --de");
  return {
    envFile: valor("env-file") ?? resolve(cwd, ".env.local"),
    escrever: argv.includes("--escrever"),
    deMs,
    ateMs,
    turno,
    gitRef: valor("git-ref") ?? PADRAO.gitRef,
    correcoesDeMs: lerData(valor("correcoes-de") ?? PADRAO.correcoesDe),
    correcoesAteMs: lerData(valor("correcoes-ate") ?? PADRAO.correcoesAte),
    paradosCargos,
    saida: valor("saida") ?? resolve(cwd, ...PAINEL_ARQUIVO_LOCAL),
    guardarInsumos: valor("guardar-insumos") ?? null,
    deInsumos: valor("de-insumos") ?? null,
  };
}

// ---------------------------------------------------------------------------
// Credenciais — lista branca, em memória
// ---------------------------------------------------------------------------

function lerCredenciais(args: ArgsRetrato): {
  databaseUrl: string | null;
  blobToken: string | null;
} {
  const chaves = [
    ...(args.deInsumos ? [] : ["DATABASE_URL"]),
    ...(args.escrever ? ["BLOB_READ_WRITE_TOKEN"] : []),
  ];
  if (chaves.length === 0) return { databaseUrl: null, blobToken: null };
  let bruto = "";
  try {
    bruto = readFileSync(args.envFile, "utf8");
  } catch {
    console.warn(`(sem ${args.envFile} — usando só o ambiente)`);
  }
  const ambiente: Record<string, string | undefined> = {};
  for (const k of chaves) ambiente[k] = process.env[k];
  const sel = selecionarEnvDoVigia(bruto, ambiente, chaves);
  const databaseUrl = sel.DATABASE_URL ?? null;
  if (!args.deInsumos && !databaseUrl) {
    throw new Error("DATABASE_URL ausente — passe --env-file <.env.local>");
  }
  const blobToken = sel.BLOB_READ_WRITE_TOKEN ?? null;
  if (args.escrever && !blobToken) {
    throw new Error("--escrever exige BLOB_READ_WRITE_TOKEN (no ambiente ou no --env-file)");
  }
  return { databaseUrl, blobToken };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

function ms(v: unknown): number {
  const n = v instanceof Date ? v.getTime() : Date.parse(String(v));
  if (!Number.isFinite(n)) throw new Error(`horário ilegível no banco: ${String(v)}`);
  return n;
}

function msOuNull(v: unknown): number | null {
  return v === null || v === undefined ? null : ms(v);
}

function inteiroOuNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function lerDoBanco(databaseUrl: string, args: ArgsRetrato) {
  const sql = neon(databaseUrl, { readOnly: true });
  const de = new Date(args.deMs).toISOString();
  const ate = new Date(args.ateMs).toISOString();
  const consulta = async (rotulo: string, texto: string, params: unknown[]): Promise<Linha[]> => {
    const t0 = Date.now();
    const r = (await sql.query(texto, params)) as Linha[];
    console.log(`  · ${rotulo}: ${r.length} linhas em ${Date.now() - t0} ms`);
    return r;
  };

  const ingest: LinhaIngestLog[] = (
    await consulta(
      "ingest_log",
      `SELECT ts, duration_ms, files_fetched, files_changed, errors, notes
         FROM ingest_log WHERE ts >= $1 AND ts < $2 ORDER BY ts, id`,
      [de, ate],
    )
  ).map((r) => ({
    tsMs: ms(r.ts),
    durationMs: inteiroOuNull(r.duration_ms),
    filesFetched: inteiroOuNull(r.files_fetched),
    filesChanged: inteiroOuNull(r.files_changed),
    errors: inteiroOuNull(r.errors),
    notes: typeof r.notes === "string" ? r.notes : null,
  }));

  // Só contagens por minuto — `payload` não é tocado (índice `ix_snap_ts`).
  const novidades: NovidadesNoMinuto[] = (
    await consulta(
      "snapshots por minuto",
      `SELECT date_trunc('minute', ts) AS minuto, cargo, count(*)::int AS n
         FROM snapshots WHERE ts >= $1 AND ts < $2 AND turno = $3
        GROUP BY 1, 2`,
      [de, ate, args.turno],
    )
  ).map((r) => ({ minutoMs: ms(r.minuto), cargo: Number(r.cargo), n: Number(r.n) }));

  const rodadas: RodadaBruta[] = (
    await consulta(
      "rodadas da projeção",
      `SELECT cargo, ts, max(dado_ts) AS dado_ts
         FROM projections WHERE ts >= $1 AND ts < $2 AND turno = $3
        GROUP BY cargo, ts`,
      [de, ate, args.turno],
    )
  ).map((r) => ({ cargo: Number(r.cargo), tsMs: ms(r.ts), dadoTsMs: msOuNull(r.dado_ts) }));

  // ~2,3 mil versões de arquivos agregados (UF e Brasil) do Presidente; de
  // cada uma, só `s.st` e `s.ts` (seções), nunca o payload inteiro.
  const agregadosPresidente: AgregadoApurado[] = (
    await consulta(
      "agregados do Presidente",
      `SELECT ts, uf, nivel, payload->'s'->>'st' AS st, payload->'s'->>'ts' AS tot
         FROM snapshots
        WHERE cargo = 1 AND turno = $3 AND nivel IN ('uf', 'br') AND ts >= $1 AND ts < $2
        ORDER BY ts, id`,
      [de, ate, args.turno],
    )
  ).map((r) => ({
    tsMs: ms(r.ts),
    uf: String(r.uf ?? "").trim(),
    nivel: String(r.nivel),
    st: r.st,
    tot: r.tot,
  }));

  // Arquivos parados, em DOIS passos (o de um passo só — JOIN com o filtro no
  // payload — levou 180 s porque o planejador aplicava o filtro antes do JOIN):
  //   1. o id da última versão de cada arquivo na janela (só colunas pequenas);
  //   2. `s.st`/`s.ts` dessas linhas, por chave primária, em lotes.
  const ultimosIds = await consulta(
    "última versão de cada arquivo",
    `SELECT cargo, max(id)::text AS id
       FROM snapshots WHERE ts >= $1 AND ts < $2 AND turno = $3 AND cargo = ANY($4::int[])
      GROUP BY cargo, nivel, uf, cod_municipio_tse, cod_zona`,
    [de, ate, args.turno, args.paradosCargos],
  );
  const ids = ultimosIds.map((r) => String(r.id));
  const versoes: UltimaVersao[] = [];
  const LOTE = 1000;
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const linhas = await consulta(
      `seções das últimas versões ${i + 1}–${i + lote.length}`,
      `SELECT ts, cargo, nivel, uf, cod_municipio_tse, cod_zona,
              payload->'s'->>'st' AS st, payload->'s'->>'ts' AS tot
         FROM snapshots WHERE id = ANY($1::bigint[])`,
      [lote],
    );
    for (const r of linhas) {
      versoes.push({
        tsMs: ms(r.ts),
        cargo: Number(r.cargo),
        nivel: String(r.nivel),
        uf: String(r.uf ?? "").trim(),
        codMunicipioTse: Number(r.cod_municipio_tse),
        codZona: Number(r.cod_zona),
        st: r.st,
        tot: r.tot,
        municipio: null,
      });
    }
  }

  // Nome do município só para os arquivos que ficaram incompletos (poucos).
  const incompletos = versoes.filter((v) => {
    const st = Number(String(v.st ?? "").replace(",", "."));
    const tot = Number(String(v.tot ?? "").replace(",", "."));
    return Number.isFinite(st) && Number.isFinite(tot) && tot > 0 && st < tot;
  });
  const codigos = [...new Set(incompletos.map((v) => v.codMunicipioTse).filter((c) => c > 0))];
  if (codigos.length > 0) {
    const nomes = await consulta(
      "nomes dos municípios",
      `SELECT cod_municipio_tse, nome FROM municipios WHERE cod_municipio_tse = ANY($1::int[])`,
      [codigos],
    );
    const porCodigo = new Map(nomes.map((r) => [Number(r.cod_municipio_tse), String(r.nome)]));
    for (const v of versoes) v.municipio = porCodigo.get(v.codMunicipioTse) ?? null;
  }

  return { ingest, novidades, rodadas, agregadosPresidente, versoes };
}

// ---------------------------------------------------------------------------
// Correções publicadas (git)
// ---------------------------------------------------------------------------

/**
 * Commits do `ref` na janela das correções, com a hora do REGISTRO (data do
 * commit) — não a hora em que a correção entrou no ar, que o git não sabe.
 */
function lerCommits(args: ArgsRetrato): CommitBruto[] {
  try {
    const saida = execFileSync(
      "git",
      [
        "log",
        args.gitRef,
        `--since=${new Date(args.correcoesDeMs).toISOString()}`,
        `--until=${new Date(args.correcoesAteMs).toISOString()}`,
        "--format=%h%x1f%cI%x1f%s",
      ],
      { encoding: "utf8" },
    );
    return saida
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, quando, titulo] = l.split("\x1f");
        return { hash: hash ?? "", tsMs: Date.parse(quando ?? ""), titulo: titulo ?? "" };
      })
      .filter((c) => c.hash && Number.isFinite(c.tsMs));
  } catch (e) {
    console.warn(`(git log ${args.gitRef} falhou — retrato sai sem correções: ${String(e)})`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

async function principal(): Promise<void> {
  const args = lerArgs(process.argv.slice(2));
  const { databaseUrl, blobToken } = lerCredenciais(args);

  console.log(
    `Retrato do painel — janela ${new Date(args.deMs).toISOString()} → ${new Date(args.ateMs).toISOString()} (UTC), turno ${args.turno}`,
  );
  const t0 = Date.now();
  type Lido = Awaited<ReturnType<typeof lerDoBanco>>;
  let lido: Lido;
  if (args.deInsumos) {
    lido = JSON.parse(readFileSync(args.deInsumos, "utf8")) as Lido;
    console.log(`  · insumos lidos de ${args.deInsumos} (banco não consultado)`);
  } else {
    lido = await lerDoBanco(databaseUrl as string, args);
  }
  if (args.guardarInsumos) {
    mkdirSync(dirname(args.guardarInsumos), { recursive: true });
    writeFileSync(args.guardarInsumos, JSON.stringify(lido));
    console.log(`  · insumos guardados em ${args.guardarInsumos}`);
  }
  const commits = lerCommits(args);

  const nomes = Object.fromEntries(CARGOS.map((c) => [c.cd, c.label])) as Record<
    CargoDoPainel,
    string
  >;
  const retrato = montarRetrato({
    deMs: args.deMs,
    ateMs: args.ateMs,
    turno: args.turno,
    ambiente: "production",
    geradoEmMs: Date.now(),
    nomes,
    ingest: lido.ingest,
    novidades: lido.novidades,
    rodadas: lido.rodadas,
    agregadosPresidente: lido.agregadosPresidente,
    ultimasVersoes: lido.versoes,
    commits,
    gitRef: args.gitRef,
    correcoesDeMs: args.correcoesDeMs,
    correcoesAteMs: args.correcoesAteMs,
  });

  const corpo = JSON.stringify(retrato);
  mkdirSync(dirname(args.saida), { recursive: true });
  writeFileSync(args.saida, corpo);
  console.log(
    `\nGravado ${args.saida} — ${Buffer.byteLength(corpo)} bytes (${Date.now() - t0} ms no total)`,
  );

  console.log("\nTotais por cargo:");
  console.table(
    retrato.totais.map((t) => ({
      cargo: t.cargo,
      ciclos: t.ciclos,
      interrompidos: t.interrompidos,
      pedidos: t.pedidos,
      novidades: t.novidades,
      erros: t.erros,
      naoEncontrados: t.naoEncontrados,
      bloqueios: t.bloqueios,
      durMedS: t.duracaoMedianaS,
      durMaxS: t.duracaoMaximaS,
      acima300: t.ciclosAcimaDe300s,
      rodadas: t.rodadas,
    })),
  );
  console.log("\nBuracos da projeção:");
  console.table(retrato.buracosProjecao);
  console.log("\nBuracos de ciclos:");
  console.table(retrato.buracosCiclos);
  console.log(`\nArquivos parados: ${retrato.arquivosParados.length}`);
  console.table(retrato.arquivosParados);
  console.log("\nEpisódios de bloqueio (429):");
  console.table(
    retrato.episodiosDeBloqueio.map((e) => ({
      de: e.de,
      ate: e.ate,
      minimo: e.minimo,
      maximo: e.maximo,
      ciclos: e.ciclos
        .map((c) => `${c.cargo}${c.fatia ? `/${c.fatia}` : ""}:${c.bloqueios}`)
        .join(" "),
    })),
  );
  console.log(
    `\nCorreções: ${retrato.correcoes.length} · linhas ignoradas: ${retrato.fonte.linhasIgnoradas}`,
  );

  if (!args.escrever) {
    console.log("\n(ensaio — nada foi para o Blob. Para subir: acrescente --escrever)");
    return;
  }
  const r = await put(PAINEL_BLOB_PATHNAME, corpo, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    token: blobToken ?? undefined,
  });
  console.log(`\nNo Blob PRIVADO: ${r.pathname}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
