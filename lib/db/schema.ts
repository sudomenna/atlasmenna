// Schema Postgres canônico do AtlasMenna.
// Fonte de verdade: docs/architecture/data-model.md.
// IMPORTANTE: snapshots é append-only (constituição § 10). Nunca UPDATE/DELETE.
// PostGIS (GEOGRAPHY) é tratado como text aqui — migração inicial habilita a extensão
// e altera a coluna; Drizzle não tem helper nativo nessa versão.

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Histórico de eleições GERAIS (Presidente + Governador) — 2018 e 2022.
 * NÃO inclui 2024 (pleito municipal, fora de escopo).
 */
export const historicalResults = pgTable(
  "historical_results",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ano: smallint("ano").notNull(), // 2018, 2022
    turno: smallint("turno").notNull(), // 1, 2
    cargo: smallint("cargo").notNull(), // 1 = Presidente, 3 = Governador
    uf: char("uf", { length: 2 }).notNull(),
    codMunicipioTse: integer("cod_municipio_tse"),
    codZona: integer("cod_zona").notNull(),
    codCandidato: integer("cod_candidato").notNull(),
    nomeCandidato: text("nome_candidato"),
    partido: varchar("partido", { length: 20 }),
    votos: integer("votos").notNull(),
    pctValidos: numeric("pct_validos", { precision: 8, scale: 5 }),
    pctTotal: numeric("pct_total", { precision: 8, scale: 5 }),
  },
  (t) => [
    uniqueIndex("uq_historical_results").on(
      t.ano,
      t.turno,
      t.cargo,
      t.uf,
      t.codZona,
      t.codCandidato,
    ),
    index("ix_hist_lookup").on(t.ano, t.turno, t.cargo, t.uf, t.codZona),
  ],
);

/**
 * Eleitorado por **par (município × zona)** — atualizado para 2026.
 *
 * Migration 0006 (ADR-0035 D1): a PK era `(ano, uf, cod_zona)`, o que obrigava
 * o importador a creditar a zona inteira a um único município. Como 62,5 % das
 * zonas cobrem de 2 a 8 municípios, isso punha 26,1 % do eleitorado sob rótulo
 * errado (`docs/_meta/diagnostico-colapso-zona-municipio-2026-09-10.md`).
 * A chave passa a ser o par; o total por zona é `SUM(...) GROUP BY uf, cod_zona`
 * e o total por município, `GROUP BY uf, cod_municipio_tse`.
 */
export const eleitorado = pgTable(
  "eleitorado",
  {
    ano: smallint("ano").notNull(),
    uf: char("uf", { length: 2 }).notNull(),
    codMunicipioTse: integer("cod_municipio_tse").notNull(),
    codZona: integer("cod_zona").notNull(),
    eleitoresAptos: integer("eleitores_aptos").notNull(),
    comparecimentoPctHistorico: numeric("comparecimento_pct_historico", {
      precision: 5,
      scale: 4,
    }),
  },
  (t) => [primaryKey({ columns: [t.ano, t.uf, t.codMunicipioTse, t.codZona] })],
);

/**
 * Mesorregiões IBGE — dimensão intermediária entre UF e município.
 * Criada pela migration 0005; consumida por `aggregate_by_mesorregiao`
 * (api/model/project.py) no bloco "Apuração por mesorregião" da página
 * `/uf/[sigla]/governador` (spec 005).
 *
 * `cod` é o código IBGE de 4 dígitos (UF[2] + meso[2]). Ex.: 3510 = SP / Itapeva.
 */
export const mesorregioes = pgTable(
  "mesorregioes",
  {
    cod: char("cod", { length: 4 }).primaryKey(),
    nome: text("nome").notNull(),
    ufSigla: char("uf_sigla", { length: 2 }).notNull(),
  },
  (t) => [index("ix_meso_uf").on(t.ufSigla)],
);

/**
 * Mapeamento geográfico — municípios.
 * geoCentroid é GEOGRAPHY(POINT) no SQL; migração inicial cria a extensão PostGIS
 * e altera o tipo da coluna após drizzle gerar como text.
 */
