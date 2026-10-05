/**
 * components/blocks/CorridaTresCirculos.tsx
 *
 * Painel "A corrida" (spec 022) — a disputa em três círculos, cada um sobre uma
 * base maior que o anterior: voto válido → voto dado → eleitorado inteiro. É a
 * hierarquia do EA20 desenhada em três passos, e é IRMÃO do painel "Votação"
 * (spec 021, `VotacaoEleitorado.tsx`): aquele é sobre o eleitorado, este é
 * sobre a corrida. Mesma geometria, mesmo `Arco`, mesma regra de fatia zero.
 *
 * ## Os três círculos, e onde cada um fecha
 *
 *   1. **Dos votos em disputa** — base `contagens.validos + contagens.sub_judice`
 *      (modo candidatura). As quatro candidaturas que COMPETEM (`valido` e
 *      `sub_judice`) de mais votos e "Outros" (RF-202, RF-204).
 *   2. **De quem votou** — base `contagens.comparecimento`. As mesmas fatias,
 *      mais brancos, nulos e "Anulados" (`contagens.anulados`, RF-205).
 *   3. **Do eleitorado apto** — base `contagens.aptos`. As do círculo 2, mais
 *      abstenção e "Ainda não apurado" (`aptos − instalados`, RF-206).
 *
 * ## Senado: tudo em VOTOS, 2 por eleitor (RF-210, 2026-09-27)
 *
 * Substitui o "aguardando Senado" de 2026-09-26. Medido nas capturas reais do
 * simulado, cargo 5 (`tests/fixtures/tse/2026-sim/senado/`): `tv == 2 × c`,
 * Σ `vap` das "Válido" == `vv`, `c + a == esi`. Os votos chegam em votos;
 * `aptos`, `instalados`, `comparecimento` e `abstencao` chegam em PESSOAS.
 * Com `votosPorEleitor = k` (a página passa `EdgePayloadUf.vagas`): o
 * círculo 1 não muda (válidos já são votos); o 2 fecha em
 * `comparecimento × k`; o 3 em `aptos × k`, com abstenção e "Ainda não
 * apurado" × k. A projeção (total `projetada.validos`) já é em votos e não
 * leva fator. Dividir os votos por `k` é proibido: não existe meio eleitor.
 *
 * Cada círculo confere a sua soma contra a sua base, **na unidade**, e devolve
 * `null` quando não bate: a tela diz "não fecha" em vez de esticar uma fatia
 * (constituição § 6). Fecham por identidade do TSE porque tudo vem do MESMO
 * arquivo agregado da abrangência — ver {@link circuloValidos}.
 *
 * ## 🔴 Emenda "opção A" ao ADR-0053 (dono, 2026-09-27) — votos EM DISPUTA
 *
 * Modo candidatura: a candidatura `sub_judice` COMPETE (segue o TSE, RF-213)
 * e ganha fatia própria nos três círculos, com "(Sub judice)" no rótulo da
 * legenda. O círculo 1 passa a fechar em `validos + sub_judice` — os votos em
 * disputa, a mesma base em que o produtor publica os percentuais da lista
 * quando há anulada. A fatia cinza dos círculos 2 e 3 vira "Anulados", só com
 * `contagens.anulados`. As identidades continuam fechando na unidade:
 * `validos + sub_judice + brancos + nulos + anulados = comparecimento`.
 *
 * ⚠️ Modo PARTIDO fica como era (círculo 1 sobre os válidos, "Anulados e sub
 * judice" nos círculos 2 e 3): `corrida_por_partido` só traz o voto VÁLIDO de
 * cada partido, e o voto sub judice não tem partido a que ser atribuído no
 * payload — inventar a atribuição seria pior que manter a fatia neutra.
 *
 * ## 🔴 Só voto que COMPETE entra numa fatia com nome (RF-203)
 *
 * O voto por candidatura que o TSE publica (`cand[].vap`) inclui os votos de
 * candidaturas anuladas e sub judice. Na captura real do simulado
 * (`tests/fixtures/tse/2026-sim/br-c0001-e021270-u.json`) o MAIS votado do
 * arquivo era `"Anulado sub judice"`. Ordenar por `votos` sem filtrar pela
 * destinação poria em 1º lugar alguém cujos votos não contam. O filtro é
 * `destino === "valido" || destino === "sub_judice"`, igualdade exata (desde a
 * opção A; era só `"valido"`) — um destino ausente ou desconhecido
 * NÃO é válido (memória `feedback_default_silencioso_enum`); ele põe o painel
 * inteiro em "aguardando" (RF-207), ver {@link destinacaoPendente}.
 *
 * ## Estados (RF-207) — nenhum fabrica zero
 *
 * | no payload                                         | o que é              | tela                          |
 * |----------------------------------------------------|----------------------|-------------------------------|
 * | `votacao`/`contagens` ausente, ou `votosPorEleitor` inválido | não sabemos | `<DetailUnavailable>` |
 * | `destino_pendente` ou entrada com votos sem destino | aguardando destinação | os três em "aguardando…"     |
 * | `corrida` (ou `corrida_por_partido`) ausente        | não sabemos          | `<DetailUnavailable>`         |
 * | `validos == 0`                                     | não começou          | 1 e 2 "sem votos apurados"; 3 segue |
 * | resto                                              | apurando             | RF-204..206                   |
 *
 * ⚠️ A ordem das linhas é decisão, não acaso:
 *   - **pendente ANTES de ausente**: no modo partido o produtor OMITE
 *     `corrida_por_partido` enquanto há destinação pendente (RF-209). Testar
 *     a ausência primeiro transformaria "aguardando o TSE" em "não sabemos" —
 *     duas notícias diferentes, com ações diferentes para quem opera.
 *
 * ## Cor
 *
 * Fatia de candidatura/partido pinta pela SIGLA, via `candidateColor`
 * (ADR-0024, constituição § 2) — nunca pelo campo `cor` do payload
 * (`tests/unit/components/cor-nunca-do-payload.test.ts`). Por ser
 * preenchimento com extensão, leva a borda `--text-secondary` do
 * `DATA_FILL_STROKE`: quatro bases da paleta ficam abaixo de 3:1 no tema claro.
 *
 * "Outros" é neutro: `--color-cand-other`, o mesmo token do termômetro "Outros
 * candidatos" (`ProjectionThermometers.tsx`). Medido contra `--surface-page`:
 *
 *   claro  #6e6e6e sobre #f3f4f6 ... 4,63:1
 *   escuro #737373 sobre #14171b ... 3,79:1
 *
 * Mas ele divide os círculos 2 e 3 com três fatias cinzentas do painel irmão
 * (`--color-part-brancos-nulos`, `--ink-2`) e por luminância NÃO se distingue
 * delas: 1,44:1 contra brancos/nulos e 1,19:1 contra anulados no claro (1,49 e
 * 1,82 no escuro). Por isso ganha a terceira textura, `"trilho"` — uma linha
 * correndo AO LONGO da fita, geometricamente diferente das listras
 * transversais (brancos) e dos pontos (anulados). Nulos segue sólido.
 *
 * ## Nenhum texto dentro do SVG
 *
 * Mesma regra do painel irmão: o axe deste projeto põe contraste de texto em
 * SVG no balde `incomplete`, que não reprova nada. A tradução textual
 * (RNF-023) é a legenda VISÍVEL de cada círculo.
 *
 * ## O seletor Parcial/Projeção (RF-211, RF-212 — 2026-09-27)
 *
 * Os três círculos são o que JÁ foi contado: visão "Parcial", via
 * `data-view-only` (ADR-0029 § 2), como os arcos 1 e 2 do painel irmão. Na
 * visão "Projeção" entra um quarto semicírculo, o da corrida PROJETADA
 * ({@link fatiasProjecaoCorrida}): o total é `votacao.projetada.validos` — o
 * MESMO número da fatia de válidos do arco 3 do painel "Votação", para os dois
 * painéis nunca discordarem na mesma tela — dividido pela participação de cada
 * candidatura em Σ `votos_projetados` das `valido`. Sem dado, "aguardando",
 * sempre no DOM. `<DetailUnavailable>` não tem visão: vale nas duas.
 *
 * Server Component puro — sem `"use client"`, sem estado, sem evento (RNF-007a).
 */

