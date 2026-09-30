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

import type { InterruptorProjecaoLido } from "@/lib/edge-config/reader";
import type {
  DeputadoConferencia,
  DeputadoCorte,
  DeputadoProjecaoEstado,
  DeputadoProjecaoUf,
  DeputadoPuxador,
  DeputadoRegras,
  DeputadoUfLinha,
  EdgeDeputadoDestaque,
  EdgeDeputadoUfRow,
  EdgePayloadDeputado,
  EdgeVotacaoUf,
} from "@/lib/edge-config/types";
import { logWarn } from "@/lib/tse/log";

import { blobUrlFor, deputadoUfBlobPathname, deputadoUfListaBlobPathname } from "./paths";

// Os tipos v2 (design 026 § 2) moram em `lib/edge-config/types.ts` — o
// nacional também os usa — e são reexportados aqui, onde o consumidor do Blob
// os procura.
export type {
  DeputadoComparacao,
  DeputadoConferencia,
  DeputadoCorte,
  DeputadoDestinoProporcional,
  DeputadoDivergencia,
  DeputadoDivergenciaChave,
  DeputadoMarcaTse,
  DeputadoProjecaoEstado,
  DeputadoProjecaoMotivo,
  DeputadoProjecaoUf,
  DeputadoPuxador,
  DeputadoRegras,
  DeputadoUfLinha,
  DeputadoVia,
  EdgeDeputadoDestaque,
  EdgeDeputadoPuxador,
} from "@/lib/edge-config/types";

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
  /**
   * Posição dentro de `eleitos` (ou de `suplentes`), 1-based, por votos desc.
   *
   * Não é o `rank` da spec 026 (`DeputadoUfLinha.rank`): `ordem` numera a lista
   * em que a linha está, `rank` numera a agremiação inteira. `eleitos` e
   * `suplentes` seguem v1 mesmo num objeto v2 (design 026 § 2.12).
   */
  ordem: number;
  /**
   * RF-127 — eleito por sobra cuja atribuição ainda depende de resultado
   * indefinido. A tela marca; nunca exibe firmeza que o cálculo não tem.
   */
  indefinido?: boolean;
}

/** Uma agremiação (partido isolado ou federação) dentro de uma UF. */
export interface DeputadoUfAgremiacao {
  /**
   * Chave nacional da agremiação (nº do partido ou `"fed:<nº>"`) — a MESMA de
   * `EdgeAgremiacaoBancada.cod`. Não é o `agr[].n` do EA20 (design 017 D3,
   * emenda de 2026-09-29).
   */
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

  // --- spec 026 (contrato v2) — todos opcionais; ausentes num objeto v1 ---

  /**
   * RF-260 (design 026 § 2.3) — ranks 1..60 ∪ todo candidato com marca
   * (parcial, projeção, TSE eleito*) ∪ `corte.primeiro_fora`, por `rank` asc.
   * Os demais (rank > 60 sem marca) ficam no objeto de lista
   * (`deputado/uf-lista/<UF>.json`, {@link readDeputadoUfLista}).
   *
   * `eleitos`/`suplentes` continuam existindo, com a semântica v1.
   */
  candidatos?: DeputadoUfLinha[];
  /** Total de candidatos da agremiação na UF (Blob + lista 61+). */
  total_candidatos?: number;
  /** Só com projeção liberada. Eleitos na projeção — mesma semântica de `cadeiras` (RF-125.1). */
  cadeiras_projetadas?: number;
  /** RF-127 emendado (ADR-0063). Ausente quando não medida — nunca `[n, n]`. */
  cadeiras_projetadas_ci95?: [number, number];
  /** Só com projeção liberada. Votos válidos projetados (nominais válidos + legenda). */
  votos_projetados?: number;
  /** RF-272 — na PARCIAL. Ausente sem eleito ou sem candidato válido de fora. */
  corte?: DeputadoCorte;
  /** RF-273 — ausente quando ninguém da agremiação tem excedente ≥ 1. Por rank asc. */
  puxadores?: DeputadoPuxador[];
}

