/**
 * lib/utils/deputado-marcas.ts — spec 026 (RF-261, RF-262, RF-264, RF-266, RF-267),
 * design 026 § 4 e § 8.3.
 *
 * **O único lugar que decide o que uma linha de candidato de Deputado Federal
 * mostra como marca.** Servidor e cliente usam as mesmas funções: o servidor
 * deriva as marcas e manda ao componente cliente uma tupla com o resultado já
 * derivado (§ 8.3); o cliente, ao buscar as posições 61+, converte cada linha
 * pela MESMA {@link paraLinhaCompacta}. Duas derivações do mesmo "eleito"
 * divergiriam em silêncio no primeiro caso de borda — é a lição do nome de
 * candidato (`lib/utils/nome-candidato.ts`) aplicada às marcas.
 *
 * ## As três marcas e a precedência (design § 4)
 *
 *   1. Linha com `destino` (voto para a legenda, anulado, sub judice) ⇒ nenhuma
 *      marca de eleito. O produtor já não a marca; a tela também não (ADR-0064).
 *   2. Totalização final (`tf = "s"`) ⇒ **só** a marca do TSE. Parcial e
 *      projeção somem da UF inteira: o resultado oficial tem precedência
 *      (RF-267).
 *   3. Senão: "eleito na parcial" se `parcial`; "eleito na projeção · não
 *      oficial" se `projecao` **e** a projeção está visível — as duas podem
 *      coexistir.
 *
 * "Visível" são DUAS leituras, sempre juntas ({@link projecaoVisivel}): o
 * estado publicado pelo modelo (`projecao.estado === "liberada"`) **e** o
 * interruptor lido no render (RF-265). Só o primeiro deixaria a projeção no ar
 * até 30 min depois de o dono desligá-la (ADR-0063 D4).
 *
 * ## Nunca "eleito" sozinho (RF-266, constituição § 1)
 *
 * Os únicos textos de marca são "eleito na parcial", "eleito na projeção · não
 * oficial" e "Eleito (TSE)". O rótulo que o TSE escreveu ("Eleito por QP",
 * "Eleito por média") pode acompanhar a marca do TSE, entre aspas — é a palavra
 * do TSE, citada; nunca vira a NOSSA via, e a nossa via ("pelo quociente",
 * "nas sobras") nunca vira rótulo do TSE (design § 2.2, RF-262).
 *
 * ## A ordem nunca é decidida aqui
 *
 * A lista segue o `rank` do produtor (voto apurado, design § 3.1). Nada neste
 * módulo ordena por marca ou por projeção (constituição § 2, ADR-0063 D5);
 * {@link ordenarPorRank} só reaplica a ordem do próprio `rank`.
 *
 * ## Tipos estruturais, de propósito
 *
 * As interfaces daqui são o SUBCONJUNTO de `DeputadoUfLinha` (design § 2.2,
 * `lib/edge-config/types.ts`) que cada função lê; as uniões (via, destino,
 * rótulo do TSE) SÃO as do contrato, importadas. O tipo canônico é aceito por
 * estas funções sem conversão — e este módulo não muda quando ele ganhar
 * campos.
 */

import type {
  DeputadoDestinoProporcional,
  DeputadoMarcaTse,
  DeputadoVia,
} from "@/lib/edge-config/types";
import { formatPercentTrim } from "@/lib/utils/format";

// ---------------------------------------------------------------------------
// Vocabulário do contrato (design § 2.2) — só o que as marcas leem
// ---------------------------------------------------------------------------

/** Por onde a vaga veio **na nossa conta** (quociente partidário ou sobras). Não é rótulo do TSE. */
export type ViaDeputado = DeputadoVia;

/** `cand.dvt` mapeado, só quando NÃO é voto nominal válido (design § 2.2). */
export type DestinoDeputado = DeputadoDestinoProporcional;

/** `cand.st` mapeado — só existe com totalização final. */
export type RotuloTse = DeputadoMarcaTse;