import { DetailUnavailable } from "@/components/atoms/surfaces/DetailUnavailable";
import { Panel } from "@/components/atoms/surfaces/Panel";
import { candidateColor } from "@/components/blocks/_candidateColor";
import {
  Arco,
  type CorFatia,
  FATIA_COR,
  FATIA_LABEL,
  type FatiaDesenho,
  type FatiaKey,
  fraseVotosPorEleitor,
  GRADE_DOS_ARCOS,
  unidadeVotos,
  votosPorEleitorValido,
} from "@/components/blocks/VotacaoEleitorado";
import { primeiroTurnoEncerrado } from "@/lib/config/calendar";
import type {
  EdgeCorridaEntrada,
  EdgeCorridaPartido,
  EdgeDestinoVoto,
  EdgeVotacao,
  EdgeVotacaoContagens,
  EdgeVotacaoUf,
} from "@/lib/edge-config/types";
import { formatVotes } from "@/lib/utils/format";

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

/** Candidatura onde há UMA corrida; partido onde há 27 (RF-201). */
export type ModoCorrida = "candidatura" | "partido";

/** Quantos concorrentes têm fatia própria antes de "Outros" (RF-202). */
export const TOP_N = 4;

/** As três destinações que o contrato admite — qualquer outra coisa é "sem destino". */
const DESTINOS: ReadonlySet<EdgeDestinoVoto> = new Set(["valido", "anulado", "sub_judice"]);

/** "Outros": neutro, com textura própria — ver o § "Cor" no cabeçalho. */
export const COR_OUTROS: CorFatia = { fill: "var(--color-cand-other)", padrao: "trilho" };

/** Borda de preenchimento com extensão — o `DATA_FILL_STROKE` aplicado ao arco. */
const BORDA_PARTIDO = "var(--text-secondary)";

/** Um concorrente já ordenado e rotulado — candidatura ou partido. */
export interface Concorrente {
  /** Chave estável: `cand-<número>` ou `partido-<sigla>`. */
  key: string;
  label: string;
  partido: string;
  votos: number;
}

/**
 * As destinações que COMPETEM e por isso têm fatia com nome (opção A). Igualdade
 * exata: ausente/desconhecido nunca chega aqui — põe o painel em "aguardando"
 * ({@link destinacaoPendente}).
 */
