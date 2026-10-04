"use client";

/**
 * components/atoms/charts/SerieBaseAlternavel.tsx
 *
 * Spec 020, RF-172 (emenda de 2026-10-04) — a chave "Apuração | Projeção" que
 * o gráfico da evolução da apuração ganhou por pedido do dono.
 *
 * ## Independente do seletor do topo — decisão do dono, 04/10
 *
 * Até 04/10 o gráfico não tinha controle próprio: obedecia ao
 * `<ViewModeSwitch>` do shell pela cascata `data-view-only`. O dono pediu um
 * seletor DENTRO do gráfico e decidiu que ele só muda o gráfico — o leitor
 * pode ter o placar em Parcial e o gráfico em Projeção ao mesmo tempo. Por
 * isso o estado é local (`useState`) e o atributo é outro (`data-serie-base` /
 * `data-serie-only`), que a cascata do shell não alcança.
 *
 * Abre em **Apuração**: o painel se chama "Evolução da apuração", e o pedido
 * foi "também ver a projeção".
 *
 * ## O que este componente NÃO faz
 *
 * Não desenha nada do gráfico. O `<svg>` chega pronto do servidor como
 * `children` (Server Component dentro de Client Component), com as duas bases
 * sempre no DOM; aqui só se troca uma string num atributo, e o CSS do módulo
 * decide qual grupo aparece. A régua vertical é a mesma nas duas bases
 * (RF-172d), então alternar nunca move uma linha por mudança de escala.
 *
 * ## Acessibilidade
 *
 * Mesmo padrão da chave "Ordenar por" do RF-295
 * (`components/blocks/StrongholdsPanel.tsx`): `<fieldset>` com `<legend>` só
 * para leitor de tela e `<button aria-pressed>` com `aria-controls` apontando
 * para o invólucro que muda. A tabela `sr-only` do gráfico (RF-176) continua
 * com as duas bases — para quem não enxerga o traço, nada fica escondido.
 */

import { type ReactNode, useId, useState } from "react";

import styles from "./SerieBaseAlternavel.module.css";

export type SerieBase = "parcial" | "proj";

/** A base com que o gráfico abre. Exportada para o teste não repetir o literal. */
export const SERIE_BASE_INICIAL: SerieBase = "parcial";

const OPCOES: ReadonlyArray<{ valor: SerieBase; rotulo: string }> = [
  { valor: "parcial", rotulo: "Apuração" },
  { valor: "proj", rotulo: "Projeção" },
];

export interface SerieBaseAlternavelProps {
  children: ReactNode;
}

export function SerieBaseAlternavel({ children }: SerieBaseAlternavelProps) {
  const [base, setBase] = useState<SerieBase>(SERIE_BASE_INICIAL);
  const alvoId = useId();

  return (
    <>
      <fieldset data-testid="serie-base-chave" className={styles.chave}>
        <legend className="sr-only">Linhas do gráfico</legend>
        <span className={styles.segmentos}>
          {OPCOES.map(({ valor, rotulo }) => {
            const ativo = valor === base;
            return (
              <button
                key={valor}
                type="button"
                data-testid="serie-base-botao"
                data-base={valor}
                aria-pressed={ativo}
                aria-controls={alvoId}
                className={[styles.segmento, ativo ? styles.segmentoOn : null]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setBase(valor)}
              >
                {rotulo}
              </button>
            );
          })}
        </span>
      </fieldset>
      <div id={alvoId} data-serie-base={base} className={styles.raiz}>
        {children}
      </div>
    </>
  );
}