export const municipios = pgTable(
  "municipios",
  {
    codIbge: char("cod_ibge", { length: 7 }).primaryKey(),
    codMunicipioTse: integer("cod_municipio_tse").notNull().unique(),
    uf: char("uf", { length: 2 }).notNull(),
    nome: text("nome").notNull(),
    geoCentroid: text("geo_centroid"), // PostGIS GEOGRAPHY(POINT) — ver nota acima
    populacao: integer("populacao"),
    /** Migration 0005 — FK para `mesorregioes.cod`. NULL enquanto o CSV IBGE não chega. */
    mesorregiaoCod: char("mesorregiao_cod", { length: 4 }).references(() => mesorregioes.cod),
    /**
     * Migration 0006 — capital da UF. Seed estático das 27 capitais por
     * `cod_ibge`; `zonas-import.ts --ea12` reescreve a partir de `mu[].c` do
     * EA12 quando o arquivo 2026 existir. Usado pela ordenação do painel
     * "Maiores colégios eleitorais" (capital primeiro — decisão E4).
     */
    capital: boolean("capital").notNull().default(false),
  },
  (t) => [index("ix_municipio_uf").on(t.uf), index("ix_municipio_meso").on(t.mesorregiaoCod)],
);

/**
 * Tabela de **pares (município × zona)** — apesar do nome herdado, uma linha
 * aqui é um par, não uma zona.
 *
 * Migration 0006 (ADR-0035 D1; emenda o ADR-0002, que fixara `(uf, cod_zona)`):
 * o TSE 2026 publica um EA20 por par (`<uf><mun5>-z<zona4>-c<cargo>-…`), e
 * enumerar alvos a partir de uma linha por zona pediria ~2.651 dos ~6.085
 * arquivos — perdendo ~56 % dos votos sem nenhum 404. O nome da tabela foi
 * mantido para não trocar `schema.zonas` em cinco lugares.
 *
 * `fonte` registra de onde o par veio: `'ea12'` (arquivo de configuração de
 * municípios do TSE) ou `'csv'` (fallback derivado de `eleitorado`).
 */
export const zonas = pgTable(
  "zonas",
  {
    uf: char("uf", { length: 2 }).notNull(),
    codMunicipioTse: integer("cod_municipio_tse")
      .notNull()
      .references(() => municipios.codMunicipioTse),
    codZona: integer("cod_zona").notNull(),
    nome: text("nome"),
    fonte: text("fonte"),
  },
  (t) => [
    primaryKey({ columns: [t.uf, t.codMunicipioTse, t.codZona] }),
    index("ix_zona_uf").on(t.uf),
  ],
);

/**
 * Snapshots APPEND-ONLY do TSE durante apuração.
 * Constituição § 10: nunca UPDATE/DELETE. Habilita replay e auditoria.
 */
export const snapshots = pgTable(
  "snapshots",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    cargo: smallint("cargo").notNull(),
    turno: smallint("turno").notNull(),
    uf: char("uf", { length: 2 }).notNull(),
    /**
     * Migration 0006 (ADR-0035 D1) — município do par. Sentinel `0` para
     * abrangências que não têm município (BR, UF), como já se faz com
     * `cod_zona`. `ADD COLUMN ... NOT NULL DEFAULT 0` é só metadado no
     * Postgres ≥ 11: nenhuma linha existente foi reescrita (§ 10).
     */
    codMunicipioTse: integer("cod_municipio_tse").notNull().default(0),
    codZona: integer("cod_zona").notNull(),
    /**
     * Migration 0010 (spec 021, RF-199) — abrangência da linha:
     * `"zona"` | `"uf"` | `"br"`. Antes desta coluna, o único jeito de
     * distinguir uma linha agregada era o sentinela `cod_zona = 0` — e o
     * pipeline nunca chegou a produzir uma, porque os 4 cargos ingerem só
     * `"zona"` (`lib/config/cargos.ts`). Agora que `listIngestTargets`
     * soma os alvos agregados de UF/BR aos de zona em produção
     * (`lib/tse/targets.ts`), a linha precisa se declarar — sem isto ela
     * cairia de volta no mesmo sentinela ambíguo. `NOT NULL DEFAULT 'zona'`
     * (não anulável, ao contrário de `pct_atual`/0009): isto não é uma
     * medição que pode faltar, é a NATUREZA da linha, e toda linha gravada
     * até hoje sempre foi de zona — `ADD COLUMN` com default constante
     * continua sendo só metadado em Postgres ≥ 11 (§ 10 intacto).
     */
    nivel: varchar("nivel", { length: 4 }).notNull().default("zona"),
    etag: text("etag"), // ETag do TSE para dedup
    pctApurado: numeric("pct_apurado", { precision: 5, scale: 2 }),
    votosTotal: integer("votos_total"),
    payload: jsonb("payload").notNull(), // EA20 cru
    hashPayload: char("hash_payload", { length: 64 }).notNull(), // SHA256
  },
  (t) => [
    // Índice da chave antiga — mantido: consultas por zona inteira continuam
    // existindo (o estimador é por zona, ADR-0021/0023).
    index("ix_snap_lookup").on(t.cargo, t.turno, t.uf, t.codZona, t.ts),
    index("ix_snap_lookup_par").on(t.cargo, t.turno, t.uf, t.codMunicipioTse, t.codZona, t.ts),
    index("ix_snap_ts").on(t.ts),
  ],
);

