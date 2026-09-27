/**
 * lib/blob/deputado-uf.ts
 *
 * Drill-down por UF de **Deputado Federal** no Vercel Blob — a lista completa
 * de agremiações, eleitos e suplentes de um estado
 * ([ADR-0026](../../docs/architecture/adrs/0026-cargos-senador-deputado-ingestao-e-read-path.md)
 * item 4, RF-129, design 017 § D6).
 *
 * ## Por que Blob e não Global Config
 *
 * Mesma linha divisória do
 * [ADR-0032](../../docs/architecture/adrs/0032-detalhe-municipal-vercel-blob.md):
 * **estado atual resumido e limitado por construção** fica no Global Config;
 * **detalhe que cresce com a cobertura** vai para o Blob. Esta é a maior carga
 * do produto — 27 UFs × (todas as agremiações × todos os eleitos e suplentes),
 * ~10–15 KB por UF — e o limite de 1 MB do Global Config já é dividido por
 * três cargos.
 *
 * O resumo por UF continua no Global Config, dentro do payload nacional
 * (`EdgePayloadDeputado.por_uf` → `EdgeDeputadoUfRow`). É essa separação que
 * permite cumprir a aceitação de RF-129: **Blob indisponível ⇒ a página exibe
 * "detalhe indisponível" e MANTÉM o resumo** (constituição § 7).
 *
 * ## Leitura e degradação
 *
 * Molde deliberado de `lib/blob/uf-detail.ts::readUfDetail`, e não uma segunda
 * convenção: resultado discriminado com o MOTIVO, nunca uma exceção, nunca um
 * `null` cru. O consumidor escolhe o texto — um 404 numa UF sem boletim não é
 * a mesma notícia que uma falha de rede — e o bloco correspondente **continua
 * no DOM** em todos os casos (ADR-0017, ADR-0032 item 3).
 *
 * O `fetch` roda **no servidor** e deve ser disparado **em paralelo** com a
 * leitura do Global Config: a página não espera o Blob para renderizar o
 * resumo.
 */

import type { EdgeVotacaoUf } from "@/lib/edge-config/types";

import { blobUrlFor, deputadoUfBlobPathname } from "./paths";

// ---------------------------------------------------------------------------
// Contrato do objeto — design 017 § D6
// ---------------------------------------------------------------------------

/**
 * Um candidato dentro de uma agremiação, no detalhe de uma UF.
 *
 * A identidade é `sqcand`, **nunca** `cand.n`: no proporcional o número de
 * urna se repete entre UFs e entre partidos, e usá-lo como chave funde
 * candidaturas distintas.
 */
export interface DeputadoUfCandidato {
  /** Sequencial do candidato no TSE (`cand[].sqcand`). A identidade. */
  sqcand: number;
  nome: string;
  /**
   * Sigla do **partido**, que dentro de uma federação não é a sigla da
   * agremiação. RF-122: a federação é uma agremiação, mas o eleito continua
   * sendo de um partido, e o leitor precisa ver qual.
   */
  partido: string;
  votos: number;
  /** Posição dentro da agremiação, 1-based, por votos desc. */
  ordem: number;
  /**
   * RF-127 — eleito por sobra cuja atribuição ainda depende de resultado
   * indefinido. A tela marca; nunca exibe firmeza que o cálculo não tem.
   */
  indefinido?: boolean;
}

/** Uma agremiação (partido isolado ou federação) dentro de uma UF. */
export interface DeputadoUfAgremiacao {
  /** `agr[].n`. Chave de reconciliação com a bancada nacional. */
  cod: string;
  sigla: string;
  nome: string;
  tipo: "partido" | "federacao";
  /** RF-122 — siglas componentes. `[]` em partido isolado. */
  componentes: string[];
  /**
   * O partido que dá a cor (ADR-0024 linha 41), medido **nesta UF** — ver
   * `EdgeAgremiacaoBancada.sigla_lider` para a regra completa. Pode diferir do
   * líder nacional da mesma federação, e isso é esperado.
   *
   * Em partido isolado vale `sigla`, o que dispensa ramo especial na tela.
   */
  sigla_lider: string;
  /** RF-130 — votos a candidatos. */
  votos_nominais: number;
  /** RF-130 — votos de legenda (`v.vl`). Separado, nunca somado em silêncio. */
  votos_legenda: number;
  /** `votos_nominais + votos_legenda` (ADR-0027). */
  votos_validos: number;
  /** % sobre os válidos da UF (0–100). */
  pct_votos: number;
  /** `votos_validos / quociente_eleitoral`, truncado (Código Eleitoral art. 107). */
  quociente_partidario: number;
  /**
   * RF-125.1 — candidatos **eleitos**. NUNCA `vagas_obtidas`: `Σ cadeiras`
   * sobre as agremiações é exatamente `lugares_a_preencher`, o que a soma de
   * `vagas_obtidas` não é.
   */
  cadeiras: number;
  /**
   * RF-127 — opcional **por desenho**, não por pendência. D7 decidiu em 12/09
   * (custo medido, cabe na janela) e o bootstrap entrou em 13/09 (`2bcee57`).
   * O campo fica ausente quando a faixa não tem largura; a tela então mostra o
   * ponto central. Ver `EdgeAgremiacaoBancada.cadeiras_ci95`.
   */
  cadeiras_ci95?: [number, number];
  eleitos: DeputadoUfCandidato[];
  /** Os primeiros da fila que não se elegeram — no máximo 5 por agremiação. */
  suplentes: DeputadoUfCandidato[];
}

