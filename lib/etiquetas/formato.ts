/**
 * lib/etiquetas/formato.ts
 *
 * O **contrato** dos arquivos de etiquetas — o que o compilador grava em
 * `lib/data/etiquetas/` (cópia do build) e o publicador envia para
 * `etiquetas/v1/` no Blob (spec 024, RF-228/RF-230). Produtor e consumidor
 * importam estes tipos daqui; nenhum dos dois redeclara.
 *
 * ## Por que "matéria-prima + resolução na leitura", e não o valor resolvido
 *
 * São 7.791 candidaturas a Deputado Federal (1.131 só em SP). Gravar o valor
 * resolvido de cada categoria, com fonte e data, repetiria o mesmo padrão do
 * partido centenas de vezes por UF. Os arquivos guardam só o que é
 * **distinto**: o padrão de cada partido/federação uma vez, as exceções
 * individuais, e as regras derivadas agrupadas por valor. A resolução
 * (`lib/etiquetas/resolver.ts`) é uma função pura, a MESMA que o compilador
 * usa — então a tela e o histórico não têm como discordar.
 *
 * ## Nada de dado pessoal aqui (RF-229)
 *
 * Nenhum tipo deste arquivo tem campo de nome, nascimento, CPF ou documento.
 * A identidade é o `sqcand` (público, do TSE) e o código parlamentar do
 * Senado. O teste de ausência de dado pessoal varre os gerados.
 */

import {
  type ChavesPublicacao,
  todasDesligadas,
  type ValorId,
  VISOES,
  type Visao,
} from "./catalogo";

export const FORMATO_ETIQUETAS = "etiquetas/v1" as const;

/**
 * Uma linha-fonte **revisada**, como sobrevive à compilação — por **lista
 * branca** de campos (ADR-0062). A coluna `nota` do CSV é anotação interna do
 * dono e **nunca** sai do repositório editorial: não entra na cópia do build,
 * não vai ao Blob, não entra no histórico público. {@link registroPublico} é
 * o único construtor, e o teste do publicador reprova arquivo com campo a mais.
 */
export interface Registro {
  valor: string;
  fonte_url: string;
  fonte_descricao: string;
  /** Data da fonte, `AAAA-MM-DD`. */
  data: string;
  /** Data da revisão do dono, `AAAA-MM-DD`. */
  revisado_em: string;
}

/** Campos de {@link Registro}, na ordem de gravação. */
export const CAMPOS_REGISTRO = [
  "valor",
  "fonte_url",
  "fonte_descricao",
  "data",
  "revisado_em",
] as const satisfies readonly (keyof Registro)[];

/** Reconstrói um registro campo a campo — o que não está na lista fica para trás. */
export function registroPublico(r: Registro): Registro {
  return {
    valor: r.valor,
    fonte_url: r.fonte_url,
    fonte_descricao: r.fonte_descricao,
    data: r.data,
    revisado_em: r.revisado_em,
  };
}

/**
 * Registros de uma chave, indexados por {@link chaveDeCategoria}:
 * `"campo_ideologico"` ou, para categoria por turno, `"palanque_presidencial:1"`.
 */
export type Registros = Record<string, Registro>;

export interface MetaEtiquetas {
  /**
   * Monotônica. O leitor usa a MAIOR entre o Blob e a cópia do build
   * (RF-231). O compilador a preserva quando o conteúdo não muda (deriva
   * zero); o publicador a carimba acima das duas.
   */
  versao: number;
  gerado_em: string;
  /** sha-256 do conteúdo (sem `meta` nem `publicar`) — identidade da versão. */
  conteudo_sha256: string;
  /** Carimbado só pelo publicador. `null` na cópia do build. */
  git_sha: string | null;
}

/** Proveniência de uma regra derivada (vale para todas as candidaturas que ela classifica). */
export interface FonteDerivada {
  fonte_url: string;
  fonte_descricao: string;
  data: string;
}

/**
 * Os quatro insumos derivados e a categoria que cada um classifica. Câmara ⇒
 * cargo 6 (nos arquivos de UF); Senado ⇒ cargo 5 e senado2031 (no nacional).
 */
