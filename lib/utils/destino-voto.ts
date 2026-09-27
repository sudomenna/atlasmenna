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
 *   - `"anulado"`    ⇒ NÃO compete. Continua na lista, no FIM (depois das que
 *                      competem, antes de "Outros"), com a etiqueta textual
 *                      "Anulado" — e **SEM percentual** (emenda "opção A",
 *                      abaixo): só os votos, ou só nome e etiqueta quando não
 *                      há voto absoluto no dado.
 *   - `"sub_judice"` ⇒ compete (segue o TSE). Posição normal, etiqueta
 *                      "Sub judice".
 *   - **ausente**    ⇒ compete. O TSE só publica `dvt` depois da 1ª
 *                      totalização parcial, e o produtor omite o campo quando
 *                      os arquivos divergem. "Desconhecido ⇒ anulado" tiraria
 *                      da disputa, em silêncio, quem o TSE nunca anulou.
 *
 * ## Emenda "opção A" ao ADR-0053 (dono, 2026-09-27, 2ª rodada)
 *
 * Com anulada na abrangência, o PRODUTOR publica o percentual de quem compete
 * sobre os **votos em disputa** (`vvc − anuladas`) — a mesma base que decide
 * 1º turno e líder. O percentual da anulada continua no dado, mas sobre `vvc`:
 * outra base. Por isso a tela nunca o exibe ({@link exibePercentual}) e nunca
 * o soma com o de quem compete. Sem anulada, nada muda.
 *
 * 🔴 Por isso a regra é `destino !== "anulado"` e NUNCA `destino === "valido"`
 * ou `destino === "valido" || destino === "sub_judice"`: as duas formas
 * "positivas" tratam a ausência como anulada — exatamente o default que o
 * contrato proíbe (`lib/edge-config/types.ts`, docstring de `EdgeDestinoVoto`).
 */

import type { EdgeDestinoVoto } from "@/lib/edge-config/types";
import { formatPercent, formatVotes, formatVotesCompact } from "@/lib/utils/format";

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
 * `true` ⇔ a tela pode mostrar o PERCENTUAL desta candidatura (emenda "opção
 * A"). Hoje é exatamente {@link compete}: o percentual de quem compete está na
 * base "votos em disputa", o da anulada está em `vvc` — outra base, que não
 * pode aparecer ao lado nem somada. Nome próprio para o ponto de uso dizer O
 * QUE decide ("mostra o número?"), não só "compete?".
 */
export function exibePercentual(c: ComDestino | undefined | null): boolean {
  return compete(c);
}

/**
 * O número que a linha de uma anulada mostra no lugar do percentual:
 * `"1.234.567 votos"` (ou `"1,2 mi votos"` com `compacto`). `null` quando o
 * dado não traz voto absoluto — a linha fica só com nome e etiqueta, nunca com
 * um "0 votos" inventado nem com um "—" que leria como "não sabemos o %".
 */
export function votosDaAnulada(votos: number | null | undefined, compacto = false): string | null {
  if (typeof votos !== "number" || !Number.isFinite(votos) || votos < 0) return null;
  return `${compacto ? formatVotesCompact(votos) : formatVotes(votos)} votos`;
}

/**
 * A parte NUMÉRICA do nome acessível de uma linha de resultado: `"45,0%
 * apurado, 47,1% projetado"` para quem compete; `"1.234 votos"` (ou `""`) para
 * a anulada. Um lugar só para as listas que montam `aria-label` à mão.
 */
export function ariaNumerosResultado(
  c: ComDestino & { votos_atuais?: number | null },
  pctAtual: number,
  pctProjetado: number,
): string {
  if (!exibePercentual(c)) return votosDaAnulada(c.votos_atuais) ?? "";
  return `${formatPercent(pctAtual, 1)} apurado, ${formatPercent(pctProjetado, 1)} projetado`;
}

/**
 * A frase de metodologia — só renderizada quando {@link haAnulada} é `true`.
 * Sem jargão: não diz "vvc", "dvt" nem "destinação". Texto do dono
 * (2026-09-27, opção A), literal.
 */
export const NOTA_ANULADAS =
  "Quando há candidatura com votos anulados pela Justiça Eleitoral, os percentuais são calculados sobre os votos em disputa — sem os anulados. Assim, quem aparece com mais de 50% é quem vence no 1º turno. As candidaturas anuladas aparecem no fim da lista, só com o número de votos.";

/**
 * A mesma frase SEM a segunda sentença, para onde "mais de 50% vence no 1º
 * turno" seria falso: Senado (duas vagas, sem 2º turno) e a folha do
 * município (o município não decide eleição nenhuma). As outras duas
 * sentenças são as do dono, palavra por palavra.
 */
export const NOTA_ANULADAS_SEM_REGRA_1T =
  "Quando há candidatura com votos anulados pela Justiça Eleitoral, os percentuais são calculados sobre os votos em disputa — sem os anulados. As candidaturas anuladas aparecem no fim da lista, só com o número de votos.";

/** A nota certa para a superfície: com a regra dos 50% só onde ela decide. */
export function notaAnuladas(regraDoPrimeiroTurno: boolean): string {
  return regraDoPrimeiroTurno ? NOTA_ANULADAS : NOTA_ANULADAS_SEM_REGRA_1T;
}