function disputa(destino: EdgeDestinoVoto | undefined): boolean {
  return destino === "valido" || destino === "sub_judice";
}

/** Rótulo da fatia: o da candidatura, mais "(Sub judice)" quando for o caso. */
function rotuloFatia(e: EdgeCorridaEntrada, nome?: string | null): string {
  const base = rotuloCandidatura(e, nome);
  return e.destino === "sub_judice" ? `${base} (Sub judice)` : base;
}

/**
 * Nome e projeção por número de urna — a lista `candidatos` do MESMO payload
 * (`national.candidatos` em `/`, `EdgePayloadUf.candidatos` nas UFs). O `id` é
 * o número de urna, a mesma chave de `EdgeCorridaEntrada.id`.
 * `votos_projetados` só é lido pelo círculo de projeção (RF-212).
 */
export type CandidatoNome = {
  id: number;
  nome?: string | null;
  votos_projetados?: number | null;
};

// ---------------------------------------------------------------------------
// Ordem e filtro — exportados porque é onde os defeitos moram
// ---------------------------------------------------------------------------

/**
 * `true` quando a tela não pode separar voto válido de anulado (RF-207): o
 * produtor sinalizou `destino_pendente`, ou alguma candidatura COM votos chegou
 * sem destinação conhecida.
 *
 * "Com votos" (`votos > 0`) é deliberado: uma candidatura zerada sem destino
 * não muda fatia nenhuma, e travar o painel por ela seria esperar à toa.
 */
export function destinacaoPendente(v: {
  destino_pendente?: true;
  corrida?: readonly EdgeCorridaEntrada[];
}): boolean {
  if (v.destino_pendente === true) return true;
  return (v.corrida ?? []).some(
    (e) => e.votos > 0 && (e.destino === undefined || !DESTINOS.has(e.destino)),
  );
}

/** Rótulo de uma candidatura: nome quando a lista o tem, NUNCA inventado. */
export function rotuloCandidatura(e: EdgeCorridaEntrada, nome?: string | null): string {
  const sigla = e.partido ? ` · ${e.partido}` : "";
  const n = nome?.trim();
  return n ? `${n}${sigla}` : `Candidatura ${e.id}${sigla}`;
}

/**
 * RF-202/203 — só as candidaturas que COMPETEM (`valido` e, desde a opção A,
 * `sub_judice`), em ordem decrescente de votos, e desempate pelo número de urna
 * CRESCENTE, para a ordem não depender da ordem de chegada do arquivo.
 */
export function ordenarCandidaturas(
  corrida: readonly EdgeCorridaEntrada[],
  candidatos: readonly CandidatoNome[] = [],
): Concorrente[] {
  const nomes = new Map(candidatos.map((c) => [c.id, c.nome]));
  return corrida
    .filter((e) => disputa(e.destino))
    .sort((a, b) => b.votos - a.votos || a.id - b.id)
    .map((e) => ({
      key: `cand-${e.id}`,
      label: rotuloFatia(e, nomes.get(e.id)),
      partido: e.partido,
      votos: e.votos,
    }));
}

/** RF-201/202 — partidos em ordem decrescente de votos válidos, desempate pela sigla crescente. */
export function ordenarPartidos(partidos: readonly EdgeCorridaPartido[]): Concorrente[] {
  return [...partidos]
    .sort(
      (a, b) =>
        b.votos_validos - a.votos_validos ||
        (a.partido < b.partido ? -1 : a.partido > b.partido ? 1 : 0),
    )
    .map((p) => ({
      key: `partido-${p.partido}`,
      label: p.partido,
      partido: p.partido,
      votos: p.votos_validos,
    }));
}

/** Uma fatia absoluta, ainda sem percentual — o percentual depende da base de cada círculo. */
interface FatiaAbs {
  key: string;
  label: string;
  abs: number;
  pintura: CorFatia;
}

/**
 * RF-202 — as quatro primeiras com fatia própria e "Outros" com a soma do
 * resto. "Outros" sai SEMPRE da função, mesmo zerado: quem some com ele é a
 * regra de fatia zero do `Arco` (spec 021), no mesmo ponto em que some
 * qualquer outra fatia zerada — uma regra, um lugar.
 */
export function fatiasDaCorrida(ordenados: readonly Concorrente[]): FatiaAbs[] {
  const top = ordenados.slice(0, TOP_N).map((c) => ({
    key: c.key,
    label: c.label,
    abs: c.votos,
    pintura: { fill: candidateColor(c.partido), borda: BORDA_PARTIDO },
  }));
  const resto = ordenados.slice(TOP_N).reduce((s, c) => s + c.votos, 0);
  return [...top, { key: "outros", label: "Outros", abs: resto, pintura: COR_OUTROS }];
}

// ---------------------------------------------------------------------------
// O círculo de projeção (RF-212)
// ---------------------------------------------------------------------------