/** Nome do design 026 § 2.3 — a agremiação com os campos v2 (todos opcionais). */
export type DeputadoUfAgremiacaoV2 = DeputadoUfAgremiacao;

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
  divergencias: Array<{
    o_que: string;
    nosso: number;
    tse: number;
    detalhe: string;
    /** Spec 026 — presente em `eleitorado` e `votos_validos`. */
    diferenca_pct?: number;
  }>;
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

  // --- tipos em dia (RF-276) — o Python já publicava, o TS não declarava ---

  /**
   * ADR-0038 D1 — a hora do dado do TSE desta UF. Três estados: ausente
   * (objeto anterior ao campo), `null` (hora indisponível neste ciclo),
   * string ISO. Nunca colapsar os três em dois.
   */
  dado_ts?: string | null;
  /** ADR-0038 D2 — pares desta UF mais de 2 cadências atrás do `dado_ts`. */
  pares_atrasados?: number | null;

  // --- spec 026 (contrato v2) — todos opcionais; ausentes num objeto v1 ---

  /** Versão do contrato. Ausente ⇒ v1 (design 026 § 2.4). */
  contrato?: 2;
  /** RF-274 — ausente sem QE (sem `nv` ou sem voto). */
  regras?: DeputadoRegras;
  /** RF-264 — presente em todo objeto v2. */
  projecao?: DeputadoProjecaoUf;
  /** RF-269 — presente em todo objeto v2. `divergencias` (v1, topo) === `conferencia.divergencias`. */
  conferencia?: DeputadoConferencia;
  /**
   * RF-270 — top 10 da UF por voto apurado, como REFERÊNCIA a linhas de
   * `agremiacoes[].candidatos` (design § 3.2). Resolva com {@link maisVotadosDaUf}.
   */
  mais_votados?: Array<{ cod: string; sqcand: number }>;
  /**
   * RF-260 — quantas linhas o objeto de lista desta UF tem (ranks 61+).
   * Ausente quando não há rank > 60 (na prática, toda UF menos SP).
   */
  lista?: { restantes: number };
}

/** Nome do design 026 § 2.4 — o objeto da UF com os campos v2 (todos opcionais). */
export type DeputadoUfDetailV2 = DeputadoUfDetail;

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

  return { status: "ok", detail: sanearDeputadoUfDetail(body), url };
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

// ---------------------------------------------------------------------------
// Leitor tolerante — spec 026 RF-276 (design § 2.12)
// ---------------------------------------------------------------------------
//
// O contrato v2 é ADITIVO: um objeto v1 passa por aqui e sai com o mesmo
// conteúdo. O que este bloco faz é outra coisa — garantir que um campo v2 com
// FORMA INESPERADA (um `parcial: "QP"` em caixa alta, um `candidatos` que veio
// objeto em vez de lista) não derrube o render com um `.map` de undefined.
// A regra é uma só: campo opcional malformado é DESCARTADO, e a tela cai no
// estado "não sabemos" daquele bloco — nunca lança, nunca inventa.
//
// ⚠️ Descartar em silêncio seria a rede de segurança de mão única deste
// projeto: o Python publicaria `"QP"` a noite toda e nenhuma marca apareceria,
// sem erro em lugar nenhum. Por isso cada descarte emite UM `warn` por campo
// por processo (e não por render — seria uma linha por leitor).
//
// As tabelas abaixo são as do design § 2.2/§ 2.7/§ 2.8 — FECHADAS.

