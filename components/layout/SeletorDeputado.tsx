/**
 * components/layout/SeletorDeputado.tsx — spec 027 (RF-283).
 *
 * O seletor "Federal · Estadual" (no DF, "Federal · Distrital") no topo das
 * telas de deputado. Decisão do dono de 29/09: o menu continua com quatro abas
 * — a de deputado passa a se chamar "Deputados" — e a escolha entre a Câmara
 * dos Deputados e a assembleia do estado acontece DENTRO da página.
 *
 * ## Destinos
 *
 *   - capa (`uf` ausente): `/deputado-federal` ↔ `/deputado-estadual` (a capa
 *     das assembleias mostra as 27 casas, o DF inclusive — não há capa
 *     distrital);
 *   - página de UF: a MESMA UF no outro cargo (`/uf/SP/deputado-federal` ↔
 *     `/uf/SP/deputado-estadual`);
 *   - DF: "Federal · Distrital" → `/uf/DF/deputado-distrital`. O DF não tem
 *     assembleia; oferecer "Estadual" ali levaria a uma casa que não existe.
 *
 * ## Forma
 *
 * Server Component, zero JavaScript: um `<nav>` nomeado com dois `<a>` crus —
 * sem `next/link`, pela mesma razão de `<UfBandeirasGrid>`: a trilha `(dep)`
 * não tem moldura de mapa a preservar, e o roteador cliente seria peso sem
 * uso. O atual leva `aria-current="page"` decidido no servidor (a página sabe
 * o próprio cargo; ao contrário do `<CargoTabs>`, que mora no layout raiz e
 * não sabe a rota). O sinal visual não é só cor: o atual vem invertido
 * (fundo escuro, texto claro) — WCAG 1.4.1. Alvo de toque `--tap-min` (44 px,
 * RNF-024), e os dois rótulos cabem lado a lado a 320 px.
 */

import type { CSSProperties } from "react";

import {
  type CargoDeputado,
  hrefDaCasa,
  rotuloCargo,
  ufTemCasa,
} from "@/lib/utils/casa-legislativa";

export interface SeletorDeputadoProps {
  /** O cargo desta página. */
  atual: CargoDeputado;
  /** Sigla da UF da página; ausente na capa. */
  uf?: string | null;
  className?: string;
}

/** "Federal", "Estadual", "Distrital" — o rótulo curto, sem "Deputado". */
function rotuloCurto(cargo: CargoDeputado): string {
  return rotuloCargo(cargo).replace(/^Deputado\s+/, "");
}

function estiloItem(atual: boolean, indice: number): CSSProperties {
  return {
    flex: 1,
    display: "grid",
    placeItems: "center",
    minHeight: "var(--tap-min)",
    padding: "0 var(--space-3)",
    borderLeft: indice > 0 ? "1px solid var(--border-strong)" : undefined,
    background: atual ? "var(--surface-inverse)" : "transparent",
    color: atual ? "var(--text-inverse)" : "var(--text-primary)",
    font: "var(--type-label)",
    fontSize: "var(--text-xs)",
    letterSpacing: "var(--tracking-caps)",
    textTransform: "uppercase",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };
}

export function SeletorDeputado({ atual, uf, className }: SeletorDeputadoProps) {
  const sigla = uf ? uf.toUpperCase() : null;
  if (sigla && !ufTemCasa(atual, sigla)) {
    // Combinação que não existe (distrital fora do DF, estadual no DF): um
    // seletor montado sobre ela apontaria para páginas que não existem.
    throw new Error(`SeletorDeputado: o cargo ${atual} não tem casa em ${sigla}`);
  }
  // O segundo item: distrital no DF, estadual em qualquer outro lugar
  // (inclusive a capa, onde as 27 casas moram juntas).
  const outro: CargoDeputado = sigla === "DF" ? 8 : 7;
  const opcoes: readonly CargoDeputado[] = [6, outro];
  // Na capa, a página das assembleias é a mesma para o 7 e o 8.
  const ehAtual = (cargo: CargoDeputado) =>
    cargo === atual || (sigla === null && cargo === 7 && atual === 8);

  return (
    <nav
      aria-label={`Deputado federal ou ${rotuloCurto(outro).toLowerCase()}`}
      // `w-full` e não `width: "100%"` inline: a capa sem payload é travada
      // por um teste que proíbe QUALQUER "%" no HTML (fase-pre-eleicao, o
      // percentual que ninguém mediu) — e um estilo inline conta.
      className={["flex w-full overflow-hidden rounded-sm", className].filter(Boolean).join(" ")}
      data-testid="seletor-deputado"
      style={{
        maxWidth: "24rem",
        border: "1px solid var(--border-strong)",
        background: "var(--surface-card)",
      }}
    >
      {opcoes.map((cargo, indice) => {
        const eAtual = ehAtual(cargo);
        return (
          <a
            aria-current={eAtual ? "page" : undefined}
            data-cargo={cargo}
            data-testid="seletor-deputado-item"
            href={hrefDaCasa(cargo, sigla)}
            key={cargo}
            style={estiloItem(eAtual, indice)}
          >
            {rotuloCurto(cargo)}
          </a>
        );
      })}
    </nav>
  );
}
