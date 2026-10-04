/**
 * lib/utils/selo-resultado.ts
 *
 * O selo em pílula dos dois primeiros cartões do `<ResultPanel>` (versão D do
 * protótipo de 2026-09-27, `docs/design-system/prototipos/apuracao-2026-09-27/`).
 *
 * Função pura, sem React: quem desenha é o painel; quem DECIDE o texto — e se
 * há texto — é daqui. Separada para que a regra seja testável sem renderizar
 * nada (e sem que um teste de marcação precise montar cada combinação de
 * turno × cargo × base).
 *
 * ## As regras, e de onde cada uma vem
 *
 * 1. **O selo sempre diz de que base vem** ("· projeção", "· na parcial",
 *    "Vaga projetada", "Vaga na parcial"). Nunca "Eleito"/"Não eleito" soltos:
 *    nada nesta tela é resultado oficial (constituição § 1; o caso (h) de
 *    `tests/unit/components/ResultPanelVagas.test.tsx`).
 * 2. **Só os dois primeiros DA BASE** ganham selo — são os dois cartões. As
 *    demais linhas não têm selo nenhum.
 * 3. **A anulada nunca ganha selo** (ADR-0053: anulada não disputa vaga,
 *    margem nem turno). Ela é tirada ANTES de contar as duas posições — então
 *    uma anulada que por acaso estivesse na posição 1 não rouba o selo do 3º
 *    que disputa.
 * 4. **2º turno ⇒ sem selo.** Com dois nomes na lista, "vai ao 2º turno" é
 *    tautologia e "vence" seria proclamação.
 * 5. **Presidente por UF ⇒ sem selo** (decisão do dono, 2026-09-27): quem vai
 *    ao 2º turno é decidido pelo Brasil, não pelo estado. Quem chama expressa
 *    isso com a regra `"nenhum"`.
 * 6. **Maioria**: com a regra `"turno"`, se o líder DA BASE passa de 50% dos
 *    votos da base (percentual sobre válidos — ou sobre votos em disputa, com
 *    anulada; ADR-0053 opção A), só ele recebe selo, e o texto é o do 1º turno.
 *    `> 50`, estritamente: 50,0% não é maioria absoluta.
 */

import type { EdgeDestinoVoto } from "@/lib/edge-config/types";
import { ordensPorBase } from "@/lib/utils/rank-parcial";
import { ocupantesDasVagas } from "@/lib/utils/vagas-eleitas";

/** Qual gramática de selo a corrida usa. */
export type RegraSelo =
  /** Presidente na home e Governador por UF: 2º turno / vence no 1º turno. */
  | "turno"
  /** Senador: a(s) vaga(s) da corrida. */
  | "vaga"
  /** Sem selo — Presidente na tela do estado, e qualquer corrida sem regra. */
  | "nenhum";

export type BaseSelo = "parcial" | "proj";

/** O texto do selo de vaga, por base — o mesmo do `<VagaBadge>`. */
export const VAGA_LABEL = { parcial: "Vaga na parcial", proj: "Vaga projetada" } as const;

/** Os textos da regra `"turno"`, por base. */
export const TURNO_LABEL = {
  segundo: { parcial: "2º turno · na parcial", proj: "2º turno · projeção" },
  primeiro: { parcial: "Venceria no 1º turno · na parcial", proj: "Vence no 1º turno · projeção" },
} as const;

/** Quantos cartões existem — o teto de selos por base. */
export const SELOS_MAX = 2;

/** O mínimo que a regra lê de uma candidatura. */
export interface CandidatoSelo {
  id: number;
  pct_atual: number;
  pct_projetado: number;
  destino?: EdgeDestinoVoto;
}

export interface OpcoesSelo {
  regra: RegraSelo;
  /** Turno da corrida. `2` desliga todo selo. Ausente ⇒ tratado como 1º turno. */
  turno?: number | null;
  /** Vagas da corrida (regra `"vaga"`). Default 1. */
  vagas?: number;
}

/**
 * Os selos de UMA base: `id` → texto. Ausente do mapa ⇒ sem selo.
 *
 * @param ordenada as candidaturas **já na ordem da base** (`ordensPorBase`).
 *   A função não reordena: a ordem é a mesma que a tela mostra, e é isso que
 *   garante que o selo caia em quem está no cartão.
 */