/** Os três valores de `tse` que significam "eleito pelo TSE". */
export type RotuloTseEleito = "eleito_qp" | "eleito_media" | "eleito";

/** O que {@link marcasDaLinha} lê de uma linha. */
export interface LinhaParaMarca {
  parcial?: ViaDeputado;
  /** Sobra apertada na parcial (`_marcar_indefinidas`). Só com `parcial: "sobra"`. */
  indefinido?: boolean;
  projecao?: ViaDeputado;
  projecao_apertada?: boolean;
  tse?: RotuloTse;
  destino?: DestinoDeputado;
}

/** A linha inteira, como {@link paraLinhaCompacta} a lê (design § 2.2). */
export interface LinhaDeputado extends LinhaParaMarca {
  sqcand: number;
  nome: string;
  partido: string;
  numero?: number;
  votos: number;
  rank: number;
  pct_validos: number | null;
}

/** Contexto da UF que decide a precedência. */
export interface ContextoMarcas {
  /** `detail.totalizacao_final` — o agregado da UF trouxe `tf = "s"`. */
  totalizacaoFinal: boolean;
  /** {@link projecaoVisivel} — estado `liberada` E interruptor ligado. */
  projecaoVisivel: boolean;
}

// ---------------------------------------------------------------------------
// A derivação
// ---------------------------------------------------------------------------

export type Marca =
  /** "Eleito (TSE)". `rotulo` é o que o TSE escreveu, para citar — nunca a nossa via. */
  | { tipo: "tse"; rotulo: RotuloTseEleito }
  /** "eleito na projeção · não oficial". */
  | { tipo: "projecao"; via: ViaDeputado; apertada: boolean }
  /**
   * "eleito na parcial". `via: null` só no objeto v1 (sem `contrato`), que não
   * diz por onde a vaga veio — ver {@link linhasCompactasDoV1}.
   */
  | { tipo: "parcial"; via: ViaDeputado | null; apertada: boolean };

const TSE_ELEITO: ReadonlySet<RotuloTse> = new Set<RotuloTse>([
  "eleito_qp",
  "eleito_media",
  "eleito",
]);

function ehTseEleito(rotulo: RotuloTse | undefined): rotulo is RotuloTseEleito {
  return rotulo !== undefined && TSE_ELEITO.has(rotulo);
}

/**
 * A projeção só é visível com as DUAS leituras juntas: o estado que o modelo
 * publicou para a UF e o interruptor lido no render (ADR-0063 D4, RF-265).
 * Estado ausente (objeto v1, ou UF sem campo) ⇒ não visível.
 */
export function projecaoVisivel(
  projecao: { estado: string } | null | undefined,
  interruptorLigado: boolean,
): boolean {
  return interruptorLigado === true && projecao?.estado === "liberada";
}

/**
 * As marcas de UMA linha, na ordem de exibição (design § 4). Pura.
 *
 * Regras, nesta ordem: `destino` ⇒ nenhuma; totalização final ⇒ só a do TSE
 * (ou nenhuma); senão parcial e/ou projeção (esta só se visível).
 */
export function marcasDaLinha(linha: LinhaParaMarca, ctx: ContextoMarcas): Marca[] {
  if (linha.destino !== undefined) return [];

  if (ctx.totalizacaoFinal) {
    return ehTseEleito(linha.tse) ? [{ tipo: "tse", rotulo: linha.tse }] : [];
  }

  const marcas: Marca[] = [];
  if (linha.parcial !== undefined) {
    marcas.push({
      tipo: "parcial",
      via: linha.parcial,
      apertada: linha.parcial === "sobra" && linha.indefinido === true,
    });
  }
  if (linha.projecao !== undefined && ctx.projecaoVisivel) {
    marcas.push({
      tipo: "projecao",
      via: linha.projecao,
      apertada: linha.projecao === "sobra" && linha.projecao_apertada === true,
    });
  }
  return marcas;
}