/**
 * O JSON gravado em `deputado/uf/<SIGLA>.json`.
 *
 * Sem cargo nem turno no caminho: Deputado se decide em turno único e não
 * divide caminho com nenhuma outra corrida (`deputadoUfBlobPathname`).
 */
export interface DeputadoUfDetail {
  /**
   * Instante da gravação DESTE objeto — **independente** do `ts` do payload de
   * Global Config. As duas escritas não são atômicas entre si: um ciclo pode
   * gravar o resumo e falhar o detalhe. A UI precisa poder datar os dois
   * separadamente (mesma razão de `UfDetailBlob.ts`).
   */
  ts: string;
  cargo: 6;
  turno: 1;
  /**
   * Sigla de 2 letras maiúsculas. Redundante com o caminho, e é o ponto: um
   * objeto servido do CDN precisa ser autodescritivo para o consumidor poder
   * detectar que recebeu o blob errado.
   */
  uf: string;
  pct_apurado: number; // 0–100
  /** RF-124 — `carg[].nv`. `null` quando o TSE não publicou. Nunca constante. */
  lugares_a_preencher: number | null;
  /** RF-123 — o quociente que NÓS calculamos, com o arredondamento do art. 106. */
  quociente_eleitoral: number | null;
  /**
   * `carg[].qe` — o quociente do **próprio TSE**. Conferência, não fonte: o
   * número exibido é o nosso, e este existe para que a divergência apareça em
   * vez de se esconder.
   */
  quociente_eleitoral_tse: number | null;
  /**
   * `tf === "s"` no EA20. Sem isto, divergência contra o TSE é **esperada** e
   * não é erro — o TSE só fecha os próprios números na totalização final.
   */
  totalizacao_final: boolean;
  /**
   * Saída de `conferir_contra_tse`. `[]` quando bate. Vai à tela
   * (constituição § 8): esconder divergência é o oposto de transparência
   * metodológica.
   */
  divergencias: Array<{ o_que: string; nosso: number; tse: number; detalhe: string }>;
  agremiacoes: DeputadoUfAgremiacao[];
  /** Cadeiras que o algoritmo não conseguiu preencher (sem candidato acima do piso de 10% do QE). */
  vagas_nao_preenchidas: number;
  /**
   * Open question 3 da spec 017 — códigos de agremiação em empate que
   * sobreviveu aos dois critérios de desempate. A norma não prevê sorteio, e
   * a decisão desta spec é **marcar como indeterminado**, nunca escolher.
   */
  empates_indeterminados: string[];
  /**
   * Spec 021 RF-192 (emendado 26/09 noite) — as contagens do agregado DESTA
   * UF para o painel "Votação" da tela `/uf/[sigla]/deputado-federal`.
   *
   * **Sem `corrida`**: Deputado não tem colocados (spec 022 RF-200). E, hoje,
   * sem `projetada`: o ciclo proporcional não calcula participação projetada,
   * e a regra é "sem participação projetada da UF ⇒ arco 3 aguardando" — nunca
   * a nacional no lugar. Ausente ⇒ "não sabemos" ⇒ `<DetailUnavailable>`
   * (RF-198), nunca zeros. Opcional também porque objetos gravados antes da
   * emenda não têm a chave.
   */
  votacao?: Omit<EdgeVotacaoUf, "corrida" | "destino_pendente">;
}

/**
 * Cadência de revalidação do `fetch`, em segundos.
 *
 * 60 s, e **não** os 900 s do cron deste cargo: quem manda no piso é o
 * `cacheControlMaxAge` que `lib/blob/write.ts` grava no objeto (60 s, o mínimo
 * que o Blob aceita). Revalidar em 900 s só faria a página servir um detalhe
 * até 30 minutos mais velho do que o CDN já tem disponível (era 15 antes do
 * ADR-0036 — a volta completa das 6 fatias passou a levar 30 min).
 */
