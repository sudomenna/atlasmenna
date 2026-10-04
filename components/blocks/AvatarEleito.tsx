/**
 * components/blocks/AvatarEleito.tsx — spec 026 RF-291 (decisão do dono de
 * 03/10): a mini-foto, ao lado do nome, de quem está SENDO ELEITO nas páginas
 * de UF de Deputado Federal, Estadual e Distrital.
 *
 * **A regra inteira mora aqui**, e as duas listas que a usam
 * (`<DeputadoListaAgremiacao>`, cliente; `<DeputadoMaisVotados>`, servidor) só
 * a chamam:
 *
 *   - `fotos` ausente ⇒ nada. É opt-in: só a página de UF passa o mapa — a
 *     capa nacional e qualquer outro consumidor ficam como estavam;
 *   - linha que não é eleita ({@link ehEleitoNosBits}: nem parcial nem TSE) ⇒
 *     nada, e a linha fica idêntica à de antes;
 *   - eleita com foto no mapa ⇒ a foto; eleita sem foto no mapa (o TSE não
 *     publicou, a fatia de candidaturas não veio, ambiente sem Blob) ⇒ as
 *     iniciais no MESMO círculo — o átomo `<CandidateAvatar>` (RF-151).
 *
 * Mesmo tratamento para todo partido (constituição § 2): o fundo do círculo é
 * o par neutro do kit, nunca a cor da agremiação. Decorativa (`alt=""` +
 * `aria-hidden`, no átomo): o nome está em texto logo ao lado.
 *
 * Sem diretiva: é importável do componente cliente e do Server Component — um
 * export de módulo `"use client"` chegaria ao servidor como referência, não
 * como valor.
 */

import { CandidateAvatar } from "@/components/atoms/data/CandidateAvatar";
import type { FotosDosEleitos } from "@/lib/deputado/fotos-eleitos";
import { ehEleitoNosBits } from "@/lib/utils/deputado-marcas";

import styles from "./DeputadoListaAgremiacao.module.css";

/** Lado do círculo, em px — os atributos da `<img>` (CLS zero); a CSS repete. */
export const AVATAR_ELEITO_PX = 28;

export interface AvatarEleitoProps {
  /** O nome EXIBIDO na linha — alimenta só as iniciais. */
  nome: string;
  sqcand: number;
  /** Bits de marca já derivados (`bitsDasMarcas`). */
  marcas: number;
  /** Mapa `sqcand → URL` dos eleitos com foto; ausente ⇒ nenhum avatar. */
  fotos: FotosDosEleitos | undefined;
}

export function AvatarEleito({ nome, sqcand, marcas, fotos }: AvatarEleitoProps) {
  if (!fotos || !ehEleitoNosBits(marcas)) return null;
  return (
    <CandidateAvatar
      nome={nome}
      fotoUrl={fotos[String(sqcand)] ?? null}
      width={AVATAR_ELEITO_PX}
      height={AVATAR_ELEITO_PX}
      responsive={false}
      rounded
      // Uma classe, e nenhum `style` por linha: em SP são dezenas de eleitos
      // por página, e a folha diz uma vez o que o `style` diria em cada um.
      semEstiloInline
      className={styles.avatar}
    />
  );
}