const VIAS: ReadonlySet<string> = new Set(["qp", "sobra"]);
const MARCAS_TSE: ReadonlySet<string> = new Set([
  "eleito_qp",
  "eleito_media",
  "eleito",
  "suplente",
  "nao_eleito",
]);
const DESTINOS: ReadonlySet<string> = new Set(["valido_legenda", "anulado", "sub_judice"]);
const ESTADOS_PROJECAO: ReadonlySet<string> = new Set(["liberada", "aguardando", "indisponivel"]);
const MOTIVOS_PROJECAO: ReadonlySet<string> = new Set([
  "pct_minimo",
  "zonas_minimas",
  "sem_vagas",
  "interruptor",
  "coligacao",
  "cobertura",
  "erro",
]);
const ESTADOS_CONFERENCIA: ReadonlySet<string> = new Set(["confere", "diverge", "sem_dado_tse"]);
const COMPARACOES: ReadonlySet<string> = new Set([
  "eleitorado",
  "algoritmo",
  "eleitos",
  "votos_validos",
]);

/** Campos já avisados neste processo — um `warn` por campo, não por render. */
const avisados = new Set<string>();

function avisarDescarte(campo: string, uf: string | undefined): void {
  if (avisados.has(campo)) return;
  avisados.add(campo);
  logWarn("deputado-uf: campo v2 descartado por forma inesperada (spec 026, RF-276)", {
    campo,
    uf: uf ?? "(desconhecida)",
    nota: "a tela mostra o bloco como 'não sabemos'; conferir o contrato (design 026 § 2)",
  });
}

