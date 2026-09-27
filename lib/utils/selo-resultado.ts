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
  destino?: string;
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
    for (const c of disputam.slice(0, n)) selos.set(c.id, VAGA_LABEL[base]);
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