/**
 * Divide `total` entre `pesos` na proporção de cada um, com arredondamento pelo
 * MAIOR RESTO: cada parte recebe o piso da sua cota e as unidades que faltam
 * vão, uma a uma, às de maior resto (empate ⇒ a de menor índice, que é a de
 * maior peso na ordem de chegada aqui). A soma é `total` EXATO, por
 * construção — arredondar cada cota sozinha erraria por ±1 ou ±2.
 *
 * Aritmética em `BigInt` de propósito: `total × peso` passa de 2^53 com números
 * de eleição nacional (1,6e8 × 4e7 ≈ 6e15 já encosta; 1e8 × 1e8 passa), e um
 * produto arredondado em ponto flutuante mudaria o resto — e com ele QUEM
 * recebe a unidade.
 */
export function maiorResto(pesos: readonly number[], total: number): number[] {
  const T = BigInt(total);
  const S = pesos.reduce((s, p) => s + BigInt(p), BigInt(0));
  if (S === BigInt(0)) return pesos.map(() => 0);
  const partes = pesos.map((p) => (T * BigInt(p)) / S);
  const restos = pesos.map((p) => (T * BigInt(p)) % S);
  let falta = T - partes.reduce((s, x) => s + x, BigInt(0));
  const ordem = pesos
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = restos[a] ?? BigInt(0);
      const rb = restos[b] ?? BigInt(0);
      return rb > ra ? 1 : rb < ra ? -1 : a - b;
    });
  for (const i of ordem) {
    if (falta <= BigInt(0)) break;
    partes[i] = (partes[i] ?? BigInt(0)) + BigInt(1);
    falta -= BigInt(1);
  }
  return partes.map((x) => Number(x));
}

/** O círculo de projeção pronto: as fatias e o total em que elas fecham. */
export interface ProjecaoCorrida {
  fatias: FatiaDesenho[];
  /** `projetadaValidos + somaSubJudice` — Σ fatias, na unidade. */
  total: number;
  /** Σ `votos_projetados` das candidaturas sub judice que entraram. */
  somaSubJudice: number;
}

/**
 * RF-212 — as fatias do círculo de projeção da corrida, ou `null` ("aguardando").
 * Ver {@link projecaoDaCorrida}, que também devolve o total.
 */
export function fatiasProjecaoCorrida(
  v: { corrida?: readonly EdgeCorridaEntrada[]; destino_pendente?: true },
  candidatos: readonly CandidatoNome[],
  projetadaValidos: number | null | undefined,
): FatiaDesenho[] | null {
  return projecaoDaCorrida(v, candidatos, projetadaValidos)?.fatias ?? null;
}

/**
 * RF-212 + opção A — o círculo de projeção da corrida, ou `null` ("aguardando").
 *
 *   - entram as candidaturas que COMPETEM em `corrida` — `valido` e
 *     `sub_judice` (RF-203, opção A)
 *     que têm `votos_projetados > 0` na lista `candidatos`, cruzada por `id`;
 *     candidatura ausente da lista NÃO entra (não há projeção dela para
 *     dividir — nunca um zero inventado);
 *   - ordem pela PROJEÇÃO (é o gráfico da projeção), desempate pelo número de
 *     urna crescente, como no RF-202; quatro com fatia própria + "Outros";
 *   - total = `projetadaValidos + Σ votos_projetados das sub judice que
 *     entraram` — os votos em disputa projetados: os válidos do painel
 *     "Votação" mais a projeção de quem está sub judice (que não é voto
 *     válido e por isso não está em `projetadaValidos`);
 *   - fatia = `total × votos_projetados_i ÷ Σ votos_projetados`, pelo maior
 *     resto: Σ fatias === total, na unidade. Sem sub judice, total ===
 *     `projetadaValidos` e o círculo é o de antes.
 *
 * `null` quando: não há `projetadaValidos` (ou não é inteiro positivo); a
 * destinação está pendente (RF-207 — sem saber quem é válido, a divisão seria
 * o número errado); `corrida` ausente; nenhuma candidatura válida com projeção
 * (Σ = 0); ou uma projeção não é inteiro ≥ 0 (payload torto não vira fatia).
 * Nunca devolve fatias cujo total difira de `projetadaValidos` — o `fechar`
 * confere na saída.
 *
 * ⚠️ Os votos de cada candidatura AQUI podem diferir nos últimos dígitos dos
 * `votos_projetados` da lista: o total vem da projeção de participação, a
 * divisão vem da soma das candidaturas. Medido no replay 2022 (spec 022
 * RF-212): 0,02% nacional com 1 h; a metodologia do painel declara isso.
 */
export function projecaoDaCorrida(
  v: { corrida?: readonly EdgeCorridaEntrada[]; destino_pendente?: true },
  candidatos: readonly CandidatoNome[],
  projetadaValidos: number | null | undefined,
): ProjecaoCorrida | null {
  if (
    projetadaValidos === null ||
    projetadaValidos === undefined ||
    !Number.isSafeInteger(projetadaValidos) ||
    projetadaValidos <= 0
  ) {
    return null;
  }
  if (!v.corrida || destinacaoPendente(v)) return null;

  const porId = new Map(candidatos.map((c) => [c.id, c]));
  const entram: { id: number; c: Concorrente }[] = [];
  let somaSubJudice = 0;
  for (const e of v.corrida) {
    if (!disputa(e.destino)) continue;
    const cand = porId.get(e.id);
    const vp = cand?.votos_projetados;
    if (vp === undefined || vp === null) continue;
    if (!Number.isSafeInteger(vp) || vp < 0) return null;
    if (vp === 0) continue;
    if (e.destino === "sub_judice") somaSubJudice += vp;
    entram.push({
      id: e.id,
      c: {
        key: `cand-${e.id}`,
        label: rotuloFatia(e, cand?.nome),
        partido: e.partido,
        votos: vp,
      },
    });
  }
  if (entram.length === 0) return null;

  entram.sort((a, b) => b.c.votos - a.c.votos || a.id - b.id);
  const total = projetadaValidos + somaSubJudice;
  if (!Number.isSafeInteger(total)) return null;
  const brutas = fatiasDaCorrida(entram.map((x) => x.c));
  const abs = maiorResto(
    brutas.map((f) => f.abs),
    total,
  );
  const fatias = fechar(
    brutas.map((f, i) => ({ ...f, abs: abs[i] ?? 0 })),
    total,
  );
  return fatias ? { fatias, total, somaSubJudice } : null;
}

