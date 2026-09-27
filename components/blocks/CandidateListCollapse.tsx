"use client";

/**
 * components/blocks/CandidateListCollapse.tsx
 *
 * O colapso **puramente visual** da lista de candidatos do `<ResultPanel>`
 * (decisão D21 do usuário, 2026-09-09).
 *
 * ## O que este componente é, e o que ele não é
 *
 * Ele **não decide o que renderizar**. As linhas chegam prontas, como
 * `children` já renderizados pelo Server Component pai — todas elas, as 6
 * primeiras e as excedentes, na mesma `<ol>`. O que este componente faz é
 * escrever `data-collapsed` na lista e manter o `aria-expanded` do botão
 * honesto. Quem clipa é a cascata de `ResultPanel.module.css`.
 *
 * Isso importa por duas razões:
 *
 *   1. **ADR-0017 / ADR-0029 § 7 / ADR-0033 § 2.** O que aqueles ADRs
 *      rejeitam no botão do kit é a REMOÇÃO de nós (`rows.slice(0, limit)`,
 *      `ui_kits/atlas-menna/App.jsx:39`). A decisão D21 mantém o botão e
 *      descarta a remoção: nenhum candidato sai do DOM, da árvore de
 *      acessibilidade ou da busca da página em nenhum estado do botão.
 *   2. **RNF-007a.** Como as linhas entram por `children`, elas continuam
 *      sendo Server Components — `<CandidateResultRow>`, `<PartyTag>` e o
 *      payload inteiro ficam fora do bundle do cliente. O que vai para o
 *      cliente é este arquivo mais o `<Button>`.
 *
 * ## A lista também reordena (2026-09-20)
 *
 * As linhas chegam na ordem da PROJEÇÃO e `<ReordenaListaPorBase>` as
 * **reposiciona no DOM** quando a base ativa é "Parcial" — por isso este
 * componente marca a própria `<ol>` com `ATRIBUTO_LISTA`, que é como aquele
 * módulo a encontra.
 *
 * ⚠️ **Esta frase dizia `order` de CSS até 2026-09-20**, e a cascata que ela
 * citava foi REMOVIDA no mesmo commit que criou a reordenação por DOM:
 * `order` movia pixel e deixava o documento na ordem antiga, violando a WCAG
 * SC 1.3.2. Achado pelo `a11y-perf-auditor` no portão — e é o terceiro
 * comentário desatualizado a morder esta mudança (ver `_lista-por-base.ts`
 * sobre os outros dois). Comentário que descreve mecanismo morto vira
 * "verdade" para quem ler daqui a três semanas.
 *
 * O `data-collapsed` que este componente escreve segue sendo metade do seletor
 * que decide quais 6 linhas ficam visíveis EM CADA BASE — e isso **não** foi
 * afetado: aquele seletor casa por `data-extra-row`, atributo de linha, nunca
 * por posição.
 *
 * ## `aria-expanded` num conteúdo que nunca some
 *
 * O estado ainda é real e ainda merece ser anunciado: colapsada, a lista
 * mostra 6 nomes e esconde visualmente o resto; expandida, mostra todos. Um
 * usuário de leitor de tela que percorre a narrativa linear encontra os 13 de
 * qualquer forma (é o que o ADR-0017 protege); o `aria-expanded` existe para
 * quem usa o leitor de tela COM a tela, e para quem navega por elementos
 * interativos. `aria-controls` aponta para a `<ol>` que muda de estado.
 */

import { useId, useState } from "react";
import { Button } from "@/components/atoms/controls/Button";
import { ATRIBUTO_LISTA } from "@/components/blocks/_lista-por-base";

import styles from "./ResultPanel.module.css";

export interface CandidateListCollapseProps {
  /**
   * TODAS as linhas, já renderizadas no servidor, como `<li>`. As excedentes
   * precisam carregar `data-extra-row` com as bases em que elas caem fora do
   * `limit` — quem monta a lista é o `<ResultPanel>`, que conhece o `limit` e
   * as duas ordens. Quem clipa é a cascata de `app/globals.css`, que é a única
   * que enxerga o `data-view` do `<html>`.
   */
  children: React.ReactNode;
  /** Quantidade total de candidatos — entra no rótulo do botão. */
  total: number;
  /**
   * Classe da `<ol>`. O `<ResultPanel>` passa a da lista da versão D
   * (cartões + cartão único dos demais, 2026-09-27). Ausente ⇒ a de sempre.
   */
  className?: string;
}

/** Chevron do kit (`App.jsx:16`), decorativo — o rótulo já diz o estado. */
function Chevron({ dir }: { dir: "up" | "down" }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      style={{ transform: dir === "up" ? "rotate(90deg)" : "rotate(-90deg)" }}
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function CandidateListCollapse({ children, total, className }: CandidateListCollapseProps) {
  const [aberto, setAberto] = useState(false);
  const listaId = useId();

  return (
    <>
      {/* `ATRIBUTO_LISTA`: marca esta `<ol>` para `<ReordenaListaPorBase>` mover
          as linhas no DOM quando a base ativa muda. O colapso não é afetado —
          ele clipa por `data-extra-row`, que é atributo de linha e não depende
          de posição. */}
      <ol
        className={className ?? styles.list}
        data-collapsed={aberto ? "false" : "true"}
        id={listaId}
        {...{ [ATRIBUTO_LISTA]: "" }}
      >
        {children}
      </ol>
      <Button
        aria-controls={listaId}
        aria-expanded={aberto}
        full
        onClick={() => setAberto((v) => !v)}
        // `md` (44px = `--tap-min`) e não o `sm` do kit (`App.jsx:39`, 32px):
        // este é alvo de toque primário no mobile, e o próprio `<Button>`
        // documenta que `sm` "fica ABAIXO de --tap-min: use só em densidade de
        // painel no desktop, nunca como alvo primário de toque no mobile".
        // Doze pixels a mais de altura contra a fidelidade ao kit é uma troca
        // que a constituição § 4 já decidiu.
        size="md"
        style={{ marginTop: "var(--space-2)" }}
        variant="ghost"
      >
        {aberto ? "Mostrar menos" : `Todos os ${total} candidatos`}
        <Chevron dir={aberto ? "up" : "down"} />
      </Button>
    </>
  );
}
