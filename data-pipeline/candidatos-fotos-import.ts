// data-pipeline/candidatos-fotos-import.ts
//
// Sobe a **foto oficial de candidato** do TSE para o Vercel Blob — spec 018
// RF-142, [ADR-0041](../docs/architecture/adrs/0041-foto-candidato-blob-binario-cache-um-ano.md).
// Irmão de `candidatos-import.ts`: mesma fonte (Portal de Dados Abertos, licença
// cc-by, ADR-0039), mesma fronteira de elegibilidade (publicabilidade
// fail-closed, ADR-0040), mesmo regime de execução (fora do request path).
//
// ─── A fonte, medida em 2026-09-13 ──────────────────────────────────────────
//
//   https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/fotos/
//     foto_cand2026_<UF>_div.zip
//
// **28 pacotes**: as 27 UFs mais `BR` (a corrida presidencial, que no cadastro
// mora sob `uf = 'BR'` — ver `candidatos-parse.ts`). AC = 2,2 MB, SP = 14,8 MB,
// ~39 MB somados. Cada ZIP traz JPEGs 161×225 px de 4,8–7,7 KB **e um
// `leiame.pdf`**, que não é foto de ninguém.
//
// Nome interno: `F<UF><SQ_CANDIDATO>_div.jpg`. `SQ_CANDIDATO` tem **11 ou 12
// dígitos** — por isso a regex captura `(\d+)` e não `(\d{12})`. É `string` em
// todo o caminho: o tipo no banco é `bigint`, e passar por `number` no meio
// convida uma perda de precisão que só apareceria como foto do candidato errado.
//
// ─── O ZIP tem MAIS fotos do que a tabela tem linhas, e isso é normal ───────
//
// O TSE empacota a foto de **toda** candidatura registrada na UF — inclusive
// vice e suplente de senador. `candidatos` só guarda os cargos do produto
// (1, 3, 5, 6, e desde 29/09 também 7 e 8; ver `CARGOS_PRODUTO`). Logo
// "foto sem linha na tabela" é, em massa, **cargo fora do produto — não
// anomalia**, e o resumo diz isso com todas as letras para que ninguém leia o
// número como alarme.
//
// O sinal que realmente dói é o **inverso**: candidatura publicável sem foto no
// ZIP. Essa é a que o leitor vê como avatar de fallback (RF-151). Está contada
// por UF, separada, e é a metade que o "não sobra órfã de nenhum lado" do
// RF-142 cobre e que um contador só de um lado deixaria passar.
//
// ─── Delta por default ──────────────────────────────────────────────────────
//
// Sobe apenas onde `candidatos.foto_ok = false`. A foto é imutável por
// construção de caminho (`candidatos/foto/<UF>/<SQ>.jpg`) e vai ao CDN com
// cache de **um ano** (`BLOB_IMMUTABLE_MAX_AGE_SECONDS`) — reescrever tudo a
// cada ciclo seria custo puro. `--force` é a saída para o único cenário de
// reescrita real que o ADR-0041 admite: o TSE corrigir a foto de alguém.
//
// `--force` também **re-baixa e re-extrai** os ZIPs (desde 03/10). Antes não
// re-baixava: o cache de `build/tse-archives/` não expira, e um run sem
// `--force` continua lendo o ZIP do dia em que foi baixado pela primeira vez —
// candidatura registrada depois disso fica sem foto. O cache antigo só é
// substituído depois que o download novo termina inteiro.
//
// ─── Uso ────────────────────────────────────────────────────────────────────
//
//   set -a; . ./.env.local; set +a
//   pnpm candidatos:fotos --uf AC
//   pnpm candidatos:fotos
//   pnpm candidatos:fotos --uf SP,BR --force
//   pnpm candidatos:fotos --dry-run
//
// ⚠️ Roda com **`tsx`**, não com `node --experimental-strip-types` como os
// outros importadores desta pasta. Motivo medido: este é o primeiro script de
// `data-pipeline/` a importar `lib/blob/`, e `lib/blob/write.ts` importa
// `@/lib/tse/log` — o alias `@` do tsconfig, que o loader nativo do Node não
// resolve (`ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'`). É a mesma
// limitação que `zonas-import.ts:64` registra para `lib/tse/`.
//
// Pré-requisitos: migration 0008 aplicada, `candidatos-import.ts` já rodado
// (sem cadastro não há em quem casar foto), `DATABASE_URL` e
// `BLOB_READ_WRITE_TOKEN` no ambiente. Sem o token o `putBinary` vira no-op
// silencioso por design (`lib/blob/write.ts`) — o resumo mostraria "subidas"
// altas e nenhum byte; por isso o `main` aborta cedo se o token faltar.

