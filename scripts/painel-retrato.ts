/**
 * scripts/painel-retrato.ts — `pnpm painel:retrato`
 *
 * Gera o **retrato** do painel privado (`/painel`, ADR-0077): um JSON com tudo
 * o que o sistema fez numa noite de apuração — pedidos ao TSE, novidades,
 * erros, bloqueios, rodadas da projeção, buracos, arquivos parados, % apurado
 * do Presidente e as correções publicadas. A página lê só este arquivo.
 *
 *   pnpm painel:retrato --env-file <caminho/.env.local>              # grava build/painel/…
 *   pnpm painel:retrato --env-file <caminho/.env.local> --escrever   # + Blob, endereço secreto
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
 * Toda consulta roda numa transação `READ ONLY` — e o jeito de conseguir isso
 * NÃO é `neon(url, { readOnly: true })`. 🔴 Conferido no código do driver
 * (`@neondatabase/serverless`, `index.mjs`): o cabeçalho `Neon-Batch-Read-Only`
 * só é enviado quando a consulta vai como LOTE (array). Uma `sql.query()`
 * avulsa ignora `readOnly` em silêncio — a primeira versão deste script
 * (`a9413db`) acreditava estar em modo leitura e não estava. Por isso cada
 * consulta passa por {@link consultarSoLeitura}, que a embrulha em
 * `sql.transaction([…], { readOnly: true })`: aí um `INSERT`/`UPDATE` é recusado
 * pelo próprio Postgres. Trava em `tests/unit/scripts/painel-retrato-leitura.test.ts`.
 * As consultas
 * nunca selecionam `snapshots.payload` inteiro — só `payload->'s'` de linhas já
 * escolhidas por id (a mesma lição do `8a977b8`: ranquear o id, buscar o
 * payload depois). E nunca usam `snapshots.pct_apurado` (é o `s.psa`).
 *
 * ## Saída
 *
 * Sem `--escrever`: só o arquivo local (sob `build/`, que o git ignora — o
 * repositório é PÚBLICO e o retrato não pode ser commitado). `--saida` e
 * `--guardar-insumos` RECUSAM qualquer caminho fora de `build/`
 * ({@link dentroDeBuild}).
 * Com `--escrever` (plano B do ADR-0077 — a store do projeto é PÚBLICA e
 * recusou `access: "private"` com "Cannot use private access on a public
 * store"): o retrato sobe com `access: "public"` num ENDEREÇO SECRETO,
 * `painel/<segredo>/retrato-1t-2026.json`, com `<segredo>` = 32 bytes
 * aleatórios em hexadecimal (`crypto.randomBytes`), sorteado de NOVO a cada
 * `--escrever` — publicar de novo invalida o endereço antigo para quem não
 * recebeu o novo. Cache curto (60 s).
 *
 * 🔴 A URL é o segredo e NÃO vai para o terminal (terminal vira print, log de
 * CI, histórico). Ela é gravada só em `build/painel/url-retrato.txt`, sem
 * quebra de linha final, para ser colada na variável `PAINEL_RETRATO_URL` do
 * projeto na Vercel. O terminal mostra apenas onde ela foi gravada.
 */

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type NeonQueryFunction, neon } from "@neondatabase/serverless";
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
import type { RodadaCorrida, VersaoCorrida } from "@/lib/painel/corrida";
import {
  CANDIDATOS_DA_CORRIDA,
  CARGOS_DO_PAINEL,
  type CargoDoPainel,
  PAINEL_ARQUIVO_LOCAL,
  PAINEL_BLOB_ARQUIVO,
  PAINEL_URL_ARQUIVO_LOCAL,
} from "@/lib/painel/tipos";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
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

/**
 * Resolve `caminho` a partir de `cwd` e exige que ele fique DENTRO de
 * `<cwd>/build/` — a única pasta que o git ignora para este fim. O repositório
 * é público: um retrato (ou os insumos) gravado em qualquer outro lugar viraria
 * um `git add` distraído de distância de ficar público.
 */
export function dentroDeBuild(caminho: string, cwd: string, opcao: string): string {
  const base = resolve(cwd, "build");
  const alvo = resolve(cwd, caminho);
  const rel = relative(base, alvo);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(
      `${opcao} precisa ficar dentro de build/ (o repositório é público); recebido: ${caminho}`,
    );
  }
  return alvo;
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
    saida: dentroDeBuild(valor("saida") ?? PAINEL_ARQUIVO_LOCAL.join("/"), cwd, "--saida"),
    guardarInsumos: ((g) => (g ? dentroDeBuild(g, cwd, "--guardar-insumos") : null))(
      valor("guardar-insumos"),
    ),
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

