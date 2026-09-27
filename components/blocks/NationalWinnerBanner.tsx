/**
 * components/blocks/NationalWinnerBanner.tsx
 *
 * Banner nacional "ELEITO" — análogo ao `<WinnerBanner />` (UF), mas pro
 * agregado nacional. Aparece quando o líder atinge threshold de chamada
 * (p_vitoria >= 0.99 ou apuração >= 99%).
 *
 * Cobertura
 *   - Inspirado em RF-032 (WinnerBanner UF) — versão nacional para o
 *     placar presidencial. Próximo nível semântico: "chamada final".
 *   - ADR-0024 (cor por PARTIDO). ⚠️ Até 19/09 este banner citava o ADR-0013
 *     (cor por rank) e pintava por colocação — ver a nota acima de `style`.
 *   - Constituição § 2 (neutralidade — cor via token, nunca partidária).
 *
 * Server Component puro. Caller passa o slice nacional + total apurado.
 *
 * Gate de renderização
 *   - Em 1T: só renderiza se `vai_a_2t === false` (sinal binário do
 *     payload — orchestrator declara que NÃO vai a 2T no agregado
 *     nacional) E threshold atingido.
 *   - Em 2T: qualquer threshold atingido (não há "vai a 2T" — o 2T já é).
 *   - Threshold combinado (OR): `p_vitoria_lider >= 0.99` OU
 *     `pct_apurado_total >= 99.0`. A primeira é probabilística (modelo
 *     muito confiante), a segunda é factual (apuração quase 100%).
 *   - `national.candidato_a_id == null` → null (pré-apuração).
 *
 * Como o líder é resolvido
 *   - Procuramos o candidato com `rank === 1` no array. Se ausente,
 *     fallback para `national.candidato_a_id` (lookup por id). Se ambos
 *     falharem, não renderiza (degradação silenciosa).
 *
 * A11y
 *   - `role="status"` + `aria-live="polite"` — quando o banner aparecer
 *     mid-apuração, screen readers anunciam de forma não-intrusiva.
 *   - Fundo e tinta saem do MESMO par medido, `partyChipInk(sigla)`.
 *     ⚠️ Até 19/09 a tinta era escolhida pelo `rank` ("1–2 = fundo escuro =
 *     texto branco"), premissa que só valia na paleta por colocação. Padrão
 *     do `<WinnerBanner />` UF.
 */

import type { CSSProperties } from "react";

import type { EdgeCandidate, EdgeNational, Turno } from "@/lib/edge-config/types";
import { compete } from "@/lib/utils/destino-voto";
import { formatPercent } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { partyChipInk } from "@/lib/utils/party-color";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

/** Threshold mínimo de p_vitoria do líder para "chamada final". */
export const NATIONAL_WIN_P_THRESHOLD = 0.99;
/** Threshold mínimo de apuração total para "chamada final". */
export const NATIONAL_WIN_PCT_APURADO_THRESHOLD = 99.0;

export interface NationalWinnerBannerProps {
  national: EdgeNational;
  /** Lista completa de candidatos do payload (alimenta lookup por id). */
  candidatos: EdgeCandidate[];
  /**
   * % total apurado da corrida (0–100). Vem do `EdgePayload.pct_apurado_total`.
   * O caller é responsável por passar — não está em `EdgeNational`.
   */
  pctApuradoTotal: number;
  /** Turno (1 ou 2). Em 1T exige `vai_a_2t === false` no payload (não há aqui — caller filtra). */
  turno: Turno;
  /**
   * Sinal binário do orchestrator: a eleição NÃO vai a 2T no agregado
   * nacional. Em 1T, exigimos `false` para renderizar. Em 2T, ignorado.
   * Convenção: `null` é tratado como `undefined` (sem sinal, não renderiza
   * em 1T por segurança). Em 2T sempre passa.
   *
   * Source: derivado de `p_segundo_turno_overall` no caller — quando
   * o caller passa esta prop, ele já decidiu o status do agregado.
   */
  vaiA2t?: boolean | null;
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
  national,
  candidatos,
  pctApuradoTotal,
  turno,
  vaiA2t,
  className,
}: NationalWinnerBannerProps) {
  // Gate 1: sem líder identificado.
  if (national.candidato_a_id == null) return null;

  // Resolve líder: rank 1 primeiro, fallback por id.
  //
  // 🔴 ADR-0053 / RF-213 — `rank` conta a candidatura anulada (é publicado
  // sobre `vvc`). Com ela em `rank` 1, o banner diria "Presidente eleito:
  // <anulada>" assim que `pct_apurado_total` passasse do limiar. O `rank` 1
  // só vale se COMPETE; senão, `candidato_a_id`, que o modelo já escolhe
  // entre as que competem.
  const lider =
    candidatos.find((c) => (c.rank ?? -1) === 1 && compete(c)) ??
    candidatos.find((c) => c.id === national.candidato_a_id);
  if (!lider) return null;

  // Gate 2 (turno 1): exige `vai_a_2t === false` (não vai a 2T no agregado).
  // null/undefined em 1T = sem sinal → não renderiza por segurança.
  if (turno === 1 && vaiA2t !== false) return null;

  // Gate 3: threshold (p_vitoria OR pct_apurado_total).
  const meetsPVitoria = lider.p_vitoria >= NATIONAL_WIN_P_THRESHOLD;
  const meetsApurado = pctApuradoTotal >= NATIONAL_WIN_PCT_APURADO_THRESHOLD;
  if (!meetsPVitoria && !meetsApurado) return null;

  // Cor do PARTIDO, com a tinta que o gerador mediu contra ela. Esta é a
  // frase mais forte do produto — e era pintada pela colocação do líder.
  const { background, ink } = partyChipInk(lider.partido);
  const style: CSSProperties = {
    backgroundColor: background,
    color: ink,
  };

  const pctLabel = formatPercent(lider.pct_projetado, 1);
  // Um nome só para o `aria-label` e para o `<strong>`: é a frase mais forte
  // do produto inteiro, e não pode dizer uma coisa na tela e outra no ouvido.
  const nome = nomeExibicao(lider.nome, lider.sqcand);
  const ariaLabel = `Presidente eleito: ${nome} (${lider.partido}) com ${pctLabel}.`;
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
      <span className="text-xs font-semibold uppercase tracking-wider opacity-90">ELEITO</span>
      <strong className="text-3xl font-semibold leading-tight md:text-4xl">
        {nome} é {turno === 2 ? "eleito" : "eleito no 1º turno"}
      </strong>
      <span className="text-sm opacity-90">
        {/* Desenhado ⇒ abreviado (2026-09-19); o `aria-label` acima mantém a
            sigla inteira. É a única divergência visto/ouvido desta faixa, e ela
            é deliberada: a frase do `<strong>` — o nome da pessoa eleita — é
            idêntica nos dois canais, e é ela que o comentário logo acima manda
            manter igual. A sigla é o dado ao lado, não a frase. */}
        {siglaExibicao(lider.partido)} · {pctLabel}
      </span>
    </div>
  );
}
