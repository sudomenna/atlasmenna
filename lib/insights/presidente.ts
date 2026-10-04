/**
 * lib/insights/presidente.ts
 *
 * Frases por TEMPLATE sobre o payload presidencial — porte de
 * `insightsPresidente` (`data-pipeline/simulacao-gerar.ts`), que só existia
 * no gerador do modo simulado. Aqui lê direto do `EdgePayload` publicado,
 * para servir de base à "leitura da noite" (ADR-0072).
 *
 * Mesmas condições do original: "os intervalos se sobrepõem, não há vencedor
 * projetado" quando o limite inferior do 1º não passa o superior do 2º; senão
 * "acima da margem de incerteza". Diferenças deliberadas: ordem por `rank`
 * (o original confiava na ordem do array), nome via `nomeExibicao`, a frase
 * de P(2º turno) cai quando o número é nulo, e quem tem voto anulado
 * (ADR-0053) não entra na comparação.
 */

import type { EdgeCandidate, EdgePayload } from "@/lib/edge-config/types";
import { compete } from "@/lib/utils/destino-voto";
import { formatPercent } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";

/** Uma casa decimal, vírgula pt-BR, sem sinal (o original: `toFixed(1)`). */
function pp(n: number): string {
  return n.toFixed(1).replace(".", ",");
}

function ordenarPorRank(cands: readonly EdgeCandidate[]): EdgeCandidate[] {
  return cands
    .map((c, i) => ({ c, r: Number.isFinite(c.rank) ? c.rank : i + 1, i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}

export function insightsPresidenteDoPayload(
  p: Pick<EdgePayload, "national" | "por_uf" | "pct_apurado_total">,
): string[] {
  if (!(p.pct_apurado_total > 0)) return [];
  const cands = ordenarPorRank((p.national?.candidatos ?? []).filter(compete));
  const a = cands[0];
  const b = cands[1];
  if (a === undefined || b === undefined) return [];

  const nomeA = nomeExibicao(a.nome, a.sqcand);
  const nomeB = nomeExibicao(b.nome, b.sqcand);

  const out: string[] = [
    `${nomeA} (${a.partido}) à frente com ${formatPercent(a.pct_projetado, 1)} — intervalo de ${formatPercent(a.pct_projetado_lower, 1)} a ${formatPercent(a.pct_projetado_upper, 1)} com ${formatPercent(p.pct_apurado_total, 1)} apurado.`,
  ];

  const margem = a.pct_projetado - b.pct_projetado;
  const sobrepoe = a.pct_projetado_lower <= b.pct_projetado_upper;
  out.push(
    sobrepoe
      ? `Diferença de ${pp(margem)} pp para ${nomeB} (${b.partido}) — os intervalos se sobrepõem, não há vencedor projetado.`
      : `${nomeA} abre ${pp(margem)} pp sobre ${nomeB} (${b.partido}), acima da margem de incerteza.`,
  );

  const chamadas = (p.por_uf ?? []).filter((l) => l.chamada === true).length;
  const p2t = p.national?.p_segundo_turno_overall;
  const fraseChamadas = `${chamadas} de 27 unidades federativas já chamadas.`;
  out.push(
    typeof p2t === "number" && Number.isFinite(p2t)
      ? `P(2º turno) = ${formatPercent(p2t * 100, 1)}. ${fraseChamadas}`
      : fraseChamadas,
  );
  return out;
}