// ---------------------------------------------------------------------------
// Texto — nunca "eleito" sozinho
// ---------------------------------------------------------------------------

/** O texto principal de cada tipo de marca. São os ÚNICOS três (RF-266). */
export const TEXTO_MARCA = {
  parcial: "eleito na parcial",
  projecao: "eleito na projeção · não oficial",
  tse: "Eleito (TSE)",
} as const;

/** A NOSSA via, dita como conta nossa. */
export const TEXTO_VIA: Readonly<Record<ViaDeputado, string>> = {
  qp: "pelo quociente",
  sobra: "nas sobras",
};

/** Como o TSE escreve o `st` — citado entre aspas, nunca parafraseado em via. */
export const TEXTO_ROTULO_TSE: Readonly<Record<RotuloTseEleito, string | null>> = {
  eleito_qp: "Eleito por QP",
  eleito_media: "Eleito por média",
  // "Eleito" sem qualificativo não acrescenta nada a "Eleito (TSE)" — e
  // citá-lo sozinho seria o "eleito" solto que o RF-266 proíbe.
  eleito: null,
};

/** As partes de texto de uma marca, para o átomo `<MarcaDeputado>` montar. */
export interface TextoDaMarca {
  /** Sempre um dos três de {@link TEXTO_MARCA}. */
  principal: string;
  /** Nossa via (parcial/projeção) — ausente na do TSE e no v1. */
  via: string | null;
  /** "sobra apertada" (parcial) ou "apertada" (projeção). */
  apertada: string | null;
  /** O `st` do TSE, citado. Só na marca do TSE. */
  citacaoTse: string | null;
}

export function textoDaMarca(marca: Marca): TextoDaMarca {
  switch (marca.tipo) {
    case "tse":
      return {
        principal: TEXTO_MARCA.tse,
        via: null,
        apertada: null,
        citacaoTse: TEXTO_ROTULO_TSE[marca.rotulo],
      };
    case "projecao":
      return {
        principal: TEXTO_MARCA.projecao,
        via: TEXTO_VIA[marca.via],
        apertada: marca.apertada ? "apertada" : null,
        citacaoTse: null,
      };
    case "parcial":
      return {
        principal: TEXTO_MARCA.parcial,
        via: marca.via === null ? null : TEXTO_VIA[marca.via],
        apertada: marca.apertada ? "sobra apertada" : null,
        citacaoTse: null,
      };
  }
}

/** A marca inteira em uma linha de texto — "eleito na parcial · nas sobras · sobra apertada". */
export function textoCorridoDaMarca(marca: Marca): string {
  const t = textoDaMarca(marca);
  const partes = [t.principal, t.via, t.apertada].filter((p): p is string => p !== null);
  const base = partes.join(" · ");
  return t.citacaoTse ? `${base} · “${t.citacaoTse}”` : base;
}

/**
 * Texto que ocupa o lugar do % quando o voto não é nominal válido
 * (design § 4, RF-261). Nunca "0,00%".
 */
export const TEXTO_DESTINO: Readonly<Record<DestinoDeputado, string>> = {
  valido_legenda: "votos para a legenda",
  anulado: "votos anulados",
  sub_judice: "sub judice — fora da conta",
};

// ---------------------------------------------------------------------------
// Bitmask (design § 8.3) — as marcas JÁ derivadas, numa tupla de posição fixa
// ---------------------------------------------------------------------------

/**
 * Bits das marcas derivadas. O cliente nunca rederiva a precedência a partir
 * dos bits — eles SÃO o resultado de {@link marcasDaLinha}.
 */
export const BIT_MARCA = {
  PARCIAL: 1,
  PARCIAL_SOBRA: 2,
  /** Objeto v1: eleito na parcial sem saber por qual via. */
  PARCIAL_SEM_VIA: 4,
  PARCIAL_APERTADA: 8,
  PROJECAO: 16,
  PROJECAO_SOBRA: 32,
  PROJECAO_APERTADA: 64,
  TSE: 128,
  TSE_QP: 256,
  TSE_MEDIA: 512,
} as const;

