/**
 * lib/utils/desfecho-governador.ts
 *
 * Ponto ÚNICO da regra "este estado fecha no 1º turno, vai ao 2º, ou ainda
 * não se sabe" para as corridas de GOVERNADOR — spec 006, RF-006.6/7/8
 * (2026-09-27, decisão do dono).
 *
 * Quatro consumidores leem daqui e de mais lugar nenhum:
 *   - o selo do `<GovernorCard>` ("● ELEITO" / "VAI A 2T" / "EM APURAÇÃO");
 *   - os filtros por status de `/governador` (`passesFilter`);
 *   - `<GovernadoresPlacarTurno>` (quantos estados em cada desfecho);
 *   - `<GovernadoresPorPartido>` (quantos por partido).
 * Com a regra em um lugar só, selo, filtro e gráficos batem por construção.
 *
 * ===========================================================================
 * 🔴 O defeito que motivou este módulo: `bucket === "chamada"` NÃO é "eleito"
 * ===========================================================================
 *
 * Até esta data o selo e o filtro "Decididos no 1º turno" tratavam
 * `bucket === "chamada"` como eleito. `chamada` quer dizer só "margem grande
 * sobre o 2º colocado" (`EdgeUfRow.bucket`, docstring: "Ortogonal ao
 * `vai_a_2t`") — e um líder com 38,5% e 13pp de folga está muito à frente E
 * vai ao 2º turno. No simulado de 26/09, ES, GO e MG saíam com "● ELEITO" e
 * `vai_a_2t: true` na mesma linha.
 *
 * ## As duas leituras
 *
 * **Pela projeção** — como o estado deve terminar, segundo o modelo. Lê
 * `vai_a_2t`, que o produtor grava a partir de `pct_projetado < 50`
 * (`api/model/project.py`):
 *   - `eleito_1t`     — `vai_a_2t === false` E `bucket !== "indefinido"` (quem
 *                       ganha precisa estar definido: um "não vai a 2º turno"
 *                       com a ordem 1º/2º em aberto não elege ninguém);
 *   - `segundo_turno` — `vai_a_2t === true`, mesmo com a ordem indefinida:
 *                       que HAVERÁ 2º turno já está dito, quem vai não importa
 *                       para a contagem de estados;
 *   - `em_aberto`     — o resto (`vai_a_2t` nulo ou ausente — payload
 *                       pré-S05, 2º turno —, ou `false` + `indefinido`).
 *
 * **Pela contagem** ("se a apuração parasse agora") — só o que já saiu das
 * urnas. Lê `top_candidatos[].pct_atual`:
 *   - `aguardando`    — `pct_apurado === 0`, ou falta `pct_atual` a alguém do
 *                       corte (ausente ≠ 0 — decisão do dono de 14/09: "não
 *                       começou / não sabemos / apurando" são três estados);
 *   - `eleito_1t`     — o líder DA CONTAGEM tem `pct_atual > 50`;
 *   - `segundo_turno` — caso contrário.
 *   Nunca `em_aberto`: com todos os `pct_atual` medidos, a conta é aritmética.
 *
 * ⚠️ **A base de `pct_atual` é `v.vvc`, não `v.vv`** (ADR-0018: válidos +
 * anulados + anulados sub judice, o mesmo denominador do `pvap` do TSE). A
 * maioria absoluta da Constituição é sobre os VÁLIDOS. Como `vvc ≥ vv`, um
 * `pct_atual > 50` implica mais de 50% dos válidos — o erro possível desta
 * régua é só o conservador: não chamar de "fecharia" um líder que, pelos
 * válidos, já passou de 50%. Nunca o contrário.
 *
 * O líder da contagem sai de `ordenarTopCandidatosPorBase(…, "parcial")` —
 * NÃO de `top_candidatos[0]`, que é o líder por PROJEÇÃO. Desde o RF-190 o
 * array pode trazer, depois do prefixo por projeção, um candidato "resgatado"
 * que lidera o apurado; é ele que conta aqui.
 *
 * **UF ausente de `por_uf`** é `aguardando` nas duas bases: o produtor omite a
 * UF sem nenhuma apuração (`api/model/project.py`), e as 27 precisam aparecer
 * — sumir com uma UF faria o placar somar 26 sem avisar.
 *
 * Funções puras, sem I/O e sem relógio (constituição § 6).
 */

import { UF_NOMES } from "@/components/atoms/maps/_shared";
import type { EdgeUfRow } from "@/lib/edge-config/types";
import { ordenarTopCandidatosPorBase, type TopCandidatoUf } from "@/lib/utils/lider-por-base";

