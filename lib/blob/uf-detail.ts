/**
 * lib/blob/uf-detail.ts
 *
 * Detalhe por UF de uma corrida majoritária — **municípios e séries temporais**
 * — no Vercel Blob, e não no store do Global Config
 * ([ADR-0032](../../docs/architecture/adrs/0032-detalhe-municipal-vercel-blob.md)).
 *
 * ## Por que estes dois campos saíram do Global Config
 *
 * Medição de 2026-09-08, não estimativa: 5.572 municípios em 27 UFs a ~206 B
 * por município = **1,10 MB só do array `municipios`, para UM cargo**, à
 * cobertura plena — contra **1 MB de limite do store inteiro**. Somando
 * Presidente + Governador, 2,19 MB. Não é questão de margem: o dado, à
 * cobertura plena, não cabe por definição de limite de produto. E piora
 * sozinho — o payload **cresce conforme a cobertura municipal melhora** (39%
 * hoje, constituição § 8), o que colocaria a recusa de escrita exatamente na
 * madrugada da apuração.
 *
 * `series_temporais` sai junto pelo mesmo motivo de forma: até ~480 pontos × 3
 * séries por UF, crescendo com o tempo decorrido de apuração. O comentário de
 * `lib/edge-config/types.ts` já registrava esse carry-over em aberto ("paginar
 * via chave separada"); o ADR-0032 o fecha apontando para cá em vez de para uma
 * segunda chave de Global Config.
 *
 * A linha divisória do ADR: **estado atual resumido e limitado por construção**
 * (Global Config) vs. **detalhe que cresce com cobertura municipal ou com o
 * tempo decorrido** (Blob).
 *
 * ## `ts` próprio, de propósito
 *
 * O objeto Blob carrega o **seu** `ts`, independente do `ts` do payload de
 * Global Config. Os dois mecanismos de escrita não são atômicos entre si: um
 * ciclo pode gravar o resumo e falhar o detalhe (ou o CDN servir uma versão
 * anterior). A UI precisa poder rotular a frescor do detalhe municipal separada
 * da do resumo — e o ADR-0032 é explícito que ela **não deve silenciar** essa
 * diferença.
 *
 * ## Leitura e degradação
 *
 * `readUfDetail` nunca lança e nunca devolve `null` cru: devolve um resultado
 * discriminado com o MOTIVO da indisponibilidade. Isso existe para o consumidor
 * poder cumprir o ADR-0032 item 3 (que aplica o "sempre no DOM" do ADR-0017 a
 * uma fonte de dado): 404, erro de rede ou ambiente sem Blob renderizam um
 * estado "detalhe indisponível" **explícito e presente no DOM** — nunca um
 * bloco escondido nem um vazio silencioso.
 *
 * O `fetch` roda **no servidor**, com `next: { revalidate: 60 }` (mesma cadência
 * de escrita, ADR-0011), e o consumidor deve dispará-lo **em paralelo** com
 * `readUfProjection()` — a página não espera o Blob para renderizar o resumo.
 */

import type { Cargo, Turno } from "@/lib/config/calendar";
import type {
  EdgePayloadUf,
  EdgeSeriePorCandidato,
  EdgeUfMunicipio,
  EdgeUfSeriesTemporais,
  UfPayloadInput,
} from "@/lib/edge-config/types";
import municipiosPresT1Fixture from "@/tests/fixtures/blob/uf-municipios-pres-t1.json" with {
  type: "json",
};

import { blobUrlFor, ufDetailBlobPathname } from "./paths";

// ---------------------------------------------------------------------------
// Contrato do objeto
// ---------------------------------------------------------------------------

/**
 * O JSON gravado em `municipios/uf/<SIGLA>/<cargo>/t<turno>.json`.
 *
 * Um único objeto por UF/cargo/turno, e não um blob por campo: a página de UF
 * sempre precisa dos dois juntos, e um `fetch` a mais por seção seria latência
 * sem contrapartida. Mesmo princípio que o ADR-0026 já aplicou ao Deputado
 * ("um único objeto por recurso composto").
 */
export interface UfDetailBlob {
  /**
   * Instante da gravação DESTE objeto. **Independente** do `ts` do payload de
   * Global Config — ver o cabeçalho deste arquivo.
   */
  ts: string;
  /** Sigla de 2 letras maiúsculas. Redundante com o caminho, e é o ponto: um
   *  objeto servido do CDN precisa ser autodescritivo para o consumidor poder
   *  detectar que recebeu o blob errado. */
  uf: string;
  cargo: Cargo;
  turno: Turno;
  municipios: EdgeUfMunicipio[];
  /** `null` (e não ausente) quando o orchestrator não emitiu séries — a
   *  distinção "não veio" vs. "veio vazia" fica legível no JSON gravado. */
  series_temporais: EdgeUfSeriesTemporais | null;
}

/** Cadência de revalidação do fetch, em segundos (ADR-0011 / ADR-0032 item 3). */
export const UF_DETAIL_REVALIDATE_SECONDS = 60;