export const INSUMOS_DERIVADOS = {
  trajetoria_camara: "trajetoria_cargo",
  alinhamento_camara: "relacao_governo",
  trajetoria_senado: "trajetoria_cargo",
  alinhamento_senado: "relacao_governo",
} as const;
export type InsumoDerivado = keyof typeof INSUMOS_DERIVADOS;

/** Valores derivados de UM candidato/senador (só as duas categorias que têm regra). */
export type ValoresDerivados = Partial<Record<"trajetoria_cargo" | "relacao_governo", string>>;

export interface CandidatoNacional {
  uf: string;
  cargo: 3 | 5;
  /** Sigla do partido, normalizada ({@link normalizarSigla}). */
  partido: string;
  /** Linhas individuais revisadas. */
  x?: Registros;
  /** Só cargo 5: trajetória e alinhamento derivados do Senado. */
  d?: ValoresDerivados;
}

export interface Senador2031 {
  uf: string;
  /** `null` = sem partido (ex.: "S/Partido" na foto do Senado). */
  partido: string | null;
  x?: Registros;
  /** Relação com o governo derivada do alinhamento no Senado. */
  d?: ValoresDerivados;
}

export interface ArquivoNacional {
  formato: typeof FORMATO_ETIQUETAS;
  meta: MetaEtiquetas;
  /**
   * As chaves por visão. Desde 2026-09-29 (spec 025, emenda ao RF-228/231 e ao
   * ADR-0060) a cópia do build carrega as do `editorial/etiquetas/publicar.json`
   * **versionado** — o mesmo arquivo que o publicador leva ao Blob. Antes eram
   * sempre `false` no build, e um deploy com compilação mais nova que a última
   * publicação apagava as visões em silêncio (open question 5 da spec 024).
   */
  publicar: ChavesPublicacao;
  /** Proveniência de cada insumo derivado; `null` = insumo ausente nesta compilação. */
  derivados: Record<InsumoDerivado, FonteDerivada | null>;
  /** Partido (normalizado) → federação (normalizada) ou `null`, observado no universo do TSE. */
  partidos: Record<string, string | null>;
  /** `"partido:PT"` / `"federacao:PT/PC DO B/PV"` → registros. */
  padroes: Record<string, Registros>;
  /** `sqcand` → candidatura a Governador ou Senador. */
  candidatos: Record<string, CandidatoNacional>;
  senado2031: {
    /** `false` enquanto `editorial/senado/mandato-2031.json` não existir. */
    disponivel: boolean;
    /** Data da foto do Senado, quando disponível. */
    foto: string | null;
    senadores: Record<string, Senador2031>;
  };
}

export interface ArquivoUf {
  formato: typeof FORMATO_ETIQUETAS;
  meta: MetaEtiquetas;
  uf: string;
  /** Candidaturas a Deputado Federal da UF, por partido (normalizado), `sqcand` ordenado. */
  por_partido: Record<string, string[]>;
  /** Trajetória derivada da Câmara, agrupada por valor. Ausente do grupo ⇒ `a_classificar`. */
  trajetoria: Partial<Record<ValorId<"trajetoria_cargo">, string[]>>;
  /** Relação com o governo derivada do alinhamento (só quem passou do mínimo de votos). */
  alinhamento: Partial<Record<ValorId<"relacao_governo">, string[]>>;
  /** Linhas individuais revisadas (`deputados-excecoes.csv`). */
  excecoes: Record<string, Registros>;
}

export interface EntradaHistorico {
  /** Quando a mudança entrou (o `gerado_em` da compilação). */
  em: string;
  versao: number;
  /** `sqcand`, `partido:X`, `federacao:X`, `senado:X` ou `derivado:<insumo>`. */
  chave: string;
  categoria: string;
  turno: 1 | 2 | null;
  de: string | null;
  para: string | null;
  fonte_url: string | null;
  fonte_descricao: string | null;
  data: string | null;
  /** Só em mudança de insumo derivado: quantas candidaturas mudaram de valor. */
  resumo?: string;
}

export interface ArquivoHistorico {
  formato: typeof FORMATO_ETIQUETAS;
  meta: MetaEtiquetas;
  /** Append-only. Nunca reescrito. */
  entradas: EntradaHistorico[];
}

/** As 27 UFs, na ordem em que os arquivos são gravados. */
export const UFS = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
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
] as const;
export type SiglaUf = (typeof UFS)[number];

