"use client";

/**
 * components/atoms/controls/EtiquetaFiltro.tsx — o filtro por etiqueta
 * editorial das capas `/governador` e `/senador` (spec 025, RF-247; V5).
 *
 * ## Esconde corridas inteiras, NUNCA reordena
 *
 * O componente só escreve no PRÓPRIO invólucro: o atributo `data-filtro` e,
 * com um filtro escolhido, UMA regra de CSS num `<style>` filho
 * ({@link regraDoFiltro}). Quem esconde é essa regra: todo elemento da mesma
 * `<main>` com `data-etq` que NÃO contém o token some (`display: none`),
 * inteiro. A ordem do DOM não é tocada — nem aqui, nem no servidor
 * (constituição § 2 (e)). Cada cartão de corrida carrega em `data-etq` os
 * tokens dos candidatos COM CHANCE (`lib/etiquetas/telas.ts`).
 *
 * ## Por que a regra nasce aqui e não na folha de estilo (29/09)
 *
 * Até 29/09 havia UMA regra por token do catálogo no CSS module — 20 regras
 * com `:has()`, 6,9 KB crus, numa folha que bloqueia a renderização de TODA
 * rota, com o filtro desligado inclusive (auditoria de a11y/perf, B1). A regra
 * agora é montada para o token escolhido, só quando alguém escolhe: zero byte
 * de CSS de filtro no carregamento, e um valor novo no catálogo não pode mais
 * ficar "sem regra" (o filtro que não filtra).
 *
 * ## Sem JavaScript, tudo aparece
 *
 * O `<select>` sai no HTML do servidor, mas sem JS ninguém escreve
 * `data-filtro` nem a regra — a página fica exatamente como sem o filtro.
 * Navegador sem `:has()` idem.
 *
 * ## O que ele NÃO faz
 *
 *   - não mexe no filtro de status de `/governador` (links GET, servidor): os
 *     dois se somam — o de status tira cartões do HTML, este esconde os que
 *     sobram;
 *   - não recalcula o consolidado da região (ADR-0057): em `/governador` a
 *     região fica, com o consolidado somando todos os estados dela; em
 *     `/senador` (`esconderRegiaoVazia`) a região sem nenhuma corrida no
 *     filtro some inteira.
 *
 * A contagem é anunciada em `aria-live` e escrita na tela.
 */

import { useEffect, useId, useRef, useState } from "react";

import type { GrupoFiltro } from "@/lib/etiquetas/telas";

import styles from "./EtiquetaFiltro.module.css";

/**
 * Forma de um token do catálogo (`categoria:valor`, `lib/etiquetas/telas.ts`).
 * Os ids do catálogo são `[a-z0-9_]`; qualquer outra coisa não vira CSS.
 */
const TOKEN_VALIDO = /^[a-z_]+:[a-z0-9_]+$/;

/**
 * A ÚNICA regra do filtro, para o token escolhido — ou `null` para token fora
 * da forma do catálogo (nada é interpolado em CSS sem passar por aqui).
 *
 * Só `display: none`: esconde a corrida inteira (`[data-etq]` sem o token) e,
 * com `esconderRegiao`, a região (`[data-regiao]`) sem nenhuma corrida com ele.
 * Escopo: a `<main>` que contém ESTE filtro (`[data-filtro]` só existe aqui).
 */
export function regraDoFiltro(tokenEscolhido: string, esconderRegiao: boolean): string | null {
  if (!TOKEN_VALIDO.test(tokenEscolhido)) return null;
  const t = tokenEscolhido;
  const escopo = `main:has([data-filtro="${t}"])`;
  const seletores = [`${escopo} [data-etq]:not([data-etq~="${t}"])`];
  if (esconderRegiao) seletores.push(`${escopo} [data-regiao]:not(:has([data-etq~="${t}"]))`);
  return `${seletores.join(",")}{display:none}`;
}

export interface EtiquetaFiltroProps {
  /** As opções, já só as que aparecem na página (`opcoesDoFiltro`). */
  grupos: readonly GrupoFiltro[];
  /** `/senador`: região sem corrida no filtro some inteira. */
  esconderRegiaoVazia?: boolean;
}

export function EtiquetaFiltro({ grupos, esconderRegiaoVazia = false }: EtiquetaFiltroProps) {
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const [filtro, setFiltro] = useState("");
  const [contagem, setContagem] = useState<number | null>(null);

  const rotulo = (() => {
    for (const g of grupos) {
      const o = g.opcoes.find((x) => x.token === filtro);
      if (o) return `${g.rotulo}: ${o.rotulo.toLocaleLowerCase("pt-BR")}`;
    }
    return null;
  })();
  const regra = filtro ? regraDoFiltro(filtro, esconderRegiaoVazia) : null;

  useEffect(() => {
    if (!filtro) {
      setContagem(null);
      return;
    }
    const escopo = raiz.current?.closest("main") ?? document;
    let n = 0;
    for (const el of escopo.querySelectorAll("[data-etq]")) {
      if ((el.getAttribute("data-etq") ?? "").split(" ").includes(filtro)) n++;
    }
    setContagem(n);
  }, [filtro]);

  if (grupos.length === 0) return null;

  return (
    <div
      ref={raiz}
      className={styles.filtro}
      data-filtro={filtro}
      data-regioes={esconderRegiaoVazia ? "esconder" : undefined}
      data-testid="etiqueta-filtro"
    >
      {regra ? <style data-testid="etiqueta-filtro-regra">{regra}</style> : null}
      <label htmlFor={id} className={styles.rotulo}>
        Filtrar corridas por etiqueta editorial
      </label>
      <select
        id={id}
        className={styles.select}
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
      >
        <option value="">Todas as corridas</option>
        {grupos.map((g) => (
          <optgroup key={g.categoria} label={g.rotulo}>
            {g.opcoes.map((o) => (
              <option key={o.token} value={o.token}>
                {o.rotulo}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {/* Sempre na árvore de acessibilidade: região viva que só nasce junto com
          o primeiro texto não é anunciada de forma confiável (M3, 29/09). */}
      <p className={styles.contagem} aria-live="polite" role="status">
        {filtro && contagem !== null && rotulo
          ? `${contagem} ${contagem === 1 ? "corrida" : "corridas"} com ${rotulo}. As demais estão escondidas, na mesma ordem.`
          : ""}
      </p>
    </div>
  );
}