// ---------------------------------------------------------------------------
// Os três círculos
// ---------------------------------------------------------------------------

function neutra(key: FatiaKey, abs: number): FatiaAbs {
  return { key, label: FATIA_LABEL[key], abs, pintura: FATIA_COR[key] };
}

/** Rótulo da fatia cinza dos anulados quando o sub judice já é fatia de candidatura. */
export const LABEL_ANULADOS = "Anulados";

/**
 * A fatia cinza dos anulados nos círculos 2 e 3. Com o sub judice DENTRO da
 * corrida (modo candidatura, opção A) ela é só `anulados`, e se chama
 * "Anulados"; sem ele (modo partido) é `anulados + sub_judice`, com o rótulo e
 * a pintura de sempre do painel "Votação" — que este arquivo não altera.
 * Mesma `key` e mesma pintura nos dois casos: o `data-testid` e a textura
 * ("pontos") não mudam.
 */
function fatiaAnulados(c: EdgeVotacaoContagens, subJudiceNaCorrida: boolean): FatiaAbs {
  return subJudiceNaCorrida
    ? { key: "anulados", label: LABEL_ANULADOS, abs: c.anulados, pintura: FATIA_COR.anulados }
    : neutra("anulados", c.anulados + c.sub_judice);
}

/**
 * Fecha um círculo na sua base: nenhuma fatia negativa e soma EXATA. Qualquer
 * outra coisa é `null` — "não fecha" na tela, nunca um círculo esticado.
 */
function fechar(fatias: readonly FatiaAbs[], base: number): FatiaDesenho[] | null {
  if (fatias.some((f) => f.abs < 0)) return null;
  const soma = fatias.reduce((s, f) => s + f.abs, 0);
  if (soma !== base) return null;
  return fatias.map((f) => ({ ...f, pct: base > 0 ? (f.abs / base) * 100 : 0 }));
}

/**
 * Círculo 1 (RF-204) — só as fatias da corrida, sobre `contagens.validos`.
 *
 * Fecha por identidade do TSE porque `corrida` e `contagens` vêm do MESMO
 * arquivo agregado: Σ `vap` das candidaturas `"Válido"` = `v.vv`, conferido na
 * unidade na captura real do simulado. Se não fechar, o dado veio torto — e é
 * isso que a tela diz.
 */
export function circuloValidos(
  corrida: readonly FatiaAbs[],
  c: EdgeVotacaoContagens,
): FatiaDesenho[] | null {
  return fechar(corrida, c.validos);
}

/**
 * Círculo 1 no modo CANDIDATURA (RF-204 + opção A) — as fatias de quem
 * compete, sobre os votos em disputa: `validos + sub_judice`. Fecha pela mesma
 * identidade do TSE: Σ `vap` das `"Válido"` = `vv` e Σ `vap` das
 * `"Anulado sub judice"` = `vansj`, no mesmo arquivo agregado.
 */
export function circuloDisputa(
  corrida: readonly FatiaAbs[],
  c: EdgeVotacaoContagens,
): FatiaDesenho[] | null {
  return fechar(corrida, c.validos + c.sub_judice);
}

/**
 * Círculo 2 (RF-205) — a corrida mais brancos, nulos e anulados, sobre
 * `contagens.comparecimento`. Sem a fatia dos anulados o círculo não fecha:
 * eles estão DENTRO do comparecimento (RF-197, spec 021). Ver
 * {@link fatiaAnulados} para `subJudiceNaCorrida`.
 *
 * Senado (RF-210): base `comparecimento × votosPorEleitor` — é o `tv` do TSE.
 * As fatias são todas de votos e entram como vêm.
 */
export function circuloComparecimento(
  corrida: readonly FatiaAbs[],
  c: EdgeVotacaoContagens,
  votosPorEleitor = 1,
  subJudiceNaCorrida = true,
): FatiaDesenho[] | null {
  if (!votosPorEleitorValido(votosPorEleitor)) return null;
  return fechar(
    [
      ...corrida,
      neutra("brancos", c.brancos),
      neutra("nulos", c.nulos),
      fatiaAnulados(c, subJudiceNaCorrida),
    ],
    c.comparecimento * votosPorEleitor,
  );
}

