/**
 * components/blocks/NaImprensaPanel.tsx
 *
 * "Na imprensa" — manchetes de feeds públicos dos veículos, na home
 * presidencial, durante a apuração (leitura da noite, ADR-0072).
 *
 * Só título, veículo, hora e link para a matéria no site do veículo — nunca o
 * texto da matéria. A seleção (quantas, quantas por veículo, idade máxima) é
 * feita antes, em `filtrarParaTela` (`lib/leitura/ler.ts`); este bloco só
 * desenha o que recebe.
 *
 * Segunda barreira de segurança: o link já passou pelo schema do Blob
 * (`MancheteSchema`, só `http(s)`), e aqui é conferido DE NOVO no render —
 * `javascript:`, `data:` ou qualquer coisa que não seja `http:`/`https:`
 * não vira `<a>`. A manchete inteira é descartada.
 *
 * Neutralidade (constituição § 2): o bloco não ordena por veículo nem destaca
 * nenhum; não usa cor de partido. A nota de rodapé diz que o AtlasMenna não
 * edita nem endossa.
 *
 * Server Component puro — sem `"use client"`, sem estado, zero JS novo.
 *
 * A11y: `<ul>` com um `<li>` por manchete; o link avisa, em texto só para
 * leitor de tela, que abre em nova aba; o horário vai em `<time dateTime>`.
 * Título e veículo quebram em qualquer ponto (`overflow-wrap: anywhere`) para
 * não criar rolagem horizontal em 375 px.
 */

import { Panel } from "@/components/atoms/surfaces/Panel";
import type { Manchete } from "@/lib/leitura/types";
import { formatTimeHMS } from "@/lib/utils/format";

export interface NaImprensaPanelProps {
  itens: Manchete[];
  className?: string;
}

/** `true` só para URL absoluta `http:`/`https:` que o `URL` consegue ler. */
export function linkSeguro(link: string): boolean {
  if (typeof link !== "string" || !/^https?:\/\//i.test(link)) return false;
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** "HH:MM" no fuso de São Paulo, ou `null` para data ausente/ilegível. */
function horaMinuto(iso: string | null): string | null {
  if (!iso) return null;
  const hms = formatTimeHMS(iso);
  return hms === "—" ? null : hms.slice(0, 5);
}

export function NaImprensaPanel({ itens, className }: NaImprensaPanelProps) {
  const seguras = (itens ?? []).filter((m) => m && linkSeguro(m.link) && m.titulo);
  if (seguras.length === 0) return null;

  return (
    <Panel
      kicker="Na imprensa"
      title="O que os veículos estão publicando"
      titleId="na-imprensa-heading"
      className={className}
    >
      <ul data-testid="na-imprensa-lista" className="m-0 list-none p-0">
        {seguras.map((m, i) => {
          const hora = horaMinuto(m.publicado_em);
          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: lista posicional, já ordenada e deduplicada; o link pode repetir entre feeds.
              key={i}
              data-feed={m.feed}
              style={{
                padding: "var(--space-3) 0",
                borderTop: i === 0 ? undefined : "1px solid var(--border-hairline)",
                minWidth: 0,
              }}
            >
              <a
                href={m.link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                style={{
                  font: "var(--type-body)",
                  fontWeight: 600,
                  overflowWrap: "anywhere",
                  textWrap: "pretty",
                }}
              >
                {m.titulo}
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
              <div
                style={{
                  marginTop: "var(--space-1)",
                  font: "var(--type-body-sm)",
                  color: "var(--text-secondary)",
                  overflowWrap: "anywhere",
                }}
              >
                <span>{m.veiculo}</span>
                {hora && m.publicado_em ? (
                  <>
                    {" · "}
                    <time dateTime={m.publicado_em} style={{ font: "var(--type-data)" }}>
                      {hora}
                    </time>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p
        data-testid="na-imprensa-nota"
        style={{
          margin: "var(--space-3) 0 0",
          font: "var(--type-body-sm)",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
        }}
      >
        Manchetes coletadas automaticamente de feeds públicos dos veículos. O AtlasMenna não edita
        nem endossa; leia a matéria no site do veículo.
      </p>
    </Panel>
  );
}
