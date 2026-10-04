/**
 * components/blocks/RealceHemiciclo.tsx — invólucro que liga o realce por
 * grupo de um plenário à legenda dele (spec 008, RF-294).
 *
 * Ponteiro sobre uma cadeira ou sobre a linha da legenda: as cadeiras e linhas
 * dos outros grupos esmaecem, a do grupo apontado fica. Copiado do
 * globalelectionsimulator (`/brazil-senate`, `/brazil-legislative`), sem
 * balão.
 *
 * ## Server Component, zero JavaScript
 *
 * Os plenários não têm script (ADR-0049, ADR-0061, spec 017, spec 023), e o
 * realce não muda isso: é CSS com `:has()`. Metade estática no módulo, metade
 * por chave num `<style>` emitido aqui — ver `lib/utils/realce-hemiciclo.ts`.
 *
 * O `<style>` vai sem `precedence`/`href`: assim o React 19 o renderiza NO
 * LUGAR, sem içar para o `<head>`. O texto vai como filho (o precedente é
 * `SeloFasePreStyle.tsx`), e o React escreve filho de `<style>` como texto
 * cru, sem escape HTML — medido em `RealceHemiciclo.test.tsx`. Por isso o
 * escape dos valores é feito antes, em `cssDoRealce` (nenhum `<` sai dali).
 *
 * Quem envolve garante que as cadeiras (`<g data-estado>`) e as linhas da
 * legenda (`<li>`) com `atributo` estão DENTRO deste invólucro, e que `chaves`
 * cobre todos os valores desse atributo — chave sem regra apaga tudo ao ser
 * apontada (o teste `RealceHemiciclo.test.tsx` trava isso por casa).
 *
 * A11y: só opacidade e fundo, transitórios, e só com ponteiro. Nada some,
 * nada muda de texto; o equivalente textual de cada plenário é o mesmo.
 */

import type { CSSProperties, ReactNode } from "react";

import {
  ATRIBUTO_RAIZ_REALCE,
  type AtributoRealce,
  cssDoRealce,
} from "@/lib/utils/realce-hemiciclo";

import styles from "./RealceHemiciclo.module.css";

export interface RealceHemicicloProps {
  /** Valor de `data-realce-raiz` — único na página. */
  raiz: string;
  atributo: AtributoRealce;
  chaves: readonly string[];
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /**
   * Atributos `data-*` do invólucro — para um bloco que usa o próprio
   * contêiner como invólucro (`<HemicicloPorBloco>`) não ganhar um `<div>` a
   * mais.
   */
  [dado: `data-${string}`]: string | number | undefined;
}

export function RealceHemiciclo({
  raiz,
  atributo,
  chaves,
  children,
  className,
  style,
  ...dados
}: RealceHemicicloProps) {
  const css = cssDoRealce({ raiz, atributo, chaves });
  return (
    <div
      {...dados}
      {...{ [ATRIBUTO_RAIZ_REALCE]: raiz }}
      className={className ? `${styles.raiz} ${className}` : styles.raiz}
      style={style}
    >
      {css ? <style>{css}</style> : null}
      {children}
    </div>
  );
}