/** Os quatro desfechos possíveis de uma corrida estadual, em uma base. */
export type DesfechoGovernador = "eleito_1t" | "segundo_turno" | "em_aberto" | "aguardando";

/** As duas leituras que a tela põe lado a lado. */
export type BaseDesfecho = "projecao" | "contagem";

/** Ordem canônica dos grupos — a mesma no placar, na faixa de 27 e no teste. */
export const ORDEM_DESFECHOS: readonly DesfechoGovernador[] = [
  "eleito_1t",
  "segundo_turno",
  "em_aberto",
  "aguardando",
] as const;

/**
 * As 27 siglas em ordem alfabética DE SIGLA — é a sigla que a tela desenha, e
 * `UF_NOMES` não está em ordem de sigla (AP antes de AM, PR antes de PE).
 * `.sort()` sem comparador compara code units: determinístico, sem depender do
 * locale do runtime (constituição § 6), e as 27 siglas são ASCII maiúsculo.
 */
export const SIGLAS_UF: readonly string[] = Object.keys(UF_NOMES).sort();

type LinhaProjecao = Pick<EdgeUfRow, "vai_a_2t" | "bucket">;
type LinhaContagem = Pick<EdgeUfRow, "pct_apurado" | "top_candidatos">;

/**
 * Desfecho da UF **pela projeção**. Ver o cabeçalho do arquivo.
 *
 * `vai_a_2t` é lido com igualdade ESTRITA a `true`/`false`: payload pré-S05
 * não tem o campo (vem `undefined`) e a corrida de 2º turno grava `null`. Os
 * dois caem em `em_aberto`, nunca em "eleito".
 */
export function classificarProjecao(row: LinhaProjecao): DesfechoGovernador {
  if (row.vai_a_2t === true) return "segundo_turno";
  if (row.vai_a_2t === false && row.bucket !== "indefinido") return "eleito_1t";
  return "em_aberto";
}

/**
 * Os candidatos da UF na ordem da CONTAGEM, ou `null` quando a contagem não
 * tem leitura honesta (nada apurado, ou falta `pct_atual` a alguém do corte).
 */
function ordemDaContagem(row: LinhaContagem): readonly TopCandidatoUf[] | null {
  if (!(row.pct_apurado > 0)) return null;
  const top = row.top_candidatos ?? [];
  const { ordenados, usouParcial } = ordenarTopCandidatosPorBase(top, "parcial");
  // `usouParcial === false` com `pct_apurado > 0` significa que ALGUÉM do
  // corte não tem `pct_atual`. A ordem devolvida nesse caso é a de PROJEÇÃO
  // (fallback de `ordenarTopCandidatosPorBase`) — usá-la aqui publicaria o
  // líder do modelo sob o título "se a apuração parasse agora".
  if (!usouParcial || ordenados.length === 0) return null;
  return ordenados;
}

/** Desfecho da UF **pela contagem**. Ver o cabeçalho do arquivo. */
export function classificarContagem(row: LinhaContagem): DesfechoGovernador {
  const ordem = ordemDaContagem(row);
  const lider = ordem?.[0]?.pct_atual;
  if (ordem === null || lider === undefined) return "aguardando";
  return lider > 50 ? "eleito_1t" : "segundo_turno";
}

/** Classificador da base pedida — sem ramo default: as duas bases são nomeadas. */
export function classificar(row: EdgeUfRow, base: BaseDesfecho): DesfechoGovernador {
  switch (base) {
    case "projecao":
      return classificarProjecao(row);
    case "contagem":
      return classificarContagem(row);
  }
}

export interface UfNoDesfecho {
  sigla: string;
  /** Nome por extenso — o que o leitor de tela lê no lugar da sigla. */
  nome: string;
}

/** As 27 UFs repartidas pelos quatro desfechos. Todo grupo existe, mesmo vazio. */
export type GruposDesfecho = Record<DesfechoGovernador, UfNoDesfecho[]>;

/**
 * Reparte as 27 UFs pelos desfechos da base pedida.
 *
 * - UF presente em `por_uf` → o classificador da base.
 * - UF de `UF_NOMES` ausente de `por_uf` → `aguardando`.
 * - Linha com sigla fora das 27 (fixture, payload malformado) é IGNORADA: o
 *   placar é das 27 corridas de governador, e uma 28ª linha o faria somar 28.
 * - Sigla repetida: vale a PRIMEIRA ocorrência, pelo mesmo motivo.
 *
 * Dentro de cada grupo a ordem é a de {@link SIGLAS_UF} (alfabética de sigla) —
 * estável entre ciclos, para que a lista não troque de lugar a cada
 * atualização sem que nada mude.
 */
