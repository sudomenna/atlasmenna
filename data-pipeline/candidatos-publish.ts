// data-pipeline/candidatos-publish.ts
//
// **O publicador** — leva as candidaturas de `candidatos` (Postgres) para o
// Vercel Blob, na forma exata de `lib/blob/candidatos.ts` (spec 018,
// RF-146/RF-150; ADR-0039, ADR-0040, ADR-0041, ADR-0042).
//
// É a peça entre o banco e a tela. `candidatos-import.ts` termina no Postgres;
// `readCandidatosUf` começa no Blob. Sem este script não existe nada entre os
// dois, e `/candidatos` responderia `unavailable: not_found` para o país
// inteiro.
//
// ─── O contrato é de OUTRO arquivo, e isso é deliberado ─────────────────────
//
// `CandidatosUfSlice` e `CandidatoIdentidade` moram em `lib/blob/candidatos.ts`
// — do lado do **consumidor**. Este produtor importa aqueles tipos em vez de
// redeclarar os seus: uma segunda declaração "equivalente" é como produtor e
// consumidor divergem em silêncio, e o `tsc` não teria nada a dizer sobre isso.
// O teste de `tests/unit/data-pipeline/candidatos-publish.test.ts` fecha a
// última fresta rodando o objeto produzido pelo guard real do consumidor
// (`readCandidatosUf`): se um campo sumir, a leitura devolve `invalid`.
//
// ─── Roda FORA do request path ──────────────────────────────────────────────
//
// Como `candidatos-import`, `eleitorado-import` e `zonas-import`: a cadência é
// humana (diária → 2–3 dias → obrigatória em 02–03/10, ADR-0040), não de
// minuto a minuto, e ~110 fatias contra o Blob não cabem no `maxDuration` de
// uma função Vercel com folga nenhuma.
//
// ─── Ordem de escrita: fatias primeiro, índice por último ───────────────────
//
// Design 018 § D10, item 5: o índice **é o que torna a publicação visível**
// (`candidatos/index.json` é a base de comparação do RF-152 e o que a página
// `/candidatos` lê para montar filtros e carimbo de frescor). Escrevê-lo antes
// das fatias publicaria um índice que promete fatias que ainda não existem —
// e o consumidor não tem como distinguir isso de "importador não rodou".
//
// ─── Uso ────────────────────────────────────────────────────────────────────
//
//   set -a; . ./.env.local; set +a
//   pnpm candidatos:publish
//   pnpm candidatos:publish -- --uf SP,RJ --cargo 6
//   pnpm candidatos:publish -- --dry-run
//
//   pnpm tsx data-pipeline/candidatos-publish.ts --uf SP
//
// ⚠️ **Roda em `tsx`, não em `node --experimental-strip-types`** — ao contrário
// dos irmãos `candidatos-import`, `eleitorado-import` e `zonas-import`. O
// motivo não é estilo: este é o primeiro script de `data-pipeline/` que importa
// `lib/blob/write.ts`, e aquele módulo importa `@/lib/tse/log`. O loader de
// strip-types do Node não resolve o alias `@/` do `tsconfig.json`, então a
// importação falha com `ERR_MODULE_NOT_FOUND` antes de qualquer linha rodar. É
// a mesma limitação que `zonas-import.ts` contorna duplicando o `USER_AGENT` à
// mão. `tsx` já é o runner de `edge-config:smoke`, `list-targets` e
// `replay-2022`, que importam de `@/lib/` pelo mesmo motivo — não é um quarto
// padrão, é o padrão que este caso exige.
//
// Pré-requisitos: migration 0008 aplicada, `candidatos-import.ts` rodado, e
// `BLOB_READ_WRITE_TOKEN` no ambiente. Sem o token, `putJson` é no-op com aviso
// (ver `lib/blob/write.ts`) — o ciclo termina sem erro e sem publicar nada, que
// é o comportamento certo em preview/CI, mas NÃO é o que você quer localmente.