export function bitsDasMarcas(marcas: readonly Marca[]): number {
  let bits = 0;
  for (const m of marcas) {
    if (m.tipo === "parcial") {
      bits |= BIT_MARCA.PARCIAL;
      if (m.via === "sobra") bits |= BIT_MARCA.PARCIAL_SOBRA;
      if (m.via === null) bits |= BIT_MARCA.PARCIAL_SEM_VIA;
      if (m.apertada) bits |= BIT_MARCA.PARCIAL_APERTADA;
    } else if (m.tipo === "projecao") {
      bits |= BIT_MARCA.PROJECAO;
      if (m.via === "sobra") bits |= BIT_MARCA.PROJECAO_SOBRA;
      if (m.apertada) bits |= BIT_MARCA.PROJECAO_APERTADA;
    } else {
      bits |= BIT_MARCA.TSE;
      if (m.rotulo === "eleito_qp") bits |= BIT_MARCA.TSE_QP;
      if (m.rotulo === "eleito_media") bits |= BIT_MARCA.TSE_MEDIA;
    }
  }
  return bits;
}

/** O inverso de {@link bitsDasMarcas}, na ordem de exibição: TSE, parcial, projeção. */
export function marcasDosBits(bits: number): Marca[] {
  const marcas: Marca[] = [];
  if (bits & BIT_MARCA.TSE) {
    const rotulo: RotuloTseEleito =
      bits & BIT_MARCA.TSE_QP
        ? "eleito_qp"
        : bits & BIT_MARCA.TSE_MEDIA
          ? "eleito_media"
          : "eleito";
    marcas.push({ tipo: "tse", rotulo });
  }
  if (bits & BIT_MARCA.PARCIAL) {
    marcas.push({
      tipo: "parcial",
      via:
        bits & BIT_MARCA.PARCIAL_SEM_VIA ? null : bits & BIT_MARCA.PARCIAL_SOBRA ? "sobra" : "qp",
      apertada: (bits & BIT_MARCA.PARCIAL_APERTADA) !== 0,
    });
  }
  if (bits & BIT_MARCA.PROJECAO) {
    marcas.push({
      tipo: "projecao",
      via: bits & BIT_MARCA.PROJECAO_SOBRA ? "sobra" : "qp",
      apertada: (bits & BIT_MARCA.PROJECAO_APERTADA) !== 0,
    });
  }
  return marcas;
}

/** 0 nenhum · 1 valido_legenda · 2 anulado · 3 sub_judice (design § 8.3). */
export type CodigoDestino = 0 | 1 | 2 | 3;

const CODIGO_DESTINO: Readonly<Record<DestinoDeputado, CodigoDestino>> = {
  valido_legenda: 1,
  anulado: 2,
  sub_judice: 3,
};

const DESTINO_DO_CODIGO: readonly (DestinoDeputado | null)[] = [
  null,
  "valido_legenda",
  "anulado",
  "sub_judice",
];

export function codigoDoDestino(destino: DestinoDeputado | undefined): CodigoDestino {
  // Valor fora da tabela fechada ⇒ tratado como ausente — o mesmo que o
  // produtor faz (design § 2.2, "sem default"). A tela não adivinha.
  if (destino === undefined) return 0;
  return CODIGO_DESTINO[destino] ?? 0;
}

export function destinoDoCodigo(codigo: number): DestinoDeputado | null {
  return DESTINO_DO_CODIGO[codigo] ?? null;
}

// ---------------------------------------------------------------------------
// A tupla compacta (design § 8.3) — contrato interno da frente U
// ---------------------------------------------------------------------------

/**
 * Uma linha como o componente cliente a recebe: posição fixa em vez de objeto
 * com chaves, porque o payload RSC de SP repetiria ~1.000 × os nomes das
 * chaves (ADR-0065 D5). Não trafega no Blob.
 *
 * `nome` e `partido` já vêm na forma de EXIBIÇÃO (quem chama passa as funções
 * de exibição); `partido` vem `""` quando a agremiação é partido isolado — a
 * coluna só existe em federação, e a string repetida seria peso sem leitor.
 */
