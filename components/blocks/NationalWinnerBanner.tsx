/**
 * components/blocks/NationalWinnerBanner.tsx
 *
 * Faixa nacional do Presidente MATEMATICAMENTE eleito — análoga ao
 * `<WinnerBanner />` (UF), mas para o agregado nacional.
 *
 * 🔴 2026-10-04 (dono, ADR-0075) — a faixa só aparece quando a eleição está
 * DEFINIDA, e a única fonte é `EdgeUfRow.eleitos_definidos`, lida pelo ponto
 * único {@link eleitosNacionais} (`lib/utils/anuncios-definidos.ts`). O
 * produtor só emite o campo no cargo 1 quando o arquivo NACIONAL do TSE diz
 * `md='e'` ou depois da totalização final (`tf='s'`); aí o eleito aparece em
 * todas as UFs, e a união dá UM id.
 *
 * Até 04/10 a faixa dizia "ELEITO" / "Presidente eleito" quando
 * `p_vitoria ≥ 0,99` OU apurado ≥ 99% — a primeira é opinião do MODELO, a
 * segunda é aritmética incompleta (1% do Brasil são ~1,5 milhão de votos).
 * Constituição § 1: a tela não proclama o que não está decidido. Nada aqui
 * olha `p_vitoria`, `pct_apurado_total`, `rank`, `candidato_a_id`, `vai_a_2t`
 * ou a base do seletor — por isso o texto é o mesmo nas duas bases.
 *
 * Cobertura
 *   - ADR-0075 (marca de eleito só com eleição matematicamente definida);
 *     ADR-0055 (nunca "Eleito" solto vindo de projeção).
 *   - ADR-0053 / RF-213 — anulada nunca é anunciada (defensivo: o produtor não
 *     a emite, `definicaoDaUf` a descarta, e aqui ela é descartada de novo
 *     pelo `destino` da lista nacional).
 *   - ADR-0024 (cor por PARTIDO). Constituição § 2 (cor via token).
 *
 * Identidade, nunca posição: o nome e a cor saem do **id definido**, mesmo
 * que o líder projetado seja outro.
 *
 * Server Component puro.
 *
 * A11y
 *   - `role="status"` + `aria-live="polite"`.
 *   - Fundo e tinta saem do MESMO par medido, `partyChipInk(sigla)`.
 */

import type { CSSProperties } from "react";

import type { EdgeCandidate, EdgeUfRow, Turno } from "@/lib/edge-config/types";
import { eleitosNacionais, fraseEleitos } from "@/lib/utils/anuncios-definidos";
import { compete } from "@/lib/utils/destino-voto";
import { partyChipInk } from "@/lib/utils/party-color";

/** Atribuição discreta sob o nome — de onde vem a definição. */
export const ATRIBUICAO_TSE = "pela contagem oficial do TSE";

export interface NationalWinnerBannerProps {
  /**
   * Lista nacional de candidatos (`EdgePayload.national.candidatos`) — só
   * para nome, partido e `destino` do id definido. Ordem e `rank` ignorados.
   */
  candidatos: EdgeCandidate[];
  /** `EdgePayload.por_uf` — de onde sai `eleitos_definidos`. */
  porUf: ReadonlyArray<
    Pick<EdgeUfRow, "sigla" | "top_candidatos" | "eleitos_definidos" | "segundo_turno_definido">
  >;
  /** Turno (1 ou 2) — só muda o complemento "no 1º turno". */
  turno: Turno;
  className?: string;
}

// ⚠️ `shouldUseDarkText(rank)` saiu em 2026-09-19. Ela dizia "ranks 1 e 2 têm
// fundos escuros (vermelho/azul); demais são médios/claros" — verdade apenas
// enquanto o fundo vinha da paleta por COLOCAÇÃO. Com a cor do PARTIDO
// (ADR-0024), a claridade do fundo é função da sigla, não da posição: um
// rank 1 de partido claro receberia texto branco sobre fundo claro.
//
// O substituto é `partyChipInk`, que devolve fundo e tinta como PAR MEDIDO
// pelo gerador da paleta. A docstring dele avisa: os dois andam juntos —
// usar este fundo com tinta de outro lugar desfaz a garantia.

export function NationalWinnerBanner({
  candidatos,
  porUf,
  turno,
  className,
}: NationalWinnerBannerProps) {
  // O único gatilho: o id (ou ids) que o produtor declarou definido(s).
  // Anulada fora também pela lista nacional (defensivo — ADR-0053).
  const ids = eleitosNacionais(porUf).filter((id) => {
    const c = candidatos.find((x) => x.id === id);
    return c === undefined || compete(c);
  });
  // Presidente elege UM. Mais de um id é dado incoerente: não anunciar.
  if (ids.length !== 1) return null;
  const id = ids[0] as number;

  // "NOME (PARTIDO) matematicamente eleito" pelo id. `null` ⇒ sem nome em
  // lugar nenhum ⇒ nunca anunciar um eleito sem nome.
  const frase = fraseEleitos([id], porUf, { candidatos });
  if (frase === null) return null;

  const partido =
    candidatos.find((c) => c.id === id)?.partido ??
    porUf.flatMap((r) => r.top_candidatos ?? []).find((t) => t.id === id)?.partido ??
    "";

  // Cor do PARTIDO do eleito, com a tinta que o gerador mediu contra ela.
  const { background, ink } = partyChipInk(partido);
  const style: CSSProperties = {
    backgroundColor: background,
    color: ink,
  };

  // Uma frase só para tela e ouvido.
  const texto = turno === 1 ? `${frase} no 1º turno` : frase;
  const ariaLabel = `Presidente: ${texto}, ${ATRIBUICAO_TSE}.`;
  const containerClass = ["flex flex-col gap-1 rounded-md px-6 py-5", className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      className={containerClass}
      style={style}
    >
      <span className="text-xs font-semibold uppercase tracking-wider opacity-90">Presidente</span>
      <strong className="text-3xl font-semibold leading-tight md:text-4xl">{texto}</strong>
      <span className="text-sm opacity-90">{ATRIBUICAO_TSE}</span>
    </div>
  );
}
