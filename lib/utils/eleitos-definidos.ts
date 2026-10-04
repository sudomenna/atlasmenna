/**
 * lib/utils/eleitos-definidos.ts
 *
 * Ponto ÚNICO de "quem está MATEMATICAMENTE eleito nesta UF, e o que o
 * cabeçalho diz" — decisão do dono em 2026-10-04 (dia do 1º turno).
 *
 * ## O defeito que isto fecha
 *
 * O balão do mapa nacional (Presidente, Governador, Senador) pintava fundo
 * cheio + ✓ e escrevia "Chamada" quando `EdgeUfRow.chamada === true` — uma
 * leitura da PROJEÇÃO (margem projetada > 10 pp), independente do seletor
 * Parcial/Projeção. Mato Grosso a 27% apurado aparecia com dois senadores
 * "eleitos". Constituição § 1: a tela não proclama o que não está decidido.
 *
 * ## A regra
 *
 * 1. **Fonte única: `EdgeUfRow.eleitos_definidos`**, emitido pelo produtor
 *    (`api/model/`) só quando a eleição está matematicamente decidida (ver a
 *    docstring do campo em `lib/edge-config/types.ts`). Nada aqui olha
 *    `chamada`, margem, `pct`, posição ou base do seletor — por isso o
 *    resultado é IGUAL nas duas bases.
 * 2. **Identidade, nunca posição.** A saída é um conjunto de `id`; quem marca
 *    linha a linha casa pelo `id`, onde quer que a linha caia depois de
 *    reordenada pela base ativa.
 * 3. **Só conta quem está nas linhas e disputa.** Id ausente de
 *    `top_candidatos` é ignorado (não há linha onde pôr o ✓, e o cabeçalho não
 *    pode anunciar um eleito invisível); anulada nunca é eleita (ADR-0053,
 *    defensivo — o produtor não a emite).
 * 4. **Cabeçalho**: 1 eleito ⇒ "Matematicamente eleito"; 2+ ⇒
 *    "Matematicamente eleitos"; nenhum eleito e `segundo_turno_definido` ⇒
 *    "2º turno definido" (sem fundo em ninguém); senão nada.
 *
 * Função pura, sem React e sem I/O — cabe no chunk do mapa (RNF-007b): importa
 * só `destino-voto`, que já está lá.
 */

import type { EdgeUfRow } from "@/lib/edge-config/types";
import { compete } from "@/lib/utils/destino-voto";

export const ROTULO_ELEITO = "Matematicamente eleito";
export const ROTULO_ELEITOS = "Matematicamente eleitos";
export const ROTULO_SEGUNDO_TURNO = "2º turno definido";

export interface DefinicaoDaUf {
  /** Ids (de `top_candidatos[].id`) que recebem fundo cheio + ✓. */
  eleitos: ReadonlySet<number>;
  /** Texto do cabeçalho do balão / status da gaveta; `undefined` ⇒ nenhum. */
  rotulo: string | undefined;
}

const NINGUEM: ReadonlySet<number> = new Set();

export function definicaoDaUf(
  row: Pick<EdgeUfRow, "top_candidatos" | "eleitos_definidos" | "segundo_turno_definido">,
): DefinicaoDaUf {
  const declarados = Array.isArray(row.eleitos_definidos) ? row.eleitos_definidos : [];
  const eleitos = new Set<number>();
  if (declarados.length > 0) {
    for (const tc of row.top_candidatos ?? []) {
      if (declarados.includes(tc.id) && compete(tc)) eleitos.add(tc.id);
    }
  }
  if (eleitos.size === 1) return { eleitos, rotulo: ROTULO_ELEITO };
  if (eleitos.size > 1) return { eleitos, rotulo: ROTULO_ELEITOS };
  if (row.segundo_turno_definido === true) {
    return { eleitos: NINGUEM, rotulo: ROTULO_SEGUNDO_TURNO };
  }
  return { eleitos: NINGUEM, rotulo: undefined };
}