/**
 * Uma consulta, numa transação `READ ONLY` de verdade: o lote de um item só
 * faz o driver mandar `Neon-Batch-Read-Only: true` (ver a docstring do
 * arquivo). Devolve as linhas da única consulta do lote.
 */
export async function consultarSoLeitura(
  sql: NeonQueryFunction<false, false>,
  texto: string,
  params: unknown[],
): Promise<Record<string, unknown>[]> {
  const [linhas] = await sql.transaction([sql.query(texto, params)], { readOnly: true });
  return (linhas ?? []) as Record<string, unknown>[];
}

export async function lerDoBanco(databaseUrl: string, args: ArgsRetrato) {
  const sql = neon(databaseUrl);
  const de = new Date(args.deMs).toISOString();
  const ate = new Date(args.ateMs).toISOString();
  const consulta = async (rotulo: string, texto: string, params: unknown[]): Promise<Linha[]> => {
    const t0 = Date.now();
    const r = (await consultarSoLeitura(sql, texto, params)) as Linha[];
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

  // A corrida do Presidente e o % apurado nacional saem das MESMAS ~2,3 mil
  // versões de arquivos agregados (UF, exterior e Brasil), em DOIS passos:
  //   1. os ids (colunas pequenas, índice `ix_snap_ts`);
  //   2. por chave primária, em lotes, SÓ os pedaços do payload que importam:
  //      `s.st`/`s.ts` (seções), `v.vv` (votos válidos) e o `vap` de cada
  //      candidato acompanhado em `carg[].agr[].par[].cand[]` (EA20,
  //      `lib/tse/ea20-schema.ts`). Nunca o payload inteiro.
  const idsAgregados = await consulta(
    "agregados do Presidente (ids)",
    `SELECT id::text AS id
       FROM snapshots
      WHERE cargo = 1 AND turno = $3 AND nivel IN ('uf', 'br') AND ts >= $1 AND ts < $2
      ORDER BY ts, id`,
    [de, ate, args.turno],
  );
  const versoesCorrida: VersaoCorrida[] = [];
  const idsLista = idsAgregados.map((r) => String(r.id));
  for (let i = 0; i < idsLista.length; i += 1000) {
    const lote = idsLista.slice(i, i + 1000);
    const linhas = await consulta(
      `agregados do Presidente ${i + 1}–${i + lote.length}`,
      `SELECT ts, uf, nivel,
              payload->'s'->>'st' AS st, payload->'s'->>'ts' AS tot, payload->'v'->>'vv' AS vv,
              jsonb_path_query_first(payload, '$.carg[*].agr[*].par[*].cand[*] ? (@.n == $n).vap',
                                     jsonb_build_object('n', $2::text)) #>> '{}' AS vap_a,
              jsonb_path_query_first(payload, '$.carg[*].agr[*].par[*].cand[*] ? (@.n == $n).vap',
                                     jsonb_build_object('n', $3::text)) #>> '{}' AS vap_b
         FROM snapshots WHERE id = ANY($1::bigint[])`,
      [lote, String(CANDIDATOS_DA_CORRIDA[0]), String(CANDIDATOS_DA_CORRIDA[1])],
    );
    for (const r of linhas) {
      versoesCorrida.push({
        tsMs: ms(r.ts),
        uf: String(r.uf ?? "").trim(),
        nivel: String(r.nivel),
        st: r.st,
        tot: r.tot,
        vv: r.vv,
        votos: [r.vap_a, r.vap_b],
      });
    }
  }
  versoesCorrida.sort((a, b) => a.tsMs - b.tsMs);
  const semVotos = versoesCorrida.filter(
    (v) => v.nivel !== "br" && v.votos.some((x) => x === null || x === undefined),
  ).length;
  if (semVotos > 0) console.warn(`  ! ${semVotos} versões de UF sem os votos de algum candidato`);

  // As rodadas do modelo para os dois candidatos, no nacional (`uf IS NULL`).
  const rodadasBrutas = await consulta(
    "rodadas da corrida",
    `SELECT ts, candidato_id, pct_projetado, pct_projetado_lower, pct_projetado_upper,
            p_vitoria, pct_atual, votos_atuais, dado_ts
       FROM projections
      WHERE cargo = 1 AND turno = $3 AND uf IS NULL AND candidato_id = ANY($4::int[])
        AND ts >= $1 AND ts < $2
      ORDER BY ts`,
    [de, ate, args.turno, [...CANDIDATOS_DA_CORRIDA]],
  );
  const porTs = new Map<number, RodadaCorrida>();
  const nulos = () => CANDIDATOS_DA_CORRIDA.map(() => null as number | null);
  for (const r of rodadasBrutas) {
    const t = ms(r.ts);
    const k = (CANDIDATOS_DA_CORRIDA as readonly number[]).indexOf(Number(r.candidato_id));
    if (k < 0) continue;
    const rod = porTs.get(t) ?? {
      tsMs: t,
      dadoTsMs: msOuNull(r.dado_ts),
      pct: nulos(),
      lo: nulos(),
      hi: nulos(),
      pVitoria: nulos(),
      pctAtual: nulos(),
      votosAtuais: nulos(),
    };
    rod.pct[k] = inteiroOuNull(r.pct_projetado);
    rod.lo[k] = inteiroOuNull(r.pct_projetado_lower);
    rod.hi[k] = inteiroOuNull(r.pct_projetado_upper);
    rod.pVitoria[k] = inteiroOuNull(r.p_vitoria);
    rod.pctAtual[k] = inteiroOuNull(r.pct_atual);
    rod.votosAtuais[k] = inteiroOuNull(r.votos_atuais);
    porTs.set(t, rod);
  }
  const rodadasCorrida = [...porTs.values()].sort((a, b) => a.tsMs - b.tsMs);

  const cadastro = await consulta(
    "candidatos da corrida",
    `SELECT numero, nome_urna, sq_candidato, partido_sigla
       FROM candidatos WHERE cargo = 1 AND numero = ANY($1::int[])`,
    [[...CANDIDATOS_DA_CORRIDA]],
  );
  const candidatosCorrida = CANDIDATOS_DA_CORRIDA.map((n) => {
    const c = cadastro.find((r) => Number(r.numero) === n);
    return {
      id: n,
      nome: c ? nomeExibicao(String(c.nome_urna), String(c.sq_candidato)) : `Candidato ${n}`,
      partido: c ? String(c.partido_sigla) : "",
    };
  });

  const agregadosPresidente: AgregadoApurado[] = versoesCorrida.map((v) => ({
    tsMs: v.tsMs,
    uf: v.uf,
    nivel: v.nivel,
    st: v.st,
    tot: v.tot,
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

  return {
    ingest,
    novidades,
    rodadas,
    agregadosPresidente,
    versoes,
    corrida: { candidatos: candidatosCorrida, versoes: versoesCorrida, rodadas: rodadasCorrida },
  };
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
// Publicação no Blob — endereço secreto
// ---------------------------------------------------------------------------

/** 32 bytes aleatórios em hexadecimal (64 caracteres) — o segredo do caminho. */
export function novoSegredo(): string {
  return randomBytes(32).toString("hex");
}

/** `painel/<segredo>/retrato-1t-2026.json`. Recusa segredo que não seja 64 hex. */
export function caminhoSecreto(segredo: string): string {
  if (!/^[0-9a-f]{64}$/.test(segredo)) throw new Error("segredo inválido (esperado 64 hex)");
  return `painel/${segredo}/${PAINEL_BLOB_ARQUIVO}`;
}

/**
 * Sobe o retrato num endereço secreto NOVO e grava a URL em
 * `build/painel/url-retrato.txt` (sem quebra de linha final). Devolve só o
 * caminho do arquivo onde a URL foi gravada — nunca a URL, para que nada
 * acima consiga imprimi-la por descuido.
 */
export async function publicarRetrato(
  corpo: string,
  token: string,
  cwd: string,
  segredo: string = novoSegredo(),
): Promise<string> {
  const r = await put(caminhoSecreto(segredo), corpo, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    contentType: "application/json; charset=utf-8",
    token,
  });
  const arquivo = resolve(cwd, ...PAINEL_URL_ARQUIVO_LOCAL);
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, r.url);
  return PAINEL_URL_ARQUIVO_LOCAL.join("/");
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
    corrida: lido.corrida ?? null,
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
  const corrida = retrato.corridaPresidente;
  if (corrida) {
    console.log(
      `\nCorrida do Presidente: ${corrida.candidatos.map((c) => `${c.nome} (${c.partido})`).join(" × ")}` +
        ` · ${corrida.apuracao.t.length} instantes de apuração · ${corrida.projecao.t.length} rodadas` +
        ` · ${Buffer.byteLength(JSON.stringify(corrida))} bytes`,
    );
    console.log(
      `  soma por UF × pct_atual do modelo: ${corrida.conferencia.instantes} instantes,` +
        ` diferença máxima ${corrida.conferencia.difMaxPp} pp (rodada de ${corrida.conferencia.horaDaDifMax})`,
    );
    console.log("  trocas de liderança:", JSON.stringify(corrida.trocas));
  } else {
    console.log("\nCorrida do Presidente: sem dados");
  }
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
  const onde = await publicarRetrato(corpo, blobToken as string, process.cwd());
  console.log(`\nURL gravada em ${onde}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  principal().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