export type LinhaCompacta = readonly [
  rank: number,
  sqcand: number,
  nome: string,
  partido: string,
  numero: number | null,
  votos: number,
  pctValidos: number | null,
  marcas: number,
  destino: CodigoDestino,
];

/** Índices da {@link LinhaCompacta}, para ninguém ler `linha[6]` sem nome. */
export const L = {
  RANK: 0,
  SQCAND: 1,
  NOME: 2,
  PARTIDO: 3,
  NUMERO: 4,
  VOTOS: 5,
  PCT: 6,
  MARCAS: 7,
  DESTINO: 8,
} as const;

/** Funções de exibição que {@link paraLinhaCompacta} aplica. Identidade quando ausentes. */
export interface ExibicaoLinha {
  /** `nomeExibicao` de `lib/utils/nome-candidato.ts`. */
  nome?: (nome: string, sqcand: string) => string;
  /** `siglaExibicao` de `lib/utils/sigla-partido.ts`. */
  partido?: (sigla: string) => string;
  /** `false` em partido isolado — a coluna de partido não existe. */
  mostrarPartido?: boolean;
}

/**
 * Linha do contrato → tupla, com as marcas derivadas por {@link marcasDaLinha}.
 * É a MESMA função no servidor (posições 1–60) e no cliente (61+).
 *
 * `pct_validos` sai `null` sempre que há destino, mesmo que o dado traga um
 * número: a tela nunca mostra % ao lado de voto que não é nominal válido
 * (RF-261; ADR-0064 decisão 5).
 */
export function paraLinhaCompacta(
  linha: LinhaDeputado,
  ctx: ContextoMarcas,
  exibicao: ExibicaoLinha = {},
): LinhaCompacta {
  const destino = codigoDoDestino(linha.destino);
  const nome = exibicao.nome ? exibicao.nome(linha.nome, String(linha.sqcand)) : linha.nome;
  const partido =
    exibicao.mostrarPartido === false
      ? ""
      : exibicao.partido
        ? exibicao.partido(linha.partido)
        : linha.partido;
  return [
    linha.rank,
    linha.sqcand,
    nome,
    partido,
    typeof linha.numero === "number" ? linha.numero : null,
    linha.votos,
    destino !== 0 || typeof linha.pct_validos !== "number" ? null : linha.pct_validos,
    bitsDasMarcas(marcasDaLinha(linha, ctx)),
    destino,
  ];
}

/**
 * Ordem de exibição: o `rank` do produtor, `sqcand` como desempate estável
 * final. NUNCA marca, projeção ou nome (constituição § 2). Não muta a entrada.
 */
export function ordenarPorRank<T extends LinhaCompacta>(linhas: readonly T[]): T[] {
  return [...linhas].sort((a, b) => a[L.RANK] - b[L.RANK] || a[L.SQCAND] - b[L.SQCAND]);
}

/**
 * Une o que a página já tem com o que chegou da rota 61+, **por `sqcand`** —
 * nunca duplica uma candidatura (ADR-0065 D1) —, e devolve na ordem do rank.
 * Em conflito, a linha que JÁ estava na página vence: ela é a do objeto da UF,
 * com as marcas derivadas no servidor.
 */
export function unirPorSqcand(
  atuais: readonly LinhaCompacta[],
  novas: readonly LinhaCompacta[],
): { linhas: LinhaCompacta[]; acrescentadas: LinhaCompacta[] } {
  const vistos = new Set(atuais.map((l) => l[L.SQCAND]));
  const acrescentadas = novas.filter((l) => !vistos.has(l[L.SQCAND]));
  return { linhas: ordenarPorRank([...atuais, ...acrescentadas]), acrescentadas };
}

// ---------------------------------------------------------------------------
// Objeto v1 (RF-276, design § 2.12)
// ---------------------------------------------------------------------------

