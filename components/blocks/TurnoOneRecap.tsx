/**
 * components/blocks/TurnoOneRecap.tsx
 *
 * Header fixo "recap do 1º turno" exibido acima do hero quando a página
 * está em mode 2T. Mostra top-3 do 1T com pct final + label dos dois
 * candidatos que avançaram (ADR-0016).
 *
 * Cobertura
 *   - ADR-0016 (placement decision — header fixo, não widget colapsável).
 *   - Constituição § 8 (transparência metodológica — leitor que chega em
 *     25/10 vê passado e presente em ordem natural).
 *
 * Server Component puro — sem state, sem efeitos, sem interatividade.
 * O caller (page.tsx em mode 2T) é responsável por buscar o payload via
 * `getEdge('projection-archive-pres-t1')` e passá-lo aqui.
 *
 * Gate de renderização
 *   - `recap == null` → null. Cobre:
 *     a) Pré-D1 (chave `projection-archive-pres-t1` ainda não gravada).
 *     b) Erro do orchestrator no archive — recap silencioso é preferível
 *        a placeholder mentindo sobre o 1T.
 *
 * Conteúdo (ADR-0016)
 *   - Label "1º turno (encerrado)" + top-3 candidatos com nome + sigla
 *     partido + pct final.
 *   - Label dos dois que avançaram: "<A> e <B> avançaram ao 2º turno".
 *
 * Cores
 *   - Cada candidato pela SIGLA, via `candidateMarkerColor` — o ponto de
 *     8×8 é marcador de identidade, sem extensão a contornar.
 *     ⚠️ Até 2026-09-19 lia `c.cor` do payload, que é a paleta por
 *     COLOCAÇÃO (ADR-0013, aposentada pelo ADR-0024 em 07/09).
 *
 * A11y
 *   - `<header role="banner">` é redundante quando direto em `<body>`,
 *     então usamos `<section aria-labelledby>` semântico.
 *   - aria-label completo no container facilita screen readers.
 *
 * Tamanho visual
 *   - Banner horizontal compacto (~80–100px desktop). Não compete com
 *     hero do 2T. Tipografia ½ escala.
 */

import { DestinoEtiqueta } from "@/components/atoms/data/DestinoEtiqueta";
import { candidateMarkerColor } from "@/components/blocks/_candidateColor";
import type { EdgePayload } from "@/lib/edge-config/types";
import { anuladasAoFim, compete, queCompetem, sufixoAriaDestino } from "@/lib/utils/destino-voto";
import { formatPercent } from "@/lib/utils/format";
import { nomeExibicao } from "@/lib/utils/nome-candidato";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

export interface TurnoOneRecapProps {
  /**
   * Payload do 1T arquivado (chave `projection-archive-pres-t1` —
   * ADR-0012 + ADR-0016). `null` quando não disponível (pré-D1 ou erro
   * do orchestrator); componente retorna `null` em ambos os casos.
   */
  recap: EdgePayload | null;
  className?: string;
}

export function TurnoOneRecap({ recap, className }: TurnoOneRecapProps) {
  // Gate: sem payload arquivado, sem render.
  if (!recap) return null;
  if (!recap.national?.candidatos || recap.national.candidatos.length === 0) return null;

  // Top-3 do 1T por rank (array já vem ordenado em S05+).
  // ADR-0053 / RF-213 — a anulada fica no fim das 3 (com etiqueta), e os
  // finalistas saem das que COMPETEM, com o `rank` recontado sem as anuladas
  // à frente: `rank` é publicado sobre `vvc` e conta a anulada, e "rank ≤ 2"
  // cru a poria no 2º turno. Sem anulada, `rankSemAnuladas === rank` e a regra
  // (inclusive o `?? -1` de quem não tem rank) é exatamente a de antes.
  const top3 = anuladasAoFim(recap.national.candidatos.slice(0, 3));
  const anuladas = recap.national.candidatos.filter((c) => !compete(c));
  const rankSemAnuladas = (rank: number | undefined): number =>
    rank == null ? -1 : rank - anuladas.filter((a) => a.rank != null && a.rank < rank).length;
  const finalistas = queCompetem(recap.national.candidatos)
    .filter((c) => rankSemAnuladas(c.rank) <= 2)
    .slice(0, 2);
  // Mesmo nome de exibição da lista de três logo abaixo — a frase e as pílulas
  // falam das mesmas duas pessoas e não podem chamá-las de formas diferentes.
  const nomeDe = (c: (typeof finalistas)[number] | undefined) =>
    c ? nomeExibicao(c.nome, c.sqcand) : "";
  const avancaramLabel =
    finalistas.length === 2
      ? `${nomeDe(finalistas[0])} e ${nomeDe(finalistas[1])} avançaram ao 2º turno.`
      : null;

  const containerClass = [
    "flex flex-col gap-2 rounded-md px-4 py-3",
    "border-b border-l-0 border-r-0 border-t-0",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      aria-labelledby="turno-um-recap-heading"
      aria-label="Resumo do 1º turno encerrado"
      className={containerClass}
      style={{
        backgroundColor: "var(--color-bg-muted)",
        borderColor: "var(--color-border)",
      }}
    >
      <header className="flex flex-col gap-0.5">
        <h2
          id="turno-um-recap-heading"
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-text-muted)" }}
        >
          1º turno (encerrado)
        </h2>
        {avancaramLabel && (
          <p className="text-sm" style={{ color: "var(--color-text)" }}>
            {avancaramLabel}
          </p>
        )}
      </header>

      <ul
        aria-label="Top 3 candidatos do 1º turno"
        className="flex flex-wrap items-center gap-x-4 gap-y-1"
      >
        {top3.map((c) => {
          const pctSafe = Number.isFinite(c.pct_projetado)
            ? Math.max(0, Math.min(100, c.pct_projetado))
            : 0;
          const pctLabel = formatPercent(pctSafe, 1);
          return (
            <li
              key={c.id}
              aria-label={`${nomeExibicao(c.nome, c.sqcand)}${sufixoAriaDestino(c.destino)} (${c.partido}): ${pctLabel}`}
              className="flex items-center gap-1.5"
            >
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: candidateMarkerColor(c.partido, c.rank) }}
              />
              <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                {nomeExibicao(c.nome, c.sqcand)}
              </span>
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                {/* Desenhado ⇒ abreviado (2026-09-19). Os três colocados
                    dividem uma única fileira com `flex-wrap`. O `aria-label`
                    do `<li>` acima segue com a sigla inteira. */}
                ({siglaExibicao(c.partido)})
              </span>
              <DestinoEtiqueta destino={c.destino} />
              <span className="text-sm font-semibold tabular-nums">{pctLabel}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