/**
 * Círculo 3 (RF-206) — o círculo 2 mais abstenção e "Ainda não apurado",
 * sobre `contagens.aptos`. "Ainda não apurado" é `aptos − instalados`, a
 * mesma subtração ESPECÍFICA de `naoApuradoInstalacao` (spec 021), nunca "o
 * resto de tudo". ⚠️ Apurado, não projetado.
 *
 * Senado (RF-210): base `aptos × votosPorEleitor`; "Abstenção" e "Ainda não
 * apurado" são PESSOAS e entram × votosPorEleitor; os votos, como vêm.
 */
export function circuloAptos(
  corrida: readonly FatiaAbs[],
  c: EdgeVotacaoContagens,
  votosPorEleitor = 1,
  subJudiceNaCorrida = true,
): FatiaDesenho[] | null {
  if (!votosPorEleitorValido(votosPorEleitor)) return null;
  const k = votosPorEleitor;
  return fechar(
    [
      ...corrida,
      neutra("brancos", c.brancos),
      neutra("nulos", c.nulos),
      fatiaAnulados(c, subJudiceNaCorrida),
      neutra("abstencao", c.abstencao * k),
      neutra("nao_apurado", (c.aptos - c.instalados) * k),
    ],
    c.aptos * k,
  );
}

// ---------------------------------------------------------------------------
// O painel
// ---------------------------------------------------------------------------

export interface CorridaTresCirculosProps {
  /**
   * Bloco `votacao` do payload — nacional (`EdgeVotacao`) ou de UF
   * (`EdgeVotacaoUf`). Ausente ⇒ `<DetailUnavailable>`. Os payloads de UF
   * sintetizados em desenvolvimento não o têm, e caem aqui.
   */
  votacao?: EdgeVotacao | EdgeVotacaoUf | null;
  /** RF-201: `"candidatura"` lê `corrida`; `"partido"` lê `corrida_por_partido`. */
  modo: ModoCorrida;
  /**
   * Lista `candidatos` do MESMO payload, só para o NOME (cruzado por `id`).
   * Sem nome, a fatia mostra número e sigla — nunca um nome inventado.
   */
  candidatos?: readonly CandidatoNome[];
  /**
   * RF-210 — quantos votos cada eleitor dá nesta corrida: 1 em Presidente e
   * Governador; no Senado, as vagas em disputa na UF (2 em 2026), passadas
   * pela página a partir de `EdgePayloadUf.vagas` — sem supor. Com `k > 1` os
   * círculos 2 e 3 contam VOTOS e as bases dizem "votos (k por eleitor)".
   * Valor que não seja inteiro ≥ 1 ⇒ `<DetailUnavailable>`.
   */
  votosPorEleitor?: number;
  kicker?: string;
  heading?: string;
  headingLevel?: 1 | 2 | 3 | 4;
  /**
   * `id` do heading; amarra o `aria-labelledby` do Panel E prefixa os `id` de
   * `<defs>` dos arcos. 🔴 Tem de ser único na página: este painel fica na
   * mesma página que o "Votação", e `id` de SVG é global ao documento.
   */
  titleId?: string;
  className?: string;
}

const TITLE_ID_PADRAO = "corrida-tres-circulos-heading";

/** Estado dos três círculos quando nenhum pode ser desenhado. */
type Espera = { sufixo: string; texto: string };

const ESPERA_DESTINO: Espera = {
  sufixo: "aguardando-destino",
  texto:
    "Aguardando a separação dos votos válidos — o TSE ainda não informou quais votos de cada candidatura são válidos e quais foram anulados.",
};

const SEM_VOTOS: Espera = {
  sufixo: "sem-votos",
  texto: "Sem votos apurados ainda — não há base para este gráfico.",
};

function naoFecha(base: string): Espera {
  return {
    sufixo: "nao-fecha",
    texto: `Não fecha: a soma das fatias difere do total de ${base} publicado pelo TSE — o gráfico não é desenhado para não inventar um número.`,
  };
}