/**
 * Cálculos de projeção (histórico do modelo).
 *
 * Constituição § 10 — append-only. Nunca UPDATE/DELETE; cada ciclo do modelo
 * gera novas rows com `ts` distinto. Replay = `SELECT ... ORDER BY ts`.
 *
 * S05/F4c (ADR-0014, ADR-0015) — colunas multi-candidato:
 *   - `modelFallbackTier` — **@deprecated desde o ADR-0021**, que supersede o
 *     ADR-0015. Registrava qual tier do K-1 fallback (mapeamento 2022→2026)
 *     tinha sido usado na linha; esse fallback deixou de existir junto com o
 *     swing. A coluna fica no schema sem migration de remoção e sem escritor
 *     — nenhum consumidor a lê.
 *   - `cenario2tJson`: dump JSON do `cenarios_2t` (top-3 pares mais prováveis)
 *     na hora do snapshot — usado pra reconstruir histórico do "termômetro
 *     de cenários 2T" sem precisar dos resamples originais. NULL nas
 *     linhas UF (só faz sentido no nacional, `uf IS NULL`).
 */
export const projections = pgTable(
  "projections",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    cargo: smallint("cargo").notNull(),
    turno: smallint("turno").notNull(),
    uf: char("uf", { length: 2 }), // NULL = nacional
    candidatoId: integer("candidato_id").notNull(),
    votosProjetados: bigint("votos_projetados", { mode: "bigint" }),
    pctProjetado: numeric("pct_projetado", { precision: 8, scale: 5 }),
    pctProjetadoLower: numeric("pct_projetado_lower", { precision: 8, scale: 5 }),
    pctProjetadoUpper: numeric("pct_projetado_upper", { precision: 8, scale: 5 }),
    pVitoria: numeric("p_vitoria", { precision: 5, scale: 4 }),
    /**
     * **Progresso da apuração** no escopo da linha, 0–100. 37 = "37% das
     * seções já foram apuradas".
     *
     * ⚠️ NÃO confundir com `pctAtual`, a coluna vizinha: aquela é a *fatia de
     * votos da candidatura*. Mesma unidade, significados opostos.
     */
    pctApurado: numeric("pct_apurado", { precision: 5, scale: 2 }),
    /**
     * **Fatia de votos da candidatura** sobre os votos já apurados, 0–100
     * (migration 0009, spec 020). 37 = "esta candidatura tem 37% dos votos
     * contados até agora".
     *
     * ⚠️ NÃO confundir com `pctApurado`, a coluna vizinha, que é o *progresso
     * da apuração*. As duas são 0–100 e medem coisas opostas. O nome
     * `pct_atual` é o que o dicionário Python, `EdgeUfCandidate` e
     * `EdgeCandidate` já usam ponta a ponta — um quarto nome criaria mais uma
     * tradução na pilha.
     *
     * É a base "apurado" do gráfico de evolução. `NULL` = não foi medido
     * (linhas anteriores à 0009, ou ciclo sem votos apurados) — nunca `0`,
     * que seria a afirmação falsa "tinha zero voto neste instante".
     */
    pctAtual: numeric("pct_atual", { precision: 8, scale: 5 }),
    /**
     * O **numerador** de `pctAtual`: votos já apurados da candidatura.
     *
     * Existe porque `pctAtual` tem denominador móvel (os votos válidos crescem
     * a noite toda) e percentual não se re-agrega: sem o numerador, a série
     * nacional não se reconstrói a partir das UFs sem rodar o modelo de novo.
     */
    votosAtuais: bigint("votos_atuais", { mode: "bigint" }),
    /**
     * A hora do **boletim** do TSE (ADR-0038), não a do cálculo — esta é `ts`,
     * que continua significando "quando o Python rodou".
     *
     * É o eixo horizontal do gráfico de evolução. Sem ela o eixo viraria o
     * relógio do servidor, que é exatamente o que o ADR-0038 proíbe: com a
     * ingestão parada, o modelo segue publicando `ts` fresco sobre dado
     * congelado. `NULL` quando nenhum par do ciclo trouxe `dg`/`hg` legível —
     * sem fallback para outro relógio (ADR-0038 D1).
     */
    dadoTs: timestamp("dado_ts", { withTimezone: true }),
    // S05/F4c — ver doc do bloco.
    modelFallbackTier: smallint("model_fallback_tier"),
    cenario2tJson: jsonb("cenario_2t_json"),
  },
  (t) => [
    index("ix_proj_lookup").on(t.cargo, t.turno, t.uf, t.ts),
    // Leitura da série do gráfico (spec 020): uma linha do gráfico é
    // exatamente um prefixo desta chave. `ix_proj_lookup` para em `uf` e
    // obrigaria a varrer todas as candidaturas da UF para desenhar uma.
    index("ix_proj_serie").on(t.cargo, t.turno, t.uf, t.candidatoId, t.ts),
  ],
);

