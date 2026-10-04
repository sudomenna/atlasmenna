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
import { eleitosNacionais, fraseEleitos } from "@/lib/utils/anuncios-definidos";
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

  // 🔴 2026-10-04 (dono) — saiu "N de 27 unidades federativas já chamadas."
  // (contava `EdgeUfRow.chamada`, leitura da PROJEÇÃO). A frase de definição
  // segue a regra do balão do mapa: só existe quando o Brasil inteiro está
  // MATEMATICAMENTE definido (`eleitos_definidos`), e então nomeia o eleito.
  const eleitos = eleitosNacionais(p.por_uf);
  const fraseEleito = eleitos.length > 0 ? fraseEleitos(eleitos, p.por_uf ?? [], p.national) : null;
  const p2t = p.national?.p_segundo_turno_overall;
  const partes: string[] = [];
  if (typeof p2t === "number" && Number.isFinite(p2t)) {
    partes.push(`P(2º turno) = ${formatPercent(p2t * 100, 1)}.`);
  }
  if (fraseEleito) partes.push(`${fraseEleito} pela contagem oficial do TSE.`);
  if (partes.length > 0) out.push(partes.join(" "));
  return out;
}