export function CorridaTresCirculos({
  votacao,
  modo,
  candidatos = [],
  votosPorEleitor = 1,
  kicker,
  heading = "A corrida",
  headingLevel = 2,
  titleId = TITLE_ID_PADRAO,
  className,
}: CorridaTresCirculosProps) {
  const rotuloIndisponivel =
    modo === "partido" ? "A corrida por partido" : "A corrida por candidatura";
  const indisponivel = (
    <Panel
      kicker={kicker}
      title={heading}
      titleId={titleId}
      headingLevel={headingLevel}
      className={className}
    >
      <DetailUnavailable label={rotuloIndisponivel} reason="not_found" />
    </Panel>
  );

  const c = votacao?.contagens;

  // RF-207, na ordem do cabeçalho. `espera` põe os TRÊS círculos no mesmo
  // estado; `null` segue para a aritmética.
  let espera: Espera | null = null;
  let corrida: FatiaAbs[] = [];
  // `votosPorEleitor` inválido é "não sabemos" (RF-210): sem a unidade, os
  // círculos 2 e 3 sairiam na unidade errada.
  if (!votacao || !c || !votosPorEleitorValido(votosPorEleitor)) {
    return indisponivel;
  } else if (destinacaoPendente(votacao)) {
    espera = ESPERA_DESTINO;
  } else if (modo === "partido") {
    const porPartido = "corrida_por_partido" in votacao ? votacao.corrida_por_partido : undefined;
    if (!porPartido) return indisponivel;
    corrida = fatiasDaCorrida(ordenarPartidos(porPartido));
  } else {
    if (!votacao.corrida) return indisponivel;
    corrida = fatiasDaCorrida(ordenarCandidaturas(votacao.corrida, candidatos));
  }

  const porPartido = modo === "partido";
  // Opção A — no modo candidatura o sub judice é fatia de candidatura e o
  // círculo 1 é sobre os votos EM DISPUTA; no modo partido, como era (ver o
  // cabeçalho).
  const subJudiceNaCorrida = !porPartido;
  const base1 = subJudiceNaCorrida ? c.validos + c.sub_judice : c.validos;
  const semVotos = !espera && c !== undefined && base1 === 0;
  const c1 =
    espera || semVotos || !c
      ? null
      : subJudiceNaCorrida
        ? circuloDisputa(corrida, c)
        : circuloValidos(corrida, c);
  const k = votosPorEleitor;
  const c2 =
    espera || semVotos || !c ? null : circuloComparecimento(corrida, c, k, subJudiceNaCorrida);
  const c3 = espera || !c ? null : circuloAptos(corrida, c, k, subJudiceNaCorrida);
  const titulo1 = subJudiceNaCorrida ? "Dos votos em disputa" : "Dos votos válidos";
  const nomeBase1 = subJudiceNaCorrida ? "votos em disputa" : "votos válidos";

  // RF-210 — bases nomeadas na unidade de cada círculo. O círculo 1 já é de
  // votos (válidos) com qualquer `k`; o 2 e o 3 viram votos quando `k > 1`.
  const emVotos = k > 1;
  const base2 = emVotos ? `${unidadeVotos(k)} de quem votou` : "eleitores que votaram";
  const base3 = emVotos ? `${unidadeVotos(k)} do eleitorado apto` : "eleitores aptos";

  const vazio = (
    n: 1 | 2 | 3,
    fatias: FatiaDesenho[] | null,
    base: string,
    semBase: boolean,
  ): { testid: string; texto: string } | undefined => {
    const e = espera ?? (semBase ? SEM_VOTOS : fatias ? null : naoFecha(base));
    return e ? { testid: `corrida-circulo-${n}-${e.sufixo}`, texto: e.texto } : undefined;
  };

  // RF-212 — o círculo de projeção. Só por candidatura: não há projeção por
  // PARTIDO no payload, e o modo partido segue em "aguardando". No Senado o
  // total `projetada.validos` já é de VOTOS (RF-210) e não leva fator.
  const projetadaValidos = votacao.projetada?.validos;
  const projecao = porPartido ? null : projecaoDaCorrida(votacao, candidatos, projetadaValidos);
  const proj = projecao?.fatias ?? null;
  const vazioProj: { testid: string; texto: string } | undefined = proj
    ? undefined
    : porPartido
      ? {
          testid: "corrida-projecao-aguardando",
          texto: "A projeção da corrida entre os partidos ainda não está disponível.",
        }
      : espera === ESPERA_DESTINO
        ? { testid: "corrida-projecao-aguardando-destino", texto: ESPERA_DESTINO.texto }
        : {
            testid: "corrida-projecao-aguardando",
            texto:
              "Aguardando projeção — ainda não há votos apurados suficientes para projetar o fim da apuração.",
          };

  // "Outros" só é citado na metodologia quando existe como fatia — com quatro
  // ou menos candidaturas válidas ele some do arco (regra de fatia zero).
  const temOutrosProj = (proj?.find((f) => f.key === "outros")?.abs ?? 0) > 0;

  // RF-211 — os três círculos (e a metodologia que fala deles) são da visão
  // "Parcial".
  const visaoApurado = "parcial" as const;

  return (
    <Panel
      kicker={kicker}
      title={heading}
      titleId={titleId}
      headingLevel={headingLevel}
      className={className}
    >
      <div
        data-testid="corrida-tres-circulos"
        data-modo={modo}
        data-votos-por-eleitor={String(k)}
        data-estado={
          espera === ESPERA_DESTINO ? "aguardando-destino" : semVotos ? "sem-votos" : "apurando"
        }
        style={GRADE_DOS_ARCOS}
      >
        {/* Círculo 1 — RF-204 + opção A. Só voto de quem compete, sobre os
            votos em disputa (modo partido: válidos, sobre os válidos). */}
        <Arco
          visao={visaoApurado}
          id="corrida-circulo-1"
          defsPrefix={titleId}
          titulo={titulo1}
          baseLabel={nomeBase1}
          total={base1}
          fatias={c1 ?? []}
          vazio={vazio(1, c1, nomeBase1, semVotos)}
        />

        {/* Círculo 2 — RF-205. Sobre quem votou; anulado ≠ nulo. */}
        <Arco
          visao={visaoApurado}
          id="corrida-circulo-2"
          defsPrefix={titleId}
          titulo="De quem votou"
          baseLabel={base2}
          total={c.comparecimento * k}
          fatias={c2 ?? []}
          vazio={vazio(2, c2, base2, semVotos)}
        />

        {/* Círculo 3 — RF-206. Sobre o eleitorado inteiro, APURADO (não
            projetado), com "Ainda não apurado" nomeado. */}
        <Arco
          visao={visaoApurado}
          id="corrida-circulo-3"
          defsPrefix={titleId}
          titulo={primeiroTurnoEncerrado() ? "Do eleitorado apto" : "Do eleitorado apto, até agora"}
          baseLabel={base3}
          total={c.aptos * k}
          fatias={c3 ?? []}
          vazio={vazio(3, c3, base3, false)}
        />

        {/* RF-212 — o círculo de projeção da corrida, só na visão "Projeção".
            O total é `projetada.validos`, o MESMO número da fatia de válidos
            do arco 3 do painel "Votação"; a divisão segue a projeção de cada
            candidatura ({@link fatiasProjecaoCorrida}). Sem dado, a figura
            fica no DOM dizendo por quê (ADR-0017). No Senado também: o total
            já é de votos (RF-210). */}
        <Arco
          visao="proj"
          id="corrida-projecao"
          // Total e fatias são projeção ⇒ cor da projeção (dono, 04/10).
          totalProjetado
          fatiasProjetadas
          defsPrefix={titleId}
          titulo="Projeção para o fim da apuração"
          baseLabel="votos em disputa (projetado)"
          total={projecao?.total ?? projetadaValidos ?? 0}
          fatias={proj ?? []}
          vazio={vazioProj}
        />
      </div>

      {/* Metodologia (RF-208, constituição § 8): de onde vêm os círculos, por
          que podem diferir da lista acima, e por que anulado não é nulo. */}
      <p
        data-testid="corrida-metodologia"
        data-view-only={visaoApurado}
        style={{
          marginTop: "var(--space-4)",
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
        }}
      >
        Os três gráficos vêm do total que o TSE publica para{" "}
        {porPartido ? "cada estado" : "esta abrangência"} — o mesmo arquivo das contagens de
        eleitorado — e por isso cada um fecha exatamente na sua base. Os votos de cada{" "}
        {porPartido ? "partido" : "candidatura"} aqui podem diferir por um ciclo de atualização dos
        números exibidos em outras partes da página, que são somados zona a zona.{" "}
        {porPartido ? (
          <>
            Na eleição para governador são 27 disputas estaduais, e não existe um primeiro colocado
            nacional: cada fatia é a soma dos votos válidos das candidaturas de um partido nos 27
            estados.{" "}
          </>
        ) : null}
        {porPartido ? (
          <>
            Só o voto válido entra na fatia de um partido: votos dados a candidaturas anuladas ou
            sub judice ficam em “Anulados e sub judice”, que não se confunde com voto nulo: no voto
            nulo o eleitor não escolheu ninguém, enquanto o anulado foi dado a uma candidatura e
            anulado depois pela Justiça — sub judice é a parte ainda sob decisão.
          </>
        ) : (
          <>
            O primeiro gráfico é sobre os votos em disputa: os válidos e os das candidaturas sub
            judice, que seguem na disputa enquanto a Justiça não decide. Os votos de candidaturas
            anuladas ficam em “Anulados”, que não se confunde com voto nulo: no voto nulo o eleitor
            não escolheu ninguém, enquanto o anulado foi dado a uma candidatura e anulado depois
            pela Justiça.
          </>
        )}
        {c.aptos > 0 && !espera ? (
          emVotos ? (
            <>
              {" "}
              O terceiro gráfico é sobre os {formatVotes(c.aptos * k)} votos dos{" "}
              {formatVotes(c.aptos)} eleitores aptos.
            </>
          ) : (
            <> O terceiro gráfico é sobre os {formatVotes(c.aptos)} eleitores aptos.</>
          )
        ) : null}
      </p>

      {/* RF-210 — a frase do Senado vale nas DUAS visões (o círculo de
          projeção também é de votos), e por isso não leva `data-view-only`. */}
      {emVotos ? (
        <p
          data-testid="corrida-metodologia-votos"
          style={{
            marginTop: "var(--space-4)",
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          {fraseVotosPorEleitor(k)}
        </p>
      ) : null}

      {/* RF-212 — a metodologia do círculo de projeção, só na visão
          "Projeção" e só quando ele está desenhado. Não cita os três círculos
          do Parcial, e o parágrafo do Parcial não cita este. */}
      {projecao && projetadaValidos ? (
        <p
          data-testid="corrida-metodologia-proj"
          data-view-only="proj"
          style={{
            marginTop: "var(--space-4)",
            font: "var(--type-body-sm)",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
          }}
        >
          {projecao.somaSubJudice > 0 ? (
            <>
              O total deste gráfico, {formatVotes(projecao.total)} votos em disputa, é a projeção de
              votos válidos do painel “Votação” ({formatVotes(projetadaValidos)}) somada à projeção
              das candidaturas sub judice ({formatVotes(projecao.somaSubJudice)}).
            </>
          ) : (
            <>
              O total deste gráfico, {formatVotes(projecao.total)} votos em disputa, é o mesmo da
              projeção de votos válidos do painel “Votação”.
            </>
          )}{" "}
          A divisão desse total entre as candidaturas segue a projeção de cada uma
          {temOutrosProj
            ? "; as quatro com mais votos projetados têm fatia própria e as demais somam “Outros”"
            : ""}
          . Candidaturas anuladas ficam fora da divisão. Por isso, os votos projetados de cada
          candidatura aqui podem diferir nos últimos dígitos dos que aparecem na lista de
          candidaturas.
        </p>
      ) : null}
    </Panel>
  );
}