/**
 * Cadastro de **candidaturas 2026** — nome, nome de urna, número, partido,
 * federação e situação de julgamento (migration 0008, spec 018).
 *
 * Fonte: Portal de Dados Abertos do TSE, licença cc-by
 * ([ADR-0039](../../docs/architecture/adrs/0039-portal-dados-abertos-tse-identidade-candidatura.md)).
 * Importador: `data-pipeline/candidatos-import.ts`.
 *
 * ## Três coisas que NÃO estão aqui, cada uma de propósito
 *
 * 1. **Nenhuma coluna de PII.** O CSV traz `NR_CPF_CANDIDATO`, `DS_EMAIL` e
 *    `NR_TITULO_ELEITORAL_CANDIDATO`; o parser não os mapeia (constituição § 5,
 *    RNF-019, ADR-0039). Também ficam fora a ficha do candidato — nascimento,
 *    ocupação, bens —, por decisão de escopo do dono do produto.
 * 2. **Nenhum índice ÚNICO sobre `(cargo, uf, numero)`.** A chave colide na
 *    própria fonte: 52 colisões brutas e 4 publicáveis no arquivo de 12/09/2026
 *    (ADR-0042 item 5). O desempate é a função determinística de
 *    `data-pipeline/candidatos-resolve.ts`.
 * 3. **Nenhuma FK para `projections`.** `projections` é append-only
 *    (constituição § 10) e nasce do EA20, que tem precedência absoluta sobre o
 *    cadastro; uma FK travaria um número publicado no boletim antes de o
 *    cadastro chegar. A relação é conferida por query de reconciliação no
 *    importador.
 *
 * Não é append-only: a constituição § 10 rege `snapshots`, o dado de apuração.
 * Esta é tabela de referência e é substituída a cada importação, como
 * `eleitorado` e `zonas`. O que protege contra perda é a guarda de
 * encolhimento do RF-152, não o histórico.
 */
