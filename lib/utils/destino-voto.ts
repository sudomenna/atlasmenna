/**
 * lib/utils/destino-voto.ts
 *
 * Ponto ÚNICO de "esta candidatura compete?" na tela — ADR-0053 / RF-213.
 *
 * O modelo já tira a candidatura de voto `"anulado"` das decisões que publica
 * (`por_uf[].lider`, agulha, `p_*`, `chamada`, `vai_a_2t`, `margem_projetada`).
 * Mas a tela deriva líder, ordem, margem, vagas e cor POR CONTA PRÓPRIA a
 * partir das listas (`top_candidatos`, `candidatos`) — e as listas seguem
 * trazendo a anulada com o percentual oficial sobre `vvc` (ADR-0018). Sem este
 * filtro, a ficha diria "Líder: <anulada>" e o mapa pintaria a UF com o
 * partido dela enquanto o modelo, ao lado, aponta outra pessoa.
 *
 * Decisão de exibição do dono (2026-09-27):
 *   - `"anulado"`    ⇒ NÃO compete. Continua na lista, com o percentual
 *                      oficial, no FIM (depois das que competem, antes de
 *                      "Outros"), com a etiqueta textual "Anulado".
 *   - `"sub_judice"` ⇒ compete (segue o TSE). Posição normal, etiqueta
 *                      "Sub judice".
 *   - **ausente**    ⇒ compete. O TSE só publica `dvt` depois da 1ª
 *                      totalização parcial, e o produtor omite o campo quando
 *                      os arquivos divergem. "Desconhecido ⇒ anulado" tiraria
 *                      da disputa, em silêncio, quem o TSE nunca anulou.
 *
 * 🔴 Por isso a regra é `destino !== "anulado"` e NUNCA `destino === "valido"`
 * ou `destino === "valido" || destino === "sub_judice"`: as duas formas
 * "positivas" tratam a ausência como anulada — exatamente o default que o
 * contrato proíbe (`lib/edge-config/types.ts`, docstring de `EdgeDestinoVoto`).
 */

import type { EdgeDestinoVoto } from "@/lib/edge-config/types";

/** Qualquer coisa que carregue (ou não) a destinação do voto. */
export interface ComDestino {
  destino?: EdgeDestinoVoto;
}

/** `true` ⇔ a candidatura disputa a vaga. Ausente ⇒ compete (ver cabeçalho). */
export function compete(c: ComDestino | undefined | null): boolean {
  return c?.destino !== "anulado";
}

/** As que competem, na MESMA ordem recebida. */
export function queCompetem<T extends ComDestino>(lista: readonly T[]): T[] {
  return lista.filter(compete);
}

/** `true` quando ao menos uma candidatura da lista está anulada. */
export function haAnulada(lista: readonly ComDestino[] | undefined | null): boolean {
  return (lista ?? []).some((c) => !compete(c));
}

/**
 * Partição ESTÁVEL: as que competem, na ordem recebida, e depois as anuladas,
 * também na ordem recebida. Sem anulada devolve uma cópia na mesma ordem —
 * nenhuma lista muda de ordem enquanto o TSE não publicar `dvt`.
 */
export function anuladasAoFim<T extends ComDestino>(lista: readonly T[]): T[] {
  const competem: T[] = [];
  const anuladas: T[] = [];
  for (const c of lista) (compete(c) ? competem : anuladas).push(c);
  return [...competem, ...anuladas];
}

/**
 * Texto da etiqueta visível. `null` para `"valido"` e para ausente — só os
 * dois estados que o leitor precisa saber ganham marca.
 */
export function etiquetaDestino(destino: EdgeDestinoVoto | undefined): string | null {
  if (destino === "anulado") return "Anulado";
  if (destino === "sub_judice") return "Sub judice";
  return null;
}

/**
 * O pedaço do NOME ACESSÍVEL de uma linha que tem `aria-label` próprio (o
 * rótulo substitui o conteúdo, então a etiqueta visível não seria lida):
 * `", Anulado"` / `", Sub judice"` ou `""`.
 */
export function sufixoAriaDestino(destino: EdgeDestinoVoto | undefined): string {
  const texto = etiquetaDestino(destino);
  return texto === null ? "" : `, ${texto}`;
}

/**
 * A frase de metodologia — só renderizada quando {@link haAnulada} é `true`.
 * Sem jargão: não diz "vvc", "dvt" nem "destinação".
 */
export const NOTA_ANULADAS =
  "Candidaturas com votos anulados pela Justiça Eleitoral aparecem no fim da lista com o percentual oficial do TSE, mas não contam para definir quem lidera.";
