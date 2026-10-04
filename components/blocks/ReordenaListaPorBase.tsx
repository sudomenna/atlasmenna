"use client";

/**
 * components/blocks/ReordenaListaPorBase.tsx
 *
 * Reordena, **no DOM**, as linhas da lista de candidatos quando o leitor troca
 * a base ativa no controle "Parcial / Projeção".
 *
 * ## Por que isto existe
 *
 * Até 2026-09-20 a reordenação era só de PINTURA: `app/globals.css` aplicava
 * `order: var(--ord-<base>)` e o documento continuava na ordem da Projeção.
 * `order` move pixel, não move documento — então leitor de tela, navegação por
 * teclado, `Ctrl+F` e **copiar-colar** recebiam a lista na ordem antiga, com a
 * numeração da base nova. Ouvia-se "3º, 1º, 2º".
 *
 * É WCAG **SC 1.3.2 (Meaningful Sequence), nível A**. Estava registrado como
 * não-conformidade aceita em `docs/nfr/accessibility.md` e como dívida 17 em
 * `docs/reference/dividas-tecnicas.md`. Este componente a resolve.
 *
 * ## Por que NÃO custa bundle de payload
 *
 * O dado para reordenar **já está no DOM**: cada `<li>` carrega
 * `--ord-parcial` e `--ord-proj` como custom properties inline
 * (`ResultPanel.tsx`), que é o que as regras de `order` liam. Este módulo lê os
 * mesmos números. Não recebe candidato, não recebe payload, não arrasta
 * `<CandidateResultRow>` nem `<PartyTag>` para o cliente — que é o custo que
 * o ADR-0025 / RNF-007a barraram quando a alternativa considerada foi
 * "transformar o painel em Client Component".
 *
 * A outra alternativa medida — emitir as DUAS listas e esconder uma — custava
 * **+312 nós e ~42 KB** acima da dobra em toda visita, inclusive nas noites em
 * que as duas ordens coincidem. Ver o bloco "Por que `order` e não duas
 * listas" em `app/globals.css`, que preserva a conta.
 *
 * ## 🔴 Por que reordenar o DOM à mão não briga com o React
 *
 * Medido em 2026-09-20 com o React 19 deste projeto, três cenários: re-render
 * do wrapper cliente (`<CandidateListCollapse>`, que tem `useState`), dois
 * re-renders seguidos, e re-render do PAI com a mesma vdom. **A ordem
 * imperativa sobreviveu aos três.**
 *
 * A razão é estrutural, não sorte: o React só toca na ordem do DOM quando a
 * ordem da **vdom dele** muda. Aqui ela nunca muda — `<ResultPanel>` e
 * `<CandidateResultRow>` são Server Components, e o polling de
 * `<PersistentMapFrame>` não alcança este painel. As linhas chegam a
 * `<CandidateListCollapse>` por `children`, já renderizadas pelo servidor.
 *
 * ⚠️ **A invariante de que isso dependia**: a lista é emitida pelo servidor
 * numa ordem fixa e nunca re-renderizada com ordem diferente.
 *
 * 🔴 **Deixou de valer em 04/10/2026** com `<AtualizacaoAutomatica>`
 * (`router.refresh()` a cada minuto): o servidor reemite o painel com dado
 * novo, e a ordem da Projeção pode mudar entre dois refreshes. O React então
 * MOVE nós — calculando a posição a partir da vdom dele, que não sabe da
 * reordenação imperativa —, e a lista pode sair do refresh na ordem da
 * Projeção, ou numa mistura, com a base "Parcial" ativa. Com o efeito preso a
 * `[base]`, nada a consertava até o leitor trocar de base.
 *
 * Daí o efeito SEM array de dependências: roda depois de todo commit em que
 * este componente renderiza — e ele renderiza a cada refresh, porque o
 * servidor o reemite como elemento novo (props novas; não há `memo`). Como o
 * efeito de layout roda depois de TODAS as mutações do commit, ele enxerga o
 * DOM já reconciliado e recoloca a ordem da base ativa antes da pintura. O
 * custo é `reordenarLista`, que é idempotente e sai sem tocar no DOM quando a
 * ordem já está certa (uma ordenação de algumas dezenas de `<li>` por lista,
 * uma vez por minuto).
 *
 * ## 🔴 O foco do teclado PRECISA ser devolvido
 *
 * Medido no Chrome em 2026-09-20: mover o `<li>` que contém o elemento focado
 * joga `document.activeElement` para o `<body>`. Quem estava navegando por
 * teclado perde o lugar no meio da lista.
 *
 * Daí o par guardar/devolver com `preventScroll: true` — sem a flag, devolver
 * o foco rola a página até o elemento, e trocar de base daria um salto de
 * rolagem que ninguém pediu.
 *
 * ## 🔴 O contrato mora em outro arquivo, e o motivo é uma armadilha do RSC
 *
 * `ATRIBUTO_LISTA` e `reordenarLista` vivem em `_lista-por-base.ts`, **sem
 * diretiva**. Estavam aqui na primeira versão, e `<ResultPanel>` (Server
 * Component) importava a constante deste módulo `"use client"` — o Next
 * converteu a STRING numa referência de cliente, o servidor recebeu um stub
 * que lança, e o stub virou o nome do atributo da `<ol>`. Três erros no
 * navegador e a lista sem reordenar. Ver o docblock daquele arquivo.
 *
 * O re-export abaixo existe só para não quebrar quem já importava daqui.
 */

