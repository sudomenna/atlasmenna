/**
 * components/layout/ShellLiveBadge.tsx
 *
 * Selo de apuração da barra do topo (ADR-0029 § 4) — "70% APURADO" no
 * protótipo, "23,4% apurado" aqui.
 *
 * ## O problema: o shell não lê dado, mas o selo mostra dado
 *
 * `app/layout.tsx` não pode ler o Edge Config nem `searchParams`/`cookies()`
 * — qualquer um dos dois tira a home e as 54 páginas de UF do
 * pré-render estático (ADR-0025 § 2 e § 5). E, sendo irmão anterior de
 * `{children}`, o `<TopBar>` também não recebe nada da página por props.
 *
 * ## A saída: a página publica o estado como custom property
 *
 * Custom properties CSS herdam de `:root` para o documento inteiro —
 * inclusive para trás, para o `<TopBar>`, que vem antes do `<main>` no DOM.
 * A página emite uma regra `:root { … }` (ver `LivePctLabelStyle()` em
 * `app/(pres)/page.tsx`) e este selo a consome. Sem JS, sem estado, sem
 * tornar rota alguma dinâmica.
 *
 * ## Todo default é silêncio (RF-159)
 *
 * 🔴 Até 2026-09-13 o selo afirmava **"AO VIVO"**, com o ponto pulsando e o
 * `sr-only` "Apuração ao vivo", em **toda** rota — inclusive nas que exibem
 * "ainda não recebemos o primeiro boletim", e inclusive em `/candidatos`,
 * `/sobre-o-modelo` e `/status`, que nunca foram ao vivo em dia nenhum do
 * calendário. O fallback do `var()` era a afirmação; a afirmação era falsa.
 *
 * Agora cada camada tem **o silêncio como default**, e uma página precisa
 * declarar explicitamente cada afirmação que quer fazer:
 *
 * | custom property        | default      | o que a página publica          |
 * |------------------------|--------------|---------------------------------|
 * | `--live-badge-display` | `none`       | `inline-flex` — o selo existe   |
 * | `--live-pct-label`     | `""`         | `"23,4% apurado"`               |
 * | `--live-dot-state`     | `paused`     | `running` — o ponto pulsa       |
 * | `--live-sr-ao-vivo`    | `none`       | `inline` — "Apuração ao vivo"   |
 * | `--live-sr-pre`        | `none`       | `inline` — fase pré-eleição     |
 *
 * Uma rota que não publica nada não mostra selo nenhum: um selo de estado
 * sem estado a reportar não deve estar na tela.
 *
 * ## Acessibilidade
 *
 * 🔴 **`content` de CSS não conserta texto acessível.** É lido de forma
 * inconsistente entre leitores de tela — é por isso que o percentual **não**
 * é anunciado daqui: o texto visível é `aria-hidden`, e o percentual
 * continua sendo texto real, anunciável e com `aria-live`, no
 * `<ApuracaoMeta>` dentro do painel de resultado (RF-026).
 *
 * Pelo mesmo motivo, o texto acessível do selo **não** é escolhido por
 * `content`: as duas frases possíveis estão as duas no DOM, e uma custom
 * property decide qual delas tem `display: none` — que é a única forma de
 * remoção que os dois leitores respeitam (`sr-only` sozinho **não** remove,
 * e um `sr-only` no elemento errado faria o leitor ouvir as duas frases
 * seguidas). Ver design 019 § D6.
 *
 * Sem `role="status"`: uma live region cujo conteúdo acessível nunca muda só
 * gasta anúncio. `<LiveBadge>` (o selo da página) segue existindo e mantém
 * `role="status"` onde faz sentido.
 */

import styles from "./ShellLiveBadge.module.css";

export interface ShellLiveBadgeProps {
  className?: string;
}

export function ShellLiveBadge({ className }: ShellLiveBadgeProps) {
  return (
    <span
      className={[styles.badge, className].filter(Boolean).join(" ")}
      data-testid="shell-live-badge"
    >
      <span aria-hidden="true" className={styles.dot} data-testid="shell-live-badge-dot" />
      <span aria-hidden="true" className={styles.label} />
      <span className={`sr-only ${styles.srPre}`} data-testid="shell-live-badge-sr-pre">
        A eleição ainda não começou. A votação é em 4 de outubro de 2026.
      </span>
      <span className={`sr-only ${styles.srAoVivo}`} data-testid="shell-live-badge-sr-ao-vivo">
        Apuração ao vivo
      </span>
      {/* 1º turno encerrado — `:root[data-encerrado]` (app/globals.css) troca
          o rótulo para "Resultado final", para o ponto e mostra esta frase no
          lugar de "Apuração ao vivo". */}
      <span className={`sr-only ${styles.srFinal}`} data-testid="shell-live-badge-sr-final">
        Resultado final do 1º turno
      </span>
    </span>
  );
}