/** O que o objeto v1 carrega por candidato (`DeputadoUfCandidato`). */
export interface CandidatoV1 {
  sqcand: number;
  nome: string;
  partido: string;
  votos: number;
  ordem: number;
  indefinido?: boolean;
}

/**
 * Objeto v1 (sem `contrato`, sem `candidatos`): a lista é `eleitos` +
 * `suplentes`, cada grupo em `ordem`, sem % nem número (RF-276).
 *
 * Os eleitos do v1 SÃO a parcial (o objeto v1 só tinha a parcial) — marcados
 * "eleito na parcial", sem via, porque o v1 não diz por onde a vaga veio.
 * `rank` é a posição na lista montada, e não `ordem`: há objetos v1 em que a
 * `ordem` dos suplentes recomeça em 1 (ver `tests/fixtures/contrato`).
 */
export function linhasCompactasDoV1(
  agr: { eleitos: readonly CandidatoV1[]; suplentes: readonly CandidatoV1[] },
  exibicao: ExibicaoLinha = {},
): LinhaCompacta[] {
  const porOrdem = (xs: readonly CandidatoV1[]) =>
    [...xs].sort((a, b) => a.ordem - b.ordem || a.sqcand - b.sqcand);
  const saida: LinhaCompacta[] = [];
  const empurrar = (c: CandidatoV1, marcas: number) => {
    const nome = exibicao.nome ? exibicao.nome(c.nome, String(c.sqcand)) : c.nome;
    const partido =
      exibicao.mostrarPartido === false
        ? ""
        : exibicao.partido
          ? exibicao.partido(c.partido)
          : c.partido;
    saida.push([saida.length + 1, c.sqcand, nome, partido, null, c.votos, null, marcas, 0]);
  };
  for (const c of porOrdem(agr.eleitos)) {
    empurrar(
      c,
      BIT_MARCA.PARCIAL |
        BIT_MARCA.PARCIAL_SEM_VIA |
        (c.indefinido === true ? BIT_MARCA.PARCIAL_APERTADA : 0),
    );
  }
  for (const c of porOrdem(agr.suplentes)) empurrar(c, 0);
  return saida;
}

// ---------------------------------------------------------------------------
// Estado da projeção, em texto (RF-264, RF-266)
// ---------------------------------------------------------------------------

/** O que as frases do estado da projeção leem (design § 2.7). */
export interface ProjecaoUfParaTexto {
  estado: "liberada" | "aguardando" | "indisponivel" | string;
  motivo?: string;
  pct_minimo: number;
  zonas_apuradas: number;
  zonas_total: number;
}

/**
 * Mínimo de zonas apuradas da trava (design § 2.7, condição 5). O payload não
 * o carrega; a constante do modelo é a mesma (`deputado_projecao.py`). Se
 * mudar lá, muda aqui — não há outro lugar que o escreva.
 */
export const ZONAS_MINIMAS_PROJECAO = 2;

/** "25%", "18,7%" — o mesmo formatador do resto do produto, sem `,0` inútil. */
const pct1 = (valor: number): string => formatPercentTrim(valor, 1);

/**
 * A linha do resumo da página de UF com o estado da projeção (spec 026 §
 * Telas, item 2). **Toda** variante traz "projeção" e "não oficial" na mesma
 * frase (RF-266): quem chama a põe num elemento só.
 *
 * `null` quando não há estado publicado (objeto v1) — nada a dizer.
 */