import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candidatoFotoBlobPathname } from "../lib/blob/paths.ts";
import { BLOB_IMMUTABLE_MAX_AGE_SECONDS, putBinary } from "../lib/blob/write.ts";
import { downloadCached, getPool, unzipTo } from "./_tse-common.ts";
import { ANO_PLEITO } from "./candidatos-parse.ts";

const BASE_FOTOS = "https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/fotos";

/**
 * As 28 siglas que o TSE publica: 27 UFs + `BR`.
 *
 * `BR` não é engano de digitação nem "Brasil agregado": é onde a candidatura
 * presidencial mora no cadastro (`SG_UF = 'BR'`), e portanto o segmento de
 * caminho da foto dela.
 */
export const SIGLAS_FOTO: readonly string[] = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "BR",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
];

/**
 * Piso de sanidade do ZIP — só para pegar corpo de erro do CDN (HTML de WAF,
 * resposta truncada), nunca para julgar volume de candidatura.
 *
 * ⚠️ Medido em 2026-09-13, e a primeira calibragem estava errada: eu havia posto
 * 300 KB assumindo que o menor pacote fosse o do AC. **O menor é o `BR`**, com
 * **284.702 bytes** — a corrida presidencial tem algumas dezenas de fotos, não
 * centenas —, e o piso de 300 KB abortou a execução inteira na 5ª sigla. O
 * segundo menor é AL (1,7 MB), o maior SP (14,8 MB). 50 KB fica uma ordem de
 * grandeza abaixo do menor real e ainda uma ordem acima de qualquer página de
 * erro.
 */
const ZIP_MIN_BYTES = 50 * 1024;

/** Fotos marcadas como `foto_ok` por statement de UPDATE. */
const UPDATE_BATCH = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

export interface Cli {
  /** `null` = todas as 28 siglas. */
  ufs: readonly string[] | null;
  /**
   * Re-baixa e re-extrai os ZIPs (ignora o cache local) **e** reescreve foto
   * já marcada `foto_ok` (TSE corrigiu a imagem de alguém).
   */
  force: boolean;
  /** Baixa, casa e conta — não escreve no Blob nem no banco. */
  dryRun: boolean;
  /** Uploads simultâneos por lote. */
  concorrencia: number;
}

export const CONCORRENCIA_DEFAULT = 10;

export function parseCli(argv: readonly string[]): Cli {
  const cli: Cli = { ufs: null, force: false, dryRun: false, concorrencia: CONCORRENCIA_DEFAULT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--uf") {
      const v = argv[i + 1];
      if (!v) throw new Error("--uf exige uma lista de siglas (ex.: AC ou SP,BR,MG)");
      const siglas = v
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s.length > 0);
      const invalidas = siglas.filter((s) => !SIGLAS_FOTO.includes(s));
      if (siglas.length === 0 || invalidas.length > 0) {
        throw new Error(
          `--uf recebeu sigla desconhecida: ${invalidas.join(", ") || "(vazio)"}. ` +
            `O TSE publica 28 pacotes: ${SIGLAS_FOTO.join(", ")}.`,
        );
      }
      cli.ufs = siglas;
      i++;
    } else if (a === "--force") {
      cli.force = true;
    } else if (a === "--dry-run") {
      cli.dryRun = true;
    } else if (a === "--concorrencia") {
      const v = Number(argv[i + 1]);
      if (!Number.isInteger(v) || v < 1 || v > 64) {
        throw new Error("--concorrencia exige um inteiro entre 1 e 64");
      }
      cli.concorrencia = v;
      i++;
    } else if (a?.startsWith("--")) {
      throw new Error(`Flag desconhecida: ${a}`);
    }
  }
  return cli;
}

