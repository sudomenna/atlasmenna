/**
 * components/atoms/data/ProjecaoIndicador.tsx
 *
 * A linha pequena **"↑ 38,0% proj"** que acompanha o percentual APURADO na
 * visão Parcial. Decisão do dono, 2026-10-03: em toda tela, sob o número
 * grande da parcial, a projeção daquela mesma candidatura numa cor só — a cor
 * que, no sistema inteiro, quer dizer "projeção" (`--color-pct-proj`).
 *
 * ⚠️ Isto emenda a decisão de 2026-09-20 (2ª rodada), "a visão Parcial não
 * mostra leitura do modelo nenhuma": o número grande da Parcial continua sendo
 * só o apurado, e a projeção entra PEQUENA e marcada com a palavra "proj" e a
 * cor da projeção — nunca no lugar nem no tamanho do apurado.
 *
 * ## Seta
 *
 * Comparada na PRECISÃO EXIBIDA (uma casa, a mesma conta de `formatPercent`):
 * ↑ se a projeção exibida é maior que o apurado exibido, ↓ se menor, nenhuma
 * se os dois textos são iguais. 37,96 × 38,04 saem os dois "38,0%" — uma seta
 * ali afirmaria um movimento que a tela não mostra.
 *
 * Seta e número na MESMA cor. Nunca verde/vermelho para "sobe/desce":
 * constituição § 2 — essas matizes são cores de partido, e "↓ em vermelho"
 * sob o candidato do PT leria como outra coisa.
 *
 * ## Quando NÃO aparece (constituição: nunca inventar dado)
 *
 * `projetado` `null`, ausente ou não-finito ⇒ **nada** (`null`). O átomo não
 * deriva projeção de lugar nenhum; quem chama passa o MESMO número que a visão
 * Projeção daquela superfície exibiria, ou `null` quando ela não exibiria
 * nenhum (aguardando, interruptor desligado, anulada, região sem total
 * projetado...). Apurado `null` não esconde a projeção — só tira a seta.
 *
 * ## Acessibilidade
 *
 * O desenhado ("↑ 38,0% proj") é `aria-hidden`; quem ouve recebe a frase
 * inteira em `sr-only`: "projeção 38,0%, acima do apurado". A seta sozinha
 * seria lida como "seta para cima", e "proj" abreviado como sílaba.
 *
 * Quem decide em qual visão ele aparece é o CALLER: o átomo vai dentro de um
 * contêiner `data-view-only="parcial"`. Não carrega o atributo na própria raiz
 * para não brigar com `.bloco` (`display` de folha) nem com o `display: revert`
 * da cascata de `app/globals.css`.
 *
 * Server Component puro — sem `"use client"`.
 */

import { formatPercent, formatVotesCompact } from "@/lib/utils/format";

import s from "./ProjecaoIndicador.module.css";

export type DirecaoProjecao = "acima" | "abaixo" | "igual";

/** O valor que `formatPercent(x, 1)` imprime, como número — mesmo clamp, mesmo `toFixed`. */
function exibido(x: number): number {
  return Number(Math.max(0, Math.min(100, x)).toFixed(1));
}

function finito(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Para que lado a projeção está do apurado, na precisão da tela. `null` quando
 * não há o que comparar (algum dos dois ausente).
 */
export function direcaoProjecao(
  projetado: number | null | undefined,
  parcial: number | null | undefined,
): DirecaoProjecao | null {
  if (!finito(projetado) || !finito(parcial)) return null;
  const p = exibido(projetado);
  const a = exibido(parcial);
  if (p > a) return "acima";
  if (p < a) return "abaixo";
  return "igual";
}

const SETA: Record<DirecaoProjecao, string> = { acima: "↑", abaixo: "↓", igual: "" };
const FALA: Record<DirecaoProjecao, string> = {
  acima: "acima do apurado",
  abaixo: "abaixo do apurado",
  igual: "igual ao apurado",
};

export interface ProjecaoIndicadorProps {
  /** % projetado (0–100) — o MESMO da visão Projeção. `null` ⇒ nada. */
  projetado: number | null | undefined;
  /** % apurado (0–100) exibido ao lado. `null` ⇒ sem seta. */
  parcial: number | null | undefined;
  /** `"sm"` (11px, default) ou `"md"` (13px — sob um número muito grande). */
  size?: "sm" | "md";
  /** `true` ⇒ linha própria (`display: block`). Default: trecho de linha. */
  bloco?: boolean;
  /** Classe extra do caller (margem, alinhamento). */
  className?: string;
}

export function ProjecaoIndicador({
  projetado,
  parcial,
  size = "sm",
  bloco = false,
  className,
}: ProjecaoIndicadorProps) {
  if (!finito(projetado)) return null;
  const texto = formatPercent(projetado, 1);
  const direcao = direcaoProjecao(projetado, parcial);
  const seta = direcao ? SETA[direcao] : "";
  const classes = [s.indicador, size === "md" ? s.md : null, bloco ? s.bloco : null, className]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={classes}
      data-direcao={direcao ?? "sem-apurado"}
      data-testid="projecao-indicador"
    >
      <span aria-hidden="true">
        {seta ? `${seta} ` : ""}
        {texto} proj
      </span>
      <span className="sr-only">
        {direcao ? `projeção ${texto}, ${FALA[direcao]}` : `projeção ${texto}`}
      </span>
    </span>
  );
}

