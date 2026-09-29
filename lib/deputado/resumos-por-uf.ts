/**
 * lib/deputado/resumos-por-uf.ts — o texto de cada UF na grade "Estado a
 * estado" da capa de deputado.
 *
 * Nasceu em `app/(dep)/deputado-federal/page.tsx` e subiu para cá na spec 027
 * (frente U-a), sem mudar uma vírgula da regra: a capa das assembleias
 * (`/deputado-estadual`, frente U-b) monta a mesma grade a partir de DOIS
 * payloads — o do cargo 7 (26 UFs) e o do cargo 8 (o DF) — e junta os
 * resultados. Duas cópias desta função seriam duas regras de "aguardando" que
 * divergiriam no primeiro ajuste.
 *
 * É **exatamente** a prosa que a lista anterior de "Estado a estado"
 * imprimia, movida de dentro do JSX quando a lista virou grade. A grade
 * acrescenta a bandeira, não troca dado por ícone (ADR-0017).
 *
 * UF ausente do payload não entra no mapa, e a grade cai em `SEM_DADO`:
 * "aguardando apuração" / "vagas não publicadas". RF-124 — `null` em
 * `lugares_a_preencher` é "o TSE ainda não publicou", nunca zero, e um
 * "0 de 0" diria que o estado não elege ninguém.
 */

import { SEM_DADO, type UfResumoCorrida } from "@/components/blocks/UfBandeirasGrid";
import type { InterruptorProjecaoLido } from "@/lib/edge-config/reader";
import type { EdgePayloadDeputado } from "@/lib/edge-config/types";
import { seloEstadoProjecao } from "@/lib/utils/deputado-marcas";

/** Sigla da UF → o resumo em texto da corrida dela, para `<UfBandeirasGrid>`. */
export function resumosPorUf(
  payload: EdgePayloadDeputado,
  interruptor: InterruptorProjecaoLido,
): Record<string, UfResumoCorrida> {
  const saida: Record<string, UfResumoCorrida> = {};
  for (const uf of payload.por_uf) {
    // Spec 026 (design § 8.4) — o selo do estado da projeção da UF, só com o
    // interruptor LIGADO: desligado, a projeção não existe na capa, nem como
    // selo (RF-265). O texto traz "não oficial" junto (RF-266).
    const selo = interruptor.ligada ? seloEstadoProjecao(uf.projecao) : null;
    saida[uf.sigla] = {
      ...(selo ? { selo } : {}),
      detalhe:
        (uf.lider ? `maior bancada: ${uf.lider.sigla} (${uf.lider.cadeiras})` : SEM_DADO.detalhe) +
        (uf.empates_indeterminados > 0
          ? ` · ${uf.empates_indeterminados} em empate sem desempate previsto`
          : "") +
        (uf.vagas_nao_preenchidas > 0
          ? ` · ${uf.vagas_nao_preenchidas} vaga sem candidato elegível`
          : ""),
      vagas:
        uf.lugares_a_preencher == null
          ? SEM_DADO.vagas
          : `${uf.cadeiras_definidas} de ${uf.lugares_a_preencher}`,
    };
  }
  return saida;
}