export const DEPUTADO_UF_REVALIDATE_SECONDS = 60;

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * Por que o detalhe não veio. A UI usa isto para escolher o texto — e a
 * escolha importa: "esta UF ainda não teve boletim" e "não conseguimos falar
 * com o armazenamento" são notícias diferentes para o leitor.
 */
export type DeputadoUfUnavailableReason =
  /** Ambiente sem Blob configurado (dev/preview sem `BLOB_READ_WRITE_TOKEN`). */
  | "not_configured"
  /** 404 — o objeto nunca foi escrito (UF sem nenhum boletim). */
  | "not_found"
  /** Rede, timeout, 5xx — o objeto pode existir, mas não chegou. */
  | "fetch_error"
  /** 200 com corpo que não casa com o contrato (JSON inválido, ou UF trocada). */
  | "invalid";

export type DeputadoUfDetailResult =
  | { status: "ok"; detail: DeputadoUfDetail; url: string }
  | { status: "unavailable"; reason: DeputadoUfUnavailableReason; url: string | null };

/** Guard estrutural mínimo — o shape canônico é {@link DeputadoUfDetail}. */
function isDeputadoUfDetail(value: unknown, expectedUf: string): value is DeputadoUfDetail {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<DeputadoUfDetail>;
  return (
    typeof v.ts === "string" &&
    typeof v.uf === "string" &&
    v.uf.toUpperCase() === expectedUf.toUpperCase() &&
    Array.isArray(v.agremiacoes)
  );
}

/**
 * Lê o detalhe de Deputado Federal de UMA UF do Blob, no servidor.
 *
 * **Nunca lança.** O caller recebe sempre um {@link DeputadoUfDetailResult} e
 * decide o texto do estado indisponível — o bloco correspondente continua no
 * DOM em todos os casos (RF-129, ADR-0017).
 *
 * Deve ser chamado **em paralelo** com a leitura do resumo:
 *
 * ```ts
 * const [nacional, detalhe] = await Promise.all([
 *   readDeputadoProjection(),
 *   readDeputadoUfDetail(sigla),
 * ]);
 * ```
 *
 * Sem `AbortSignal`, pela mesma razão de `readUfDetail`: um `signal`
 * desabilita o Data Cache do Next para esse `fetch`, trocando uma proteção de
 * latência por uma ida à origem a cada request na noite da apuração.
 */
export async function readDeputadoUfDetail(sigla: string): Promise<DeputadoUfDetailResult> {
  let url: string | null;
  try {
    url = blobUrlFor(deputadoUfBlobPathname(sigla));
  } catch {
    // Sigla malformada — mesma degradação de qualquer outra falha de leitura.
    return { status: "unavailable", reason: "invalid", url: null };
  }

  if (!url) return { status: "unavailable", reason: "not_configured", url: null };

  let response: Response;
  try {
    response = await fetch(url, { next: { revalidate: DEPUTADO_UF_REVALIDATE_SECONDS } });
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

  if (!isDeputadoUfDetail(body, sigla)) return { status: "unavailable", reason: "invalid", url };

  return { status: "ok", detail: body, url };
}

// ---------------------------------------------------------------------------
// Acessores de conveniência
// ---------------------------------------------------------------------------

/** Agremiações do resultado, ou `[]` quando indisponível. */
export function agremiacoesFrom(result: DeputadoUfDetailResult): DeputadoUfAgremiacao[] {
  return result.status === "ok" ? result.detail.agremiacoes : [];
}

/**
 * Ordem canônica de exibição das agremiações de uma UF, com desempate
 * explícito (constituição § 6): cadeiras desc → votos válidos desc → sigla
 * asc. Reaplicada no consumidor em vez de confiar na ordem recebida — duas
 * agremiações empatadas em cadeiras trocariam de lugar entre ciclos se a
 * ordem viesse de uma estabilidade que ninguém garantiu.
 */
export function ordenarAgremiacoes(
  agremiacoes: readonly DeputadoUfAgremiacao[],
): DeputadoUfAgremiacao[] {
  return [...agremiacoes].sort((a, b) => {
    if (b.cadeiras !== a.cadeiras) return b.cadeiras - a.cadeiras;
    if (b.votos_validos !== a.votos_validos) return b.votos_validos - a.votos_validos;
    return a.sigla.localeCompare(b.sigla, "pt-BR");
  });
}

/**
 * Ordem canônica dos candidatos dentro de uma agremiação: `ordem` asc, com
 * `sqcand` asc como desempate estável final.
 */
export function ordenarCandidatos(
  candidatos: readonly DeputadoUfCandidato[],
): DeputadoUfCandidato[] {
  return [...candidatos].sort((a, b) => {
    if (a.ordem !== b.ordem) return a.ordem - b.ordem;
    return a.sqcand - b.sqcand;
  });
}
