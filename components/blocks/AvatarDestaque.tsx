/**
 * components/blocks/AvatarDestaque.tsx — decisão do dono de 04/10 ("na capa
 * dos deputados precisa trazer o avatar dos candidatos também"): a mini-foto
 * em CADA linha das listas nacionais das capas `/deputado-federal` e
 * `/deputado-estadual` — "Mais votados do país" e "Puxadores de voto".
 *
 * Irmão de `<AvatarEleito>` (páginas de UF), com o mesmo círculo, a mesma
 * classe e o mesmo átomo (`<CandidateAvatar>`, RF-151). Duas diferenças, as
 * duas forçadas pelo que a capa tem na mão:
 *
 *   1. **Sem a regra de eleito.** O payload nacional não leva marca de eleito
 *      (`EdgeDeputadoDestaque`), e o pedido do dono é o avatar dos candidatos
 *      das duas listas — todas as linhas.
 *   2. **A URL sai de `(uf, sqcand)`, sem `foto_ok`.** A capa nunca lê Blob
 *      (spec 026 RF-271/RF-273; ADR-0001: Postgres nunca no read path), e o
 *      `foto_ok` mora na fatia de candidaturas da UF — 27 leituras por capa. A
 *      URL é determinística ({@link candidatoFotoUrl}, o construtor único), o
 *      mesmo caminho que o `<ResultPanel>` já usa para Presidente, Governador e
 *      Senador. Consequência aceita: candidato SEM foto publicada pelo TSE vira
 *      um `<img>` que não carrega — `alt=""` não desenha ícone quebrado e a
 *      classe `.avatar` pinta o fundo neutro, então sobra o círculo cinza, do
 *      mesmo tamanho (nenhum salto de leiaute). Ambiente sem Blob ⇒ `null` ⇒ as
 *      iniciais no mesmo círculo.
 *
 * Mesmo tratamento para todo partido (constituição § 2): fundo neutro do kit,
 * nunca a cor da agremiação. Decorativa (`alt=""` + `aria-hidden`, no átomo):
 * o nome está em texto logo ao lado.
 *
 * Só para Server Components (as duas listas da capa são): importa
 * `lib/blob/paths`, que lê a base do Blob do AMBIENTE do servidor. Por isso
 * mora fora de `AvatarEleito.tsx`, que a lista cliente da UF importa.
 */

import { CandidateAvatar } from "@/components/atoms/data/CandidateAvatar";
import { candidatoFotoUrl } from "@/lib/blob/paths";

import { AVATAR_ELEITO_PX } from "./AvatarEleito";
import styles from "./DeputadoListaAgremiacao.module.css";

export interface AvatarDestaqueProps {
  /** O nome EXIBIDO na linha — alimenta só as iniciais. */
  nome: string;
  /** UF do candidato — a pasta da foto no Blob. */
  uf: string;
  sqcand: number;
}

export function AvatarDestaque({ nome, uf, sqcand }: AvatarDestaqueProps) {
  return (
    <CandidateAvatar
      nome={nome}
      fotoUrl={candidatoFotoUrl(uf, String(sqcand))}
      width={AVATAR_ELEITO_PX}
      height={AVATAR_ELEITO_PX}
      responsive={false}
      rounded
      // Nenhum `style` por linha (até 40 linhas na capa): a folha diz uma vez.
      semEstiloInline
      className={styles.avatar}
    />
  );
}
