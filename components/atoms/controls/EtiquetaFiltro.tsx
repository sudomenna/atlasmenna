"use client";

/**
 * components/atoms/controls/EtiquetaFiltro.tsx — o filtro por etiqueta
 * editorial das capas `/governador` e `/senador` (spec 025, RF-247; V5).
 *
 * ## Esconde corridas inteiras, NUNCA reordena
 *
 * O componente só escreve `data-filtro` no PRÓPRIO invólucro. Quem esconde é a
 * cascata de `EtiquetaFiltro.module.css`: com `data-filtro="categoria:valor"`,
 * todo elemento da mesma página com `data-etq` que NÃO contém esse token some
 * (`display: none`), inteiro. A ordem do DOM não é tocada — nem aqui, nem no
 * servidor (constituição § 2 (e)). Cada cartão de corrida carrega em
 * `data-etq` os tokens dos candidatos COM CHANCE (`lib/etiquetas/telas.ts`).
 *
 * ## Sem JavaScript, tudo aparece
 *
 * O `<select>` sai no HTML do servidor, mas sem JS ninguém escreve
 * `data-filtro` — e sem `data-filtro` nenhuma regra casa. A página fica
 * exatamente como sem o filtro. Navegador sem `:has()` idem.
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
      <p className={styles.contagem} aria-live="polite" role="status">
        {filtro && contagem !== null && rotulo
          ? `${contagem} ${contagem === 1 ? "corrida" : "corridas"} com ${rotulo}. As demais estão escondidas, na mesma ordem.`
          : ""}
      </p>
    </div>
  );
}
