"use client";

/**
 * components/blocks/RegiaoRecolhivel.tsx
 *
 * O ÚNICO pedaço de cliente do agrupamento por região (ADR-0057 item 2): o
 * botão que abre e fecha os cartões de uma região e mantém o `aria-expanded`
 * honesto. Tudo o que ele mostra chega pronto do servidor — o `resumo` (o
 * consolidado da região, nas duas bases) e os `children` (os cartões dos
 * estados) são Server Components, e o payload fica fora do bundle
 * (RNF-007a). O que vai para o cliente é este arquivo.
 *
 * ## Fechar só recolhe a ALTURA
 *
 * ADR-0017 / ADR-0034 D21: nenhum cartão sai do DOM, da árvore de
 * acessibilidade ou da busca da página (Ctrl+F) em estado nenhum. Este
 * componente só escreve `data-fechado` no corpo; quem recolhe é
 * `RegiaoConsolidada.module.css` (`height: 0; overflow: hidden`, nunca
 * `display: none`). Enquanto o foco de teclado estiver DENTRO de um corpo
 * fechado (os cartões são links), a regra não vale e o corpo reabre — senão
 * o Tab andaria por links invisíveis.
 *
 * ## Por que o botão fica DENTRO do título, e não o cabeçalho inteiro dentro do botão
 *
 * O protótipo (versão C) fazia do cabeçalho inteiro um `<button>` — título,
 * líder, barra e legenda. Um `<h3>` dentro de `<button>` é HTML inválido
 * (botão só aceita conteúdo de frase), e o nome acessível do botão viraria a
 * legenda inteira lida de uma vez. Aqui é o padrão de acordeão da WAI-ARIA
 * APG: `<hN><button aria-expanded aria-controls>Norte, 7 estados</button></hN>`,
 * com o resumo logo abaixo, como texto comum. O cabeçalho inteiro continua
 * clicável: o `::after` do botão se estende sobre ele (CSS).
 *
 * Aberta por padrão (decisão do dono).
 */

import { type ReactNode, useId, useState } from "react";

import styles from "./RegiaoConsolidada.module.css";

export interface RegiaoRecolhivelProps {
  /** Nome da região ("Norte"). */
  nome: string;
  /** "7 estados". Entra no nome acessível do botão. */
  contagem: string;
  /** Nível do título — não furar o outline da página. */
  nivel: 2 | 3;
  /** Default `true` (regiões abertas ao carregar — decisão do dono). */
  abertaInicial?: boolean;
  /** O consolidado da região, já renderizado no servidor. */
  resumo: ReactNode;
  /** Os cartões dos estados, já renderizados no servidor. */
  children: ReactNode;
  /** `data-regiao` — âncora de teste e de estilo. */
  regiaoId: string;
}

export function RegiaoRecolhivel({
  nome,
  contagem,
  nivel,
  abertaInicial = true,
  resumo,
  children,
  regiaoId,
}: RegiaoRecolhivelProps) {
  const [aberta, setAberta] = useState(abertaInicial);
  const corpoId = useId();
  const Titulo = `h${nivel}` as "h2" | "h3";

  return (
    <section className={styles.regiao} data-regiao={regiaoId}>
      <div className={styles.cabecalho}>
        <Titulo className={styles.titulo}>
          <button
            type="button"
            className={styles.botao}
            aria-expanded={aberta}
            aria-controls={corpoId}
            onClick={() => setAberta((v) => !v)}
          >
            <span className={styles.nome}>{nome}</span>
            <span className={styles.seta}>
              <span className="sr-only">, </span>
              {contagem}
              <span aria-hidden="true"> · {aberta ? "fechar ▴" : "abrir ▾"}</span>
            </span>
          </button>
        </Titulo>
        {resumo}
      </div>
      <div
        id={corpoId}
        className={styles.corpo}
        data-fechado={aberta ? "false" : "true"}
        data-testid="regiao-corpo"
      >
        {children}
      </div>
    </section>
  );
}