import { fileURLToPath } from "node:url";
import type { CandidatoIdentidade, CandidatosUfSlice } from "@/lib/blob/candidatos";
import {
  blobUrlFor,
  candidatosIndexBlobPathname,
  candidatosUfBlobPathname,
} from "@/lib/blob/paths";
import { hasBlobWriteCredentials, putJson } from "@/lib/blob/write";
import { type CargoTse, cargoInfo, cargoToken, isCargoTse } from "@/lib/config/cargos";
import { getPool } from "./_tse-common.ts";
import { ANO_PLEITO, CARGOS_PRODUTO } from "./candidatos-parse.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uma linha de `candidatos` como este script a lê — exatamente as colunas que
 * a fatia publicada consome, e **nenhuma a mais**.
 *
 * O recorte é a conformidade de PII, pela mesma lógica de `CandidatoRow` em
 * `candidatos-parse.ts`: a tabela não tem coluna de PII (migration 0008 barra
 * isso), mas um `SELECT *` aqui convidaria a próxima coluna a viajar até o CDN
 * sem ninguém decidir que ela devia (constituição § 5, RNF-019).
 */
export interface CandidatoDbRow {
  /** `bigint` no Postgres — lido como `::text` para não passar por `number`. */
  sq_candidato: string;
  cargo: number;
  uf: string;
  numero: number;
  nome: string;
  nome_urna: string;
  partido_sigla: string;
  federacao_sigla: string | null;
  coligacao_nome: string | null;
  situacao_julgamento: string;
  foto_ok: boolean;
  /**
   * ADR-0040, fail-closed. Está aqui — e não só no `WHERE` da query — de
   * propósito; ver {@link montarFatia}.
   */
  publicavel: boolean;
  /** `Last-Modified` do ZIP do TSE, como `candidatos-import` o gravou. */
  fonte_ts: string;
}

/**
 * O JSON de `candidatos/index.json`.
 *
 * Existe para a página `/candidatos` montar filtros e o carimbo de frescor
 * **sem sondar 100+ objetos** e sem ter de interpretar 404 — um 404 de fatia é
 * ambíguo entre "esta UF não tem este cargo" e "o publicador não rodou", e a
 * diferença importa para o leitor (constituição § 8, `lib/blob/paths.ts`).
 */
export interface CandidatosIndex {
  /** Instante do dado na FONTE — o `Last-Modified` do ZIP do TSE (RF-150). */
  fonte_ts: string;
  /** Instante da NOSSA gravação. Relógio distinto de `fonte_ts` (ADR-0038). */
  gerado_ts: string;
  /** Σ de todas as contagens de `por_cargo_uf`. Baseline 13/09: 7.698. */
  total: number;
  /**
   * `{ <token de cargo>: { <SIGLA UF>: <publicáveis> } }` — ex.
   * `{ "dep": { "SP": 1061, … }, "pres": { "BR": 12 } }`.
   *
   * A chave de cargo é o **token** (`pres`/`gov`/`sen`/`dep`), não o código
   * numérico, porque é com ele que o consumidor monta o caminho da fatia
   * (`candidatosUfBlobPathname(uf, cargo)`) e o campo `cargo` do corpo da
   * fatia. Um índice em código numérico obrigaria cada leitor a converter, e
   * conversor de cargo espalhado é exatamente onde este repositório já perdeu
   * payload inteiro para a chave errada.
   */
  por_cargo_uf: Record<string, Record<string, number>>;
}