// ─────────────────────────────────────────────────────────────────────────────
// Nome de arquivo → `sqcand`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `F<UF><SQ_CANDIDATO>_div.jpg` — **ancorada nas duas pontas**.
 *
 * `(\d+)` e não `(\d{12})`: `SQ_CANDIDATO` tem 11 **ou** 12 dígitos (ADR-0041
 * item 5). Um quantificador fixo descartaria em silêncio toda candidatura de 11
 * dígitos, e o sintoma seria avatar de fallback em milhares de cards — nunca um
 * erro.
 *
 * `^`/`$` não são decoração: sem âncora, `lixo_FAC123_div.jpg.bak` casaria e
 * gravaria um blob sob um `sqcand` que ninguém pediu.
 */
export const NOME_FOTO_PATTERN = /^F([A-Z]{2})(\d+)_div\.jpe?g$/i;

/** Extensões que consideramos "arquivo de foto" ao classificar o conteúdo do ZIP. */
const EXT_FOTO_PATTERN = /\.jpe?g$/i;

export interface NomeFoto {
  /** Sigla embutida no NOME do arquivo — conferida contra a do cadastro. */
  uf: string;
  /** Dígitos crus de `SQ_CANDIDATO`. `string` sempre; ver cabeçalho. */
  sqcand: string;
}

/** `null` quando o nome não é `F<UF><SQ>_div.jpg`. O caller **conta** o `null`. */
export function parseNomeFoto(nome: string): NomeFoto | null {
  const m = NOME_FOTO_PATTERN.exec(basename(nome));
  const uf = m?.[1];
  const sqcand = m?.[2];
  if (!uf || !sqcand) return null;
  return { uf: uf.toUpperCase(), sqcand };
}

