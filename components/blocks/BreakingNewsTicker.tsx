"use client";

/**
 * components/blocks/BreakingNewsTicker.tsx
 *
 * S06/F4d (Fase 3) — banner rotativo no topo (broadcast-style).
 *
 * 🔴 2026-10-04 (dono) — os itens são os resultados MATEMATICAMENTE definidos
 * (`lib/utils/anuncios-definidos.ts` → `itensFaixaAgora`), a mesma regra do
 * balão do mapa. Até esta data vinham de `national.chamadas_recentes`, cujo
 * texto ("AP chamada para …") saía da `chamada` da PROJEÇÃO. A prop continua
 * se chamando `chamadas` só para não mexer nos chamadores; nenhum texto ao
 * público diz "chamada".
 *
 * Comportamento
 *   - Auto-rotaciona 1 chamada a cada 5s (rotação cíclica).
 *   - `prefers-reduced-motion: reduce` → mostra TODAS as chamadas
 *     empilhadas verticalmente, sem rotação.
 *   - SSR-safe: render inicial mostra primeira chamada (ou empilhado se
 *     `reducedMotion` prop force). matchMedia só consultado em useEffect.
 *
 * Cobertura
 *   - Spec 005 (header `/governador`).
 *   - Constituição § 7 (acessibilidade — respeita reduced motion).
 *   - Constituição § 2 / ADR-0005 — chamadas são templates determinísticos.
 *
 * A11y
 *   - `role="status"` + `aria-live="polite"` — screen reader anuncia
 *     mudança da chamada visível sem ser intrusivo.
 *   - Em reduce mode: `<ul>` com todas as chamadas, sem aria-live (estático).
 */

import { useEffect, useState } from "react";

export interface BreakingNewsTickerProps {
  chamadas: Array<{ ts: string; texto: string }>;
  /** Override pra testes (bypass matchMedia). */
  reducedMotion?: boolean;
  /** Intervalo de rotação em ms. Default 5000. */
  intervalMs?: number;
}

function fmtTime(ts: string): string {
  try {
    const d = new Date(ts);
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

export function BreakingNewsTicker({
  chamadas,
  reducedMotion: reducedMotionProp,
  intervalMs = 5000,
}: BreakingNewsTickerProps) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState<boolean>(reducedMotionProp ?? false);

  // Lê preferência só no client; SSR renderiza assumindo rotação.
  useEffect(() => {
    if (reducedMotionProp !== undefined) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [reducedMotionProp]);

  // Rotação cíclica
  useEffect(() => {
    if (reducedMotion) return;
    if (chamadas.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % chamadas.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [reducedMotion, chamadas.length, intervalMs]);

  if (chamadas.length === 0) {
    return null;
  }

  if (reducedMotion) {
    return (
      <section
        data-testid="breaking-news-ticker"
        data-mode="reduced"
        aria-label="Resultados definidos"
        className="flex flex-col gap-1 rounded-md border px-4 py-3"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-muted)",
        }}
      >
        <span
          className="text-xs uppercase tracking-wide font-semibold"
          // -strong: cor de texto exige 4.5:1 — --color-warning falha
          // (3.05:1 sobre --color-bg-muted). Achado a11y-perf-auditor
          // 2026-09-05, ver globals.css.
          style={{ color: "var(--color-warning-strong, #b45309)" }}
        >
          RESULTADOS DEFINIDOS
        </span>
        <ul className="flex flex-col gap-1">
          {chamadas.map((c) => (
            // `key` pelo texto: todos os itens carregam o MESMO `ts` (o do
            // payload), e um por UF tem texto único.
            <li key={c.texto} className="text-sm" style={{ color: "var(--color-text)" }}>
              <span className="mr-2 tabular-nums" style={{ color: "var(--color-text-muted)" }}>
                {fmtTime(c.ts)}
              </span>
              {c.texto}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const safeIndex = Math.min(index, chamadas.length - 1);
  const current = chamadas[safeIndex];
  return (
    <section
      data-testid="breaking-news-ticker"
      data-mode="rotating"
      role="status"
      aria-live="polite"
      aria-label="Resultados definidos"
      className="flex items-center gap-3 rounded-md border px-4 py-2"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-bg-muted)",
      }}
    >
      <span
        className="shrink-0 text-xs uppercase tracking-wide font-semibold"
        // -strong: idem acima — cor de texto exige 4.5:1.
        style={{ color: "var(--color-warning-strong, #b45309)" }}
      >
        AGORA
      </span>
      <span
        className="text-sm truncate"
        style={{ color: "var(--color-text)" }}
        data-testid="ticker-current-text"
      >
        {current && (
          <>
            <span className="mr-2 tabular-nums" style={{ color: "var(--color-text-muted)" }}>
              {fmtTime(current.ts)}
            </span>
            {current.texto}
          </>
        )}
      </span>
    </section>
  );
}