/**
 * `votos_projetados` que a tela pode exibir: número finito e **> 0**. Qualquer
 * outra coisa ⇒ `null` (a linha de votos projetados não sai).
 *
 * Por que `0` também é "não sai": o produtor grava
 * `int(r.get("votos_projetados") or 0)` (`api/model/project.py`, blocos
 * nacional e de UF) — ausência VIRA zero no payload. Zero voto projetado para
 * quem tem percentual projetado não é um resultado do modelo, é a falta dele, e
 * "não sabemos ≠ zero" (decisão do dono de 14/09). Uma candidatura com
 * projeção realmente nula perde só uma linha que diria "≈ 0 votos".
 */
export function votosProjetadosExibiveis(votos: number | null | undefined): number | null {
  return typeof votos === "number" && Number.isFinite(votos) && votos > 0 ? votos : null;
}

export interface VotosProjetadosProps {
  /**
   * Votos PROJETADOS, já como o payload os dá (`votos_projetados` da
   * candidatura, ou um total que o caller soma de campos do payload). Passe
   * por {@link votosProjetadosExibiveis} antes: o átomo não decide ausência.
   */
  votos: number;
  /** Classe extra da raiz (margem, alinhamento). */
  className?: string;
  /** Classe do rótulo "projetados" — o caller pode jogá-lo para a linha de baixo. */
  rotuloClassName?: string;
  /**
   * `true` quando o caller JÁ está dentro de um contêiner
   * `data-view-only="proj"` (o resumo da Projeção de `<RegiaoConsolidada>`):
   * a raiz não repete o atributo. Default `false` — a raiz o carrega.
   */
  dentroDaProjecao?: boolean;
}

/**
 * **"≈ 172 mil votos projetados"** — a contagem de votos da visão Projeção,
 * na cor da projeção (`--color-pct-proj`). Decisão do dono, 2026-10-03: ao
 * trocar o controle para Projeção, a linha de votos sob cada candidatura passa
 * do apurado para o projetado.
 *
 * Abreviada (`formatVotesCompact`) e com "≈" porque é estimativa: o número
 * cheio ("172.418 votos") afirmaria uma precisão que o modelo não tem. Quem
 * ouve recebe "aproximadamente 172 mil votos projetados" — o "≈" desenhado é
 * `aria-hidden` e a palavra vai em `sr-only`.
 *
 * A raiz carrega `data-view-only="proj"` (salvo `dentroDaProjecao`): o número
 * só existe na visão Projeção (a cascata de `app/globals.css` o tira da tela e
 * da árvore de acessibilidade na Parcial). Por isso a raiz NUNCA recebe
 * `display` de folha — uma regra de módulo mais específica que a cascata o
 * mostraria na Parcial.
 *
 * Nenhum número nasce aqui: o átomo só formata o que o caller lhe passa.
 */
export function VotosProjetados({
  votos,
  className,
  rotuloClassName,
  dentroDaProjecao = false,
}: VotosProjetadosProps) {
  return (
    <span
      className={className ? `${s.votos} ${className}` : s.votos}
      data-testid="votos-projetados"
      data-view-only={dentroDaProjecao ? undefined : "proj"}
    >
      {/* 04/10 — o "≈" NÃO pode ficar sozinho num elemento: o axe classifica
          o contraste de um glifo isolado como indecidível (`incomplete`,
          "shortTextContent") e o portão de a11y reprova. O texto desenhado
          inteiro fica num só `aria-hidden`; quem ouve recebe a frase por
          extenso no `sr-only`. */}
      <span aria-hidden="true">
        ≈ {formatVotesCompact(votos)} votos{" "}
        {rotuloClassName ? <span className={rotuloClassName}>projetados</span> : "projetados"}
      </span>
      <span className="sr-only">aproximadamente {formatVotesCompact(votos)} votos projetados</span>
    </span>
  );
}