export function agruparPorDesfecho(
  porUf: readonly EdgeUfRow[],
  base: BaseDesfecho,
): GruposDesfecho {
  const porSigla = new Map<string, EdgeUfRow>();
  for (const row of porUf) {
    if (!(row.sigla in UF_NOMES) || porSigla.has(row.sigla)) continue;
    porSigla.set(row.sigla, row);
  }
  const grupos: GruposDesfecho = {
    eleito_1t: [],
    segundo_turno: [],
    em_aberto: [],
    aguardando: [],
  };
  for (const sigla of SIGLAS_UF) {
    const row = porSigla.get(sigla);
    const desfecho = row ? classificar(row, base) : "aguardando";
    grupos[desfecho].push({ sigla, nome: UF_NOMES[sigla] ?? sigla });
  }
  return grupos;
}

/** Uma linha do gráfico por partido. */
export interface LinhaPartido {
  /** Sigla como chegou (aparada). `null` = o payload não trouxe partido. */
  partido: string | null;
  /** Estados em que o candidato do partido fecha no 1º turno. */
  eleitos: number;
  /** Estados em que o partido tem um dos dois candidatos do 2º turno. */
  segundo_turno: number;
}

function chavePartido(tc: TopCandidatoUf | undefined): string | null {
  const p = tc?.partido?.trim();
  return p ? p : null;
}

/**
 * Quem conta, nesta UF e nesta base, para o gráfico por partido.
 *
 * - `eleito_1t`     → o partido do 1º colocado.
 * - `segundo_turno` → os partidos dos DOIS primeiros — na MESMA base que
 *                     classificou a UF (nunca o desfecho de uma base com os
 *                     nomes da outra).
 * - `em_aberto` / `aguardando` → ninguém.
 */
function candidatosQueContam(
  row: EdgeUfRow,
  base: BaseDesfecho,
): { desfecho: DesfechoGovernador; ordem: readonly TopCandidatoUf[] } {
  if (base === "contagem") {
    const desfecho = classificarContagem(row);
    return { desfecho, ordem: ordemDaContagem(row) ?? [] };
  }
  const desfecho = classificarProjecao(row);
  const { ordenados } = ordenarTopCandidatosPorBase(row.top_candidatos ?? [], "proj");
  return { desfecho, ordem: ordenados };
}

/**
 * Soma por partido, na base pedida. Ver {@link candidatosQueContam}.
 *
 * Ordem: total (eleitos + 2º turno) desc → eleitos desc → sigla em collation
 * pt-BR (a mesma de `ordenarBancada`, `lib/utils/bancada.ts`). A ordem é por
 * CONTAGEM, nunca por espectro nem por cor (constituição § 2). A linha sem
 * partido (`partido: null`) vai depois de qualquer sigla empatada com ela —
 * não há sigla a comparar, e o fim do empate é o lugar neutro.
 *
 * Partido sem nenhuma UF contada não aparece: a lista é de quem soma algo.
 */
export function agregarPorPartido(porUf: readonly EdgeUfRow[], base: BaseDesfecho): LinhaPartido[] {
  const acc = new Map<string | null, LinhaPartido>();
  const vistas = new Set<string>();
  const soma = (partido: string | null, campo: "eleitos" | "segundo_turno") => {
    const linha = acc.get(partido) ?? { partido, eleitos: 0, segundo_turno: 0 };
    linha[campo] += 1;
    acc.set(partido, linha);
  };

  for (const row of porUf) {
    // Mesmo filtro de `agruparPorDesfecho`: só as 27, cada uma uma vez — para
    // que "estados eleitos" aqui e no placar sejam o MESMO número.
    if (!(row.sigla in UF_NOMES) || vistas.has(row.sigla)) continue;
    vistas.add(row.sigla);

    const { desfecho, ordem } = candidatosQueContam(row, base);
    if (desfecho === "eleito_1t") {
      if (ordem.length > 0) soma(chavePartido(ordem[0]), "eleitos");
    } else if (desfecho === "segundo_turno") {
      for (const tc of ordem.slice(0, 2)) soma(chavePartido(tc), "segundo_turno");
    }
  }

  return [...acc.values()].sort((a, b) => {
    const totalA = a.eleitos + a.segundo_turno;
    const totalB = b.eleitos + b.segundo_turno;
    if (totalB !== totalA) return totalB - totalA;
    if (b.eleitos !== a.eleitos) return b.eleitos - a.eleitos;
    if (a.partido === null) return b.partido === null ? 0 : 1;
    if (b.partido === null) return -1;
    return a.partido.localeCompare(b.partido, "pt-BR");
  });
}