/** Só para os testes: zera o registro de avisos de descarte. */
export function _reiniciarAvisosDeDescarte(): void {
  avisados.clear();
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function ehNumero(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function ehFaixa(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && ehNumero(v[0]) && ehNumero(v[1]);
}

/**
 * Uma linha v2 (`candidatos`, lista 61+). Sem os campos obrigatórios do design
 * § 2.2 (`sqcand`, `nome`, `partido`, `votos`, `rank`, `pct_validos`) a linha
 * não tem como ser desenhada nem ordenada, e sai inteira; com eles, só os
 * opcionais malformados saem. Devolve o próprio objeto quando nada muda — sem
 * cópia no caminho feliz (a página de SP tem ~1.000 linhas).
 */
function sanearLinha(
  bruta: unknown,
  campoBase: string,
  uf: string | undefined,
): DeputadoUfLinha | null {
  if (
    !ehObjeto(bruta) ||
    !ehNumero(bruta.sqcand) ||
    typeof bruta.nome !== "string" ||
    typeof bruta.partido !== "string" ||
    !ehNumero(bruta.votos) ||
    !ehNumero(bruta.rank) ||
    !(bruta.pct_validos === null || ehNumero(bruta.pct_validos))
  ) {
    avisarDescarte(`${campoBase}[]`, uf);
    return null;
  }

  let saida: Record<string, unknown> | null = null;
  const descartar = (campo: string) => {
    const copia: Record<string, unknown> = saida ?? { ...bruta };
    delete copia[campo];
    saida = copia;
    avisarDescarte(`${campoBase}.${campo}`, uf);
  };

  if ("numero" in bruta && !ehNumero(bruta.numero)) descartar("numero");
  if ("parcial" in bruta && !VIAS.has(bruta.parcial as string)) descartar("parcial");
  if ("projecao" in bruta && !VIAS.has(bruta.projecao as string)) descartar("projecao");
  // Booleano opcional só aparece como `true` (design § 2.2).
  if ("indefinido" in bruta && bruta.indefinido !== true) descartar("indefinido");
  if ("projecao_apertada" in bruta && bruta.projecao_apertada !== true) {
    descartar("projecao_apertada");
  }
  if ("tse" in bruta && !MARCAS_TSE.has(bruta.tse as string)) descartar("tse");
  if ("destino" in bruta && !DESTINOS.has(bruta.destino as string)) descartar("destino");

  return (saida ?? bruta) as unknown as DeputadoUfLinha;
}

function sanearLinhas(
  bruta: unknown,
  campoBase: string,
  uf: string | undefined,
): DeputadoUfLinha[] | undefined {
  if (!Array.isArray(bruta)) {
    avisarDescarte(campoBase, uf);
    return undefined;
  }
  const saida: DeputadoUfLinha[] = [];
  for (const item of bruta) {
    const linha = sanearLinha(item, campoBase, uf);
    if (linha) saida.push(linha);
  }
  return saida;
}

function corteValido(v: unknown): v is DeputadoCorte {
  return (
    ehObjeto(v) &&
    ehNumero(v.ultimo_eleito) &&
    ehNumero(v.primeiro_fora) &&
    ehNumero(v.diferenca) &&
    (v.primeiro_fora_abaixo_piso_10 === undefined || v.primeiro_fora_abaixo_piso_10 === true)
  );
}

function puxadoresValidos(v: unknown): v is DeputadoPuxador[] {
  return (
    Array.isArray(v) &&
    v.every(
      (p) => ehObjeto(p) && ehNumero(p.sqcand) && ehNumero(p.quocientes) && ehNumero(p.excedente),
    )
  );
}

function regrasValidas(v: unknown): v is DeputadoRegras {
  return (
    ehObjeto(v) &&
    ehNumero(v.quociente_eleitoral) &&
    ehNumero(v.votos_validos) &&
    ehNumero(v.lugares_a_preencher) &&
    ehNumero(v.piso_candidato) &&
    ehNumero(v.piso_agremiacao_sobras) &&
    ehNumero(v.piso_candidato_sobras)
  );
}

/**
 * Forma válida de {@link DeputadoProjecaoUf} (design § 2.7), inclusive o
 * motivo no conjunto FECHADO. Serve também a `por_uf[].projecao`.
 */
export function projecaoValida(v: unknown): v is DeputadoProjecaoUf {
  return (
    ehObjeto(v) &&
    ESTADOS_PROJECAO.has(v.estado as string) &&
    (v.motivo === undefined || MOTIVOS_PROJECAO.has(v.motivo as string)) &&
    ehNumero(v.pct_minimo) &&
    ehNumero(v.zonas_apuradas) &&
    ehNumero(v.zonas_total)
  );
}

function conferenciaValida(v: unknown): v is DeputadoConferencia {
  return (
    ehObjeto(v) &&
    ESTADOS_CONFERENCIA.has(v.estado as string) &&
    (v.boletim_dado_ts === null || typeof v.boletim_dado_ts === "string") &&
    typeof v.totalizacao_final === "boolean" &&
    Array.isArray(v.comparou) &&
    v.comparou.every((c) => COMPARACOES.has(c as string)) &&
    Array.isArray(v.divergencias)
  );
}

/**
 * `eleitos`/`suplentes` são v1 (design § 2.12): a lista fica como veio — tirar
 * um eleito mudaria a contagem de cadeiras —, e ausente vira `[]`, a forma que
 * a tela já sabe desenhar.
 */
function listaV1(bruta: unknown, campo: string, uf: string | undefined): DeputadoUfCandidato[] {
  if (Array.isArray(bruta)) return bruta as DeputadoUfCandidato[];
  avisarDescarte(campo, uf);
  return [];
}

function sanearAgremiacao(
  bruta: Record<string, unknown>,
  uf: string | undefined,
): DeputadoUfAgremiacao {
  const saida: Record<string, unknown> = {
    ...bruta,
    eleitos: listaV1(bruta.eleitos, "agremiacoes[].eleitos", uf),
    suplentes: listaV1(bruta.suplentes, "agremiacoes[].suplentes", uf),
  };
  const descartar = (campo: string) => {
    delete saida[campo];
    avisarDescarte(`agremiacoes[].${campo}`, uf);
  };

  if ("candidatos" in bruta) {
    const linhas = sanearLinhas(bruta.candidatos, "agremiacoes[].candidatos", uf);
    if (linhas) saida.candidatos = linhas;
    else delete saida.candidatos;
  }
  if ("total_candidatos" in bruta && !ehNumero(bruta.total_candidatos)) {
    descartar("total_candidatos");
  }
  if ("cadeiras_projetadas" in bruta && !ehNumero(bruta.cadeiras_projetadas)) {
    descartar("cadeiras_projetadas");
  }
  if ("cadeiras_projetadas_ci95" in bruta && !ehFaixa(bruta.cadeiras_projetadas_ci95)) {
    descartar("cadeiras_projetadas_ci95");
  }
  if ("votos_projetados" in bruta && !ehNumero(bruta.votos_projetados)) {
    descartar("votos_projetados");
  }
  if ("cadeiras_ci95" in bruta && !ehFaixa(bruta.cadeiras_ci95)) descartar("cadeiras_ci95");
  if ("corte" in bruta && !corteValido(bruta.corte)) descartar("corte");
  if ("puxadores" in bruta && !puxadoresValidos(bruta.puxadores)) descartar("puxadores");

  return saida as unknown as DeputadoUfAgremiacao;
}

/**
 * O leitor tolerante do detalhe de UF (spec 026 RF-276). Aplicado por
 * {@link readDeputadoUfDetail} a todo objeto que chega do Blob; exportado para
 * quem recebe o objeto por outro caminho (fixture de desenvolvimento, modo
 * simulado).
 *
 *   - objeto v1 ⇒ sai com o mesmo conteúdo (só `eleitos`/`suplentes`
 *     ausentes viram `[]`);
 *   - campo v2 com forma inesperada ⇒ sai do objeto, com um `warn` por campo
 *     por processo;
 *   - campo desconhecido ⇒ intocado (o produtor pode avançar sem quebrar o
 *     leitor).
 *
 * Nunca lança.
 */
export function sanearDeputadoUfDetail(detail: DeputadoUfDetail): DeputadoUfDetail {
  const bruto = detail as unknown as Record<string, unknown>;
  const uf = typeof bruto.uf === "string" ? bruto.uf : undefined;
  const saida: Record<string, unknown> = {
    ...bruto,
    agremiacoes: Array.isArray(bruto.agremiacoes)
      ? bruto.agremiacoes.filter(ehObjeto).map((a) => sanearAgremiacao(a, uf))
      : [],
  };
  const descartar = (campo: string) => {
    delete saida[campo];
    avisarDescarte(campo, uf);
  };

  if ("dado_ts" in bruto && bruto.dado_ts !== null && typeof bruto.dado_ts !== "string") {
    descartar("dado_ts");
  }
  if (
    "pares_atrasados" in bruto &&
    bruto.pares_atrasados !== null &&
    !ehNumero(bruto.pares_atrasados)
  ) {
    descartar("pares_atrasados");
  }
  if ("contrato" in bruto && !ehNumero(bruto.contrato)) descartar("contrato");
  if ("regras" in bruto && !regrasValidas(bruto.regras)) descartar("regras");
  if ("projecao" in bruto && !projecaoValida(bruto.projecao)) descartar("projecao");
  if ("conferencia" in bruto && !conferenciaValida(bruto.conferencia)) descartar("conferencia");
  if ("mais_votados" in bruto) {
    if (Array.isArray(bruto.mais_votados)) {
      const refs = bruto.mais_votados.filter(
        (r): r is { cod: string; sqcand: number } =>
          ehObjeto(r) && typeof r.cod === "string" && ehNumero(r.sqcand),
      );
      if (refs.length !== bruto.mais_votados.length) avisarDescarte("mais_votados[]", uf);
      saida.mais_votados = refs;
    } else {
      descartar("mais_votados");
    }
  }
  if ("lista" in bruto && !(ehObjeto(bruto.lista) && ehNumero(bruto.lista.restantes))) {
    descartar("lista");
  }
  // Campo de TRANSPORTE — nunca deveria chegar ao leitor (o escritor o
  // separa). Se chegar, some aqui, para a página não carregar o que ninguém
  // pediu.
  if ("lista_restante" in bruto) descartar("lista_restante");

  return saida as unknown as DeputadoUfDetail;
}

/**
 * Os mais votados da UF (RF-270, design § 2.4) resolvidos a partir das
 * referências `mais_votados[{cod, sqcand}]`, no formato do destaque nacional
 * ({@link EdgeDeputadoDestaque}) — o mesmo componente serve a UF e a capa.
 *
 * Referência que não resolve (agremiação ou linha ausente) é pulada: um
 * destaque sem nome não tem o que mostrar. Objeto v1 ⇒ `[]`.
 */
export function maisVotadosDaUf(detail: DeputadoUfDetail): EdgeDeputadoDestaque[] {
  const refs = detail.mais_votados ?? [];
  if (refs.length === 0) return [];
  const porCod = new Map(detail.agremiacoes.map((a) => [a.cod, a]));
  const saida: EdgeDeputadoDestaque[] = [];
  for (const { cod, sqcand } of refs) {
    const agremiacao = porCod.get(cod);
    const linha = agremiacao?.candidatos?.find((c) => c.sqcand === sqcand);
    if (!agremiacao || !linha) continue;
    saida.push({
      uf: detail.uf.toUpperCase(),
      sqcand: linha.sqcand,
      nome: linha.nome,
      partido: linha.partido,
      cod: agremiacao.cod,
      sigla: agremiacao.sigla,
      ...(linha.numero !== undefined ? { numero: linha.numero } : {}),
      votos: linha.votos,
      pct_validos: linha.pct_validos,
      ...(linha.destino !== undefined ? { destino: linha.destino } : {}),
    });
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Lista restante (ranks 61+) — spec 026 RF-260, ADR-0065, design § 2.5
// ---------------------------------------------------------------------------

/**
 * A partir de qual rank a candidatura (sem marca) sai do objeto da UF e vai
 * para o objeto de lista. As faixas da TELA (20 visíveis · 21–60 na página ·
 * 61+ sob demanda) são do componente; esta é a fronteira do DADO.
 */
export const DEPUTADO_RANK_MAXIMO_NA_PAGINA = 60;

/** As linhas 61+ de UMA agremiação. */
export interface DeputadoUfListaAgremiacao {
  /** O mesmo `cod` da agremiação no objeto da UF (chave nacional, não `agr[].n`). */
  cod: string;
  /** Rank asc. */
  candidatos: DeputadoUfLinha[];
}

/**
 * `deputado/uf-lista/<SIGLA>.json` (design § 2.5). Mesma autodescrição do
 * objeto da UF (`ts`, `uf`): um CDN que sirva o objeto errado precisa poder
 * ser detectado.
 */
export interface DeputadoUfLista {
  /** O MESMO carimbo do objeto da UF no ciclo. */
  ts: string;
  cargo: 6;
  turno: 1;
  contrato: 2;
  uf: string;
  /** Na ordem das agremiações do objeto da UF. */
  agremiacoes: DeputadoUfListaAgremiacao[];
}

/**
 * O campo de TRANSPORTE `payloads_uf[UF].lista_restante` =
 * `DeputadoUfLista["agremiacoes"]` (design § 2.5). O escritor o tira do
 * objeto da UF e monta o envelope.
 */
export type DeputadoListaRestanteTransporte = DeputadoUfLista["agremiacoes"];

/** Um `DeputadoUfDetail` como chega do Python, com o campo de transporte. */
export type DeputadoUfDetailComTransporte = DeputadoUfDetail & {
  lista_restante?: DeputadoListaRestanteTransporte;
};

/**
 * Normaliza o `lista_restante` do transporte. `null` quando ausente OU
 * malformado — nos dois casos o escritor não grava lista neste ciclo.
 */
export function agremiacoesDaListaRestante(bruta: unknown): DeputadoUfListaAgremiacao[] | null {
  if (!Array.isArray(bruta)) return null;
  const valida = bruta.every(
    (a) => ehObjeto(a) && typeof a.cod === "string" && Array.isArray(a.candidatos),
  );
  return valida ? (bruta as DeputadoUfListaAgremiacao[]) : null;
}

export type DeputadoUfListaResult =
  | { status: "ok"; lista: DeputadoUfLista; url: string }
  | { status: "unavailable"; reason: DeputadoUfUnavailableReason; url: string | null };

function isDeputadoUfLista(value: unknown, expectedUf: string): value is DeputadoUfLista {
  return (
    ehObjeto(value) &&
    typeof value.ts === "string" &&
    typeof value.uf === "string" &&
    value.uf.toUpperCase() === expectedUf.toUpperCase() &&
    Array.isArray(value.agremiacoes)
  );
}

/** O leitor tolerante sobre as linhas da lista; agremiação sem `cod` sai. */
export function sanearDeputadoUfLista(lista: DeputadoUfLista): DeputadoUfLista {
  const uf = lista.uf;
  const agremiacoes: DeputadoUfListaAgremiacao[] = [];
  for (const a of lista.agremiacoes as unknown[]) {
    if (!ehObjeto(a) || typeof a.cod !== "string") {
      avisarDescarte("lista.agremiacoes[]", uf);
      continue;
    }
    agremiacoes.push({
      ...a,
      cod: a.cod,
      candidatos: sanearLinhas(a.candidatos, "lista.agremiacoes[].candidatos", uf) ?? [],
    });
  }
  return { ...lista, agremiacoes };
}

/**
 * Lê a lista 61+ de UMA UF do Blob, no servidor. Mesmo contrato de
 * {@link readDeputadoUfDetail}: nunca lança, devolve o motivo, mesma
 * revalidação de 60 s.
 */
export async function readDeputadoUfLista(sigla: string): Promise<DeputadoUfListaResult> {
  let url: string | null;
  try {
    url = blobUrlFor(deputadoUfListaBlobPathname(sigla));
  } catch {
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

  if (!isDeputadoUfLista(body, sigla)) return { status: "unavailable", reason: "invalid", url };

  return { status: "ok", lista: sanearDeputadoUfLista(body), url };
}

// ---------------------------------------------------------------------------
// Interruptor da projeção no RENDER — spec 026 RF-265, ADR-0063 D4
// ---------------------------------------------------------------------------
//
// O interruptor é lido pelo modelo a cada ciclo (vem no corpo do POST,
// design § 2.11) E pela página a cada render. O segundo é o que faz
// "desligar" valer em até ~60 s: a volta de Deputado leva 30 min, e o objeto
// da UF gravado antes de desligar continua no Blob com a projeção dentro.
// Estas funções apagam a projeção do OBJETO LIDO, antes de qualquer componente
// o ver — um lugar só, para nenhuma tela esquecer um campo.
//
// A lista 61+ não passa por aqui: pelo ADR-0065 D1 ela nunca carrega marca nem
// dado de projeção (candidatura com marca fica no objeto da UF).

/** O que o interruptor faz com a projeção de UMA UF. */
export interface EfeitoDoInterruptor {
  estado: Exclude<DeputadoProjecaoEstado, "liberada">;
  /**
   * `interruptor` — desligado, chave ausente OU ilegível (a tela diferencia
   * pelos `origem` do interruptor lido, não pelo motivo: o conjunto de motivos
   * do design § 2.7 é fechado); `pct_minimo` — a trava foi SUBIDA pela chave
   * e esta UF ainda não chegou nela.
   */
  motivo: "interruptor" | "pct_minimo";
  pct_minimo?: number;
}

/**
 * O efeito do interruptor sobre a projeção de uma UF, ou `null` quando ele
 * não muda nada.
 *
 * Desligado — pela operação, por ausência ou por leitura ruim — apaga sempre.
 * A trava subida só age sobre UF que o ciclo publicou como `liberada`: uma UF
 * já `aguardando`/`indisponivel` mantém o motivo do modelo, mais informativo.
 */
export function efeitoDoInterruptor(
  interruptor: InterruptorProjecaoLido,
  pctApuradoUf: number,
  estadoPublicado: DeputadoProjecaoEstado | undefined,
): EfeitoDoInterruptor | null {
  if (!interruptor.ligada) return { estado: "indisponivel", motivo: "interruptor" };
  if (estadoPublicado === "liberada" && pctApuradoUf < interruptor.pct_minimo) {
    return { estado: "aguardando", motivo: "pct_minimo", pct_minimo: interruptor.pct_minimo };
  }
  return null;
}

function semProjecaoNaLinha(linha: DeputadoUfLinha): DeputadoUfLinha {
  if (!("projecao" in linha) && !("projecao_apertada" in linha)) return linha;
  const { projecao: _p, projecao_apertada: _a, ...resto } = linha;
  return resto;
}

function comEfeito(projecao: DeputadoProjecaoUf, efeito: EfeitoDoInterruptor): DeputadoProjecaoUf {
  return {
    ...projecao,
    estado: efeito.estado,
    motivo: efeito.motivo,
    ...(efeito.pct_minimo !== undefined ? { pct_minimo: efeito.pct_minimo } : {}),
  };
}

/**
 * O detalhe de UF com o interruptor aplicado. Sem efeito, devolve o **mesmo
 * objeto**; com efeito, uma cópia sem NENHUM campo de projeção —
 * `projecao`/`projecao_apertada` em toda linha de `candidatos` e
 * `votos_projetados`/`cadeiras_projetadas(_ci95)` em toda agremiação — e com
 * `projecao.estado`/`motivo` dizendo por quê.
 *
 * Um objeto v1 (sem `projecao`) não ganha o campo: continua "não sabemos".
 */
export function aplicarInterruptorProjecao(
  detail: DeputadoUfDetail,
  interruptor: InterruptorProjecaoLido,
): DeputadoUfDetail {
  const efeito = efeitoDoInterruptor(interruptor, detail.pct_apurado, detail.projecao?.estado);
  if (efeito === null) return detail;

  const agremiacoes = detail.agremiacoes.map((a) => {
    const {
      votos_projetados: _v,
      cadeiras_projetadas: _c,
      cadeiras_projetadas_ci95: _ci,
      ...resto
    } = a;
    return a.candidatos ? { ...resto, candidatos: a.candidatos.map(semProjecaoNaLinha) } : resto;
  });

  return {
    ...detail,
    agremiacoes,
    ...(detail.projecao ? { projecao: comEfeito(detail.projecao, efeito) } : {}),
  };
}

/**
 * O payload NACIONAL com o interruptor aplicado: a capa desenha o selo de
 * projeção por UF a partir de `por_uf[].projecao`. Os destaques nacionais
 * (`mais_votados`, `puxadores`) não carregam marca de projeção (design § 2.9).
 * Sem efeito em nenhuma UF, devolve o mesmo objeto.
 */
export function aplicarInterruptorNoNacional(
  payload: EdgePayloadDeputado,
  interruptor: InterruptorProjecaoLido,
): EdgePayloadDeputado {
  let mudou = false;
  const porUf = payload.por_uf.map((row: EdgeDeputadoUfRow) => {
    if (!row.projecao) return row;
    const efeito = efeitoDoInterruptor(interruptor, row.pct_apurado, row.projecao.estado);
    if (efeito === null) return row;
    mudou = true;
    return { ...row, projecao: comEfeito(row.projecao, efeito) };
  });
  return mudou ? { ...payload, por_uf: porUf } : payload;
}