export function selosDaBase(
  ordenada: readonly CandidatoSelo[],
  base: BaseSelo,
  { regra, turno, vagas = 1 }: OpcoesSelo,
): Map<number, string> {
  const selos = new Map<number, string>();
  if (regra === "nenhum" || turno === 2) return selos;

  const disputam = ordenada.filter((c) => c.destino !== "anulado");
  const pctDaBase = (c: CandidatoSelo) => (base === "proj" ? c.pct_projetado : c.pct_atual);

  if (regra === "vaga") {
    const n = Math.min(SELOS_MAX, Math.max(1, Math.trunc(Number.isFinite(vagas) ? vagas : 1)));
    // 2026-09-29 — quem ocupa as vagas sai do ponto único
    // (`lib/utils/vagas-eleitas.ts`), o mesmo do `<StateResultSheet>`, do
    // balão do mapa, dos cartões de `/senador` e do hemiciclo de 2027. O
    // clamp acima continua aqui: ele é sobre CARTÕES (`SELOS_MAX`), não sobre
    // a regra de quem elege.
    for (const c of ocupantesDasVagas(ordenada, n)) selos.set(c.id, VAGA_LABEL[base]);
    return selos;
  }

  // regra === "turno"
  const lider = disputam[0];
  if (lider == null) return selos;
  const pctLider = pctDaBase(lider);
  if (Number.isFinite(pctLider) && pctLider > 50) {
    selos.set(lider.id, TURNO_LABEL.primeiro[base]);
    return selos;
  }
  for (const c of disputam.slice(0, SELOS_MAX)) selos.set(c.id, TURNO_LABEL.segundo[base]);
  return selos;
}

/**
 * Os selos das DUAS bases de uma corrida, a partir da lista crua.
 *
 * Ponto único de "que selo cada candidatura tem em cada base" — 2026-10-04
 * (dono): a folha do município (`<MunicipioExplorer>`) passou a mostrar o
 * status de cada candidato na corrida do ESTADO, e ele tem de ser EXATAMENTE
 * o dos cartões do `<ResultPanel>` da mesma página. Os dois chamam esta
 * função com a mesma lista (`payload.candidatos`) e as mesmas opções; a ordem
 * de cada base sai de `ordensPorBase` (o mesmo ponto que o painel usa para a
 * lista), e o texto de `selosDaBase`.
 *
 * Não recebe a lista já ordenada de propósito: quem chama não tem como errar
 * a ordem da base, porque não é quem a escolhe.
 */
export function selosPorBase(
  candidatos: readonly CandidatoSelo[],
  opcoes: OpcoesSelo,
): Record<BaseSelo, Map<number, string>> {
  const ordens = ordensPorBase(candidatos);
  return {
    parcial: selosDaBase(ordens.parcial, "parcial", opcoes),
    proj: selosDaBase(ordens.proj, "proj", opcoes),
  };
}

/**
 * 🔴 2026-10-04 (dono) — a regra de selo das superfícies do MAPA NACIONAL (o
 * balão do desktop e a gaveta do celular), por cargo. É a MESMA gramática dos
 * cartões da página de cada corrida: Governador por UF usa `"turno"`, Senador
 * `"vaga"` e Presidente na UF `"nenhum"` (decisão de 27/09 — quem vai ao 2º
 * turno é decidido pelo Brasil, não pelo estado; regra 5 acima).
 */
export function regraSeloNoMapaNacional(cargo: "pres" | "gov" | "sen"): RegraSelo {
  if (cargo === "gov") return "turno";
  if (cargo === "sen") return "vaga";
  return "nenhum";
}

/** O mínimo de `EdgeUfRow.top_candidatos[]` que {@link selosDoTopUf} lê. */
export interface TopUfSelo {
  id: number;
  /** Projeção (payload: `pct`). */
  pct: number;
  /** Parcial (payload: `pct_atual`); ausente ⇒ não finito, nunca 0. */
  pct_atual?: number;
  destino?: EdgeDestinoVoto;
}

/**
 * {@link selosDaBase} sobre a lista de UMA UF do payload, já na ordem da base
 * que a tela DE FATO usou (`ordenarTopCandidatosPorBase` → `ordenados`, com
 * `base` derivada de `usouParcial` — nunca de `viewMode` cru). Só traduz os
 * nomes de campo do payload (`pct` = projeção, `pct_atual` = parcial) para os
 * de `CandidatoSelo`; a regra é a de cima, intacta.
 *
 * `pct_atual` ausente vira `NaN`, não `0`: a regra de maioria exige
 * `Number.isFinite`, então ausência nunca vira "venceria no 1º turno" nem
 * empurra ninguém para fora (e a base "parcial" só é usada quando TODO o
 * corte tem `pct_atual` — ver `ordenarTopCandidatosPorBase`).
 */
export function selosDoTopUf(
  ordenadaNaBase: readonly TopUfSelo[],
  base: BaseSelo,
  opcoes: OpcoesSelo,
): Map<number, string> {
  return selosDaBase(
    ordenadaNaBase.map((c) => ({
      id: c.id,
      pct_atual: typeof c.pct_atual === "number" ? c.pct_atual : Number.NaN,
      pct_projetado: c.pct,
      ...(c.destino ? { destino: c.destino } : {}),
    })),
    base,
    opcoes,
  );
}