export function isSiglaUf(v: string): v is SiglaUf {
  return (UFS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Normalizações — a junção depende delas
// ---------------------------------------------------------------------------

/**
 * `sqcand` como texto decimal (RF-232). Aceita `number` (`DeputadoUfCandidato`)
 * e `string` (`EdgeUfRow.top_candidatos[]`, `EdgeUfCandidate`). Devolve `null`
 * para qualquer coisa que não seja um inteiro positivo — um `sqcand` ausente
 * nunca vira a chave `"undefined"`.
 *
 * 11 ou 12 dígitos cabem em `Number.MAX_SAFE_INTEGER`; o limite de 15 é só
 * uma guarda contra lixo.
 */
export function normalizarSqcand(v: string | number | null | undefined): string | null {
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v <= 0) return null;
    return String(v);
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{1,15}$/.test(s)) return null;
  const semZeros = s.replace(/^0+/, "");
  return semZeros === "" ? null : semZeros;
}

/**
 * Sigla de partido/federação comparável entre fontes: sem acento, maiúscula,
 * espaços colapsados. O TSE escreve `UNIÃO` e `PT/PC do B/PV`; um payload pode
 * trazer `UNIAO`. Sem isto, a junção por partido falha calada.
 */
export function normalizarSigla(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Chave do mapa {@link Registros}. */
export function chaveDeCategoria(categoria: string, turno: 1 | 2 | null): string {
  return turno === null ? categoria : `${categoria}:${turno}`;
}

export function chavePartido(sigla: string): string {
  return `partido:${normalizarSigla(sigla)}`;
}

export function chaveFederacao(sigla: string): string {
  return `federacao:${normalizarSigla(sigla)}`;
}

// ---------------------------------------------------------------------------
// Guardas estruturais — para o que chega do Blob
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isMeta(v: unknown): v is MetaEtiquetas {
  return (
    isObj(v) &&
    typeof v.versao === "number" &&
    Number.isFinite(v.versao) &&
    typeof v.gerado_em === "string" &&
    typeof v.conteudo_sha256 === "string"
  );
}

export function isArquivoNacional(v: unknown): v is ArquivoNacional {
  return (
    isObj(v) &&
    v.formato === FORMATO_ETIQUETAS &&
    isMeta(v.meta) &&
    isObj(v.publicar) &&
    isObj(v.derivados) &&
    isObj(v.partidos) &&
    isObj(v.padroes) &&
    isObj(v.candidatos) &&
    isObj(v.senado2031) &&
    isObj((v.senado2031 as Record<string, unknown>).senadores)
  );
}

export function isArquivoUf(v: unknown, ufEsperada: string): v is ArquivoUf {
  return (
    isObj(v) &&
    v.formato === FORMATO_ETIQUETAS &&
    isMeta(v.meta) &&
    v.uf === ufEsperada &&
    isObj(v.por_partido) &&
    isObj(v.trajetoria) &&
    isObj(v.alinhamento) &&
    isObj(v.excecoes)
  );
}

/**
 * `editorial/etiquetas/publicar.json` → chaves. Recusa objeto que não seja
 * `{ visão: boolean }`, visão fora de `VISOES` e valor não booleano; visão
 * ausente do arquivo fica desligada. Lido pelo COMPILADOR (a cópia do build
 * carrega estas chaves) e pelo PUBLICADOR (o Blob carrega as mesmas) — um
 * parser só, para os dois lados nunca discordarem sobre o que o arquivo diz.
 */
export function lerChavesPublicacao(json: unknown): ChavesPublicacao | { erro: string } {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { erro: "publicar.json deve ser um objeto { visão: true|false }" };
  }
  const out = todasDesligadas();
  for (const [k, v] of Object.entries(json)) {
    if (!(VISOES as readonly string[]).includes(k)) {
      return { erro: `publicar.json: visão desconhecida "${k}" (aceitas: ${VISOES.join(", ")})` };
    }
    if (typeof v !== "boolean") return { erro: `publicar.json: "${k}" deve ser true ou false` };
    out[k as Visao] = v;
  }
  return out;
}

export function isArquivoHistorico(v: unknown): v is ArquivoHistorico {
  return isObj(v) && v.formato === FORMATO_ETIQUETAS && isMeta(v.meta) && Array.isArray(v.entradas);
}