/** `true` para `.jpg`/`.jpeg` — o que separa "nome fora do padrão" de `leiame.pdf`. */
export function ehArquivoDeFoto(nome: string): boolean {
  return EXT_FOTO_PATTERN.test(basename(nome));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cadastro
// ─────────────────────────────────────────────────────────────────────────────

/** A linha de `candidatos` que decide se aquela foto sobe, e sob qual caminho. */
export interface LinhaCadastro {
  /**
   * UF **do cadastro**, não a do nome do arquivo. É ela que entra no caminho do
   * blob, porque é dela que o read path deriva a URL
   * (`blobUrlFor(candidatoFotoBlobPathname(row.uf, sqcand))`). Gravar sob a UF
   * do nome do arquivo produziria um 404 mudo se as duas divergissem.
   */
  uf: string;
  cargo: number;
  publicavel: boolean;
  fotoOk: boolean;
}

export type Cadastro = ReadonlyMap<string, LinhaCadastro>;

// ─────────────────────────────────────────────────────────────────────────────
// Resumo
// ─────────────────────────────────────────────────────────────────────────────

export interface ResumoUf {
  uf: string;
  /** Arquivos `.jpg`/`.jpeg` no ZIP — casados ou não. */
  jpegs: number;
  /** `.jpg` cujo nome NÃO é `F<UF><SQ>_div.jpg`. Contado, nunca descartado em silêncio. */
  foraDoPadrao: number;
  /** Entradas que não são imagem (o `leiame.pdf` de cada pacote). */
  naoImagem: number;
  /** Fotos que acharam candidatura **publicável** no cadastro. */
  casaram: number;
  /** Subidas nesta execução. */
  subidas: number;
  /** Já tinham `foto_ok` e o run não é `--force`. */
  puladasDelta: number;
  /** `putBinary` lançou. Agregadas, não fatais. */
  falhas: number;
  /** Mensagens das primeiras falhas, para o resumo não virar adivinhação. */
  motivosFalha: string[];
  /** `sqcand` ausente do cadastro — em massa, cargo fora do produto. NÃO é alarme. */
  semLinha: number;
  /** `sqcand` presente mas `publicavel = false` (ADR-0040). Nenhum byte sobe. */
  naoPublicavel: number;
  /** Candidatura publicável desta UF **sem** foto no ZIP — o sinal que dói (RF-151). */
  publicaveisSemFoto: number;
  /** Total de publicáveis desta UF no cadastro — denominador das duas linhas acima. */
  publicaveis: number;
  /** Bytes efetivamente gravados. */
  bytes: number;
  ms: number;
}

function resumoVazio(uf: string): ResumoUf {
  return {
    uf,
    jpegs: 0,
    foraDoPadrao: 0,
    naoImagem: 0,
    casaram: 0,
    subidas: 0,
    puladasDelta: 0,
    falhas: 0,
    motivosFalha: [],
    semLinha: 0,
    naoPublicavel: 0,
    publicaveisSemFoto: 0,
    publicaveis: 0,
    bytes: 0,
    ms: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// O núcleo — testável sem rede, sem banco e sem Blob
// ─────────────────────────────────────────────────────────────────────────────

export interface DepsFoto {
  /** Bytes de uma entrada do ZIP, pelo nome. */
  lerArquivo: (nome: string) => Promise<Uint8Array>;
  /** `putBinary` de `lib/blob/write.ts`. Injetado só para o teste poder observá-lo. */
  putBinary: typeof putBinary;
  /** Marca `foto_ok = true` no banco. No-op em `--dry-run`. */
  marcarFotoOk: (sqcands: readonly string[]) => Promise<void>;
}

export interface OpcoesFoto {
  force: boolean;
  dryRun: boolean;
  concorrencia: number;
}

interface Alvo {
  nome: string;
  sqcand: string;
  linha: LinhaCadastro;
}

/**
 * Classifica as entradas do ZIP de UMA sigla e sobe o que deve subir.
 *
 * A ordem das guardas é a regra de negócio, e cada uma delas tem um contador
 * próprio de propósito: sem contador, "não subiu" e "não existia" viram o mesmo
 * silêncio no log, que é o defeito que a constituição § 8 proíbe.
 *
 *   1. não é imagem  → `naoImagem` (o `leiame.pdf`)
 *   2. nome fora do padrão → `foraDoPadrao`
 *   3. `sqcand` sem linha → `semLinha`
 *   4. linha não publicável → `naoPublicavel` (ADR-0040: a foto segue a MESMA
 *      fronteira de "quem existe" que nome e partido; não há segunda regra)
 *   5. já tem `foto_ok` e não é `--force` → `puladasDelta`
 *   6. sobe
 */
export async function importarFotosDaSigla(
  uf: string,
  entradas: readonly string[],
  cadastro: Cadastro,
  opts: OpcoesFoto,
  deps: DepsFoto,
): Promise<ResumoUf> {
  const t0 = Date.now();
  const r = resumoVazio(uf);

  // Denominador do cruzamento inverso: quem, nesta sigla, deveria ter foto.
  const publicaveisDaSigla = new Set<string>();
  for (const [sq, linha] of cadastro) {
    if (linha.uf === uf && linha.publicavel) publicaveisDaSigla.add(sq);
  }
  r.publicaveis = publicaveisDaSigla.size;

  const alvos: Alvo[] = [];

  for (const entrada of entradas) {
    const nome = basename(entrada);
    if (!ehArquivoDeFoto(nome)) {
      r.naoImagem++;
      continue;
    }
    r.jpegs++;

    const parsed = parseNomeFoto(nome);
    if (!parsed) {
      r.foraDoPadrao++;
      console.warn(`  [${uf}] nome fora do padrão F<UF><SQ>_div.jpg: ${nome}`);
      continue;
    }

    const linha = cadastro.get(parsed.sqcand);
    if (!linha) {
      r.semLinha++;
      continue;
    }
    if (!linha.publicavel) {
      r.naoPublicavel++;
      continue;
    }

    r.casaram++;
    publicaveisDaSigla.delete(parsed.sqcand);

    if (linha.uf !== parsed.uf) {
      console.warn(
        `  [${uf}] UF divergente em ${nome}: nome diz ${parsed.uf}, cadastro diz ${linha.uf} — ` +
          `gravando sob a do cadastro (é dela que o read path deriva a URL).`,
      );
    }

    if (linha.fotoOk && !opts.force) {
      r.puladasDelta++;
      continue;
    }

    alvos.push({ nome, sqcand: parsed.sqcand, linha });
  }

  r.publicaveisSemFoto = publicaveisDaSigla.size;

  const subidos: string[] = [];
  for (let i = 0; i < alvos.length; i += opts.concorrencia) {
    const lote = alvos.slice(i, i + opts.concorrencia);
    // `allSettled`, não `all`: uma foto que falha (rede, 5xx do Blob) não pode
    // derrubar as outras nove do lote nem as 7.000 seguintes. As falhas viram
    // número no resumo — e o `foto_ok` delas fica `false`, então o próximo run
    // em modo delta tenta de novo sozinho.
    const res = await Promise.allSettled(
      lote.map(async (alvo) => {
        const pathname = candidatoFotoBlobPathname(alvo.linha.uf, alvo.sqcand);
        const buf = await deps.lerArquivo(alvo.nome);
        if (opts.dryRun) return { sqcand: alvo.sqcand, bytes: buf.byteLength };
        const out = await deps.putBinary(pathname, buf, {
          contentType: "image/jpeg",
          // Explícito, e não herdado do default de `putBinary`, porque RF-142
          // afirma o número: 31.536.000 s. "Consertar" isto para os 60 s do
          // `putJson` é o erro que o ADR-0041 existe para prevenir.
          cacheControlMaxAge: BLOB_IMMUTABLE_MAX_AGE_SECONDS,
        });
        return { sqcand: alvo.sqcand, bytes: out.bytes };
      }),
    );
    for (let k = 0; k < res.length; k++) {
      const item = res[k];
      if (item === undefined) continue;
      if (item.status === "fulfilled") {
        r.subidas++;
        r.bytes += item.value.bytes;
        subidos.push(item.value.sqcand);
      } else {
        r.falhas++;
        const causa = item.reason;
        const msg = `${lote[k]?.nome ?? "?"}: ${causa instanceof Error ? causa.message : String(causa)}`;
        if (r.motivosFalha.length < 5) r.motivosFalha.push(msg);
      }
    }
  }

  if (!opts.dryRun && subidos.length > 0) {
    for (let i = 0; i < subidos.length; i += UPDATE_BATCH) {
      await deps.marcarFotoOk(subidos.slice(i, i + UPDATE_BATCH));
    }
  }

  r.ms = Date.now() - t0;
  return r;
}

/** Soma dois resumos campo a campo; o `uf` do agregado é rotulado pelo caller. */
export function somarResumos(resumos: readonly ResumoUf[], rotulo = "TOTAL"): ResumoUf {
  const t = resumoVazio(rotulo);
  for (const r of resumos) {
    t.jpegs += r.jpegs;
    t.foraDoPadrao += r.foraDoPadrao;
    t.naoImagem += r.naoImagem;
    t.casaram += r.casaram;
    t.subidas += r.subidas;
    t.puladasDelta += r.puladasDelta;
    t.falhas += r.falhas;
    t.semLinha += r.semLinha;
    t.naoPublicavel += r.naoPublicavel;
    t.publicaveisSemFoto += r.publicaveisSemFoto;
    t.publicaveis += r.publicaveis;
    t.bytes += r.bytes;
    t.ms += r.ms;
    t.motivosFalha.push(...r.motivosFalha);
  }
  return t;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const n = (v: number) => v.toLocaleString("pt-BR");
const mb = (v: number) => `${(v / 1024 / 1024).toFixed(1)} MB`;

async function carregarCadastro(
  client: import("@neondatabase/serverless").PoolClient,
): Promise<Map<string, LinhaCadastro>> {
  const { rows } = await client.query<{
    sq: string;
    uf: string;
    cargo: number;
    publicavel: boolean;
    foto_ok: boolean;
  }>(
    `SELECT sq_candidato::text AS sq, uf, cargo, publicavel, foto_ok
       FROM candidatos WHERE ano = $1`,
    [ANO_PLEITO],
  );
  const m = new Map<string, LinhaCadastro>();
  for (const row of rows) {
    m.set(row.sq, {
      uf: row.uf.trim().toUpperCase(),
      cargo: Number(row.cargo),
      publicavel: row.publicavel,
      fotoOk: row.foto_ok,
    });
  }
  return m;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const cli = parseCli(process.argv.slice(2));
  const siglas = cli.ufs ?? SIGLAS_FOTO;

  console.log(
    `[candidatos-fotos-import] siglas=${siglas.join(",")} conc=${cli.concorrencia} ` +
      `${cli.force ? "FORCE " : "delta "}${cli.dryRun ? "DRY-RUN" : ""}`.trimEnd(),
  );

  if (!cli.dryRun && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN ausente. `putBinary` viraria no-op silencioso " +
        "(lib/blob/write.ts) e o resumo mostraria milhares de 'subidas' com zero byte. " +
        "Rode `set -a; . ./.env.local; set +a` antes, ou use --dry-run.",
    );
  }

  const pool = getPool();
  const client = await pool.connect();
  const resumos: ResumoUf[] = [];

  try {
    const cadastro = await carregarCadastro(client);
    console.log(
      `  [cadastro] ${n(cadastro.size)} candidaturas · ` +
        `${n([...cadastro.values()].filter((l) => l.publicavel).length)} publicáveis · ` +
        `${n([...cadastro.values()].filter((l) => l.fotoOk).length)} já com foto`,
    );
    if (cadastro.size === 0) {
      throw new Error(
        "Tabela `candidatos` vazia para o ano " +
          `${ANO_PLEITO}. Rode \`pnpm candidatos:import\` antes — sem cadastro não há em quem casar foto.`,
      );
    }

    const marcarFotoOk = async (sqcands: readonly string[]) => {
      await client.query(
        `UPDATE candidatos SET foto_ok = true WHERE sq_candidato = ANY($1::int8[])`,
        [sqcands],
      );
    };

    for (const uf of siglas) {
      console.log(`\n── ${uf} ──`);
      const zip = await downloadCached(
        `${BASE_FOTOS}/foto_cand2026_${uf}_div.zip`,
        `fotos_${uf}.zip`,
        { minBytes: ZIP_MIN_BYTES, force: cli.force },
      );
      const dir = await unzipTo(zip, `fotos_${uf}`, { force: cli.force });
      const entradas = await readdir(dir);

      const resumo = await importarFotosDaSigla(
        uf,
        entradas,
        cadastro,
        { force: cli.force, dryRun: cli.dryRun, concorrencia: cli.concorrencia },
        {
          lerArquivo: (nome) => readFile(resolve(dir, nome)),
          putBinary,
          marcarFotoOk,
        },
      );
      resumos.push(resumo);

      const taxa = resumo.ms > 0 ? (resumo.subidas / (resumo.ms / 1000)).toFixed(1) : "—";
      console.log(
        `  ${uf}: ${n(resumo.jpegs)} jpegs · ${n(resumo.casaram)} casaram · ` +
          `${n(resumo.subidas)} subidas (${taxa} PUT/s) · ${n(resumo.puladasDelta)} delta · ` +
          `${n(resumo.falhas)} falhas · ${(resumo.ms / 1000).toFixed(1)}s`,
      );
    }
  } finally {
    client.release();
    await pool.end();
  }

  // ── resumo ────────────────────────────────────────────────────────────────
  const total = somarResumos(resumos);

  console.log(`\n=== Resumo ===`);
  console.log(
    `  sigla  jpegs  casaram  subidas   delta  falhas  s/linha  ñ-públ  públ-s/foto`.replace(
      /\s+$/,
      "",
    ),
  );
  for (const r of resumos) {
    console.log(
      `  ${r.uf.padEnd(5)} ${n(r.jpegs).padStart(6)} ${n(r.casaram).padStart(8)} ` +
        `${n(r.subidas).padStart(8)} ${n(r.puladasDelta).padStart(7)} ${n(r.falhas).padStart(7)} ` +
        `${n(r.semLinha).padStart(8)} ${n(r.naoPublicavel).padStart(7)} ${n(r.publicaveisSemFoto).padStart(12)}`,
    );
  }
  console.log(
    `  ${"TOTAL".padEnd(5)} ${n(total.jpegs).padStart(6)} ${n(total.casaram).padStart(8)} ` +
      `${n(total.subidas).padStart(8)} ${n(total.puladasDelta).padStart(7)} ${n(total.falhas).padStart(7)} ` +
      `${n(total.semLinha).padStart(8)} ${n(total.naoPublicavel).padStart(7)} ${n(total.publicaveisSemFoto).padStart(12)}`,
  );
  console.log("");
  console.log(`  publicáveis no escopo : ${n(total.publicaveis)}`);
  console.log(`  casaram com foto      : ${n(total.casaram)}`);
  console.log(
    `  publicáveis SEM foto  : ${n(total.publicaveisSemFoto)} ← avatar de fallback no card (RF-151)`,
  );
  console.log(
    `  foto sem linha        : ${n(total.semLinha)} (esperado: vice, suplente e dep. estadual/distrital — ` +
      `cargos fora do produto, não anomalia)`,
  );
  console.log(`  foto de não-publicável: ${n(total.naoPublicavel)} (ADR-0040 — nenhum byte subiu)`);
  console.log(`  nome fora do padrão   : ${n(total.foraDoPadrao)}`);
  console.log(`  não-imagem no ZIP     : ${n(total.naoImagem)} (leiame.pdf)`);
  console.log(`  falhas                : ${n(total.falhas)}`);
  for (const m of total.motivosFalha.slice(0, 10)) console.log(`    · ${m}`);
  console.log(`  bytes gravados        : ${mb(total.bytes)}`);
  const segundos = (Date.now() - t0) / 1000;
  console.log(
    `  tempo                 : ${segundos.toFixed(1)}s` +
      (total.subidas > 0 ? ` (${(total.subidas / segundos).toFixed(1)} PUT/s médio)` : ""),
  );
  if (cli.dryRun) console.log(`  ⚠️  DRY-RUN — nada foi gravado no Blob nem no banco.`);
}

// Só roda como CLI. O `import` do teste precisa do módulo sem o efeito colateral
// — é o que separa este arquivo de `candidatos-import.ts`, que chama `main()`
// incondicionalmente e por isso não pode ser importado por nenhum teste.
const ehEntrypoint =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (ehEntrypoint) {
  main().catch((err) => {
    console.error("Falha em candidatos-fotos-import:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