/** O que uma fatia montada carrega até a hora de escrever. */
export interface FatiaPreparada {
  uf: string;
  cargo: CargoTse;
  pathname: string;
  slice: CandidatosUfSlice;
  /** Bytes UTF-8 reais do corpo — ver a nota de unidade em {@link tamanhoBytes}. */
  bytes: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Regras puras
// ─────────────────────────────────────────────────────────────────────────────

/** O único valor de `DS_SITUACAO_JULGAMENTO` que NÃO é ressalva. */
const SITUACAO_SEM_RESSALVA = "DEFERIDO";

/**
 * `sob_ressalva` — derivado **aqui**, na publicação, e nunca no componente.
 *
 * ## A regra
 *
 * Ressalva é tudo que não for **exatamente** `"DEFERIDO"`.
 *
 * ⚠️ Não é `startsWith("DEFERIDO")`. `"DEFERIDO EM PRAZO RECURSAL OU COM
 * RECURSO"` (84 candidaturas no arquivo de 12/09) **É** ressalva: o registro
 * está sob litígio, e é essa a informação que o leitor precisa ter. Um
 * `startsWith` — que é a regra certa em `candidatos-resolve.ts`, para outra
 * pergunta: "qual das duas candidaturas colididas prefiro" — apagaria as 84
 * daqui em silêncio.
 *
 * ## Por que mora neste arquivo
 *
 * O ADR-0040 proíbe usar a situação de julgamento como filtro e manda exibi-la
 * como texto honesto: **743 candidaturas estão na urna com registro indeferido
 * sob recurso, e recebem voto de eleitores reais em 04/10/2026**. Excluí-las
 * seria mentir por omissão sobre quem está na disputa; publicá-las sem sinal
 * seria escondê-las entre as 18.575 deferidas sem ressalva. A tela mostra as
 * duas coisas — nome E situação.
 *
 * Uma regra editorial dessa delicadeza não sobrevive espalhada em `if`s de
 * JSX, onde cada tela a interpretaria à sua maneira e a próxima cairia no
 * `startsWith`. Mora num lugar só, e este é o lugar.
 *
 * ## Fail-closed também aqui
 *
 * Valor desconhecido, vazio ou novo do TSE → `true`. A situação de julgamento
 * tem **9 valores distintos** no arquivo de 12/09, e a primeira redação do
 * ADR-0040 conhecia só 8 — uma lista de valores conhecidos já nasceu
 * incompleta. O default conservador aqui exibe uma ressalva a mais, que é
 * visível e corrigível; o default otimista esconderia um litígio, que não é.
 */
export function sobRessalva(situacaoJulgamento: string): boolean {
  return situacaoJulgamento.trim().toUpperCase() !== SITUACAO_SEM_RESSALVA;
}

/** Vazio, espaço ou sentinela do TSE viram ausência — nunca string vazia na fatia. */
function opcional(v: string | null): string | undefined {
  if (v === null) return undefined;
  const s = v.trim();
  if (!s || s === "#NULO" || s === "#NULO#" || s === "#NE") return undefined;
  return s;
}

/**
 * `NM_COLIGACAO` **não é um nome de coligação em 97,5% das linhas** — é um de
 * dois rótulos que dizem que coligação não existe. Medido em 2026-09-13 nas
 * 7.698 candidaturas publicáveis:
 *
 * | `coligacao_nome` | linhas | o que significa de verdade |
 * |---|---|---|
 * | `PARTIDO ISOLADO` | 5.246 (68,1%) | não há coligação **nem** federação |
 * | `FEDERAÇÃO` | 2.259 (29,3%) | o agrupamento é federação, não coligação |
 * | nome próprio | 193 (2,5%, 91 distintos) | coligação de verdade |
 * | `NULL` | 0 | o TSE sempre preenche a coluna |
 *
 * O contrato de `lib/blob/candidatos.ts` diz `coligacao?: string`, "ausente
 * quando a candidatura não integra coligação". Copiar a coluna crua faria
 * **7.505 cards** exibirem "Coligação: PARTIDO ISOLADO" ou "Coligação:
 * FEDERAÇÃO" — texto falso mostrado ao leitor (constituição § 8), e no segundo
 * caso redundante com o campo `federacao`, que já carrega a sigla real.
 * Verificado: as 2.259 linhas `FEDERAÇÃO` têm `federacao_sigla` preenchida em
 * **100%** dos casos, e as 5.246 `PARTIDO ISOLADO` têm `NULL` em 100% — nada
 * se perde ao omitir.
 *
 * ⚠️ A comparação é de **igualdade exata**, nunca prefixo ou `includes`. Medido:
 * nenhuma das 91 coligações reais começa com `FEDERA` nem contém `ISOLADO`. Um
 * `startsWith` apagaria em silêncio uma coligação futura chamada "FEDERAÇÃO DO
 * POVO PARAENSE" — que é a forma como este tipo de filtro erra.
 */
const ROTULOS_SEM_COLIGACAO = new Set(["PARTIDO ISOLADO", "FEDERAÇÃO"]);

function coligacaoReal(v: string | null): string | undefined {
  const s = opcional(v);
  if (s === undefined) return undefined;
  return ROTULOS_SEM_COLIGACAO.has(s.toUpperCase()) ? undefined : s;
}

/**
 * Uma linha do banco → uma candidatura publicada.
 *
 * `federacao` e `coligacao` são **omitidos** quando ausentes, e não emitidos
 * como `null`: o contrato de `lib/blob/candidatos.ts` os declara opcionais
 * (`federacao?: string`), e um `null` ali seria um terceiro estado que o
 * consumidor não declara aceitar.
 */
export function montarCandidato(row: CandidatoDbRow): CandidatoIdentidade {
  const candidato: CandidatoIdentidade = {
    // `string`, jamais `Number(...)`: são 11 ou 12 dígitos, `bigint` no banco,
    // e é a chave que endereça a foto. Converter é convidar perda de precisão
    // que só apareceria como candidato trocado (ADR-0042).
    sqcand: row.sq_candidato,
    numero: row.numero,
    nome_urna: row.nome_urna,
    nome: row.nome,
    partido: row.partido_sigla,
    situacao_julgamento: row.situacao_julgamento,
    sob_ressalva: sobRessalva(row.situacao_julgamento),
    foto_ok: row.foto_ok,
  };
  const federacao = opcional(row.federacao_sigla);
  if (federacao !== undefined) candidato.federacao = federacao;
  const coligacao = coligacaoReal(row.coligacao_nome);
  if (coligacao !== undefined) candidato.coligacao = coligacao;
  return candidato;
}

/**
 * Ordem de publicação: **número de urna crescente**.
 *
 * Constituição § 6 (determinismo) e § 2 (neutralidade — "nomes e siglas
 * aparecem sempre na mesma ordem dentro de uma mesma corrida"). Ordenar por
 * percentual, por nome ou por partido introduziria um critério editorial onde
 * não deve haver nenhum: quem lidera a grade não pode depender de quem lidera
 * a apuração, nem de onde a letra cai no alfabeto.
 *
 * O desempate por `sq_candidato` **não é cosmético**: `(cargo, uf, numero)`
 * colide 4× no dado real do TSE (ADR-0042, migration 0008), e sem segundo
 * critério a ordem dessas quatro fatias dependeria da ordem em que o Postgres
 * devolveu as linhas — o mesmo banco produzindo dois arquivos diferentes.
 * Comparado como `BigInt` porque o sequencial tem 11 OU 12 dígitos e comparação
 * de texto entre larguras diferentes ordena errado.
 */
function ordenarPorNumero(a: CandidatoIdentidade, b: CandidatoIdentidade): number {
  if (a.numero !== b.numero) return a.numero - b.numero;
  const sa = BigInt(a.sqcand);
  const sb = BigInt(b.sqcand);
  if (sa === sb) return 0;
  return sa < sb ? -1 : 1;
}

/**
 * Monta a fatia de UMA UF e UM cargo, no tipo exato de `lib/blob/candidatos.ts`.
 *
 * ## O filtro de publicabilidade está aqui, e não só no `WHERE`
 *
 * ADR-0040 é fail-closed: a ausência de sinal claro nunca resulta em
 * publicação. A query já traz só `publicavel = true` — por eficiência, não por
 * correção. Este filtro é o que **garante** a regra no ponto onde o dado vira
 * arquivo público: um `--uf` novo, um refactor de SQL ou um caller que monte a
 * fatia a partir de outra fonte não conseguem publicar uma candidatura fora da
 * urna sem passar por aqui. Não remover por parecer redundante — não é: as
 * 1.532 candidaturas não publicáveis (7,3%) são justamente as que não podem
 * chegar à tela.
 *
 * `fonte_ts` sai do **maior** `fonte_ts` das linhas da fatia: é o instante do
 * dado na origem, e se uma reimportação parcial deixou linhas de dois ciclos
 * na mesma fatia, a data honesta é a mais recente representada ali.
 */
export function montarFatia(
  uf: string,
  cargo: CargoTse,
  rows: readonly CandidatoDbRow[],
  geradoTs: string,
): CandidatosUfSlice {
  const publicaveis = rows.filter((r) => r.publicavel);

  let fonteTs = "";
  for (const r of publicaveis) {
    if (r.fonte_ts > fonteTs) fonteTs = r.fonte_ts;
  }

  return {
    uf: uf.toUpperCase(),
    // `cargoToken` é o conversor único (`lib/config/cargos.ts`). Nunca um
    // ternário local do tipo `cargo === 3 ? "gov" : "pres"` — esse padrão já
    // mandou o payload de Senador inteiro para a chave do Presidente.
    cargo: cargoToken(cargo),
    fonte_ts: fonteTs,
    gerado_ts: geradoTs,
    candidatos: publicaveis.map(montarCandidato).sort(ordenarPorNumero),
  };
}

/**
 * Monta `candidatos/index.json` a partir das fatias efetivamente preparadas.
 *
 * `total` é a soma das contagens das próprias fatias — **não** uma contagem
 * separada do banco. Contar duas vezes o mesmo fato por dois caminhos
 * diferentes é como um índice passa a prometer um número que as fatias não
 * entregam; aqui é impossível por construção.
 */
export function montarIndice(
  fatias: readonly { uf: string; cargo: CargoTse; slice: CandidatosUfSlice }[],
  geradoTs: string,
): CandidatosIndex {
  const porCargoUf: Record<string, Record<string, number>> = {};
  let total = 0;
  let fonteTs = "";

  for (const f of fatias) {
    const token = cargoToken(f.cargo);
    let porUf = porCargoUf[token];
    if (porUf === undefined) {
      porUf = {};
      porCargoUf[token] = porUf;
    }
    porUf[f.uf.toUpperCase()] = f.slice.candidatos.length;
    total += f.slice.candidatos.length;
    if (f.slice.fonte_ts > fonteTs) fonteTs = f.slice.fonte_ts;
  }

  return { fonte_ts: fonteTs, gerado_ts: geradoTs, total, por_cargo_uf: porCargoUf };
}

/**
 * Bytes UTF-8 **reais** do corpo serializado.
 *
 * Difere de propósito do `bytes` que `putJson` devolve, que é `body.length` —
 * comprimento em unidades UTF-16, ~0,1% abaixo da contagem real com nomes
 * acentuados (e a fatia é feita de nomes acentuados). Os dois números aparecem
 * no resumo; o que se compara com o `content-length` de um `curl` é este.
 */
export function tamanhoBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recorte explícito de colunas — nunca `SELECT *` (ver {@link CandidatoDbRow}).
 *
 * `WHERE publicavel` é a primeira linha de defesa do ADR-0040; a segunda, a que
 * de fato garante a regra, está em {@link montarFatia}.
 *
 * `ORDER BY` aqui é para o agrupamento ficar previsível na leitura do log — a
 * ordem que vai para o arquivo é decidida por {@link ordenarPorNumero}, e não
 * pela ordem de chegada do Postgres.
 */
const SELECT_PUBLICAVEIS_SQL = `
  SELECT sq_candidato::text        AS sq_candidato,
         cargo,
         uf,
         numero,
         nome,
         nome_urna,
         partido_sigla,
         federacao_sigla,
         coligacao_nome,
         situacao_julgamento,
         foto_ok,
         publicavel,
         fonte_ts
    FROM candidatos
   WHERE ano = $1
     AND publicavel
     AND cargo = ANY($2::int2[])
     AND ($3::text[] IS NULL OR uf = ANY($3::text[]))
   ORDER BY cargo, uf, numero, sq_candidato
`;

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

interface Cli {
  /** `null` = todas. Siglas em maiúscula; `"BR"` é válido (cargo 1). */
  ufs: string[] | null;
  cargos: CargoTse[];
  dryRun: boolean;
}

function parseListaCargos(raw: string): CargoTse[] {
  const out: CargoTse[] = [];
  for (const item of raw.split(",")) {
    const s = item.trim();
    if (!s) continue;
    // Código numérico do TSE (1/3/5/6/7/8) ou token de chave
    // (pres/gov/sen/dep/est/dis).
    // Lookup explícito nos dois casos — nada de `?? "pres"`, que é como um
    // valor não reconhecido viraria Presidente em silêncio.
    const n = Number(s);
    if (Number.isInteger(n) && isCargoTse(n)) {
      out.push(n);
      continue;
    }
    const porToken = CARGOS_PRODUTO.find((c) => cargoInfo(c).token === s.toLowerCase());
    if (porToken === undefined) {
      throw new Error(
        `--cargo não reconhece "${s}". Aceita código (${CARGOS_PRODUTO.join(", ")}) ` +
          `ou token (${CARGOS_PRODUTO.map((c) => cargoInfo(c).token).join(", ")}).`,
      );
    }
    out.push(porToken);
  }
  if (out.length === 0) throw new Error("--cargo exige ao menos um cargo");
  return [...new Set(out)];
}

function parseListaUfs(raw: string): string[] {
  const out = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  for (const uf of out) {
    if (!/^[A-Z]{2}$/.test(uf)) {
      throw new Error(`--uf não reconhece "${uf}". Esperado sigla de 2 letras (ex.: SP, BR).`);
    }
  }
  if (out.length === 0) throw new Error("--uf exige ao menos uma sigla");
  return [...new Set(out)];
}

export function parseCli(argv: readonly string[]): Cli {
  const cli: Cli = { ufs: null, cargos: [...CARGOS_PRODUTO], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--uf") {
      const v = argv[i + 1];
      if (!v) throw new Error("--uf exige uma lista de siglas (ex.: --uf SP,RJ)");
      cli.ufs = parseListaUfs(v);
      i++;
    } else if (a === "--cargo") {
      const v = argv[i + 1];
      if (!v) throw new Error("--cargo exige uma lista de cargos (ex.: --cargo 5,6)");
      cli.cargos = parseListaCargos(v);
      i++;
    } else if (a === "--dry-run") {
      cli.dryRun = true;
    } else if (a?.startsWith("--")) {
      throw new Error(`Flag desconhecida: ${a}`);
    }
  }
  return cli;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

/** Agrupa as linhas por `(cargo, uf)` preservando a ordem de chegada. */
function agrupar(rows: readonly CandidatoDbRow[]): Map<string, CandidatoDbRow[]> {
  const grupos = new Map<string, CandidatoDbRow[]>();
  for (const r of rows) {
    const k = `${r.cargo}|${r.uf.trim().toUpperCase()}`;
    const cur = grupos.get(k);
    if (cur) cur.push(r);
    else grupos.set(k, [r]);
  }
  return grupos;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const cli = parseCli(process.argv.slice(2));
  const geradoTs = new Date().toISOString();

  console.log(`[candidatos-publish] iniciando${cli.dryRun ? " — DRY RUN (nada é escrito)" : ""}`);
  console.log(
    `  cargos                : ${cli.cargos.map((c) => `${c} (${cargoToken(c)})`).join(", ")}`,
  );
  console.log(`  ufs                   : ${cli.ufs ? cli.ufs.join(", ") : "todas"}`);
  if (!hasBlobWriteCredentials()) {
    console.warn(
      "  ⚠️  BLOB_READ_WRITE_TOKEN ausente — `putJson` vira no-op e NADA será publicado.\n" +
        "     Rode `set -a; . ./.env.local; set +a` antes.",
    );
  }

  const pool = getPool();
  let preparadas: FatiaPreparada[];
  try {
    // `timestamptz` volta do driver como `Date`, não como string — daí o
    // `Omit` em vez de reusar `CandidatoDbRow` cru: quem monta a fatia recebe
    // a data já normalizada em ISO, e a normalização fica num lugar só.
    const { rows } = await pool.query<
      Omit<CandidatoDbRow, "fonte_ts"> & { fonte_ts: Date | string }
    >(SELECT_PUBLICAVEIS_SQL, [ANO_PLEITO, cli.cargos, cli.ufs]);
    console.log(`  linhas publicáveis    : ${rows.length.toLocaleString("pt-BR")}`);
    if (rows.length === 0) {
      throw new Error(
        "Nenhuma candidatura publicável para este recorte. " +
          "Rode `pnpm candidatos:import` antes (ou revise --uf/--cargo).",
      );
    }

    const normalizadas: CandidatoDbRow[] = rows.map((r) => ({
      ...r,
      uf: r.uf.trim().toUpperCase(),
      fonte_ts: r.fonte_ts instanceof Date ? r.fonte_ts.toISOString() : String(r.fonte_ts),
    }));

    preparadas = [];
    for (const [chave, grupo] of agrupar(normalizadas)) {
      const [cargoRaw, uf] = chave.split("|");
      const cargoNum = Number(cargoRaw);
      if (!isCargoTse(cargoNum)) {
        // Inalcançável pelo `WHERE cargo = ANY(...)`; a guarda existe porque um
        // cargo fora dos quatro cobertos não pode virar caminho de Blob por
        // acidente — `cargoToken` lançaria, mas depois de já ter montado a fatia.
        throw new Error(`[publish] cargo não coberto veio do banco: ${cargoRaw}`);
      }
      if (!uf) throw new Error(`[publish] grupo sem UF: ${chave}`);
      const slice = montarFatia(uf, cargoNum, grupo, geradoTs);
      preparadas.push({
        uf,
        cargo: cargoNum,
        pathname: candidatosUfBlobPathname(uf, slice.cargo),
        slice,
        bytes: tamanhoBytes(slice),
      });
    }
  } finally {
    await pool.end();
  }

  preparadas.sort((a, b) => a.cargo - b.cargo || a.uf.localeCompare(b.uf));
  const indice = montarIndice(preparadas, geradoTs);
  const indicePathname = candidatosIndexBlobPathname();
  const indiceBytes = tamanhoBytes(indice);

  // ── escrita: fatias primeiro, índice por último (design 018 § D10) ────────
  let escritas = 0;
  let puladas = 0;
  if (!cli.dryRun) {
    for (const f of preparadas) {
      const res = await putJson(f.pathname, f.slice);
      if (res.status === "written") escritas++;
      else puladas++;
    }
    const res = await putJson(indicePathname, indice);
    if (res.status === "written") escritas++;
    else puladas++;
  }

  // ── resumo ────────────────────────────────────────────────────────────────
  const n = (v: number) => v.toLocaleString("pt-BR");
  const kb = (v: number) => `${(v / 1024).toFixed(1)} KB`;
  const maior = preparadas.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  const totalBytes = preparadas.reduce((a, f) => a + f.bytes, 0) + indiceBytes;
  const comRessalva = preparadas.reduce(
    (a, f) => a + f.slice.candidatos.filter((c) => c.sob_ressalva).length,
    0,
  );
  const comFoto = preparadas.reduce(
    (a, f) => a + f.slice.candidatos.filter((c) => c.foto_ok).length,
    0,
  );

  console.log(`\n=== Resumo ===`);
  console.log(`  fatias preparadas     : ${n(preparadas.length)}`);
  console.log(
    `  fatias escritas       : ${cli.dryRun ? "0 (dry-run)" : n(escritas)}${puladas > 0 ? ` · ${n(puladas)} puladas (sem credencial)` : ""}`,
  );
  console.log(`  candidaturas          : ${n(indice.total)}`);
  console.log(
    `  sob ressalva          : ${n(comRessalva)} (${((comRessalva / indice.total) * 100).toFixed(1).replace(".", ",")}%) — ADR-0040: texto, nunca filtro`,
  );
  console.log(`  com foto (foto_ok)    : ${n(comFoto)}`);
  console.log(`  fonte_ts              : ${indice.fonte_ts} (Last-Modified do ZIP do TSE)`);
  console.log(`  gerado_ts             : ${indice.gerado_ts}`);
  console.log(
    `  maior fatia           : ${maior.pathname} — ${n(maior.slice.candidatos.length)} candidaturas, ${kb(maior.bytes)} (${n(maior.bytes)} B)`,
  );
  console.log(`  índice                : ${indicePathname} — ${kb(indiceBytes)}`);
  console.log(`  total gravado         : ${kb(totalBytes)}`);
  console.log("  candidaturas por cargo:");
  for (const cargo of cli.cargos) {
    const porUf = indice.por_cargo_uf[cargoToken(cargo)];
    if (!porUf) continue;
    const soma = Object.values(porUf).reduce((a, v) => a + v, 0);
    console.log(
      `    ${cargo} (${cargoToken(cargo)}): ${n(soma)} em ${n(Object.keys(porUf).length)} UFs`,
    );
  }
  const url = blobUrlFor(maior.pathname);
  if (url) console.log(`  conferir              : curl -sI ${url}`);
  console.log(`  tempo                 : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// Só executa quando invocado como script. Sem esta guarda, `import` num teste
// dispararia o ciclo inteiro contra o banco e o Blob reais.
const invocadoComoScript =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === fileURLToPath(`file://${process.argv[1]}`);

if (invocadoComoScript) {
  main().catch((err) => {
    console.error("Falha em candidatos-publish:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
