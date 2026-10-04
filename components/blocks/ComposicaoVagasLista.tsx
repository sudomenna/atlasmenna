/**
 * components/blocks/ComposicaoVagasLista.tsx — spec 016, RF-107 + RF-301.
 *
 * A fileira de partidos de "As 54 vagas em disputa" (capa `/senador`), usada
 * nas duas bases da chave "Parcial / Projeção". Até 04/10/2026 era um `<ul>`
 * escrito duas vezes à mão em `page.tsx`, só com "N PARTIDO".
 *
 * ## RF-301 — cada partido abre e mostra quem ocupa as vagas
 *
 * Decisão do dono (04/10/2026): "para o usuário poder enxergar todos os
 * senadores eleitos". Cada partido vira um `<details>` nativo — zero
 * JavaScript, teclado e leitor de tela de graça — com UF e nome de cada vaga,
 * por sigla de UF (`lib/utils/senado-nomes-das-vagas.ts`). A linha
 * "aguardando apuração" abre do mesmo jeito e lista as UFs que faltam.
 *
 * ⚠️ **ADR-0017 não se aplica aqui, e por quê.** Ele proíbe `<details>` nas
 * listas de CANDIDATOS de uma corrida (Camadas 1–3) para que nenhuma
 * candidatura saia da tela. Esta lista não é a de uma corrida: é um índice,
 * por partido, de nomes que já estão visíveis — fora de qualquer recolhido —
 * nos 27 cartões "Estado a estado" da mesma página. Fechar um `<details>`
 * aqui não esconde ninguém que a página não mostre logo abaixo. O mesmo
 * raciocínio já sustenta o `<details>` do `SenadoDe2027Panel`.
 *
 * ## Quando um partido NÃO abre
 *
 * `nomes === null` ⇒ a pílula sai como antes, sem `<details>`: a derivação não
 * fechou com a contagem publicada (falha fechada, RF-217) ou os nomes não são
 * exatamente tantos quantos a linha conta. Um número sem nomes é verdadeiro;
 * nomes que não somam o número, não.
 *
 * ## Selo e ressalvas
 *
 * O selo da base (`VAGA_LABEL`, `lib/utils/selo-resultado.ts` — o mesmo texto
 * do `<VagaBadge>` e do `<ResultPanel>`) sai UMA vez por partido, no topo do
 * que abre, com "não oficial"; cada nome leva só a ressalva que foge dele
 * (UF com a apuração concluída; na Projeção, UF sem voto apurado). Nunca
 * "eleito" (constituição § 1, RF-218).
 *
 * Server Component puro.
 */

import type { NomeDaVaga, RessalvaDaVaga } from "@/lib/utils/senado-nomes-das-vagas";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

import styles from "./ComposicaoVagasLista.module.css";

export interface LinhaComposicao {
  /** Sigla inteira, como no payload (a tela abrevia; ver `siglaExibicao`). */
  partido: string;
  vagas: number;
  /** Os nomes na ordem de UF, ou `null` quando a linha não abre. */
  nomes: readonly NomeDaVaga[] | null;
}

export interface ComposicaoVagasListaProps {
  linhas: readonly LinhaComposicao[];
  /** Vagas sem dono nesta base. `0` ⇒ sem a linha "aguardando apuração". */
  aguardando: number;
  /** UFs com vaga sem dono, ou `null` quando a linha não abre. */
  ufsAguardando: readonly string[] | null;
  /** O selo da base, escrito no topo de cada partido aberto. */
  selo: string;
  testId: string;
  testIdAguardando: string;
}

/** O que cada ressalva diz, depois do nome. */
export const TEXTO_RESSALVA: Record<RessalvaDaVaga, string> = {
  concluida: "apuração concluída",
  sem_apuracao: "sem voto apurado",
};

/** Uma linha de nome, num nó de texto só (o payload RSC não ganha elemento por parte). */
export function textoDaVaga(v: NomeDaVaga): string {
  return `${v.uf} · ${v.nome}${v.ressalva ? ` · ${TEXTO_RESSALVA[v.ressalva]}` : ""}`;
}

export function ComposicaoVagasLista({
  linhas,
  aguardando,
  ufsAguardando,
  selo,
  testId,
  testIdAguardando,
}: ComposicaoVagasListaProps) {
  return (
    <ul className={styles.l} data-testid={testId}>
      {linhas.map((p) => (
        <li key={p.partido}>
          {p.nomes ? (
            <details>
              {/* O nome acessível começa pelo texto VISÍVEL ("9 PL" — WCAG
                  2.5.3) e diz o que abre. A sigla vista é abreviada; a dita,
                  inteira (regra de `lib/utils/sigla-partido.ts`). */}
              <summary>
                <b>{p.vagas}</b> <span>{siglaExibicao(p.partido)}</span>
                <span className="sr-only">
                  {`, ${p.partido === siglaExibicao(p.partido) ? "" : `${p.partido}, `}ver ${
                    p.vagas === 1 ? "o nome" : "os nomes"
                  }`}
                </span>
              </summary>
              <p>{selo} · não oficial</p>
              <ol>
                {p.nomes.map((v, i) => (
                  // Índice como chave: a lista é derivada inteira a cada
                  // render, nunca reordenada no cliente.
                  // biome-ignore lint/suspicious/noArrayIndexKey: lista estática do servidor
                  <li key={i}>{textoDaVaga(v)}</li>
                ))}
              </ol>
            </details>
          ) : (
            <>
              <b>{p.vagas}</b> <span>{siglaExibicao(p.partido)}</span>
            </>
          )}
        </li>
      ))}
      {aguardando > 0 ? (
        <li data-ag="" data-testid={testIdAguardando}>
          {ufsAguardando && ufsAguardando.length > 0 ? (
            <details>
              <summary>
                <b>{aguardando}</b> <span>aguardando apuração</span>
                <span className="sr-only">
                  {`, ver ${ufsAguardando.length === 1 ? "o estado" : "os estados"}`}
                </span>
              </summary>
              <p>{ufsAguardando.join(", ")}</p>
            </details>
          ) : (
            <>
              <b>{aguardando}</b> <span>aguardando apuração</span>
            </>
          )}
        </li>
      ) : null}
    </ul>
  );
}
