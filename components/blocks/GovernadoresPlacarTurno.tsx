/**
 * components/blocks/GovernadoresPlacarTurno.tsx
 *
 * Quantos estados fecham a eleição de governador no 1º turno, quantos vão ao
 * 2º, e quais — spec 006, RF-006.6 (2026-09-27, decisão do dono).
 *
 * Uma instância por BASE, e a página põe as duas lado a lado:
 *   - `base="projecao"` — "Pela projeção": como o estado deve terminar;
 *   - `base="contagem"` — "Se a apuração parasse agora": só o já apurado.
 * Elas podem discordar na mesma noite, e é para isso que existem juntas.
 *
 * A regra de desfecho NÃO mora aqui: é `lib/utils/desfecho-governador.ts`,
 * a mesma que o selo do `<GovernorCard>` e os filtros de `/governador` usam
 * (RF-006.8). Este componente só desenha.
 *
 * ## Server Component, zero JavaScript
 *
 * Sem estado, sem evento — o precedente de `CamaraHemiciclo.tsx` e
 * `UfLinksGrid.tsx`. Estilo por classe (`GovernadoresPlacarTurno.module.css`),
 * não por `style` repetido nas 27 células.
 *
 * ## Vocabulário
 *
 * Na base "contagem" nada é "eleito": o rótulo é condicional ("fechariam no
 * 1º turno") e a nota diz que é um retrato do que já foi contado. Na base
 * "projeção" o rótulo é o que o dono pediu ("eleitos no 1º turno") sob o
 * título "Pela projeção" e o kicker não-oficial do painel.
 *
 * ## Sem número fabricado
 *
 * Se nenhuma das 27 UFs tem desfecho na base (tudo "aguardando"), o placar
 * não imprime "0 eleitos · 0 no 2º turno": diz em texto que ainda não há
 * estado com votos apurados (decisão do dono de 14/09 — nunca um zero de
 * resgate). Com ao menos uma UF classificada, os quatro grupos aparecem com
 * o número de cada um, e zero ali É medição.
 *
 * ## A11y
 *
 * - A faixa de 27 células é `aria-hidden`: redundante com os números e as
 *   listas, que são texto.
 * - Cada sigla tem o nome do estado por extenso para o leitor de tela (a
 *   sigla visível fica `aria-hidden`) e no `title` para o mouse.
 * - O quadradinho de cor ao lado de cada rótulo é legenda, não informação
 *   única: o rótulo diz o grupo em palavras (WCAG 1.4.1).
 */

import styles from "@/components/blocks/GovernadoresPlacarTurno.module.css";
import type { EdgeUfRow } from "@/lib/edge-config/types";
import {
  agruparPorDesfecho,
  type BaseDesfecho,
  type DesfechoGovernador,
  ORDEM_DESFECHOS,
  SIGLAS_UF,
} from "@/lib/utils/desfecho-governador";

export interface GovernadoresPlacarTurnoProps {
  porUf: readonly EdgeUfRow[];
  base: BaseDesfecho;
}

/** Rótulos por base. A contagem fala no condicional — nunca "eleito". */
const ROTULOS: Record<BaseDesfecho, Record<DesfechoGovernador, [string, string]>> = {
  projecao: {
    eleito_1t: ["vence no 1º turno", "vencem no 1º turno"],
    segundo_turno: ["vai ao 2º turno", "vão ao 2º turno"],
    em_aberto: ["em aberto", "em aberto"],
    aguardando: ["aguardando apuração", "aguardando apuração"],
  },
  contagem: {
    eleito_1t: ["fecharia no 1º turno", "fechariam no 1º turno"],
    segundo_turno: ["iria ao 2º turno", "iriam ao 2º turno"],
    em_aberto: ["em aberto", "em aberto"],
    aguardando: ["aguardando apuração", "aguardando apuração"],
  },
};

const NOTAS: Record<BaseDesfecho, string> = {
  projecao:
    "Pela projeção do modelo: fecha no 1º turno quem deve terminar com mais da metade dos votos. Não oficial.",
  contagem:
    "Retrato do que já foi contado, não resultado nem projeção: fecharia no 1º turno o estado cujo líder tem hoje mais de 50% dos votos apurados.",
};

function rotulo(base: BaseDesfecho, desfecho: DesfechoGovernador, n: number): string {
  const [singular, plural] = ROTULOS[base][desfecho];
  return n === 1 ? singular : plural;
}

export function GovernadoresPlacarTurno({ porUf, base }: GovernadoresPlacarTurnoProps) {
  const grupos = agruparPorDesfecho(porUf, base);
  const classificadas = SIGLAS_UF.length - grupos.aguardando.length;

  if (classificadas <= 0) {
    return (
      <div className={styles.placar} data-testid="placar-turno" data-base={base} data-vazio="">
        <p className={styles.nota}>
          Nenhum estado tem votos apurados para governador ainda. O placar aparece aqui quando a
          contagem começar.
        </p>
      </div>
    );
  }

  // Na contagem `em_aberto` é impossível por construção (ver o módulo da
  // regra); o grupo não é desenhado ali para não prometer um estado que a
  // base não tem.
  const desfechos = ORDEM_DESFECHOS.filter((d) => base === "projecao" || d !== "em_aberto");

  return (
    <div className={styles.placar} data-testid="placar-turno" data-base={base}>
      <ol className={styles.faixa} aria-hidden="true">
        {desfechos.flatMap((d) =>
          grupos[d].map((uf) => (
            <li
              key={uf.sigla}
              className={`${styles.celula} ${styles[d]}`}
              data-desfecho={d}
              title={`${uf.nome}: ${rotulo(base, d, 1)}`}
            />
          )),
        )}
      </ol>

      <ul className={styles.grupos}>
        {desfechos.map((d) => {
          const ufs = grupos[d];
          return (
            <li key={d} className={styles.grupo} data-testid="placar-grupo" data-desfecho={d}>
              <p className={styles.cabecaGrupo}>
                <span className={`${styles.amostra} ${styles[d]}`} aria-hidden="true" />
                <span className={styles.numero} data-testid="placar-numero">
                  {ufs.length}
                </span>
                <span className={styles.rotulo}>{rotulo(base, d, ufs.length)}</span>
              </p>
              {ufs.length > 0 ? (
                <ul className={styles.siglas} data-testid="placar-siglas">
                  {ufs.map((uf) => (
                    <li key={uf.sigla} title={uf.nome}>
                      <span aria-hidden="true">{uf.sigla}</span>
                      <span className="sr-only">{uf.nome}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className={styles.nota}>{NOTAS[base]}</p>
    </div>
  );
}