import { useEffect, useLayoutEffect } from "react";
import { ATRIBUTO_LISTA, reordenarLista } from "@/components/blocks/_lista-por-base";
import { useViewMode } from "@/lib/state/view-mode-client";

/**
 * 🔴 `useLayoutEffect`, e não `useEffect` — a diferença é um QUADRO visível.
 *
 * `setViewMode` (`lib/state/view-mode-client.ts:78-86`) escreve `data-view` no
 * `<html>` **de forma síncrona**, antes de notificar os assinantes. Ou seja,
 * tudo que é cascata — a ênfase dos dois números, a cor, o badge de vaga, o
 * corte do colapso — troca no instante do clique. A reordenação, se ficasse
 * num efeito PASSIVO, poderia só acontecer depois da pintura: um quadro em que
 * os números já são da base nova e a ORDEM ainda é da antiga.
 *
 * É o defeito original em miniatura (ordem discordando do resto), com ~16ms de
 * duração em vez de uma sessão inteira. `useLayoutEffect` roda antes da
 * pintura, então as duas coisas chegam ao olho no mesmo quadro.
 *
 * Achado pelo `a11y-perf-auditor` no portão de 2026-09-20, que classificou
 * como polimento; medi a causa (a escrita síncrona do atributo) e concordei
 * que vale.
 *
 * O ramo para `useEffect` no servidor é o padrão isomórfico de sempre:
 * `useLayoutEffect` avisa em SSR. Este componente renderiza `null` e o efeito
 * é só de cliente, então o ramo não produz diferença de marcação — não há
 * risco de divergência de hidratação.
 */
const useEfeitoDeLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

export { ATRIBUTO_LISTA, reordenarLista };

/**
 * Componente sem marcação. Montado por `<ResultPanel>`, reordena **todas** as
 * listas marcadas do documento a cada troca de base e a cada refresh do
 * servidor.
 *
 * Reordenar todas, e não só "a sua", é deliberado: uma instância não tem
 * referência ao `<ol>` irmão (as linhas atravessam a fronteira servidor →
 * cliente por `children`, e o `<ol>` do colapso gera o próprio `id` com
 * `useId`). Como `reordenarLista` é idempotente, duas instâncias na mesma
 * página fazem o trabalho uma vez e a outra sai no `every` acima.
 */
export function ReordenaListaPorBase() {
  const base = useViewMode();

  // Sem array de dependências DE PROPÓSITO — ver "Deixou de valer em
  // 04/10/2026" no topo. `base` muda → o componente renderiza → o efeito roda;
  // refresh do servidor → o componente renderiza → o efeito roda.
  useEfeitoDeLayout(() => {
    for (const lista of document.querySelectorAll<HTMLElement>(`[${ATRIBUTO_LISTA}]`)) {
      reordenarLista(lista, base);
    }
  });

  return null;
}