export const candidatos = pgTable(
  "candidatos",
  {
    /**
     * `SQ_CANDIDATO` — 11 ou 12 dígitos no arquivo de 2026.
     *
     * `mode: "bigint"`, **nunca `"number"`**: no payload e no importador o
     * valor viaja como `string` (design 018 § D2) e converter para `number` em
     * qualquer ponto do trajeto é a perda de precisão que só aparece como
     * candidato — ou foto — trocado.
     */
    sqCandidato: bigint("sq_candidato", { mode: "bigint" }).primaryKey(),
    ano: smallint("ano").notNull().default(2026),
    /** `CD_ELEICAO` — 6257 (Presidente) ou 6259 (demais), medido. */
    cdEleicao: integer("cd_eleicao").notNull(),
    turno: smallint("turno").notNull().default(1),
    /** Código do TSE: 1, 3, 5 ou 6 (`CargoTse`, `lib/config/cargos.ts`). */
    cargo: smallint("cargo").notNull(),
    /** Sigla; **`BR`** em candidatura presidencial — é o que o CSV traz. */
    uf: char("uf", { length: 2 }).notNull(),
    /** `NR_CANDIDATO`: 2 a 4 dígitos, zero ocorrências de zero à esquerda. */
    numero: integer("numero").notNull(),
    nome: text("nome").notNull(),
    nomeUrna: text("nome_urna").notNull(),
    partidoSigla: varchar("partido_sigla", { length: 20 }).notNull(),
    partidoNumero: smallint("partido_numero").notNull(),
    partidoNome: text("partido_nome"),
    federacaoSigla: varchar("federacao_sigla", { length: 40 }),
    coligacaoNome: text("coligacao_nome"),
    /** `DS_SITUACAO_JULGAMENTO` **cru**. Nunca normalizado para enum. */
    situacaoJulgamento: text("situacao_julgamento").notNull(),
    /** `ST_CANDIDATO_INSERIDO_URNA = "SIM"`. */
    inseridoUrna: boolean("inserido_urna").notNull(),
    substituido: boolean("substituido").notNull().default(false),
    sqSubstituido: bigint("sq_substituido", { mode: "bigint" }),
    /** Regra fail-closed do ADR-0040 — a única porta de publicação. */
    publicavel: boolean("publicavel").notNull(),
    /** Trilha de fotos (RF-142); esta importação não o escreve. */
    fotoOk: boolean("foto_ok").notNull().default(false),
    /** `Last-Modified` do ZIP do TSE — jamais o `last_modified` do CKAN. */
    fonteTs: timestamp("fonte_ts", { withTimezone: true }).notNull(),
    importadoTs: timestamp("importado_ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Ambos NÃO-ÚNICOS — ver nota 2 acima. O segundo é parcial: o grid só lê
    // publicável, e o índice parcial evita varrer os 7,3% fora da urna.
    // O índice GIN de busca (`ix_cand_busca`) existe no banco (migration 0008)
    // e não tem representação em Drizzle nesta versão.
    index("ix_cand_cargo_uf").on(t.cargo, t.uf),
    index("ix_cand_publicavel").on(t.cargo, t.uf).where(sql`publicavel`),
  ],
);

/**
 * Partidos — tabela de referência número → sigla/nome, extraída do mesmo CSV de
 * candidaturas (migration 0008). Populada a partir do universo **inteiro** do
 * arquivo, antes de qualquer filtro de cargo.
 */
export const partidos = pgTable("partidos", {
  numero: smallint("numero").primaryKey(),
  sigla: varchar("sigla", { length: 20 }).notNull(),
  nome: text("nome").notNull(),
});

/** Log operacional do pipeline de ingest. */
export const ingestLog = pgTable("ingest_log", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer("duration_ms"),
  filesFetched: integer("files_fetched"),
  filesChanged: integer("files_changed"),
  errors: integer("errors"),
  notes: text("notes"),
});

export type HistoricalResult = typeof historicalResults.$inferSelect;
export type NewHistoricalResult = typeof historicalResults.$inferInsert;
export type Eleitorado = typeof eleitorado.$inferSelect;
export type Mesorregiao = typeof mesorregioes.$inferSelect;
export type Municipio = typeof municipios.$inferSelect;
/** Uma linha de `zonas` é um par (município × zona) desde a migration 0006. */
export type Zona = typeof zonas.$inferSelect;
export type Snapshot = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
export type Projection = typeof projections.$inferSelect;
export type NewProjection = typeof projections.$inferInsert;
export type IngestLog = typeof ingestLog.$inferSelect;
export type Candidato = typeof candidatos.$inferSelect;
export type NewCandidato = typeof candidatos.$inferInsert;
export type Partido = typeof partidos.$inferSelect;
