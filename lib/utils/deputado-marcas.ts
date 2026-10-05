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
 *      coexistir NA DERIVAÇÃO, mas a tela mostra uma base por vez (decisão do
 *      dono, 04/10 — ver {@link separaBases} e {@link avisoSemProjecao}).
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

import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import type {
  DeputadoDestinoProporcional,
  DeputadoMarcaTse,
  DeputadoVia,
} from "@/lib/edge-config/types";
import { formatPercentTrim, formatVotesCompact } from "@/lib/utils/format";
import { TERMO_ESTADO, type TermoDoTerritorio } from "@/lib/utils/termo-territorio";

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
  /** Spec 026 RF-297 — voto projetado da candidatura (ver {@link VotoProjetado}). */
  votos_projetados?: number;
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

export function ehTseEleito(rotulo: RotuloTse | undefined): rotulo is RotuloTseEleito {
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
  // 1º turno encerrado (05/10/2026): a totalização acabou — nenhuma leitura
  // do modelo vai à tela, e as marcas são as da contagem final.
  if (primeiroTurnoEncerrado()) return false;
  return interruptorLigado === true && projecao?.estado === "liberada";
}

/**
 * O cargo tem projeção? Só o Deputado Federal (cargo 6). Decisão do dono,
 * 04/10: Deputado Estadual (7) e Distrital (8) NÃO têm projeção — fica
 * desativada nas telas, qualquer que seja o estado publicado ou o
 * interruptor. Quem monta o {@link ContextoMarcas} de uma tela de deputado
 * passa `cargoTemProjecao(cargo) && projecaoVisivel(...)`.
 */
export function cargoTemProjecao(cargo: number): boolean {
  return cargo === 6;
}

// ---------------------------------------------------------------------------
// Uma base por vez — decisão do dono, 04/10
// ---------------------------------------------------------------------------

/**
 * O aviso que a base "Projeção" mostra quando NÃO há projeção na tela.
 *
 * Decisão do dono (04/10): as marcas seguem o seletor global Parcial/Projeção
 * — em "Parcial" só as da parcial, em "Projeção" só as da projeção; "Eleito
 * (TSE)" nas duas. Sem projeção visível, a base "Projeção" mostra as marcas da
 * PARCIAL e diz isso, num aviso curto que só existe nela (`data-view-only=
 * "proj"`). Dois textos, porque são duas razões diferentes:
 *
 *   - `cargo` ....... Estadual/Distrital: o cargo não tem projeção;
 *   - `travada` ..... Federal com interruptor desligado ou trava abaixo de 25%.
 */
export const AVISO_SEM_PROJECAO = {
  cargo: "Este cargo não tem projeção — as marcas são da parcial.",
  travada: "Projeção ainda não liberada — as marcas são da parcial.",
} as const;

/**
 * O aviso de {@link AVISO_SEM_PROJECAO} para esta tela, ou `null` quando não há
 * o que avisar: projeção visível (cada base tem as suas marcas) ou totalização
 * final (só a marca do TSE existe, nas duas bases — RF-267).
 */
export function avisoSemProjecao(cargoComProjecao: boolean, ctx: ContextoMarcas): string | null {
  if (ctx.totalizacaoFinal || ctx.projecaoVisivel || primeiroTurnoEncerrado()) return null;
  return cargoComProjecao ? AVISO_SEM_PROJECAO.travada : AVISO_SEM_PROJECAO.cargo;
}

/**
 * A lista separa as duas bases? Só com a projeção visível e sem totalização
 * final. Sem projeção não há o que separar: as marcas da parcial valem nas
 * duas bases (a "Projeção" ganha o aviso). Com totalização final só a marca
 * do TSE existe, e ela aparece nas duas.
 */