// ---------------------------------------------------------------------------
// Split — a fronteira campo a campo do ADR-0032 item 1
// ---------------------------------------------------------------------------

/**
 * Separa o payload de UF que chega do orchestrator em (a) o que fica no Global
 * Config e (b) o que vai para o Blob.
 *
 * O Python segue emitindo `municipios` e `series_temporais` no mesmo objeto —
 * a fronteira é aplicada aqui, do lado TypeScript, num ponto só. É por isso que
 * o tipo de ENTRADA ({@link UfPayloadInput}) é distinto do tipo ARMAZENADO
 * ({@link EdgePayloadUf}): deixar o tipo armazenado continuar declarando campos
 * que ele não guarda mais seria o tipo mentindo sobre o store.
 *
 * @param input  Payload de UF como veio do orchestrator.
 * @param cargo  Cargo literal da corrida (`"pres"` | `"gov"`) — o mesmo
 *               qualificador da chave de Global Config (ADR-0012).
 * @param turno  Turno da corrida.
 */
export function splitUfPayload(
  input: UfPayloadInput,
  cargo: Cargo,
  turno: Turno,
): { stored: EdgePayloadUf; detail: UfDetailBlob } {
  const { municipios, series_temporais, ...stored } = input;

  return {
    stored,
    detail: {
      // `ts` próprio: nasce do relógio desta gravação, não do payload de
      // Global Config. Ver o cabeçalho.
      ts: new Date().toISOString(),
      uf: input.uf,
      cargo,
      turno,
      municipios: municipios ?? [],
      series_temporais: series_temporais ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * Por que o detalhe não veio. A UI usa isto para escolher o texto do estado
 * "detalhe indisponível" — um 404 numa UF sem cobertura municipal não é a
 * mesma notícia que uma falha de rede, e o leitor merece saber qual dos dois é.
 */
export type UfDetailUnavailableReason =
  /** Ambiente sem Blob configurado (dev/preview sem `BLOB_READ_WRITE_TOKEN`). */
  | "not_configured"
  /** 404 — o objeto nunca foi escrito (cargo/turno novo, ou UF com 0% de cobertura). */
  | "not_found"
  /** Rede, timeout, 5xx — o objeto pode existir, mas não chegou. */
  | "fetch_error"
  /** 200 com corpo que não casa com o contrato (JSON inválido, ou UF trocada). */
  | "invalid";

export type UfDetailResult =
  | { status: "ok"; detail: UfDetailBlob; url: string }
  | { status: "unavailable"; reason: UfDetailUnavailableReason; url: string | null };

/** Guard estrutural mínimo — o shape canônico é {@link UfDetailBlob}. */
function isUfDetailBlob(value: unknown, expectedUf: string): value is UfDetailBlob {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<UfDetailBlob>;
  return (
    typeof v.ts === "string" &&
    typeof v.uf === "string" &&
    v.uf.toUpperCase() === expectedUf.toUpperCase() &&
    Array.isArray(v.municipios)
  );
}

/**
 * Lê o detalhe de UMA UF do Blob, no servidor.
 *
 * Nunca lança. O caller recebe sempre um {@link UfDetailResult} e decide o
 * texto do estado indisponível — o bloco correspondente **continua no DOM** em
 * todos os casos (ADR-0032 item 3, ADR-0017).
 *
 * Deve ser chamado **em paralelo** com `readUfProjection()`:
 *
 * ```ts
 * const [payload, detalhe] = await Promise.all([
 *   readUfProjection(sigla),
 *   readUfDetail(sigla, { cargo: "pres", turno: 1 }),
 * ]);
 * ```
 *
 * Sem `AbortSignal` de propósito: um `signal` desabilita o cache de Data Cache
 * do Next para esse `fetch`, o que trocaria uma proteção de latência por uma
 * ida à origem a cada request na noite da apuração. O `revalidate: 60` já
 * limita a exposição, e a plataforma tem seu próprio teto de execução.
 */
export async function readUfDetail(
  sigla: string,
  opts: { cargo: Cargo; turno: Turno },
): Promise<UfDetailResult> {
  let url: string | null;
  try {
    url = blobUrlFor(ufDetailBlobPathname(sigla, opts.cargo, opts.turno));
  } catch {
    // Sigla malformada — mesma degradação de qualquer outra falha de leitura.
    return { status: "unavailable", reason: "invalid", url: null };
  }

  if (!url) return { status: "unavailable", reason: "not_configured", url: null };

  let response: Response;
  try {
    response = await fetch(url, {
      // 🔴 04/10 noite — `no-store`: o Data Cache do Next serve a cópia velha
      // ao 1º leitor depois de um tempo ocioso (sem teto de idade) — UF pouco
      // visitada mostrava municípios de 20 min atrás. O CDN do Blob já
      // segura 60 s (`cacheControlMaxAge`), o custo não muda.
      cache: "no-store",
    });
  } catch {
    return { status: "unavailable", reason: "fetch_error", url };
  }

  if (response.status === 404) return { status: "unavailable", reason: "not_found", url };
  if (!response.ok) return { status: "unavailable", reason: "fetch_error", url };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: "unavailable", reason: "invalid", url };
  }

  if (!isUfDetailBlob(body, sigla)) return { status: "unavailable", reason: "invalid", url };

  return { status: "ok", detail: body, url };
}

// ---------------------------------------------------------------------------
// Fallback de DEV — carry-over do map-builder, 2026-09-09
// ---------------------------------------------------------------------------

/**
 * Fixture municipal versionada, dev/preview-only — o Blob do ADR-0032 nunca
 * recebeu escrita real (o pipeline de publicação não rodou ainda; ver o
 * relatório do map-builder de 2026-09-09). Sem ela, `/uf/SP` não tem como
 * exercitar o coroplético municipal em `pnpm dev`, e a moldura persistente
 * (`components/layout/PersistentMapFrame.tsx`) e as páginas de UF ficam
 * condenadas ao estado "detalhe indisponível" mesmo com o banco tendo dado
 * real.
 *
 * Gerada por um script one-off (não commitado — não faz parte do pipeline)
 * a partir do Postgres de dev real: `cargo=1, turno=1`, as 27 UFs, 2.180
 * municípios com apuração (mesma contagem que o Postgres reporta hoje via
 * `snapshots`). Candidatos remapeados 10/20/30 → 1001/1002/1003 — os únicos
 * três códigos TSE presentes no dado sintético de Presidente — para casar
 * com os ids que `tests/fixtures/edge-config/projection-current.json` já
 * usa (e que `synthesizeUfFromNational`, em `app/(pres)/uf/[sigla]/page.tsx`,
 * já emprega para montar `payload.candidatos` nesta mesma rota). Assim
 * `candidateColor[m.lider.candidato_id]` resolve para a cor real do
 * candidato em vez de cair no cinza `--color-tossup`.
 *
 * Só cobre `cargo="pres", turno=1` — é o que o dado de partida do bug
 * report pedia (`/uf/SP` presidencial). Governador continua honestamente
 * "detalhe indisponível" (não há fixture equivalente: o esquema de
 * candidatos de Governador é POR UF — 3 ids distintos por estado — e o
 * Postgres de dev só tem 2 candidatos sintéticos por corrida estadual,
 * então o remapeamento não é 1:1 direto; não foi feito por não ser o alvo
 * do bug reportado).
 *
 * **NUNCA usado em produção.** Todo chamador deve fazer o gate
 * `process.env.NODE_ENV !== "production"` ANTES de chamar esta função — ela
 * própria não faz esse gate para não silenciar, por engano, um ambiente de
 * teste que precise inspecionar o valor bruto. `readUfDetail` (acima)
 * continua sendo SEMPRE tentado primeiro pelos chamadores; isto é usado só
 * como último recurso quando ele já devolveu "unavailable" — a fonte real
 * (Blob) nunca é substituída silenciosamente, apenas complementada em dev.
 */
type UfMunicipiosFixtureFile = Record<string, UfDetailBlob>;

export function devMunicipiosFixtureFor(
  sigla: string,
  cargo: Cargo,
  turno: Turno,
): UfDetailBlob | null {
  if (cargo !== "pres" || turno !== 1) return null;
  const file = municipiosPresT1Fixture as unknown as UfMunicipiosFixtureFile;
  return file[sigla.toUpperCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Acessores de conveniência para o consumidor
// ---------------------------------------------------------------------------

/** Municípios do resultado, ou `[]` quando indisponível. */
export function municipiosFrom(result: UfDetailResult): EdgeUfMunicipio[] {
  return result.status === "ok" ? result.detail.municipios : [];
}

/** Séries do resultado, ou `null` quando indisponível. */
export function seriesFrom(result: UfDetailResult): EdgeUfSeriesTemporais | null {
  return result.status === "ok" ? result.detail.series_temporais : null;
}

/**
 * Série por candidatura do resultado (spec 020, ADR-0046 D3), ou `null`.
 *
 * Irmã de {@link seriesFrom}, e `null` por **duas** razões diferentes que o
 * chamador precisa distinguir — este acessor não as distingue, e é de
 * propósito: quem sabe qual é o caso é quem tem o `UfDetailResult` na mão.
 *
 *   - `result.status !== "ok"` → o Blob não respondeu. A UI mostra
 *     `<DetailUnavailable reason={result.reason} />`.
 *   - `result.status === "ok"` e o retorno é `null` → o Blob respondeu e o
 *     produtor **não emitiu** a série (blob anterior à spec 020, ou fase
 *     pré-eleição). A UI mostra `<DetailUnavailable reason="sem_serie" />`.
 *
 * Colapsar os dois num texto só faz o operador caçar o erro errado na noite da
 * apuração: "a rede caiu" e "o Python não publicou" têm causas e correções
 * opostas.
 *
 * ⚠️ O consumidor **não re-ordena** `candidatos`: a ordem do array é contrato
 * do produtor (ADR-0046 D4).
 */
export function seriePorCandidatoFrom(result: UfDetailResult): EdgeSeriePorCandidato | null {
  if (result.status !== "ok") return null;
  return result.detail.series_temporais?.por_candidato ?? null;
}
