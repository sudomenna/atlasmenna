/**
 * components/blocks/GovernadoresPorPartido.tsx
 *
 * Como cada partido está se saindo nas 27 corridas de governador — spec 006,
 * RF-006.7 (2026-09-27, decisão do dono). Uma linha por partido:
 *
 *     PL   ███████▒▒▒▒▒▒▒▒▒▒
 *          15 · 6 eleitos + 9 no 2º turno
 *
 * Parte CHEIA = estados em que o candidato do partido fecha no 1º turno;
 * parte LISTRADA = estados em que o partido tem um dos dois candidatos do 2º
 * turno. Uma instância por base ("projecao" | "contagem"), lado a lado na
 * página, com a mesma escala fixa de 27 (ver o CSS) para serem comparáveis.
 *
 * A contagem vem de `agregarPorPartido` (`lib/utils/desfecho-governador.ts`),
 * que usa a MESMA regra de desfecho do placar, do selo e dos filtros
 * (RF-006.8). Este componente só desenha.
 *
 * ## Cor: identidade do partido, nunca posição (ADR-0024)
 *
 * `colorForParty` — a cor É a sigla. A composição do Senado
 * (`app/(sen)/senador/page.tsx`) é a referência de LAYOUT desta lista, mas
 * NÃO de cor: ela ainda pinta por posição (`--color-cand-${i + 1}`), o que o
 * ADR-0024 vetou. Barra = preenchimento com extensão ⇒ cor-base +
 * `DATA_FILL_STROKE` (RNF-035; o `<CamaraHemiciclo>` usa `textForParty`
 * porque os assentos dele são marcadores sem extensão — caso diferente).
 *
 * ## Ordem por contagem, nunca por espectro
 *
 * Total desc → eleitos desc → sigla. A lista não afirma nada sobre posição
 * política (constituição § 2).
 *
 * ## Sigla
 *
 * Desenhada com `siglaExibicao` ("REPUBLICANOS" → "REP", a coluna é estreita);
 * o leitor de tela recebe a sigla INTEIRA, como o TSE publica — a regra de
 * `lib/utils/sigla-partido.ts`.
 *
 * Server Component, zero JavaScript.
 */

import type { CSSProperties } from "react";

import styles from "@/components/blocks/GovernadoresPorPartido.module.css";
import type { EdgeUfRow } from "@/lib/edge-config/types";
import { agregarPorPartido, type BaseDesfecho } from "@/lib/utils/desfecho-governador";
import { colorForParty } from "@/lib/utils/party-color";
import { siglaExibicao } from "@/lib/utils/sigla-partido";

export interface GovernadoresPorPartidoProps {
  porUf: readonly EdgeUfRow[];
  base: BaseDesfecho;
  /** Nível do título "Por partido" — para não furar o outline da página. */
  headingLevel?: 3 | 4 | 5;
}

/** Rótulo da linha sem partido no payload. */
export const PARTIDO_NAO_INFORMADO = "Partido não informado";

const PALAVRA_ELEITOS: Record<BaseDesfecho, [string, string]> = {
  projecao: ["eleito", "eleitos"],
  contagem: ["fecharia", "fechariam"],
};

function textoDaLinha(base: BaseDesfecho, eleitos: number, turno2: number): string {
  const partes: string[] = [];
  if (eleitos > 0) {
    const [s, p] = PALAVRA_ELEITOS[base];
    partes.push(`${eleitos} ${eleitos === 1 ? s : p}`);
  }
  if (turno2 > 0) partes.push(`${turno2} no 2º turno`);
  return partes.join(" + ");
}

export function GovernadoresPorPartido({
  porUf,
  base,
  headingLevel = 4,
}: GovernadoresPorPartidoProps) {
  const Heading = `h${headingLevel}` as "h3" | "h4" | "h5";
  const linhas = agregarPorPartido(porUf, base);
  const [legendaEleitos] = PALAVRA_ELEITOS[base];

  return (
    <div className={styles.bloco} data-testid="por-partido" data-base={base}>
      <Heading className={styles.titulo}>Por partido</Heading>

      {linhas.length === 0 ? (
        <p className={styles.vazio}>
          Nenhum partido soma estado nesta leitura ainda. A lista aparece quando ao menos um estado
          tiver desfecho.
        </p>
      ) : (
        <>
          <ul className={styles.legenda} aria-hidden="true">
            <li className={styles.legendaItem}>
              <span className={`${styles.amostra} ${styles.cheio}`} />
              {legendaEleitos} no 1º turno
            </li>
            <li className={styles.legendaItem}>
              <span className={`${styles.amostra} ${styles.listrado}`} />
              no 2º turno
            </li>
          </ul>

          <ul className={styles.linhas}>
            {linhas.map((l) => {
              const total = l.eleitos + l.segundo_turno;
              const siglaInteira = l.partido ?? PARTIDO_NAO_INFORMADO;
              const siglaDesenhada = l.partido ? siglaExibicao(l.partido) : PARTIDO_NAO_INFORMADO;
              const detalhe = textoDaLinha(base, l.eleitos, l.segundo_turno);
              const varsDaLinha = {
                "--cor": colorForParty(l.partido),
                "--eleitos": l.eleitos,
                "--turno2": l.segundo_turno,
              } as CSSProperties;
              return (
                <li
                  key={l.partido ?? "__sem_partido__"}
                  className={styles.linha}
                  style={varsDaLinha}
                  data-testid="por-partido-linha"
                  data-partido={l.partido ?? ""}
                  data-eleitos={l.eleitos}
                  data-segundo-turno={l.segundo_turno}
                >
                  <span className={styles.sigla}>
                    {siglaDesenhada === siglaInteira ? (
                      siglaInteira
                    ) : (
                      <>
                        <span aria-hidden="true">{siglaDesenhada}</span>
                        <span className="sr-only">{siglaInteira}</span>
                      </>
                    )}
                  </span>
                  <span className={styles.trilha} aria-hidden="true">
                    {l.eleitos > 0 ? <span className={styles.cheio} /> : null}
                    {l.segundo_turno > 0 ? <span className={styles.listrado} /> : null}
                  </span>
                  <span className={styles.texto}>
                    <span className={styles.total}>{total}</span> · {detalhe}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className={styles.nota}>
            Cada estado que vai ao 2º turno conta dois candidatos, um para cada partido — por isso a
            soma das linhas passa do número de estados.
          </p>
        </>
      )}
    </div>
  );
}