export function separaBases(ctx: ContextoMarcas): boolean {
  return ctx.projecaoVisivel && !ctx.totalizacaoFinal;
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

/**
 * 1º turno encerrado (05/10/2026, `primeiroTurnoEncerrado`): com a totalização
 * do TSE em 100%, a marca da contagem é a do resultado final — "Eleito", sem
 * "na parcial".
 */
export const TEXTO_MARCA_FINAL = "Eleito";

/** "eleito na parcial" — ou "eleito" com o 1º turno encerrado. */
function eleitoDaContagem(): string {
  return primeiroTurnoEncerrado() ? "eleito" : "eleito na parcial";
}

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
        principal: primeiroTurnoEncerrado() ? TEXTO_MARCA_FINAL : TEXTO_MARCA.parcial,
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

/**
 * A linha é de quem está SENDO ELEITO agora — "eleito na parcial" ou, com a
 * totalização final, "Eleito (TSE)" (spec 026 RF-291, decisão do dono de
 * 03/10: a mini-foto só para esses). Lê os bits JÁ derivados por
 * {@link marcasDaLinha}, então herda a precedência inteira: linha com destino
 * nunca tem bit, e com totalização final só o do TSE sobrevive.
 *
 * "Eleito na projeção" sozinho NÃO conta: é estimativa nossa, não oficial
 * (RF-266) — e é a mesma regra de "quem conta como eleito" de
 * `lib/deputado/lista-documento.ts`.
 */
export function ehEleitoNosBits(bits: number): boolean {
  return (bits & (BIT_MARCA.PARCIAL | BIT_MARCA.TSE)) !== 0;
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

/**
 * Destinos cujos votos ficam FORA da conta — a linha não tem %. "Válido
 * (legenda)" não está aqui: o voto é válido (conta para a agremiação) e o %
 * dele é publicado numérico (ADR-0064, emenda de 29/09).
 */
export function destinoSemPercentual(codigo: CodigoDestino | number): boolean {
  return codigo === CODIGO_DESTINO.anulado || codigo === CODIGO_DESTINO.sub_judice;
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
  /**
   * Spec 026 RF-297 — voto PROJETADO, inteiro. OPCIONAL de propósito: só
   * existe nas linhas que o mostram ({@link elegiveisAoVotoProjetado}); um
   * `null` em ~1.000 linhas de SP seria peso sem leitor.
   */
  votosProjetados?: number,
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
  /** Opcional — ausente quando a linha não mostra voto projetado. */
  VOTOS_PROJ: 9,
} as const;

// ---------------------------------------------------------------------------
// Visível por padrão — "eleitos + 7" (decisão do dono, 04/10/2026)
// ---------------------------------------------------------------------------

/**
 * Quantas posições abaixo do último eleito ficam visíveis por padrão em cada
 * agremiação, em todas as telas de deputado (federal, estadual,
 * distrital; celular e computador). Decisão do dono, 04/10/2026: "o padrão do
 * sistema será sempre exibir os eleitos e + 7 abaixo do corte; a partir
 * desses, só tocando no botão".
 *
 * Substitui as faixas fixas de antes: no federal, as posições 1–20 visíveis
 * (ADR-0065 D1, spec 026 RF-260); nas assembleias, eleitos + 5 com mínimo de
 * 10 (spec 027, decisão de 03/10). O MESMO número do produtor
 * (`api/model/deputado_payload.py::VISIVEIS_ABAIXO_DO_CORTE`).
 */
export const VISIVEIS_ABAIXO_DO_CORTE = 7;

/**
 * Nome antigo do mesmo número (spec 026 RF-297): o voto projetado sai
 * exatamente nas linhas válidas do conjunto visível por padrão — ver
 * {@link elegiveisAoVotoProjetado}.
 */
export const NAO_ELEITOS_COM_VOTO_PROJETADO = VISIVEIS_ABAIXO_DO_CORTE;

/** O que {@link ultimoRankVisivel} lê de uma linha. */
export interface LinhaParaVisibilidade {
  rank: number;
  /** Tem marca de eleito NA TELA: parcial, projeção visível ou TSE — já com a precedência. */
  eleita: boolean;
}

/**
 * O maior rank visível por padrão numa agremiação (R). Visível ⇔ `rank ≤ R`:
 *
 *     R = (maior rank entre as linhas ELEITAS, ou 0 se nenhuma) + 7
 *
 * Contar a partir do MAIOR rank eleito, e não "k eleitos + 7": uma linha com
 * `destino` (anulado, sub judice, válido-legenda) tem rank — é ordenada pelo
 * voto apurado — e nunca se elege; e o eleito na projeção nem sempre é
 * contíguo ao da parcial. A partir do último eleito o conjunto é CONTÍGUO
 * (ranks 1..R): nenhum buraco entre linhas visíveis, e a rota das assembleias
 * devolve exatamente "rank > R" (`lib/deputado/lista-documento.ts`).
 *
 * As 7 são POSIÇÕES, com ou sem `destino` — é o que o leitor vê: sete linhas
 * abaixo do corte. Contar só as válidas foi medido e descartado (04/10): uma
 * agremiação com a candidatura inteira anulada (DRAP indeferido — 3 das 26 no
 * simulado do estadual de SP) nunca chegaria a 7 válidas e abriria as 60
 * linhas, +150 linhas no documento de SP.
 *
 * Agremiação sem eleito: as 7 primeiras. Com menos de R linhas: todas.
 * Monótona: mais linhas eleitas nunca diminuem R — é o que permite à rota das
 * assembleias, que não lê o interruptor da projeção, usar o R SEM projeção
 * como piso seguro.
 */
export function ultimoRankVisivel(linhas: readonly LinhaParaVisibilidade[]): number {
  let ultimoEleito = 0;
  for (const l of linhas) if (l.eleita && l.rank > ultimoEleito) ultimoEleito = l.rank;
  return ultimoEleito + VISIVEIS_ABAIXO_DO_CORTE;
}

/**
 * {@link ultimoRankVisivel} sobre linhas do contrato: "eleita" é ter alguma
 * marca em {@link marcasDaLinha} — a MESMA precedência que desenha os selos
 * (destino ⇒ nenhuma; totalização final ⇒ só TSE; projeção só se visível).
 */
export function ultimoRankVisivelDasLinhas(
  linhas: readonly (LinhaParaMarca & { rank: number })[],
  ctx: ContextoMarcas,
): number {
  return ultimoRankVisivel(
    linhas.map((l) => ({ rank: l.rank, eleita: marcasDaLinha(l, ctx).length > 0 })),
  );
}

/**
 * {@link ultimoRankVisivel} sobre as tuplas do componente: os bits JÁ são o
 * resultado de {@link marcasDaLinha} no mesmo contexto, então "eleita" é
 * `marcas ≠ 0` — o mesmo R que {@link ultimoRankVisivelDasLinhas} daria.
 */
export function ultimoRankVisivelDasTuplas(linhas: readonly LinhaCompacta[]): number {
  return ultimoRankVisivel(linhas.map((l) => ({ rank: l[L.RANK], eleita: l[L.MARCAS] !== 0 })));
}

// ---------------------------------------------------------------------------
// Voto projetado por candidatura — spec 026 RF-297 (emenda do ADR-0063 D1)
// ---------------------------------------------------------------------------

/**
 * Os `sqcand` de UMA agremiação que podem mostrar o voto projetado: as linhas
 * VÁLIDAS (sem `destino`) do conjunto visível por padrão
 * ({@link ultimoRankVisivelDasLinhas}) — eleitos + 7 —, ou nada se a projeção
 * não está visível ({@link projecaoVisivel}) ou a UF tem totalização final (o
 * resultado oficial tem precedência, RF-267).
 *
 * Com a projeção visível, "eleita" é marcada na parcial OU na projeção. A
 * ordem é sempre a do `rank` (nunca a do voto projetado — ADR-0063 D5).
 *
 * Emenda 04/10 (visível por padrão): até aqui eram "as marcadas + as 7
 * primeiras válidas sem marca" contadas do TOPO; agora são as 7 posições
 * depois do último eleito (uma linha com `destino` entre elas ocupa a posição
 * e não leva o número), e as sem marca ENTRE eleitos também o levam. É o
 * conjunto que fica visível sem clique, menos as linhas com `destino` —
 * nenhuma linha válida visível fica sem o número e nenhuma recolhida o leva.
 *
 * Recebe TODAS as linhas da agremiação que a página tem; no servidor são as
 * posições 1–60 + marcadas. A lista 61+ nunca traz o campo (RF-265).
 */
export function elegiveisAoVotoProjetado(
  linhas: readonly LinhaDeputado[],
  ctx: ContextoMarcas,
): ReadonlySet<number> {
  const saida = new Set<number>();
  if (!ctx.projecaoVisivel || ctx.totalizacaoFinal) return saida;
  const r = ultimoRankVisivelDasLinhas(linhas, ctx);
  for (const linha of linhas) {
    if (codigoDoDestino(linha.destino) === 0 && linha.rank <= r) saida.add(linha.sqcand);
  }
  return saida;
}

/**
 * O texto do voto projetado — "projeção ≈ 652 mil · não oficial". "projeção"
 * e "não oficial" no MESMO elemento (RF-266): o número arredondado nunca
 * aparece sem dizer que é estimativa nossa.
 */
export function textoVotoProjetado(votos: number): string {
  return `projeção ≈ ${formatVotesCompact(votos)} · não oficial`;
}

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
 * `pct_validos` sai `null` para destino **anulado** e **sub judice**, mesmo que
 * o dado traga um número: esses votos estão fora da conta, e a tela nunca
 * mostra % ao lado deles (RF-261; ADR-0064 decisão 5). Para **"Válido
 * (legenda)"** o % sai NUMÉRICO, como o contrato o publica (design 026 § 2.2:
 * "`null` ⇔ destino anulado ou sub judice"; ADR-0064, emenda de 29/09): o voto
 * é válido e o percentual é verdadeiro — a linha leva o texto do destino ao
 * lado, que desfaz a leitura de voto nominal.
 */
export function paraLinhaCompacta(
  linha: LinhaDeputado,
  ctx: ContextoMarcas,
  exibicao: ExibicaoLinha = {},
  elegiveisVotoProjetado?: ReadonlySet<number>,
): LinhaCompacta {
  const destino = codigoDoDestino(linha.destino);
  const nome = exibicao.nome ? exibicao.nome(linha.nome, String(linha.sqcand)) : linha.nome;
  const partido =
    exibicao.mostrarPartido === false
      ? ""
      : exibicao.partido
        ? exibicao.partido(linha.partido)
        : linha.partido;
  const base = [
    linha.rank,
    linha.sqcand,
    nome,
    partido,
    typeof linha.numero === "number" ? linha.numero : null,
    linha.votos,
    destinoSemPercentual(destino) || typeof linha.pct_validos !== "number"
      ? null
      : linha.pct_validos,
    bitsDasMarcas(marcasDaLinha(linha, ctx)),
    destino,
  ] as const;
  // Spec 026 RF-297 — a posição 9 só existe quando a linha MOSTRA o voto
  // projetado: projeção visível, sem totalização final, linha válida e no
  // conjunto "eleitos + 7" da agremiação. Sem o conjunto (a rota 61+, que
  // nunca traz o campo), nunca.
  const vp = linha.votos_projetados;
  if (
    elegiveisVotoProjetado?.has(linha.sqcand) === true &&
    ctx.projecaoVisivel &&
    !ctx.totalizacaoFinal &&
    destino === 0 &&
    typeof vp === "number" &&
    Number.isFinite(vp) &&
    vp >= 0
  ) {
    return [...base, vp];
  }
  return base;
}

/**
 * Os mais votados DA UF com o voto projetado só onde a lista de agremiações o
 * mostraria — a mesma regra de {@link elegiveisAoVotoProjetado}, aplicada
 * agremiação por agremiação. Fora dela o campo SAI do destaque (não fica
 * `undefined`). Não reordena nem muda nenhum outro campo.
 */
export function maisVotadosComVotoProjetado<
  T extends { sqcand: number; votos_projetados?: number },
>(
  destaques: readonly T[],
  agremiacoes: readonly { candidatos?: readonly LinhaDeputado[] }[],
  ctx: ContextoMarcas,
): T[] {
  const elegiveis = new Set<number>();
  for (const a of agremiacoes) {
    for (const sq of elegiveisAoVotoProjetado(a.candidatos ?? [], ctx)) elegiveis.add(sq);
  }
  return destaques.map((d) => {
    if (d.votos_projetados === undefined || elegiveis.has(d.sqcand)) return d;
    const { votos_projetados: _vp, ...resto } = d;
    return resto as T;
  });
}

/**
 * As linhas de UMA agremiação → tuplas, com o conjunto do voto projetado
 * ({@link elegiveisAoVotoProjetado}) calculado sobre elas. É o que a página
 * usa no servidor; a ordem da saída é a da entrada (quem ordena é
 * {@link ordenarPorRank}).
 */
export function linhasCompactasDaAgremiacao(
  linhas: readonly LinhaDeputado[],
  ctx: ContextoMarcas,
  exibicao: ExibicaoLinha = {},
): LinhaCompacta[] {
  const elegiveis = elegiveisAoVotoProjetado(linhas, ctx);
  return linhas.map((l) => paraLinhaCompacta(l, ctx, exibicao, elegiveis));
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
 * `null` quando não há estado publicado (objeto v1, ou o modo resumo da spec
 * 027, em que o objeto não traz `projecao`) — nada a dizer.
 *
 * `territorio` (spec 027, RF-284): no DF a frase diz "do Distrito Federal", não
 * "do estado". Ausente ⇒ o termo dos 26 estados — o texto de antes.
 */
export function fraseEstadoProjecao(
  projecao: ProjecaoUfParaTexto | null | undefined,
  pctApurado: number,
  territorio: TermoDoTerritorio = TERMO_ESTADO,
): string | null {
  if (!projecao || primeiroTurnoEncerrado()) return null;
  const pre = "Projeção · não oficial:";
  if (projecao.estado === "liberada") {
    return `Projeção liberada · não oficial — estimativa nossa do resultado final ${territorio.doTerritorio}, zona a zona.`;
  }
  if (projecao.estado === "aguardando") {
    switch (projecao.motivo) {
      case "pct_minimo":
        return `${pre} aparece a partir de ${pct1(projecao.pct_minimo)} do eleitorado apurado (agora ${pct1(pctApurado)}).`;
      case "zonas_minimas":
        return `${pre} aparece com ao menos ${ZONAS_MINIMAS_PROJECAO} zonas eleitorais apuradas (agora ${projecao.zonas_apuradas}).`;
      case "sem_vagas":
        return `${pre} aparece depois que o TSE publicar quantas cadeiras ${territorio.o} elege.`;
      default:
        return `${pre} aguardando mais apuração.`;
    }
  }
  switch (projecao.motivo) {
    case "interruptor":
      return `${pre} desligada neste cálculo.`;
    case "coligacao":
      return `${pre} indisponível — o dado ${territorio.deste} traz coligação, que a lei não admite mais na eleição proporcional.`;
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
  if (!projecao || primeiroTurnoEncerrado()) return null;
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
  const base = `Linha de corte: ${votos} ${unidade} o último ${eleitoDaContagem()}${ultimo} do primeiro de fora${primeiro}.`;
  return corte.primeiro_fora_abaixo_piso_10 ? `${base} ${PISO_10_TEXTO}` : base;
}

/**
 * A repetição curta no cabeçalho da agremiação (RF-272: o corte não some quando
 * a faixa 21–60 está fechada).
 */
export function fraseCorteCabecalho(corte: CorteParaTexto): string {
  const votos = corte.diferenca.toLocaleString("pt-BR");
  const unidade = corte.diferenca === 1 ? "voto" : "votos";
  const base = `Corte: ${votos} ${unidade} entre o último ${eleitoDaContagem()} e o primeiro de fora.`;
  return corte.primeiro_fora_abaixo_piso_10 ? `${base} ${PISO_10_TEXTO}` : base;
}