export function fraseEstadoProjecao(
  projecao: ProjecaoUfParaTexto | null | undefined,
  pctApurado: number,
): string | null {
  if (!projecao) return null;
  const pre = "Projeção · não oficial:";
  if (projecao.estado === "liberada") {
    return "Projeção liberada · não oficial — estimativa nossa do resultado final do estado, zona a zona.";
  }
  if (projecao.estado === "aguardando") {
    switch (projecao.motivo) {
      case "pct_minimo":
        return `${pre} aparece a partir de ${pct1(projecao.pct_minimo)} do eleitorado apurado (agora ${pct1(pctApurado)}).`;
      case "zonas_minimas":
        return `${pre} aparece com ao menos ${ZONAS_MINIMAS_PROJECAO} zonas eleitorais apuradas (agora ${projecao.zonas_apuradas}).`;
      case "sem_vagas":
        return `${pre} aparece depois que o TSE publicar quantas cadeiras o estado elege.`;
      default:
        return `${pre} aguardando mais apuração.`;
    }
  }
  switch (projecao.motivo) {
    case "interruptor":
      return `${pre} desligada neste cálculo.`;
    case "coligacao":
      return `${pre} indisponível — o dado deste estado traz coligação, que a lei não admite mais na eleição proporcional.`;
    case "cobertura":
      return `${pre} indisponível — o eleitorado das zonas que lemos não fecha com o total do TSE (ver a Conferência).`;
    case "erro":
      return `${pre} indisponível — o cálculo falhou neste ciclo; a parcial segue normal.`;
    default:
      return `${pre} indisponível.`;
  }
}

/**
 * O selo curto por UF na grade da capa (design § 8.4). Mesma regra: "projeção"
 * e "não oficial" juntos. Quem chama só o passa com o interruptor ligado.
 */
export function seloEstadoProjecao(
  projecao: ProjecaoUfParaTexto | null | undefined,
): string | null {
  if (!projecao) return null;
  if (projecao.estado === "liberada") return "projeção liberada · não oficial";
  if (projecao.estado === "aguardando") {
    return projecao.motivo === "pct_minimo"
      ? `projeção · não oficial: aguarda ${pct1(projecao.pct_minimo)}`
      : "projeção · não oficial: aguardando";
  }
  return "projeção · não oficial: indisponível";
}

// ---------------------------------------------------------------------------
// Linha de corte (RF-272) — texto compartilhado pela lista e pelo cabeçalho
// ---------------------------------------------------------------------------

/** O `corte` do contrato (design § 2.3), só com o que o texto lê. */
export interface CorteParaTexto {
  diferenca: number;
  primeiro_fora_abaixo_piso_10?: boolean;
}

const PISO_10_TEXTO =
  "O primeiro de fora está abaixo do piso de 10% do quociente eleitoral — só poderia entrar numa rodada de sobras aberta a todos.";

/**
 * A frase da linha de corte, dentro da lista (entre o último eleito na parcial
 * e o primeiro de fora). O corte é SEMPRE da parcial — nunca da projeção nem do
 * TSE —, e a frase diz isso.
 */
export function fraseCorte(
  corte: CorteParaTexto,
  nomes: { ultimo?: string | null; primeiro?: string | null } = {},
): string {
  const votos = corte.diferenca.toLocaleString("pt-BR");
  const unidade = corte.diferenca === 1 ? "voto separa" : "votos separam";
  const ultimo = nomes.ultimo ? ` (${nomes.ultimo})` : "";
  const primeiro = nomes.primeiro ? ` (${nomes.primeiro})` : "";
  const base = `Linha de corte: ${votos} ${unidade} o último eleito na parcial${ultimo} do primeiro de fora${primeiro}.`;
  return corte.primeiro_fora_abaixo_piso_10 ? `${base} ${PISO_10_TEXTO}` : base;
}

/**
 * A repetição curta no cabeçalho da agremiação (RF-272: o corte não some quando
 * a faixa 21–60 está fechada).
 */
export function fraseCorteCabecalho(corte: CorteParaTexto): string {
  const votos = corte.diferenca.toLocaleString("pt-BR");
  const unidade = corte.diferenca === 1 ? "voto" : "votos";
  const base = `Corte: ${votos} ${unidade} entre o último eleito na parcial e o primeiro de fora.`;
  return corte.primeiro_fora_abaixo_piso_10 ? `${base} ${PISO_10_TEXTO}` : base;
}
